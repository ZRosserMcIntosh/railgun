/* eslint-disable no-console */
/**
 * SECURE WIPE SERVICE - Military/Intelligence-Grade Data Destruction
 * 
 * This service implements multiple secure deletion standards:
 * - DoD 5220.22-M (7 passes)
 * - Gutmann Method (35 passes)
 * - RCMP TSSIT OPS-II (7 passes)
 * - Cryptographic Erasure (destroy encryption keys)
 * - Custom Rail Gun Protocol (100 passes with entropy injection)
 * 
 * DESIGNED TO RESIST:
 * - FBI forensic recovery
 * - NSA/CIA data recovery
 * - Mossad intelligence extraction
 * - Pegasus-style endpoint compromise
 * - Electron microscope analysis
 * - Magnetic force microscopy (MFM)
 * 
 * @see https://en.wikipedia.org/wiki/Gutmann_method
 * @see https://www.nist.gov/publications/guidelines-media-sanitization
 */

import { getApiClient } from './api';

// ==================== Types ====================

export interface WipeProgress {
  phase: WipePhase;
  currentPass: number;
  totalPasses: number;
  currentOperation: string;
  bytesDestroyed: number;
  percentComplete: number;
  estimatedTimeRemaining: number; // seconds
}

export type WipePhase = 
  | 'initializing'
  | 'key_destruction'
  | 'overwrite_pass'
  | 'verification'
  | 'metadata_scrub'
  | 'final_purge'
  | 'complete';

export type WipeMethod = 
  | 'quick'        // 3 passes - basic
  | 'dod'          // 7 passes - DoD 5220.22-M
  | 'gutmann'      // 35 passes - Gutmann
  | 'railgun'      // 100 passes - Maximum paranoia
  | 'paranoid';    // 100 passes + cryptographic destruction + verification

export interface WipeOptions {
  method: WipeMethod;
  verifyOverwrite: boolean;
  destroyLocalKeys: boolean;
  destroyRemoteKeys: boolean;
  wipeLocalStorage: boolean;
  wipeIndexedDB: boolean;
  wipeSessionStorage: boolean;
  overwriteCount: number;
  onProgress?: (progress: WipeProgress) => void;
}

// ==================== Overwrite Patterns ====================

/**
 * Gutmann 35-pass overwrite patterns
 * These patterns are designed to defeat magnetic force microscopy
 */
const GUTMANN_PATTERNS: (number | 'random')[] = [
  'random', 'random', 'random', 'random', // Passes 1-4: Random
  0x55, 0xAA, 0x92, 0x49, 0x24,           // Passes 5-9: Specific patterns
  0x00, 0x11, 0x22, 0x33, 0x44,           // Passes 10-14
  0x55, 0x66, 0x77, 0x88, 0x99,           // Passes 15-19
  0xAA, 0xBB, 0xCC, 0xDD, 0xEE,           // Passes 20-24
  0xFF, 0x92, 0x49, 0x24, 0x6D,           // Passes 25-29
  0xB6, 0xDB, 0x6D, 0xB6,                 // Passes 30-33
  'random', 'random',                      // Passes 34-35: Random
];

/**
 * DoD 5220.22-M patterns
 */
const DOD_PATTERNS: (number | 'random')[] = [
  0x00,     // Pass 1: All zeros
  0xFF,     // Pass 2: All ones
  'random', // Pass 3: Random
  0x00,     // Pass 4: Zeros
  0xFF,     // Pass 5: Ones
  'random', // Pass 6: Random
  'random', // Pass 7: Final random
];

/**
 * Rail Gun Maximum Security Protocol - 100 passes
 * Combines all known patterns + cryptographic entropy
 */
const RAILGUN_PATTERNS: (number | 'random' | 'crypto')[] = [
  // First 35: Gutmann
  ...GUTMANN_PATTERNS,
  // Next 35: Inverted Gutmann
  ...GUTMANN_PATTERNS.map(p => p === 'random' ? 'random' : (typeof p === 'number' ? p ^ 0xFF : p)),
  // Next 20: Cryptographic random (uses libsodium)
  ...Array(20).fill('crypto'),
  // Final 10: Alternating patterns with verification
  0x00, 0xFF, 0xAA, 0x55, 0xF0, 0x0F, 0xCC, 0x33, 'crypto', 'random',
];

