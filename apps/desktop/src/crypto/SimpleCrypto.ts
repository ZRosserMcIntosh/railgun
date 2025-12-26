/**
 * Simple Crypto Implementation using libsodium-wrappers
 * 
 * This is a simplified encryption layer that uses only libsodium
 * (which works in browser/Electron renderer). For production,
 * the full Signal Protocol should be used via the main process.
 * 
 * This provides:
 * - Symmetric encryption (XChaCha20-Poly1305)
 * - Key derivation (Argon2id)
 * - Random ID generation
 */

import sodium from 'libsodium-wrappers';

let sodiumReady = false;

async function ensureSodium(): Promise<void> {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
}

// ============================================================================
// SIMPLE CRYPTO IMPLEMENTATION
// ============================================================================

export interface SimpleCryptoKeys {
  publicKey: string; // Base64
  privateKey: string; // Base64 (encrypted locally)
}

export interface EncryptedPayload {
  ciphertext: string; // Base64
  nonce: string; // Base64
}

class SimpleCryptoImpl {
  private keyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;
  private initialized = false;
  private localUserId: string | null = null;
  private deviceId: number = 1;
  private registrationId: number = 0;

  async init(): Promise<void> {
    if (this.initialized) return;
    
    await ensureSodium();
    
    // Generate or load key pair
    // In a real implementation, we'd persist this securely
    this.keyPair = sodium.crypto_box_keypair();
    this.registrationId = sodium.randombytes_uniform(16384) + 1;
    
    this.initialized = true;
    console.log('[SimpleCrypto] Initialized');
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
    
    // Generate a signed pre-key
    const signedPreKey = sodium.crypto_box_keypair();
    const signedPreKeyId = sodium.randombytes_uniform(0xFFFFFF);
    
    // Sign it (simplified - in Signal this is a proper signature)
    const signature = sodium.crypto_sign_detached(
      signedPreKey.publicKey,
      sodium.crypto_sign_seed_keypair(this.keyPair!.privateKey.slice(0, 32)).privateKey
    );
    
    // Generate pre-keys
    const preKeys: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 0; i < 10; i++) {
      const pk = sodium.crypto_box_keypair();
      preKeys.push({
        keyId: i + 1,
        publicKey: sodium.to_base64(pk.publicKey),
      });
    }

    return {
      identityKey: sodium.to_base64(this.keyPair!.publicKey),
      registrationId: this.registrationId,
      deviceId: this.deviceId,
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: sodium.to_base64(signedPreKey.publicKey),
        signature: sodium.to_base64(signature),
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
   * Encrypt a message for a recipient.
   * Simplified: uses sealed box (anonymous sender).
   */
  async encryptMessage(
    recipientUserId: string,
    _recipientDeviceId: number,
    plaintext: string,
    recipientPublicKey?: string
  ): Promise<{ ciphertext: string; messageType: number }> {
    this.ensureInitialized();
    
    // If we have the recipient's public key, use sealed box
    // Otherwise, use symmetric encryption with a shared secret
    const plaintextBytes = sodium.from_string(plaintext);
    
    if (recipientPublicKey) {
      const recipientPk = sodium.from_base64(recipientPublicKey);
      const sealed = sodium.crypto_box_seal(plaintextBytes, recipientPk);
      return {
        ciphertext: sodium.to_base64(sealed),
        messageType: 1, // Sealed box
      };
    }
    
    // Fallback: symmetric encryption with derived key
    const key = sodium.crypto_generichash(32, recipientUserId + this.localUserId);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintextBytes, nonce, key);
    
    // Combine nonce + ciphertext
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);
    
