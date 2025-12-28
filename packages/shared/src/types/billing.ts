/**
 * Billing Types
 * 
 * Shared types for the pseudonymous billing system.
 * These types are used by both the API and client applications.
 */

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
 * Billing interval options
 */
export type BillingInterval = 'monthly' | 'yearly';

/**
 * Subscription status response from API
 */
export interface SubscriptionStatus {
  /** Current subscription tier */
  tier: ProTier;
  /** Current subscription state */
  state: SubscriptionState;
  /** When the current billing period ends (ISO string) */
  currentPeriodEnd: string | null;
  /** Whether subscription will cancel at period end */
  cancelAtPeriodEnd: boolean;
  /** Whether user has active Pro access */
  hasProAccess: boolean;
}

/**
 * Request to create a checkout session
 */
export interface CreateCheckoutRequest {
  /** Tier to subscribe to */
  tier: ProTier;
  /** Billing interval */
  interval: BillingInterval;
  /** URL to redirect on success (optional) */
  successUrl?: string;
  /** URL to redirect on cancel (optional) */
  cancelUrl?: string;
}

/**
 * Response from checkout session creation
 */
export interface CheckoutSessionResponse {
  /** Stripe checkout session ID */
  sessionId: string;
  /** URL to redirect user to Stripe Checkout */
  url: string;
}

/**
 * Request to create a portal session
 */
export interface CreatePortalRequest {
  /** URL to return to after portal (optional) */
  returnUrl?: string;
}

/**
 * Response from portal session creation
 */
export interface PortalSessionResponse {
  /** URL to redirect user to Customer Portal */
  url: string;
}

/**
 * Request for ephemeral key (mobile)
 */
export interface EphemeralKeyRequest {
  /** Stripe API version used by the mobile SDK */
  stripeApiVersion: string;
}

/**
 * Response from ephemeral key request
 */
export interface EphemeralKeyResponse {
  /** Ephemeral key secret for mobile SDK */
  ephemeralKey: string;
  /** Stripe customer ID */
  customerId: string;
}

/**
 * Feature flags based on subscription tier
 */
export interface TierFeatures {
  /** Maximum number of conversations */
  maxConversations: number;
  /** Maximum message length */
  maxMessageLength: number;
  /** Can use end-to-end encryption */
  e2eEncryption: boolean;
  /** Can create group chats */
  groupChats: boolean;
  /** Maximum group size */
  maxGroupSize: number;
  /** Can use custom relays */
  customRelays: boolean;
  /** File attachment size limit (bytes) */
  maxFileSize: number;
  /** Priority support */
  prioritySupport: boolean;
  /** API access */
  apiAccess: boolean;
  /** Custom branding for business */
  customBranding: boolean;
}

/**
 * Get features for a tier
 */
export function getTierFeatures(tier: ProTier): TierFeatures {
  switch (tier) {
    case ProTier.BUSINESS:
      return {
        maxConversations: -1, // unlimited
        maxMessageLength: 50000,
        e2eEncryption: true,
        groupChats: true,
        maxGroupSize: 500,
        customRelays: true,
        maxFileSize: 100 * 1024 * 1024, // 100MB
        prioritySupport: true,
        apiAccess: true,
        customBranding: true,
      };
    case ProTier.PRO:
      return {
        maxConversations: -1, // unlimited
        maxMessageLength: 25000,
        e2eEncryption: true,
        groupChats: true,
        maxGroupSize: 100,
        customRelays: true,
        maxFileSize: 50 * 1024 * 1024, // 50MB
        prioritySupport: true,
        apiAccess: false,
        customBranding: false,
      };
    case ProTier.FREE:
    default:
      return {
        maxConversations: 10,
        maxMessageLength: 5000,
        e2eEncryption: true,
        groupChats: false,
        maxGroupSize: 0,
        customRelays: false,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        prioritySupport: false,
        apiAccess: false,
        customBranding: false,
      };
  }
}

/**
 * Check if a state grants active access
 */
export function hasActiveAccess(state: SubscriptionState): boolean {
  return [
    SubscriptionState.ACTIVE,
    SubscriptionState.TRIALING,
    SubscriptionState.PAST_DUE, // Grace period
    SubscriptionState.CANCELED, // Until period end
  ].includes(state);
}

/**
 * Pricing information for display
 */
export interface PricingInfo {
  tier: ProTier;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
}

/**
 * Get pricing information for all tiers
 */
export function getPricingInfo(): PricingInfo[] {
  return [
    {
      tier: ProTier.FREE,
      name: 'Free',
      description: 'Basic secure messaging',
      monthlyPrice: 0,
      yearlyPrice: 0,
      features: [
        'End-to-end encryption',
        '10 conversations',
        '5MB file attachments',
        'Standard support',
      ],
    },
    {
      tier: ProTier.PRO,
      name: 'Pro',
      description: 'Advanced features for power users',
      monthlyPrice: 9.99,
      yearlyPrice: 99.99,
      features: [
        'Everything in Free',
        'Unlimited conversations',
        'Group chats up to 100 members',
        'Custom relay support',
        '50MB file attachments',
        'Priority support',
      ],
    },
    {
      tier: ProTier.BUSINESS,
      name: 'Business',
      description: 'Enterprise features for teams',
      monthlyPrice: 29.99,
      yearlyPrice: 299.99,
      features: [
        'Everything in Pro',
        'Groups up to 500 members',
        '100MB file attachments',
        'API access',
        'Custom branding',
        'Dedicated support',
      ],
    },
  ];
}
