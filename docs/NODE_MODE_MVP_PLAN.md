# Railgun Node Mode - MVP Implementation Plan

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Draft

---

## Executive Summary

This document outlines the phased implementation plan for Railgun Node Mode, a delay-tolerant mesh networking layer enabling offline-first encrypted communication. The MVP targets **3 months** with a focused feature set, followed by incremental hardening phases.

---

## 1. MVP Scope Definition

### 1.1 In-Scope for MVP

| Feature | Priority | Description |
|---------|----------|-------------|
| **LAN Discovery** | P0 | mDNS/DNS-SD peer discovery on local network |
| **Wi-Fi Direct** | P0 | P2P connections without infrastructure |
| **BLE Peripheral/Central** | P0 | Bluetooth 5.0 for proximity messaging |
| **Store-and-Forward** | P0 | Bundle storage with TTL and relay |
| **Epidemic Routing** | P0 | Simple flood-based message propagation |
| **Bloom Deduplication** | P1 | Prevent message loops |
| **Gateway Sync** | P1 | Sync to/from cloud when online |
| **Basic UI** | P1 | Node mode toggle, peer list, status |

### 1.2 Out-of-Scope for MVP (Phase 2+)

- PROPHET/Spray-and-Wait routing algorithms
- Onion routing privacy layer
- Geographic routing hints
- NFC tap-to-share
- Reputation system
- Mesh visualization
- Advanced metrics dashboard
- Cross-platform mesh bridging

### 1.3 Success Criteria

1. **Functional**: Two devices can exchange encrypted messages with no internet
2. **Latency**: <5s for direct peer communication
3. **Reliability**: 95%+ delivery for 2-hop paths within TTL
4. **Storage**: Handle 1000+ bundles without performance degradation
5. **Battery**: <10% additional drain in background mode

---

## 2. Team Structure

### 2.1 Recommended Team

| Role | Count | Focus |
|------|-------|-------|
| iOS Engineer | 1-2 | Core Framework, BLE, MultipeerConnectivity |
| Android Engineer | 1-2 | Nearby Connections, BLE, Wi-Fi Direct |
| Backend Engineer | 0.5 | Gateway sync API extensions |
| QA Engineer | 0.5 | Multi-device testing, stress testing |
| Tech Lead | 1 | Architecture, protocol design, code review |

**Minimum viable team**: 2 engineers (1 iOS, 1 Android) + part-time lead

### 2.2 External Dependencies

- Cryptography: Existing E2EE stack (libsodium)
- Protocol Buffers: For wire format
- SQLite/Room/GRDB: For storage
- BLE libraries: CoreBluetooth, Android BLE API

---

## 3. Phase Breakdown

## Phase 1: Foundation (Weeks 1-4)

### Week 1-2: Core Infrastructure

**iOS Tasks**:
```
□ Create NodeMode module structure
□ Implement Bundle model and serialization
□ Set up GRDB database with schema
□ Implement BundleStore with CRUD operations
□ Add bloom filter implementation
□ Write unit tests for storage layer
```

**Android Tasks**:
```
□ Create nodemode feature module
□ Implement Bundle entity and serialization
□ Set up Room database with migrations
□ Implement BundleRepository
□ Add bloom filter implementation
□ Write unit tests for storage layer
```

**Shared Tasks**:
```
□ Define Protocol Buffer schemas
□ Document wire format specification
□ Set up cross-platform test vectors
```

**Deliverables**:
- Bundle storage working on both platforms
- Serialization/deserialization tested
- Test vectors passing

### Week 3-4: Transport Layer - LAN

**iOS Tasks**:
```
□ Implement LANTransport using Network.framework
□ Add NWListener for incoming connections
□ Add NWBrowser for peer discovery (Bonjour)
□ Implement connection handshake
□ Add message framing (length-prefixed)
□ Integration tests with simulator
```

**Android Tasks**:
```
□ Implement LANTransport using NsdManager
□ Add service registration and discovery
□ Implement TCP socket handling
□ Add connection handshake
□ Add message framing
□ Integration tests with emulator
```

**Deliverables**:
- LAN peer discovery working
- Direct message exchange over TCP
- Basic handshake protocol

---

## Phase 2: Proximity Transports (Weeks 5-8)

