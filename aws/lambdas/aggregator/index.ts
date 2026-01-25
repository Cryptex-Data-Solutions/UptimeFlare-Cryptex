/**
 * Aggregator Lambda
 * Runs every minute in the central region to:
 * - Aggregate check results from all regional checkers
 * - Apply majority voting for up/down determination
 * - Detect latency spikes and threshold breaches
 * - Update monitor state
 * - Send notifications
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

import type {
  MonitorTarget,
  AWSRegion,
  CheckResultItem,
  MonitorStateItem,
  GlobalStateItem,
  IncidentItem,
  TimingMetrics,
  NotificationConfig,
} from '../../types/config'

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME || 'uptimeflare'
const MONITORS_CONFIG = process.env.MONITORS_CONFIG // JSON string of all monitors
const NOTIFICATION_CONFIG = process.env.NOTIFICATION_CONFIG // JSON string
const TIMEZONE = process.env.TIMEZONE || 'UTC'

// DynamoDB client
const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)

// TTL constants
const INCIDENT_TTL_DAYS = 90

interface AggregatedResult {
  monitorId: string
  status: 'up' | 'down' | 'degraded'
  primaryRegion: AWSRegion
  primaryLatency: number
  primaryTiming: TimingMetrics
  regionStatuses: Record<AWSRegion, { status: 'up' | 'down'; latency: number; timing: TimingMetrics; error?: string }>
  regionsUp: number
  regionsDown: number
  majorityStatus: 'up' | 'down'
  error?: string
}

/**
 * Fetch recent check results for a monitor from all regions
 */
async function getRecentCheckResults(
  monitorId: string,
  regions: AWSRegion[],
  windowMs: number = 90000 // 90 seconds to account for clock drift
): Promise<CheckResultItem[]> {
  const now = Date.now()
  const cutoff = now - windowMs

  const results: CheckResultItem[] = []

  // Query check results for each region
  for (const region of regions) {
    try {
      const response = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk AND sk > :cutoff',
          ExpressionAttributeValues: {
            ':pk': `CHECK#${monitorId}`,
            ':cutoff': `${cutoff}#`,
          },
          ScanIndexForward: false, // Most recent first
          Limit: 5, // Get last few results per region
        })
      )

      if (response.Items) {
        // Filter to only this region's results
        const regionResults = response.Items.filter(
          (item) => (item as CheckResultItem).region === region
        ) as CheckResultItem[]

        if (regionResults.length > 0) {
          results.push(regionResults[0]) // Most recent for this region
        }
      }
    } catch (error) {
      console.error(`Error fetching results for ${monitorId} in ${region}:`, error)
    }
  }

  return results
}

/**
 * Get current monitor state from DynamoDB
 */
async function getMonitorState(monitorId: string): Promise<MonitorStateItem | null> {
  try {
    const response = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `STATE#${monitorId}`,
          sk: 'CURRENT',
        },
      })
    )
    return (response.Item as MonitorStateItem) || null
  } catch {
    return null
  }
}

/**
 * Calculate baseline latency for spike detection
 */
async function getBaselineLatency(
  monitorId: string,
  region: AWSRegion,
  windowMinutes: number
): Promise<number | null> {
  const now = Date.now()
  const cutoff = now - windowMinutes * 60 * 1000

  try {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk > :cutoff',
        ExpressionAttributeValues: {
          ':pk': `LATENCY#${monitorId}#${region}`,
          ':cutoff': `${cutoff}`,
        },
        ProjectionExpression: 'latency',
      })
    )

    if (response.Items && response.Items.length > 5) {
      // Calculate median to avoid outlier effects
      const latencies = response.Items.map((item) => item.latency as number).sort((a, b) => a - b)
      const mid = Math.floor(latencies.length / 2)
      return latencies.length % 2 ? latencies[mid] : (latencies[mid - 1] + latencies[mid]) / 2
    }
  } catch (error) {
    console.error(`Error getting baseline for ${monitorId}:`, error)
  }

  return null
}

/**
 * Aggregate results and apply majority voting
 */
