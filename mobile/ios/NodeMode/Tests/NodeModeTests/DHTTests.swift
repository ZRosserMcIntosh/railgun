//
//  DHTTests.swift
//  NodeModeTests
//
//  Unit tests for Kademlia DHT implementation
//

import XCTest
@testable import NodeMode

final class DHTTests: XCTestCase {
    
    // MARK: - NodeID Tests
    
    func testNodeIDCreation() {
        let id1 = NodeID.random()
        let id2 = NodeID.random()
        
        XCTAssertNotEqual(id1.bytes, id2.bytes)
        XCTAssertEqual(id1.bytes.count, 32) // 256 bits
    }
    
    func testNodeIDFromData() {
        let data = Data(repeating: 0xAB, count: 32)
        let id = NodeID(bytes: data)
        
        XCTAssertEqual(id.bytes, data)
    }
    
    func testXORDistance() {
        let id1 = NodeID(bytes: Data(repeating: 0x00, count: 32))
        let id2 = NodeID(bytes: Data(repeating: 0xFF, count: 32))
        
        let distance = id1.xorDistance(to: id2)
        
        // All 1s XOR all 0s = all 1s (maximum distance)
        XCTAssertEqual(distance, Data(repeating: 0xFF, count: 32))
    }
    
    func testXORDistanceSameNode() {
        let id = NodeID.random()
        let distance = id.xorDistance(to: id)
        
        // Same ID XOR = all zeros
        XCTAssertEqual(distance, Data(repeating: 0x00, count: 32))
    }
    
    func testBucketIndex() {
        let id1 = NodeID(bytes: Data(repeating: 0x00, count: 32))
        
        // ID with highest bit set
        var highBitData = Data(repeating: 0x00, count: 32)
        highBitData[0] = 0x80
        let id2 = NodeID(bytes: highBitData)
        
        let bucketIndex = id1.bucketIndex(for: id2)
        XCTAssertEqual(bucketIndex, 255) // Highest bit difference = bucket 255
    }
    
    // MARK: - K-Bucket Tests
    
    func testKBucketAddNode() async {
        let bucket = KBucket(k: 20)
        
        let node = DHTNode(
            id: NodeID.random(),
            address: "192.168.1.1",
            port: 8000
        )
        
        await bucket.addNode(node)
        
        let nodes = await bucket.nodes
        XCTAssertEqual(nodes.count, 1)
        XCTAssertEqual(nodes.first?.id, node.id)
    }
    
    func testKBucketMaxSize() async {
        let k = 5
        let bucket = KBucket(k: k)
        
        // Add more than k nodes
        for i in 0..<10 {
            let node = DHTNode(
                id: NodeID.random(),
                address: "192.168.1.\(i)",
                port: 8000
            )
            await bucket.addNode(node)
        }
        
        let nodes = await bucket.nodes
        XCTAssertEqual(nodes.count, k) // Should not exceed k
    }
    
    func testKBucketMoveToTail() async {
        let bucket = KBucket(k: 20)
        
        let node1 = DHTNode(id: NodeID.random(), address: "1.1.1.1", port: 8000)
        let node2 = DHTNode(id: NodeID.random(), address: "2.2.2.2", port: 8000)
        
        await bucket.addNode(node1)
        await bucket.addNode(node2)
        
        // Re-add node1 (should move to tail as most recently seen)
        await bucket.addNode(node1)
        
        let nodes = await bucket.nodes
        XCTAssertEqual(nodes.last?.id, node1.id)
    }
    
    // MARK: - DHT Routing Table Tests
    
    func testDHTFindClosestNodes() async throws {
        let dht = KademliaDHT(localId: NodeID.random())
        
        // Add some nodes
        for i in 0..<50 {
            let node = DHTNode(
                id: NodeID.random(),
                address: "192.168.1.\(i % 256)",
                port: 8000 + i
            )
            await dht.addNode(node)
        }
        
        let targetId = NodeID.random()
        let closest = await dht.findClosestNodes(to: targetId, count: 10)
        
        XCTAssertTrue(closest.count <= 10)
        
        // Verify sorting by distance
        for i in 0..<(closest.count - 1) {
            let dist1 = targetId.xorDistance(to: closest[i].id)
            let dist2 = targetId.xorDistance(to: closest[i + 1].id)
            XCTAssertTrue(dist1 <= dist2, "Nodes not sorted by distance")
        }
    }
    
    func testDHTNodeLookup() async throws {
        // Create a small network of DHTs
        let nodeCount = 10
        var dhts: [KademliaDHT] = []
        
        for _ in 0..<nodeCount {
            let dht = KademliaDHT(localId: NodeID.random())
            dhts.append(dht)
        }
        
        // Connect all nodes to each other
        for i in 0..<nodeCount {
            for j in 0..<nodeCount where i != j {
                let node = DHTNode(
                    id: await dhts[j].localId,
                    address: "192.168.1.\(j)",
                    port: 8000 + j
                )
                await dhts[i].addNode(node)
            }
        }
        
        // Lookup a random target
        let targetId = NodeID.random()
        let result = await dhts[0].findClosestNodes(to: targetId, count: 5)
        
        XCTAssertTrue(result.count > 0)
    }
    
