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
