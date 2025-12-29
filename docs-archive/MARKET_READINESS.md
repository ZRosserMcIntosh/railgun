# Rail Gun - Market Readiness Roadmap

**Status**: Pre-Launch  
**Target**: Q1 2025 Production Release  
**Last Updated**: December 26, 2024

---

## Current State Summary

### ✅ Recently Completed
- [x] Vercel deployment fixed (Node 20, framework detection)
- [x] Pseudonymous billing architecture designed & implemented
- [x] BillingService with HMAC billing_ref surrogates
- [x] Stripe integration (Checkout, Portal, Webhooks)
- [x] Shared billing types in packages/shared
- [x] Database migration for billing_profiles
- [x] PRO_RUNBOOK.md documentation
- [x] QR Auth Bridge API (services/api)
  - AuthSession entity with status enum
  - AuthSessionService with create/complete/exchange
  - AuthSessionController REST endpoints
  - AuthSessionGateway WebSocket for real-time updates
  - Migration for auth_sessions table
- [x] QR Auth shared types (packages/shared)
- [x] useQRAuth React hook (apps/desktop)
- [x] QRLoginModal component (apps/desktop)

### 🚧 In Progress
- [ ] Web app (apps/web) - marketing + web client
- [ ] Mobile app QR scanner integration

### ❌ Major Gaps to Ship
- [ ] Mobile app (Expo)
- [ ] Backend hardening (tests, observability, security)
- [ ] Distribution (signed installers, app stores)
- [ ] Legal (Privacy Policy, ToS)

---

## Phase 1: Core Infrastructure (Week 1-2)

### 1.1 Web App Foundation ✅ DONE
```
apps/web/
├── src/app/(marketing)/     # Public marketing pages
├── src/app/(app)/           # Authenticated web client  
├── src/components/          # UI components
└── Deployed to Vercel
```

### 1.2 QR Auth Bridge API ✅ DONE
**Priority**: 🔴 CRITICAL  
**Status**: COMPLETED

Session-based QR authentication for web↔desktop/mobile bridge:

```typescript
// Implemented endpoints in services/api/src/auth
POST   /auth/sessions              // Create QR session (returns sessionId + secret)
GET    /auth/sessions/:id          // Poll session status
POST   /auth/sessions/:id/scan     // Mark as scanned (optional)
POST   /auth/sessions/:id/complete // Mobile scans QR, completes auth
POST   /auth/sessions/:id/exchange // Exchange completed session for JWT
POST   /auth/sessions/:id/cancel   // Cancel session
WS     /auth (namespace)           // Real-time session updates via Socket.io
```

**Implementation**:
- ✅ AuthSession entity with status enum (PENDING, SCANNED, COMPLETED, EXPIRED, CANCELLED)
- ✅ AuthSessionService with create/complete/exchange
- ✅ AuthSessionController REST endpoints
- ✅ AuthSessionGateway WebSocket for real-time updates
- ✅ EventEmitter for session events
- ✅ Migration for auth_sessions table
- ✅ Shared QR auth types

### 1.3 Web/Desktop Client QR Flow ✅ DONE
**Priority**: 🔴 CRITICAL  
**Status**: COMPLETED

```
User clicks "Login with Mobile"
    ↓
Display QR code (via QRLoginModal component)
    ↓
Poll /auth/sessions/:id for status (or WebSocket)
    ↓
User scans QR with mobile app
    ↓
Mobile calls POST /auth/sessions/:id/complete with user's keys
    ↓
Web detects completion → calls /exchange for JWT
    ↓
Store token, redirect to dashboard
```

**Implementation**:
- ✅ useQRAuth React hook with polling
- ✅ QRLoginModal component
- ✅ qrcode library for QR generation
- ✅ Countdown timer for expiry

---

## Phase 2: Mobile App (Week 2-3)

### 2.1 Expo Project Setup
**Priority**: 🔴 CRITICAL  
**Effort**: 3-4 days

