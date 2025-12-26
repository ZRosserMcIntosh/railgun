import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { secureTokenStore } from '../lib/secureTokenStore';
import { initApiClient } from '../lib/api';

interface User {
  id: string;
  username: string;
  displayName: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isTokensLoaded: boolean; // New: track if tokens are loaded from secure storage
  
  // Actions
  login: (user: User, accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isInitialized: false,
      isTokensLoaded: false,

      initialize: async () => {
        // Initialize API client with token getter
        const initializeApiClient = () => {
          initApiClient(
            () => get().accessToken,
            async () => {
              // On unauthorized, logout
              await get().logout();
            }
          );
        };

        // Try to load tokens from secure storage
        const tokens = await secureTokenStore.getTokens();
        if (tokens) {
          const hasUser = !!get().user;
          set({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: hasUser && !!tokens.accessToken, // Only authenticated if BOTH user AND token
            isTokensLoaded: true,
            isInitialized: true,
          });
          initializeApiClient();
        } else {
          // Check for migration from localStorage
          await secureTokenStore.migrateFromLocalStorage();
          const migratedTokens = await secureTokenStore.getTokens();
          if (migratedTokens) {
            const hasUser = !!get().user;
            set({
              accessToken: migratedTokens.accessToken,
              refreshToken: migratedTokens.refreshToken,
              isAuthenticated: hasUser && !!migratedTokens.accessToken,
              isTokensLoaded: true,
              isInitialized: true,
            });
            initializeApiClient();
          } else {
            // No tokens found - user needs to login
            set({ 
              isInitialized: true, 
              isTokensLoaded: true,
              isAuthenticated: false, // Force not authenticated if no tokens
            });
            // Still initialize API client even without token (for login/register)
            initializeApiClient();
          }
        }
      },

      login: async (user, accessToken, refreshToken) => {
        // Store tokens securely
        await secureTokenStore.setTokens(accessToken, refreshToken);
        
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isTokensLoaded: true,
        });
      },

      logout: async () => {
        // Clear secure storage
        await secureTokenStore.clearTokens();
        
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isTokensLoaded: false,
        });
      },

      setTokens: async (accessToken, refreshToken) => {
        // Store tokens securely
        await secureTokenStore.setTokens(accessToken, refreshToken);
        
        set({ accessToken, refreshToken, isTokensLoaded: true });
      },
    }),
    {
      name: 'railgun-auth',
      // Only persist user info to localStorage, not tokens
      partialize: (state) => ({
        user: state.user,
        // Don't persist isAuthenticated - it should be derived from tokens on startup
        // isAuthenticated: state.isAuthenticated,
        // Explicitly exclude tokens - they go to secure storage
      }),
    }
  )
);
