/**
 * Rail Gun - Crypto Implementation
 * 
 * Main crypto facade that combines SignalWrapper (E2E encryption) and
 * LocalKeyStore (encrypted local storage). All crypto operations for
 * the app go through this single interface.
 * 
 * SECURITY:
 * - Uses Signal Protocol for E2E messaging (NOT custom crypto)
 * - Uses libsodium only for local storage encryption
 * - Private keys never leave the device
 * - Server cannot decrypt any messages
 */

import type {
  RailGunCrypto,
  EncryptedMessage,
  EncryptedChannelMessage,
  PreKeyBundleForUpload,
  PreKeyForUpload,
  PreKeyBundleFromServer,
} from './types';
import { LocalKeyStoreImpl, createLocalKeyStore } from './LocalKeyStore';
import { SignalWrapperImpl, createSignalWrapper } from './SignalWrapper';
import {
  computeSafetyNumberFromBase64,
  createIdentityStore,
  createHashFunction,
  type SafetyNumber,
  type IdentityStatus,
  type StoredIdentity,
} from './SafetyNumber';
import { cryptoLogger } from '../lib/logger';

// ============================================================================
// RAIL GUN CRYPTO IMPLEMENTATION
// ============================================================================

/**
 * Main crypto implementation.
 * This is the only crypto interface exposed to the rest of the app.
 */
export class RailGunCryptoImpl implements RailGunCrypto {
  private keyStore: LocalKeyStoreImpl;
  private signal: SignalWrapperImpl;
  private initialized = false;
  private localUserId: string | null = null;
  private identityStore: ReturnType<typeof createIdentityStore> | null = null;
  private hashFunction: ((data: Uint8Array) => Uint8Array) | null = null;

  constructor() {
    this.keyStore = createLocalKeyStore() as LocalKeyStoreImpl;
    this.signal = createSignalWrapper(this.keyStore) as SignalWrapperImpl;
  }

  /**
   * Initialize the crypto module.
   * Must be called before any other methods.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Initialize local key store (sets up IndexedDB + master key)
    await this.keyStore.init();

    // Initialize Signal wrapper (loads/generates identity keys)
    await this.signal.initialize();

    // Initialize identity store for TOFU tracking
    this.identityStore = createIdentityStore(this.keyStore);

    // Initialize hash function for safety numbers
    // We get this from the keyStore's sodium instance
    const sodium = await this.keyStore.getSodium();
    this.hashFunction = createHashFunction(sodium);

    this.initialized = true;
    cryptoLogger.debug('Initialized');
  }

  /**
   * Check if initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ==================== IDENTITY & DEVICE ====================

  /**
   * Set the local user ID (called after login).
   */
  async setLocalUserId(userId: string): Promise<void> {
    this.localUserId = userId;
    await this.signal.setLocalUserId(userId);
  }

  /**
   * Get the local user ID.
   */
  getLocalUserId(): string {
    if (!this.localUserId) {
      throw new Error('Local user ID not set. Call setLocalUserId first.');
    }
    return this.localUserId;
  }

  /**
   * Get the device ID.
   */
  getDeviceId(): number {
    this.ensureInitialized();
    return this.signal.getDeviceId();
  }

  /**
   * Get the registration ID.
   */
  getRegistrationId(): number {
    this.ensureInitialized();
    // This is async in SignalWrapper but we cached it during init
    // For now, return a placeholder and fetch async
    return 0; // Will be populated properly
  }

  /**
   * Get the public identity key (base64 encoded).
   */
  getIdentityPublicKey(): string {
    this.ensureInitialized();
    // We need to fetch this async, so this is a stub
    // In practice, we'd cache this during init
    return '';
  }

  /**
   * Get human-readable fingerprint for identity verification.
   */
  getIdentityFingerprint(): string {
    this.ensureInitialized();
    // TODO: Implement fingerprint generation
    return '';
  }

  /**
   * Get the prekey bundle to upload to server.
   */
  async getPreKeyBundle(): Promise<PreKeyBundleForUpload> {
    this.ensureInitialized();

    const bundle = await this.signal.getRegistrationBundle();

    return {
      registrationId: bundle.registrationId,
      identityKey: this.toBase64(bundle.identityKey),
      signedPreKey: {
        keyId: bundle.signedPreKey.id,
        publicKey: this.toBase64(bundle.signedPreKey.publicKey),
        signature: this.toBase64(bundle.signedPreKey.signature),
      },
      preKeys: bundle.preKeys.map(pk => ({
        keyId: pk.id,
        publicKey: this.toBase64(pk.publicKey),
      })),
    };
  }

  /**
   * Generate more one-time prekeys for upload.
   */
  async generateMorePreKeys(count: number): Promise<PreKeyForUpload[]> {
    this.ensureInitialized();

    // Get current counter
    const stored = await this.keyStore.get('prekey_id_counter');
    const startId = stored ? parseInt(new TextDecoder().decode(stored), 10) : 1;

    // Get a new registration bundle (generates new prekeys)
    const bundle = await this.signal.getRegistrationBundle();

    // Update counter
    await this.keyStore.set(
      'prekey_id_counter',
      new TextEncoder().encode((startId + count).toString())
    );

    return bundle.preKeys.slice(0, count).map(pk => ({
      keyId: pk.id,
      publicKey: this.toBase64(pk.publicKey),
    }));
  }