### Week 5-6: Bluetooth Low Energy

**iOS Tasks**:
```
□ Implement BLETransport with CoreBluetooth
□ Add CBPeripheralManager (advertising)
□ Add CBCentralManager (scanning)
□ Define GATT service/characteristics
□ Implement chunked transfer for large payloads
□ Handle background mode (state restoration)
□ Test with real devices
```

**Android Tasks**:
```
□ Implement BLETransport with Android BLE API
□ Add BluetoothLeAdvertiser
□ Add BluetoothLeScanner
□ Define GATT service/characteristics (matching iOS)
□ Implement chunked transfer
□ Handle Doze mode compatibility
□ Test with real devices
```

**Cross-Platform Testing**:
```
□ iOS ↔ iOS BLE exchange
□ Android ↔ Android BLE exchange
□ iOS ↔ Android BLE exchange (interop)
```

**Deliverables**:
- BLE discovery and connection
- Cross-platform BLE messaging
- Background operation

### Week 7-8: Wi-Fi Direct / MultipeerConnectivity

**iOS Tasks**:
```
□ Implement WiFiDirectTransport using MCSession
□ Add MCNearbyServiceAdvertiser
□ Add MCNearbyServiceBrowser
□ Handle session state changes
□ Implement reliable data transfer
□ Add fallback from BLE to WiFi for large payloads
```

**Android Tasks**:
```
□ Implement WiFiDirectTransport using WifiP2pManager
□ Add service discovery (DNSSD over Wi-Fi Direct)
□ Handle group owner negotiation
□ Implement socket communication
□ Add fallback from BLE to WiFi Direct
```

**Deliverables**:
- Wi-Fi Direct peer connection
- High-bandwidth data transfer
- Automatic transport selection

---

## Phase 3: Routing & Sync (Weeks 9-10)

### Week 9: Epidemic Routing

**Both Platforms**:
```
□ Implement RouterManager with epidemic strategy
□ Add bundle selection for relay (priority-based)
□ Implement anti-entropy sync protocol
□ Add bloom filter exchange for deduplication
□ Handle TTL decrement and expiration
□ Add hop count tracking
□ Stress test with 100+ bundles
```

**Deliverables**:
- Multi-hop message delivery
- Efficient deduplication
- TTL-based expiration

### Week 10: Gateway Sync

**Both Platforms**:
```
□ Implement GatewayManager
□ Add online/offline detection
□ Implement delta sync (send unsent bundles)
□ Implement pull sync (receive pending bundles)
□ Add conflict resolution
□ Handle partial sync failures
```

**Backend Tasks**:
```
□ Add /api/v1/node/bundles/sync endpoint
□ Implement bundle storage for offline users
□ Add bundle expiration job
□ Rate limiting for sync
```

**Deliverables**:
- Cloud sync when online
- Offline queue flush
- Seamless online/offline transition

---

## Phase 4: Integration & Polish (Weeks 11-12)

### Week 11: UI & Integration

**iOS Tasks**:
```
□ Create NodeModeSettingsView
□ Add toggle for Node Mode enable/disable
□ Create PeerListView with discovered nodes
□ Add NodeStatusView (connection state, stats)
□ Integrate with existing ChatManager
□ Add "Send via Node Mode" option in DMs
```

**Android Tasks**:
```
□ Create NodeModeSettingsScreen (Compose)
□ Add toggle for Node Mode enable/disable
□ Create PeerListScreen with discovered nodes
□ Add NodeStatusComposable
□ Integrate with existing MessageRepository
□ Add "Send via Node Mode" option
```

**Deliverables**:
- User-facing Node Mode controls
- Peer visibility
- Seamless UX integration

### Week 12: Testing & Hardening

**QA Tasks**:
```
□ Multi-device mesh testing (4+ devices)
□ Long-duration stability testing (24h)
□ Battery drain profiling
□ Network transition testing (online → offline → online)
□ Edge case testing (bluetooth off, wifi off, etc.)
□ Performance benchmarking
□ Memory leak detection
□ Crash reporting integration
```

**Documentation**:
```
□ User-facing Node Mode guide
□ Troubleshooting FAQ
□ Developer API documentation
□ Test report and metrics
```

**Deliverables**:
- Stable MVP release candidate
- Performance benchmarks
- Test coverage report

