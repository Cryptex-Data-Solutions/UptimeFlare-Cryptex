# UptimeFlare AWS

AWS Lambda-based uptime monitoring with multi-region support, detailed timing metrics, and majority voting for downtime detection.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Regional Check Workers                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ af-south-1   │  │ eu-west-1    │  │ us-east-1    │  │ ap-southeast │    │
│  │ EventBridge  │  │ EventBridge  │  │ EventBridge  │  │ EventBridge  │    │
│  │ (1 min cron) │  │ (1 min cron) │  │ (1 min cron) │  │ (1 min cron) │    │
│  │      ↓       │  │      ↓       │  │      ↓       │  │      ↓       │    │
│  │   Lambda     │  │   Lambda     │  │   Lambda     │  │   Lambda     │    │
│  │  (checker)   │  │  (checker)   │  │  (checker)   │  │  (checker)   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         └─────────────────┴────────┬────────┴─────────────────┘            │
│                                    ↓ (cross-region writes)                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Central Region (us-east-1)                        │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │                     DynamoDB (Single Table)                  │    │   │
│  │  │  • Check Results (TTL: 12 hours)                            │    │   │
│  │  │  • Monitor State (current status per monitor)               │    │   │
│  │  │  • Incidents (TTL: 90 days)                                 │    │   │
│  │  │  • Latency History (TTL: 12 hours)                          │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  │                                                                      │   │
│  │  ┌───────────────────┐     ┌───────────────────────────────────┐   │   │
│  │  │ Aggregator Lambda │     │     API Gateway + API Lambda      │   │   │
│  │  │ (EventBridge 1m)  │     │  /api/status  - Current status    │   │   │
│  │  │ • Majority voting │     │  /api/data    - Compatible API    │   │   │
│  │  │ • Spike detection │     │  /api/history - Latency charts    │   │   │
│  │  │ • Notifications   │     │  /api/badge   - Status badges     │   │   │
│  │  └───────────────────┘     └───────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

### Multi-Region Monitoring
- Deploy checker Lambdas to any AWS region
- Per-monitor configuration of which regions to check from
- Primary region concept for display with fallback to alternates

### Majority Voting
- Prevents false positives from single region failures
- Configurable vote threshold per monitor
- "Degraded" status when some (but not majority) regions report down

### Detailed Timing Metrics
Uses `undici` for granular timing breakdown:
- **DNS Lookup** - DNS resolution time
- **TCP Connect** - TCP connection establishment
- **TLS Handshake** - SSL/TLS negotiation (helps identify CPU load issues)
- **TTFB** - Time to first byte (server response time)
- **Content Download** - Response body download time
- **Total** - End-to-end latency

### Alerting
- **Status Change** - UP/DOWN transitions with grace period
- **Latency Threshold** - Alerts when response time exceeds threshold
- **Spike Detection** - Detects sudden latency increases vs baseline
- **Timing Breakdown** - Notifications include which phase (DNS/TLS/TTFB) caused issues

## Quick Start

### Prerequisites
- AWS Account with appropriate permissions
- Terraform >= 1.6.0
- Node.js >= 20.x
- AWS CLI configured

### 1. Build Lambda Functions

```bash
cd aws/lambdas/checker && npm install && npm run build && npm run package
cd ../aggregator && npm install && npm run build && npm run package
cd ../api && npm install && npm run build && npm run package
```

### 2. Configure Terraform

```bash
cd aws/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your configuration
```

### 3. Deploy

```bash
terraform init
terraform plan
terraform apply
```

## Configuration

### Monitor Configuration