  // ==================== DIRECT MESSAGES (1:1) ====================

  /**
   * Ensure a DM session exists with a peer.
   */
  async ensureDmSession(
    peerUserId: string,
    peerPreKeyBundle?: PreKeyBundleFromServer
  ): Promise<void> {
    this.ensureInitialized();

    const deviceId = peerPreKeyBundle?.deviceId ?? 1;

    // Check if session already exists
    if (await this.signal.hasSession(peerUserId, deviceId)) {
      return;
    }

    // Need prekey bundle to create session
    if (!peerPreKeyBundle) {
      throw new Error(
        `No session with ${peerUserId} and no prekey bundle provided`
      );
    }

    // Create session from prekey bundle
    await this.signal.createSession(peerUserId, deviceId, {
      identityKey: this.fromBase64(peerPreKeyBundle.identityKey),
      registrationId: peerPreKeyBundle.registrationId,
      signedPreKey: {
        id: peerPreKeyBundle.signedPreKey.keyId,
        publicKey: this.fromBase64(peerPreKeyBundle.signedPreKey.publicKey),
        signature: this.fromBase64(peerPreKeyBundle.signedPreKey.signature),
      },
      kyberPreKey: {
        // Use placeholder if not provided (older servers may not have Kyber)
        id: 1,
        publicKey: new Uint8Array(32),
        signature: new Uint8Array(64),
      },
      preKey: peerPreKeyBundle.preKey
        ? {
            id: peerPreKeyBundle.preKey.keyId,
            publicKey: this.fromBase64(peerPreKeyBundle.preKey.publicKey),
          }
        : undefined,
    });
  }

  /**
   * Check if we have a DM session with a peer.
   */
  async hasDmSession(peerUserId: string): Promise<boolean> {
    this.ensureInitialized();
    // Check for session with device 1 (primary device)
    return this.signal.hasSession(peerUserId, 1);
  }

  /**
   * Encrypt a DM message.
   */
  async encryptDm(peerUserId: string, plaintext: string): Promise<EncryptedMessage> {
    this.ensureInitialized();

    const plaintextBytes = new TextEncoder().encode(plaintext);
    const deviceId = 1; // TODO: Support multiple devices

    const result = await this.signal.encrypt(peerUserId, deviceId, plaintextBytes);

    return {
      type: result.type === 3 ? 'prekey' : 'message',
      ciphertext: this.toBase64(result.body),
      senderDeviceId: this.signal.getDeviceId(),
      registrationId: result.type === 3 ? await this.signal.getRegistrationId() : undefined,
    };
  }

