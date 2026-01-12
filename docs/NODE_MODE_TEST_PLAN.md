# Railgun Node Mode - Test Plan

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Draft

---

## 1. Overview

This document defines the comprehensive testing strategy for Railgun Node Mode, covering unit tests, integration tests, end-to-end scenarios, performance benchmarks, and security validation.

---

## 2. Test Categories

### 2.1 Test Pyramid

```
                    /\
                   /  \  E2E Tests (5%)
                  /----\  - Multi-device mesh scenarios
                 /      \
                /--------\  Integration Tests (25%)
               /          \  - Transport + Storage
              /            \  - Routing + Gateway
             /--------------\
            /                \  Unit Tests (70%)
           /                  \  - Storage, Routing, Crypto
          /--------------------\
```

### 2.2 Test Environments

| Environment | Purpose | Configuration |
|-------------|---------|---------------|
| **Local** | Dev testing | Simulators/Emulators |
| **Device Lab** | Real device testing | Physical devices, various OS versions |
| **CI/CD** | Automated regression | Emulators + limited real devices |
| **Mesh Lab** | Large-scale testing | 10-100 physical devices |

---

## 3. Unit Tests

### 3.1 Storage Layer

```swift
// iOS - BundleStoreTests.swift
class BundleStoreTests: XCTestCase {
    var store: BundleStore!
    
    override func setUp() async throws {
        store = BundleStore(database: .inMemory)
    }
    
    // MARK: - Basic CRUD
    
    func testInsertBundle() async throws {
        let bundle = TestFixtures.makeBundle()
        try await store.insert(bundle)
        
        let retrieved = try await store.get(id: bundle.id)
        XCTAssertEqual(retrieved?.id, bundle.id)
        XCTAssertEqual(retrieved?.payload, bundle.payload)
    }
    
    func testUpdateBundleState() async throws {
        let bundle = TestFixtures.makeBundle(state: .pending)
        try await store.insert(bundle)
        
        try await store.markDelivered(id: bundle.id, to: TestFixtures.nodeId)
        
        let retrieved = try await store.get(id: bundle.id)
        XCTAssertEqual(retrieved?.state, .delivered)
        XCTAssertNotNil(retrieved?.deliveredAt)
    }
    
    func testDeleteBundle() async throws {
        let bundle = TestFixtures.makeBundle()
        try await store.insert(bundle)
        try await store.delete(id: bundle.id)
        
        let retrieved = try await store.get(id: bundle.id)
        XCTAssertNil(retrieved)
    }
    
    // MARK: - Queries
    
    func testGetRelayQueue() async throws {
        // Insert bundles with different priorities
        let urgent = TestFixtures.makeBundle(priority: .urgent)
        let normal = TestFixtures.makeBundle(priority: .normal)
        let bulk = TestFixtures.makeBundle(priority: .bulk)
        
        try await store.insert(urgent)
        try await store.insert(normal)
        try await store.insert(bulk)
        
        let queue = try await store.getRelayQueue(limit: 10)
        
        XCTAssertEqual(queue[0].id, urgent.id)  // Urgent first
        XCTAssertEqual(queue[1].id, normal.id)
        XCTAssertEqual(queue[2].id, bulk.id)
    }
    
    func testExpireOldBundles() async throws {
        let expired = TestFixtures.makeBundle(expiresAt: Date().addingTimeInterval(-3600))
        let valid = TestFixtures.makeBundle(expiresAt: Date().addingTimeInterval(3600))
        
        try await store.insert(expired)
        try await store.insert(valid)
        
        let count = try await store.expireOldBundles()
        
        XCTAssertEqual(count, 1)
        let expiredBundle = try await store.get(id: expired.id)
        XCTAssertEqual(expiredBundle?.state, .expired)
    }
    
    // MARK: - Edge Cases
    
    func testDuplicateInsertRejected() async throws {
        let bundle = TestFixtures.makeBundle()
        try await store.insert(bundle)
        
        XCTAssertThrowsError(try await store.insert(bundle)) { error in
            XCTAssertTrue(error is BundleStore.Error.duplicateId)
        }
    }
    
    func testStorageLimitEnforced() async throws {
        store.configure(maxStorageBytes: 1000)
        
        // Insert bundles until over limit
        for i in 0..<100 {
            let bundle = TestFixtures.makeBundle(payloadSize: 100)
            try await store.insert(bundle)
        }
        
        let stats = try await store.getStats()
        XCTAssertLessThanOrEqual(stats.totalBytes, 1000)
    }
}
```

