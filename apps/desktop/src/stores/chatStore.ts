import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConversationType, MessageStatus } from '@railgun/shared';

// ==================== Types ====================

/** Reaction on a message */
export interface MessageReaction {
  emoji: string;
  userId: string;
  username: string;
  timestamp: number;
}

/** Link preview data */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

/** User mention in a message */
export interface MessageMention {
  userId: string;
  username: string;
  startIndex: number;
  endIndex: number;
}

/** Edit history entry */
export interface MessageEdit {
  content: string;
  editedAt: number;
}

/** Decrypted message for local storage only - NEVER sent to server */
export interface DecryptedMessage {
  id: string;
  senderId: string;
  senderUsername?: string;
  content: string; // Decrypted plaintext - stored locally only
  channelId?: string;
  conversationId?: string;
  conversationType: ConversationType;
  timestamp: number;
  replyToId?: string;
  status: MessageStatus;
  clientNonce: string; // For deduplication and optimistic updates
  
  // === New Signal-inspired features ===
  reactions?: MessageReaction[];
  expiresAt?: number; // For disappearing messages
  readBy?: string[]; // User IDs who have read this message
  editedAt?: number; // When message was last edited
  editHistory?: MessageEdit[]; // Previous versions of the message
  isPinned?: boolean;
  linkPreviews?: LinkPreview[];
  quotedMessage?: QuotedMessage; // Full quoted message data for display
  mentions?: MessageMention[];
}

/** Quoted/replied message preview */
export interface QuotedMessage {
  id: string;
  senderId: string;
  senderUsername?: string;
  content: string;
  timestamp: number;
}

/** Disappearing message timer settings */
export type DisappearingTimer = 'off' | '30s' | '5m' | '1h' | '24h' | '7d';

/** Conversation-level settings */
export interface ConversationSettings {
  disappearingTimer: DisappearingTimer;
  isMuted: boolean;
  mutedUntil?: number; // Timestamp when mute expires, undefined = forever
}

/** Community with channels */
export interface CommunityData {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  ownerId: string;
  inviteCode?: string;
  channels: ChannelData[];
}

/** Channel within a community */
export interface ChannelData {
  id: string;
  name: string;
  description?: string;
  type: 'TEXT' | 'VOICE';
  position: number;
  unreadCount: number;
}

/** DM conversation */
export interface DmConversation {
  conversationId: string;
  peerId: string;
  peerUsername: string;
  peerDisplayName: string;
  peerAvatarUrl?: string;
  peerPresence: string;
  lastMessageAt?: number;
  unreadCount: number;
}

// ==================== Store ====================

interface ChatState {
  // Messages by channel/conversation ID (decrypted, local only)
  messages: Record<string, DecryptedMessage[]>;

  // Communities and channels
  communities: CommunityData[];
  currentCommunityId: string | null;
  currentChannelId: string | null;

  // DMs
  dmConversations: DmConversation[];
  currentDmUserId: string | null;

  // UI state
  isLoadingMessages: boolean;
  hasMoreMessages: Record<string, boolean>;

  // Pending messages for optimistic updates (clientNonce -> message)
  pendingNonces: Set<string>;

  // === New Signal-inspired state ===
  conversationSettings: Record<string, ConversationSettings>;
  typingUsers: Record<string, { userId: string; username: string; timestamp: number }[]>;
  pinnedMessages: Record<string, string[]>; // conversationId -> messageIds
  replyingTo: DecryptedMessage | null; // Message being replied to

  // Actions - Messages
  addMessage: (message: DecryptedMessage) => void;
  addMessages: (conversationId: string, messages: DecryptedMessage[], prepend?: boolean) => void;
  updateMessageStatus: (clientNonce: string, status: MessageStatus) => void;
  confirmPendingMessage: (clientNonce: string, serverId: string) => void;
  failPendingMessage: (clientNonce: string) => void;

  // === New Signal-inspired message actions ===
  addReaction: (conversationId: string, messageId: string, emoji: string, userId: string, username: string) => void;
  removeReaction: (conversationId: string, messageId: string, emoji: string, userId: string) => void;
  markMessageRead: (conversationId: string, messageId: string, userId: string) => void;
  editMessage: (conversationId: string, messageId: string, newContent: string) => void;
  pinMessage: (conversationId: string, messageId: string) => void;
  unpinMessage: (conversationId: string, messageId: string) => void;
  setReplyingTo: (message: DecryptedMessage | null) => void;
  deleteExpiredMessages: () => void;

  // === New Signal-inspired conversation actions ===
  setDisappearingTimer: (conversationId: string, timer: DisappearingTimer) => void;
  muteConversation: (conversationId: string, until?: number) => void;
  unmuteConversation: (conversationId: string) => void;
  setTypingUser: (conversationId: string, userId: string, username: string, isTyping: boolean) => void;

