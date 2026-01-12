//
//  Node.swift
//  RailGun Node Mode
//
//  Mesh peer node model
//

import Foundation

// MARK: - Node Capabilities

public struct NodeCapabilities: OptionSet, Codable {
    public let rawValue: UInt8
    
    public init(rawValue: UInt8) {
        self.rawValue = rawValue
    }
    
    /// Node can relay messages to other nodes
    public static let canRelay = NodeCapabilities(rawValue: 1 << 0)
    
    /// Node can store messages for later delivery
    public static let canStore = NodeCapabilities(rawValue: 1 << 1)
    
    /// Node has internet connectivity (can act as gateway)
    public static let hasInternet = NodeCapabilities(rawValue: 1 << 2)
    
    /// Node has high bandwidth connection
    public static let highBandwidth = NodeCapabilities(rawValue: 1 << 3)
    
    /// Node has high storage capacity
    public static let highStorage = NodeCapabilities(rawValue: 1 << 4)
    
    /// Node supports BLE transport
    public static let supportsBLE = NodeCapabilities(rawValue: 1 << 5)
    
    /// Node supports WiFi Direct transport
    public static let supportsWiFiDirect = NodeCapabilities(rawValue: 1 << 6)
    
    /// Default capabilities
    public static let `default`: NodeCapabilities = [.canRelay, .canStore]
}

// MARK: - Connection Type

public enum ConnectionType: String, Codable {
    case ble = "ble"
    case wifiDirect = "wifi_direct"
    case lan = "lan"
    case multipeer = "multipeer"
    case unknown = "unknown"
}

// MARK: - Node

/// Represents a mesh peer in the Node Mode network
public struct Node: Identifiable, Codable, Equatable {
    
    // MARK: - Identity
    
    /// Node ID (Ed25519 public key as hex string)
    public let id: String
    
    /// Associated user ID (if known)
    public var userId: String?
    
    /// Human-readable display name (optional)
    public var displayName: String?
    
    // MARK: - Capabilities
    
    /// Node capability flags
    public var capabilities: NodeCapabilities
    
    // MARK: - Discovery State
    
    /// First time this node was discovered
    public let firstSeen: Int64
    
    /// Most recent time this node was seen
    public var lastSeen: Int64
    
    /// Number of times this node has been discovered
    public var timesSeen: Int
    
    // MARK: - Location
    
    /// Last known geohash location
    public var lastGeoHash: String?
    
    /// Accuracy of last location (meters)
    public var lastGeoAccuracy: Int?
    
    // MARK: - Reputation
    
    /// Reputation score (0.0 to 1.0)
    public var reputation: Double
    
    /// Number of samples used to calculate reputation
    public var reputationSamples: Int
    
    // MARK: - Statistics
    
    /// Number of bundles received from this node
    public var bundlesReceivedFrom: Int
    
    /// Number of bundles sent to this node
    public var bundlesSentTo: Int
    
    /// Bytes received from this node
    public var bytesReceivedFrom: Int64
    
    /// Bytes sent to this node
    public var bytesSentTo: Int64
    
    /// Successful deliveries via this node
    public var deliverySuccesses: Int
    
    /// Failed deliveries via this node
    public var deliveryFailures: Int
    
    // MARK: - PROPHET Routing
    
    /// Delivery predictability (P(a,b) in PROPHET)
    public var deliveryPredictability: Double
    
    /// Last time predictability was updated
    public var predictabilityUpdatedAt: Int64?
    
    // MARK: - Connection Info
    
    /// Last connection type used
    public var lastConnectionType: ConnectionType?
    
    /// Last RSSI (signal strength) reading
    public var lastRssi: Int?
    
    /// Is currently connected
    public var isConnected: Bool = false
    
    // MARK: - Computed Properties
    
    /// Node ID as Data (32 bytes)
    public var nodeIdData: Data? {
        Data(hexString: id)
    }
    
    /// Delivery success rate
    public var deliverySuccessRate: Double {
        let total = deliverySuccesses + deliveryFailures
        guard total > 0 else { return 0.5 }
        return Double(deliverySuccesses) / Double(total)
    }
    
    /// Is this node a gateway (has internet)?
    public var isGateway: Bool {
        capabilities.contains(.hasInternet)
    }
    
    /// Time since last seen (seconds)
    public var timeSinceLastSeen: TimeInterval {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return Double(now - lastSeen) / 1000.0
    }
    
    /// Is this node recently active (seen in last hour)?
    public var isRecentlyActive: Bool {
        timeSinceLastSeen < 3600
    }
    
    // MARK: - Initialization
    
