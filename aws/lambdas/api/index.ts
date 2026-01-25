/**
 * API Lambda for UptimeFlare Status Page
 * Serves status data, latency history, and incidents via API Gateway
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

import type {
  MonitorTarget,
  MonitorStateItem,
  GlobalStateItem,
  IncidentItem,
  LatencyHistoryItem,
  MaintenanceConfig,
  AWSRegion,
} from '../../types/config'

// Environment variables
const TABLE_NAME = process.env.TABLE_NAME || 'uptimeflare'
const MONITORS_CONFIG = process.env.MONITORS_CONFIG
const MAINTENANCES_CONFIG = process.env.MAINTENANCES_CONFIG
const PAGE_CONFIG = process.env.PAGE_CONFIG
const PASSWORD_PROTECTION = process.env.PASSWORD_PROTECTION // user:pass format

// DynamoDB client
const dynamoClient = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(dynamoClient)

// Parse configurations
function getMonitors(): MonitorTarget[] {
  try {
    return JSON.parse(MONITORS_CONFIG || '[]')
  } catch {
    return []
  }
}

function getMaintenances(): MaintenanceConfig[] {
  try {
    return JSON.parse(MAINTENANCES_CONFIG || '[]')
  } catch {
    return []
  }
}

function getPageConfig(): Record<string, unknown> {
  try {
    return JSON.parse(PAGE_CONFIG || '{}')
  } catch {
    return {}
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

/**
 * Check basic auth
 */
function checkAuth(event: APIGatewayProxyEvent): boolean {
  if (!PASSWORD_PROTECTION) return true

  const authHeader = event.headers['Authorization'] || event.headers['authorization']
  if (!authHeader?.startsWith('Basic ')) return false

  const base64Credentials = authHeader.slice(6)
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')

  return credentials === PASSWORD_PROTECTION
}

/**
 * Get global state summary
 */
async function getGlobalState(): Promise<GlobalStateItem | null> {
  try {
    const response = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: 'STATE#GLOBAL',
          sk: 'SUMMARY',
        },
      })
    )
    return (response.Item as GlobalStateItem) || null
  } catch {
    return null
  }
}

/**
 * Get all monitor states
 */
async function getAllMonitorStates(): Promise<Map<string, MonitorStateItem>> {
  const states = new Map<string, MonitorStateItem>()

  try {
    // Scan for all STATE# items (could optimize with GSI if needed)
    const response = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :prefix) AND sk = :current',
        ExpressionAttributeValues: {
          ':prefix': 'STATE#',
          ':current': 'CURRENT',
        },
      })
    )

    if (response.Items) {
      for (const item of response.Items) {
        const state = item as MonitorStateItem
        if (state.monitorId) {
          states.set(state.monitorId, state)
        }
      }
    }
  } catch (error) {
    console.error('Error fetching monitor states:', error)
  }

  return states
}

/**
 * Get latency history for a monitor/region
 */
async function getLatencyHistory(
  monitorId: string,
  region: AWSRegion,
  hoursBack: number = 12
): Promise<LatencyHistoryItem[]> {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000

  try {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk > :cutoff',
        ExpressionAttributeValues: {
          ':pk': `LATENCY#${monitorId}#${region}`,
          ':cutoff': `${cutoff}`,
        },
        ScanIndexForward: true, // Oldest first for charts
      })
    )

    return (response.Items as LatencyHistoryItem[]) || []
  } catch (error) {
    console.error(`Error fetching latency history for ${monitorId}:`, error)
    return []
  }
}

/**
 * Get incidents for a monitor
 */
async function getIncidents(monitorId: string, daysBack: number = 90): Promise<IncidentItem[]> {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000

  try {
    const response = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk > :cutoff',
        ExpressionAttributeValues: {
          ':pk': `INCIDENT#${monitorId}`,
          ':cutoff': `${cutoff}`,
        },
        ScanIndexForward: false, // Most recent first
      })
    )

    return (response.Items as IncidentItem[]) || []
  } catch (error) {
    console.error(`Error fetching incidents for ${monitorId}:`, error)
    return []
  }
}

/**
 * Get all incidents across all monitors
 */
async function getAllIncidents(daysBack: number = 90): Promise<IncidentItem[]> {
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
  const incidents: IncidentItem[] = []

  try {
    const response = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :prefix) AND #start > :cutoff',
        ExpressionAttributeNames: {
          '#start': 'start',
        },
        ExpressionAttributeValues: {
          ':prefix': 'INCIDENT#',
          ':cutoff': cutoff,
        },
      })
    )

    if (response.Items) {
      incidents.push(...(response.Items as IncidentItem[]))
    }

    // Sort by start time descending
    incidents.sort((a, b) => b.start - a.start)
  } catch (error) {
    console.error('Error fetching all incidents:', error)
  }

  return incidents
}

