/**
 * Rail Gun - Local Key Store
 * 
 * Secure local storage for cryptographic keys and session state.
 * Uses libsodium XChaCha20-Poly1305 for encryption at rest.
 * Master key is protected by Electron's safeStorage (OS keychain).
 * 
 * SECURITY:
 * - All data is encrypted before storage
 * - Master key never stored in plaintext
 * - Uses OS keychain for master key protection
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="libsodium-wrappers" />
import type libsodium from 'libsodium-wrappers';
import type { LocalKeyStore } from './types';

// libsodium type alias
type SodiumType = typeof libsodium;

// Will be dynamically imported
let sodium: SodiumType | null = null;

/**
 * Initialize libsodium.
 * Called once during LocalKeyStore initialization.
 */
async function initSodium(): Promise<SodiumType> {
  if (sodium) return sodium;
  
  // Dynamic import to handle ESM/CJS
  const sodiumModule = await import('libsodium-wrappers');
  await sodiumModule.default.ready;
  sodium = sodiumModule.default as unknown as SodiumType;
  return sodium;
}

/**
 * LocalKeyStore implementation using IndexedDB + libsodium encryption.
 * 
 * Storage structure:
 * - IndexedDB stores encrypted blobs
 * - Each value is encrypted with XChaCha20-Poly1305
 * - Master key is derived from a secret stored in Electron safeStorage
 */
export class LocalKeyStoreImpl implements LocalKeyStore {
  private db: IDBDatabase | null = null;
  private masterKey: Uint8Array | null = null;
  private initialized = false;

  private static readonly DB_NAME = 'railgun-keystore';
  private static readonly DB_VERSION = 1;
  private static readonly STORE_NAME = 'keys';
  private static readonly MASTER_KEY_ID = 'railgun-master-key';

  /**
   * Initialize the key store.
   * - Opens/creates IndexedDB
   * - Retrieves or generates master key via Electron safeStorage
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Initialize libsodium
    const s = await initSodium();

    // Get or create master key
    this.masterKey = await this.getOrCreateMasterKey(s);

    // Open IndexedDB
    this.db = await this.openDatabase();

    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the initialized sodium instance.
   * Used by other crypto modules that need sodium functions.
   */
  async getSodium(): Promise<SodiumType> {
    if (!sodium) {
      await initSodium();
    }
    return sodium!;
  }

  /**
   * Get a value from the store.
   */
  async get(key: string): Promise<Uint8Array | null> {
    this.ensureInitialized();

    const encryptedData = await this.readFromDb(key);
    if (!encryptedData) return null;

    return this.decrypt(encryptedData);
  }

  /**
   * Set a value in the store.
   */
  async set(key: string, value: Uint8Array): Promise<void> {
    this.ensureInitialized();

    const encryptedData = this.encrypt(value);
    await this.writeToDb(key, encryptedData);
  }

  /**
   * Delete a value from the store.
   */
  async delete(key: string): Promise<void> {
    this.ensureInitialized();
    await this.deleteFromDb(key);
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<boolean> {
    this.ensureInitialized();
    const value = await this.readFromDb(key);
    return value !== null;
  }

  /**
   * List all keys with a given prefix.
   */
  async listKeys(prefix: string): Promise<string[]> {
    this.ensureInitialized();
    return this.listKeysFromDb(prefix);
  }

  /**
   * Clear all data from the store.
   */
  async clear(): Promise<void> {
    this.ensureInitialized();
    await this.clearDb();
  }

  // ==================== PRIVATE METHODS ====================

  private ensureInitialized(): void {
    if (!this.initialized || !this.masterKey || !this.db) {
      throw new Error('LocalKeyStore not initialized. Call init() first.');
    }
  }

  /**
   * Get or create the master encryption key.
   * Uses Electron's safeStorage to protect the key via OS keychain.
   */
  private async getOrCreateMasterKey(s: SodiumType): Promise<Uint8Array> {
    // Check if we're in Electron environment
    if (typeof window !== 'undefined' && window.electronAPI?.secureStore) {
      // Try to get existing master key from secure storage
      const storedKey = await window.electronAPI.secureStore.get(
        LocalKeyStoreImpl.MASTER_KEY_ID
      );

      if (storedKey) {
        // Decode the stored base64 key
        return s.from_base64(storedKey);
      }

      // Generate new master key
      const newKey = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);

      // Store in secure storage
      await window.electronAPI.secureStore.set(
        LocalKeyStoreImpl.MASTER_KEY_ID,
        s.to_base64(newKey)
      );

      return newKey;
    } else {
      // Fallback for non-Electron environment (dev/testing)
      // WARNING: This is NOT secure for production
      console.warn('Running outside Electron - using insecure key storage');
      
      const storedKey = localStorage.getItem(LocalKeyStoreImpl.MASTER_KEY_ID);
      if (storedKey) {
        return s.from_base64(storedKey);
      }

      const newKey = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
      localStorage.setItem(LocalKeyStoreImpl.MASTER_KEY_ID, s.to_base64(newKey));
      return newKey;
    }
  }

  /**
   * Encrypt data using XChaCha20-Poly1305.
   */
  private encrypt(plaintext: Uint8Array): Uint8Array {
    if (!sodium || !this.masterKey) {
      throw new Error('Sodium or master key not initialized');
    }

    // Generate random nonce
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);