function aggregateResults(
  monitor: MonitorTarget,
  checkResults: CheckResultItem[]
): AggregatedResult {
  const regionStatuses: AggregatedResult['regionStatuses'] = {}

  // Default empty timing
  const emptyTiming: TimingMetrics = {
    dnsLookup: 0,
    tcpConnect: 0,
    tlsHandshake: 0,
    ttfb: 0,
    contentDownload: 0,
    total: 0,
  }

  // Process each region's result
  for (const result of checkResults) {
    regionStatuses[result.region] = {
      status: result.status,
      latency: result.latency,
      timing: result.timing || emptyTiming,
      error: result.error,
    }
  }

  // Count up/down regions
  const regionsUp = Object.values(regionStatuses).filter((r) => r.status === 'up').length
  const regionsDown = Object.values(regionStatuses).filter((r) => r.status === 'down').length
  const totalRegions = monitor.regions.length

  // Calculate vote threshold
  const voteThreshold = monitor.alerting?.downVoteThreshold || Math.ceil(totalRegions / 2)

  // Majority voting: down only if >= threshold regions report down
  const majorityStatus: 'up' | 'down' = regionsDown >= voteThreshold ? 'down' : 'up'

  // Get primary region status
  const primaryStatus = regionStatuses[monitor.primaryRegion]
  const primaryLatency = primaryStatus?.latency || 0
  const primaryTiming = primaryStatus?.timing || emptyTiming

  // Determine overall status
  let status: 'up' | 'down' | 'degraded'
  if (majorityStatus === 'down') {
    status = 'down'
  } else if (regionsDown > 0) {
    status = 'degraded' // Some regions down but not majority
  } else {
    status = 'up'
  }

  // Determine error message
  let error: string | undefined
  if (status !== 'up') {
    const downRegions = Object.entries(regionStatuses)
      .filter(([_, s]) => s.status === 'down')
      .map(([r, s]) => `${r}: ${s.error || 'unknown'}`)
    error = downRegions.join('; ')
  }

  return {
    monitorId: monitor.id,
    status,
    primaryRegion: monitor.primaryRegion,
    primaryLatency,
    primaryTiming,
    regionStatuses,
    regionsUp,
    regionsDown,
    majorityStatus,
    error,
  }
}

/**
 * Update monitor state in DynamoDB
 */
async function updateMonitorState(
  monitor: MonitorTarget,
  aggregated: AggregatedResult,
  previousState: MonitorStateItem | null,
  timestamp: number
): Promise<{ stateChanged: boolean; newState: MonitorStateItem }> {
  const previousStatus = previousState?.status || 'up'
  const stateChanged = previousStatus !== aggregated.status

  // Determine downSince and slowSince
  let downSince = previousState?.downSince
  let slowSince = previousState?.slowSince

  if (aggregated.status === 'down' && previousStatus !== 'down') {
    downSince = timestamp
  } else if (aggregated.status !== 'down') {
    downSince = undefined
  }

  // Check latency threshold
  const threshold = monitor.latencyThreshold
  if (threshold && aggregated.primaryLatency > threshold) {
    if (!slowSince) {
      slowSince = timestamp
    }
  } else {
    slowSince = undefined
  }

  const newState: MonitorStateItem = {
    pk: `STATE#${monitor.id}`,
    sk: 'CURRENT',
    monitorId: monitor.id,
    status: aggregated.status,
    primaryLatency: aggregated.primaryLatency,
    primaryTiming: aggregated.primaryTiming,
    regionStatuses: Object.fromEntries(
      Object.entries(aggregated.regionStatuses).map(([r, s]) => [
        r,
        { status: s.status, latency: s.latency },
      ])
    ) as Record<AWSRegion, { status: 'up' | 'down'; latency: number }>,
    lastCheck: timestamp,
    downSince,
    slowSince,
    lastNotifiedDown: previousState?.lastNotifiedDown,
    lastNotifiedSlow: previousState?.lastNotifiedSlow,
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: newState,
    })
  )

  return { stateChanged, newState }
}

/**
 * Create or update incident record
 */
