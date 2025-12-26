import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { DeviceType } from '@railgun/shared';
import { UserEntity } from '../users/user.entity';

/**
 * Device entity representing a user's device for E2E encryption.
 * Each device has its own Signal protocol session keys.
 */
@Entity('devices')
@Unique(['userId', 'deviceId'])
export class DeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The user who owns this device */
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  /** Device identifier (client-generated) */
  @Column({ type: 'int' })
  deviceId!: number;

  /** Type of device */
  @Column({
    type: 'enum',
    enum: DeviceType,
    default: DeviceType.DESKTOP,
  })
  deviceType!: DeviceType;

  /** Device name (e.g., "MacBook Pro", "iPhone 15") */
  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceName?: string;

  /** Last time this device was active */
  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt?: Date;

  /** Push notification token for this device */
  @Column({ type: 'varchar', length: 255, nullable: true })
  pushToken?: string;

  /** Whether the device is currently active */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
