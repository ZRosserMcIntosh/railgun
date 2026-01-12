/**
 * Rail Gun - Group Types
 * 
 * Shared type definitions for group structures, policies, and paid groups.
 * This is used across backend, web, desktop, iOS, and Android.
 */

// ============================================================================
// GROUP POLICIES
// ============================================================================

/**
 * How users can join the group.
 */
export enum JoinPolicy {
  /** Anyone can join instantly */
  OPEN = 'OPEN',
  /** Requires owner/admin approval */
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  /** Requires invite code */
  INVITE_ONLY = 'INVITE_ONLY',
  /** Requires payment */
  PAID = 'PAID',
}

/**
 * Who can send messages in the group.
 */
export enum PostPolicy {
  /** All members can post */
  OPEN = 'OPEN',
  /** Only the owner can post (broadcast/announcement) */
  OWNER_ONLY = 'OWNER_ONLY',
  /** Users with POST_MESSAGES permission can post */
  ROLE_BASED = 'ROLE_BASED',
}

/**
 * Type of group structure.
 */
export enum GroupType {
  /** All members can post */
  FULL = 'FULL',
  /** Only owner/authorized can post */
  BROADCAST = 'BROADCAST',
  /** Requires payment to join */
  PAID = 'PAID',
}

// ============================================================================
// GROUP MEMBERSHIP
// ============================================================================

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
 * Status of a join request.
 */
export enum JoinRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// ============================================================================
// GROUP PLAN (PRICING)
// ============================================================================

/**
 * Billing interval for group subscriptions.
 * Different from user subscription billing intervals.
 */
export enum GroupBillingInterval {
  /** One-time purchase */
  ONE_TIME = 'ONE_TIME',
  /** Monthly subscription */
  MONTHLY = 'MONTHLY',
  /** Yearly subscription */
  YEARLY = 'YEARLY',
}

/**
 * Pricing plan for a paid group.
 */
export interface GroupPlan {
  id: string;
  communityId: string;
  
  /** Price in cents (e.g., 999 = $9.99) */
  priceCents: number;
  
  /** ISO 4217 currency code */
  currency: string;
  
  /** Billing interval */
  interval: GroupBillingInterval;
  
  /** Stripe Product ID (for web/desktop) */
  stripeProductId?: string;
  
  /** Stripe Price ID (for web/desktop) */
  stripePriceId?: string;
  
  /** Apple IAP Product ID (for iOS) */
  appleProductId?: string;
  
  /** Google Play Product ID (for Android) */
  googleProductId?: string;
  
  /** Whether this plan is currently available */
  isActive: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A user's membership in a paid group.
 */
export interface GroupMembership {
  id: string;
  userId: string;
  communityId: string;
  groupPlanId?: string;
  
  /** Where the payment came from */
  paymentSource: PaymentSource;
  
  /** External subscription/transaction ID */
  externalSubscriptionId?: string;
  
  /** Current status */
  status: MembershipStatus;
  
  /** When the membership started */
  startedAt: Date;
  
  /** When the current period expires */
  expiresAt?: Date;
  
  /** When the user canceled (if applicable) */
  canceledAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// JOIN REQUESTS
// ============================================================================

/**
 * A request to join a group that requires approval.
 */
export interface GroupJoinRequest {
  id: string;
  userId: string;
  communityId: string;
  
  /** Current status */
  status: JoinRequestStatus;
  
  /** Who reviewed the request */
  reviewedBy?: string;
  
  /** When the request was reviewed */
  reviewedAt?: Date;
  
  /** Optional message from the requester */
  message?: string;
  
  createdAt: Date;
}

// ============================================================================
// STRIPE CONNECT
// ============================================================================

/**
 * A group owner's connected Stripe account.
 */
export interface StripeConnectAccount {
  id: string;
  userId: string;
  
  /** Stripe Account ID */
  stripeAccountId: string;
  
  /** Account type (standard, express, custom) */
  accountType: 'standard' | 'express' | 'custom';
  
  /** Whether the account can accept charges */
  chargesEnabled: boolean;
  
  /** Whether the account can receive payouts */
  payoutsEnabled: boolean;
  
  /** Whether onboarding is complete */
  onboardingComplete: boolean;
  
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// API DTOs
// ============================================================================

/**
 * Request to create or update group policies.
 */
export interface UpdateGroupPoliciesRequest {
  joinPolicy?: JoinPolicy;
  postPolicy?: PostPolicy;
  isPublic?: boolean;
  isDiscoverable?: boolean;
  handle?: string;
}

/**
 * Response for group details including policies.
 */
export interface GroupDetailsResponse {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  handle?: string;
  
