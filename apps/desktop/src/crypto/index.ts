/**
 * Rail Gun - Crypto Module
 * 
 * This module provides end-to-end encryption for Rail Gun.
 * 
 * ARCHITECTURE:
 * - In Electron: Uses IPC to communicate with main process where Signal Protocol runs
 * - In Browser: Falls back to SimpleCrypto (libsodium sealed boxes, no forward secrecy)
 * 
 * The full Signal Protocol with Double Ratchet requires native modules that
 * can only run in Electron's main process, not in the renderer.
 * 
 * Usage:
 * ```typescript
 * import { initCrypto, getCrypto } from './crypto';
 * 
 * // Initialize on app startup
 * await initCrypto();
 * 
 * // Get crypto instance
 * const crypto = getCrypto();
 * 
 * // Set user ID after login
 * await crypto.setLocalUserId(userId);
 * ```
 */

import { createLogger } from '../lib/logger';

const logger = createLogger('Crypto');

import type {
  RailGunCrypto,
  EncryptedMessage,
  EncryptedChannelMessage,
  PreKeyBundleForUpload,
  PreKeyBundleFromServer,
} from './types';

// Check if running in Electron with crypto IPC available
function isElectronWithCrypto(): boolean {
  return typeof window !== 'undefined' &&
         typeof window.electronAPI !== 'undefined' &&
         typeof window.electronAPI.crypto !== 'undefined';
}

/**
 * Electron IPC-based crypto implementation.
 * Delegates all operations to the main process via IPC.
 */
class ElectronCryptoImpl implements RailGunCrypto {
  private initialized = false;
  private localUserId: string | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    
    const result = await window.electronAPI.crypto.init();
    
    // If Signal native module isn't available, we need to signal fallback
    if (!result.success && result.useSimpleCrypto) {
      logger.warn('Signal not available, using SimpleCrypto fallback');
      throw new Error('USE_SIMPLE_CRYPTO');
    }
    
    if (!result.success) {
      throw new Error('Failed to initialize crypto in main process');
    }
    
    this.initialized = true;
    logger.debug('Initialized via IPC');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async setLocalUserId(userId: string): Promise<void> {
    this.localUserId = userId;
    await window.electronAPI.crypto.setLocalUserId(userId);
  }

  getLocalUserId(): string {
    if (!this.localUserId) {
      throw new Error('Local user ID not set');
    }
    return this.localUserId;
  }

  getDeviceId(): number {
    // This is sync in the interface but we need async IPC
    // For now return 1, the async version should be used
    return 1;
  }

  async setDeviceId(deviceId: number): Promise<void> {
    // TODO: Implement via IPC to persist deviceId
    logger.debug('setDeviceId:', deviceId);
  }

  getRegistrationId(): number {
    return 0; // Use async version
  }

  getIdentityPublicKey(): string {
    return ''; // Use async version
  }

  getIdentityFingerprint(): string {
    return ''; // Use async version
  }

  async getPreKeyBundle(): Promise<PreKeyBundleForUpload> {
    const bundle = await window.electronAPI.crypto.getPreKeyBundle();
    return bundle as PreKeyBundleForUpload;
  }

  async generateMorePreKeys(_count: number): Promise<Array<{ keyId: number; publicKey: string }>> {
    // TODO: Implement via IPC
    logger.warn('generateMorePreKeys not yet implemented');
    return [];
  }

  async ensureDmSession(_peerUserId: string, _peerPreKeyBundle?: PreKeyBundleFromServer): Promise<void> {
    // TODO: Implement full session management via IPC
    logger.debug('ensureDmSession');
  }

  async hasDmSession(_peerUserId: string, _deviceId?: number): Promise<boolean> {
    // TODO: Implement via IPC
    return true;
  }

  async encryptDm(peerUserId: string, plaintext: string, _targetDeviceId?: number): Promise<EncryptedMessage> {
    const result = await window.electronAPI.crypto.encryptDm(peerUserId, plaintext);
    return result as EncryptedMessage;
  }

  async encryptDmForDevices(
    peerUserId: string,
    plaintext: string,
    deviceIds: number[]
  ): Promise<Array<{ deviceId: number; envelope: EncryptedMessage }>> {
    // Encrypt for each device
    const results: Array<{ deviceId: number; envelope: EncryptedMessage }> = [];
    for (const deviceId of deviceIds) {
      try {
        const envelope = await this.encryptDm(peerUserId, plaintext, deviceId);
        results.push({ deviceId, envelope });
      } catch (error) {
        logger.warn(`Failed to encrypt for device ${deviceId}:`, error);
      }
    }
    return results;
  }

  async decryptDm(peerUserId: string, message: EncryptedMessage): Promise<string> {
    return await window.electronAPI.crypto.decryptDm(peerUserId, message);
  }

  async ensureChannelSession(channelId: string, _memberUserIds: string[]): Promise<void> {
    // TODO: Implement channel encryption via IPC
    logger.debug('ensureChannelSession:', channelId);
  }

  async encryptChannel(channelId: string, plaintext: string): Promise<EncryptedChannelMessage> {
    // TODO: Implement via IPC - for now return plaintext marker
    logger.warn('Channel encryption not yet implemented');
    return {
      ciphertext: Buffer.from(plaintext).toString('base64'),
      senderDeviceId: 1,
      distributionId: channelId,
    };
  }

  async decryptChannel(_channelId: string, _senderUserId: string, message: EncryptedChannelMessage): Promise<string> {
    // TODO: Implement via IPC
    return Buffer.from(message.ciphertext, 'base64').toString('utf-8');
  }

