/**
 * UptimeFlare AWS Configuration
 * This file defines your monitors, notifications, and page settings for AWS deployment
 *
 * To deploy: This configuration is converted to JSON and passed to Terraform variables
 * Run: npm run config:export to generate terraform.tfvars
 */

import type {
  MonitorTarget,
  PageConfig,
  WorkerConfig,
  MaintenanceConfig,
  NotificationConfig,
} from './types/config'

// Page configuration for the status page
export const pageConfig: PageConfig = {
  title: "My Status Page",
  links: [
    { link: 'https://github.com/your-org', label: 'GitHub' },
    { link: 'mailto:support@example.com', label: 'Support', highlight: true },
  ],
  // Group monitors on the status page
  group: {
    '🌐 API Services': ['example_api', 'auth_api'],
    '🇿🇦 South Africa': ['za_service'],
    '🔧 Infrastructure': ['ssh_server', 'database'],
  },
  maintenances: {
    upcomingColor: 'gray',
  },
}

// Worker/Lambda configuration
export const workerConfig: WorkerConfig = {
  // Central region for DynamoDB and API Gateway
  centralRegion: 'us-east-1',

  // Write to DynamoDB at most every N minutes unless status changed
  writeCooldownMinutes: 3,

  // Optional: Basic auth for status page (user:pass format)
  // passwordProtection: 'admin:secretpassword',

  // Define all your monitors
  monitors: [
    // Example HTTP monitor with multi-region checks
    {
      id: 'example_api',
      name: 'Example API',
      method: 'GET',
      target: 'https://api.example.com/health',
      tooltip: 'Main API health endpoint',
      statusPageLink: 'https://api.example.com',
      expectedCodes: [200],
      timeout: 10000,
      headers: {
        'User-Agent': 'UptimeFlare-AWS',
      },

      // Multi-region configuration
      regions: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
      primaryRegion: 'us-east-1',

      // Latency threshold for slow notifications
      latencyThreshold: 500,

      // Advanced alerting
      alerting: {
        downGracePeriod: 5, // Wait 5 minutes before DOWN notification
        slowGracePeriod: 3, // Wait 3 minutes before SLOW notification
        // downVoteThreshold: 2, // Custom threshold (default: majority)
        spikeDetection: {
          enabled: true,
          thresholdPercent: 200, // Alert if 2x baseline
          baselineWindowMinutes: 30,
        },
      },

      group: 'API Services',
    },

    // South Africa focused service
    {
      id: 'za_service',
      name: 'South Africa Service',
      method: 'GET',
      target: 'https://za.example.com/api/health',
      expectedCodes: [200],
      timeout: 10000,

      // Primary region is af-south-1 (Cape Town)
      // Falls back to eu-west-1 if primary is down for status display
      regions: ['af-south-1', 'eu-west-1'],
      primaryRegion: 'af-south-1',

      latencyThreshold: 300,
      alerting: {
        downGracePeriod: 3,
        slowGracePeriod: 2,
      },

      group: 'Regional Services',
    },

    // TCP monitoring example
    {
      id: 'ssh_server',
      name: 'Production SSH',
      method: 'TCP_PING',
      target: 'server.example.com:22',
      tooltip: 'SSH access to production server',
      timeout: 5000,

      // Single region for internal services
      regions: ['af-south-1'],
      primaryRegion: 'af-south-1',

      group: 'Infrastructure',
    },

    // POST endpoint with body
    {
      id: 'auth_api',
      name: 'Authentication API',
      method: 'POST',
      target: 'https://auth.example.com/api/health',
      expectedCodes: [200, 201],
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ check: 'health' }),
      responseKeyword: '"status":"ok"',

      regions: ['us-east-1', 'eu-west-1'],
      primaryRegion: 'us-east-1',

      latencyThreshold: 400,
      group: 'API Services',
    },
  ],

  // Notification configuration
  notification: {
    // Slack webhook example
    webhook: {
      url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
      method: 'POST',
      payloadType: 'json',
      payload: {
        text: '$MSG',
        // You can add more Slack-specific fields:
        // username: 'UptimeFlare',
        // icon_emoji: ':robot_face:',
      },
      timeout: 5000,
    },

    // Telegram example (commented):
    // webhook: {
    //   url: 'https://api.telegram.org/bot<TOKEN>/sendMessage',
    //   method: 'POST',
    //   payloadType: 'json',
    //   payload: {
    //     chat_id: 123456789,
    //     text: '$MSG',
    //     parse_mode: 'HTML',
    //   },
    // },

    timeZone: 'Africa/Johannesburg',
    gracePeriod: 5, // Wait 5 minutes before sending DOWN notification

    // Skip notifications for specific monitors
    skipNotificationIds: [],

    // Don't send extra notifications when error reason changes during incident
    skipErrorChangeNotification: false,
  },
}

