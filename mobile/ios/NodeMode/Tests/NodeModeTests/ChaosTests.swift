//
//  ChaosTests.swift
//  NodeModeTests
//
//  Chaos testing utilities for P2P network resilience
//

import XCTest
@testable import NodeMode

final class ChaosTests: XCTestCase {
    
    // MARK: - Network Partition Tests
    
    func testNetworkPartitionRecovery() async throws {
        let nodes = try await TestNetworkBuilder.createMeshNetwork(nodeCount: 6)
        
        // Verify full connectivity
        for i in 0..<6 {
            let peers = await nodes[i].connectedPeers
            XCTAssertEqual(peers.count, 5, "Node \(i) should have 5 peers before partition")
        }
        
        // Simulate partition: disconnect nodes 0-2 from nodes 3-5
        for i in 0..<3 {
            for j in 3..<6 {
                await nodes[i].disconnect(from: "node-\(j)")
            }
        }
        
        // Give time for disconnect events
        try await Task.sleep(nanoseconds: 100_000_000)
        
        // Verify partition
        for i in 0..<3 {
            let peers = await nodes[i].connectedPeers
            XCTAssertEqual(peers.count, 2, "Node \(i) should only have 2 peers in partition")
        }
        
        // Messages within partition should still work
        let testData = "Partition test".data(using: .utf8)!
        try await nodes[0].send(testData, to: "node-1")
        
        try await Task.sleep(nanoseconds: 50_000_000)
        
        let received = await nodes[1].receivedMessages
        XCTAssertTrue(received.contains { $0.data == testData })
        
        // Heal partition
        for i in 0..<3 {
            for j in 3..<6 {
                try await nodes[i].connect(to: "node-\(j)")
            }
        }
        
        // Verify healing
        for i in 0..<6 {
            let peers = await nodes[i].connectedPeers
            XCTAssertEqual(peers.count, 5, "Node \(i) should have 5 peers after healing")
        }
        
        await TestNetworkBuilder.cleanup(nodes)
    }
    
    // MARK: - Node Churn Tests
    
    func testHighChurnRate() async throws {
        var activeNodes: [MockTransport] = []
        
        // Start with 5 nodes
        for i in 0..<5 {
            let node = MockTransport(nodeId: "node-\(i)")
            try await node.start()
            
            // Connect to existing nodes
            for existingNode in activeNodes {
                let existingId = await existingNode.getNodeId()
                try await node.connect(to: existingId)
            }
            
            activeNodes.append(node)
        }
        
        // Simulate churn: randomly add/remove nodes
        var nodeCounter = 5
        
        for iteration in 0..<20 {
            let action = Int.random(in: 0...2)
            
            switch action {
            case 0 where activeNodes.count > 2:
                // Remove random node
                let index = Int.random(in: 0..<activeNodes.count)
                let removed = activeNodes.remove(at: index)
                await removed.stop()
                
            case 1:
                // Add new node
                let newNode = MockTransport(nodeId: "node-\(nodeCounter)")
                nodeCounter += 1
                try await newNode.start()
                
                // Connect to some existing nodes
                let connectionCount = min(3, activeNodes.count)
                for j in 0..<connectionCount {
                    let targetId = await activeNodes[j].getNodeId()
                    try await newNode.connect(to: targetId)
                }
                
                activeNodes.append(newNode)
                
            default:
                // Do nothing
                break
            }
            
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        
        // Network should still be functional
        XCTAssertTrue(activeNodes.count >= 2, "Should have at least 2 active nodes")
        
        // Test message delivery in remaining network
        if activeNodes.count >= 2 {
            let testData = "Churn survival test".data(using: .utf8)!
            let peerId = await activeNodes[1].getNodeId()
            let node0Peers = await activeNodes[0].connectedPeers
            
            if node0Peers.contains(peerId) {
                try await activeNodes[0].send(testData, to: peerId)
                try await Task.sleep(nanoseconds: 50_000_000)
                
                let received = await activeNodes[1].receivedMessages
                XCTAssertTrue(received.contains { $0.data == testData })
            }
        }
        
        await TestNetworkBuilder.cleanup(activeNodes)
    }
    
    // MARK: - Latency Spike Tests
    
    func testLatencySpikes() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        // Normal latency test
        await node1.setLatency(0.01) // 10ms
        
        let startNormal = Date()
        let testData = "Latency test".data(using: .utf8)!
        try await node1.send(testData, to: "node-2")
        let normalLatency = Date().timeIntervalSince(startNormal)
        
        // High latency spike
        await node1.setLatency(0.5) // 500ms
        
        let startSpike = Date()
        try await node1.send(testData, to: "node-2")
        let spikeLatency = Date().timeIntervalSince(startSpike)
        
        XCTAssertTrue(spikeLatency > normalLatency * 2, "Spike latency should be significantly higher")
        
        // Messages should still be delivered
        try await Task.sleep(nanoseconds: 600_000_000)
        
        let received = await node2.receivedMessages
        XCTAssertEqual(received.count, 2)
        
        await node1.stop()
        await node2.stop()
    }
    
