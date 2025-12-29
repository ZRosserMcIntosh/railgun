# Takedown-Resilient Architecture

## Overview

This document describes Rail Gun's multi-layered approach to censorship resistance and takedown resilience. The goal is to make the network **very hard to kill** while maintaining the ability to push verified updates.

> **Reality Check**: You can make it takedown-resistant but not truly "impossible to offline." There will always be some dependency (bootstrapping, binaries, DNS/PKI). The goal is defense in depth.

---

## 1. Bootstrap Resilience

### Multi-Transport Bootstrap List

```typescript
interface BootstrapNode {
  // Primary identifiers
  peerId: string;           // libp2p peer ID (public key hash)
  
  // Multiple transport addresses (try all in parallel)
  addresses: {
    ipv4?: string[];        // Direct IP:port
    ipv6?: string[];        // IPv6 addresses
    dns?: string[];         // DNS names (least resilient)
    onion?: string[];       // Tor .onion v3 addresses
    i2p?: string[];         // I2P b32 addresses
    ipfs?: string[];        // /ipfs/Qm... or /ipns/...
    dnslink?: string[];     // _dnslink.domain.tld
  };
  
  // Verification
  publicKey: string;        // Ed25519 public key (base64)
  signature: string;        // Self-signature proving ownership
  
  // Metadata
  region?: string;          // Geographic hint
  capabilities: string[];   // ['relay', 'turn', 'bootstrap', 'archive']
  addedAt: number;          // Timestamp
}
```

### Bootstrap Resolution Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    BOOTSTRAP RESOLUTION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Load cached peer list (if exists and < 24h old)            │
│     ↓                                                          │
│  2. Try all bootstrap transports IN PARALLEL:                  │
│     ┌─────────────┬─────────────┬─────────────┬──────────────┐ │
│     │ Direct IP   │ Tor .onion  │ I2P         │ IPFS Gateway │ │
│     │ (fastest)   │ (anonymous) │ (anonymous) │ (resilient)  │ │
│     └─────────────┴─────────────┴─────────────┴──────────────┘ │
│     ↓                                                          │
│  3. First 3 successful connections → start DHT discovery       │
│     ↓                                                          │
│  4. Cache discovered peers locally (encrypted)                 │
│     ↓                                                          │
│  5. Peer-assisted discovery (ask peers for their peer lists)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Hardcoded Bootstrap List Format

```json
{
  "version": 1,
  "updated": "2025-12-26T00:00:00Z",
  "nodes": [
    {
      "peerId": "12D3KooW...",
      "addresses": {
        "ipv4": ["203.0.113.50:9000", "198.51.100.25:9000"],
        "onion": ["abc123...xyz.onion:9000"],
        "i2p": ["abc123...b32.i2p"],
        "ipfs": ["/ipfs/QmBootstrap.../peer-manifest"]
      },
      "publicKey": "MCowBQYDK2VwAyEA...",
      "signature": "...",
      "capabilities": ["relay", "bootstrap", "turn"]
    }
  ],
  "dnsSeeds": [
    "_railgun-peers._tcp.example1.com",
    "_railgun-peers._tcp.example2.org"
  ],
  "ipfsManifests": [
    "/ipns/k51qzi5uqu5d.../bootstrap",
    "ipfs://bafybeig.../bootstrap.json"
  ],
  "signature": "..." // Signed by root key
}
```

---

## 2. Signed Update System

### Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                      KEY HIERARCHY                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ROOT KEY (OFFLINE - Ed25519)                                  │
│  ├── Stored on air-gapped hardware                             │
│  ├── Never touches network                                      │
│  ├── Signs: online signing keys, emergency revocations         │
│  │                                                              │
│  └── ONLINE SIGNING KEY (Rotated quarterly)                    │
│      ├── Signs: releases, manifests, config updates            │
│      ├── Can be revoked by root key                            │
│      │                                                          │
│      └── BUILD KEY (Per-release)                               │
│          └── Signs: individual build artifacts                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Update Manifest Format