```kotlin
// Android - BundleRepositoryTest.kt
@ExperimentalCoroutinesApi
class BundleRepositoryTest {
    private lateinit var database: NodeModeDatabase
    private lateinit var repository: BundleRepository
    
    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, NodeModeDatabase::class.java).build()
        repository = BundleRepository(database.bundleDao())
    }
    
    @After
    fun teardown() {
        database.close()
    }
    
    @Test
    fun `insert and retrieve bundle`() = runTest {
        val bundle = TestFixtures.makeBundle()
        repository.insert(bundle)
        
        val retrieved = repository.getById(bundle.id)
        
        assertEquals(bundle.id, retrieved?.id)
        assertArrayEquals(bundle.payload, retrieved?.payload)
    }
    
    @Test
    fun `relay queue orders by priority`() = runTest {
        val urgent = TestFixtures.makeBundle(priority = Priority.URGENT)
        val normal = TestFixtures.makeBundle(priority = Priority.NORMAL)
        
        repository.insert(normal)
        repository.insert(urgent)
        
        val queue = repository.getRelayQueue(10)
        
        assertEquals(urgent.id, queue[0].id)
        assertEquals(normal.id, queue[1].id)
    }
    
    @Test
    fun `expire old bundles`() = runTest {
        val expired = TestFixtures.makeBundle(
            expiresAt = System.currentTimeMillis() - 3600000
        )
        repository.insert(expired)
        
        val count = repository.expireOldBundles()
        
        assertEquals(1, count)
    }
}
```

### 3.2 Routing Logic

```swift
// iOS - EpidemicRouterTests.swift
class EpidemicRouterTests: XCTestCase {
    var router: EpidemicRouter!
    var mockStore: MockBundleStore!
    
    override func setUp() {
        mockStore = MockBundleStore()
        router = EpidemicRouter(store: mockStore)
    }
    
    func testSelectBundlesForPeer() async throws {
        // Given: Multiple bundles in store
        let bundles = (0..<10).map { _ in TestFixtures.makeBundle() }
        bundles.forEach { mockStore.bundles[$0.id] = $0 }
        
        // Given: Peer's bloom filter
        let peerBloom = BloomFilter()
        peerBloom.add(bundles[0].id)  // Peer already has first bundle
        
        // When: Select bundles for peer
        let selected = try await router.selectBundles(
            forPeer: TestFixtures.nodeId,
            peerBloom: peerBloom,
            maxCount: 5
        )
        
        // Then: First bundle excluded (peer has it)
        XCTAssertFalse(selected.contains { $0.id == bundles[0].id })
        XCTAssertEqual(selected.count, 5)
    }
    
    func testIncrementHopCount() async throws {
        let bundle = TestFixtures.makeBundle(hopCount: 3)
        
        let forwarded = try await router.prepareForRelay(bundle)
        
        XCTAssertEqual(forwarded.hopCount, 4)
    }
    
    func testRejectOverMaxHops() async throws {
        let bundle = TestFixtures.makeBundle(hopCount: 10, maxHops: 10)
        
        XCTAssertThrowsError(try await router.prepareForRelay(bundle)) { error in
            XCTAssertEqual(error as? RouterError, .maxHopsExceeded)
        }
    }
}
```

### 3.3 Bloom Filter

```swift
// iOS - BloomFilterTests.swift
class BloomFilterTests: XCTestCase {
    func testAddAndContains() {
        let bloom = BloomFilter(expectedElements: 1000, falsePositiveRate: 0.01)
        
        bloom.add("test-id-1")
        bloom.add("test-id-2")
        
        XCTAssertTrue(bloom.mightContain("test-id-1"))
        XCTAssertTrue(bloom.mightContain("test-id-2"))
    }
    
    func testFalsePositiveRate() {
        let bloom = BloomFilter(expectedElements: 1000, falsePositiveRate: 0.01)
        
        // Add 1000 elements
        for i in 0..<1000 {
            bloom.add("element-\(i)")
        }
        
        // Check 10000 elements that were NOT added
        var falsePositives = 0
        for i in 1000..<11000 {
            if bloom.mightContain("element-\(i)") {
                falsePositives += 1
            }
        }
        
        let actualRate = Double(falsePositives) / 10000.0
        XCTAssertLessThan(actualRate, 0.02)  // Allow 2x expected rate
    }
    
    func testSerializationRoundTrip() throws {
        let bloom = BloomFilter(expectedElements: 100, falsePositiveRate: 0.01)
        bloom.add("test-1")
        bloom.add("test-2")
        
        let data = try bloom.serialize()
        let restored = try BloomFilter(data: data)
        
        XCTAssertTrue(restored.mightContain("test-1"))
        XCTAssertTrue(restored.mightContain("test-2"))
    }
}
```

