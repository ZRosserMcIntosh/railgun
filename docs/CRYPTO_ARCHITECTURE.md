# Rail Gun Cryptographic Architecture

## Executive Summary

Rail Gun implements **end-to-end encryption (E2EE)** using the Signal Protocol. The server acts as a **blind relay** - it stores and forwards encrypted messages but **provably cannot decrypt them**.

**Key Guarantee**: Private keys NEVER leave the client device. The server only stores public keys.

---

## Key Hierarchy

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
│  │ ├── Message Keys (MK)       ← Derived locally, NEVER uploaded          ││
│  │ └── Ratchet Key Pairs       ← Generated locally, public sent in msgs   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVER (PUBLIC ONLY)                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Per-Device Key Bundle (all PUBLIC keys only):                           ││
│  │ ├── identityPublicKey      (for verification)                          ││
│  │ ├── signedPreKeyPublic     (for X3DH)                                   ││
│  │ ├── signedPreKeySignature  (to verify SPK authenticity)                 ││
│  │ ├── oneTimePreKeyPublic[]  (consumed on session creation)               ││
│  │ └── registrationId         (device identifier)                          ││
│  ├─────────────────────────────────────────────────────────────────────────┤│
│  │ Messages (encrypted blobs only):                                        ││
│  │ └── encryptedEnvelope      (opaque ciphertext - server cannot read)    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Proof: Server Cannot Decrypt

### 1. Mathematical Guarantee

The server stores **only public keys**. Decryption requires the corresponding **private keys** which:
- Are generated on the client device
- Are stored in encrypted local storage (Electron safeStorage / IndexedDB with encryption)
- Are NEVER transmitted to the server

### 2. Key Exchange (X3DH) - Server is Blind

When Alice wants to message Bob for the first time:

```
Alice (sender)                          Server                         Bob (recipient)
     │                                     │                                  │
     │──── Request Bob's key bundle ──────►│                                  │
     │◄─── Return: IK_B, SPK_B, OPK_B ─────│                                  │
     │                                     │                                  │
     │ Generate ephemeral key pair (EK)    │                                  │
     │ Compute shared secrets:             │                                  │
     │   DH1 = DH(IK_A, SPK_B)            │                                  │
     │   DH2 = DH(EK_A, IK_B)             │                                  │
     │   DH3 = DH(EK_A, SPK_B)            │                                  │
     │   DH4 = DH(EK_A, OPK_B)            │                                  │
     │ SK = KDF(DH1 || DH2 || DH3 || DH4) │                                  │
     │                                     │                                  │
     │ Encrypt message with SK             │                                  │
     │──── Send: IK_A, EK_A, ciphertext ──►│                                  │
     │                                     │──── Forward encrypted msg ──────►│
     │                                     │                                  │
     │                                     │              Bob computes same SK│
     │                                     │              using his privates: │
     │                                     │              IK_B_priv, SPK_priv │
     │                                     │              OPK_priv            │
     │                                     │              Decrypts message    │
```

**Server sees**: Public keys + opaque ciphertext
**Server can compute**: Nothing - it lacks ALL private keys

### 3. Forward Secrecy via Double Ratchet

After initial X3DH, the Double Ratchet provides:
- **Forward Secrecy**: Compromise of current keys doesn't reveal past messages
- **Break-in Recovery**: Future messages secure even if current state leaked

```
Message N:
  Sender generates new ratchet key pair
  DH with recipient's last ratchet public key
  Derive new chain key → message key
  Encrypt with message key
  Include sender's new ratchet PUBLIC key in message

Message N+1:
  Recipient uses received ratchet public key
  DH with their ratchet private key
  Derive new chain key → message key
  Generate new ratchet key pair for reply
```

Each message uses a **unique message key** derived from chain keys that are immediately deleted after use.

---

## Key Storage Model

### Client-Side (Desktop App)

```typescript
// Keys stored in Electron's encrypted safeStorage + IndexedDB
interface LocalKeyStore {
  // Identity (permanent until device reset)
  identityKeyPair: {
    publicKey: Uint8Array;   // Also uploaded to server
    privateKey: Uint8Array;  // NEVER leaves device
  };
  registrationId: number;
  
  // Signed Pre-Key (rotated weekly)
  signedPreKey: {
    keyId: number;
    keyPair: KeyPair;        // Private NEVER leaves device
    signature: Uint8Array;   // Signature of public key
    createdAt: number;
  };
  
  // One-Time Pre-Keys (consumed, replenished in batches)
  preKeys: Map<number, {
    keyId: number;
    keyPair: KeyPair;        // Private NEVER leaves device
  }>;
  
  // Active sessions (per recipient device)
  sessions: Map<string, SessionState>;  // All derived keys, NEVER uploaded
}
```

### Server-Side (API)

