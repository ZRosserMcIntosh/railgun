# Railgun Project - Comprehensive Platform Review

**Date:** January 11, 2026  
**Reviewer:** Automated Analysis  
**Version:** 1.0.0

## Executive Summary

This document provides a comprehensive review of the Railgun messaging platform across all platforms (Desktop, iOS, Android, Web, and API) to ensure consistency and compatibility.

---

## 1. Platform Overview

| Platform | Repository | Status | Tech Stack |
|----------|-----------|--------|------------|
| Desktop | railgun (apps/desktop) | ✅ Production Ready | Electron + React + Vite |
| iOS | railgun-ios | 🔄 Development | SwiftUI + iOS 15+ |
| Android | railgun-android | 🔄 Development | Kotlin + Jetpack Compose |
| Web | railgun (apps/web) | ✅ Production Ready | Next.js 14 |
| API | railgun (services/api) | ✅ Production Ready | NestJS + PostgreSQL |
| Site | railgun-site | ✅ Production Ready | Next.js |

---

## 2. API Endpoint Compatibility Matrix

### Authentication Endpoints

| Endpoint | Desktop | iOS | Android | Status |
|----------|---------|-----|---------|--------|
| POST /auth/register | ✅ | ✅ | ✅ | Compatible |
| POST /auth/login | ✅ | ✅ | ✅ | Compatible |
| POST /auth/logout | ✅ | ✅ | ✅ | Compatible |
| POST /auth/refresh | ✅ | ✅ | ✅ | Compatible |
| POST /auth/recover | ✅ | ✅ | ✅ | Compatible |
| POST /auth/recovery-codes/rotate | ✅ | ⚠️ TODO | ⚠️ TODO | Needs implementation |
| DELETE /auth/nuke | ✅ | ❌ Missing | ❌ Missing | Critical - add to mobile |

### Messaging Endpoints

| Endpoint | Desktop | iOS | Android | Status |
|----------|---------|-----|---------|--------|
| GET /dms | ✅ | ⚠️ Partial | ⚠️ Partial | Mobile uses /channels |
| POST /dms | ✅ | ⚠️ Partial | ⚠️ Partial | Mobile uses /channels |
| GET /messages/dm/:userId | ✅ | ⚠️ Partial | ⚠️ Partial | Needs alignment |
| POST /messages | ✅ | ⚠️ Partial | ⚠️ Partial | Needs alignment |
| GET /messages/channel/:channelId | ✅ | ✅ | ✅ | Compatible |

### Key Management Endpoints

| Endpoint | Desktop | iOS | Android | Status |
|----------|---------|-----|---------|--------|
| POST /keys/register | ✅ | ❌ Missing | ❌ Missing | Critical for E2EE |
| GET /keys/bundle/:userId | ✅ | ❌ Missing | ❌ Missing | Critical for E2EE |
| POST /keys/prekeys | ✅ | ❌ Missing | ❌ Missing | Critical for E2EE |
| GET /keys/prekeys/count | ✅ | ❌ Missing | ❌ Missing | Critical for E2EE |
| GET /keys/devices | ✅ | ❌ Missing | ❌ Missing | Needed |

---

## 3. Critical Issues Found

### 3.1 End-to-End Encryption Not Implemented on Mobile

**Severity:** 🔴 CRITICAL

Both iOS and Android apps currently:
- Do NOT register device keys with the server
- Do NOT fetch pre-key bundles for other users
- Do NOT encrypt messages client-side
- Send messages in plaintext (relying on TLS only)

**Impact:** Messages from mobile devices are not end-to-end encrypted.

**Required Actions:**
1. iOS: Implement Sodium-based encryption using libsodium-ios
2. Android: Implement Lazysodium-based encryption
3. Both: Register device keys on first launch
4. Both: Fetch pre-key bundles before sending first message to a user
5. Both: Implement Signal Protocol ratcheting (or simplified version)

### 3.2 API Endpoint Misalignment

**Severity:** 🟡 MEDIUM

Mobile apps use a generic `/channels` endpoint while desktop uses specific:
- `/dms` for direct messages
- `/communities/{id}/channels` for community channels
- `/messages/dm/:userId` for DM message history

**Required Actions:**
1. Update iOS `APIClient.swift` to use correct endpoints
2. Update Android `RailgunApi.kt` to use correct endpoints
3. Or create unified endpoints on the API that support both patterns

### 3.3 Missing Account Destruction

**Severity:** 🟡 MEDIUM

Mobile apps don't have the "Nuke Account" feature that desktop has.

**Required Actions:**
1. Add DELETE /auth/nuke to mobile API clients
2. Add confirmation UI in Settings screens

---

## 4. Data Model Compatibility

### User Model

```
Desktop (TypeScript):        Mobile (Kotlin/Swift):
{                           {
  id: string                  id: String
  username: string            username: String
  displayName?: string        displayName: String?
  avatarUrl?: string          avatarUrl: String?
  createdAt?: Date            createdAt: String?
}                           }
```
✅ **Compatible** - Field names match, types are equivalent

### Message Model

