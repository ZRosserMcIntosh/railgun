/**
 * Rail Gun Pro - Billing Store
 * 
 * Zustand store for managing Pro subscription state.
 * Handles entitlement loading, verification, and capability checks.
 */

import { create } from 'zustand';
import {
  Plan,
  Capability,
  VerifiedEntitlement,
  CapabilityCheckResult,
  VerificationError,
  loadAndVerifyEntitlement,
  importEntitlementToken,
  clearEntitlementToken,
  exportEntitlementToken,
  getCapabilities,
  hasCapability,
  getCurrentPlan,
  checkImageSend,
  checkVideoSend,
  checkFileSend,
  checkVideoCall,
  checkScreenShare,
  getDaysUntilExpiration,
  isExpiringSoon,
  formatExpirationDate,
  getVerificationErrorMessage,
} from '../billing';
import { getIdentityPublicKey } from '../auth/identity';

// ============================================================================
// TYPES
// ============================================================================

interface BillingState {
  // Current entitlement (null = free tier or not loaded)
  entitlement: VerifiedEntitlement | null;
  
  // Loading state
  isLoading: boolean;
  isInitialized: boolean;
  
  // Error state
  error: string | null;
  
  // Cached capabilities for quick access
  capabilities: Set<Capability>;
  plan: Plan;
  
  // Paywall modal state
  isPaywallOpen: boolean;
  paywallContext: PaywallContext | null;
  
  // Actions
  initialize: () => Promise<void>;
  importToken: (tokenString: string) => Promise<ImportResult>;
  exportToken: () => Promise<string | null>;
  clearToken: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
  
  // Capability checks
  hasCapability: (capability: Capability) => boolean;
  checkImage: (width: number, height: number) => CapabilityCheckResult;
  checkVideo: (durationSeconds: number) => CapabilityCheckResult;
  checkFile: (sizeBytes: number) => CapabilityCheckResult;
  checkVideoCall: () => CapabilityCheckResult;
  checkScreenShare: () => CapabilityCheckResult;
  
  // Paywall
  openPaywall: (context?: PaywallContext) => void;
  closePaywall: () => void;
  
  // Computed
  getDaysRemaining: () => number;
  isExpiringSoon: () => boolean;
  getExpirationDate: () => string | null;
}

export interface PaywallContext {
  /** Which capability triggered the paywall */
  capability?: Capability;
  /** Description of what user was trying to do */
  action?: string;
  /** Additional context (e.g., file size, image dimensions) */
  details?: Record<string, unknown>;
}

export interface ImportResult {
  success: boolean;
  error?: VerificationError;
  errorMessage?: string;
}

// ============================================================================
// LOCAL LOGGING (for instrumentation)
// ============================================================================

interface GateLog {
  timestamp: number;
  capability: Capability;
  action: 'blocked' | 'downscaled' | 'allowed';
  context?: Record<string, unknown>;
}

const gateLogs: GateLog[] = [];
const MAX_GATE_LOGS = 100;

function logGateEvent(
  capability: Capability,
  action: 'blocked' | 'downscaled' | 'allowed',
  context?: Record<string, unknown>
): void {
  gateLogs.push({
    timestamp: Date.now(),
    capability,
    action,
    context,
  });
  
  // Keep logs bounded
  if (gateLogs.length > MAX_GATE_LOGS) {
    gateLogs.shift();
  }
  
  // Also log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[BillingGate] ${capability}: ${action}`, context);
  }
}

/**
 * Get recent gate logs for debugging/analytics.
 */
export function getGateLogs(): GateLog[] {
  return [...gateLogs];
}

// ============================================================================
// STORE
// ============================================================================

