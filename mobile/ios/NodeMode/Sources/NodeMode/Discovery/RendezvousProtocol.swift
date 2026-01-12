//
//  RendezvousProtocol.swift
//  RailGun Node Mode
//
//  Rendezvous protocol for topic-based peer discovery
//  Allows peers to find each other based on shared interests/channels
//

import Foundation
import CryptoKit

// MARK: - Rendezvous Point

public struct RendezvousPoint: Codable, Hashable {
    public let topic: String
    public let topicHash: Data  // SHA256 of topic for DHT lookup
    public let createdAt: Date
    public let expiresAt: Date
    
    public init(topic: String, ttl: TimeInterval = 3600) {
        self.topic = topic
        self.topicHash = Data(SHA256.hash(data: topic.data(using: .utf8)!))
        self.createdAt = Date()
        self.expiresAt = Date().addingTimeInterval(ttl)
    }
    
    public var isExpired: Bool {
        return Date() > expiresAt
    }
    
    public func hash(into hasher: inout Hasher) {
        hasher.combine(topicHash)
    }
}

// MARK: - Rendezvous Registration

public struct RendezvousRegistration: Codable {
    public let peerId: String
    public let publicKey: Data
    public let topics: [String]
    public let endpoint: NodeEndpoint
    public let timestamp: Date
    public let expiresAt: Date
    public let signature: Data
    
    public init(peerId: String,
                publicKey: Data,
                topics: [String],
                endpoint: NodeEndpoint,
                ttl: TimeInterval = 3600) {
        self.peerId = peerId
        self.publicKey = publicKey
        self.topics = topics
        self.endpoint = endpoint
        self.timestamp = Date()
        self.expiresAt = Date().addingTimeInterval(ttl)
        // Signature will be set by signing method
        self.signature = Data()
    }
    
    public var isExpired: Bool {
        return Date() > expiresAt
    }
    
    /// Create signed registration
    public static func signed(peerId: String,
                              publicKey: Data,
                              topics: [String],
                              endpoint: NodeEndpoint,
                              signingKey: Curve25519.Signing.PrivateKey,
                              ttl: TimeInterval = 3600) throws -> RendezvousRegistration {
        var reg = RendezvousRegistration(
            peerId: peerId,
            publicKey: publicKey,
            topics: topics,
            endpoint: endpoint,
            ttl: ttl
        )
        
        // Sign the registration
        let dataToSign = reg.signingData
        let signature = try signingKey.signature(for: dataToSign)
        
        return RendezvousRegistration(
            peerId: reg.peerId,
            publicKey: reg.publicKey,
            topics: reg.topics,
            endpoint: reg.endpoint,
            timestamp: reg.timestamp,
            expiresAt: reg.expiresAt,
            signature: signature
        )
    }
    
    private init(peerId: String,
                 publicKey: Data,
                 topics: [String],
                 endpoint: NodeEndpoint,
                 timestamp: Date,
                 expiresAt: Date,
                 signature: Data) {
        self.peerId = peerId
        self.publicKey = publicKey
        self.topics = topics
        self.endpoint = endpoint
        self.timestamp = timestamp
        self.expiresAt = expiresAt
        self.signature = signature
    }
    
    /// Data used for signing
    public var signingData: Data {
        var data = Data()
        data.append(peerId.data(using: .utf8)!)
        data.append(publicKey)
        for topic in topics.sorted() {
            data.append(topic.data(using: .utf8)!)
        }
        data.append(endpoint.host.data(using: .utf8)!)
        var port = endpoint.port
        data.append(Data(bytes: &port, count: 2))
        
        var timestamp = Int64(self.timestamp.timeIntervalSince1970)
        data.append(Data(bytes: &timestamp, count: 8))
        
        return data
    }
    
    /// Verify signature
    public func verifySignature() throws -> Bool {
        // The public key in the registration should be the signing public key
        // For Curve25519.Signing, we need to parse it correctly
        let signingPublicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
        return signingPublicKey.isValidSignature(signature, for: signingData)
    }
}

// MARK: - Rendezvous Service

