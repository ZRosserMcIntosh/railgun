/**
 * Rail Gun - Cryptographic Types
 * 
 * These types define the key model where the server PROVABLY
 * never holds decryption keys. All private keys remain on client devices.
 */

// ============================================================================
// KEY TYPES - Client Side (includes private keys)
// ============================================================================

/**
 * A Curve25519 key pair.
 * The private key NEVER leaves the client device.
 */
export interface KeyPair {
  /** Public key (can be shared/uploaded to server) */
  publicKey: Uint8Array;
  /** Private key (NEVER leaves device) */
  privateKey: Uint8Array;
}

/**
 * Identity key pair - Long-term device identity.
 * Generated once per device, only replaced if device is reset.
 */
export interface IdentityKeyPair extends KeyPair {
  /** When this identity was created */
  createdAt: number;
}

/**
 * Signed pre-key - Medium-term key signed by identity.
 * Rotated periodically (default: every 7 days).
 */
export interface SignedPreKey {
  keyId: number;
  keyPair: KeyPair;
  /** Signature of the public key by the identity private key */
  signature: Uint8Array;
  /** Timestamp when this key was generated */
  createdAt: number;
}

/**
 * One-time pre-key - Ephemeral key for forward secrecy.
 * Each key is used exactly once then discarded.
 */
export interface PreKey {
  keyId: number;
  keyPair: KeyPair;
}

/**
 * Complete local key store for a device.
 * ALL private keys are stored here, encrypted by device credentials.
 * This data NEVER leaves the device.
 */
export interface LocalKeyStore {
  /** Unique registration ID for this device */
  registrationId: number;
  
  /** Long-term identity key pair */
  identityKeyPair: IdentityKeyPair;
  
  /** Current signed pre-key (rotated weekly) */
  signedPreKey: SignedPreKey;
  
  /** Previous signed pre-key (kept briefly for in-flight messages) */
  previousSignedPreKey?: SignedPreKey;
  
  /** Pool of one-time pre-keys */
  preKeys: Map<number, PreKey>;
  
  /** Next pre-key ID to generate */
  nextPreKeyId: number;
  
  /** Next signed pre-key ID */
  nextSignedPreKeyId: number;
}

// ============================================================================
// KEY TYPES - Server Side (PUBLIC KEYS ONLY)
// ============================================================================

/**
 * Public key bundle stored on server.
 * Contains ONLY public keys - server cannot derive any secrets.
 */
export interface PublicKeyBundle {
  /** Device registration ID */
  registrationId: number;
  
  /** Identity public key (base64) */
  identityKey: string;
  
  /** Signed pre-key public key (base64) */
  signedPreKey: {
    keyId: number;
    publicKey: string;
    /** Signature proving this key belongs to the identity */
    signature: string;
  };
  
  /** Available one-time pre-key (base64) - may be absent if depleted */
  preKey?: {
    keyId: number;
    publicKey: string;
  };
}

/**
 * Keys uploaded during device registration.
 * Only PUBLIC keys are sent to server.
 */
export interface KeyRegistrationPayload {
  registrationId: number;
  
  /** Identity PUBLIC key only */
  identityKey: string;
  
  /** Signed pre-key PUBLIC key + signature */
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  
  /** Batch of one-time pre-key PUBLIC keys */
  preKeys: Array<{
    keyId: number;
    publicKey: string;
  }>;
}

// ============================================================================
// SESSION TYPES - Client Side Only (NEVER sent to server)
// ============================================================================

/**
 * Symmetric ratchet state for one direction of communication.
 */
export interface ChainState {
  /** Current chain key */
  chainKey: Uint8Array;
  /** Message counter */
  messageNumber: number;
}

/**
 * Double Ratchet session state.
 * This is stored ONLY on client devices, NEVER uploaded.
 */
export interface SessionState {
  /** Remote party's identity public key */
  remoteIdentityKey: Uint8Array;
  
  /** Local identity public key */
  localIdentityKey: Uint8Array;
  
  /** Current root key */
  rootKey: Uint8Array;
  
  /** Our current ratchet key pair */
  senderRatchetKeyPair: KeyPair;
  
  /** Their current ratchet public key */
  receiverRatchetKey?: Uint8Array;
  
  /** Sending chain state */
  sendingChain: ChainState;
  
  /** Receiving chain state */
  receivingChain?: ChainState;
  
  /** Previous sending chains (for out-of-order messages) */
  previousSendingChains: Map<string, ChainState>;
  
  /** Skipped message keys (for out-of-order decryption) */
  skippedMessageKeys: Map<string, Uint8Array>;
  
