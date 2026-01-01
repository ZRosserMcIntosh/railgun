# External Dependencies & Infrastructure Requirements

This document lists all external services, AWS resources, and server connections required for Rail Gun to operate in production.

## Summary

| Category | Service | Required For | Can Run Locally? |
|----------|---------|--------------|------------------|
| Database | PostgreSQL (Supabase) | All data persistence | ✅ Docker |
| Cache | Redis | Rate limiting, sessions | ✅ Docker |
| Payments | Stripe | Pro subscriptions | ✅ Test mode |
| Secrets | AWS Secrets Manager | Production keys | ❌ Use .env |
| Email | SES / External SMTP | Password reset | ❌ Skip in dev |
| Turn Server | Coturn / TURN service | Voice chat | ❌ Skip in dev |
| SFU | Mediasoup / LiveKit | Voice/Video | ❌ Skip in dev |
| Analytics | PostHog / Internal | Usage tracking | ✅ Disabled |
| CDN | CloudFront / S3 | File uploads | ❌ Local storage |
| Updates | GitHub Releases | Auto-updates | ✅ Local builds |

---

## 1. Database (PostgreSQL)

**Service:** Supabase (managed PostgreSQL) or self-hosted

**Used For:**
- User accounts
- Communities, channels, memberships
- Message metadata (encrypted content)
- Billing profiles
- Auth sessions

**Environment Variables:**
```env
DATABASE_URL=postgresql://user:pass@host:5432/railgun
# OR individual params:
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=railgun
DATABASE_PASSWORD=secret
DATABASE_NAME=railgun
```

**Local Development:**
```bash
docker run -d --name railgun-postgres \
  -e POSTGRES_DB=railgun \
  -e POSTGRES_USER=railgun \
  -e POSTGRES_PASSWORD=dev \
  -p 5432:5432 \
  postgres:15
```

---

## 2. Redis

**Service:** Redis Cloud / Upstash / self-hosted

**Used For:**
- Rate limiting
- Session caching
- Presence pub/sub
- Voice room state
- Feature flag cache

**Environment Variables:**
```env
REDIS_URL=redis://localhost:6379
# OR:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional
```

**Local Development:**
```bash
docker run -d --name railgun-redis \
  -p 6379:6379 \
  redis:7
```

**Fallback:** The API uses a mock in-memory Redis when connection fails (development only).

---

## 3. Stripe (Payments)

**Service:** Stripe.com

**Used For:**
- Pro subscription checkout
- Recurring billing
- Webhook events (subscription updates)
- Customer portal

**Environment Variables:**
```env
STRIPE_SECRET_KEY=sk_test_...      # Test or live key
STRIPE_PUBLISHABLE_KEY=pk_test_... # Test or live key
STRIPE_WEBHOOK_SECRET=whsec_...    # From Stripe dashboard
STRIPE_PRO_PRICE_ID=price_...      # Your Pro plan price ID
```

