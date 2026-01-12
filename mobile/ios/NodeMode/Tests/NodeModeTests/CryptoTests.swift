//
//  CryptoTests.swift
//  NodeModeTests
//
//  Unit tests for cryptographic operations
//

import XCTest
import CryptoKit
@testable import NodeMode

final class CryptoTests: XCTestCase {
    
    // MARK: - Noise Protocol Tests
    
    func testNoiseHandshakeXX() async throws {
        let initiator = NoiseProtocol()
        let responder = NoiseProtocol()
        
        // Generate static keys
        let initiatorStatic = Curve25519.KeyAgreement.PrivateKey()
        let responderStatic = Curve25519.KeyAgreement.PrivateKey()
        
        // Message 1: Initiator -> Responder (e)
        let (message1, _) = try await initiator.initiateHandshake(
            staticKey: initiatorStatic
        )
        
        // Message 2: Responder -> Initiator (e, ee, s, es)
        let (message2, _) = try await responder.respondToHandshake(
            staticKey: responderStatic,
            message: message1
        )
        
        // Message 3: Initiator -> Responder (s, se)
        let (message3, initiatorSession) = try await initiator.finalizeInitiator(
            message: message2
        )
        
        // Finalize responder
        let responderSession = try await responder.finalizeResponder(
            message: message3
        )
        
        XCTAssertNotNil(initiatorSession)
        XCTAssertNotNil(responderSession)
        
        // Test encryption/decryption
        let plaintext = "Hello, secure world!".data(using: .utf8)!
        
        let ciphertext = try initiatorSession.encrypt(plaintext)
        let decrypted = try responderSession.decrypt(ciphertext)
        
        XCTAssertEqual(plaintext, decrypted)
    }
    
    func testNoiseSessionEncryptionRoundTrip() async throws {
        // Create a test session
        let sharedKey = SymmetricKey(size: .bits256)
        let session = NoiseSession(
            sendingKey: sharedKey,
            receivingKey: sharedKey,
            isInitiator: true
        )
        
        let messages = [
            "Short message",
            "A much longer message that contains more data for testing purposes",
            String(repeating: "X", count: 10000) // Large message
        ]
        
        for message in messages {
            let plaintext = message.data(using: .utf8)!
            let ciphertext = try session.encrypt(plaintext)
            let decrypted = try session.decrypt(ciphertext)
            XCTAssertEqual(plaintext, decrypted, "Failed for message length: \(message.count)")
        }
    }
    
    // MARK: - Key Rotation Tests
    
    func testDoubleRatchetKeyDerivation() async throws {
        let manager = KeyRotationManager()
        
        // Initialize ratchet state for both parties
        let aliceIdentity = Curve25519.KeyAgreement.PrivateKey()
        let bobIdentity = Curve25519.KeyAgreement.PrivateKey()
        let bobSignedPreKey = Curve25519.KeyAgreement.PrivateKey()
        
        // Alice initiates
        let aliceState = try await manager.initiateSenderSession(
            identityKey: aliceIdentity,
            bobIdentity: bobIdentity.publicKey,
            bobSignedPreKey: bobSignedPreKey.publicKey
        )
        
        // Bob receives
        let bobState = try await manager.initiateReceiverSession(
            identityKey: bobIdentity,
            signedPreKey: bobSignedPreKey,
            aliceIdentity: aliceIdentity.publicKey,
            aliceEphemeral: aliceState.ephemeralPublicKey
        )
        
        XCTAssertNotNil(aliceState)
        XCTAssertNotNil(bobState)
    }
    
    func testRatchetKeyRotation() async throws {
        let ratchet = SymmetricRatchet(rootKey: SymmetricKey(size: .bits256))
        
        var previousKey: SymmetricKey? = nil
        
        // Generate several chain keys
        for _ in 0..<10 {
            let (chainKey, _) = try ratchet.ratchetStep()
            
            // Each key should be different
            if let prev = previousKey {
                let prevData = prev.withUnsafeBytes { Data($0) }
                let currentData = chainKey.withUnsafeBytes { Data($0) }
                XCTAssertNotEqual(prevData, currentData)
            }
            
            previousKey = chainKey
        }
    }
    
    // MARK: - Secure Key Storage Tests
    
    func testSecureKeyStorageRoundTrip() async throws {
        let storage = SecureKeyStorage()
        let testKey = Curve25519.KeyAgreement.PrivateKey()
        let keyId = "test-key-\(UUID().uuidString)"
        
        // Store
        try await storage.storePrivateKey(testKey, identifier: keyId)
        
        // Retrieve
        let retrieved = try await storage.retrievePrivateKey(identifier: keyId)
        
        XCTAssertNotNil(retrieved)
        XCTAssertEqual(testKey.publicKey.rawRepresentation, retrieved?.publicKey.rawRepresentation)
        
        // Cleanup
        try await storage.deleteKey(identifier: keyId)
        
        // Verify deletion
        let afterDelete = try await storage.retrievePrivateKey(identifier: keyId)
        XCTAssertNil(afterDelete)
    }
    
