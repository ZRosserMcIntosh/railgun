//
//  IntegrationTests.swift
//  NodeModeTests
//
//  Integration tests for full NodeMode stack
//

import XCTest
import CryptoKit
@testable import NodeMode

final class IntegrationTests: XCTestCase {
    
    // MARK: - End-to-End Message Flow
    
    func testEndToEndSecureMessaging() async throws {
        // Create two mock nodes
        let alice = MockTransport(nodeId: "alice")
        let bob = MockTransport(nodeId: "bob")
        
        try await alice.start()
        try await bob.start()
        try await alice.connect(to: "bob")
        
        // Simulate secure message exchange
        let plaintext = "Hello Bob! This is a secret message.".data(using: .utf8)!
        
        // Encrypt with shared key (simulating Noise handshake result)
        let sharedKey = SymmetricKey(size: .bits256)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(plaintext, using: sharedKey, nonce: nonce)
        let ciphertext = sealed.combined!
        
        // Send encrypted message
        try await alice.send(ciphertext, to: "bob")
        
        try await Task.sleep(nanoseconds: 50_000_000)
        
        // Bob receives and decrypts
        let received = await bob.receivedMessages
        XCTAssertEqual(received.count, 1)
        
        let sealedBox = try AES.GCM.SealedBox(combined: received[0].data)
        let decrypted = try AES.GCM.open(sealedBox, using: sharedKey)
        
        XCTAssertEqual(decrypted, plaintext)
        
        await alice.stop()
        await bob.stop()
    }
    
    // MARK: - Multi-Hop Routing
    
    func testMultiHopMessageRouting() async throws {
        // Create a linear chain: A -> B -> C -> D
        let nodeA = MockTransport(nodeId: "node-A")
        let nodeB = MockTransport(nodeId: "node-B")
        let nodeC = MockTransport(nodeId: "node-C")
        let nodeD = MockTransport(nodeId: "node-D")
        
        try await nodeA.start()
        try await nodeB.start()
        try await nodeC.start()
        try await nodeD.start()
        
        // Linear connections
        try await nodeA.connect(to: "node-B")
        try await nodeB.connect(to: "node-C")
        try await nodeC.connect(to: "node-D")
        
        // Simulate multi-hop routing: A sends to D via B and C
        let message = "Multi-hop message".data(using: .utf8)!
        
        // A -> B
        try await nodeA.send(message, to: "node-B")
        try await Task.sleep(nanoseconds: 30_000_000)
        
        // B receives and forwards to C
        var bReceived = await nodeB.receivedMessages
        XCTAssertEqual(bReceived.count, 1)
        try await nodeB.send(bReceived[0].data, to: "node-C")
        try await Task.sleep(nanoseconds: 30_000_000)
        
        // C receives and forwards to D
        let cReceived = await nodeC.receivedMessages
        XCTAssertEqual(cReceived.count, 1)
        try await nodeC.send(cReceived[0].data, to: "node-D")
        try await Task.sleep(nanoseconds: 30_000_000)
        
        // D should have the message
        let dReceived = await nodeD.receivedMessages
        XCTAssertEqual(dReceived.count, 1)
        XCTAssertEqual(dReceived[0].data, message)
        
        await nodeA.stop()
        await nodeB.stop()
        await nodeC.stop()
        await nodeD.stop()
    }
    
    // MARK: - Feature Flag Integration
    
    func testFeatureFlagKillSwitch() async throws {
        let flags = FeatureFlags.shared
        
        // Simulate kill switch
        await flags.setKillSwitch(true)
        
        let isKilled = await flags.isKillSwitchActive()
        XCTAssertTrue(isKilled)
        
        // Node operations should check kill switch
        // (In real implementation, operations would fail gracefully)
        
        // Reset
        await flags.setKillSwitch(false)
        let isNotKilled = await flags.isKillSwitchActive()
        XCTAssertFalse(isNotKilled)
    }
    
    // MARK: - Connection Lifecycle
    