  async processSenderKeyDistribution(_channelId: string, _senderUserId: string, _distribution: Uint8Array): Promise<void> {
    // TODO: Implement via IPC
  }

  async getSenderKeyDistribution(_channelId: string): Promise<Uint8Array> {
    // TODO: Implement via IPC
    return new Uint8Array(0);
  }

  computeSafetyNumber(_peerUserId: string, _peerIdentityKey: string): string {
    // TODO: Implement via IPC
    return '';
  }

  async getSafetyNumberDetails(_peerUserId: string, _peerIdentityKey: string): Promise<unknown> {
    // TODO: Implement via IPC
    return {};
  }

  async markIdentityVerified(_peerUserId: string): Promise<void> {
    // TODO: Implement via IPC
  }

  async checkIdentityStatus(_peerUserId: string, _currentIdentityKey: string): Promise<unknown> {
    // TODO: Implement via IPC
    return { hasStoredIdentity: false };
  }

  async storeIdentity(_peerUserId: string, _identityKey: string): Promise<{ isNew: boolean; hasChanged: boolean }> {
    // TODO: Implement via IPC
    return { isNew: true, hasChanged: false };
  }

  async getStoredIdentity(_peerUserId: string): Promise<unknown> {
    // TODO: Implement via IPC
    return null;
  }

  async hasIdentityChanged(_peerUserId: string, _currentIdentityKey: string): Promise<boolean> {
    // TODO: Implement via IPC
    return false;
  }

  async clearAllData(): Promise<void> {
    await window.electronAPI.crypto.clearAllData();
    this.initialized = false;
    this.localUserId = null;
  }

  async cryptoShred(): Promise<void> {
    await window.electronAPI.crypto.cryptoShred();
    this.initialized = false;
    this.localUserId = null;
  }
}

// Import SimpleCrypto as fallback for browser
import { getCrypto as getSimpleCrypto } from './SimpleCrypto';

// Singleton instance
let cryptoInstance: RailGunCrypto | null = null;
let useSimpleCryptoFallback = false;

/**
 * Check if running in Electron with Signal available
 */
async function checkSignalAvailable(): Promise<boolean> {
  if (!isElectronWithCrypto()) return false;
  try {
    const available = await window.electronAPI.crypto.isSignalAvailable();
    logger.debug('Signal native module available:', available);
    return available;
  } catch (err) {
    logger.warn('Failed to check Signal availability:', err);
    return false;
  }
}

/**
 * Get the singleton crypto instance.
 * Uses IPC-based implementation in Electron with Signal, SimpleCrypto otherwise.
 * 
 * IMPORTANT: When Signal native module is not available, SimpleCrypto is used
 * which provides real encryption (libsodium sealed boxes) but no forward secrecy.
 */
export function getCrypto(): RailGunCrypto {
  if (!cryptoInstance) {
    // Always use SimpleCrypto if:
    // 1. Not in Electron, or
    // 2. Signal fallback was requested, or  
    // 3. Running in Electron but Signal unavailable
    if (!isElectronWithCrypto() || useSimpleCryptoFallback) {
      logger.debug('Using SimpleCrypto (libsodium sealed boxes)');
      cryptoInstance = getSimpleCrypto() as unknown as RailGunCrypto;
    } else {
      // This path is only used when Signal IS available in Electron
      logger.debug('Using Electron IPC-based crypto (Signal Protocol)');
      cryptoInstance = new ElectronCryptoImpl();
    }
  }
  return cryptoInstance!;
}

/**
 * Initialize the crypto module.
 */
export async function initCrypto(): Promise<RailGunCrypto> {
  // Check if Signal is available first
  if (isElectronWithCrypto()) {
    const signalAvailable = await checkSignalAvailable();
    if (!signalAvailable) {
      logger.warn('Signal native module not available, using SimpleCrypto');
      useSimpleCryptoFallback = true;
      cryptoInstance = null; // Reset to use SimpleCrypto
    }
  }
  
  const crypto = getCrypto();
  
  try {
    await crypto.init();
  } catch (err) {
    if (err instanceof Error && err.message === 'USE_SIMPLE_CRYPTO') {
      logger.warn('Falling back to SimpleCrypto');
      useSimpleCryptoFallback = true;
      cryptoInstance = null;
      const fallback = getCrypto();
      await fallback.init();
      return fallback;
    }
    throw err;
  }
  
  return crypto;
}

/**
 * Reset crypto instance (for testing).
 */
export function resetCrypto(): void {
  cryptoInstance = null;
}

// Re-export for backwards compatibility
export { SimpleCryptoImpl, DevCryptoImpl } from './SimpleCrypto';

// Types (exported for use by other modules)
export type {
  RailGunCrypto,
  EncryptedMessage,
  EncryptedChannelMessage,
  PreKeyBundleForUpload,
  PreKeyForUpload,
  PreKeyBundleFromServer,
} from './types';

// Internal types (for testing/debugging only)
export type { LocalKeyStore, SignalWrapper } from './types';

// Storage key constants
export { STORAGE_KEYS } from './types';

// Safety number types and utilities
export type {
  SafetyNumber,
  IdentityStatus,
  StoredIdentity,
} from './SafetyNumber';

export {
  computeSafetyNumber,
  computeSafetyNumberFromBase64,
  formatSafetyNumber,
  getSafetyNumberQRData,
  verifySafetyNumberQR,
  createIdentityStore,
  createHashFunction,
} from './SafetyNumber';
