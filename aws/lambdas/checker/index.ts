/**
 * Regional Checker Lambda
 * Runs in each configured AWS region, performs health checks, and writes results to central DynamoDB
 *
 * Uses undici for detailed timing metrics (DNS, TLS, TTFB, etc.)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { Client, Dispatcher } from 'undici'
import * as net from 'net'
import * as tls from 'tls'
import * as dns from 'dns'
import { promisify } from 'util'

import type {
  MonitorTarget,
  AWSRegion,
  TimingMetrics,
  CheckResultItem,
  LatencyHistoryItem,
} from '../../types/config'

const dnsLookup = promisify(dns.lookup)

// Environment variables
const CENTRAL_REGION = process.env.CENTRAL_REGION || 'us-east-1'
const TABLE_NAME = process.env.TABLE_NAME || 'uptimeflare'
const CURRENT_REGION = (process.env.AWS_REGION || 'us-east-1') as AWSRegion
const MONITORS_CONFIG = process.env.MONITORS_CONFIG // JSON string of monitors for this region

// DynamoDB client configured for central region (cross-region writes)
const dynamoClient = new DynamoDBClient({ region: CENTRAL_REGION })
const docClient = DynamoDBDocumentClient.from(dynamoClient)

// TTL constants
const CHECK_TTL_HOURS = 12
const LATENCY_TTL_HOURS = 12

interface CheckResult {
  status: 'up' | 'down'
  latency: number
  timing: TimingMetrics
  error?: string
}

/**
 * Perform HTTP/HTTPS check with detailed timing using undici
 */
