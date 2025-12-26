import { io, Socket } from 'socket.io-client';
import { WSEventType, MessageStatus, ConversationType } from '@railgun/shared';
import { getMessagingService, SendMessageOptions } from './messagingService';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import type { ServerMessage } from './api';

const WS_URL = 'http://localhost:3001/ws';

/** Encrypted message payload to send to server */
interface EncryptedMessagePayload {
  channelId?: string;
  recipientId?: string;
  encryptedEnvelope: string;
  clientNonce: string;
  protocolVersion: number;
  replyToId?: string;
}

/** Message received from server (still encrypted) */
interface ServerMessageReceived {
  id: string;
  senderId: string;
  senderUsername?: string;
  channelId?: string;
  conversationId?: string;
  conversationType: string;
  encryptedEnvelope: string;
  protocolVersion: number;
  createdAt: string;
  replyToId?: string;
}

/** Message acknowledgment from server */
interface MessageAck {
  clientNonce: string;
  messageId: string;
  status: MessageStatus;
}

/** Message error from server */
interface MessageError {
  clientNonce: string;
  error: string;
}

interface TypingEvent {
  userId: string;
  username: string;
  channelId: string;
}

interface PresenceEvent {
  userId: string;
  status: string;
}

type MessageHandler = (message: ServerMessageReceived) => void;
type TypingHandler = (event: TypingEvent) => void;
type PresenceHandler = (event: PresenceEvent) => void;
type ConnectionHandler = (connected: boolean) => void;

