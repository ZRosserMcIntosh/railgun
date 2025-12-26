import { useState, useCallback } from 'react';
import { getApiClient } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { socketClient } from '../lib/socket';

interface StartDmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  presence: string;
}

export function StartDmModal({ isOpen, onClose }: StartDmModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuthStore();
  const { addDmConversation, setCurrentDmUser } = useChatStore();

  // Start DM with yourself (Saved Messages / Notes)
  const handleStartSelfDm = useCallback(async () => {
    if (!user) return;

    setIsStarting(true);
    setError(null);

    try {
      const api = getApiClient();
      const result = await api.startDmById(user.id);

      // Add to conversations
      addDmConversation({
        conversationId: result.conversationId,
        peerId: user.id,
        peerUsername: user.username,
        peerDisplayName: `${user.displayName} (You)`,
        peerAvatarUrl: undefined,
        peerPresence: 'ONLINE',
        unreadCount: 0,
      });

      // Join the DM room
      socketClient.joinDm(result.conversationId);

      // Select this DM
      setCurrentDmUser(user.id);

      // Close modal
      onClose();

      // Reset state
      setSearchQuery('');
      setSearchResults([]);
      setSelectedUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start self-DM');
    } finally {
      setIsStarting(false);
    }
  }, [user, addDmConversation, setCurrentDmUser, onClose]);

  const handleSearch = useCallback(async () => {
    if (searchQuery.length < 2) {
      setError('Enter at least 2 characters');
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const api = getApiClient();
      const { users } = await api.searchUsers(searchQuery);
      setSearchResults(users);
      if (users.length === 0) {
        setError('No users found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const handleStartDm = useCallback(async () => {
    if (!selectedUser) return;

    setIsStarting(true);
    setError(null);

    try {
      const api = getApiClient();
      const result = await api.startDmById(selectedUser.id);

      // Add to conversations if new
      addDmConversation({
        conversationId: result.conversationId,
        peerId: selectedUser.id,
        peerUsername: selectedUser.username,
        peerDisplayName: selectedUser.displayName,
        peerAvatarUrl: selectedUser.avatarUrl,
        peerPresence: selectedUser.presence,
        unreadCount: 0,
      });

      // Join the DM room
      socketClient.joinDm(result.conversationId);

      // Select this DM
      setCurrentDmUser(selectedUser.id);

      // Close modal
      onClose();

      // Reset state
      setSearchQuery('');
      setSearchResults([]);
      setSelectedUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start DM');
    } finally {
      setIsStarting(false);
    }
  }, [selectedUser, addDmConversation, setCurrentDmUser, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (selectedUser) {
        handleStartDm();
      } else {
        handleSearch();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
        <h2 className="text-xl font-bold text-white mb-4">Start a Direct Message</h2>

        {/* Message Yourself Button */}
        <button
          onClick={handleStartSelfDm}
          disabled={isStarting}
          className="w-full mb-4 p-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <span>💾</span>
          <span className="font-medium">Message Yourself (Saved Messages)</span>
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-600"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-800 text-gray-400">or search for a user</span>
          </div>
        </div>

        {/* Search Input */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by username..."
            className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || searchQuery.length < 2}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}

        {/* Search Results */}
        <div className="max-h-60 overflow-y-auto mb-4">
          {searchResults.map((user) => (
            <div
              key={user.id}
              onClick={() => setSelectedUser(user)}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                selectedUser?.id === user.id
                  ? 'bg-blue-600'
                  : 'hover:bg-gray-700'
              }`}
            >
              {/* Avatar */}
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    user.username[0].toUpperCase()
                  )}
                </div>
                {/* Presence indicator */}
                <div
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800 ${
                    user.presence === 'ONLINE'
                      ? 'bg-green-500'
                      : user.presence === 'AWAY'
                      ? 'bg-yellow-500'
                      : user.presence === 'DND'
                      ? 'bg-red-500'
                      : 'bg-gray-500'
                  }`}
                />
              </div>

              {/* User info */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">
                  {user.displayName}
                </p>
                <p className="text-gray-400 text-sm truncate">@{user.username}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStartDm}
            disabled={!selectedUser || isStarting}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg transition-colors"
          >
            {isStarting ? 'Starting...' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  );
}
