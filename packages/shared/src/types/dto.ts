/**
 * Rail Gun - Data Transfer Objects (DTOs)
 * Request/Response shapes for API communication
 */

import { ConversationType, PresenceStatus, DeviceType, Permission } from '../enums.js';

// ============================================================
// Auth DTOs
// ============================================================

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface RegisterResponse {
  userId: string;
  username: string;
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: DeviceType;
}

export interface LoginResponse {
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

// ============================================================
// Key Management DTOs
// ============================================================

export interface DeviceRegistrationRequest {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  /** Base64-encoded public identity key */
  identityKeyPublic: string;
  /** Signal protocol registration ID */
  registrationId: number;
  /** Signed prekey bundle */
  signedPrekey: SignedPrekeyData;
  /** One-time prekeys */
  oneTimePrekeys: PrekeyData[];
}

export interface SignedPrekeyData {
  keyId: number;
  /** Base64-encoded public key */
  publicKey: string;
  /** Base64-encoded signature */
  signature: string;
}

export interface PrekeyData {
  keyId: number;
  /** Base64-encoded public key */
  publicKey: string;
}

export interface PrekeyBundleRequest {
  userId: string;
  deviceId?: string; // If not specified, returns all devices
}

export interface PrekeyBundleResponse {
  userId: string;
  devices: DevicePrekeyBundle[];
}

export interface DevicePrekeyBundle {
  deviceId: string;
  registrationId: number;
  identityKeyPublic: string;
  signedPrekey: SignedPrekeyData;
  oneTimePrekey?: PrekeyData; // May be null if exhausted
}

export interface UploadPrekeysRequest {
  signedPrekey?: SignedPrekeyData;
  oneTimePrekeys: PrekeyData[];
}

// ============================================================
// Message DTOs
// ============================================================

export interface MessageEnvelope {
  /** Unique message ID (client-generated UUID) */
  id: string;
  /** Sender's user ID */
  senderUserId: string;
  /** Sender's device ID */
  senderDeviceId: string;
  /** Type of conversation */
  conversationType: ConversationType;
  /** Conversation ID (DM or Channel) */
  conversationId: string;
  /** Protocol version */
  protocolVersion: number;
  /** Client timestamp */
  timestamp: number;
  /** Encrypted payloads per recipient device */
  envelopes: RecipientEnvelope[];
}

export interface RecipientEnvelope {
  /** Recipient device ID */
  recipientDeviceId: string;
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Signal protocol message type */
  messageType: number;
}

export interface SendMessageRequest {
  envelope: MessageEnvelope;
}

export interface SendMessageResponse {
  messageId: string;
  serverTimestamp: number;
}

export interface MessageAck {
  messageId: string;
  status: 'delivered' | 'read';
  timestamp: number;
}

// ============================================================
// Community DTOs
// ============================================================

export interface CreateCommunityRequest {
  name: string;
  description?: string;
  isPublic?: boolean;
}

export interface CreateCommunityResponse {
  id: string;
  name: string;
  inviteCode: string;
}

export interface UpdateCommunityRequest {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface JoinCommunityRequest {
  inviteCode: string;
}

export interface CommunityResponse {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  isPublic: boolean;
  memberCount: number;
  channels: ChannelResponse[];
  roles: RoleResponse[];
}

// ============================================================
// Channel DTOs
// ============================================================

export interface CreateChannelRequest {
  communityId: string;
  name: string;
  description?: string;
}

export interface UpdateChannelRequest {
  name?: string;
  description?: string;
  position?: number;
}

export interface ChannelResponse {
  id: string;
  communityId: string;
  name: string;
  description?: string;
  position: number;
  isReadOnly: boolean;
}

// ============================================================
// Role DTOs
// ============================================================

export interface CreateRoleRequest {
  communityId: string;
  name: string;
  color?: string;
  permissions?: Permission[];
}

export interface UpdateRoleRequest {
  name?: string;
  color?: string;
  position?: number;
  permissions?: Permission[];
}

export interface RoleResponse {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: Permission[];
  isDefault: boolean;
}

// ============================================================
// DM DTOs
// ============================================================

export interface CreateDMRequest {
  /** User IDs to start a DM with */
  participantIds: string[];
  /** Optional name for group DMs */
  name?: string;
}

export interface DMConversationResponse {
  id: string;
  participantIds: string[];
  participants: UserProfileResponse[];
  name?: string;
  lastMessageAt?: string;
}

// ============================================================
// User DTOs
// ============================================================

export interface UserProfileResponse {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  presence: PresenceStatus;
  statusMessage?: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  avatarUrl?: string;
  statusMessage?: string;
}

export interface UpdatePresenceRequest {
  status: PresenceStatus;
}

// ============================================================
// Presence DTOs
// ============================================================

export interface PresenceUpdate {
  userId: string;
  status: PresenceStatus;
  lastSeenAt?: string;
}

// ============================================================
// WebSocket Event Payloads
// ============================================================

export interface WSAuthPayload {
  token: string;
  deviceId: string;
}

export interface WSMessagePayload {
  envelope: MessageEnvelope;
}

export interface WSTypingPayload {
  conversationType: ConversationType;
  conversationId: string;
  userId: string;
}

export interface WSPresencePayload {
  userId: string;
  status: PresenceStatus;
}
