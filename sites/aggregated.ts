/**
 * Aggregated Status Page Configuration
 * Domain: status.aggregated-website.com
 *
 * Shows ALL monitors from all services - the complete infrastructure view
 */

import type { SiteConfig } from '@/lib/data-provider'

const config: SiteConfig = {
  id: 'aggregated',
  title: 'Infrastructure Status',
  domain: 'status.aggregated-website.com',

  // Show ALL monitors
  monitors: '*',

  // Group all services logically
  groups: {
    'Service 1': ['svc1_api', 'svc1_database', 'svc1_worker', 'svc1_cdn'],
    'Service 2': ['svc2_api', 'svc2_auth', 'svc2_payments', 'svc2_notifications'],
    'Shared Infrastructure': ['shared_cdn', 'shared_dns', 'shared_monitoring'],
    'Regional': ['za_primary', 'eu_primary', 'us_primary'],
  },

  // Branding for the aggregated view
  links: [
    { link: 'https://company.com', label: 'Company' },
    { link: 'https://github.com/company', label: 'GitHub' },
    { link: 'mailto:ops@company.com', label: 'Operations', highlight: true },
  ],

  maintenances: {
    upcomingColor: 'gray',
  },

  customFooter: '<p>Powered by UptimeFlare AWS | Multi-region monitoring</p>',
}

export default config
