//
//  KademliaDHT.swift
//  RailGun Node Mode
//
//  Kademlia-style Distributed Hash Table for peer discovery
//  Enables decentralized peer lookup without central servers
//

import Foundation
import CryptoKit

// MARK: - Node ID

/// 256-bit Node ID using SHA-256 hash of public key
public struct NodeID: Hashable, Codable, CustomStringConvertible {
    public let bytes: Data
    
    public init(bytes: Data) {
        precondition(bytes.count == 32, "NodeID must be 32 bytes")
        self.bytes = bytes
    }
    
    /// Create NodeID from public key
    public static func fromPublicKey(_ publicKey: Data) -> NodeID {
        let hash = SHA256.hash(data: publicKey)
        return NodeID(bytes: Data(hash))
    }
    
    /// Generate random NodeID
    public static func random() -> NodeID {
        var bytes = Data(count: 32)
        bytes.withUnsafeMutableBytes { ptr in
            _ = SecRandomCopyBytes(kSecRandomDefault, 32, ptr.baseAddress!)
        }
        return NodeID(bytes: bytes)
    }
    
    /// XOR distance to another NodeID
    public func distance(to other: NodeID) -> Data {
        var result = Data(count: 32)
        for i in 0..<32 {
            result[i] = bytes[i] ^ other.bytes[i]
        }
        return result
    }
    
    /// Get the bucket index for storing a node (0-255)
    public func bucketIndex(for other: NodeID) -> Int {
        let dist = distance(to: other)
        
        // Find the highest bit set
        for i in 0..<32 {
            let byte = dist[i]
            if byte != 0 {
                // Find highest bit in this byte
                for bit in (0..<8).reversed() {
                    if byte & (1 << bit) != 0 {
                        return i * 8 + (7 - bit)
                    }
                }
            }
        }
        
        return 255 // Same node
    }
    
