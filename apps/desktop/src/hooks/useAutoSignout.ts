import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';

/**
 * Auto-signout timer hook
 * Automatically logs out user after inactivity period set in settings
 */
export function useAutoSignout() {
  const { autoSignoutEnabled, autoSignoutMinutes } = useSettingsStore();
  const { logout, isAuthenticated } = useAuthStore();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  const resetTimer = useCallback(() => {
    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    // Only set new timer if enabled and authenticated
    if (!autoSignoutEnabled || !isAuthenticated) {
      return;
    }
    
    // Set new timer
    timerRef.current = setTimeout(() => {
      console.log('[AutoSignout] Inactivity timeout reached, logging out...');
      logout();
    }, autoSignoutMinutes * 60 * 1000);
  }, [autoSignoutEnabled, autoSignoutMinutes, logout, isAuthenticated]);
  
  useEffect(() => {
    if (!autoSignoutEnabled || !isAuthenticated) {
      // Clear timer if disabled or not authenticated
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    
    // Start timer
    resetTimer();
    
    // Activity events that reset the timer
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click'
    ];
    
    // Throttle reset to avoid too many calls
    let throttleTimeout: NodeJS.Timeout | null = null;
    const throttledReset = () => {
      if (!throttleTimeout) {
        throttleTimeout = setTimeout(() => {
          resetTimer();
          throttleTimeout = null;
        }, 1000); // Throttle to once per second
      }
    };
    
    // Add event listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, throttledReset, true);
    });
    
    // Cleanup
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (throttleTimeout) {
        clearTimeout(throttleTimeout);
      }
      activityEvents.forEach(event => {
        document.removeEventListener(event, throttledReset, true);
      });
    };
  }, [autoSignoutEnabled, isAuthenticated, resetTimer]);
}