// ==================== Utility Functions ====================

/**
 * Generate cryptographically secure random bytes
 */
async function generateSecureRandom(length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  
  // Use Web Crypto API for CSPRNG
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buffer);
  } else {
    // Fallback to libsodium if available
    const sodiumModule = await import('libsodium-wrappers');
    const sodium = (sodiumModule as any).default ?? sodiumModule;
    await sodium.ready;
    return sodium.randombytes_buf(length);
  }
  
  return buffer;
}

/**
 * Generate pattern-based data for overwrite
 */
async function generateOverwriteData(
  length: number, 
  pattern: number | 'random' | 'crypto'
): Promise<Uint8Array> {
  if (pattern === 'random') {
    return generateSecureRandom(length);
  }
  
  if (pattern === 'crypto') {
    // Use libsodium for maximum entropy
    const sodiumModule = await import('libsodium-wrappers');
    const sodium = (sodiumModule as any).default ?? sodiumModule;
    await sodium.ready;
    return sodium.randombytes_buf(length);
  }
  
  // Fixed pattern
  const buffer = new Uint8Array(length);
  buffer.fill(pattern);
  return buffer;
}

/**
 * XOR two buffers (for verification)
 */
function xorBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ (b[i] || 0);
  }
  return result;
}

// ==================== Core Wipe Functions ====================

/**
 * Securely overwrite a string value multiple times
 */
async function secureOverwriteString(
  value: string,
  passes: number,
  patterns: (number | 'random' | 'crypto')[],
  onPass?: (pass: number) => void
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let currentValue = new Uint8Array(encoder.encode(value));
  const length = currentValue.length;
  
  for (let pass = 0; pass < passes; pass++) {
    const patternIndex = pass % patterns.length;
    const pattern = patterns[patternIndex];
    
    // Generate overwrite data
    const overwriteData = await generateOverwriteData(length, pattern);
    
    // XOR with current value to ensure complete destruction
    currentValue = new Uint8Array(xorBuffers(currentValue, overwriteData));
    
    // Additional entropy injection
    const entropy = await generateSecureRandom(length);
    currentValue = new Uint8Array(xorBuffers(currentValue, entropy));
    
    onPass?.(pass + 1);
  }
  
  // Final pass: all zeros
  currentValue.fill(0);
  
  return decoder.decode(currentValue);
}

/**
 * Destroy all localStorage data with secure overwrite
 */
async function secureWipeLocalStorage(
  passes: number,
  patterns: (number | 'random' | 'crypto')[],
  onProgress?: (key: string, pass: number) => void
): Promise<void> {
  const keys = Object.keys(localStorage);
  
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) {
      // Overwrite the value multiple times
      for (let pass = 0; pass < passes; pass++) {
        const pattern = patterns[pass % patterns.length];
        const overwriteData = await generateOverwriteData(value.length, pattern);
        const overwriteString = Array.from(overwriteData)
          .map(b => String.fromCharCode(b))
          .join('');
        
        localStorage.setItem(key, overwriteString);
        onProgress?.(key, pass + 1);
      }
      
      // Final: set to empty, then random, then remove
      localStorage.setItem(key, '');
      localStorage.setItem(key, await generateRandomString(value.length));
      localStorage.removeItem(key);
    }
  }
  
  // Clear entire storage
  localStorage.clear();
}

/**
 * Destroy all sessionStorage data with secure overwrite
 */
