//
//  BootstrapNodes.swift
//  RailGun Node Mode
//
//  Bootstrap node configuration and management
//  Provides initial peers for DHT bootstrapping and relay fallback
//

import Foundation

// MARK: - Bootstrap Node

public struct BootstrapNode: Codable, Equatable, Sendable {
    public let id: String
    public let host: String
    public let port: UInt16
    public let publicKey: Data?
    public let region: String?
    public let type: NodeType
    public let priority: Int
    public let isActive: Bool
    
    public init(id: String,
                host: String,
                port: UInt16,
                publicKey: Data? = nil,
                region: String? = nil,
                type: NodeType = .bootstrap,
                priority: Int = 0,
                isActive: Bool = true) {
        self.id = id
        self.host = host
        self.port = port
        self.publicKey = publicKey
        self.region = region
        self.type = type
        self.priority = priority
        self.isActive = isActive
    }
    
    public var endpoint: String {
        return "\(host):\(port)"
    }
}

// MARK: - Node Type

public enum NodeType: String, Codable, Sendable {
    case bootstrap  // Initial DHT bootstrap
    case relay      // WebSocket relay server
    case stun       // STUN server
    case turn       // TURN server
    case supernode  // High-availability supernode
}

// MARK: - Bootstrap Configuration

public struct BootstrapConfiguration: Codable, Sendable {
    public var bootstrapNodes: [BootstrapNode]
    public var relayServers: [BootstrapNode]
    public var stunServers: [String]
    public var turnServers: [String]
    public var version: Int
    public var lastUpdated: Date
    
    public init(bootstrapNodes: [BootstrapNode] = [],
                relayServers: [BootstrapNode] = [],
                stunServers: [String] = [],
                turnServers: [String] = [],
                version: Int = 1,
                lastUpdated: Date = Date()) {
        self.bootstrapNodes = bootstrapNodes
        self.relayServers = relayServers
        self.stunServers = stunServers
        self.turnServers = turnServers
        self.version = version
        self.lastUpdated = lastUpdated
    }
    
    /// Default hardcoded configuration (fallback)
    public static let `default` = BootstrapConfiguration(
        bootstrapNodes: [
            // These would be your production bootstrap nodes
            BootstrapNode(
                id: "bootstrap-us-1",
                host: "bootstrap-us.railgun.app",
                port: 8443,
                region: "us-east",
                type: .bootstrap,
                priority: 1
            ),
            BootstrapNode(
                id: "bootstrap-eu-1",
                host: "bootstrap-eu.railgun.app",
                port: 8443,
                region: "eu-west",
                type: .bootstrap,
                priority: 1
            ),
            BootstrapNode(
                id: "bootstrap-ap-1",
                host: "bootstrap-ap.railgun.app",
                port: 8443,
                region: "ap-southeast",
                type: .bootstrap,
                priority: 2
            )
        ],
        relayServers: [
            BootstrapNode(
                id: "relay-us-1",
                host: "relay-us.railgun.app",
                port: 443,
                region: "us-east",
                type: .relay,
                priority: 1
            ),
            BootstrapNode(
                id: "relay-eu-1",
                host: "relay-eu.railgun.app",
                port: 443,
                region: "eu-west",
                type: .relay,
                priority: 1
            )
        ],
        stunServers: [
            "stun.l.google.com:19302",
            "stun1.l.google.com:19302",
            "stun.cloudflare.com:3478"
        ],
        turnServers: [
            // TURN servers would be configured with credentials
        ],
        version: 1
    )
}

// MARK: - Bootstrap Manager

