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
import { CommunityEntity } from '../../communities/community.entity';

/**
 * Billing interval for group subscriptions.
 */
export enum BillingInterval {
  ONE_TIME = 'ONE_TIME',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

/**
 * GroupPlan Entity
 * 
 * Defines pricing for paid groups. A community can have at most one plan.
 * The plan can be purchased via Stripe (web/desktop) or IAP (iOS/Android).
 */
@Entity('group_plans')
export class GroupPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The community this plan belongs to */
  @Column({ type: 'uuid' })
  @Index()
  communityId!: string;

  @ManyToOne(() => CommunityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'communityId' })
  community!: CommunityEntity;

  /** Price in cents (e.g., 999 = $9.99) */
  @Column({ type: 'int' })
  priceCents!: number;

  /** ISO 4217 currency code */
  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency!: string;

  /** Billing interval */
  @Column({
    type: 'enum',
    enum: BillingInterval,
    default: BillingInterval.MONTHLY,
  })
  interval!: BillingInterval;

  /** Stripe Product ID (for web/desktop purchases) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeProductId?: string;

  /** Stripe Price ID (for web/desktop purchases) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  stripePriceId?: string;

  /** Apple IAP Product ID (for iOS purchases) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  appleProductId?: string;

  /** Google Play Product ID (for Android purchases) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  googleProductId?: string;

  /** Whether this plan is currently available for purchase */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Get formatted price string (e.g., "$9.99/mo")
   */
  getFormattedPrice(): string {
    const amount = (this.priceCents / 100).toFixed(2);
    const symbol = this.currency === 'USD' ? '$' : this.currency;
    
    switch (this.interval) {
      case BillingInterval.ONE_TIME:
        return `${symbol}${amount}`;
      case BillingInterval.MONTHLY:
        return `${symbol}${amount}/mo`;
      case BillingInterval.YEARLY:
        return `${symbol}${amount}/yr`;
      default:
        return `${symbol}${amount}`;
    }
  }
}
