/**
 * Data Provider Abstraction
 * Supports both Cloudflare D1 and AWS DynamoDB (via API) backends
 * Enables multi-tenant status pages with per-site filtering
 */

import type { MonitorState, MonitorStateCompacted } from '@/types/config'

export interface SiteConfig {
  id: string
  title: string
  domain?: string
  monitors: string[] | '*' // Monitor IDs to display, or '*' for all
  links?: Array<{ link: string; label: string; highlight?: boolean }>
  groups?: Record<string, string[]>
  favicon?: string
  logo?: string
  customFooter?: string
  maintenances?: {
    upcomingColor?: 'gray' | 'blue' | 'green' | 'yellow' | 'red'
  }
}

export interface MonitorInfo {
  id: string
  name: string
  tooltip?: string
  statusPageLink?: string
  hideLatencyChart?: boolean
  group?: string
  regions?: string[]
  primaryRegion?: string
}

export interface MaintenanceInfo {
  monitors?: string[]
  title?: string
  body: string
  start: string | number
  end?: string | number
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'red'
}

export interface DataProviderResponse {
  state: MonitorState | MonitorStateCompacted | null
  monitors: MonitorInfo[]
  maintenances: MaintenanceInfo[]
  siteConfig: SiteConfig
}

export type DataProviderType = 'cloudflare' | 'aws'

/**
 * Fetch data from AWS API backend
 */
async function fetchFromAWS(
  apiEndpoint: string,
  siteConfig: SiteConfig
): Promise<DataProviderResponse> {
  const monitorFilter = siteConfig.monitors === '*'
    ? ''
    : `?monitors=${(siteConfig.monitors as string[]).join(',')}`

  // Fetch status data
  const statusUrl = `${apiEndpoint}/api/status${monitorFilter}`
  const configUrl = `${apiEndpoint}/api/config`

  const [statusRes, configRes] = await Promise.all([
    fetch(statusUrl, { next: { revalidate: 60 } }),
    fetch(configUrl, { next: { revalidate: 300 } }),
  ])

  if (!statusRes.ok) {
    throw new Error(`Failed to fetch status: ${statusRes.status}`)
  }

  const statusData = await statusRes.json()
  const configData = configRes.ok ? await configRes.json() : { monitors: [], maintenances: [] }

  // Filter monitors based on site config
  let monitors: MonitorInfo[] = configData.monitors || []
  if (siteConfig.monitors !== '*') {
    const allowedIds = new Set(siteConfig.monitors as string[])
    monitors = monitors.filter((m: MonitorInfo) => allowedIds.has(m.id))
  }

  // Apply site-specific grouping if defined
  if (siteConfig.groups) {
    monitors = monitors.map((m: MonitorInfo) => {
      for (const [groupName, monitorIds] of Object.entries(siteConfig.groups!)) {
        if (monitorIds.includes(m.id)) {
          return { ...m, group: groupName }
        }
      }
      return m
    })
  }

  // Convert AWS state format to compatible format
  const state = convertAWSStateToCompacted(statusData, monitors)

  // Filter maintenances
  let maintenances: MaintenanceInfo[] = configData.maintenances || []
  if (siteConfig.monitors !== '*') {
    const allowedIds = new Set(siteConfig.monitors as string[])
    maintenances = maintenances.filter((m: MaintenanceInfo) =>
      !m.monitors || m.monitors.some(id => allowedIds.has(id))
    )
  }

  return {
    state,
    monitors,
    maintenances,
    siteConfig,
  }
}

/**
 * Convert AWS API response to compacted state format for compatibility
 */
function convertAWSStateToCompacted(
  statusData: any,
  monitors: MonitorInfo[]
): MonitorStateCompacted {
  const state: MonitorStateCompacted = {
    lastUpdate: statusData.updatedAt || Date.now(),
    overallUp: statusData.up || 0,
    overallDown: statusData.down || 0,
    incident: {},
    latency: {},
  }

  // Convert each monitor's data
  for (const monitor of monitors) {
    const monitorData = statusData.monitors?.[monitor.id]
    if (!monitorData) continue

    // Initialize incident data (simplified for AWS - just current state)
    state.incident[monitor.id] = {
      start: [],
      end: [],
      error: [],
    }

    // If monitor is down, add current incident
    if (monitorData.status === 'down' && monitorData.downSince) {
      state.incident[monitor.id].start.push(monitorData.downSince)
      state.incident[monitor.id].end.push(null)
      state.incident[monitor.id].error.push([monitorData.error || 'Service unavailable'])
    }

    // Initialize latency data with current value
    // In AWS, we store detailed timing - convert to simple format for now
    const latency = monitorData.latency || 0
    const region = monitorData.primaryRegion || 'unknown'
    const timestamp = Math.floor(Date.now() / 1000)

    // Encode as hex (matching original format)
    const timeHex = uint32ToHex(timestamp)
    const pingHex = uint16ToHex(Math.min(latency, 65535))

    state.latency[monitor.id] = {
      time: timeHex,
      ping: pingHex,
      loc: {
        v: [region],
        c: [1],
      },
    }
  }

  return state
}

