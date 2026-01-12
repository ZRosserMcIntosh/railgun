import XCTest
@testable import NodeMode

final class BloomFilterTests: XCTestCase {
    
    func testBasicInsertion() throws {
        let filter = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        filter.add("test-item-1")
        filter.add("test-item-2")
        filter.add("test-item-3")
        
        XCTAssertTrue(filter.mightContain("test-item-1"))
        XCTAssertTrue(filter.mightContain("test-item-2"))
        XCTAssertTrue(filter.mightContain("test-item-3"))
    }
    
    func testItemNotPresent() throws {
        let filter = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        filter.add("exists")
        
        // This might occasionally fail due to false positives, but unlikely with low fill rate
        XCTAssertFalse(filter.mightContain("does-not-exist"))
    }
    
    func testByteArrayInsertion() throws {
        let filter = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        let data1 = Data([0x01, 0x02, 0x03, 0x04])
        let data2 = Data([0x05, 0x06, 0x07, 0x08])
        
        filter.add(data1)
        
        XCTAssertTrue(filter.mightContain(data1))
        XCTAssertFalse(filter.mightContain(data2))
    }
    
    func testSerialization() throws {
        let filter = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        filter.add("item-1")
        filter.add("item-2")
        filter.add("item-3")
        
        // Serialize
        let data = filter.toData()
        XCTAssertNotNil(data)
        
        // Deserialize
        let restored = BloomFilter.fromData(data!)
        XCTAssertNotNil(restored)
        
        // Verify items are still present
        XCTAssertTrue(restored!.mightContain("item-1"))
        XCTAssertTrue(restored!.mightContain("item-2"))
        XCTAssertTrue(restored!.mightContain("item-3"))
    }
    
    func testApproximateCount() throws {
        let filter = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        for i in 0..<100 {
            filter.add("item-\(i)")
        }
        
        let count = filter.approximateCount()
        // Should be approximately 100, with some error margin
        XCTAssertGreaterThan(count, 80)
        XCTAssertLessThan(count, 150)
    }
    
    func testClear() throws {
        let filter = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        filter.add("test-item")
        XCTAssertTrue(filter.mightContain("test-item"))
        XCTAssertFalse(filter.isEmpty)
        
        filter.clear()
        
        // After clearing, the item should not be found (unless false positive)
        // This test verifies the clear operation worked
        XCTAssertTrue(filter.isEmpty)
    }
    
    func testUnion() throws {
        let filter1 = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        let filter2 = BloomFilter(expectedItems: 1000, falsePositiveRate: 0.01)
        
        filter1.add("filter1-item")
        filter2.add("filter2-item")
        
        filter1.union(with: filter2)
        
        XCTAssertTrue(filter1.mightContain("filter1-item"))
        XCTAssertTrue(filter1.mightContain("filter2-item"))
    }
}

final class BundleTests: XCTestCase {
    
    func testBundleCreation() throws {
        let sourceId = Data(repeating: 0x01, count: 32)
        let destId = Data(repeating: 0x02, count: 32)
        let payload = "Hello, Node Mode!".data(using: .utf8)!
        
        let bundle = Bundle(
            id: "test-bundle-id",
            sourceNodeId: sourceId,
            destinationNodeId: destId,
            payload: payload
        )
        
        XCTAssertEqual(bundle.id, "test-bundle-id")
        XCTAssertEqual(bundle.sourceNodeId, sourceId)
        XCTAssertEqual(bundle.destinationNodeId, destId)
        XCTAssertEqual(bundle.payload, payload)
        XCTAssertEqual(bundle.hopCount, 0)
        XCTAssertFalse(bundle.isExpired)
    }
    
    func testBundleSerialization() throws {
        let sourceId = Data(repeating: 0x01, count: 32)
        let destId = Data(repeating: 0x02, count: 32)
        let payload = "Test payload data".data(using: .utf8)!
        
        let original = Bundle(
            id: "serialization-test",
            sourceNodeId: sourceId,
            destinationNodeId: destId,
            payload: payload,
            priority: .high,
            flags: BundleFlags(
                encrypted: true,
                compressed: false,
                acknowledgmentRequested: true,
                routingHints: false
            )
        )
        
        let serialized = original.serialize()
        let deserialized = Bundle.deserialize(from: serialized)
        
        XCTAssertNotNil(deserialized)
        XCTAssertEqual(deserialized?.id, original.id)
        XCTAssertEqual(deserialized?.sourceNodeId, original.sourceNodeId)
        XCTAssertEqual(deserialized?.destinationNodeId, original.destinationNodeId)
        XCTAssertEqual(deserialized?.payload, original.payload)
        XCTAssertEqual(deserialized?.priority, original.priority)
        XCTAssertEqual(deserialized?.flags.encrypted, original.flags.encrypted)
        XCTAssertEqual(deserialized?.flags.acknowledgmentRequested, original.flags.acknowledgmentRequested)
    }
    