    func testSecureKeyStorageOverwrite() async throws {
        let storage = SecureKeyStorage()
        let keyId = "overwrite-test-\(UUID().uuidString)"
        
        let key1 = Curve25519.KeyAgreement.PrivateKey()
        let key2 = Curve25519.KeyAgreement.PrivateKey()
        
        try await storage.storePrivateKey(key1, identifier: keyId)
        try await storage.storePrivateKey(key2, identifier: keyId)
        
        let retrieved = try await storage.retrievePrivateKey(identifier: keyId)
        
        XCTAssertEqual(key2.publicKey.rawRepresentation, retrieved?.publicKey.rawRepresentation)
        
        try await storage.deleteKey(identifier: keyId)
    }
    
    // MARK: - Message Authentication Tests
    
    func testHMACAuthentication() {
        let key = SymmetricKey(size: .bits256)
        let message = "Authenticate this message".data(using: .utf8)!
        
        let mac = HMAC<SHA256>.authenticationCode(for: message, using: key)
        let macData = Data(mac)
        
        // Verify
        XCTAssertTrue(HMAC<SHA256>.isValidAuthenticationCode(macData, authenticating: message, using: key))
        
        // Tampered message should fail
        var tamperedMessage = message
        tamperedMessage[0] ^= 0xFF
        XCTAssertFalse(HMAC<SHA256>.isValidAuthenticationCode(macData, authenticating: tamperedMessage, using: key))
    }
    
    func testAESGCMEncryption() throws {
        let key = SymmetricKey(size: .bits256)
        let plaintext = "Secret message".data(using: .utf8)!
        let nonce = AES.GCM.Nonce()
        
        let sealedBox = try AES.GCM.seal(plaintext, using: key, nonce: nonce)
        let decrypted = try AES.GCM.open(sealedBox, using: key)
        
        XCTAssertEqual(plaintext, decrypted)
    }
    
    func testAESGCMTamperDetection() throws {
        let key = SymmetricKey(size: .bits256)
        let plaintext = "Secret message".data(using: .utf8)!
        
        let sealedBox = try AES.GCM.seal(plaintext, using: key)
        
        // Tamper with ciphertext
        var tamperedCiphertext = sealedBox.ciphertext
        tamperedCiphertext[0] ^= 0xFF
        
        XCTAssertThrowsError(try AES.GCM.open(
            try AES.GCM.SealedBox(nonce: sealedBox.nonce, ciphertext: tamperedCiphertext, tag: sealedBox.tag),
            using: key
        ))
    }
    
    // MARK: - Key Derivation Tests
    
    func testHKDFKeyDerivation() {
        let inputKey = SymmetricKey(size: .bits256)
        let salt = "test-salt".data(using: .utf8)!
        let info = "test-info".data(using: .utf8)!
        
        let derivedKey = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: salt,
            info: info,
            outputByteCount: 32
        )
        
        let keyData = derivedKey.withUnsafeBytes { Data($0) }
        XCTAssertEqual(keyData.count, 32)
        
        // Same inputs should produce same output
        let derivedKey2 = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: salt,
            info: info,
            outputByteCount: 32
        )
        
        let keyData2 = derivedKey2.withUnsafeBytes { Data($0) }
        XCTAssertEqual(keyData, keyData2)
    }
    
    // MARK: - Replay Protection Tests
    
    func testReplayProtection() async throws {
        let protection = ReplayProtection(windowSize: 64)
        
        // First message should be accepted
        let result1 = await protection.checkAndRecord(messageId: 1)
        XCTAssertTrue(result1)
        
        // Same message should be rejected
        let result2 = await protection.checkAndRecord(messageId: 1)
        XCTAssertFalse(result2)
        
        // New message should be accepted
        let result3 = await protection.checkAndRecord(messageId: 2)
        XCTAssertTrue(result3)
    }
    
    func testReplayProtectionWindow() async throws {
        let windowSize = 64
        let protection = ReplayProtection(windowSize: windowSize)
        
        // Accept messages in order
        for i in 1...100 {
            _ = await protection.checkAndRecord(messageId: UInt64(i))
        }
        
        // Recent message should be rejected
        let recentReplay = await protection.checkAndRecord(messageId: 99)
        XCTAssertFalse(recentReplay)
        
        // Very old message (outside window) behavior depends on implementation
        // Most implementations reject as potentially replay attack
    }
}

// MARK: - Test Helpers

/// Simple replay protection for testing
actor ReplayProtection {
    private var seenIds: Set<UInt64> = []
    private var highestId: UInt64 = 0
    private let windowSize: Int
    
    init(windowSize: Int) {
        self.windowSize = windowSize
    }
    
    func checkAndRecord(messageId: UInt64) -> Bool {
        // Check if already seen
        if seenIds.contains(messageId) {
            return false
        }
        
        // Check if too old
        if messageId + UInt64(windowSize) < highestId {
            return false
        }
        
        // Record and update
        seenIds.insert(messageId)
        if messageId > highestId {
            highestId = messageId
            // Trim old entries
            seenIds = seenIds.filter { $0 + UInt64(windowSize) >= highestId }
        }
        
        return true
    }
}