  // Actions - Communities
  setCommunities: (communities: CommunityData[]) => void;
  addCommunity: (community: CommunityData) => void;
  removeCommunity: (communityId: string) => void;
  updateCommunityChannels: (communityId: string, channels: ChannelData[]) => void;
  setCurrentCommunity: (communityId: string | null) => void;
  setCurrentChannel: (channelId: string | null) => void;

  // Actions - DMs
  setDmConversations: (conversations: DmConversation[]) => void;
  addDmConversation: (conversation: DmConversation) => void;
  updateDmPresence: (peerId: string, presence: string) => void;
  setCurrentDmUser: (userId: string | null) => void;
  getCurrentDmConversationId: () => string | null;

  // Actions - UI
  setLoadingMessages: (loading: boolean) => void;
  setHasMoreMessages: (conversationId: string, hasMore: boolean) => void;
  markChannelRead: (channelId: string) => void;

  // Actions - Cleanup
  clearMessages: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: {},
      communities: [],
      currentCommunityId: null,
      currentChannelId: null,
      dmConversations: [],
      currentDmUserId: null,
      isLoadingMessages: false,
      hasMoreMessages: {},
      pendingNonces: new Set(),
      
      // === New Signal-inspired initial state ===
      conversationSettings: {},
      typingUsers: {},
      pinnedMessages: {},
      replyingTo: null,

      // ==================== Messages ====================

      addMessage: (message) => {
        const conversationId = message.channelId || message.conversationId || 'unknown';
        set((state) => {
          const existing = state.messages[conversationId] || [];

          // Check for duplicates by ID or clientNonce
          const isDuplicate = existing.some(
            (m) =>
              m.id === message.id ||
              (message.clientNonce && m.clientNonce === message.clientNonce)
          );

          if (isDuplicate) {
            // Update existing message if this is a confirmation
            return {
              messages: {
                ...state.messages,
                [conversationId]: existing.map((m) =>
                  m.clientNonce === message.clientNonce
                    ? { ...m, id: message.id, status: message.status }
                    : m
                ),
              },
            };
          }

          return {
            messages: {
              ...state.messages,
              [conversationId]: [...existing, message].sort(
                (a, b) => a.timestamp - b.timestamp
              ),
            },
          };
        });
      },

