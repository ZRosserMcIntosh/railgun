/**
 * Voice/Video Types
 * 
 * Shared DTOs and interfaces for the voice system.
 * Matches the spec in docs/VOICE_CHAT.md
 */

// Use stub types when mediasoup is not installed
import type { types as mediasoupTypes } from './mediasoup-types';

// ============================================================================
// Session & Ownership
// ============================================================================

/**
 * Per-socket session data.
 * Invariant: 1 socket = 1 user + 1 device session.
 * All mediasoup objects are owned by this session.
 */
export interface VoiceSession {
  userId: string;
  deviceId: string;
  isPro: boolean;
  
  // Current room (single room per socket)
  joinedChannelId?: string;
  
  // Ownership tracking - validates all incoming IDs
  transports: Set<string>;
  producers: Set<string>;
  consumers: Set<string>;
  
  // Timestamps for rate limiting
  joinedAt?: number;
  lastStateUpdate?: number;
}

export const VOICE_SESSION_KEY = 'rg_voice_session';

// ============================================================================
// Client → Server Events
// ============================================================================

export interface JoinVoicePayload {
  channelId: string;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
}

export interface LeaveVoicePayload {
  channelId: string;
}

export interface CreateTransportPayload {
  direction: 'send' | 'recv';
}

export interface ConnectTransportPayload {
  transportId: string;
  dtlsParameters: mediasoupTypes.DtlsParameters;
}

export interface ProducePayload {
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  appData?: ProducerAppData;
}

export interface ProducerAppData {
  source: 'mic' | 'camera' | 'screen';
}

export interface ConsumePayload {
  transportId: string;
  producerId: string;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
}

export interface ProducerActionPayload {
  producerId: string;
}

export interface ConsumerActionPayload {
  consumerId: string;
}

export interface StateUpdatePayload {
  muted?: boolean;
  deafened?: boolean;
  speaking?: boolean;
}

// ============================================================================
// Server → Client Events
// ============================================================================

export interface VoiceJoinedPayload {
  channelId: string;
  sfuEndpoint: string;
  participants: VoiceParticipantInfo[];
  permissions: VoicePermissions;
  rtcConfig: RTCConfigPayload;
  routerRtpCapabilities: mediasoupTypes.RtpCapabilities;
  turnCredentialExpiresAt?: string;
}

export interface VoicePermissions {
  audio: boolean;
  video: boolean;
  screenshare: boolean;
  maxBitrate: number;
}

export interface RTCConfigPayload {
  iceServers: RTCIceServer[];
  iceTransportPolicy: 'all' | 'relay';
}

export interface RTCIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface VoiceParticipantInfo {
  userId: string;
  deviceId: string;
  state: ParticipantState;
  producers: ProducerInfo[];
}

export interface ParticipantState {
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  videoEnabled: boolean;
  screenshareEnabled: boolean;
}

export interface ProducerInfo {
  producerId: string;
  kind: 'audio' | 'video';
  appData: ProducerAppData;
}

export interface TransportCreatedPayload {
  transportId: string;
  iceParameters: mediasoupTypes.IceParameters;
  iceCandidates: mediasoupTypes.IceCandidate[];
  dtlsParameters: mediasoupTypes.DtlsParameters;
}

export interface ProducedPayload {
  producerId: string;
}

export interface ConsumedPayload {
  consumerId: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  appData: ProducerAppData;
}

export interface NewProducerPayload {
  producerId: string;
  userId: string;
  kind: 'audio' | 'video';
  appData: ProducerAppData;
}

export interface ParticipantJoinedPayload {
  userId: string;
  deviceId: string;
  state: ParticipantState;
}

export interface ParticipantLeftPayload {
  userId: string;
  deviceId: string;
  reason: string;
}

export interface ParticipantStatePayload {
  userId: string;
  state: Partial<ParticipantState>;
}

export interface ProducerClosedPayload {
  producerId: string;
  userId: string;
}

// ============================================================================
// Error Types
// ============================================================================

export type VoiceErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_REQUEST'
  | 'NOT_IN_CHANNEL'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_FULL'
  | 'PERMISSION_DENIED'
  | 'BANNED'
  | 'TRANSPORT_NOT_OWNED'
  | 'PRODUCER_NOT_OWNED'
  | 'CONSUMER_NOT_OWNED'
  | 'CAPABILITY_REQUIRED'
  | 'VIDEO_SLOTS_FULL'
  | 'TRANSPORT_FAILED'
  | 'PRODUCER_FAILED'
  | 'CONSUMER_FAILED'
  | 'SFU_ERROR'
  | 'RATE_LIMITED';

export interface VoiceErrorPayload {
  code: VoiceErrorCode;
  message?: string;
  details?: {
    capability?: 'VIDEO_CALLING' | 'SCREEN_SHARE';
    current?: number;
    max?: number;
    retryAfter?: number;
  };
}

// ============================================================================
// Internal Service Types
// ============================================================================

export interface JoinChannelParams {
  userId: string;
  deviceId: string;
  channelId: string;
  isPro: boolean;
  socketId: string;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
}

export interface LeaveChannelParams {
  userId: string;
  deviceId: string;
  channelId: string;
  socketId: string;
  reason: string;
}

export interface CreateTransportParams {
  channelId: string;
  userId: string;
  deviceId: string;
  socketId: string;
  direction: 'send' | 'recv';
}

export interface ConnectTransportParams {
  channelId: string;
  socketId: string;
  transportId: string;
  dtlsParameters: mediasoupTypes.DtlsParameters;
}

export interface ProduceParams {
  channelId: string;
  userId: string;
  deviceId: string;
  socketId: string;
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: mediasoupTypes.RtpParameters;
  appData: ProducerAppData;
}

export interface ConsumeParams {
  channelId: string;
  userId: string;
  deviceId: string;
  socketId: string;
  transportId: string;
  producerId: string;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
}

export interface CloseSessionParams {
  channelId: string;
  socketId: string;
  transports: string[];
  producers: string[];
  consumers: string[];
}

// ============================================================================
// Video Slot Queue
// ============================================================================

export interface VideoSlotQueue {
  roomId: string;
  maxSlots: number;
  activePublishers: Map<string, string>; // producerId -> userId
  waitingQueue: string[]; // userId[], FIFO
}

export interface VideoSlotResult {
  granted: boolean;
  queuePosition?: number;
}

// ============================================================================
// SFU Allocation
// ============================================================================

export interface SFUAssignment {
  sfuNodeId: string;
  sfuEndpoint: string;
  roomId: string;
}

export interface SFUNodeHealth {
  nodeId: string;
  region: string;
  activeRooms: number;
  activeParticipants: number;
  cpuPercent: number;
  memoryPercent: number;
  status: 'healthy' | 'degraded' | 'overloaded' | 'draining';
  capacityScore: number;
}

// ============================================================================
// Room State
// ============================================================================

export interface VoiceRoomState {
  channelId: string;
  sfuNodeId: string;
  routerId?: string;
  participants: Map<string, VoiceRoomParticipant>;
  videoSlotQueue: VideoSlotQueue;
  createdAt: Date;
  isPro: boolean; // Community Pro status
}

export interface VoiceRoomParticipant {
  userId: string;
  deviceId: string;
  socketId: string;
  isPro: boolean;
  state: ParticipantState;
  sendTransportId?: string;
  recvTransportId?: string;
  producers: Map<string, ProducerInfo>;
  consumers: Set<string>;
  joinedAt: Date;
}
