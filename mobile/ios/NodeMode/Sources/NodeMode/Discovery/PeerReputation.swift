//
//  PeerReputation.swift
//  RailGun Node Mode
//
//  Peer reputation and trust scoring system
//  Tracks peer behavior and reliability for intelligent routing
//

import Foundation

// MARK: - Reputation Score

public struct ReputationScore: Codable {
    public var successfulConnections: Int
    public var failedConnections: Int
    public var messagesRelayed: Int
    public var messagesDropped: Int
    public var averageLatencyMs: Double
    public var lastInteraction: Date
    public var penalties: [Penalty]
    public var bonuses: [Bonus]
    
    public init() {
        self.successfulConnections = 0
        self.failedConnections = 0
        self.messagesRelayed = 0
        self.messagesDropped = 0
        self.averageLatencyMs = 0
        self.lastInteraction = Date()
        self.penalties = []
        self.bonuses = []
    }
    
    /// Calculate overall reputation score (0-100)
    public var score: Double {
        var base: Double = 50 // Start at neutral
        
        // Connection reliability (+/- 20 points)
        let totalConnections = successfulConnections + failedConnections
        if totalConnections > 0 {
            let successRate = Double(successfulConnections) / Double(totalConnections)
            base += (successRate - 0.5) * 40
        }
        
        // Message reliability (+/- 15 points)
        let totalMessages = messagesRelayed + messagesDropped
        if totalMessages > 0 {
            let relayRate = Double(messagesRelayed) / Double(totalMessages)
            base += (relayRate - 0.5) * 30
        }
        
        // Latency factor (+/- 10 points)
        if averageLatencyMs > 0 {
            // Lower latency = higher score
            // 50ms = +10, 200ms = 0, 500ms = -10
            let latencyScore = max(-10, min(10, (200 - averageLatencyMs) / 15))
            base += latencyScore
        }
        
        // Apply penalties
        let penaltySum = penalties.reduce(0.0) { $0 + $1.impact }
        base -= min(penaltySum, 30) // Cap penalty impact at 30 points
        
        // Apply bonuses
        let bonusSum = bonuses.reduce(0.0) { $0 + $1.impact }
        base += min(bonusSum, 20) // Cap bonus impact at 20 points
        
        // Recency factor - decay if not seen recently
        let daysSinceInteraction = Date().timeIntervalSince(lastInteraction) / 86400
        if daysSinceInteraction > 7 {
            base -= min(daysSinceInteraction - 7, 10)
        }
        
        return max(0, min(100, base))
    }
    
    /// Reputation tier based on score
    public var tier: ReputationTier {
        switch score {
        case 80...100: return .trusted
        case 60..<80: return .reliable
        case 40..<60: return .neutral
        case 20..<40: return .suspicious
        default: return .untrusted
        }
    }
}

// MARK: - Reputation Tier

public enum ReputationTier: String, Codable {
    case trusted     // High reliability, prioritize
    case reliable    // Good track record
    case neutral     // Unknown or mixed
    case suspicious  // Some issues noted
    case untrusted   // Known bad actor
    
    public var priority: Int {
        switch self {
        case .trusted: return 5
        case .reliable: return 4
        case .neutral: return 3
        case .suspicious: return 2
        case .untrusted: return 1
        }
    }
    
    public var shouldRelay: Bool {
        return self != .untrusted
    }
    
    public var connectionLimit: Int {
        switch self {
        case .trusted: return 50
        case .reliable: return 30
        case .neutral: return 15
        case .suspicious: return 5
        case .untrusted: return 0
        }
    }
}

// MARK: - Penalty & Bonus

public struct Penalty: Codable, Identifiable {
    public var id: String
    public let reason: PenaltyReason
    public let impact: Double
    public let timestamp: Date
    public let expiresAt: Date?
    
    public init(reason: PenaltyReason, impact: Double, duration: TimeInterval? = nil) {
        self.id = UUID().uuidString
        self.reason = reason
        self.impact = impact
        self.timestamp = Date()
        self.expiresAt = duration.map { Date().addingTimeInterval($0) }
    }
    
    public var isExpired: Bool {
        if let expires = expiresAt {
            return Date() > expires
        }
        return false
    }
}

public enum PenaltyReason: String, Codable {
    case connectionAbuse      // Too many connection attempts
    case messageSpam          // Flooding messages
    case protocolViolation    // Invalid protocol behavior
    case tamperedMessage      // Signature/MAC failure
    case timeoutExcessive     // Frequent timeouts
    case badRouting          // Routing incorrect information
    case reportedByPeers     // Other peers reported issues
}

public struct Bonus: Codable, Identifiable {
    public var id: String
    public let reason: BonusReason
    public let impact: Double
    public let timestamp: Date
    public let expiresAt: Date?
    
