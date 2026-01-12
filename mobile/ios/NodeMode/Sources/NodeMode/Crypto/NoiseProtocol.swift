//
//  NoiseProtocol.swift
//  RailGun Node Mode
//
//  Noise Protocol Framework implementation for secure handshakes
//  Uses XX pattern: mutual authentication with static key transmission
//

import Foundation
import CryptoKit

// MARK: - Noise Protocol Constants

private enum NoiseConstants {
    /// Noise protocol name
    static let protocolName = "Noise_XX_25519_ChaChaPoly_SHA256"
    
    /// Protocol name as bytes
    static var protocolNameBytes: Data {
        protocolName.data(using: .utf8)!
    }
    
    /// Empty key
    static let emptyKey = Data(repeating: 0, count: 32)
    
    /// Maximum message size
    static let maxMessageSize = 65535
    
    /// Tag size for AEAD
    static let tagSize = 16
}

// MARK: - Cipher State

private class CipherState {
    var key: SymmetricKey?
    var nonce: UInt64 = 0
    
    init(key: Data? = nil) {
        if let key = key {
            self.key = SymmetricKey(data: key)
        }
    }
    
    func hasKey() -> Bool {
        return key != nil
    }
    
    func setKey(_ keyData: Data) {
        key = SymmetricKey(data: keyData)
        nonce = 0
    }
    
    func encryptWithAd(ad: Data, plaintext: Data) throws -> Data {
        guard let key = key else {
            return plaintext
        }
        
        let nonceData = Data(repeating: 0, count: 4) + withUnsafeBytes(of: nonce.littleEndian) { Data($0) }
        let nonce = try ChaChaPoly.Nonce(data: nonceData)
        
        let sealed = try ChaChaPoly.seal(plaintext, using: key, nonce: nonce, authenticating: ad)
        self.nonce += 1
        
        return sealed.ciphertext + sealed.tag
    }
    
    func decryptWithAd(ad: Data, ciphertext: Data) throws -> Data {
        guard let key = key else {
            return ciphertext
        }
        
        guard ciphertext.count >= NoiseConstants.tagSize else {
            throw NoiseError.decryptionFailed
        }
        
        let nonceData = Data(repeating: 0, count: 4) + withUnsafeBytes(of: nonce.littleEndian) { Data($0) }
        let nonce = try ChaChaPoly.Nonce(data: nonceData)
        
        let ct = ciphertext.prefix(ciphertext.count - NoiseConstants.tagSize)
        let tag = ciphertext.suffix(NoiseConstants.tagSize)
        
        let sealedBox = try ChaChaPoly.SealedBox(nonce: nonce, ciphertext: ct, tag: tag)
        let plaintext = try ChaChaPoly.open(sealedBox, using: key, authenticating: ad)
        
        self.nonce += 1
        return plaintext
    }
}

// MARK: - Symmetric State

private class SymmetricState {
    var cipherState: CipherState
    var chainingKey: Data
    var hash: Data
    
    init(protocolName: Data) {
        if protocolName.count <= 32 {
            var h = Data(repeating: 0, count: 32)
            h.replaceSubrange(0..<protocolName.count, with: protocolName)
            self.hash = h
        } else {
            self.hash = Data(SHA256.hash(data: protocolName))
        }
        
        self.chainingKey = hash
        self.cipherState = CipherState()
    }
    
    func mixKey(_ inputKeyMaterial: Data) {
        let (ck, tempK, _) = hkdf(chainingKey: chainingKey, inputKeyMaterial: inputKeyMaterial, numOutputs: 2)
        chainingKey = ck
        cipherState.setKey(tempK)
    }
    
    func mixHash(_ data: Data) {
        var toHash = hash
        toHash.append(data)
        hash = Data(SHA256.hash(data: toHash))
    }
    
    func mixKeyAndHash(_ inputKeyMaterial: Data) {
        let (ck, tempH, tempK) = hkdf(chainingKey: chainingKey, inputKeyMaterial: inputKeyMaterial, numOutputs: 3)
        chainingKey = ck
        mixHash(tempH)
        cipherState.setKey(tempK)
    }
    
