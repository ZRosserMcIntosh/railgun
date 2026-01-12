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

/**
 * StripeConnectAccount Entity
 * 
 * Stores information about a user's connected Stripe account for receiving
 * payments from paid groups they own.
 * 
 * Uses Stripe Connect Standard accounts for maximum flexibility.
 */
@Entity('stripe_connect_accounts')
@Unique(['userId'])
@Unique(['stripeAccountId'])
export class StripeConnectAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The user who owns this Stripe account */
  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: UserEntity;

  /** Stripe Account ID (e.g., acct_xxx) */
  @Column({ type: 'varchar', length: 255 })
  stripeAccountId!: string;

  /** Type of Stripe Connect account */
  @Column({ type: 'varchar', length: 20, default: 'standard' })
  accountType!: 'standard' | 'express' | 'custom';

  /** Whether the account can accept charges */
  @Column({ type: 'boolean', default: false })
  chargesEnabled!: boolean;

  /** Whether the account can receive payouts */
  @Column({ type: 'boolean', default: false })
  payoutsEnabled!: boolean;

  /** Whether onboarding is complete */
  @Column({ type: 'boolean', default: false })
  onboardingComplete!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Check if the account is fully set up and can receive payments.
   */
  isReady(): boolean {
    return this.chargesEnabled && this.payoutsEnabled && this.onboardingComplete;
  }

  /**
   * Check if the account needs to complete onboarding.
   */
  needsOnboarding(): boolean {
    return !this.onboardingComplete;
  }
}
