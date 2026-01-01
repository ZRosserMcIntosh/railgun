# Infrastructure

Docker, migrations, and CI/CD scripts for Rail Gun.

## Quick Start (Development)

Start all services:
```bash
./start-dev.sh
```

Stop all services:
```bash
./stop-dev.sh
```

Or manually with docker-compose:
```bash
docker-compose up -d
```

## Services Overview

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Caching, sessions, pub/sub |
| Meilisearch | 7700 | Full-text search (optional) |

## Production Setup

### PostgreSQL

**Recommended**: Managed PostgreSQL service (AWS RDS, Digital Ocean, etc.)

Required configuration:
```env
DATABASE_URL=postgresql://user:password@host:5432/railgun
DATABASE_SSL=true
DATABASE_POOL_SIZE=20
```

Minimum specs:
- 2 vCPU, 4GB RAM for small deployments
- 4 vCPU, 8GB RAM for medium deployments
- Enable connection pooling (PgBouncer recommended)

Migrations:
```bash
cd services/api
pnpm run migration:run
```

### Redis

**Recommended**: Managed Redis (AWS ElastiCache, Redis Cloud, etc.)

Required configuration:
```env
REDIS_URL=redis://host:6379
REDIS_PASSWORD=your-secure-password
REDIS_TLS=true
```

Minimum specs:
- 1GB RAM minimum (caching + sessions)
- 2GB RAM recommended (with pub/sub for realtime)
- Enable persistence (AOF mode)

### Meilisearch (Optional)

For full-text search of messages and users.

```env
MEILISEARCH_URL=http://host:7700
MEILISEARCH_API_KEY=your-master-key
```

Deploy options:
- Meilisearch Cloud (managed)
- Self-hosted with Docker

### Environment Variables

Create `.env.production`:

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/railgun
DATABASE_SSL=true

# Redis
REDIS_URL=redis://:password@host:6379
REDIS_TLS=true

# Auth
JWT_SECRET=<generate-256-bit-secret>
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
RECOVERY_CODE_SECRET=<generate-256-bit-secret>

# Crypto
ENTITLEMENT_SIGNING_PUBLIC_KEY=JMjdHZ0J_jL4OzfRFpcDahsgT-0IZuwrDeTz9hldXFA
ENTITLEMENT_SIGNING_PRIVATE_KEY=<production-private-key>

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_MONTHLY=price_...
STRIPE_PRICE_ID_YEARLY=price_...

# Voice (TURN)
TURN_SECRET=<generate-secret>
TURN_HOST=turn.your-domain.com

# Feature Flags
FEATURE_FLAGS_URL=https://config.your-domain.com/flags.json

# API
API_BASE_URL=https://api.your-domain.com
CORS_ORIGINS=https://app.your-domain.com
```

### Generating Secrets

```bash
# Generate JWT Secret
openssl rand -base64 32

# Generate Recovery Code Secret  
openssl rand -base64 32

# Generate TURN Secret
openssl rand -base64 32
```

## Docker Production Deployment

Production docker-compose.prod.yml:

```yaml
version: '3.8'

services:
  api:
    build:
      context: ../services/api
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1'
          memory: 1G

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: railgun
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: railgun
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redis_data:/data
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 1G

volumes:
  postgres_data:
  redis_data:
```

## Health Checks

The API exposes health endpoints:

- `GET /health` - Basic health check
- `GET /health/ready` - Readiness (DB + Redis connected)
- `GET /health/live` - Liveness (always 200)

## Backup Strategy

### PostgreSQL

Daily backups with pg_dump:
```bash
pg_dump -Fc railgun > backup-$(date +%Y%m%d).dump
```

Or use managed service snapshots.

### Redis

Enable AOF persistence:
```
appendonly yes
appendfsync everysec
```

## Monitoring

Recommended monitoring stack:
- **Metrics**: Prometheus + Grafana
- **Logs**: Loki or CloudWatch
- **Errors**: Sentry

API exposes Prometheus metrics at `/metrics` when enabled.

## SSL/TLS

Required for production:
- Database connections (ssl=true)
- Redis connections (TLS mode)
- API behind reverse proxy (nginx/Caddy) with Let's Encrypt

Example Caddy configuration:
```
api.your-domain.com {
    reverse_proxy localhost:3000
}
```
