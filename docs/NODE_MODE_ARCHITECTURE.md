# Railgun Node Mode - System Architecture Document

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Architecture Design Phase

---

## 1. Executive Summary

Node Mode transforms Railgun from a client-server messaging app into a **decentralized mesh network** capable of operating without internet connectivity. When enabled, a device becomes a "node" that can:

1. **Store and forward** messages for other users
2. **Relay** messages through multi-hop paths
3. **Operate offline** using local network discovery
4. **Sync** when internet connectivity returns

This enables communication in:
- Remote areas without cellular coverage
- Disaster scenarios where infrastructure is down
- High-security environments requiring air-gapped operation
- Privacy-focused deployments avoiding centralized servers

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          RAILGUN NODE MODE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │   Node A     │◄──►│   Node B     │◄──►│   Node C     │              │
│  │  (Offline)   │    │  (Offline)   │    │  (Gateway)   │◄───► Internet │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│         │                   │                   │                        │
│         │    Bluetooth/     │    Wi-Fi          │                        │
│         │    Wi-Fi Direct   │    Direct         │                        │
│         ▼                   ▼                   ▼                        │
│  ┌─────────────────────────────────────────────────────┐               │
│  │              Local Transport Layer                   │               │
│  │  • Bluetooth LE (iOS/Android)                       │               │
│  │  • Wi-Fi Direct/AWDL (iOS)                          │               │
│  │  • Wi-Fi P2P (Android)                              │               │
│  │  • Local Network (mDNS/Bonjour)                     │               │
│  └─────────────────────────────────────────────────────┘               │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────┐               │
│  │              Mesh Routing Layer                      │               │
│  │  • Epidemic routing for small networks              │               │
│  │  • PROPHET routing for larger networks              │               │
│  │  • Geographic hints when available                  │               │
│  └─────────────────────────────────────────────────────┘               │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────┐               │
│  │              Message Store Layer                     │               │
│  │  • SQLite message store (encrypted at rest)         │               │
│  │  • TTL-based expiration                             │               │
│  │  • Priority queuing                                  │               │
│  │  • Duplicate detection (bloom filters)              │               │
│  └─────────────────────────────────────────────────────┘               │
│                            │                                            │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────┐               │
│  │              Cryptographic Layer                     │               │
│  │  • Existing E2EE (unchanged)                        │               │
│  │  • Onion routing for relay privacy                  │               │
│  │  • Node identity via Ed25519                        │               │
│  └─────────────────────────────────────────────────────┘               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Node Identity

Each node has a unique identity separate from user identity:

```
Node Identity:
├── node_id: Ed25519 public key (32 bytes)
├── node_private_key: Ed25519 private key (stored securely)
├── user_id: Optional association with Railgun user
├── capabilities: Bitmask of supported features
│   ├── CAN_RELAY (0x01)
│   ├── CAN_STORE (0x02)
│   ├── HAS_INTERNET (0x04)
│   ├── HIGH_BANDWIDTH (0x08)
│   └── HIGH_STORAGE (0x10)
├── last_seen: Timestamp
└── reputation_score: Float (0.0 - 1.0)
```

### 3.2 Message Bundle Format

Messages in Node Mode are wrapped in a "bundle" for DTN transport:

```
Bundle Structure:
├── header (48 bytes)
│   ├── version: u8
│   ├── flags: u8
│   ├── priority: u8 (0=bulk, 1=normal, 2=urgent, 3=critical)
│   ├── hop_count: u8
│   ├── max_hops: u8
│   ├── reserved: [u8; 3]
│   ├── bundle_id: [u8; 16] (UUID)
│   ├── created_at: u64 (unix timestamp ms)
│   ├── expires_at: u64 (unix timestamp ms)
│   └── payload_length: u32
├── routing_info (variable)
│   ├── source_node: [u8; 32]
│   ├── destination_type: u8 (user_id | node_id | broadcast)
│   ├── destination: [u8; 32]
│   └── geographic_hint: Optional<GeoHash>
├── payload (encrypted)
│   └── Original Railgun EncryptedEnvelope
└── signature: [u8; 64] (Ed25519 signature of header + routing + payload)
```

### 3.3 Transport Adapters

#### 3.3.1 Bluetooth LE Adapter