    public var description: String {
        return bytes.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
    
    public var hexString: String {
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - DHT Node

public struct DHTNode: Codable, Hashable {
    public let id: NodeID
    public let endpoint: NodeEndpoint
    public var lastSeen: Date
    public var failedAttempts: Int
    
    public init(id: NodeID, endpoint: NodeEndpoint) {
        self.id = id
        self.endpoint = endpoint
        self.lastSeen = Date()
        self.failedAttempts = 0
    }
    
    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    public static func == (lhs: DHTNode, rhs: DHTNode) -> Bool {
        return lhs.id == rhs.id
    }
}

public struct NodeEndpoint: Codable, Hashable {
    public let host: String
    public let port: UInt16
    public let transportType: String // "ble", "lan", "websocket", etc.
    
    public init(host: String, port: UInt16, transportType: String = "lan") {
        self.host = host
        self.port = port
        self.transportType = transportType
    }
}

// MARK: - K-Bucket

/// K-Bucket for storing nodes at similar distance
public class KBucket {
    public let k: Int
    private var nodes: [DHTNode] = []
    private let lock = NSLock()
    
    public init(k: Int = 20) {
        self.k = k
    }
    
    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return nodes.count
    }
    
    public var allNodes: [DHTNode] {
        lock.lock()
        defer { lock.unlock() }
        return nodes
    }
    
    /// Add or update a node in the bucket
    @discardableResult
    public func addNode(_ node: DHTNode) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        // Check if node already exists
        if let index = nodes.firstIndex(where: { $0.id == node.id }) {
            // Move to end (most recently seen)
            var updated = nodes.remove(at: index)
            updated.lastSeen = Date()
            updated.failedAttempts = 0
            nodes.append(updated)
            return true
        }
        
        // Add new node if space available
        if nodes.count < k {
            nodes.append(node)
            return true
        }
        
        // Bucket full - check if oldest node is still alive
        // In real implementation, we'd ping the oldest node
        // For now, just reject
        return false
    }
    
    /// Remove a node from the bucket
    public func removeNode(_ nodeId: NodeID) {
        lock.lock()
        defer { lock.unlock() }
        nodes.removeAll { $0.id == nodeId }
    }
    
    /// Mark a node as failed
    public func markFailed(_ nodeId: NodeID) {
        lock.lock()
        defer { lock.unlock() }
        
        if let index = nodes.firstIndex(where: { $0.id == nodeId }) {
            nodes[index].failedAttempts += 1
            
            // Remove if too many failures
            if nodes[index].failedAttempts > 3 {
                nodes.remove(at: index)
            }
        }
    }
    
    /// Get closest nodes to a target
    public func closestNodes(to target: NodeID, count: Int) -> [DHTNode] {
        lock.lock()
        defer { lock.unlock() }
        
        return nodes
            .sorted { $0.id.distance(to: target).lexicographicallyPrecedes($1.id.distance(to: target)) }
            .prefix(count)
            .map { $0 }
    }
}

// MARK: - Kademlia DHT

public actor KademliaDHT {
    
    // MARK: - Constants
    
    public static let k = 20          // Bucket size
    public static let alpha = 3       // Parallel queries
    public static let idLength = 256  // Bits
    
    // MARK: - Properties
    
    private let selfId: NodeID
    private var buckets: [KBucket]
    private var valueStore: [String: Data] = [:]
    private var refreshTask: Task<Void, Never>?
    
    public var nodeId: NodeID { selfId }
    
    // MARK: - Initialization
    
    public init(publicKey: Data) {
        self.selfId = NodeID.fromPublicKey(publicKey)
        self.buckets = (0..<256).map { _ in KBucket(k: Self.k) }
    }
    
    public init(nodeId: NodeID) {
        self.selfId = nodeId
        self.buckets = (0..<256).map { _ in KBucket(k: Self.k) }
    }
    
    // MARK: - Node Operations
    
    /// Add a node to the routing table
    public func addNode(_ node: DHTNode) {
        guard node.id != selfId else { return }
        
        let bucketIndex = selfId.bucketIndex(for: node.id)
        buckets[bucketIndex].addNode(node)
    }
    
    /// Remove a node from the routing table
    public func removeNode(_ nodeId: NodeID) {
        let bucketIndex = selfId.bucketIndex(for: nodeId)
        buckets[bucketIndex].removeNode(nodeId)
    }
    
    /// Mark a node as failed
    public func markNodeFailed(_ nodeId: NodeID) {
        let bucketIndex = selfId.bucketIndex(for: nodeId)
        buckets[bucketIndex].markFailed(nodeId)
    }
    
    // MARK: - Lookup Operations
    
    /// Find the k closest nodes to a target ID
    public func findClosestNodes(to target: NodeID, count: Int = k) -> [DHTNode] {
        var closest: [DHTNode] = []
        
        // Get the target bucket first
        let targetBucket = selfId.bucketIndex(for: target)
        closest.append(contentsOf: buckets[targetBucket].closestNodes(to: target, count: count))
        
        // Expand to neighboring buckets if needed
        var offset = 1
        while closest.count < count && offset < 256 {
            if targetBucket + offset < 256 {
                closest.append(contentsOf: buckets[targetBucket + offset].closestNodes(to: target, count: count - closest.count))
            }
            if targetBucket - offset >= 0 {
                closest.append(contentsOf: buckets[targetBucket - offset].closestNodes(to: target, count: count - closest.count))
            }
            offset += 1
        }
        
        // Sort by distance and return top k
        return closest
            .sorted { $0.id.distance(to: target).lexicographicallyPrecedes($1.id.distance(to: target)) }
            .prefix(count)
            .map { $0 }
    }
    
    /// Get all known nodes
    public func allNodes() -> [DHTNode] {
        return buckets.flatMap { $0.allNodes }
    }
    
    /// Get routing table stats
    public func getStats() -> DHTStats {
        let nodeCounts = buckets.map { $0.count }
        let totalNodes = nodeCounts.reduce(0, +)
        let nonEmptyBuckets = nodeCounts.filter { $0 > 0 }.count
        
        return DHTStats(
            selfId: selfId,
            totalNodes: totalNodes,
            nonEmptyBuckets: nonEmptyBuckets,
            storedValues: valueStore.count
        )
    }
    
    // MARK: - Value Storage (DHT as key-value store)
    
    /// Store a value
    public func store(key: String, value: Data) {
        valueStore[key] = value
    }
    
    /// Retrieve a value
    public func retrieve(key: String) -> Data? {
        return valueStore[key]
    }
    
    /// Delete a value
    public func delete(key: String) {
        valueStore.removeValue(forKey: key)
    }
    
    // MARK: - Bootstrap
    
    /// Bootstrap the DHT with known nodes
    public func bootstrap(nodes: [DHTNode]) {
        for node in nodes {
            addNode(node)
        }
    }
    
    // MARK: - Periodic Refresh
    
    public func startRefreshTask() {
        refreshTask?.cancel()
        
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                // Refresh every 15 minutes
                try? await Task.sleep(nanoseconds: 15 * 60 * 1_000_000_000)
                await self?.refreshBuckets()
            }
        }
    }
    
    public func stopRefreshTask() {
        refreshTask?.cancel()
        refreshTask = nil
    }
    
    private func refreshBuckets() {
        // Refresh buckets that haven't been used recently
        // In full implementation, this would do iterative FIND_NODE
        // For now, just prune stale nodes
        
        let staleThreshold: TimeInterval = 3600 // 1 hour
        let now = Date()
        
        for bucket in buckets {
            for node in bucket.allNodes {
                if now.timeIntervalSince(node.lastSeen) > staleThreshold {
                    bucket.markFailed(node.id)
                }
            }
        }
    }
}

