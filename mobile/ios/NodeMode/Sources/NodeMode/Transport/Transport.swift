//
//  Transport.swift
//  RailGun Node Mode
//
//  Transport layer protocol and common types
//

import Foundation
import Combine

// MARK: - Transport State

public enum TransportState: Equatable {
    case idle
    case starting
    case running
    case stopping
    case error(String)
    
    public var isActive: Bool {
        switch self {
        case .running: return true
        default: return false
        }
    }
}

// MARK: - Peer Info

/// Information about a discovered mesh peer
public struct PeerInfo: Identifiable {
    /// Unique peer identifier (transport-specific)
    public let id: String
    
    /// Node ID (Ed25519 public key as hex, if known from handshake)
    public var nodeId: String?
    
    /// Transport type used to discover this peer
    public let transportType: TransportType
    
    /// Signal strength (RSSI for BLE, or estimated distance)
    public var signalStrength: Int?
    
    /// Peer display name (if advertised)
    public var displayName: String?
    
    /// Peer capabilities bitmask (from advertisement)
    public var capabilitiesRaw: UInt8?
    
    /// Discovery timestamp
    public let discoveredAt: Date
    
    /// Last seen timestamp
    public var lastSeenAt: Date
    
    /// Is currently connected
    public var isConnected: Bool = false
    
    public init(
        id: String,
        nodeId: String? = nil,
        transportType: TransportType,
        signalStrength: Int? = nil,
        displayName: String? = nil,
        capabilitiesRaw: UInt8? = nil
    ) {
        self.id = id
        self.nodeId = nodeId
        self.transportType = transportType
        self.signalStrength = signalStrength
        self.displayName = displayName
        self.capabilitiesRaw = capabilitiesRaw
        self.discoveredAt = Date()
        self.lastSeenAt = Date()
    }
}

// MARK: - Transport Type

public enum TransportType: String, Codable {
    case ble = "ble"
    case wifiDirect = "wifi_direct"
    case multipeer = "multipeer"
    case lan = "lan"
}

// MARK: - Transport Event

public enum TransportEvent {
    case stateChanged(TransportState)
    case peerDiscovered(PeerInfo)
    case peerLost(String) // peer id
    case peerConnected(PeerInfo)
    case peerDisconnected(String) // peer id
    case messageReceived(Data, from: String) // message data, peer id
    case messageSent(String, to: String) // message id, peer id
    case error(Error)
}

// MARK: - Transport Protocol

/// Protocol for mesh network transports (BLE, Wi-Fi Direct, etc.)
public protocol Transport: AnyObject {
    
    /// Transport type identifier
    var transportType: TransportType { get }
    
    /// Current transport state
    var state: TransportState { get }
    
    /// Publisher for transport events
    var events: AnyPublisher<TransportEvent, Never> { get }
    
    /// Currently discovered peers
    var discoveredPeers: [PeerInfo] { get }
    
    /// Currently connected peers
    var connectedPeers: [PeerInfo] { get }
    
    /// Start the transport (advertising and scanning)
    func start() async throws
    
    /// Stop the transport
    func stop() async
    
    /// Connect to a specific peer
    func connect(to peerId: String) async throws
    
    /// Disconnect from a peer
    func disconnect(from peerId: String) async
    
    /// Send data to a connected peer
    func send(_ data: Data, to peerId: String) async throws
    
    /// Send data to all connected peers
    func broadcast(_ data: Data) async throws
    
    /// Set the node ID for advertisement
    func setNodeId(_ nodeId: Data)
    
    /// Set display name for advertisement
    func setDisplayName(_ name: String)
}

// MARK: - Transport Manager

