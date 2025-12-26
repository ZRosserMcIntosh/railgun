import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { DeviceEntity } from './device.entity';

/**
 * One-Time Pre-Key entity for Signal protocol.
 * Ephemeral keys used once to establish a session.
 * Clients upload batches of these; each is consumed when used.
 */
@Entity('prekeys')
@Unique(['deviceId', 'keyId'])
@Index(['deviceId', 'isUsed'])
export class PreKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The device this pre-key belongs to */
  @Column({ type: 'uuid' })
  @Index()
  deviceId!: string;

  @ManyToOne(() => DeviceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device!: DeviceEntity;

  /** Key identifier */
  @Column({ type: 'int' })
  keyId!: number;

  /** The public pre-key (base64 encoded) */
  @Column({ type: 'text' })
  publicKey!: string;

  /** Whether this key has been used (should be deleted after use) */
  @Column({ type: 'boolean', default: false })
  isUsed!: boolean;

  /** When this key was used */
  @Column({ type: 'timestamp', nullable: true })
  usedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
