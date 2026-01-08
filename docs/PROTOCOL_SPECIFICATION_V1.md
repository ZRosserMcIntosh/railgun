# Railgun Protocol Specification v1.0

**Status:** DRAFT → REVIEW  
**Version:** 1.0.0  
**Date:** January 8, 2026  
**Authors:** Railgun Protocol Team  
**License:** CC BY 4.0 (Specification), MIT (Reference Implementation)

---

## Abstract

Railgun is a decentralized, end-to-end encrypted messaging protocol designed for censorship resistance and user sovereignty. This specification defines the message formats, cryptographic primitives, transport mechanisms, and discovery protocols that enable secure communication without reliance on centralized infrastructure.

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [Terminology](#2-terminology)
3. [Identity & Key Management](#3-identity--key-management)
4. [Cryptographic Primitives](#4-cryptographic-primitives)
5. [Message Format](#5-message-format)
6. [Session Establishment](#6-session-establishment)
7. [Transport Layer](#7-transport-layer)
8. [Discovery & Bootstrap](#8-discovery--bootstrap)
9. [Group Messaging](#9-group-messaging)
10. [Store & Forward](#10-store--forward)
11. [Security Considerations](#11-security-considerations)
12. [Appendix: Wire Formats](#appendix-a-wire-formats)

---

## 1. Design Goals

### 1.1 Primary Goals

| Goal | Description |
|------|-------------|
| **User Sovereignty** | Users control their keys and data. No server can read message content. |
| **Censorship Resistance** | Network operates without single points of failure. Survives infrastructure loss. |
| **Forward Secrecy** | Compromise of long-term keys does not compromise past messages. |
| **Post-Compromise Security** | Sessions heal after temporary key compromise. |
| **Deniability** | Cryptographic deniability for message authorship. |
| **Minimal Metadata** | Protocol minimizes metadata exposure by design. |

### 1.2 Non-Goals

- Anonymous communication (use Tor for transport-level anonymity)
- Cryptocurrency/payment integration (out of scope for v1)
- Decentralized identity verification (DIDs optional, not required)

---

## 2. Terminology

| Term | Definition |
|------|------------|
| **Peer** | Any participant in the Railgun network |
| **Identity Key (IK)** | Long-term Ed25519 keypair identifying a user |
| **Signed Pre-Key (SPK)** | Medium-term X25519 key, rotated periodically |
| **One-Time Pre-Key (OPK)** | Single-use X25519 key for session initiation |
| **Ratchet Key** | Ephemeral X25519 key used in Double Ratchet |
| **Session** | Encrypted communication channel between two peers |
| **Envelope** | Encrypted message container with routing metadata |
| **DHT** | Distributed Hash Table for decentralized discovery |
| **Bootstrap Node** | Well-known peer for initial network discovery |

---

## 3. Identity & Key Management

### 3.1 Identity Key Pair

Each user generates a long-term identity:

```
Identity Key Pair:
  - Algorithm: Ed25519
  - Private Key: 32 bytes (kept secret)
  - Public Key: 32 bytes (shared publicly)
  - Purpose: Sign pre-keys, prove identity
```

### 3.2 Key Bundle

Users publish a key bundle for session initiation:

```
KeyBundle {
  identity_key: Ed25519PublicKey,      // 32 bytes
  signed_pre_key: X25519PublicKey,     // 32 bytes
  signed_pre_key_signature: Signature, // 64 bytes
  signed_pre_key_id: uint32,           // Key identifier
  one_time_pre_keys: [                 // 0-100 keys
    {
      key_id: uint32,
      key: X25519PublicKey             // 32 bytes
    }
  ],
  timestamp: uint64,                   // Unix timestamp (ms)
  bundle_signature: Signature          // Signs entire bundle
}
```

### 3.3 Key Rotation

| Key Type | Rotation Period | Notes |
|----------|-----------------|-------|
| Identity Key | Never (unless compromised) | User's permanent identity |
| Signed Pre-Key | 7-30 days | Must be signed by IK |
| One-Time Pre-Keys | Single use | Replenish when <20 remaining |

### 3.4 Peer ID Derivation

```
PeerId = "12D3KooW" + Base58(SHA256(IdentityPublicKey)[0:32])
```

This creates a libp2p-compatible peer identifier.

---

## 4. Cryptographic Primitives

### 4.1 Algorithms

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| Identity Signing | Ed25519 | RFC 8032 |
| Key Agreement | X25519 | RFC 7748 |
| Symmetric Encryption | AES-256-GCM | 256-bit key, 96-bit nonce |
| Key Derivation | HKDF-SHA256 | RFC 5869 |
| Message Authentication | HMAC-SHA256 | RFC 2104 |
| Hashing | SHA-256 | FIPS 180-4 |

### 4.2 X3DH Key Agreement

Extended Triple Diffie-Hellman for session establishment:

```
Alice (initiator) has:
  - IK_A: Identity Key (Ed25519 → X25519 conversion)
  - EK_A: Ephemeral Key (X25519, generated per session)

Bob (responder) published:
  - IK_B: Identity Key
  - SPK_B: Signed Pre-Key
  - OPK_B: One-Time Pre-Key (optional)

Key Agreement:
  DH1 = X25519(IK_A, SPK_B)
  DH2 = X25519(EK_A, IK_B)
  DH3 = X25519(EK_A, SPK_B)
  DH4 = X25519(EK_A, OPK_B)  // if OPK available

  SK = HKDF(DH1 || DH2 || DH3 || DH4, salt="RailgunX3DH", info="session")
```

### 4.3 Double Ratchet

After X3DH, communication uses Double Ratchet:

```
State per session:
  - DHs: Current DH key pair (X25519)
  - DHr: Remote DH public key
  - RK: Root key (32 bytes)
  - CKs: Sending chain key (32 bytes)
  - CKr: Receiving chain key (32 bytes)
  - Ns: Sending message counter
  - Nr: Receiving message counter
  - PN: Previous chain message count
  - MKSKIPPED: Dictionary of skipped message keys

Ratchet Step (receiving new DH):
  DHr = received_dh_public
  (RK, CKr) = KDF_RK(RK, DH(DHs, DHr))
  DHs = generate_new_keypair()
  (RK, CKs) = KDF_RK(RK, DH(DHs, DHr))

Message Key Derivation:
  (CK, MK) = KDF_CK(CK)
  // CK = next chain key
  // MK = message key for this message
```

### 4.4 Ed25519 to X25519 Conversion

For X3DH with Ed25519 identity keys:

```
X25519_Private = SHA512(Ed25519_Private)[0:32]
X25519_Public = Convert_Ed25519_to_X25519(Ed25519_Public)
```

Using birational map per RFC 8032 / libsodium.

---

## 5. Message Format

### 5.1 Plaintext Message

```protobuf
message PlaintextMessage {
  // Header
  bytes message_id = 1;        // 16 bytes, random UUID
  uint64 timestamp = 2;        // Unix timestamp (ms)
  string sender_id = 3;        // PeerId of sender
  
  // Content (oneof)
  oneof content {
    TextContent text = 10;
    MediaContent media = 11;
    FileContent file = 12;
    ReactionContent reaction = 13;
    ReceiptContent receipt = 14;
    TypingContent typing = 15;
    CallSignaling call = 16;
  }
  
  // Optional
  bytes reply_to = 20;         // message_id being replied to
  repeated string mentions = 21; // PeerIds mentioned
  uint32 expiration = 22;      // Seconds until expiration (0 = never)
}

message TextContent {
  string body = 1;
  repeated TextRange formatting = 2;
}

message MediaContent {
  string content_type = 1;     // MIME type
  bytes thumbnail = 2;         // Encrypted thumbnail (optional)
  uint64 size = 3;
  bytes encryption_key = 4;    // Key for media blob
  bytes digest = 5;            // SHA-256 of plaintext
  string url = 6;              // URL to encrypted blob
}

message FileContent {
  string filename = 1;
  string content_type = 2;
  uint64 size = 3;
  bytes encryption_key = 4;
  bytes digest = 5;
  string url = 6;
}
```

### 5.2 Encrypted Envelope

```protobuf
message Envelope {
  // Routing (unencrypted)
  string source_peer_id = 1;
  string destination_peer_id = 2;
  uint64 timestamp = 3;
  bytes envelope_id = 4;       // 16 bytes
  
  // Encryption metadata
  uint32 session_version = 5;
  bytes ephemeral_key = 6;     // 32 bytes, sender's current DH public
  uint32 previous_counter = 7;
  uint32 counter = 8;
  
  // Ciphertext
  bytes ciphertext = 10;       // AES-256-GCM encrypted PlaintextMessage
  bytes mac = 11;              // HMAC-SHA256 over envelope (optional redundancy)
  
  // Type hint (for processing without decryption)
  EnvelopeType type = 12;
}

enum EnvelopeType {
  UNKNOWN = 0;
  MESSAGE = 1;
  KEY_EXCHANGE = 2;
  RECEIPT = 3;
  TYPING = 4;
  CALL_SIGNALING = 5;
  PREKEY_BUNDLE = 6;
}
```

### 5.3 Padding

All messages are padded to fixed sizes to prevent length analysis:

| Content Type | Padded Size |
|--------------|-------------|
| Text (short) | 256 bytes |
| Text (medium) | 1024 bytes |
| Text (long) | 4096 bytes |
| Media reference | 512 bytes |
| Receipt/Typing | 128 bytes |

Padding uses PKCS#7 style with random fill.

---

## 6. Session Establishment

### 6.1 Initial Session (X3DH)

```
Alice → Bob (first message):

1. Alice fetches Bob's KeyBundle from DHT/relay
2. Alice performs X3DH to derive shared secret SK
3. Alice initializes Double Ratchet with SK
4. Alice sends PreKeyMessage:

PreKeyMessage {
  registration_id: uint32,           // Alice's registration ID
  identity_key: bytes,               // Alice's IK public
  ephemeral_key: bytes,              // Alice's EK public
  signed_pre_key_id: uint32,         // Which SPK used
  one_time_pre_key_id: uint32,       // Which OPK used (0 if none)
  message: Envelope                  // First encrypted message
}

5. Bob receives, performs X3DH, initializes ratchet
6. Bob can now decrypt and respond
```

### 6.2 Subsequent Messages

After session established, messages use current ratchet state:

```
Sender:
  1. Derive message key from chain
  2. Encrypt plaintext with AES-256-GCM
  3. Include current DH public in envelope
  4. Send envelope

Receiver:
  1. Check if new DH public (ratchet step needed)
  2. Derive message key
  3. Decrypt ciphertext
  4. Process plaintext
```

### 6.3 Session Reset

Sessions can be reset if:
- User reinstalls app
- Keys are rotated due to suspected compromise
- Too many messages skipped (DoS protection)

Reset triggers new X3DH handshake.

---

## 7. Transport Layer

### 7.1 Transport Hierarchy

```
Priority 1: Direct P2P (libp2p)
  └─ WebRTC (browser/mobile)
  └─ QUIC (native)
  └─ TCP (fallback)

Priority 2: Relay via known infrastructure
  └─ AWS/Cloud relay cluster
  └─ WebSocket transport

Priority 3: DHT-based relay
  └─ Peer-to-peer relay committee
  └─ Store-and-forward

Priority 4: Overlay networks
  └─ Tor hidden service
  └─ I2P eepsite
```

### 7.2 libp2p Integration

```
Supported Protocols:
  /railgun/message/1.0.0     - Direct messaging
  /railgun/keyexchange/1.0.0 - Key bundle exchange
  /railgun/sync/1.0.0        - Device sync
  /railgun/relay/1.0.0       - Relay protocol

Transports:
  - WebRTC-Star (browser)
  - WebSocket (universal fallback)
  - QUIC (native performance)
  - TCP (legacy)
  - Circuit Relay v2 (NAT traversal)

Discovery:
  - Kademlia DHT
  - mDNS (local network)
  - Bootstrap nodes
```

### 7.3 Message Delivery

```
Send(message, recipient):
  1. Check if direct connection exists
     → Yes: Send via direct stream
     → No: Continue to step 2
  
  2. Attempt direct connection
     → Success: Send via direct stream
     → Failure: Continue to step 3
  
  3. Check if relay available
     → Yes: Send via relay
     → No: Continue to step 4
  
  4. Store in DHT for later retrieval
     → Set TTL (7 days default)
     → Replicate to K peers
  
  5. Return delivery status
```

### 7.4 Acknowledgments

```
Delivery Receipt Flow:
  1. Sender sends message
  2. Recipient receives, decrypts
  3. Recipient sends DeliveryReceipt
  4. Sender marks message as delivered

Read Receipt Flow (optional):
  1. User views message
  2. Client sends ReadReceipt
  3. Sender shows "read" indicator

Receipt Message:
  ReceiptContent {
    type: DELIVERY | READ
    message_ids: [bytes]    // Can batch multiple
    timestamp: uint64
  }
```

---

## 8. Discovery & Bootstrap

### 8.1 Bootstrap Process

```
Client Startup:
  1. Check local cache for known peers
  2. If cache empty or stale:
     a. Query DNS seeds (_railgun-peers._tcp.bootstrap.railgun.app)
     b. Fetch IPFS manifest (ipns://bootstrap.railgun.eth)
     c. Try hardcoded bootstrap nodes
     d. Try Tor hidden service (if Tor available)
  3. Connect to bootstrap nodes
  4. Perform DHT bootstrap (find_node on self)
  5. Announce presence in DHT
  6. Ready for operation
```

### 8.2 DNS Seeds

```
DNS TXT Record Format:
  _railgun-peers._tcp.bootstrap.railgun.app TXT "
    peer_id=12D3KooW...,
    addrs=/ip4/1.2.3.4/tcp/9000,/ip6/.../tcp/9000,
    pubkey=...,
    sig=..."

Multiple TXT records for multiple bootstrap nodes.
Signature prevents DNS poisoning.
```

### 8.3 DHT Records

```
Key Types:
  peer:<peer_id>      → PeerInfo (addresses, capabilities)
  room:<room_hash>    → [PeerId] (room participants)
  prekey:<peer_id>    → KeyBundle (latest pre-keys)
  rendezvous:<hash>   → StoreForwardLocation

Record Structure:
  SignedDHTRecord {
    key_type: string
    key: string
    data: bytes
    signer_peer_id: string
    signature: bytes
    sequence: uint64       // Monotonic, prevents replay
    ttl: uint32            // Seconds
    created_at: uint64
  }
```

### 8.4 Peer Discovery for Messaging

```
FindPeer(peer_id):
  1. Check local peer store
  2. If not found, DHT lookup: get("peer:" + peer_id)
  3. If not found, query bootstrap nodes
  4. If not found, check relay/store-forward
  5. Return addresses or "offline"
```

---

## 9. Group Messaging

### 9.1 Group Structure

```
Group {
  group_id: bytes              // 32 bytes, random
  name: string                 // Encrypted in group messages
  members: [GroupMember]
  admin_keys: [PeerId]         // Who can modify group
  created_at: uint64
  version: uint64              // Increments on membership change
}

GroupMember {
  peer_id: string
  role: MEMBER | ADMIN | OWNER
  joined_at: uint64
  invited_by: string
}
```

### 9.2 Sender Keys (for efficiency)

For groups >2 members, use Sender Keys:

```
Sender Key Distribution:
  1. Each member generates SenderKey (chain key + signing key)
  2. Distributes SenderKey to all members via pairwise sessions
  3. Messages encrypted with SenderKey (one encrypt, many decrypt)
  4. Rotate SenderKey on membership change

SenderKeyMessage {
  group_id: bytes
  sender_id: string
  chain_id: uint32           // Which sender key chain
  iteration: uint32          // Position in chain
  ciphertext: bytes          // AES-256-GCM
}

Rotation Triggers:
  - Member removed
  - Member added (forward secrecy for new member)
  - Every N messages (configurable)
  - Manual rotation request
```

### 9.3 Group Membership Changes

```
Add Member:
  1. Admin creates GroupUpdate message
  2. Existing members rotate sender keys
  3. New member receives group state + history (optional, encrypted)
  4. New member generates and distributes sender key

Remove Member:
  1. Admin creates GroupUpdate message
  2. All remaining members rotate sender keys
  3. Removed member cannot decrypt future messages
```

---

## 10. Store & Forward

### 10.1 Offline Message Delivery

When recipient is offline:

```
Store Flow:
  1. Sender detects recipient offline
  2. Sender finds K storage peers (DHT lookup for capable peers)
  3. Sender encrypts message (already E2EE)
  4. Sender stores on K peers with TTL
  5. Sender publishes rendezvous record to DHT

Retrieve Flow:
  1. Recipient comes online
  2. Recipient queries DHT for rendezvous records
  3. Recipient contacts storage peers
  4. Recipient retrieves and decrypts messages
  5. Recipient sends delivery receipts
  6. Storage peers delete delivered messages
```

### 10.2 Storage Peer Selection

```
Selection Criteria:
  - Capability: "store-forward" advertised
  - Uptime: >95% (from reputation)
  - Bandwidth: Sufficient for message size
  - Geographic: Diverse jurisdictions preferred

Replication Factor: K=3 (configurable)
```

### 10.3 Rendezvous Record

```
RendezvousRecord {
  recipient_peer_id: string
  storage_peers: [string]      // PeerIds holding messages
  message_count: uint32
  total_size: uint64
  oldest_message: uint64       // Timestamp
  expires_at: uint64
  signature: bytes             // Signed by sender
}

DHT Key: "rendezvous:" + SHA256(recipient_peer_id + sender_peer_id)
```

---

## 11. Security Considerations

### 11.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Passive network observer | All traffic encrypted (TLS + E2EE) |
| Active network attacker | Key verification, certificate pinning |
| Compromised relay | E2EE - relay sees only ciphertext |
| Compromised storage peer | E2EE - storage peer sees only ciphertext |
| Key compromise (short-term) | Forward secrecy via ratchet |
| Key compromise (long-term) | Re-verify identity, rotate keys |
| Denial of service | Rate limiting, proof-of-work during attacks |
| Sybil attack on DHT | Reputation system, signed records |
| Replay attacks | Sequence numbers, timestamps, nonces |
| Traffic analysis | Padding, optional traffic shaping |

### 11.2 Key Verification

Users SHOULD verify identity keys out-of-band:

```
Safety Number = Truncate(
  SHA256(
    Sort(IK_A, IK_B) || 
    PeerId_A || 
    PeerId_B
  ), 
  30
)

Display: 12345 67890 12345 67890 12345 67890
         (groups of 5 digits, 6 groups)
```

### 11.3 Metadata Protection

| Metadata | Protection Level |
|----------|------------------|
| Message content | Fully encrypted (E2EE) |
| Sender/recipient | Visible to transport, encrypted to relays |
| Timestamp | Visible (can be fuzzed) |
| Message size | Padded to fixed sizes |
| Frequency | Optional traffic shaping |
| IP address | Tor support, relay mixing |

### 11.4 Cryptographic Agility

Protocol supports algorithm upgrades:

```
Version negotiation during session establishment.
Minimum supported: Current algorithms.
Deprecated algorithms rejected.
```

---

## Appendix A: Wire Formats

### A.1 Protobuf Definitions

Full `.proto` files in `/packages/protocol/proto/`

### A.2 CBOR Alternative

For constrained environments, CBOR encoding supported:

```
Same message structure, CBOR-encoded instead of Protobuf.
Content-Type: application/cbor
```

### A.3 Byte Order

All multi-byte integers: **Big Endian** (network byte order)

### A.4 String Encoding

All strings: **UTF-8**

---

## Appendix B: Constants

```
// Key sizes
IDENTITY_KEY_SIZE = 32
SIGNED_PRE_KEY_SIZE = 32
ONE_TIME_PRE_KEY_SIZE = 32
EPHEMERAL_KEY_SIZE = 32
CHAIN_KEY_SIZE = 32
MESSAGE_KEY_SIZE = 32

// Limits
MAX_ONE_TIME_PREKEYS = 100
MIN_ONE_TIME_PREKEYS = 20
MAX_MESSAGE_SIZE = 64 * 1024  // 64 KB
MAX_SKIP_MESSAGES = 1000
MAX_GROUP_SIZE = 1000

// Timeouts
SIGNED_PRE_KEY_ROTATION = 7 * 24 * 60 * 60  // 7 days (seconds)
SESSION_ARCHIVE_TIMEOUT = 30 * 24 * 60 * 60 // 30 days
STORE_FORWARD_TTL = 7 * 24 * 60 * 60        // 7 days

// Network
DHT_REPLICATION_FACTOR = 3
DHT_BUCKET_SIZE = 20
DHT_ALPHA = 3
BOOTSTRAP_NODE_COUNT = 5
```

---

## Appendix C: Reference Implementation

Reference implementation available at:
- Repository: `github.com/ZRosserMcIntosh/railgun`
- Package: `@railgun/protocol`
- License: MIT

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-08 | Initial specification |

---

*End of Specification*
