//
//  KeyRotationManager.swift
//  RailGun Node Mode
//
//  Manages automatic key rotation for session keys
//  Implements ratcheting and periodic rotation schedules
//

import Foundation
import CryptoKit

// MARK: - Rotation Policy

public struct RotationPolicy {
    public let maxMessageCount: Int
    public let maxAgeSeconds: TimeInterval
    public let rotateOnDisconnect: Bool
    
    public init(maxMessageCount: Int = 1000,
                maxAgeSeconds: TimeInterval = 86400, // 24 hours
                rotateOnDisconnect: Bool = true) {
        self.maxMessageCount = maxMessageCount
        self.maxAgeSeconds = maxAgeSeconds
        self.rotateOnDisconnect = rotateOnDisconnect
    }
    
    public static let `default` = RotationPolicy()
    public static let aggressive = RotationPolicy(maxMessageCount: 100, maxAgeSeconds: 3600)
    public static let relaxed = RotationPolicy(maxMessageCount: 10000, maxAgeSeconds: 604800)
}

// MARK: - Session State

public struct SessionKeyState: Codable {
    public var currentKeyId: UInt32
    public var messageCount: Int
    public var createdAt: Date
    public var lastUsedAt: Date
    public var chainKey: Data
    public var sendingKey: Data?
    public var receivingKey: Data?
    
    public init(keyId: UInt32, chainKey: Data) {
        self.currentKeyId = keyId
        self.messageCount = 0
        self.createdAt = Date()
        self.lastUsedAt = Date()
        self.chainKey = chainKey
    }
    
    public mutating func recordMessage() {
        messageCount += 1
        lastUsedAt = Date()
    }
    
    public func needsRotation(policy: RotationPolicy) -> Bool {
        if messageCount >= policy.maxMessageCount {
            return true
        }
        if Date().timeIntervalSince(createdAt) >= policy.maxAgeSeconds {
            return true
        }
        return false
    }
}

// MARK: - Key Rotation Manager

