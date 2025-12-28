/**
 * Analytics Client for Rail Gun Desktop (Renderer Process)
 * 
 * Provides a React-friendly API for tracking events from the renderer process.
 * All events are sent to the main process via IPC, which handles batching and sending.
 */

// ============================================================================
// Types
// ============================================================================

export interface TrackingProperties {
  [key: string]: string | number | boolean;
}

export interface AnalyticsClient {
  track: (eventName: string, properties?: TrackingProperties) => void;
  trackScreen: (screenName: string, properties?: TrackingProperties) => void;
  trackTiming: (name: string, durationMs: number, properties?: TrackingProperties) => void;
  trackFeature: (featureName: string, properties?: TrackingProperties) => void;
  trackConversion: (funnelName: string, step: string, properties?: TrackingProperties) => void;
  trackError: (errorType: string, message: string) => void;
  setConsent: (consent: boolean) => Promise<void>;
  getConsent: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  flush: () => Promise<void>;
}

// ============================================================================
// Create Analytics Client
// ============================================================================

function createAnalyticsClient(): AnalyticsClient {
  // Check if we're in Electron with preload script
  const electronAPI = (window as unknown as { electronAPI?: {
    analytics: {
      track: (name: string, properties?: TrackingProperties) => void;
      trackScreen: (screenName: string) => void;
      trackTiming: (name: string, duration: number, properties?: TrackingProperties) => void;
      setConsent: (consent: boolean) => Promise<void>;
      getConsent: () => Promise<boolean>;
      isEnabled: () => Promise<boolean>;
      flush: () => Promise<void>;
    };
  } })?.electronAPI;

  if (electronAPI?.analytics) {
    // Running in Electron with proper preload
    return {
      track: (eventName, properties) => {
        electronAPI.analytics.track(eventName, properties);
      },
      trackScreen: (screenName, properties) => {
        electronAPI.analytics.track('screen_view', { screen_name: screenName, ...properties });
      },
      trackTiming: (name, durationMs, properties) => {
        electronAPI.analytics.trackTiming(name, durationMs, properties);
      },
      trackFeature: (featureName, properties) => {
        electronAPI.analytics.track(`feature_${featureName}`, properties);
      },
      trackConversion: (funnelName, step, properties) => {
        electronAPI.analytics.track(`funnel_${funnelName}`, { step, ...properties });
      },
      trackError: (errorType, message) => {
        electronAPI.analytics.track('error', { error_type: errorType, error_message: message });
      },
      setConsent: (consent) => electronAPI.analytics.setConsent(consent),
      getConsent: () => electronAPI.analytics.getConsent(),
      isEnabled: () => electronAPI.analytics.isEnabled(),
      flush: () => electronAPI.analytics.flush(),
    };
  }

  // Fallback for web or development
  const isDev = process.env.NODE_ENV === 'development';
  
  return {
    track: (eventName, properties) => {
      if (isDev) {
        console.log('[Analytics]', eventName, properties);
      }
    },
    trackScreen: (screenName, properties) => {
      if (isDev) {
        console.log('[Analytics] Screen:', screenName, properties);
      }
    },
    trackTiming: (name, durationMs, properties) => {
      if (isDev) {
        console.log('[Analytics] Timing:', name, `${durationMs}ms`, properties);
      }
    },
    trackFeature: (featureName, properties) => {
      if (isDev) {
        console.log('[Analytics] Feature:', featureName, properties);
      }
    },
    trackConversion: (funnelName, step, properties) => {
      if (isDev) {
        console.log('[Analytics] Funnel:', funnelName, step, properties);
      }
    },
    trackError: (errorType, message) => {
      if (isDev) {
        console.log('[Analytics] Error:', errorType, message);
      }
    },
    setConsent: async () => {},
    getConsent: async () => true,
    isEnabled: async () => isDev,
    flush: async () => {},
  };
}

// Singleton instance
let analyticsInstance: AnalyticsClient | null = null;

export function getAnalytics(): AnalyticsClient {
  if (!analyticsInstance) {
    analyticsInstance = createAnalyticsClient();
  }
  return analyticsInstance;
}

// ============================================================================
// Timing Utilities
// ============================================================================

/**
 * Measure the duration of an async operation
 */
export async function withTiming<T>(
  name: string,
  operation: () => Promise<T>,
  properties?: TrackingProperties
): Promise<T> {
  const startTime = performance.now();
  try {
    const result = await operation();
    const duration = Math.round(performance.now() - startTime);
    getAnalytics().trackTiming(name, duration, { ...properties, success: true });
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    getAnalytics().trackTiming(name, duration, { ...properties, success: false });
    throw error;
  }
}