    // MARK: - Peer Reputation Tests
    
    func testReputationInitialScore() async {
        let reputation = PeerReputation()
        let peerId = "test-peer"
        
        let score = await reputation.getScore(for: peerId)
        XCTAssertEqual(score, 50) // Default initial score
    }
    
    func testReputationIncrease() async {
        let reputation = PeerReputation()
        let peerId = "test-peer"
        
        await reputation.recordSuccess(for: peerId)
        await reputation.recordSuccess(for: peerId)
        
        let score = await reputation.getScore(for: peerId)
        XCTAssertTrue(score > 50)
    }
    
    func testReputationDecrease() async {
        let reputation = PeerReputation()
        let peerId = "test-peer"
        
        await reputation.recordFailure(for: peerId)
        await reputation.recordFailure(for: peerId)
        
        let score = await reputation.getScore(for: peerId)
        XCTAssertTrue(score < 50)
    }
    
    func testReputationTiers() async {
        let reputation = PeerReputation()
        let peerId = "test-peer"
        
        // Initial tier should be neutral
        let initialTier = await reputation.getTier(for: peerId)
        XCTAssertEqual(initialTier, .neutral)
        
        // Many successes should increase tier
        for _ in 0..<20 {
            await reputation.recordSuccess(for: peerId)
        }
        
        let highTier = await reputation.getTier(for: peerId)
        XCTAssertTrue(highTier == .reliable || highTier == .trusted)
    }
    
    func testReputationBounds() async {
        let reputation = PeerReputation()
        let peerId = "test-peer"
        
        // Many failures
        for _ in 0..<100 {
            await reputation.recordFailure(for: peerId)
        }
        
        let lowScore = await reputation.getScore(for: peerId)
        XCTAssertTrue(lowScore >= 0, "Score should not go below 0")
        
        // Many successes
        for _ in 0..<200 {
            await reputation.recordSuccess(for: peerId)
        }
        
        let highScore = await reputation.getScore(for: peerId)
        XCTAssertTrue(highScore <= 100, "Score should not exceed 100")
    }
    
    // MARK: - Rendezvous Protocol Tests
    
    func testRendezvousTopicHash() {
        let topic1 = "chat:general"
        let topic2 = "chat:general"
        let topic3 = "chat:private"
        
        let hash1 = RendezvousPoint.topicHash(topic1)
        let hash2 = RendezvousPoint.topicHash(topic2)
        let hash3 = RendezvousPoint.topicHash(topic3)
        
        XCTAssertEqual(hash1, hash2, "Same topic should produce same hash")
        XCTAssertNotEqual(hash1, hash3, "Different topics should produce different hashes")
    }
    
    func testRendezvousRegistration() async throws {
        let rendezvous = RendezvousProtocol()
        let dht = KademliaDHT(localId: NodeID.random())
        
        await rendezvous.setDHT(dht)
        
        let topic = "test-topic"
        let peerId = "test-peer"
        let signingKey = Curve25519.Signing.PrivateKey()
        let publicKey = Curve25519.KeyAgreement.PrivateKey().publicKey
        
        let registration = try await rendezvous.register(
            topic: topic,
            peerId: peerId,
            publicKey: publicKey,
            signingKey: signingKey
        )
        
        XCTAssertEqual(registration.topic, topic)
        XCTAssertEqual(registration.peerId, peerId)
        XCTAssertTrue(registration.expiresAt > Date())
    }
    
    func testRendezvousDiscovery() async throws {
        let rendezvous = RendezvousProtocol()
        let dht = KademliaDHT(localId: NodeID.random())
        
        await rendezvous.setDHT(dht)
        
        let topic = "discovery-test"
        
        // Register several peers
        for i in 0..<5 {
            let signingKey = Curve25519.Signing.PrivateKey()
            let publicKey = Curve25519.KeyAgreement.PrivateKey().publicKey
            
            _ = try await rendezvous.register(
                topic: topic,
                peerId: "peer-\(i)",
                publicKey: publicKey,
                signingKey: signingKey
            )
        }
        
        // Discover peers (local cache)
        let discovered = await rendezvous.getLocalRegistrations(for: topic)
        
        XCTAssertEqual(discovered.count, 5)
    }
}

// MARK: - Test Helpers

extension Data: Comparable {
    public static func < (lhs: Data, rhs: Data) -> Bool {
        let minCount = min(lhs.count, rhs.count)
        for i in 0..<minCount {
            if lhs[i] < rhs[i] { return true }
            if lhs[i] > rhs[i] { return false }
        }
        return lhs.count < rhs.count
    }
}