```
apps/mobile/
├── app/                    # Expo Router screens
├── components/             # Shared components
├── lib/                    # API client, crypto, storage
├── app.json                # Expo config
└── package.json
```

**Core features**:
- [ ] Deep link scheme: `railgun://`
- [ ] HTTPS fallback: `https://railgun.app/link/`
- [ ] QR scanner (expo-camera or expo-barcode-scanner)
- [ ] Secure storage (expo-secure-store)
- [ ] Push notifications (expo-notifications)
- [ ] Biometric auth (expo-local-authentication)

### 2.2 Mobile Auth Flow
```
User opens mobile app
    ↓
Scan QR from web/desktop
    ↓
Parse sessionId + secret from QR
    ↓
POST /auth/session/:id/complete with identity keys
    ↓
Web client receives auth, mobile shows success
```

### 2.3 Mobile Billing Integration
- Stripe PaymentSheet via ephemeral keys
- Same billing_ref architecture as web
- In-app subscription management

---

## Phase 3: Backend Hardening (Week 3-4)

### 3.1 Database & Migrations ✅ DONE
**Priority**: 🟡 HIGH  
**Status**: COMPLETED

- [x] TypeORM data-source.ts for CLI migrations
- [x] Migration scripts (generate, run, revert, show)
- [x] Database backup/restore scripts (pg_dump)
- [x] Connection pooling config (SSL, retry, pool limits)
- [x] Supabase support via DATABASE_URL
- [x] Comprehensive .env.example
- [x] DATABASE_OPERATIONS.md documentation
- [ ] Seed data scripts (TODO)

### 3.2 Security Hardening
**Priority**: 🔴 CRITICAL  
**Effort**: 3 days

- [ ] Strict CORS origins (not `*`)
- [ ] WebSocket origin validation
- [ ] Rate limiting (express-rate-limit)
- [ ] Input validation (class-validator)
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (helmet, CSP headers)
- [ ] Key rotation mechanism
- [ ] Audit logging for sensitive operations

### 3.3 Observability
**Priority**: 🟡 HIGH  
**Effort**: 2 days

- [ ] Structured logging (pino/winston)
- [ ] Sentry error tracking
- [ ] Prometheus metrics
- [ ] Health check endpoints
- [ ] Uptime monitoring (Better Uptime, Checkly)

### 3.4 Environment Management
- [ ] Env validation (zod/joi)
- [ ] Secrets management (Doppler/Vault)
- [ ] Staging environment
- [ ] Production environment

---

## Phase 4: Testing & CI (Week 4-5)

### 4.1 Backend Tests
**Priority**: 🟡 HIGH  
**Effort**: 3 days

```
services/api/src/__tests__/
├── auth/
│   ├── session.spec.ts        # QR session tests
│   └── jwt.spec.ts            # Token tests
├── billing/
│   ├── billing.service.spec.ts
│   └── webhook.spec.ts
├── users/
│   └── users.service.spec.ts
└── messages/
    └── messages.service.spec.ts
```

**Coverage targets**:
- Unit tests: 80%+
- Integration tests: Critical paths
- E2E tests: Auth flow, billing flow

### 4.2 Frontend Tests
- [ ] Component tests (Vitest + Testing Library)
- [ ] E2E tests (Playwright)
- [ ] Visual regression (optional)

### 4.3 CI Pipeline
```yaml
# .github/workflows/ci.yml
- Lint & typecheck all packages
- Run unit tests
- Run integration tests (with test DB)
- Build desktop app
- Build web app
- Run E2E tests
- Upload coverage to Codecov
```

---

## Phase 5: Distribution (Week 5-6)

### 5.1 Desktop Distribution
**Priority**: 🟡 HIGH  
**Effort**: 3 days

- [ ] Code signing (macOS: Developer ID, Windows: EV cert)
- [ ] Notarization (macOS)
- [ ] Auto-update mechanism (electron-updater)
- [ ] Update manifest server
- [ ] DMG/installer customization

