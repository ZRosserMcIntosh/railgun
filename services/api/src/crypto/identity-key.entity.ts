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
 * Identity Key entity for Signal protocol.
 * Stores the long-term identity public key for a device.
 * The private key never leaves the client device.
 */
@Entity('identity_keys')
@Unique(['deviceId'])
export class IdentityKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The device this identity key belongs to */
  @Column({ type: 'uuid' })
  @Index()
  deviceId!: string;

  @ManyToOne(() => DeviceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device!: DeviceEntity;

  /**
   * The public identity key (base64 encoded).
   * This is the long-term public key used to verify the device.
   */
  @Column({ type: 'text' })
  publicKey!: string;

  /** Registration ID for this device (used in Signal protocol) */
  @Column({ type: 'int' })
  registrationId!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
