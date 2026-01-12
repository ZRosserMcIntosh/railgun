import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CommunityEntity } from './community.entity';
import { UserEntity } from '../users/user.entity';
import { RoleEntity } from './role.entity';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Metadata for invite customization
 */
export interface InviteMetadata {
  /** Restrict to specific channels */
  channelIds?: string[];
  /** Custom welcome message */
  welcomeMessage?: string;
  /** Required verification level */
  requiredVerification?: 'none' | 'email' | 'phone';
}

/**
 * GroupInvite entity
 * 
 * Represents a shareable invite link/QR code for joining a community.
 * 
 * SECURITY:
 * - Only stores hash of the invite token, never the raw token
 * - Uses constant-time comparison to prevent timing attacks
 * - Supports expiration and usage limits
 * - Audit logged for all usage attempts
 */
@Entity('group_invites')
export class GroupInviteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The community this invite is for */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** The user who created this invite */
  @Column({ type: 'uuid' })
  @Index()
  createdById!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy!: UserEntity;

  /** 
   * SHA256 hash of the invite token.
   * SECURITY: Never store the raw token!
   */
  @Column({ type: 'varchar', length: 64 })
  @Index({ unique: true })
  tokenHash!: string;

  /** Role to assign to new members (null = default role) */
  @Column({ type: 'uuid', nullable: true })
  roleId?: string;

  @ManyToOne(() => RoleEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'roleId' })
  role?: RoleEntity;

  /** Maximum number of uses (0 = unlimited) */
  @Column({ type: 'int', default: 1 })
  maxUses!: number;

  /** Current number of uses */
  @Column({ type: 'int', default: 0 })
  uses!: number;

  /** When this invite expires */
  @Column({ type: 'timestamp with time zone' })
  @Index()
  expiresAt!: Date;

  /** Whether this invite has been manually revoked */
  @Column({ type: 'boolean', default: false })
  revoked!: boolean;

  /** When the invite was revoked */
  @Column({ type: 'timestamp with time zone', nullable: true })
  revokedAt?: Date;

  /** Who revoked the invite */
  @Column({ type: 'uuid', nullable: true })
  revokedById?: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'revokedById' })
  revokedBy?: UserEntity;

  /** Optional metadata */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: InviteMetadata;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;

  // ==================== STATIC METHODS ====================

  /**
   * Generate a cryptographically secure invite token.
   * Returns: { token, hash } - token is returned to user, hash is stored
   */
  static generateToken(): { token: string; hash: string } {
    // Generate 32 bytes = 256 bits of entropy
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, hash };
  }

  /**
   * Hash a token for lookup
   */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Verify a token against stored hash using constant-time comparison
   * SECURITY: Prevents timing attacks
   */
  static verifyToken(providedToken: string, storedHash: string): boolean {
    const providedHash = createHash('sha256').update(providedToken).digest('hex');
    const providedBuffer = Buffer.from(providedHash, 'hex');
    const storedBuffer = Buffer.from(storedHash, 'hex');
    
    if (providedBuffer.length !== storedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(providedBuffer, storedBuffer);
  }

  // ==================== INSTANCE METHODS ====================

  /**
   * Check if invite is valid (not expired, not revoked, not used up)
   */
  isValid(): boolean {
    if (this.revoked) {
      return false;
    }
    
    if (this.expiresAt < new Date()) {
      return false;
    }
    
    if (this.maxUses > 0 && this.uses >= this.maxUses) {
      return false;
    }
    
    return true;
  }

  /**
   * Get remaining uses (0 = unlimited)
   */
  getRemainingUses(): number | null {
    if (this.maxUses === 0) {
      return null; // Unlimited
    }
    return Math.max(0, this.maxUses - this.uses);
  }

  /**
   * Check if invite is expired
   */
  isExpired(): boolean {
    return this.expiresAt < new Date();
  }

  /**
   * Generate the join URL for this invite
   */
  getJoinUrl(baseUrl: string, token: string): string {
    return `${baseUrl}/join/${this.id}.${token}`;
  }

  /**
   * Generate the QR payload (deep link)
   */
  getQRPayload(token: string): string {
    // Format: railgun://join?invite=<id>.<token>
    return `railgun://join?invite=${this.id}.${token}`;
  }
}

/**
 * InviteUsageLog entity for audit trail
 */
@Entity('invite_usage_logs')
export class InviteUsageLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  inviteId!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip?: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent?: string;

  @Column({ type: 'boolean' })
  success!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason?: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;
}