---

## 4. Technical Milestones

### Milestone 1: Storage & Serialization (Week 2)
- [ ] Bundle model with all fields
- [ ] SQLite schema implemented
- [ ] Protobuf serialization working
- [ ] 100% test coverage on storage

### Milestone 2: LAN Discovery (Week 4)
- [ ] Devices discover each other on same network
- [ ] Messages exchange successfully
- [ ] Connection handshake secure

### Milestone 3: BLE Mesh (Week 6)
- [ ] BLE discovery and connection
- [ ] Cross-platform interop tested
- [ ] Background operation working

### Milestone 4: Wi-Fi High-Bandwidth (Week 8)
- [ ] Wi-Fi Direct connections
- [ ] Large file transfer (>1MB)
- [ ] Automatic transport selection

### Milestone 5: Multi-Hop Routing (Week 10)
- [ ] 3+ hop message delivery
- [ ] Deduplication working
- [ ] Gateway sync operational

### Milestone 6: MVP Release (Week 12)
- [ ] Feature complete
- [ ] All critical bugs fixed
- [ ] Performance targets met
- [ ] Documentation complete

---

## 5. Risk Assessment

### High Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| BLE interop issues (iOS ↔ Android) | High | High | Early cross-platform testing, fallback to Wi-Fi |
| Background restrictions (iOS/Android) | Medium | High | Use proper background modes, optimize for batching |
| Battery drain complaints | Medium | High | Aggressive power optimization, user controls |
| Complex state management | High | Medium | Clear state machines, extensive logging |

### Medium Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wi-Fi Direct unreliability | Medium | Medium | Graceful fallbacks, retry logic |
| Large mesh scaling issues | Medium | Medium | MVP limited to small meshes, optimize later |
| Cryptographic overhead | Low | Medium | Profile early, optimize hot paths |

---

## 6. Resource Requirements

### Development Environment

**Per Developer**:
- 2+ test devices per platform
- Access to device lab for multi-device testing
- USB hubs for device farms

**Shared**:
- CI/CD for automated testing
- Crash reporting (Sentry/Crashlytics)
- Analytics for mesh telemetry

### External Services

| Service | Purpose | Cost |
|---------|---------|------|
| Firebase Test Lab | Android device testing | ~$100/mo |
| AWS Device Farm | iOS device testing | ~$200/mo |
| Sentry | Crash reporting | Free tier |

---

## 7. Testing Strategy

### Unit Tests

```
Coverage Targets:
- Storage layer: 90%+
- Serialization: 100%
- Routing logic: 85%+
- Crypto operations: 100%
```

### Integration Tests

```
Scenarios:
1. Direct peer message exchange
2. 2-hop relay delivery
3. Gateway sync round-trip
4. Transport fallback (BLE → WiFi)
5. Offline → online transition
6. Bundle expiration
7. Bloom filter deduplication
```

### Manual Test Matrix

| Scenario | iOS 17 | iOS 16 | Android 14 | Android 13 | Android 12 |
|----------|--------|--------|------------|------------|------------|
| BLE Discovery | ✓ | ✓ | ✓ | ✓ | ✓ |
| Wi-Fi Direct | ✓ | ✓ | ✓ | ✓ | ✓ |
| LAN Sync | ✓ | ✓ | ✓ | ✓ | ✓ |
| Background | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cross-platform | ✓ | ✓ | ✓ | ✓ | ✓ |

### Performance Benchmarks

```
Metrics to Track:
- Discovery latency (ms)
- Connection establishment (ms)
- Message throughput (msg/sec)
- Battery drain (%/hr)
- Memory usage (MB)
- Storage efficiency (bytes/message)
```

---

## 8. Post-MVP Roadmap

### Phase 5: Routing Intelligence (Month 4)
- PROPHET predictability routing
- Spray-and-Wait with limited copies
- Geographic routing hints
- Reputation-based peer selection

### Phase 6: Privacy Hardening (Month 5)
- Onion routing for multi-hop
- Traffic analysis resistance
- Timing attack mitigations
- Cover traffic generation

### Phase 7: Scale & Reliability (Month 6)
- 100+ node mesh support
- Advanced deduplication (similarity hashing)
- Mesh visualization dashboard
- Remote diagnostics