    // Encrypt
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      null, // no additional data
      null, // secret nonce (not used)
      nonce,
      this.masterKey
    );

    // Prepend nonce to ciphertext
    const result = new Uint8Array(nonce.length + ciphertext.length);
    result.set(nonce, 0);
    result.set(ciphertext, nonce.length);

    return result;
  }

  /**
   * Decrypt data using XChaCha20-Poly1305.
   */
  private decrypt(encryptedData: Uint8Array): Uint8Array {
    if (!sodium || !this.masterKey) {
      throw new Error('Sodium or master key not initialized');
    }

    const nonceLength = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;

    // Extract nonce and ciphertext
    const nonce = encryptedData.slice(0, nonceLength);
    const ciphertext = encryptedData.slice(nonceLength);

    // Decrypt
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, // secret nonce (not used)
      ciphertext,
      null, // no additional data
      nonce,
      this.masterKey
    );
  }

  /**
   * Open IndexedDB database.
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        LocalKeyStoreImpl.DB_NAME,
        LocalKeyStoreImpl.DB_VERSION
      );

      request.onerror = () => reject(request.error);

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(LocalKeyStoreImpl.STORE_NAME)) {
          db.createObjectStore(LocalKeyStoreImpl.STORE_NAME);
        }
      };
    });
  }

  /**
   * Read encrypted data from IndexedDB.
   */
  private readFromDb(key: string): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(LocalKeyStoreImpl.STORE_NAME, 'readonly');
      const store = transaction.objectStore(LocalKeyStoreImpl.STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result instanceof Uint8Array) {
          resolve(result);
        } else if (result) {
          // Handle ArrayBuffer
          resolve(new Uint8Array(result));
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * Write encrypted data to IndexedDB.
   */
  private writeToDb(key: string, value: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(LocalKeyStoreImpl.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(LocalKeyStoreImpl.STORE_NAME);
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Delete from IndexedDB.
   */
  private deleteFromDb(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(LocalKeyStoreImpl.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(LocalKeyStoreImpl.STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * List keys with prefix from IndexedDB.
   */
  private listKeysFromDb(prefix: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(LocalKeyStoreImpl.STORE_NAME, 'readonly');
      const store = transaction.objectStore(LocalKeyStoreImpl.STORE_NAME);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const allKeys = request.result as string[];
        const filteredKeys = allKeys.filter((key) =>
          typeof key === 'string' && key.startsWith(prefix)
        );
        resolve(filteredKeys);
      };
    });
  }

  /**
   * Clear all data from IndexedDB.
   */
  private clearDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction(LocalKeyStoreImpl.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(LocalKeyStoreImpl.STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * CRYPTO-SHRED: Securely destroy all key material.
   * 
   * The REAL security here is destroying the encryption keys - without them,
   * the ciphertext is useless. Storage deletion is defense-in-depth.
   * 
   * Steps:
   * 1. Overwrites stored ciphertext (best-effort, may not defeat SSD wear leveling)
   * 2. Deletes IndexedDB database
   * 3. Deletes the master key from OS keychain (THIS IS THE CRITICAL STEP)
   * 4. Zeros in-memory key material
   * 
   * SECURITY NOTE: Multi-pass overwrite is largely ceremonial on modern storage.
   * The actual guarantee is: key material is destroyed, making ciphertext undecryptable.
   */
  async cryptoShred(): Promise<void> {
    if (!sodium) {
      await initSodium();
    }
    const s = sodium!;
    
    console.log('[LocalKeyStore] 🔥 CRYPTO-SHRED initiated');
    
    try {
      // Step 1: Get all keys and overwrite them with random data (3 passes)
      if (this.initialized && this.db && this.masterKey) {
        const allKeys = await this.listKeysFromDb('');
        
        for (const key of allKeys) {
          // 3 passes of random overwrite
          for (let pass = 0; pass < 3; pass++) {
            const randomData = s.randombytes_buf(256); // Overwrite with 256 random bytes
            const encrypted = this.encrypt(randomData);
            await this.writeToDb(key, encrypted);
          }
          
          // Final: overwrite with zeros
          const zeros = new Uint8Array(256).fill(0);
          const encryptedZeros = this.encrypt(zeros);
          await this.writeToDb(key, encryptedZeros);
          
          // Delete the key
          await this.deleteFromDb(key);
        }
        
        console.log(`[LocalKeyStore] 🔥 Overwritten and deleted ${allKeys.length} keys`);
      }
      
      // Step 2: Clear the entire IndexedDB store
      if (this.db) {
        await this.clearDb();
        this.db.close();
        this.db = null;
        
        // Delete the entire database
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(LocalKeyStoreImpl.DB_NAME);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
        
        console.log('[LocalKeyStore] 🔥 IndexedDB database deleted');
      }
      
      // Step 3: Delete master key from OS keychain
      if (typeof window !== 'undefined' && window.electronAPI?.secureStore) {
        await window.electronAPI.secureStore.delete(LocalKeyStoreImpl.MASTER_KEY_ID);
        console.log('[LocalKeyStore] 🔥 Master key deleted from OS keychain');
      }
      
      // Step 4: Zero out in-memory master key
      if (this.masterKey) {
        // Overwrite with random first, then zeros
        const randomOverwrite = s.randombytes_buf(this.masterKey.length);
        this.masterKey.set(randomOverwrite);
        this.masterKey.fill(0);
        this.masterKey = null;
        console.log('[LocalKeyStore] 🔥 In-memory master key zeroed');
      }
      
      this.initialized = false;
      
      console.log('[LocalKeyStore] 🔥 CRYPTO-SHRED complete - all key material destroyed');
      
    } catch (error) {
      console.error('[LocalKeyStore] CRYPTO-SHRED error:', error);
      throw error;
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new LocalKeyStore instance.
 */
export function createLocalKeyStore(): LocalKeyStore {
  return new LocalKeyStoreImpl();
}
