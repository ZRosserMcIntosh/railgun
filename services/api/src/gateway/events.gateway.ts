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
import { WSEventType } from '@railgun/shared';
import { UsersService } from '../users/users.service';
import { PresenceStatus } from '@railgun/shared';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

interface ChatMessage {
  content: string;
  channelId: string;
}

@WebSocketGateway({
  cors: {
    origin: '*', // TODO: Restrict in production
  },
  namespace: '/ws',
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private connectedUsers: Map<string, Set<string>> = new Map(); // userId -> Set of socket IDs

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService
  ) {}

  afterInit(_server: Server) {
    // Gateway initialized - using stderr to avoid console.log
    process.stderr.write('WebSocket Gateway initialized\n');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // Extract token from handshake
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.emit(WSEventType.AUTH_ERROR, { message: 'No token provided' });
        client.disconnect();
        return;
      }

      // Verify JWT
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // Attach user info to socket
      client.userId = payload.sub;
      client.username = payload.username;

      // Track connected user
      if (!this.connectedUsers.has(payload.sub)) {
        this.connectedUsers.set(payload.sub, new Set());
      }
      this.connectedUsers.get(payload.sub)!.add(client.id);

      // Update user presence
      await this.usersService.updatePresence(payload.sub, PresenceStatus.ONLINE);

      // Notify client of successful auth
      client.emit(WSEventType.AUTHENTICATED, {
        userId: payload.sub,
        username: payload.username,
      });

      // Broadcast presence update to others
      client.broadcast.emit(WSEventType.PRESENCE_UPDATE, {
        userId: payload.sub,
        status: PresenceStatus.ONLINE,
      });

      process.stderr.write(`Client connected: ${payload.username} (${client.id})\n`);
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
          // Update user presence to offline
          await this.usersService.updatePresence(client.userId, PresenceStatus.OFFLINE);
          // Broadcast presence update
          this.server.emit(WSEventType.PRESENCE_UPDATE, {
            userId: client.userId,
            status: PresenceStatus.OFFLINE,
          });
        }
      }
    }
    process.stderr.write(`Client disconnected: ${client.id}\n`);
  }

  @SubscribeMessage(WSEventType.MESSAGE_SEND)
  handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ChatMessage
  ) {
    if (!client.userId) {
      return { error: 'Not authenticated' };
    }

    // For Stage 1, we just echo/broadcast plaintext messages
    // In later stages, this will handle encrypted envelopes
    const message = {
      id: Date.now().toString(), // Simple ID for now
      senderUserId: client.userId,
      senderUsername: client.username,
      content: data.content,
      channelId: data.channelId,
      timestamp: Date.now(),
    };

    // Broadcast to all connected clients (including sender for confirmation)
    this.server.emit(WSEventType.MESSAGE_RECEIVED, message);

    return { success: true, messageId: message.id };
  }

  @SubscribeMessage(WSEventType.TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channelId: string }
  ) {
    if (!client.userId) return;

    client.broadcast.emit(WSEventType.TYPING_START, {
      userId: client.userId,
      username: client.username,
      channelId: data.channelId,
    });
  }

  @SubscribeMessage(WSEventType.TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { channelId: string }
  ) {
    if (!client.userId) return;

    client.broadcast.emit(WSEventType.TYPING_STOP, {
      userId: client.userId,
      channelId: data.channelId,
    });
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() _client: AuthenticatedSocket) {
    return { event: 'pong', timestamp: Date.now() };
  }

  // Utility method to send to specific user (all their devices)
  sendToUser(userId: string, event: string, data: unknown) {
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      for (const socketId of userSockets) {
        this.server.to(socketId).emit(event, data);
      }
    }
  }

  // Get online user IDs
  getOnlineUsers(): string[] {
    return Array.from(this.connectedUsers.keys());
  }
}