export const useBillingStore = create<BillingState>()((set, get) => ({
  // Initial state
  entitlement: null,
  isLoading: false,
  isInitialized: false,
  error: null,
  capabilities: new Set<Capability>(),
  plan: Plan.FREE,
  isPaywallOpen: false,
  paywallContext: null,

  /**
   * Initialize billing - load and verify stored entitlement.
   * Call this after crypto is initialized and user identity is available.
   */
  initialize: async () => {
    if (get().isInitialized) return;
    
    set({ isLoading: true, error: null });
    
    try {
      // Get user's identity public key
      const identityKey = await getIdentityPublicKey();
      
      // Load and verify stored token
      const entitlement = await loadAndVerifyEntitlement(identityKey);
      
      // Update state
      const plan = getCurrentPlan(entitlement ?? undefined);
      const capabilities = getCapabilities(entitlement ?? undefined);
      
      set({
        entitlement,
        plan,
        capabilities,
        isLoading: false,
        isInitialized: true,
      });
      
      // Log expiration warning if needed
      if (entitlement && isExpiringSoon(entitlement)) {
        console.warn('[Billing] Pro subscription expiring soon:', getDaysUntilExpiration(entitlement), 'days left');
      }
    } catch (error) {
      console.error('[Billing] Failed to initialize:', error);
      set({
        error: 'Failed to load subscription status',
        isLoading: false,
        isInitialized: true,
        plan: Plan.FREE,
        capabilities: getCapabilities(undefined),
      });
    }
  },

  /**
   * Import a Pro token from string (file content or paste).
   */
  importToken: async (tokenString: string): Promise<ImportResult> => {
    set({ isLoading: true, error: null });
    
    try {
      const identityKey = await getIdentityPublicKey();
      const result = await importEntitlementToken(tokenString, identityKey);
      
      if (result.valid) {
        const plan = getCurrentPlan(result.entitlement);
        const capabilities = getCapabilities(result.entitlement);
        
        set({
          entitlement: result.entitlement,
          plan,
          capabilities,
          isLoading: false,
          isPaywallOpen: false, // Close paywall on success
        });
        
        return { success: true };
      } else {
        const errorMessage = getVerificationErrorMessage(result.reason);
        set({
          error: errorMessage,
          isLoading: false,
        });
        
        return {
          success: false,
          error: result.reason,
          errorMessage,
        };
      }
    } catch (error) {
      const errorMessage = 'Failed to import token';
      set({
        error: errorMessage,
        isLoading: false,
      });
      return { success: false, errorMessage };
    }
  },

  /**
   * Export the current token for backup/transfer.
   */
  exportToken: async (): Promise<string | null> => {
    return exportEntitlementToken();
  },

  /**
   * Clear the current token (logout or downgrade).
   */
  clearToken: async () => {
    await clearEntitlementToken();
    
    set({
      entitlement: null,
      plan: Plan.FREE,
      capabilities: getCapabilities(undefined),
      error: null,
    });
  },

  /**
   * Refresh entitlement status (re-verify stored token).
   */
  refreshEntitlement: async () => {
    const { initialize } = get();
    set({ isInitialized: false });
    await initialize();
  },

  /**
   * Check if user has a specific capability.
   */
  hasCapability: (capability: Capability): boolean => {
    const { entitlement } = get();
    return hasCapability(capability, entitlement ?? undefined);
  },

  /**
   * Check if an image can be sent.
   */
  checkImage: (width: number, height: number): CapabilityCheckResult => {
    const { entitlement } = get();
    const result = checkImageSend(width, height, entitlement ?? undefined);
    
    if (!result.allowed) {
      logGateEvent(Capability.HD_MEDIA, 'blocked', { width, height });
    }
    
    return result;
  },

  /**
   * Check if a video can be sent.
   */
  checkVideo: (durationSeconds: number): CapabilityCheckResult => {
    const { entitlement } = get();
    const result = checkVideoSend(durationSeconds, entitlement ?? undefined);
    
    if (!result.allowed) {
      logGateEvent(Capability.LONG_VIDEO, 'blocked', { durationSeconds });
    }
    
    return result;
  },

  /**
   * Check if a file can be sent.
   */
  checkFile: (sizeBytes: number): CapabilityCheckResult => {
    const { entitlement } = get();
    const result = checkFileSend(sizeBytes, entitlement ?? undefined);
    
    if (!result.allowed) {
      logGateEvent(Capability.LARGE_FILES, 'blocked', { sizeBytes });
    }
    
    return result;
  },

  /**
   * Check if video calling is allowed.
   */
  checkVideoCall: (): CapabilityCheckResult => {
    const { entitlement } = get();
    const result = checkVideoCall(entitlement ?? undefined);
    
    if (!result.allowed) {
      logGateEvent(Capability.VIDEO_CALLING, 'blocked');
    }
    
    return result;
  },

  /**
   * Check if screen sharing is allowed.
   */
  checkScreenShare: (): CapabilityCheckResult => {
    const { entitlement } = get();
    const result = checkScreenShare(entitlement ?? undefined);
    
    if (!result.allowed) {
      logGateEvent(Capability.SCREEN_SHARE, 'blocked');
    }
    
    return result;
  },

  /**
   * Open the paywall modal.
   */
  openPaywall: (context?: PaywallContext) => {
    set({
      isPaywallOpen: true,
      paywallContext: context ?? null,
    });
  },

  /**
   * Close the paywall modal.
   */
  closePaywall: () => {
    set({
      isPaywallOpen: false,
      paywallContext: null,
    });
  },

  /**
   * Get days remaining until expiration.
   */
  getDaysRemaining: (): number => {
    const { entitlement } = get();
    if (!entitlement) return 0;
    return getDaysUntilExpiration(entitlement);
  },

  /**
   * Check if subscription is expiring soon.
   */
  isExpiringSoon: (): boolean => {
    const { entitlement } = get();
    if (!entitlement) return false;
    return isExpiringSoon(entitlement);
  },

  /**
   * Get formatted expiration date.
   */
  getExpirationDate: (): string | null => {
    const { entitlement } = get();
    if (!entitlement) return null;
    return formatExpirationDate(entitlement);
  },
}));

// ============================================================================
// SELECTOR HOOKS
// ============================================================================

/**
 * Hook to check if user is Pro.
 */
export function useIsPro(): boolean {
  return useBillingStore((state) => state.plan === Plan.PRO);
}

/**
 * Hook to get current plan.
 */
export function usePlan(): Plan {
  return useBillingStore((state) => state.plan);
}

/**
 * Hook to check a specific capability.
 */
export function useHasCapability(capability: Capability): boolean {
  return useBillingStore((state) => state.capabilities.has(capability));
}

/**
 * Hook for paywall state.
 */
export function usePaywall() {
  return useBillingStore((state) => ({
    isOpen: state.isPaywallOpen,
    context: state.paywallContext,
    open: state.openPaywall,
    close: state.closePaywall,
  }));
}

/**
 * Hook for subscription info.
 */
export function useSubscriptionInfo() {
  return useBillingStore((state) => ({
    plan: state.plan,
    billingPeriod: state.entitlement?.billingPeriod ?? null,
    daysRemaining: state.getDaysRemaining(),
    expiresAt: state.getExpirationDate(),
    isExpiringSoon: state.isExpiringSoon(),
  }));
}
