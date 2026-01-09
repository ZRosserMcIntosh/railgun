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
import { ConfigService } from '@nestjs/config';
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
 * 
 * SECURITY: CORS restricted, rate limiting on subscriptions
 */
@WebSocketGateway({
  namespace: '/auth',
  cors: {
    // SECURITY: Restrict CORS to allowed origins (configured via environment)
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (e.g., mobile apps, same-origin)
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // In development, allow localhost
      if (process.env.NODE_ENV !== 'production') {
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          callback(null, true);
          return;
        }
      }
      
      // Check against allowed origins from config
      const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') {
        // Allow all in dev if no origins configured
        callback(null, true);
        return;
      }
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'), false);
      }
    },
    credentials: true,
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
  
  // Rate limiting: track subscription attempts per socket
  private socketSubscriptionCount = new Map<string, { count: number; resetAt: number }>();
  private readonly MAX_SUBSCRIPTIONS_PER_MINUTE = 20;

  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly configService: ConfigService,
  ) {}

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
    
    // Clean up rate limit tracking
    this.socketSubscriptionCount.delete(client.id);
  }

  /**
   * Check rate limit for subscription attempts
   */
  private checkSubscriptionRateLimit(clientId: string): boolean {
    const now = Date.now();
    let entry = this.socketSubscriptionCount.get(clientId);
    
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60000 }; // 1 minute window
      this.socketSubscriptionCount.set(clientId, entry);
    }
    
    entry.count++;
    return entry.count <= this.MAX_SUBSCRIPTIONS_PER_MINUTE;
  }

  /**
   * Subscribe to session updates
   * 
   * SECURITY: Rate limited to prevent abuse
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): Promise<{ success: boolean; error?: string }> {
    const { sessionId } = data;

    // SECURITY: Rate limit subscription attempts
    if (!this.checkSubscriptionRateLimit(client.id)) {
      this.logger.warn(`Rate limit exceeded for client ${client.id}`);
      return { success: false, error: 'Rate limit exceeded' };
    }

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
