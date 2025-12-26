import { useState, useRef, useEffect, FormEvent } from 'react';
import { useChatStore, DecryptedMessage } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { socketClient } from '../lib/socket';
import { getMessagingService } from '../lib/messagingService';
import { MessageStatus } from '@railgun/shared';
import MessageReactions from './MessageReactions';
import TypingIndicator from './TypingIndicator';
import QuotedMessage from './QuotedMessage';
import LinkPreview, { extractUrls } from './LinkPreview';
import MessageContextMenu from './MessageContextMenu';

// Icons
const SendIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const LockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const DoubleCheckIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const LoadingSpinner = () => (
  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

export default function ChatArea() {
  const { 
    messages, 
    currentChannelId, 
    currentDmUserId,
    dmConversations,
    communities, 
    currentCommunityId, 
    isLoadingMessages, 
    hasMoreMessages,
    getCurrentDmConversationId,
    typingUsers,
    replyingTo,
    setReplyingTo,
    addReaction,
    removeReaction,
    pinMessage,
    unpinMessage,
    editMessage,
  } = useChatStore();
  const { user } = useAuthStore();
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    message: DecryptedMessage;
    position: { x: number; y: number };
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Determine if we're in channel or DM mode
  const isDmMode = !!currentDmUserId && !currentChannelId;
  const currentConversationId = isDmMode 
    ? getCurrentDmConversationId() 
    : currentChannelId;
  
  const conversationMessages = currentConversationId 
    ? messages[currentConversationId] || [] 
    : [];
  
  const currentCommunity = communities.find((c) => c.id === currentCommunityId);
  const currentChannel = currentCommunity?.channels.find((ch) => ch.id === currentChannelId);
  const currentDm = dmConversations.find((dm) => dm.peerId === currentDmUserId);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationMessages.length]);

  // Load message history when channel or DM changes
  useEffect(() => {
    if (!currentConversationId) return;

    const loadHistory = async () => {
      const messagingService = getMessagingService();
      if (!messagingService.isInitialized()) return;

      // Only load if we don't have messages for this conversation
      if (!messages[currentConversationId] || messages[currentConversationId].length === 0) {
        try {
          if (isDmMode && currentDmUserId) {
            await messagingService.fetchDmHistory(currentDmUserId);
          } else if (currentChannelId) {
            await messagingService.fetchChannelHistory(currentChannelId);
          }
        } catch (error) {
          console.error('Failed to load message history:', error);
        }
      }
    };

    loadHistory();
  }, [currentConversationId, isDmMode]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;
    if (!currentChannelId && !currentDmUserId) return;

    const content = newMessage.trim();
    setNewMessage('');
    setIsSending(true);

    try {
      if (isDmMode && currentDmUserId) {
        await socketClient.sendEncryptedMessage({
          recipientId: currentDmUserId,
          content,
        });
      } else if (currentChannelId) {
        await socketClient.sendEncryptedMessage({
          channelId: currentChannelId,
          content,
        });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore the message if sending failed
      setNewMessage(content);
    } finally {
      setIsSending(false);
    }
  };

  const handleLoadMore = async () => {
    if (!currentConversationId || isLoadingMessages) return;
    
    const oldestMessage = conversationMessages[0];
    if (!oldestMessage) return;

    const messagingService = getMessagingService();
    if (!messagingService.isInitialized()) return;

    try {
      if (isDmMode && currentDmUserId) {
        await messagingService.fetchDmHistory(currentDmUserId, 50, oldestMessage.id);
      } else if (currentChannelId) {
        await messagingService.fetchChannelHistory(currentChannelId, 50, oldestMessage.id);
      }
    } catch (error) {
      console.error('Failed to load more messages:', error);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const getStatusIcon = (status: MessageStatus) => {
    switch (status) {
      case MessageStatus.SENDING:
        return <LoadingSpinner />;
      case MessageStatus.SENT:
        return <CheckIcon />;
      case MessageStatus.DELIVERED:
        return <DoubleCheckIcon />;
      case MessageStatus.READ:
        return <span className="text-primary-400"><DoubleCheckIcon /></span>;
      case MessageStatus.FAILED:
        return <span className="text-status-error">!</span>;
      default:
        return null;
    }
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: DecryptedMessage[] }[] = [];
  let currentDate = '';

  for (const message of conversationMessages) {
    const messageDate = formatDate(message.timestamp);
    if (messageDate !== currentDate) {
      currentDate = messageDate;
      groupedMessages.push({ date: messageDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(message);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="h-12 border-b border-dark-900 flex items-center px-4 gap-2">
        {isDmMode ? (
          <>
            {/* DM Header */}
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-semibold">
                {currentDm?.peerAvatarUrl ? (
                  <img
                    src={currentDm.peerAvatarUrl}
                    alt={currentDm.peerUsername}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  currentDm?.peerUsername[0].toUpperCase() || '?'
                )}
              </div>
              <div
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-dark-900 ${
                  currentDm?.peerPresence === 'ONLINE'
                    ? 'bg-green-500'
                    : currentDm?.peerPresence === 'AWAY'
                    ? 'bg-yellow-500'
                    : currentDm?.peerPresence === 'DND'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
                }`}
              />
            </div>
            <h2 className="font-semibold text-text-primary flex items-center gap-2">
              {currentDm?.peerDisplayName || currentDm?.peerUsername || 'Direct Message'}
              {currentDm?.peerId === user?.id && (
                <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded font-normal">
                  Saved Messages
                </span>
              )}
            </h2>
            <div className="ml-auto flex items-center gap-1 text-text-muted text-xs">
              <LockIcon />
              <span>End-to-end encrypted</span>
            </div>
          </>
        ) : (
          <>
            {/* Channel Header */}
            <span className="text-xl text-text-muted">#</span>
            <h2 className="font-semibold text-text-primary">
              {currentChannel?.name || 'Select a channel'}
            </h2>
            {currentChannel?.description && (
              <>
                <div className="w-px h-4 bg-dark-700 mx-2" />
                <span className="text-sm text-text-muted truncate">{currentChannel.description}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Messages Area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {!currentConversationId ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted">
            <div className="text-6xl mb-4">💬</div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              Welcome to Rail Gun
            </h3>
            <p className="text-sm">
              Select a channel to start messaging
            </p>
          </div>
        ) : conversationMessages.length === 0 && !isLoadingMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted">
            <div className="text-6xl mb-4">#</div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              Welcome to #{currentChannel?.name || 'channel'}!
            </h3>
            <p className="text-sm">
              This is the start of the conversation. Send a message to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Load more button */}
            {currentConversationId && hasMoreMessages[currentConversationId] && (
              <div className="flex justify-center mb-4">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMessages}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text-primary bg-surface-elevated rounded-lg disabled:opacity-50"
                >
                  {isLoadingMessages ? 'Loading...' : 'Load earlier messages'}
                </button>
              </div>
            )}

            {/* Messages grouped by date */}
            {groupedMessages.map((group) => (
              <div key={group.date}>
                {/* Date divider */}
                <div className="flex items-center my-4">
                  <div className="flex-1 border-t border-dark-700" />
                  <span className="px-4 text-xs text-text-muted font-semibold">{group.date}</span>
                  <div className="flex-1 border-t border-dark-700" />
                </div>

                {/* Messages for this date */}
                <div className="space-y-4">
                  {group.messages.map((message) => {
                    const urls = extractUrls(message.content);
                    const isEditing = editingMessageId === message.id;
                    
                    return (
                    <div
                      key={message.id}
                      id={`message-${message.id}`}
                      className={`flex gap-3 group hover:bg-surface-primary/30 -mx-2 px-2 py-1 rounded relative ${
                        message.isPinned ? 'border-l-2 border-yellow-500 pl-3' : ''
                      }`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ message, position: { x: e.clientX, y: e.clientY } });
                      }}
                    >
                      {/* Pinned indicator */}
                      {message.isPinned && (
                        <div className="absolute -left-1 top-1">
                          <svg className="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.617 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.018 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.583l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.018 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.79l1.599.8L9 4.323V3a1 1 0 011-1z" />
                          </svg>
                        </div>
                      )}

                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-primary-500 flex-shrink-0 flex items-center justify-center text-white font-semibold">
                        {message.senderUsername?.charAt(0).toUpperCase() || '?'}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`font-medium ${
                              message.senderId === user?.id ? 'text-primary-400' : 'text-text-primary'
                            }`}
                          >
                            {message.senderUsername || 'Unknown'}
                          </span>
                          <span className="text-xs text-text-muted">{formatTime(message.timestamp)}</span>
                          {message.editedAt && (
                            <span className="text-xs text-text-muted italic">(edited)</span>
                          )}
                          {message.senderId === user?.id && (
                            <span className="text-text-muted">{getStatusIcon(message.status)}</span>
                          )}
                        </div>
                        
                        {/* Quoted message */}
                        {message.quotedMessage && (
                          <div className="mb-1">
                            <QuotedMessage
                              quote={message.quotedMessage}
                              onJumpToMessage={() => {
                                document.getElementById(`message-${message.quotedMessage?.id}`)?.scrollIntoView({ behavior: 'smooth' });
                              }}
                            />
                          </div>
                        )}
                        
                        {/* Message content or edit mode */}
                        {isEditing ? (
                          <div className="flex gap-2 mt-1">
                            <input
                              type="text"
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="flex-1 px-2 py-1 bg-surface-elevated rounded text-text-primary text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  if (editContent.trim() && currentConversationId) {
                                    editMessage(currentConversationId, message.id, editContent.trim());
                                    setEditingMessageId(null);
                                    setEditContent('');
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingMessageId(null);
                                  setEditContent('');
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (editContent.trim() && currentConversationId) {
                                  editMessage(currentConversationId, message.id, editContent.trim());
                                }
                                setEditingMessageId(null);
                                setEditContent('');
                              }}
                              className="px-2 py-1 bg-primary-500 text-white rounded text-xs"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingMessageId(null);
                                setEditContent('');
                              }}
                              className="px-2 py-1 bg-surface-primary text-text-muted rounded text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <p className="text-text-primary break-words select-text">{message.content}</p>
                        )}
                        
                        {/* Link previews */}
                        {urls.length > 0 && !isEditing && (
                          <div className="space-y-2">
                            {urls.slice(0, 3).map((url) => (
                              <LinkPreview key={url} url={url} />
                            ))}
                          </div>
                        )}
                        
                        {/* Reactions */}
                        {(message.reactions?.length || 0) > 0 && currentConversationId && user?.id && (
                          <MessageReactions
                            reactions={message.reactions || []}
                            messageId={message.id}
                            currentUserId={user.id}
                            onAddReaction={(emoji) => addReaction(currentConversationId, message.id, emoji, user.id, user.username || 'You')}
                            onRemoveReaction={(emoji) => removeReaction(currentConversationId, message.id, emoji, user.id)}
                          />
                        )}
                      </div>
                      
                      {/* Hover actions */}
                      <div className="absolute right-2 top-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={() => setReplyingTo(message)}
                          className="p-1.5 bg-surface-elevated rounded hover:bg-surface-primary text-text-muted hover:text-text-primary"
                          title="Reply"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            if (currentConversationId && user?.id) {
                              addReaction(currentConversationId, message.id, '👍', user.id, user.username || 'You');
                            }
                          }}
                          className="p-1.5 bg-surface-elevated rounded hover:bg-surface-primary text-text-muted hover:text-text-primary"
                          title="React"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                        {message.senderId === user?.id && (
                          <button
                            onClick={() => {
                              setEditingMessageId(message.id);
                              setEditContent(message.content);
                            }}
                            className="p-1.5 bg-surface-elevated rounded hover:bg-surface-primary text-text-muted hover:text-text-primary"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Typing indicator */}
      {currentConversationId && typingUsers[currentConversationId]?.length > 0 && (
        <TypingIndicator typingUsers={typingUsers[currentConversationId]} />
      )}

      {/* Context Menu */}
      {contextMenu && currentConversationId && (
        <MessageContextMenu
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onReply={() => setReplyingTo(contextMenu.message)}
          onReact={() => {
            if (user?.id) {
              addReaction(currentConversationId, contextMenu.message.id, '👍', user.id, user.username || 'You');
            }
          }}
          onEdit={
            contextMenu.message.senderId === user?.id
              ? () => {
                  setEditingMessageId(contextMenu.message.id);
                  setEditContent(contextMenu.message.content);
                }
              : undefined
          }
          onPin={() => {
            if (contextMenu.message.isPinned) {
              unpinMessage(currentConversationId, contextMenu.message.id);
            } else {
              pinMessage(currentConversationId, contextMenu.message.id);
            }
          }}
          onCopy={() => navigator.clipboard.writeText(contextMenu.message.content)}
          isOwnMessage={contextMenu.message.senderId === user?.id}
          isPinned={contextMenu.message.isPinned || false}
        />
      )}

      {/* Message Input */}
      <div className="px-4 pb-4">
        {/* Reply preview */}
        {replyingTo && (
          <div className="mb-2">
            <QuotedMessage
              quote={{
                id: replyingTo.id,
                senderId: replyingTo.senderId,
                senderUsername: replyingTo.senderUsername,
                content: replyingTo.content,
                timestamp: replyingTo.timestamp,
              }}
              isCompact
              onClear={() => setReplyingTo(null)}
            />
          </div>
        )}
        
        <form onSubmit={handleSend} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={
              replyingTo 
                ? `Reply to ${replyingTo.senderUsername || 'message'}...` 
                : currentChannelId 
                  ? `Message #${currentChannel?.name || 'channel'}` 
                  : isDmMode 
                    ? `Message ${currentDm?.peerUsername || 'user'}` 
                    : 'Select a channel to message'
            }
            disabled={(!currentChannelId && !isDmMode) || isSending}
            className="w-full px-4 py-3 rounded-lg bg-surface-elevated text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || (!currentChannelId && !isDmMode) || isSending}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? <LoadingSpinner /> : <SendIcon />}
          </button>
        </form>
        <div className="mt-2 flex items-center justify-center gap-1 text-xs text-text-muted">
          <LockIcon />
          <span>Messages are end-to-end encrypted</span>
        </div>
      </div>
    </div>
  );
}
