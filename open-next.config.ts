/**
 * OpenNext Configuration
 * Deploys Next.js to AWS Lambda with CloudFront CDN
 *
 * OpenNext is the recommended way to deploy Next.js to AWS:
 * - Supports SSR, SSG, ISR, and API routes
 * - Automatic CloudFront caching
 * - Edge functions for middleware
 * - Image optimization via Lambda
 *
 * @see https://open-next.js.org/
 */

import type { OpenNextConfig } from 'open-next/types/open-next'

const config: OpenNextConfig = {
  // Build configuration
  buildCommand: 'npx next build',

  // Dangerous: allows pages with runtime edge to be deployed
  // We need this for backwards compatibility with Cloudflare pages
  dangerous: {
    disableIncrementalCache: false,
    disableTagCache: false,
  },

  // Server function configuration
  default: {
    // Override function configuration if needed
    override: {
      // Use streaming for faster TTFB
      wrapper: 'aws-lambda-streaming',
    },
  },

  // Image optimization (optional - can be disabled to reduce costs)
  imageOptimization: {
    arch: 'arm64',
  },

  // Middleware runs on CloudFront Functions or Lambda@Edge
  middleware: {
    external: true,
  },
}

export default config