async function updateIncident(
  monitorId: string,
  status: 'up' | 'down' | 'degraded',
  error: string | undefined,
  downSince: number | undefined,
  regionsDown: AWSRegion[],
  timestamp: number
): Promise<void> {
  if (status === 'down' && downSince) {
    // Create or update incident
    const ttl = Math.floor(timestamp / 1000) + INCIDENT_TTL_DAYS * 24 * 60 * 60

    const incident: IncidentItem = {
      pk: `INCIDENT#${monitorId}`,
      sk: `${downSince}`,
      monitorId,
      start: downSince,
      error: error || 'Unknown error',
      regionsDown,
      ttl,
    }

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: incident,
      })
    )
  } else if (status === 'up') {
    // Close any open incident
    // Find the most recent incident without an end time
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `INCIDENT#${monitorId}`,
        },
        ScanIndexForward: false,
        Limit: 1,
      })
    )

    if (response.Items && response.Items.length > 0) {
      const incident = response.Items[0] as IncidentItem
      if (!incident.end) {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: incident.pk,
              sk: incident.sk,
            },
            UpdateExpression: 'SET #end = :end',
            ExpressionAttributeNames: {
              '#end': 'end',
            },
            ExpressionAttributeValues: {
              ':end': timestamp,
            },
          })
        )
      }
    }
  }
}

/**
 * Update global state summary
 */
async function updateGlobalState(
  monitors: MonitorTarget[],
  states: Map<string, MonitorStateItem>,
  timestamp: number
): Promise<void> {
  let overallUp = 0
  let overallDown = 0
  let overallDegraded = 0

  for (const monitor of monitors) {
    const state = states.get(monitor.id)
    if (state?.status === 'up') overallUp++
    else if (state?.status === 'down') overallDown++
    else if (state?.status === 'degraded') overallDegraded++
    else overallUp++ // Default to up if no state
  }

  const globalState: GlobalStateItem = {
    pk: 'STATE#GLOBAL',
    sk: 'SUMMARY',
    overallUp,
    overallDown,
    overallDegraded,
    lastUpdate: timestamp,
  }

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: globalState,
    })
  )
}

/**
 * Format notification message
 */
function formatNotificationMessage(
  monitor: MonitorTarget,
  isUp: boolean,
  downSince: number | undefined,
  error: string | undefined,
  regionStatuses: AggregatedResult['regionStatuses'],
  timestamp: number
): string {
  const timeStr = new Date(timestamp).toLocaleString('en-US', { timeZone: TIMEZONE })
  const groupPrefix = monitor.group ? `[${monitor.group}] ` : ''

  if (isUp && downSince) {
    const downDuration = Math.round((timestamp - downSince) / 60000)
    return `✅ ${groupPrefix}${monitor.name} is up!\nThe service is up again after being down for ${downDuration} minutes.`
  } else if (!isUp) {
    const regionSummary = Object.entries(regionStatuses)
      .map(([r, s]) => `  ${r}: ${s.status}${s.error ? ` (${s.error})` : ''}`)
      .join('\n')

    return `🔴 ${groupPrefix}${monitor.name} is currently down.\nService is unavailable at ${timeStr}.\nIssue: ${error || 'Unknown'}\n\nRegion Status:\n${regionSummary}`
  }

  return ''
}

/**
 * Format latency notification message
 */
function formatLatencyMessage(
  monitor: MonitorTarget,
  isSlow: boolean,
  latency: number,
  threshold: number,
  timing: TimingMetrics,
  slowSince: number | undefined,
  timestamp: number
): string {
  const timeStr = new Date(timestamp).toLocaleString('en-US', { timeZone: TIMEZONE })
  const groupPrefix = monitor.group ? `[${monitor.group}] ` : ''

  const timingBreakdown = `DNS: ${timing.dnsLookup}ms, TCP: ${timing.tcpConnect}ms, TLS: ${timing.tlsHandshake}ms, TTFB: ${timing.ttfb}ms`

  if (isSlow) {
    return `🐢 ${groupPrefix}${monitor.name} is slow!\nResponse time ${latency}ms exceeds threshold of ${threshold}ms at ${timeStr}.\nTiming breakdown: ${timingBreakdown}`
  } else if (slowSince) {
    const slowDuration = Math.round((timestamp - slowSince) / 60000)
    return `⚡ ${groupPrefix}${monitor.name} is fast again!\nResponse time ${latency}ms is back below threshold of ${threshold}ms after being slow for ${slowDuration} minutes.\nTiming breakdown: ${timingBreakdown}`
  }

  return ''
}

/**
 * Format spike notification message
 */
