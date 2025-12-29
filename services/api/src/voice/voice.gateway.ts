import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

import { VoiceAuthService } from './voice-auth.service';
import { VoiceService } from './voice.service';
import { VoiceRoomService } from './voice-room.service';
import { VoiceSfuService } from './voice-sfu.service';
import {
  VoiceSession,
  VOICE_SESSION_KEY,
  JoinVoicePayload,
  LeaveVoicePayload,
  CreateTransportPayload,
  ConnectTransportPayload,
  ProducePayload,
  ConsumePayload,
  ProducerActionPayload,
  ConsumerActionPayload,
  StateUpdatePayload,
  VoiceErrorCode,
} from './types';

/**
 * VoiceGateway
 * 
 * WebSocket gateway for voice/video signaling.
 * Implements the mediasoup lifecycle from docs/VOICE_CHAT.md.
 * 
 * Security invariants:
 * - Every socket maps to exactly one authenticated user + device session
 * - All mediasoup objects (transportId, producerId, consumerId) are owned by that session
 * - Every event validates: object exists, owned by this socket, correct room
 * - Never trust IDs from client without ownership checks
 * 
 * Event flow:
 * voice:join → voice:rtc:getRouterRtpCapabilities → voice:rtc:createTransport (x2)
 * → voice:rtc:connectTransport → voice:rtc:produce → voice:rtc:consume
 */