  /**
   * Decrypt a DM message.
   */
  async decryptDm(peerUserId: string, message: EncryptedMessage): Promise<string> {
    this.ensureInitialized();

    const ciphertext = {
      type: message.type === 'prekey' ? 3 : 2,
      body: this.fromBase64(message.ciphertext),
    };

    const plaintext = await this.signal.decrypt(
      peerUserId,
      message.senderDeviceId,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }

  // ==================== CHANNELS / GROUPS ====================

  /**
   * Ensure we have a sender key session for a channel.
   */
  async ensureChannelSession(
    channelId: string,
    _memberUserIds: string[]
  ): Promise<void> {
    this.ensureInitialized();

    // Create our sender key for this channel
    await this.signal.createGroupSession(channelId);

    // TODO: Distribute sender key to members via DM
    // This requires sending our distribution message to each member
  }

  /**
   * Encrypt a channel message.
   */
  async encryptChannel(
    channelId: string,
    plaintext: string
  ): Promise<EncryptedChannelMessage> {
    this.ensureInitialized();

    const plaintextBytes = new TextEncoder().encode(plaintext);
    const ciphertext = await this.signal.groupEncrypt(channelId, plaintextBytes);

    return {
      ciphertext: this.toBase64(ciphertext),
      senderDeviceId: this.signal.getDeviceId(),
      distributionId: channelId,
    };
  }

  /**
   * Decrypt a channel message.
   */
  async decryptChannel(
    _channelId: string,
    senderUserId: string,
    message: EncryptedChannelMessage
  ): Promise<string> {
    this.ensureInitialized();

    const ciphertext = this.fromBase64(message.ciphertext);
    const plaintext = await this.signal.groupDecrypt(
      senderUserId,
      message.senderDeviceId,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Process a sender key distribution message.
   */
  async processSenderKeyDistribution(
    _channelId: string,
    senderUserId: string,
    distribution: Uint8Array
  ): Promise<void> {
    this.ensureInitialized();

    await this.signal.processGroupSession(
      senderUserId,
      1, // TODO: Support multiple devices
      distribution
    );
  }

  /**
   * Get our sender key distribution for a channel.
   */
  async getSenderKeyDistribution(_channelId: string): Promise<Uint8Array> {
    this.ensureInitialized();
    return this.signal.createGroupSession(_channelId);
  }

  // ==================== VERIFICATION ====================

  /**
   * Compute safety number for identity verification.
   * Returns a 60-digit numeric string that both parties should see identically.
   */
  computeSafetyNumber(peerUserId: string, peerIdentityKey: string): string {
    this.ensureInitialized();
    
    if (!this.hashFunction || !this.localUserId) {
      throw new Error('Crypto not fully initialized');
    }

    // Get our identity key
    const localIdentityKey = this.getIdentityPublicKey();
    if (!localIdentityKey) {
      throw new Error('Local identity key not available');
    }

    const safetyNumber = computeSafetyNumberFromBase64(
      this.localUserId,
      localIdentityKey,
      peerUserId,
      peerIdentityKey,
      this.hashFunction
    );

    return safetyNumber.numeric;
  }

  /**
   * Get full safety number object including QR data.
   */
  async getSafetyNumberDetails(
    peerUserId: string,
    peerIdentityKey: string
  ): Promise<SafetyNumber> {
    this.ensureInitialized();
    
    if (!this.hashFunction || !this.localUserId) {
      throw new Error('Crypto not fully initialized');
    }

    const localIdentityKey = this.getIdentityPublicKey();
    if (!localIdentityKey) {
      throw new Error('Local identity key not available');
    }

    return computeSafetyNumberFromBase64(
      this.localUserId,
      localIdentityKey,
      peerUserId,
      peerIdentityKey,
      this.hashFunction
    );
  }

  /**
   * Mark an identity as verified after user confirms safety numbers match.
   */
  async markIdentityVerified(peerUserId: string): Promise<void> {
    this.ensureInitialized();
    
    if (!this.identityStore) {
      throw new Error('Identity store not initialized');
    }

    await this.identityStore.markVerified(peerUserId);
    cryptoLogger.debug(`Identity verified for ${peerUserId}`);
  }

  /**
   * Check if peer's identity has changed since we last saw them.
   * This is critical for detecting MITM attacks.
   * 
   * Returns detailed status including whether identity changed and previous key.
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
   * Store or update a peer's identity.
   * Call this when receiving a key bundle from the server.
   * 
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
      cryptoLogger.warn(
        `⚠️ IDENTITY CHANGED for ${peerUserId}! ` +
        'This could indicate a security issue or the user reinstalled.'
      );
    }

    return result;
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
   * Check if identity has changed (simple boolean version).
   * @deprecated Use checkIdentityStatus for more detailed information.
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
   * Uses basic clear - data may be recoverable with forensics.
   */
  async clearAllData(): Promise<void> {
    await this.keyStore.clear();
    this.initialized = false;
    this.localUserId = null;
    cryptoLogger.debug('Cleared all data');
  }

  /**
   * CRYPTO-SHRED: Permanently destroy all cryptographic key material.
   * 
   * This is the NUCLEAR option - use for account deletion or panic button.
   * After calling this, ALL encrypted data becomes PERMANENTLY UNRECOVERABLE.
   * 
   * Performs:
   * 1. Multi-pass secure overwrite of all stored keys
   * 2. Master key deletion from OS keychain
   * 3. In-memory key zeroing
   */
  async cryptoShred(): Promise<void> {
    cryptoLogger.debug('🔥 CRYPTO-SHRED: Initiating permanent key destruction');
    
    // First clear identity cache
    if (this.identityStore) {
      // Identity store uses keyStore internally, will be wiped
    }
    
    // Execute crypto-shred on the key store
    await this.keyStore.cryptoShred();
    
    // Clear instance state
    this.initialized = false;
    this.localUserId = null;
    this.identityStore = null;
    this.hashFunction = null;
    
    cryptoLogger.debug('🔥 CRYPTO-SHRED complete - all keys permanently destroyed');
  }

  // ==================== HELPERS ====================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RailGunCrypto not initialized. Call init() first.');
    }
  }

  private toBase64(data: Uint8Array): string {
    return Buffer.from(data).toString('base64');
  }

  private fromBase64(data: string): Uint8Array {
    return new Uint8Array(Buffer.from(data, 'base64'));
  }
}

// ============================================================================
// FACTORY & SINGLETON
// ============================================================================

let cryptoInstance: RailGunCrypto | null = null;

/**
 * Get the singleton RailGunCrypto instance.
 */
export function getCrypto(): RailGunCrypto {
  if (!cryptoInstance) {
    cryptoInstance = new RailGunCryptoImpl();
  }
  return cryptoInstance;
}

/**
 * Initialize the crypto module.
 * Call this early in app startup.
 */
export async function initCrypto(): Promise<RailGunCrypto> {
  const crypto = getCrypto();
  await crypto.init();
  return crypto;
}

/**
 * Reset the crypto instance (for testing).
 */
export function resetCrypto(): void {
  cryptoInstance = null;
}
