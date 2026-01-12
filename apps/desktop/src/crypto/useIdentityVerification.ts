/**
 * Identity Verification Hook
 * 
 * Manages identity verification state and warnings for contacts.
 * Integrates with the crypto module's identity store.
 */

import { useState, useCallback, useEffect } from 'react';
import { getCrypto, type IdentityStatus } from '../crypto';

interface UseIdentityVerificationOptions {
  /** User ID of the contact to verify */
  userId: string;
  
  /** Current identity key (base64) from the server */
  identityKey: string;
  
  /** Username for display purposes */
  username: string;
  
  /** Auto-check identity on mount */
  autoCheck?: boolean;
}

interface IdentityVerificationState {
  /** Loading state */
  isLoading: boolean;
  
  /** Current identity status */
  status: IdentityStatus | null;
  
  /** Whether to show the identity change warning modal */
  showWarning: boolean;
  
  /** Whether to show inline banner */
  showBanner: boolean;
  
  /** Error if any */
  error: string | null;
  
  /** The safety number string */
  safetyNumber: string | null;
}

interface IdentityVerificationActions {
  /** Check identity against stored value */
  checkIdentity: () => Promise<IdentityStatus>;
  
  /** Mark the identity as verified (user confirmed safety numbers match) */
  verify: () => Promise<void>;
  
  /** Accept the new identity without full verification (proceed with caution) */
  acceptWithoutVerifying: () => Promise<void>;
  
  /** Dismiss the warning banner/modal */
  dismissWarning: () => void;
  
  /** Show the safety number verification modal */
  showSafetyNumber: () => void;
  
  /** Get the safety number for this contact */
  getSafetyNumber: () => string | null;
}

export function useIdentityVerification(
  options: UseIdentityVerificationOptions
): [IdentityVerificationState, IdentityVerificationActions] {
  const { userId, identityKey, autoCheck = true } = options;

  const [state, setState] = useState<IdentityVerificationState>({
    isLoading: false,
    status: null,
    showWarning: false,
    showBanner: false,
    error: null,
    safetyNumber: null,
  });

  /**
   * Check identity against stored value
   */
  const checkIdentity = useCallback(async (): Promise<IdentityStatus> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const crypto = getCrypto();
      
      if (!crypto.isInitialized()) {
        throw new Error('Crypto not initialized');
      }

      // Store/update identity and check for changes
      const storeResult = await (crypto as unknown as {
        storeIdentity: (userId: string, key: string) => Promise<{ isNew: boolean; hasChanged: boolean; previousKey?: string }>;
      }).storeIdentity(userId, identityKey);

      // Get full status
      const status = await (crypto as unknown as {
        checkIdentityStatus: (userId: string, key: string) => Promise<IdentityStatus>;
      }).checkIdentityStatus(userId, identityKey);

      // Compute safety number
      let safetyNumber: string | null = null;
      try {
        safetyNumber = crypto.computeSafetyNumber(userId, identityKey);
      } catch (e) {
        console.warn('Could not compute safety number:', e);
      }

      // Determine if we need to show warnings
      const showWarning = storeResult.hasChanged;
      const showBanner = storeResult.hasChanged || (!status.isVerified && status.hasStoredIdentity);

      setState(prev => ({
        ...prev,
        isLoading: false,
        status,
        showWarning,
        showBanner,
        safetyNumber,
      }));

      return status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, [userId, identityKey]);

  /**
   * Mark identity as verified
   */
  const verify = useCallback(async (): Promise<void> => {
    try {
      const crypto = getCrypto();
      await crypto.markIdentityVerified(userId);
      
      // Re-check status after verification
      const status = await (crypto as unknown as {
        checkIdentityStatus: (userId: string, key: string) => Promise<IdentityStatus>;
      }).checkIdentityStatus(userId, identityKey);
      
      setState(prev => ({
        ...prev,
        status,
        showWarning: false,
        showBanner: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, error: errorMessage }));
      throw error;
    }
  }, [userId, identityKey]);

  /**
   * Accept new identity without full verification
   */
  const acceptWithoutVerifying = useCallback(async (): Promise<void> => {
    // Just dismiss the warning - identity is already stored
    setState(prev => ({
      ...prev,
      showWarning: false,
      showBanner: true, // Keep banner as reminder to verify
    }));
  }, []);

  /**
   * Dismiss warning
   */
  const dismissWarning = useCallback((): void => {
    setState(prev => ({
      ...prev,
      showWarning: false,
      showBanner: false,
    }));
  }, []);

  /**
   * Show safety number modal
   */
  const showSafetyNumber = useCallback((): void => {
    // This would typically trigger a modal via state/context
    // For now just log - actual modal handling is in the component
    console.log('[IdentityVerification] Show safety number for', userId);
  }, [userId]);

  /**
   * Get current safety number
   */
  const getSafetyNumber = useCallback((): string | null => {
    return state.safetyNumber;
  }, [state.safetyNumber]);

  // Auto-check on mount if enabled
  useEffect(() => {
    if (autoCheck && identityKey) {
      checkIdentity().catch(console.error);
    }
  }, [autoCheck, identityKey, checkIdentity]);

  return [
    state,
    {
      checkIdentity,
      verify,
      acceptWithoutVerifying,
      dismissWarning,
      showSafetyNumber,
      getSafetyNumber,
    },
  ];
}

/**
 * Hook to get just the verified status for display
 */
export function useIsVerified(userId: string): boolean {
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    const checkVerification = async () => {
      try {
        const crypto = getCrypto();
        if (!crypto.isInitialized()) return;
        
        const stored = await (crypto as unknown as {
          getStoredIdentity: (userId: string) => Promise<{ verified: boolean } | null>;
        }).getStoredIdentity(userId);
        
        setIsVerified(stored?.verified ?? false);
      } catch {
        setIsVerified(false);
      }
    };

    checkVerification();
  }, [userId]);

  return isVerified;
}

export default useIdentityVerification;
