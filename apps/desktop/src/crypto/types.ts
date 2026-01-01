/**
 * Rail Gun - Crypto Module Types
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * PROTOCOL OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This module implements end-to-end encryption using the Signal Protocol:
 * 
 * 1. X3DH (Extended Triple Diffie-Hellman) - Session establishment
 * 2. Double Ratchet - Forward secrecy for 1:1 DMs
 * 3. Sender Keys - Efficient group/channel encryption
 * 
 * ⚠️  POST-QUANTUM STATUS:
 * libsignal-client v0.86+ internally uses PQXDH (which includes Kyber KEM).
 * This is handled by the library - we do NOT implement custom PQ crypto.
 * For documentation purposes, treat this as "Signal Protocol" without
 * making specific post-quantum claims until we've audited the full chain.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE BOUNDARIES (STRICTLY ENFORCED)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                         REST OF THE APP                                 │
 * │              (UI, Networking, State Management)                         │
 * └─────────────────────────────┬───────────────────────────────────────────┘
 *                               │ ONLY imports RailGunCrypto
 *                               ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                        RailGunCrypto                                    │
 * │                    (Public Facade Layer)                                │
 * │         - String-based API (base64 for binary data)                     │
 * │         - User/channel-centric operations                               │
 * └─────────────────────────────┬───────────────────────────────────────────┘
 *                               │ Delegates to
 *              ┌────────────────┴────────────────┐
 *              ▼                                 ▼
 * ┌────────────────────────┐      ┌────────────────────────────────────────┐
 * │     LocalKeyStore      │◄────►│           SignalWrapper                │
 * │  (Encrypted Storage)   │      │      (Signal Protocol Ops)             │
 * │                        │      │                                        │
 * │ - libsodium ONLY       │      │ - libsignal-client ONLY                │
 * │ - XChaCha20-Poly1305   │      │ - X3DH + Double Ratchet                │
 * │ - IndexedDB backend    │      │ - Sender Keys                          │
 * │ - OS keychain for      │      │ - Stores use LocalKeyStore             │
 * │   master key           │      │                                        │
 * └────────────────────────┘      └────────────────────────────────────────┘
 * 
 * IMPORT RULES:
 * - ONLY LocalKeyStore.ts may import 'libsodium-wrappers'
 * - ONLY SignalWrapper.ts may import '@signalapp/libsignal-client'
 * - ONLY RailGunCrypto.ts may import LocalKeyStore and SignalWrapper
 * - Everything else imports from './crypto' (the index.ts barrel)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * KEY LIFECYCLES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * IDENTITY KEY LIFECYCLE:
 * 1. On first app launch, generate identity key pair via Signal library
 * 2. Private key → encrypted via LocalKeyStore → stored in IndexedDB
 * 3. Public key → included in prekey bundle → uploaded to server
 * 4. Identity key is long-lived; only regenerated on account reset
 * 
 * DM SESSION ESTABLISHMENT (X3DH):
 * 1. Alice fetches Bob's prekey bundle from server
 * 2. Alice performs X3DH with Bob's identity key + signed prekey + one-time prekey
 * 3. Shared secret established; Alice sends first message as PreKeyMessage
 * 4. Bob receives, completes X3DH, both enter Double Ratchet
 * 5. Each message ratchets forward; compromise of old keys doesn't expose new messages
 * 
 * CHANNEL/GROUP ENCRYPTION (Sender Keys):
 * 1. Each member generates a sender key for the channel
 * 2. Sender key distribution message sent E2E to each member (via DM)
 * 3. When sending to channel, encrypt once with own sender key
 * 4. All members can decrypt using the sender's distributed key
 * 5. Member removal requires sender key rotation by remaining members
 */

// ============================================================================
// PUBLIC API - RailGunCrypto Interface
// ============================================================================

/**
 * Main crypto facade for Rail Gun.
 * 
 * This is the ONLY interface the rest of the app should use.
 * Do NOT import libsodium or libsignal-client anywhere else.
 */
export interface RailGunCrypto {
  // ────────────────── Initialization ──────────────────

  /**
   * Initialize the crypto module.
   * 
   * FIRST RUN:
   * - Generates identity key pair
   * - Generates initial prekeys
   * - Stores everything encrypted in IndexedDB
   * 
   * SUBSEQUENT RUNS:
   * - Loads identity and keys from encrypted storage
   */
  init(): Promise<void>;

  /** Check if crypto is ready to use. */
  isInitialized(): boolean;

  /** Set the local user ID (call after login). */
  setLocalUserId(userId: string): Promise<void>;

  // ────────────────── Identity ──────────────────

  /** Get this device's unique identifier. */
  getDeviceId(): number;

  /** Get the registration ID for Signal protocol. */
  getRegistrationId(): number;

  /** Get the public identity key (base64 encoded). */
  getIdentityPublicKey(): string;

