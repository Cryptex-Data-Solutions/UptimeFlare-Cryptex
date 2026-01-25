/**
 * Service 2 Status Page Configuration
 * Domain: status.service2.com
 *
 * Shows only monitors related to Service 2
 */

import type { SiteConfig } from '@/lib/data-provider'

const config: SiteConfig = {
  id: 'service2',
  title: 'Service 2 Status',
  domain: 'status.service2.com',

  // Only show these monitors
  monitors: [
    'svc2_api',
    'svc2_auth',
    'svc2_payments',
    'svc2_notifications',
  ],

  // Custom grouping
  groups: {
    'API & Authentication': ['svc2_api', 'svc2_auth'],
    'Payments': ['svc2_payments'],
    'Notifications': ['svc2_notifications'],
  },

  // Custom branding
  links: [
    { link: 'https://service2.com', label: 'Website' },
    { link: 'https://api.service2.com/docs', label: 'API Docs' },
    { link: 'mailto:support@service2.com', label: 'Contact', highlight: true },
  ],

  maintenances: {
    upcomingColor: 'gray',
  },
}

export default config