```typescript
interface UpdateManifest {
  // Versioning
  version: string;          // Semantic version "1.2.3"
  versionCode: number;      // Monotonic integer (rollback protection)
  channel: 'stable' | 'beta' | 'canary';
  
  // Timing
  releaseDate: string;      // ISO timestamp
  expiresAt?: string;       // Optional: force update after this date
  
  // Artifacts (multiple platforms)
  artifacts: {
    platform: 'darwin-x64' | 'darwin-arm64' | 'linux-x64' | 'win32-x64';
    
    // Multiple download sources (try all)
    sources: {
      https?: string[];     // CDN URLs
      ipfs?: string;        // IPFS CID
      torrent?: string;     // Magnet link
      onion?: string;       // Tor hidden service URL
    };
    
    // Verification
    sha256: string;         // Hash of artifact
    sha512: string;         // Double verification
    size: number;           // Expected size in bytes
    signature: string;      // Signed hash (by online key)
  }[];
  
  // Security
  minimumVersion?: string;  // Force upgrade from older versions
  revokedVersions?: string[]; // Known-bad versions
  
  // Changelog
  changelog: string;
  securityFixes: boolean;
  
  // Signatures (chain of trust)
  signatures: {
    onlineKey: string;      // Primary signature
    onlineKeyId: string;    // Which online key signed
    rootAttestation?: string; // Optional: root key vouches for this release
  };
}
```

### Multi-Transport Update Distribution

```
┌─────────────────────────────────────────────────────────────────┐
│                   UPDATE DISTRIBUTION                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SOURCES (Client tries all, verifies against manifest):        │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ HTTPS/CDN   │ │    IPFS     │ │  BitTorrent │               │
│  │ (fast)      │ │ (resilient) │ │ (resilient) │               │
│  │             │ │             │ │             │               │
│  │ releases.   │ │ ipfs://     │ │ magnet:?xt= │               │
│  │ railgun.app │ │ bafybei... │ │ urn:btih:.. │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ Tor Hidden  │ │  P2P Peers  │ │   GitHub    │               │
│  │ Service     │ │ (gossip)    │ │  Releases   │               │
│  │             │ │             │ │             │               │
│  │ abc...onion │ │ DHT lookup  │ │ github.com/ │               │
│  │ /releases   │ │ for version │ │ .../releases│               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  VERIFICATION:                                                  │
│  1. Download manifest from any source                          │
│  2. Verify manifest signature (online key → root key chain)    │
│  3. Check versionCode > current (rollback protection)          │
│  4. Download artifact from any source                          │
│  5. Verify sha256 + sha512 match manifest                      │
│  6. Verify artifact signature                                   │
│  7. Apply update                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Gossip-Based Config Propagation

### Signed Config Manifest (CRDT/Append-Only)

```typescript
interface ConfigEntry {
  // Entry identification
  id: string;               // UUID
  sequence: number;         // Monotonic (per key)
  
  // Content
  key: string;              // e.g., "bootstrap.nodes", "feature.voip"
  value: unknown;           // JSON-serializable value
  action: 'set' | 'append' | 'remove';
  
  // Timing
  timestamp: number;        // Unix timestamp
  expiresAt?: number;       // Optional TTL
  
  // Signatures
  signature: string;        // Signed by online key
  signingKeyId: string;
}

interface ConfigManifest {
  // Version tracking
  manifestVersion: number;  // Increments with each change
  
  // Entries (append-only log)
  entries: ConfigEntry[];
  
  // Merkle root for efficient sync
  merkleRoot: string;
  