// Maintenance windows
export const maintenances: MaintenanceConfig[] = [
  {
    monitors: ['example_api', 'auth_api'],
    title: 'Scheduled Maintenance',
    body: 'Performing system updates and database maintenance',
    start: '2025-06-01T02:00:00+02:00',
    end: '2025-06-01T04:00:00+02:00',
    color: 'blue',
  },
  // Monthly maintenance example (generated dynamically)
  ...(function () {
    const schedules: MaintenanceConfig[] = []
    const today = new Date()

    for (let i = 0; i <= 2; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() + i, 1)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')

      schedules.push({
        monitors: ['za_service'],
        title: `${year}/${month} - Monthly Maintenance`,
        body: 'Monthly system maintenance window',
        start: `${year}-${month}-01T02:00:00+02:00`,
        end: `${year}-${month}-01T04:00:00+02:00`,
        color: 'gray',
      })
    }
    return schedules
  })(),
]

// Export for Terraform config generation
export function generateTerraformConfig(): {
  monitors_config: string
  notification_config: string
  page_config: string
  maintenances_config: string
  checker_regions: string[]
} {
  // Get all unique regions from monitors
  const allRegions = new Set<string>()
  for (const monitor of workerConfig.monitors) {
    for (const region of monitor.regions) {
      allRegions.add(region)
    }
  }

  return {
    monitors_config: JSON.stringify(workerConfig.monitors, null, 2),
    notification_config: JSON.stringify(workerConfig.notification || {}, null, 2),
    page_config: JSON.stringify(pageConfig, null, 2),
    maintenances_config: JSON.stringify(maintenances, null, 2),
    checker_regions: Array.from(allRegions),
  }
}

// Helper to validate configuration
export function validateConfig(): string[] {
  const errors: string[] = []

  if (!workerConfig.centralRegion) {
    errors.push('centralRegion is required')
  }

  for (const monitor of workerConfig.monitors) {
    if (!monitor.id) {
      errors.push('Monitor missing id')
    }
    if (!monitor.regions || monitor.regions.length === 0) {
      errors.push(`Monitor ${monitor.id}: at least one region required`)
    }
    if (!monitor.primaryRegion) {
      errors.push(`Monitor ${monitor.id}: primaryRegion is required`)
    }
    if (monitor.primaryRegion && !monitor.regions?.includes(monitor.primaryRegion)) {
      errors.push(
        `Monitor ${monitor.id}: primaryRegion ${monitor.primaryRegion} not in regions list (will be auto-added)`
      )
      // Auto-fix: add primaryRegion to regions
      monitor.regions = [monitor.primaryRegion, ...(monitor.regions || [])]
    }
  }

  return errors
}

// Run validation and export on direct execution
if (require.main === module) {
  const errors = validateConfig()
  if (errors.length > 0) {
    console.error('Configuration errors:')
    errors.forEach((e) => console.error(`  - ${e}`))
    process.exit(1)
  }

  console.log('Configuration valid!')
  console.log('\nTerraform config:')
  console.log(JSON.stringify(generateTerraformConfig(), null, 2))
}