### 3.4 Serialization

```swift
// iOS - BundleSerializationTests.swift
class BundleSerializationTests: XCTestCase {
    func testProtobufRoundTrip() throws {
        let bundle = Bundle(
            id: UUID(),
            version: 1,
            flags: .encrypted,
            priority: .urgent,
            hopCount: 2,
            maxHops: 10,
            createdAt: Date(),
            expiresAt: Date().addingTimeInterval(3600),
            sourceNode: TestFixtures.nodeId,
            destinationType: .user,
            destination: TestFixtures.userId,
            payload: Data([0x01, 0x02, 0x03]),
            signature: TestFixtures.signature
        )
        
        let encoded = try bundle.toProtobuf()
        let decoded = try Bundle(protobuf: encoded)
        
        XCTAssertEqual(bundle.id, decoded.id)
        XCTAssertEqual(bundle.version, decoded.version)
        XCTAssertEqual(bundle.payload, decoded.payload)
        XCTAssertEqual(bundle.signature, decoded.signature)
    }
    
    func testCrossPlatformCompatibility() throws {
        // Test vector from Android implementation
        let androidBytes = Data(base64Encoded: "CgQBAgME...")!
        
        let bundle = try Bundle(protobuf: androidBytes)
        
        XCTAssertEqual(bundle.id.uuidString, "expected-uuid")
        XCTAssertEqual(bundle.priority, .normal)
    }
}
```

---

## 4. Integration Tests

### 4.1 Transport Tests

```swift
// iOS - BLETransportIntegrationTests.swift
class BLETransportIntegrationTests: XCTestCase {
    var advertiser: BLETransport!
    var scanner: BLETransport!
    
    override func setUp() async throws {
        advertiser = BLETransport(mode: .peripheral)
        scanner = BLETransport(mode: .central)
        
        try await advertiser.start()
        try await scanner.start()
    }
    
    func testDiscoverPeer() async throws {
        let expectation = expectation(description: "Peer discovered")
        
        scanner.onPeerDiscovered = { peer in
            XCTAssertNotNil(peer.nodeId)
            expectation.fulfill()
        }
        
        await fulfillment(of: [expectation], timeout: 10.0)
    }
    
    func testSendMessage() async throws {
        let peer = try await scanner.waitForPeer(timeout: 10)
        
        let message = Data([0x01, 0x02, 0x03])
        try await scanner.send(message, to: peer)
        
        let received = try await advertiser.waitForMessage(timeout: 5)
        XCTAssertEqual(received, message)
    }
    
    func testLargePayloadChunking() async throws {
        let peer = try await scanner.waitForPeer(timeout: 10)
        
        // 10KB payload (requires chunking over BLE)
        let message = Data(repeating: 0xAB, count: 10240)
        try await scanner.send(message, to: peer)
        
        let received = try await advertiser.waitForMessage(timeout: 30)
        XCTAssertEqual(received, message)
    }
}
```

### 4.2 Gateway Sync Tests

```kotlin
// Android - GatewaySyncIntegrationTest.kt
@MediumTest
class GatewaySyncIntegrationTest {
    @get:Rule
    val hiltRule = HiltAndroidRule(this)
    
    @Inject lateinit var gatewayManager: GatewayManager
    @Inject lateinit var bundleRepository: BundleRepository
    
    private lateinit var mockServer: MockWebServer
    
    @Before
    fun setup() {
        hiltRule.inject()
        mockServer = MockWebServer()
        mockServer.start()
        gatewayManager.setBaseUrl(mockServer.url("/").toString())
    }
    
    @Test
    fun `sync uploads pending bundles`() = runTest {
        // Given: Local pending bundle
        val bundle = TestFixtures.makeBundle(state = BundleState.PENDING)
        bundleRepository.insert(bundle)
        
        // Given: Server accepts upload
        mockServer.enqueue(MockResponse().setBody("""
            {"status": "ok", "received": 1}
        """))
        
        // When: Sync
        val result = gatewayManager.syncWithGateway()
        
        // Then: Bundle uploaded
        assertTrue(result.uploadedCount == 1)
        val request = mockServer.takeRequest()
        assertTrue(request.path?.contains("/bundles/upload") == true)
    }
    
    @Test
    fun `sync downloads pending bundles for user`() = runTest {
        // Given: Server has pending bundles
        mockServer.enqueue(MockResponse().setBody("""
            {"bundles": [${TestFixtures.bundleJson()}]}
        """))
        
        // When: Sync
        val result = gatewayManager.syncWithGateway()
        
        // Then: Bundle downloaded and stored
        assertTrue(result.downloadedCount == 1)
        val stored = bundleRepository.getAll()
        assertEquals(1, stored.size)
    }
}
```

