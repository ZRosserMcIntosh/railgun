/**
 * Rail Gun - Crypto Types
 * 
 * Types related to Signal protocol and end-to-end encryption.
 * 
 * KEY SECURITY MODEL:
 * - All private keys are stored ONLY on client devices
 * - Server stores ONLY public keys
 * - Server CANNOT decrypt any messages
 */

import { KeyType } from '../enums.js';

// ============================================================================
// CORE KEY TYPES
// ============================================================================

/** 
 * Key pair for asymmetric cryptography (Curve25519).
 * Private keys NEVER leave the client device.
 */
export interface KeyPair {
  /** Base64-encoded public key (can be shared/uploaded to server) */
  publicKey: string;
  /** Base64-encoded private key (NEVER sent to server, NEVER leaves device) */
  privateKey: string;
}

/** 
 * Identity key pair with metadata.
 * Long-term device identity - generated once per device.
 */
export interface IdentityKeyPair extends KeyPair {
  /** Fingerprint for safety number display */
  fingerprint: string;
  /** When this identity was created */
  createdAt: number;
}

/** 
 * Signed prekey with signature.
 * Medium-term key signed by identity key.
 * Rotated periodically (default: every 7 days).
 */
export interface SignedPrekey {
  keyId: number;
  keyPair: KeyPair;
  /** Base64-encoded signature from identity private key */
  signature: string;
  /** Timestamp when this prekey was generated */
  timestamp: number;
}

/** 
 * One-time prekey for forward secrecy.
 * Each key is used exactly once then deleted from both client and server.
 */
export interface OneTimePrekey {
  keyId: number;
  keyPair: KeyPair;
}

// ============================================================================
// LOCAL KEY STORAGE (Client-Side Only)
// ============================================================================

/** 
 * Complete local key store for a device.
 * Stored ONLY on the client device, encrypted with device credentials.
 * Contains ALL private keys - NEVER uploaded to server.
 */
export interface LocalKeyStore {
  /** This device's identity key pair */
  identityKeyPair: IdentityKeyPair;
  
  /** Signal protocol registration ID (unique per device) */
  registrationId: number;
  
  /** Current signed prekey */
  signedPrekey: SignedPrekey;
  
  /** Previous signed prekey (kept briefly for in-flight messages) */
  previousSignedPrekey?: SignedPrekey;
  
  /** Available one-time prekeys (private keys) */
  oneTimePrekeys: OneTimePrekey[];
  
  /** Next one-time prekey ID to generate */
  nextOnetimePrekeyId: number;
  
  /** Next signed prekey ID */
  nextSignedPrekeyId: number;
}

// ============================================================================
// SERVER-SIDE KEY BUNDLE (Public Keys Only)
// ============================================================================

/**
 * Public key bundle stored on and served by the server.
 * Contains ONLY public keys - server cannot derive any secrets.
 */
export interface PublicKeyBundle {
  /** Device registration ID */
  registrationId: number;
  
  /** Base64-encoded identity public key */
  identityKey: string;
  
  /** Signed prekey (public only) */
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  
  /** One-time prekey (public only, may be absent if depleted) */
  preKey?: {
    keyId: number;
    publicKey: string;
  };
}

/**
 * Payload for registering device keys with the server.
 * Only PUBLIC keys are uploaded.
 */
export interface KeyRegistrationPayload {
  /** Device registration ID */
  registrationId: number;
  
  /** Identity PUBLIC key (base64) */
  identityKey: string;
  
  /** Signed prekey PUBLIC key + signature */
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  
  /** Batch of one-time prekey PUBLIC keys */
  preKeys: Array<{
    keyId: number;
    publicKey: string;
  }>;
}

// ============================================================================
// SESSION STATE (Client-Side Only, NEVER Uploaded)
// ============================================================================

/** Session state with another device */
export interface SessionRecord {
  /** Remote user ID */
  remoteUserId: string;
  /** Remote device ID */
  remoteDeviceId: string;
  /** Serialized session state (Signal protocol format, base64) */
  sessionData: string;
  /** When this session was established */
  createdAt: number;
  /** When this session was last used */
  lastUsedAt: number;
}

/** 
 * Double Ratchet chain state.
 * Stored ONLY on client, NEVER uploaded.
 */
export interface ChainState {
  /** Base64-encoded chain key */
  chainKey: string;
  /** Current message number in this chain */
  messageNumber: number;
}

/**
 * Full Double Ratchet session state.
 * This is stored ONLY on client devices, NEVER uploaded to server.
 */
export interface DoubleRatchetSession {
  /** Remote party's identity public key */
  remoteIdentityKey: string;
  
  /** Local identity public key */
  localIdentityKey: string;
  
  /** Root key (base64) */
  rootKey: string;
  
  /** Our current ratchet key pair */
  senderRatchetKeyPair: KeyPair;
  
  /** Their current ratchet public key */
  receiverRatchetKey?: string;
  
  /** Sending chain state */
  sendingChain: ChainState;
  
  /** Receiving chain state */
  receivingChain?: ChainState;
  
  /** Skipped message keys for out-of-order messages */
  skippedMessageKeys: Record<string, string>;
  
  /** Session creation timestamp */
  createdAt: number;
  
