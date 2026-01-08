# Rail Gun Hybrid Transport Architecture

## Overview

Rail Gun implements a censorship-resistant hybrid transport architecture that uses AWS infrastructure as the primary communication path for optimal performance, with automatic failover to a fully distributed peer-to-peer (P2P) network when centralized infrastructure becomes unavailable.

This document describes the architecture that makes Rail Gun "untouchable" - able to continue operating even if governments attempt to take down centralized servers.

## Design Philosophy

```
Normal Operation:          Takedown Scenario:
┌──────────────────┐       ┌──────────────────┐
│   AWS Primary    │       │   AWS Blocked    │
│  (Low latency)   │       │        ╳         │
│  (99.99% uptime) │       └────────┬─────────┘
└────────┬─────────┘                │
         │                   Automatic Failover
         ▼                          │
┌──────────────────┐       ┌────────▼─────────┐
│     Clients      │       │  P2P Network     │
└──────────────────┘       │  (Distributed)   │
                           │  (No SPOF)       │
                           └──────────────────┘
```

**Key Principles:**
1. **AWS-First**: Use AWS for best performance when available
2. **Automatic Failover**: Seamless switch to P2P when AWS unreachable
3. **No Single Point of Failure**: P2P mode requires no centralized infrastructure
4. **Capacity Sharing**: Each device contributes proportionally to network capacity
5. **E2EE Preserved**: End-to-end encryption regardless of transport path

## Architecture Components

### 1. Hybrid Transport Layer

**Location:** `apps/desktop/src/lib/p2p/hybrid-transport.ts`

The `HybridTransportService` manages transport mode selection and failover:

```typescript
// Transport modes
type TransportMode = 'aws' | 'hybrid' | 'p2p-only';

// Transport states
type TransportState =
  | 'connected-aws'        // Normal operation
  | 'connected-hybrid'     // Using both (redundancy)
  | 'connected-p2p'        // P2P fallback active
  | 'degraded'             // Partial connectivity
  | 'connecting'
  | 'disconnected';
```

**Features:**
- AWS health monitoring with automatic failover
- Device capability detection and advertisement
- Capacity-aware routing
- Store-and-forward for offline message delivery
- Event-driven architecture for state changes

### 2. DHT (Distributed Hash Table) Service

**Location:** `apps/desktop/src/lib/p2p/dht-service.ts`

Kademlia-based DHT for decentralized discovery without any central server:

```
┌─────────────────────────────────────────────────────────────┐
│                    DHT Key Types                            │
├─────────────────────────────────────────────────────────────┤
│  peer:       Peer presence announcements                    │
│  room:       Room/channel membership                        │
│  rendezvous: Store-and-forward pickup points               │
│  capability: Device capability advertisements               │
│  bootstrap:  Bootstrap node announcements                   │
└─────────────────────────────────────────────────────────────┘
```

**Operations:**
- `store(key, value)`: Publish data to DHT
- `get(key)`: Retrieve data from DHT
- `findNode(peerId)`: Find peer addresses
- `announceRoom(roomId)`: Announce presence in room
- `findRoomPeers(roomId)`: Find other participants

### 3. P2P Voice Service

**Location:** `apps/desktop/src/lib/p2p/voice-service.ts`

Voice/video that works without any servers:

```
Topology Selection:
─────────────────────────────────────────────────────────────
Participants │ Topology         │ Reason
─────────────────────────────────────────────────────────────
    1-4      │ Mesh             │ Low overhead, direct links
    5-12     │ SFU (single)     │ Best peer hosts for others
    13+      │ SFU (distributed)│ Multiple peer hosts share load
─────────────────────────────────────────────────────────────

Mesh Topology (≤4 participants):
    ┌─────┐
    │  A  │←──────────────┐
    └──┬──┘               │
       │                  │
       ▼                  ▼
    ┌─────┐           ┌─────┐
    │  B  │◄─────────►│  C  │
    └─────┘           └─────┘

SFU Topology (>4 participants):
              ┌─────────────┐
              │  SFU Host   │ ← Highest-capacity peer
              │  (Peer A)   │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
      ┌─────┐    ┌─────┐    ┌─────┐
      │  B  │    │  C  │    │  D  │
      └─────┘    └─────┘    └─────┘
```