    public init(reason: BonusReason, impact: Double, duration: TimeInterval? = nil) {
        self.id = UUID().uuidString
        self.reason = reason
        self.impact = impact
        self.timestamp = Date()
        self.expiresAt = duration.map { Date().addingTimeInterval($0) }
    }
    
    public var isExpired: Bool {
        if let expires = expiresAt {
            return Date() > expires
        }
        return false
    }
}

public enum BonusReason: String, Codable {
    case reliableRelay       // Consistently relays messages
    case lowLatency         // Fast responses
    case longUptime         // Available for extended periods
    case helpedBootstrap    // Helped new nodes join
    case validatedBlocks    // Participated in consensus (if applicable)
}

// MARK: - Reputation Manager

public actor ReputationManager {
    
    // MARK: - Properties
    
    private var peerScores: [String: ReputationScore] = [:]
    private let storage: ReputationStorage
    private var banList: Set<String> = []
    private var whiteList: Set<String> = []
    
    // Configuration
    private let banThreshold: Double = 15
    private let autoUnbanDays: Int = 7
    
    // MARK: - Initialization
    
    public init(storage: ReputationStorage = InMemoryReputationStorage()) {
        self.storage = storage
    }
    
    public func load() async {
        if let stored = await storage.loadScores() {
            peerScores = stored
        }
        if let banned = await storage.loadBanList() {
            banList = banned
        }
    }
    
    public func save() async {
        await storage.saveScores(peerScores)
        await storage.saveBanList(banList)
    }
    
    // MARK: - Score Access
    
    public func getScore(for peerId: String) -> ReputationScore {
        return peerScores[peerId] ?? ReputationScore()
    }
    
    public func getTier(for peerId: String) -> ReputationTier {
        if banList.contains(peerId) {
            return .untrusted
        }
        if whiteList.contains(peerId) {
            return .trusted
        }
        return getScore(for: peerId).tier
    }
    
    public func isBanned(_ peerId: String) -> Bool {
        return banList.contains(peerId)
    }
    
    public func isWhitelisted(_ peerId: String) -> Bool {
        return whiteList.contains(peerId)
    }
    
    // MARK: - Event Recording
    
    public func recordConnectionSuccess(peerId: String) {
        var score = peerScores[peerId] ?? ReputationScore()
        score.successfulConnections += 1
        score.lastInteraction = Date()
        peerScores[peerId] = score
    }
    
    public func recordConnectionFailure(peerId: String) {
        var score = peerScores[peerId] ?? ReputationScore()
        score.failedConnections += 1
        score.lastInteraction = Date()
        peerScores[peerId] = score
        
        checkForBan(peerId: peerId)
    }
    
    public func recordMessageRelayed(peerId: String, latencyMs: Double) {
        var score = peerScores[peerId] ?? ReputationScore()
        score.messagesRelayed += 1
        score.lastInteraction = Date()
        
        // Update average latency
        let total = score.averageLatencyMs * Double(score.messagesRelayed - 1) + latencyMs
        score.averageLatencyMs = total / Double(score.messagesRelayed)
        
        peerScores[peerId] = score
    }
    
    public func recordMessageDropped(peerId: String) {
        var score = peerScores[peerId] ?? ReputationScore()
        score.messagesDropped += 1
        score.lastInteraction = Date()
        peerScores[peerId] = score
        
        checkForBan(peerId: peerId)
    }
    
    // MARK: - Penalties & Bonuses
    
    public func applyPenalty(to peerId: String, reason: PenaltyReason, impact: Double, duration: TimeInterval? = nil) {
        var score = peerScores[peerId] ?? ReputationScore()
        let penalty = Penalty(reason: reason, impact: impact, duration: duration)
        score.penalties.append(penalty)
        score.lastInteraction = Date()
        peerScores[peerId] = score
        
        checkForBan(peerId: peerId)
    }
    
    public func applyBonus(to peerId: String, reason: BonusReason, impact: Double, duration: TimeInterval? = nil) {
        var score = peerScores[peerId] ?? ReputationScore()
        let bonus = Bonus(reason: reason, impact: impact, duration: duration)
        score.bonuses.append(bonus)
        score.lastInteraction = Date()
        peerScores[peerId] = score
    }
    
    // MARK: - Ban Management
    
    public func ban(_ peerId: String, reason: String? = nil) {
        banList.insert(peerId)
    }
    
    public func unban(_ peerId: String) {
        banList.remove(peerId)
    }
    
    public func whitelist(_ peerId: String) {
        whiteList.insert(peerId)
        banList.remove(peerId)
    }
    
    public func removeFromWhitelist(_ peerId: String) {
        whiteList.remove(peerId)
    }
    
    private func checkForBan(peerId: String) {
        if whiteList.contains(peerId) {
            return
        }
        
        let score = getScore(for: peerId)
        if score.score < banThreshold {
            banList.insert(peerId)
        }
    }
    
    // MARK: - Cleanup
    
    public func cleanupExpiredPenalties() {
        for (peerId, var score) in peerScores {
            score.penalties.removeAll { $0.isExpired }
            score.bonuses.removeAll { $0.isExpired }
            peerScores[peerId] = score
        }
    }
    
    public func pruneOldScores(olderThan days: Int = 30) {
        let cutoff = Date().addingTimeInterval(-Double(days) * 86400)
        peerScores = peerScores.filter { $0.value.lastInteraction > cutoff }
    }
    
    // MARK: - Queries
    
    /// Get top-rated peers
    public func topPeers(count: Int = 10) -> [(String, ReputationScore)] {
        return peerScores
            .filter { !banList.contains($0.key) }
            .sorted { $0.value.score > $1.value.score }
            .prefix(count)
            .map { ($0.key, $0.value) }
    }
    
    /// Get peers suitable for routing
    public func getPeersForRouting(count: Int = 5) -> [String] {
        return peerScores
            .filter { !banList.contains($0.key) && $0.value.tier.shouldRelay }
            .sorted { $0.value.score > $1.value.score }
            .prefix(count)
            .map { $0.key }
    }
    
    /// Get statistics
    public func getStats() -> ReputationStats {
        let scores = peerScores.values
        
        let tiers = Dictionary(grouping: scores) { $0.tier }
        
        return ReputationStats(
            totalPeers: peerScores.count,
            bannedPeers: banList.count,
            whitelistedPeers: whiteList.count,
            trustedCount: tiers[.trusted]?.count ?? 0,
            reliableCount: tiers[.reliable]?.count ?? 0,
            neutralCount: tiers[.neutral]?.count ?? 0,
            suspiciousCount: tiers[.suspicious]?.count ?? 0,
            untrustedCount: tiers[.untrusted]?.count ?? 0,
            averageScore: scores.isEmpty ? 50 : scores.map { $0.score }.reduce(0, +) / Double(scores.count)
        )
    }
}

