import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { WSEventType, MessageStatus, PresenceStatus } from '@railgun/shared';
import { UsersService } from '../users/users.service';
import { MessagesService } from '../messages/messages.service';
import { DmService } from '../messages/dm.service';
import { CommunitiesService } from '../communities/communities.service';
import { CryptoService } from '../crypto/crypto.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  deviceId?: number; // Device ID for multi-device routing
}

/** Per-device envelope for V2 multi-device protocol */
interface DeviceEnvelopePayload {
  deviceId: number;
  encryptedEnvelope: string;
}

/** Encrypted message payload from client */
interface EncryptedMessagePayload {
  channelId?: string;
  recipientId?: string;
  /** V1: Single envelope for channels or legacy DMs */
  encryptedEnvelope?: string;
  /** V2: Per-device envelopes for multi-device DMs */
  deviceEnvelopes?: DeviceEnvelopePayload[];
  clientNonce: string;
  protocolVersion?: number;
  replyToId?: string;
}

/** Message acknowledgment */
interface MessageAck {
  messageId: string;
  status: MessageStatus;
}

/** Typing event payload */
interface TypingPayload {
  channelId?: string;
  conversationId?: string;
}

// SECURITY: Static logger for CORS handler (class not yet instantiated)
const wsLogger = new Logger('WebSocketGateway');