```
iOS: Core Bluetooth
├── Peripheral Mode: Advertise as Railgun node
├── Central Mode: Scan for nearby nodes
├── Service UUID: Custom Railgun UUID
├── Characteristics:
│   ├── Node Announce (read)
│   ├── Bundle Transfer (write + notify)
│   └── Peer Discovery (read + notify)
└── MTU: Negotiated (typically 185-512 bytes)

Android: Bluetooth LE
├── GATT Server: Advertise node
├── GATT Client: Connect to peers
├── Same service/characteristic UUIDs
└── Background scanning with filters
```

#### 3.3.2 Wi-Fi Direct Adapter

```
iOS: Multipeer Connectivity / AWDL
├── MCNearbyServiceBrowser
├── MCNearbyServiceAdvertiser
├── MCSession for data transfer
└── Automatic peer discovery

Android: Wi-Fi P2P (Wi-Fi Direct)
├── WifiP2pManager
├── Service discovery via DNS-SD
├── Group formation
└── Socket-based data transfer
```

#### 3.3.3 Local Network Adapter

```
Both platforms:
├── mDNS/Bonjour discovery
│   └── _railgun._tcp service
├── UDP broadcast for initial discovery
├── TCP connections for reliable transfer
└── TLS 1.3 with node certificates
```

### 3.4 Message Store

Each node maintains a local store for:

1. **Own messages** - Messages addressed to this node's user
2. **Relay messages** - Messages being forwarded for others
3. **Routing table** - Known nodes and their capabilities

```
SQLite Schema:

-- Stored bundles
CREATE TABLE bundles (
    id TEXT PRIMARY KEY,           -- bundle_id
    source_node BLOB NOT NULL,     -- 32-byte node_id
    destination BLOB NOT NULL,     -- user_id or node_id
    destination_type INTEGER,      -- 0=user, 1=node, 2=broadcast
    priority INTEGER DEFAULT 1,
    hop_count INTEGER DEFAULT 0,
    max_hops INTEGER DEFAULT 10,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    payload BLOB NOT NULL,         -- encrypted bundle payload
    signature BLOB NOT NULL,
    delivered INTEGER DEFAULT 0,
    delivery_attempts INTEGER DEFAULT 0
);

-- Known nodes
CREATE TABLE nodes (
    node_id BLOB PRIMARY KEY,
    user_id TEXT,                  -- associated user, if known
    capabilities INTEGER,
    first_seen INTEGER,
    last_seen INTEGER,
    last_location_hash TEXT,       -- geohash, if available
    reputation REAL DEFAULT 0.5,
    times_seen INTEGER DEFAULT 1,
    bytes_relayed INTEGER DEFAULT 0
);

-- Bloom filter for duplicate detection
CREATE TABLE seen_bundles (
    filter_id INTEGER PRIMARY KEY,
    bloom_filter BLOB,             -- serialized bloom filter
    created_at INTEGER,
    entry_count INTEGER
);

-- Routing hints
CREATE TABLE routing_hints (
    destination BLOB,
    next_hop BLOB,
    hops_away INTEGER,
    last_updated INTEGER,
    confidence REAL
);
```

### 3.5 Routing Algorithms

#### 3.5.1 Epidemic Routing (Small Networks, <20 nodes)

```
On receiving bundle B:
1. Check bloom filter - if seen, discard
2. Add to bloom filter
3. If B.destination == my_user_id:
   a. Deliver to application layer
   b. Mark as delivered
4. If B.hop_count >= B.max_hops:
   a. Discard (TTL exceeded)
5. If B.expires_at < now():
   a. Discard (expired)
6. Store B locally
7. On peer connection:
   a. Exchange bloom filters
   b. Send bundles peer hasn't seen
```

#### 3.5.2 PROPHET Routing (Larger Networks)

Probabilistic Routing Protocol using History of Encounters and Transitivity:

```
Delivery Predictability P(a,b) = probability node A can deliver to B

On encounter with node B:
1. Update P(A,B) = P(A,B)_old + (1 - P(A,B)_old) × P_encounter
   where P_encounter = 0.75 (configurable)

2. Age all predictabilities:
   P(A,*) = P(A,*) × γ^k
   where γ = 0.98, k = time units since last aging

3. Transitivity update for each node C:
   P(A,C) = P(A,C)_old + (1 - P(A,C)_old) × P(A,B) × P(B,C) × β
   where β = 0.25 (transitivity scaling factor)

Forward bundle to B if:
  P(B, destination) > P(A, destination)
  OR B.has_internet AND destination.requires_internet
```

### 3.6 Gateway Mode

Nodes with internet connectivity act as **gateways** between the mesh and Railgun servers:

