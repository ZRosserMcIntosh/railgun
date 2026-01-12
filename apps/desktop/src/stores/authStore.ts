/* eslint-disable no-console */
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
        console.log('[AuthStore] initialize() called');
        
        // Initialize API client with token getter
        const initializeApiClient = () => {
          console.log('[AuthStore] Initializing API client');
          initApiClient(
            () => get().accessToken,
            async () => {
              // On unauthorized, logout
              await get().logout();
            }
          );
        };

        // Try to load tokens from secure storage
        console.log('[AuthStore] Loading tokens from secure storage...');
        try {
          const tokens = await secureTokenStore.getTokens();
          console.log('[AuthStore] Tokens loaded:', !!tokens);
          if (tokens) {
            const hasUser = !!get().user;
            console.log('[AuthStore] Setting authenticated state, hasUser:', hasUser);
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
            console.log('[AuthStore] No tokens, checking migration...');
            await secureTokenStore.migrateFromLocalStorage();
            const migratedTokens = await secureTokenStore.getTokens();
            if (migratedTokens) {
              const hasUser = !!get().user;
              console.log('[AuthStore] Migrated tokens found, hasUser:', hasUser);
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
              console.log('[AuthStore] No tokens found, showing login');
              set({ 
                isInitialized: true, 
                isTokensLoaded: true,
                isAuthenticated: false, // Force not authenticated if no tokens
              });
              // Still initialize API client even without token (for login/register)
              initializeApiClient();
            }
          }
        } catch (error) {
          console.error('[AuthStore] Error loading tokens:', error);
          // On error, still set initialized so app doesn't hang
          set({ 
            isInitialized: true, 
            isTokensLoaded: true,
            isAuthenticated: false,
          });
          initializeApiClient();
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