### 4. Capacity-Aware Routing

Devices advertise their capabilities and the network routes traffic accordingly:

```typescript
interface DeviceCapabilities {
  deviceClass: DeviceClass;      // 'desktop-powerful' | 'mobile-wifi' etc.
  uploadBandwidth: number;       // bytes/sec
  downloadBandwidth: number;
  maxRelayConnections: number;
  maxRelayBandwidth: number;
  canActAsTurn: boolean;
  canStoreMessages: boolean;
  natType: NATType;
  batteryStatus?: BatteryStatus;
  availability: 'always' | 'when-active' | 'scheduled';
}
```

**Scoring:**
```
Device Class Score (30%):
- server:            30 points
- desktop-powerful:  25 points
- desktop-standard:  20 points
- laptop-plugged:    15 points
- laptop-battery:    10 points
- mobile-wifi:        5 points
- mobile-cellular:    0 points

Bandwidth Score (50%):
- 10+ Mbps:          50 points
- Scale linearly below

NAT Type Score (10%):
- open/full-cone:    10 points
- restricted:         6 points
- symmetric:          2 points

Availability Score (10%):
- always:            10 points
- when-active:        5 points
```

### 5. Store-and-Forward

Messages for offline recipients are stored across multiple peers:

```
Message Storage Flow:
─────────────────────────────────────────────────────────────
1. Sender creates message
2. Recipient offline detected
3. Message stored on K peers (k-replication)
4. Rendezvous key published to DHT
5. Recipient comes online
6. Recipient queries rendezvous point
7. Retrieves messages from storage peers
8. Storage peers delete delivered messages
─────────────────────────────────────────────────────────────

┌────────┐     Store(k=3)     ┌─────────┐
│ Sender │────────────────────►│ Peer A  │
└────────┘                    └─────────┘
                              ┌─────────┐
                      ───────►│ Peer B  │
                              └─────────┘
                              ┌─────────┐
                      ───────►│ Peer C  │
                              └─────────┘
                                   │
                         DHT Rendezvous
                                   │
                                   ▼
                              ┌──────────┐
                              │Recipient │
                              │ (later)  │
                              └──────────┘
```

## Failover Scenarios

### Scenario 1: DNS Blocking

```
Detection: AWS health check fails with DNS resolution error
Action:    Switch to P2P with Tor/I2P .onion addresses
Result:    Continue operation via overlay networks
```

### Scenario 2: IP Blocking

```
Detection: TCP connections timeout to known AWS IPs
Action:    Activate P2P with peer relay through non-blocked peers
Result:    Traffic routes around blocked addresses
```

### Scenario 3: Complete AWS Takedown

```
Detection: All AWS endpoints unreachable
Action:    Full P2P mode activation
           - DHT for discovery
           - Peer relay committees for messages
           - Peer-hosted SFU for voice
Result:    Service continues with no AWS dependency
```

### Scenario 4: Partial Network Partition

```
Detection: Some peers unreachable, some connected
Action:    Use connected peers as bridges
           - Message store-and-forward across partition
           - DHT queries via available peers
Result:    Eventually consistent delivery
```

## Bootstrap Resilience

Multiple bootstrap methods ensure initial peer discovery:

```
Priority Order:
─────────────────────────────────────────────────────────────
1. Cached peer list (from previous sessions)
2. Hardcoded bootstrap nodes (embedded in client)
3. Tor .onion bootstrap addresses
4. I2P bootstrap addresses
5. IPFS-hosted bootstrap manifest
6. DNS SRV records
─────────────────────────────────────────────────────────────

All methods tried IN PARALLEL for fastest connection.
```

## Privacy Considerations

### Cover Traffic
Random dummy messages sent periodically to prevent traffic analysis:
```typescript
// Generate cover traffic indistinguishable from real messages
coverTraffic: {
  enabled: true,
  intervalMs: 30000,      // Send every 30 seconds
  jitterMs: 10000,        // ±10 second randomization
}
```

### Message Padding
All messages padded to fixed size buckets:
```
Small:  256 bytes  (reactions, typing)
Medium: 4KB        (text messages)
Large:  64KB       (media metadata)
```

