# Railgun Node Mode - Mobile Implementation

## Overview

Node Mode enables peer-to-peer mesh networking for Railgun, allowing devices to communicate and relay messages even without internet connectivity. This implementation provides Delay-Tolerant Networking (DTN) capabilities for both iOS and Android platforms.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Node Mode Architecture                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     NodeModeManager                               │ │
│  │  • Lifecycle management (activate/deactivate)                     │ │
│  │  • Bundle routing & forwarding                                    │ │
│  │  • Peer connection management                                     │ │
│  │  • Statistics & monitoring                                        │ │
│  └───────────────┬─────────────────────────────────────────────────┘ │
│                  │                                                    │
│  ┌───────────────┴─────────────────────────────────────────────────┐ │
│  │                     Transport Layer                               │ │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │ │
│  │  │ BLE         │  │ Wi-Fi Direct    │  │ Multipeer           │   │ │
│  │  │ Transport   │  │ (Android)       │  │ (iOS only)          │   │ │
│  │  └─────────────┘  └─────────────────┘  └─────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                  │                                                    │
│  ┌───────────────┴─────────────────────────────────────────────────┐ │
│  │                     Storage Layer                                 │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │ │
│  │  │ Bundle Store    │  │ Node Registry   │  │ Routing Table   │   │ │
│  │  │ (SQLite/Room)   │  │ (Peers)         │  │ (Bloom Filter)  │   │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
mobile/
├── ios/
│   └── NodeMode/
│       ├── Package.swift
│       ├── Sources/NodeMode/
│       │   ├── Core/
│       │   │   ├── Bundle.swift          # DTN bundle model
│       │   │   ├── Node.swift            # Peer node model
│       │   │   ├── NodeModeConfig.swift  # Configuration
│       │   │   └── NodeModeManager.swift # Main coordinator
│       │   ├── Storage/
│       │   │   └── NodeModeDatabase.swift
│       │   ├── Routing/
│       │   │   └── BloomFilter.swift
│       │   └── Transport/
│       │       ├── Transport.swift
│       │       └── BLETransport.swift
│       └── Tests/NodeModeTests/
│           └── NodeModeTests.swift
│
└── android/
    ├── nodemode/
    │   └── build.gradle.kts
    └── app/src/main/java/com/railgun/android/nodemode/
        ├── core/
        │   ├── Bundle.kt
        │   ├── Node.kt
        │   └── NodeModeManager.kt
        ├── data/
        │   └── NodeModeDatabase.kt
        ├── routing/
        │   └── BloomFilter.kt
        ├── transport/
        │   └── BLETransport.kt
        └── di/
            └── NodeModeModule.kt
```

## Core Components

### Bundle

The fundamental data unit for DTN communication. Contains:
- **id**: Unique identifier (UUID)
- **sourceNodeId**: 32-byte originating node ID
- **destinationNodeId**: 32-byte target node ID
- **payload**: Encrypted message content
- **hopCount**: Number of relays traversed
- **hopPath**: List of relay node IDs
- **priority**: LOW, NORMAL, HIGH, CRITICAL
- **flags**: Encrypted, compressed, ACK requested, etc.
- **createdAt/expiresAt**: Timestamps for TTL management

### Node

Represents a peer in the mesh network:
- **id**: 32-byte unique identifier (Ed25519 public key)
- **publicKey**: For key exchange
- **capabilities**: Relay, storage, internet gateway, etc.
- **supportedTransports**: BLE, Wi-Fi Direct, etc.
- **routingStats**: Messages forwarded, last seen, etc.

### BloomFilter

Space-efficient probabilistic data structure for deduplication:
- Prevents reprocessing of seen bundles
- Configurable false positive rate (default 1%)
- MurmurHash3 for hash functions
- Serializable for persistence

### Transport Layer

Abstraction for different communication methods:
- **BLETransport**: Bluetooth Low Energy (primary)
- **Wi-Fi Direct**: Higher bandwidth (future)
- **MultipeerConnectivity**: iOS only (future)

## Usage

### iOS (Swift)

```swift
import NodeMode

// Configure Node Mode
let config = NodeModeConfig(
    enableBLE: true,
    maxStoredBundles: 1000,
    bundleTTLHours: 72,
    maxHops: 10
)

// Get manager instance
let nodeMode = NodeModeManager.shared

// Activate Node Mode
Task {
    await nodeMode.activate(config: config)
}

// Listen for events
for await event in nodeMode.events {
    switch event {
    case .bundleReceived(let bundle):
        print("Received bundle: \(bundle.id)")
    case .peerConnected(let peer):
        print("Peer connected: \(peer.displayName ?? peer.id.prefix(8))")
    case .bundleDelivered(let bundleId, let recipientId):
        print("Bundle \(bundleId) delivered to \(recipientId)")
    default:
        break
    }
}

// Send a message
let destinationNodeId = Data(/* recipient's node ID */)
let payload = "Hello, mesh network!".data(using: .utf8)!

let bundleId = try await nodeMode.sendBundle(
    payload: payload,
    destinationNodeId: destinationNodeId,
    priority: .normal
)

// Deactivate when done
await nodeMode.deactivate()
```

### Android (Kotlin)

```kotlin
import com.railgun.android.nodemode.core.*
import kotlinx.coroutines.flow.collect

// Configure Node Mode
val config = NodeModeConfig(
    enableBLE = true,
    maxStoredBundles = 1000,
    bundleTTLHours = 72,
    maxHops = 10
)

