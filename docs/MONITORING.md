# Rail Gun Monitoring & Alerting

Guide for setting up production monitoring for Rail Gun.

## Overview

Monitoring stack recommendations:
- **Metrics**: Prometheus + Grafana
- **Logs**: Loki or CloudWatch Logs
- **Errors**: Sentry
- **Uptime**: UptimeRobot, Pingdom, or Better Stack

---

## Health Endpoints

The API exposes health check endpoints:

| Endpoint | Purpose | Success Response |
|----------|---------|------------------|
| `GET /api/v1/health` | Basic health | `{ status: 'ok' }` |
| `GET /api/v1/health/ready` | Readiness | `{ status: 'ready', db: true, redis: true }` |
| `GET /api/v1/health/live` | Liveness | `200 OK` |

### Usage

```bash
# Basic health check
curl https://api.your-domain.com/api/v1/health

# Kubernetes readiness probe
curl https://api.your-domain.com/api/v1/health/ready

# Load balancer health check
curl https://api.your-domain.com/api/v1/health/live
```

---

## Prometheus Metrics

### Enabling Metrics

Install prom-client in the API:

```bash
cd services/api
pnpm add prom-client
```

Create `src/metrics/metrics.module.ts`:

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { PrometheusController } from './prometheus.controller';
import * as client from 'prom-client';

@Module({
  controllers: [PrometheusController],
})
export class MetricsModule implements OnModuleInit {
  onModuleInit() {
    // Collect default metrics (CPU, memory, etc.)
    client.collectDefaultMetrics({ prefix: 'railgun_' });
  }
}
```

Create `src/metrics/prometheus.controller.ts`:

```typescript
import { Controller, Get, Header } from '@nestjs/common';
import * as client from 'prom-client';

@Controller('metrics')
export class PrometheusController {
  @Get()
  @Header('Content-Type', client.register.contentType)
  async getMetrics(): Promise<string> {
    return client.register.metrics();
  }
}
```

### Key Metrics to Track

```typescript
// Custom metrics
const httpRequestsTotal = new client.Counter({
  name: 'railgun_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

const httpRequestDuration = new client.Histogram({
  name: 'railgun_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

const activeWebsocketConnections = new client.Gauge({
  name: 'railgun_websocket_connections',
  help: 'Active WebSocket connections',
});

const messagesProcessed = new client.Counter({
  name: 'railgun_messages_processed_total',
  help: 'Total messages processed',
  labelNames: ['type'], // 'dm', 'channel'
});

const voiceParticipants = new client.Gauge({
  name: 'railgun_voice_participants',
  help: 'Active voice participants',
  labelNames: ['channel_id'],
});
```

### Prometheus Configuration

`prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'railgun-api'
    static_configs:
      - targets: ['api:3001']
    metrics_path: '/api/v1/metrics'
```

---

## Grafana Dashboards

### Recommended Panels

1. **API Overview**
   - Request rate (req/sec)
   - Error rate (%)
   - Response time (p50, p95, p99)
   - Active connections

2. **Database Health**
   - Query latency
   - Connection pool usage
   - Slow queries

3. **Redis Health**
   - Memory usage
   - Hit/miss ratio
   - Connected clients

4. **Voice/WebSocket**
   - Active voice channels
   - WebSocket connections
   - Message throughput

### Sample Dashboard JSON

Import this into Grafana:

```json
{
  "dashboard": {
    "title": "Rail Gun API",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(railgun_http_requests_total[5m])",
            "legendFormat": "{{method}} {{path}}"
          }
        ]
      },
      {
        "title": "Response Time p95",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(railgun_http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "p95"
          }
        ]
      }
    ]
  }
}
```

---

## Error Tracking (Sentry)

### Setup

Install Sentry:

```bash
pnpm add @sentry/node
```

Configure in `main.ts`:

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1, // 10% of transactions
  beforeSend(event) {
    // Scrub sensitive data
    if (event.request?.headers) {
      delete event.request.headers['Authorization'];
    }
    return event;
  },
});
```

Create exception filter:

```typescript
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    
    // Report to Sentry
    Sentry.captureException(exception);
    
    // Continue with normal error handling
    // ...
  }
}
```

---

## Logging (Loki/CloudWatch)

### Structured Logging

Configure NestJS logger:

```typescript
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

@Module({
  imports: [
    WinstonModule.forRoot({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

Log format:

```json
{
  "timestamp": "2025-12-30T12:00:00.000Z",
  "level": "info",
  "context": "AuthService",
  "message": "User logged in",
  "userId": "user-123",
  "requestId": "req-abc"
}
```

### Log Queries (Loki)

```logql
# Error rate by service
sum(rate({app="railgun"} |= "error" [5m])) by (context)

# Auth failures
{app="railgun", context="AuthService"} |= "unauthorized"

# Slow requests
{app="railgun"} | json | latency > 1000
```

---

## Alerting Rules

### Prometheus Alert Rules

```yaml
groups:
  - name: railgun
    rules:
      - alert: HighErrorRate
        expr: rate(railgun_http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on Rail Gun API"
          
      - alert: SlowResponseTime
        expr: histogram_quantile(0.95, rate(railgun_http_request_duration_seconds_bucket[5m])) > 2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "p95 response time above 2 seconds"
          
      - alert: DatabaseConnectionPoolExhausted
        expr: pg_stat_activity_count > pg_settings_max_connections * 0.9
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool near exhaustion"
          
      - alert: RedisHighMemory
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Redis memory usage above 90%"
```

### Notification Channels

Configure alerts to:
- **Slack**: Real-time notifications
- **PagerDuty**: On-call rotation
- **Email**: Non-urgent alerts

---

## Uptime Monitoring

### External Checks

Set up uptime monitoring for:

| Endpoint | Check Interval | Timeout |
|----------|---------------|---------|
| `https://api.your-domain.com/api/v1/health` | 1 min | 10s |
| `wss://api.your-domain.com/ws` | 5 min | 30s |
| `https://app.your-domain.com` | 1 min | 10s |

### Status Page

Consider using:
- **Statuspage.io**
- **Better Stack Status**
- **Cachet** (self-hosted)

---

## Runbook

### High Error Rate

1. Check Sentry for error details
2. Review recent deployments
3. Check database/Redis health
4. Scale if needed

### Slow Response Time

1. Check database query times
2. Review Redis hit/miss ratio
3. Check for memory pressure
4. Profile slow endpoints

### WebSocket Connection Issues

1. Check active connection count
2. Review load balancer timeout settings
3. Check for memory leaks
4. Verify Redis pub/sub health