### 4.3 End-to-End Routing

```swift
// iOS - RoutingE2ETests.swift
class RoutingE2ETests: XCTestCase {
    func testTwoHopDelivery() async throws {
        // Setup 3 nodes: A → B → C
        let nodeA = TestNode(name: "A")
        let nodeB = TestNode(name: "B")
        let nodeC = TestNode(name: "C")
        
        // Connect A ↔ B, B ↔ C (but NOT A ↔ C)
        try await nodeA.connect(to: nodeB)
        try await nodeB.connect(to: nodeC)
        
        // A sends message to C
        let message = TestFixtures.makeMessage(to: nodeC.userId)
        try await nodeA.send(message)
        
        // Wait for epidemic routing to propagate
        try await Task.sleep(nanoseconds: 5_000_000_000)  // 5 seconds
        
        // Verify C received the message
        let received = try await nodeC.getReceivedMessages()
        XCTAssertTrue(received.contains { $0.id == message.id })
        
        // Verify hop count increased
        let receivedMessage = received.first { $0.id == message.id }
        XCTAssertEqual(receivedMessage?.hopCount, 2)
    }
    
    func testDeduplication() async throws {
        // Setup: A connected to both B and C, B and C connected
        let nodeA = TestNode(name: "A")
        let nodeB = TestNode(name: "B")
        let nodeC = TestNode(name: "C")
        
        try await nodeA.connect(to: nodeB)
        try await nodeA.connect(to: nodeC)
        try await nodeB.connect(to: nodeC)
        
        // A sends message (will be flooded to B and C)
        let message = TestFixtures.makeMessage(to: nodeB.userId)
        try await nodeA.send(message)
        
        // Wait for routing
        try await Task.sleep(nanoseconds: 3_000_000_000)
        
        // B should receive message exactly once (not duplicated via C)
        let received = try await nodeB.getReceivedMessages()
        let duplicates = received.filter { $0.id == message.id }
        XCTAssertEqual(duplicates.count, 1)
    }
}
```

---

## 5. Performance Tests

### 5.1 Benchmarks

```swift
// iOS - PerformanceBenchmarks.swift
class PerformanceBenchmarks: XCTestCase {
    func testBundleInsertPerformance() throws {
        let store = BundleStore(database: .temporary)
        
        measure {
            for _ in 0..<1000 {
                let bundle = TestFixtures.makeBundle()
                try? store.insertSync(bundle)
            }
        }
        // Target: < 100ms for 1000 inserts
    }
    
    func testBloomFilterQueryPerformance() throws {
        let bloom = BloomFilter(expectedElements: 100000, falsePositiveRate: 0.01)
        
        // Pre-populate
        for i in 0..<100000 {
            bloom.add("id-\(i)")
        }
        
        measure {
            for i in 0..<10000 {
                _ = bloom.mightContain("id-\(i)")
            }
        }
        // Target: < 10ms for 10000 queries
    }
    
    func testSerializationPerformance() throws {
        let bundles = (0..<100).map { _ in TestFixtures.makeBundle(payloadSize: 1024) }
        
        measure {
            for bundle in bundles {
                _ = try? bundle.toProtobuf()
            }
        }
        // Target: < 50ms for 100 bundles
    }
    
    func testRouteSelectionPerformance() throws {
        let router = EpidemicRouter(store: BundleStore(database: .temporary))
        
        // Pre-populate 10000 bundles
        for _ in 0..<10000 {
            try? router.store.insertSync(TestFixtures.makeBundle())
        }
        
        let peerBloom = BloomFilter(expectedElements: 5000, falsePositiveRate: 0.01)
        for i in 0..<5000 {
            peerBloom.add("bundle-\(i)")
        }
        
        measure {
            _ = try? router.selectBundles(
                forPeer: TestFixtures.nodeId,
                peerBloom: peerBloom,
                maxCount: 100
            )
        }
        // Target: < 200ms
    }
}
```