    func testBundleHopIncrement() throws {
        let sourceId = Data(repeating: 0x01, count: 32)
        let destId = Data(repeating: 0x02, count: 32)
        let relayId = Data(repeating: 0x03, count: 32)
        
        var bundle = Bundle(
            id: "hop-test",
            sourceNodeId: sourceId,
            destinationNodeId: destId,
            payload: Data()
        )
        
        XCTAssertEqual(bundle.hopCount, 0)
        XCTAssertTrue(bundle.hopPath.isEmpty)
        
        bundle = bundle.incrementHop(relayNodeId: relayId)
        
        XCTAssertEqual(bundle.hopCount, 1)
        XCTAssertEqual(bundle.hopPath.count, 1)
        XCTAssertEqual(bundle.hopPath.first, relayId)
    }
    
    func testBundleExpiration() throws {
        let sourceId = Data(repeating: 0x01, count: 32)
        let destId = Data(repeating: 0x02, count: 32)
        
        // Create bundle that expires in the past
        let expiredBundle = Bundle(
            id: "expired-test",
            sourceNodeId: sourceId,
            destinationNodeId: destId,
            payload: Data(),
            expiresAt: Date().addingTimeInterval(-3600) // 1 hour ago
        )
        
        XCTAssertTrue(expiredBundle.isExpired)
        
        // Create bundle that expires in the future
        let validBundle = Bundle(
            id: "valid-test",
            sourceNodeId: sourceId,
            destinationNodeId: destId,
            payload: Data(),
            expiresAt: Date().addingTimeInterval(3600) // 1 hour from now
        )
        
        XCTAssertFalse(validBundle.isExpired)
    }
}

final class NodeTests: XCTestCase {
    
    func testNodeCreation() throws {
        let nodeId = Data(repeating: 0xAB, count: 32)
        let publicKey = Data(repeating: 0xCD, count: 32)
        
        let node = Node(
            id: nodeId,
            publicKey: publicKey,
            displayName: "Test Node"
        )
        
        XCTAssertEqual(node.id, nodeId)
        XCTAssertEqual(node.publicKey, publicKey)
        XCTAssertEqual(node.displayName, "Test Node")
        XCTAssertTrue(node.capabilities.isRelay)
        XCTAssertTrue(node.capabilities.canStoreBundles)
    }
    
    func testNodeCapabilities() throws {
        var capabilities = NodeCapabilities()
        
        XCTAssertTrue(capabilities.isRelay)
        XCTAssertTrue(capabilities.canStoreBundles)
        XCTAssertFalse(capabilities.hasInternet)
        XCTAssertFalse(capabilities.isGateway)
        
        // Modify capabilities
        capabilities = NodeCapabilities(
            isRelay: false,
            canStoreBundles: true,
            hasInternet: true,
            isGateway: true
        )
        
        XCTAssertFalse(capabilities.isRelay)
        XCTAssertTrue(capabilities.hasInternet)
        XCTAssertTrue(capabilities.isGateway)
    }
    
    func testNodeSupportedTransports() throws {
        var node = Node(
            id: Data(repeating: 0x01, count: 32),
            publicKey: Data(repeating: 0x02, count: 32)
        )
        
        node.addTransport(.ble)
        node.addTransport(.wifiDirect)
        
        XCTAssertTrue(node.supportsTransport(.ble))
        XCTAssertTrue(node.supportsTransport(.wifiDirect))
        XCTAssertFalse(node.supportsTransport(.lan))
    }
}

final class NodeModeConfigTests: XCTestCase {
    
    func testDefaultConfig() throws {
        let config = NodeModeConfig.default
        
        XCTAssertTrue(config.enableBLE)
        XCTAssertFalse(config.enableWifiDirect)
        XCTAssertEqual(config.maxStoredBundles, 1000)
        XCTAssertEqual(config.bundleTTLHours, 72)
        XCTAssertEqual(config.maxHops, 10)
        XCTAssertTrue(config.forwardingEnabled)
    }
    
    func testConfigSerialization() throws {
        let original = NodeModeConfig(
            enableBLE: false,
            enableWifiDirect: true,
            maxStoredBundles: 500,
            bundleTTLHours: 48,
            maxHops: 5,
            forwardingEnabled: false
        )
        
        let encoder = JSONEncoder()
        let data = try encoder.encode(original)
        
        let decoder = JSONDecoder()
        let decoded = try decoder.decode(NodeModeConfig.self, from: data)
        
        XCTAssertEqual(decoded.enableBLE, original.enableBLE)
        XCTAssertEqual(decoded.enableWifiDirect, original.enableWifiDirect)
        XCTAssertEqual(decoded.maxStoredBundles, original.maxStoredBundles)
        XCTAssertEqual(decoded.bundleTTLHours, original.bundleTTLHours)
        XCTAssertEqual(decoded.maxHops, original.maxHops)
        XCTAssertEqual(decoded.forwardingEnabled, original.forwardingEnabled)
    }
}