public actor BootstrapManager {
    
    // MARK: - Properties
    
    public static let shared = BootstrapManager()
    
    private var configuration: BootstrapConfiguration
    private var healthyNodes: Set<String> = []
    private var unhealthyNodes: Set<String> = []
    private var lastHealthCheck: Date?
    
    private let storage: BootstrapStorage
    
    // MARK: - Initialization
    
    private init() {
        self.storage = FileBootstrapStorage()
        self.configuration = .default
        
        Task {
            await loadCachedConfiguration()
        }
    }
    
    // MARK: - Node Access
    
    /// Get all active bootstrap nodes
    public func getBootstrapNodes() -> [BootstrapNode] {
        return configuration.bootstrapNodes.filter { $0.isActive && !unhealthyNodes.contains($0.id) }
    }
    
    /// Get bootstrap nodes sorted by priority and health
    public func getBootstrapNodesPrioritized() -> [BootstrapNode] {
        return getBootstrapNodes()
            .sorted { node1, node2 in
                // Healthy nodes first
                let health1 = healthyNodes.contains(node1.id) ? 0 : 1
                let health2 = healthyNodes.contains(node2.id) ? 0 : 1
                
                if health1 != health2 {
                    return health1 < health2
                }
                
                // Then by priority
                return node1.priority < node2.priority
            }
    }
    
    /// Get relay servers
    public func getRelayServers() -> [BootstrapNode] {
        return configuration.relayServers.filter { $0.isActive && !unhealthyNodes.contains($0.id) }
    }
    
    /// Get STUN servers
    public func getSTUNServers() -> [String] {
        return configuration.stunServers
    }
    
    /// Get TURN servers
    public func getTURNServers() -> [String] {
        return configuration.turnServers
    }
    
    /// Get nodes by region
    public func getNodesByRegion(_ region: String) -> [BootstrapNode] {
        return getBootstrapNodes().filter { $0.region == region }
    }
    
    /// Get closest relay server (simple region matching)
    public func getClosestRelayServer(preferredRegion: String?) -> BootstrapNode? {
        let relays = getRelayServers()
        
        if let region = preferredRegion,
           let regional = relays.first(where: { $0.region == region }) {
            return regional
        }
        
        return relays.first
    }
    
    // MARK: - Health Management
    
    /// Mark a node as healthy
    public func markHealthy(_ nodeId: String) {
        healthyNodes.insert(nodeId)
        unhealthyNodes.remove(nodeId)
    }
    
    /// Mark a node as unhealthy
    public func markUnhealthy(_ nodeId: String) {
        unhealthyNodes.insert(nodeId)
        healthyNodes.remove(nodeId)
    }
    
    /// Reset health status (e.g., after network change)
    public func resetHealthStatus() {
        healthyNodes.removeAll()
        unhealthyNodes.removeAll()
    }
    
    /// Check if any bootstrap nodes are available
    public func hasAvailableBootstrapNodes() -> Bool {
        return !getBootstrapNodes().isEmpty
    }
    
    // MARK: - Configuration Update
    
    /// Update configuration from remote config
    public func updateConfiguration(bootstrapNodes: [String]?, relayServers: [String]?, stunServers: [String]?, turnServers: [String]?, version: Int) async {
        if let bootstrapHosts = bootstrapNodes {
            // Parse bootstrap nodes from strings
            var nodes: [BootstrapNode] = []
            for (index, host) in bootstrapHosts.enumerated() {
                if let node = parseNodeString(host, type: .bootstrap, index: index) {
                    nodes.append(node)
                }
            }
            if !nodes.isEmpty {
                configuration.bootstrapNodes = nodes
            }
        }
        
        if let relayHosts = relayServers {
            var relays: [BootstrapNode] = []
            for (index, host) in relayHosts.enumerated() {
                if let node = parseNodeString(host, type: .relay, index: index) {
                    relays.append(node)
                }
            }
            if !relays.isEmpty {
                configuration.relayServers = relays
            }
        }
        
        if let stuns = stunServers {
            configuration.stunServers = stuns
        }
        
        if let turns = turnServers {
            configuration.turnServers = turns
        }
        
        configuration.version = version
        configuration.lastUpdated = Date()
        
        // Persist
        await saveConfiguration()
    }
    
    /// Manually set configuration
    public func setConfiguration(_ config: BootstrapConfiguration) async {
        configuration = config
        await saveConfiguration()
    }
    
    // MARK: - Persistence
    
    private func loadCachedConfiguration() async {
        if let cached = await storage.load() {
            configuration = cached
        }
    }
    
    private func saveConfiguration() async {
        await storage.save(configuration)
    }
    
    // MARK: - Helpers
    
    private func parseNodeString(_ string: String, type: NodeType, index: Int) -> BootstrapNode? {
        // Parse "host:port" or just "host"
        let parts = string.split(separator: ":")
        guard !parts.isEmpty else { return nil }
        
        let host = String(parts[0])
        let port: UInt16 = parts.count > 1 ? UInt16(parts[1]) ?? 8443 : 8443
        
        return BootstrapNode(
            id: "\(type.rawValue)-\(index)",
            host: host,
            port: port,
            type: type,
            priority: index
        )
    }
}

// MARK: - Bootstrap Storage Protocol

public protocol BootstrapStorage: Sendable {
    func load() async -> BootstrapConfiguration?
    func save(_ config: BootstrapConfiguration) async
}

// MARK: - File Bootstrap Storage

public actor FileBootstrapStorage: BootstrapStorage {
    private let fileURL: URL
    
    public init() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.fileURL = documentsPath.appendingPathComponent("bootstrap_config.json")
    }
    
    public func load() async -> BootstrapConfiguration? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(BootstrapConfiguration.self, from: data)
    }
    
    public func save(_ config: BootstrapConfiguration) async {
        guard let data = try? JSONEncoder().encode(config) else { return }
        try? data.write(to: fileURL)
    }
}
