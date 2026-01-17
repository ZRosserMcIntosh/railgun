# Multi-Device Testing Guide

**Date:** January 17, 2026  
**Version:** Protocol V2  
**Status:** Ready for Testing

---

## Overview

This guide covers testing procedures for the multi-device messaging implementation. All changes are backward compatible with V1 protocol.

---

## Prerequisites

### Environment Setup

1. **Test Database**
   ```bash
   # Create test database
   createdb railgun_test
   
   # Copy environment
   cp .env.example .env.test
   
   # Update .env.test with test database credentials
   ```

2. **Install Dependencies**
   ```bash
   # Root
   pnpm install
   
   # API
   cd services/api && pnpm install
   
   # Desktop
   cd apps/desktop && pnpm install
   ```

---

## Migration Testing

### Step 1: Database Backup

```bash
# Backup staging database
pg_dump -h localhost -U railgun -d railgun_staging > backup_pre_migration.sql
```

### Step 2: Run Migration Test Script

```bash
cd /path/to/railgun
./scripts/test-migrations.sh --confirm
```

The script will:
- ✅ Create automatic backup
- ✅ Run migrations
- ✅ Verify schema changes
- ✅ Test data operations
- ✅ Check indexes

### Step 3: Verify Migration Results

```sql
-- Check message_envelopes table
SELECT * FROM message_envelopes LIMIT 5;

-- Verify recipientDeviceId column
\d message_envelopes;

-- Check sender_key_distribution
\d sender_key_distribution;

-- Verify indexes
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('message_envelopes', 'sender_key_distribution');
```

---

## E2E Testing

### Running E2E Tests

```bash
cd services/api

# Set test environment
export NODE_ENV=test
export DB_NAME=railgun_test

# Run E2E tests
pnpm test:e2e messages.e2e.spec.ts
```

### Test Coverage

The E2E test suite covers:

1. **Device Registration**
   - Server-assigned deviceIds (client sends 0)
   - Multiple devices per user
   - Device listing via GET /keys/devices/:userId

2. **V2 Multi-Device Messaging**
   - Sending messages with per-device envelopes
   - Retrieving envelopes for specific devices
   - Marking envelopes as delivered
   - Access control (users can't access other's envelopes)

3. **Backward Compatibility**
   - V1 message format still accepted
   - Legacy single-envelope messages work

4. **Channel Sender-Keys**
   - Per-device sender-key distribution
   - Device-specific retrieval

---

## Manual Testing Scenarios

### Scenario 1: Two-Device DM Conversation

**Setup:**
- User A: Desktop + Mobile
- User B: Desktop

**Steps:**
1. Register User A on desktop (deviceId should be 1)
2. Register User A on mobile (deviceId should be 2)
3. Register User B on desktop (deviceId should be 1)
4. User B sends message to User A
5. Verify both User A devices receive the message

**Expected Results:**
- ✅ Desktop receives message
- ✅ Mobile receives message
- ✅ Both devices can decrypt independently

### Scenario 2: Multi-Device Sync

**Setup:**
- User A: 3 devices (Desktop, iOS, Android)
- User B: 1 device (Desktop)

**Steps:**
1. User A sends message from Desktop
2. Check iOS device
3. Check Android device

**Expected Results:**
- ✅ Message appears on iOS
- ✅ Message appears on Android
- ✅ Timestamps match across devices

### Scenario 3: Offline Device Handling

**Setup:**
- User A: Desktop (online) + Mobile (offline)
- User B: Desktop (online)

**Steps:**
1. User B sends message while User A mobile is offline
2. Bring User A mobile online
3. Check message delivery

**Expected Results:**
- ✅ Desktop receives message immediately
- ✅ Mobile receives message when back online
- ✅ No message loss

### Scenario 4: Channel Sender-Keys

**Setup:**
- Channel with 3 members
- Each member has 2 devices

**Steps:**
1. Member A sends channel message
2. Verify all 4 other devices receive sender-key distribution
3. Verify all devices can decrypt channel messages

**Expected Results:**
- ✅ Each device gets targeted sender-key
- ✅ All devices can decrypt
- ✅ Sender-keys are one-time delivery

---

## API Endpoint Testing

### Device Registration

```bash
# Register device (server assigns ID)
curl -X POST http://localhost:3000/keys/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": 0,
    "deviceType": "desktop",
    "identityKey": "base64_key",
    "registrationId": 12345,
    "signedPreKey": {
      "keyId": 1,
      "publicKey": "base64_key",
      "signature": "base64_sig"
    },
    "preKeys": [...]
  }'

# Expected response:
# { "deviceId": 1, "message": "Keys registered successfully" }
```

### Get User Devices

```bash
curl -X GET http://localhost:3000/keys/devices/$USER_ID \
  -H "Authorization: Bearer $TOKEN"

# Expected response:
# {
#   "devices": [
#     { "deviceId": 1, "deviceType": "desktop", "createdAt": "..." },
#     { "deviceId": 2, "deviceType": "mobile", "createdAt": "..." }
#   ]
# }
```