```typescript
{
  "id": "my_api",                    // Unique identifier
  "name": "My API",                  // Display name
  "method": "GET",                   // HTTP method or "TCP_PING"
  "target": "https://api.example.com/health",
  "expectedCodes": [200],            // Expected HTTP status codes
  "timeout": 10000,                  // Timeout in milliseconds
  "regions": ["us-east-1", "eu-west-1", "af-south-1"],
  "primaryRegion": "af-south-1",     // Primary region for display
  "latencyThreshold": 500,           // Slow alert threshold (ms)
  "alerting": {
    "downGracePeriod": 5,            // Minutes before DOWN notification
    "slowGracePeriod": 3,            // Minutes before SLOW notification
    "downVoteThreshold": 2,          // Regions required for DOWN (default: majority)
    "spikeDetection": {
      "enabled": true,
      "thresholdPercent": 200,       // 2x baseline triggers spike alert
      "baselineWindowMinutes": 30    // Rolling window for baseline
    }
  },
  "group": "API Services"            // Optional grouping for display
}
```

### Notification Configuration

```typescript
{
  "webhook": {
    "url": "https://hooks.slack.com/services/...",
    "method": "POST",
    "payloadType": "json",           // "json", "param", or "x-www-form-urlencoded"
    "payload": {
      "text": "$MSG"                 // $MSG replaced with notification message
    },
    "timeout": 5000
  },
  "timeZone": "Africa/Johannesburg",
  "gracePeriod": 5,                  // Minutes before DOWN notification
  "skipNotificationIds": [],         // Monitor IDs to skip notifications
  "skipErrorChangeNotification": false
}
```

## API Endpoints

### GET /api/status
Full status with region breakdown:
```json
{
  "up": 10,
  "down": 1,
  "degraded": 2,
  "updatedAt": 1706094600000,
  "monitors": {
    "my_api": {
      "name": "My API",
      "status": "up",
      "primaryRegion": "af-south-1",
      "latency": 125,
      "timing": {
        "dnsLookup": 15,
        "tcpConnect": 25,
        "tlsHandshake": 45,
        "ttfb": 35,
        "contentDownload": 5,
        "total": 125
      },
      "regionStatuses": {
        "af-south-1": {"status": "up", "latency": 125},
        "eu-west-1": {"status": "up", "latency": 180},
        "us-east-1": {"status": "up", "latency": 220}
      }
    }
  }
}
```

### GET /api/data
Compatible with original UptimeFlare format for existing status page integration.

### GET /api/history/{monitorId}
Latency history for charts (12-hour window).

### GET /api/history/{monitorId}/all
Latency history for all regions.

### GET /api/incidents
Incident history grouped by month.

### GET /api/badge?id={monitorId}
Shields.io compatible badge.

## Multi-Tenant Status Pages

