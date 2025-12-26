/**
 * Rail Gun - Crypto Module
 * 
 * This module provides end-to-end encryption for Rail Gun.
 * 
 * Currently using SimpleCrypto (libsodium-only) for browser compatibility.
 * For production with full Signal Protocol, the crypto operations should
 * be moved to the Electron main process via IPC.
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

// Use SimpleCrypto (libsodium-only) for browser/renderer compatibility
// The full Signal Protocol implementation requires running in Electron main process
export { getCrypto, initCrypto, SimpleCryptoImpl } from './SimpleCrypto';

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