```
Gateway Operations:

1. Uplink (mesh → server):
   - Collect bundles destined for online users
   - Batch and upload via standard Railgun API
   - Receive delivery confirmations
   - Propagate confirmations back to mesh

2. Downlink (server → mesh):
   - Poll server for messages to offline users
   - Download and wrap in bundles
   - Inject into local mesh
   
3. Key synchronization:
   - Fetch pre-key bundles for offline users
   - Cache for mesh distribution
```

---

## 4. State Machine

### 4.1 Node States

```
┌─────────────┐
│   IDLE      │ ◄─────────────────────────────┐
│             │                                │
└──────┬──────┘                                │
       │ enable_node_mode()                    │
       ▼                                       │
┌─────────────┐                                │
│ INITIALIZING│                                │
│             │                                │
└──────┬──────┘                                │
       │ keys_loaded, transports_ready         │
       ▼                                       │
┌─────────────┐     peer_found      ┌─────────────┐
│ DISCOVERING │ ──────────────────► │ CONNECTING  │
│             │ ◄────────────────── │             │
└──────┬──────┘  connection_failed  └──────┬──────┘
       │                                   │
       │ timeout, no_peers                 │ connected
       ▼                                   ▼
┌─────────────┐                    ┌─────────────┐
│   STANDBY   │                    │   ACTIVE    │
│ (low power) │ ◄────────────────► │  (syncing)  │
└─────────────┘   no_active_peers  └──────┬──────┘
       │                                   │
       │ disable_node_mode()               │
       ▼                                   │
┌─────────────┐                            │
│  SHUTDOWN   │ ◄──────────────────────────┘
│             │   disable_node_mode()
└─────────────┘
```

### 4.2 Sync State Machine (per peer connection)

```
┌────────────────┐
│ HANDSHAKE      │ Exchange node identities, capabilities
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ BLOOM_EXCHANGE │ Exchange bloom filters of known bundles
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ DELTA_SYNC     │ Transfer bundles peer doesn't have
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ ROUTING_UPDATE │ Exchange routing table hints
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ IDLE           │ Maintain connection, periodic sync
└────────────────┘
```

---

## 5. Platform-Specific Considerations

### 5.1 iOS Constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| Background execution limited to ~30s | Can't maintain persistent connections | Use BGTaskScheduler, significant location changes |
| Bluetooth LE MTU ~185 bytes | Large messages need chunking | Implement fragmentation protocol |
| No raw Wi-Fi access | Can't do ad-hoc networks | Use Multipeer Connectivity framework |
| App must be in foreground for full BLE | Limited background discovery | Use BLE beacons, iBeacon regions |

### 5.2 Android Constraints

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| Doze mode limits background | Reduced sync frequency | Use high-priority FCM, exemptions |
| Battery optimization kills services | Lost connections | Foreground service with notification |
| Wi-Fi Direct requires location permission | UX friction | Clear explanation, graceful fallback |
| Manufacturer-specific restrictions | Inconsistent behavior | Device-specific workarounds |

### 5.3 Desktop Considerations

| Aspect | Approach |
|--------|----------|
| Always-on capability | Can act as reliable relay node |
| Network access | Full TCP/UDP, can be gateway |
| Storage | Generous storage for message caching |
| Power | Not a concern, can do heavy lifting |

---

## 6. Security Considerations

### 6.1 Trust Model

```
Trust Hierarchy:
1. Own device (fully trusted)
2. Known contacts (messages are E2EE anyway)
3. Unknown nodes (untrusted relays)

Relay nodes:
- Cannot read message contents (E2EE)
- CAN see: source node, destination user/node, timing, size
- CANNOT see: message content, sender user identity (with onion routing)
```

### 6.2 Onion Routing (Optional, for high-privacy mode)

```
For relay privacy, wrap bundle in onion layers:

Original: Bundle(A → D, payload)

With onion routing through B, C:
Layer 3: Encrypt(key_D, Bundle(payload))
Layer 2: Encrypt(key_C, "forward to D" + Layer3)
Layer 1: Encrypt(key_B, "forward to C" + Layer2)

Each relay peels one layer, learns only next hop.
```

### 6.3 Sybil Attack Prevention

```
Defenses:
1. Rate limiting per node_id
2. Proof-of-work for bundle creation (optional)
3. Reputation system based on successful deliveries
4. Social graph verification (only relay for N-hop contacts)
```

### 6.4 Denial of Service Prevention

```
Defenses:
1. Bundle size limits (default 64KB)
2. Per-node storage quotas
3. Priority queuing (own messages > contacts > unknown)
4. TTL enforcement
5. Bloom filter for seen bundles (reject duplicates)
```

