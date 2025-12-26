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
import { UserEntity } from '../users/user.entity';
import { CommunityEntity } from './community.entity';
import { RoleEntity } from './role.entity';

/**
 * Member entity representing a user's membership in a community.
 */
@Entity('members')
@Unique(['userId', 'communityId'])
@Index(['communityId', 'joinedAt'])
export class MemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The user who is a member */
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  /** The community they belong to */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, (community) => community.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** Nickname in this community (overrides display name) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname?: string;

  /** Primary role in this community */
  @Column({ type: 'uuid', nullable: true })
  roleId?: string;

  @ManyToOne(() => RoleEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'roleId' })
  role?: RoleEntity;

  /** Additional role IDs (for multiple roles) */
  @Column({ type: 'uuid', array: true, default: [] })
  additionalRoleIds!: string[];

  /** When the user joined this community */
  @Column({ type: 'timestamp' })
  joinedAt!: Date;

  /** Whether the member is muted in this community */
  @Column({ type: 'boolean', default: false })
  isMuted!: boolean;

  /** Whether the member is deafened in this community */
  @Column({ type: 'boolean', default: false })
  isDeafened!: boolean;

  /** Mute expiration time (null = permanent until unmuted) */
  @Column({ type: 'timestamp', nullable: true })
  muteExpiresAt?: Date;

  /** User's notification settings for this community */
  @Column({
    type: 'jsonb',
    default: { allMessages: true, mentions: true, nothing: false },
  })
  notificationSettings!: {
    allMessages: boolean;
    mentions: boolean;
    nothing: boolean;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
