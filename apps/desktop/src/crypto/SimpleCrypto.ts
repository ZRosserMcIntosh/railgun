/**
 * DevCrypto - Development/Testing Crypto Shim using libsodium-wrappers
 * 
 * ⚠️  WARNING: This is a DEVELOPMENT SHIM, not production crypto!
 * 
 * This provides basic encryption for development and testing using pure libsodium
 * (which works in browser/Electron renderer without native modules).
 * 
 * For production, use the full Signal Protocol via RailGunCrypto (main process).
 * 
 * WHAT THIS ACTUALLY PROVIDES:
 * ✅ DM encryption via sealed box (X25519 + XSalsa20-Poly1305)
 * ✅ Identity key generation (X25519)
 * ✅ Safety number computation (Signal-inspired, uses BLAKE2b not SHA-512)
 * ✅ Identity verification tracking
 * ✅ Random ID generation
 * 
 * WHAT THIS DOES NOT PROVIDE:
 * ❌ Group/channel encryption (messages are plaintext with warning)
 * ❌ Forward secrecy (no Double Ratchet)
 * ❌ Sender Keys for efficient group messaging
 * ❌ Verifiable signed prekeys (signature is a placeholder)
 * ❌ XEdDSA signatures (requires @aspect/libsignal)
 * 
 * ALGORITHMS USED:
 * - Sealed box: crypto_box_seal (X25519 + XSalsa20-Poly1305)
 * - Hashing: crypto_generichash (BLAKE2b), NOT SHA-512
 * - Key pairs: crypto_box_keypair (X25519), NOT Ed25519
 * 
 * The most dangerous crypto is the kind that "looks fine" in code review
 * and quietly provides zero secrecy. This file is intentionally loud
 * about its limitations.
 */

import * as sodiumModule from 'libsodium-wrappers';

// Handle both ESM namespace import and CommonJS module.exports
const sodium = (sodiumModule as any).default ?? sodiumModule;

import {
  computeSafetyNumberFromBase64,
  createIdentityStore,
  type SafetyNumber,
  type IdentityStatus,
  type StoredIdentity,
} from './SafetyNumber';

let sodiumReady = false;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
}

// ============================================================================
// DEV CRYPTO IMPLEMENTATION
// ============================================================================

export interface DevCryptoKeys {
  publicKey: string; // Base64
  privateKey: string; // Base64 (encrypted locally)
}

// Backwards compatibility alias
export type SimpleCryptoKeys = DevCryptoKeys;

export interface EncryptedPayload {
  ciphertext: string; // Base64
  nonce: string; // Base64
}

/**
 * DevCrypto - Development/testing crypto shim.
 * 
 * See file header for full limitations. This is NOT production crypto.
 */
class DevCryptoImpl {
  private keyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;
  private initialized = false;
  private localUserId: string | null = null;
  private deviceId: number = 1;
  private registrationId: number = 0;
  private identityStore: ReturnType<typeof createIdentityStore> | null = null;
  
  // Cache of peer identity keys (userId -> base64 public key)
  // Populated by ensureDmSession, used by encryptDm
  private peerKeyCache: Map<string, string> = new Map();

  async init(): Promise<void> {
    if (this.initialized) return;
    
    await ensureSodium();
    
    // Generate or load key pair
    // In a real implementation, we'd persist this securely
    this.keyPair = sodium.crypto_box_keypair();
    this.registrationId = sodium.randombytes_uniform(16384) + 1;
    
    // Initialize identity store with a simple localStorage-based store for DevCrypto
    this.identityStore = createIdentityStore(this.createSimpleKeyStore());
    
    this.initialized = true;
    console.log('[DevCrypto] ⚠️ Initialized (development shim - NOT production crypto)');
  }
  
