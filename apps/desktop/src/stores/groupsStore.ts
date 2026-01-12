/**
 * Rail Gun - Groups Store
 * 
 * Zustand store for managing groups, discovery, and paid group memberships.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  JoinPolicy, 
  PostPolicy, 
  GroupType,
  GroupPlan,
  MembershipStatus,
} from '@railgun/shared';

// ============================================================================
// TYPES
// ============================================================================

export interface DiscoveredGroup {
  id: string;
  name: string;
  handle?: string;
  description?: string;
  iconUrl?: string;
  memberCount: number;
  joinPolicy: JoinPolicy;
  postPolicy: PostPolicy;
  groupType: GroupType;
  isPaid: boolean;
  priceAmount?: number;
  priceCurrency?: string;
}

export interface GroupMembership {
  communityId: string;
  status: MembershipStatus;
  expiresAt?: string;
  plan?: GroupPlan;
}

export interface JoinRequest {
  id: string;
  communityId: string;
  userId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface GroupsState {
  // Discoverable groups
  discoverableGroups: DiscoveredGroup[];
  isLoading: boolean;
  error: string | null;
  
  // User's memberships
  memberships: Record<string, GroupMembership>;
  
  // Pending join requests
  pendingRequests: JoinRequest[];
  
  // Actions
  fetchDiscoverableGroups: (cursor?: string, limit?: number) => Promise<void>;
  searchByHandle: (handle: string) => Promise<DiscoveredGroup | null>;
  joinGroup: (groupId: string) => Promise<boolean>;
  requestToJoin: (groupId: string, message?: string) => Promise<boolean>;
  leaveGroup: (groupId: string) => Promise<boolean>;
  
  // Paid groups
  subscribeToPaidGroup: (groupId: string) => Promise<{ checkoutUrl: string } | null>;
  verifyMembership: (groupId: string) => Promise<GroupMembership | null>;
  
  // Admin actions
  fetchJoinRequests: (groupId: string) => Promise<void>;
  approveJoinRequest: (requestId: string) => Promise<boolean>;
  rejectJoinRequest: (requestId: string) => Promise<boolean>;
  
  // Reset
  reset: () => void;
}

// ============================================================================
// API HELPERS
// ============================================================================

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('auth_token');
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// STORE
// ============================================================================

const initialState = {
  discoverableGroups: [],
  isLoading: false,
  error: null,
  memberships: {},
  pendingRequests: [],
};

export const useGroupsStore = create<GroupsState>()(
  persist(
    (set) => ({
      ...initialState,

      fetchDiscoverableGroups: async (cursor?: string, limit = 50) => {
        set({ isLoading: true, error: null });
        
        try {
          const params = new URLSearchParams();
          if (cursor) params.append('cursor', cursor);
          params.append('limit', String(limit));
          
          const response = await apiRequest<{
            groups: DiscoveredGroup[];
            cursor?: string;
          }>(`/groups/discover?${params}`);
          
          set({ 
            discoverableGroups: response.groups,
            isLoading: false,
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to fetch groups',
            isLoading: false,
          });
        }
      },

      searchByHandle: async (handle: string) => {
        try {
          const response = await apiRequest<DiscoveredGroup>(
            `/groups/handle/${encodeURIComponent(handle.replace('@', ''))}`
          );
          return response;
        } catch {
          return null;
        }
      },

      joinGroup: async (groupId: string) => {
        try {
          await apiRequest(`/groups/${groupId}/join`, { method: 'POST' });
          
          // Update local state
          set(state => ({
            memberships: {
              ...state.memberships,
              [groupId]: {
                communityId: groupId,
                status: MembershipStatus.ACTIVE,
              },
            },
          }));
          
          return true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to join group' });
          return false;
        }
      },

      requestToJoin: async (groupId: string, message?: string) => {
        try {
          await apiRequest(`/groups/${groupId}/request`, {
            method: 'POST',
            body: JSON.stringify({ message }),
          });
          
          return true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to send join request' });
          return false;
        }
      },

      leaveGroup: async (groupId: string) => {
        try {
          await apiRequest(`/groups/${groupId}/leave`, { method: 'POST' });
          
          // Update local state
          set(state => {
            const { [groupId]: _, ...rest } = state.memberships;
            return { memberships: rest };
          });
          
          return true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to leave group' });
          return false;
        }
      },

      subscribeToPaidGroup: async (groupId: string) => {
        try {
          const response = await apiRequest<{ checkoutUrl: string }>(
            `/groups/${groupId}/subscribe`,
            { method: 'POST' }
          );
          return response;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to start subscription' });
          return null;
        }
      },

      verifyMembership: async (groupId: string) => {
        try {
          const response = await apiRequest<GroupMembership>(
            `/groups/${groupId}/membership`
          );
          
          set(state => ({
            memberships: {
              ...state.memberships,
              [groupId]: response,
            },
          }));
          
          return response;
        } catch {
          return null;
        }
      },

      fetchJoinRequests: async (groupId: string) => {
        try {
          const response = await apiRequest<{ requests: JoinRequest[] }>(
            `/groups/${groupId}/requests`
          );
          
          set({ pendingRequests: response.requests });
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to fetch requests' });
        }
      },

      approveJoinRequest: async (requestId: string) => {
        try {
          await apiRequest(`/groups/requests/${requestId}/approve`, { method: 'POST' });
          
          set(state => ({
            pendingRequests: state.pendingRequests.filter(r => r.id !== requestId),
          }));
          
          return true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to approve request' });
          return false;
        }
      },

      rejectJoinRequest: async (requestId: string) => {
        try {
          await apiRequest(`/groups/requests/${requestId}/reject`, { method: 'POST' });
          
          set(state => ({
            pendingRequests: state.pendingRequests.filter(r => r.id !== requestId),
          }));
          
          return true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Failed to reject request' });
          return false;
        }
      },

      reset: () => set(initialState),
    }),
    {
      name: 'railgun-groups',
      partialize: (state) => ({
        memberships: state.memberships,
      }),
    }
  )
);

export default useGroupsStore;
