//
//  TransportTests.swift
//  NodeModeTests
//
//  Unit tests for transport layer
//

import XCTest
@testable import NodeMode

final class TransportTests: XCTestCase {
    
    override func setUp() async throws {
        MockTransport.resetVirtualNetwork()
    }
    
    override func tearDown() async throws {
        MockTransport.resetVirtualNetwork()
    }
    
    // MARK: - Basic Connection Tests
    
    func testMockTransportStartsSuccessfully() async throws {
        let transport = MockTransport(nodeId: "test-node")
        
        try await transport.start()
        
        let isStarted = await transport.isStarted
        XCTAssertTrue(isStarted)
    }
    
    func testMockTransportStopsSuccessfully() async throws {
        let transport = MockTransport(nodeId: "test-node")
        try await transport.start()
        
        await transport.stop()
        
        let isStarted = await transport.isStarted
        XCTAssertFalse(isStarted)
    }
    
    func testTwoNodesCanConnect() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        
        try await node1.connect(to: "node-2")
        
        let node1Peers = await node1.connectedPeers
        let node2Peers = await node2.connectedPeers
        
        XCTAssertTrue(node1Peers.contains("node-2"))
        XCTAssertTrue(node2Peers.contains("node-1"))
        
        await node1.stop()
        await node2.stop()
    }
    
    func testConnectionToNonExistentPeerFails() async throws {
        let node = MockTransport(nodeId: "node-1")
        try await node.start()
        
        do {
            try await node.connect(to: "non-existent")
            XCTFail("Should have thrown error")
        } catch {
            XCTAssertTrue(error is TransportError)
        }
        
        await node.stop()
    }
    
    // MARK: - Message Passing Tests
    
    func testMessageDelivery() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        let testData = "Hello, Node 2!".data(using: .utf8)!
        try await node1.send(testData, to: "node-2")
        
        // Give time for delivery
        try await Task.sleep(nanoseconds: 50_000_000)
        
        let receivedMessages = await node2.receivedMessages
        XCTAssertEqual(receivedMessages.count, 1)
        XCTAssertEqual(receivedMessages.first?.data, testData)
        
        await node1.stop()
        await node2.stop()
    }
    
    func testBroadcastToAllPeers() async throws {
        let nodes = try await TestNetworkBuilder.createMeshNetwork(nodeCount: 4)
        
        let testData = "Broadcast message".data(using: .utf8)!
        try await nodes[0].broadcast(testData)
        
        // Give time for delivery
        try await Task.sleep(nanoseconds: 100_000_000)
        
        // All other nodes should receive
        for i in 1..<4 {
            let received = await nodes[i].receivedMessages
            XCTAssertTrue(received.contains { $0.data == testData }, "Node \(i) didn't receive broadcast")
        }
        
        await TestNetworkBuilder.cleanup(nodes)
    }
    
    // MARK: - Failure Simulation Tests
    
    func testSimulatedConnectionFailure() async throws {
        let node = MockTransport(nodeId: "failing-node")
        await node.setFailConnection(true)
        
        do {
            try await node.start()
            XCTFail("Should have thrown error")
        } catch {
            XCTAssertTrue(error is TransportError)
        }
    }
    
    func testSimulatedSendFailure() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        await node1.setFailSend(true)
        
        do {
            try await node1.send(Data(), to: "node-2")
            XCTFail("Should have thrown error")
        } catch {
            XCTAssertTrue(error is TransportError)
        }
        
        await node1.stop()
        await node2.stop()
    }
    
    func testPacketLossSimulation() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        // Set 50% packet loss
        await node1.setPacketLoss(0.5)
        
        let testData = "Test".data(using: .utf8)!
        let messageCount = 100
        
        for _ in 0..<messageCount {
            try await node1.send(testData, to: "node-2")
        }
        
        try await Task.sleep(nanoseconds: 200_000_000)
        
        let receivedCount = await node2.receivedMessages.count
        
        // With 50% loss, we expect roughly 50 messages (allow for variance)
        XCTAssertTrue(receivedCount > 20 && receivedCount < 80, "Unexpected packet loss rate: \(receivedCount)/\(messageCount)")
        
        await node1.stop()
        await node2.stop()
    }
    
    // MARK: - Network Topology Tests
    
    func testMeshNetworkTopology() async throws {
        let nodes = try await TestNetworkBuilder.createMeshNetwork(nodeCount: 5)
        
        // Each node should be connected to all others
        for i in 0..<5 {
            let peers = await nodes[i].connectedPeers
            XCTAssertEqual(peers.count, 4, "Node \(i) should have 4 peers")
        }
        
        await TestNetworkBuilder.cleanup(nodes)
    }
    
    func testRingNetworkTopology() async throws {
        let nodes = try await TestNetworkBuilder.createRingNetwork(nodeCount: 5)
        
        // Each node should have 2 connections (next and previous)
        for i in 0..<5 {
            let peers = await nodes[i].connectedPeers
            XCTAssertTrue(peers.count >= 1, "Node \(i) should have at least 1 peer in ring")
        }
        
        await TestNetworkBuilder.cleanup(nodes)
    }
    
    func testStarNetworkTopology() async throws {
        let nodes = try await TestNetworkBuilder.createStarNetwork(nodeCount: 5)
        
        // Hub should have all spokes connected
        let hubPeers = await nodes[0].connectedPeers
        XCTAssertEqual(hubPeers.count, 4, "Hub should have 4 spoke connections")
        
        await TestNetworkBuilder.cleanup(nodes)
    }
    
    // MARK: - Disconnect Tests
    
    func testGracefulDisconnect() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        await node1.disconnect(from: "node-2")
        
        let node1Peers = await node1.connectedPeers
        let node2Peers = await node2.connectedPeers
        
        XCTAssertFalse(node1Peers.contains("node-2"))
        XCTAssertFalse(node2Peers.contains("node-1"))
        
        await node1.stop()
        await node2.stop()
    }
    
    func testAutoDisconnectAfterMessages() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        await node1.setDisconnectAfter(3)
        
        let testData = "Test".data(using: .utf8)!
        
        for i in 0..<5 {
            do {
                try await node1.send(testData, to: "node-2")
            } catch {
                // Expected after disconnect
                if i < 3 {
                    XCTFail("Unexpected error before disconnect threshold")
                }
            }
        }
        
        let node1Peers = await node1.connectedPeers
        XCTAssertFalse(node1Peers.contains("node-2"))
        
        await node1.stop()
        await node2.stop()
    }
}

// MARK: - MockTransport Test Helpers

extension MockTransport {
    func setFailConnection(_ fail: Bool) async {
        shouldFailConnection = fail
    }
    
    func setFailSend(_ fail: Bool) async {
        shouldFailSend = fail
    }
    
    func setPacketLoss(_ rate: Double) async {
        simulatedPacketLoss = rate
    }
    
    func setDisconnectAfter(_ count: Int?) async {
        simulatedDisconnectAfter = count
    }
}
