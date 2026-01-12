//
//  MockTransport.swift
//  NodeMode
//
//  Mock transport for testing P2P functionality
//

import Foundation
import Combine

// Forward declaration - actual types come from NodeMode
public enum TransportType: Equatable {
    case ble
    case lan
    case multipeer
    case webSocket
    case custom(String)
}

public enum TransportEvent {
    case started
    case stopped
    case peerConnected(String)
    case peerDisconnected(String)
    case dataReceived(Data, from: String)
    case error(Error)
}

public enum TransportError: Error {
    case notConnected
    case peerNotFound
    case connectionFailed(String)
    case sendFailed(String)
    case timeout
}

public protocol Transport: Actor {
    var transportType: TransportType { get }
    var events: AnyPublisher<TransportEvent, Never> { get }
    
    func start() async throws
    func stop() async
    func connect(to peerId: String) async throws
    func disconnect(from peerId: String) async
    func send(_ data: Data, to peerId: String) async throws
    func broadcast(_ data: Data) async throws
}

/// Mock transport that simulates network behavior for testing
public actor MockTransport: Transport {
    public let transportType: TransportType = .custom("mock")
    
    // MARK: - Test Configuration
    
    public var simulatedLatency: TimeInterval = 0.01
    public var simulatedPacketLoss: Double = 0.0
    public var simulatedDisconnectAfter: Int? = nil
    public var shouldFailConnection: Bool = false
    public var shouldFailSend: Bool = false
    
    // MARK: - State Tracking
    
    private(set) var isStarted = false
    private(set) var connectedPeers: Set<String> = []
    private(set) var sentMessages: [(peerId: String, data: Data)] = []
    private(set) var receivedMessages: [(peerId: String, data: Data)] = []
    private var messageCounter = 0
    
    // MARK: - Virtual Network
    
    private static var virtualNetwork: [String: MockTransport] = [:]
    private static let networkLock = NSLock()
    
    public let nodeId: String
    private let eventsSubject = PassthroughSubject<TransportEvent, Never>()
    
    public nonisolated var events: AnyPublisher<TransportEvent, Never> {
        eventsSubject.eraseToAnyPublisher()
    }
    
    // MARK: - Initialization
    
    public init(nodeId: String = UUID().uuidString) {
        self.nodeId = nodeId
    }
    
    // MARK: - Transport Protocol
    
    public func start() async throws {
        guard !shouldFailConnection else {
            throw TransportError.connectionFailed("Simulated connection failure")
        }
        
        isStarted = true
        
        // Register in virtual network
        Self.networkLock.lock()
        Self.virtualNetwork[nodeId] = self
        Self.networkLock.unlock()
        
        eventsSubject.send(.started)
    }
    
    public func stop() async {
        isStarted = false
        
        // Notify connected peers of disconnect
        for peerId in connectedPeers {
            await notifyPeerOfDisconnect(peerId)
        }
        
        connectedPeers.removeAll()
        
        // Remove from virtual network
        Self.networkLock.lock()
        Self.virtualNetwork.removeValue(forKey: nodeId)
        Self.networkLock.unlock()
        
        eventsSubject.send(.stopped)
    }
    
    public func connect(to peerId: String) async throws {
        guard isStarted else {
            throw TransportError.notConnected
        }
        
        guard !shouldFailConnection else {
            throw TransportError.connectionFailed("Simulated connection failure")
        }
        
        // Simulate latency
        if simulatedLatency > 0 {
            try await Task.sleep(nanoseconds: UInt64(simulatedLatency * 1_000_000_000))
        }
        
        // Check if peer exists in virtual network
        Self.networkLock.lock()
        let peerTransport = Self.virtualNetwork[peerId]
        Self.networkLock.unlock()
        
        guard peerTransport != nil else {
            throw TransportError.peerNotFound
        }
        
        connectedPeers.insert(peerId)
        eventsSubject.send(.peerConnected(peerId))
        
        // Notify peer of connection
        await peerTransport?.handleIncomingConnection(from: nodeId)
    }
    
    public func disconnect(from peerId: String) async {
        guard connectedPeers.contains(peerId) else { return }
        
        connectedPeers.remove(peerId)
        eventsSubject.send(.peerDisconnected(peerId))
        
        await notifyPeerOfDisconnect(peerId)
    }
    
    public func send(_ data: Data, to peerId: String) async throws {
        guard isStarted else {
            throw TransportError.notConnected
        }
        
        guard connectedPeers.contains(peerId) else {
            throw TransportError.peerNotFound
        }
        
        guard !shouldFailSend else {
            throw TransportError.sendFailed("Simulated send failure")
        }
        
        // Simulate packet loss
        if simulatedPacketLoss > 0 && Double.random(in: 0...1) < simulatedPacketLoss {
            return // Packet "lost"
        }
        
        messageCounter += 1
        sentMessages.append((peerId, data))
        
        // Check for simulated disconnect
        if let disconnectAfter = simulatedDisconnectAfter, messageCounter >= disconnectAfter {
            await disconnect(from: peerId)
            return
        }
        
        // Simulate latency
        if simulatedLatency > 0 {
            try await Task.sleep(nanoseconds: UInt64(simulatedLatency * 1_000_000_000))
        }
        
        // Deliver to peer
        Self.networkLock.lock()
        let peerTransport = Self.virtualNetwork[peerId]
        Self.networkLock.unlock()
        
        await peerTransport?.handleIncomingData(data, from: nodeId)
    }
    
    public func broadcast(_ data: Data) async throws {
        for peerId in connectedPeers {
            try await send(data, to: peerId)
        }
    }
    
    // MARK: - Internal Handlers
    
    private func handleIncomingConnection(from peerId: String) {
        connectedPeers.insert(peerId)
        eventsSubject.send(.peerConnected(peerId))
    }
    
    private func handleIncomingData(_ data: Data, from peerId: String) {
        receivedMessages.append((peerId, data))
        eventsSubject.send(.dataReceived(data, from: peerId))
    }
    
    private func notifyPeerOfDisconnect(_ peerId: String) async {
        Self.networkLock.lock()
        let peerTransport = Self.virtualNetwork[peerId]
        Self.networkLock.unlock()
        
        await peerTransport?.handlePeerDisconnect(nodeId)
    }
    
    private func handlePeerDisconnect(_ peerId: String) {
        connectedPeers.remove(peerId)
        eventsSubject.send(.peerDisconnected(peerId))
    }
    
    // MARK: - Test Helpers
    
    public func reset() {
        sentMessages.removeAll()
        receivedMessages.removeAll()
        messageCounter = 0
    }
    
    public static func resetVirtualNetwork() {
        networkLock.lock()
        virtualNetwork.removeAll()
        networkLock.unlock()
    }
    
    public func injectMessage(_ data: Data, from peerId: String) {
        handleIncomingData(data, from: peerId)
    }
    
    public func simulateDisconnect(from peerId: String) {
        handlePeerDisconnect(peerId)
    }
}

