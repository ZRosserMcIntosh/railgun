# Rail Gun Launch Readiness Checklist

**Generated:** December 29, 2025  
**Last Updated:** December 29, 2025  
**Status:** � IN PROGRESS - Most P0 items addressed

This document tracks all blockers, operational gaps, and action items that must be addressed before launching Rail Gun.

---

## Phase 1 Progress (Completed December 29, 2025)

### ✅ Completed Items

1. **Crypto IPC Bridge** - Created `electron/crypto-ipc.ts` for Signal Protocol in main process
2. **Production Ed25519 Keys** - Generated real keypair, public key embedded in `entitlement.ts`
3. **Stripe Integration** - Full billing controller, webhook handler, test sandbox configured
4. **Feature Flags** - Created `useFeatureFlags` hook, disabled DEX/P2P/Web, gated VOIP as premium
5. **Health Checks** - Updated `/health` and `/health/ready` with DB/Redis connectivity checks
6. **Voice Permissions** - Added `validateChannelAccess()` and new permissions (CONNECT_VOICE, SPEAK_VOICE)
7. **Community Settings API** - Added CRUD methods for members, roles, community settings
8. **External Dependencies** - Created `EXTERNAL_DEPENDENCIES.md` documenting all AWS/external requirements
9. **App Icons** - Generated all icon sizes from Railgun logo (.icns, .ico, Linux PNGs)
10. **Site Favicons** - Added favicon.ico, apple-touch-icon, android-chrome icons to Vercel site

### 🔴 Remaining for Launch

1. **Test Coverage** - Need tests for crypto, auth, messaging flows
2. **Configure Infrastructure** - Provision production Postgres, Redis, deploy API
3. **Stripe Products** - Create Pro product/price in Stripe Dashboard
4. **Feature Flag Server** - Deploy config.json for remote feature flags

---

## Table of Contents