### 5.2 Battery Tests

```kotlin
// Android - BatteryProfileTest.kt
@LargeTest
class BatteryProfileTest {
    @get:Rule
    val batteryRule = BatteryHistorianRule()
    
    @Test
    fun profileBackgroundNodeMode() {
        // Enable Node Mode
        NodeModeManager.enable()
        
        // Run for 1 hour in background
        SystemClock.sleep(3600000)
        
        // Get battery stats
        val stats = batteryRule.getBatteryStats()
        
        // Assert battery drain < 5% per hour
        assertTrue("Battery drain too high: ${stats.drainPercent}%", 
            stats.drainPercent < 5.0)
    }
    
    @Test
    fun profileActiveMeshCommunication() {
        NodeModeManager.enable()
        
        // Simulate active mesh traffic for 10 minutes
        repeat(60) {
            NodeModeManager.sendTestBundle()
            SystemClock.sleep(10000)
        }
        
        val stats = batteryRule.getBatteryStats()
        
        // Assert battery drain < 2% for 10 minutes active use
        assertTrue(stats.drainPercent < 2.0)
    }
}
```

### 5.3 Memory Tests

```swift
// iOS - MemoryTests.swift
class MemoryTests: XCTestCase {
    func testMemoryUsageUnderLoad() throws {
        let initialMemory = getMemoryUsage()
        
        let store = BundleStore(database: .temporary)
        
        // Insert 10000 bundles
        for _ in 0..<10000 {
            try store.insertSync(TestFixtures.makeBundle(payloadSize: 1024))
        }
        
        let peakMemory = getMemoryUsage()
        let delta = peakMemory - initialMemory
        
        // Memory increase should be < 50MB
        XCTAssertLessThan(delta, 50 * 1024 * 1024)
    }
    
    func testNoMemoryLeaksInRouter() throws {
        weak var weakRouter: EpidemicRouter?
        
        autoreleasepool {
            let router = EpidemicRouter(store: BundleStore(database: .temporary))
            weakRouter = router
            
            // Perform operations
            for _ in 0..<1000 {
                _ = try? router.selectBundles(
                    forPeer: TestFixtures.nodeId,
                    peerBloom: BloomFilter(),
                    maxCount: 10
                )
            }
        }
        
        // Router should be deallocated
        XCTAssertNil(weakRouter)
    }
}
```

---

## 6. Security Tests

### 6.1 Cryptographic Validation

```swift
// iOS - CryptoSecurityTests.swift
class CryptoSecurityTests: XCTestCase {
    func testBundleSignatureValidation() throws {
        let bundle = TestFixtures.makeSignedBundle()
        
        // Valid signature should verify
        XCTAssertTrue(bundle.verifySignature())
        
        // Tampered payload should fail verification
        var tampered = bundle
        tampered.payload = Data([0xFF])
        XCTAssertFalse(tampered.verifySignature())
    }
    
    func testRejectExpiredBundles() throws {
        let expired = TestFixtures.makeBundle(expiresAt: Date().addingTimeInterval(-1))
        let store = BundleStore(database: .temporary)
        
        XCTAssertThrowsError(try store.insertSync(expired)) { error in
            XCTAssertEqual(error as? StoreError, .bundleExpired)
        }
    }
    
    func testRejectInvalidSignature() throws {
        var bundle = TestFixtures.makeBundle()
        bundle.signature = Data(repeating: 0, count: 64)  // Invalid signature
        
        let store = BundleStore(database: .temporary)
        
        XCTAssertThrowsError(try store.insertSync(bundle)) { error in
            XCTAssertEqual(error as? StoreError, .invalidSignature)
        }
    }
    
    func testRejectOversizedBundle() throws {
        let oversized = TestFixtures.makeBundle(payloadSize: 128 * 1024)  // 128KB
        let store = BundleStore(database: .temporary)
        store.configure(maxBundleSize: 64 * 1024)
        
        XCTAssertThrowsError(try store.insertSync(oversized)) { error in
            XCTAssertEqual(error as? StoreError, .bundleTooLarge)
        }
    }
}
```

