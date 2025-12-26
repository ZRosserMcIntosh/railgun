import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, CommunityData, ChannelData } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { getApiClient } from '../lib/api';
import { socketClient } from '../lib/socket';
import { StartDmModal } from './StartDmModal';
import { CommunitySettingsModal } from './settings';

// Icons
const HashIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const PhoneIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const BookIcon = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
    <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
    <path d="M3 4a2 2 0 012-2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2V4zm4 0v16h10V4H7z" />
  </svg>
);

export default function Sidebar() {
  const navigate = useNavigate();
  const { accessToken, isTokensLoaded } = useAuthStore();
  const {
    communities,
    currentCommunityId,
    currentChannelId,
    dmConversations,
    currentDmUserId,
    setCommunities,
    addCommunity,
    updateCommunityChannels,
    setCurrentCommunity,
    setCurrentChannel,
    setDmConversations,
    setCurrentDmUser,
  } = useChatStore();

  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showStartDm, setShowStartDm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newCommunityName, setNewCommunityName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentCommunity = communities.find((c) => c.id === currentCommunityId);

  // Fetch communities on mount
  useEffect(() => {
    if (!accessToken || !isTokensLoaded) return;
    
    const fetchCommunities = async () => {
      try {
        const api = getApiClient();
        const { communities: fetchedCommunities } = await api.getUserCommunities();
        
        // Transform to CommunityData with empty channels
        const communityData: CommunityData[] = fetchedCommunities.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          iconUrl: c.iconUrl,
          ownerId: c.ownerId,
          inviteCode: c.inviteCode,
          channels: [],
        }));
        
        setCommunities(communityData);
        
        // If we have communities, select the first one
        if (communityData.length > 0 && !currentCommunityId) {
          setCurrentCommunity(communityData[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch communities:', err);
      }
    };
    
    fetchCommunities();
  }, [accessToken, isTokensLoaded]);

  // Fetch DM conversations on mount
  useEffect(() => {
    if (!accessToken || !isTokensLoaded) return;
    
    const fetchDms = async () => {
      try {
        const api = getApiClient();
        const { conversations } = await api.getDmConversations();
        
        setDmConversations(
          conversations.map((c) => ({
            conversationId: c.conversationId,
            peerId: c.peerId,
            peerUsername: c.peerUsername,
            peerDisplayName: c.peerDisplayName,
            peerAvatarUrl: c.peerAvatarUrl,
            peerPresence: c.peerPresence,
            lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : undefined,
            unreadCount: 0,
          }))
        );
      } catch (err) {
        console.error('Failed to fetch DM conversations:', err);
      }
    };
    
    fetchDms();
  }, [accessToken, isTokensLoaded]);

  // Fetch channels when community changes
  useEffect(() => {
    if (!currentCommunityId || !accessToken || !isTokensLoaded) return;
    
    const fetchChannels = async () => {
      try {
        const api = getApiClient();
        const { channels } = await api.getCommunityChannels(currentCommunityId);
        
        const channelData: ChannelData[] = channels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          description: ch.description,
          type: ch.type as 'TEXT' | 'VOICE',
          position: ch.position,
          unreadCount: 0,
        }));
        
        updateCommunityChannels(currentCommunityId, channelData);
        
        // Join all channel rooms
        for (const channel of channelData) {
          if (socketClient.isConnected()) {
            socketClient.joinChannel(channel.id);
          }
        }
        
        // Auto-select first text channel if none selected
        if (!currentChannelId && channelData.length > 0) {
          const firstTextChannel = channelData.find((ch) => ch.type === 'TEXT');
          if (firstTextChannel) {
            setCurrentChannel(firstTextChannel.id);
          }
        }
      } catch (err) {
        console.error('Failed to fetch channels:', err);
      }
    };
    
    fetchChannels();
  }, [currentCommunityId, accessToken, isTokensLoaded]);

  const handleCreateCommunity = async () => {
    if (!newCommunityName.trim()) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const api = getApiClient();
      const { community } = await api.createCommunity({
        name: newCommunityName.trim(),
      });
      
      // Add to store
      addCommunity({
        id: community.id,
        name: community.name,
        description: community.description,
        iconUrl: community.iconUrl,
        ownerId: community.ownerId,
        inviteCode: community.inviteCode,
        channels: [],
      });
      
      // Select the new community
      setCurrentCommunity(community.id);
      
      // Reset
      setNewCommunityName('');
      setShowCreateCommunity(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create community');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinCommunity = async () => {
    if (!inviteCode.trim()) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const api = getApiClient();
      
      // Get community by invite code first
      const { community: preview } = await api.getCommunityByInvite(inviteCode.trim());
      
      // Join it
      await api.joinCommunity(preview.id, inviteCode.trim());
      
      // Fetch full community details
      const { community } = await api.getCommunity(preview.id);
      
      // Add to store
      addCommunity({
        id: community.id,
        name: community.name,
        description: community.description,
        iconUrl: community.iconUrl,
        ownerId: community.ownerId,
        inviteCode: community.inviteCode,
        channels: [],
      });
      
      // Select it
      setCurrentCommunity(community.id);
      
      // Reset
      setInviteCode('');
      setShowCreateCommunity(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join community');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim() || !currentCommunityId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const api = getApiClient();
      const { channel } = await api.createChannel(currentCommunityId, {
        name: newChannelName.trim(),
        type: 'TEXT',
      });
      
      // Update channels in store
      const currentChannels = currentCommunity?.channels || [];
      updateCommunityChannels(currentCommunityId, [
        ...currentChannels,
        {
          id: channel.id,
          name: channel.name,
          description: channel.description,
          type: channel.type as 'TEXT' | 'VOICE',
          position: channel.position,
          unreadCount: 0,
        },
      ]);
      
      // Join the channel room
      if (socketClient.isConnected()) {
        socketClient.joinChannel(channel.id);
      }
      
      // Select it
      setCurrentChannel(channel.id);
      
      // Reset
      setNewChannelName('');
      setShowCreateChannel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex">
      {/* Server Icons */}
      <div className="w-[72px] bg-surface-tertiary flex flex-col items-center py-3 gap-2 overflow-y-auto">
        {/* Community icons */}
        {communities.map((community) => (
          <button
            key={community.id}
            onClick={() => setCurrentCommunity(community.id)}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xl transition-all cursor-pointer ${
              currentCommunityId === community.id
                ? 'rounded-xl bg-primary-500'
                : 'bg-surface-primary hover:rounded-xl hover:bg-primary-500'
            }`}
            title={community.name}
          >
            {community.iconUrl ? (
              <img src={community.iconUrl} alt={community.name} className="w-full h-full rounded-2xl object-cover" />
            ) : (
              community.name.charAt(0).toUpperCase()
            )}
          </button>
        ))}
        
        <div className="w-8 h-0.5 bg-dark-700 rounded-full" />
        
        {/* Add server button */}
        <button
          onClick={() => setShowCreateCommunity(true)}
          className="w-12 h-12 rounded-full bg-surface-primary flex items-center justify-center text-status-online hover:bg-status-online hover:text-white transition-all cursor-pointer"
          title="Create or Join Server"
        >
          <PlusIcon />
        </button>

        {/* Downloads Button */}
        <button
          onClick={() => navigate('/downloads')}
          className="w-12 h-12 rounded-2xl bg-gray-700 hover:bg-green-600 flex items-center justify-center transition-colors group"
          title="Download Rail Gun"
        >
          <svg className="w-6 h-6 text-gray-300 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>

        {/* DEX Swap Button */}
        <button
          onClick={() => navigate('/dex')}
          className="w-12 h-12 rounded-2xl bg-blue-800 hover:bg-blue-600 flex items-center justify-center transition-colors group"
          title="DEX Swap"
        >
          <span className="text-xl font-bold text-white">$</span>
        </button>

        {/* Anonymous Phone Dialer Button */}
        <button
          onClick={() => navigate('/phone')}
          className="w-12 h-12 rounded-2xl bg-green-800 hover:bg-green-600 flex items-center justify-center transition-colors group"
          title="Anonymous Phone (*67)"
        >
          <PhoneIcon />
        </button>

        {/* Bible Reader Button */}
        <button
          onClick={() => navigate('/bible')}
          className="w-12 h-12 rounded-2xl bg-yellow-800 hover:bg-yellow-600 flex items-center justify-center transition-colors group"
          title="Bible Reader"
        >
          <BookIcon />
        </button>

        {/* Settings Button */}
        <button 
          className="p-1 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </div>

      {/* Channels Panel */}
      <div className="w-60 bg-surface-secondary flex flex-col">
        {/* Community Header */}
        <div className="h-12 border-b border-dark-900 flex items-center px-4 justify-between drag-region">
          <h2 className="font-semibold text-text-primary truncate no-drag">
            {currentCommunity?.name || 'Select a Server'}
          </h2>
          {currentCommunity && (
            <button 
              onClick={() => setShowSettings(true)}
              className="p-1 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
              title="Community Settings"
              aria-label="Community Settings"
            >
              <SettingsIcon />
            </button>
          )}
        </div>

        {/* Channels List */}
        <div className="flex-1 overflow-y-auto p-2">
          {/* Direct Messages Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between px-2 mb-1">
              <h3 className="text-xs font-semibold uppercase text-text-muted">
                Direct Messages
              </h3>
              <button
                onClick={() => setShowStartDm(true)}
                className="p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
                title="Start DM"
              >
                <PlusIcon />
              </button>
            </div>
            
            {dmConversations.map((dm) => {
              const isSelfDm = dm.peerId === accessToken; // Check if it's a self-DM
              
              return (
              <button
                key={dm.conversationId}
                onClick={() => {
                  setCurrentDmUser(dm.peerId);
                  // Join DM room when selecting
                  if (socketClient.isConnected()) {
                    socketClient.joinDm(dm.conversationId);
                  }
                }}
                className={`
                  w-full px-2 py-1.5 rounded flex items-center gap-2 text-left
                  ${
                    currentDmUserId === dm.peerId
                      ? 'bg-surface-elevated text-text-primary'
                      : 'text-text-secondary hover:bg-surface-elevated/50 hover:text-text-primary'
                  }
                `}
              >
                {/* Avatar with presence or special icon for self */}
                <div className="relative flex-shrink-0">
                  {isSelfDm ? (
                    <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm">
                      💾
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-semibold">
                        {dm.peerAvatarUrl ? (
                          <img
                            src={dm.peerAvatarUrl}
                            alt={dm.peerUsername}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          dm.peerUsername[0].toUpperCase()
                        )}
                      </div>
                      <div
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface-secondary ${
                          dm.peerPresence === 'ONLINE'
                            ? 'bg-green-500'
                            : dm.peerPresence === 'AWAY'
                            ? 'bg-yellow-500'
                            : dm.peerPresence === 'DND'
                            ? 'bg-red-500'
                            : 'bg-gray-500'
                        }`}
                      />
                    </>
                  )}
                </div>
                <span className="truncate">{dm.peerDisplayName || dm.peerUsername}</span>
                {dm.unreadCount > 0 && (
                  <span className="ml-auto bg-primary-500 text-white text-xs px-1.5 rounded-full">
                    {dm.unreadCount}
                  </span>
                )}
              </button>
            );
            })}
            
            {dmConversations.length === 0 && (
              <p className="px-2 py-2 text-xs text-text-muted italic">
                No conversations yet
              </p>
            )}
          </div>

          {/* Server Channels Section */}
          {currentCommunity ? (
            <>
              <div className="mb-4">
                <div className="flex items-center justify-between px-2 mb-1">
                  <h3 className="text-xs font-semibold uppercase text-text-muted">
                    Text Channels
                  </h3>
                  <button
                    onClick={() => setShowCreateChannel(true)}
                    className="p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
                    title="Create Channel"
                  >
                    <PlusIcon />
                  </button>
                </div>
                
                {currentCommunity.channels
                  .filter((ch) => ch.type === 'TEXT')
                  .map((channel) => (
                    <button
                      key={channel.id}
                      onClick={() => setCurrentChannel(channel.id)}
                      className={`
                        w-full px-2 py-1.5 rounded flex items-center gap-2 text-left
                        ${
                          currentChannelId === channel.id
                            ? 'bg-surface-elevated text-text-primary'
                            : 'text-text-secondary hover:bg-surface-elevated/50 hover:text-text-primary'
                        }
                      `}
                    >
                      <span className="opacity-60"><HashIcon /></span>
                      <span className="truncate">{channel.name}</span>
                      {channel.unreadCount > 0 && (
                        <span className="ml-auto bg-primary-500 text-white text-xs px-1.5 rounded-full">
                          {channel.unreadCount}
                        </span>
                      )}
                    </button>
                  ))}
                
                {currentCommunity.channels.filter((ch) => ch.type === 'TEXT').length === 0 && (
                  <p className="px-2 py-2 text-xs text-text-muted italic">
                    No channels yet
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="px-2 py-4 text-center text-text-muted">
              <p className="text-sm mb-2">No server selected</p>
              <button
                onClick={() => setShowCreateCommunity(true)}
                className="text-primary-400 hover:text-primary-300 text-sm"
              >
                Create or join a server
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Create Community Modal */}
      {showCreateCommunity && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-secondary rounded-lg p-6 w-96 max-w-[90vw]">
            <h2 className="text-xl font-bold text-text-primary mb-4">Create or Join Server</h2>
            
            {error && (
              <div className="bg-status-error/20 border border-status-error text-status-error px-3 py-2 rounded mb-4 text-sm">
                {error}
              </div>
            )}
            
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-text-primary mb-2">Create a new server</h3>
              <input
                type="text"
                placeholder="Server name"
                value={newCommunityName}
                onChange={(e) => setNewCommunityName(e.target.value)}
                className="w-full px-3 py-2 rounded bg-surface-elevated text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCommunity()}
              />
              <button
                onClick={handleCreateCommunity}
                disabled={isLoading || !newCommunityName.trim()}
                className="mt-2 w-full px-4 py-2 bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating...' : 'Create Server'}
              </button>
            </div>
            
            <div className="border-t border-dark-700 pt-4">
              <h3 className="text-sm font-semibold text-text-primary mb-2">Join with invite code</h3>
              <input
                type="text"
                placeholder="Enter invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full px-3 py-2 rounded bg-surface-elevated text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
                onKeyDown={(e) => e.key === 'Enter' && handleJoinCommunity()}
              />
              <button
                onClick={handleJoinCommunity}
                disabled={isLoading || !inviteCode.trim()}
                className="mt-2 w-full px-4 py-2 bg-status-online text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Joining...' : 'Join Server'}
              </button>
            </div>
            
            <button
              onClick={() => {
                setShowCreateCommunity(false);
                setError(null);
              }}
              className="mt-4 w-full px-4 py-2 text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-secondary rounded-lg p-6 w-96 max-w-[90vw]">
            <h2 className="text-xl font-bold text-text-primary mb-4">Create Channel</h2>
            
            {error && (
              <div className="bg-status-error/20 border border-status-error text-status-error px-3 py-2 rounded mb-4 text-sm">
                {error}
              </div>
            )}
            
            <input
              type="text"
              placeholder="Channel name"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              className="w-full px-3 py-2 rounded bg-surface-elevated text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateChannel()}
            />
            
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowCreateChannel(false);
                  setError(null);
                }}
                className="flex-1 px-4 py-2 text-text-muted hover:text-text-primary bg-surface-elevated rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChannel}
                disabled={isLoading || !newChannelName.trim()}
                className="flex-1 px-4 py-2 bg-primary-500 text-white rounded hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start DM Modal */}
      <StartDmModal
        isOpen={showStartDm}
        onClose={() => setShowStartDm(false)}
      />

      {/* Community Settings Modal */}
      {showSettings && currentCommunity && (
        <CommunitySettingsModal
          community={currentCommunity}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