function formatSpikeMessage(
  monitor: MonitorTarget,
  currentLatency: number,
  baselineLatency: number,
  spikePercent: number,
  timing: TimingMetrics,
  timestamp: number
): string {
  const timeStr = new Date(timestamp).toLocaleString('en-US', { timeZone: TIMEZONE })
  const groupPrefix = monitor.group ? `[${monitor.group}] ` : ''

  // Identify which phase caused the spike
  let spikeCause = 'overall response'
  if (timing.dnsLookup > 100) spikeCause = 'DNS resolution'
  else if (timing.tlsHandshake > 200) spikeCause = 'TLS handshake (possible CPU load)'
  else if (timing.ttfb > timing.total * 0.7) spikeCause = 'server response (TTFB)'

  return `📈 ${groupPrefix}${monitor.name} latency spike detected!\nCurrent: ${currentLatency}ms (${spikePercent.toFixed(0)}% above baseline of ${baselineLatency}ms)\nLikely cause: ${spikeCause}\nTiming: DNS=${timing.dnsLookup}ms, TLS=${timing.tlsHandshake}ms, TTFB=${timing.ttfb}ms\nDetected at ${timeStr}`
}

/**
 * Send webhook notification
 */
async function sendNotification(message: string, config: NotificationConfig): Promise<void> {
  if (!config.webhook?.url || !message) return

  try {
    const { url, method = 'POST', headers = {}, payloadType, payload, timeout = 5000 } = config.webhook

    // Replace $MSG in payload
    const processedPayload = JSON.parse(JSON.stringify(payload).replace(/\$MSG/g, message))

    let requestUrl = url
    let body: string | undefined
    const requestHeaders: Record<string, string> = { ...headers }

    if (payloadType === 'param') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(processedPayload)) {
        params.append(key, String(value))
      }
      requestUrl = `${url}?${params.toString()}`
    } else if (payloadType === 'json') {
      body = JSON.stringify(processedPayload)
      requestHeaders['Content-Type'] = 'application/json'
    } else if (payloadType === 'x-www-form-urlencoded') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(processedPayload)) {
        params.append(key, String(value))
      }
      body = params.toString()
      requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    await fetch(requestUrl, {
      method: method || 'POST',
      headers: requestHeaders,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    console.log('Notification sent successfully')
  } catch (error) {
    console.error('Failed to send notification:', error)
  }
}

/**
 * Lambda handler - runs every minute to aggregate all monitor results
 */