### 6.2 Fuzzing

```swift
// iOS - FuzzTests.swift
class FuzzTests: XCTestCase {
    func testProtobufFuzzing() throws {
        // Generate random bytes and try to parse
        for _ in 0..<10000 {
            let randomData = Data((0..<100).map { _ in UInt8.random(in: 0...255) })
            
            // Should not crash, should return error
            XCTAssertThrowsError(try Bundle(protobuf: randomData))
        }
    }
    
    func testHandshakeFuzzing() throws {
        let transport = MockTransport()
        
        for _ in 0..<10000 {
            let randomHandshake = Data((0..<50).map { _ in UInt8.random(in: 0...255) })
            
            // Should reject invalid handshakes gracefully
            let result = transport.processHandshake(randomHandshake)
            XCTAssertEqual(result, .rejected)
        }
    }
}
```

---

## 7. Multi-Device Test Scenarios

### 7.1 Test Matrix

| Scenario | Devices | Description |
|----------|---------|-------------|
| **Direct Pair** | 2 | iOS ↔ Android direct BLE |
| **Linear Chain** | 3 | A → B → C relay |
| **Mesh (Small)** | 4 | Full mesh connectivity |
| **Mesh (Medium)** | 10 | Partial connectivity |
| **Mesh (Large)** | 20+ | Sparse connectivity, stress test |
| **Gateway Bridge** | 5 | 3 offline, 1 gateway, 1 server |

### 7.2 Test Scripts

```bash
#!/bin/bash
# mesh-test-runner.sh

echo "=== Railgun Node Mode Mesh Test ==="

# Reset all devices
adb devices | tail -n +2 | cut -f1 | xargs -I {} adb -s {} shell pm clear com.railgun.android

# Enable Node Mode on all devices
for device in $(adb devices | tail -n +2 | cut -f1); do
    adb -s $device shell am broadcast -a com.railgun.NODE_MODE_ENABLE
done

# Wait for mesh to form
sleep 30

# Send test message from device 1 to device 5
DEVICE1=$(adb devices | tail -n +2 | head -1 | cut -f1)
adb -s $DEVICE1 shell am broadcast \
    -a com.railgun.SEND_TEST_MESSAGE \
    --es target "device5-user-id" \
    --es message "Test message $(date)"

# Wait for propagation
sleep 60

# Collect results from all devices
for device in $(adb devices | tail -n +2 | cut -f1); do
    echo "=== Device: $device ==="
    adb -s $device shell cat /data/data/com.railgun.android/files/nodemode_log.txt
done
```

### 7.3 Simulation Framework

```swift
// iOS - MeshSimulator.swift
class MeshSimulator {
    var nodes: [SimulatedNode] = []
    var connections: [(Int, Int)] = []
    
    func createMesh(nodeCount: Int, connectivity: Double) {
        // Create nodes
        for i in 0..<nodeCount {
            nodes.append(SimulatedNode(id: i))
        }
        
        // Create random connections based on connectivity probability
        for i in 0..<nodeCount {
            for j in (i+1)..<nodeCount {
                if Double.random(in: 0...1) < connectivity {
                    connections.append((i, j))
                    nodes[i].connect(to: nodes[j])
                    nodes[j].connect(to: nodes[i])
                }
            }
        }
    }
    
    func sendMessage(from: Int, to: Int) -> Message {
        let message = Message(
            id: UUID(),
            from: nodes[from].userId,
            to: nodes[to].userId,
            content: "Test",
            createdAt: Date()
        )
        nodes[from].send(message)
        return message
    }
    
    func runSimulation(steps: Int) async {
        for step in 0..<steps {
            // Each node processes received messages
            for node in nodes {
                await node.processInbox()
            }
            
            // Each node relays to connected peers
            for (i, j) in connections {
                await nodes[i].syncWith(nodes[j])
                await nodes[j].syncWith(nodes[i])
            }
            
            // Log progress
            print("Step \(step): \(totalDelivered()) delivered")
        }
    }
    
    func totalDelivered() -> Int {
        nodes.reduce(0) { $0 + $1.deliveredCount }
    }
}
```

---

## 8. CI/CD Integration

### 8.1 GitHub Actions

