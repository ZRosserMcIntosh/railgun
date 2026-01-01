/**
 * Rail Gun - Messaging Service
 *
 * Handles E2E encrypted message sending and receiving.
 * This is the bridge between the crypto layer, API, and WebSocket.
 *
 * SECURITY: All encryption/decryption happens here. The server
 * NEVER sees plaintext - only encryptedEnvelope blobs.
 */

import { ConversationType, MessageStatus, DeviceType, PROTOCOL_VERSION } from '@railgun/shared';
import { getCrypto } from '../crypto';
import { getApiClient, PreKeyBundleFromServer, ServerMessage } from './api';
import { useChatStore, DecryptedMessage } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';

// ==================== Helpers ====================

/** Generate a UUID v4 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==================== Types ====================

export interface SendMessageOptions {
  channelId?: string;
  recipientId?: string;
  content: string;
  replyToId?: string;
}

export interface EncryptedEnvelope {
  /** 'dm' for DM, 'channel' for sender-key based channel */
  type: 'dm' | 'channel';
  /** Base64 ciphertext */
  ciphertext: string;
  /** Sender's device ID */
  senderDeviceId: number;
  /** For channel messages, the distribution ID */
  distributionId?: string;
  /** For DM prekey messages */
  registrationId?: number;
  /** 'prekey' or 'message' for DM type detection */
  messageType?: 'prekey' | 'message';
}

// ==================== Messaging Service ====================

class MessagingService {
  private initialized = false;
  private localUserId: string | null = null;
  private _deviceId: number | null = null;

  /**
   * Initialize the messaging service after login.
   * Sets up crypto and registers device keys with server.
   */
  async initialize(userId: string): Promise<void> {
    if (this.initialized && this.localUserId === userId) {
      return;
    }

    console.log('[MessagingService] Initializing for user:', userId);

    const crypto = getCrypto();

    // Initialize crypto if needed
    if (!crypto.isInitialized()) {
      await crypto.init();
    }

    // Set local user ID in crypto
    await crypto.setLocalUserId(userId);
    this.localUserId = userId;

    // Register device keys with server
    await this.registerDeviceKeys();

    this.initialized = true;
    console.log('[MessagingService] Initialized successfully');
  }

  /**
   * Register our device keys with the server.
   */
  private async registerDeviceKeys(): Promise<void> {
    const crypto = getCrypto();
    const api = getApiClient();

    try {
      // Get our prekey bundle
      const bundle = await crypto.getPreKeyBundle();

      // Register with server
      const result = await api.registerDeviceKeys({
        deviceId: crypto.getDeviceId(),
        deviceType: DeviceType.DESKTOP,
        deviceName: 'Desktop App',
        identityKey: bundle.identityKey,
        registrationId: bundle.registrationId,
        signedPreKey: bundle.signedPreKey,
        preKeys: bundle.preKeys,
      });

      this._deviceId = result.deviceId;
      console.log('[MessagingService] Device keys registered, deviceId:', result.deviceId);
    } catch (error) {
      console.error('[MessagingService] Failed to register device keys:', error);
      throw error;
    }
  }

  /**
   * Get the device ID.
   */
  getDeviceId(): number | null {
    return this._deviceId;
  }

  /**
   * Send an encrypted message.
   */
  async sendMessage(options: SendMessageOptions): Promise<DecryptedMessage> {
    if (!this.initialized || !this.localUserId) {
      throw new Error('MessagingService not initialized');
    }

    const { channelId, recipientId, content, replyToId } = options;

    if (!channelId && !recipientId) {
      throw new Error('Must specify channelId or recipientId');
    }

    const user = useAuthStore.getState().user;
    const clientNonce = generateUUID();

    // Create optimistic message for UI
    const optimisticMessage: DecryptedMessage = {
      id: `pending-${clientNonce}`,
      senderId: this.localUserId,
      senderUsername: user?.username,
      content,
      channelId,
      conversationId: recipientId ? this.getDmConversationId(recipientId) : undefined,
      conversationType: channelId ? ConversationType.CHANNEL : ConversationType.DM,
      timestamp: Date.now(),
      replyToId,
      status: MessageStatus.SENDING,
      clientNonce,
    };

    // Add to store immediately for optimistic UI
    useChatStore.getState().addMessage(optimisticMessage);

    try {
      if (channelId) {
        // Channel message - use sender keys
        await this.encryptChannelMessage(channelId, content);
      } else if (recipientId) {
        // DM message - use Signal session
        await this.encryptDmMessage(recipientId, content);
      } else {
        throw new Error('Must specify channelId or recipientId');
      }

      // Send to server via WebSocket (handled by socket.ts)
      // The socket will call sendEncryptedMessage
      return {
        ...optimisticMessage,
        status: MessageStatus.SENDING,
      };
    } catch (error) {
      console.error('[MessagingService] Failed to send message:', error);
      useChatStore.getState().failPendingMessage(clientNonce);
      throw error;
    }
  }