    public init(
        id: String,
        userId: String? = nil,
        displayName: String? = nil,
        capabilities: NodeCapabilities = .default,
        firstSeen: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        lastSeen: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        timesSeen: Int = 1,
        lastGeoHash: String? = nil,
        lastGeoAccuracy: Int? = nil,
        reputation: Double = 0.5,
        reputationSamples: Int = 0,
        bundlesReceivedFrom: Int = 0,
        bundlesSentTo: Int = 0,
        bytesReceivedFrom: Int64 = 0,
        bytesSentTo: Int64 = 0,
        deliverySuccesses: Int = 0,
        deliveryFailures: Int = 0,
        deliveryPredictability: Double = 0.0,
        predictabilityUpdatedAt: Int64? = nil,
        lastConnectionType: ConnectionType? = nil,
        lastRssi: Int? = nil
    ) {
        self.id = id
        self.userId = userId
        self.displayName = displayName
        self.capabilities = capabilities
        self.firstSeen = firstSeen
        self.lastSeen = lastSeen
        self.timesSeen = timesSeen
        self.lastGeoHash = lastGeoHash
        self.lastGeoAccuracy = lastGeoAccuracy
        self.reputation = reputation
        self.reputationSamples = reputationSamples
        self.bundlesReceivedFrom = bundlesReceivedFrom
        self.bundlesSentTo = bundlesSentTo
        self.bytesReceivedFrom = bytesReceivedFrom
        self.bytesSentTo = bytesSentTo
        self.deliverySuccesses = deliverySuccesses
        self.deliveryFailures = deliveryFailures
        self.deliveryPredictability = deliveryPredictability
        self.predictabilityUpdatedAt = predictabilityUpdatedAt
        self.lastConnectionType = lastConnectionType
        self.lastRssi = lastRssi
    }
    
    // MARK: - Equatable
    
    public static func == (lhs: Node, rhs: Node) -> Bool {
        lhs.id == rhs.id
    }
    
    // MARK: - Reputation Updates
    
    /// Update reputation based on delivery outcome
    public mutating func updateReputation(success: Bool) {
        let weight = 1.0 / Double(reputationSamples + 1)
        let outcome = success ? 1.0 : 0.0
        reputation = reputation * (1 - weight) + outcome * weight
        reputationSamples += 1
        
        if success {
            deliverySuccesses += 1
        } else {
            deliveryFailures += 1
        }
    }
    
    // MARK: - PROPHET Predictability
    
    /// Update delivery predictability on encounter
    /// Uses PROPHET algorithm: P(a,b) = P(a,b)_old + (1 - P(a,b)_old) * P_init
    public mutating func updatePredictabilityOnEncounter(initialProbability: Double = 0.75) {
        deliveryPredictability = deliveryPredictability + (1 - deliveryPredictability) * initialProbability
        predictabilityUpdatedAt = Int64(Date().timeIntervalSince1970 * 1000)
    }
    
    /// Age the predictability over time
    /// Uses PROPHET algorithm: P(a,b) = P(a,b)_old * gamma^k
    public mutating func agePredictability(gamma: Double = 0.98, timeDelta: TimeInterval) {
        let k = timeDelta / 60.0 // Age per minute
        deliveryPredictability = deliveryPredictability * pow(gamma, k)
        predictabilityUpdatedAt = Int64(Date().timeIntervalSince1970 * 1000)
    }
    
    /// Compute transitive predictability
    /// P(a,c) = P(a,c)_old + (1 - P(a,c)_old) * P(a,b) * P(b,c) * beta
    public mutating func updateTransitivePredictability(
        via intermediateNode: Node,
        toDestination destinationPredictability: Double,
        beta: Double = 0.25
    ) {
        let transitive = deliveryPredictability * intermediateNode.deliveryPredictability * destinationPredictability * beta
        deliveryPredictability = deliveryPredictability + (1 - deliveryPredictability) * transitive
        predictabilityUpdatedAt = Int64(Date().timeIntervalSince1970 * 1000)
    }
    
    // MARK: - Record Activity
    
    /// Record that this node was seen
    public mutating func recordSeen(connectionType: ConnectionType? = nil, rssi: Int? = nil) {
        lastSeen = Int64(Date().timeIntervalSince1970 * 1000)
        timesSeen += 1
        
        if let connectionType = connectionType {
            lastConnectionType = connectionType
        }
        if let rssi = rssi {
            lastRssi = rssi
        }
    }
    
    /// Record bundle received from this node
    public mutating func recordBundleReceived(bytes: Int) {
        bundlesReceivedFrom += 1
        bytesReceivedFrom += Int64(bytes)
        recordSeen()
    }
    
    /// Record bundle sent to this node
    public mutating func recordBundleSent(bytes: Int) {
        bundlesSentTo += 1
        bytesSentTo += Int64(bytes)
    }
}

// MARK: - Data Hex Extension

extension Data {
    init?(hexString: String) {
        let hex = hexString.lowercased()
        guard hex.count % 2 == 0 else { return nil }
        
        var data = Data()
        var index = hex.startIndex
        
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<nextIndex], radix: 16) else {
                return nil
            }
            data.append(byte)
            index = nextIndex
        }
        
        self = data
    }
    
    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
