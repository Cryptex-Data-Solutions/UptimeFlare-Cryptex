/**
 * Site Configuration Registry
 * Defines multiple status page configurations for multi-tenant deployment
 *
 * Each site can have:
 * - Its own domain
 * - Filtered set of monitors
 * - Custom branding (title, logo, links)
 * - Custom grouping of monitors
 */

import type { SiteConfig } from '@/lib/data-provider'

// Import individual site configs
import service1Config from './service1'
import service2Config from './service2'
import aggregatedConfig from './aggregated'

// Registry of all site configurations
export const siteConfigs: Record<string, SiteConfig> = {
  service1: service1Config,
  service2: service2Config,
  aggregated: aggregatedConfig,
}

// Domain to site mapping
export const domainToSite: Record<string, string> = {
  'status.service1.com': 'service1',
  'status.service2.com': 'service2',
  'status.aggregated-website.com': 'aggregated',
  // Local development
  'localhost:3000': 'aggregated',
  'localhost:3001': 'service1',
  'localhost:3002': 'service2',
}

/**
 * Get site config from domain or site ID
 */
export function getSiteConfig(domainOrId: string): SiteConfig {
  // Check if it's a domain
  const siteId = domainToSite[domainOrId] || domainOrId

  // Return the config or default to aggregated
  return siteConfigs[siteId] || siteConfigs.aggregated
}

/**
 * Get site config from request headers (for SSR)
 */
export function getSiteConfigFromRequest(headers: Headers): SiteConfig {
  const host = headers.get('host') || headers.get('x-forwarded-host') || 'localhost:3000'
  return getSiteConfig(host)
}

/**
 * Get all available site configs (for build-time generation)
 */
export function getAllSiteConfigs(): SiteConfig[] {
  return Object.values(siteConfigs)
}

/**
 * Get all domains that need to be configured
 */
export function getAllDomains(): string[] {
  return Object.keys(domainToSite).filter(d => !d.startsWith('localhost'))
}

export default siteConfigs