  /**
   * Get the encrypted payload for sending via WebSocket.
   */
  async prepareEncryptedPayload(options: SendMessageOptions): Promise<{
    channelId?: string;
    recipientId?: string;
    encryptedEnvelope: string;
    clientNonce: string;
    protocolVersion: number;
    replyToId?: string;
  }> {
    const { channelId, recipientId, content, replyToId } = options;
    const clientNonce = generateUUID();

    let envelope: EncryptedEnvelope;

    if (channelId) {
      envelope = await this.encryptChannelMessage(channelId, content);
    } else if (recipientId) {
      envelope = await this.encryptDmMessage(recipientId, content);
    } else {
      throw new Error('Must specify channelId or recipientId');
    }

    return {
      channelId,
      recipientId,
      encryptedEnvelope: JSON.stringify(envelope),
      clientNonce,
      protocolVersion: PROTOCOL_VERSION,
      replyToId,
    };
  }

  /**
   * Encrypt a channel message using sender keys.
   */
  private async encryptChannelMessage(
    channelId: string,
    plaintext: string
  ): Promise<EncryptedEnvelope> {
    const crypto = getCrypto();
    const api = getApiClient();

    // Get channel members from server
    let memberUserIds: string[] = [];
    try {
      const { members } = await api.getChannelMembers(channelId);
      memberUserIds = members
        .filter(m => m.userId !== this.localUserId) // Exclude ourselves
        .map(m => m.userId);
    } catch (err) {
      console.warn('[MessagingService] Failed to get channel members, proceeding without key distribution:', err);
    }

    // Ensure we have a sender key session for this channel
    await crypto.ensureChannelSession(channelId, memberUserIds);

    // Distribute our sender key to members who don't have it
    await this.distributeSenderKey(channelId, memberUserIds);

    const encrypted = await crypto.encryptChannel(channelId, plaintext);

    return {
      type: 'channel',
      ciphertext: encrypted.ciphertext,
      senderDeviceId: encrypted.senderDeviceId,
      distributionId: encrypted.distributionId,
    };
  }

  /**
   * Distribute our sender key to channel members.
   * This sends an encrypted distribution message to each member.
   */
  private async distributeSenderKey(channelId: string, memberUserIds: string[]): Promise<void> {
    if (memberUserIds.length === 0) return;

    const crypto = getCrypto();
    const api = getApiClient();

    try {
      // Get our sender key distribution
      const distribution = await crypto.getSenderKeyDistribution(channelId);
      if (!distribution) {
        console.warn('[MessagingService] No sender key distribution available');
        return;
      }

      // Convert to base64 string if it's a Uint8Array
      const distributionBase64 = typeof distribution === 'string' 
        ? distribution 
        : btoa(String.fromCharCode(...distribution));

      // Send to each member via the server
      // The server queues these for delivery
      const sendPromises = memberUserIds.map(async (userId) => {
        try {
          await api.sendSenderKeyDistribution(channelId, userId, distributionBase64);
        } catch (err) {
          console.warn(`[MessagingService] Failed to send sender key to ${userId}:`, err);
        }
      });

      await Promise.allSettled(sendPromises);
      console.log(`[MessagingService] Distributed sender key to ${memberUserIds.length} members`);
    } catch (err) {
      console.error('[MessagingService] Failed to distribute sender key:', err);
    }
  }

  /**
   * Process pending sender key distributions for a channel.
   * Call this when joining a channel or receiving a message we can't decrypt.
   */
  async processPendingSenderKeys(channelId: string): Promise<void> {
    const crypto = getCrypto();
    const api = getApiClient();

    try {
      const { distributions } = await api.getPendingSenderKeys(channelId);
      
      for (const dist of distributions) {
        try {
          await crypto.processSenderKeyDistribution(
            channelId,
            dist.senderUserId,
            dist.distribution // Already base64, crypto layer handles conversion
          );
          console.log(`[MessagingService] Processed sender key from ${dist.senderUserId}`);
        } catch (err) {
          console.warn(`[MessagingService] Failed to process sender key from ${dist.senderUserId}:`, err);
        }
      }
    } catch (err) {
      console.error('[MessagingService] Failed to get pending sender keys:', err);
    }
  }