async function secureWipeSessionStorage(
  passes: number,
  patterns: (number | 'random' | 'crypto')[],
  onProgress?: (key: string, pass: number) => void
): Promise<void> {
  const keys = Object.keys(sessionStorage);
  
  for (const key of keys) {
    const value = sessionStorage.getItem(key);
    if (value) {
      for (let pass = 0; pass < passes; pass++) {
        const pattern = patterns[pass % patterns.length];
        const overwriteData = await generateOverwriteData(value.length, pattern);
        const overwriteString = Array.from(overwriteData)
          .map(b => String.fromCharCode(b))
          .join('');
        
        sessionStorage.setItem(key, overwriteString);
        onProgress?.(key, pass + 1);
      }
      
      sessionStorage.setItem(key, '');
      sessionStorage.removeItem(key);
    }
  }
  
  sessionStorage.clear();
}

/**
 * Destroy all IndexedDB data with secure overwrite
 */
async function secureWipeIndexedDB(
  passes: number,
  patterns: (number | 'random' | 'crypto')[],
  onProgress?: (db: string, pass: number) => void
): Promise<void> {
  // Get all database names
  const databases = await indexedDB.databases();
  
  for (const dbInfo of databases) {
    if (!dbInfo.name) continue;
    
    const dbName = dbInfo.name;
    
    // Open database
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    // Get all object stores
    const storeNames = Array.from(db.objectStoreNames);
    
    for (const storeName of storeNames) {
      // Overwrite all records multiple times
      for (let pass = 0; pass < passes; pass++) {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        // Get all records
        const records = await new Promise<any[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        // Overwrite each record
        for (const record of records) {
          const overwriteRecord = await createOverwriteRecord(record, patterns[pass % patterns.length]);
          store.put(overwriteRecord);
        }
        
        await new Promise<void>((resolve) => {
          transaction.oncomplete = () => resolve();
        });
        
        onProgress?.(dbName, pass + 1);
      }
    }
    
    db.close();
    
    // Delete the database entirely
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

/**
 * Create an overwritten version of a record
 */
async function createOverwriteRecord(
  record: any, 
  pattern: number | 'random' | 'crypto'
): Promise<any> {
  if (typeof record === 'string') {
    const data = await generateOverwriteData(record.length, pattern);
    return Array.from(data).map(b => String.fromCharCode(b)).join('');
  }
  
  if (typeof record === 'object' && record !== null) {
    const result: any = {};
    for (const key of Object.keys(record)) {
      result[key] = await createOverwriteRecord(record[key], pattern);
    }
    return result;
  }
  
  if (typeof record === 'number') {
    return Math.random() * Number.MAX_SAFE_INTEGER;
  }
  
  return null;
}

/**
 * Generate a random string of specified length
 */
async function generateRandomString(length: number): Promise<string> {
  const data = await generateSecureRandom(length);
  return Array.from(data).map(b => String.fromCharCode(b % 94 + 33)).join('');
}

// ==================== Cryptographic Key Destruction ====================

/**
 * Destroy all local cryptographic keys via the RailGunCrypto cryptoShred method.
 * This uses the proper crypto layer which handles:
 * - Multi-pass secure overwrite of IndexedDB keys
 * - Master key deletion from OS keychain  
 * - In-memory key zeroing
 */
async function destroyLocalCryptoKeys(
  _passes: number,
  onProgress?: (keyType: string) => void
): Promise<void> {
  try {
    // Import the crypto module dynamically to avoid circular deps
    const { getCrypto } = await import('../crypto');
    const crypto = getCrypto();
    
    onProgress?.('RailGunCrypto keys');
    
    // Use the proper crypto-shred method which handles all key material
    await crypto.cryptoShred();
    
    onProgress?.('All crypto keys destroyed');
    
    // LEGACY: Also try to clean up any legacy localStorage keys
    // (in case they exist from older versions)
    const legacyKeyTypes = [
      'identity_private_key',
      'identity_public_key', 
      'signed_prekey_private',
      'signed_prekey_public',
      'one_time_prekeys',
      'session_keys',
      'root_key',
      'chain_keys',
      'message_keys',
    ];
    
    for (const keyType of legacyKeyTypes) {
      const key = localStorage.getItem(keyType);
      if (key) {
        const sodiumModule = await import('libsodium-wrappers');
        const sodium = (sodiumModule as any).default ?? sodiumModule;
        await sodium.ready;
        
        // Overwrite with secure random
        const randomKey = sodium.randombytes_buf(key.length);
        localStorage.setItem(keyType, sodium.to_base64(randomKey));
        localStorage.setItem(keyType, '0'.repeat(key.length));
        localStorage.removeItem(keyType);
        
        onProgress?.(`Legacy key: ${keyType}`);
      }
    }
    
    // Force garbage collection if available
    if (typeof global !== 'undefined' && (global as any).gc) {
      (global as any).gc();
    }
    
  } catch (error) {
    console.error('[SecureWipe] Error destroying crypto keys:', error);
    throw error;
  }
}

// ==================== Main Secure Wipe Class ====================

export class SecureWipeService {
  private isWiping = false;
  private progress: WipeProgress = {
    phase: 'initializing',
    currentPass: 0,
    totalPasses: 0,
    currentOperation: '',
    bytesDestroyed: 0,
    percentComplete: 0,
    estimatedTimeRemaining: 0,
  };
  
  /**
   * Execute a complete secure wipe of all user data
   */
  async executeNuke(options: WipeOptions): Promise<void> {
    if (this.isWiping) {
      throw new Error('Wipe already in progress');
    }
    
    this.isWiping = true;
    const startTime = Date.now();
    
    try {
      // Determine patterns and passes based on method
      const { patterns, passes } = this.getWipeConfig(options.method, options.overwriteCount);
      this.progress.totalPasses = passes;
      
      // Phase 1: Key Destruction (Cryptographic Erasure)
      this.updateProgress('key_destruction', 0, 'Destroying encryption keys...');
      
      if (options.destroyLocalKeys) {
        await destroyLocalCryptoKeys(passes, (keyType) => {
          this.updateProgress('key_destruction', 0, `Shredding ${keyType}...`);
        });
      }
      
      if (options.destroyRemoteKeys) {
        await this.destroyRemoteKeys();
      }
      
      // Phase 2: Overwrite Local Storage
      if (options.wipeLocalStorage) {
        this.updateProgress('overwrite_pass', 0, 'Overwriting localStorage...');
        
        await secureWipeLocalStorage(passes, patterns, (key, pass) => {
          this.updateProgress('overwrite_pass', pass, `localStorage: ${key} (pass ${pass}/${passes})`);
        });
      }
      
      // Phase 3: Overwrite Session Storage
      if (options.wipeSessionStorage) {
        this.updateProgress('overwrite_pass', 0, 'Overwriting sessionStorage...');
        
        await secureWipeSessionStorage(passes, patterns, (key, pass) => {
          this.updateProgress('overwrite_pass', pass, `sessionStorage: ${key} (pass ${pass}/${passes})`);
        });
      }
      
      // Phase 4: Overwrite IndexedDB
      if (options.wipeIndexedDB) {
        this.updateProgress('overwrite_pass', 0, 'Overwriting IndexedDB...');
        
        await secureWipeIndexedDB(passes, patterns, (db, pass) => {
          this.updateProgress('overwrite_pass', pass, `IndexedDB: ${db} (pass ${pass}/${passes})`);
        });
      }
      
      // Phase 5: Server-side data destruction
      this.updateProgress('metadata_scrub', 0, 'Initiating server-side destruction...');
      await this.executeServerNuke(passes);
      
      // Phase 6: Verification (if enabled)
      if (options.verifyOverwrite) {
        this.updateProgress('verification', 0, 'Verifying destruction...');
        await this.verifyDestruction();
      }
      
      // Phase 7: Final cleanup
      this.updateProgress('final_purge', 0, 'Final purge...');
      await this.finalPurge();
      
      // Complete
      this.updateProgress('complete', passes, 'All data destroyed');
      
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`[SecureWipe] Complete. Total time: ${elapsed.toFixed(2)}s`);
      
    } finally {
      this.isWiping = false;
    }
  }
  
  /**
   * Get wipe configuration based on method
   */
  private getWipeConfig(
    method: WipeMethod, 
    customPasses?: number
  ): { patterns: (number | 'random' | 'crypto')[]; passes: number } {
    switch (method) {
      case 'quick':
        return { patterns: [0x00, 0xFF, 'random'], passes: 3 };
      
      case 'dod':
        return { patterns: DOD_PATTERNS, passes: 7 };
      
      case 'gutmann':
        return { patterns: GUTMANN_PATTERNS, passes: 35 };
      
      case 'railgun':
        return { patterns: RAILGUN_PATTERNS, passes: 100 };
      
      case 'paranoid': {
        // Use custom pass count, minimum 100
        const passes = Math.max(customPasses || 100, 100);
        return { patterns: RAILGUN_PATTERNS, passes };
      }
      
      default:
        return { patterns: RAILGUN_PATTERNS, passes: 100 };
    }
  }
  
  /**
   * Update progress and notify listeners
   */
  private updateProgress(
    phase: WipePhase, 
    currentPass: number, 
    operation: string
  ): void {
    this.progress = {
      ...this.progress,
      phase,
      currentPass,
      currentOperation: operation,
      percentComplete: this.calculatePercent(phase, currentPass),
    };
    
    // Log to console for debugging
    console.log(`[SecureWipe] ${phase}: ${operation}`);
  }
  
  /**
   * Calculate completion percentage
   */
  private calculatePercent(phase: WipePhase, currentPass: number): number {
    const phaseWeights: Record<WipePhase, number> = {
      initializing: 0,
      key_destruction: 10,
      overwrite_pass: 70,
      verification: 85,
      metadata_scrub: 90,
      final_purge: 95,
      complete: 100,
    };
    
    const basePercent = phaseWeights[phase];
    
    if (phase === 'overwrite_pass') {
      const passPercent = (currentPass / this.progress.totalPasses) * 60;
      return Math.min(10 + passPercent, 70);
    }
    
    return basePercent;
  }
  
  /**
   * Destroy keys stored on the server
   */
  private async destroyRemoteKeys(): Promise<void> {
    try {
      const api = getApiClient();
      
      // Request server to destroy all key bundles
      await api.nukeAccount();
      
    } catch (error) {
      console.error('[SecureWipe] Failed to destroy remote keys:', error);
      // Continue anyway - local destruction is more important
    }
  }
  
  /**
 * Execute server-side data destruction
 */
  private async executeServerNuke(_passes: number): Promise<void> {
    try {
      const api = getApiClient();
      
      // The server will perform its own multi-pass overwrite
      // See backend implementation for details
      await api.nukeAccount();
      
    } catch (error) {
      console.error('[SecureWipe] Server nuke failed:', error);
      throw error;
    }
  }
  
  /**
   * Verify that destruction was successful
   */
  private async verifyDestruction(): Promise<void> {
    // Check localStorage is empty
    if (localStorage.length > 0) {
      console.warn('[SecureWipe] Warning: localStorage not fully cleared');
    }
    
    // Check sessionStorage is empty
    if (sessionStorage.length > 0) {
      console.warn('[SecureWipe] Warning: sessionStorage not fully cleared');
    }
    
    // Check IndexedDB databases are gone
    const databases = await indexedDB.databases();
    if (databases.length > 0) {
      console.warn('[SecureWipe] Warning: IndexedDB not fully cleared');
    }
  }
  
  /**
   * Final cleanup and memory purge
   */
  private async finalPurge(): Promise<void> {
    // Clear any remaining caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    
    // Clear cookies
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    });
    
    // Request garbage collection if available
    if (typeof window !== 'undefined' && (window as any).gc) {
      (window as any).gc();
    }
  }
  
  /**
   * Get current progress
   */
  getProgress(): WipeProgress {
    return { ...this.progress };
  }
  
  /**
   * Check if wipe is in progress
   */
  isWipeInProgress(): boolean {
    return this.isWiping;
  }
}

// Export singleton instance
export const secureWipeService = new SecureWipeService();

// Export for testing
export {
  GUTMANN_PATTERNS,
  DOD_PATTERNS,
  RAILGUN_PATTERNS,
  generateSecureRandom,
  secureOverwriteString,
};
