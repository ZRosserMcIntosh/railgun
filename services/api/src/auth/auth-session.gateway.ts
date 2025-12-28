import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthSessionService } from './auth-session.service';

/**
 * AuthSessionGateway
 * 
 * WebSocket gateway for real-time auth session updates.
 * Clients subscribe to session updates and receive notifications when:
 * - Session is scanned
 * - Session is completed
 * - Session is cancelled/expired
 * 
 * Protocol:
 * 1. Client connects to WebSocket
 * 2. Client sends: { event: 'subscribe', data: { sessionId: '...' } }
 * 3. Server sends session updates: { event: 'session.update', data: { ... } }
 * 4. Client can unsubscribe: { event: 'unsubscribe', data: { sessionId: '...' } }
 */
@WebSocketGateway({
  namespace: '/auth',
  cors: {
    origin: '*', // Configure properly in production
  },
})
export class AuthSessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AuthSessionGateway.name);
  
  // Map of sessionId -> Set of socket IDs
  private sessionSubscribers = new Map<string, Set<string>>();
  
  // Map of socket ID -> Set of session IDs
  private socketSessions = new Map<string, Set<string>>();

  constructor(private readonly authSessionService: AuthSessionService) {}

  /**
   * Handle new WebSocket connection
   */
  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
    this.socketSessions.set(client.id, new Set());
  }

  /**
   * Handle WebSocket disconnection
   */
  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
    
    // Clean up subscriptions
    const sessions = this.socketSessions.get(client.id);
    if (sessions) {
      for (const sessionId of sessions) {
        const subscribers = this.sessionSubscribers.get(sessionId);
        if (subscribers) {
          subscribers.delete(client.id);
          if (subscribers.size === 0) {
            this.sessionSubscribers.delete(sessionId);
          }
        }
      }
      this.socketSessions.delete(client.id);
    }
  }

  /**
   * Subscribe to session updates
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): Promise<{ success: boolean; error?: string }> {
    const { sessionId } = data;

    try {
      // Verify session exists
      const session = await this.authSessionService.getSessionForWs(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      // Add subscription
      if (!this.sessionSubscribers.has(sessionId)) {
        this.sessionSubscribers.set(sessionId, new Set());
      }
      this.sessionSubscribers.get(sessionId)!.add(client.id);
      this.socketSessions.get(client.id)?.add(sessionId);

      // Join room for this session
      client.join(`session:${sessionId}`);

      this.logger.debug(`Client ${client.id} subscribed to session ${sessionId}`);

      // Send current status
      client.emit('session.status', {
        sessionId,
        status: session.status,
        expiresAt: session.expiresAt.toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Subscribe error: ${error}`);
      return { success: false, error: 'Failed to subscribe' };
    }
  }

  /**
   * Unsubscribe from session updates
   */
  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): { success: boolean } {
    const { sessionId } = data;

    // Remove subscription
    const subscribers = this.sessionSubscribers.get(sessionId);
    if (subscribers) {
      subscribers.delete(client.id);
      if (subscribers.size === 0) {
        this.sessionSubscribers.delete(sessionId);
      }
    }
    this.socketSessions.get(client.id)?.delete(sessionId);

    // Leave room
    client.leave(`session:${sessionId}`);

    this.logger.debug(`Client ${client.id} unsubscribed from session ${sessionId}`);

    return { success: true };
  }

  /**
   * Handle session scanned event
   */
  @OnEvent('auth.session.scanned')
  handleSessionScanned(payload: { sessionId: string }): void {
    this.server.to(`session:${payload.sessionId}`).emit('session.scanned', {
      sessionId: payload.sessionId,
      status: 'scanned',
    });
    this.logger.debug(`Broadcast scanned for session ${payload.sessionId}`);
  }

  /**
   * Handle session completed event
   */
  @OnEvent('auth.session.completed')
  handleSessionCompleted(payload: {
    sessionId: string;
    userId: string;
    userPublicKey: string;
  }): void {
    this.server.to(`session:${payload.sessionId}`).emit('session.completed', {
      sessionId: payload.sessionId,
      status: 'completed',
      // Don't expose userId/publicKey over WebSocket for security
      ready: true,
    });
    this.logger.debug(`Broadcast completed for session ${payload.sessionId}`);
  }

  /**
   * Handle session cancelled event
   */
  @OnEvent('auth.session.cancelled')
  handleSessionCancelled(payload: { sessionId: string }): void {
    this.server.to(`session:${payload.sessionId}`).emit('session.cancelled', {
      sessionId: payload.sessionId,
      status: 'cancelled',
    });
    this.logger.debug(`Broadcast cancelled for session ${payload.sessionId}`);
  }
}
