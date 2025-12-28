/**
 * Rail Gun Pro - Billing Module
 * 
 * Exports for Pro subscription functionality.
 */

// Capabilities system
export {
  Capability,
  Plan,
  BillingPeriod,
  FREE_TIER_LIMITS,
  PRO_PRICING,
  PLAN_CAPABILITIES,
  getCapabilities,
  hasCapability,
  getCurrentPlan,
  checkImageSend,
  checkVideoSend,
  checkFileSend,
  checkVideoCall,
  checkScreenShare,
  requireCapability,
  CapabilityRequiredError,
  formatFileSize,
  formatDuration,
  getCapabilityDescription,
  getProBenefits,
} from './capabilities';

export type {
  VerifiedEntitlement,
  CapabilityCheckResult,
} from './capabilities';

// Entitlement token system
export {
  TOKEN_VERSION,
  TOKEN_PREFIX,
  CLOCK_SKEW_GRACE_SECONDS,
  ENTITLEMENT_STORAGE_KEY,
  TOKEN_FILE_EXTENSION,
  ENTITLEMENT_PUBLIC_KEYS,
  parseTokenString,
  serializeToken,
  verifyEntitlementToken,
  saveEntitlementToken,
  loadEntitlementToken,
  clearEntitlementToken,
  exportEntitlementToken,
  importEntitlementToken,
  loadAndVerifyEntitlement,
  createEntitlementToken,
  generateSigningKeypair,
  getDaysUntilExpiration,
  isExpiringSoon,
  formatExpirationDate,
  getVerificationErrorMessage,
  parseDeepLinkToken,
  createDeepLinkUrl,
} from './entitlement';

export type {
  EntitlementPayload,
  EntitlementToken,
  VerificationResult,
  VerificationError,
} from './entitlement';
