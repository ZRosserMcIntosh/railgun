/**
 * Rail Gun Pro - Capabilities System
 * 
 * Defines capabilities unlocked by Pro subscription and free tier limits.
 * This is the single source of truth for feature access control.
 * 
 * SECURITY: Capability checks should be applied at the point of action
 * (sending, not receiving). Users should always be able to receive
 * any content regardless of their subscription status.
 */

// ============================================================================
// CAPABILITY DEFINITIONS
// ============================================================================

/**
 * Capabilities that can be unlocked with Pro subscription.
 * Free tier users do not have these capabilities.
 */
export enum Capability {
  /** High-resolution images (above MAX_FREE_IMAGE_DIMENSION) */
  HD_MEDIA = 'HD_MEDIA',
  
  /** Large file transfers (above MAX_FREE_FILE_BYTES) */
  LARGE_FILES = 'LARGE_FILES',
  
  /** Video calling (free users get voice only) */
  VIDEO_CALLING = 'VIDEO_CALLING',
  
  /** Long video uploads (above MAX_FREE_VIDEO_SECONDS) */
  LONG_VIDEO = 'LONG_VIDEO',
  
  /** Screen sharing in calls (future feature) */
  SCREEN_SHARE = 'SCREEN_SHARE',
  
  /** Priority access to relay network (future feature) */
  PRIORITY_RELAY = 'PRIORITY_RELAY',
}

/**
 * Subscription plans available.
 */
export enum Plan {
  FREE = 'FREE',
  PRO = 'PRO',
}

/**
 * Billing periods for paid plans.
 */
export enum BillingPeriod {
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
}

// ============================================================================
// FREE TIER LIMITS (THRESHOLDS)
// ============================================================================

/**
 * Free tier limitations.
 * These thresholds determine when Pro is required.
 */
export const FREE_TIER_LIMITS = {
  /**
   * Maximum image dimension (width or height) for free users.
   * Images larger than this require Pro for sending.
   * Recommendation: Offer to downscale images for free users.
   */
  MAX_IMAGE_DIMENSION: 1280, // pixels
  
  /**
   * Maximum video duration for free users.
   * Videos longer than this require Pro for sending.
   */
  MAX_VIDEO_SECONDS: 60,
  
  /**
   * Maximum file size for free users.
   * Files larger than this require Pro for sending.
   */
  MAX_FILE_BYTES: 100 * 1024 * 1024, // 100 MB
  
  /**
   * Whether free users can make video calls.
   * false = voice only for free users.
   */
  VIDEO_CALLING_ENABLED: false,
  
  /**
   * Whether free users can share their screen.
   * false = no screen sharing for free users.
   */
  SCREEN_SHARE_ENABLED: false,
} as const;

// ============================================================================
// PRO PRICING
// ============================================================================

/**
 * Pro subscription pricing.
 */
export const PRO_PRICING = {
  /** Monthly subscription price in USD */
  MONTHLY_PRICE: 7,
  
  /** Annual subscription price in USD */
  ANNUAL_PRICE: 77,
  
  /** Currency code */
  CURRENCY: 'USD',
  
  /** Monthly duration in days */
  MONTHLY_DURATION_DAYS: 30,
  
  /** Annual duration in days */
  ANNUAL_DURATION_DAYS: 365,
} as const;

// ============================================================================
// CAPABILITY MAPPING
// ============================================================================

/**
 * Capabilities granted by each plan.
 */
export const PLAN_CAPABILITIES: Record<Plan, Set<Capability>> = {
  [Plan.FREE]: new Set<Capability>(),
  [Plan.PRO]: new Set<Capability>([
    Capability.HD_MEDIA,
    Capability.LARGE_FILES,
    Capability.VIDEO_CALLING,
    Capability.LONG_VIDEO,
    // Future capabilities can be added here
    // Capability.SCREEN_SHARE,
    // Capability.PRIORITY_RELAY,
  ]),
};

// ============================================================================
// VERIFIED ENTITLEMENT TYPE (imported from entitlement module)
// ============================================================================

/**
 * A verified entitlement token payload.
 * This is returned after successful token verification.
 */
export interface VerifiedEntitlement {
  plan: Plan;
  billingPeriod: BillingPeriod;
  issuedAt: number;
  expiresAt: number;
  features: Capability[];
  tokenId: string;
  sub: string; // User's identity public key
}