  /**
   * Create a simple key-value store using localStorage with base64 encoding.
   * For DevCrypto only - the full RailGunCrypto uses encrypted IndexedDB.
   * 
   * NOTE: Uses base64 encoding for binary safety (TextEncoder/Decoder mangles arbitrary bytes).
   */
  private createSimpleKeyStore() {
    return {
      async get(key: string): Promise<Uint8Array | null> {
        const b64 = localStorage.getItem(`railgun_identity_${key}`);
        return b64 ? sodium.from_base64(b64) : null;
      },
      async set(key: string, value: Uint8Array): Promise<void> {
        localStorage.setItem(`railgun_identity_${key}`, sodium.to_base64(value));
      },
      async delete(key: string): Promise<void> {
        localStorage.removeItem(`railgun_identity_${key}`);
      },
      async has(key: string): Promise<boolean> {
        return localStorage.getItem(`railgun_identity_${key}`) !== null;
      },
      async listKeys(prefix: string): Promise<string[]> {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(`railgun_identity_${prefix}`)) {
            keys.push(k.replace('railgun_identity_', ''));
          }
        }
        return keys;
      },
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async setLocalUserId(userId: string): Promise<void> {
    this.localUserId = userId;
  }

  getLocalUserId(): string {
    if (!this.localUserId) {
      throw new Error('Local user ID not set');
    }
    return this.localUserId;
  }

  getDeviceId(): number {
    return this.deviceId;
  }

  getRegistrationId(): number {
    return this.registrationId;
  }

  // ==================== KEY MANAGEMENT ====================

  async getIdentityPublicKey(): Promise<string> {
    this.ensureInitialized();
    return sodium.to_base64(this.keyPair!.publicKey);
  }

  async getPreKeyBundle(): Promise<{
    identityKey: string;
    registrationId: number;
    deviceId: number;
    signedPreKey: {
      keyId: number;
      publicKey: string;
      signature: string;
    };
    preKeys: Array<{
      keyId: number;
      publicKey: string;
    }>;
  }> {
    return this.generatePreKeyBundle();
  }

  async generatePreKeyBundle(): Promise<{
    identityKey: string;
    registrationId: number;
    deviceId: number;
    signedPreKey: {
      keyId: number;
      publicKey: string;
      signature: string;
    };
    preKeys: Array<{
      keyId: number;
      publicKey: string;
    }>;
  }> {
    this.ensureInitialized();
    
    // Generate a "signed" pre-key (X25519 key pair)
    const signedPreKey = sodium.crypto_box_keypair();
    const signedPreKeyId = sodium.randombytes_uniform(0xFFFFFF);
    
    // ⚠️  HONEST PLACEHOLDER: The signature field is NOT verifiable.
    //
    // Real Signal uses XEdDSA to create signatures compatible with X25519 keys,
    // which requires the XEdDSA scheme (not available in plain libsodium).
    // 
    // For DevCrypto, we include an empty signature placeholder.
    // The full RailGunCrypto implementation should use @aspect/libsignal
    // which handles XEdDSA properly.
    //
    // DO NOT rely on this signature for authentication.
    const placeholderSignature = new Uint8Array(64); // Empty 64-byte signature
    
    // Generate one-time pre-keys
    const preKeys: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 0; i < 10; i++) {
      const pk = sodium.crypto_box_keypair();
      preKeys.push({
        keyId: i + 1,
        publicKey: sodium.to_base64(pk.publicKey),
      });
    }

    console.warn(
      '[DevCrypto] ⚠️ generatePreKeyBundle: signature field is a placeholder. ' +
      'Signed prekey verification is NOT implemented. Use RailGunCrypto for production.'
    );