  /** Get human-readable fingerprint for identity verification. */
  getIdentityFingerprint(): string;

  // ────────────────── Prekey Management ──────────────────

  /**
   * Get the full prekey bundle for server upload.
   * Contains ONLY public keys - private keys stay local.
   */
  getPreKeyBundle(): Promise<PreKeyBundleForUpload>;

  /**
   * Generate additional one-time prekeys.
   * Call when server indicates prekey count is low.
   */
  generateMorePreKeys(count: number): Promise<PreKeyForUpload[]>;

  // ────────────────── Direct Messages (1:1) ──────────────────

  /**
   * Ensure a DM session exists with a peer.
   * If no session, creates one using their prekey bundle.
   */
  ensureDmSession(peerUserId: string, peerPreKeyBundle?: PreKeyBundleFromServer): Promise<void>;

  /** Check if we have an active session with a peer. */
  hasDmSession(peerUserId: string): Promise<boolean>;

  /** Encrypt a DM. Returns envelope to send to server. */
  encryptDm(peerUserId: string, plaintext: string): Promise<EncryptedMessage>;

  /** Decrypt a received DM. Returns plaintext. */
  decryptDm(peerUserId: string, message: EncryptedMessage): Promise<string>;

  // ────────────────── Channels / Groups ──────────────────

  /**
   * Ensure we have a sender key session for a channel.
   * Creates our sender key and prepares for distribution.
   */
  ensureChannelSession(channelId: string, memberUserIds: string[]): Promise<void>;

  /** Encrypt a message for a channel using sender keys. */
  encryptChannel(channelId: string, plaintext: string): Promise<EncryptedChannelMessage>;

  /** Decrypt a channel message from a specific sender. */
  decryptChannel(
    channelId: string,
    senderUserId: string,
    message: EncryptedChannelMessage
  ): Promise<string>;

  /** Process a sender key distribution from another member. */
  processSenderKeyDistribution(
    channelId: string,
    senderUserId: string,
    distribution: Uint8Array | string
  ): Promise<void>;

  /** Get our sender key distribution to send to new members. */
  getSenderKeyDistribution(channelId: string): Promise<Uint8Array | string | null>;

  // ────────────────── Verification ──────────────────

  /** Compute safety number for identity verification. */
  computeSafetyNumber(peerUserId: string, peerIdentityKey: string): string;

  /** Mark a peer's identity as verified. */
  markIdentityVerified(peerUserId: string): Promise<void>;

  /** Check if peer's identity has changed. */
  hasIdentityChanged(peerUserId: string, currentIdentityKey: string): Promise<boolean>;

  // ────────────────── Cleanup ──────────────────

  /** Clear all crypto state (logout/account deletion). */
  clearAllData(): Promise<void>;

  /**
   * CRYPTO-SHRED: Permanently destroy all cryptographic key material.
   * 
   * This is the NUCLEAR option - use for account deletion or panic button.
   * After calling this, ALL encrypted data becomes PERMANENTLY UNRECOVERABLE.
   * 
   * Performs multi-pass secure overwrite, master key deletion, and memory zeroing.
   */
  cryptoShred(): Promise<void>;
}

// ============================================================================
// MESSAGE ENVELOPES
// ============================================================================

/**
 * Encrypted DM envelope.
 */
export interface EncryptedMessage {
  /** 'prekey' for first message establishing session, 'message' thereafter */
  type: 'prekey' | 'message';
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Sender's device ID */
  senderDeviceId: number;
  /** Registration ID (only for prekey messages) */
  registrationId?: number;
}

/**
 * Encrypted channel message envelope.
 */
export interface EncryptedChannelMessage {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Sender's device ID */
  senderDeviceId: number;
  /** Channel distribution ID */
  distributionId: string;
}

// ============================================================================
// PREKEY BUNDLES
// ============================================================================

/**
 * Prekey bundle for upload to server.
 * Contains ONLY public keys.
 */
export interface PreKeyBundleForUpload {
  registrationId: number;
  identityKey: string; // base64
  signedPreKey: {
    keyId: number;
    publicKey: string; // base64
    signature: string; // base64
  };
  preKeys: PreKeyForUpload[];
}

/**
 * Single one-time prekey for upload.
 */
export interface PreKeyForUpload {
  keyId: number;
  publicKey: string; // base64
}

/**
 * Prekey bundle received from server for session establishment.
 */
export interface PreKeyBundleFromServer {
  registrationId: number;
  deviceId: number;
  identityKey: string; // base64
  signedPreKey: {
    keyId: number;
    publicKey: string; // base64
    signature: string; // base64
  };
  preKey?: {
    keyId: number;
    publicKey: string; // base64
  };
}

// ============================================================================
// INTERNAL INTERFACES (not exported from index.ts)
// ============================================================================