// MARK: - Reputation Stats

public struct ReputationStats {
    public let totalPeers: Int
    public let bannedPeers: Int
    public let whitelistedPeers: Int
    public let trustedCount: Int
    public let reliableCount: Int
    public let neutralCount: Int
    public let suspiciousCount: Int
    public let untrustedCount: Int
    public let averageScore: Double
}

// MARK: - Reputation Storage Protocol

public protocol ReputationStorage: Sendable {
    func loadScores() async -> [String: ReputationScore]?
    func saveScores(_ scores: [String: ReputationScore]) async
    func loadBanList() async -> Set<String>?
    func saveBanList(_ banList: Set<String>) async
}

// MARK: - In-Memory Storage

public actor InMemoryReputationStorage: ReputationStorage {
    private var scores: [String: ReputationScore]?
    private var banList: Set<String>?
    
    public init() {}
    
    public func loadScores() async -> [String: ReputationScore]? {
        return scores
    }
    
    public func saveScores(_ scores: [String: ReputationScore]) async {
        self.scores = scores
    }
    
    public func loadBanList() async -> Set<String>? {
        return banList
    }
    
    public func saveBanList(_ banList: Set<String>) async {
        self.banList = banList
    }
}

// MARK: - File-Based Storage

public actor FileReputationStorage: ReputationStorage {
    private let scoresURL: URL
    private let banListURL: URL
    
    public init(directory: URL) {
        self.scoresURL = directory.appendingPathComponent("reputation_scores.json")
        self.banListURL = directory.appendingPathComponent("ban_list.json")
        
        // Create directory if needed
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    
    public func loadScores() async -> [String: ReputationScore]? {
        guard let data = try? Data(contentsOf: scoresURL) else { return nil }
        return try? JSONDecoder().decode([String: ReputationScore].self, from: data)
    }
    
    public func saveScores(_ scores: [String: ReputationScore]) async {
        guard let data = try? JSONEncoder().encode(scores) else { return }
        try? data.write(to: scoresURL)
    }
    
    public func loadBanList() async -> Set<String>? {
        guard let data = try? Data(contentsOf: banListURL) else { return nil }
        return try? JSONDecoder().decode(Set<String>.self, from: data)
    }
    
    public func saveBanList(_ banList: Set<String>) async {
        guard let data = try? JSONEncoder().encode(banList) else { return }
        try? data.write(to: banListURL)
    }
}
