# Rail Gun Security Documentation

Last updated: December 28, 2025

Comprehensive documentation of Rail Gun's security architecture, cryptographic protocols, and security model.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Cryptographic Protocols](#cryptographic-protocols)
3. [Key Management](#key-management)
4. [Security Properties](#security-properties)
5. [Implementation Details](#implementation-details)
6. [Attack Resistance](#attack-resistance)
7. [Security Hardening](#security-hardening)

---

## Executive Summary

Rail Gun implements **end-to-end encryption (E2EE)** using the Signal Protocol. The server acts as a **blind relay** - it stores and forwards encrypted messages but **provably cannot decrypt them**.

**Key Guarantee**: Private keys NEVER leave the client device. The server only stores public keys.

### Core Protocol Stack

```
Signal Protocol + Curve25519 + ChaCha20-Poly1305
```

| Protocol | Purpose | Library |
|----------|---------|---------|
| **Signal Protocol** | End-to-end encryption framework | libsignal |
| **X3DH** | Key exchange (initial session setup) | libsignal |
| **Double Ratchet** | Per-message key derivation | libsignal |
| **Curve25519** | Elliptic curve cryptography | libsodium/NaCl |
| **ChaCha20-Poly1305** | Authenticated encryption (AEAD) | libsodium/NaCl |
| **HKDF** | Key derivation function | libsodium |

---

## Cryptographic Protocols

### 1. Signal Protocol

**Purpose**: End-to-end encrypted messaging with perfect forward secrecy

**Components**:
- **X3DH (Extended Triple Diffie-Hellman)**: Initial key exchange protocol
  - Provides mutual authentication and secrecy against eavesdropping
  - Supports asynchronous communication (pre-shared keys)
  
- **Double Ratchet Algorithm**: Symmetric key ratcheting
  - KDF (Key Derivation Function) chains for key progression
  - Ensures each message has unique encryption material
  - Provides perfect forward secrecy (PFS)
  - Achieves break-in recovery if long-term keys compromised

**Implementation**: Using `@signalapp/libsignal-client` (Signal's official library)

### 2. Curve25519

**Purpose**: Elliptic Curve Cryptography for key agreement

**Properties**:
- Modern 128-bit security level
- Fast constant-time implementation
- Resistant to side-channel attacks
- Used in X3DH key exchange
- ECDH (Elliptic Curve Diffie-Hellman) for shared secrets

**Variant**: Ed25519 for digital signatures (authentication)

### 3. ChaCha20-Poly1305

**Purpose**: Authenticated Encryption with Associated Data (AEAD)

**Components**:
- **ChaCha20**: Stream cipher for message confidentiality (256-bit key, 96-bit nonce)
- **Poly1305**: One-time authenticator for integrity

**Mode**: AEAD (RFC 7539) - Encrypts + Authenticates in one operation

### 4. HKDF (HMAC-based Key Derivation Function)

**Purpose**: Secure key derivation from shared secrets

**Standard**: RFC 5869

**Usage**:
- Derives session keys from X3DH shared secrets
- Creates message keys from ratchet state
- Protects against key reuse attacks

---

## Key Management

### Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT DEVICE (PRIVATE)                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Identity Key Pair (IK)                                                  ││
│  │ ├── Private: identityPrivateKey (Curve25519) ← NEVER LEAVES DEVICE     ││
│  │ └── Public:  identityPublicKey  (Curve25519) → Uploaded to server      ││
│  ├─────────────────────────────────────────────────────────────────────────┤│
│  │ Signed Pre-Key Pair (SPK) - Rotated weekly                              ││
│  │ ├── Private: signedPreKeyPrivate (Curve25519) ← NEVER LEAVES DEVICE    ││
│  │ ├── Public:  signedPreKeyPublic  (Curve25519) → Uploaded to server     ││
│  │ └── Signature: sign(SPK.public, IK.private)  → Uploaded to server      ││
│  ├─────────────────────────────────────────────────────────────────────────┤│
│  │ One-Time Pre-Keys (OPK) - Batch of 100, consumed on use                 ││
│  │ ├── Private: opkPrivate[0..99] (Curve25519)  ← NEVER LEAVES DEVICE     ││
│  │ └── Public:  opkPublic[0..99]  (Curve25519)  → Uploaded to server      ││
│  ├─────────────────────────────────────────────────────────────────────────┤│
│  │ Session Keys (per conversation) - Double Ratchet                        ││
│  │ ├── Root Key (RK)           ← Derived locally, NEVER uploaded          ││
│  │ ├── Chain Keys (CK_s, CK_r) ← Derived locally, NEVER uploaded          ││
│  │ └── Message Keys (MK)       ← Derived locally, NEVER uploaded          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVER (PUBLIC ONLY)                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Per-Device Key Bundle (all PUBLIC keys only):                           ││
│  │ ├── identityPublicKey      (for verification)                          ││
│  │ ├── signedPreKeyPublic     (for X3DH)                                   ││
│  │ ├── signedPreKeySignature  (to verify SPK authenticity)                 ││
│  │ └── oneTimePreKeyPublic[]  (consumed on session creation)               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Types Summary

| Type | Size | Duration | Generated | Stored |
|------|------|----------|-----------|--------|
| Identity Key | 32 bytes | Permanent | Locally | Keychain/DPAPI |
| Signed Pre-Key | 32 bytes | 7 days | Locally | Server (public) |
| One-Time Pre-Key | 32 bytes | Single use | Locally | Server (public) |
| Session Key | Ephemeral | Per-message | KDF chain | RAM only |

### Local Storage Security

| Platform | Storage Method |
|----------|---------------|
| **macOS** | Apple Keychain (encrypted by OS) |
| **Windows** | DPAPI (Data Protection API) |
| **Linux** | File permissions (0600) + optional gpg-agent |

---

## Security Properties

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| **Perfect Forward Secrecy** | Past messages safe if keys compromised | Ephemeral key ratcheting |
| **Backward Secrecy** | Future messages safe if session key leaked | One-way KDF chain |
| **Deniable Authentication** | Recipients can't prove sender to 3rd party | No non-repudiation in protocol |
| **Server Blindness** | Server sees only encrypted blobs | ChaCha20-Poly1305 encryption |
| **Metadata Minimization** | Limited exposure of routing info | Encrypted headers where possible |

---

## Implementation Details

### Safety Numbers

Signal-inspired safety number verification for detecting MITM attacks:

```typescript
// 60-digit fingerprint (12 groups of 5 digits)
// 5,200 iterations of SHA-512 hashing
computeSafetyNumber(localIdentityKey, localUserId, remoteIdentityKey, remoteUserId)
```

**Features**:
- Trust-On-First-Use (TOFU) with change detection
- QR code generation for visual verification
- Warning UI on identity key changes

### Sender Keys (Group Messaging)

For efficient group/channel encryption:

```typescript
// Rekey policies
REKEY_ON_MEMBER_REMOVE = true;    // ALWAYS rekey when member leaves
REKEY_ON_MEMBER_ADD = false;       // New members can't read history
MAX_MESSAGES_BEFORE_REKEY = 10000; // Forward secrecy bound
MAX_AGE_BEFORE_REKEY = 7 days;     // Periodic rotation
```

**Replay Protection**:
- Epoch-based message counters (monotonic per epoch)
- Circular buffer tracking (1000-message window)
- O(1) duplicate detection

### Secure Token Storage

```typescript
// Electron safeStorage integration
setTokens(accessToken, refreshToken)  // Encrypts with OS keychain
getTokens()                            // Decrypts from secure storage
clearTokens()                          // Secure deletion
migrateFromLocalStorage()              // One-time migration
```

---

## Attack Resistance

| Attack | Mitigation |
|--------|------------|
| **MITM** | X3DH mutual authentication, safety numbers |
| **Replay** | Epoch counters, monotonic message IDs |
| **Key Compromise** | Perfect forward secrecy, periodic rotation |
| **Server Compromise** | Server only has encrypted blobs |
| **Traffic Analysis** | Metadata minimization, sealed sender (planned) |
| **Enumeration** | Rate limiting (10-30 req/min on search) |
| **Downgrade** | Build number verification, rollback protection |

---

## Security Hardening

### From libsignal Analysis

#### Sealed Sender (Planned)
Hides sender identity from server - currently sender is visible in message headers.

#### Updater Security
- Build number tracking prevents rollback attacks
- Manifest expiry timestamps (7-day validity)
- Cryptographic signature verification

#### Crypto-Shred ("Nuke")
```typescript
// Secure memory wipe
async cryptoShred(reason: string): Promise<void>
  - Overwrite all keys with random data (3 passes)
  - Clear session storage
  - Delete encrypted local database
  - Unregister device from server
```

---

## Compliance & Standards

| Standard | Status |
|----------|--------|
| Signal Protocol | ✅ Using official libsignal |
| NIST Curves | ✅ Curve25519 (128-bit security) |
| AEAD Ciphers | ✅ ChaCha20-Poly1305 (RFC 7539) |
| Key Derivation | ✅ HKDF (RFC 5869) |
| Post-Quantum | 🔄 PQXDH via Kyber (experimental) |
