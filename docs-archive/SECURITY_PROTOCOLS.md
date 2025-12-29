# Rail Gun Security Protocols & Specifications

## Core Cryptographic Protocols

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

**Implementation**: Using libsignal (Signal's official library)

---

### 2. Curve25519
**Purpose**: Elliptic Curve Cryptography for key agreement

**Properties**:
- Modern 128-bit security level
- Fast constant-time implementation
- Resistant to side-channel attacks
- Used in X3DH key exchange
- ECDH (Elliptic Curve Diffie-Hellman) for shared secrets

**Variant**: Ed25519 for digital signatures (authentication)

**Library**: libsodium / NaCl

---

### 3. ChaCha20-Poly1305
**Purpose**: Authenticated Encryption with Associated Data (AEAD)

**Components**:
- **ChaCha20**: Stream cipher for message confidentiality
  - 256-bit key, 96-bit nonce
  - Fast and constant-time
  
- **Poly1305**: One-time authenticator
  - Provides authentication and integrity
  - Prevents tampering and replay attacks

**Mode**: AEAD (RFC 7539) - Encrypts + Authenticates in one operation

**Library**: libsodium / NaCl

---

### 4. HKDF (HMAC-based Key Derivation Function)
**Purpose**: Secure key derivation from shared secrets

**Standard**: RFC 5869

**Usage**:
- Derives session keys from X3DH shared secrets
- Creates message keys from ratchet state
- Protects against key reuse attacks

**Hash Function**: HMAC-SHA256

---

## Derived Security Properties

### Perfect Forward Secrecy (PFS)
- **Mechanism**: Double Ratchet with ephemeral keys
- **Guarantee**: Compromising long-term keys doesn't decrypt past messages
- **Implementation**: Each message uses keys that are immediately discarded after use

### Backward Secrecy
- **Mechanism**: KDF chain ratcheting (one-way progression)
- **Guarantee**: Compromised session keys don't decrypt future messages
- **Implementation**: Key material only moves forward, never backward

### Deniable Authentication
- **Property**: Recipients can't prove sender identity to third parties
- **Benefit**: Messages are authenticated but not non-repudiable
- **Use Case**: Privacy in conversation participants only

### Server Blindness
- **Encryption**: All messages encrypted with ChaCha20-Poly1305
- **Limitation**: Servers see only:
  - Encrypted message blobs (authentication verified via Poly1305)
  - Routing metadata (sender/recipient identifiers)
  - Timestamps
- **Guarantee**: Server cannot decrypt message contents

---

## Key Management

### Client-Side
- Keys generated locally using libsodium's random functions
- Private keys stored in secure storage:
  - **macOS**: Keychain (OS-level encryption)
  - **Windows**: DPAPI (Data Protection API)
  - **Linux**: File permissions (0600) + optional gpg-agent
- Keys never transmitted to server in plaintext

### Key Types
| Key Type | Size | Purpose | Generation |
|----------|------|---------|-----------|
| Identity Key | 32 bytes (Curve25519) | Long-term user key | Once, locally |
| Signed PreKey | 32 bytes | One-time server key | Server-rotated (~24h) |
| One-Time PreKeys | 32 bytes each | Session initiation | Generated locally, uploaded |
| Session Keys | Ephemeral | Per-message encryption | Derived via Double Ratchet |

### Key Rotation
- **Identity Keys**: Static per user (user manages rotation)
- **Pre-keys**: Rotated by server (24-hour cycles)
- **One-Time Keys**: Consumed on session initiation
- **Session Keys**: Rotated with every message (Double Ratchet)

---

## Data Encryption at Rest

### Desktop Client
- Private keys: OS-level keychain/DPAPI
- Chat history: Optional local encryption (libsodium)
- Application state: Encrypted via secure store

### Server Storage
- Messages: Encrypted in-transit, decrypted only briefly for routing
- Keys: Not stored (public keys only, not private keys)
- Metadata: Minimal, routing info only
- User data: Encrypted in database at rest (optional)

---

## Protocol Versions & Compatibility

### Signal Protocol Version
- **Current**: Signal Protocol v3
- **Algorithm**: Double Ratchet + X3DH

### Cryptographic Primitives Version
- **libsignal**: Latest stable (v0.x)
- **libsodium**: Latest stable (1.0.x)
- **TLS**: TLS 1.3 minimum for server communication

---

## Attack Resistance

| Attack | Mitigation |
|--------|-----------|
| **Eavesdropping** | X3DH + ChaCha20-Poly1305 encryption |
| **MITM (Key Exchange)** | X3DH mutual authentication + public key verification |
| **Replay Attacks** | Poly1305 authentication + message numbering |
| **Tampering** | Poly1305 authentication verification |
| **Key Compromise** | Perfect Forward Secrecy (past) + Break-in Recovery (future) |
| **Passive Correlation** | Server blindness - metadata minimization |
| **Side-Channel** | Constant-time implementations (libsodium) |

---

## Compliance & Standards

### Standards Adopted
- **RFC 7539**: ChaCha20 and Poly1305 AEAD
- **RFC 5869**: HKDF (HMAC-based Key Derivation Function)
- **RFC 8439**: TLS 1.3 (for server communication)
- **Signal Protocol Specification**: Double Ratchet Algorithm
- **X3DH Specification**: Extended Triple Diffie-Hellman

### Security Audits
- Signal Protocol: Audited by Open Whisper Systems (now Signal Messenger)
- libsignal: Regularly audited by security firms
- libsodium: Widely audited and used in production systems

---

## Future Enhancements

### Post-Quantum Readiness
- Monitoring NIST post-quantum cryptography standards
- Planning hybrid protocols (classical + quantum-resistant)
- Timeline: When NIST finalizes standards (2024+)

### Additional Protocols (Planned)
- **ZRTP**: For voice call encryption (when voice feature added)
- **SRTP**: For secure real-time media transport
- **OMEMO**: Multi-device synchronization (optional future)

---

## Implementation Details

### Message Format
```
[Message Header]
- Version (1 byte)
- Algorithm ID (1 byte)
- Sender DH Public Key (32 bytes)
- Counter (2 bytes)

[Ciphertext]
- ChaCha20 encrypted message (variable)
- Poly1305 tag (16 bytes)
```

### Session State
```
[Ratchet State]
- Sending chain key (32 bytes)
- Receiving chain key (32 bytes)
- Sender DH key (32 bytes)
- Receiver DH key (32 bytes)
- Previous sending chain length (2 bytes)
- Message number (2 bytes)
```

---

## Performance Characteristics

| Operation | Time | Hardware |
|-----------|------|----------|
| X3DH (Initial KE) | ~10ms | Modern CPU |
| Double Ratchet Step | <1ms | Modern CPU |
| Message Encryption | <1ms | Modern CPU |
| Message Decryption | <1ms | Modern CPU |
| Key Generation | ~5ms | Modern CPU |

All operations remain fast enough for real-time messaging.

---

## Transparency & Verification

### Open Source
- **Repository**: https://github.com/ZRosserMcIntosh/railgun
- **License**: Dual-licensed (OSS + Commercial)
- **Verification**: Users can:
  - Audit source code
  - Review cryptographic implementations
  - Build and verify binaries
  - Test against known test vectors

### Reproducible Builds
- CI/CD builds binaries reproducibly
- Signed with GPG/Sigstore
- Checksums verifiable by users
