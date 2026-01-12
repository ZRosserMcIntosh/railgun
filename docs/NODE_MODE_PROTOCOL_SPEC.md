# Railgun Node Mode - Protocol Specification v1.0

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Draft

---

## 1. Overview

This document specifies the wire protocols, message formats, and routing behaviors for Railgun Node Mode mesh networking.

---

## 2. Bundle Format

### 2.1 Binary Bundle Structure

All multi-byte integers are **big-endian** (network byte order).

```
+------------------+------------------+------------------+------------------+
|      Byte 0      |      Byte 1      |      Byte 2      |      Byte 3      |
+------------------+------------------+------------------+------------------+
|    Version (1)   |    Flags (1)     |   Priority (1)   |  Hop Count (1)   |  Header
+------------------+------------------+------------------+------------------+
|   Max Hops (1)   |             Reserved (3 bytes)                         |
+------------------+------------------+------------------+------------------+
|                                                                           |
|                          Bundle ID (16 bytes, UUID)                       |
|                                                                           |
+------------------+------------------+------------------+------------------+
|                                                                           |
|                      Created At (8 bytes, uint64 ms)                      |
|                                                                           |
+------------------+------------------+------------------+------------------+
|                                                                           |
|                      Expires At (8 bytes, uint64 ms)                      |
|                                                                           |
+------------------+------------------+------------------+------------------+
|                      Payload Length (4 bytes, uint32)                     |
+------------------+------------------+------------------+------------------+
|                                                                           |
|                      Source Node ID (32 bytes, Ed25519 pubkey)            |
|                                                                           |  Routing
+------------------+------------------+------------------+------------------+
| Dest Type (1)    |                                                        |
+------------------+                                                        |
|                      Destination (32 bytes, user_id or node_id)           |
|                                                                           |
+------------------+------------------+------------------+------------------+
|  Geo Present (1) |      Geohash (0 or 8 bytes, optional)                  |
+------------------+------------------+------------------+------------------+
|                                                                           |
|                      Payload (variable length, encrypted)                  |  Payload
|                                                                           |
+------------------+------------------+------------------+------------------+
|                                                                           |
|                      Signature (64 bytes, Ed25519)                        |  Signature
|                                                                           |
+------------------+------------------+------------------+------------------+
```

### 2.2 Field Definitions

#### Version (1 byte)
```
0x01 = Version 1 (this specification)
```

#### Flags (1 byte)
```
Bit 0: ACK_REQUESTED    - Sender wants delivery confirmation
Bit 1: IS_ACK           - This bundle is a delivery acknowledgment
Bit 2: IS_FRAGMENT      - This is a fragment of a larger bundle
Bit 3: MORE_FRAGMENTS   - More fragments follow
Bit 4: ONION_WRAPPED    - Payload is onion-encrypted
Bit 5: COMPRESSED       - Payload is compressed (zstd)
Bit 6-7: Reserved
```

#### Priority (1 byte)
```
0x00 = BULK      - Background sync, can be delayed indefinitely
0x01 = NORMAL    - Standard message priority
0x02 = URGENT    - Time-sensitive, prefer direct routes
0x03 = CRITICAL  - Emergency, bypass storage quotas
```

#### Destination Type (1 byte)
```
0x00 = USER_ID     - Destination is a Railgun user ID (SHA-256 of username)
0x01 = NODE_ID     - Destination is a specific node's public key
0x02 = BROADCAST   - Deliver to all reachable nodes
0x03 = MULTICAST   - Deliver to nodes matching a group ID
```

### 2.3 Bundle ID Generation

```
bundle_id = UUID v4 (random)

For deduplication, derive:
bundle_hash = SHA-256(bundle_id || source_node || created_at)[0:16]
```

### 2.4 Signature Computation

```
signature_input = header_bytes || routing_bytes || payload_bytes
signature = Ed25519_Sign(node_private_key, signature_input)
```

Verification:
```
Ed25519_Verify(source_node_pubkey, signature_input, signature) == true
```

---

## 3. Fragmentation Protocol

For bundles exceeding transport MTU (typically 512 bytes for BLE):

### 3.1 Fragment Header (prepended to each fragment)

```
+------------------+------------------+------------------+------------------+
|                      Original Bundle ID (16 bytes)                        |
+------------------+------------------+------------------+------------------+
|    Fragment Index (2 bytes)         |    Total Fragments (2 bytes)        |
+------------------+------------------+------------------+------------------+
|                      Fragment Payload (variable)                          |
+------------------+------------------+------------------+------------------+
```

### 3.2 Fragmentation Rules

