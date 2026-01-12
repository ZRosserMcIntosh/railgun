//
//  FeatureFlags.swift
//  RailGun Node Mode
//
//  Feature flags and kill switch for safe updates
//  Allows remote configuration and emergency disable
//

import Foundation

// MARK: - Feature Flag

public struct FeatureFlag: Codable, Sendable {
    public let key: String
    public let enabled: Bool
    public let rolloutPercentage: Double  // 0.0 - 1.0
    public let minVersion: String?
    public let maxVersion: String?
    public let expiresAt: Date?
    public let metadata: [String: String]
    
    public init(key: String,
                enabled: Bool = true,
                rolloutPercentage: Double = 1.0,
                minVersion: String? = nil,
                maxVersion: String? = nil,
                expiresAt: Date? = nil,
                metadata: [String: String] = [:]) {
        self.key = key
        self.enabled = enabled
        self.rolloutPercentage = rolloutPercentage
        self.minVersion = minVersion
        self.maxVersion = maxVersion
        self.expiresAt = expiresAt
        self.metadata = metadata
    }
    
    public var isExpired: Bool {
        if let expires = expiresAt {
            return Date() > expires
        }
        return false
    }
}

// MARK: - Known Feature Keys

public enum FeatureKey: String, CaseIterable, Sendable {
    // Transport features
    case bleTransport = "transport.ble"
    case lanTransport = "transport.lan"
    case multipeerTransport = "transport.multipeer"
    case webSocketRelay = "transport.websocket"
    
    // Crypto features
    case noiseProtocol = "crypto.noise"
    case doubleRatchet = "crypto.double_ratchet"
    case keyRotation = "crypto.key_rotation"
    
    // P2P features
    case dhtDiscovery = "p2p.dht"
    case rendezvous = "p2p.rendezvous"
    case relayFallback = "p2p.relay_fallback"
    
    // Node mode features
    case bundleStore = "node.bundle_store"
    case bundleRelay = "node.bundle_relay"
    case peerReputation = "node.reputation"
    
    // Platform features
    case backgroundExecution = "platform.background"
    case pushWake = "platform.push_wake"
    
    // Kill switches
    case killSwitch = "kill.all"
    case killP2P = "kill.p2p"
    case killRelay = "kill.relay"
}

// MARK: - Feature Flag Manager