  /** Session creation timestamp */
  createdAt: number;
  
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Collection of sessions with different users/devices.
 * Stored ONLY on client, NEVER uploaded.
 */
export interface SessionStore {
  /** Map of recipientId:deviceId -> SessionState */
  sessions: Map<string, SessionState>;
}

// ============================================================================
// MESSAGE ENVELOPE TYPES
// ============================================================================

/**
 * Pre-key message - sent to establish a new session.
 * Contains enough info for recipient to derive shared secret.
 */
export interface PreKeyMessagePayload {
  /** Recipient's registration ID (for verification) */
  registrationId: number;
  
  /** ID of one-time pre-key used (if any) */
  preKeyId?: number;
  
  /** ID of signed pre-key used */
  signedPreKeyId: number;
  
  /** Sender's ephemeral public key (base64) */
  ephemeralKey: string;
  
  /** Sender's identity public key (base64) */
  identityKey: string;
  
  /** The encrypted message payload */
  message: EncryptedMessagePayload;
}

/**
 * Regular encrypted message (after session established).
 */
export interface EncryptedMessagePayload {
  /** Sender's current ratchet public key (base64) */
  ratchetKey: string;
  
  /** Message counter in current chain */
  counter: number;
  
  /** Previous chain's message count (for skipped message handling) */
  previousCounter: number;
  
  /** AES-256-GCM encrypted ciphertext (base64) */
  ciphertext: string;
}

/**
 * Complete encrypted envelope sent over the wire.
 * Server sees this as an opaque blob - cannot decrypt.
 */
export interface EncryptedEnvelope {
  /** Protocol version for backwards compatibility */
  protocolVersion: number;
  
  /** Sender's device ID */
  senderDeviceId: number;
  
  /** Message type */
  type: 'prekey' | 'message';
  
  /** Pre-key message (for session establishment) */
  preKeyMessage?: PreKeyMessagePayload;
  
  /** Regular message (for established sessions) */
  message?: EncryptedMessagePayload;
  
  /** Timestamp (for ordering) */
  timestamp: number;
}

// ============================================================================
// PLAINTEXT MESSAGE TYPES (before encryption / after decryption)
// ============================================================================

/**
 * Message content types.
 */
export enum MessageContentType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  REACTION = 'reaction',
  REPLY = 'reply',
  EDIT = 'edit',
  DELETE = 'delete',
  SYSTEM = 'system',
}

/**
 * Plaintext message structure (encrypted before sending).
 */
export interface PlaintextMessage {
  /** Content type */
  type: MessageContentType;
  
  /** Text content */
  text?: string;
  
  /** File/image attachment metadata */
  attachment?: {
    /** Encrypted file URL */
    url: string;
    /** File name */
    name: string;
    /** MIME type */
    mimeType: string;
    /** File size in bytes */
    size: number;
    /** Decryption key for the file (base64) */
    key: string;
    /** Thumbnail (for images, base64) */
    thumbnail?: string;
  };
  
  /** Reply reference */
  replyTo?: {
    messageId: string;
    /** Preview of replied message (may be truncated) */
    preview: string;
  };
  
  /** For edits: ID of message being edited */
  editedMessageId?: string;
  
  /** For reactions: the reaction emoji */
  reaction?: string;
  
  /** Client-side timestamp */
  clientTimestamp: number;
}

// ============================================================================
// VERIFICATION TYPES
// ============================================================================

/**
 * Safety number for identity verification.
 * Computed from both parties' identity keys.
 */
export interface SafetyNumber {
  /** Numeric representation (60 digits) */
  numbers: string;
  
  /** QR code data for scanning */
  qrData: Uint8Array;
  
  /** Fingerprint of local identity key */
  localFingerprint: string;
  
  /** Fingerprint of remote identity key */
  remoteFingerprint: string;
}

/**
 * Identity verification state.
 */
export enum VerificationState {
  /** Not yet verified */
  UNVERIFIED = 'unverified',
  /** Verified by user (e.g., scanned QR code) */
  VERIFIED = 'verified',
  /** Identity key changed since last verification */
  CHANGED = 'changed',
}

// ============================================================================
// CRYPTO OPERATION TYPES
// ============================================================================

/**
 * Result of encrypting a message.
 */
export interface EncryptResult {
  /** The encrypted envelope to send */
  envelope: EncryptedEnvelope;
  
  /** Updated session state (store locally) */
  updatedSession: SessionState;
}

/**
 * Result of decrypting a message.
 */
export interface DecryptResult {
  /** The decrypted plaintext message */
  plaintext: PlaintextMessage;
  
  /** Updated session state (store locally) */
  updatedSession: SessionState;
  
  /** Sender's identity key (for verification UI) */
  senderIdentityKey: Uint8Array;
}

/**
 * Result of X3DH key agreement.
 */
export interface X3DHResult {
  /** Shared secret (32 bytes) */
  sharedSecret: Uint8Array;
  
  /** Ephemeral key pair used (public key sent to recipient) */
  ephemeralKeyPair: KeyPair;
  
  /** Associated data for AEAD */
  associatedData: Uint8Array;
}