```
MAX_FRAGMENT_PAYLOAD = transport_mtu - 20  // 20 bytes for fragment header

fragments = ceil(bundle_size / MAX_FRAGMENT_PAYLOAD)

for i in 0..fragments:
    fragment.bundle_id = original.bundle_id
    fragment.index = i
    fragment.total = fragments
    fragment.payload = original_bytes[i*MAX_FRAGMENT_PAYLOAD : (i+1)*MAX_FRAGMENT_PAYLOAD]
```

### 3.3 Reassembly

```
reassembly_buffer[bundle_id] = {
    fragments: Map<index, payload>,
    total: total_fragments,
    received_at: timestamp,
    timeout: 60 seconds
}

On receiving fragment:
1. Add to reassembly_buffer[bundle_id].fragments[index]
2. If fragments.size == total:
   a. Concatenate fragments in order
   b. Parse as complete bundle
   c. Verify signature
   d. Process bundle
3. If timeout exceeded:
   a. Discard partial bundle
```

---

## 4. Transport Protocols

### 4.1 Bluetooth LE Protocol

#### Service Definition
```
Service UUID: 7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D

Characteristics:
- Node Announce (Read, Notify)
  UUID: 7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5E
  Value: NodeAnnounce structure

- Bundle Transfer (Write, Notify)  
  UUID: 7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5F
  Value: Fragment or control message

- Sync Control (Read, Write, Notify)
  UUID: 7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C60
  Value: Sync protocol messages
```

#### Node Announce Structure
```
+------------------+------------------+------------------+------------------+
|    Protocol Version (1)             |    Capabilities (2 bytes)           |
+------------------+------------------+------------------+------------------+
|                      Node ID (32 bytes)                                   |
+------------------+------------------+------------------+------------------+
|    Bundles Available (4 bytes)      |    Storage Free KB (4 bytes)        |
+------------------+------------------+------------------+------------------+
```

#### Transfer Protocol
```
1. Central subscribes to Bundle Transfer notify
2. Central writes to Sync Control: { type: SYNC_REQUEST }
3. Peripheral notifies via Sync Control: { type: SYNC_READY, bloom_filter_size }
4. Exchange bloom filters via Bundle Transfer
5. Each side sends bundles the other needs
6. Acknowledge with: { type: BUNDLE_ACK, bundle_id }
```

### 4.2 Wi-Fi Direct Protocol

#### Service Discovery (DNS-SD)
```
Service Type: _railgun._tcp
Service Name: railgun-node-{short_node_id}

TXT Records:
  v=1                    // Protocol version
  cap=0x1F               // Capabilities bitmask
  bc=42                  // Bundle count available
  sf=10240               // Storage free (KB)
```

#### TCP Transfer Protocol
```
Port: 7847 (RAIL on phone keypad)

Connection:
1. TLS 1.3 handshake with node certificate
2. Exchange NodeHandshake messages
3. Enter sync loop

Message Framing:
+------------------+------------------+------------------+------------------+
|    Message Type (1)                 |    Payload Length (3 bytes)         |
+------------------+------------------+------------------+------------------+
|                      Payload (variable)                                   |
+------------------+------------------+------------------+------------------+
```

#### Message Types
```
0x01 = HANDSHAKE
0x02 = BLOOM_FILTER
0x03 = BUNDLE
0x04 = BUNDLE_REQUEST
0x05 = ACK
0x06 = NACK
0x07 = ROUTING_UPDATE
0x08 = PING
0x09 = PONG
0x0A = DISCONNECT
```

### 4.3 Local Network Protocol (mDNS + TCP)

#### mDNS Advertisement
```
Service: _railgun._tcp.local.
Host: railgun-{short_node_id}.local.
Port: 7847
TXT: Same as Wi-Fi Direct
```

#### Protocol
Same as Wi-Fi Direct TCP protocol, but over LAN without group formation.

---

## 5. Sync Protocol

### 5.1 Handshake

```
NodeHandshake {
    version: u8,
    node_id: [u8; 32],
    capabilities: u16,
    timestamp: u64,
    nonce: [u8; 16],
    signature: [u8; 64]  // Sign(version || node_id || timestamp || nonce)
}
```

### 5.2 Bloom Filter Exchange

```
BloomFilterMessage {
    filter_type: u8,       // 0=bundle_ids, 1=known_nodes
    num_entries: u32,
    false_positive_rate: f32,  // Target FPR (typically 0.01)
    filter_data: Vec<u8>   // Serialized bloom filter
}
```

Bloom filter parameters:
```
For n entries with FPR p:
  m = -n * ln(p) / (ln(2)^2)  // bits
  k = (m/n) * ln(2)            // hash functions

Example: n=10000, p=0.01
  m ≈ 95851 bits ≈ 12KB
  k ≈ 7 hash functions
```

### 5.3 Bundle Request/Response

