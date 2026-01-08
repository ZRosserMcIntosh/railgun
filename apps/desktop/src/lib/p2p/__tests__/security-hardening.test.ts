/**
 * Security Hardening Test Suite
 * 
 * Tests for SEC-002, SEC-003, SEC-004 remediations:
 * - X25519 key exchange
 * - Peer reputation system (Sybil protection)
 * - DTLS fingerprint verification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateX25519KeyPair,
  deriveX25519SharedSecret,
  deriveSessionKeys,
  encryptWithSessionKey,
  decryptWithSessionKey,
  initiateKeyExchange,
  completeKeyExchange,
  PeerReputationManager,
  verifyDTLSFingerprint,
  extractFingerprintFromSDP,
} from '../security-hardening';

// ============================================================================
// X25519 Key Exchange Tests (SEC-002)
// ============================================================================

describe('X25519 Key Exchange (SEC-002)', () => {
  describe('generateX25519KeyPair', () => {
    it('generates valid 32-byte keypairs', async () => {
      const keyPair = await generateX25519KeyPair();
      
      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.publicKey.length).toBe(32);
      expect(keyPair.privateKey.length).toBe(32);
    });

    it('generates unique keypairs on each call', async () => {
      const keyPair1 = await generateX25519KeyPair();
      const keyPair2 = await generateX25519KeyPair();
      
      expect(Buffer.from(keyPair1.publicKey).toString('hex'))
        .not.toBe(Buffer.from(keyPair2.publicKey).toString('hex'));
      expect(Buffer.from(keyPair1.privateKey).toString('hex'))
        .not.toBe(Buffer.from(keyPair2.privateKey).toString('hex'));
    });
  });

  describe('deriveX25519SharedSecret', () => {
    it('derives same shared secret for both parties', async () => {
      const alice = await generateX25519KeyPair();
      const bob = await generateX25519KeyPair();
      
      const aliceShared = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
      const bobShared = await deriveX25519SharedSecret(bob.privateKey, alice.publicKey);
      
      expect(Buffer.from(aliceShared).toString('hex'))
        .toBe(Buffer.from(bobShared).toString('hex'));
    });

    it('produces 32-byte shared secret', async () => {
      const alice = await generateX25519KeyPair();
      const bob = await generateX25519KeyPair();
      
      const shared = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
      
      expect(shared.length).toBe(32);
    });

    it('produces different secrets for different keypairs', async () => {
      const alice = await generateX25519KeyPair();
      const bob1 = await generateX25519KeyPair();
      const bob2 = await generateX25519KeyPair();
      
      const shared1 = await deriveX25519SharedSecret(alice.privateKey, bob1.publicKey);
      const shared2 = await deriveX25519SharedSecret(alice.privateKey, bob2.publicKey);
      
      expect(Buffer.from(shared1).toString('hex'))
        .not.toBe(Buffer.from(shared2).toString('hex'));
    });
  });

  describe('deriveSessionKeys', () => {
    it('derives encryption key, MAC key, and nonce', async () => {
      const alice = await generateX25519KeyPair();
      const bob = await generateX25519KeyPair();
      const sharedSecret = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
      
      const sessionKeys = await deriveSessionKeys(sharedSecret);
      
      expect(sessionKeys.encryptionKey.length).toBe(32);
      expect(sessionKeys.macKey.length).toBe(32);
      expect(sessionKeys.nonce.length).toBe(12);
    });

    it('produces same keys for same inputs', async () => {
      const alice = await generateX25519KeyPair();
      const bob = await generateX25519KeyPair();
      const sharedSecret = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
      const salt = new Uint8Array(32).fill(42);
      
      const keys1 = await deriveSessionKeys(sharedSecret, salt, 'test-context');
      const keys2 = await deriveSessionKeys(sharedSecret, salt, 'test-context');
      
      expect(Buffer.from(keys1.encryptionKey).toString('hex'))
        .toBe(Buffer.from(keys2.encryptionKey).toString('hex'));
    });

    it('produces different keys for different info strings', async () => {
      const alice = await generateX25519KeyPair();
      const bob = await generateX25519KeyPair();
      const sharedSecret = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
      
      const keys1 = await deriveSessionKeys(sharedSecret, undefined, 'context-1');
      const keys2 = await deriveSessionKeys(sharedSecret, undefined, 'context-2');
      
      expect(Buffer.from(keys1.encryptionKey).toString('hex'))
        .not.toBe(Buffer.from(keys2.encryptionKey).toString('hex'));
    });
  });
});

// ============================================================================
// AES-256-GCM Encryption Tests
// ============================================================================

describe('AES-256-GCM Encryption', () => {
  let encryptionKey: Uint8Array;
  let nonce: Uint8Array;

  beforeEach(async () => {
    const alice = await generateX25519KeyPair();
    const bob = await generateX25519KeyPair();
    const sharedSecret = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
    const sessionKeys = await deriveSessionKeys(sharedSecret);
    
    encryptionKey = sessionKeys.encryptionKey;
    nonce = sessionKeys.nonce;
  });

  it('encrypts and decrypts plaintext correctly', async () => {
    const plaintext = new TextEncoder().encode('Hello, Rail Gun!');
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext);
    const decrypted = await decryptWithSessionKey(encryptionKey, nonce, ciphertext);
    
    expect(new TextDecoder().decode(decrypted)).toBe('Hello, Rail Gun!');
  });

  it('ciphertext is different from plaintext', async () => {
    const plaintext = new TextEncoder().encode('Secret message');
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext);
    
    expect(Buffer.from(ciphertext).toString('hex'))
      .not.toBe(Buffer.from(plaintext).toString('hex'));
  });

  it('includes authentication tag (ciphertext longer than plaintext)', async () => {
    const plaintext = new TextEncoder().encode('Test data');
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext);
    
    // AES-GCM adds 16 bytes (128 bits) authentication tag
    expect(ciphertext.length).toBe(plaintext.length + 16);
  });

  it('supports additional authenticated data (AAD)', async () => {
    const plaintext = new TextEncoder().encode('Authenticated message');
    const aad = new TextEncoder().encode('channel:general');
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext, aad);
    const decrypted = await decryptWithSessionKey(encryptionKey, nonce, ciphertext, aad);
    
    expect(new TextDecoder().decode(decrypted)).toBe('Authenticated message');
  });

  it('fails decryption with wrong AAD', async () => {
    const plaintext = new TextEncoder().encode('Authenticated message');
    const aad = new TextEncoder().encode('channel:general');
    const wrongAad = new TextEncoder().encode('channel:private');
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext, aad);
    
    await expect(
      decryptWithSessionKey(encryptionKey, nonce, ciphertext, wrongAad)
    ).rejects.toThrow();
  });

  it('fails decryption with wrong key', async () => {
    const plaintext = new TextEncoder().encode('Secret message');
    const wrongKey = new Uint8Array(32).fill(0);
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext);
    
    await expect(
      decryptWithSessionKey(wrongKey, nonce, ciphertext)
    ).rejects.toThrow();
  });

  it('fails decryption with tampered ciphertext', async () => {
    const plaintext = new TextEncoder().encode('Secret message');
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext);
    
    // Tamper with the ciphertext
    ciphertext[0] ^= 0xff;
    
    await expect(
      decryptWithSessionKey(encryptionKey, nonce, ciphertext)
    ).rejects.toThrow();
  });

  it('handles large messages', async () => {
    // 64KB of random data (respects crypto.getRandomValues limit)
    const plaintext = new Uint8Array(64 * 1024);
    crypto.getRandomValues(plaintext);
    
    const ciphertext = await encryptWithSessionKey(encryptionKey, nonce, plaintext);
    const decrypted = await decryptWithSessionKey(encryptionKey, nonce, ciphertext);
    
    expect(Buffer.from(decrypted).toString('hex'))
      .toBe(Buffer.from(plaintext).toString('hex'));
  });
});

// ============================================================================
// Session Key Exchange Protocol Tests
// ============================================================================

describe('Session Key Exchange Protocol', () => {
  it('initiates key exchange with ephemeral keypair', async () => {
    const exchange = await initiateKeyExchange();
    
    expect(exchange.keyExchange.ephemeralPublicKey.length).toBe(32);
    expect(exchange.keyExchange.nonce.length).toBe(32);
    expect(exchange.keyExchange.timestamp).toBeLessThanOrEqual(Date.now());
    expect(exchange.privateKey.length).toBe(32);
  });

  it('completes key exchange and derives session keys', async () => {
    // Alice initiates
    const aliceInit = await initiateKeyExchange();
    
    // Bob initiates (for his response)
    const bobInit = await initiateKeyExchange();
    
    // Alice completes with Bob's public key
    const aliceSession = await completeKeyExchange(
      aliceInit.privateKey,
      bobInit.keyExchange
    );
    
    // Bob completes with Alice's public key
    const bobSession = await completeKeyExchange(
      bobInit.privateKey,
      aliceInit.keyExchange
    );
    
    // Both should derive same encryption key
    expect(Buffer.from(aliceSession.encryptionKey).toString('hex'))
      .toBe(Buffer.from(bobSession.encryptionKey).toString('hex'));
  });

  it('rejects old key exchange messages', async () => {
    const init = await initiateKeyExchange();
    
    // Fake an old timestamp (6 minutes ago)
    const oldExchange = {
      ...init.keyExchange,
      timestamp: Date.now() - 6 * 60 * 1000,
    };
    
    const bobInit = await initiateKeyExchange();
    
    await expect(
      completeKeyExchange(bobInit.privateKey, oldExchange)
    ).rejects.toThrow('expired');
  });
});

// ============================================================================
// Peer Reputation System Tests (SEC-003 - Sybil Protection)
// ============================================================================

describe('Peer Reputation System (SEC-003)', () => {
  let reputationManager: PeerReputationManager;

  beforeEach(() => {
    reputationManager = new PeerReputationManager();
  });

  describe('Initial Scores', () => {
    it('assigns default score to new peers', () => {
      const score = reputationManager.getScore('peer-1');
      
      expect(score.trustLevel).toBe('neutral');
      expect(score.score).toBe(50); // Default neutral score
    });

    it('tracks first seen timestamp', () => {
      const beforeTime = Date.now();
      reputationManager.getScore('peer-1');
      const afterTime = Date.now();
      
      const score = reputationManager.getScore('peer-1');
      
      expect(score.firstSeen).toBeGreaterThanOrEqual(beforeTime);
      expect(score.firstSeen).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Reputation Updates', () => {
    it('increases score for successful message delivery', () => {
      const initialScore = reputationManager.getScore('peer-1').score;
      
      reputationManager.recordSuccess('peer-1', 'message_delivery');
      
      const newScore = reputationManager.getScore('peer-1').score;
      expect(newScore).toBeGreaterThan(initialScore);
    });

    it('decreases score for failed message delivery', () => {
      const initialScore = reputationManager.getScore('peer-1').score;
      
      reputationManager.recordFailure('peer-1', 'message_delivery');
      
      const newScore = reputationManager.getScore('peer-1').score;
      expect(newScore).toBeLessThan(initialScore);
    });

    it('increases score for relay participation', () => {
      const initialScore = reputationManager.getScore('peer-1').score;
      
      reputationManager.recordSuccess('peer-1', 'relay_participation');
      
      const newScore = reputationManager.getScore('peer-1').score;
      expect(newScore).toBeGreaterThan(initialScore);
    });

    it('increases score for bandwidth contribution', () => {
      const initialScore = reputationManager.getScore('peer-1').score;
      
      reputationManager.recordSuccess('peer-1', 'bandwidth_contribution');
      
      const newScore = reputationManager.getScore('peer-1').score;
      expect(newScore).toBeGreaterThan(initialScore);
    });
  });

  describe('Trust Levels', () => {
    it('elevates trust level with consistent good behavior', () => {
      // Simulate many successful interactions
      for (let i = 0; i < 50; i++) {
        reputationManager.recordSuccess('peer-1', 'message_delivery');
      }
      
      const score = reputationManager.getScore('peer-1');
      expect(score.trustLevel).toBe('trusted');
    });

    it('degrades trust level with bad behavior', () => {
      // First build up some trust
      for (let i = 0; i < 20; i++) {
        reputationManager.recordSuccess('peer-1', 'message_delivery');
      }
      
      // Then exhibit bad behavior
      for (let i = 0; i < 30; i++) {
        reputationManager.recordFailure('peer-1', 'message_delivery');
      }
      
      const score = reputationManager.getScore('peer-1');
      expect(['neutral', 'suspicious', 'blocked']).toContain(score.trustLevel);
    });

    it('blocks peers with very low scores', () => {
      // Many failures
      for (let i = 0; i < 100; i++) {
        reputationManager.recordFailure('peer-1', 'message_delivery');
      }
      
      const score = reputationManager.getScore('peer-1');
      expect(score.trustLevel).toBe('blocked');
    });
  });

  describe('Peer Selection', () => {
    it('selects peers above trust threshold', () => {
      // Create peers with varying scores
      for (let i = 0; i < 30; i++) {
        reputationManager.recordSuccess('good-peer', 'message_delivery');
      }
      for (let i = 0; i < 10; i++) {
        reputationManager.recordFailure('bad-peer', 'message_delivery');
      }
      reputationManager.getScore('neutral-peer');
      
      const candidates = ['good-peer', 'bad-peer', 'neutral-peer'];
      // minScore of 40 should exclude bad-peer (score: 30) but include good-peer (80) and neutral-peer (50)
      const selected = reputationManager.selectTrustedPeers(candidates, 40);
      
      expect(selected).toContain('good-peer');
      expect(selected).not.toContain('bad-peer');
    });

    it('excludes blocked peers from selection', () => {
      // Block a peer
      for (let i = 0; i < 100; i++) {
        reputationManager.recordFailure('blocked-peer', 'message_delivery');
      }
      
      const candidates = ['blocked-peer'];
      const selected = reputationManager.selectTrustedPeers(candidates, 1);
      
      expect(selected).not.toContain('blocked-peer');
    });
  });

  describe('Sybil Attack Protection', () => {
    it('new peers have rate-limited trust building', () => {
      const peer = 'sybil-attempt-1';
      
      // Try to rapidly build trust
      for (let i = 0; i < 100; i++) {
        reputationManager.recordSuccess(peer, 'message_delivery');
      }
      
      const score = reputationManager.getScore(peer);
      
      // Score should be capped to prevent rapid trust building
      expect(score.score).toBeLessThan(100);
    });

    it('tracks interaction count', () => {
      const peer = 'tracked-peer';
      
      reputationManager.recordSuccess(peer, 'message_delivery');
      reputationManager.recordSuccess(peer, 'message_delivery');
      reputationManager.recordFailure(peer, 'message_delivery');
      
      const score = reputationManager.getScore(peer);
      
      expect(score.totalInteractions).toBe(3);
    });
  });

  describe('Persistence', () => {
    it('exports reputation data', () => {
      reputationManager.recordSuccess('peer-1', 'message_delivery');
      reputationManager.recordSuccess('peer-2', 'relay_participation');
      
      const exported = reputationManager.exportData();
      
      expect(exported).toHaveProperty('peer-1');
      expect(exported).toHaveProperty('peer-2');
    });

    it('imports reputation data', () => {
      reputationManager.recordSuccess('peer-1', 'message_delivery');
      const exported = reputationManager.exportData();
      
      const newManager = new PeerReputationManager();
      newManager.importData(exported);
      
      const score = newManager.getScore('peer-1');
      expect(score.totalInteractions).toBe(1);
    });
  });
});

// ============================================================================
// DTLS Fingerprint Verification Tests (SEC-004)
// ============================================================================

describe('DTLS Fingerprint Verification (SEC-004)', () => {
  describe('extractFingerprintFromSDP', () => {
    it('extracts fingerprint from valid SDP', () => {
      const sdp = `v=0
o=- 1234567890 2 IN IP4 127.0.0.1
s=-
t=0 0
a=fingerprint:sha-256 AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90
m=audio 9 UDP/TLS/RTP/SAVPF 111`;
      
      const fingerprint = extractFingerprintFromSDP(sdp);
      
      expect(fingerprint).toBe('AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90');
    });

    it('returns null for SDP without fingerprint', () => {
      const sdp = `v=0
o=- 1234567890 2 IN IP4 127.0.0.1
s=-
t=0 0
m=audio 9 UDP/RTP/AVP 111`;
      
      const fingerprint = extractFingerprintFromSDP(sdp);
      
      expect(fingerprint).toBeNull();
    });

    it('handles different fingerprint formats', () => {
      const sdpSha256 = `a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99`;
      const sdpSha1 = `a=fingerprint:sha-1 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD`;
      
      expect(extractFingerprintFromSDP(sdpSha256)).toBeTruthy();
      expect(extractFingerprintFromSDP(sdpSha1)).toBeTruthy();
    });
  });

  describe('verifyDTLSFingerprint', () => {
    it('verifies matching fingerprints', async () => {
      const fingerprint = 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90';
      const expectedFingerprint = 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90';
      
      const result = await verifyDTLSFingerprint(fingerprint, expectedFingerprint);
      
      expect(result).toBe(true);
    });

    it('rejects mismatched fingerprints', async () => {
      const fingerprint = 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90';
      const expectedFingerprint = 'FF:FF:FF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90';
      
      const result = await verifyDTLSFingerprint(fingerprint, expectedFingerprint);
      
      expect(result).toBe(false);
    });

    it('is case insensitive', async () => {
      const fingerprint = 'ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90';
      const expectedFingerprint = 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90';
      
      const result = await verifyDTLSFingerprint(fingerprint, expectedFingerprint);
      
      expect(result).toBe(true);
    });
  });
});

// ============================================================================
// End-to-End Encryption Flow Tests
// ============================================================================

describe('End-to-End Encryption Flow', () => {
  it('completes full secure message exchange', async () => {
    // 1. Both parties generate keypairs
    const alice = await generateX25519KeyPair();
    const bob = await generateX25519KeyPair();
    
    // 2. Exchange public keys (simulated)
    // In production, this happens via signaling
    
    // 3. Both derive shared secret
    const aliceShared = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
    const bobShared = await deriveX25519SharedSecret(bob.privateKey, alice.publicKey);
    
    // 4. Derive session keys with shared nonce
    const sharedNonce = new Uint8Array(32);
    crypto.getRandomValues(sharedNonce);
    
    const aliceKeys = await deriveSessionKeys(aliceShared, sharedNonce);
    const bobKeys = await deriveSessionKeys(bobShared, sharedNonce);
    
    // 5. Alice encrypts message
    const message = new TextEncoder().encode('Hello Bob, this is encrypted!');
    const ciphertext = await encryptWithSessionKey(
      aliceKeys.encryptionKey,
      aliceKeys.nonce,
      message
    );
    
    // 6. Bob decrypts message
    const decrypted = await decryptWithSessionKey(
      bobKeys.encryptionKey,
      bobKeys.nonce,
      ciphertext
    );
    
    expect(new TextDecoder().decode(decrypted)).toBe('Hello Bob, this is encrypted!');
  });

  it('handles bidirectional encrypted communication', async () => {
    const alice = await generateX25519KeyPair();
    const bob = await generateX25519KeyPair();
    
    const sharedSecret = await deriveX25519SharedSecret(alice.privateKey, bob.publicKey);
    const sessionKeys = await deriveSessionKeys(sharedSecret);
    
    // Simulate message counter for unique nonces
    const createNonce = (counter: number, baseNonce: Uint8Array): Uint8Array => {
      const nonce = new Uint8Array(baseNonce);
      const counterBytes = new Uint8Array(4);
      new DataView(counterBytes.buffer).setUint32(0, counter, true);
      // XOR counter into first 4 bytes
      for (let i = 0; i < 4; i++) {
        nonce[i] ^= counterBytes[i];
      }
      return nonce;
    };
    
    // Alice sends to Bob
    const msg1 = new TextEncoder().encode('Message 1: Hello!');
    const nonce1 = createNonce(1, sessionKeys.nonce);
    const ct1 = await encryptWithSessionKey(sessionKeys.encryptionKey, nonce1, msg1);
    
    // Bob sends to Alice
    const msg2 = new TextEncoder().encode('Message 2: Hi there!');
    const nonce2 = createNonce(2, sessionKeys.nonce);
    const ct2 = await encryptWithSessionKey(sessionKeys.encryptionKey, nonce2, msg2);
    
    // Both decrypt
    const decrypted1 = await decryptWithSessionKey(sessionKeys.encryptionKey, nonce1, ct1);
    const decrypted2 = await decryptWithSessionKey(sessionKeys.encryptionKey, nonce2, ct2);
    
    expect(new TextDecoder().decode(decrypted1)).toBe('Message 1: Hello!');
    expect(new TextDecoder().decode(decrypted2)).toBe('Message 2: Hi there!');
  });
});
