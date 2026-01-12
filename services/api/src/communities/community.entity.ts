import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { ChannelEntity } from './channel.entity';
import { MemberEntity } from './member.entity';
import { RoleEntity } from './role.entity';

/**
 * How users can join the group.
 */
export enum JoinPolicy {
  OPEN = 'OPEN',
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  INVITE_ONLY = 'INVITE_ONLY',
  PAID = 'PAID',
}

/**
 * Who can send messages in the group.
 */
export enum PostPolicy {
  OPEN = 'OPEN',
  OWNER_ONLY = 'OWNER_ONLY',
  ROLE_BASED = 'ROLE_BASED',
}

/**
 * Type of group structure.
 */
export enum GroupType {
  FULL = 'FULL',
  BROADCAST = 'BROADCAST',
  PAID = 'PAID',
}

/**
 * Community entity (similar to Discord "server").
 * A community contains channels and members.
 */
@Entity('communities')
export class CommunityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Community name */
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Community description */
  @Column({ type: 'text', nullable: true })
  description?: string;

  /** Community icon URL */
  @Column({ type: 'varchar', length: 255, nullable: true })
  iconUrl?: string;

  /** Community banner URL */
  @Column({ type: 'varchar', length: 255, nullable: true })
  bannerUrl?: string;

  /** The owner of this community */
  @Column({ type: 'uuid' })
  @Index()
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ownerId' })
  owner!: UserEntity;

  /** Unique invite code for this community */
  @Column({ type: 'varchar', length: 16, unique: true })
  @Index()
  inviteCode!: string;

  /** Whether the community is public (joinable without invite) */
  @Column({ type: 'boolean', default: false })
  isPublic!: boolean;

  // ==================== GROUP POLICY FIELDS ====================

  /** Unique @handle for public groups (e.g., @railgun-community) */
  @Column({ type: 'varchar', length: 32, unique: true, nullable: true })
  @Index()
  handle?: string;

  /** How users can join this group */
  @Column({
    type: 'enum',
    enum: JoinPolicy,
    default: JoinPolicy.INVITE_ONLY,
  })
  joinPolicy!: JoinPolicy;

  /** Who can send messages in this group */
  @Column({
    type: 'enum',
    enum: PostPolicy,
    default: PostPolicy.OPEN,
  })
  postPolicy!: PostPolicy;

  /** Type of group (full chat, broadcast, or paid) */
  @Column({
    type: 'enum',
    enum: GroupType,
    default: GroupType.FULL,
  })
  groupType!: GroupType;

  /** Whether this group appears in discovery/search */
  @Column({ type: 'boolean', default: false })
  isDiscoverable!: boolean;

  // ==================== END GROUP POLICY FIELDS ====================

  /** Maximum number of members (0 = unlimited) */
  @Column({ type: 'int', default: 0 })
  maxMembers!: number;

  /** Current member count (denormalized for performance) */
  @Column({ type: 'int', default: 1 })
  memberCount!: number;

  /** Community-wide encryption settings */
  @Column({ type: 'jsonb', nullable: true })
  encryptionSettings?: {
    /** Whether E2E encryption is enforced */
    enforceE2E: boolean;
    /** Key rotation interval in hours */
    keyRotationInterval: number;
  };

  /** Channels in this community */
  @OneToMany(() => ChannelEntity, (channel) => channel.community)
  channels!: ChannelEntity[];

  /** Members of this community */
  @OneToMany(() => MemberEntity, (member) => member.community)
  members!: MemberEntity[];

  /** Roles in this community */
  @OneToMany(() => RoleEntity, (role) => role.community)
  roles!: RoleEntity[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