```
BundleRequest {
    bundle_ids: Vec<[u8; 16]>,  // Request specific bundles
    max_bundles: u32,           // Or request up to N bundles
    priority_min: u8,           // Minimum priority to send
    destination_filter: Option<[u8; 32]>  // Only for this destination
}

BundleResponse {
    bundles: Vec<Bundle>,
    has_more: bool,
    next_offset: u32
}
```

### 5.4 Routing Table Exchange

```
RoutingUpdate {
    entries: Vec<RoutingEntry>
}

RoutingEntry {
    destination: [u8; 32],      // User ID or Node ID
    destination_type: u8,
    next_hop: [u8; 32],         // Node to forward to
    hops_away: u8,
    predictability: f32,        // PROPHET P(A,B) value
    last_updated: u64,
    confidence: f32             // How reliable is this info
}
```

---

## 6. Routing Protocols

### 6.1 Epidemic Routing

Simple flood-based routing for small networks (<20 nodes).

```
Algorithm:

on_receive_bundle(bundle):
    if seen_filter.contains(bundle.id):
        return  // Already processed
    
    seen_filter.add(bundle.id)
    
    if bundle.destination == my_user_id:
        deliver_to_app(bundle)
        return
    
    if bundle.hop_count >= bundle.max_hops:
        return  // TTL exceeded
    
    if bundle.expires_at < now():
        return  // Expired
    
    store_bundle(bundle)

on_peer_connected(peer):
    // Exchange bloom filters
    my_filter = seen_filter.serialize()
    peer_filter = exchange(my_filter)
    
    // Send bundles peer hasn't seen
    for bundle in stored_bundles:
        if not peer_filter.contains(bundle.id):
            bundle.hop_count += 1
            send_to_peer(peer, bundle)
```

### 6.2 PROPHET Routing

Probabilistic routing using delivery predictability.

```
Constants:
    P_ENCOUNTER = 0.75    // Predictability increment on encounter
    GAMMA = 0.98          // Aging factor
    BETA = 0.25           // Transitivity factor
    AGING_INTERVAL = 60s  // How often to age predictabilities

State:
    predictabilities: Map<(node_id, destination), float>
    last_aged: timestamp

on_encounter(peer_node_id):
    // Update direct predictability
    for dest in all_known_destinations:
        p_old = predictabilities[(my_node_id, dest)]
        
        // Direct encounter update
        if dest == peer_node_id:
            p_new = p_old + (1 - p_old) * P_ENCOUNTER
            predictabilities[(my_node_id, dest)] = p_new
        
        // Transitivity update
        p_peer = peer.predictabilities[(peer_node_id, dest)]
        p_trans = p_old + (1 - p_old) * predictabilities[(my_node_id, peer_node_id)] * p_peer * BETA
        predictabilities[(my_node_id, dest)] = max(p_new, p_trans)

on_aging_tick():
    elapsed = (now() - last_aged) / AGING_INTERVAL
    for key in predictabilities:
        predictabilities[key] *= pow(GAMMA, elapsed)
    last_aged = now()

should_forward(bundle, peer):
    my_p = predictabilities[(my_node_id, bundle.destination)]
    peer_p = peer.predictabilities[(peer.node_id, bundle.destination)]
    
    // Forward if peer has better chance of delivery
    return peer_p > my_p
    
    // Or if peer has internet and destination is online user
    // return peer.has_internet AND destination.is_online_user
```

### 6.3 Hybrid Routing Selection

```
select_routing_algorithm(network_size):
    if network_size <= 20:
        return EPIDEMIC
    else:
        return PROPHET
        
estimate_network_size():
    // Count unique nodes seen in last hour
    return nodes.filter(n => n.last_seen > now() - 1h).count()
```

---

## 7. TTL and Expiration

### 7.1 TTL Calculation

```
default_ttl = config.default_ttl_hours * 3600 * 1000  // in milliseconds

expires_at = created_at + ttl

// Priority affects TTL
priority_multiplier = [0.5, 1.0, 2.0, 4.0]  // BULK, NORMAL, URGENT, CRITICAL
effective_ttl = default_ttl * priority_multiplier[priority]

// Cap at max TTL
effective_ttl = min(effective_ttl, config.max_ttl_hours * 3600 * 1000)
```

### 7.2 Expiration Handling

```
background_cleanup():
    every 5 minutes:
        for bundle in stored_bundles:
            if bundle.expires_at < now():
                delete_bundle(bundle)
                emit_event(BUNDLE_EXPIRED, bundle.id)
```

### 7.3 Storage Quota Management

```
on_store_bundle(bundle):
    while storage_used + bundle.size > config.max_storage:
        // Evict lowest priority, oldest bundles first
        victim = stored_bundles
            .sort_by(b => (b.priority, -b.created_at))
            .first()
        
        if victim.priority >= bundle.priority and victim.created_at < bundle.created_at:
            // Don't evict higher priority bundles
            return STORAGE_FULL
        
        delete_bundle(victim)
    
    store(bundle)
```