### 5.2 Mobile Distribution
- [ ] Apple App Store listing
- [ ] Google Play Store listing
- [ ] TestFlight beta
- [ ] Play Store beta track
- [ ] App Store screenshots/metadata

### 5.3 Web Distribution
- [ ] Production domain: `app.railgun.app`
- [ ] CDN configuration
- [ ] SSL certificates
- [ ] DNS configuration

---

## Phase 6: Legal & Compliance (Week 6)

### 6.1 Legal Documents
**Priority**: 🔴 CRITICAL  
**Effort**: 2 days (with legal review)

- [ ] Privacy Policy (`/privacy`)
- [ ] Terms of Service (`/terms`)
- [ ] Cookie Policy (if applicable)
- [ ] GDPR compliance (EU users)
- [ ] Data Processing Agreement (for business tier)

### 6.2 Security Documentation
- [ ] Security whitepaper
- [ ] Bug bounty program (optional)
- [ ] SOC 2 readiness (future)

---

## Phase 7: Feature Scope for V1

### ✅ Include in V1
- End-to-end encrypted messaging
- Contact management
- Group chats (Pro/Business)
- File attachments
- QR-based auth bridge
- Pro subscriptions
- Desktop + Web + Mobile clients

### ❌ Defer to V2
- DEX integration (mock for v1)
- VoIP calls (mock for v1)
- Reactions/pins (UI only, no server sync)
- Custom relay support
- API access (Business tier)

---

## Immediate Action Items

### This Week
1. ✅ ~~Fix Vercel deployment~~
2. ✅ ~~Implement billing service~~
3. [ ] Add QR auth endpoints to API
4. [ ] Wire QR flow in web client
5. [ ] Start Expo mobile project

### Next Week
1. [ ] Complete mobile QR scanner
2. [ ] Add backend tests
3. [ ] Set up staging environment
4. [ ] Security audit pass

### Week 3
1. [ ] Code signing setup
2. [ ] App store listings draft
3. [ ] Legal documents draft
4. [ ] Beta testing program

---

## Environment Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/railgun

# Redis
REDIS_URL=redis://localhost:6379

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_PRO_YEARLY=price_xxx
STRIPE_PRICE_BUSINESS_MONTHLY=price_xxx
STRIPE_PRICE_BUSINESS_YEARLY=price_xxx

# Billing
BILLING_REF_SECRET=your-32-byte-secret

# JWT
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d

# App
APP_URL=https://railgun.app
API_URL=https://api.railgun.app
WEB_URL=https://app.railgun.app

# Observability
SENTRY_DSN=https://xxx@sentry.io/xxx

# Feature Flags
ENABLE_DEX=false
ENABLE_VOIP=false
```

---

## Success Metrics

### Launch Criteria
- [ ] All critical features working
- [ ] Zero P0 bugs
- [ ] <3s page load time
- [ ] 99.9% uptime target
- [ ] Security audit passed
- [ ] Legal review completed
- [ ] App store approved

### Post-Launch KPIs
- Daily Active Users (DAU)
- Message volume
- Conversion rate (Free → Pro)
- Churn rate
- NPS score
- Crash-free rate (>99.5%)

---

## Team Responsibilities

| Area | Owner | Backup |
|------|-------|--------|
| Backend API | TBD | TBD |
| Desktop App | TBD | TBD |
| Web Client | TBD | TBD |
| Mobile App | TBD | TBD |
| Infrastructure | TBD | TBD |
| Security | TBD | TBD |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| App store rejection | High | Medium | Follow guidelines strictly, beta test |
| Security breach | Critical | Low | Audit, pen test, bug bounty |
| Stripe account issues | High | Low | Proper KYC, follow ToS |
| Scale issues at launch | Medium | Medium | Load testing, auto-scaling |
| Legal challenges | High | Low | Proper legal review, compliance |

---

*Document maintained by the Rail Gun team. Update as progress is made.*