### Send V2 Message

```bash
curl -X POST http://localhost:3000/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipientId": "user-id",
    "protocolVersion": 2,
    "deviceEnvelopes": [
      {
        "deviceId": 1,
        "encryptedEnvelope": "base64_envelope_1"
      },
      {
        "deviceId": 2,
        "encryptedEnvelope": "base64_envelope_2"
      }
    ],
    "clientNonce": "unique-nonce"
  }'
```

### Get Envelope for Device

```bash
curl -X GET "http://localhost:3000/messages/$MESSAGE_ID/envelope?deviceId=1" \
  -H "Authorization: Bearer $TOKEN"

# Expected response:
# {
#   "encryptedEnvelope": "base64_envelope_1",
#   "recipientDeviceId": 1,
#   "delivered": false
# }
```

---

## Desktop App Testing

### Build and Run

```bash
cd apps/desktop

# Development mode
pnpm dev

# Production build
pnpm build
```

### Test Checklist

- [ ] Device registration persists deviceId to storage
- [ ] WebSocket auth includes deviceId
- [ ] Sending DM encrypts for all recipient devices
- [ ] Receiving DM decrypts with correct device session
- [ ] Channel messages distribute sender-keys per device
- [ ] Multiple desktop instances work independently

### Debug Logging

Enable crypto debug logs in `apps/desktop/src/crypto/RailGunCrypto.ts`:

```typescript
console.log('[Crypto] Device ID:', this.deviceId);
console.log('[Crypto] Encrypting for devices:', deviceIds);
```

---

## iOS App Testing

### Build Requirements

```bash
cd railgun-ios

# Install dependencies
swift package resolve

# Build
xcodebuild -scheme RailGun -configuration Debug
```

### Test Checklist

- [ ] Server assigns deviceId on first registration
- [ ] Stored deviceId persists across app restarts
- [ ] Multi-device encryption works (createEncryptedEnvelopesForAllDevices)
- [ ] V2 message sending includes all device envelopes
- [ ] Message reception handles device-specific envelopes

---

## Android App Testing

### Build and Run

```bash
cd railgun-android

# Build debug APK
./gradlew assembleDebug

# Install on device
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Test Checklist

- [ ] Server assigns deviceId on registration
- [ ] DMRepository sends deviceId=0 initially
- [ ] encryptMessageForAllDevices creates all envelopes
- [ ] SendDMMessageV2Request properly serializes
- [ ] Message reception works with V2 protocol

---

## Performance Testing

### Load Testing

Test with multiple concurrent users and devices:

```bash
# Use artillery or k6 for load testing
npm install -g artillery

# Run load test
artillery run load-test.yml
```

### Metrics to Monitor

- Message delivery latency
- Database query performance (envelope queries)
- WebSocket connection stability
- Memory usage with multiple devices

---

## Rollback Plan

If issues are discovered:

### Database Rollback

```bash
# Restore from backup
psql -h localhost -U railgun -d railgun_staging < backup_pre_migration.sql
```

### Code Rollback

```bash
# Revert commits
git revert HEAD~5..HEAD

# Or reset to previous version
git reset --hard <commit-before-changes>
```

### Client Compatibility

V1 clients will continue to work as the server accepts both protocols.

---

## Production Deployment Checklist

- [ ] All E2E tests passing
- [ ] Manual testing scenarios completed
- [ ] Migration tested on staging
- [ ] Performance benchmarks acceptable
- [ ] Rollback plan documented and tested
- [ ] Monitoring alerts configured
- [ ] Database backup created
- [ ] Team notified of deployment window
- [ ] Documentation updated

---

## Monitoring Post-Deployment

### Key Metrics

1. **Message Delivery Success Rate**
   ```sql
   SELECT 
     COUNT(*) FILTER (WHERE delivered = true) * 100.0 / COUNT(*) as delivery_rate
   FROM message_envelopes
   WHERE "createdAt" > NOW() - INTERVAL '1 hour';
   ```

2. **Device Distribution**
   ```sql
   SELECT 
     "userId",
     COUNT(DISTINCT "deviceId") as device_count
   FROM device
   GROUP BY "userId"
   ORDER BY device_count DESC
   LIMIT 10;
   ```

3. **Protocol Version Usage**
   ```sql
   SELECT 
     CASE 
       WHEN "encryptedEnvelope" IS NOT NULL THEN 'V1'
       ELSE 'V2'
     END as protocol_version,
     COUNT(*) as message_count
   FROM message
   WHERE "createdAt" > NOW() - INTERVAL '1 day'
   GROUP BY protocol_version;
   ```

### Error Monitoring

Watch for:
- Envelope not found errors
- Device ID mismatch errors
- WebSocket authentication failures with deviceId
- Sender-key distribution failures

---

## Support Resources

- **Documentation:** `/docs/COPILOT_MULTI_DEVICE_AND_AWS_REMOVAL.md`
- **Architecture:** `/docs/ARCHITECTURE.md`
- **API Reference:** `/docs/API.md`

---

*Last Updated: January 17, 2026*
