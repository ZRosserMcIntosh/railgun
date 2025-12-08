/**
 * Rail Gun - Crypto Types
 * Types related to Signal protocol and encryption
 */

import { KeyType } from '../enums.js';

/** Key pair for asymmetric cryptography */
export interface KeyPair {
  /** Base64-encoded public key */
  publicKey: string;
  /** Base64-encoded private key (NEVER sent to server) */
  privateKey: string;
}

/** Identity key pair with metadata */
export interface IdentityKeyPair extends KeyPair {
  /** Fingerprint for safety number display */
  fingerprint: string;
}

/** Signed prekey with signature */
export interface SignedPrekey {
  keyId: number;
  keyPair: KeyPair;
  /** Base64-encoded signature from identity key */
  signature: string;
  /** Timestamp when this prekey was generated */
  timestamp: number;
}

/** One-time prekey */
export interface OneTimePrekey {
  keyId: number;
  keyPair: KeyPair;
}

/** Complete local key store for a device */
export interface LocalKeyStore {
  /** This device's identity key pair */
  identityKeyPair: IdentityKeyPair;
  /** Signal protocol registration ID */
  registrationId: number;
  /** Current signed prekey */
  signedPrekey: SignedPrekey;
  /** Available one-time prekeys */
  oneTimePrekeys: OneTimePrekey[];
  /** Next one-time prekey ID to generate */
  nextOnetimePrekeyId: number;
}

/** Session state with another device */
export interface SessionRecord {
  /** Remote user ID */
  remoteUserId: string;
  /** Remote device ID */
  remoteDeviceId: string;
  /** Serialized session state (Signal protocol format) */
  sessionData: string;
  /** When this session was last used */
  lastUsedAt: number;
}

/** Stored identity for verification */
export interface StoredIdentity {
  userId: string;
  deviceId: string;
  /** Base64-encoded public identity key */
  identityKeyPublic: string;
  /** Whether this identity has been verified by the user */
  verified: boolean;
  /** When this identity was first seen */
  firstSeenAt: number;
}

/** Safety number for identity verification */
export interface SafetyNumber {
  /** User IDs involved (sorted) */
  userIds: [string, string];
  /** Numeric safety number string */
  numericCode: string;
  /** QR code data for scanning */
  qrCodeData: string;
}

/** Decrypted message for local storage */
export interface DecryptedMessage {
  id: string;
  conversationType: 'DM' | 'CHANNEL';
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  /** Plaintext content (ONLY stored locally, encrypted at rest) */
  content: string;
  /** Optional attachments metadata */
  attachments?: AttachmentMeta[];
  /** Client timestamp */
  timestamp: number;
  /** Server timestamp */
  serverTimestamp: number;
  /** Whether this message is from the local user */
  isOutgoing: boolean;
}

/** Attachment metadata */
export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Encryption key for this attachment */
  encryptionKey: string;
  /** URL to encrypted blob */
  url: string;
}

/** Key entry for storage */
export interface StoredKey {
  type: KeyType;
  keyId: number;
  publicKey: string;
  privateKey?: string; // Only present for local keys
  signature?: string;
  timestamp: number;
}

/** Group/Channel encryption key */
export interface ChannelGroupKey {
  channelId: string;
  /** Key generation/version number */
  generation: number;
  /** Base64-encoded symmetric key */
  key: string;
  /** When this key was created */
  createdAt: number;
  /** User ID who created/distributed this key */
  distributedBy: string;
}