// MARK: - Test Network Builder

/// Utility for creating test network topologies
public struct TestNetworkBuilder {
    public static func createMeshNetwork(nodeCount: Int) async throws -> [MockTransport] {
        var transports: [MockTransport] = []
        
        // Create nodes
        for i in 0..<nodeCount {
            let transport = MockTransport(nodeId: "node-\(i)")
            try await transport.start()
            transports.append(transport)
        }
        
        // Connect all to all (mesh)
        for i in 0..<nodeCount {
            for j in (i+1)..<nodeCount {
                try await transports[i].connect(to: "node-\(j)")
            }
        }
        
        return transports
    }
    
    public static func createRingNetwork(nodeCount: Int) async throws -> [MockTransport] {
        var transports: [MockTransport] = []
        
        // Create nodes
        for i in 0..<nodeCount {
            let transport = MockTransport(nodeId: "node-\(i)")
            try await transport.start()
            transports.append(transport)
        }
        
        // Connect in ring
        for i in 0..<nodeCount {
            let nextIndex = (i + 1) % nodeCount
            try await transports[i].connect(to: "node-\(nextIndex)")
        }
        
        return transports
    }
    
    public static func createStarNetwork(nodeCount: Int) async throws -> [MockTransport] {
        var transports: [MockTransport] = []
        
        // Create hub node
        let hub = MockTransport(nodeId: "hub")
        try await hub.start()
        transports.append(hub)
        
        // Create spoke nodes
        for i in 0..<(nodeCount - 1) {
            let spoke = MockTransport(nodeId: "spoke-\(i)")
            try await spoke.start()
            try await spoke.connect(to: "hub")
            transports.append(spoke)
        }
        
        return transports
    }
    
    public static func cleanup(_ transports: [MockTransport]) async {
        for transport in transports {
            await transport.stop()
        }
        MockTransport.resetVirtualNetwork()
    }
}