public actor RendezvousService {
    
    // MARK: - Properties
    
    private let dht: KademliaDHT
    private let storage: SecureKeyStorage
    private var localRegistrations: [String: RendezvousRegistration] = [:]  // topic -> registration
    private var discoveredPeers: [String: [RendezvousRegistration]] = [:]   // topic -> [registrations]
    private var subscriptions: [String: Set<String>] = [:]                  // topic -> [peer IDs]
    
    private var refreshTask: Task<Void, Never>?
    private let refreshInterval: TimeInterval = 300  // 5 minutes
    
    public nonisolated let selfPeerId: String
    
    // MARK: - Initialization
    
    public init(peerId: String, dht: KademliaDHT, storage: SecureKeyStorage) {
        self.selfPeerId = peerId
        self.dht = dht
        self.storage = storage
    }
    
    // MARK: - Registration
    
    /// Register interest in a topic
    public func register(topic: String, endpoint: NodeEndpoint) async throws {
        let signingKey = try await storage.getOrCreateSigningKey()
        let publicKey = signingKey.publicKey.rawRepresentation
        
        let registration = try RendezvousRegistration.signed(
            peerId: selfPeerId,
            publicKey: publicKey,
            topics: [topic],
            endpoint: endpoint,
            signingKey: signingKey
        )
        
        localRegistrations[topic] = registration
        
        // Store in DHT
        let point = RendezvousPoint(topic: topic)
        let regData = try JSONEncoder().encode(registration)
        await dht.store(key: point.topicHash.base64EncodedString(), value: regData)
    }
    
    /// Unregister from a topic
    public func unregister(topic: String) async {
        localRegistrations.removeValue(forKey: topic)
        
        // Remove from DHT
        let point = RendezvousPoint(topic: topic)
        await dht.delete(key: point.topicHash.base64EncodedString())
    }
    
    // MARK: - Discovery
    
    /// Discover peers registered for a topic
    public func discover(topic: String) async throws -> [RendezvousRegistration] {
        let point = RendezvousPoint(topic: topic)
        let key = point.topicHash.base64EncodedString()
        
        // Check local cache first
        if let cached = discoveredPeers[topic] {
            let valid = cached.filter { !$0.isExpired }
            if !valid.isEmpty {
                return valid
            }
        }
        
        // Look up in DHT
        var results: [RendezvousRegistration] = []
        
        // Find nodes closest to the topic hash
        let nodeId = NodeID(bytes: point.topicHash)
        let closestNodes = await dht.findClosestNodes(to: nodeId)
        
        // Query each node for the topic
        // In a full implementation, this would send FIND_VALUE messages
        // For now, just check local DHT store
        if let data = await dht.retrieve(key: key) {
            if let registration = try? JSONDecoder().decode(RendezvousRegistration.self, from: data) {
                if !registration.isExpired {
                    if try registration.verifySignature() {
                        results.append(registration)
                    }
                }
            }
        }
        
        // Cache results
        discoveredPeers[topic] = results
        
        return results
    }
    
    /// Subscribe to updates for a topic
    public func subscribe(topic: String) {
        var subscribers = subscriptions[topic] ?? []
        subscribers.insert(selfPeerId)
        subscriptions[topic] = subscribers
    }
    
    /// Unsubscribe from topic updates
    public func unsubscribe(topic: String) {
        subscriptions[topic]?.remove(selfPeerId)
    }
    
    /// Get all subscribed topics
    public func getSubscribedTopics() -> [String] {
        return subscriptions.keys.filter { subscriptions[$0]?.contains(selfPeerId) == true }
    }
    
    // MARK: - Topic Management
    
    /// Get all registered topics
    public func getRegisteredTopics() -> [String] {
        return Array(localRegistrations.keys)
    }
    
    /// Check if registered for a topic
    public func isRegistered(for topic: String) -> Bool {
        return localRegistrations[topic] != nil
    }
    
    /// Get cached peers for a topic
    public func getCachedPeers(for topic: String) -> [RendezvousRegistration] {
        return discoveredPeers[topic]?.filter { !$0.isExpired } ?? []
    }
    
    // MARK: - Background Refresh
    
    public func startRefreshTask() {
        refreshTask?.cancel()
        
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(300 * 1_000_000_000))
                await self?.refreshRegistrations()
            }
        }
    }
    
    public func stopRefreshTask() {
        refreshTask?.cancel()
        refreshTask = nil
    }
    
    private func refreshRegistrations() async {
        // Re-register all local topics
        for (topic, registration) in localRegistrations {
            if registration.isExpired || isNearExpiry(registration) {
                do {
                    try await register(topic: topic, endpoint: registration.endpoint)
                } catch {
                    print("[Rendezvous] Failed to refresh registration for \(topic): \(error)")
                }
            }
        }
        
        // Refresh subscribed topics
        for topic in getSubscribedTopics() {
            _ = try? await discover(topic: topic)
        }
        
        // Prune expired cache entries
        for (topic, registrations) in discoveredPeers {
            let valid = registrations.filter { !$0.isExpired }
            if valid.isEmpty {
                discoveredPeers.removeValue(forKey: topic)
            } else {
                discoveredPeers[topic] = valid
            }
        }
    }
    
    private func isNearExpiry(_ registration: RendezvousRegistration) -> Bool {
        let timeUntilExpiry = registration.expiresAt.timeIntervalSince(Date())
        return timeUntilExpiry < refreshInterval
    }
}

// MARK: - Rendezvous Messages

public enum RendezvousMessageType: String, Codable {
    case register
    case unregister
    case discover
    case discoverResponse
    case announce      // Broadcast new peer to subscribers
}

public struct RendezvousMessage: Codable {
    public let type: RendezvousMessageType
    public let senderId: String
    public let requestId: String
    public let topic: String?
    public let registration: RendezvousRegistration?
    public let registrations: [RendezvousRegistration]?
    
    public init(type: RendezvousMessageType,
                senderId: String,
                requestId: String = UUID().uuidString,
                topic: String? = nil,
                registration: RendezvousRegistration? = nil,
                registrations: [RendezvousRegistration]? = nil) {
        self.type = type
        self.senderId = senderId
        self.requestId = requestId
        self.topic = topic
        self.registration = registration
        self.registrations = registrations
    }
    
    public static func registerMessage(senderId: String, registration: RendezvousRegistration) -> RendezvousMessage {
        return RendezvousMessage(
            type: .register,
            senderId: senderId,
            registration: registration
        )
    }
    
    public static func discoverMessage(senderId: String, topic: String) -> RendezvousMessage {
        return RendezvousMessage(
            type: .discover,
            senderId: senderId,
            topic: topic
        )
    }
    
    public static func discoverResponse(senderId: String, replyTo requestId: String, registrations: [RendezvousRegistration]) -> RendezvousMessage {
        return RendezvousMessage(
            type: .discoverResponse,
            senderId: senderId,
            requestId: requestId,
            registrations: registrations
        )
    }
}

// MARK: - Topic Hash Utilities

extension String {
    /// Get the DHT node ID for this topic
    public var topicNodeId: NodeID {
        let hash = SHA256.hash(data: self.data(using: .utf8)!)
        return NodeID(bytes: Data(hash))
    }
}