---

## 7. Configuration Options

```swift
struct NodeModeConfig {
    // Enable/disable
    var enabled: Bool = false
    
    // Role
    var canRelay: Bool = true        // Relay messages for others
    var canStore: Bool = true        // Store messages for later delivery
    var actAsGateway: Bool = true    // Bridge to internet when available
    
    // Storage
    var maxStorageMB: Int = 100      // Max storage for relay messages
    var maxBundleSizeKB: Int = 64    // Max single bundle size
    var defaultTTLHours: Int = 72    // Default message TTL
    var maxTTLHours: Int = 168       // Maximum TTL (1 week)
    
    // Network
    var enableBluetooth: Bool = true
    var enableWiFiDirect: Bool = true
    var enableLocalNetwork: Bool = true
    var maxPeers: Int = 8            // Max simultaneous connections
    
    // Routing
    var routingAlgorithm: RoutingAlgorithm = .automatic // .epidemic, .prophet, .automatic
    var maxHops: Int = 10
    
    // Privacy
    var enableOnionRouting: Bool = false
    var hideNodeIdentity: Bool = false // Rotate node_id periodically
    
    // Battery
    var backgroundSyncInterval: Int = 300 // seconds
    var lowPowerMode: Bool = false   // Reduce scan frequency
}
```

---

## 8. API Integration

### 8.1 New REST Endpoints (Gateway Operations)

```
POST /api/v1/mesh/upload
  - Upload bundles from mesh to server
  - Body: { bundles: [Bundle], node_id: string, signature: string }
  - Returns: { accepted: [bundle_id], rejected: [{ id, reason }] }

GET /api/v1/mesh/download?node_id={}&signature={}
  - Download messages destined for mesh users
  - Returns: { bundles: [Bundle], users_online: [user_id] }

POST /api/v1/mesh/ack
  - Acknowledge delivery confirmations
  - Body: { delivered: [{ bundle_id, delivered_at }] }

GET /api/v1/mesh/keys?user_ids=[]
  - Batch fetch pre-key bundles for offline users
  - Returns: { keys: { user_id: PreKeyBundle } }
```

### 8.2 WebSocket Events (Gateway Real-time)

```
// Server → Gateway
{
  "type": "mesh:message",
  "bundle": { ... },
  "destination_user": "user_id"
}

// Gateway → Server
{
  "type": "mesh:delivered",
  "bundle_id": "...",
  "delivered_at": 1234567890
}
```

---

## 9. Metrics and Monitoring

### 9.1 Local Metrics (per node)

```
NodeMetrics {
    // Network
    peers_connected: Int
    peers_discovered: Int
    bytes_sent: Int
    bytes_received: Int
    
    // Messages
    bundles_stored: Int
    bundles_relayed: Int
    bundles_delivered: Int
    bundles_expired: Int
    
    // Storage
    storage_used_bytes: Int
    oldest_bundle_age: Duration
    
    // Battery
    battery_consumed_percent: Float
}
```

### 9.2 Network Metrics (aggregated at gateway)

```
MeshMetrics {
    active_nodes: Int
    total_bundles_in_flight: Int
    average_delivery_time: Duration
    delivery_success_rate: Float
    network_partitions: Int
}
```

---

## 10. Future Extensions

1. **Voice Messages** - Compressed audio bundles with priority routing
2. **Location Sharing** - Encrypted location updates for trusted contacts
3. **Group Mesh** - Efficient multicast within mesh network
4. **Incentive Layer** - Optional token rewards for relay nodes
5. **Hardware Nodes** - Dedicated Railgun relay hardware (Raspberry Pi, etc.)

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| Bundle | DTN message container with routing metadata |
| DTN | Delay-Tolerant Network |
| Gateway | Node with internet connectivity bridging mesh ↔ server |
| Mesh | Collection of nodes communicating peer-to-peer |
| Node | Device running Railgun with Node Mode enabled |
| PROPHET | Probabilistic Routing Protocol using History of Encounters |
| Relay | Forwarding messages for other users |
| TTL | Time-To-Live, message expiration |

---

## Appendix B: References

1. RFC 4838 - Delay-Tolerant Networking Architecture
2. RFC 5050 - Bundle Protocol Specification
3. PROPHET: Probabilistic Routing Protocol for Intermittently Connected Networks
4. Epidemic Routing for Partially-Connected Ad Hoc Networks
5. Apple Multipeer Connectivity Framework
6. Android Wi-Fi P2P (Wi-Fi Direct)
