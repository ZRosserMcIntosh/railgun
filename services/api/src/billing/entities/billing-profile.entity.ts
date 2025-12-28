import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { createHmac } from 'crypto';

/**
 * Subscription state enum
 * Tracks the current state of a user's subscription
 */
export enum SubscriptionState {
  /** No active subscription */
  NONE = 'none',
  /** Subscription is active and paid */
  ACTIVE = 'active',
  /** Trial period */
  TRIALING = 'trialing',
  /** Payment failed, grace period */
  PAST_DUE = 'past_due',
  /** Subscription cancelled but still active until period end */
  CANCELED = 'canceled',
  /** Subscription is paused */
  PAUSED = 'paused',
  /** Subscription has ended */
  EXPIRED = 'expired',
}

/**
 * Pro tier enum
 * Different subscription tiers available
 */
export enum ProTier {
  /** Free tier - basic features */
  FREE = 'free',
  /** Pro tier - advanced features */
  PRO = 'pro',
  /** Business tier - team features */
  BUSINESS = 'business',
}

/**
 * BillingProfile Entity
 * 
 * Privacy-preserving billing profile that links app users to Stripe
 * using a non-reversible surrogate (billing_ref) instead of PII.
 * 
 * Security considerations:
 * - billing_ref is an HMAC of user_id, not reversible
 * - No username/email stored or sent to Stripe
 * - Columns should be encrypted at rest in production
 * - Access should be limited to billing service only
 */
@Entity('billing_profiles')
@Index(['billingRef'], { unique: true })
@Index(['stripeCustomerId'], { unique: true, where: '"stripeCustomerId" IS NOT NULL' })
export class BillingProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Reference to the app user (from auth system)
   * This is the only link to user identity
   */
  @Column({ type: 'uuid', unique: true })
  @Index()
  userId!: string;

  /**
   * Non-reversible surrogate for Stripe interactions
   * Generated as HMAC(secret, user_id) on creation
   * This is the ONLY identifier sent to Stripe
   */
  @Column({ type: 'varchar', length: 64, unique: true })
  billingRef!: string;

  /**
   * Stripe Customer ID
   * Set after customer is created in Stripe
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  stripeCustomerId!: string | null;

  /**
   * Current subscription state
   */
  @Column({
    type: 'enum',
    enum: SubscriptionState,
    default: SubscriptionState.NONE,
  })
  subscriptionState!: SubscriptionState;

  /**
   * Current Pro tier
   */
  @Column({
    type: 'enum',
    enum: ProTier,
    default: ProTier.FREE,
  })
  tier!: ProTier;

  /**
   * Stripe Subscription ID (for active subscriptions)
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  stripeSubscriptionId!: string | null;

  /**
   * When the current subscription period ends
   */
  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd!: Date | null;

  /**
   * Whether subscription will cancel at period end
   */
  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  /**
   * Stripe Identity verification ID (if KYC required)
   * Only stores the verification session ID, not PII
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  identityVerificationId!: string | null;

  /**
   * Identity verification status
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  identityVerificationStatus!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Generate billing_ref before insert
   * Uses HMAC with a secret key to create a non-reversible surrogate
   */
  @BeforeInsert()
  generateBillingRef() {
    if (!this.billingRef) {
      // Get secret from environment - MUST be set in production
      const secret = process.env.BILLING_REF_SECRET;
      if (!secret) {
        throw new Error('BILLING_REF_SECRET environment variable is required');
      }
      
      // Create HMAC of user_id
      this.billingRef = createHmac('sha256', secret)
        .update(this.userId)
        .digest('hex');
    }
  }

  /**
   * Check if user has active Pro access
   */
  hasProAccess(): boolean {
    return (
      this.tier !== ProTier.FREE &&
      [SubscriptionState.ACTIVE, SubscriptionState.TRIALING].includes(
        this.subscriptionState,
      )
    );
  }

  /**
   * Check if user is in grace period (past due but still has access)
   */
  isInGracePeriod(): boolean {
    return this.subscriptionState === SubscriptionState.PAST_DUE;
  }
}