    func encryptAndHash(_ plaintext: Data) throws -> Data {
        let ciphertext = try cipherState.encryptWithAd(ad: hash, plaintext: plaintext)
        mixHash(ciphertext)
        return ciphertext
    }
    
    func decryptAndHash(_ ciphertext: Data) throws -> Data {
        let plaintext = try cipherState.decryptWithAd(ad: hash, ciphertext: ciphertext)
        mixHash(ciphertext)
        return plaintext
    }
    
    func split() -> (CipherState, CipherState) {
        let (tempK1, tempK2, _) = hkdf(chainingKey: chainingKey, inputKeyMaterial: Data(), numOutputs: 2)
        
        let c1 = CipherState(key: tempK1)
        let c2 = CipherState(key: tempK2)
        
        return (c1, c2)
    }
    
    private func hkdf(chainingKey: Data, inputKeyMaterial: Data, numOutputs: Int) -> (Data, Data, Data) {
        let tempKey = hmacSHA256(key: chainingKey, data: inputKeyMaterial)
        let output1 = hmacSHA256(key: tempKey, data: Data([0x01]))
        var output2 = Data()
        var output3 = Data()
        
        if numOutputs >= 2 {
            var toHash = output1
            toHash.append(0x02)
            output2 = hmacSHA256(key: tempKey, data: toHash)
        }
        
        if numOutputs >= 3 {
            var toHash = output2
            toHash.append(0x03)
            output3 = hmacSHA256(key: tempKey, data: toHash)
        }
        
        return (output1, output2, output3)
    }
    
    private func hmacSHA256(key: Data, data: Data) -> Data {
        let symmetricKey = SymmetricKey(data: key)
        let mac = HMAC<SHA256>.authenticationCode(for: data, using: symmetricKey)
        return Data(mac)
    }
}

// MARK: - Handshake State

private class HandshakeState {
    var symmetricState: SymmetricState
    var localStatic: Curve25519.KeyAgreement.PrivateKey
    var localEphemeral: Curve25519.KeyAgreement.PrivateKey?
    var remoteStatic: Curve25519.KeyAgreement.PublicKey?
    var remoteEphemeral: Curve25519.KeyAgreement.PublicKey?
    var initiator: Bool
    var messagePatterns: [[String]]
    
    init(
        localStatic: Curve25519.KeyAgreement.PrivateKey,
        remoteStatic: Curve25519.KeyAgreement.PublicKey? = nil,
        initiator: Bool
    ) {
        self.symmetricState = SymmetricState(protocolName: NoiseConstants.protocolNameBytes)
        self.localStatic = localStatic
        self.remoteStatic = remoteStatic
        self.initiator = initiator
        
        // XX pattern message tokens
        self.messagePatterns = [
            ["e"],                    // -> e
            ["e", "ee", "s", "es"],   // <- e, ee, s, es
            ["s", "se"]               // -> s, se
        ]
        
        // Mix in prologue (empty for now)
        symmetricState.mixHash(Data())
    }
    