// ============================================================================
// CAPABILITY CHECKING FUNCTIONS
// ============================================================================

/**
 * Get the effective capabilities for a user based on their entitlement.
 * 
 * @param entitlement - Verified entitlement token (undefined = free user)
 * @returns Set of capabilities the user has access to
 */
export function getCapabilities(entitlement?: VerifiedEntitlement): Set<Capability> {
  if (!entitlement) {
    return PLAN_CAPABILITIES[Plan.FREE];
  }
  
  // Check if token is expired
  const now = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_GRACE = 5 * 60; // 5 minutes
  
  if (now > entitlement.expiresAt + CLOCK_SKEW_GRACE) {
    // Token expired, return free capabilities
    return PLAN_CAPABILITIES[Plan.FREE];
  }
  
  // Return capabilities for the plan
  return PLAN_CAPABILITIES[entitlement.plan];
}

/**
 * Check if a user has a specific capability.
 * 
 * @param capability - The capability to check
 * @param entitlement - Verified entitlement token (undefined = free user)
 * @returns true if user has the capability
 */
export function hasCapability(
  capability: Capability,
  entitlement?: VerifiedEntitlement
): boolean {
  const capabilities = getCapabilities(entitlement);
  return capabilities.has(capability);
}

/**
 * Get the current plan based on entitlement.
 * 
 * @param entitlement - Verified entitlement token (undefined = free user)
 * @returns The user's current plan
 */
export function getCurrentPlan(entitlement?: VerifiedEntitlement): Plan {
  if (!entitlement) {
    return Plan.FREE;
  }
  
  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_GRACE = 5 * 60;
  
  if (now > entitlement.expiresAt + CLOCK_SKEW_GRACE) {
    return Plan.FREE;
  }
  
  return entitlement.plan;
}

// ============================================================================
// GATE CHECKING HELPERS
// ============================================================================

/**
 * Result of a capability check with details for UI.
 */
export interface CapabilityCheckResult {
  allowed: boolean;
  reason?: 'FREE_TIER_LIMIT' | 'CAPABILITY_REQUIRED' | 'EXPIRED';
  requiredCapability?: Capability;
  limit?: number | boolean;
  actual?: number | boolean;
}

/**
 * Check if an image can be sent at the given dimensions.
 * 
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param entitlement - User's entitlement
 * @returns Check result with allowed status and details
 */
export function checkImageSend(
  width: number,
  height: number,
  entitlement?: VerifiedEntitlement
): CapabilityCheckResult {
  const maxDimension = Math.max(width, height);
  const limit = FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION;
  
  if (maxDimension <= limit) {
    return { allowed: true };
  }
  
  if (hasCapability(Capability.HD_MEDIA, entitlement)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: 'FREE_TIER_LIMIT',
    requiredCapability: Capability.HD_MEDIA,
    limit,
    actual: maxDimension,
  };
}

/**
 * Check if a video can be sent at the given duration.
 * 
 * @param durationSeconds - Video duration in seconds
 * @param entitlement - User's entitlement
 * @returns Check result with allowed status and details
 */
export function checkVideoSend(
  durationSeconds: number,
  entitlement?: VerifiedEntitlement
): CapabilityCheckResult {
  const limit = FREE_TIER_LIMITS.MAX_VIDEO_SECONDS;
  
  if (durationSeconds <= limit) {
    return { allowed: true };
  }
  
  if (hasCapability(Capability.LONG_VIDEO, entitlement)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: 'FREE_TIER_LIMIT',
    requiredCapability: Capability.LONG_VIDEO,
    limit,
    actual: durationSeconds,
  };
}

/**
 * Check if a file can be sent at the given size.
 * 
 * @param sizeBytes - File size in bytes
 * @param entitlement - User's entitlement
 * @returns Check result with allowed status and details
 */
export function checkFileSend(
  sizeBytes: number,
  entitlement?: VerifiedEntitlement
): CapabilityCheckResult {
  const limit = FREE_TIER_LIMITS.MAX_FILE_BYTES;
  
  if (sizeBytes <= limit) {
    return { allowed: true };
  }
  
  if (hasCapability(Capability.LARGE_FILES, entitlement)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: 'FREE_TIER_LIMIT',
    requiredCapability: Capability.LARGE_FILES,
    limit,
    actual: sizeBytes,
  };
}

