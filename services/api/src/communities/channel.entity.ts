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

/** Channel types */
export enum ChannelType {
  TEXT = 'TEXT',
  VOICE = 'VOICE',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
}

/**
 * Channel entity within a community.
 */
@Entity('channels')
@Index(['communityId', 'position'])
export class ChannelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Channel name */
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Channel topic/description */
  @Column({ type: 'text', nullable: true })
  topic?: string;

  /** The community this channel belongs to */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, (community) => community.channels, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** Channel type (text, voice, announcement) */
  @Column({
    type: 'enum',
    enum: ChannelType,
    default: ChannelType.TEXT,
  })
  type!: ChannelType;

  /** Position for ordering channels */
  @Column({ type: 'int', default: 0 })
  position!: number;

  /** Category/group name for organizing channels */
  @Column({ type: 'varchar', length: 100, nullable: true })
  category?: string;

  /** Whether the channel is private (role-restricted) */
  @Column({ type: 'boolean', default: false })
  isPrivate!: boolean;

  /** Whether the channel is read-only for non-admins */
  @Column({ type: 'boolean', default: false })
  isReadOnly!: boolean;

  /** Rate limit in seconds between messages (0 = no limit) */
  @Column({ type: 'int', default: 0 })
  rateLimitSeconds!: number;

  /** Whether the channel is archived */
  @Column({ type: 'boolean', default: false })
  isArchived!: boolean;

  /** Last message timestamp for sorting */
  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt?: Date;

  /** Message count (denormalized for performance) */
  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
