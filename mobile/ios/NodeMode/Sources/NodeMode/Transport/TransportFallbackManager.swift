//
//  TransportFallbackManager.swift
//  RailGun Node Mode
//
//  Manages transport priority and automatic fallback
//  Provides unified interface across BLE, MultipeerConnectivity, LAN, and WebSocket
//

import Foundation
import Combine
import Network

// MARK: - Transport Priority

public enum TransportPriority: Int, Comparable, CaseIterable {
    case lan = 0        // Highest - fastest, most reliable
    case multipeer = 1  // Wi-Fi Direct / AWDL
    case ble = 2        // Always available but slow
    case websocket = 3  // Fallback relay (requires internet)
    
    public static func < (lhs: TransportPriority, rhs: TransportPriority) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
    
    var transportType: TransportType {
        switch self {
        case .lan: return .lan
        case .multipeer: return .multipeer
        case .ble: return .ble
        case .websocket: return .lan // Placeholder - would be .websocket
        }
    }
}

// MARK: - Fallback Policy

public struct FallbackPolicy {
    /// Whether to automatically try lower-priority transports on failure
    public var autoFallback: Bool = true
    
    /// Maximum number of fallback attempts per message
    public var maxFallbackAttempts: Int = 3
    
    /// Delay between fallback attempts
    public var fallbackDelay: TimeInterval = 1.0
    
    /// Whether to prefer connected transports over higher-priority disconnected ones
    public var preferConnected: Bool = true
    
    /// Minimum signal strength for BLE (RSSI)
    public var minBLESignalStrength: Int = -80
    
    /// Enabled transports (all by default)
    public var enabledTransports: Set<TransportType> = [.lan, .multipeer, .ble]
    
    public init() {}
}

// MARK: - Peer Connection

public struct PeerConnection: Identifiable {
    public let id: String // nodeId or peerId
    public var transports: [TransportType: PeerInfo] = [:]
    public var preferredTransport: TransportType?
    public var lastSuccessfulTransport: TransportType?
    
    /// Best available transport for this peer
    public var bestTransport: TransportType? {
        // Prefer last successful
        if let last = lastSuccessfulTransport, transports[last]?.isConnected == true {
            return last
        }
        
        // Find highest priority connected transport
        for priority in TransportPriority.allCases {
            let type = priority.transportType
            if transports[type]?.isConnected == true {
                return type
            }
        }
        
        // Fall back to any known transport
        return transports.keys.first
    }
    
    public init(id: String) {
        self.id = id
    }
}

// MARK: - Fallback Event

public enum FallbackEvent {
    case transportStarted(TransportType)
    case transportStopped(TransportType)
    case transportFailed(TransportType, Error)
    case fallbackTriggered(from: TransportType, to: TransportType, peer: String)
    case peerConnected(PeerConnection)
    case peerDisconnected(String)
    case messageSent(String, via: TransportType)
    case messageReceived(Data, from: String, via: TransportType)
    case networkStatusChanged(NetworkStatus)
}

// MARK: - Network Status

public struct NetworkStatus {
    public var hasWiFi: Bool = false
    public var hasCellular: Bool = false
    public var hasInternet: Bool = false
    public var isExpensive: Bool = false
    public var isConstrained: Bool = false
}

// MARK: - Transport Fallback Manager