export async function handler(event: unknown): Promise<{ statusCode: number; body: string }> {
  const timestamp = Date.now()

  // Parse configurations
  let monitors: MonitorTarget[]
  let notificationConfig: NotificationConfig | undefined

  try {
    monitors = JSON.parse(MONITORS_CONFIG || '[]')
  } catch {
    console.error('Failed to parse MONITORS_CONFIG')
    return { statusCode: 500, body: 'Invalid monitors configuration' }
  }

  try {
    notificationConfig = NOTIFICATION_CONFIG ? JSON.parse(NOTIFICATION_CONFIG) : undefined
  } catch {
    console.warn('Failed to parse NOTIFICATION_CONFIG, notifications disabled')
  }

  console.log(`Aggregating results for ${monitors.length} monitors at ${new Date(timestamp).toISOString()}`)

  const states = new Map<string, MonitorStateItem>()
  const notifications: string[] = []

  // Process each monitor
  for (const monitor of monitors) {
    try {
      // Get recent check results from all regions
      const checkResults = await getRecentCheckResults(monitor.id, monitor.regions)

      if (checkResults.length === 0) {
        console.warn(`No recent check results for ${monitor.id}`)
        continue
      }

      // Aggregate results with majority voting
      const aggregated = aggregateResults(monitor, checkResults)

      // Get previous state
      const previousState = await getMonitorState(monitor.id)

      // Update state
      const { stateChanged, newState } = await updateMonitorState(
        monitor,
        aggregated,
        previousState,
        timestamp
      )

      states.set(monitor.id, newState)

      // Handle status change notifications
      if (stateChanged && notificationConfig) {
        const skipNotify = notificationConfig.skipNotificationIds?.includes(monitor.id)

        if (!skipNotify) {
          const gracePeriod = (notificationConfig.gracePeriod || 0) * 60 * 1000

          // DOWN notification
          if (aggregated.status === 'down') {
            const downDuration = timestamp - (newState.downSince || timestamp)
            if (downDuration >= gracePeriod) {
              if (!newState.lastNotifiedDown || newState.lastNotifiedDown < (newState.downSince || 0)) {
                const message = formatNotificationMessage(
                  monitor,
                  false,
                  newState.downSince,
                  aggregated.error,
                  aggregated.regionStatuses,
                  timestamp
                )
                notifications.push(message)

                // Update last notified
                await docClient.send(
                  new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { pk: newState.pk, sk: newState.sk },
                    UpdateExpression: 'SET lastNotifiedDown = :t',
                    ExpressionAttributeValues: { ':t': timestamp },
                  })
                )
              }
            }
          }

          // UP notification (only if we sent a DOWN notification)
          if (aggregated.status === 'up' && previousState?.status === 'down') {
            if (previousState.lastNotifiedDown) {
              const message = formatNotificationMessage(
                monitor,
                true,
                previousState.downSince,
                undefined,
                aggregated.regionStatuses,
                timestamp
              )
              notifications.push(message)
            }
          }
        }
      }

      // Handle latency threshold notifications
      if (monitor.latencyThreshold && notificationConfig) {
        const threshold = monitor.latencyThreshold
        const slowGracePeriod = (monitor.alerting?.slowGracePeriod || 3) * 60 * 1000

        const wasSlowBefore = previousState?.slowSince !== undefined
        const isSlowNow = aggregated.primaryLatency > threshold

        if (isSlowNow && !wasSlowBefore) {
          // Just became slow - wait for grace period
        } else if (isSlowNow && wasSlowBefore) {
          // Still slow - check grace period
          const slowDuration = timestamp - (newState.slowSince || timestamp)
          if (slowDuration >= slowGracePeriod && !previousState?.lastNotifiedSlow) {
            const message = formatLatencyMessage(
              monitor,
              true,
              aggregated.primaryLatency,
              threshold,
              aggregated.primaryTiming,
              newState.slowSince,
              timestamp
            )
            notifications.push(message)

            await docClient.send(
              new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { pk: newState.pk, sk: newState.sk },
                UpdateExpression: 'SET lastNotifiedSlow = :t',
                ExpressionAttributeValues: { ':t': timestamp },
              })
            )
          }
        } else if (!isSlowNow && wasSlowBefore && previousState?.lastNotifiedSlow) {
          // Recovered from slow
          const message = formatLatencyMessage(
            monitor,
            false,
            aggregated.primaryLatency,
            threshold,
            aggregated.primaryTiming,
            previousState.slowSince,
            timestamp
          )
          notifications.push(message)
        }
      }

      // Handle spike detection
      if (monitor.alerting?.spikeDetection?.enabled) {
        const { thresholdPercent, baselineWindowMinutes } = monitor.alerting.spikeDetection
        const baseline = await getBaselineLatency(monitor.id, monitor.primaryRegion, baselineWindowMinutes)

        if (baseline && aggregated.primaryLatency > baseline * (1 + thresholdPercent / 100)) {
          const spikePercent = ((aggregated.primaryLatency - baseline) / baseline) * 100
          const message = formatSpikeMessage(
            monitor,
            aggregated.primaryLatency,
            baseline,
            spikePercent,
            aggregated.primaryTiming,
            timestamp
          )
          notifications.push(message)
        }
      }

      // Update incident records
      const regionsDown = Object.entries(aggregated.regionStatuses)
        .filter(([_, s]) => s.status === 'down')
        .map(([r]) => r as AWSRegion)

      await updateIncident(
        monitor.id,
        aggregated.status,
        aggregated.error,
        newState.downSince,
        regionsDown,
        timestamp
      )

      console.log(
        `[${monitor.id}] ${aggregated.status.toUpperCase()} - Primary: ${aggregated.primaryLatency}ms, ` +
          `Regions: ${aggregated.regionsUp}/${monitor.regions.length} up`
      )
    } catch (error) {
      console.error(`Error processing monitor ${monitor.id}:`, error)
    }
  }

  // Update global state
  await updateGlobalState(monitors, states, timestamp)

  // Send all notifications
  if (notificationConfig) {
    for (const notification of notifications) {
      await sendNotification(notification, notificationConfig)
    }
  }

  console.log(`Aggregation complete. Sent ${notifications.length} notifications.`)

  return {
    statusCode: 200,
    body: JSON.stringify({
      timestamp,
      monitorsProcessed: monitors.length,
      notificationsSent: notifications.length,
    }),
  }
}
