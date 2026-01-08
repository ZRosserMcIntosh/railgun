/**
 * Rail Gun - Messaging Service Tests
 * 
 * Tests for message encryption, decryption, and sender key distribution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// MOCK SETUP - Must be before imports that use mocked modules
// ============================================================================

// Mock crypto module
vi.mock('../../crypto', () => ({
  getCrypto: () => ({
    isInitialized: vi.fn(() => true),
    init: vi.fn(),
    setLocalUserId: vi.fn(),
    getPreKeyBundle: vi.fn(() => ({
      identityKey: 'mock-identity-key',
      signedPreKey: { keyId: 1, publicKey: 'mock-signed-prekey', signature: 'mock-sig' },
      preKeys: [{ keyId: 1, publicKey: 'mock-prekey' }],
      registrationId: 12345,
    })),
    hasDmSession: vi.fn(() => true),
    ensureDmSession: vi.fn(),
    encryptDm: vi.fn(() => ({
      ciphertext: 'encrypted-dm-message',
      senderDeviceId: 1,
      type: 'message',
      registrationId: 12345,
    })),
    decryptDm: vi.fn(() => 'decrypted-message'),
    hasChannelSession: vi.fn(() => true),
    ensureChannelSession: vi.fn(),
    encryptChannel: vi.fn(() => ({
      ciphertext: 'encrypted-channel-message',
      senderDeviceId: 1,
      distributionId: 'channel-123',
    })),
    decryptChannel: vi.fn(() => 'decrypted-channel-message'),
    getSenderKeyDistribution: vi.fn(() => 'mock-sender-key-distribution-base64'),
    processSenderKeyDistribution: vi.fn(),
  }),
}));

// Mock API client
const mockApi = {
  registerDeviceKeys: vi.fn(() => ({ deviceId: 1 })),
  getPreKeyBundle: vi.fn(() => ({
    bundles: [{
      userId: 'recipient-123',
      deviceId: 1,
      identityKey: 'recipient-identity-key',
      signedPreKey: { keyId: 1, publicKey: 'signed-prekey', signature: 'sig' },
      preKeys: [{ keyId: 1, publicKey: 'prekey' }],
      registrationId: 54321,
    }],
  })),
  sendMessage: vi.fn(() => ({
    messageId: 'msg-123',
    timestamp: new Date().toISOString(),
  })),
  getChannelMembers: vi.fn(() => ({
    members: [
      { userId: 'user-1', username: 'alice', displayName: 'Alice', deviceId: 1 },
      { userId: 'user-2', username: 'bob', displayName: 'Bob', deviceId: 1 },
    ],
  })),
  getPendingSenderKeys: vi.fn(() => ({
    distributions: [] as Array<{
      senderUserId: string;
      senderDeviceId: number;
      distribution: string;
      createdAt: string;
    }>,
  })),
  sendDm: vi.fn(() => ({ success: true })),
};

vi.mock('../api', () => ({
  getApiClient: () => mockApi,
}));

// Mock stores
const mockChatStore = {
  getState: () => ({
    addPendingMessage: vi.fn(),
    confirmMessage: vi.fn(),
    setLoadingMessages: vi.fn(),
    addMessage: vi.fn(),
  }),
};

const mockAuthStore = {
  getState: () => ({
    userId: 'user-123',
    accessToken: 'mock-token',
  }),
};

vi.mock('../../stores/chatStore', () => ({
  useChatStore: mockChatStore,
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: mockAuthStore,
}));

// ============================================================================
// TESTS
// ============================================================================

describe('MessagingService', () => {
  beforeEach(() => {
    resetMessagingService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const service = getMessagingService();
      await service.initialize('user-123');
      expect(mockCrypto.setLocalUserId).toHaveBeenCalledWith('user-123');
      expect(mockApi.registerDeviceKeys).toHaveBeenCalled();
    });

    it('should not re-initialize for same user', async () => {
      const service = getMessagingService();
      await service.initialize('user-123');
      await service.initialize('user-123');
      // Should only call registerDeviceKeys once
      expect(mockApi.registerDeviceKeys).toHaveBeenCalledTimes(1);
    });
  });

  describe('DM encryption', () => {
    beforeEach(async () => {
      const service = getMessagingService();
      await service.initialize('user-123');
    });

    it('should encrypt DM with existing session', async () => {
      const service = getMessagingService();
      mockCrypto.hasDmSession.mockReturnValue(true);
      
      const result = await service.sendMessage({
        recipientId: 'recipient-123',
        content: 'Hello, World!',
      });

      expect(mockCrypto.encryptDm).toHaveBeenCalledWith('recipient-123', 'Hello, World!');
      expect(mockApi.sendMessage).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should establish session if none exists', async () => {
      const service = getMessagingService();
      mockCrypto.hasDmSession.mockReturnValue(false);
      
      await service.sendMessage({
        recipientId: 'recipient-123',
        content: 'First message!',
      });

      expect(mockApi.getPreKeyBundle).toHaveBeenCalledWith('recipient-123');
      expect(mockCrypto.ensureDmSession).toHaveBeenCalled();
    });
  });

  describe('Channel encryption', () => {
    beforeEach(async () => {
      const service = getMessagingService();
      await service.initialize('user-123');
    });

    it('should encrypt channel message', async () => {
      const service = getMessagingService();
      mockCrypto.hasChannelSession.mockReturnValue(true);
      
      const result = await service.sendMessage({
        channelId: 'channel-123',
        content: 'Hello channel!',
      });

      expect(mockCrypto.encryptChannel).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should distribute sender keys to new channels', async () => {
      const service = getMessagingService();
      mockCrypto.hasChannelSession.mockReturnValue(false);
      
      await service.sendMessage({
        channelId: 'new-channel-456',
        content: 'First message in channel!',
      });

      // Should fetch channel members
      expect(mockApi.getChannelMembers).toHaveBeenCalledWith('new-channel-456');
      // Should create channel session
      expect(mockCrypto.ensureChannelSession).toHaveBeenCalled();
    });
  });

  describe('Message decryption', () => {
    beforeEach(async () => {
      const service = getMessagingService();
      await service.initialize('user-123');
    });

    it('should decrypt DM message', async () => {
      const service = getMessagingService();
      const serverMessage = {
        id: 'msg-123',
        senderId: 'sender-456',
        senderUsername: 'sender',
        encryptedEnvelope: JSON.stringify({
          type: 'dm',
          ciphertext: 'encrypted-content',
          senderDeviceId: 1,
          messageType: 'message',
          registrationId: 12345,
        }),
        conversationId: 'conv-123',
        conversationType: 'dm',
        createdAt: new Date().toISOString(),
      };

      const result = await service.decryptMessage(serverMessage as any);

      expect(mockCrypto.decryptDm).toHaveBeenCalled();
      expect(result.content).toBe('decrypted-message');
    });

    it('should decrypt channel message', async () => {
      const service = getMessagingService();
      const serverMessage = {
        id: 'msg-123',
        senderId: 'sender-456',
        senderUsername: 'sender',
        channelId: 'channel-123',
        encryptedEnvelope: JSON.stringify({
          type: 'channel',
          ciphertext: 'encrypted-content',
          senderDeviceId: 1,
          distributionId: 'channel-123',
        }),
        conversationType: 'channel',
        createdAt: new Date().toISOString(),
      };

      const result = await service.decryptMessage(serverMessage as any);

      expect(mockCrypto.decryptChannel).toHaveBeenCalled();
      expect(result.content).toBe('decrypted-channel-message');
    });

    it('should fetch sender keys on decryption failure', async () => {
      const service = getMessagingService();
      mockCrypto.decryptChannel
        .mockRejectedValueOnce(new Error('No sender key'))
        .mockResolvedValueOnce('decrypted-after-key-fetch');

      mockApi.getPendingSenderKeys.mockResolvedValue({
        distributions: [
          {
            senderUserId: 'sender-456',
            senderDeviceId: 1,
            distribution: 'mock-distribution',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      const serverMessage = {
        id: 'msg-123',
        senderId: 'sender-456',
        senderUsername: 'sender',
        channelId: 'channel-123',
        encryptedEnvelope: JSON.stringify({
          type: 'channel',
          ciphertext: 'encrypted-content',
          senderDeviceId: 1,
          distributionId: 'channel-123',
        }),
        conversationType: 'channel',
        createdAt: new Date().toISOString(),
      };

      const result = await service.decryptMessage(serverMessage as any);

      expect(mockApi.getPendingSenderKeys).toHaveBeenCalledWith('channel-123');
      expect(mockCrypto.processSenderKeyDistribution).toHaveBeenCalled();
      expect(result.content).toBe('decrypted-after-key-fetch');
    });
  });

  describe('Error handling', () => {
    it('should throw if not initialized', async () => {
      const service = getMessagingService();
      await expect(
        service.sendMessage({
          recipientId: 'recipient-123',
          content: 'test',
        })
      ).rejects.toThrow('MessagingService not initialized');
    });

    it('should require either channelId or recipientId', async () => {
      const service = getMessagingService();
      await service.initialize('user-123');
      
      await expect(
        service.sendMessage({ content: 'test' })
      ).rejects.toThrow();
    });
  });
});

// ============================================================================
// INTEGRATION STYLE TESTS
// ============================================================================

describe('MessagingService Integration', () => {
  beforeEach(() => {
    resetMessagingService();
    vi.clearAllMocks();
  });

  it('should handle full message flow: encrypt -> send -> receive -> decrypt', async () => {
    const service = getMessagingService();
    await service.initialize('alice-123');

    // Alice sends a message
    mockCrypto.encryptDm.mockReturnValue({
      ciphertext: 'alice-encrypted-hello',
      senderDeviceId: 1,
      type: 'message',
      registrationId: 12345,
    });

    const sendResult = await service.sendMessage({
      recipientId: 'bob-456',
      content: 'Hello Bob!',
    });

    expect(sendResult).toBeDefined();

    // Simulate Bob receiving and decrypting
    mockCrypto.decryptDm.mockReturnValue('Hello Bob!');

    const receivedMessage = {
      id: 'msg-123',
      senderId: 'alice-123',
      senderUsername: 'alice',
      encryptedEnvelope: JSON.stringify({
        type: 'dm',
        ciphertext: 'alice-encrypted-hello',
        senderDeviceId: 1,
        messageType: 'message',
        registrationId: 12345,
      }),
      conversationId: 'conv-123',
      conversationType: 'dm',
      createdAt: new Date().toISOString(),
    };

    const decrypted = await service.decryptMessage(receivedMessage as any);

    expect(decrypted.content).toBe('Hello Bob!');
    expect(decrypted.senderId).toBe('alice-123');
  });
});