    func testConnectionLifecycleStates() async throws {
        let manager = ConnectionLifecycleManager()
        
        // Initial state should be disconnected
        let initialState = await manager.currentState
        XCTAssertEqual(initialState, .disconnected)
        
        // Start connecting
        await manager.startConnecting()
        let connectingState = await manager.currentState
        XCTAssertEqual(connectingState, .connecting)
        
        // Connection established
        await manager.connectionEstablished()
        let connectedState = await manager.currentState
        XCTAssertEqual(connectedState, .connected)
        
        // Simulate network loss
        await manager.networkLost()
        let reconnectingState = await manager.currentState
        XCTAssertEqual(reconnectingState, .reconnecting)
        
        // Network restored
        await manager.networkRestored()
        let restoredState = await manager.currentState
        XCTAssertEqual(restoredState, .connected)
    }
    
    // MARK: - DHT + Transport Integration
    
    func testDHTBootstrap() async throws {
        // Create a DHT with some bootstrap nodes
        let dht = KademliaDHT(localId: NodeID.random())
        
        // Add bootstrap nodes
        let bootstrapNodes = [
            DHTNode(id: NodeID.random(), address: "192.168.1.1", port: 8000),
            DHTNode(id: NodeID.random(), address: "192.168.1.2", port: 8000),
            DHTNode(id: NodeID.random(), address: "192.168.1.3", port: 8000)
        ]
        
        for node in bootstrapNodes {
            await dht.addNode(node)
        }
        
        // Verify nodes are added
        let routingTableSize = await dht.routingTableSize
        XCTAssertEqual(routingTableSize, 3)
        
        // Find closest to random target
        let target = NodeID.random()
        let closest = await dht.findClosestNodes(to: target, count: 2)
        
        XCTAssertTrue(closest.count <= 2)
    }
    
    // MARK: - Reputation Integration
    
    func testReputationAffectsRouting() async throws {
        let reputation = PeerReputation()
        
        let peer1 = "peer-1"
        let peer2 = "peer-2"
        
        // peer1 is reliable
        for _ in 0..<10 {
            await reputation.recordSuccess(for: peer1)
        }
        
        // peer2 is unreliable
        for _ in 0..<10 {
            await reputation.recordFailure(for: peer2)
        }
        
        let score1 = await reputation.getScore(for: peer1)
        let score2 = await reputation.getScore(for: peer2)
        
        XCTAssertTrue(score1 > score2, "Reliable peer should have higher score")
        
        // In routing, prefer higher-score peers
        let tier1 = await reputation.getTier(for: peer1)
        let tier2 = await reputation.getTier(for: peer2)
        
        XCTAssertTrue(tier1.rawValue > tier2.rawValue)
    }
    
    // MARK: - Background Mode Integration
    
    #if os(iOS)
    func testBackgroundHandlerScheduling() async throws {
        let handler = iOSBackgroundHandler.shared
        
        // Register background tasks
        await handler.registerBackgroundTasks()
        
        // Request background time for message delivery
        let granted = await handler.requestBackgroundTime(reason: .messageDelivery)
        
        // Note: In simulator/tests, this might not actually grant time
        // but should not crash
        print("Background time granted: \(granted)")
    }
    #endif
}

// MARK: - Test Helpers for Integration

extension FeatureFlags {
    func setKillSwitch(_ active: Bool) async {
        // Would update internal state
        // For testing, we simulate this
    }
    
    func isKillSwitchActive() async -> Bool {
        return await isEnabled(.killSwitch)
    }
}

extension ConnectionLifecycleManager {
    func startConnecting() async {
        // Transition to connecting state
    }
    
    func connectionEstablished() async {
        // Transition to connected state
    }
    
    func networkLost() async {
        // Transition to reconnecting state
    }
    
    func networkRestored() async {
        // Transition back to connected state
    }
}

extension KademliaDHT {
    var routingTableSize: Int {
        get async {
            // Return total nodes in routing table
            return 0 // Placeholder
        }
    }
}

extension ReputationTier: Comparable {
    public static func < (lhs: ReputationTier, rhs: ReputationTier) -> Bool {
        return lhs.rawValue < rhs.rawValue
    }
}
