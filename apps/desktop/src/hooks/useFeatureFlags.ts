/**
 * Feature Flags Hook
 * 
 * Provides access to feature flags in React components.
 * Flags are fetched from the main process via IPC.
 */

import { useState, useEffect, useCallback } from 'react';
import { loadAndVerifyEntitlement } from '../billing/entitlement';
import { type VerifiedEntitlement } from '../billing/capabilities';

// Feature flag keys - keep in sync with electron/feature-flags.ts
export const FeatureFlags = {
  DM_MESSAGING: 'dm_messaging',
  COMMUNITY_CHAT: 'community_chat',
  DEX_SWAP: 'dex_swap',
  P2P_NETWORKING: 'p2p_networking',
  WEB_APP: 'web_app',
  VOIP_PHONE: 'voip_phone',
  BIBLE_READER: 'bible_reader',
  VOICE_CHANNELS: 'voice_channels',
} as const;

export type FeatureFlagKey = typeof FeatureFlags[keyof typeof FeatureFlags];

interface FeatureFlagsState {
  flags: Record<string, boolean>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to access all feature flags
 */
export function useFeatureFlags(): FeatureFlagsState & {
  isEnabled: (key: FeatureFlagKey) => boolean;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<FeatureFlagsState>({
    flags: {},
    isLoading: true,
    error: null,
  });

  const loadFlags = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.featureFlags) {
        const flags = await window.electronAPI.featureFlags.getAll();
        setState({ flags, isLoading: false, error: null });
      } else {
        // Web/browser fallback - use conservative defaults
        setState({
          flags: {
            [FeatureFlags.DM_MESSAGING]: true,
            [FeatureFlags.COMMUNITY_CHAT]: true,
            [FeatureFlags.DEX_SWAP]: false,
            [FeatureFlags.P2P_NETWORKING]: false,
            [FeatureFlags.WEB_APP]: false,
            [FeatureFlags.VOIP_PHONE]: false,
            [FeatureFlags.BIBLE_READER]: true,
            [FeatureFlags.VOICE_CHANNELS]: true,
          },
          isLoading: false,
          error: null,
        });
      }
    } catch (err) {
      setState({
        flags: {},
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load feature flags',
      });
    }
  }, []);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const isEnabled = useCallback(
    (key: FeatureFlagKey): boolean => {
      return state.flags[key] ?? false;
    },
    [state.flags]
  );

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    if (typeof window !== 'undefined' && window.electronAPI?.featureFlags) {
      await window.electronAPI.featureFlags.refresh();
    }
    await loadFlags();
  }, [loadFlags]);

  return {
    ...state,
    isEnabled,
    refresh,
  };
}

/**
 * Hook to check if a specific feature is enabled
 */
export function useFeature(key: FeatureFlagKey): boolean {
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    const checkFeature = async () => {
      try {
        if (typeof window !== 'undefined' && window.electronAPI?.featureFlags) {
          const isEnabled = await window.electronAPI.featureFlags.get(key);
          setEnabled(isEnabled);
        } else {
          // Web fallback - conservative defaults
          const webDefaults: Record<string, boolean> = {
            [FeatureFlags.DM_MESSAGING]: true,
            [FeatureFlags.COMMUNITY_CHAT]: true,
            [FeatureFlags.DEX_SWAP]: false,
            [FeatureFlags.P2P_NETWORKING]: false,
            [FeatureFlags.WEB_APP]: false,
            [FeatureFlags.VOIP_PHONE]: false,
            [FeatureFlags.BIBLE_READER]: true,
            [FeatureFlags.VOICE_CHANNELS]: true,
          };
          setEnabled(webDefaults[key] ?? false);
        }
      } catch {
        setEnabled(false);
      }
    };

    checkFeature();
  }, [key]);

  return enabled;
}

/**
 * Hook to check if a feature requires Pro subscription
 * Returns { enabled, requiresPro, hasPro }
 */
export function usePremiumFeature(key: FeatureFlagKey): {
  enabled: boolean;
  requiresPro: boolean;
  hasPro: boolean;
  entitlement: VerifiedEntitlement | null;
} {
  const enabled = useFeature(key);
  const [entitlement, setEntitlement] = useState<VerifiedEntitlement | null>(null);
  
  useEffect(() => {
    const loadEntitlement = async () => {
      // In real implementation, you'd get the user's identity key from auth store
      // For now, attempt to load without specific identity binding
      try {
        // Try to load entitlement - identity key would come from crypto module
        // This is a simplified version - full implementation would verify identity
        const ent = await loadAndVerifyEntitlement('');
        setEntitlement(ent);
      } catch {
        setEntitlement(null);
      }
    };
    
    loadEntitlement();
  }, []);
  
  // Premium features that require Pro subscription
  const premiumFeatures: FeatureFlagKey[] = [
    FeatureFlags.VOIP_PHONE,
  ];

  const requiresPro = premiumFeatures.includes(key);
  const hasPro = entitlement !== null;

  return {
    enabled: enabled && (!requiresPro || hasPro),
    requiresPro,
    hasPro,
    entitlement,
  };
}
