import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { createHmac } from 'crypto';
import {
  BillingProfile,
  SubscriptionState,
  ProTier,
} from './entities/billing-profile.entity';

/**
 * Stripe price IDs for different tiers
 * These should be set in environment variables
 */
interface StripePrices {
  proMonthly: string;
  proYearly: string;
  businessMonthly: string;
  businessYearly: string;
}

/**
 * BillingService
 * 
 * Privacy-preserving billing service that manages Stripe interactions
 * using pseudonymous billing_ref instead of PII.
 * 
 * Key principles:
 * - Never send username/email to Stripe
 * - Use billing_ref as the only identifier
 * - Store minimal mapping in database
 * - All Stripe webhook lookups use billing_ref or stripe_customer_id
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;
  private prices: StripePrices;
  private billingRefSecret: string | null = null;

  constructor(
    @InjectRepository(BillingProfile)
    private readonly billingProfileRepo: Repository<BillingProfile>,
    private readonly configService: ConfigService,
  ) {
    // Initialize Stripe client
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not set - billing service will not function');
    } else {
      this.stripe = new Stripe(stripeSecretKey);
    }

    // Get billing ref secret for HMAC generation
    const billingRefSecret = this.configService.get<string>('BILLING_REF_SECRET');
    if (!billingRefSecret) {
      this.logger.warn('BILLING_REF_SECRET not set - billing service will not function');
    }
    this.billingRefSecret = billingRefSecret || null;

    // Get Stripe price IDs (optional in dev)
    this.prices = {
      proMonthly: this.configService.get<string>('STRIPE_PRICE_PRO_MONTHLY') || '',
      proYearly: this.configService.get<string>('STRIPE_PRICE_PRO_YEARLY') || '',
      businessMonthly: this.configService.get<string>('STRIPE_PRICE_BUSINESS_MONTHLY') || '',
      businessYearly: this.configService.get<string>('STRIPE_PRICE_BUSINESS_YEARLY') || '',
    };
  }

  /**
   * Check if billing service is properly configured
   */
  private ensureConfigured(): void {
    if (!this.stripe || !this.billingRefSecret) {
      throw new Error('Billing service is not configured. Set STRIPE_SECRET_KEY and BILLING_REF_SECRET.');
    }
  }

  /**
   * Generate billing_ref from user_id using HMAC
   * This is a one-way function - cannot reverse to get user_id
   */
  private generateBillingRef(userId: string): string {
    this.ensureConfigured();
    return createHmac('sha256', this.billingRefSecret!)
      .update(userId)
      .digest('hex');
  }

  /**
   * Get or create a billing profile for a user
   * Creates Stripe customer with billing_ref metadata only
   */
  async getOrCreateProfile(userId: string): Promise<BillingProfile> {
    // Check for existing profile
    let profile = await this.billingProfileRepo.findOne({
      where: { userId },
    });

    if (profile) {
      return profile;
    }

    // Create new profile with generated billing_ref
    const billingRef = this.generateBillingRef(userId);

    profile = this.billingProfileRepo.create({
      userId,
      billingRef,
      subscriptionState: SubscriptionState.NONE,
      tier: ProTier.FREE,
    });

    await this.billingProfileRepo.save(profile);
    this.logger.log(`Created billing profile for billing_ref: ${billingRef.substring(0, 8)}...`);

    return profile;
  }

  /**
   * Get billing profile by user ID
   */
  async getProfileByUserId(userId: string): Promise<BillingProfile | null> {
    return this.billingProfileRepo.findOne({ where: { userId } });
  }

  /**
   * Get billing profile by billing_ref (used in webhook handlers)
   */
  async getProfileByBillingRef(billingRef: string): Promise<BillingProfile | null> {
    return this.billingProfileRepo.findOne({ where: { billingRef } });
  }

  /**
   * Get billing profile by Stripe customer ID (used in webhook handlers)
   */
  async getProfileByStripeCustomerId(stripeCustomerId: string): Promise<BillingProfile | null> {
    return this.billingProfileRepo.findOne({ where: { stripeCustomerId } });
  }

  /**
   * Ensure a Stripe customer exists for the billing profile
   * Only stores billing_ref in Stripe metadata - NO PII
   */
  async ensureStripeCustomer(profile: BillingProfile): Promise<string> {
    if (profile.stripeCustomerId) {
      return profile.stripeCustomerId;
    }

    this.ensureConfigured();

    try {
      // Create Stripe customer with ONLY billing_ref as metadata
      // NO email, NO name, NO PII
      const customer = await this.stripe!.customers.create({
        metadata: {
          billing_ref: profile.billingRef,
        },
      });

      profile.stripeCustomerId = customer.id;
      await this.billingProfileRepo.save(profile);
      
      this.logger.log(`Created Stripe customer: ${customer.id} for billing_ref: ${profile.billingRef.substring(0, 8)}...`);
      
      return customer.id;
    } catch (error) {
      this.logger.error('Failed to create Stripe customer', error);
      throw new InternalServerErrorException('Failed to create billing customer');
    }
  }

  /**
   * Create a Checkout session for subscription
   * Uses client_reference_id = billing_ref for webhook correlation
   */
  async createCheckoutSession(
    userId: string,
    tier: ProTier,
    interval: 'monthly' | 'yearly',
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ sessionId: string; url: string }> {
    this.ensureConfigured();

    const profile = await this.getOrCreateProfile(userId);
    const stripeCustomerId = await this.ensureStripeCustomer(profile);

    // Get the price ID based on tier and interval
    const priceId = this.getPriceId(tier, interval);
    if (!priceId) {
      throw new BadRequestException('Invalid tier or interval');
    }

    try {
      const session = await this.stripe!.checkout.sessions.create({
        customer: stripeCustomerId,
        client_reference_id: profile.billingRef, // Key: billing_ref for webhook lookup
        mode: 'subscription',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      this.logger.log(`Created checkout session: ${session.id} for billing_ref: ${profile.billingRef.substring(0, 8)}...`);

      return {
        sessionId: session.id,
        url: session.url || '',
      };
    } catch (error) {
      this.logger.error('Failed to create checkout session', error);
      throw new InternalServerErrorException('Failed to create checkout session');
    }
  }

  /**
   * Create a Customer Portal session
   * Allows users to manage their subscription
   */
  async createPortalSession(
    userId: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    this.ensureConfigured();

    const profile = await this.getProfileByUserId(userId);
    
    if (!profile?.stripeCustomerId) {
      throw new NotFoundException('No billing profile found');
    }

    try {
      const session = await this.stripe!.billingPortal.sessions.create({
        customer: profile.stripeCustomerId,
        return_url: returnUrl,
      });

      this.logger.log(`Created portal session for billing_ref: ${profile.billingRef.substring(0, 8)}...`);

      return { url: session.url };
    } catch (error) {
      this.logger.error('Failed to create portal session', error);
      throw new InternalServerErrorException('Failed to create billing portal session');
    }
  }

  /**
   * Get ephemeral key for mobile PaymentSheet
   * Used by iOS/Android Stripe SDK
   */
  async getEphemeralKey(
    userId: string,
    apiVersion: string,
  ): Promise<{ ephemeralKey: string; customerId: string }> {
    this.ensureConfigured();

    const profile = await this.getOrCreateProfile(userId);
    const stripeCustomerId = await this.ensureStripeCustomer(profile);

    try {
      const ephemeralKey = await this.stripe!.ephemeralKeys.create(
        { customer: stripeCustomerId },
        { apiVersion },
      );

      return {
        ephemeralKey: ephemeralKey.secret || '',
        customerId: stripeCustomerId,
      };
    } catch (error) {
      this.logger.error('Failed to create ephemeral key', error);
      throw new InternalServerErrorException('Failed to create ephemeral key');
    }
  }

  /**
   * Handle checkout.session.completed webhook
   * Look up by client_reference_id (billing_ref) and update subscription
   */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    this.ensureConfigured();

    const billingRef = session.client_reference_id;
    if (!billingRef) {
      this.logger.warn('Checkout session missing client_reference_id');
      return;
    }

    const profile = await this.getProfileByBillingRef(billingRef);
    if (!profile) {
      this.logger.warn(`No profile found for billing_ref: ${billingRef.substring(0, 8)}...`);
      return;
    }

    // Get subscription details
    if (session.subscription && typeof session.subscription === 'string') {
      const subscription = await this.stripe!.subscriptions.retrieve(session.subscription);
      await this.updateSubscriptionState(profile, subscription);
    }

    this.logger.log(`Checkout completed for billing_ref: ${billingRef.substring(0, 8)}...`);
  }

  /**
   * Handle subscription updated webhook
   */
  async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const customerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer?.id;
    
    if (!customerId) {
      this.logger.warn('Subscription missing customer ID');
      return;
    }

    const profile = await this.getProfileByStripeCustomerId(customerId);
    if (!profile) {
      this.logger.warn(`No profile found for Stripe customer: ${customerId}`);
      return;
    }

    await this.updateSubscriptionState(profile, subscription);
    this.logger.log(`Subscription updated for billing_ref: ${profile.billingRef.substring(0, 8)}...`);
  }

  /**
   * Handle subscription deleted webhook
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const customerId = typeof subscription.customer === 'string' 
      ? subscription.customer 
      : subscription.customer?.id;

    if (!customerId) return;

    const profile = await this.getProfileByStripeCustomerId(customerId);
    if (!profile) {
      this.logger.warn(`No profile found for Stripe customer: ${customerId}`);
      return;
    }

    profile.subscriptionState = SubscriptionState.EXPIRED;
    profile.tier = ProTier.FREE;
    profile.stripeSubscriptionId = null;
    profile.currentPeriodEnd = null;
    profile.cancelAtPeriodEnd = false;

    await this.billingProfileRepo.save(profile);
    this.logger.log(`Subscription deleted for billing_ref: ${profile.billingRef.substring(0, 8)}...`);
  }

  /**
   * Handle invoice payment succeeded webhook
   */
  async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    // Access subscription via any due to Stripe API version differences
    const invoiceAny = invoice as unknown as Record<string, unknown>;
    const subscriptionField = invoiceAny.subscription;
    const subscriptionId = typeof subscriptionField === 'string'
      ? subscriptionField
      : (subscriptionField as { id?: string } | null)?.id;

    if (!subscriptionId) return;

    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as { id?: string })?.id;

    if (!customerId) return;

    const profile = await this.getProfileByStripeCustomerId(customerId);
    if (!profile) return;

    // Subscription is active - update state
    if (profile.subscriptionState === SubscriptionState.PAST_DUE) {
      profile.subscriptionState = SubscriptionState.ACTIVE;
      await this.billingProfileRepo.save(profile);
      this.logger.log(`Payment succeeded, reactivated subscription for billing_ref: ${profile.billingRef.substring(0, 8)}...`);
    }
  }

  /**
   * Handle invoice payment failed webhook
   */
  async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // Access subscription via any due to Stripe API version differences
    const invoiceAny = invoice as unknown as Record<string, unknown>;
    const subscriptionField = invoiceAny.subscription;
    const subscriptionId = typeof subscriptionField === 'string'
      ? subscriptionField
      : (subscriptionField as { id?: string } | null)?.id;

    if (!subscriptionId) return;

    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as { id?: string })?.id;

    if (!customerId) return;

    const profile = await this.getProfileByStripeCustomerId(customerId);
    if (!profile) return;

    // Mark as past due - user still has access during grace period
    profile.subscriptionState = SubscriptionState.PAST_DUE;
    await this.billingProfileRepo.save(profile);
    
    this.logger.log(`Payment failed for billing_ref: ${profile.billingRef.substring(0, 8)}...`);
  }

  /**
   * Update subscription state from Stripe subscription object
   */
  private async updateSubscriptionState(
    profile: BillingProfile,
    subscription: Stripe.Subscription,
  ): Promise<void> {
    profile.stripeSubscriptionId = subscription.id;
    
    // Handle current_period_end - access via any type due to Stripe API changes
    const subAny = subscription as unknown as Record<string, unknown>;
    const periodEnd = subAny.current_period_end as number | undefined;
    if (periodEnd) {
      profile.currentPeriodEnd = new Date(periodEnd * 1000);
    }
    
    profile.cancelAtPeriodEnd = subscription.cancel_at_period_end;

    // Map Stripe status to our state
    switch (subscription.status) {
      case 'active':
        profile.subscriptionState = SubscriptionState.ACTIVE;
        break;
      case 'trialing':
        profile.subscriptionState = SubscriptionState.TRIALING;
        break;
      case 'past_due':
        profile.subscriptionState = SubscriptionState.PAST_DUE;
        break;
      case 'canceled':
        profile.subscriptionState = profile.cancelAtPeriodEnd 
          ? SubscriptionState.CANCELED 
          : SubscriptionState.EXPIRED;
        break;
      case 'paused':
        profile.subscriptionState = SubscriptionState.PAUSED;
        break;
      default:
        profile.subscriptionState = SubscriptionState.NONE;
    }

    // Determine tier from price
    const priceId = subscription.items.data[0]?.price?.id;
    if (priceId) {
      profile.tier = this.getTierFromPriceId(priceId);
    }

    await this.billingProfileRepo.save(profile);
  }

  /**
   * Get price ID based on tier and interval
   */
  private getPriceId(tier: ProTier, interval: 'monthly' | 'yearly'): string | null {
    if (!this.prices) return null;

    switch (tier) {
      case ProTier.PRO:
        return interval === 'monthly' ? this.prices.proMonthly : this.prices.proYearly;
      case ProTier.BUSINESS:
        return interval === 'monthly' ? this.prices.businessMonthly : this.prices.businessYearly;
      default:
        return null;
    }
  }

  /**
   * Get tier from Stripe price ID
   */
  private getTierFromPriceId(priceId: string): ProTier {
    if (!this.prices) return ProTier.FREE;

    if (priceId === this.prices.proMonthly || priceId === this.prices.proYearly) {
      return ProTier.PRO;
    }
    if (priceId === this.prices.businessMonthly || priceId === this.prices.businessYearly) {
      return ProTier.BUSINESS;
    }
    return ProTier.FREE;
  }

  /**
   * Check if a user has Pro access
   */
  async hasProAccess(userId: string): Promise<boolean> {
    const profile = await this.getProfileByUserId(userId);
    return profile?.hasProAccess() ?? false;
  }

  /**
   * Get subscription status for a user
   */
  async getSubscriptionStatus(userId: string): Promise<{
    tier: ProTier;
    state: SubscriptionState;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }> {
    const profile = await this.getProfileByUserId(userId);
    
    if (!profile) {
      return {
        tier: ProTier.FREE,
        state: SubscriptionState.NONE,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      };
    }

    return {
      tier: profile.tier,
      state: profile.subscriptionState,
      currentPeriodEnd: profile.currentPeriodEnd,
      cancelAtPeriodEnd: profile.cancelAtPeriodEnd,
    };
  }
}
