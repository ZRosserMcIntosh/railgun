# Security Fixes - January 9, 2026

This document summarizes the security hardening implemented based on the attack surface analysis.

## Top 5 Fixes Implemented

### Fix 1: QR Auth Flow Security (F-001)

**Problem:** QR auth flow allowed token minting with sessionId only, no requester binding or one-time exchange.

**Solution:**
- Added one-time `exchangeToken` field to auth sessions
- Exchange token is generated on session completion and must be provided for JWT exchange
- Sessions are marked as `isExchanged` after successful exchange to prevent replay attacks
- Constant-time comparison for secrets using `crypto.timingSafeEqual()`
- Rate limiting added to session creation and subscription
- CORS restricted from `*` to configured allowed origins
- WebSocket subscription rate limiting added

**Files Modified:**
- `services/api/src/auth/entities/auth-session.entity.ts` - Added `exchangeToken` and `isExchanged` fields
- `services/api/src/auth/auth-session.service.ts` - One-time exchange enforcement, constant-time comparison
- `services/api/src/auth/auth-session.controller.ts` - Exchange token required, rate limiting
- `services/api/src/auth/auth-session.gateway.ts` - CORS restrictions, rate limiting

### Fix 2: Password Reset Token Security (F-002)

**Problem:** Password reset tokens were logged and stored in plaintext.

**Solution:**
- Removed console.log that exposed reset tokens
- Added proper logging without token exposure using Logger
- Reset tokens are now hashed with SHA-256 before database storage
- Plain token is sent to user (via email), only hash is stored
- Comparison done by hashing the provided token

**Files Modified:**
- `services/api/src/auth/auth.service.ts` - Hashed token storage, removed logging

### Fix 3: Message Status Authorization (F-003)

**Problem:** Message status updates lacked authorization, allowing any authenticated user to mark arbitrary messages as read/delivered.

**Solution:**
- `updateStatus()` now accepts optional `userId` parameter for authorization
- DM messages: Validates that user is a participant in the conversation
- Channel messages: Sender can mark as sent, recipients are validated at controller level
- Batch status updates also enforce authorization
- WebSocket message ack handler now passes user ID for validation

**Files Modified:**
- `services/api/src/messages/messages.service.ts` - Authorization checks in updateStatus/batchUpdateStatus
- `services/api/src/messages/messages.controller.ts` - Pass userId to service methods
- `services/api/src/gateway/events.gateway.ts` - Pass userId in WS ack handler

### Fix 4: Analytics Endpoint Security (F-004)

**Problem:** Analytics endpoints were unauthenticated and accepted client-supplied userId.

**Solution:**
- Event ingestion endpoints are now rate limited (100 req/min)
- Health report endpoint rate limited (30 req/min)
- All metrics endpoints (DAU, WAU, MAU, sessions, features, retention, etc.) require JWT authentication
- Added batch size limit (100 events max)
- Added field length validation to prevent storage abuse
- Property values are sanitized and truncated

**Files Modified:**
- `services/api/src/analytics/analytics.controller.ts` - Auth guards, rate limiting, validation

### Fix 5: Community/Channel Membership Checks (F-005)

**Problem:** Community and channel metadata exposed to non-members.

**Solution:**
- `GET /communities/:id` - Non-public communities require membership
- `GET /communities/:id/members` - Requires membership
- `GET /communities/:id/roles` - Requires membership
- `GET /channels/:id` - Requires community membership
- `GET /channels/community/:communityId` - Requires community membership
- Added `isMember()` helper method to CommunitiesService

**Files Modified:**
- `services/api/src/communities/communities.service.ts` - Added isMember() method
- `services/api/src/communities/communities.controller.ts` - Membership checks
- `services/api/src/communities/channels.controller.ts` - Membership checks

### Additional: Auth Rate Limiting (F-006)

**Problem:** Auth endpoints lacked rate limiting despite comments.

**Solution:**
Applied rate limiting to all auth endpoints:
- `POST /auth/register` - 5/minute
- `POST /auth/login` - 10/minute
- `POST /auth/refresh` - 30/minute
- `POST /auth/recover` - 5/5 minutes
- `POST /auth/recovery-codes/rotate` - 3/minute
- `DELETE /auth/nuke` - 1/hour
- `POST /auth/password-reset/request` - 3/5 minutes
- `POST /auth/password-reset/complete` - 5/5 minutes
- `POST /auth/sessions` - 10/minute

**Files Modified:**
- `services/api/src/auth/auth.controller.ts` - Rate limiting decorators
- `services/api/src/auth/auth-session.controller.ts` - Rate limiting decorators

## Database Migration Required

The auth_sessions table needs to be updated to add two new columns:

```sql
ALTER TABLE auth_sessions 
ADD COLUMN exchange_token VARCHAR(64),
ADD COLUMN is_exchanged BOOLEAN DEFAULT FALSE;
```

## Configuration Required

Add `CORS_ALLOWED_ORIGINS` to environment configuration:

```env
# Comma-separated list of allowed origins for WebSocket connections
CORS_ALLOWED_ORIGINS=https://app.railgun.xyz,https://desktop.railgun.xyz
```

## Testing Recommendations

1. **QR Auth:**
   - Test that exchange fails without exchangeToken
   - Test that exchange only succeeds once per session
   - Test that invalid exchangeToken is rejected

2. **Password Reset:**
   - Verify no tokens appear in logs
   - Test that stored tokens are hashed (not readable)

3. **Message Status:**
   - Test that non-participants cannot update DM status
   - Test that non-members cannot update channel message status

4. **Analytics:**
   - Test that metrics endpoints return 401 without auth
   - Test rate limiting on event ingestion

5. **Communities:**
   - Test that non-members get 403 for community/channel endpoints
   - Test that public communities allow some access

## Remaining Strategic Work (30-90 days)

1. Centralized authorization layer for community/channel/message access
2. Global Redis-backed rate limiting guard
3. Structured security logging with redaction
4. Secret management via vault/KMS
5. CI security gates (SAST, secret scanning)
