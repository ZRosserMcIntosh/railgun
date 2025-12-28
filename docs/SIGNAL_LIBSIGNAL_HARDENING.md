# Rail Gun - Security Hardening from Signal libsignal Analysis

## Executive Summary

After cross-referencing your Rail Gun implementation with Signal's official `libsignal` library, I've identified several areas for security hardening. Your current implementation uses the correct libraries (`@signalapp/libsignal-client`) and follows good security practices, but there are gaps that Signal implements which you're missing.

---

## ✅ What You're Doing Right

### 1. **Core Protocol Implementation**
- ✅ Using official `@signalapp/libsignal-client` (NOT custom crypto)
- ✅ X3DH key exchange implemented
- ✅ Double Ratchet messaging 
- ✅ PQXDH (Post-Quantum) via Kyber keys
- ✅ Sender Keys for group messaging
- ✅ ChaCha20-Poly1305 (AEAD) via libsodium for local storage
- ✅ OS keychain integration (Electron safeStorage)
- ✅ Proper store implementations (Identity, Session, PreKey, SignedPreKey, Kyber, SenderKey)

### 2. **Key Management**
- ✅ Keys generated locally, never transmitted
- ✅ Proper pre-key rotation
- ✅ Registration bundles for upload
- ✅ Session persistence

---

## 🔴 Critical Missing Features from libsignal

### 1. **Sealed Sender (Metadata Protection)** - HIGH PRIORITY

Signal's libsignal implements "Sealed Sender" which hides who sent a message from the server. Currently, your implementation exposes sender identity in message headers.

**What Signal has:**
```typescript
// From libsignal - node/ts/index.ts
export async function sealedSenderEncryptMessage(
  message: Uint8Array,
  address: ProtocolAddress,
  senderCert: SenderCertificate,
  sessionStore: SessionStore,
  identityStore: IdentityKeyStore
): Promise<Uint8Array>

export class SealedSenderDecryptionResult {
  message(): Uint8Array;
  senderE164(): string | null;
  senderUuid(): string;
  deviceId(): number;
}
```

**What you need to add:**
```typescript
// In SignalWrapper.ts - add sealed sender support
import * as Signal from '@signalapp/libsignal-client';

async encryptSealed(
  recipientId: string,
  deviceId: number,
  plaintext: Uint8Array,
  senderCert: Signal.SenderCertificate
): Promise<Uint8Array> {
  const address = Signal.ProtocolAddress.new(recipientId, deviceId);
  
  return Signal.sealedSenderEncryptMessage(
    Buffer.from(plaintext),
    address,
    senderCert,
    this.sessionStore,
    this.identityStore
  );
}

async decryptSealed(
  ciphertext: Uint8Array,
  trustRoot: Signal.PublicKey,
  timestamp: number,
  localUuid: string,
  localDeviceId: number
): Promise<Signal.SealedSenderDecryptionResult> {
  return Signal.sealedSenderDecrypt(
    Buffer.from(ciphertext),
    trustRoot,
    timestamp,
    null, // localE164 (optional)
    localUuid,
    localDeviceId,
    this.identityStore,
    this.sessionStore,
    this.preKeyStore,
    this.signedPreKeyStore,
    this.kyberPreKeyStore
  );
}
```

**Server changes needed:**
- Implement `SenderCertificate` and `ServerCertificate` issuance
- Server must trust but not inspect sealed sender messages
- Certificate validation on the receiving client

---

### 2. **Proper Safety Number / Fingerprint Verification** - HIGH PRIORITY

Your current fingerprint implementation is a simple hex encoding. Signal uses a cryptographically proper fingerprint with 60-digit display + QR scanning capability.

**What Signal has:**
```typescript
// From libsignal - node/ts/index.ts
export class Fingerprint {
  static new(
    iterations: number,     // 5200 recommended for 112-bit security
    version: number,        // Protocol version
    localIdentifier: Uint8Array,
    localKey: PublicKey,
    remoteIdentifier: Uint8Array,
    remoteKey: PublicKey
  ): Fingerprint;

  displayableFingerprint(): DisplayableFingerprint;  // 60-digit string
  scannableFingerprint(): ScannableFingerprint;      // QR code data
}

export class ScannableFingerprint {
  compare(other: ScannableFingerprint): boolean;
  toBuffer(): Uint8Array;
}
```

