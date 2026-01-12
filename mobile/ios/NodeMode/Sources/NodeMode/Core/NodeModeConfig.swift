//
//  NodeModeConfig.swift
//  RailGun Node Mode
//
//  Configuration for Node Mode
//

import Foundation

// MARK: - Config Capabilities (local to this file)

public struct ConfigCapabilities: OptionSet, Codable {
    public let rawValue: UInt8
    
    public init(rawValue: UInt8) {
        self.rawValue = rawValue
    }
    
    public static let canRelay = ConfigCapabilities(rawValue: 1 << 0)
    public static let canStore = ConfigCapabilities(rawValue: 1 << 1)
    public static let hasInternet = ConfigCapabilities(rawValue: 1 << 2)
    public static let highBandwidth = ConfigCapabilities(rawValue: 1 << 3)
    public static let highStorage = ConfigCapabilities(rawValue: 1 << 4)
    
    public static let `default`: ConfigCapabilities = [.canRelay, .canStore]
}

// MARK: - Node Mode Configuration

public struct NodeModeConfig: Codable {
    
    // MARK: - Node Identity
    
    /// Node private key (Ed25519, 64 bytes, stored securely)
    public var nodePrivateKey: Data?
    
    /// Node public key / ID (Ed25519, 32 bytes)
    public var nodeId: Data?
    
    /// Device identifier for registration
    public var deviceId: UInt32 = 0
    
    /// Registration ID for Signal protocol
    public var registrationId: UInt32 = 0
    
    // MARK: - Capabilities
    
    /// Node capability flags
    public var capabilities: ConfigCapabilities = .default
    
    // MARK: - Storage Limits
    
    /// Maximum storage for bundles in bytes (default: 100MB)
    public var maxStorageBytes: Int64 = 100 * 1024 * 1024
    
    /// Maximum number of bundles to store
    public var maxBundleCount: Int = 10_000
    
    /// Maximum single bundle payload size (default: 64KB)
    public var maxBundleSize: Int = 64 * 1024
    
    // MARK: - TTL Settings
    
    /// Default TTL for outgoing bundles in hours
    public var defaultTTLHours: Int = 72
    
    /// Maximum hops for outgoing bundles
    public var maxHops: UInt8 = 10
    
    // MARK: - Routing Settings
    
    /// Routing algorithm to use
    public var routingAlgorithm: RoutingAlgorithm = .automatic
    
    /// Enable onion routing for enhanced privacy
    public var onionRoutingEnabled: Bool = false
    
    /// Number of onion layers (if enabled)
    public var onionLayers: Int = 3
    
    // MARK: - Transport Settings
    
    /// Enable BLE transport
    public var bleEnabled: Bool = true
    
    /// Enable Wi-Fi Direct transport
    public var wifiDirectEnabled: Bool = true
    
    /// Enable LAN transport
    public var lanEnabled: Bool = true
    
    /// Enable MultipeerConnectivity (iOS only)
    public var multipeerEnabled: Bool = true
    
    /// BLE scan interval in seconds
    public var bleScanInterval: TimeInterval = 10
    
    /// BLE advertisement interval in seconds
    public var bleAdvertiseInterval: TimeInterval = 5
    
    // MARK: - Power Settings
    
    /// Enable low power mode (reduces scan frequency)
    public var lowPowerMode: Bool = false
    
    /// Background sync interval in seconds
    public var backgroundSyncInterval: TimeInterval = 300
    
    // MARK: - Gateway Settings
    
    /// Gateway server URL (stored as string for Codable)
    public var gatewayURLString: String?
    
    /// Gateway URL computed property
    public var gatewayURL: URL? {
        get { gatewayURLString.flatMap { URL(string: $0) } }
        set { gatewayURLString = newValue?.absoluteString }
    }
    
    /// Sync with gateway when online
    public var gatewaySyncEnabled: Bool = true
    
    /// Gateway sync interval in seconds
    public var gatewaySyncInterval: TimeInterval = 60
    
    // MARK: - Bloom Filter Settings
    
    /// Expected number of bundles for bloom filter sizing
    public var bloomExpectedElements: Int = 10_000
    
    /// Desired false positive rate for bloom filter
    public var bloomFalsePositiveRate: Double = 0.01
    
    // MARK: - Metrics Settings
    
    /// Enable metrics collection
    public var metricsEnabled: Bool = true
    
    /// Metrics retention period in days
    public var metricsRetentionDays: Int = 7
    
    // MARK: - Initialization
    
    /// Timestamp when config was initialized
    public var initializedAt: Int64 = 0
    
    /// Timestamp when config was last modified
    public var lastModifiedAt: Int64 = 0
    
    // MARK: - CodingKeys (exclude computed properties)
    
    enum CodingKeys: String, CodingKey {
        case nodePrivateKey, nodeId, deviceId, registrationId
        case capabilities
        case maxStorageBytes, maxBundleCount, maxBundleSize
        case defaultTTLHours, maxHops
        case routingAlgorithm, onionRoutingEnabled, onionLayers
        case bleEnabled, wifiDirectEnabled, lanEnabled, multipeerEnabled
        case bleScanInterval, bleAdvertiseInterval
        case lowPowerMode, backgroundSyncInterval
        case gatewayURLString, gatewaySyncEnabled, gatewaySyncInterval
        case bloomExpectedElements, bloomFalsePositiveRate
        case metricsEnabled, metricsRetentionDays
        case initializedAt, lastModifiedAt
    }
    
    public init() {
        self.initializedAt = Int64(Date().timeIntervalSince1970 * 1000)
        self.lastModifiedAt = self.initializedAt
    }
    
    // MARK: - Computed Properties
    
    /// Is the config initialized with identity?
    public var isInitialized: Bool {
        nodePrivateKey != nil && nodeId != nil
    }
    
    /// Default TTL in milliseconds
    public var defaultTTLMillis: Int64 {
        Int64(defaultTTLHours) * 60 * 60 * 1000
    }
}

// MARK: - Routing Algorithm

public enum RoutingAlgorithm: String, Codable {
    /// Automatically select best algorithm based on conditions
    case automatic
    
    /// Simple epidemic flooding
    case epidemic
    
    /// PROPHET probabilistic routing
    case prophet
    
    /// Spray and Wait with limited copies
    case sprayAndWait
    
    /// Geographic routing (requires location)
    case geographic
}

// MARK: - Config Storage

public actor NodeModeConfigStore {
    private let userDefaults: UserDefaults
    private let configKey = "com.railgun.nodemode.config"
    
    private var cachedConfig: NodeModeConfig?
    
    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }
    
    public func load() -> NodeModeConfig {
        if let cached = cachedConfig {
            return cached
        }
        
        guard let data = userDefaults.data(forKey: configKey),
              let config = try? JSONDecoder().decode(NodeModeConfig.self, from: data) else {
            let newConfig = NodeModeConfig()
            cachedConfig = newConfig
            return newConfig
        }
        
        cachedConfig = config
        return config
    }
    
    public func save(_ config: NodeModeConfig) throws {
        var mutableConfig = config
        mutableConfig.lastModifiedAt = Int64(Date().timeIntervalSince1970 * 1000)
        
        let data = try JSONEncoder().encode(mutableConfig)
        userDefaults.set(data, forKey: configKey)
        cachedConfig = mutableConfig
    }
    
    public func update(_ transform: (inout NodeModeConfig) -> Void) throws {
        var config = load()
        transform(&config)
        try save(config)
    }
    
    public func reset() {
        userDefaults.removeObject(forKey: configKey)
        cachedConfig = nil
    }
}