  /** Group type */
  groupType: GroupType;
  
  /** Policies */
  joinPolicy: JoinPolicy;
  postPolicy: PostPolicy;
  isPublic: boolean;
  isDiscoverable: boolean;
  
  /** Stats */
  memberCount: number;
  
  /** Pricing (if paid) */
  plan?: GroupPlan;
  
  /** Current user's membership (if any) */
  membership?: {
    status: MembershipStatus;
    expiresAt?: Date;
  };
  
  /** Current user's permissions */
  permissions?: {
    canPost: boolean;
    canManage: boolean;
    canInvite: boolean;
  };
}

/**
 * Request to create a group plan.
 */
export interface CreateGroupPlanRequest {
  priceCents: number;
  currency?: string;
  interval: GroupBillingInterval;
}

/**
 * Request to join a group.
 */
export interface JoinGroupRequest {
  /** Optional message for approval-required groups */
  message?: string;
}

/**
 * Response when joining a group.
 */
export interface JoinGroupResponse {
  /** Whether the user was immediately added */
  joined: boolean;
  
  /** If not immediately joined, the join request ID */
  requestId?: string;
  
  /** If payment required, checkout URL (Stripe) */
  checkoutUrl?: string;
  
  /** If payment required on iOS, product ID */
  appleProductId?: string;
  
  /** If payment required on Android, product ID */
  googleProductId?: string;
  
  /** Message to display */
  message: string;
}

/**
 * Request to verify an IAP purchase.
 */
export interface VerifyPurchaseRequest {
  /** The group being joined */
  communityId: string;
  
  /** Payment source */
  source: PaymentSource.APPLE_IAP | PaymentSource.GOOGLE_PLAY;
  
  /** For iOS: base64 encoded receipt data or JWS transaction */
  receipt?: string;
  
  /** For Android: purchase token */
  purchaseToken?: string;
  
  /** Product ID */
  productId: string;
}

/**
 * Response from purchase verification.
 */
export interface VerifyPurchaseResponse {
  success: boolean;
  membership?: GroupMembership;
  error?: string;
}

/**
 * Stripe Connect OAuth URL response.
 */
export interface StripeConnectUrlResponse {
  url: string;
}

/**
 * Stripe Connect account status.
 */
export interface StripeConnectStatusResponse {
  connected: boolean;
  account?: StripeConnectAccount;
  dashboardUrl?: string;
}

// ============================================================================
// DISCOVERY
// ============================================================================

/**
 * A group in the discovery list.
 */
export interface DiscoverableGroup {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  handle?: string;
  
  groupType: GroupType;
  joinPolicy: JoinPolicy;
  memberCount: number;
  
  /** Price if paid (null = free) */
  price?: {
    cents: number;
    currency: string;
    interval: GroupBillingInterval;
  };
}

/**
 * Response for group discovery.
 */
export interface DiscoverGroupsResponse {
  groups: DiscoverableGroup[];
  cursor?: string;
}

// ============================================================================
// DEEP LINKS
// ============================================================================

/**
 * Deep link data for joining a group.
 */
export interface GroupDeepLink {
  handle: string;
  source?: 'qr' | 'link' | 'share';
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

/**
 * Generate a join URL for a group.
 */
export function getGroupJoinUrl(handle: string, options?: { 
  useAppLink?: boolean;
  utm?: GroupDeepLink['utm'];
}): string {
  const base = options?.useAppLink 
    ? `railgun://join/${handle}`
    : `https://railgun.app/join/${handle}`;
  
  if (!options?.utm) return base;
  
  const params = new URLSearchParams();
  if (options.utm.source) params.set('utm_source', options.utm.source);
  if (options.utm.medium) params.set('utm_medium', options.utm.medium);
  if (options.utm.campaign) params.set('utm_campaign', options.utm.campaign);
  
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Parse a group join URL.
 */
export function parseGroupJoinUrl(url: string): GroupDeepLink | null {
  try {
    // Handle app links
    if (url.startsWith('railgun://join/')) {
      const handle = url.slice('railgun://join/'.length).split('?')[0];
      return { handle, source: 'link' };
    }
    
    // Handle web URLs
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/join\/([a-zA-Z0-9_-]+)$/);
    if (!match) return null;
    
    return {
      handle: match[1],
      source: parsed.searchParams.get('utm_medium') === 'qr' ? 'qr' : 'link',
      utm: {
        source: parsed.searchParams.get('utm_source') || undefined,
        medium: parsed.searchParams.get('utm_medium') || undefined,
        campaign: parsed.searchParams.get('utm_campaign') || undefined,
      },
    };
  } catch {
    return null;
  }
}