  /**
   * Encrypt a DM using Signal session.
   */
  private async encryptDmMessage(
    recipientId: string,
    plaintext: string
  ): Promise<EncryptedEnvelope> {
    const crypto = getCrypto();
    const api = getApiClient();

    // Check if we have a session, if not fetch prekey bundle
    if (!(await crypto.hasDmSession(recipientId))) {
      console.log('[MessagingService] No session with', recipientId, ', fetching prekey bundle');

      const { bundles } = await api.getPreKeyBundle(recipientId);
      if (!bundles.length) {
        throw new Error(`No prekey bundles available for user ${recipientId}`);
      }

      // Use first device's bundle
      const bundle = bundles[0];
      await crypto.ensureDmSession(recipientId, this.convertBundle(bundle));
    }

    const encrypted = await crypto.encryptDm(recipientId, plaintext);

    return {
      type: 'dm',
      ciphertext: encrypted.ciphertext,
      senderDeviceId: encrypted.senderDeviceId,
      messageType: encrypted.type,
      registrationId: encrypted.registrationId,
    };
  }

  /**
   * Decrypt an incoming message from the server.
   */
  async decryptMessage(serverMessage: ServerMessage): Promise<DecryptedMessage> {
    if (!this.initialized || !this.localUserId) {
      throw new Error('MessagingService not initialized');
    }

    const crypto = getCrypto();

    // Parse the encrypted envelope
    let envelope: EncryptedEnvelope;
    try {
      envelope = JSON.parse(serverMessage.encryptedEnvelope);
    } catch {
      console.error('[MessagingService] Failed to parse encrypted envelope');
      throw new Error('Invalid encrypted envelope');
    }

    let plaintext: string;

    if (envelope.type === 'channel') {
      // Channel message - decrypt with sender key
      try {
        plaintext = await crypto.decryptChannel(
          serverMessage.channelId!,
          serverMessage.senderId,
          {
            ciphertext: envelope.ciphertext,
            senderDeviceId: envelope.senderDeviceId,
            distributionId: envelope.distributionId || serverMessage.channelId!,
          }
        );
      } catch (decryptError) {
        // If decryption fails, try to fetch sender key from server
        console.log('[MessagingService] Channel decryption failed, fetching sender keys...');
        
        const api = getApiClient();
        try {
          const { distributions } = await api.getPendingSenderKeys(serverMessage.channelId!);
          
          // Find distribution from this specific sender
          const senderDistributions = distributions.filter(
            d => d.senderUserId === serverMessage.senderId
          );
          
          if (senderDistributions && senderDistributions.length > 0) {
            // Process each sender key distribution
            for (const dist of senderDistributions) {
              await crypto.processSenderKeyDistribution(
                serverMessage.channelId!,
                dist.senderUserId,
                dist.distribution
              );
            }
            
            // Retry decryption
            plaintext = await crypto.decryptChannel(
              serverMessage.channelId!,
              serverMessage.senderId,
              {
                ciphertext: envelope.ciphertext,
                senderDeviceId: envelope.senderDeviceId,
                distributionId: envelope.distributionId || serverMessage.channelId!,
              }
            );
          } else {
            throw new Error(`No sender keys available for user ${serverMessage.senderId} in channel ${serverMessage.channelId}`);
          }
        } catch (fetchError) {
          console.error('[MessagingService] Failed to fetch/process sender keys:', fetchError);
          throw decryptError; // Re-throw original error
        }
      }
    } else if (envelope.type === 'dm') {
      // DM message - decrypt with Signal session
      plaintext = await crypto.decryptDm(serverMessage.senderId, {
        type: envelope.messageType || 'message',
        ciphertext: envelope.ciphertext,
        senderDeviceId: envelope.senderDeviceId,
        registrationId: envelope.registrationId,
      });
    } else {
      throw new Error(`Unknown envelope type: ${(envelope as EncryptedEnvelope).type}`);
    }

    return {
      id: serverMessage.id,
      senderId: serverMessage.senderId,
      senderUsername: serverMessage.senderUsername,
      content: plaintext,
      channelId: serverMessage.channelId,
      conversationId: serverMessage.conversationId,
      conversationType: serverMessage.conversationType,
      timestamp: new Date(serverMessage.createdAt).getTime(),
      replyToId: serverMessage.replyToId,
      status: MessageStatus.DELIVERED,
      clientNonce: serverMessage.id, // Use server ID as nonce for received messages
    };
  }