// Get manager instance (with Hilt injection)
@Inject
lateinit var nodeMode: NodeModeManager

// Activate Node Mode
lifecycleScope.launch {
    nodeMode.activate()
}

// Listen for events
lifecycleScope.launch {
    nodeMode.events.collect { event ->
        when (event) {
            is NodeModeEvent.BundleReceived -> {
                Log.d("NodeMode", "Received bundle: ${event.bundle.id}")
            }
            is NodeModeEvent.PeerConnected -> {
                Log.d("NodeMode", "Peer connected: ${event.peer.displayName}")
            }
            is NodeModeEvent.BundleDelivered -> {
                Log.d("NodeMode", "Bundle ${event.bundleId} delivered")
            }
            else -> {}
        }
    }
}

// Send a message
val destinationNodeId = ByteArray(32) // recipient's node ID
val payload = "Hello, mesh network!".toByteArray()

lifecycleScope.launch {
    val bundleId = nodeMode.sendBundle(
        payload = payload,
        destinationNodeId = destinationNodeId,
        priority = BundlePriority.NORMAL
    )
}

// Deactivate when done
lifecycleScope.launch {
    nodeMode.deactivate()
}
```

## Protocol Specification

### Bundle Format (Wire Protocol)

```
┌────────────────────────────────────────────────────────────┐
│                    Bundle Wire Format                       │
├────────────────────────────────────────────────────────────┤
│ Field              │ Size       │ Description              │
├────────────────────┼────────────┼──────────────────────────┤
│ Version            │ 1 byte     │ Protocol version (0x01)  │
│ Flags              │ 1 byte     │ Bundle flags bitmap      │
│ Priority           │ 1 byte     │ 0-3 priority level       │
│ Hop Count          │ 1 byte     │ Current hop count        │
│ ID Length          │ 2 bytes    │ Bundle ID length         │
│ ID                 │ Variable   │ Bundle identifier        │
│ Source Node ID     │ 32 bytes   │ Originator node ID       │
│ Destination Node ID│ 32 bytes   │ Target node ID           │
│ Created Timestamp  │ 8 bytes    │ Unix timestamp (ms)      │
│ Expires Timestamp  │ 8 bytes    │ Expiration time (ms)     │
│ Hop Path Length    │ 2 bytes    │ Number of hops           │
│ Hop Path           │ Variable   │ Array of 32-byte node IDs│
│ Payload Length     │ 4 bytes    │ Payload size             │
│ Payload            │ Variable   │ Encrypted message data   │
│ Checksum           │ 4 bytes    │ CRC32 of all fields      │
└────────────────────────────────────────────────────────────┘
```

### Flags Bitmap

```
Bit 0: Encrypted
Bit 1: Compressed
Bit 2: Acknowledgment Requested
Bit 3: Routing Hints Present
Bit 4-7: Reserved
```

## Security Considerations

1. **Node Identity**: Ed25519 keypair generated on first launch
2. **Payload Encryption**: XSalsa20-Poly1305 with X25519 key exchange
3. **Hop Path Privacy**: Optional encryption of relay node IDs
4. **Bundle Authentication**: Source node signs each bundle
5. **Anti-Replay**: Bloom filter prevents bundle reprocessing

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `enableBLE` | true | Enable BLE transport |
| `enableWifiDirect` | false | Enable Wi-Fi Direct |
| `maxStoredBundles` | 1000 | Maximum bundles to store |
| `maxBundleSize` | 256KB | Maximum payload size |
| `bundleTTLHours` | 72 | Bundle time-to-live |
| `maxHops` | 10 | Maximum relay hops |
| `forwardingEnabled` | true | Relay bundles for others |
| `autoConnectPeers` | true | Auto-connect to discovered peers |
| `maxConcurrentConnections` | 5 | Max simultaneous peer connections |

## Required Permissions

### iOS (Info.plist)

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Railgun uses Bluetooth for mesh networking</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>Railgun uses Bluetooth for mesh networking</string>
<key>NSLocalNetworkUsageDescription</key>
<string>Railgun uses local network for peer discovery</string>
<key>UIBackgroundModes</key>
<array>
    <string>bluetooth-central</string>
    <string>bluetooth-peripheral</string>
</array>
```

### Android (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />

<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

## Testing

### Unit Tests

```bash
# iOS
cd mobile/ios/NodeMode
swift test

# Android
cd mobile/android
./gradlew :app:testDebugUnitTest
```

### Integration Tests

See `/docs/NODE_MODE_TEST_PLAN.md` for comprehensive test scenarios.

## Related Documentation

- [NODE_MODE_ARCHITECTURE.md](/docs/NODE_MODE_ARCHITECTURE.md)
- [NODE_MODE_PROTOCOL_SPECIFICATION.md](/docs/NODE_MODE_PROTOCOL_SPECIFICATION.md)
- [NODE_MODE_TRANSPORT_PLAN.md](/docs/NODE_MODE_TRANSPORT_PLAN.md)
- [NODE_MODE_STORAGE_SCHEMA.md](/docs/NODE_MODE_STORAGE_SCHEMA.md)
- [NODE_MODE_THREAT_MODEL.md](/docs/NODE_MODE_THREAT_MODEL.md)
- [NODE_MODE_API_SPECIFICATION.md](/docs/NODE_MODE_API_SPECIFICATION.md)
- [NODE_MODE_TEST_PLAN.md](/docs/NODE_MODE_TEST_PLAN.md)

## License

Proprietary - Railgun Inc.
