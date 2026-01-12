//
//  Bundle.swift
//  RailGun Node Mode
//
//  Core bundle model for delay-tolerant networking
//

import Foundation

// MARK: - Bundle Priority

public enum BundlePriority: Int, Codable, Comparable {
    case bulk = 0       // Best effort, lowest priority
    case normal = 1     // Standard messages
    case urgent = 2     // Time-sensitive
    case critical = 3   // Emergency/safety messages
    
    public static func < (lhs: BundlePriority, rhs: BundlePriority) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

// MARK: - Bundle Flags

public struct BundleFlags: OptionSet, Codable {
    public let rawValue: UInt8
    
    public init(rawValue: UInt8) {
        self.rawValue = rawValue
    }
    
    public static let encrypted = BundleFlags(rawValue: 1 << 0)
    public static let requestAck = BundleFlags(rawValue: 1 << 1)
    public static let isAck = BundleFlags(rawValue: 1 << 2)
    public static let noRelay = BundleFlags(rawValue: 1 << 3)
    public static let broadcast = BundleFlags(rawValue: 1 << 4)
    public static let compressed = BundleFlags(rawValue: 1 << 5)
    
    public static let `default`: BundleFlags = [.encrypted, .requestAck]
}

// MARK: - Destination Type

public enum DestinationType: Int, Codable {
    case user = 0       // Deliver to specific user
    case node = 1       // Deliver to specific node
    case broadcast = 2  // Flood to all nodes
    case geographic = 3 // Deliver to geographic region
}

// MARK: - Bundle State

public enum BundleState: Int, Codable {
    case pending = 0    // Awaiting delivery
    case delivered = 1  // Successfully delivered
    case failed = 2     // Delivery failed (retries exhausted)
    case expired = 3    // TTL exceeded
}

// MARK: - Bundle

/// Core data unit for Node Mode mesh networking
public struct Bundle: Identifiable, Codable, Equatable {
    
    // MARK: - Properties
    
    /// Unique bundle identifier (UUID)
    public let id: UUID
    
    /// Protocol version
    public let version: UInt8
    
    /// Bundle flags
    public var flags: BundleFlags
    
    /// Delivery priority
    public let priority: BundlePriority
    
    /// Current hop count (incremented on relay)
    public var hopCount: UInt8
    
    /// Maximum allowed hops
    public let maxHops: UInt8
    
    /// Bundle creation timestamp (Unix ms)
    public let createdAt: Int64
    
    /// Bundle expiration timestamp (Unix ms)
    public let expiresAt: Int64
    
    /// Source node public key (Ed25519, 32 bytes)
    public let sourceNode: Data
    
    /// Destination type
    public let destinationType: DestinationType
    
    /// Destination identifier (32 bytes - user ID or node ID)
    public let destination: Data
    
    /// Geographic hint (optional, for geographic routing)
    public let geoHash: String?
    
    /// Encrypted payload
    public let payload: Data
    
    /// Ed25519 signature over bundle header + payload hash
    public let signature: Data
    
    // MARK: - Local State (not serialized)
    
    /// Current delivery state
    public var state: BundleState = .pending
    
    /// Number of delivery attempts
    public var deliveryAttempts: Int = 0
    
    /// Last delivery attempt timestamp
    public var lastAttemptAt: Int64?
    
    /// Delivery completion timestamp
    public var deliveredAt: Int64?
    
    /// Node that confirmed delivery
    public var deliveredTo: Data?
    
    /// Timestamp when this bundle was received locally
    public var receivedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    
    /// Is this bundle destined for the local user?
    public var isOwnMessage: Bool = false
    
    /// Did this node create this bundle?
    public var isOutgoing: Bool = false
    
    // MARK: - Computed Properties
    
    /// Payload size in bytes
    public var payloadSize: Int {
        payload.count
    }
    
    /// Total serialized size in bytes
    public var totalSize: Int {
        // Fixed header: 1 + 1 + 1 + 1 + 1 + 8 + 8 + 32 + 1 + 32 + 64 = 150 bytes
        // Variable: geoHash + payload
        150 + (geoHash?.utf8.count ?? 0) + payload.count
    }
    
    /// Is the bundle expired?
    public var isExpired: Bool {
        Int64(Date().timeIntervalSince1970 * 1000) > expiresAt
    }
    