@WebSocketGateway({
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      const isProduction = process.env.NODE_ENV === 'production';
      
      // SECURITY: In production, require explicit origins
      const allowedOriginsEnv = process.env.WS_CORS_ORIGINS || process.env.CORS_ORIGINS;
      
      if (isProduction && !allowedOriginsEnv) {
        wsLogger.error('CRITICAL: WS_CORS_ORIGINS or CORS_ORIGINS must be set in production');
        callback(new Error('WebSocket CORS not configured'), false);
        return;
      }
      
      const allowedOrigins = allowedOriginsEnv?.split(',').map(o => o.trim()).filter(Boolean) || [
        'http://localhost:5173',
        'http://localhost:3000',
      ];
      
      // Allow Electron app protocol in all environments
      allowedOrigins.push('app://.');
      
      // SECURITY: In production, require origin header
      if (!origin) {
        if (!isProduction) {
          callback(null, true);
        } else {
          wsLogger.warn('WebSocket: Blocked request with no origin in production');
          callback(new Error('Origin required'), false);
        }
        return;
      }
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        wsLogger.warn(`WebSocket CORS blocked: ${origin}`);
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  },
  namespace: '/ws',
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private connectedUsers: Map<string, Set<string>> = new Map(); // userId -> Set of socket IDs
  private userChannels: Map<string, Set<string>> = new Map(); // userId -> Set of channel IDs
  private userDmRooms: Map<string, Set<string>> = new Map(); // userId -> Set of DM conversation IDs
  private socketDeviceMap: Map<string, number> = new Map(); // socketId -> deviceId

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly messagesService: MessagesService,
    private readonly dmService: DmService,
    private readonly communitiesService: CommunitiesService,
    private readonly cryptoService: CryptoService,
  ) {}

  afterInit(_server: Server) {
    process.stderr.write('WebSocket Gateway initialized\n');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');
      const deviceId = client.handshake.auth?.deviceId;

      if (!token) {
        client.emit(WSEventType.AUTH_ERROR, { message: 'No token provided' });
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      client.userId = payload.sub;
      client.username = payload.username;

      // Validate and store deviceId if provided
      if (deviceId && typeof deviceId === 'number') {
        const device = await this.cryptoService.getDeviceByUserAndDeviceId(payload.sub, deviceId);
        if (device) {
          client.deviceId = deviceId;
          this.socketDeviceMap.set(client.id, deviceId);
        } else {
          wsLogger.warn(`Invalid deviceId ${deviceId} for user ${payload.sub}`);
        }
      }

      if (!this.connectedUsers.has(payload.sub)) {
        this.connectedUsers.set(payload.sub, new Set());
      }
      this.connectedUsers.get(payload.sub)!.add(client.id);

      await this.usersService.updatePresence(payload.sub, PresenceStatus.ONLINE);

      client.emit(WSEventType.AUTHENTICATED, {
        userId: payload.sub,
        username: payload.username,
        deviceId: client.deviceId,
      });

      // Broadcast presence to relevant users only (channels and DM partners)
      await this.broadcastPresenceToRelevantUsers(client.userId!, PresenceStatus.ONLINE);

      process.stderr.write(`Client connected: ${payload.username} (${client.id}) deviceId: ${client.deviceId || 'none'}\n`);
    } catch {
      client.emit(WSEventType.AUTH_ERROR, { message: 'Invalid token' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      const userSockets = this.connectedUsers.get(client.userId);
      if (userSockets) {
        userSockets.delete(client.id);
        if (userSockets.size === 0) {
          this.connectedUsers.delete(client.userId);
          await this.usersService.updatePresence(client.userId, PresenceStatus.OFFLINE);
          await this.broadcastPresenceToRelevantUsers(client.userId, PresenceStatus.OFFLINE);
        }
      }
      
      // Clean up device mapping
      this.socketDeviceMap.delete(client.id);

      // Clean up channel/DM room tracking
      this.userChannels.delete(client.userId);
      this.userDmRooms.delete(client.userId);
    }
    process.stderr.write(`Client disconnected: ${client.id}\n`);
  }

  @SubscribeMessage(WSEventType.MESSAGE_SEND)
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: EncryptedMessagePayload,
  ) {
    if (!client.userId) {
      return { error: 'Not authenticated' };
    }

    try {
      // Authorization checks
      if (data.channelId) {
        const canAccess = await this.communitiesService.canAccessChannel(
          data.channelId,
          client.userId,
        );
        if (!canAccess) {
          return { error: 'Access denied to channel' };
        }
      } else if (data.recipientId) {
        // Validate recipient exists
        const recipient = await this.usersService.findById(data.recipientId);
        if (!recipient) {
          return { error: 'Recipient not found' };
        }
        // Create or get DM conversation
        await this.dmService.startDmByUserId(client.userId, data.recipientId);
      }

      // Check for duplicate
      const existing = await this.messagesService.existsByClientNonce(
        client.userId,
        data.clientNonce,
      );

      if (existing) {
        return { success: true, messageId: existing.id, duplicate: true };
      }

      // Detect V2 format: deviceEnvelopes at top level for multi-device DMs
      const isV2 = data.recipientId && 
                   Array.isArray(data.deviceEnvelopes) && 
                   data.deviceEnvelopes.length > 0;

      let message;

      if (isV2 && data.deviceEnvelopes && data.recipientId) {
        // V2 DM: Store per-device envelopes and route to specific devices

        // Create V2 message with envelopes
        message = await this.messagesService.createWithEnvelopes(
          client.userId,
          {
            recipientId: data.recipientId,
            encryptedEnvelope: data.deviceEnvelopes[0]?.encryptedEnvelope || '{}', // Store first envelope as primary
            clientNonce: data.clientNonce,
            protocolVersion: data.protocolVersion || 2,
            replyToId: data.replyToId,
          },
          data.deviceEnvelopes.map(env => ({
            recipientUserId: data.recipientId!,
            recipientDeviceId: env.deviceId,
            encryptedEnvelope: env.encryptedEnvelope,
          })),
        );

        // Update DM last message time
        if (message.conversationId) {
          await this.dmService.updateLastMessage(message.conversationId);
        }

        // Route to each recipient device
        for (const env of data.deviceEnvelopes) {
          const devicePayload = {
            id: message.id,
            senderId: client.userId,
            senderUsername: client.username,
            conversationId: message.conversationId,
            conversationType: message.conversationType,
            // Send the envelope directly - it's already in the right format
            encryptedEnvelope: env.encryptedEnvelope,
            protocolVersion: data.protocolVersion || 2,
            replyToId: message.replyToId,
            createdAt: message.createdAt,
          };

          this.sendToUserDevice(
            data.recipientId,
            env.deviceId,
            WSEventType.MESSAGE_RECEIVED,
            devicePayload,
          );
        }
      } else {
        // V1 or channel message: Use existing logic
        message = await this.messagesService.create(client.userId, {
          channelId: data.channelId,
          recipientId: data.recipientId,
          encryptedEnvelope: data.encryptedEnvelope || '{}',
          clientNonce: data.clientNonce,
          protocolVersion: data.protocolVersion,
          replyToId: data.replyToId,
        });

        // Update DM last message time
        if (message.conversationId) {
          await this.dmService.updateLastMessage(message.conversationId);
        }

        const messagePayload = {
          id: message.id,
          senderId: client.userId,
          senderUsername: client.username,
          channelId: message.channelId,
          conversationId: message.conversationId,
          conversationType: message.conversationType,
          encryptedEnvelope: message.encryptedEnvelope,
          protocolVersion: message.protocolVersion,
          replyToId: message.replyToId,
          createdAt: message.createdAt,
        };

        // Broadcast using rooms
        if (data.channelId) {
          // Send to channel room only
          this.server.to(`channel:${data.channelId}`).emit(WSEventType.MESSAGE_RECEIVED, messagePayload);
        } else if (data.recipientId && message.conversationId) {
          // V1 DM: Send to DM room and also directly to recipient
          this.server.to(`dm:${message.conversationId}`).emit(WSEventType.MESSAGE_RECEIVED, messagePayload);
          // Also send directly to all recipient's connected sockets (for delivery without room join)
          this.sendToUser(data.recipientId, WSEventType.MESSAGE_RECEIVED, messagePayload);
          // Also send to sender if not in room (fallback)
          client.emit(WSEventType.MESSAGE_RECEIVED, messagePayload);
        }
      }

      client.emit(WSEventType.MESSAGE_ACK, {
        clientNonce: data.clientNonce,
        messageId: message.id,
        status: MessageStatus.SENT,
      });

      return { success: true, messageId: message.id };
    } catch (error) {
      client.emit(WSEventType.MESSAGE_ERROR, {
        clientNonce: data.clientNonce,
        error: error instanceof Error ? error.message : 'Failed to send message',
      });
      return { error: 'Failed to send message' };
    }
  }

  @SubscribeMessage(WSEventType.MESSAGE_ACK)
  async handleMessageAck(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MessageAck,
  ) {
    if (!client.userId) return;

    try {
      // SECURITY: Pass userId for authorization check
      await this.messagesService.updateStatus(data.messageId, data.status, client.userId);

      const message = await this.messagesService.getById(data.messageId);
      this.sendToUser(message.senderId, WSEventType.MESSAGE_ACK, {
        messageId: data.messageId,
        status: data.status,
      });
    } catch {
      // Silently fail - ack updates are best-effort
      // Note: This may fail if user doesn't have access to the message
    }
  }

  @SubscribeMessage('channel:join')
  async handleChannelJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channelId: string },
  ) {
    if (!client.userId) return { error: 'Not authenticated' };

    // Verify channel access
    const canAccess = await this.communitiesService.canAccessChannel(
      data.channelId,
      client.userId,
    );
    if (!canAccess) {
      return { error: 'Access denied' };
    }

    client.join(`channel:${data.channelId}`);

    if (!this.userChannels.has(client.userId)) {
      this.userChannels.set(client.userId, new Set());
    }
    this.userChannels.get(client.userId)!.add(data.channelId);

    return { success: true };
  }

  @SubscribeMessage('channel:leave')
  handleChannelLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channelId: string },
  ) {
    if (!client.userId) return;

    client.leave(`channel:${data.channelId}`);

    const channels = this.userChannels.get(client.userId);
    if (channels) {
      channels.delete(data.channelId);
    }

    return { success: true };
  }

  @SubscribeMessage('dm:join')
  async handleDmJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return { error: 'Not authenticated' };

    // Verify DM participation
    const isParticipant = await this.dmService.isParticipant(
      data.conversationId,
      client.userId,
    );
    if (!isParticipant) {
      return { error: 'Access denied' };
    }

    client.join(`dm:${data.conversationId}`);

    if (!this.userDmRooms.has(client.userId)) {
      this.userDmRooms.set(client.userId, new Set());
    }
    this.userDmRooms.get(client.userId)!.add(data.conversationId);

    return { success: true };
  }

  @SubscribeMessage('dm:leave')
  handleDmLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!client.userId) return;

    client.leave(`dm:${data.conversationId}`);

    const dmRooms = this.userDmRooms.get(client.userId);
    if (dmRooms) {
      dmRooms.delete(data.conversationId);
    }

    return { success: true };
  }

  @SubscribeMessage(WSEventType.TYPING_START)
  async handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: TypingPayload,
  ) {
    if (!client.userId) return;

    const typingPayload = {
      userId: client.userId,
      username: client.username,
      channelId: data.channelId,
      conversationId: data.conversationId,
    };

    // Emit to specific room only
    if (data.channelId) {
      client.to(`channel:${data.channelId}`).emit(WSEventType.TYPING_START, typingPayload);
    } else if (data.conversationId) {
      client.to(`dm:${data.conversationId}`).emit(WSEventType.TYPING_START, typingPayload);
    }
  }

  @SubscribeMessage(WSEventType.TYPING_STOP)
  async handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: TypingPayload,
  ) {
    if (!client.userId) return;

    const typingPayload = {
      userId: client.userId,
      channelId: data.channelId,
      conversationId: data.conversationId,
    };

    if (data.channelId) {
      client.to(`channel:${data.channelId}`).emit(WSEventType.TYPING_STOP, typingPayload);
    } else if (data.conversationId) {
      client.to(`dm:${data.conversationId}`).emit(WSEventType.TYPING_STOP, typingPayload);
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() _client: AuthenticatedSocket) {
    return { event: 'pong', timestamp: Date.now() };
  }

  // Send to specific user (all their devices)
  sendToUser(userId: string, event: string, data: unknown) {
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      for (const socketId of userSockets) {
        this.server.to(socketId).emit(event, data);
      }
    }
  }

  /**
   * Send to a specific user's device.
   * Falls back to sending to all user's devices if device not found.
   */
  private sendToUserDevice(
    userId: string,
    deviceId: number,
    event: WSEventType,
    payload: unknown,
  ): void {
    const userSockets = this.connectedUsers.get(userId);
    if (!userSockets) return;

    let sent = false;
    for (const socketId of userSockets) {
      const socketDeviceId = this.socketDeviceMap.get(socketId);
      if (socketDeviceId === deviceId) {
        this.server.to(socketId).emit(event, payload);
        sent = true;
        break;
      }
    }

    // If specific device not connected, message will be fetched on reconnect
    // Optionally, we could send to all devices as fallback:
    if (!sent) {
      // Log for debugging but don't send to wrong devices
      wsLogger.debug(`Device ${deviceId} for user ${userId} not connected, message queued`);
    }
  }

  // Broadcast presence to users in shared channels and DM partners
  private async broadcastPresenceToRelevantUsers(
    userId: string,
    status: PresenceStatus,
  ): Promise<void> {
    const userChannelSet = this.userChannels.get(userId);
    
    // Broadcast to all channels the user is in
    if (userChannelSet) {
      for (const channelId of userChannelSet) {
        this.server.to(`channel:${channelId}`).emit(WSEventType.PRESENCE_UPDATE, {
          userId,
          status,
        });
      }
    }

    // Broadcast to DM partners
    const dmConversations = await this.dmService.getUserDms(userId);
    for (const dm of dmConversations) {
      this.sendToUser(dm.peerId, WSEventType.PRESENCE_UPDATE, {
        userId,
        status,
      });
    }
  }

  getOnlineUsers(): string[] {
    return Array.from(this.connectedUsers.keys());
  }
}