      addMessages: (conversationId, messages, prepend = false) => {
        set((state) => {
          const existing = state.messages[conversationId] || [];
          const combined = prepend ? [...messages, ...existing] : [...existing, ...messages];

          // Deduplicate by ID
          const seen = new Set<string>();
          const deduplicated = combined.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });

          return {
            messages: {
              ...state.messages,
              [conversationId]: deduplicated.sort((a, b) => a.timestamp - b.timestamp),
            },
          };
        });
      },

      updateMessageStatus: (clientNonce, status) => {
        set((state) => {
          const newMessages = { ...state.messages };
          for (const conversationId in newMessages) {
            newMessages[conversationId] = newMessages[conversationId].map((m) =>
              m.clientNonce === clientNonce ? { ...m, status } : m
            );
          }
          return { messages: newMessages };
        });
      },

      confirmPendingMessage: (clientNonce, serverId) => {
        set((state) => {
          const newPending = new Set(state.pendingNonces);
          newPending.delete(clientNonce);

          const newMessages = { ...state.messages };
          for (const conversationId in newMessages) {
            newMessages[conversationId] = newMessages[conversationId].map((m) =>
              m.clientNonce === clientNonce
                ? { ...m, id: serverId, status: MessageStatus.SENT }
                : m
            );
          }

          return { messages: newMessages, pendingNonces: newPending };
        });
      },

      failPendingMessage: (clientNonce) => {
        set((state) => {
          const newPending = new Set(state.pendingNonces);
          newPending.delete(clientNonce);

          const newMessages = { ...state.messages };
          for (const conversationId in newMessages) {
            newMessages[conversationId] = newMessages[conversationId].map((m) =>
              m.clientNonce === clientNonce ? { ...m, status: MessageStatus.FAILED } : m
            );
          }

          return { messages: newMessages, pendingNonces: newPending };
        });
      },

      // ==================== Signal-inspired Message Actions ====================

      addReaction: (conversationId, messageId, emoji, userId, username) => {
        set((state) => {
          const messages = state.messages[conversationId] || [];
          return {
            messages: {
              ...state.messages,
              [conversationId]: messages.map((m) => {
                if (m.id !== messageId) return m;
                const reactions = m.reactions || [];
                // Check if user already reacted with this emoji
                const existingIndex = reactions.findIndex(
                  (r) => r.emoji === emoji && r.userId === userId
                );
                if (existingIndex >= 0) return m; // Already reacted
                return {
                  ...m,
                  reactions: [...reactions, { emoji, userId, username, timestamp: Date.now() }],
                };
              }),
            },
          };
        });
      },

      removeReaction: (conversationId, messageId, emoji, userId) => {
        set((state) => {
          const messages = state.messages[conversationId] || [];
          return {
            messages: {
              ...state.messages,
              [conversationId]: messages.map((m) => {
                if (m.id !== messageId) return m;
                return {
                  ...m,
                  reactions: (m.reactions || []).filter(
                    (r) => !(r.emoji === emoji && r.userId === userId)
                  ),
                };
              }),
            },
          };
        });
      },

      markMessageRead: (conversationId, messageId, userId) => {
        set((state) => {
          const messages = state.messages[conversationId] || [];
          return {
            messages: {
              ...state.messages,
              [conversationId]: messages.map((m) => {
                if (m.id !== messageId) return m;
                const readBy = m.readBy || [];
                if (readBy.includes(userId)) return m;
                return { ...m, readBy: [...readBy, userId] };
              }),
            },
          };
        });
      },

      editMessage: (conversationId, messageId, newContent) => {
        set((state) => {
          const messages = state.messages[conversationId] || [];
          return {
            messages: {
              ...state.messages,
              [conversationId]: messages.map((m) => {
                if (m.id !== messageId) return m;
                const editHistory = m.editHistory || [];
                return {
                  ...m,
                  content: newContent,
                  editedAt: Date.now(),
                  editHistory: [...editHistory, { content: m.content, editedAt: m.editedAt || m.timestamp }],
                };
              }),
            },
          };
        });
      },

      pinMessage: (conversationId, messageId) => {
        set((state) => {
          const messages = state.messages[conversationId] || [];
          const pinnedMessages = state.pinnedMessages[conversationId] || [];
          if (pinnedMessages.includes(messageId)) return state;
          return {
            messages: {
              ...state.messages,
              [conversationId]: messages.map((m) =>
                m.id === messageId ? { ...m, isPinned: true } : m
              ),
            },
            pinnedMessages: {
              ...state.pinnedMessages,
              [conversationId]: [...pinnedMessages, messageId],
            },
          };
        });
      },

      unpinMessage: (conversationId, messageId) => {
        set((state) => {
          const messages = state.messages[conversationId] || [];
          const pinnedMessages = state.pinnedMessages[conversationId] || [];
          return {
            messages: {
              ...state.messages,
              [conversationId]: messages.map((m) =>
                m.id === messageId ? { ...m, isPinned: false } : m
              ),
            },
            pinnedMessages: {
              ...state.pinnedMessages,
              [conversationId]: pinnedMessages.filter((id) => id !== messageId),
            },
          };
        });
      },

      setReplyingTo: (message) => {
        set({ replyingTo: message });
      },

      deleteExpiredMessages: () => {
        set((state) => {
          const now = Date.now();
          const newMessages: Record<string, DecryptedMessage[]> = {};
          for (const conversationId in state.messages) {
            newMessages[conversationId] = state.messages[conversationId].filter(
              (m) => !m.expiresAt || m.expiresAt > now
            );
          }
          return { messages: newMessages };
        });
      },

      // ==================== Signal-inspired Conversation Actions ====================

      setDisappearingTimer: (conversationId, timer) => {
        set((state) => ({
          conversationSettings: {
            ...state.conversationSettings,
            [conversationId]: {
              ...(state.conversationSettings[conversationId] || { isMuted: false }),
              disappearingTimer: timer,
            },
          },
        }));
      },

      muteConversation: (conversationId, until) => {
        set((state) => ({
          conversationSettings: {
            ...state.conversationSettings,
            [conversationId]: {
              ...(state.conversationSettings[conversationId] || { disappearingTimer: 'off' as DisappearingTimer }),
              isMuted: true,
              mutedUntil: until,
            },
          },
        }));
      },

      unmuteConversation: (conversationId) => {
        set((state) => ({
          conversationSettings: {
            ...state.conversationSettings,
            [conversationId]: {
              ...(state.conversationSettings[conversationId] || { disappearingTimer: 'off' as DisappearingTimer }),
              isMuted: false,
              mutedUntil: undefined,
            },
          },
        }));
      },

      setTypingUser: (conversationId, userId, username, isTyping) => {
        set((state) => {
          const currentTyping = state.typingUsers[conversationId] || [];
          if (isTyping) {
            // Add user if not already typing
            const exists = currentTyping.some((t) => t.userId === userId);
            if (exists) {
              return {
                typingUsers: {
                  ...state.typingUsers,
                  [conversationId]: currentTyping.map((t) =>
                    t.userId === userId ? { ...t, timestamp: Date.now() } : t
                  ),
                },
              };
            }
            return {
              typingUsers: {
                ...state.typingUsers,
                [conversationId]: [...currentTyping, { userId, username, timestamp: Date.now() }],
              },
            };
          } else {
            // Remove user from typing
            return {
              typingUsers: {
                ...state.typingUsers,
                [conversationId]: currentTyping.filter((t) => t.userId !== userId),
              },
            };
          }
        });
      },

      // ==================== Communities ====================

      setCommunities: (communities) => {
        set({ communities });
      },

      addCommunity: (community) => {
        set((state) => ({
          communities: [...state.communities, community],
        }));
      },

      removeCommunity: (communityId) => {
        set((state) => ({
          communities: state.communities.filter((c) => c.id !== communityId),
          currentCommunityId:
            state.currentCommunityId === communityId ? null : state.currentCommunityId,
          currentChannelId:
            state.communities.find((c) => c.id === communityId)?.channels.some(
              (ch) => ch.id === state.currentChannelId
            )
              ? null
              : state.currentChannelId,
        }));
      },

      updateCommunityChannels: (communityId, channels) => {
        set((state) => ({
          communities: state.communities.map((c) =>
            c.id === communityId
              ? { ...c, channels: channels.map((ch) => ({ ...ch, unreadCount: 0 })) }
              : c
          ),
        }));
      },

      setCurrentCommunity: (communityId) => {
        const state = get();
        // When switching community, auto-select first channel
        const community = state.communities.find((c) => c.id === communityId);
        const firstChannel = community?.channels.find((ch) => ch.type === 'TEXT');

        set({
          currentCommunityId: communityId,
          currentChannelId: firstChannel?.id || null,
          currentDmUserId: null, // Clear DM selection
        });
      },

      setCurrentChannel: (channelId) => {
        set({ currentChannelId: channelId, currentDmUserId: null });
      },

      // ==================== DMs ====================

      setDmConversations: (conversations) => {
        set({ dmConversations: conversations });
      },

      addDmConversation: (conversation) => {
        set((state) => {
          // Check if already exists
          const exists = state.dmConversations.some(
            (c) => c.conversationId === conversation.conversationId
          );
          if (exists) {
            return state;
          }
          return {
            dmConversations: [conversation, ...state.dmConversations],
          };
        });
      },

      updateDmPresence: (peerId, presence) => {
        set((state) => ({
          dmConversations: state.dmConversations.map((c) =>
            c.peerId === peerId ? { ...c, peerPresence: presence } : c
          ),
        }));
      },

      setCurrentDmUser: (userId) => {
        set({
          currentDmUserId: userId,
          currentChannelId: null, // Clear channel selection
        });
      },

      getCurrentDmConversationId: () => {
        const state = get();
        if (!state.currentDmUserId) return null;
        const dm = state.dmConversations.find(
          (c) => c.peerId === state.currentDmUserId
        );
        return dm?.conversationId || null;
      },

      // ==================== UI ====================

      setLoadingMessages: (loading) => {
        set({ isLoadingMessages: loading });
      },

      setHasMoreMessages: (conversationId, hasMore) => {
        set((state) => ({
          hasMoreMessages: { ...state.hasMoreMessages, [conversationId]: hasMore },
        }));
      },

      markChannelRead: (channelId) => {
        set((state) => ({
          communities: state.communities.map((c) => ({
            ...c,
            channels: c.channels.map((ch) =>
              ch.id === channelId ? { ...ch, unreadCount: 0 } : ch
            ),
          })),
        }));
      },

      // ==================== Cleanup ====================

      clearMessages: () => {
        set({ messages: {}, pendingNonces: new Set() });
      },

      reset: () => {
        set({
          messages: {},
          communities: [],
          currentCommunityId: null,
          currentChannelId: null,
          dmConversations: [],
          currentDmUserId: null,
          isLoadingMessages: false,
          hasMoreMessages: {},
          pendingNonces: new Set(),
          conversationSettings: {},
          typingUsers: {},
          pinnedMessages: {},
          replyingTo: null,
        });
      },
    }),
    {
      name: 'railgun-chat',
      // Persist communities, selections, and conversation settings (not messages for security)
      partialize: (state) => ({
        communities: state.communities,
        currentCommunityId: state.currentCommunityId,
        currentChannelId: state.currentChannelId,
        conversationSettings: state.conversationSettings,
        pinnedMessages: state.pinnedMessages,
      }),
    }
  )
);
