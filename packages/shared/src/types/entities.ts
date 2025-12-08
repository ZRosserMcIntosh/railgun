/**
 * Rail Gun - Core Entity Types
 * These types represent the core domain entities
 */

import { DeviceType, Permission, PresenceStatus } from '../enums.js';

/** Base entity with common fields */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** User entity - represents a registered user */
export interface User extends BaseEntity {
  username: string;
  displayName: string;
  avatarUrl?: string;
  /** Email is stored hashed, never in plaintext */
  emailHash: string;
  /** Argon2 password hash */
  passwordHash: string;
  /** Whether the user has verified their email */
  emailVerified: boolean;
  /** User's current presence status */
  presence: PresenceStatus;
  /** Custom status message (encrypted on client) */
  statusMessage?: string;
  /** When the user was last active */
  lastSeenAt: Date;
}

/** Public user profile (safe to share) */
export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  presence: PresenceStatus;
  statusMessage?: string;
}

/** Device entity - represents a user's device for E2E encryption */
export interface Device extends BaseEntity {
  userId: string;
  /** Unique identifier for this device instance */
  deviceId: string;
  /** Human-readable device name */
  deviceName: string;
  deviceType: DeviceType;
  /** Base64-encoded public identity key */
  identityKeyPublic: string;
  /** Device registration ID for Signal protocol */
  registrationId: number;
  /** When this device was last active */
  lastActiveAt: Date;
  /** Whether this device is currently active */
  isActive: boolean;
}

/** Community entity - like a Discord server */
export interface Community extends BaseEntity {
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  /** Invite code for joining */
  inviteCode: string;
  /** Whether the community is public/discoverable */
  isPublic: boolean;
  /** Member count (denormalized for performance) */
  memberCount: number;
}

/** Channel entity - text channel within a community */
export interface Channel extends BaseEntity {
  communityId: string;
  name: string;
  description?: string;
  /** Display order within the community */
  position: number;
  /** Whether the channel is read-only for most members */
  isReadOnly: boolean;
  /** Encrypted channel key envelope for group E2E */
  encryptedChannelKey?: string;
}

/** Membership entity - user's membership in a community */
export interface Membership extends BaseEntity {
  userId: string;
  communityId: string;
  /** Display name within this community (optional override) */
  nickname?: string;
  /** Roles assigned to this member */
  roleIds: string[];
  /** When the user joined */
  joinedAt: Date;
}

/** Role entity - defines permissions within a community */
export interface Role extends BaseEntity {
  communityId: string;
  name: string;
  /** Hex color for the role */
  color: string;
  /** Display order (lower = higher in hierarchy) */
  position: number;
  /** Permissions granted by this role */
  permissions: Permission[];
  /** Whether this is the default role for new members */
  isDefault: boolean;
}

/** DM Conversation - direct message thread between users */
export interface DMConversation extends BaseEntity {
  /** Participant user IDs (2 for 1:1, more for group DMs) */
  participantIds: string[];
  /** Optional name for group DMs */
  name?: string;
  /** ID of the last message for sorting */
  lastMessageId?: string;
  /** Timestamp of last message for sorting */
  lastMessageAt?: Date;
}

/** Message metadata - stored on server (NO PLAINTEXT) */
export interface MessageMetadata extends BaseEntity {
  /** Sender's user ID */
  senderUserId: string;
  /** Sender's device ID */
  senderDeviceId: string;
  /** Type of conversation */
  conversationType: 'DM' | 'CHANNEL';
  /** ID of the conversation (DMConversation or Channel) */
  conversationId: string;
  /** Server timestamp when message was received */
  serverTimestamp: Date;
  /** Protocol version used */
  protocolVersion: number;
  /** Encrypted message envelopes for each recipient device */
  envelopes: EncryptedEnvelope[];
}

/** Encrypted envelope for a specific recipient device */
export interface EncryptedEnvelope {
  /** Recipient device ID */
  recipientDeviceId: string;
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Message type for Signal protocol (prekey, whisper, etc.) */
  messageType: number;
}
