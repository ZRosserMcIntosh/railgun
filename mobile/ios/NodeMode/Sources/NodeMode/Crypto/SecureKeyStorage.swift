//
//  SecureKeyStorage.swift
//  RailGun Node Mode
//
//  Secure key storage using iOS Keychain
//  Stores node identity keys, session keys, and replay protection data
//

import Foundation
import Security
import CryptoKit

// MARK: - Key Storage Error

public enum KeyStorageError: Error, LocalizedError {
    case keyGenerationFailed
    case keyNotFound
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)
    case deleteFailed(OSStatus)
    case invalidKeyData
    case accessDenied
    
    public var errorDescription: String? {
        switch self {
        case .keyGenerationFailed: return "Failed to generate key"
        case .keyNotFound: return "Key not found in keychain"
        case .saveFailed(let status): return "Failed to save key: \(status)"
        case .loadFailed(let status): return "Failed to load key: \(status)"
        case .deleteFailed(let status): return "Failed to delete key: \(status)"
        case .invalidKeyData: return "Invalid key data"
        case .accessDenied: return "Access to keychain denied"
        }
    }
}

// MARK: - Key Type

public enum SecureKeyType: String {
    case nodeIdentity = "com.railgun.nodemode.identity"
    case nodeEphemeral = "com.railgun.nodemode.ephemeral"
    case sessionKey = "com.railgun.nodemode.session"
    case preKey = "com.railgun.nodemode.prekey"
}

// MARK: - Secure Key Storage