```yaml
# .github/workflows/nodemode-tests.yml
name: Node Mode Tests

on:
  push:
    paths:
      - 'railgun-ios/RailGun/NodeMode/**'
      - 'railgun-android/app/src/main/java/com/railgun/android/nodemode/**'
  pull_request:
    paths:
      - 'railgun-ios/RailGun/NodeMode/**'
      - 'railgun-android/app/src/main/java/com/railgun/android/nodemode/**'

jobs:
  ios-unit-tests:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: Run iOS Unit Tests
        run: |
          cd railgun-ios
          xcodebuild test \
            -scheme RailGun \
            -destination 'platform=iOS Simulator,name=iPhone 15' \
            -only-testing:RailGunTests/NodeModeTests

  android-unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - name: Run Android Unit Tests
        run: |
          cd railgun-android
          ./gradlew testDebugUnitTest --tests "com.railgun.android.nodemode.*"

  integration-tests:
    needs: [ios-unit-tests, android-unit-tests]
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: Start iOS Simulators
        run: |
          xcrun simctl create "NodeA" "iPhone 15"
          xcrun simctl create "NodeB" "iPhone 15"
          xcrun simctl boot "NodeA"
          xcrun simctl boot "NodeB"
      - name: Run Integration Tests
        run: |
          cd railgun-ios
          xcodebuild test \
            -scheme RailGun \
            -only-testing:RailGunIntegrationTests/NodeModeIntegrationTests
```

### 8.2 Test Reporting

```yaml
# Test report configuration
test-reporting:
  format: junit
  output: test-results/
  coverage:
    enabled: true
    threshold: 80%
    fail-below: true
```

---

## 9. Test Data Management

### 9.1 Fixtures

```swift
// iOS - TestFixtures.swift
enum TestFixtures {
    static let nodeId = Data(repeating: 0x01, count: 32)
    static let userId = Data(repeating: 0x02, count: 32)
    static let signature = Data(repeating: 0x03, count: 64)
    
    static func makeBundle(
        id: UUID = UUID(),
        priority: Bundle.Priority = .normal,
        hopCount: Int = 0,
        maxHops: Int = 10,
        payloadSize: Int = 100,
        state: Bundle.State = .pending,
        expiresAt: Date = Date().addingTimeInterval(3600)
    ) -> Bundle {
        Bundle(
            id: id,
            version: 1,
            flags: .encrypted,
            priority: priority,
            hopCount: hopCount,
            maxHops: maxHops,
            createdAt: Date(),
            expiresAt: expiresAt,
            sourceNode: nodeId,
            destinationType: .user,
            destination: userId,
            payload: Data(repeating: 0xAB, count: payloadSize),
            signature: signature,
            state: state
        )
    }
    
    static func makeNode(
        id: String = UUID().uuidString,
        reputation: Double = 0.5
    ) -> Node {
        Node(
            nodeId: id,
            capabilities: [.canRelay, .canStore],
            firstSeen: Date(),
            lastSeen: Date(),
            reputation: reputation
        )
    }
}
```

### 9.2 Test Vectors

```json
// test-vectors.json
{
  "bundles": [
    {
      "description": "Minimal valid bundle",
      "protobuf_base64": "CgQBAgME...",
      "expected": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "version": 1,
        "priority": 1
      }
    },
    {
      "description": "Bundle with max hops",
      "protobuf_base64": "...",
      "expected": {
        "hopCount": 10,
        "maxHops": 10
      }
    }
  ],
  "bloom_filters": [
    {
      "description": "1000 elements, 1% FPR",
      "expected_size_bytes": 1198,
      "expected_hash_count": 7
    }
  ]
}
```

---

## 10. Acceptance Criteria

### 10.1 MVP Release Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Unit test coverage | >80% | Code coverage report |
| Integration tests passing | 100% | CI pipeline |
| Direct message latency | <5s | Performance benchmark |
| 2-hop delivery rate | >95% | E2E test suite |
| Battery drain (background) | <5%/hr | Battery profiler |
| Memory usage | <50MB | Memory profiler |
| Crash-free rate | >99.5% | Crash reporting |

### 10.2 Sign-off Checklist

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Performance benchmarks within targets
- [ ] Security tests passing
- [ ] Memory leak tests passing
- [ ] Battery profiling acceptable
- [ ] Cross-platform interop verified
- [ ] Multi-device mesh tests passing
- [ ] QA manual testing complete
- [ ] Documentation reviewed

---

*This test plan will be updated as development progresses and new test scenarios are identified.*
