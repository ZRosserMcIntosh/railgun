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
 * Signed Pre-Key entity for Signal protocol.
 * Medium-term key signed by the identity key.
 * Rotated periodically (e.g., weekly).
 */
@Entity('signed_prekeys')
@Unique(['deviceId', 'keyId'])
export class SignedPreKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The device this signed pre-key belongs to */
  @Column({ type: 'uuid' })
  @Index()
  deviceId!: string;

  @ManyToOne(() => DeviceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device!: DeviceEntity;

  /** Key identifier */
  @Column({ type: 'int' })
  keyId!: number;

  /** The public signed pre-key (base64 encoded) */
  @Column({ type: 'text' })
  publicKey!: string;

  /** Signature of the public key by the identity key (base64 encoded) */
  @Column({ type: 'text' })
  signature!: string;

  /** When this key expires and should be rotated */
  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  /** Whether this key is still active */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
