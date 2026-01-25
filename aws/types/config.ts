/**
 * AWS Lambda UptimeFlare Configuration Types
 * Multi-region monitoring with detailed timing metrics
 */

export interface MonitorTarget {
  // Unique identifier - history preserved if id remains constant
  id: string
  // Display name for status page and notifications
  name: string
  // HTTP method or TCP_PING
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TCP_PING'
  // Target URL or host:port for TCP
  target: string

  // Optional fields
  tooltip?: string
  statusPageLink?: string
  hideLatencyChart?: boolean
  expectedCodes?: number[]
  timeout?: number // milliseconds, default 10000
  headers?: Record<string, string>
  body?: string
  responseKeyword?: string
  responseForbiddenKeyword?: string

  // Latency threshold for slow notifications (ms)
  latencyThreshold?: number

  // Multi-region configuration
  regions: AWSRegion[] // Regions to check from
  primaryRegion: AWSRegion // Primary region for display (auto-added to regions if missing)

  // Alerting configuration
  alerting?: {
    // Grace period before DOWN notification (minutes)
    downGracePeriod?: number // default: 5
    // Minimum regions that must report DOWN for majority vote
    downVoteThreshold?: number // default: ceil(regions.length / 2)
    // Grace period before SLOW notification (minutes)
    slowGracePeriod?: number // default: 3
    // Detect sudden latency spikes (% increase from baseline)
    spikeDetection?: {
      enabled: boolean
      thresholdPercent: number // e.g., 200 = 2x baseline
      baselineWindowMinutes: number // rolling window for baseline calculation
    }
  }

  // Monitor group for display
  group?: string
}

export type AWSRegion =
  | 'us-east-1'
  | 'us-east-2'
  | 'us-west-1'
  | 'us-west-2'
  | 'af-south-1'
  | 'ap-east-1'
  | 'ap-south-1'
  | 'ap-south-2'
  | 'ap-southeast-1'
  | 'ap-southeast-2'
  | 'ap-southeast-3'
  | 'ap-southeast-4'
  | 'ap-northeast-1'
  | 'ap-northeast-2'
  | 'ap-northeast-3'
  | 'ca-central-1'
  | 'eu-central-1'
  | 'eu-central-2'
  | 'eu-west-1'
  | 'eu-west-2'
  | 'eu-west-3'
  | 'eu-south-1'
  | 'eu-south-2'
  | 'eu-north-1'
  | 'il-central-1'
  | 'me-south-1'
  | 'me-central-1'
  | 'sa-east-1'

export interface PageConfig {
  title: string
  links?: Array<{
    link: string
    label: string
    highlight?: boolean
  }>
  group?: Record<string, string[]>
  favicon?: string
  logo?: string
  maintenances?: {
    upcomingColor?: 'gray' | 'blue' | 'green' | 'yellow' | 'red'
  }
  customFooter?: string
}

export interface WorkerConfig {
  // Central region for DynamoDB and aggregator
  centralRegion: AWSRegion

  // Write cooldown (minutes) - only write if status changed or N minutes elapsed
  writeCooldownMinutes?: number // default: 3

  // Password protection for status page (user:pass format)
  passwordProtection?: string

  // All monitor definitions
  monitors: MonitorTarget[]

  // Notification settings
  notification?: NotificationConfig

  // Custom callbacks (executed in aggregator Lambda)
  callbacks?: CallbackConfig
}

export interface NotificationConfig {
  webhook?: {
    url: string
    method?: 'GET' | 'POST' | 'PUT'
    headers?: Record<string, string>
    payloadType: 'param' | 'json' | 'x-www-form-urlencoded'
    payload: Record<string, unknown>
    timeout?: number
  }
  timeZone?: string
  gracePeriod?: number
  skipNotificationIds?: string[]
  skipErrorChangeNotification?: boolean
}

export interface CallbackConfig {
  onStatusChange?: (
    monitor: MonitorTarget,
    isUp: boolean,
    timeIncidentStart: number,
    timeNow: number,
    reason: string,
    regionStatuses: Record<AWSRegion, RegionCheckResult>,
    group?: string
  ) => Promise<void>

  onIncident?: (
    monitor: MonitorTarget,
    timeIncidentStart: number,
    timeNow: number,
    reason: string,
    regionStatuses: Record<AWSRegion, RegionCheckResult>,
    group?: string
  ) => Promise<void>