Deploy multiple branded status pages from a single monitoring infrastructure. Each status page can have:
- Its own custom domain (e.g., `status.service1.com`, `status.service2.com`)
- Filtered set of monitors to display
- Custom branding (title, logo, links)
- Custom grouping of monitors

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Monitoring Backend                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Checkers   │  │ Aggregator  │  │  DynamoDB   │              │
│  │ (regional)  │  │             │  │ (all data)  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                          │                                       │
│                    ┌─────┴─────┐                                │
│                    │  API GW   │  ← Single API serves all data  │
│                    │ /api/*    │    with optional filtering     │
│                    └─────┬─────┘                                │
└──────────────────────────┼──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ status.svc1   │  │ status.svc2   │  │ status.agg    │
│  CloudFront   │  │  CloudFront   │  │  CloudFront   │
│  + Lambda SSR │  │  + Lambda SSR │  │  + Lambda SSR │
│               │  │               │  │               │
│ Shows only:   │  │ Shows only:   │  │ Shows all     │
│ - svc1_api    │  │ - svc2_api    │  │ monitors      │
│ - svc1_db     │  │ - svc2_web    │  │               │
└───────────────┘  └───────────────┘  └───────────────┘
```

### Site Configuration

Create site configs in `sites/` directory:

```typescript
// sites/service1.ts
const config: SiteConfig = {
  id: 'service1',
  title: 'Service 1 Status',
  domain: 'status.service1.com',

  // Only show these monitors
  monitors: ['svc1_api', 'svc1_database', 'svc1_worker'],

  // Custom grouping
  groups: {
    'Core Services': ['svc1_api', 'svc1_database'],
    'Background Jobs': ['svc1_worker'],
  },

  // Custom branding
  links: [
    { link: 'https://service1.com', label: 'Website' },
    { link: 'mailto:support@service1.com', label: 'Support', highlight: true },
  ],
}
```

### Terraform Configuration

Deploy multiple status pages:

```hcl
status_pages = {
  service1 = {
    custom_domain   = "status.service1.com"
    certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/xxx"
  }
  service2 = {
    custom_domain   = "status.service2.com"
    certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/yyy"
  }
  aggregated = {
    custom_domain   = "status.company.com"
    certificate_arn = "arn:aws:acm:us-east-1:123456789:certificate/zzz"
  }
}
```

### Domain Setup

1. **Create ACM certificates** in `us-east-1` (required for CloudFront)
2. **Add CNAME records** pointing to CloudFront distribution domains
3. **Configure `STATUS_PAGES_CONFIG`** secret in GitHub Actions

### Additional Cost per Status Page

| Resource | Monthly Cost |
|----------|-------------|
| CloudFront distribution | ~$0.50 |
| Lambda SSR | ~$1-3 |
| S3 static assets | ~$0.10 |
| **Per-site total** | **~$2-4/mo** |

## GitHub Actions Deployment

### Required Secrets
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `MONITORS_CONFIG` - JSON monitor configuration
- `NOTIFICATION_CONFIG` - JSON notification configuration (optional)
- `PAGE_CONFIG` - JSON page configuration (optional)
- `CHECKER_REGIONS` - JSON array of regions (optional, default: `["us-east-1", "eu-west-1"]`)
- `PASSWORD_PROTECTION` - Basic auth (user:pass format, optional)
- `CUSTOM_DOMAIN` - Custom domain for API (optional)
- `CERTIFICATE_ARN` - ACM certificate ARN (required if custom domain set)
- `STATUS_PAGES_CONFIG` - JSON map of status page sites (see Multi-Tenant section)

### Manual Deployment
```bash
# Plan only
gh workflow run deploy-aws.yml -f action=plan

# Apply
gh workflow run deploy-aws.yml -f action=apply

# Destroy
gh workflow run deploy-aws.yml -f action=destroy
```

## Cost Estimate

For 50 monitors, 5 regions, 1-minute checks:

| Resource | Monthly Cost |
|----------|-------------|
| DynamoDB (on-demand) | ~$16-20 |
| Lambda (checkers) | ~$2-3 |
| Lambda (aggregator) | ~$0.50 |
| Lambda (API) | ~$0.20 |
| API Gateway | ~$0.35 |
| EventBridge | ~$0.50 |
| CloudWatch Logs | ~$1-2 |
| **Total** | **~$21-27/mo** |

## Comparison with Cloudflare Version

| Feature | Cloudflare | AWS |
|---------|------------|-----|
| Check locations | Cloudflare edge (310+ cities) | AWS regions (30+) |
| Timing details | Basic (total only) | Detailed (DNS/TLS/TTFB) |
| Multi-region per check | Via Durable Objects | Native multi-region Lambda |
| Majority voting | Not built-in | ✅ Built-in |
| Spike detection | Not built-in | ✅ Built-in |
| Status page | Cloudflare Pages | API Gateway + your frontend |
| Cost | ~Free tier | ~$20-30/mo |

## Troubleshooting

### Check Lambda Logs
```bash
aws logs tail /aws/lambda/uptimeflare_checker_af_south_1 --follow
aws logs tail /aws/lambda/uptimeflare_aggregator --follow
aws logs tail /aws/lambda/uptimeflare_api --follow
```

### Test API Locally
```bash
curl https://your-api-id.execute-api.us-east-1.amazonaws.com/api/status
```

### Force Check Execution
```bash
aws lambda invoke --function-name uptimeflare_checker_af_south_1 response.json
```