/**
 * Check if a monitor is in maintenance
 */
function isInMaintenance(monitorId: string, maintenances: MaintenanceConfig[]): MaintenanceConfig | null {
  const now = Date.now()

  for (const maintenance of maintenances) {
    if (maintenance.monitors && !maintenance.monitors.includes(monitorId)) {
      continue
    }

    const start =
      typeof maintenance.start === 'string' ? new Date(maintenance.start).getTime() : maintenance.start
    const end = maintenance.end
      ? typeof maintenance.end === 'string'
        ? new Date(maintenance.end).getTime()
        : maintenance.end
      : Infinity

    if (now >= start && now <= end) {
      return maintenance
    }
  }

  return null
}

/**
 * Handler for GET /api/status
 * Returns current status of all monitors
 */
async function handleStatus(): Promise<APIGatewayProxyResult> {
  const monitors = getMonitors()
  const maintenances = getMaintenances()
  const globalState = await getGlobalState()
  const monitorStates = await getAllMonitorStates()

  const result: Record<string, unknown> = {
    up: globalState?.overallUp || 0,
    down: globalState?.overallDown || 0,
    degraded: globalState?.overallDegraded || 0,
    updatedAt: globalState?.lastUpdate || Date.now(),
    maintenances,
    monitors: {} as Record<string, unknown>,
  }

  for (const monitor of monitors) {
    const state = monitorStates.get(monitor.id)
    const maintenance = isInMaintenance(monitor.id, maintenances)

    ;(result.monitors as Record<string, unknown>)[monitor.id] = {
      name: monitor.name,
      status: maintenance ? 'maintenance' : state?.status || 'unknown',
      primaryRegion: monitor.primaryRegion,
      latency: state?.primaryLatency || 0,
      timing: state?.primaryTiming || null,
      regionStatuses: state?.regionStatuses || {},
      lastCheck: state?.lastCheck || null,
      downSince: state?.downSince || null,
      slowSince: state?.slowSince || null,
      maintenance: maintenance
        ? {
            title: maintenance.title || 'Scheduled Maintenance',
            body: maintenance.body,
          }
        : null,
    }
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(result),
  }
}

/**
 * Handler for GET /api/data
 * Compatibility endpoint matching original UptimeFlare format
 */
async function handleData(): Promise<APIGatewayProxyResult> {
  const monitors = getMonitors()
  const maintenances = getMaintenances()
  const globalState = await getGlobalState()
  const monitorStates = await getAllMonitorStates()

  const result: Record<string, unknown> = {
    up: globalState?.overallUp || 0,
    down: globalState?.overallDown || 0,
    updatedAt: globalState?.lastUpdate || Date.now(),
    maintenances,
    monitors: {} as Record<string, unknown>,
  }

  for (const monitor of monitors) {
    const state = monitorStates.get(monitor.id)
    const maintenance = isInMaintenance(monitor.id, maintenances)

    ;(result.monitors as Record<string, unknown>)[monitor.id] = {
      up: maintenance ? true : state?.status === 'up' || state?.status === 'degraded',
      latency: state?.primaryLatency || 0,
      location: monitor.primaryRegion,
      message: state?.status === 'down' ? 'Service unavailable' : 'OK',
    }
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(result),
  }
}

/**
 * Handler for GET /api/history/{monitorId}
 * Returns latency history for charts
 */
async function handleHistory(monitorId: string, region?: string): Promise<APIGatewayProxyResult> {
  const monitors = getMonitors()
  const monitor = monitors.find((m) => m.id === monitorId)

  if (!monitor) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Monitor not found' }),
    }
  }

  const targetRegion = (region as AWSRegion) || monitor.primaryRegion
  const history = await getLatencyHistory(monitorId, targetRegion)

  // Format for chart.js
  const chartData = {
    monitorId,
    region: targetRegion,
    data: history.map((h) => ({
      time: h.timestamp,
      latency: h.latency,
      timing: h.timing,
    })),
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(chartData),
  }
}

/**
 * Handler for GET /api/history/{monitorId}/all
 * Returns latency history for all regions
 */
