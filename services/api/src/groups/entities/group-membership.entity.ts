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
import { UserEntity } from '../../users/user.entity';
import { CommunityEntity } from '../../communities/community.entity';
import { GroupPlanEntity } from './group-plan.entity';

/**
 * Status of a paid group membership.
 */
export enum MembershipStatus {
  /** Active subscription */
  ACTIVE = 'ACTIVE',
  /** Payment failed, in grace period */
  PAST_DUE = 'PAST_DUE',
  /** User canceled, access until period end */
  CANCELED = 'CANCELED',
  /** Subscription ended */
  EXPIRED = 'EXPIRED',
}

/**
 * Where the payment originated from.
 */
export enum PaymentSource {
  /** Stripe payment (web/desktop) */
  STRIPE = 'STRIPE',
  /** Apple In-App Purchase (iOS) */
  APPLE_IAP = 'APPLE_IAP',
  /** Google Play Billing (Android) */
  GOOGLE_PLAY = 'GOOGLE_PLAY',
  /** Promotional/gifted access */
  PROMO = 'PROMO',
}

/**
 * GroupMembership Entity
 * 
 * Tracks paid access to groups. This is separate from the regular
 * community membership (members table) and represents the payment/subscription
 * status for paid groups.
 * 
 * A user can only have one membership per community.
 */
@Entity('group_memberships')
@Unique(['userId', 'communityId'])
export class GroupMembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The user who has this membership */
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  /** The community/group this membership is for */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** The plan that was purchased (can be null if plan was deleted) */
  @Column({ type: 'uuid', nullable: true })
  groupPlanId?: string;

  @ManyToOne(() => GroupPlanEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'groupPlanId' })
  groupPlan?: GroupPlanEntity;

  /** Where the payment came from */
  @Column({
    type: 'enum',
    enum: PaymentSource,
  })
  paymentSource!: PaymentSource;

  /** External subscription/transaction ID */
  @Column({ type: 'varchar', length: 255, nullable: true })
  externalSubscriptionId?: string;

  /** Current membership status */
  @Column({
    type: 'enum',
    enum: MembershipStatus,
    default: MembershipStatus.ACTIVE,
  })
  status!: MembershipStatus;

  /** When the membership started */
  @Column({ type: 'timestamp', default: () => 'now()' })
  startedAt!: Date;

  /** When the current period expires */
  @Column({ type: 'timestamp', nullable: true })
  @Index()
  expiresAt?: Date;

  /** When the user canceled (if applicable) */
  @Column({ type: 'timestamp', nullable: true })
  canceledAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Check if the membership grants active access.
   */
  hasAccess(): boolean {
    // Active and trialing have access
    if (this.status === MembershipStatus.ACTIVE) {
      return true;
    }
    
    // Past due has grace period access
    if (this.status === MembershipStatus.PAST_DUE) {
      return true;
    }
    
    // Canceled has access until period end
    if (this.status === MembershipStatus.CANCELED && this.expiresAt) {
      return new Date() < this.expiresAt;
    }
    
    return false;
  }

  /**
   * Check if the membership is expiring soon (within 7 days).
   */
  isExpiringSoon(): boolean {
    if (!this.expiresAt) return false;
    
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    
    return this.expiresAt < sevenDaysFromNow;
  }

  /**
   * Get days until expiration.
   */
  getDaysUntilExpiration(): number {
    if (!this.expiresAt) return Infinity;
    
    const now = new Date();
    const diff = this.expiresAt.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}