public actor FeatureFlagManager {
    
    // MARK: - Properties
    
    public static let shared = FeatureFlagManager()
    
    private var flags: [String: FeatureFlag] = [:]
    private var overrides: [String: Bool] = [:]
    private let userIdentifier: String
    private var lastFetchTime: Date?
    private let cacheExpiry: TimeInterval = 3600 // 1 hour
    
    private let storage: FeatureFlagStorage
    
    // MARK: - Initialization
    
    private init() {
        // Generate stable user identifier for rollout
        if let stored = UserDefaults.standard.string(forKey: "com.railgun.nodemode.userId") {
            self.userIdentifier = stored
        } else {
            let newId = UUID().uuidString
            UserDefaults.standard.set(newId, forKey: "com.railgun.nodemode.userId")
            self.userIdentifier = newId
        }
        
        self.storage = FileFeatureFlagStorage()
        
        // Load cached flags
        Task {
            await loadCachedFlags()
        }
    }
    
    // MARK: - Flag Checking
    
    /// Check if a feature is enabled
    public func isEnabled(_ key: FeatureKey) -> Bool {
        return isEnabled(key.rawValue)
    }
    
    /// Check if a feature is enabled by string key
    public func isEnabled(_ key: String) -> Bool {
        // Check kill switch first
        if key != FeatureKey.killSwitch.rawValue {
            if let killSwitch = flags[FeatureKey.killSwitch.rawValue], killSwitch.enabled {
                return false // Kill switch active, disable everything
            }
        }
        
        // Check local override
        if let override = overrides[key] {
            return override
        }
        
        // Check flag
        guard let flag = flags[key] else {
            // Default to enabled if not configured
            return true
        }
        
        // Check expiry
        if flag.isExpired {
            return true // Default to enabled if flag expired
        }
        
        // Check if globally disabled
        if !flag.enabled {
            return false
        }
        
        // Check version requirements
        if let minVersion = flag.minVersion {
            if !isVersionAtLeast(minVersion) {
                return false
            }
        }
        
        if let maxVersion = flag.maxVersion {
            if !isVersionAtMost(maxVersion) {
                return false
            }
        }
        
        // Check rollout percentage
        if flag.rolloutPercentage < 1.0 {
            return isUserInRollout(key: key, percentage: flag.rolloutPercentage)
        }
        
        return true
    }
    
    /// Check if kill switch is active
    public func isKillSwitchActive() -> Bool {
        if let killSwitch = flags[FeatureKey.killSwitch.rawValue] {
            return killSwitch.enabled
        }
        return false
    }
    
    // MARK: - Flag Management
    
    /// Set a local override for testing
    public func setOverride(_ key: FeatureKey, enabled: Bool) {
        overrides[key.rawValue] = enabled
    }
    
    /// Remove a local override
    public func removeOverride(_ key: FeatureKey) {
        overrides.removeValue(forKey: key.rawValue)
    }
    
    /// Clear all local overrides
    public func clearOverrides() {
        overrides.removeAll()
    }
    
    /// Get current value of a flag
    public func getFlag(_ key: FeatureKey) -> FeatureFlag? {
        return flags[key.rawValue]
    }
    
    /// Get all flags
    public func getAllFlags() -> [FeatureFlag] {
        return Array(flags.values)
    }
    
    // MARK: - Remote Fetch
    
    /// Fetch flags from remote server
    public func fetchFlags(from url: URL? = nil) async throws {
        let fetchURL = url ?? URL(string: "https://config.railgun.app/flags")!
        
        var request = URLRequest(url: fetchURL)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(bundleIdentifier(), forHTTPHeaderField: "X-App-ID")
        request.setValue(currentVersion(), forHTTPHeaderField: "X-App-Version")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw FeatureFlagError.fetchFailed
        }
        
        let fetchedFlags = try JSONDecoder().decode([FeatureFlag].self, from: data)
        
        // Update flags
        for flag in fetchedFlags {
            flags[flag.key] = flag
        }
        
        lastFetchTime = Date()
        
        // Cache flags
        await saveCachedFlags()
    }
    
    /// Check if flags need refresh
    public func needsRefresh() -> Bool {
        guard let lastFetch = lastFetchTime else {
            return true
        }
        return Date().timeIntervalSince(lastFetch) > cacheExpiry
    }
    
    // MARK: - Persistence
    
    private func loadCachedFlags() async {
        if let cached = await storage.load() {
            for flag in cached {
                flags[flag.key] = flag
            }
        }
        
        // Load default flags if none cached
        if flags.isEmpty {
            loadDefaultFlags()
        }
    }
    
    private func saveCachedFlags() async {
        await storage.save(Array(flags.values))
    }
    
    private func loadDefaultFlags() {
        // Default all features to enabled
        for key in FeatureKey.allCases {
            let defaultEnabled = !key.rawValue.hasPrefix("kill.")
            flags[key.rawValue] = FeatureFlag(key: key.rawValue, enabled: defaultEnabled)
        }
    }
    
    // MARK: - Helpers
    
    private func isUserInRollout(key: String, percentage: Double) -> Bool {
        // Use hash of user ID + key for stable rollout
        let combined = "\(userIdentifier)-\(key)"
        let hash = combined.hashValue
        let normalized = Double(abs(hash) % 10000) / 10000.0
        return normalized < percentage
    }
    
    private func currentVersion() -> String {
        return NodeModeVersion.current
    }
    
    private func bundleIdentifier() -> String {
        return NodeModeVersion.bundleId
    }
    
    private func isVersionAtLeast(_ version: String) -> Bool {
        return currentVersion().compare(version, options: .numeric) != .orderedAscending
    }
    
    private func isVersionAtMost(_ version: String) -> Bool {
        return currentVersion().compare(version, options: .numeric) != .orderedDescending
    }
}

