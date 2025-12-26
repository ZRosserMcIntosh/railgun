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
import { MessageStatus, ConversationType } from '@railgun/shared';
import { UserEntity } from '../users/user.entity';
import { ChannelEntity } from '../communities/channel.entity';

/**
 * Message entity for storing encrypted message envelopes.
 * Messages are E2E encrypted - server only stores ciphertext.
 */
@Entity('messages')
@Index(['channelId', 'createdAt'])
@Index(['senderId', 'createdAt'])
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The sender of this message */
  @Column({ type: 'uuid' })
  @Index()
  senderId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'senderId' })
  sender!: UserEntity;

  /** The channel this message belongs to (null for DMs) */
  @Column({ type: 'uuid', nullable: true })
  @Index()
  channelId?: string;

  @ManyToOne(() => ChannelEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'channelId' })
  channel?: ChannelEntity;

  /** For DMs: the conversation ID (sorted user IDs concatenated) */
  @Column({ type: 'varchar', length: 73, nullable: true })
  @Index()
  conversationId?: string;

  /** Type of conversation (DM or CHANNEL) */
  @Column({
    type: 'enum',
    enum: ConversationType,
    default: ConversationType.CHANNEL,
  })
  conversationType!: ConversationType;

  /**
   * Encrypted message envelope (ciphertext).
   * Contains the Signal protocol message with encrypted payload.
   * Server cannot decrypt this - only stores and forwards.
   */
  @Column({ type: 'text' })
  encryptedEnvelope!: string;

  /** Protocol version for backwards compatibility */
  @Column({ type: 'smallint', default: 1 })
  protocolVersion!: number;

  /** Client-generated nonce for deduplication */
  @Column({ type: 'varchar', length: 36 })
  @Index()
  clientNonce!: string;

  /** Delivery status of the message */
  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.SENT,
  })
  status!: MessageStatus;

  /** When the message was delivered to all recipients */
  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  /** When the message was read by recipient(s) */
  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date;

  /** If this message is a reply, reference to parent message */
  @Column({ type: 'uuid', nullable: true })
  replyToId?: string;

  @ManyToOne(() => MessageEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'replyToId' })
  replyTo?: MessageEntity;

  /** Whether the message has been soft-deleted */
  @Column({ type: 'boolean', default: false })
  isDeleted!: boolean;

  /** Whether the message has been edited */
  @Column({ type: 'boolean', default: false })
  isEdited!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