1. [Critical Blockers (P0)](#critical-blockers-p0)
2. [High Priority (P1)](#high-priority-p1)
3. [Medium Priority (P2)](#medium-priority-p2)
4. [Pre-Launch Checklist](#pre-launch-checklist)
5. [Recommended Launch Strategy](#recommended-launch-strategy)

---

## Critical Blockers (P0)

These MUST be resolved before any launch. Ship without these = security incident.

### 1. ✅ Crypto Implementation - RESOLVED

**File:** `apps/desktop/src/crypto/index.ts`  
**Status:** ✅ Fixed - Now uses IPC to main process for Signal Protocol operations

**Completed:**
- Created `electron/crypto-ipc.ts` with handlers for crypto operations
- Updated `crypto/index.ts` to use `ElectronCryptoImpl` which delegates to IPC
- Falls back to `SimpleCryptoImpl` for browser/web environments
- Main process handles `@aspect-community/signal-protocol` native module

---

### 2. ✅ Billing Keys - RESOLVED

**File:** `apps/desktop/src/billing/entitlement.ts`  
**Status:** ✅ Fixed - Production keys generated and embedded

**Completed:**
- Generated real Ed25519 keypair using libsodium
- Public key: `JMjdHZ0J_jL4OzfRFpcDahsgT-0IZuwrDeTz9hldXFA`
- Private key stored in `.env` (`ENTITLEMENT_SIGNING_KEY`)
- `TEST_KEYPAIR` gated behind `NODE_ENV === 'development'`

---

### 3. � Advertised Features - PARTIALLY RESOLVED

**Status:** Feature-flagged incomplete features
// Line 194
// TODO: Verify signature
```

The swap service has a complete state machine but signature verification is stubbed. This is a financial feature - shipping incomplete = potential fund loss.

**Decision Required:** Ship DEX or hide it?

- [ ] **Option A (Recommended for v1):** Hide DEX feature flag, ship in v1.1
- [ ] **Option B:** Complete signature verification, security audit, then ship

#### VOIP
**File:** `apps/desktop/src/stores/voipStore.ts`

```typescript
// Line 217
// TODO: Integrate with actual VOIP provider (Twilio, etc.)

// Line 297
// TODO: Send DTMF tone through VOIP provider
```

VOIP is entirely simulated - no actual calls are placed.

**Decision Required:**
- [ ] **Option A (Recommended for v1):** Remove VOIP from UI, ship in v1.1
- [ ] **Option B:** Integrate Twilio/other provider, complete implementation

#### P2P/Relay Overlay
**File:** `apps/desktop/src/lib/p2p/bootstrap-service.ts`

```typescript
// Line 424
// TODO: Verify signature and update bootstrap list

// Line 540
// TODO: Implement peer exchange protocol
```

Bootstrap list has example nodes (`12D3KooWExample1...`), signature verification stubbed, peer exchange unimplemented.

**Decision Required:**
- [ ] **Option A (Recommended):** Fall back to centralized relay for v1, P2P in v1.2
- [ ] **Option B:** Deploy real bootstrap nodes, complete protocol

---

### 4. 🔴 Channel Encryption Lacks Key Distribution

**File:** `apps/desktop/src/lib/messagingService.ts`

```typescript
// Line 228
// TODO: Get actual member list from server
```

**File:** `apps/desktop/src/crypto/RailGunCrypto.ts`

```typescript
// Line 303
// TODO: Distribute sender key to members via DM
```

Sender keys for channel encryption are generated but never distributed to members. This means:
- Channel messages are encrypted locally
- Other members cannot decrypt them
- OR channel messages fall back to plaintext (SimpleCrypto behavior)

**Required Actions:**
- [ ] Implement sender key distribution via encrypted DMs
- [ ] Handle member joins/leaves with key rotation
- [ ] Wire to backend channel membership API

---

### 5. ✅ Community/Channel Management - RESOLVED

**File:** `apps/desktop/src/components/settings/CommunitySettingsModal.tsx`  
**Status:** ✅ Fixed - Wired to real API

**Completed:**
- Added API methods in `src/api/index.ts`: `getCommunityMembers()`, `getCommunityRoles()`, `assignRole()`, `unassignRole()`, `updateCommunitySettings()`
- Updated `CommunitySettingsModal.tsx` to fetch real data and make real API calls
- Loading/error states implemented

---

### 6. 🔴 Web/Mobile Login Path Incomplete

**File:** `railgun-site/src/app/(app)/app/page.tsx`

```typescript
// Lines 28-36 - Polling is commented out
// TODO: Poll for session confirmation
// const pollInterval = setInterval(async () => {
//   const response = await fetch(`/api/session/${token}`);
//   ...
// }, 2000);
```

QR code generates but session is never confirmed. No mobile client exists despite docs mentioning it.

**Decision Required:**
- [ ] **Option A (Recommended for v1):** Remove web app from marketing, desktop-only launch
- [ ] **Option B:** Implement session bridge, decide on mobile scope

---

### 7. 🔴 Tests Effectively Absent

**Found test files:**
```
packages/shared/src/__tests__/enums.test.ts    (utility tests)
packages/shared/src/__tests__/utils.test.ts    (utility tests)
apps/desktop/src/crypto/__tests__/crypto.e2e.test.ts  (crypto test)
apps/desktop/src/billing/__tests__/entitlement.test.ts (billing test)
```

**Missing coverage for:**
- [ ] Auth flows (login, registration, session management)
- [ ] Message encryption/decryption (DM + channel)
- [ ] WebSocket message handling
- [ ] Billing/webhooks
- [ ] Voice signaling
- [ ] Auto-updater

**Required Actions:**
- [ ] Unit tests for crypto module (DM encryption, channel encryption, key exchange)
- [ ] Integration tests for auth flows
- [ ] E2E tests for messaging flow
- [ ] Integration tests for billing/webhook verification
- [ ] Voice signaling tests
- [ ] Updater manifest verification tests

---

## High Priority (P1)

Must be resolved before public launch, but could potentially soft-launch without.

### 8. ✅ Health Endpoint - RESOLVED

**File:** `services/api/src/health/health.controller.ts`  
**Status:** ✅ Fixed - Full dependency checks implemented

**Completed:**
- `/health` - Basic liveness check
- `/health/ready` - Full readiness with Postgres + Redis connectivity
- Returns actual connection status, not hardcoded true

---

### 9. 🟠 Voice Service Skips Permission Checks

**File:** `services/api/src/voice/voice.service.ts`

```typescript
// Lines 42-44
// TODO: Validate channel exists (query communities module)
// TODO: Check if user is banned from channel
// TODO: Check channel permissions
```

Users can join any voice channel regardless of membership/bans.

**Required Actions:**
- [ ] Query channel existence before join
- [ ] Check ban list
- [ ] Verify channel permissions
- [ ] Get privacy mode from user settings (line 82)

---

### 10. 🟠 Rollout Alerts are Stubbed

**File:** `services/api/src/analytics/update-health.service.ts`

```typescript
// Line 262
// TODO: Emit alert to monitoring system (Slack, PagerDuty, etc.)
```

Auto-halt detection works, but nobody gets notified.

**Required Actions:**
- [ ] Integrate Slack webhook for alerts
- [ ] Integrate PagerDuty for on-call escalation
- [ ] Test alert flow end-to-end

---

### 11. 🟠 Production Environment Not Configured

**File:** `apps/desktop/src/lib/env.ts`

Defaults to `localhost` for development. Need to verify production values are set.

**Required Actions:**
- [ ] Set `VITE_API_URL` for production build
- [ ] Set `VITE_WS_URL` for production build
- [ ] Verify Electron preload injects correct URLs
- [ ] Test production build against staging API

---

### 12. 🟠 Download URLs Need Real Artifacts

**File:** `railgun-site/src/lib/config.ts`

```typescript
const VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0';
```

Download URLs point to GitHub releases that may not exist yet.

**Required Actions:**
- [ ] Build signed release artifacts
- [ ] Upload to GitHub Releases
- [ ] Verify download URLs work
- [ ] Test auto-update from these URLs

---

## Medium Priority (P2)

Nice to have before launch, but can ship without.

### 13. 🟡 CORS Origins Need Tightening

**Required Actions:**
- [ ] Audit CORS configuration in API
- [ ] Restrict to production domains only
- [ ] Remove `*` origins if present

---

### 14. 🟡 Environment Variable Validation

**Required Actions:**
- [ ] Add startup validation for required env vars
- [ ] Fail fast if critical vars missing
- [ ] Document all required vars in README

---

### 15. 🟡 Database Migrations

**Required Actions:**
- [ ] Run migrations on production database
- [ ] Create seed scripts if needed
- [ ] Document rollback procedures

---

### 16. 🟡 Legal/Compliance

**Files:** `railgun-site/src/app/(marketing)/privacy/page.tsx`, `terms/page.tsx`

Both are template content.

**Required Actions:**
- [ ] Legal review of privacy policy
- [ ] Legal review of terms of service
- [ ] DEX compliance disclaimers (if shipping DEX)
- [ ] Stripe/payment compliance review

---

### 17. 🟡 Monitoring/Observability

**Required Actions:**
- [ ] Add Sentry for error tracking
- [ ] Add structured logging (pino/winston)
- [ ] Add metrics endpoint (Prometheus)
- [ ] Set up uptime monitoring
- [ ] Configure database backups
- [ ] Configure Redis backups/persistence

---

## Pre-Launch Checklist

### Code Signing & Release (GitHub Secrets)

- [ ] `MACOS_CERTIFICATE` - Base64 encoded .p12
- [ ] `MACOS_CERTIFICATE_PASSWORD`
- [ ] `APPLE_ID` - For notarization
- [ ] `APPLE_ID_PASSWORD` - App-specific password
- [ ] `APPLE_TEAM_ID`
- [ ] `WINDOWS_CERTIFICATE` - EV code signing cert
- [ ] `WINDOWS_CERTIFICATE_PASSWORD`
- [ ] `RAILGUN_UPDATE_PRIVATE_KEY` - Ed25519 for signing update manifests
- [ ] `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` - If using S3/R2 for updates

### Infrastructure

- [ ] Production PostgreSQL provisioned
- [ ] Production Redis provisioned
- [ ] SFU server(s) deployed (if voice enabled)
- [ ] TURN server deployed with valid certificates
- [ ] Vercel project configured for railgun-site
- [ ] DNS configured (railgun.app, api.railgun.app, etc.)
- [ ] SSL certificates valid

### Staging Dry-Run

- [ ] Staging environment matches production config
- [ ] Tested registration → login → messaging flow
- [ ] Tested auto-update with signed artifact
- [ ] Tested billing flow (test mode)
- [ ] Tested voice channel (if enabled)

---

## Recommended Launch Strategy

### Phase 1: MVP Launch (Recommended)

**Scope:** Desktop-only, DM-only, no DEX/VOIP/P2P

1. **Fix crypto:** Switch to RailGunCrypto, IPC to main process
2. **Fix billing keys:** Generate real keys, server-side signing
3. **Hide features:** Feature flag DEX, VOIP, P2P, Web app
4. **Add tests:** Crypto, auth, messaging core paths
5. **Fix health checks:** DB/Redis validation
6. **Deploy staging:** Full dry-run
7. **Sign & release:** Code-sign, notarize, publish

**Estimated effort:** 2-3 weeks

### Phase 2: Feature Expansion

1. Channel encryption with sender key distribution
2. Community management wired to API
3. Voice with real provider
4. Web app session bridge

**Estimated effort:** 4-6 weeks

### Phase 3: Advanced Features

1. DEX with full security audit
2. P2P relay network
3. Mobile clients

**Estimated effort:** 8-12 weeks

---

## Summary

| Category | Status | Count |
|----------|--------|-------|
| Critical Blockers (P0) | 🔴 | 7 |
| High Priority (P1) | 🟠 | 5 |
| Medium Priority (P2) | 🟡 | 5 |

**Recommendation:** Do NOT launch until P0 items are resolved. For fastest path to market, descope to desktop DM-only and hide incomplete features behind flags.