// MARK: - Version Info (Set by consuming app)

public enum NodeModeVersion {
    public static var current: String = "1.0.0"
    public static var bundleId: String = "com.railgun.nodemode"
}

// MARK: - Feature Flag Error

public enum FeatureFlagError: Error, LocalizedError {
    case fetchFailed
    case invalidResponse
    case networkError(String)
    
    public var errorDescription: String? {
        switch self {
        case .fetchFailed: return "Failed to fetch feature flags"
        case .invalidResponse: return "Invalid response from server"
        case .networkError(let msg): return "Network error: \(msg)"
        }
    }
}

// MARK: - Feature Flag Storage Protocol

public protocol FeatureFlagStorage: Sendable {
    func load() async -> [FeatureFlag]?
    func save(_ flags: [FeatureFlag]) async
}

// MARK: - File Feature Flag Storage

public actor FileFeatureFlagStorage: FeatureFlagStorage {
    private let fileURL: URL
    
    public init() {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.fileURL = documentsPath.appendingPathComponent("feature_flags.json")
    }
    
    public func load() async -> [FeatureFlag]? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode([FeatureFlag].self, from: data)
    }
    
    public func save(_ flags: [FeatureFlag]) async {
        guard let data = try? JSONEncoder().encode(flags) else { return }
        try? data.write(to: fileURL)
    }
}

// MARK: - Kill Switch

/// Emergency kill switch for disabling features
public actor KillSwitch {
    
    public static let shared = KillSwitch()
    
    private var localKilled: Set<String> = []
    private var remoteKilled: Set<String> = []
    private var killReason: [String: String] = [:]
    
    private init() {}
    
    /// Check if a feature is killed
    public func isKilled(_ key: FeatureKey) -> Bool {
        return localKilled.contains(key.rawValue) || remoteKilled.contains(key.rawValue)
    }
    
    /// Kill a feature locally (for testing/debugging)
    public func localKill(_ key: FeatureKey, reason: String? = nil) {
        localKilled.insert(key.rawValue)
        if let reason = reason {
            killReason[key.rawValue] = reason
        }
    }
    
    /// Unkill a locally killed feature
    public func localUnkill(_ key: FeatureKey) {
        localKilled.remove(key.rawValue)
        killReason.removeValue(forKey: key.rawValue)
    }
    
    /// Update remote kill list (called from feature flag fetch)
    public func updateRemoteKills(_ kills: [String]) {
        remoteKilled = Set(kills)
    }
    
    /// Get reason why a feature is killed
    public func getKillReason(_ key: FeatureKey) -> String? {
        return killReason[key.rawValue]
    }
    
    /// Get all killed features
    public func getKilledFeatures() -> [String] {
        return Array(localKilled.union(remoteKilled))
    }
}

// MARK: - Configuration Remote Update

public struct RemoteConfig: Codable {
    public let version: Int
    public let flags: [FeatureFlag]
    public let killList: [String]
    public let bootstrapNodes: [String]?
    public let relayServers: [String]?
    public let stunServers: [String]?
    public let turnServers: [String]?
    public let message: String?
    
    public init(version: Int,
                flags: [FeatureFlag],
                killList: [String] = [],
                bootstrapNodes: [String]? = nil,
                relayServers: [String]? = nil,
                stunServers: [String]? = nil,
                turnServers: [String]? = nil,
                message: String? = nil) {
        self.version = version
        self.flags = flags
        self.killList = killList
        self.bootstrapNodes = bootstrapNodes
        self.relayServers = relayServers
        self.stunServers = stunServers
        self.turnServers = turnServers
        self.message = message
    }
}