```
Desktop (TypeScript):        Mobile (Kotlin/Swift):
{                           {
  id: string                  id: String
  senderId: string            senderId: String
  channelId?: string          channelId: String
  conversationId?: string     (MISSING)
  encryptedEnvelope: string   encryptedContent: String?
  protocolVersion: number     (MISSING)
  replyToId?: string          (MISSING)
  createdAt: string           timestamp: String
}                           }
```
⚠️ **Partial Compatibility** - Missing fields:
- `conversationId` - Needed for DMs
- `protocolVersion` - Needed for encryption version
- `replyToId` - Optional, for threading

### Token Response

```
Desktop:                     Mobile:
{                           {
  accessToken: string         accessToken: String
  refreshToken: string        refreshToken: String
}                           }
```
✅ **Compatible**

---

## 5. Security Feature Comparison

| Feature | Desktop | iOS | Android |
|---------|---------|-----|---------|
| E2EE (libsodium) | ✅ | ❌ | ❌ |
| Secure key storage | ✅ electron-store | ✅ Keychain | ✅ EncryptedPrefs |
| Biometric unlock | ❌ | ✅ (UI only) | ✅ (UI only) |
| Auto sign-out | ✅ | ✅ | ✅ |
| Certificate pinning | ❌ | ❌ | ❌ |
| Secure wipe | ✅ | ❌ | ❌ |
| Recovery codes | ✅ | ✅ | ✅ |

---

## 6. Required Changes for Production Readiness

### iOS App (Priority Order)

1. **Implement E2EE Layer**
   - Add `CryptoManager.swift` using Sodium
   - Register device keys on login/register
   - Encrypt all messages before sending
   - Decrypt messages on receive

2. **Fix API Endpoints**
   - Use `/dms` for DM conversations
   - Use `/messages/dm/:userId` for DM messages
   - Add `/keys/*` endpoints

3. **Add Missing Features**
   - Account destruction (nuke)
   - WebSocket reconnection logic
   - Push notification handling
   - Offline message queue

### Android App (Priority Order)

1. **Implement E2EE Layer**
   - Add `CryptoManager.kt` using Lazysodium
   - Register device keys on login/register
   - Encrypt all messages before sending
   - Decrypt messages on receive

2. **Fix API Endpoints**
   - Use `/dms` for DM conversations  
   - Use `/messages/dm/:userId` for DM messages
   - Add `/keys/*` endpoints

3. **Add Missing Features**
   - Account destruction (nuke)
   - WebSocket service for real-time messages
   - FCM push notification handling
   - Offline message queue with Room

---

## 7. Recommended Architecture Updates

### Unified API Response Format

Standardize all API responses to use this format:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": {
    "timestamp": "2026-01-11T12:00:00Z"
  }
}
```

### WebSocket Event Standardization

Current events should be documented and matched across platforms:

| Event | Payload | Desktop | iOS | Android |
|-------|---------|---------|-----|---------|
| message:new | Message object | ✅ | ❌ | ❌ |
| message:read | {messageId, readAt} | ✅ | ❌ | ❌ |
| typing:start | {channelId, userId} | ✅ | ❌ | ❌ |
| typing:stop | {channelId, userId} | ✅ | ❌ | ❌ |
| presence:update | {userId, status} | ✅ | ❌ | ❌ |

---

## 8. Testing Recommendations

### Cross-Platform Testing Matrix

| Test Case | Desktop ↔ iOS | Desktop ↔ Android | iOS ↔ Android |
|-----------|---------------|-------------------|---------------|
| Send/receive message | ❌ Can't test (no E2EE) | ❌ Can't test | ❌ Can't test |
| User search | ✅ Should work | ✅ Should work | ✅ Should work |
| Login/logout | ✅ Should work | ✅ Should work | ✅ Should work |
| Recovery flow | ✅ Should work | ✅ Should work | ✅ Should work |

### Integration Test Suite Needed

1. Multi-platform message delivery
2. Key exchange between different platforms
3. Session management across devices
4. Push notification delivery
5. Offline/online sync

---

## 9. Immediate Action Items

### Critical (Block Release)

- [ ] Implement E2EE in iOS app
- [ ] Implement E2EE in Android app
- [ ] Fix API endpoint alignment in mobile apps
- [ ] Add missing `conversationId` to mobile message models

### High Priority

- [ ] Add WebSocket support to mobile apps
- [ ] Implement certificate pinning
- [ ] Add account destruction to mobile
- [ ] Create unified integration test suite

### Medium Priority

- [ ] Add offline message queuing
- [ ] Implement push notifications
- [ ] Add typing indicators to mobile
- [ ] Add read receipts to mobile

### Low Priority

- [ ] Add voice/video calling to mobile
- [ ] Community features on mobile
- [ ] Profile editing on mobile

---

## 10. Conclusion

The desktop app is production-ready with full E2EE support. The iOS and Android apps have solid UI foundations but **lack the critical encryption layer** required for secure messaging. 

Before releasing mobile apps:
1. E2EE must be implemented using the same protocol as desktop
2. API endpoints must be aligned with the existing backend
3. Cross-platform messaging must be tested

**Estimated effort to production-ready mobile apps:** 2-4 weeks