    return {
      identityKey: sodium.to_base64(this.keyPair!.publicKey),
      registrationId: this.registrationId,
      deviceId: this.deviceId,
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: sodium.to_base64(signedPreKey.publicKey),
        signature: sodium.to_base64(placeholderSignature), // NOT VERIFIABLE
      },
      preKeys,
    };
  }

  async generateMorePreKeys(startId: number, count: number): Promise<Array<{ keyId: number; publicKey: string }>> {
    this.ensureInitialized();
    
    const preKeys: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 0; i < count; i++) {
      const pk = sodium.crypto_box_keypair();
      preKeys.push({
        keyId: startId + i,
        publicKey: sodium.to_base64(pk.publicKey),
      });
    }
    return preKeys;
  }

  // ==================== MESSAGE ENCRYPTION ====================

  /**
   * Encrypt a message for a recipient using sealed box.
   * 
   * SECURITY: Recipient public key is REQUIRED. There is no fallback.
   * The previous symmetric fallback using hash(userId+userId) was insecure
   * because anyone could derive the "key" from public identifiers.
   */
  async encryptMessage(
    _recipientUserId: string,
    _recipientDeviceId: number,
    plaintext: string,
    recipientPublicKey: string
  ): Promise<{ ciphertext: string; messageType: number }> {
    this.ensureInitialized();
    
    if (!recipientPublicKey) {
      throw new Error(
        '[DevCrypto] Missing recipient public key. ' +
        'Refusing insecure fallback - fetch key bundle first via /keys/bundle.'
      );
    }
    
    const plaintextBytes = sodium.from_string(plaintext);
    const recipientPk = sodium.from_base64(recipientPublicKey);
    const sealed = sodium.crypto_box_seal(plaintextBytes, recipientPk);
    
    return {
      ciphertext: sodium.to_base64(sealed),
      messageType: 1, // Sealed box (only supported type)
    };
  }

  /**
   * Decrypt a message from a sender using sealed box.
   */
  async decryptMessage(
    _senderUserId: string,
    _senderDeviceId: number,
    ciphertext: string,
    messageType: number
  ): Promise<string> {
    this.ensureInitialized();
    
    if (messageType !== 1) {
      throw new Error(
        `[DevCrypto] Unsupported message type ${messageType}. ` +
        'Only sealed box (type 1) is supported.'
      );
    }
    
    const ciphertextBytes = sodium.from_base64(ciphertext);
    const plaintext = sodium.crypto_box_seal_open(
      ciphertextBytes,
      this.keyPair!.publicKey,
      this.keyPair!.privateKey
    );
    
    return sodium.to_string(plaintext);
  }

  // ==================== CHANNEL ENCRYPTION ====================
  //
  // ⚠️  WARNING: Channel/group encryption is NOT IMPLEMENTED in DevCrypto.
  //
  // The previous implementation was broken:
  // - Encrypt derived key from channelId + localPublicKey
  // - Decrypt derived key from channelId + senderPublicKey
  // These don't match, so messages couldn't be decrypted.
  //
  // Real group encryption requires:
  // - Generate random shared channelKey on channel creation
  // - Distribute channelKey to members via sealed box (per-member)
  // - Store channelKey locally, use AEAD for channel messages
  //
  // For now, channel messages are sent as plaintext with a warning.
  // Use the full RailGunCrypto with Sender Keys for production.
  //

  /**
   * "Encrypt" a message for a channel.
   * 
   * ⚠️  NOT IMPLEMENTED: Returns plaintext with a marker.
   * DevCrypto does not support group encryption.
   */
  async encryptChannelMessage(
    channelId: string,
    plaintext: string
  ): Promise<{ ciphertext: string; senderKeyDistribution?: string }> {
    this.ensureInitialized();
    
    console.warn(
      `[DevCrypto] ⚠️ Channel encryption NOT IMPLEMENTED. ` +
      `Message for channel ${channelId} is NOT encrypted.`
    );
    
    // Return plaintext with a marker so we know it's unencrypted
    // This is intentionally obvious so no one mistakes it for real encryption
    const marker = '[DEVCRYPTO:PLAINTEXT]';
    return {
      ciphertext: sodium.to_base64(sodium.from_string(marker + plaintext)),
    };
  }

  /**
   * "Decrypt" a channel message.
   * 
   * ⚠️  NOT IMPLEMENTED: Expects plaintext with marker.
   */
  async decryptChannelMessage(
    channelId: string,
    _senderUserId: string,
    ciphertext: string,
    _senderPublicKey?: string
  ): Promise<string> {
    this.ensureInitialized();
    
    const decoded = sodium.to_string(sodium.from_base64(ciphertext));
    const marker = '[DEVCRYPTO:PLAINTEXT]';
    
    if (decoded.startsWith(marker)) {
      console.warn(
        `[DevCrypto] ⚠️ Received unencrypted channel message for ${channelId}.`
      );
      return decoded.slice(marker.length);
    }
    
    // If it doesn't have our marker, it might be from old broken code or real crypto
    throw new Error(
      `[DevCrypto] Cannot decrypt channel message. ` +
      `DevCrypto does not support real group encryption. ` +
      `Use RailGunCrypto with Sender Keys for production.`
    );
  }

  // ==================== SESSION MANAGEMENT ====================

  async hasDmSession(userId: string): Promise<boolean> {
    // In DevCrypto, we have a "session" if we have the peer's identity key cached
    return this.peerKeyCache.has(userId);
  }

  async hasSession(userId: string, _deviceId: number): Promise<boolean> {
    return this.peerKeyCache.has(userId);
  }

  async ensureDmSession(userId: string, preKeyBundle?: any): Promise<void> {
    // Extract and cache the identity key from the bundle
    if (preKeyBundle?.identityKey) {
      this.peerKeyCache.set(userId, preKeyBundle.identityKey);
      console.log(`[DevCrypto] Cached identity key for ${userId}`);
    } else if (!this.peerKeyCache.has(userId)) {
      throw new Error(
        `[DevCrypto] ensureDmSession requires preKeyBundle with identityKey ` +
        `for user ${userId}. Fetch bundle via /keys/bundle first.`
      );
    }
  }

  async ensureChannelSession(_channelId: string, _memberIds: string[]): Promise<void> {
    // DevCrypto doesn't support real channel encryption
    console.warn(
      `[DevCrypto] ⚠️ ensureChannelSession called but group encryption ` +
      `is NOT IMPLEMENTED. Messages will be sent as plaintext.`
    );
  }

  async establishSession(
    userId: string,
    deviceId: number,
    _preKeyBundle: any
  ): Promise<void> {
    // Simplified: no-op for now
    console.log(`[DevCrypto] Session established with ${userId}:${deviceId}`);
  }

  // ==================== SIGNAL-COMPATIBLE ENCRYPTION API ====================

  /**
   * Encrypt a DM using sealed box.
   * 
   * Uses cached identity key from ensureDmSession, or accepts explicit key.
   */
  async encryptDm(
    recipientId: string,
    plaintext: string,
    recipientPublicKey?: string
  ): Promise<{
    ciphertext: string;
    senderDeviceId: number;
    type: 'prekey' | 'message';
    registrationId?: number;
  }> {
    this.ensureInitialized();
    
    // Use provided key or look up from cache
    const pubKey = recipientPublicKey || this.peerKeyCache.get(recipientId);
    
    if (!pubKey) {
      throw new Error(
        `[DevCrypto] No identity key for ${recipientId}. ` +
        'Call ensureDmSession with preKeyBundle first, or provide recipientPublicKey.'
      );
    }
    
    const result = await this.encryptMessage(recipientId, 1, plaintext, pubKey);
    
    return {
      ciphertext: result.ciphertext,
      senderDeviceId: this.deviceId,
      type: 'message',
      registrationId: this.registrationId,
    };
  }

  /**
   * Decrypt a DM using sealed box.
   */
  async decryptDm(
    senderId: string,
    encrypted: {
      ciphertext: string;
      senderDeviceId: number;
      type?: 'prekey' | 'message';
      registrationId?: number;
    }
  ): Promise<string> {
    // Type 1 = sealed box (the only supported type)
    return this.decryptMessage(senderId, encrypted.senderDeviceId, encrypted.ciphertext, 1);
  }

  /**
   * Encrypt a channel message.
   */
  async encryptChannel(
    channelId: string,
    plaintext: string
  ): Promise<{
    ciphertext: string;
    senderDeviceId: number;
    distributionId: string;
  }> {
    this.ensureInitialized();
    
    const result = await this.encryptChannelMessage(channelId, plaintext);
    
    return {
      ciphertext: result.ciphertext,
      senderDeviceId: this.deviceId,
      distributionId: channelId, // Use channel ID as distribution ID
    };
  }

  /**
   * Decrypt a channel message.
   */
  async decryptChannel(
    channelId: string,
    senderId: string,
    encrypted: {
      ciphertext: string;
      senderDeviceId: number;
      distributionId?: string;
    }
  ): Promise<string> {
    // For now, we'll use a simplified approach - derive key from sender's public identity
    // In production, this would use actual sender keys
    return this.decryptChannelMessage(channelId, senderId, encrypted.ciphertext);
  }

  // ==================== SENDER KEY DISTRIBUTION ====================

  /**
   * Process a sender key distribution message (for group chats).
   * In simplified mode, this is a no-op since we don't support real group encryption.
   */
  async processSenderKeyDistribution(
    _channelId: string,
    _senderId: string,
    _distribution: string
  ): Promise<void> {
    // No-op - DevCrypto doesn't support sender keys
    console.warn('[DevCrypto] processSenderKeyDistribution called but sender keys are NOT implemented');
  }

  /**
   * Get our sender key distribution for a channel.
   * DevCrypto doesn't support sender keys - returns null.
   */
  async getSenderKeyDistribution(_channelId: string): Promise<string | null> {
    // Return null - we don't use sender keys in simplified mode
    return null;
  }

  // ==================== SAFETY NUMBERS & IDENTITY VERIFICATION ====================

  /**
   * Hash function for safety number computation using libsodium's generic hash.
   * 
   * ⚠️  NOTE: We use BLAKE2b-512, NOT SHA-512.
   * 
   * Real Signal uses 5200 iterations of SHA-512 for safety number computation.
   * This implementation is "Signal-inspired" but NOT compatible with Signal's
   * actual safety numbers. The output format is similar (60 digits) but the
   * underlying computation differs.
   * 
   * For production interoperability with Signal, use SHA-512 with proper iterations.
   */
  private hashFn = (data: Uint8Array): Uint8Array => {
    // BLAKE2b-512 (not SHA-512)
    return sodium.crypto_generichash(64, data);
  };

  /**
   * Compute safety number for identity verification.
   * Returns a 60-digit numeric string split into two lines (30 digits each).
   * 
   * ⚠️  Uses BLAKE2b, not Signal's 5200x SHA-512 iterations.
   * Numbers will NOT match Signal app safety numbers.
   */
  computeSafetyNumber(peerUserId: string, peerIdentityKey: string): string {
    this.ensureInitialized();
    
    if (!this.localUserId) {
      throw new Error('Local user ID not set');
    }
    
    const localIdentityKey = sodium.to_base64(this.keyPair!.publicKey);
    
    const safetyNumber = computeSafetyNumberFromBase64(
      this.localUserId,
      localIdentityKey,
      peerUserId,
      peerIdentityKey,
      this.hashFn
    );
    
    return safetyNumber.numeric;
  }

  /**
   * Get full safety number details including QR data.
   */
  async getSafetyNumberDetails(
    peerUserId: string,
    peerIdentityKey: string
  ): Promise<SafetyNumber> {
    this.ensureInitialized();
    
    if (!this.localUserId) {
      throw new Error('Local user ID not set');
    }
    
    const localIdentityKey = sodium.to_base64(this.keyPair!.publicKey);
    
    return computeSafetyNumberFromBase64(
      this.localUserId,
      localIdentityKey,
      peerUserId,
      peerIdentityKey,
      this.hashFn
    );
  }

  /**
   * Store or update a peer's identity key.
   * Returns whether this is a new identity or if it changed.
   */
  async storeIdentity(
    peerUserId: string,
    identityKey: string
  ): Promise<{ isNew: boolean; hasChanged: boolean; previousKey?: string }> {
    this.ensureInitialized();
    
    if (!this.identityStore) {
      throw new Error('Identity store not initialized');
    }
    
    const result = await this.identityStore.storeIdentity(peerUserId, identityKey);
    
    if (result.hasChanged) {
      console.warn(
        `[DevCrypto] ⚠️ IDENTITY CHANGED for ${peerUserId}! ` +
        'This could indicate a security issue.'
      );
    }
    
    return result;
  }

  /**
   * Check identity status for a peer.
   */
  async checkIdentityStatus(
    peerUserId: string,
    currentIdentityKey: string
  ): Promise<IdentityStatus> {
    this.ensureInitialized();
    
    if (!this.identityStore) {
      throw new Error('Identity store not initialized');
    }
    
    return this.identityStore.checkIdentityStatus(peerUserId, currentIdentityKey);
  }

  /**
   * Mark a peer's identity as verified.
   */
  async markIdentityVerified(peerUserId: string): Promise<void> {
    this.ensureInitialized();
    
    if (!this.identityStore) {
      throw new Error('Identity store not initialized');
    }
    
    await this.identityStore.markVerified(peerUserId);
    console.log(`[DevCrypto] Identity verified for ${peerUserId}`);
  }

  /**
   * Get stored identity for a peer.
   */
  async getStoredIdentity(peerUserId: string): Promise<StoredIdentity | null> {
    this.ensureInitialized();
    
    if (!this.identityStore) {
      throw new Error('Identity store not initialized');
    }
    
    return this.identityStore.getStoredIdentity(peerUserId);
  }

  /**
   * Check if peer's identity has changed.
   */
  async hasIdentityChanged(
    peerUserId: string,
    currentIdentityKey: string
  ): Promise<boolean> {
    const status = await this.checkIdentityStatus(peerUserId, currentIdentityKey);
    return status.hasStoredIdentity && !status.identityMatches;
  }

  // ==================== CLEANUP ====================

  /**
   * Clear all crypto data (for logout/account deletion).
   */
  async clearAllData(): Promise<void> {
    // Clear localStorage identity keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('railgun_identity_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    this.keyPair = null;
    this.initialized = false;
    this.localUserId = null;
    this.identityStore = null;
    this.peerKeyCache.clear();
    console.log('[DevCrypto] Cleared all data');
  }

  /**
   * CRYPTO-SHRED: Permanently destroy all cryptographic key material.
   * 
   * For DevCrypto, this overwrites localStorage keys with random data
   * before deletion, then zeros in-memory keys.
   * 
   * NOTE: Overwriting localStorage is best-effort. The real guarantee
   * is the destruction of in-memory keys. Storage media may retain data.
   */
  async cryptoShred(): Promise<void> {
    console.log('[DevCrypto] 🔥 CRYPTO-SHRED: Initiating key destruction');
    
    await ensureSodium();
    
    // Find and securely overwrite all identity keys (best-effort)
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('railgun_identity_')) {
        keysToRemove.push(key);
      }
    }
    
    for (const key of keysToRemove) {
      const value = localStorage.getItem(key);
      if (value) {
        // 3 passes of random overwrite
        for (let pass = 0; pass < 3; pass++) {
          const randomData = sodium.randombytes_buf(value.length);
          localStorage.setItem(key, sodium.to_base64(randomData));
        }
        // Zero pass
        localStorage.setItem(key, '0'.repeat(value.length));
        // Remove
        localStorage.removeItem(key);
      }
    }
    
    // Zero in-memory keys
    if (this.keyPair) {
      if (this.keyPair.privateKey) {
        const random = sodium.randombytes_buf(this.keyPair.privateKey.length);
        this.keyPair.privateKey.set(random);
        this.keyPair.privateKey.fill(0);
      }
      if (this.keyPair.publicKey) {
        this.keyPair.publicKey.fill(0);
      }
      this.keyPair = null;
    }
    
    this.initialized = false;
    this.localUserId = null;
    this.identityStore = null;
    this.peerKeyCache.clear();
    
    console.log('[DevCrypto] 🔥 CRYPTO-SHRED complete');
  }

  // ==================== UTILITIES ====================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('DevCrypto not initialized. Call init() first.');
    }
  }

  /**
   * Generate a random message ID.
   */
  generateMessageId(): string {
    if (!sodiumReady) {
      return crypto.randomUUID();
    }
    const bytes = sodium.randombytes_buf(16);
    return sodium.to_hex(bytes);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let cryptoInstance: DevCryptoImpl | null = null;

export function getCrypto(): DevCryptoImpl {
  if (!cryptoInstance) {
    cryptoInstance = new DevCryptoImpl();
  }
  return cryptoInstance;
}

export async function initCrypto(): Promise<void> {
  const crypto = getCrypto();
  await crypto.init();
}

// Export with both names for backwards compatibility
export { DevCryptoImpl };
export { DevCryptoImpl as SimpleCryptoImpl };