**Setup Steps:**
1. Create Stripe account at stripe.com
2. Create a Product ("Rail Gun Pro")
3. Create a Price (monthly/yearly)
4. Set up webhook endpoint: `https://api.railgun.app/billing/webhook`
5. Configure webhook to send:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`

**Local Development:** Use test mode keys (pk_test_*, sk_test_*)

---

## 4. AWS Secrets Manager

**Service:** AWS Secrets Manager (or HashiCorp Vault)

**Used For:**
- Production Ed25519 signing keys
- Stripe live keys
- Database credentials
- JWT secrets

**Required Secrets:**
```
railgun/prod/entitlement-signing-key  # Ed25519 private key for Pro tokens
railgun/prod/jwt-secret               # JWT signing secret
railgun/prod/database-url             # Production DB connection string
railgun/prod/stripe-secret            # Live Stripe key
```

**Local Development:** Use `.env` file with test/development values.

---

## 5. TURN Server (Voice)

**Service:** Coturn (self-hosted) or Twilio TURN / Cloudflare TURN

**Used For:**
- WebRTC NAT traversal
- Privacy mode (forced relay)
- Voice channel connectivity

**Environment Variables:**
```env
TURN_HOST=turn.railgun.app
TURN_SECRET=shared-secret-for-credentials
```

**How It Works:**
- TURN REST API credentials generated with HMAC-SHA1
- 24-hour credential expiry
- Used when direct P2P connection fails

**Local Development:** Voice features work without TURN on localhost. For LAN testing, use Coturn in Docker or skip voice features.

---

## 6. SFU (Selective Forwarding Unit)

**Service:** Mediasoup or LiveKit (self-hosted or cloud)

**Used For:**
- Multi-party voice/video
- Efficient bandwidth usage
- Screen sharing

**Environment Variables:**
```env
SFU_ENDPOINT=wss://sfu.railgun.app
SFU_API_KEY=optional-api-key
```

**Local Development:** 
- Voice module has stubs that return mock data
- For full testing, run mediasoup locally

---

## 7. Email Service

**Service:** AWS SES / SendGrid / Mailgun

**Used For:**
- Password reset emails
- Email verification (future)
- Subscription receipts

**Environment Variables:**
```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIAXXXXXXXXXX
SMTP_PASS=xxxxx
EMAIL_FROM=noreply@railgun.app
```

**Local Development:** Email features can be disabled or logged to console.

---

## 8. CDN / File Storage

**Service:** CloudFront + S3 / Cloudflare R2

**Used For:**
- User avatars
- Community icons
- Shared files (future)
- Auto-update downloads

**Environment Variables:**
```env
AWS_S3_BUCKET=railgun-assets
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=xxx
CDN_BASE_URL=https://cdn.railgun.app
```

**Local Development:** Files stored locally or use MinIO.

---

## 9. Feature Flag Server (Optional)

**Service:** Self-hosted config server

**Used For:**
- Remote feature toggles
- Kill switches
- Gradual rollouts
- A/B testing

**Environment Variables:**
```env
RAILGUN_CONFIG_URL=https://config.railgun.app
```

**Config Format:**
```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-12-29T00:00:00Z",
  "emergencyKillSwitch": false,
  "flags": {
    "dex_swap": { "key": "dex_swap", "enabled": false },
    "voip_phone": { "key": "voip_phone", "enabled": true }
  }
}
```

**Local Development:** Falls back to hardcoded defaults in `feature-flags.ts`.

---

## 10. Analytics (Optional)

**Service:** PostHog / Internal analytics

**Used For:**
- Usage tracking
- Error monitoring
- Update health reports

**Environment Variables:**
```env
ANALYTICS_ENABLED=false  # Disabled by default
POSTHOG_API_KEY=optional
POSTHOG_HOST=https://app.posthog.com
```

**Privacy:** All analytics are opt-in. User ID is hashed before sending.

---

## Infrastructure Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRODUCTION                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    │
│   │ Desktop │    │   API   │    │  Redis  │    │ Postgres│    │
│   │  App    │───▶│ Server  │───▶│ (Cache) │    │  (DB)   │    │
│   └─────────┘    └────┬────┘    └─────────┘    └─────────┘    │
│                       │                              ▲          │
│                       │                              │          │
│                       ▼                              │          │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐        │          │
│   │  TURN   │◀──▶│   SFU   │    │ Stripe  │────────┘          │
│   │ Server  │    │(Media)  │    │(Billing)│                   │
│   └─────────┘    └─────────┘    └─────────┘                   │
│                                                                 │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐                   │
│   │   S3    │    │  SES    │    │ Secrets │                   │
│   │ (Files) │    │ (Email) │    │ Manager │                   │
│   └─────────┘    └─────────┘    └─────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Local Development Checklist

1. **Required:**
   - [ ] PostgreSQL running (Docker or local)
   - [ ] Redis running (Docker or local)
   - [ ] `.env` file with development values

2. **Optional but Recommended:**
   - [ ] Stripe test keys for billing testing
   - [ ] MinIO for local file storage

3. **Not Needed Locally:**
   - [ ] AWS Secrets Manager (use .env)
   - [ ] TURN server (localhost doesn't need NAT traversal)
   - [ ] SFU (voice stubs work for development)
   - [ ] CDN (serve files locally)
   - [ ] Email service (log to console)

---

## Production Deployment Checklist

- [ ] PostgreSQL provisioned (Supabase, RDS, or self-hosted)
- [ ] Redis provisioned (Upstash, ElastiCache, or self-hosted)
- [ ] Stripe webhooks configured
- [ ] AWS Secrets Manager secrets created
- [ ] TURN server deployed (Coturn or Twilio)
- [ ] SFU deployed (Mediasoup or LiveKit)
- [ ] S3 bucket created with CDN
- [ ] SES configured for domain
- [ ] SSL certificates provisioned
- [ ] Monitoring/alerting set up

---

## Cost Estimates (Monthly)

| Service | Free Tier | Startup | Growth |
|---------|-----------|---------|--------|
| Supabase DB | Free (500MB) | $25/mo | $50+/mo |
| Upstash Redis | Free (10k/day) | $10/mo | $20+/mo |
| Stripe | 2.9% + $0.30 | Same | Same |
| TURN (Twilio) | - | ~$5/mo | ~$20+/mo |
| SFU (LiveKit) | - | $50/mo | $100+/mo |
| S3 + CloudFront | ~$1/mo | ~$10/mo | ~$50+/mo |
| SES | $0.10/1000 | ~$1/mo | ~$10/mo |
| **Total** | ~$0 | ~$100/mo | ~$250+/mo |

Note: TURN and SFU are the largest costs for voice features. Consider these optional for MVP.
