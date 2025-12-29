/**
 * Environment Configuration for Desktop App
 * 
 * This module provides centralized access to environment-specific configuration.
 * Values can come from:
 * 1. Vite environment variables (VITE_*)
 * 2. Window globals injected by Electron preload
 * 3. Default values for development
 */

// Type for window globals that might be injected by Electron
interface RailgunGlobals {
  __RAILGUN_API_URL__?: string;
  __RAILGUN_WS_URL__?: string;
  __RAILGUN_UPDATE_URL__?: string;
  __RAILGUN_ENV__?: 'development' | 'staging' | 'production';
}

// Extend window type
declare global {
  interface Window extends RailgunGlobals {}
}

/**
 * Get a configuration value from environment or window globals
 */
function getEnvValue(
  viteKey: string,
  windowKey: keyof RailgunGlobals,
  defaultValue: string
): string {
  // Check Vite env first
  const viteValue = (import.meta.env as Record<string, string | undefined>)[viteKey];
  if (viteValue) return viteValue;

  // Check window globals (injected by Electron preload)
  if (typeof window !== 'undefined' && window[windowKey]) {
    return window[windowKey] as string;
  }

  // Return default
  return defaultValue;
}

/**
 * Determine current environment
 */
export function getEnvironment(): 'development' | 'staging' | 'production' {
  if (import.meta.env.PROD) {
    return 'production';
  }
  const env = getEnvValue('VITE_ENV', '__RAILGUN_ENV__', 'development');
  return env as 'development' | 'staging' | 'production';
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return getEnvironment() === 'development';
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return getEnvironment() === 'production';
}

/**
 * Application Configuration
 */
export const config = {
  /**
   * API base URL (without /api/v1 suffix)
   */
  get apiBaseUrl(): string {
    return getEnvValue(
      'VITE_API_URL',
      '__RAILGUN_API_URL__',
      'http://localhost:3001'
    );
  },

  /**
   * Full API URL with version prefix
   */
  get apiUrl(): string {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
  },

  /**
   * WebSocket URL
   */
  get wsUrl(): string {
    const explicit = getEnvValue(
      'VITE_WS_URL',
      '__RAILGUN_WS_URL__',
      ''
    );

    if (explicit) {
      return explicit.replace(/\/$/, '').endsWith('/ws')
        ? explicit.replace(/\/$/, '')
        : `${explicit.replace(/\/$/, '')}/ws`;
    }

    // Derive from API base URL
    const apiOrigin = new URL(this.apiBaseUrl).origin;
    const wsProtocol = apiOrigin.startsWith('https://') ? 'wss://' : 'ws://';
    const host = apiOrigin.replace(/^https?:\/\//, '');
    return `${wsProtocol}${host}/ws`;
  },

  /**
   * Update server URL for auto-updates
   */
  get updateUrl(): string {
    return getEnvValue(
      'VITE_UPDATE_URL',
      '__RAILGUN_UPDATE_URL__',
      'https://update.railgun.app'
    );
  },

  /**
   * Current environment
   */
  get environment(): 'development' | 'staging' | 'production' {
    return getEnvironment();
  },

  /**
   * Whether running in development mode
   */
  get isDev(): boolean {
    return isDevelopment();
  },

  /**
   * Whether running in production mode
   */
  get isProd(): boolean {
    return isProduction();
  },
} as const;

export default config;
