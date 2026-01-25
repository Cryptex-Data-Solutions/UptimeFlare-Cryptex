/**
 * Service 1 Status Page Configuration
 * Domain: status.service1.com
 *
 * Shows only monitors related to Service 1
 */

import type { SiteConfig } from '@/lib/data-provider'

const config: SiteConfig = {
  id: 'service1',
  title: 'Service 1 Status',
  domain: 'status.service1.com',

  // Only show these monitors (filter from all available monitors)
  monitors: [
    'svc1_api',
    'svc1_database',
    'svc1_worker',
    'svc1_cdn',
  ],

  // Custom grouping for this status page
  groups: {
    'Core Services': ['svc1_api', 'svc1_database'],
    'Background Jobs': ['svc1_worker'],
    'CDN & Assets': ['svc1_cdn'],
  },

  // Custom branding
  links: [
    { link: 'https://service1.com', label: 'Website' },
    { link: 'https://docs.service1.com', label: 'Documentation' },
    { link: 'mailto:support@service1.com', label: 'Support', highlight: true },
  ],

  // Optional: custom favicon/logo
  // favicon: 'https://service1.com/favicon.ico',
  // logo: 'https://service1.com/logo.svg',

  maintenances: {
    upcomingColor: 'blue',
  },
}

export default config
