/**
 * AWS-compatible Status Page
 * Uses the data provider abstraction for multi-tenant support
 *
 * This page can be deployed to:
 * - AWS Lambda via OpenNext
 * - Vercel
 * - Any Node.js hosting
 *
 * To use: rename to index.tsx when deploying to AWS
 */

import Head from 'next/head'
import { GetServerSidePropsContext } from 'next'
import { Inter } from 'next/font/google'
import { MonitorTarget } from '@/types/config'
import OverallStatus from '@/components/OverallStatus'
import Header from '@/components/Header'
import MonitorList from '@/components/MonitorList'
import { Center, Text } from '@mantine/core'
import MonitorDetail from '@/components/MonitorDetail'
import Footer from '@/components/Footer'
import { useTranslation } from 'react-i18next'
import { CompactedMonitorStateWrapper } from '@/worker/src/store'
import { getStatusData, SiteConfig, MonitorInfo, MaintenanceInfo } from '@/lib/data-provider'
import { getSiteConfigFromRequest } from '@/sites'

const inter = Inter({ subsets: ['latin'] })

interface PageProps {
  compactedStateStr: string
  monitors: MonitorInfo[]
  maintenances: MaintenanceInfo[]
  siteConfig: SiteConfig
}

export default function Home({
  compactedStateStr,
  monitors,
  maintenances,
  siteConfig,
}: PageProps) {
  const { t } = useTranslation('common')
  let state = new CompactedMonitorStateWrapper(compactedStateStr).uncompact()

  // Specify monitorId in URL hash to view a specific monitor (can be used in iframe)
  const monitorId = typeof window !== 'undefined' ? window.location.hash.substring(1) : ''
  if (monitorId) {
    const monitor = monitors.find((m) => m.id === monitorId)
    if (!monitor || !state) {
      return <Text fw={700}>{t('Monitor not found', { id: monitorId })}</Text>
    }
    return (
      <div style={{ maxWidth: '810px' }}>
        <MonitorDetail monitor={monitor as MonitorTarget} state={state} />
      </div>
    )
  }

  // Create page config from site config
  const pageConfig = {
    title: siteConfig.title,
    links: siteConfig.links || [],
    group: siteConfig.groups,
    favicon: siteConfig.favicon,
    logo: siteConfig.logo,
    maintenances: siteConfig.maintenances,
    customFooter: siteConfig.customFooter,
  }

  return (
    <>
      <Head>
        <title>{pageConfig.title}</title>
        <link rel="icon" href={pageConfig.favicon ?? '/favicon.png'} />
      </Head>

      <main className={inter.className}>
        <Header config={pageConfig} />

        {state.lastUpdate === 0 ? (
          <Center>
            <Text fw={700}>{t('Monitor State not defined')}</Text>
          </Center>
        ) : (
          <div>
            <OverallStatus
              state={state}
              monitors={monitors as MonitorTarget[]}
              maintenances={maintenances}
            />
            <MonitorList
              monitors={monitors as MonitorTarget[]}
              state={state}
              groups={pageConfig.group}
            />
          </div>
        )}

        <Footer customFooter={pageConfig.customFooter} />
      </main>
    </>
  )
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  // Determine which site config to use based on host header
  const headers = new Headers()
  const host = context.req.headers.host || context.req.headers['x-forwarded-host']
  if (host) {
    headers.set('host', Array.isArray(host) ? host[0] : host)
  }

  const siteConfig = getSiteConfigFromRequest(headers)

  try {
    // Fetch data from AWS API
    const data = await getStatusData(siteConfig, {
      type: 'aws',
      apiEndpoint: process.env.AWS_API_ENDPOINT,
    })

    return {
      props: {
        compactedStateStr: JSON.stringify(data.state),
        monitors: data.monitors,
        maintenances: data.maintenances,
        siteConfig: data.siteConfig,
      },
    }
  } catch (error) {
    console.error('Failed to fetch status data:', error)

    // Return empty state on error
    return {
      props: {
        compactedStateStr: JSON.stringify({
          lastUpdate: 0,
          overallUp: 0,
          overallDown: 0,
          incident: {},
          latency: {},
        }),
        monitors: [],
        maintenances: [],
        siteConfig,
      },
    }
  }
}