public actor KeyRotationManager {
    
    // MARK: - Properties
    
    private let storage: SecureKeyStorage
    private var sessions: [String: SessionKeyState] = [:]
    private let policy: RotationPolicy
    
    private var rotationTimer: Task<Void, Never>?
    private let checkInterval: TimeInterval = 60 // Check every minute
    
    // MARK: - Initialization
    
    public init(storage: SecureKeyStorage, policy: RotationPolicy = .default) {
        self.storage = storage
        self.policy = policy
    }
    
    // MARK: - Session Management
    
    /// Initialize a new session with a peer
    public func initializeSession(peerId: String, sharedSecret: Data) async throws {
        // Derive initial chain key from shared secret
        let chainKey = deriveChainKey(from: sharedSecret, iteration: 0)
        
        var state = SessionKeyState(keyId: 0, chainKey: chainKey)
        
        // Derive sending and receiving keys
        let (sendKey, recvKey) = deriveMessageKeys(from: chainKey)
        state.sendingKey = sendKey
        state.receivingKey = recvKey
        
        sessions[peerId] = state
        
        // Persist the chain key
        try await storage.saveSessionKey(chainKey, forPeer: peerId)
    }
    
    /// Get current sending key for a peer
    public func getSendingKey(forPeer peerId: String) async throws -> Data {
        guard var state = sessions[peerId] else {
            throw KeyStorageError.keyNotFound
        }
        
        // Check if rotation needed
        if state.needsRotation(policy: policy) {
            state = try await rotateSessionKey(peerId: peerId, currentState: state)
        }
        
        state.recordMessage()
        sessions[peerId] = state
        
        guard let sendingKey = state.sendingKey else {
            throw KeyStorageError.invalidKeyData
        }
        
        return sendingKey
    }
    
    /// Get current receiving key for a peer
    public func getReceivingKey(forPeer peerId: String, keyId: UInt32) async throws -> Data {
        guard let state = sessions[peerId] else {
            throw KeyStorageError.keyNotFound
        }
        
        // If keyId matches current, return current
        if keyId == state.currentKeyId {
            guard let receivingKey = state.receivingKey else {
                throw KeyStorageError.invalidKeyData
            }
            return receivingKey
        }
        
        // Try to derive the key for the given keyId
        // This handles out-of-order messages
        let derivedChainKey = deriveChainKey(from: state.chainKey, iteration: Int(keyId))
        let (_, recvKey) = deriveMessageKeys(from: derivedChainKey)
        
        return recvKey
    }
    
    /// Record that a message was sent/received
    public func recordMessage(peerId: String) async throws {
        guard var state = sessions[peerId] else {
            throw KeyStorageError.keyNotFound
        }
        
        state.recordMessage()
        
        // Auto-rotate if needed
        if state.needsRotation(policy: policy) {
            state = try await rotateSessionKey(peerId: peerId, currentState: state)
        }
        
        sessions[peerId] = state
    }
    
    // MARK: - Key Rotation
    
    /// Force rotate a session key
    public func rotateSessionKey(peerId: String, currentState: SessionKeyState) async throws -> SessionKeyState {
        // Ratchet the chain key
        let newChainKey = ratchetChainKey(currentState.chainKey)
        let newKeyId = currentState.currentKeyId + 1
        
        var newState = SessionKeyState(keyId: newKeyId, chainKey: newChainKey)
        let (sendKey, recvKey) = deriveMessageKeys(from: newChainKey)
        newState.sendingKey = sendKey
        newState.receivingKey = recvKey
        
        sessions[peerId] = newState
        
        // Persist
        try await storage.saveSessionKey(newChainKey, forPeer: peerId)
        
        return newState
    }
    
    /// End session with a peer
    public func endSession(peerId: String) async throws {
        sessions.removeValue(forKey: peerId)
        try await storage.deleteSessionKey(forPeer: peerId)
    }
    
    /// Get current key ID for a peer
    public func getCurrentKeyId(forPeer peerId: String) -> UInt32? {
        return sessions[peerId]?.currentKeyId
    }
    
    /// Get session info
    public func getSessionInfo(peerId: String) -> SessionKeyState? {
        return sessions[peerId]
    }
    
    // MARK: - Background Rotation Check
    
    public func startPeriodicRotationCheck() {
        rotationTimer?.cancel()
        
        rotationTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(60 * 1_000_000_000))
                await self?.performScheduledRotations()
            }
        }
    }
    
    public func stopPeriodicRotationCheck() {
        rotationTimer?.cancel()
        rotationTimer = nil
    }
    
    private func performScheduledRotations() {
        for (peerId, state) in sessions {
            if state.needsRotation(policy: policy) {
                Task {
                    do {
                        _ = try await rotateSessionKey(peerId: peerId, currentState: state)
                    } catch {
                        print("[KeyRotation] Failed to rotate for \(peerId): \(error)")
                    }
                }
            }
        }
    }
    
    // MARK: - Key Derivation
    
    private func deriveChainKey(from secret: Data, iteration: Int) -> Data {
        // HKDF-like derivation
        let info = "railgun-chain-\(iteration)".data(using: .utf8)!
        let key = SymmetricKey(data: secret)
        
        var hmac = HMAC<SHA256>(key: key)
        hmac.update(data: info)
        let result = Data(hmac.finalize())
        
        return result
    }
    
    private func deriveMessageKeys(from chainKey: Data) -> (send: Data, receive: Data) {
        let key = SymmetricKey(data: chainKey)
        
        // Derive sending key
        var hmacSend = HMAC<SHA256>(key: key)
        hmacSend.update(data: "send".data(using: .utf8)!)
        let sendKey = Data(hmacSend.finalize())
        
        // Derive receiving key
        var hmacRecv = HMAC<SHA256>(key: key)
        hmacRecv.update(data: "recv".data(using: .utf8)!)
        let recvKey = Data(hmacRecv.finalize())
        
        return (sendKey, recvKey)
    }
    
    private func ratchetChainKey(_ currentKey: Data) -> Data {
        let key = SymmetricKey(data: currentKey)
        
        var hmac = HMAC<SHA256>(key: key)
        hmac.update(data: "ratchet".data(using: .utf8)!)
        
        return Data(hmac.finalize())
    }
}

// MARK: - Double Ratchet (X3DH + Ratchet)

