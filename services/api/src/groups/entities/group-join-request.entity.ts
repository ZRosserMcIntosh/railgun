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
import { UserEntity } from '../../users/user.entity';
import { CommunityEntity } from '../../communities/community.entity';

/**
 * Status of a join request.
 */
export enum JoinRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * GroupJoinRequest Entity
 * 
 * Represents a request to join a group that requires approval.
 * Used when a group's joinPolicy is APPROVAL_REQUIRED.
 * 
 * A user can only have one pending request per community.
 */
@Entity('group_join_requests')
@Unique(['userId', 'communityId'])
export class GroupJoinRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The user requesting to join */
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  /** The community being requested to join */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** Current status of the request */
  @Column({
    type: 'enum',
    enum: JoinRequestStatus,
    default: JoinRequestStatus.PENDING,
  })
  status!: JoinRequestStatus;

  /** Who reviewed the request (owner or admin) */
  @Column({ type: 'uuid', nullable: true })
  reviewedBy?: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewedBy' })
  reviewer?: UserEntity;

  /** When the request was reviewed */
  @Column({ type: 'timestamp', nullable: true })
  reviewedAt?: Date;

  /** Optional message from the requester */
  @Column({ type: 'text', nullable: true })
  message?: string;

  @CreateDateColumn()
  createdAt!: Date;

  /**
   * Check if this request is still pending.
   */
  isPending(): boolean {
    return this.status === JoinRequestStatus.PENDING;
  }

  /**
   * Check if this request was approved.
   */
  isApproved(): boolean {
    return this.status === JoinRequestStatus.APPROVED;
  }

  /**
   * Check if this request was rejected.
   */
  isRejected(): boolean {
    return this.status === JoinRequestStatus.REJECTED;
  }

  /**
   * Approve this request.
   */
  approve(reviewerId: string): void {
    this.status = JoinRequestStatus.APPROVED;
    this.reviewedBy = reviewerId;
    this.reviewedAt = new Date();
  }

  /**
   * Reject this request.
   */
  reject(reviewerId: string): void {
    this.status = JoinRequestStatus.REJECTED;
    this.reviewedBy = reviewerId;
    this.reviewedAt = new Date();
  }
}