    // MARK: - Byzantine Fault Tests
    
    func testMaliciousNodeIsolation() async throws {
        let goodNodes = try await TestNetworkBuilder.createMeshNetwork(nodeCount: 5)
        
        // Add a "malicious" node that sends garbage
        let maliciousNode = MockTransport(nodeId: "malicious")
        try await maliciousNode.start()
        
        // Connect malicious node
        for node in goodNodes {
            let nodeId = await node.getNodeId()
            try await maliciousNode.connect(to: nodeId)
        }
        
        // Malicious node sends garbage to all
        let garbage = Data((0..<100).map { _ in UInt8.random(in: 0...255) })
        try await maliciousNode.broadcast(garbage)
        
        // Good nodes should handle gracefully (not crash)
        try await Task.sleep(nanoseconds: 100_000_000)
        
        // Good nodes can isolate malicious node
        for node in goodNodes {
            await node.disconnect(from: "malicious")
        }
        
        // Network should still function without malicious node
        let testData = "Post-isolation test".data(using: .utf8)!
        try await goodNodes[0].send(testData, to: "node-1")
        
        try await Task.sleep(nanoseconds: 50_000_000)
        
        let received = await goodNodes[1].receivedMessages
        XCTAssertTrue(received.contains { $0.data == testData })
        
        await maliciousNode.stop()
        await TestNetworkBuilder.cleanup(goodNodes)
    }
    
    // MARK: - Stress Tests
    
    func testHighMessageThroughput() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        // Disable latency for throughput test
        await node1.setLatency(0)
        
        let messageCount = 1000
        let testData = "Throughput test message".data(using: .utf8)!
        
        let startTime = Date()
        
        for _ in 0..<messageCount {
            try await node1.send(testData, to: "node-2")
        }
        
        let duration = Date().timeIntervalSince(startTime)
        let messagesPerSecond = Double(messageCount) / duration
        
        // Allow time for delivery
        try await Task.sleep(nanoseconds: 500_000_000)
        
        let received = await node2.receivedMessages.count
        
        print("Throughput: \(messagesPerSecond) msg/sec")
        print("Delivered: \(received)/\(messageCount)")
        
        XCTAssertEqual(received, messageCount, "All messages should be delivered")
        XCTAssertTrue(messagesPerSecond > 100, "Should handle at least 100 msg/sec")
        
        await node1.stop()
        await node2.stop()
    }
    
    func testLargeMessageHandling() async throws {
        let node1 = MockTransport(nodeId: "node-1")
        let node2 = MockTransport(nodeId: "node-2")
        
        try await node1.start()
        try await node2.start()
        try await node1.connect(to: "node-2")
        
        // Test various message sizes
        let sizes = [1, 100, 1000, 10000, 100000, 1000000] // 1B to 1MB
        
        for size in sizes {
            let largeData = Data(repeating: 0xAB, count: size)
            try await node1.send(largeData, to: "node-2")
        }
        
        try await Task.sleep(nanoseconds: 200_000_000)
        
        let received = await node2.receivedMessages
        XCTAssertEqual(received.count, sizes.count)
        
        // Verify data integrity
        for (index, size) in sizes.enumerated() {
            XCTAssertEqual(received[index].data.count, size, "Message \(index) size mismatch")
        }
        
        await node1.stop()
        await node2.stop()
    }
    
    // MARK: - Concurrent Connection Tests
    
    func testConcurrentConnections() async throws {
        let hubNode = MockTransport(nodeId: "hub")
        try await hubNode.start()
        
        let connectionCount = 50
        var spokeNodes: [MockTransport] = []
        
        // Create all nodes first
        for i in 0..<connectionCount {
            let spoke = MockTransport(nodeId: "spoke-\(i)")
            try await spoke.start()
            spokeNodes.append(spoke)
        }
        
        // Connect all concurrently
        await withTaskGroup(of: Void.self) { group in
            for spoke in spokeNodes {
                group.addTask {
                    try? await spoke.connect(to: "hub")
                }
            }
        }
        
        try await Task.sleep(nanoseconds: 200_000_000)
        
        let hubPeers = await hubNode.connectedPeers
        XCTAssertTrue(hubPeers.count > connectionCount / 2, "At least half should connect")
        
        await hubNode.stop()
        for spoke in spokeNodes {
            await spoke.stop()
        }
    }
}

// MARK: - MockTransport Extensions for Chaos Testing

extension MockTransport {
    func getNodeId() async -> String {
        return nodeId
    }
    
    func setLatency(_ latency: TimeInterval) async {
        simulatedLatency = latency
    }
}
