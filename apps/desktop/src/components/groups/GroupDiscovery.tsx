/**
 * Group Discovery Page
 * 
 * Browse and search public groups with various policies.
 * Supports @handle search and QR code scanning.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import { useGroupsStore } from '../../stores/groupsStore';
import { JoinPolicy, PostPolicy, GroupType } from '@railgun/shared';

// ============================================================================
// ICONS
// ============================================================================

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const QrCodeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const LockClosedIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const DollarIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const MegaphoneIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
  </svg>
);

// ============================================================================
// TYPES
// ============================================================================

interface DiscoveredGroup {
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

// ============================================================================
// COMPONENTS
// ============================================================================

function GroupCard({ group, onJoin }: { group: DiscoveredGroup; onJoin: (id: string) => void }) {
  const getTypeIcon = () => {
    if (group.isPaid) return <DollarIcon />;
    if (group.postPolicy === PostPolicy.OWNER_ONLY || group.postPolicy === PostPolicy.ROLE_BASED) {
      return <MegaphoneIcon />;
    }
    return <UsersIcon />;
  };

  const getTypeLabel = () => {
    if (group.isPaid) {
      const price = group.priceAmount ? `$${(group.priceAmount / 100).toFixed(2)}` : 'Paid';
      return `${price}/mo`;
    }
    if (group.groupType === GroupType.BROADCAST) return 'Broadcast';
    return 'Community';
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0">
          {group.iconUrl ? (
            <img src={group.iconUrl} alt={group.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-semibold text-gray-300">
              {group.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white truncate">{group.name}</h3>
            {group.joinPolicy === JoinPolicy.INVITE_ONLY && (
              <LockClosedIcon />
            )}
          </div>
          
          {group.handle && (
            <p className="text-sm text-gray-400">@{group.handle}</p>
          )}
          
          {group.description && (
            <p className="text-sm text-gray-300 mt-1 line-clamp-2">{group.description}</p>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <UsersIcon />
              {group.memberCount.toLocaleString()} members
            </span>
            <span className="flex items-center gap-1">
              {getTypeIcon()}
              {getTypeLabel()}
            </span>
          </div>
        </div>

        {/* Join Button */}
        <Button
          variant={group.isPaid ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => onJoin(group.id)}
          disabled={group.joinPolicy === JoinPolicy.INVITE_ONLY}
        >
          {group.joinPolicy === JoinPolicy.APPROVAL_REQUIRED ? 'Request' : 
           group.joinPolicy === JoinPolicy.INVITE_ONLY ? 'Invite Only' :
           group.isPaid ? 'Subscribe' : 'Join'}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function GroupDiscovery() {
  const navigate = useNavigate();
  const { 
    discoverableGroups, 
    isLoading, 
    error,
    fetchDiscoverableGroups,
    joinGroup,
    requestToJoin,
  } = useGroupsStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'free' | 'paid' | 'broadcast'>('all');

  // Fetch groups on mount
  useEffect(() => {
    fetchDiscoverableGroups();
  }, [fetchDiscoverableGroups]);

  // Filter groups
  const filteredGroups = (discoverableGroups as DiscoveredGroup[]).filter((group: DiscoveredGroup) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = group.name.toLowerCase().includes(query);
      const matchesHandle = group.handle?.toLowerCase().includes(query.replace('@', ''));
      if (!matchesName && !matchesHandle) return false;
    }

    // Type filter
    switch (filter) {
      case 'free':
        return !group.isPaid;
      case 'paid':
        return group.isPaid;
      case 'broadcast':
        return group.groupType === GroupType.BROADCAST;
      default:
        return true;
    }
  });

  const handleJoin = useCallback(async (groupId: string) => {
    const group = (discoverableGroups as DiscoveredGroup[]).find((g: DiscoveredGroup) => g.id === groupId);
    if (!group) return;

    if (group.isPaid) {
      // Navigate to payment flow
      navigate(`/groups/${groupId}/subscribe`);
      return;
    }

    if (group.joinPolicy === JoinPolicy.APPROVAL_REQUIRED) {
      await requestToJoin(groupId);
    } else {
      await joinGroup(groupId);
    }
  }, [discoverableGroups, joinGroup, requestToJoin, navigate]);

  const handleScanQR = useCallback(() => {
    // Open QR scanner modal
    // This would use a camera API or allow file upload
    console.log('Open QR scanner');
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-xl font-bold text-white mb-4">Discover Groups</h1>
        
        {/* Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or @handle..."
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <Button variant="secondary" onClick={handleScanQR}>
            <QrCodeIcon />
            Scan QR
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-3">
          {(['all', 'free', 'paid', 'broadcast'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Groups List */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : error ? (
          <div className="text-center text-red-400 p-4">
            {error}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="text-center text-gray-400 p-8">
            {searchQuery ? 'No groups found matching your search.' : 'No discoverable groups yet.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map(group => (
              <GroupCard key={group.id} group={group} onJoin={handleJoin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default GroupDiscovery;