async function handleHistoryAllRegions(monitorId: string): Promise<APIGatewayProxyResult> {
  const monitors = getMonitors()
  const monitor = monitors.find((m) => m.id === monitorId)

  if (!monitor) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Monitor not found' }),
    }
  }

  const result: Record<string, unknown> = {
    monitorId,
    primaryRegion: monitor.primaryRegion,
    regions: {},
  }

  for (const region of monitor.regions) {
    const history = await getLatencyHistory(monitorId, region)
    ;(result.regions as Record<string, unknown>)[region] = history.map((h) => ({
      time: h.timestamp,
      latency: h.latency,
      timing: h.timing,
    }))
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(result),
  }
}

/**
 * Handler for GET /api/incidents
 * Returns incident history
 */
async function handleIncidents(monitorId?: string): Promise<APIGatewayProxyResult> {
  let incidents: IncidentItem[]

  if (monitorId) {
    incidents = await getIncidents(monitorId)
  } else {
    incidents = await getAllIncidents()
  }

  // Group by month for display
  const byMonth: Record<string, IncidentItem[]> = {}

  for (const incident of incidents) {
    const date = new Date(incident.start)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    if (!byMonth[monthKey]) {
      byMonth[monthKey] = []
    }
    byMonth[monthKey].push(incident)
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      incidents,
      byMonth,
    }),
  }
}

/**
 * Handler for GET /api/config
 * Returns page configuration (non-sensitive)
 */
async function handleConfig(): Promise<APIGatewayProxyResult> {
  const monitors = getMonitors()
  const pageConfig = getPageConfig()
  const maintenances = getMaintenances()

  // Return only safe fields
  const safeMonitors = monitors.map((m) => ({
    id: m.id,
    name: m.name,
    tooltip: m.tooltip,
    statusPageLink: m.statusPageLink,
    hideLatencyChart: m.hideLatencyChart,
    group: m.group,
    regions: m.regions,
    primaryRegion: m.primaryRegion,
  }))

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      page: pageConfig,
      monitors: safeMonitors,
      maintenances,
    }),
  }
}

/**
 * Handler for GET /api/badge
 * Returns shields.io compatible badge data
 */
async function handleBadge(
  monitorId: string,
  options: {
    label?: string
    up?: string
    down?: string
    colorUp?: string
    colorDown?: string
  }
): Promise<APIGatewayProxyResult> {
  const monitorStates = await getAllMonitorStates()
  const state = monitorStates.get(monitorId)

  const isUp = state?.status === 'up' || state?.status === 'degraded'

  const badge = {
    schemaVersion: 1,
    label: options.label || 'status',
    message: isUp ? options.up || 'up' : options.down || 'down',
    color: isUp ? options.colorUp || 'brightgreen' : options.colorDown || 'red',
  }

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'max-age=60',
    },
    body: JSON.stringify(badge),
  }
}

/**
 * Main Lambda handler
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    }
  }

  // Check authentication
  if (!checkAuth(event)) {
    return {
      statusCode: 401,
      headers: {
        ...corsHeaders,
        'WWW-Authenticate': 'Basic realm="UptimeFlare"',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  const path = event.path || event.rawPath || ''
  const queryParams = event.queryStringParameters || {}

  try {
    // Route to appropriate handler
    if (path === '/api/status' || path === '/status') {
      return handleStatus()
    }

    if (path === '/api/data' || path === '/data') {
      return handleData()
    }

    if (path === '/api/config' || path === '/config') {
      return handleConfig()
    }

    if (path === '/api/incidents' || path === '/incidents') {
      return handleIncidents(queryParams.monitorId || undefined)
    }

    // /api/history/{monitorId}
    const historyMatch = path.match(/^\/api\/history\/([^\/]+)(?:\/all)?$/)
    if (historyMatch) {
      const monitorId = historyMatch[1]
      if (path.endsWith('/all')) {
        return handleHistoryAllRegions(monitorId)
      }
      return handleHistory(monitorId, queryParams.region || undefined)
    }

    // /api/badge?id=xxx
    if (path === '/api/badge' || path === '/badge') {
      const monitorId = queryParams.id
      if (!monitorId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing id parameter' }),
        }
      }
      return handleBadge(monitorId, {
        label: queryParams.label || undefined,
        up: queryParams.up || undefined,
        down: queryParams.down || undefined,
        colorUp: queryParams.colorUp || undefined,
        colorDown: queryParams.colorDown || undefined,
      })
    }

    // 404 for unknown routes
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    }
  } catch (error) {
    console.error('API error:', error)
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}