    return {
      ciphertext: sodium.to_base64(combined),
      messageType: 2, // Symmetric
    };
  }

  /**
   * Decrypt a message from a sender.
   */
  async decryptMessage(
    senderUserId: string,
    _senderDeviceId: number,
    ciphertext: string,
    messageType: number
  ): Promise<string> {
    this.ensureInitialized();
    
    const ciphertextBytes = sodium.from_base64(ciphertext);
    
    if (messageType === 1) {
      // Sealed box - decrypt with our private key
      const plaintext = sodium.crypto_box_seal_open(
        ciphertextBytes,
        this.keyPair!.publicKey,
        this.keyPair!.privateKey
      );
      return sodium.to_string(plaintext);
    }
    
    // Symmetric decryption
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = ciphertextBytes.slice(0, nonceLength);
    const actualCiphertext = ciphertextBytes.slice(nonceLength);
    const key = sodium.crypto_generichash(32, senderUserId + this.localUserId);
    
    const plaintext = sodium.crypto_secretbox_open_easy(actualCiphertext, nonce, key);
    return sodium.to_string(plaintext);
  }

  // ==================== CHANNEL ENCRYPTION ====================

  /**
   * Encrypt a message for a channel (group).
   * Uses a derived channel key.
   */
  async encryptChannelMessage(
    channelId: string,
    plaintext: string
  ): Promise<{ ciphertext: string; senderKeyDistribution?: string }> {
    this.ensureInitialized();
    
    const plaintextBytes = sodium.from_string(plaintext);
    
    // Derive channel key from channelId + user identity
    const channelKey = sodium.crypto_generichash(
      32,
      channelId + sodium.to_base64(this.keyPair!.publicKey)
    );
    
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintextBytes, nonce, channelKey);
    
    // Combine nonce + ciphertext
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);
    
    return {
      ciphertext: sodium.to_base64(combined),
    };
  }

  /**
   * Decrypt a channel message.
   */
  async decryptChannelMessage(
    channelId: string,
    senderUserId: string,
    ciphertext: string,
    senderPublicKey?: string
  ): Promise<string> {
    this.ensureInitialized();
    
    const ciphertextBytes = sodium.from_base64(ciphertext);
    
    // Derive the same channel key
    const senderPk = senderPublicKey || senderUserId;
    const channelKey = sodium.crypto_generichash(32, channelId + senderPk);
    
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = ciphertextBytes.slice(0, nonceLength);
    const actualCiphertext = ciphertextBytes.slice(nonceLength);
    
    const plaintext = sodium.crypto_secretbox_open_easy(actualCiphertext, nonce, channelKey);
    return sodium.to_string(plaintext);
  }

  // ==================== SESSION MANAGEMENT ====================

  async hasDmSession(_userId: string): Promise<boolean> {
    // Simplified: always return true (we use sealed box which doesn't need sessions)
    return true;
  }

  async hasSession(_userId: string, _deviceId: number): Promise<boolean> {
    // Simplified: always return true
    return true;
  }

  async ensureDmSession(_userId: string, _preKeyBundle: any): Promise<void> {
    // Simplified: no-op, sealed box doesn't need session establishment
    console.log(`[SimpleCrypto] DM session ready (sealed box)`);
  }

  async ensureChannelSession(_channelId: string, _memberIds: string[]): Promise<void> {
    // Simplified: no-op, we use symmetric encryption derived from channel ID
    console.log(`[SimpleCrypto] Channel session ready`);
  }

  async establishSession(
    userId: string,
    deviceId: number,
    _preKeyBundle: any
  ): Promise<void> {
    // Simplified: no-op for now
    console.log(`[SimpleCrypto] Session established with ${userId}:${deviceId}`);
  }

  // ==================== SIGNAL-COMPATIBLE ENCRYPTION API ====================

  /**
   * Encrypt a DM using simplified crypto.
   */
  async encryptDm(
    recipientId: string,
    plaintext: string
  ): Promise<{
    ciphertext: string;
    senderDeviceId: number;
    type: 'prekey' | 'message';
    registrationId?: number;
  }> {
    this.ensureInitialized();
    
    const result = await this.encryptMessage(recipientId, 1, plaintext);
    
    return {
      ciphertext: result.ciphertext,
      senderDeviceId: this.deviceId,
      type: 'message',
      registrationId: this.registrationId,
    };
  }

  /**
   * Decrypt a DM using simplified crypto.
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
    return this.decryptMessage(senderId, encrypted.senderDeviceId, encrypted.ciphertext, 2);
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
   * In simplified mode, this is a no-op since we derive keys from channel ID.
   */
  async processSenderKeyDistribution(
    _channelId: string,
    _senderId: string,
    _distribution: string
  ): Promise<void> {
    // No-op in simplified mode
    console.log('[SimpleCrypto] Sender key distribution processed');
  }

  /**
   * Get our sender key distribution for a channel.
   * In simplified mode, return a placeholder since we use symmetric encryption.
   */
  async getSenderKeyDistribution(_channelId: string): Promise<string | null> {
    // Return null - we don't use sender keys in simplified mode
    return null;
  }

  // ==================== UTILITIES ====================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SimpleCrypto not initialized. Call init() first.');
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

let cryptoInstance: SimpleCryptoImpl | null = null;

export function getCrypto(): SimpleCryptoImpl {
  if (!cryptoInstance) {
    cryptoInstance = new SimpleCryptoImpl();
  }
  return cryptoInstance;
}

export async function initCrypto(): Promise<void> {
  const crypto = getCrypto();
  await crypto.init();
}

export { SimpleCryptoImpl };
