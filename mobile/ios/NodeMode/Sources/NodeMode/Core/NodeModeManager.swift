//
//  NodeModeManager.swift
//  RailGun Node Mode
//
//  Main coordinator for Node Mode mesh networking
//

import Foundation
import Combine

// MARK: - Node Mode State

public enum NodeModeState: Equatable {
    case disabled
    case initializing
    case running
    case paused
    case error(String)
    
    public var isActive: Bool {
        switch self {
        case .running: return true
        default: return false
        }
    }
}

// MARK: - Node Mode Event

public enum NodeModeEvent {
    case stateChanged(NodeModeState)
    case peerDiscovered(PeerInfo)
    case peerConnected(PeerInfo)
    case peerDisconnected(String)
    case bundleReceived(Bundle)
    case bundleSent(Bundle, to: String)
    case bundleDelivered(Bundle)
    case syncCompleted(uploaded: Int, downloaded: Int)
    case error(Error)
}

// MARK: - Node Mode Manager

/// Main coordinator for Node Mode mesh networking
public actor NodeModeManager {
    
    // MARK: - Singleton
    
    public static let shared = NodeModeManager()
    
    // MARK: - Properties
    
    private let configStore: NodeModeConfigStore
    private var config: NodeModeConfig
    private var database: NodeModeDatabase?
    private var transportManager: TransportManager?
    private var bloomFilter: BloomFilter?
    
    private var cancellables = Set<AnyCancellable>()
    
    public private(set) var state: NodeModeState = .disabled {
        didSet {
            eventsSubject.send(.stateChanged(state))
        }
    }
    
    private let eventsSubject = PassthroughSubject<NodeModeEvent, Never>()
    public nonisolated var events: AnyPublisher<NodeModeEvent, Never> {
        eventsSubject.eraseToAnyPublisher()
    }
    
    // MARK: - Statistics
    
    public private(set) var stats = NodeModeStats()
    
    // MARK: - Initialization
    
    private init() {
        self.configStore = NodeModeConfigStore()
        self.config = NodeModeConfig()
    }
    
    // MARK: - Lifecycle
    
    /// Initialize and start Node Mode
    public func start() async throws {
        guard state == .disabled else { return }
        state = .initializing
        
        // Load configuration
        config = await configStore.load()
        
        // Initialize identity if needed
        if !config.isInitialized {
            try await generateIdentity()
        }
        
        // Initialize database
        database = NodeModeDatabase()
        try await database?.open()
        
        // Initialize bloom filter from stored bundles
        bloomFilter = BloomFilter(
            expectedElements: config.bloomExpectedElements,
            falsePositiveRate: config.bloomFalsePositiveRate
        )
        
        if let bundleIds = try? await database?.getAllBundleIds() {
            for id in bundleIds {
                bloomFilter?.add(id)
            }
        }
        
        // Initialize transports
        transportManager = TransportManager()
        
        // Register BLE transport
        let bleTransport = BLETransport()
        await transportManager?.register(bleTransport)
        
        // Set node identity on transports
        if let nodeId = config.nodeId {
            await transportManager?.setNodeId(nodeId)
        }
        
        // Subscribe to transport events
        await subscribeToTransportEvents()
        
        // Start transports
        await transportManager?.startAll()
        
        // Start background tasks
        startBackgroundTasks()
        
        state = .running
    }
    
    /// Stop Node Mode
    public func stop() async {
        guard state == .running || state == .paused else { return }
        
        // Stop transports
        await transportManager?.stopAll()
        
        // Close database
        await database?.close()
        
        // Cancel background tasks
        cancellables.removeAll()
        
        state = .disabled
    }
    
    /// Pause Node Mode (stops transports but keeps state)
    public func pause() async {
        guard state == .running else { return }
        await transportManager?.stopAll()
        state = .paused
    }
    
    /// Resume Node Mode from paused state
    public func resume() async {
        guard state == .paused else { return }
        await transportManager?.startAll()
        state = .running
    }
    
    // MARK: - Identity Management
    
    private func generateIdentity() async throws {
        // Generate Ed25519 keypair using CommonCrypto/Security
        // This is a simplified version - real implementation would use proper Ed25519
        var publicKey = Data(count: 32)
        var privateKey = Data(count: 64)
        
        // Generate random bytes for keys (placeholder - use proper Ed25519 in production)
        _ = publicKey.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        _ = privateKey.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 64, $0.baseAddress!) }
        
        // Copy public key to first 32 bytes of private key (Ed25519 convention)
        privateKey.replaceSubrange(32..<64, with: publicKey)
        
        config.nodeId = publicKey
        config.nodePrivateKey = privateKey
        config.deviceId = UInt32.random(in: 1...UInt32.max)
        config.registrationId = UInt32.random(in: 1...UInt32.max)
        
        try await configStore.save(config)
    }
    
    // MARK: - Bundle Operations
    
    /// Create and send a bundle to a destination
    public func sendBundle(
        payload: Data,
        to destination: Data,
        destinationType: DestinationType = .user,
        priority: BundlePriority = .normal
    ) async throws -> Bundle {
        guard state == .running else {
            throw NodeModeError.notRunning
        }
        
        guard let nodeId = config.nodeId else {
            throw NodeModeError.notInitialized
        }
        
        // Check payload size
        guard payload.count <= config.maxBundleSize else {
            throw BundleError.payloadTooLarge
        }
        
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        
        // Create bundle
        var bundle = Bundle(
            version: 1,
            flags: .default,
            priority: priority,
            maxHops: config.maxHops,
            createdAt: now,
            expiresAt: now + config.defaultTTLMillis,
            sourceNode: nodeId,
            destinationType: destinationType,
            destination: destination,
            payload: payload,
            signature: Data(repeating: 0, count: 64) // Placeholder - sign in production
        )
        
        bundle.isOutgoing = true
        
        // Sign the bundle (placeholder)
        // In production: bundle.signature = sign(bundle.bytesToSign(), config.nodePrivateKey!)
        
        // Store bundle
        try await database?.insertBundle(bundle)
        bloomFilter?.add(bundle.id)
        
        // Broadcast to connected peers
        let serialized = try bundle.serialize()
        await transportManager?.broadcast(serialized)
        
        stats.bundlesCreated += 1
        eventsSubject.send(.bundleSent(bundle, to: destination.hexString))
        
        return bundle
    }
    
    /// Process a received bundle
    public func processReceivedBundle(_ data: Data, from peerId: String) async throws {
        // Deserialize bundle
        let bundle = try Bundle.deserialize(from: data)
        
        // Check if we've already seen this bundle
        if bloomFilter?.mightContain(bundle.id) == true {
            if try await database?.bundleExists(id: bundle.id) == true {
                // Already have this bundle, ignore
                return
            }
        }
        
        // Validate bundle
        guard !bundle.isExpired else {
            throw BundleError.expired
        }
        
        // Check signature (placeholder)
        // In production: verify signature against source node's public key
        
        // Store bundle
        var storedBundle = bundle
        storedBundle.receivedAt = Int64(Date().timeIntervalSince1970 * 1000)
        
        // Check if this bundle is for us
        if let myUserId = await getCurrentUserId(),
           bundle.destinationType == .user && bundle.destination == myUserId {
            storedBundle.isOwnMessage = true
        }
        
        try await database?.insertBundle(storedBundle)
        bloomFilter?.add(bundle.id)
        
        // Update peer stats
        if var node = try await database?.getNode(id: peerId) {
            node.recordBundleReceived(bytes: data.count)
            try await database?.upsertNode(node)
        }
        
        stats.bundlesReceived += 1
        eventsSubject.send(.bundleReceived(storedBundle))
        
        // Relay to other peers if not max hops
        if storedBundle.canRelay && !storedBundle.isOwnMessage {
            try await relayBundle(storedBundle, excludingPeer: peerId)
        }
    }
    
    /// Relay a bundle to other connected peers
    private func relayBundle(_ bundle: Bundle, excludingPeer: String) async throws {
        guard let transportManager = transportManager else { return }
        
        let relayedBundle = try bundle.preparedForRelay()
        let serialized = try relayedBundle.serialize()
        
        for peer in await transportManager.allConnectedPeers where peer.id != excludingPeer {
            do {
                try await transportManager.send(serialized, to: peer)
                stats.bundlesRelayed += 1
            } catch {
                eventsSubject.send(.error(error))
            }
        }
    }
    
    // MARK: - Peer Sync
    
    /// Sync bundles with a connected peer
    public func syncWithPeer(_ peerId: String) async throws {
        guard let transportManager = transportManager else { return }
        guard let bloomData = bloomFilter?.serialize() else { return }
        
        // Send our bloom filter to peer
        var syncMessage = Data([0x01]) // Sync type: bloom filter
        syncMessage.append(bloomData)
        
        if let peer = await transportManager.allConnectedPeers.first(where: { $0.id == peerId }) {
            try await transportManager.send(syncMessage, to: peer)
        }
    }
    
    // MARK: - Background Tasks
    
    private func startBackgroundTasks() {
        // Periodic cleanup
        Timer.publish(every: 3600, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                Task {
                    await self?.performMaintenance()
                }
            }
            .store(in: &cancellables)
        
        // Gateway sync (if enabled and online)
        if config.gatewaySyncEnabled {
            Timer.publish(every: config.gatewaySyncInterval, on: .main, in: .common)
                .autoconnect()
                .sink { [weak self] _ in
                    Task {
                        await self?.syncWithGateway()
                    }
                }
                .store(in: &cancellables)
        }
    }
    
    private func performMaintenance() async {
        // Expire old bundles
        if let expired = try? await database?.expireOldBundles() {
            stats.bundlesExpired += expired
        }
        
        // Clean up old metrics, etc.
    }
    
    private func syncWithGateway() async {
        // Check network connectivity
        // Upload pending outgoing bundles
        // Download pending incoming bundles
        // This would integrate with the existing API client
    }
    
    // MARK: - Transport Events
    
    private func subscribeToTransportEvents() async {
        guard let transportManager = transportManager else { return }
        
        await transportManager.events.sink { [weak self] event in
            Task { [weak self] in
                await self?.handleTransportEvent(event)
            }
        }.store(in: &cancellables)
    }
    
    private func handleTransportEvent(_ event: TransportEvent) async {
        switch event {
        case .peerDiscovered(let peer):
            eventsSubject.send(.peerDiscovered(peer))
            stats.peersDiscovered += 1
            
        case .peerConnected(let peer):
            eventsSubject.send(.peerConnected(peer))
            stats.peersConnected += 1
            
            // Register node in database
            let node = Node(
                id: peer.nodeId ?? peer.id,
                displayName: peer.displayName,
                lastConnectionType: peer.transportType == .ble ? .ble : .unknown
            )
            try? await database?.upsertNode(node)
            
            // Initiate sync
            try? await syncWithPeer(peer.id)
            
        case .peerDisconnected(let peerId):
            eventsSubject.send(.peerDisconnected(peerId))
            
        case .messageReceived(let data, let peerId):
            do {
                try await processReceivedBundle(data, from: peerId)
            } catch {
                eventsSubject.send(.error(error))
            }
            
        case .error(let error):
            eventsSubject.send(.error(error))
            
        default:
            break
        }
    }
    
    // MARK: - Helpers
    
    private func getCurrentUserId() async -> Data? {
        // Get current user ID from app's authentication system
        // This would integrate with existing auth
        return nil
    }
    
    // MARK: - Public Getters
    
    public var isRunning: Bool {
        state == .running
    }
    
    public var nodeIdHex: String? {
        config.nodeId?.hexString
    }
    
    public func getDiscoveredPeers() async -> [PeerInfo] {
        await transportManager?.allDiscoveredPeers ?? []
    }
    
    public func getConnectedPeers() async -> [PeerInfo] {
        await transportManager?.allConnectedPeers ?? []
    }
    
    public func getPendingBundles() async throws -> [Bundle] {
        try await database?.getOwnPendingMessages() ?? []
    }
    
    public func getRelayQueue() async throws -> [Bundle] {
        try await database?.getRelayQueue(limit: 100) ?? []
    }
    
    public func getStorageStats() async throws -> (bundleCount: Int, totalBytes: Int64) {
        try await database?.getStorageStats() ?? (0, 0)
    }
}

// MARK: - Node Mode Stats

public struct NodeModeStats {
    public var peersDiscovered: Int = 0
    public var peersConnected: Int = 0
    public var bundlesCreated: Int = 0
    public var bundlesReceived: Int = 0
    public var bundlesRelayed: Int = 0
    public var bundlesDelivered: Int = 0
    public var bundlesExpired: Int = 0
    public var bytesSent: Int64 = 0
    public var bytesReceived: Int64 = 0
}

// MARK: - Node Mode Error

public enum NodeModeError: Error, LocalizedError {
    case notRunning
    case notInitialized
    case alreadyRunning
    case configurationError(String)
    case storageError(String)
    
    public var errorDescription: String? {
        switch self {
        case .notRunning: return "Node Mode is not running"
        case .notInitialized: return "Node Mode is not initialized"
        case .alreadyRunning: return "Node Mode is already running"
        case .configurationError(let msg): return "Configuration error: \(msg)"
        case .storageError(let msg): return "Storage error: \(msg)"
        }
    }
}

import Security