### Phase 8: Platform Expansion
- Desktop apps (Electron with local transports)
- Web gateway (WebRTC bridge)
- CLI tools for testing

---

## 9. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-12 | Start with Epidemic routing | Simplest to implement, good enough for MVP |
| 2026-01-12 | Use Protocol Buffers | Compact, cross-platform, schema evolution |
| 2026-01-12 | SQLite for storage | Native on all platforms, proven reliability |
| 2026-01-12 | Prioritize BLE over NFC | More range, background support, no tap needed |
| 2026-01-12 | Skip AWDL in MVP | iOS-only, complex, add in Phase 5 |

---

## 10. Definition of Done

### For each feature:
- [ ] Code complete with tests
- [ ] Code reviewed and approved
- [ ] Integration tested on real devices
- [ ] Documentation updated
- [ ] No critical/high bugs
- [ ] Performance within targets

### For MVP release:
- [ ] All P0 features complete
- [ ] All P1 features complete or deferred
- [ ] <5 known issues (none critical)
- [ ] User documentation complete
- [ ] QA sign-off
- [ ] Security review passed
- [ ] Performance benchmarks published

---

## Appendix A: File Structure

### iOS

```
railgun-ios/
├── RailGun/
│   ├── NodeMode/
│   │   ├── Core/
│   │   │   ├── NodeModeManager.swift
│   │   │   ├── Bundle.swift
│   │   │   ├── Node.swift
│   │   │   └── Config.swift
│   │   ├── Storage/
│   │   │   ├── NodeModeDatabase.swift
│   │   │   ├── BundleStore.swift
│   │   │   └── NodeRegistry.swift
│   │   ├── Transport/
│   │   │   ├── TransportManager.swift
│   │   │   ├── BLETransport.swift
│   │   │   ├── WiFiDirectTransport.swift
│   │   │   └── LANTransport.swift
│   │   ├── Routing/
│   │   │   ├── RouterManager.swift
│   │   │   ├── EpidemicRouter.swift
│   │   │   └── BloomFilter.swift
│   │   ├── Gateway/
│   │   │   ├── GatewayManager.swift
│   │   │   └── SyncProtocol.swift
│   │   └── UI/
│   │       ├── NodeModeSettingsView.swift
│   │       ├── PeerListView.swift
│   │       └── NodeStatusView.swift
│   └── ...
```

### Android

```
railgun-android/
├── app/src/main/java/com/railgun/android/
│   ├── nodemode/
│   │   ├── NodeModeManager.kt
│   │   ├── data/
│   │   │   ├── model/
│   │   │   │   ├── Bundle.kt
│   │   │   │   └── Node.kt
│   │   │   ├── local/
│   │   │   │   ├── NodeModeDatabase.kt
│   │   │   │   ├── BundleDao.kt
│   │   │   │   └── NodeDao.kt
│   │   │   └── repository/
│   │   │       ├── BundleRepository.kt
│   │   │       └── NodeRepository.kt
│   │   ├── transport/
│   │   │   ├── TransportManager.kt
│   │   │   ├── BLETransport.kt
│   │   │   ├── WiFiDirectTransport.kt
│   │   │   └── LANTransport.kt
│   │   ├── routing/
│   │   │   ├── RouterManager.kt
│   │   │   ├── EpidemicRouter.kt
│   │   │   └── BloomFilter.kt
│   │   ├── gateway/
│   │   │   ├── GatewayManager.kt
│   │   │   └── SyncWorker.kt
│   │   └── ui/
│   │       ├── NodeModeSettingsScreen.kt
│   │       ├── PeerListScreen.kt
│   │       └── NodeStatusComposable.kt
│   └── ...
```

---

## Appendix B: Dependencies

### iOS

```swift
// Package.swift additions
dependencies: [
    .package(url: "https://github.com/groue/GRDB.swift", from: "6.0.0"),
    .package(url: "https://github.com/apple/swift-protobuf", from: "1.20.0"),
]
```

### Android

```kotlin
// build.gradle additions
dependencies {
    implementation("com.google.protobuf:protobuf-kotlin-lite:3.24.0")
    implementation("net.zetetic:android-database-sqlcipher:4.5.4")
}
```

---

*This plan is a living document and will be updated as development progresses.*
