import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { ChannelEntity } from './channel.entity';

/**
 * SenderKeyDistribution Entity
 * 
 * Stores pending sender key distributions for channel E2E encryption.
 * When a user joins a channel or rotates their sender key, they need to
 * distribute it to all other channel members.
 * 
 * Flow:
 * 1. User A joins/creates channel, generates sender key
 * 2. User A POSTs distribution to /channels/:id/sender-key for each member
 * 3. Server stores distribution here
 * 4. User B GETs /channels/:id/sender-key to fetch pending distributions
 * 5. User B processes distribution and deletes it
 */
@Entity('sender_key_distributions')
@Index(['channelId', 'recipientUserId']) // For efficient lookups
export class SenderKeyDistributionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  channelId!: string;

  @ManyToOne(() => ChannelEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channelId' })
  channel!: ChannelEntity;

  /** User ID who sent/owns this sender key */
  @Column()
  senderUserId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderUserId' })
  sender!: UserEntity;

  /** Device ID of the sender */
  @Column()
  senderDeviceId!: number;

  /** User ID who should receive this distribution */
  @Column()
  @Index()
  recipientUserId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipientUserId' })
  recipient!: UserEntity;

  /** Device ID of the recipient (0 = all devices) */
  @Column({ default: 0 })
  recipientDeviceId!: number;

  /** Base64-encoded sender key distribution message */
  @Column('text')
  distribution!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