class SocketClient {
  private socket: Socket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private typingStartHandlers: Set<TypingHandler> = new Set();
  private typingStopHandlers: Set<TypingHandler> = new Set();
  private presenceHandlers: Set<PresenceHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private currentToken: string | null = null;
  private isConnecting: boolean = false;

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      // If already connecting, wait for that to finish
      if (this.isConnecting) {
        // Poll until connection resolves
        const checkConnection = setInterval(() => {
          if (this.socket?.connected) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkConnection);
          reject(new Error('Connection timeout'));
        }, 10000);
        return;
      }

      this.isConnecting = true;
      this.currentToken = token;

      // Disconnect any existing socket
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      this.socket = io(WS_URL, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      this.socket.on('connect', () => {
        console.log('[SocketClient] Connected');
        this.isConnecting = false;
        this.notifyConnection(true);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[SocketClient] Disconnected:', reason);
        this.notifyConnection(false);
      });

      this.socket.on('connect_error', (error) => {
        console.error('[SocketClient] Connection error:', error.message);
      });

      this.socket.on(WSEventType.AUTHENTICATED, () => {
        console.log('[SocketClient] Authenticated');
        this.isConnecting = false;
        resolve();
      });

      this.socket.on(WSEventType.AUTH_ERROR, (error: { message: string }) => {
        console.error('[SocketClient] Auth error:', error.message);
        this.isConnecting = false;
        reject(new Error(error.message));
      });

      // Handle encrypted messages from server
      this.socket.on(WSEventType.MESSAGE_RECEIVED, async (message: ServerMessageReceived) => {
        console.log('[SocketClient] Received encrypted message:', message.id);
        
        // Notify raw handlers first
        this.messageHandlers.forEach((handler) => handler(message));
        
        // Decrypt and add to store
        try {
          const messagingService = getMessagingService();
          if (messagingService.isInitialized()) {
            const serverMsg: ServerMessage = {
              ...message,
              conversationType: message.conversationType as ConversationType,
            };
            const decrypted = await messagingService.decryptMessage(serverMsg);
            useChatStore.getState().addMessage(decrypted);
          }
        } catch (error) {
          console.error('[SocketClient] Failed to decrypt message:', error);
        }
      });

      // Handle message acknowledgments
      this.socket.on(WSEventType.MESSAGE_ACK, (ack: MessageAck) => {
        console.log('[SocketClient] Message ACK:', ack);
        useChatStore.getState().confirmPendingMessage(ack.clientNonce, ack.messageId);
      });

      // Handle message errors
      this.socket.on(WSEventType.MESSAGE_ERROR, (error: MessageError) => {
        console.error('[SocketClient] Message error:', error);
        useChatStore.getState().failPendingMessage(error.clientNonce);
      });

      this.socket.on(WSEventType.TYPING_START, (event: TypingEvent) => {
        this.typingStartHandlers.forEach((handler) => handler(event));
      });

      this.socket.on(WSEventType.TYPING_STOP, (event: TypingEvent) => {
        this.typingStopHandlers.forEach((handler) => handler(event));
      });

      this.socket.on(WSEventType.PRESENCE_UPDATE, (event: PresenceEvent) => {
        this.presenceHandlers.forEach((handler) => handler(event));
      });

      // Timeout if not authenticated within 10 seconds
      setTimeout(() => {
        if (this.isConnecting && !this.socket?.connected) {
          this.isConnecting = false;
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Attempt to reconnect with the stored token.
   */
  async reconnect(): Promise<void> {
    if (this.currentToken) {
      this.disconnect();
      await this.connect(this.currentToken);
    }
  }

  disconnect(): void {
    this.isConnecting = false;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Send an encrypted message.
   * Encrypts the content and sends to server.
   */
  async sendEncryptedMessage(options: SendMessageOptions): Promise<string> {
    // Try to reconnect if not connected
    if (!this.socket?.connected) {
      // Try to get token from stored value or auth store
      const token = this.currentToken || useAuthStore.getState().accessToken;
      if (token) {
        console.log('[SocketClient] Attempting to reconnect before sending message...');
        try {
          await this.connect(token);
        } catch (error) {
          console.error('[SocketClient] Reconnect failed:', error);
          throw new Error('Not connected and reconnection failed');
        }
      } else {
        throw new Error('Not connected');
      }
    }

    const messagingService = getMessagingService();
    if (!messagingService.isInitialized()) {
      throw new Error('Messaging service not initialized');
    }

    // Prepare encrypted payload
    const payload = await messagingService.prepareEncryptedPayload(options);

    // Add optimistic message to store
    const chatStore = useChatStore.getState();
    const localUserId = messagingService.getLocalUserId();
    
    if (localUserId) {
      chatStore.addMessage({
        id: `pending-${payload.clientNonce}`,
        senderId: localUserId,
        content: options.content,
        channelId: options.channelId,
        conversationType: options.channelId ? ConversationType.CHANNEL : ConversationType.DM,
        timestamp: Date.now(),
        replyToId: options.replyToId,
        status: MessageStatus.SENDING,
        clientNonce: payload.clientNonce,
      });
    }

    // Send to server
    if (!this.socket) {
      throw new Error('Socket is null');
    }
    this.socket.emit(WSEventType.MESSAGE_SEND, payload);

    return payload.clientNonce;
  }

  /**
   * Send raw encrypted payload (already prepared).
   */
  sendRawEncryptedMessage(payload: EncryptedMessagePayload): void {
    if (!this.socket?.connected) {
      throw new Error('Not connected');
    }
    this.socket.emit(WSEventType.MESSAGE_SEND, payload);
  }

  /**
   * Join a channel room for receiving messages.
   */
  joinChannel(channelId: string): void {
    if (!this.socket?.connected) {
      throw new Error('Not connected');
    }
    this.socket.emit('channel:join', { channelId });
  }

  /**
   * Leave a channel room.
   */
  leaveChannel(channelId: string): void {
    if (!this.socket?.connected) {
      throw new Error('Not connected');
    }
    this.socket.emit('channel:leave', { channelId });
  }

  /**
   * Join a DM room for receiving messages.
   */
  joinDm(conversationId: string): void {
    if (!this.socket?.connected) {
      throw new Error('Not connected');
    }
    this.socket.emit('dm:join', { conversationId });
  }

  /**
   * Leave a DM room.
   */
  leaveDm(conversationId: string): void {
    if (!this.socket?.connected) {
      throw new Error('Not connected');
    }
    this.socket.emit('dm:leave', { conversationId });
  }

  /**
   * Send a message acknowledgment.
   */
  sendMessageAck(messageId: string, status: MessageStatus): void {
    if (!this.socket?.connected) return;
    this.socket.emit(WSEventType.MESSAGE_ACK, { messageId, status });
  }

  startTyping(channelId?: string, conversationId?: string): void {
    this.socket?.emit(WSEventType.TYPING_START, { channelId, conversationId });
  }

  stopTyping(channelId?: string, conversationId?: string): void {
    this.socket?.emit(WSEventType.TYPING_STOP, { channelId, conversationId });
  }

  // Event handlers
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onTypingStart(handler: TypingHandler): () => void {
    this.typingStartHandlers.add(handler);
    return () => this.typingStartHandlers.delete(handler);
  }

  onTypingStop(handler: TypingHandler): () => void {
    this.typingStopHandlers.add(handler);
    return () => this.typingStopHandlers.delete(handler);
  }

  onPresence(handler: PresenceHandler): () => void {
    this.presenceHandlers.add(handler);
    return () => this.presenceHandlers.delete(handler);
  }

  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private notifyConnection(connected: boolean): void {
    this.connectionHandlers.forEach((handler) => handler(connected));
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

// Singleton instance
export const socketClient = new SocketClient();