---

## 8. Acknowledgment Protocol

### 8.1 Delivery Acknowledgment Bundle

When ACK_REQUESTED flag is set:

```
AckBundle {
    version: 0x01,
    flags: IS_ACK,
    priority: URGENT,
    bundle_id: new_uuid(),
    created_at: now(),
    expires_at: now() + 24h,
    source_node: my_node_id,
    destination_type: NODE_ID,
    destination: original_bundle.source_node,
    payload: AckPayload {
        original_bundle_id: [u8; 16],
        delivered_at: u64,
        recipient_node_id: [u8; 32]
    }
}
```

### 8.2 Acknowledgment Propagation

```
on_deliver_bundle(bundle):
    if bundle.flags & ACK_REQUESTED:
        ack = create_ack_bundle(bundle)
        store_bundle(ack)
        
        // Try direct delivery if possible
        if peer_connected(bundle.source_node):
            send_to_peer(bundle.source_node, ack)
```

---

## 9. Security Protocols

### 9.1 Node Certificate

```
NodeCertificate {
    node_id: [u8; 32],
    created_at: u64,
    expires_at: u64,
    capabilities: u16,
    user_binding: Option<UserBinding>,  // Optional binding to Railgun user
    self_signature: [u8; 64]
}

UserBinding {
    user_id: [u8; 32],
    user_signature: [u8; 64]  // User's identity key signs node_id
}
```

### 9.2 Peer Authentication

```
TLS 1.3 with:
- Server certificate: Node certificate (self-signed)
- Client certificate: Node certificate (self-signed)
- Cipher suites: TLS_CHACHA20_POLY1305_SHA256, TLS_AES_256_GCM_SHA384
- No CA verification (peer-to-peer trust)
- Verify node_id matches certificate
```

### 9.3 Rate Limiting

```
RateLimits {
    bundles_per_minute_per_peer: 100,
    bytes_per_minute_per_peer: 1_000_000,  // 1MB/min
    connections_per_minute: 10,
    bloom_filters_per_minute: 5
}

on_receive_from_peer(peer, data):
    if rate_limiter.exceeds(peer, data.size):
        disconnect(peer, RATE_LIMIT_EXCEEDED)
```

---

## 10. Error Codes

```
enum ErrorCode {
    SUCCESS = 0x00,
    INVALID_VERSION = 0x01,
    INVALID_SIGNATURE = 0x02,
    EXPIRED_BUNDLE = 0x03,
    TTL_EXCEEDED = 0x04,
    STORAGE_FULL = 0x05,
    RATE_LIMITED = 0x06,
    DUPLICATE_BUNDLE = 0x07,
    UNKNOWN_DESTINATION = 0x08,
    FRAGMENTATION_ERROR = 0x09,
    BLOOM_FILTER_ERROR = 0x0A,
    HANDSHAKE_FAILED = 0x0B,
    CRYPTO_ERROR = 0x0C,
    PROTOCOL_ERROR = 0x0D,
    INTERNAL_ERROR = 0xFF
}
```

---

## Appendix A: Constants

```
// Protocol
PROTOCOL_VERSION = 1
MAX_BUNDLE_SIZE = 65536  // 64KB
MAX_FRAGMENT_COUNT = 256
FRAGMENT_HEADER_SIZE = 20

// Timeouts
HANDSHAKE_TIMEOUT = 10s
SYNC_TIMEOUT = 60s
REASSEMBLY_TIMEOUT = 60s
IDLE_TIMEOUT = 300s

// Bluetooth
BLE_SERVICE_UUID = "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D"
BLE_MTU_DEFAULT = 185

// TCP
TCP_PORT = 7847
TCP_BUFFER_SIZE = 65536

// Bloom Filters
BLOOM_FPR = 0.01
BLOOM_MAX_ENTRIES = 100000

// PROPHET
P_ENCOUNTER = 0.75
GAMMA = 0.98
BETA = 0.25
```

---

## Appendix B: State Codes

```
enum ConnectionState {
    DISCONNECTED = 0,
    CONNECTING = 1,
    HANDSHAKING = 2,
    SYNCING = 3,
    IDLE = 4,
    DISCONNECTING = 5
}

enum BundleState {
    PENDING = 0,
    STORED = 1,
    IN_TRANSIT = 2,
    DELIVERED = 3,
    EXPIRED = 4,
    FAILED = 5
}

enum NodeState {
    IDLE = 0,
    INITIALIZING = 1,
    DISCOVERING = 2,
    CONNECTING = 3,
    ACTIVE = 4,
    STANDBY = 5,
    SHUTDOWN = 6
}
```