@WebSocketGateway({
  namespace: '/voice',
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || [],
    credentials: true,
  },
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: VoiceAuthService,
    private readonly voice: VoiceService,
    private readonly rooms: VoiceRoomService,
    private readonly sfu: VoiceSfuService,
  ) {}

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  /**
   * Authenticate on connection.
   * Creates the session object that tracks ownership of all mediasoup objects.
   */
  async handleConnection(@ConnectedSocket() socket: Socket): Promise<void> {
    try {
      // Auth from handshake (JWT in query or header)
      const { userId, deviceId, isPro } = await this.auth.authenticateSocket(socket);

      // Invariant: 1 socket = 1 user + device session
      const session: VoiceSession = {
        userId,
        deviceId,
        isPro,
        transports: new Set(),
        producers: new Set(),
        consumers: new Set(),
      };
      socket.data[VOICE_SESSION_KEY] = session;

      this.logger.log(`[connect] user=${userId} device=${deviceId} socket=${socket.id}`);
    } catch (e) {
      this.logger.warn(`[connect] auth failed socket=${socket.id}: ${(e as Error).message}`);
      socket.emit('voice:error', { code: 'UNAUTHENTICATED', message: 'Authentication failed' });
      socket.disconnect(true);
    }
  }

  /**
   * Cleanup on disconnect.
   * Must be idempotent—may be called multiple ways (client leave, socket drop, worker die).
   */
  async handleDisconnect(@ConnectedSocket() socket: Socket): Promise<void> {
    try {
      const session = this.getSessionSafe(socket);
      if (!session) return;

      // If in a channel, leave it (cleans up mediasoup objects)
      if (session.joinedChannelId) {
        await this.safeLeave(socket, session.joinedChannelId, 'disconnect');
      }

      this.logger.log(`[disconnect] user=${session.userId} socket=${socket.id}`);
    } catch (e) {
      this.logger.error(`[disconnect] cleanup error socket=${socket.id}: ${(e as Error).message}`);
    }
  }

  // ===========================================================================
  // Core: Join / Leave
  // ===========================================================================

  @SubscribeMessage('voice:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: JoinVoicePayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);

    if (!body?.channelId || !body?.rtpCapabilities) {
      throw this.error('INVALID_REQUEST', 'channelId and rtpCapabilities required');
    }

    // Single room per socket rule (simplifies state management)
    if (session.joinedChannelId && session.joinedChannelId !== body.channelId) {
      await this.safeLeave(socket, session.joinedChannelId, 'switch_room');
    }

    // Join channel (validates permissions, capacity, bans, allocates SFU)
    const joinResult = await this.voice.joinChannel({
      userId: session.userId,
      deviceId: session.deviceId,
      channelId: body.channelId,
      isPro: session.isPro,
      socketId: socket.id,
      rtpCapabilities: body.rtpCapabilities,
    });

    session.joinedChannelId = body.channelId;
    session.joinedAt = Date.now();

    // Join socket.io room for broadcasts
    socket.join(this.rooms.socketRoomName(body.channelId));

    // Send full join payload
    socket.emit('voice:joined', joinResult);

    // Notify others
    socket.to(this.rooms.socketRoomName(body.channelId)).emit('voice:participant:joined', {
      userId: session.userId,
      deviceId: session.deviceId,
      state: {
        muted: false,
        deafened: false,
        speaking: false,
        videoEnabled: false,
        screenshareEnabled: false,
      },
    });

    return { ok: true };
  }

  @SubscribeMessage('voice:leave')
  async onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: LeaveVoicePayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    const channelId = body?.channelId ?? session.joinedChannelId;

    if (!channelId) {
      return { ok: true }; // Not in any channel
    }

    await this.safeLeave(socket, channelId, 'user_leave');
    return { ok: true };
  }

  // ===========================================================================
  // mediasoup Lifecycle
  // ===========================================================================

  @SubscribeMessage('voice:rtc:getRouterRtpCapabilities')
  async getRouterRtpCapabilities(
    @ConnectedSocket() socket: Socket,
  ): Promise<{ rtpCapabilities: unknown }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);

    const rtpCapabilities = await this.sfu.getRouterRtpCapabilities({
      channelId: session.joinedChannelId!,
    });

    return { rtpCapabilities };
  }

  @SubscribeMessage('voice:rtc:createTransport')
  async createTransport(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: CreateTransportPayload,
  ): Promise<unknown> {
    const session = this.getSession(socket);
    this.requireInChannel(session);

    if (!body?.direction || !['send', 'recv'].includes(body.direction)) {
      throw this.error('INVALID_REQUEST', 'direction must be "send" or "recv"');
    }

    const result = await this.sfu.createWebRtcTransport({
      channelId: session.joinedChannelId!,
      userId: session.userId,
      deviceId: session.deviceId,
      socketId: socket.id,
      direction: body.direction,
    });

    // Track ownership
    session.transports.add(result.transportId);

    return result;
  }

  @SubscribeMessage('voice:rtc:connectTransport')
  async connectTransport(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ConnectTransportPayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateTransportOwnership(session, body.transportId);

    if (!body?.dtlsParameters) {
      throw this.error('INVALID_REQUEST', 'dtlsParameters required');
    }

    await this.sfu.connectTransport({
      channelId: session.joinedChannelId!,
      socketId: socket.id,
      transportId: body.transportId,
      dtlsParameters: body.dtlsParameters,
    });

    return { ok: true };
  }

  @SubscribeMessage('voice:rtc:produce')
  async produce(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ProducePayload,
  ): Promise<{ producerId: string }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateTransportOwnership(session, body.transportId);

    if (!body?.kind || !['audio', 'video'].includes(body.kind)) {
      throw this.error('INVALID_REQUEST', 'kind must be "audio" or "video"');
    }

    if (!body?.rtpParameters) {
      throw this.error('INVALID_REQUEST', 'rtpParameters required');
    }

    const appData = body.appData ?? { source: body.kind === 'audio' ? 'mic' : 'camera' };

    // Pro gating for video/screen
    if (body.kind === 'video') {
      if (!session.isPro) {
        throw this.error('CAPABILITY_REQUIRED', 'Video requires Pro', {
          capability: appData.source === 'screen' ? 'SCREEN_SHARE' : 'VIDEO_CALLING',
        });
      }

      // Video slot limit
      const slotResult = await this.rooms.tryAcquireVideoSlot(
        session.joinedChannelId!,
        session.userId,
        appData.source,
      );

      if (!slotResult.granted) {
        throw this.error('VIDEO_SLOTS_FULL', `Video slots full, queue position: ${slotResult.queuePosition}`, {
          current: slotResult.queuePosition,
        });
      }
    }

    const { producerId } = await this.sfu.produce({
      channelId: session.joinedChannelId!,
      userId: session.userId,
      deviceId: session.deviceId,
      socketId: socket.id,
      transportId: body.transportId,
      kind: body.kind,
      rtpParameters: body.rtpParameters,
      appData,
    });

    // Track ownership
    session.producers.add(producerId);

    // Notify others so they can consume
    socket.to(this.rooms.socketRoomName(session.joinedChannelId!)).emit('voice:rtc:newProducer', {
      producerId,
      userId: session.userId,
      kind: body.kind,
      appData,
    });

    return { producerId };
  }

  @SubscribeMessage('voice:rtc:consume')
  async consume(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ConsumePayload,
  ): Promise<unknown> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateTransportOwnership(session, body.transportId);

    if (!body?.producerId || !body?.rtpCapabilities) {
      throw this.error('INVALID_REQUEST', 'producerId and rtpCapabilities required');
    }

    const result = await this.sfu.consume({
      channelId: session.joinedChannelId!,
      userId: session.userId,
      deviceId: session.deviceId,
      socketId: socket.id,
      transportId: body.transportId,
      producerId: body.producerId,
      rtpCapabilities: body.rtpCapabilities,
    });

    // Track ownership
    session.consumers.add(result.consumerId);

    return result;
  }

  @SubscribeMessage('voice:rtc:pauseProducer')
  async pauseProducer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ProducerActionPayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateProducerOwnership(session, body.producerId);

    await this.sfu.pauseProducer({
      channelId: session.joinedChannelId!,
      socketId: socket.id,
      producerId: body.producerId,
    });

    return { ok: true };
  }

  @SubscribeMessage('voice:rtc:resumeProducer')
  async resumeProducer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ProducerActionPayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateProducerOwnership(session, body.producerId);

    await this.sfu.resumeProducer({
      channelId: session.joinedChannelId!,
      socketId: socket.id,
      producerId: body.producerId,
    });

    return { ok: true };
  }

  @SubscribeMessage('voice:rtc:pauseConsumer')
  async pauseConsumer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ConsumerActionPayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateConsumerOwnership(session, body.consumerId);

    await this.sfu.pauseConsumer({
      channelId: session.joinedChannelId!,
      socketId: socket.id,
      consumerId: body.consumerId,
    });

    return { ok: true };
  }

  @SubscribeMessage('voice:rtc:resumeConsumer')
  async resumeConsumer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ConsumerActionPayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateConsumerOwnership(session, body.consumerId);

    await this.sfu.resumeConsumer({
      channelId: session.joinedChannelId!,
      socketId: socket.id,
      consumerId: body.consumerId,
    });

    return { ok: true };
  }

  @SubscribeMessage('voice:rtc:closeProducer')
  async closeProducer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ProducerActionPayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);
    this.validateProducerOwnership(session, body.producerId);

    await this.sfu.closeProducer({
      channelId: session.joinedChannelId!,
      socketId: socket.id,
      producerId: body.producerId,
    });

    // Release ownership
    session.producers.delete(body.producerId);

    // Release video slot if applicable
    await this.rooms.releaseVideoSlotByProducer(
      session.joinedChannelId!,
      session.userId,
      body.producerId,
    );

    // Notify others
    socket.to(this.rooms.socketRoomName(session.joinedChannelId!)).emit('voice:rtc:producerClosed', {
      producerId: body.producerId,
      userId: session.userId,
    });

    return { ok: true };
  }

  // ===========================================================================
  // State Updates
  // ===========================================================================

  @SubscribeMessage('voice:state:update')
  async updateState(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: StateUpdatePayload,
  ): Promise<{ ok: boolean }> {
    const session = this.getSession(socket);
    this.requireInChannel(session);

    // Rate limit speaking updates (can spam)
    if (body.speaking !== undefined) {
      const now = Date.now();
      if (session.lastStateUpdate && now - session.lastStateUpdate < 50) {
        return { ok: true }; // Silently drop rapid updates
      }
      session.lastStateUpdate = now;
    }

    await this.rooms.updateParticipantState(session.joinedChannelId!, session.userId, body);

    socket.to(this.rooms.socketRoomName(session.joinedChannelId!)).emit('voice:participant:state', {
      userId: session.userId,
      ...body,
    });

    return { ok: true };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Leave a channel safely.
   * Idempotent—can be called multiple times without error.
   */
  private async safeLeave(socket: Socket, channelId: string, reason: string): Promise<void> {
    const session = this.getSessionSafe(socket);
    if (!session) return;

    try {
      // Close all mediasoup objects owned by this session
      await this.sfu.closeAllForSession({
        channelId,
        socketId: socket.id,
        transports: [...session.transports],
        producers: [...session.producers],
        consumers: [...session.consumers],
      });
    } catch (e) {
      this.logger.error(`[safeLeave] SFU cleanup error: ${(e as Error).message}`);
    }

    // Clear ownership sets
    session.transports.clear();
    session.producers.clear();
    session.consumers.clear();

    // Leave business logic (Redis + memory)
    try {
      await this.voice.leaveChannel({
        userId: session.userId,
        deviceId: session.deviceId,
        channelId,
        socketId: socket.id,
        reason,
      });
    } catch (e) {
      this.logger.error(`[safeLeave] voice.leaveChannel error: ${(e as Error).message}`);
    }

    // Socket.io room cleanup
    socket.leave(this.rooms.socketRoomName(channelId));

    // Notify others
    socket.to(this.rooms.socketRoomName(channelId)).emit('voice:participant:left', {
      userId: session.userId,
      deviceId: session.deviceId,
      reason,
    });

    if (session.joinedChannelId === channelId) {
      session.joinedChannelId = undefined;
    }
  }

  /**
   * Get session or throw if not authenticated.
   */
  private getSession(socket: Socket): VoiceSession {
    const session = socket.data?.[VOICE_SESSION_KEY] as VoiceSession | undefined;
    if (!session) {
      throw this.error('UNAUTHENTICATED');
    }
    return session;
  }

  /**
   * Get session without throwing (for cleanup paths).
   */
  private getSessionSafe(socket: Socket): VoiceSession | undefined {
    return socket.data?.[VOICE_SESSION_KEY] as VoiceSession | undefined;
  }

  /**
   * Require user to be in a channel.
   */
  private requireInChannel(session: VoiceSession): void {
    if (!session.joinedChannelId) {
      throw this.error('NOT_IN_CHANNEL');
    }
  }

  /**
   * Validate transport ownership.
   */
  private validateTransportOwnership(session: VoiceSession, transportId: string): void {
    if (!transportId || !session.transports.has(transportId)) {
      throw this.error('TRANSPORT_NOT_OWNED');
    }
  }

  /**
   * Validate producer ownership.
   */
  private validateProducerOwnership(session: VoiceSession, producerId: string): void {
    if (!producerId || !session.producers.has(producerId)) {
      throw this.error('PRODUCER_NOT_OWNED');
    }
  }

  /**
   * Validate consumer ownership.
   */
  private validateConsumerOwnership(session: VoiceSession, consumerId: string): void {
    if (!consumerId || !session.consumers.has(consumerId)) {
      throw this.error('CONSUMER_NOT_OWNED');
    }
  }

  /**
   * Create a WsException with typed error code.
   */
  private error(
    code: VoiceErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ): WsException {
    return new WsException({ code, message, details });
  }
}