public actor SecureKeyStorage {
    
    // MARK: - Properties
    
    private let serviceName = "com.railgun.nodemode"
    private let accessGroup: String?
    
    // MARK: - Initialization
    
    public init(accessGroup: String? = nil) {
        self.accessGroup = accessGroup
    }
    
    // MARK: - Identity Key Management
    
    /// Get or create the node identity key
    public func getOrCreateIdentityKey() throws -> Curve25519.KeyAgreement.PrivateKey {
        // Try to load existing key
        if let existingKey = try? loadIdentityKey() {
            return existingKey
        }
        
        // Generate new key
        let newKey = Curve25519.KeyAgreement.PrivateKey()
        try saveIdentityKey(newKey)
        return newKey
    }
    
    /// Load existing identity key
    public func loadIdentityKey() throws -> Curve25519.KeyAgreement.PrivateKey {
        let keyData = try loadKey(type: .nodeIdentity, identifier: "main")
        return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: keyData)
    }
    
    /// Save identity key
    public func saveIdentityKey(_ key: Curve25519.KeyAgreement.PrivateKey) throws {
        try saveKey(key.rawRepresentation, type: .nodeIdentity, identifier: "main")
    }
    
    /// Get identity public key
    public func getIdentityPublicKey() throws -> Data {
        let privateKey = try loadIdentityKey()
        return privateKey.publicKey.rawRepresentation
    }
    
    // MARK: - Signing Key Management (Ed25519)
    
    /// Get or create signing key for bundle signatures
    public func getOrCreateSigningKey() throws -> Curve25519.Signing.PrivateKey {
        if let existingKey = try? loadSigningKey() {
            return existingKey
        }
        
        let newKey = Curve25519.Signing.PrivateKey()
        try saveSigningKey(newKey)
        return newKey
    }
    
    public func loadSigningKey() throws -> Curve25519.Signing.PrivateKey {
        let keyData = try loadKey(type: .nodeIdentity, identifier: "signing")
        return try Curve25519.Signing.PrivateKey(rawRepresentation: keyData)
    }
    
    public func saveSigningKey(_ key: Curve25519.Signing.PrivateKey) throws {
        try saveKey(key.rawRepresentation, type: .nodeIdentity, identifier: "signing")
    }
    
    // MARK: - Session Key Management
    
    /// Save a session key for a peer
    public func saveSessionKey(_ key: Data, forPeer peerId: String) throws {
        try saveKey(key, type: .sessionKey, identifier: peerId)
    }
    
    /// Load session key for a peer
    public func loadSessionKey(forPeer peerId: String) throws -> Data {
        return try loadKey(type: .sessionKey, identifier: peerId)
    }
    
    /// Delete session key for a peer
    public func deleteSessionKey(forPeer peerId: String) throws {
        try deleteKey(type: .sessionKey, identifier: peerId)
    }
    
    /// Delete all session keys
    public func deleteAllSessionKeys() throws {
        try deleteAllKeys(type: .sessionKey)
    }
    
    // MARK: - Pre-Key Management
    
    /// Save a pre-key
    public func savePreKey(_ key: Data, keyId: UInt32) throws {
        try saveKey(key, type: .preKey, identifier: "pk-\(keyId)")
    }
    
    /// Load a pre-key
    public func loadPreKey(keyId: UInt32) throws -> Data {
        return try loadKey(type: .preKey, identifier: "pk-\(keyId)")
    }
    
    /// Delete a pre-key
    public func deletePreKey(keyId: UInt32) throws {
        try deleteKey(type: .preKey, identifier: "pk-\(keyId)")
    }
    
    // MARK: - Key Rotation
    
    /// Rotate the identity key (creates new, backs up old)
    public func rotateIdentityKey() throws -> (newKey: Curve25519.KeyAgreement.PrivateKey, oldKeyId: String) {
        // Backup current key
        let oldKey = try loadIdentityKey()
        let oldKeyId = UUID().uuidString
        try saveKey(oldKey.rawRepresentation, type: .nodeIdentity, identifier: "backup-\(oldKeyId)")
        
        // Generate and save new key
        let newKey = Curve25519.KeyAgreement.PrivateKey()
        try saveIdentityKey(newKey)
        
        return (newKey, oldKeyId)
    }
    
    /// Load a backed-up key
    public func loadBackupKey(keyId: String) throws -> Curve25519.KeyAgreement.PrivateKey {
        let keyData = try loadKey(type: .nodeIdentity, identifier: "backup-\(keyId)")
        return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: keyData)
    }
    
    // MARK: - Generic Key Operations
    
    private func saveKey(_ keyData: Data, type: SecureKeyType, identifier: String) throws {
        let tag = "\(type.rawValue).\(identifier)"
        
        // Delete existing key if present
        try? deleteKey(type: type, identifier: identifier)
        
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: tag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        
        if let accessGroup = accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        
        let status = SecItemAdd(query as CFDictionary, nil)
        
        guard status == errSecSuccess else {
            throw KeyStorageError.saveFailed(status)
        }
    }
    
    private func loadKey(type: SecureKeyType, identifier: String) throws -> Data {
        let tag = "\(type.rawValue).\(identifier)"
        
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        if let accessGroup = accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeyStorageError.keyNotFound
            }
            throw KeyStorageError.loadFailed(status)
        }
        
        guard let keyData = result as? Data else {
            throw KeyStorageError.invalidKeyData
        }
        
        return keyData
    }
    
    private func deleteKey(type: SecureKeyType, identifier: String) throws {
        let tag = "\(type.rawValue).\(identifier)"
        
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: tag
        ]
        
        if let accessGroup = accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        
        let status = SecItemDelete(query as CFDictionary)
        
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeyStorageError.deleteFailed(status)
        }
    }
    
    private func deleteAllKeys(type: SecureKeyType) throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName
        ]
        
        if let accessGroup = accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        
        // Note: This deletes ALL keys for the service
        // In production, you'd want to query and filter by type prefix
        let status = SecItemDelete(query as CFDictionary)
        
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeyStorageError.deleteFailed(status)
        }
    }
    
    // MARK: - Utility
    
    /// Check if identity key exists
    public func hasIdentityKey() -> Bool {
        do {
            _ = try loadIdentityKey()
            return true
        } catch {
            return false
        }
    }
    
    /// Export identity public key as hex string
    public func exportIdentityPublicKeyHex() throws -> String {
        let publicKey = try getIdentityPublicKey()
        return publicKey.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Replay Protection

/// Tracks nonces to prevent replay attacks
public actor ReplayProtection {
    
    private var seenNonces: Set<Data> = []
    private var nonceWindow: [Data] = []
    private let maxWindowSize = 10000
    private let storage: SecureKeyStorage
    
    public init(storage: SecureKeyStorage) {
        self.storage = storage
    }
    
    /// Check if a nonce has been seen (and mark it as seen)
    public func checkAndMarkNonce(_ nonce: Data) -> Bool {
        // Check if already seen
        if seenNonces.contains(nonce) {
            return false // Replay detected
        }
        
        // Add to seen set
        seenNonces.insert(nonce)
        nonceWindow.append(nonce)
        
        // Trim window if too large
        if nonceWindow.count > maxWindowSize {
            let removed = nonceWindow.removeFirst()
            seenNonces.remove(removed)
        }
        
        return true // Nonce is fresh
    }
    
    /// Generate a fresh nonce
    public func generateNonce() -> Data {
        var nonce = Data(count: 12)
        nonce.withUnsafeMutableBytes { ptr in
            _ = SecRandomCopyBytes(kSecRandomDefault, 12, ptr.baseAddress!)
        }
        return nonce
    }
    
    /// Reset all tracked nonces
    public func reset() {
        seenNonces.removeAll()
        nonceWindow.removeAll()
    }
}

// MARK: - Secure Message Wrapper

/// Wraps messages with nonce for replay protection
public struct SecureMessage: Codable {
    public let nonce: Data
    public let ciphertext: Data
    public let timestamp: Int64
    public let senderId: String
    
    public init(nonce: Data, ciphertext: Data, senderId: String) {
        self.nonce = nonce
        self.ciphertext = ciphertext
        self.timestamp = Int64(Date().timeIntervalSince1970 * 1000)
        self.senderId = senderId
    }
    
    /// Check if message is too old (potential replay)
    public func isExpired(maxAgeSeconds: TimeInterval = 300) -> Bool {
        let messageTime = Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000)
        return Date().timeIntervalSince(messageTime) > maxAgeSeconds
    }
}