    /// Has the bundle exceeded max hops?
    public var isMaxHopsExceeded: Bool {
        hopCount >= maxHops
    }
    
    /// Can this bundle be relayed?
    public var canRelay: Bool {
        !isExpired && !isMaxHopsExceeded && !flags.contains(.noRelay) && state == .pending
    }
    
    /// Time remaining until expiration (seconds)
    public var ttlRemaining: TimeInterval {
        let remaining = Double(expiresAt - Int64(Date().timeIntervalSince1970 * 1000)) / 1000.0
        return max(0, remaining)
    }
    
    // MARK: - Initialization
    
    public init(
        id: UUID = UUID(),
        version: UInt8 = 1,
        flags: BundleFlags = .default,
        priority: BundlePriority = .normal,
        hopCount: UInt8 = 0,
        maxHops: UInt8 = 10,
        createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        expiresAt: Int64? = nil,
        sourceNode: Data,
        destinationType: DestinationType = .user,
        destination: Data,
        geoHash: String? = nil,
        payload: Data,
        signature: Data
    ) {
        self.id = id
        self.version = version
        self.flags = flags
        self.priority = priority
        self.hopCount = hopCount
        self.maxHops = maxHops
        self.createdAt = createdAt
        self.expiresAt = expiresAt ?? (createdAt + (72 * 60 * 60 * 1000)) // Default 72h TTL
        self.sourceNode = sourceNode
        self.destinationType = destinationType
        self.destination = destination
        self.geoHash = geoHash
        self.payload = payload
        self.signature = signature
    }
    
    // MARK: - Relay Preparation
    
    /// Prepare bundle for relay (increment hop count)
    public func preparedForRelay() throws -> Bundle {
        guard canRelay else {
            if isExpired {
                throw BundleError.expired
            } else if isMaxHopsExceeded {
                throw BundleError.maxHopsExceeded
            } else if flags.contains(.noRelay) {
                throw BundleError.relayDisabled
            } else {
                throw BundleError.invalidState
            }
        }
        
        var relayed = self
        relayed.hopCount += 1
        return relayed
    }
    
    // MARK: - Equatable
    
    public static func == (lhs: Bundle, rhs: Bundle) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Bundle Error

public enum BundleError: Error, LocalizedError {
    case expired
    case maxHopsExceeded
    case relayDisabled
    case invalidState
    case invalidSignature
    case payloadTooLarge
    case serializationFailed
    case deserializationFailed
    
    public var errorDescription: String? {
        switch self {
        case .expired:
            return "Bundle has expired"
        case .maxHopsExceeded:
            return "Bundle has exceeded maximum hops"
        case .relayDisabled:
            return "Bundle relay is disabled"
        case .invalidState:
            return "Bundle is in an invalid state for this operation"
        case .invalidSignature:
            return "Bundle signature is invalid"
        case .payloadTooLarge:
            return "Bundle payload exceeds maximum size"
        case .serializationFailed:
            return "Failed to serialize bundle"
        case .deserializationFailed:
            return "Failed to deserialize bundle"
        }
    }
}

// MARK: - Bundle Serialization

extension Bundle {
    
    /// Serialize bundle to binary format
    public func serialize() throws -> Data {
        var data = Data()
        
        // Header (fixed size: 150 bytes + variable)
        data.append(version)
        data.append(flags.rawValue)
        data.append(UInt8(priority.rawValue))
        data.append(hopCount)
        data.append(maxHops)
        
        // Timestamps (big endian)
        data.append(contentsOf: withUnsafeBytes(of: createdAt.bigEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: expiresAt.bigEndian) { Array($0) })
        
        // UUID (16 bytes)
        let uuidBytes = withUnsafePointer(to: id.uuid) {
            Data(bytes: $0, count: 16)
        }
        data.append(uuidBytes)
        
        // Source node (32 bytes)
        guard sourceNode.count == 32 else {
            throw BundleError.serializationFailed
        }
        data.append(sourceNode)
        
        // Destination type + destination
        data.append(UInt8(destinationType.rawValue))
        guard destination.count == 32 else {
            throw BundleError.serializationFailed
        }
        data.append(destination)
        
        // GeoHash (length-prefixed)
        if let geoHash = geoHash {
            let geoData = Data(geoHash.utf8)
            data.append(UInt8(min(geoData.count, 12)))
            data.append(geoData.prefix(12))
        } else {
            data.append(UInt8(0))
        }
        
        // Payload (length-prefixed, 4 bytes)
        let payloadLength = UInt32(payload.count)
        data.append(contentsOf: withUnsafeBytes(of: payloadLength.bigEndian) { Array($0) })
        data.append(payload)
        
        // Signature (64 bytes)
        guard signature.count == 64 else {
            throw BundleError.serializationFailed
        }
        data.append(signature)
        
        return data
    }
    