/// Full Double Ratchet implementation for maximum forward secrecy
public actor DoubleRatchet {
    
    // MARK: - Ratchet State
    
    private struct RatchetState {
        var dhSelf: Curve25519.KeyAgreement.PrivateKey
        var dhRemote: Curve25519.KeyAgreement.PublicKey?
        var rootKey: Data
        var sendingChainKey: Data?
        var receivingChainKey: Data?
        var sendMessageNumber: UInt32 = 0
        var receiveMessageNumber: UInt32 = 0
        var previousSendChainLength: UInt32 = 0
        
        // Skipped message keys (for out-of-order delivery)
        var skippedKeys: [String: Data] = [:]
    }
    
    // MARK: - Properties
    
    private var states: [String: RatchetState] = [:]
    private let storage: SecureKeyStorage
    private let maxSkip = 100
    
    // MARK: - Initialization
    
    public init(storage: SecureKeyStorage) {
        self.storage = storage
    }
    
    // MARK: - X3DH Key Agreement (Alice initiates)
    
    /// Initialize ratchet as initiator (Alice)
    public func initializeAsAlice(peerId: String,
                                   remoteIdentityKey: Data,
                                   remoteSignedPreKey: Data,
                                   remoteOneTimePreKey: Data?) async throws {
        
        let identityKey = try await storage.getOrCreateIdentityKey()
        let ephemeralKey = Curve25519.KeyAgreement.PrivateKey()
        
        // Parse remote keys
        let bobIdentity = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: remoteIdentityKey)
        let bobSignedPreKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: remoteSignedPreKey)
        
        // X3DH
        var dh1 = try identityKey.sharedSecretFromKeyAgreement(with: bobSignedPreKey)
        var dh2 = try ephemeralKey.sharedSecretFromKeyAgreement(with: bobIdentity)
        var dh3 = try ephemeralKey.sharedSecretFromKeyAgreement(with: bobSignedPreKey)
        
        var master = Data(dh1.withUnsafeBytes { Data($0) })
        master.append(dh2.withUnsafeBytes { Data($0) })
        master.append(dh3.withUnsafeBytes { Data($0) })
        
        // Add one-time prekey if available
        if let otpkData = remoteOneTimePreKey {
            let bobOTPK = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: otpkData)
            let dh4 = try ephemeralKey.sharedSecretFromKeyAgreement(with: bobOTPK)
            master.append(dh4.withUnsafeBytes { Data($0) })
        }
        
        // Derive root key
        let rootKey = deriveRootKey(from: master)
        
        // Create ratchet state
        let newDH = Curve25519.KeyAgreement.PrivateKey()
        var state = RatchetState(dhSelf: newDH, rootKey: rootKey)
        state.dhRemote = bobSignedPreKey
        
        // Perform initial DH ratchet
        if let remoteKey = state.dhRemote {
            let dhOut = try state.dhSelf.sharedSecretFromKeyAgreement(with: remoteKey)
            let (newRootKey, chainKey) = deriveChain(rootKey: state.rootKey, dhOut: dhOut.withUnsafeBytes { Data($0) })
            state.rootKey = newRootKey
            state.sendingChainKey = chainKey
        }
        
        states[peerId] = state
    }
    
    /// Initialize ratchet as responder (Bob)
    public func initializeAsBob(peerId: String,
                                 remoteIdentityKey: Data,
                                 remoteEphemeralKey: Data,
                                 usedOneTimePreKeyId: UInt32?) async throws {
        
        let identityKey = try await storage.getOrCreateIdentityKey()
        let signedPreKey = try await storage.loadPreKey(keyId: 0) // Signed prekey
        let signedPreKeyPrivate = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: signedPreKey)
        
        // Parse remote keys
        let aliceIdentity = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: remoteIdentityKey)
        let aliceEphemeral = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: remoteEphemeralKey)
        
        // X3DH
        let dh1 = try signedPreKeyPrivate.sharedSecretFromKeyAgreement(with: aliceIdentity)
        let dh2 = try identityKey.sharedSecretFromKeyAgreement(with: aliceEphemeral)
        let dh3 = try signedPreKeyPrivate.sharedSecretFromKeyAgreement(with: aliceEphemeral)
        
        var master = Data(dh1.withUnsafeBytes { Data($0) })
        master.append(dh2.withUnsafeBytes { Data($0) })
        master.append(dh3.withUnsafeBytes { Data($0) })
        
        // Add one-time prekey if used
        if let otpkId = usedOneTimePreKeyId {
            let otpkData = try await storage.loadPreKey(keyId: otpkId)
            let otpk = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: otpkData)
            let dh4 = try otpk.sharedSecretFromKeyAgreement(with: aliceEphemeral)
            master.append(dh4.withUnsafeBytes { Data($0) })
            
            // Delete used one-time prekey
            try await storage.deletePreKey(keyId: otpkId)
        }
        
        // Derive root key
        let rootKey = deriveRootKey(from: master)
        
        // Create ratchet state
        var state = RatchetState(dhSelf: signedPreKeyPrivate, rootKey: rootKey)
        state.dhRemote = aliceEphemeral
        state.receivingChainKey = rootKey
        
        states[peerId] = state
    }
    
    // MARK: - Encryption/Decryption
    
    /// Encrypt a message
    public func encrypt(message: Data, forPeer peerId: String) throws -> (ciphertext: Data, header: MessageHeader) {
        guard var state = states[peerId] else {
            throw KeyStorageError.keyNotFound
        }
        
        // Get message key from sending chain
        guard let chainKey = state.sendingChainKey else {
            throw KeyStorageError.invalidKeyData
        }
        
        let (messageKey, newChainKey) = deriveMessageKey(from: chainKey)
        state.sendingChainKey = newChainKey
        
        // Create header
        let header = MessageHeader(
            publicKey: state.dhSelf.publicKey.rawRepresentation,
            previousChainLength: state.previousSendChainLength,
            messageNumber: state.sendMessageNumber
        )
        
        state.sendMessageNumber += 1
        states[peerId] = state
        
        // Encrypt
        let ciphertext = try encryptWithKey(message, key: messageKey, header: header)
        
        return (ciphertext, header)
    }
    
    /// Decrypt a message
    public func decrypt(ciphertext: Data, header: MessageHeader, fromPeer peerId: String) throws -> Data {
        guard var state = states[peerId] else {
            throw KeyStorageError.keyNotFound
        }
        
        // Check for skipped messages
        let skipKey = "\(header.publicKey.base64EncodedString())-\(header.messageNumber)"
        if let messageKey = state.skippedKeys[skipKey] {
            state.skippedKeys.removeValue(forKey: skipKey)
            states[peerId] = state
            return try decryptWithKey(ciphertext, key: messageKey, header: header)
        }
        
        // Check if need to perform DH ratchet
        let headerPubKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: header.publicKey)
        
        if state.dhRemote == nil || headerPubKey.rawRepresentation != state.dhRemote!.rawRepresentation {
            // Skip any remaining messages in the current receiving chain
            if let recvChain = state.receivingChainKey {
                try skipMessages(&state, until: header.previousChainLength, chainKey: recvChain)
            }
            
            // Perform DH ratchet
            state = try performDHRatchet(state: state, headerKey: headerPubKey)
        }
        
        // Skip messages if needed
        if let recvChain = state.receivingChainKey {
            try skipMessages(&state, until: header.messageNumber, chainKey: recvChain)
        }
        
        // Derive message key
        guard let chainKey = state.receivingChainKey else {
            throw KeyStorageError.invalidKeyData
        }
        
        let (messageKey, newChainKey) = deriveMessageKey(from: chainKey)
        state.receivingChainKey = newChainKey
        state.receiveMessageNumber = header.messageNumber + 1
        
        states[peerId] = state
        
        return try decryptWithKey(ciphertext, key: messageKey, header: header)
    }
    
    // MARK: - Private Helpers
    
    private func performDHRatchet(state: RatchetState, headerKey: Curve25519.KeyAgreement.PublicKey) throws -> RatchetState {
        var newState = state
        
        newState.previousSendChainLength = newState.sendMessageNumber
        newState.sendMessageNumber = 0
        newState.receiveMessageNumber = 0
        newState.dhRemote = headerKey
        
        // Derive receiving chain
        let dhRecv = try newState.dhSelf.sharedSecretFromKeyAgreement(with: headerKey)
        let (rootKey1, recvChain) = deriveChain(rootKey: newState.rootKey, dhOut: dhRecv.withUnsafeBytes { Data($0) })
        newState.rootKey = rootKey1
        newState.receivingChainKey = recvChain
        
        // Generate new DH key pair
        newState.dhSelf = Curve25519.KeyAgreement.PrivateKey()
        
        // Derive sending chain
        let dhSend = try newState.dhSelf.sharedSecretFromKeyAgreement(with: headerKey)
        let (rootKey2, sendChain) = deriveChain(rootKey: newState.rootKey, dhOut: dhSend.withUnsafeBytes { Data($0) })
        newState.rootKey = rootKey2
        newState.sendingChainKey = sendChain
        
        return newState
    }
    
    private func skipMessages(_ state: inout RatchetState, until n: UInt32, chainKey: Data) throws {
        guard n > state.receiveMessageNumber else { return }
        guard n - state.receiveMessageNumber <= maxSkip else {
            throw KeyStorageError.invalidKeyData
        }
        
        var currentChain = chainKey
        while state.receiveMessageNumber < n {
            let (messageKey, newChain) = deriveMessageKey(from: currentChain)
            currentChain = newChain
            
            let pubKeyBase64 = state.dhRemote?.rawRepresentation.base64EncodedString() ?? ""
            let skipKey = "\(pubKeyBase64)-\(state.receiveMessageNumber)"
            state.skippedKeys[skipKey] = messageKey
            
            state.receiveMessageNumber += 1
        }
        state.receivingChainKey = currentChain
    }
    
    private func deriveRootKey(from master: Data) -> Data {
        let key = SymmetricKey(data: Data(repeating: 0, count: 32))
        var hmac = HMAC<SHA256>(key: key)
        hmac.update(data: "railgun-root".data(using: .utf8)!)
        hmac.update(data: master)
        return Data(hmac.finalize())
    }
    
    private func deriveChain(rootKey: Data, dhOut: Data) -> (rootKey: Data, chainKey: Data) {
        let key = SymmetricKey(data: rootKey)
        
        var hmacRoot = HMAC<SHA256>(key: key)
        hmacRoot.update(data: dhOut)
        hmacRoot.update(data: Data([0x01]))
        let newRoot = Data(hmacRoot.finalize())
        
        var hmacChain = HMAC<SHA256>(key: key)
        hmacChain.update(data: dhOut)
        hmacChain.update(data: Data([0x02]))
        let newChain = Data(hmacChain.finalize())
        
        return (newRoot, newChain)
    }
    
    private func deriveMessageKey(from chainKey: Data) -> (messageKey: Data, newChainKey: Data) {
        let key = SymmetricKey(data: chainKey)
        
        var hmacMsg = HMAC<SHA256>(key: key)
        hmacMsg.update(data: Data([0x01]))
        let messageKey = Data(hmacMsg.finalize())
        
        var hmacChain = HMAC<SHA256>(key: key)
        hmacChain.update(data: Data([0x02]))
        let newChainKey = Data(hmacChain.finalize())
        
        return (messageKey, newChainKey)
    }
    
    private func encryptWithKey(_ plaintext: Data, key: Data, header: MessageHeader) throws -> Data {
        let symmetricKey = SymmetricKey(data: key)
        let nonce = try AES.GCM.Nonce(data: Data(count: 12))
        let headerData = try JSONEncoder().encode(header)
        let sealed = try AES.GCM.seal(plaintext, using: symmetricKey, nonce: nonce, authenticating: headerData)
        return sealed.combined!
    }
    
    private func decryptWithKey(_ ciphertext: Data, key: Data, header: MessageHeader) throws -> Data {
        let symmetricKey = SymmetricKey(data: key)
        let sealed = try AES.GCM.SealedBox(combined: ciphertext)
        let headerData = try JSONEncoder().encode(header)
        return try AES.GCM.open(sealed, using: symmetricKey, authenticating: headerData)
    }
}

// MARK: - Message Header

public struct MessageHeader: Codable {
    public let publicKey: Data
    public let previousChainLength: UInt32
    public let messageNumber: UInt32
    
    public init(publicKey: Data, previousChainLength: UInt32, messageNumber: UInt32) {
        self.publicKey = publicKey
        self.previousChainLength = previousChainLength
        self.messageNumber = messageNumber
    }
}