    func writeMessage(payload: Data = Data()) throws -> Data {
        guard !messagePatterns.isEmpty else {
            throw NoiseError.handshakeComplete
        }
        
        let pattern = messagePatterns.removeFirst()
        var message = Data()
        
        for token in pattern {
            switch token {
            case "e":
                localEphemeral = Curve25519.KeyAgreement.PrivateKey()
                let pubKey = localEphemeral!.publicKey.rawRepresentation
                message.append(pubKey)
                symmetricState.mixHash(pubKey)
                
            case "s":
                let encrypted = try symmetricState.encryptAndHash(localStatic.publicKey.rawRepresentation)
                message.append(encrypted)
                
            case "ee":
                let shared = try localEphemeral!.sharedSecretFromKeyAgreement(with: remoteEphemeral!)
                symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                
            case "es":
                if initiator {
                    let shared = try localEphemeral!.sharedSecretFromKeyAgreement(with: remoteStatic!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                } else {
                    let shared = try localStatic.sharedSecretFromKeyAgreement(with: remoteEphemeral!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                }
                
            case "se":
                if initiator {
                    let shared = try localStatic.sharedSecretFromKeyAgreement(with: remoteEphemeral!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                } else {
                    let shared = try localEphemeral!.sharedSecretFromKeyAgreement(with: remoteStatic!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                }
                
            default:
                break
            }
        }
        
        let encryptedPayload = try symmetricState.encryptAndHash(payload)
        message.append(encryptedPayload)
        
        return message
    }
    
    func readMessage(_ message: Data, payloadBuffer: inout Data) throws {
        guard !messagePatterns.isEmpty else {
            throw NoiseError.handshakeComplete
        }
        
        let pattern = messagePatterns.removeFirst()
        var offset = 0
        
        for token in pattern {
            switch token {
            case "e":
                let pubKeyData = message[offset..<(offset + 32)]
                remoteEphemeral = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: pubKeyData)
                symmetricState.mixHash(Data(pubKeyData))
                offset += 32
                
            case "s":
                let length = symmetricState.cipherState.hasKey() ? 32 + NoiseConstants.tagSize : 32
                let encrypted = message[offset..<(offset + length)]
                let pubKeyData = try symmetricState.decryptAndHash(Data(encrypted))
                remoteStatic = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: pubKeyData)
                offset += length
                
            case "ee":
                let shared = try localEphemeral!.sharedSecretFromKeyAgreement(with: remoteEphemeral!)
                symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                
            case "es":
                if initiator {
                    let shared = try localEphemeral!.sharedSecretFromKeyAgreement(with: remoteStatic!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                } else {
                    let shared = try localStatic.sharedSecretFromKeyAgreement(with: remoteEphemeral!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                }
                
            case "se":
                if initiator {
                    let shared = try localStatic.sharedSecretFromKeyAgreement(with: remoteEphemeral!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                } else {
                    let shared = try localEphemeral!.sharedSecretFromKeyAgreement(with: remoteStatic!)
                    symmetricState.mixKey(shared.withUnsafeBytes { Data($0) })
                }
                
            default:
                break
            }
        }
        
        let encryptedPayload = message[offset...]
        payloadBuffer = try symmetricState.decryptAndHash(Data(encryptedPayload))
    }
    
    var isComplete: Bool {
        messagePatterns.isEmpty
    }
}

// MARK: - Noise Error

public enum NoiseError: Error, LocalizedError {
    case handshakeComplete
    case handshakeIncomplete
    case decryptionFailed
    case invalidPublicKey
    case messageTooLarge
    
    public var errorDescription: String? {
        switch self {
        case .handshakeComplete: return "Handshake already complete"
        case .handshakeIncomplete: return "Handshake not yet complete"
        case .decryptionFailed: return "Decryption failed"
        case .invalidPublicKey: return "Invalid public key"
        case .messageTooLarge: return "Message too large"
        }
    }
}

// MARK: - Noise Session

/// A complete Noise protocol session for secure communication
public class NoiseSession {
    
    private var handshakeState: HandshakeState?
    private var sendCipher: CipherState?
    private var receiveCipher: CipherState?
    
    public private(set) var isHandshakeComplete = false
    public private(set) var remoteStaticKey: Data?
    
    private let localStaticKey: Curve25519.KeyAgreement.PrivateKey
    public let isInitiator: Bool
    
    /// Create a new Noise session
    /// - Parameters:
    ///   - localStaticKey: Our long-term identity key
    ///   - isInitiator: Whether we're initiating the handshake
    public init(localStaticKey: Curve25519.KeyAgreement.PrivateKey, isInitiator: Bool) {
        self.localStaticKey = localStaticKey
        self.isInitiator = isInitiator
        self.handshakeState = HandshakeState(localStatic: localStaticKey, initiator: isInitiator)
    }
    
    /// Get our public key
    public var localPublicKey: Data {
        localStaticKey.publicKey.rawRepresentation
    }
    
    /// Write the next handshake message
    public func writeHandshakeMessage(payload: Data = Data()) throws -> Data {
        guard let hs = handshakeState else {
            throw NoiseError.handshakeComplete
        }
        
        let message = try hs.writeMessage(payload: payload)
        
        if hs.isComplete {
            finalizeHandshake()
        }
        
        return message
    }
    
    /// Read a handshake message from the peer
    public func readHandshakeMessage(_ message: Data) throws -> Data {
        guard let hs = handshakeState else {
            throw NoiseError.handshakeComplete
        }
        
        var payload = Data()
        try hs.readMessage(message, payloadBuffer: &payload)
        
        if hs.isComplete {
            finalizeHandshake()
        }
        
        return payload
    }
    
    /// Encrypt a message after handshake is complete
    public func encrypt(_ plaintext: Data) throws -> Data {
        guard isHandshakeComplete, let cipher = sendCipher else {
            throw NoiseError.handshakeIncomplete
        }
        
        guard plaintext.count <= NoiseConstants.maxMessageSize else {
            throw NoiseError.messageTooLarge
        }
        
        return try cipher.encryptWithAd(ad: Data(), plaintext: plaintext)
    }
    
    /// Decrypt a message after handshake is complete
    public func decrypt(_ ciphertext: Data) throws -> Data {
        guard isHandshakeComplete, let cipher = receiveCipher else {
            throw NoiseError.handshakeIncomplete
        }
        
        return try cipher.decryptWithAd(ad: Data(), ciphertext: ciphertext)
    }
    
    private func finalizeHandshake() {
        guard let hs = handshakeState else { return }
        
        let (c1, c2) = hs.symmetricState.split()
        
        if isInitiator {
            sendCipher = c1
            receiveCipher = c2
        } else {
            sendCipher = c2
            receiveCipher = c1
        }
        
        remoteStaticKey = hs.remoteStatic?.rawRepresentation
        handshakeState = nil
        isHandshakeComplete = true
    }
}

// MARK: - Noise Handshake Manager

/// Manages Noise handshakes for multiple peers
public actor NoiseHandshakeManager {
    
    private var sessions: [String: NoiseSession] = [:]
    private let identityKey: Curve25519.KeyAgreement.PrivateKey
    
    public init(identityKey: Curve25519.KeyAgreement.PrivateKey? = nil) {
        self.identityKey = identityKey ?? Curve25519.KeyAgreement.PrivateKey()
    }
    
    /// Get our public identity key
    public var publicKey: Data {
        identityKey.publicKey.rawRepresentation
    }
    
    /// Start a handshake with a peer (as initiator)
    public func initiateHandshake(with peerId: String) throws -> Data {
        let session = NoiseSession(localStaticKey: identityKey, isInitiator: true)
        sessions[peerId] = session
        return try session.writeHandshakeMessage()
    }
    
    /// Handle incoming handshake message
    public func handleHandshakeMessage(_ message: Data, from peerId: String) throws -> (response: Data?, complete: Bool) {
        // Get or create session
        let session: NoiseSession
        if let existing = sessions[peerId] {
            session = existing
        } else {
            // Create responder session
            session = NoiseSession(localStaticKey: identityKey, isInitiator: false)
            sessions[peerId] = session
        }
        
        // Process message
        let _ = try session.readHandshakeMessage(message)
        
        // Generate response if handshake not complete
        if !session.isHandshakeComplete {
            let response = try session.writeHandshakeMessage()
            return (response, session.isHandshakeComplete)
        }
        
        return (nil, true)
    }
    
    /// Get session for encrypting/decrypting messages
    public func getSession(for peerId: String) -> NoiseSession? {
        return sessions[peerId]
    }
    
    /// Remove session
    public func removeSession(for peerId: String) {
        sessions.removeValue(forKey: peerId)
    }
    
    /// Check if handshake is complete for a peer
    public func isHandshakeComplete(for peerId: String) -> Bool {
        sessions[peerId]?.isHandshakeComplete ?? false
    }
    
    /// Get peer's static public key after handshake
    public func getRemotePublicKey(for peerId: String) -> Data? {
        sessions[peerId]?.remoteStaticKey
    }
}
