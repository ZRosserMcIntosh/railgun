import { ConversationType, DeviceType } from '@railgun/shared';
import { config } from './env';

/**
 * API Base URL - Uses environment configuration.
 * See env.ts for how this is resolved from environment variables or defaults.
 */
const API_BASE_URL = config.apiUrl;

interface ApiError {
  message: string;
  statusCode: number;
}

// ==================== Types ====================

export interface PreKeyBundleFromServer {
  deviceId: number;
  registrationId: number;
  identityKey: string;
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  preKey?: {
    keyId: number;
    publicKey: string;
  };
}

export interface ServerMessage {
  id: string;
  senderId: string;
  senderUsername?: string;
  channelId?: string;
  conversationId?: string;
  conversationType: ConversationType;
  encryptedEnvelope: string;
  protocolVersion: number;
  replyToId?: string;
  createdAt: string;
}

export interface Community {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  inviteCode?: string;
  memberCount?: number;
  isPublic?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  type: 'TEXT' | 'VOICE';
  position: number;
  communityId: string;
}

class ApiClient {
  private baseUrl: string;
  private getAccessToken: () => string | null;
  private onUnauthorized: () => void;

  constructor(
    baseUrl: string,
    getAccessToken: () => string | null,
    onUnauthorized: () => void
  ) {
    this.baseUrl = baseUrl;
    this.getAccessToken = getAccessToken;
    this.onUnauthorized = onUnauthorized;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getAccessToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.onUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        message: 'An error occurred',
        statusCode: response.status,
      }));
      throw new Error(error.message);
    }

    return response.json();
  }

  // ==================== Auth ====================

  async register(data: {
    username: string;
    password: string;
    email?: string;
    displayName?: string;
  }) {
    return this.request<{
      user: {
        id: string;
        username: string;
        displayName: string;
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      recoveryCodes: string[];
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: { username: string; password: string }) {
    return this.request<{
      user: {
        id: string;
        username: string;
        displayName: string;
      };
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout() {
    return this.request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    });
  }

  async refreshToken(refreshToken: string) {
    return this.request<{
      accessToken: string;
      refreshToken: string;
    }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  async recoverAccount(data: {
    username: string;
    recoveryCode: string;
    newPassword: string;
  }) {
    return this.request<{
      success: boolean;
      message: string;
      recoveryCodes?: string[];
    }>('/auth/recover', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async rotateRecoveryCodes() {
    return this.request<{
      recoveryCodes: string[];
      message: string;
    }>('/auth/recovery-codes/rotate', {
      method: 'POST',
    });
  }

  // ==================== Account Destruction ====================

  /**
   * NUKE ACCOUNT - Permanently destroys all user data
   * This action is IRREVERSIBLE. All data will be wiped:
   * - User profile and credentials
   * - All messages (encrypted and metadata)
   * - All cryptographic keys
   * - All community memberships
   * - All DM conversations
   * - All session tokens
   */
  async nukeAccount() {
    return this.request<{
      success: boolean;
      message: string;
      deletedAt: string;
    }>('/auth/nuke', {
      method: 'DELETE',
    });
  }

  // ==================== Keys ====================

  async registerDeviceKeys(dto: {
    deviceId: number;
    deviceType: DeviceType;
    deviceName?: string;
    identityKey: string;
    registrationId: number;
    signedPreKey: {
      keyId: number;
      publicKey: string;
      signature: string;
    };
    preKeys: Array<{ keyId: number; publicKey: string }>;
  }) {
    return this.request<{ deviceId: number; message: string }>('/keys/register', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async getPreKeyBundle(userId: string, deviceId?: number) {
    const query = deviceId !== undefined ? `?deviceId=${deviceId}` : '';
    return this.request<{ bundles: PreKeyBundleFromServer[] }>(
      `/keys/bundle/${userId}${query}`
    );
  }

  async uploadPreKeys(
    deviceId: number,
    preKeys: Array<{ keyId: number; publicKey: string }>
  ) {
    return this.request<{ message: string }>('/keys/prekeys', {
      method: 'POST',
      body: JSON.stringify({ deviceId, preKeys }),
    });
  }

  async getPreKeyCount(deviceId: number) {
    return this.request<{ count: number }>(`/keys/prekeys/count?deviceId=${deviceId}`);
  }

  async getDevices() {
    return this.request<{
      devices: Array<{
        id: string;
        deviceId: number;
        deviceType: string;
        deviceName?: string;
        lastActiveAt: string;
        createdAt: string;
      }>;
    }>('/keys/devices');
  }

  // ==================== Messages ====================

  async sendMessage(dto: {
    channelId?: string;
    recipientId?: string;
    encryptedEnvelope: string;
    clientNonce: string;
    protocolVersion?: number;
    replyToId?: string;
  }) {
    return this.request<{
      message: ServerMessage;
      duplicate: boolean;
    }>('/messages', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async getChannelMessages(channelId: string, limit = 50, before?: string) {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (before) params.set('before', before);
    return this.request<{ messages: ServerMessage[] }>(
      `/messages/channel/${channelId}?${params}`
    );
  }

  async getDmMessages(userId: string, limit = 50, before?: string) {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (before) params.set('before', before);
    return this.request<{ messages: ServerMessage[] }>(
      `/messages/dm/${userId}?${params}`
    );
  }

  async updateMessageStatus(messageId: string, status: string) {
    return this.request<{ message: ServerMessage }>(`/messages/${messageId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // ==================== Communities ====================

  async createCommunity(dto: { name: string; description?: string; isPublic?: boolean }) {
    return this.request<{ community: Community }>('/communities', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async getUserCommunities() {
    return this.request<{ communities: Community[] }>('/communities');
  }

  async getCommunity(communityId: string) {
    return this.request<{ community: Community }>(`/communities/${communityId}`);
  }

  async getCommunityByInvite(inviteCode: string) {
    return this.request<{
      community: {
        id: string;
        name: string;
        description?: string;
        iconUrl?: string;
        memberCount: number;
      };
    }>(`/communities/invite/${inviteCode}`);
  }

  async joinCommunity(communityId: string, inviteCode?: string) {
    return this.request<{ member: { id: string; communityId: string } }>(
      `/communities/${communityId}/join`,
      {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      }
    );
  }

  async joinCommunityByInvite(inviteCode: string) {
    // First get community by invite, then join
    const { community } = await this.getCommunityByInvite(inviteCode);
    return this.joinCommunity(community.id, inviteCode);
  }

  async leaveCommunity(communityId: string) {
    return this.request<{ message: string }>(`/communities/${communityId}/leave`, {
      method: 'POST',
    });
  }

  async regenerateInviteCode(communityId: string) {
    return this.request<{ inviteCode: string }>(
      `/communities/${communityId}/invite/regenerate`,
      { method: 'POST' }
    );
  }

  // ==================== Channels ====================

  async getCommunityChannels(communityId: string) {
    return this.request<{ channels: Channel[] }>(`/channels/community/${communityId}`);
  }

  async getChannel(channelId: string) {
    return this.request<{ channel: Channel }>(`/channels/${channelId}`);
  }

  async createChannel(
    communityId: string,
    dto: { name: string; description?: string; type?: 'TEXT' | 'VOICE' }
  ) {
    return this.request<{ channel: Channel }>(`/channels/community/${communityId}`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  async updateChannel(channelId: string, dto: { name?: string; description?: string }) {
    return this.request<{ channel: Channel }>(`/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  }

  async deleteChannel(channelId: string) {
    return this.request<{ message: string }>(`/channels/${channelId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Users ====================

  async getUser(userId: string) {
    return this.request<{
      user: {
        id: string;
        username: string;
        displayName?: string;
        avatarUrl?: string;
        presence?: string;
      };
    }>(`/users/${userId}`);
  }

  async getUserByUsername(username: string) {
    return this.request<{
      user: {
        id: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
        presence: string;
      };
    }>(`/users/by-username/${encodeURIComponent(username)}`);
  }

  async searchUsers(query: string) {
    return this.request<{
      users: Array<{
        id: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
        presence: string;
      }>;
    }>(`/users/search?query=${encodeURIComponent(query)}`);
  }

  // ==================== DMs ====================

  async getDmConversations() {
    return this.request<{
      conversations: Array<{
        conversationId: string;
        peerId: string;
        peerUsername: string;
        peerDisplayName: string;
        peerAvatarUrl?: string;
        peerPresence: string;
        lastMessageAt?: string;
        createdAt: string;
      }>;
    }>('/dms');
  }

  async startDm(username: string) {
    return this.request<{
      conversationId: string;
      peerId: string;
      isNew: boolean;
    }>('/dms', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
  }

  async startDmById(userId: string) {
    return this.request<{
      conversationId: string;
      peerId: string;
      isNew: boolean;
    }>('/dms/by-id', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  // ==================== Health ====================

  async health() {
    return this.request<{
      status: string;
      timestamp: string;
      version: string;
      uptime: number;
    }>('/health');
  }
}

// Create singleton instance
let apiClient: ApiClient | null = null;

export function initApiClient(
  getAccessToken: () => string | null,
  onUnauthorized: () => void
): ApiClient {
  apiClient = new ApiClient(API_BASE_URL, getAccessToken, onUnauthorized);
  return apiClient;
}

export function getApiClient(): ApiClient {
  if (!apiClient) {
    // Create a default client that will be properly initialized later
    // This prevents crashes when components try to use API before auth init
    console.warn('[API] API client accessed before initialization, creating temporary instance');
    apiClient = new ApiClient(
      API_BASE_URL,
      () => null,
      () => {}
    );
  }
  return apiClient;
}

export function isApiClientInitialized(): boolean {
  return apiClient !== null;
}

export { ApiClient };