```typescript
// Server ONLY stores public keys - cannot derive secrets
interface ServerKeyStore {
  // Per device
  devices: {
    deviceId: number;
    registrationId: number;
    
    // PUBLIC ONLY
    identityPublicKey: string;      // Base64
    signedPreKeyPublic: string;     // Base64  
    signedPreKeySignature: string;  // Base64
    signedPreKeyId: number;
    
    // One-time pre-keys (PUBLIC ONLY, deleted after use)
    preKeys: Array<{
      keyId: number;
      publicKey: string;  // Base64 - private on client
    }>;
  }[];
  
  // Messages - opaque encrypted blobs
  messages: {
    encryptedEnvelope: string;  // Server cannot decrypt
    // ... metadata only
  }[];
}
```

---

## Encryption Envelope Format

```typescript
interface EncryptedEnvelope {
  // Protocol metadata (plaintext - needed for routing/decryption)
  protocolVersion: number;
  senderDeviceId: number;
  senderIdentityKey: string;      // Public key for verification
  
  // For session establishment (first message only)
  preKeyMessage?: {
    registrationId: number;
    preKeyId?: number;            // One-time pre-key used (if any)
    signedPreKeyId: number;
    ephemeralKey: string;         // Sender's ephemeral public key
    identityKey: string;          // Sender's identity public key
  };
  
  // Current ratchet public key (included in every message)
  ratchetKey: string;
  
  // Message counter for ordering/deduplication
  counter: number;
  previousCounter: number;
  
  // The actual encrypted payload
  ciphertext: string;  // AES-256-GCM encrypted, server CANNOT read
}
```

---

## Cryptographic Primitives

| Purpose | Algorithm | Key Size |
|---------|-----------|----------|
| Identity/Pre-Keys | Curve25519 | 256-bit |
| Key Derivation | HKDF-SHA-256 | - |
| Symmetric Encryption | AES-256-GCM | 256-bit |
| Message Authentication | HMAC-SHA-256 | 256-bit |
| Signatures | Ed25519 (XEdDSA) | 256-bit |

---

## Audit Points: Proving Server Blindness

### 1. Code Audit
- Client crypto module (`/apps/desktop/src/lib/crypto/`) contains all private key operations
- Server code (`/services/api/src/crypto/`) only handles public key distribution
- No private key fields in any server entity or DTO

### 2. Network Traffic Audit
- Capture all traffic between client and server
- Verify: No private key material ever transmitted
- Verify: Message payloads are opaque ciphertext

### 3. Database Audit
```sql
-- Server database contains ONLY:
SELECT 
  identity_keys.public_key,      -- PUBLIC only
  signed_prekeys.public_key,     -- PUBLIC only
  prekeys.public_key,            -- PUBLIC only
  messages.encrypted_envelope    -- Opaque ciphertext
FROM ...
-- No private_key columns exist
```

### 4. Runtime Verification
- Server can be run in secure enclave (optional)
- Memory dumps show no private key material
- Logs contain no key material (enforced by code review)

---

## Key Lifecycle

### Device Registration
1. Client generates identity key pair locally
2. Client generates signed pre-key pair, signs with identity key
3. Client generates 100 one-time pre-key pairs
4. Client uploads ONLY public keys + signatures to server
5. Private keys stored in local encrypted storage

### Session Establishment (First Message)
1. Sender requests recipient's key bundle from server
2. Sender performs X3DH locally to derive shared secret
3. Sender encrypts message with derived key
4. Server relays encrypted message (cannot decrypt)
5. Recipient performs X3DH locally to derive same shared secret
6. Recipient decrypts message

### Ongoing Messages (Double Ratchet)
1. Each message includes sender's new ratchet public key
2. Both parties perform DH ratchet step
3. New message keys derived from chain keys
4. Used message keys immediately deleted

### Key Rotation
- Signed Pre-Key: Rotated every 7 days
- One-Time Pre-Keys: Replenished when count < 10
- Ratchet Keys: New pair every message (or message chain)

### Device Revocation
1. User marks device as revoked via another device
2. Server deletes all key bundles for revoked device
3. Other users' clients receive notification, delete sessions
4. Revoked device cannot decrypt new messages

---

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Server compromise | Server has no private keys - only public keys and ciphertext |
| Server collusion with attacker | Same as above - cannot provide decryption capability |
| Database leak | Encrypted messages unreadable without client private keys |
| MITM attack | Identity key verification (safety numbers) |
| Device theft | Local key storage encrypted with device credentials |
| Quantum computers (future) | Upgrade path to post-quantum X3DH (CRYSTALS-Kyber) |

---

## Implementation Checklist

- [ ] Client: Implement Curve25519 key generation (libsodium-wrappers)
- [ ] Client: Implement X3DH key agreement
- [ ] Client: Implement Double Ratchet
- [ ] Client: Encrypted local key storage (Electron safeStorage + IndexedDB)
- [ ] Client: Safety number computation for verification
- [ ] Server: Key bundle distribution endpoints (public keys only)
- [ ] Server: Ensure no private key fields in any entity
- [ ] Server: Message relay (store-and-forward encrypted blobs)
- [ ] Audit: Automated tests verifying no private key transmission
- [ ] Audit: Database schema review for private key fields