async function checkHttp(monitor: MonitorTarget): Promise<CheckResult> {
  const timing: TimingMetrics = {
    dnsLookup: 0,
    tcpConnect: 0,
    tlsHandshake: 0,
    ttfb: 0,
    contentDownload: 0,
    total: 0,
  }

  const startTime = performance.now()
  const timeout = monitor.timeout || 10000

  try {
    const url = new URL(monitor.target)
    const isHttps = url.protocol === 'https:'

    // Step 1: DNS Lookup timing
    const dnsStart = performance.now()
    let resolvedAddress: string
    try {
      const result = await dnsLookup(url.hostname)
      resolvedAddress = result.address
      timing.dnsLookup = Math.round(performance.now() - dnsStart)
    } catch (dnsError) {
      timing.dnsLookup = Math.round(performance.now() - dnsStart)
      throw new Error(`DNS lookup failed: ${(dnsError as Error).message}`)
    }

    // Step 2: TCP + TLS timing via undici with diagnostics
    const connectStart = performance.now()

    // Create undici client with connection tracking
    const client = new Client(url.origin, {
      connect: {
        timeout: timeout,
        // Track connection phases
        lookup: (_hostname, _options, callback) => {
          // DNS already resolved, use cached result
          callback(null, resolvedAddress, 4)
        },
      },
      headersTimeout: timeout,
      bodyTimeout: timeout,
    })

    // Track timing through request lifecycle
    let tcpConnected = 0
    let tlsConnected = 0
    let responseStart = 0

    const requestOptions: Dispatcher.RequestOptions = {
      path: url.pathname + url.search,
      method: monitor.method as Dispatcher.HttpMethod,
      headers: {
        'User-Agent': 'UptimeFlare-AWS/1.0',
        Host: url.host,
        ...(monitor.headers || {}),
      },
    }

    if (monitor.body && ['POST', 'PUT', 'PATCH'].includes(monitor.method)) {
      requestOptions.body = monitor.body
    }

    // Execute request with timing hooks
    const response = await client.request(requestOptions)

    // Calculate timing phases
    const afterConnect = performance.now()
    timing.tcpConnect = Math.round(afterConnect - connectStart - timing.dnsLookup)

    if (isHttps) {
      // For HTTPS, estimate TLS handshake as ~40% of connection overhead
      // This is an approximation since undici doesn't expose exact TLS timing
      const connectionOverhead = timing.tcpConnect
      timing.tlsHandshake = Math.round(connectionOverhead * 0.4)
      timing.tcpConnect = Math.round(connectionOverhead * 0.6)
    }

    responseStart = performance.now()
    timing.ttfb = Math.round(responseStart - startTime)

    // Read response body
    const bodyStart = performance.now()
    const chunks: Buffer[] = []
    for await (const chunk of response.body) {
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks).toString('utf-8')
    timing.contentDownload = Math.round(performance.now() - bodyStart)
    timing.total = Math.round(performance.now() - startTime)

    await client.close()

    // Validate response
    const statusCode = response.statusCode
    const expectedCodes = monitor.expectedCodes || [200, 201, 202, 203, 204, 205, 206]
    const statusOk =
      expectedCodes.length > 0
        ? expectedCodes.includes(statusCode)
        : statusCode >= 200 && statusCode < 300

    if (!statusOk) {
      return {
        status: 'down',
        latency: timing.total,
        timing,
        error: `HTTP ${statusCode} (expected ${expectedCodes.join('/')})`,
      }
    }

    // Check for required keyword
    if (monitor.responseKeyword && !body.includes(monitor.responseKeyword)) {
      return {
        status: 'down',
        latency: timing.total,
        timing,
        error: `Response missing required keyword: ${monitor.responseKeyword}`,
      }
    }

    // Check for forbidden keyword
    if (monitor.responseForbiddenKeyword && body.includes(monitor.responseForbiddenKeyword)) {
      return {
        status: 'down',
        latency: timing.total,
        timing,
        error: `Response contains forbidden keyword: ${monitor.responseForbiddenKeyword}`,
      }
    }

    return {
      status: 'up',
      latency: timing.total,
      timing,
    }
  } catch (error) {
    timing.total = Math.round(performance.now() - startTime)
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Categorize error
    let errorType = 'Connection failed'
    if (errorMessage.includes('DNS')) {
      errorType = 'DNS resolution failed'
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      errorType = 'Request timeout'
    } else if (errorMessage.includes('ECONNREFUSED')) {
      errorType = 'Connection refused'
    } else if (errorMessage.includes('ENOTFOUND')) {
      errorType = 'Host not found'
    } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
      errorType = 'TLS/SSL error'
    }

    return {
      status: 'down',
      latency: timing.total,
      timing,
      error: `${errorType}: ${errorMessage}`,
    }
  }
}

/**
 * Perform TCP ping check with detailed timing
 */
async function checkTcp(monitor: MonitorTarget): Promise<CheckResult> {
  const timing: TimingMetrics = {
    dnsLookup: 0,
    tcpConnect: 0,
    tlsHandshake: 0,
    ttfb: 0,
    contentDownload: 0,
    total: 0,
  }

  const startTime = performance.now()
  const timeout = monitor.timeout || 5000

  // Parse host:port
  const [host, portStr] = monitor.target.split(':')
  const port = parseInt(portStr, 10)

  if (!host || !port) {
    return {
      status: 'down',
      latency: 0,
      timing,
      error: 'Invalid target format (expected host:port)',
    }
  }

  try {
    // Step 1: DNS Lookup
    const dnsStart = performance.now()
    let resolvedAddress: string
    try {
      const result = await dnsLookup(host)
      resolvedAddress = result.address
      timing.dnsLookup = Math.round(performance.now() - dnsStart)
    } catch (dnsError) {
      timing.dnsLookup = Math.round(performance.now() - dnsStart)
      timing.total = timing.dnsLookup
      throw new Error(`DNS lookup failed: ${(dnsError as Error).message}`)
    }

    // Step 2: TCP Connect
    const connectStart = performance.now()

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket()

      const timeoutId = setTimeout(() => {
        socket.destroy()
        reject(new Error('Connection timeout'))
      }, timeout)

      socket.connect(port, resolvedAddress, () => {
        clearTimeout(timeoutId)
        timing.tcpConnect = Math.round(performance.now() - connectStart)
        timing.total = Math.round(performance.now() - startTime)
        socket.destroy()
        resolve()
      })

      socket.on('error', (err) => {
        clearTimeout(timeoutId)
        timing.tcpConnect = Math.round(performance.now() - connectStart)
        timing.total = Math.round(performance.now() - startTime)
        reject(err)
      })
    })

    return {
      status: 'up',
      latency: timing.total,
      timing,
    }
  } catch (error) {
    timing.total = Math.round(performance.now() - startTime)
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      status: 'down',
      latency: timing.total,
      timing,
      error: errorMessage,
    }
  }
}