    /// Deserialize bundle from binary format
    public static func deserialize(from data: Data) throws -> Bundle {
        guard data.count >= 150 else {
            throw BundleError.deserializationFailed
        }
        
        var offset = 0
        
        // Header
        let version = data[offset]; offset += 1
        let flags = BundleFlags(rawValue: data[offset]); offset += 1
        let priority = BundlePriority(rawValue: Int(data[offset])) ?? .normal; offset += 1
        let hopCount = data[offset]; offset += 1
        let maxHops = data[offset]; offset += 1
        
        // Timestamps
        let createdAt = data.subdata(in: offset..<(offset + 8)).withUnsafeBytes { $0.load(as: Int64.self).bigEndian }
        offset += 8
        let expiresAt = data.subdata(in: offset..<(offset + 8)).withUnsafeBytes { $0.load(as: Int64.self).bigEndian }
        offset += 8
        
        // UUID
        let uuidData = data.subdata(in: offset..<(offset + 16))
        let uuid = uuidData.withUnsafeBytes { ptr -> UUID in
            let tuple = ptr.load(as: uuid_t.self)
            return UUID(uuid: tuple)
        }
        offset += 16
        
        // Source node
        let sourceNode = data.subdata(in: offset..<(offset + 32))
        offset += 32
        
        // Destination
        let destinationType = DestinationType(rawValue: Int(data[offset])) ?? .user
        offset += 1
        let destination = data.subdata(in: offset..<(offset + 32))
        offset += 32
        
        // GeoHash
        let geoLength = Int(data[offset])
        offset += 1
        let geoHash: String?
        if geoLength > 0 {
            let geoData = data.subdata(in: offset..<(offset + geoLength))
            geoHash = String(data: geoData, encoding: .utf8)
            offset += geoLength
        } else {
            geoHash = nil
        }
        
        // Payload
        guard data.count >= offset + 4 else {
            throw BundleError.deserializationFailed
        }
        let payloadLength = Int(data.subdata(in: offset..<(offset + 4)).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
        offset += 4
        
        guard data.count >= offset + payloadLength + 64 else {
            throw BundleError.deserializationFailed
        }
        let payload = data.subdata(in: offset..<(offset + payloadLength))
        offset += payloadLength
        
        // Signature
        let signature = data.subdata(in: offset..<(offset + 64))
        
        return Bundle(
            id: uuid,
            version: version,
            flags: flags,
            priority: priority,
            hopCount: hopCount,
            maxHops: maxHops,
            createdAt: createdAt,
            expiresAt: expiresAt,
            sourceNode: sourceNode,
            destinationType: destinationType,
            destination: destination,
            geoHash: geoHash,
            payload: payload,
            signature: signature
        )
    }
    
    /// Get bytes to sign (header + payload hash)
    public func bytesToSign() -> Data {
        var data = Data()
        
        // Include all header fields except signature
        data.append(version)
        data.append(flags.rawValue)
        data.append(UInt8(priority.rawValue))
        data.append(hopCount)
        data.append(maxHops)
        data.append(contentsOf: withUnsafeBytes(of: createdAt.bigEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: expiresAt.bigEndian) { Array($0) })
        
        let uuidBytes = withUnsafePointer(to: id.uuid) {
            Data(bytes: $0, count: 16)
        }
        data.append(uuidBytes)
        data.append(sourceNode)
        data.append(UInt8(destinationType.rawValue))
        data.append(destination)
        
        // Hash the payload and include the hash
        // Using SHA-256 of payload
        data.append(payload.sha256())
        
        return data
    }
}

// MARK: - Data Extension for Hashing

extension Data {
    func sha256() -> Data {
        var hash = [UInt8](repeating: 0, count: 32)
        self.withUnsafeBytes { ptr in
            _ = CC_SHA256(ptr.baseAddress, CC_LONG(self.count), &hash)
        }
        return Data(hash)
    }
}

import CommonCrypto
