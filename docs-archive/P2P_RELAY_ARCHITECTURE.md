# Rail Gun P2P Relay Architecture

## Overview

Rail Gun implements a fully decentralized peer-to-peer relay network where users share the load of message delivery. This eliminates central server dependencies and distributes infrastructure costs across the user base.

## Core Principles

1. **Zero Central Dependency**: After initial peer discovery, the network operates without central servers
2. **Traffic Proportionality**: Each peer handles `1/N` of network traffic where N = active peers
3. **Privacy Preservation**: Relay peers only see encrypted ciphertext; E2EE remains end-to-end
4. **Byzantine Fault Tolerance**: System continues operating even with malicious/offline peers

## Architecture Components

### 1. Peer Discovery Layer

```
┌─────────────────────────────────────────────────────────────┐
│                    Bootstrap Nodes                          │
│  (Minimal stateless rendezvous - no message content)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Kademlia DHT (libp2p)                       │
│  • Peer discovery by topic/room hash                        │
│  • NAT traversal coordination (STUN/TURN hints)             │
│  • Relay committee announcements                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              WebRTC Data Channels / QUIC                    │
│  • Direct peer-to-peer encrypted transport                  │
│  • Fallback through TURN when direct fails                  │
└─────────────────────────────────────────────────────────────┘
```

### 2. Relay Committee System

For each channel/conversation, a **relay committee** of 3-7 peers handles message fanout:

```typescript
// Committee selection is deterministic and verifiable
function selectCommittee(roomId: string, epoch: number): PeerId[] {
  const seed = hash(roomId + epoch.toString());
  const eligiblePeers = getActivePeers().filter(p => p.reputation >= MIN_REP);
  return deterministicSample(eligiblePeers, COMMITTEE_SIZE, seed);
}
```

**Rotation Schedule**:
- Committees rotate every 10 minutes (configurable)
- Overlap period of 2 minutes for handoff
- Clients cache next committee for seamless transition

### 3. Message Flow

```
Sender                Committee (3 peers)              Recipients
  │                        │                              │
  ├──[E2EE envelope]──────►│                              │
  │                        ├──verify PoW/reputation──────►│
  │                        ├──fanout to 3 relays─────────►│
  │                        │                              │
  │                        │◄─────────────────────────────┤
  │                        │   (each relay forwards to    │
  │                        │    1/3 of room members)      │
  │                        │                              │
  │◄───────[ACK]───────────┤                              │
```

### 4. Reputation System

Peers earn reputation through:
- **Uptime**: Consistent availability during committed relay periods
- **Throughput**: Successfully relaying messages within latency bounds
- **Stake** (optional): Bonding tokens to increase trust weight

```typescript
interface PeerReputation {
  peerId: string;
  uptimeScore: number;       // 0-100, rolling 24h window
  relaySuccessRate: number;  // 0-100, last 1000 messages
  latencyP95: number;        // milliseconds
  stakedAmount?: bigint;     // optional economic stake
  blacklisted: boolean;
  blacklistReason?: string;
  lastSeen: number;
}
```

### 5. Anti-Sybil Measures

To prevent flood attacks:

1. **Proof of Work**: Light PoW required to join relay pool
2. **Blinded Tokens**: Relay admission via unlinkable tokens
3. **Rate Limiting**: Per-peer message rate caps
4. **Reputation Gates**: Minimum reputation to relay high-traffic rooms

```typescript
// Proof of work for relay admission
interface RelayAdmissionProof {
  peerId: string;
  timestamp: number;
  nonce: string;
  difficulty: number; // adjusts based on network load
}

function verifyAdmissionProof(proof: RelayAdmissionProof): boolean {
  const hash = sha256(proof.peerId + proof.timestamp + proof.nonce);
  return countLeadingZeros(hash) >= proof.difficulty;
}
```

## Privacy Enhancements

### Cover Traffic

To prevent traffic analysis:

```typescript
// Generate dummy messages indistinguishable from real traffic
function generateCoverTraffic(interval: number) {
  setInterval(() => {
    const dummy = createPaddedEnvelope(randomBytes(MSG_SIZE));
    sendToRandomCommittee(dummy);
  }, interval + randomJitter());
}
```

### Message Padding

All messages padded to fixed sizes:
- Small: 256 bytes (reactions, typing indicators)
- Medium: 4KB (text messages)
- Large: 64KB (media metadata)

### Mixnet Mode (High Security)

For sensitive rooms, optional mixnet routing:

```
Sender → Relay₁ → Relay₂ → Relay₃ → Recipient
         (decrypt   (decrypt   (decrypt
          layer 1)   layer 2)   layer 3)
```

Trade-off: +500-2000ms latency for strong anonymity.

## Bootstrap Infrastructure

Minimal required infrastructure:

| Component | Purpose | Data Exposure |
|-----------|---------|---------------|
| Bootstrap DHT | Initial peer discovery | Peer IDs only |
| STUN servers | NAT type detection | IP addresses |
| TURN fallback | Relay for symmetric NAT | Encrypted blobs |

**Privacy commitment**: Bootstrap nodes NEVER see:
- Message contents
- Room membership
- User identities
- Conversation metadata

## Failure Modes & Recovery

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Committee peer offline | Heartbeat timeout (30s) | Remaining peers absorb load; DHT announces replacement |
| All committee offline | Client-side timeout | Fallback to direct P2P or TURN |
| Malicious relay | Message verification fails | Blacklist + reputation penalty |
| Network partition | DHT inconsistency | Clients retry via bootstrap |

## Implementation Phases

### Phase 1: Hybrid Mode
- Central server as fallback
- P2P relay opt-in for early adopters
- Collect telemetry on relay performance

### Phase 2: P2P Primary
- P2P relay as default
- Central server for bootstrap only
- Committee rotation active

### Phase 3: Full Decentralization
- Decentralized bootstrap via DHT seeds
- Optional TURN through community-run nodes
- Incentivized relay via token economics (optional)

## Security Considerations

1. **End-to-End Encryption**: Signal Protocol unchanged; relays see only ciphertext
2. **Forward Secrecy**: Per-message keys derived via Double Ratchet
3. **Replay Protection**: Nonces prevent message replay
4. **Denial of Service**: PoW + reputation limit flooding
5. **Eclipse Attacks**: Diverse peer selection from multiple DHT regions

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Message latency (P2P direct) | <100ms | Same region |
| Message latency (relayed) | <300ms | Cross-region |
| Message latency (mixnet) | <2000ms | High security mode |
| Committee failover | <5s | Automatic |
| DHT lookup | <500ms | Peer discovery |