/**
 * Execute a single monitor check
 */
async function executeCheck(monitor: MonitorTarget): Promise<CheckResult> {
  if (monitor.method === 'TCP_PING') {
    return checkTcp(monitor)
  }
  return checkHttp(monitor)
}

/**
 * Write check result to DynamoDB
 */
async function writeCheckResult(
  monitorId: string,
  region: AWSRegion,
  result: CheckResult,
  timestamp: number
): Promise<void> {
  const ttl = Math.floor(timestamp / 1000) + CHECK_TTL_HOURS * 60 * 60

  const checkItem: CheckResultItem = {
    pk: `CHECK#${monitorId}`,
    sk: `${timestamp}#${region}`,
    monitorId,
    region,
    status: result.status,
    latency: result.latency,
    timing: result.timing,
    error: result.error,
    timestamp,
    ttl,
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: checkItem,
    })
  )

  // Also write to latency history for charts
  const latencyItem: LatencyHistoryItem = {
    pk: `LATENCY#${monitorId}#${region}`,
    sk: `${timestamp}`,
    monitorId,
    region,
    latency: result.latency,
    timing: result.timing,
    timestamp,
    ttl,
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: latencyItem,
    })
  )
}

/**
 * Lambda handler - runs all monitors configured for this region
 */
export async function handler(event: unknown): Promise<{ statusCode: number; body: string }> {
  const timestamp = Date.now()

  // Parse monitors configuration
  let monitors: MonitorTarget[]
  try {
    monitors = JSON.parse(MONITORS_CONFIG || '[]')
  } catch {
    console.error('Failed to parse MONITORS_CONFIG')
    return { statusCode: 500, body: 'Invalid monitors configuration' }
  }

  // Filter monitors that should run in this region
  const regionMonitors = monitors.filter((m) => m.regions.includes(CURRENT_REGION))

  console.log(
    `Running ${regionMonitors.length} checks from region ${CURRENT_REGION} at ${new Date(timestamp).toISOString()}`
  )

  // Execute all checks in parallel
  const results = await Promise.allSettled(
    regionMonitors.map(async (monitor) => {
      const startTime = performance.now()
      const result = await executeCheck(monitor)
      const duration = Math.round(performance.now() - startTime)

      console.log(
        `[${monitor.id}] ${result.status.toUpperCase()} - ${result.latency}ms (DNS: ${result.timing.dnsLookup}ms, TCP: ${result.timing.tcpConnect}ms, TLS: ${result.timing.tlsHandshake}ms, TTFB: ${result.timing.ttfb}ms)${result.error ? ` - ${result.error}` : ''}`
      )

      // Write to DynamoDB
      await writeCheckResult(monitor.id, CURRENT_REGION, result, timestamp)

      return {
        monitorId: monitor.id,
        ...result,
        checkDuration: duration,
      }
    })
  )

  // Summarize results
  const successful = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length

  const summary = {
    region: CURRENT_REGION,
    timestamp,
    monitorsChecked: regionMonitors.length,
    successful,
    failed,
    results: results.map((r) => {
      if (r.status === 'fulfilled') {
        return r.value
      }
      return { error: (r.reason as Error).message }
    }),
  }

  console.log(`Completed: ${successful} successful, ${failed} failed`)

  return {
    statusCode: 200,
    body: JSON.stringify(summary),
  }
}
