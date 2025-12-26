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
import { Permission } from '@railgun/shared';
import { CommunityEntity } from './community.entity';

/**
 * Role entity for permission management within a community.
 */
@Entity('roles')
@Index(['communityId', 'position'])
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Role name */
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** Role color (hex without #) */
  @Column({ type: 'varchar', length: 6, default: '99aab5' })
  color!: string;

  /** The community this role belongs to */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, (community) => community.roles, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** Position for role hierarchy (higher = more power) */
  @Column({ type: 'int', default: 0 })
  position!: number;

  /** Permissions granted by this role */
  @Column({
    type: 'enum',
    enum: Permission,
    array: true,
    default: [Permission.READ_MESSAGES, Permission.SEND_MESSAGES],
  })
  permissions!: Permission[];

  /** Whether this role is displayed separately in member list */
  @Column({ type: 'boolean', default: false })
  isHoisted!: boolean;

  /** Whether this role can be mentioned */
  @Column({ type: 'boolean', default: false })
  isMentionable!: boolean;

  /** Whether this is the default role for new members */
  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /** Whether this role is managed by the system (cannot be deleted) */
  @Column({ type: 'boolean', default: false })
  isManaged!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
