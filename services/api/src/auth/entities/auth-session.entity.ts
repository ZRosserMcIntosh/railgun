import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { randomBytes } from 'crypto';

/**
 * Session status enum
 */
export enum SessionStatus {
  /** Session created, waiting for scan */
  PENDING = 'pending',
  /** QR code scanned, awaiting confirmation */
  SCANNED = 'scanned',
  /** Session completed successfully */
  COMPLETED = 'completed',
  /** Session expired */
  EXPIRED = 'expired',
  /** Session cancelled */
  CANCELLED = 'cancelled',
}

/**
 * QR Auth Session Entity
 * 
 * Represents a temporary session for QR-based authentication.
 * Used to bridge web/desktop with mobile app authentication.
 * 
 * Flow:
 * 1. Web/Desktop creates session → gets QR code
 * 2. Mobile scans QR → calls complete endpoint
 * 3. Web/Desktop polls or receives WebSocket update
 * 4. Session marked complete, JWT issued to web/desktop
 * 
 * Security:
 * - Sessions have 5-minute TTL
 * - One-time use only
 * - Secret is shown once in QR, verified on complete
 * - Rate limited creation
 */
@Entity('auth_sessions')
@Index(['status', 'expiresAt'])
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * One-time secret for session verification
   * Included in QR code, verified when mobile completes
   */
  @Column({ type: 'varchar', length: 64 })
  secret!: string;

  /**
   * Current session status
   */
  @Column({
    type: 'enum',
    enum: SessionStatus,
    default: SessionStatus.PENDING,
  })
  @Index()
  status!: SessionStatus;

  /**
   * User ID of the authenticated user (set on completion)
   */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  /**
   * User's public identity key (set on completion)
   */
  @Column({ type: 'text', nullable: true })
  userPublicKey!: string | null;

  /**
   * Client type that created the session
   */
  @Column({ type: 'varchar', length: 20, default: 'web' })
  clientType!: 'web' | 'desktop';

  /**
   * IP address of session creator (for audit)
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  creatorIp!: string | null;

  /**
   * User agent of session creator
   */
  @Column({ type: 'text', nullable: true })
  creatorUserAgent!: string | null;

  /**
   * IP address of completer (mobile device)
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  completerIp!: string | null;

  /**
   * When the session expires
   */
  @Column({ type: 'timestamp' })
  @Index()
  expiresAt!: Date;

  /**
   * When the session was completed
   */
  @Column({ type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  /**
   * Generate a secure random secret
   */
  static generateSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Check if session is expired
   */
  isExpired(): boolean {
    return new Date() > this.expiresAt || this.status === SessionStatus.EXPIRED;
  }

  /**
   * Check if session can be completed
   */
  canComplete(): boolean {
    return (
      !this.isExpired() &&
      (this.status === SessionStatus.PENDING || this.status === SessionStatus.SCANNED)
    );
  }

  /**
   * Generate QR payload for this session
   */
  getQRPayload(): string {
    return JSON.stringify({
      type: 'railgun-auth',
      version: 1,
      sessionId: this.id,
      secret: this.secret,
      expiresAt: this.expiresAt.toISOString(),
    });
  }
}
