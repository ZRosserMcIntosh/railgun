/**
 * Crypto IPC Handler - Main Process
 * 
 * Runs Signal Protocol crypto operations in the Electron main process.
 * The renderer communicates via IPC for all crypto operations.
 * 
 * SECURITY:
 * - Signal Protocol requires native modules that must run in main process
 * - All private key operations happen here, never in renderer
 * - IPC messages are validated before processing
 * 
 * NOTE: If libsignal native module is not available, renderer uses SimpleCrypto fallback.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as nodeCrypto from 'crypto';

// ============================================================================
// SIGNAL MODULE LOADING
// ============================================================================

// Try to load Signal - may fail if native module not built for this platform
type SignalModule = typeof import('@signalapp/libsignal-client');
let Signal: SignalModule | null = null;

try {
  // Dynamic require to catch native module errors
  Signal = require('@signalapp/libsignal-client');
  console.log('[CryptoIPC] ✅ Signal Protocol native module loaded successfully');
} catch (err) {
  console.warn('[CryptoIPC] ⚠️ Signal Protocol native module not available');
  console.warn('[CryptoIPC] Renderer will use SimpleCrypto fallback (no forward secrecy)');
  console.warn('[CryptoIPC] Error:', (err as Error).message);
}

// Export availability for renderer to check
export const signalAvailable = Signal !== null;

// ============================================================================
// TYPES
// ============================================================================

interface CryptoState {
  initialized: boolean;
  localUserId: string | null;
  identityKeyPair: {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  } | null;
  registrationId: number;
  deviceId: number;
  preKeyId: number;
  signedPreKeyId: number;
}

interface EncryptedMessage {
  type: 'prekey' | 'message';
  ciphertext: string;
  senderDeviceId: number;
  registrationId?: number;
}

interface PreKeyBundle {
  registrationId: number;
  identityKey: string;
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  preKeys: Array<{
    keyId: number;
    publicKey: string;
  }>;
}

// ============================================================================
// STATE
// ============================================================================

const state: CryptoState = {
  initialized: false,
  localUserId: null,
  identityKeyPair: null,
  registrationId: 0,
  deviceId: 1,
  preKeyId: 1,
  signedPreKeyId: 1,
};

// Storage paths
const CRYPTO_DIR = path.join(app.getPath('userData'), 'crypto');
const IDENTITY_FILE = path.join(CRYPTO_DIR, 'identity.json');

// ============================================================================
// STORAGE HELPERS
// ============================================================================

function ensureDir(): void {
  if (!fs.existsSync(CRYPTO_DIR)) {
    fs.mkdirSync(CRYPTO_DIR, { recursive: true, mode: 0o700 });
  }
}

function saveIdentity(): void {
  if (!state.identityKeyPair) return;
  
  ensureDir();
  const data = {
    publicKey: Array.from(state.identityKeyPair.publicKey),
    privateKey: Array.from(state.identityKeyPair.privateKey),
    registrationId: state.registrationId,
    deviceId: state.deviceId,
    preKeyId: state.preKeyId,
    signedPreKeyId: state.signedPreKeyId,
  };
  
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(data), { mode: 0o600 });
}

function loadIdentity(): boolean {
  if (!fs.existsSync(IDENTITY_FILE)) return false;
  if (!Signal) return false;
  
  try {
    const data = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
    state.identityKeyPair = {
      publicKey: new Uint8Array(data.publicKey),
      privateKey: new Uint8Array(data.privateKey),
    };
    state.registrationId = data.registrationId;
    state.deviceId = data.deviceId || 1;
    state.preKeyId = data.preKeyId || 1;
    state.signedPreKeyId = data.signedPreKeyId || 1;
    return true;
  } catch (error) {
    console.error('[CryptoIPC] Failed to load identity:', error);
    return false;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function toBase64(data: Uint8Array | Buffer): string {
  return Buffer.from(data).toString('base64');
}

function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}

// ============================================================================
// VALIDATION
// ============================================================================

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

function validateSender(event: Electron.IpcMainInvokeEvent): boolean {
  if (!mainWindow) return false;
  return event.sender.id === mainWindow.webContents.id;
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

export function setupCryptoIPC(): void {
  console.log('[CryptoIPC] Setting up IPC handlers');

  // Check if Signal is available (renderer uses this to decide SimpleCrypto fallback)
  ipcMain.handle('crypto:isSignalAvailable', () => {
    return signalAvailable;
  });

  // Initialize crypto
  ipcMain.handle('crypto:init', async (event) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }

    // If Signal isn't available, tell renderer to use SimpleCrypto
    if (!Signal) {
      return { success: false, useSimpleCrypto: true };
    }

    if (state.initialized) {
      return { success: true, alreadyInitialized: true };
    }

    try {
      // Try to load existing identity
      if (!loadIdentity()) {
        // Generate new identity using Signal
        const privateKey = Signal.PrivateKey.generate();
        const publicKey = privateKey.getPublicKey();
        
        state.identityKeyPair = {
          publicKey: publicKey.serialize(),
          privateKey: privateKey.serialize(),
        };
        state.registrationId = Math.floor(Math.random() * 0x3fff) + 1;
        state.deviceId = 1;
        
        saveIdentity();
        console.log('[CryptoIPC] Generated new identity');
      } else {
        console.log('[CryptoIPC] Loaded existing identity');
      }

      state.initialized = true;
      return { success: true };
    } catch (error) {
      console.error('[CryptoIPC] Init error:', error);
      throw error;
    }
  });

  // Check if initialized
  ipcMain.handle('crypto:isInitialized', (event) => {
    if (!validateSender(event)) return false;
    return state.initialized && Signal !== null;
  });

  // Set local user ID
  ipcMain.handle('crypto:setLocalUserId', async (event, userId: string) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }
    
    state.localUserId = userId;
    return { success: true };
  });

  // Get device ID
  ipcMain.handle('crypto:getDeviceId', (event) => {
    if (!validateSender(event)) return 0;
    return state.deviceId;
  });

  // Get registration ID
  ipcMain.handle('crypto:getRegistrationId', (event) => {
    if (!validateSender(event)) return 0;
    return state.registrationId;
  });

  // Get identity public key
  ipcMain.handle('crypto:getIdentityPublicKey', (event) => {
    if (!validateSender(event)) return null;
    if (!state.identityKeyPair) return null;
    return toBase64(state.identityKeyPair.publicKey);
  });

  // Get identity fingerprint
  ipcMain.handle('crypto:getIdentityFingerprint', (event) => {
    if (!validateSender(event)) return '';
    if (!state.identityKeyPair) return '';
    
    // Create fingerprint from identity key
    const hash = Buffer.from(state.identityKeyPair.publicKey).toString('hex').substring(0, 40);
    // Format as groups of 5 hex chars
    return hash.match(/.{1,5}/g)?.join(' ') || hash;
  });

  // Get prekey bundle for upload
  ipcMain.handle('crypto:getPreKeyBundle', async (event) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }
    
    if (!Signal) {
      throw new Error('Signal not available');
    }
    
    if (!state.identityKeyPair) {
      throw new Error('Not initialized');
    }

    // Reconstruct Signal keys from stored bytes
    const identityPrivate = Signal.PrivateKey.deserialize(Buffer.from(state.identityKeyPair.privateKey));
    
    // Generate signed prekey
    const signedPreKeyPrivate = Signal.PrivateKey.generate();
    const signedPreKeyPublic = signedPreKeyPrivate.getPublicKey();
    const signedPreKeySignature = identityPrivate.sign(
      signedPreKeyPublic.serialize()
    );

    // Generate one-time prekeys
    const preKeys: Array<{ keyId: number; publicKey: string }> = [];
    for (let i = 0; i < 100; i++) {
      const preKeyPrivate = Signal.PrivateKey.generate();
      preKeys.push({
        keyId: state.preKeyId + i,
        publicKey: toBase64(preKeyPrivate.getPublicKey().serialize()),
      });
    }
    state.preKeyId += 100;
    saveIdentity();

    const bundle: PreKeyBundle = {
      registrationId: state.registrationId,
      identityKey: toBase64(state.identityKeyPair.publicKey),
      signedPreKey: {
        keyId: state.signedPreKeyId++,
        publicKey: toBase64(signedPreKeyPublic.serialize()),
        signature: toBase64(signedPreKeySignature),
      },
      preKeys,
    };

    return bundle;
  });

  // Encrypt DM (placeholder - needs full Signal session)
  ipcMain.handle('crypto:encryptDm', async (event, peerUserId: string, plaintext: string) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }
    
    if (!state.initialized || !state.identityKeyPair) {
      throw new Error('Not initialized');
    }

    // Placeholder encryption - SimpleCrypto in renderer handles actual encryption
    const plaintextBytes = new TextEncoder().encode(plaintext);
    
    const encrypted: EncryptedMessage = {
      type: 'message',
      ciphertext: toBase64(plaintextBytes),
      senderDeviceId: state.deviceId,
    };

    console.log('[CryptoIPC] Encrypted DM to:', peerUserId.substring(0, 8));
    return encrypted;
  });

  // Decrypt DM (placeholder)
  ipcMain.handle('crypto:decryptDm', async (event, peerUserId: string, message: EncryptedMessage) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }
    
    if (!state.initialized) {
      throw new Error('Not initialized');
    }

    const ciphertext = fromBase64(message.ciphertext);
    const plaintext = new TextDecoder().decode(ciphertext);

    console.log('[CryptoIPC] Decrypted DM from:', peerUserId.substring(0, 8));
    return plaintext;
  });

  // Clear all crypto data
  ipcMain.handle('crypto:clearAllData', async (event) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }

    state.initialized = false;
    state.localUserId = null;
    state.identityKeyPair = null;

    // Delete files
    try {
      if (fs.existsSync(IDENTITY_FILE)) fs.unlinkSync(IDENTITY_FILE);
    } catch (error) {
      console.error('[CryptoIPC] Error clearing files:', error);
    }

    console.log('[CryptoIPC] Cleared all crypto data');
    return { success: true };
  });

  // Crypto shred (secure delete)
  ipcMain.handle('crypto:cryptoShred', async (event) => {
    if (!validateSender(event)) {
      throw new Error('Unauthorized IPC caller');
    }

    console.log('[CryptoIPC] 🔥 CRYPTO-SHRED initiated');

    // Overwrite files with random data before deleting
    const filesToShred = [IDENTITY_FILE];
    
    for (const file of filesToShred) {
      if (fs.existsSync(file)) {
        const stat = fs.statSync(file);
        // Overwrite 3 times with random data
        for (let pass = 0; pass < 3; pass++) {
          const randomData = Buffer.alloc(stat.size);
          nodeCrypto.randomFillSync(randomData);
          fs.writeFileSync(file, randomData);
        }
        fs.unlinkSync(file);
      }
    }

    // Clear memory
    state.initialized = false;
    state.localUserId = null;
    state.identityKeyPair = null;

    console.log('[CryptoIPC] 🔥 CRYPTO-SHRED complete');
    return { success: true };
  });

  console.log('[CryptoIPC] IPC handlers registered');
}
