/**
 * Secure Token Store
 * 
 * Uses Electron's safeStorage API to securely store authentication tokens.
 * Tokens are encrypted using OS-level encryption:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret
 * 
 * Falls back to localStorage if running in browser or if encryption is unavailable.
 */

const TOKEN_KEYS = {
  ACCESS_TOKEN: 'railgun_access_token',
  REFRESH_TOKEN: 'railgun_refresh_token',
} as const;

/**
 * Check if we're running in Electron with secure storage available
 */
function isElectron(): boolean {
  return typeof window !== 'undefined' && 
         typeof window.electronAPI !== 'undefined' &&
         typeof window.electronAPI.secureStore !== 'undefined';
}

/**
 * Securely store a value
 */
async function secureSet(key: string, value: string): Promise<boolean> {
  if (isElectron()) {
    try {
      return await window.electronAPI.secureStore.set(key, value);
    } catch (error) {
      console.error('[SecureTokenStore] Failed to set secure value:', error);
      // Fall through to localStorage
    }
  }
  
  // Fallback to localStorage (for browser development)
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Securely retrieve a value
 */
async function secureGet(key: string): Promise<string | null> {
  if (isElectron()) {
    try {
      return await window.electronAPI.secureStore.get(key);
    } catch (error) {
      console.error('[SecureTokenStore] Failed to get secure value:', error);
      // Fall through to localStorage
    }
  }
  
  // Fallback to localStorage
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Securely delete a value
 */
async function secureDelete(key: string): Promise<boolean> {
  if (isElectron()) {
    try {
      return await window.electronAPI.secureStore.delete(key);
    } catch (error) {
      console.error('[SecureTokenStore] Failed to delete secure value:', error);
      // Fall through to localStorage
    }
  }
  
  // Fallback to localStorage
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Secure Token Store API
 */
export const secureTokenStore = {
  /**
   * Store both access and refresh tokens securely
   */
  async setTokens(accessToken: string, refreshToken: string): Promise<boolean> {
    const [accessResult, refreshResult] = await Promise.all([
      secureSet(TOKEN_KEYS.ACCESS_TOKEN, accessToken),
      secureSet(TOKEN_KEYS.REFRESH_TOKEN, refreshToken),
    ]);
    return accessResult && refreshResult;
  },

  /**
   * Retrieve stored tokens
   */
  async getTokens(): Promise<TokenPair | null> {
    const [accessToken, refreshToken] = await Promise.all([
      secureGet(TOKEN_KEYS.ACCESS_TOKEN),
      secureGet(TOKEN_KEYS.REFRESH_TOKEN),
    ]);

    if (accessToken && refreshToken) {
      return { accessToken, refreshToken };
    }

    return null;
  },

  /**
   * Get access token only
   */
  async getAccessToken(): Promise<string | null> {
    return secureGet(TOKEN_KEYS.ACCESS_TOKEN);
  },

  /**
   * Get refresh token only
   */
  async getRefreshToken(): Promise<string | null> {
    return secureGet(TOKEN_KEYS.REFRESH_TOKEN);
  },

  /**
   * Clear all stored tokens
   */
  async clearTokens(): Promise<boolean> {
    const [accessResult, refreshResult] = await Promise.all([
      secureDelete(TOKEN_KEYS.ACCESS_TOKEN),
      secureDelete(TOKEN_KEYS.REFRESH_TOKEN),
    ]);
    return accessResult && refreshResult;
  },

  /**
   * Check if tokens are stored
   */
  async hasTokens(): Promise<boolean> {
    const tokens = await this.getTokens();
    return tokens !== null;
  },

  /**
   * Check if secure storage is available
   */
  async isSecureStorageAvailable(): Promise<boolean> {
    if (isElectron()) {
      try {
        return await window.electronAPI.secureStore.isAvailable();
      } catch {
        return false;
      }
    }
    return false;
  },

  /**
   * Migrate tokens from localStorage to secure storage (one-time operation)
   */
  async migrateFromLocalStorage(): Promise<boolean> {
    // Check if we have tokens in localStorage but not in secure storage
    const localAccess = localStorage.getItem('railgun-auth');
    if (!localAccess) {
      return false; // Nothing to migrate
    }

    try {
      const parsed = JSON.parse(localAccess);
      const state = parsed.state;
      
      if (state?.accessToken && state?.refreshToken) {
        console.log('[SecureTokenStore] Migrating tokens from localStorage to secure storage...');
        
        // Store in secure storage
        const success = await this.setTokens(state.accessToken, state.refreshToken);
        
        if (success) {
          // Remove tokens from localStorage (keep user info)
          const newState = {
            ...parsed,
            state: {
              ...state,
              accessToken: null,
              refreshToken: null,
            },
          };
          localStorage.setItem('railgun-auth', JSON.stringify(newState));
          console.log('[SecureTokenStore] Migration complete');
          return true;
        }
      }
    } catch (error) {
      console.error('[SecureTokenStore] Migration failed:', error);
    }

    return false;
  },
};

export default secureTokenStore;
