# Railgun Observability Stack

**DOCTRINE COMPLIANCE**: This monitoring infrastructure tracks only business metrics and operational health. No user data, message content, or personally identifiable information is ever logged, traced, or stored.

## Quick Start

```bash
cd infra/observability
chmod +x start-observability.sh stop-observability.sh
./start-observability.sh
```

## Services

| Service | URL | Purpose |
|---------|-----|---------|
| Prometheus | http://localhost:9090 | Metrics collection & storage |
| Grafana | http://localhost:3030 | Dashboards & alerting |
| Jaeger | http://localhost:16686 | Distributed tracing |
| Alertmanager | http://localhost:9093 | Alert routing |
| OTEL Collector | http://localhost:8888 | Telemetry aggregation |

**Grafana Credentials**: `admin` / `railgun_grafana_dev`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    RAILGUN API SERVERS                          │
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   API Server 1  │  │   API Server 2  │  │   API Server N  │ │
│  │                 │  │                 │  │                 │ │
│  │ OTEL SDK        │  │ OTEL SDK        │  │ OTEL SDK        │ │
│  │ /metrics:9464   │  │ /metrics:9464   │  │ /metrics:9464   │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
└───────────┼────────────────────┼────────────────────┼──────────┘
            │                    │                    │
            │    OTLP/HTTP       │                    │
            └────────────────────┼────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   OTEL COLLECTOR       │
                    │                        │
                    │ • Receives traces/metrics
                    │ • DOCTRINE: Filters PII│
                    │ • Routes to backends   │
                    └──────────┬─────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  PROMETHEUS  │ │    JAEGER    │ │ ALERTMANAGER │
      │              │ │              │ │              │
      │ Metrics      │ │ Traces       │ │ Alerts       │
      │ Storage      │ │ Storage      │ │ Routing      │
      └──────┬───────┘ └──────────────┘ └──────────────┘
             │
             ▼
      ┌──────────────┐
      │   GRAFANA    │
      │              │
      │ Dashboards   │
      │ Visualization│
      └──────────────┘
```

## Doctrine Compliance

### What We DO Track

| Metric Category | Examples | Purpose |
|-----------------|----------|---------|
| Request Rates | req/sec, error rate | Performance monitoring |
| Latency Distributions | P50, P90, P95, P99 | SLA compliance |
| Connection Counts | active WebSockets | Capacity planning |
| Message Throughput | messages/min | Load understanding |
| Message Sizes | byte distributions | Network planning |
| P2P Metrics | peer count, fallback activations | Sovereignty monitoring |
| Infrastructure | CPU, memory, disk | Resource planning |

### What We NEVER Track

| Data Type | Why Forbidden | Doctrine Principle |
|-----------|---------------|-------------------|
| Message content | User sovereignty | Principle 3: User Keys, User Data |
| User identifiers | Privacy | Principle 5: Minimal Retention |
| IP addresses | Anonymity | Principle 5 |
| Encryption keys | Security | Principle 3 |
| Relationship graphs | Privacy | Principle 6: No Central Authority |
| SQL query data | May contain PII | Principle 5 |

### Technical Implementation

The OTEL Collector includes filters that automatically:
1. **Delete** sensitive attributes before export
2. **Hash** user identifiers for correlation without exposure
3. **Filter** health check requests to reduce noise

```yaml
# From otel/config.yaml
processors:
  attributes/remove_sensitive:
    actions:
      - key: message.content
        action: delete
      - key: user.email
        action: delete
      # ... more redactions

  attributes/hash_identifiers:
    actions:
      - key: user.id
        action: hash
```

## Dashboards

### Railgun Overview

Main operational dashboard showing:
- API success rate & latency
- Active connections & rooms
- Message throughput
- P2P fallback status
- Infrastructure health

### Custom Dashboards

Create additional dashboards in Grafana for:
- Enterprise customer metrics (aggregate)
- Geographic distribution (country-level only)
- Feature adoption rates

## Alerts

### Critical Alerts (PagerDuty)
- `APIDown` - API server unreachable
- `DatabaseConnectionPoolExhausted` - DB at capacity

### Warning Alerts (Slack/Email)
- `APIHighErrorRate` - >5% error rate
- `APIHighLatency` - P95 > 500ms
- `P2PFallbackSustained` - Repeated P2P activations
- `HighCPUUsage` - CPU > 80%

### Informational Alerts
- `P2PFallbackActivated` - P2P mode engaged (normal operation)

## Configuration

### Environment Variables

```bash
# Grafana
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=your_secure_password
GRAFANA_ROOT_URL=https://grafana.yourcompany.com

# Alert Routing
PLATFORM_TEAM_EMAIL=platform@yourcompany.com
SECURITY_TEAM_EMAIL=security@yourcompany.com
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
PAGERDUTY_SERVICE_KEY=your_pagerduty_key

# SMTP for emails
SMTP_HOST=smtp.yourcompany.com:587
SMTP_FROM=alerts@yourcompany.com
SMTP_USER=smtp_user
SMTP_PASSWORD=smtp_password
```

### Production Deployment

For production, update:

1. **Prometheus** - Add service discovery for auto-scaling
2. **Grafana** - Enable SSO, configure proper auth
3. **Alertmanager** - Set real notification channels
4. **OTEL Collector** - Configure cloud backend export

## Integration with API

Add to your NestJS API:

```typescript
// main.ts
import { initializeTelemetry } from './observability/telemetry';

async function bootstrap() {
  // Initialize before NestFactory.create
  const sdk = initializeTelemetry({
    serviceName: 'railgun-api',
    environment: process.env.NODE_ENV || 'development',
  });
  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await shutdownTelemetry(sdk);
    process.exit(0);
  });

  const app = await NestFactory.create(AppModule);
  // ... rest of bootstrap
}
```

## Troubleshooting

### No Metrics Appearing

1. Check API is exposing `/metrics` on port 9464
2. Verify Prometheus can reach the API (`docker exec railgun-prometheus wget -qO- http://host.docker.internal:9464/metrics`)
3. Check OTEL collector logs: `docker logs railgun-otel-collector`

### Missing Traces

1. Verify OTLP endpoint is reachable
2. Check `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
3. Ensure trace sampling is configured

### Alerts Not Firing

1. Check Prometheus targets are UP
2. Verify alert rules are loaded: http://localhost:9090/rules
3. Check Alertmanager routing: http://localhost:9093/#/status

## Files

```
infra/observability/
├── docker-compose.yml          # Main orchestration
├── start-observability.sh      # Startup script
├── stop-observability.sh       # Shutdown script
├── README.md                   # This file
├── prometheus/
│   ├── prometheus.yml          # Scrape config
│   └── alerts.yml              # Alert rules
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/
│   │   │   └── datasources.yml
│   │   └── dashboards/
│   │       └── dashboards.yml
│   └── dashboards/
│       └── railgun-overview.json
├── otel/
│   └── config.yaml             # OTEL collector config
└── alertmanager/
    └── alertmanager.yml        # Alert routing
```
