import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PresenceStatus } from '@railgun/shared';

/**
 * Stored recovery code hash structure
 * Recovery codes are hashed and never stored in plaintext
 */
export interface RecoveryCodeHash {
  id: string;           // Unique ID for this code
  hash: string;         // HMAC hash of the code
  salt: string;         // Per-code salt
  used: boolean;        // Whether this code has been used
  createdAt: Date;      // When this code was generated
  usedAt?: Date | null; // When this code was used (if applicable)
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  @Index()
  username!: string;

  @Column({ type: 'varchar', length: 100 })
  displayName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatarUrl?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  email?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({
    type: 'enum',
    enum: PresenceStatus,
    default: PresenceStatus.OFFLINE,
  })
  presence!: PresenceStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  statusMessage?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Refresh token hash for token rotation
  @Column({ type: 'varchar', length: 255, nullable: true })
  refreshTokenHash?: string;

  // Recovery codes stored as JSONB (hashed, never plaintext)
  @Column({ type: 'jsonb', nullable: true, default: [] })
  recoveryCodes!: RecoveryCodeHash[];
}