/**
 * Create a timing tracker for manual start/stop
 */
export function createTimer(name: string, properties?: TrackingProperties) {
  const startTime = performance.now();
  
  return {
    stop: (additionalProps?: TrackingProperties) => {
      const duration = Math.round(performance.now() - startTime);
      getAnalytics().trackTiming(name, duration, { ...properties, ...additionalProps });
      return duration;
    },
  };
}

// ============================================================================
// React Hooks
// ============================================================================

import { useEffect, useCallback, useRef } from 'react';

/**
 * Track screen/page view when component mounts
 */
export function useScreenTracking(screenName: string, properties?: TrackingProperties) {
  const hasTracked = useRef(false);
  
  useEffect(() => {
    if (!hasTracked.current) {
      getAnalytics().trackScreen(screenName, properties);
      hasTracked.current = true;
    }
  }, [screenName]); // Only track once per screen name
}

/**
 * Track an event with dependencies
 */
export function useTrackEvent() {
  return useCallback((eventName: string, properties?: TrackingProperties) => {
    getAnalytics().track(eventName, properties);
  }, []);
}

/**
 * Track feature usage
 */
export function useFeatureTracking(featureName: string) {
  const hasTracked = useRef(false);
  
  const trackUsage = useCallback((properties?: TrackingProperties) => {
    getAnalytics().trackFeature(featureName, properties);
  }, [featureName]);

  const trackOnce = useCallback((properties?: TrackingProperties) => {
    if (!hasTracked.current) {
      getAnalytics().trackFeature(featureName, properties);
      hasTracked.current = true;
    }
  }, [featureName]);

  return { trackUsage, trackOnce };
}

/**
 * Track funnel progression
 */
export function useFunnelTracking(funnelName: string) {
  const currentStep = useRef<string | null>(null);
  
  const trackStep = useCallback((step: string, properties?: TrackingProperties) => {
    getAnalytics().trackConversion(funnelName, step, {
      previous_step: currentStep.current || 'none',
      ...properties,
    });
    currentStep.current = step;
  }, [funnelName]);

  return { trackStep };
}

// ============================================================================
// Predefined Events
// ============================================================================

export const Events = {
  // Onboarding funnel
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_USERNAME_SET: 'onboarding_username_set',
  ONBOARDING_KEYS_GENERATED: 'onboarding_keys_generated',
  ONBOARDING_COMPLETED: 'onboarding_completed',

  // Messaging
  CONVERSATION_OPENED: 'conversation_opened',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  ATTACHMENT_SENT: 'attachment_sent',

  // Social
  CONTACT_ADDED: 'contact_added',
  CONTACT_BLOCKED: 'contact_blocked',
  GROUP_CREATED: 'group_created',
  GROUP_JOINED: 'group_joined',

  // Settings
  SETTINGS_OPENED: 'settings_opened',
  THEME_CHANGED: 'theme_changed',
  NOTIFICATION_TOGGLED: 'notification_toggled',

  // Security
  SAFETY_NUMBER_VERIFIED: 'safety_number_verified',
  KEYS_EXPORTED: 'keys_exported',
  KEYS_IMPORTED: 'keys_imported',

  // App lifecycle
  APP_LAUNCHED: 'app_launched',
  APP_BACKGROUNDED: 'app_backgrounded',
  APP_FOREGROUNDED: 'app_foregrounded',
  APP_CRASHED: 'app_crashed',

  // Updates
  UPDATE_CHECKED: 'update_checked',
  UPDATE_AVAILABLE: 'update_available',
  UPDATE_DOWNLOADED: 'update_downloaded',
  UPDATE_INSTALLED: 'update_installed',
  UPDATE_DECLINED: 'update_declined',
} as const;

export const Screens = {
  HOME: 'home',
  CHAT: 'chat',
  SETTINGS: 'settings',
  PROFILE: 'profile',
  CONTACTS: 'contacts',
  NEW_CHAT: 'new_chat',
  NEW_GROUP: 'new_group',
  GROUP_SETTINGS: 'group_settings',
  SECURITY: 'security',
  ABOUT: 'about',
} as const;

export const Funnels = {
  ONBOARDING: 'onboarding',
  FIRST_MESSAGE: 'first_message',
  GROUP_CREATION: 'group_creation',
  INVITE_FLOW: 'invite_flow',
} as const;