  // Signature over entire manifest
  signature: string;
}
```

### Gossip Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIG GOSSIP                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PUSH: When a peer receives a new config entry:                │
│  1. Verify signature (reject unsigned/invalid)                 │
│  2. Check sequence > last seen for this key (reject old)       │
│  3. Apply to local config                                       │
│  4. Gossip to K random peers (epidemic spread)                 │
│                                                                 │
│  PULL: Periodically (every 5 min):                             │
│  1. Ask random peers for their merkleRoot                      │
│  2. If different, request missing entries                      │
│  3. Merge using CRDT rules (highest sequence wins)             │
│                                                                 │
│  CONFLICT RESOLUTION:                                          │
│  - Same key, different sequence → higher sequence wins         │
│  - Same sequence (rare) → lexicographically higher sig wins    │
│  - Expired entries → garbage collected                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Anti-Kill-Switch Design

### Principles

| Principle | Implementation |
|-----------|----------------|
| No single DNS name | Multiple domains, .onion, .i2p, IPFS |
| No sole API host | All critical functions can run P2P |
| Stateless coordination | Discovery + TURN only; no central DB |
| Replicable minimum layer | Any peer can become a bootstrap node |
| No centralized auth | E2E crypto; server can't read messages |

### Critical Path Analysis

```
┌─────────────────────────────────────────────────────────────────┐
│               DEPENDENCY ANALYSIS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HARD DEPENDENCIES (Can't avoid):                              │
│  ├── Initial binary distribution (mitigate: many mirrors)     │
│  ├── At least ONE bootstrap peer reachable                     │
│  └── Signing keys not compromised                              │
│                                                                 │
│  SOFT DEPENDENCIES (Graceful degradation):                     │
│  ├── TURN servers → fallback to direct/relay P2P              │
│  ├── Update servers → P2P gossip + IPFS                       │
│  ├── DNS → hardcoded IPs + .onion + .i2p                      │
│  └── Central API → full P2P mode                               │
│                                                                 │
│  ATTACK VECTORS & MITIGATIONS:                                 │
│  ├── DNS takedown → .onion, .i2p, direct IP, IPFS             │
│  ├── CDN block → BitTorrent, IPFS, P2P gossip                 │
│  ├── IP blocking → Tor, I2P, domain fronting                  │
│  ├── App store removal → direct APK/DMG download              │
│  ├── Signing key theft → key rotation, root offline           │
│  └── Protocol block (DPI) → pluggable transports, obfs4      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Roadmap

### Phase 1: Foundation (Current)
- [x] Basic P2P relay infrastructure
- [x] E2E encryption (Signal protocol)
- [ ] Hardcoded bootstrap list with multiple transports

### Phase 2: Signed Updates
- [ ] Generate root + online signing keypair
- [ ] Build reproducible release pipeline
- [ ] Publish to HTTPS + IPFS + Tor
- [ ] Client-side signature verification

### Phase 3: Config Gossip
- [ ] Implement append-only config log
- [ ] Merkle tree for efficient sync
- [ ] Gossip protocol integration

### Phase 4: Full Resilience
- [ ] I2P transport support
- [ ] Pluggable transports (obfs4, meek)
- [ ] Peer-assisted update distribution
- [ ] Emergency key rotation procedures

---

## 6. Operational Security

### Signing Key Management

```
ROOT KEY:
- Generated on air-gapped machine
- Stored on multiple hardware security modules (HSM)
- Geographically distributed (3+ locations)
- Required signers: 2-of-3 multisig
- Never touches networked computer

ONLINE SIGNING KEY:
- Rotated every 90 days
- Stored in HSM attached to build server
- Automatically expires after 120 days
- Revocable by root key

BUILD VERIFICATION:
- Reproducible builds (same source → same binary)
- Multiple independent builders verify
- Hashes published to multiple locations
- Users can verify from source
```

### Emergency Procedures

```
KEY COMPROMISE RESPONSE:
1. Root key signs revocation of compromised online key
2. Revocation propagates via gossip (priority message)
3. Clients reject updates signed by revoked key
4. New online key generated and attested by root
5. Force-update pushed with security notice

BOOTSTRAP COMPROMISE RESPONSE:
1. Compromised nodes removed from hardcoded list
2. Config gossip pushes updated bootstrap list
3. Clients automatically refresh peer cache
4. New bootstrap nodes added

TOTAL COMPROMISE (ROOT KEY):
1. Emergency announcement via all channels
2. Users instructed to verify new root key fingerprint
3. Fresh key ceremony with public witnesses
4. New client release with new root key embedded
```

---

## Limitations to Accept

1. **Global Protocol Blocking**: If all bootstrap addresses are blocked globally, new users can't join (existing users with cached peers may still work)

2. **Supply Chain Risk**: Signing keys must be protected; reproducible builds help but don't eliminate risk

3. **Binary Distribution**: Initial download always requires some trusted channel

4. **Metadata Leakage**: Even with E2E encryption, traffic analysis can reveal communication patterns

5. **State-Level Adversaries**: Nation-state actors with deep packet inspection and legal authority are difficult to fully resist

---

## References

- [libp2p Peer Discovery](https://docs.libp2p.io/concepts/discovery-routing/)
- [The Update Framework (TUF)](https://theupdateframework.io/)
- [IPFS Content Addressing](https://docs.ipfs.tech/concepts/content-addressing/)
- [Tor Hidden Services](https://community.torproject.org/onion-services/)
- [I2P Technical Introduction](https://geti2p.net/en/docs/how/intro)
- [Signal's Key Distribution](https://signal.org/docs/specifications/x3dh/)
