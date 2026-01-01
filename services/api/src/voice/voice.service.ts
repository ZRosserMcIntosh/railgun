import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

import { VoiceRoomService } from './voice-room.service';
import { VoiceSfuService } from './voice-sfu.service';
import {
  JoinChannelParams,
  LeaveChannelParams,
  VoiceJoinedPayload,
  VoicePermissions,
  RTCConfigPayload,
} from './types';
import { Permission } from '@railgun/shared';

/**
 * VoiceService
 * 
 * Orchestrates voice channel joins/leaves.
 * Handles policy decisions, SFU allocation, and TURN credential generation.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly turnSecret: string | null;
  
  // Inject CommunitiesService for permission checks
  // Note: This creates a circular dependency issue - resolve by using lazy loading
  // or a separate ChannelValidationService
  private channelValidationService: ChannelValidationServiceInterface | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly rooms: VoiceRoomService,
    private readonly sfu: VoiceSfuService,
  ) {
    this.turnSecret = this.configService.get<string>('TURN_SECRET') || null;
  }
  
  /**
   * Set the channel validation service (to avoid circular dependency).
   * Called during module initialization.
   */
  setChannelValidationService(service: ChannelValidationServiceInterface): void {
    this.channelValidationService = service;
  }

  /**
   * Join a voice channel.
   * Validates permissions, allocates SFU, creates router if needed.
   */
  async joinChannel(params: JoinChannelParams): Promise<VoiceJoinedPayload> {
    const { userId, deviceId, channelId, isPro, socketId } = params;
    // Note: rtpCapabilities from params will be used when we implement full SFU integration

    // Validate channel exists and user has permission
    await this.validateChannelAccess(userId, channelId);

    // Get or create room state
    const room = await this.rooms.getOrCreateRoom(channelId, isPro);

    // Check capacity
    const maxParticipants = room.isPro ? 25 : 8;
    if (room.participants.size >= maxParticipants) {
      throw new Error('CHANNEL_FULL');
    }

    // Ensure router exists on SFU
    const routerRtpCapabilities = await this.sfu.ensureRouter(channelId);

    // Add participant to room
    await this.rooms.addParticipant(channelId, {
      userId,
      deviceId,
      socketId,
      isPro,
      state: {
        muted: false,
        deafened: false,
        speaking: false,
        videoEnabled: false,
        screenshareEnabled: false,
      },
    });

    // Build permissions based on Pro status
    const permissions: VoicePermissions = {
      audio: true,
      video: isPro,
      screenshare: isPro,
      maxBitrate: isPro ? 64000 : 32000,
    };

    // Build RTC config with TURN credentials
    const rtcConfig = this.buildRtcConfig(userId, false); // TODO: Get privacy mode from user settings

    // Get current participants for the joining user
    // Type assertion needed until mediasoup types are installed
    type ParticipantData = { userId: string; deviceId: string; state: unknown; producers: Map<string, unknown> };
    const participantValues = Array.from(room.participants.values()) as ParticipantData[];
    const participants = participantValues
      .filter((p) => p.userId !== userId)
      .map((p) => ({
        userId: p.userId,
        deviceId: p.deviceId,
        state: p.state,
        producers: Array.from(p.producers.values()),
      })) as VoiceJoinedPayload['participants'];

    // Get SFU endpoint (for multi-region, would be from allocator)
    const sfuEndpoint = this.configService.get<string>('SFU_ENDPOINT') || 'wss://sfu.railgun.app';

    this.logger.log(`[joinChannel] user=${userId} channel=${channelId} participants=${room.participants.size}`);

    return {
      channelId,
      sfuEndpoint,
      participants,
      permissions,
      rtcConfig,
      routerRtpCapabilities,
      turnCredentialExpiresAt: rtcConfig.iceServers[0]?.username
        ? new Date(Date.now() + 86400 * 1000).toISOString()
        : undefined,
    };
  }

  /**
   * Leave a voice channel.
   */
  async leaveChannel(params: LeaveChannelParams): Promise<void> {
    const { userId, channelId, reason } = params;

    await this.rooms.removeParticipant(channelId, userId);

    this.logger.log(`[leaveChannel] user=${userId} channel=${channelId} reason=${reason}`);
  }

  /**
   * Build RTC configuration with TURN credentials.
   */
  private buildRtcConfig(userId: string, privacyMode: boolean): RTCConfigPayload {
    const iceServers: RTCConfigPayload['iceServers'] = [];

    // Add TURN server with ephemeral credentials
    if (this.turnSecret) {
      const creds = this.generateTurnCredentials(userId);
      const turnHost = this.configService.get<string>('TURN_HOST') || 'turn.railgun.app';

      iceServers.push({
        urls: [
          `turns:${turnHost}:443?transport=tcp`,
          `turn:${turnHost}:443?transport=tcp`,
        ],
        username: creds.username,
        credential: creds.credential,
      });
    }

    // Add STUN server if not in privacy mode
    if (!privacyMode) {
      const turnHost = this.configService.get<string>('TURN_HOST') || 'turn.railgun.app';
      iceServers.push({
        urls: [`stun:${turnHost}:3478`],
      });
    }

    return {
      iceServers,
      iceTransportPolicy: privacyMode ? 'relay' : 'all',
    };
  }

  /**
   * Generate ephemeral TURN credentials (TURN REST API style).
   * Username: timestamp:userId
   * Credential: HMAC-SHA1(secret, username)
   */
  private generateTurnCredentials(userId: string, ttlSeconds = 86400): { username: string; credential: string } {
    if (!this.turnSecret) {
      throw new Error('TURN_SECRET not configured');
    }

    const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${timestamp}:${userId}`;

    const hmac = createHmac('sha1', this.turnSecret);
    hmac.update(username);
    const credential = hmac.digest('base64');

    return { username, credential };
  }
  
  /**
   * Validate that a user can access a voice channel.
   * Checks: channel exists, user is member, user has CONNECT_VOICE permission, user not banned.
   */
  private async validateChannelAccess(userId: string, channelId: string): Promise<void> {
    // If no validation service configured, skip (for development)
    if (!this.channelValidationService) {
      this.logger.warn(`[validateChannelAccess] No validation service configured, skipping permission check`);
      return;
    }
    
    const result = await this.channelValidationService.validateVoiceAccess(userId, channelId);
    
    if (!result.allowed) {
      this.logger.warn(`[validateChannelAccess] Access denied: user=${userId} channel=${channelId} reason=${result.reason}`);
      throw new ForbiddenException(result.reason || 'Access denied');
    }
  }
}

/**
 * Interface for channel validation service.
 * Implemented by CommunitiesModule to avoid circular dependencies.
 */
export interface ChannelValidationServiceInterface {
  /**
   * Validate if a user can access a voice channel.
   * Checks membership, permissions, and ban status.
   */
  validateVoiceAccess(userId: string, channelId: string): Promise<{
    allowed: boolean;
    reason?: string;
    permissions?: Permission[];
  }>;
}
