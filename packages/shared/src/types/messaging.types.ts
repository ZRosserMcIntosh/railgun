/**
 * Rail Gun - Messaging Types
 * Types for E2E encrypted messaging with multi-device support
 */

// ============================================================================
// Per-Device Envelope Types (Protocol V2)
// ============================================================================

/** Per-device encrypted envelope */
export interface DeviceEnvelope {
  /** Target device ID */
  recipientDeviceId: number;
  /** Base64 ciphertext encrypted for this device */
  ciphertext: string;
  /** 'prekey' for initial message, 'message' for subsequent */
  messageType: 'prekey' | 'message';
}

/** V2 DM message with per-device envelopes */
export interface EncryptedDmMessageV2 {
  /** Message type */
  type: 'dm';
  /** Sender's device ID */
  senderDeviceId: number;
  /** Sender's registration ID (for prekey messages) */
  registrationId?: number;
  /** Protocol version - always 2 for this type */
  protocolVersion: 2;
  /** Per-recipient-device envelopes */
  envelopes: DeviceEnvelope[];
  /** Envelopes for sender's other devices (for sync) */
  senderEnvelopes?: DeviceEnvelope[];
}

/** V1 backward-compat single envelope (deprecated) */
export interface EncryptedDmMessageV1 {
  /** Message type */
  type: 'dm';
  /** Sender's device ID */
  senderDeviceId: number;
  /** Base64 ciphertext (single envelope) */
  ciphertext: string;
  /** Message type for Signal protocol */
  messageType?: 'prekey' | 'message';
  /** Sender's registration ID (for prekey messages) */
  registrationId?: number;
  /** Protocol version - 1 or undefined for V1 */
  protocolVersion?: 1;
}

/** Union type for DM messages (V1 or V2) */
export type EncryptedDmMessage = EncryptedDmMessageV1 | EncryptedDmMessageV2;

/** Channel message envelope (uses sender keys) */
export interface EncryptedChannelMessage {
  /** Message type */
  type: 'channel';
  /** Base64 ciphertext */
  ciphertext: string;
  /** Sender's device ID */
  senderDeviceId: number;
  /** Distribution ID (usually channel ID) */
  distributionId: string;
}

/** Union type for all encrypted message types */
export type EncryptedMessage = EncryptedDmMessage | EncryptedChannelMessage;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if message is V2 format with per-device envelopes */
export function isV2DmMessage(msg: EncryptedDmMessage): msg is EncryptedDmMessageV2 {
  return msg.protocolVersion === 2 && 'envelopes' in msg && Array.isArray(msg.envelopes);
}

/** Check if message is V1 format with single envelope */
export function isV1DmMessage(msg: EncryptedDmMessage): msg is EncryptedDmMessageV1 {
  return !isV2DmMessage(msg) && 'ciphertext' in msg;
}

/** Check if message is a channel message */
export function isChannelMessage(msg: EncryptedMessage): msg is EncryptedChannelMessage {
  return msg.type === 'channel';
}

/** Check if message is a DM */
export function isDmMessage(msg: EncryptedMessage): msg is EncryptedDmMessage {
  return msg.type === 'dm';
}

// ============================================================================
// Server Message Types
// ============================================================================

/** Message as received from server (encrypted) */
export interface ServerEncryptedMessage {
  /** Message UUID */
  id: string;
  /** Sender's user ID */
  senderId: string;
  /** Sender's username */
  senderUsername?: string;
  /** Channel ID (for channel messages) */
  channelId?: string;
  /** Conversation ID (for DMs) */
  conversationId?: string;
  /** Conversation type */
  conversationType: 'DM' | 'CHANNEL';
  /** JSON-encoded encrypted envelope */
  encryptedEnvelope: string;
  /** Protocol version */
  protocolVersion: number;
  /** ISO timestamp */
  createdAt: string;
  /** Reply-to message ID */
  replyToId?: string;
}