/**
 * Local encrypted key store interface.
 * 
 * IMPLEMENTATION RULES:
 * - ONLY talks to libsodium + IndexedDB + Electron safeStorage
 * - All data encrypted with XChaCha20-Poly1305 before storage
 * - Master key protected by OS keychain via safeStorage
 */
export interface LocalKeyStore {
  /** Initialize the store. */
  init(): Promise<void>;

  /** Check if initialized. */
  isInitialized(): boolean;

  /** Get a value (decrypted). */
  get(key: string): Promise<Uint8Array | null>;

  /** Set a value (will be encrypted). */
  set(key: string, value: Uint8Array): Promise<void>;

  /** Delete a value. */
  delete(key: string): Promise<void>;

  /** Check if key exists. */
  has(key: string): Promise<boolean>;

  /** List keys with prefix. */
  listKeys(prefix: string): Promise<string[]>;

  /** Clear all data. */
  clear(): Promise<void>;

  /**
   * CRYPTO-SHRED: Securely destroy all key material.
   * 
   * Performs military-grade destruction:
   * 1. Overwrites each key with random data (multiple passes)
   * 2. Clears IndexedDB
   * 3. Deletes master key from OS keychain
   * 4. Zeros in-memory keys
   * 
   * After calling this, ALL encrypted data is PERMANENTLY UNRECOVERABLE.
   */
  cryptoShred(): Promise<void>;
}

/**
 * Signal protocol wrapper interface.
 * 
 * IMPLEMENTATION RULES:
 * - ONLY talks to @signalapp/libsignal-client
 * - Uses LocalKeyStore for all persistent storage
 * - Exposes high-level encrypt/decrypt operations
 */
export interface SignalWrapper {
  /** Initialize (loads/generates identity). */
  initialize(): Promise<void>;

  /** Set local user ID for addressing. */
  setLocalUserId(userId: string): Promise<void>;

  /** Set device ID. */
  setDeviceId(deviceId: number): Promise<void>;

  /** Get device ID. */
  getDeviceId(): number;

  /** Get identity public key. */
  getIdentityPublicKey(): Promise<Uint8Array>;

  /** Get registration ID. */
  getRegistrationId(): Promise<number>;

  /** Get fingerprint for identity verification. */
  getIdentityFingerprint(): Promise<string>;

  /** Build prekey bundle for server upload. */
  buildPreKeyBundleForUpload(): Promise<{
    identityKey: Uint8Array;
    registrationId: number;
    signedPreKey: { id: number; publicKey: Uint8Array; signature: Uint8Array };
    preKeys: Array<{ id: number; publicKey: Uint8Array }>;
  }>;

  // ── DM Operations ──

  /** Establish DM session using peer's prekey bundle. */
  createSession(
    recipientId: string,
    deviceId: number,
    bundle: {
      identityKey: Uint8Array;
      registrationId: number;
      signedPreKey: { id: number; publicKey: Uint8Array; signature: Uint8Array };
      preKey?: { id: number; publicKey: Uint8Array };
    }
  ): Promise<void>;

  /** Check if session exists. */
  hasSession(recipientId: string, deviceId: number): Promise<boolean>;

  /** Encrypt for DM. */
  encrypt(
    recipientId: string,
    deviceId: number,
    plaintext: Uint8Array
  ): Promise<{ type: number; body: Uint8Array }>;

  /** Decrypt DM. */
  decrypt(
    senderId: string,
    deviceId: number,
    ciphertext: { type: number; body: Uint8Array }
  ): Promise<Uint8Array>;

  // ── Group/Channel Operations ──

  /** Create sender key distribution for channel. */
  createGroupSession(groupId: string): Promise<Uint8Array>;

  /** Process received sender key distribution. */
  processGroupSession(
    senderId: string,
    deviceId: number,
    distributionMessage: Uint8Array
  ): Promise<void>;

  /** Encrypt with sender key. */
  groupEncrypt(groupId: string, plaintext: Uint8Array): Promise<Uint8Array>;

  /** Decrypt sender key message. */
  groupDecrypt(
    senderId: string,
    deviceId: number,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;
}

// ============================================================================
// STORAGE KEY CONSTANTS
// ============================================================================

export const STORAGE_KEYS = {
  // Identity
  IDENTITY: 'identity',
  DEVICE_ID: 'device_id',
  LOCAL_USER_ID: 'local_user_id',
  
  // Prekeys
  PREKEYS: 'prekeys',
  SIGNED_PREKEYS: 'signed_prekeys',
  PREKEY_ID_COUNTER: 'prekey_id_counter',
  SIGNED_PREKEY_ID: 'signed_prekey_id',
  
  // Sessions
  SESSIONS: 'sessions',
  SENDER_KEYS: 'sender_keys',
  
  // Trust
  TRUSTED_IDENTITIES: 'trusted_identities',
  VERIFIED_PREFIX: 'verified:',
  STORED_IDENTITY_PREFIX: 'identity:',
} as const;