**Fix for your SignalWrapper.ts:**
```typescript
// Replace getIdentityFingerprint() with proper implementation
async getSafetyNumber(
  remoteUserId: string,
  remoteIdentityKey: Signal.PublicKey
): Promise<{
  displayText: string;
  scannableData: Uint8Array;
}> {
  const localUserId = await this.getLocalUserId();
  const localIdentityKey = this.identityStore.getIdentityPublicKey();
  
  const fingerprint = Signal.Fingerprint.new(
    5200,  // iterations (112-bit security)
    2,     // version
    new TextEncoder().encode(localUserId),
    localIdentityKey,
    new TextEncoder().encode(remoteUserId),
    remoteIdentityKey
  );
  
  return {
    displayText: fingerprint.displayableFingerprint().toString(),
    scannableData: fingerprint.scannableFingerprint().toBuffer()
  };
}

async verifySafetyNumber(
  scannedData: Uint8Array,
  expectedData: Uint8Array
): Promise<boolean> {
  const local = Signal.ScannableFingerprint._fromBuffer(expectedData);
  const remote = Signal.ScannableFingerprint._fromBuffer(scannedData);
  return local.compare(remote);
}
```

---

### 3. **Certificate Validation Infrastructure** - MEDIUM PRIORITY

Signal has server certificates and sender certificates for sealed sender. You need:

**Required classes (already in libsignal-client):**
```typescript
// ServerCertificate - signed by trust root
export class ServerCertificate {
  static new(id: number, key: PublicKey, trustRoot: PrivateKey): ServerCertificate;
  keyId(): number;
  key(): PublicKey;
}

// SenderCertificate - signed by server
export class SenderCertificate {
  static new(
    senderUuid: string,
    senderE164: string | null,
    senderDeviceId: number,
    senderKey: PublicKey,
    expiration: number,
    signerCert: ServerCertificate,
    signerKey: PrivateKey
  ): SenderCertificate;
}

// CertificateValidator - validates chain
export class CertificateValidator {
  constructor(trustRoot: PublicKey);
  validate(certificate: SenderCertificate, validationTime: number): void;
}
```

---

### 4. **DecryptionErrorMessage Recovery** - MEDIUM PRIORITY

Signal handles decryption failures gracefully with recovery messages:

```typescript
// From libsignal
export class DecryptionErrorMessage {
  static forOriginal(
    bytes: Uint8Array,
    type: CiphertextMessageType,
    timestamp: number,
    originalSenderDeviceId: number
  ): DecryptionErrorMessage;
  
  ratchetKey(): PublicKey | undefined;
  timestamp(): number;
  deviceId(): number;
}
```

Add to your implementation for session recovery when decryption fails.

---

### 5. **Content Hints for Message Retries** - LOW PRIORITY

Signal's sealed sender includes content hints:

```typescript
export enum ContentHint {
  Default = 0,
  Resendable = 1,  // Message can be requested again
  Implicit = 2     // Content is implicit (typing indicator, etc.)
}
```

---

## 🟡 Recommended Enhancements

### 1. **Multi-recipient Sealed Sender**

Signal can efficiently encrypt for multiple recipients:

```typescript
export function sealedSenderMultiRecipientEncrypt(
  content: UnidentifiedSenderMessageContent,
  recipients: ProtocolAddress[],
  identityStore: IdentityKeyStore,
  sessionStore: SessionStore
): Promise<Uint8Array>
```

This is more efficient for group messages sent via sealed sender.

### 2. **HKDF Usage**

You're using libsodium for HKDF, but libsignal exposes it directly:

```typescript
export function hkdf(
  outputLength: number,
  keyMaterial: Uint8Array,
  label: Uint8Array,
  salt: Uint8Array | null
): Uint8Array
```

Consistent use of libsignal's HKDF ensures protocol compatibility.

### 3. **Session Archive on Identity Change**

Signal archives old sessions when identity keys change:

```typescript
// In SessionRecord
archiveCurrentState(): void;
```

Add identity key change detection and session archival.

---

## 📋 Implementation Checklist

### Phase 1: Core Security (Immediate)
- [ ] Implement proper `Fingerprint` safety numbers in `SignalWrapper.ts`
- [ ] Add safety number UI component for identity verification
- [ ] Add identity key change alerts
- [ ] Implement `DecryptionErrorMessage` handling for recovery

### Phase 2: Sealed Sender (1-2 weeks)
- [ ] Implement `ServerCertificate` issuance on backend
- [ ] Implement `SenderCertificate` issuance flow
- [ ] Add sealed sender encryption in `SignalWrapper.ts`
- [ ] Add sealed sender decryption
- [ ] Add certificate validation
- [ ] Update message routing to support sealed sender

### Phase 3: Enhanced Features (2-4 weeks)
- [ ] Multi-recipient sealed sender for groups
- [ ] Content hints for message retries
- [ ] Session archival on identity change
- [ ] Formal security audit

---

## 🔒 Code Changes Required

### File: `apps/desktop/src/crypto/SignalWrapper.ts`

Add these methods:

```typescript
// ============== SAFETY NUMBERS ==============

/**
 * Generate a proper Signal-style safety number for identity verification.
 */
async getSafetyNumber(
  remoteUserId: string,
  remoteDeviceId: number
): Promise<{ displayText: string; scannableData: Uint8Array } | null> {
  const address = makeAddress(remoteUserId, remoteDeviceId);
  const remoteIdentity = await this.identityStore.getIdentity(address);
  
  if (!remoteIdentity) {
    return null;
  }
  
  const localUserId = await this.getLocalUserId();
  const localIdentityKey = this.identityStore.getIdentityPublicKey();
  
  const fingerprint = Signal.Fingerprint.new(
    5200,
    2,
    new TextEncoder().encode(localUserId),
    localIdentityKey,
    new TextEncoder().encode(remoteUserId),
    remoteIdentity
  );
  
  return {
    displayText: fingerprint.displayableFingerprint().toString(),
    scannableData: fingerprint.scannableFingerprint().toBuffer()
  };
}

/**
 * Compare a scanned safety number QR code.
 */
verifySafetyNumber(scannedData: Uint8Array, localData: Uint8Array): boolean {
  const local = Signal.ScannableFingerprint._fromBuffer(localData);
  const scanned = Signal.ScannableFingerprint._fromBuffer(scannedData);
  return local.compare(scanned);
}

// ============== IDENTITY KEY CHANGE DETECTION ==============

/**
 * Check if a remote identity key has changed.
 */
async hasIdentityChanged(
  remoteUserId: string,
  remoteDeviceId: number,
  newIdentityKey: Signal.PublicKey
): Promise<boolean> {
  const address = makeAddress(remoteUserId, remoteDeviceId);
  const storedKey = await this.identityStore.getIdentity(address);
  
  if (!storedKey) {
    return false; // First contact, not a "change"
  }
  
  const storedBytes = storedKey.serialize();
  const newBytes = newIdentityKey.serialize();
  
  return !arraysEqual(storedBytes, newBytes);
}

// ============== SEALED SENDER (when implemented) ==============

// TODO: Add sealed sender support
// This requires server-side certificate issuance infrastructure
```

### File: `apps/desktop/src/crypto/RailGunCrypto.ts`

Update the facade:

```typescript
/**
 * Get safety number for identity verification.
 */
async getSafetyNumber(
  peerUserId: string,
  peerDeviceId: number = 1
): Promise<{ displayText: string; qrData: Uint8Array } | null> {
  this.ensureInitialized();
  
  const result = await this.signal.getSafetyNumber(peerUserId, peerDeviceId);
  if (!result) {
    return null;
  }
  
  return {
    displayText: result.displayText,
    qrData: result.scannableData
  };
}

/**
 * Verify a scanned safety number.
 */
verifySafetyNumber(scannedQrData: Uint8Array, localQrData: Uint8Array): boolean {
  this.ensureInitialized();
  return this.signal.verifySafetyNumber(scannedQrData, localQrData);
}
```

---

## 📊 Security Comparison Matrix

| Feature | Signal libsignal | Rail Gun Current | Priority |
|---------|------------------|------------------|----------|
| X3DH Key Exchange | ✅ | ✅ | - |
| Double Ratchet | ✅ | ✅ | - |
| PQXDH (Kyber) | ✅ | ✅ | - |
| Sender Keys (Groups) | ✅ | ✅ | - |
| Pre-key Bundles | ✅ | ✅ | - |
| Session Persistence | ✅ | ✅ | - |
| **Safety Numbers** | ✅ | ⚠️ (basic) | HIGH |
| **Sealed Sender** | ✅ | ❌ | HIGH |
| Certificate Chain | ✅ | ❌ | MEDIUM |
| Decryption Recovery | ✅ | ❌ | MEDIUM |
| Multi-recipient SSv2 | ✅ | ❌ | LOW |
| Content Hints | ✅ | ❌ | LOW |

---

## 🎯 Recommended Action Plan

1. **This Week:**
   - Implement proper `Fingerprint` safety numbers
   - Add safety number verification UI
   - Add identity key change detection and alerts

2. **Next 2 Weeks:**
   - Design server-side certificate infrastructure
   - Implement sealed sender encryption/decryption
   - Add certificate validation

3. **Month 2:**
   - Add decryption error recovery
   - Implement multi-recipient sealed sender
   - Conduct security audit

---

## References

- Signal Protocol Documentation: https://signal.org/docs/
- libsignal GitHub: https://github.com/signalapp/libsignal
- libsignal Node.js Bindings: `@signalapp/libsignal-client`
- Sealed Sender Blog Post: https://signal.org/blog/sealed-sender/
- Safety Numbers: https://signal.org/blog/safety-number-updates/

---

*Generated from libsignal-main analysis on December 27, 2025*
