import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthSession, SessionStatus } from './entities/auth-session.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Session creation result
 */
export interface CreateSessionResult {
  sessionId: string;
  secret: string;
  qrPayload: string;
  expiresAt: Date;
}

/**
 * Session status result
 */
export interface SessionStatusResult {
  sessionId: string;
  status: SessionStatus;
  expiresAt: Date;
  userId?: string;
}

/**
 * Session completion result
 */
export interface CompleteSessionResult {
  success: boolean;
  sessionId: string;
}

/**
 * JWT payload for authenticated sessions
 */
export interface AuthTokenPayload {
  sub: string; // userId
  sessionId: string;
  publicKey: string;
  iat: number;
  exp: number;
}

/**
 * AuthSessionService
 * 
 * Manages QR-based authentication sessions for web↔mobile auth bridge.
 * 
 * Flow:
 * 1. Web client calls createSession() → gets QR code data
 * 2. Web client subscribes to session updates (WebSocket/SSE/polling)
 * 3. Mobile scans QR → calls completeSession() with user credentials
 * 4. Web client receives notification → exchanges for JWT
 * 
 * Security considerations:
 * - Sessions expire in 5 minutes
 * - Secrets are one-time use
 * - Rate limiting on session creation
 * - IP logging for audit
 */
@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private readonly sessionTtlMinutes: number;

  constructor(
    @InjectRepository(AuthSession)
    private readonly sessionRepo: Repository<AuthSession>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.sessionTtlMinutes = this.configService.get<number>('AUTH_SESSION_TTL_MINUTES', 5);
  }

  /**
   * Create a new QR auth session
   */
  async createSession(
    clientType: 'web' | 'desktop',
    creatorIp?: string,
    creatorUserAgent?: string,
  ): Promise<CreateSessionResult> {
    const secret = AuthSession.generateSecret();
    const expiresAt = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000);

    const session = this.sessionRepo.create({
      secret,
      status: SessionStatus.PENDING,
      clientType,
      creatorIp,
      creatorUserAgent,
      expiresAt,
    });

    await this.sessionRepo.save(session);

    this.logger.log(`Created auth session: ${session.id} (expires: ${expiresAt.toISOString()})`);

    return {
      sessionId: session.id,
      secret,
      qrPayload: session.getQRPayload(),
      expiresAt,
    };
  }

  /**
   * Get session status (for polling)
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatusResult> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Check if expired
    if (session.isExpired() && session.status === SessionStatus.PENDING) {
      session.status = SessionStatus.EXPIRED;
      await this.sessionRepo.save(session);
    }

    return {
      sessionId: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      userId: session.userId ?? undefined,
    };
  }

  /**
   * Mark session as scanned (optional intermediate state)
   */
  async markScanned(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (!session.canComplete()) {
      throw new BadRequestException('Session cannot be updated');
    }

    session.status = SessionStatus.SCANNED;
    await this.sessionRepo.save(session);

    // Emit event for WebSocket subscribers
    this.eventEmitter.emit('auth.session.scanned', { sessionId });

    this.logger.log(`Session scanned: ${sessionId}`);
  }

  /**
   * Complete session authentication
   * Called by mobile after scanning QR code
   */
  async completeSession(
    sessionId: string,
    secret: string,
    userId: string,
    userPublicKey: string,
    completerIp?: string,
  ): Promise<CompleteSessionResult> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (!session.canComplete()) {
      throw new BadRequestException('Session expired or already completed');
    }

    // Verify secret (constant-time comparison would be better)
    if (session.secret !== secret) {
      this.logger.warn(`Invalid secret for session: ${sessionId}`);
      throw new ForbiddenException('Invalid session secret');
    }

    // Update session
    session.status = SessionStatus.COMPLETED;
    session.userId = userId;
    session.userPublicKey = userPublicKey;
    session.completerIp = completerIp ?? null;
    session.completedAt = new Date();

    // Clear secret after use (one-time)
    session.secret = '';

    await this.sessionRepo.save(session);

    // Emit event for WebSocket subscribers
    this.eventEmitter.emit('auth.session.completed', {
      sessionId,
      userId,
      userPublicKey,
    });

    this.logger.log(`Session completed: ${sessionId} by user: ${userId.substring(0, 8)}...`);

    return {
      success: true,
      sessionId,
    };
  }

  /**
   * Cancel a session
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    session.status = SessionStatus.CANCELLED;
    await this.sessionRepo.save(session);

    // Emit event for WebSocket subscribers
    this.eventEmitter.emit('auth.session.cancelled', { sessionId });

    this.logger.log(`Session cancelled: ${sessionId}`);
  }

  /**
   * Exchange completed session for JWT token
   * Called by web client after session is completed
   */
  async exchangeForToken(sessionId: string): Promise<string> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== SessionStatus.COMPLETED) {
      throw new BadRequestException('Session not completed');
    }

    if (!session.userId || !session.userPublicKey) {
      throw new BadRequestException('Session missing user data');
    }

    // Generate JWT
    const payload: Partial<AuthTokenPayload> = {
      sub: session.userId,
      sessionId: session.id,
      publicKey: session.userPublicKey,
    };

    const token = this.jwtService.sign(payload);

    this.logger.log(`Token issued for session: ${sessionId}`);

    return token;
  }

  /**
   * Clean up expired sessions (run periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.sessionRepo.delete({
      expiresAt: LessThan(new Date(Date.now() - 60 * 60 * 1000)), // 1 hour after expiry
      status: SessionStatus.PENDING,
    });

    if (result.affected && result.affected > 0) {
      this.logger.log(`Cleaned up ${result.affected} expired sessions`);
    }

    return result.affected ?? 0;
  }

  /**
   * Get session for WebSocket authentication
   */
  async getSessionForWs(sessionId: string): Promise<AuthSession | null> {
    return this.sessionRepo.findOne({
      where: { id: sessionId },
    });
  }
}