// MARK: - DHT Stats

public struct DHTStats {
    public let selfId: NodeID
    public let totalNodes: Int
    public let nonEmptyBuckets: Int
    public let storedValues: Int
}

// MARK: - DHT Messages

public enum DHTMessageType: String, Codable {
    case ping
    case pong
    case findNode
    case findNodeResponse
    case store
    case findValue
    case findValueResponse
}

public struct DHTMessage: Codable {
    public let type: DHTMessageType
    public let senderId: NodeID
    public let requestId: String
    public let targetId: NodeID?
    public let nodes: [DHTNode]?
    public let key: String?
    public let value: Data?
    
    public init(type: DHTMessageType,
                senderId: NodeID,
                requestId: String = UUID().uuidString,
                targetId: NodeID? = nil,
                nodes: [DHTNode]? = nil,
                key: String? = nil,
                value: Data? = nil) {
        self.type = type
        self.senderId = senderId
        self.requestId = requestId
        self.targetId = targetId
        self.nodes = nodes
        self.key = key
        self.value = value
    }
    
    public static func ping(from senderId: NodeID) -> DHTMessage {
        return DHTMessage(type: .ping, senderId: senderId)
    }
    
    public static func pong(from senderId: NodeID, replyTo requestId: String) -> DHTMessage {
        return DHTMessage(type: .pong, senderId: senderId, requestId: requestId)
    }
    
    public static func findNode(from senderId: NodeID, target: NodeID) -> DHTMessage {
        return DHTMessage(type: .findNode, senderId: senderId, targetId: target)
    }
    
    public static func findNodeResponse(from senderId: NodeID, replyTo requestId: String, nodes: [DHTNode]) -> DHTMessage {
        return DHTMessage(type: .findNodeResponse, senderId: senderId, requestId: requestId, nodes: nodes)
    }
}

// MARK: - Iterative Lookup

public actor IterativeLookup {
    
    private let dht: KademliaDHT
    private let target: NodeID
    private var queried: Set<NodeID> = []
    private var closest: [DHTNode] = []
    private let k = KademliaDHT.k
    private let alpha = KademliaDHT.alpha
    
    public init(dht: KademliaDHT, target: NodeID) {
        self.dht = dht
        self.target = target
    }
    
    /// Perform iterative lookup
    public func lookup(queryHandler: @escaping (DHTNode, NodeID) async throws -> [DHTNode]) async throws -> [DHTNode] {
        // Initialize with closest nodes from local table
        closest = await dht.findClosestNodes(to: target, count: k)
        
        if closest.isEmpty {
            return []
        }
        
        var improved = true
        
        while improved {
            improved = false
            
            // Get alpha closest unqueried nodes
            let toQuery = closest
                .filter { !queried.contains($0.id) }
                .prefix(alpha)
            
            if toQuery.isEmpty {
                break
            }
            
            // Query in parallel
            await withTaskGroup(of: [DHTNode].self) { group in
                for node in toQuery {
                    queried.insert(node.id)
                    
                    group.addTask {
                        do {
                            return try await queryHandler(node, self.target)
                        } catch {
                            await self.dht.markNodeFailed(node.id)
                            return []
                        }
                    }
                }
                
                for await newNodes in group {
                    for node in newNodes {
                        await dht.addNode(node)
                        
                        // Check if this improves our closest set
                        if !closest.contains(where: { $0.id == node.id }) {
                            closest.append(node)
                            improved = true
                        }
                    }
                }
            }
            
            // Keep only k closest
            closest = closest
                .sorted { $0.id.distance(to: target).lexicographicallyPrecedes($1.id.distance(to: target)) }
                .prefix(k)
                .map { $0 }
        }
        
        return closest
    }
}