### Relay Opacity
P2P relays only see:
- Encrypted ciphertext (E2EE preserved)
- Room ID (for routing)
- Timestamp and TTL
- Size bucket

Relays NEVER see:
- Sender identity
- Recipient identity
- Message content
- Conversation metadata

## Configuration

### Transport Configuration

```typescript
const config: HybridTransportConfig = {
  preferredMode: 'aws',                    // Primary mode
  awsEndpoint: 'https://api.railgun.app',
  awsWebsocketEndpoint: 'wss://ws.railgun.app',
  awsHealthCheckInterval: 30000,           // 30 second checks
  awsLatencyThreshold: 2000,               // Switch if >2s latency
  awsFailureThreshold: 3,                  // Switch after 3 failures
  enableHybridRedundancy: false,           // Dual-path for high availability
  
  storeAndForward: {
    enabled: true,
    defaultTTL: 7 * 24 * 60 * 60 * 1000,  // 7 days
    redundancyFactor: 3,                   // Store on 3 peers
  },
  
  capacitySharing: {
    enabled: true,
    maxUploadShare: 0.5,                   // Use 50% of bandwidth
    maxRelayConnections: 20,
  },
};
```

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Hybrid Transport Types | ✅ Complete | `hybrid-transport.types.ts` |
| Hybrid Transport Service | ✅ Complete | AWS failover, capacity routing |
| DHT Service | ✅ Complete | Kademlia-like peer discovery |
| P2P Voice Service | ✅ Complete | Mesh and SFU topologies |
| Bootstrap Service | ✅ Complete | Multi-transport discovery |
| Bootstrap Nodes Config | ✅ Complete | `bootstrap-nodes.ts` - Multi-jurisdiction |
| Relay Service | ✅ Complete | Committee-based relay |
| Crypto Utils | ✅ Complete | `crypto-utils.ts` - Ed25519, SHA-256 |
| Signature Verification | ✅ Complete | Ed25519 verification for DHT/bootstrap |
| libp2p Transport | ✅ Complete | `libp2p-transport.ts` - Real P2P layer |
| Peer-hosted TURN | ✅ Complete | `peer-turn.ts` - Decentralized relay |
| Integration API | ✅ Complete | `integration.ts` - High-level API |
| Production Tests | ✅ Complete | `__tests__/hybrid-transport.test.ts` |

### Files Created

```
apps/desktop/src/lib/p2p/
├── hybrid-transport.ts      # Main transport service (~1100 lines)
├── dht-service.ts           # Kademlia DHT (~900 lines)
├── voice-service.ts         # P2P voice/video (~870 lines)
├── bootstrap-nodes.ts       # Production bootstrap config (~230 lines)
├── libp2p-transport.ts      # libp2p integration (~660 lines)
├── crypto-utils.ts          # Cryptographic utilities (~310 lines)
├── peer-turn.ts             # Peer-hosted TURN (~600 lines)
├── integration.ts           # High-level API (~400 lines)
├── index.ts                 # Module exports
└── __tests__/
    └── hybrid-transport.test.ts  # Production test harness (~600 lines)

packages/shared/src/types/
└── hybrid-transport.types.ts  # Type definitions
```

## Security Considerations

1. **Bootstrap List Signing**: Bootstrap lists must be signed to prevent poisoning
2. **Peer Reputation**: Track peer behavior to prevent Sybil attacks
3. **Rate Limiting**: Per-peer message rate caps
4. **Proof of Work**: Light PoW for relay admission during attacks
5. **Key Rotation**: Regular rotation of signing keys

## Deployment

### Phase 1: AWS Primary (Current)
- AWS handles all traffic
- P2P layer initialized but dormant
- Health monitoring active

### Phase 2: Hybrid Testing
- Enable hybrid mode for subset of users
- Test failover scenarios
- Measure P2P performance

### Phase 3: Full Resilience
- Deploy bootstrap nodes across jurisdictions
- Enable automatic failover for all users
- Continuous P2P network health monitoring

## Related Documentation

- [P2P Relay Architecture](../docs-archive/P2P_RELAY_ARCHITECTURE.md)
- [Takedown Resilience](../docs-archive/TAKEDOWN_RESILIENCE.md)
- [Bootstrap Service](./bootstrap-service.ts)
- [Relay Service](./relay-service.ts)