function uint32ToHex(value: number): string {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setUint32(0, value, true) // little endian
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function uint16ToHex(value: number): string {
  const buffer = new ArrayBuffer(2)
  new DataView(buffer).setUint16(0, value, true) // little endian
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Fetch data from Cloudflare D1 backend (original implementation)
 */
async function fetchFromCloudflare(
  env: any,
  siteConfig: SiteConfig,
  workerConfig: any,
  maintenances: MaintenanceInfo[]
): Promise<DataProviderResponse> {
  // Dynamic import to avoid bundling Cloudflare-specific code in AWS builds
  const { getFromStore, CompactedMonitorStateWrapper } = await import('@/worker/src/store')

  const compactedStateStr = await getFromStore(env, 'state')
  const wrapper = new CompactedMonitorStateWrapper(compactedStateStr)

  // Filter monitors based on site config
  let monitors: MonitorInfo[] = workerConfig.monitors.map((m: any) => ({
    id: m.id,
    name: m.name,
    tooltip: m.tooltip,
    statusPageLink: m.statusPageLink,
    hideLatencyChart: m.hideLatencyChart,
  }))

  if (siteConfig.monitors !== '*') {
    const allowedIds = new Set(siteConfig.monitors as string[])
    monitors = monitors.filter((m: MonitorInfo) => allowedIds.has(m.id))
  }

  // Filter maintenances
  let filteredMaintenances = maintenances
  if (siteConfig.monitors !== '*') {
    const allowedIds = new Set(siteConfig.monitors as string[])
    filteredMaintenances = maintenances.filter((m: MaintenanceInfo) =>
      !m.monitors || m.monitors.some(id => allowedIds.has(id))
    )
  }

  return {
    state: wrapper.data,
    monitors,
    maintenances: filteredMaintenances,
    siteConfig,
  }
}

/**
 * Main data provider function
 * Automatically detects backend type from environment
 */
export async function getStatusData(
  siteConfig: SiteConfig,
  options?: {
    type?: DataProviderType
    apiEndpoint?: string
    cloudflareEnv?: any
    workerConfig?: any
    maintenances?: MaintenanceInfo[]
  }
): Promise<DataProviderResponse> {
  const providerType = options?.type ||
    (process.env.DATA_PROVIDER as DataProviderType) ||
    (process.env.AWS_API_ENDPOINT ? 'aws' : 'cloudflare')

  if (providerType === 'aws') {
    const apiEndpoint = options?.apiEndpoint || process.env.AWS_API_ENDPOINT
    if (!apiEndpoint) {
      throw new Error('AWS_API_ENDPOINT environment variable is required for AWS provider')
    }
    return fetchFromAWS(apiEndpoint, siteConfig)
  }

  // Cloudflare provider
  if (!options?.cloudflareEnv) {
    throw new Error('Cloudflare environment is required for Cloudflare provider')
  }
  return fetchFromCloudflare(
    options.cloudflareEnv,
    siteConfig,
    options.workerConfig,
    options.maintenances || []
  )
}

/**
 * Fetch latency history for charts (AWS only)
 */
export async function getLatencyHistory(
  monitorId: string,
  options?: {
    apiEndpoint?: string
    region?: string
    allRegions?: boolean
  }
): Promise<any> {
  const apiEndpoint = options?.apiEndpoint || process.env.AWS_API_ENDPOINT
  if (!apiEndpoint) {
    throw new Error('AWS_API_ENDPOINT required for latency history')
  }

  const path = options?.allRegions
    ? `/api/history/${monitorId}/all`
    : `/api/history/${monitorId}${options?.region ? `?region=${options.region}` : ''}`

  const res = await fetch(`${apiEndpoint}${path}`, { next: { revalidate: 60 } })
  if (!res.ok) {
    throw new Error(`Failed to fetch latency history: ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch incidents (AWS only)
 */
export async function getIncidents(
  monitorId?: string,
  options?: { apiEndpoint?: string }
): Promise<any> {
  const apiEndpoint = options?.apiEndpoint || process.env.AWS_API_ENDPOINT
  if (!apiEndpoint) {
    throw new Error('AWS_API_ENDPOINT required for incidents')
  }

  const query = monitorId ? `?monitorId=${monitorId}` : ''
  const res = await fetch(`${apiEndpoint}/api/incidents${query}`, { next: { revalidate: 60 } })
  if (!res.ok) {
    throw new Error(`Failed to fetch incidents: ${res.status}`)
  }
  return res.json()
}