  /**
   * Fetch and decrypt message history for a channel.
   */
  async fetchChannelHistory(
    channelId: string,
    limit = 50,
    before?: string
  ): Promise<DecryptedMessage[]> {
    const api = getApiClient();
    const chatStore = useChatStore.getState();

    chatStore.setLoadingMessages(true);

    try {
      const { messages: serverMessages } = await api.getChannelMessages(channelId, limit, before);

      const decryptedMessages: DecryptedMessage[] = [];

      for (const serverMsg of serverMessages) {
        try {
          const decrypted = await this.decryptMessage(serverMsg);
          decryptedMessages.push(decrypted);
        } catch (error) {
          console.error('[MessagingService] Failed to decrypt message:', serverMsg.id, error);
          // Add a placeholder for failed decryption
          decryptedMessages.push({
            id: serverMsg.id,
            senderId: serverMsg.senderId,
            senderUsername: serverMsg.senderUsername,
            content: '[Unable to decrypt message]',
            channelId: serverMsg.channelId,
            conversationType: serverMsg.conversationType,
            timestamp: new Date(serverMsg.createdAt).getTime(),
            status: MessageStatus.DELIVERED,
            clientNonce: serverMsg.id,
          });
        }
      }

      // Add to store
      chatStore.addMessages(channelId, decryptedMessages, !!before);
      chatStore.setHasMoreMessages(channelId, serverMessages.length === limit);

      return decryptedMessages;
    } finally {
      chatStore.setLoadingMessages(false);
    }
  }

  /**
   * Fetch and decrypt DM history.
   */
  async fetchDmHistory(
    userId: string,
    limit = 50,
    before?: string
  ): Promise<DecryptedMessage[]> {
    const api = getApiClient();
    const chatStore = useChatStore.getState();
    const conversationId = this.getDmConversationId(userId);

    chatStore.setLoadingMessages(true);

    try {
      const { messages: serverMessages } = await api.getDmMessages(userId, limit, before);

      const decryptedMessages: DecryptedMessage[] = [];

      for (const serverMsg of serverMessages) {
        try {
          const decrypted = await this.decryptMessage(serverMsg);
          decryptedMessages.push(decrypted);
        } catch (error) {
          console.error('[MessagingService] Failed to decrypt DM:', serverMsg.id, error);
          decryptedMessages.push({
            id: serverMsg.id,
            senderId: serverMsg.senderId,
            senderUsername: serverMsg.senderUsername,
            content: '[Unable to decrypt message]',
            conversationId: serverMsg.conversationId,
            conversationType: serverMsg.conversationType,
            timestamp: new Date(serverMsg.createdAt).getTime(),
            status: MessageStatus.DELIVERED,
            clientNonce: serverMsg.id,
          });
        }
      }

      chatStore.addMessages(conversationId, decryptedMessages, !!before);
      chatStore.setHasMoreMessages(conversationId, serverMessages.length === limit);

      return decryptedMessages;
    } finally {
      chatStore.setLoadingMessages(false);
    }
  }

  /**
   * Process a sender key distribution message.
   */
  async processSenderKeyDistribution(
    channelId: string,
    senderId: string,
    distributionBase64: string
  ): Promise<void> {
    const crypto = getCrypto();
    // SimpleCrypto accepts string directly
    await crypto.processSenderKeyDistribution(channelId, senderId, distributionBase64);
  }

  /**
   * Get our sender key distribution for a channel.
   */
  async getSenderKeyDistribution(channelId: string): Promise<string | null> {
    const crypto = getCrypto();
    const distribution = await crypto.getSenderKeyDistribution(channelId);
    // Handle both string (SimpleCrypto) and Uint8Array (Signal) return types
    if (distribution === null) return null;
    if (typeof distribution === 'string') return distribution;
    // Convert Uint8Array to base64 string
    return btoa(String.fromCharCode(...distribution));
  }

  /**
   * Clear all messaging data (for logout).
   */
  async clear(): Promise<void> {
    this.initialized = false;
    this.localUserId = null;
    this._deviceId = null;
    useChatStore.getState().clearMessages();
  }

  // ==================== Helpers ====================

  private getDmConversationId(otherUserId: string): string {
    if (!this.localUserId) throw new Error('Not initialized');
    const sorted = [this.localUserId, otherUserId].sort();
    return `${sorted[0]}:${sorted[1]}`;
  }

  private convertBundle(bundle: PreKeyBundleFromServer) {
    return {
      deviceId: bundle.deviceId,
      registrationId: bundle.registrationId,
      identityKey: bundle.identityKey,
      signedPreKey: bundle.signedPreKey,
      preKey: bundle.preKey,
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getLocalUserId(): string | null {
    return this.localUserId;
  }
}

// Singleton instance
let messagingService: MessagingService | null = null;

export function getMessagingService(): MessagingService {
  if (!messagingService) {
    messagingService = new MessagingService();
  }
  return messagingService;
}

export function resetMessagingService(): void {
  if (messagingService) {
    messagingService.clear();
  }
  messagingService = null;
}