public actor TransportFallbackManager {
    
    // MARK: - Properties
    
    private var transports: [TransportType: Transport] = [:]
    private var peerConnections: [String: PeerConnection] = [:] // keyed by nodeId
    private var policy: FallbackPolicy
    
    private var nodeId: Data?
    private var displayName: String?
    
    private let eventsSubject = PassthroughSubject<FallbackEvent, Never>()
    public nonisolated var events: AnyPublisher<FallbackEvent, Never> {
        eventsSubject.eraseToAnyPublisher()
    }
    
    private var cancellables = Set<AnyCancellable>()
    private var networkMonitor: NWPathMonitor?
    private var networkStatus = NetworkStatus()
    
    // MARK: - Initialization
    
    public init(policy: FallbackPolicy = FallbackPolicy()) {
        self.policy = policy
    }
    
    // MARK: - Configuration
    
    public func setPolicy(_ policy: FallbackPolicy) {
        self.policy = policy
    }
    
    public func setNodeId(_ nodeId: Data) {
        self.nodeId = nodeId
        for transport in transports.values {
            transport.setNodeId(nodeId)
        }
    }
    
    public func setDisplayName(_ name: String) {
        self.displayName = name
        for transport in transports.values {
            transport.setDisplayName(name)
        }
    }
    
    // MARK: - Transport Registration
    
    public func registerTransport(_ transport: Transport) {
        let type = transport.transportType
        transports[type] = transport
        
        // Configure transport
        if let nodeId = nodeId {
            transport.setNodeId(nodeId)
        }
        if let name = displayName {
            transport.setDisplayName(name)
        }
        
        // Subscribe to events
        transport.events.sink { [weak self] event in
            Task { [weak self] in
                await self?.handleTransportEvent(event, from: type)
            }
        }.store(in: &cancellables)
    }
    
    // MARK: - Lifecycle
    
    public func startAll() async {
        // Start network monitoring
        startNetworkMonitoring()
        
        // Start transports in priority order
        for priority in TransportPriority.allCases {
            let type = priority.transportType
            guard policy.enabledTransports.contains(type),
                  let transport = transports[type] else { continue }
            
            do {
                try await transport.start()
                eventsSubject.send(.transportStarted(type))
                print("[FallbackManager] Started transport: \(type)")
            } catch {
                print("[FallbackManager] Failed to start \(type): \(error)")
                eventsSubject.send(.transportFailed(type, error))
            }
        }
    }
    
    public func stopAll() async {
        // Stop network monitoring
        networkMonitor?.cancel()
        networkMonitor = nil
        
        // Stop all transports
        for (type, transport) in transports {
            await transport.stop()
            eventsSubject.send(.transportStopped(type))
        }
        
        peerConnections.removeAll()
    }
    
    public func start(_ transportType: TransportType) async throws {
        guard let transport = transports[transportType] else {
            throw TransportError.peerNotFound
        }
        
        try await transport.start()
        eventsSubject.send(.transportStarted(transportType))
    }
    
    public func stop(_ transportType: TransportType) async {
        guard let transport = transports[transportType] else { return }
        
        await transport.stop()
        eventsSubject.send(.transportStopped(transportType))
    }
    
    // MARK: - Peer Management
    
    public func allDiscoveredPeers() -> [PeerConnection] {
        Array(peerConnections.values)
    }
    
    public func connectedPeers() -> [PeerConnection] {
        peerConnections.values.filter { $0.bestTransport != nil }
    }
    
    public func getPeerConnection(for nodeId: String) -> PeerConnection? {
        peerConnections[nodeId]
    }
    
    // MARK: - Connection
    
    public func connect(to nodeId: String) async throws {
        guard var peerConnection = peerConnections[nodeId] else {
            throw TransportError.peerNotFound
        }
        
        // Try transports in priority order
        for priority in TransportPriority.allCases {
            let type = priority.transportType
            
            guard policy.enabledTransports.contains(type),
                  let transport = transports[type],
                  let peerInfo = peerConnection.transports[type] else { continue }
            
            do {
                try await transport.connect(to: peerInfo.id)
                peerConnection.lastSuccessfulTransport = type
                peerConnections[nodeId] = peerConnection
                return
            } catch {
                print("[FallbackManager] Connect via \(type) failed: \(error)")
                if !policy.autoFallback { throw error }
                // Try next transport
            }
        }
        
        throw TransportError.connectionFailed("All transports failed")
    }
    
    public func disconnect(from nodeId: String) async {
        guard let peerConnection = peerConnections[nodeId] else { return }
        
        // Disconnect from all transports
        for (type, peerInfo) in peerConnection.transports {
            if let transport = transports[type] {
                await transport.disconnect(from: peerInfo.id)
            }
        }
    }
    
    // MARK: - Messaging
    
    public func send(_ data: Data, to nodeId: String) async throws {
        guard let peerConnection = peerConnections[nodeId] else {
            throw TransportError.peerNotFound
        }
        
        var lastError: Error?
        var attempts = 0
        
        // Build priority list
        var priorityList: [TransportType] = []
        
        // Add last successful first if preferConnected
        if policy.preferConnected, let last = peerConnection.lastSuccessfulTransport {
            priorityList.append(last)
        }
        
        // Add remaining by priority
        for priority in TransportPriority.allCases {
            let type = priority.transportType
            if !priorityList.contains(type) {
                priorityList.append(type)
            }
        }
        
        // Try each transport
        for type in priorityList {
            guard policy.enabledTransports.contains(type),
                  let transport = transports[type],
                  let peerInfo = peerConnection.transports[type],
                  peerInfo.isConnected else { continue }
            
            attempts += 1
            if attempts > policy.maxFallbackAttempts { break }
            
            do {
                try await transport.send(data, to: peerInfo.id)
                
                // Update last successful
                if var updated = peerConnections[nodeId] {
                    updated.lastSuccessfulTransport = type
                    peerConnections[nodeId] = updated
                }
                
                eventsSubject.send(.messageSent(UUID().uuidString, via: type))
                return
                
            } catch {
                lastError = error
                print("[FallbackManager] Send via \(type) failed: \(error)")
                
                if policy.autoFallback && attempts < policy.maxFallbackAttempts {
                    // Emit fallback event
                    if let nextType = priorityList.dropFirst(attempts).first {
                        eventsSubject.send(.fallbackTriggered(from: type, to: nextType, peer: nodeId))
                    }
                    
                    // Delay before retry
                    try? await Task.sleep(nanoseconds: UInt64(policy.fallbackDelay * 1_000_000_000))
                }
            }
        }
        
        throw lastError ?? TransportError.sendFailed("No available transport")
    }
    
    public func broadcast(_ data: Data) async throws {
        // Send to all connected peers
        for nodeId in peerConnections.keys {
            try? await send(data, to: nodeId)
        }
    }
    
    // MARK: - Event Handling
    
    private func handleTransportEvent(_ event: TransportEvent, from transportType: TransportType) {
        switch event {
        case .peerDiscovered(let peerInfo):
            handlePeerDiscovered(peerInfo, via: transportType)
            
        case .peerConnected(let peerInfo):
            handlePeerConnected(peerInfo, via: transportType)
            
        case .peerDisconnected(let peerId):
            handlePeerDisconnected(peerId, via: transportType)
            
        case .peerLost(let peerId):
            handlePeerLost(peerId, via: transportType)
            
        case .messageReceived(let data, let peerId):
            handleMessageReceived(data, from: peerId, via: transportType)
            
        case .error(let error):
            eventsSubject.send(.transportFailed(transportType, error))
            
        default:
            break
        }
    }
    
    private func handlePeerDiscovered(_ peerInfo: PeerInfo, via transportType: TransportType) {
        let nodeId = peerInfo.nodeId ?? peerInfo.id
        
        if peerConnections[nodeId] == nil {
            peerConnections[nodeId] = PeerConnection(id: nodeId)
        }
        
        peerConnections[nodeId]?.transports[transportType] = peerInfo
        
        print("[FallbackManager] Peer discovered: \(nodeId) via \(transportType)")
    }
    
    private func handlePeerConnected(_ peerInfo: PeerInfo, via transportType: TransportType) {
        let nodeId = peerInfo.nodeId ?? peerInfo.id
        
        if peerConnections[nodeId] == nil {
            peerConnections[nodeId] = PeerConnection(id: nodeId)
        }
        
        var updatedInfo = peerInfo
        updatedInfo.isConnected = true
        peerConnections[nodeId]?.transports[transportType] = updatedInfo
        
        if let connection = peerConnections[nodeId] {
            eventsSubject.send(.peerConnected(connection))
        }
        
        print("[FallbackManager] Peer connected: \(nodeId) via \(transportType)")
    }
    
    private func handlePeerDisconnected(_ peerId: String, via transportType: TransportType) {
        // Find the peer connection by transport peer ID
        for (nodeId, var connection) in peerConnections {
            if connection.transports[transportType]?.id == peerId {
                connection.transports[transportType]?.isConnected = false
                peerConnections[nodeId] = connection
                
                // Check if completely disconnected
                if connection.bestTransport == nil {
                    eventsSubject.send(.peerDisconnected(nodeId))
                }
                break
            }
        }
    }
    
    private func handlePeerLost(_ peerId: String, via transportType: TransportType) {
        // Find and remove transport entry
        for (nodeId, var connection) in peerConnections {
            if connection.transports[transportType]?.id == peerId {
                connection.transports.removeValue(forKey: transportType)
                
                if connection.transports.isEmpty {
                    peerConnections.removeValue(forKey: nodeId)
                    eventsSubject.send(.peerDisconnected(nodeId))
                } else {
                    peerConnections[nodeId] = connection
                }
                break
            }
        }
    }
    
    private func handleMessageReceived(_ data: Data, from peerId: String, via transportType: TransportType) {
        // Find nodeId for this transport peer
        var nodeId = peerId
        for (nId, connection) in peerConnections {
            if connection.transports[transportType]?.id == peerId {
                nodeId = nId
                break
            }
        }
        
        eventsSubject.send(.messageReceived(data, from: nodeId, via: transportType))
    }
    
    // MARK: - Network Monitoring
    
    private func startNetworkMonitoring() {
        let monitor = NWPathMonitor()
        networkMonitor = monitor
        
        monitor.pathUpdateHandler = { [weak self] path in
            Task { [weak self] in
                await self?.handleNetworkPathUpdate(path)
            }
        }
        
        monitor.start(queue: DispatchQueue(label: "com.railgun.network-monitor"))
    }
    
    private func handleNetworkPathUpdate(_ path: NWPath) {
        var status = NetworkStatus()
        
        status.hasWiFi = path.usesInterfaceType(.wifi)
        status.hasCellular = path.usesInterfaceType(.cellular)
        status.hasInternet = path.status == .satisfied
        status.isExpensive = path.isExpensive
        status.isConstrained = path.isConstrained
        
        let changed = status.hasWiFi != networkStatus.hasWiFi ||
                      status.hasCellular != networkStatus.hasCellular ||
                      status.hasInternet != networkStatus.hasInternet
        
        networkStatus = status
        
        if changed {
            eventsSubject.send(.networkStatusChanged(status))
            print("[FallbackManager] Network status: WiFi=\(status.hasWiFi), Cell=\(status.hasCellular), Internet=\(status.hasInternet)")
        }
    }
}