/**
 * Check if video calling is allowed.
 * 
 * @param entitlement - User's entitlement
 * @returns Check result with allowed status and details
 */
export function checkVideoCall(
  entitlement?: VerifiedEntitlement
): CapabilityCheckResult {
  if (FREE_TIER_LIMITS.VIDEO_CALLING_ENABLED) {
    return { allowed: true };
  }
  
  if (hasCapability(Capability.VIDEO_CALLING, entitlement)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: 'CAPABILITY_REQUIRED',
    requiredCapability: Capability.VIDEO_CALLING,
    limit: false,
    actual: true, // User is trying to enable video
  };
}

/**
 * Check if screen sharing is allowed.
 * 
 * @param entitlement - User's entitlement
 * @returns Check result with allowed status and details
 */
export function checkScreenShare(
  entitlement?: VerifiedEntitlement
): CapabilityCheckResult {
  if (FREE_TIER_LIMITS.SCREEN_SHARE_ENABLED) {
    return { allowed: true };
  }
  
  if (hasCapability(Capability.SCREEN_SHARE, entitlement)) {
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: 'CAPABILITY_REQUIRED',
    requiredCapability: Capability.SCREEN_SHARE,
    limit: false,
    actual: true,
  };
}

// ============================================================================
// REQUIRE CAPABILITY (THROWS)
// ============================================================================

/**
 * Error thrown when a capability check fails.
 */
export class CapabilityRequiredError extends Error {
  constructor(
    public readonly capability: Capability,
    public readonly checkResult: CapabilityCheckResult
  ) {
    super(`Pro subscription required for ${capability}`);
    this.name = 'CapabilityRequiredError';
  }
}

/**
 * Require a capability, throwing an error if not met.
 * Use this for imperative code paths where you want to halt execution.
 * 
 * @param capability - The capability to require
 * @param entitlement - User's entitlement
 * @throws CapabilityRequiredError if capability is not available
 */
export function requireCapability(
  capability: Capability,
  entitlement?: VerifiedEntitlement
): void {
  if (!hasCapability(capability, entitlement)) {
    const checkResult: CapabilityCheckResult = {
      allowed: false,
      reason: 'CAPABILITY_REQUIRED',
      requiredCapability: capability,
    };
    throw new CapabilityRequiredError(capability, checkResult);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format duration for display.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}:${secs.toString().padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get a human-readable description of a capability.
 */
export function getCapabilityDescription(capability: Capability): string {
  switch (capability) {
    case Capability.HD_MEDIA:
      return `High-resolution images (above ${FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION}px)`;
    case Capability.LARGE_FILES:
      return `Large file transfers (above ${formatFileSize(FREE_TIER_LIMITS.MAX_FILE_BYTES)})`;
    case Capability.VIDEO_CALLING:
      return 'Video calls';
    case Capability.LONG_VIDEO:
      return `Long videos (above ${formatDuration(FREE_TIER_LIMITS.MAX_VIDEO_SECONDS)})`;
    case Capability.SCREEN_SHARE:
      return 'Screen sharing';
    case Capability.PRIORITY_RELAY:
      return 'Priority relay access';
    default:
      return capability;
  }
}

/**
 * Get all Pro benefits for marketing display.
 */
export function getProBenefits(): Array<{ capability: Capability; description: string }> {
  return [
    { capability: Capability.HD_MEDIA, description: 'Send high-resolution images without compression' },
    { capability: Capability.LARGE_FILES, description: `Send files up to unlimited size (free: ${formatFileSize(FREE_TIER_LIMITS.MAX_FILE_BYTES)})` },
    { capability: Capability.VIDEO_CALLING, description: 'Video calls with end-to-end encryption' },
    { capability: Capability.LONG_VIDEO, description: `Send videos of any length (free: ${formatDuration(FREE_TIER_LIMITS.MAX_VIDEO_SECONDS)})` },
    // Future:
    // { capability: Capability.SCREEN_SHARE, description: 'Share your screen during calls' },
    // { capability: Capability.PRIORITY_RELAY, description: 'Priority access to relay network' },
  ];
}