  onLatencyThreshold?: (
    monitor: MonitorTarget,
    isSlow: boolean,
    latency: number,
    threshold: number,
    timeSlowStart: number,
    timeNow: number,
    region: AWSRegion,
    timingBreakdown: TimingMetrics,
    group?: string
  ) => Promise<void>

  onLatencySpike?: (
    monitor: MonitorTarget,
    currentLatency: number,
    baselineLatency: number,
    spikePercent: number,
    region: AWSRegion,
    timingBreakdown: TimingMetrics,
    group?: string
  ) => Promise<void>
}

export interface MaintenanceConfig {
  monitors?: string[]
  title?: string
  body: string
  start: string | number
  end?: string | number
  color?: 'gray' | 'blue' | 'green' | 'yellow' | 'red'
}

// Detailed timing metrics from undici
export interface TimingMetrics {
  dnsLookup: number // DNS resolution time (ms)
  tcpConnect: number // TCP connection time (ms)
  tlsHandshake: number // TLS handshake time (ms) - 0 for HTTP
  ttfb: number // Time to first byte (ms)
  contentDownload: number // Content download time (ms)
  total: number // Total request time (ms)
}

export interface RegionCheckResult {
  region: AWSRegion
  status: 'up' | 'down'
  latency: number
  timing: TimingMetrics
  error?: string
  timestamp: number
}

// DynamoDB item types
export interface CheckResultItem {
  pk: string // CHECK#{monitorId}
  sk: string // {timestamp}#{region}
  monitorId: string
  region: AWSRegion
  status: 'up' | 'down'
  latency: number
  timing: TimingMetrics
  error?: string
  timestamp: number
  ttl: number // Unix timestamp for auto-deletion
}

export interface MonitorStateItem {
  pk: string // STATE#{monitorId}
  sk: string // CURRENT
  monitorId: string
  status: 'up' | 'down' | 'degraded'
  primaryLatency: number
  primaryTiming: TimingMetrics
  regionStatuses: Record<AWSRegion, { status: 'up' | 'down'; latency: number }>
  lastCheck: number
  downSince?: number
  slowSince?: number
  lastNotifiedDown?: number
  lastNotifiedSlow?: number
}

export interface GlobalStateItem {
  pk: string // STATE#GLOBAL
  sk: string // SUMMARY
  overallUp: number
  overallDown: number
  overallDegraded: number
  lastUpdate: number
}

export interface IncidentItem {
  pk: string // INCIDENT#{monitorId}
  sk: string // {startTimestamp}
  monitorId: string
  start: number
  end?: number
  error: string
  regionsDown: AWSRegion[]
  ttl: number // Unix timestamp for auto-deletion (90 days)
}

// Latency history for charts (stored per region)
export interface LatencyHistoryItem {
  pk: string // LATENCY#{monitorId}#{region}
  sk: string // {timestamp}
  monitorId: string
  region: AWSRegion
  latency: number
  timing: TimingMetrics
  timestamp: number
  ttl: number // 12 hours
}

// Configuration validation
export function validateConfig(config: WorkerConfig): string[] {
  const errors: string[] = []

  if (!config.centralRegion) {
    errors.push('centralRegion is required')
  }

  if (!config.monitors || config.monitors.length === 0) {
    errors.push('At least one monitor is required')
  }

  for (const monitor of config.monitors) {
    if (!monitor.id) {
      errors.push(`Monitor missing id`)
    }
    if (!monitor.regions || monitor.regions.length === 0) {
      errors.push(`Monitor ${monitor.id}: at least one region required`)
    }
    if (!monitor.primaryRegion) {
      errors.push(`Monitor ${monitor.id}: primaryRegion is required`)
    }
    // Auto-add primaryRegion to regions if missing
    if (monitor.primaryRegion && !monitor.regions?.includes(monitor.primaryRegion)) {
      monitor.regions = [monitor.primaryRegion, ...(monitor.regions || [])]
    }
  }

  return errors
}

// Helper to get all unique regions from monitors
export function getAllRegions(monitors: MonitorTarget[]): AWSRegion[] {
  const regions = new Set<AWSRegion>()
  for (const monitor of monitors) {
    for (const region of monitor.regions) {
      regions.add(region)
    }
  }
  return Array.from(regions)
}

// Helper to get monitors for a specific region
export function getMonitorsForRegion(monitors: MonitorTarget[], region: AWSRegion): MonitorTarget[] {
  return monitors.filter((m) => m.regions.includes(region))
}