  /** Last activity timestamp */
  lastActivityAt: number;
}

// ============================================================================
// IDENTITY VERIFICATION
// ============================================================================

/** Stored identity for verification */
export interface StoredIdentity {
  userId: string;
  deviceId: string;
  /** Base64-encoded public identity key */
  identityKeyPublic: string;
  /** Verification state */
  verificationState: 'unverified' | 'verified' | 'changed';
  /** When this identity was first seen */
  firstSeenAt: number;
  /** When this identity was verified (if applicable) */
  verifiedAt?: number;
}

/** Safety number for identity verification */
export interface SafetyNumber {
  /** User IDs involved (sorted) */
  userIds: [string, string];
  /** Numeric safety number string (60 digits) */
  numericCode: string;
  /** QR code data for scanning */
  qrCodeData: string;
  /** Fingerprints */
  fingerprints: {
    local: string;
    remote: string;
  };
}

// ============================================================================
// MESSAGE ENCRYPTION
// ============================================================================

/**
 * Pre-key message for session establishment.
 * Sent when initiating communication with a new device.
 */
export interface PreKeyMessage {
  /** Recipient's registration ID (for verification) */
  registrationId: number;
  /** ID of one-time prekey used (if any) */
  preKeyId?: number;
  /** ID of signed prekey used */
  signedPreKeyId: number;
  /** Sender's ephemeral public key (base64) */
  ephemeralKey: string;
  /** Sender's identity public key (base64) */
  identityKey: string;
  /** The encrypted message */
  message: RatchetMessage;
}

/**
 * Regular ratchet message (after session established).
 */
export interface RatchetMessage {
  /** Sender's current ratchet public key (base64) */
  ratchetKey: string;
  /** Message counter in current sending chain */
  counter: number;
  /** Previous chain's message count */
  previousCounter: number;
  /** AES-256-GCM encrypted ciphertext (base64) */
  ciphertext: string;
}

/**
 * Complete encrypted envelope.
 * This is what the server stores and forwards.
 * Server sees this as an opaque blob - CANNOT decrypt.
 */
export interface EncryptedEnvelope {
  /** Protocol version for backwards compatibility */
  protocolVersion: number;
  /** Sender's device ID */
  senderDeviceId: number;
  /** Message type indicator */
  type: 'prekey' | 'message';
  /** Pre-key message (for new sessions) */
  preKeyMessage?: PreKeyMessage;
  /** Regular message (for established sessions) */
  message?: RatchetMessage;
  /** Timestamp (for ordering) */
  timestamp: number;
}

// ============================================================================
// PLAINTEXT MESSAGES (Before Encryption / After Decryption)
// ============================================================================

/** Message content types */
export enum MessageContentType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  VOICE = 'voice',
  REACTION = 'reaction',
  REPLY = 'reply',
  EDIT = 'edit',
  DELETE = 'delete',
  SYSTEM = 'system',
}

/** Decrypted message for local storage */
export interface DecryptedMessage {
  id: string;
  conversationType: 'DM' | 'CHANNEL';
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  /** Content type */
  contentType: MessageContentType;
  /** Plaintext content (ONLY stored locally, encrypted at rest) */
  content: string;
  /** Optional attachments metadata */
  attachments?: AttachmentMeta[];
  /** Reply reference */
  replyTo?: {
    messageId: string;
    preview: string;
  };
  /** Client timestamp */
  timestamp: number;
  /** Server timestamp */
  serverTimestamp: number;
  /** Whether this message is from the local user */
  isOutgoing: boolean;
  /** Whether message was edited */
  isEdited: boolean;
}

/** Attachment metadata */
export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Encryption key for this attachment (base64) */
  encryptionKey: string;
  /** IV/nonce for decryption (base64) */
  iv: string;
  /** URL to encrypted blob */
  url: string;
  /** Optional thumbnail for images (base64) */
  thumbnail?: string;
}

// ============================================================================
// KEY STORAGE HELPERS
// ============================================================================

/** Key entry for storage */
export interface StoredKey {
  type: KeyType;
  keyId: number;
  publicKey: string;
  privateKey?: string; // Only present for local keys
  signature?: string;
  timestamp: number;
}

/** 
 * Group/Channel encryption key.
 * For channels, we use Sender Keys for efficiency.
 */
export interface ChannelGroupKey {
  channelId: string;
  /** Key generation/version number */
  generation: number;
  /** Base64-encoded symmetric key */
  key: string;
  /** Base64-encoded chain key for forward secrecy */
  chainKey: string;
  /** When this key was created */
  createdAt: number;
  /** User ID who created/distributed this key */
  distributedBy: string;
}

// ============================================================================
// CRYPTO OPERATION RESULTS
// ============================================================================

/** Result of encrypting a message */
export interface EncryptResult {
  /** The encrypted envelope to send */
  envelope: EncryptedEnvelope;
  /** Was a new session established? */
  isNewSession: boolean;
}

/** Result of decrypting a message */
export interface DecryptResult {
  /** The decrypted plaintext */
  plaintext: string;
  /** Sender's identity key (for verification UI) */
  senderIdentityKey: string;
  /** Was this from a new session? */
  isNewSession: boolean;
}