/// Manages multiple transport layers and provides unified interface
public actor TransportManager {
    
    // MARK: - Properties
    
    private var transports: [TransportType: Transport] = [:]
    private var nodeId: Data?
    private var displayName: String?
    
    private let eventsSubject = PassthroughSubject<TransportEvent, Never>()
    public var events: AnyPublisher<TransportEvent, Never> {
        eventsSubject.eraseToAnyPublisher()
    }
    
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    public init() {}
    
    // MARK: - Registration
    
    /// Register a transport
    public func register(_ transport: Transport) {
        transports[transport.transportType] = transport
        
        // Forward events (capture weak reference for actor isolation)
        transport.events.sink { [weak self] event in
            Task { [weak self] in
                await self?.handleEvent(event)
            }
        }.store(in: &cancellables)
    }
    
    private func handleEvent(_ event: TransportEvent) {
        eventsSubject.send(event)
    }
    
    /// Get a specific transport
    public func transport(for type: TransportType) -> Transport? {
        transports[type]
    }
    
    // MARK: - Configuration
    
    /// Set node ID for all transports
    public func setNodeId(_ nodeId: Data) {
        self.nodeId = nodeId
        for transport in transports.values {
            transport.setNodeId(nodeId)
        }
    }
    
    /// Set display name for all transports
    public func setDisplayName(_ name: String) {
        self.displayName = name
        for transport in transports.values {
            transport.setDisplayName(name)
        }
    }
    
    // MARK: - Control
    
    /// Start all registered transports
    public func startAll() async {
        for transport in transports.values {
            do {
                try await transport.start()
            } catch {
                eventsSubject.send(.error(error))
            }
        }
    }
    
    /// Stop all transports
    public func stopAll() async {
        for transport in transports.values {
            await transport.stop()
        }
    }
    
    /// Start a specific transport
    public func start(_ type: TransportType) async throws {
        guard let transport = transports[type] else {
            throw TransportError.transportNotRegistered
        }
        try await transport.start()
    }
    
    /// Stop a specific transport
    public func stop(_ type: TransportType) async {
        guard let transport = transports[type] else { return }
        await transport.stop()
    }
    
    // MARK: - Peer Discovery
    
    /// Get all discovered peers across all transports
    public var allDiscoveredPeers: [PeerInfo] {
        transports.values.flatMap { $0.discoveredPeers }
    }
    
    /// Get all connected peers across all transports
    public var allConnectedPeers: [PeerInfo] {
        transports.values.flatMap { $0.connectedPeers }
    }
    
    // MARK: - Connection
    
    /// Connect to a peer via the appropriate transport
    public func connect(to peer: PeerInfo) async throws {
        guard let transport = transports[peer.transportType] else {
            throw TransportError.transportNotRegistered
        }
        try await transport.connect(to: peer.id)
    }
    
    /// Disconnect from a peer
    public func disconnect(from peer: PeerInfo) async {
        guard let transport = transports[peer.transportType] else { return }
        await transport.disconnect(from: peer.id)
    }
    
    // MARK: - Messaging
    
    /// Send data to a specific peer
    public func send(_ data: Data, to peer: PeerInfo) async throws {
        guard let transport = transports[peer.transportType] else {
            throw TransportError.transportNotRegistered
        }
        try await transport.send(data, to: peer.id)
    }
    
    /// Broadcast data to all connected peers across all transports
    public func broadcast(_ data: Data) async {
        for transport in transports.values {
            do {
                try await transport.broadcast(data)
            } catch {
                eventsSubject.send(.error(error))
            }
        }
    }
}

// MARK: - Transport Error

public enum TransportError: Error, LocalizedError {
    case alreadyRunning
    case transportNotRegistered
    case peerNotFound
    case peerNotConnected
    case notConnected
    case dataTooLarge
    case connectionFailed(String)
    case sendFailed(String)
    case unauthorized
    case bluetoothUnavailable
    case wifiUnavailable
    case timeout
    case noTransportsAvailable
    case allTransportsFailed
    
    public var errorDescription: String? {
        switch self {
        case .alreadyRunning:
            return "Transport is already running"
        case .transportNotRegistered:
            return "Transport not registered"
        case .peerNotFound:
            return "Peer not found"
        case .peerNotConnected:
            return "Peer is not connected"
        case .notConnected:
            return "Not connected to peer"
        case .dataTooLarge:
            return "Data exceeds maximum size"
        case .connectionFailed(let reason):
            return "Connection failed: \(reason)"
        case .sendFailed(let reason):
            return "Send failed: \(reason)"
        case .unauthorized:
            return "Not authorized to use transport"
        case .bluetoothUnavailable:
            return "Bluetooth is unavailable"
        case .wifiUnavailable:
            return "Wi-Fi is unavailable"
        case .timeout:
            return "Operation timed out"
        case .noTransportsAvailable:
            return "No transports available"
        case .allTransportsFailed:
            return "All transports failed"
        }
    }
}
