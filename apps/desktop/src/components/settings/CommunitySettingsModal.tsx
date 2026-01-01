import { useState, useCallback, useRef, useEffect } from 'react';
import { Permission } from '@railgun/shared';
import { CommunityData } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { getApiClient } from '../../lib/api';

// Note: Inline styles used for dynamic role colors - this is intentional

// ==================== Types ====================

interface Member {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  roleIds: string[];
  joinedAt: string;
}

interface Role {
  id: string;
  name: string;
  color: string;
  permissions: Permission[];
  position: number;
}

interface CommunitySettingsModalProps {
  community: CommunityData;
  onClose: () => void;
}

type SettingsTab = 'overview' | 'roles' | 'members' | 'channels';

// ==================== Component ====================

export const CommunitySettingsModal = ({ community, onClose }: CommunitySettingsModalProps) => {
  const { user } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<SettingsTab>('overview');
  const [communityName, setCommunityName] = useState(community.name);
  const [communityDescription, setCommunityDescription] = useState(community.description || '');
  const [communityIcon, setCommunityIcon] = useState(community.iconUrl || '');
  const [inviteCode, setInviteCode] = useState(community.inviteCode || '');
  
  // Members and roles - loaded from API
  const [members, setMembers] = useState<Member[]>([
    {
      id: user?.id || '1',
      username: user?.username || 'owner',
      displayName: user?.displayName || 'Owner',
      roleIds: ['owner'],
      joinedAt: new Date().toISOString(),
    },
  ]);

  const [roles, setRoles] = useState<Role[]>([
    {
      id: 'owner',
      name: 'Owner',
      color: '#FF0000',
      permissions: [Permission.ADMINISTRATOR],
      position: 999,
    },
    {
      id: 'admin',
      name: 'Admin',
      color: '#FFA500',
      permissions: [
        Permission.MANAGE_COMMUNITY,
        Permission.MANAGE_CHANNELS,
        Permission.MANAGE_ROLES,
        Permission.MANAGE_MEMBERS,
        Permission.KICK_MEMBERS,
        Permission.BAN_MEMBERS,
      ],
      position: 100,
    },
    {
      id: 'moderator',
      name: 'Moderator',
      color: '#00FF00',
      permissions: [
        Permission.MANAGE_MESSAGES,
        Permission.KICK_MEMBERS,
      ],
      position: 50,
    },
    {
      id: 'member',
      name: 'Member',
      color: '#999999',
      permissions: [
        Permission.READ_MESSAGES,
        Permission.SEND_MESSAGES,
        Permission.INVITE_MEMBERS,
      ],
      position: 0,
    },
  ]);

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);

  // Check if current user is owner or admin
  const isOwner = community.ownerId === user?.id;
  const canManage = isOwner; // TODO: Check for MANAGE_COMMUNITY permission
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Load members and roles from API
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const api = getApiClient();
        
        // Load members
        const { members: apiMembers } = await api.getCommunityMembers(community.id);
        setMembers(apiMembers.map(m => ({
          id: m.userId,
          username: m.username,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
          roleIds: m.roleId ? [m.roleId] : [],
          joinedAt: m.joinedAt,
        })));
        
        // Load roles
        const { roles: apiRoles } = await api.getCommunityRoles(community.id);
        setRoles(apiRoles.map(r => ({
          id: r.id,
          name: r.name,
          color: r.color || '#999999',
          permissions: r.permissions as Permission[],
          position: r.position,
        })));
      } catch (err) {
        console.error('Failed to load community data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, [community.id]);

  // Handle icon upload
  const handleIconUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // In production, upload to server and get URL
    const reader = new FileReader();
    reader.onload = (e) => {
      setCommunityIcon(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  // Handle save settings
  const handleSave = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const api = getApiClient();
      
      await api.updateCommunity(community.id, {
        name: communityName,
        description: communityDescription,
        iconUrl: communityIcon,
      });
      
      onClose();
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsLoading(false);
    }
  }, [community.id, communityName, communityDescription, communityIcon, onClose]);

  // Handle role assignment
  const assignRole = useCallback(async (memberId: string, roleId: string) => {
    try {
      const api = getApiClient();
      await api.assignRole(community.id, memberId, roleId);
      // Update local state
      setMembers(prev => prev.map(m => 
        m.id === memberId ? { ...m, roleIds: [roleId] } : m
      ));
    } catch (err) {
      console.error('Failed to assign role:', err);
      setError(err instanceof Error ? err.message : 'Failed to assign role');
    }
  }, [community.id]);

  // Handle role removal
  const removeRole = useCallback(async (memberId: string, _roleId: string) => {
    try {
      // Find default member role
      const defaultRole = roles.find(r => r.name === 'Member' || r.name === '@everyone');
      if (defaultRole) {
        const api = getApiClient();
        await api.assignRole(community.id, memberId, defaultRole.id);
        setMembers(prev => prev.map(m => 
          m.id === memberId ? { ...m, roleIds: [defaultRole.id] } : m
        ));
      }
    } catch (err) {
      console.error('Failed to remove role:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove role');
    }
  }, [community.id, roles]);

  // Handle kick member
  const kickMember = useCallback(async (memberId: string) => {
    try {
      const api = getApiClient();
      await api.kickMember(community.id, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Failed to kick member:', err);
      setError(err instanceof Error ? err.message : 'Failed to kick member');
    }
  }, [community.id]);

  // Handle regenerate invite
  const regenerateInvite = useCallback(async () => {
    try {
      const api = getApiClient();
      const { inviteCode: newCode } = await api.regenerateInviteCode(community.id);
      setInviteCode(newCode);
    } catch (err) {
      console.error('Failed to regenerate invite:', err);
      setError(err instanceof Error ? err.message : 'Failed to regenerate invite');
    }
  }, [community.id]);

  // Handle create role
  const createRole = useCallback(async () => {
    try {
      const api = getApiClient();
      const { role: newRole } = await api.createRole(community.id, {
        name: 'New Role',
        color: '#3B82F6',
        permissions: [Permission.READ_MESSAGES, Permission.SEND_MESSAGES],
        position: roles.length,
      });
      setRoles([...roles, {
        id: newRole.id,
        name: newRole.name,
        color: newRole.color || '#3B82F6',
        permissions: newRole.permissions as Permission[],
        position: newRole.position,
      }]);
    } catch (err) {
      console.error('Failed to create role:', err);
      setError(err instanceof Error ? err.message : 'Failed to create role');
    }
  }, [community.id, roles]);

  // Handle update role
  const updateRole = useCallback(async (roleId: string, updates: Partial<Role>) => {
    try {
      const api = getApiClient();
      await api.updateRole(community.id, roleId, {
        name: updates.name,
        color: updates.color,
        permissions: updates.permissions,
        position: updates.position,
      });
      setRoles(roles.map(r => r.id === roleId ? { ...r, ...updates } : r));
    } catch (err) {
      console.error('Failed to update role:', err);
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  }, [community.id, roles]);

  // Handle delete role
  const deleteRole = useCallback(async (roleId: string) => {
    if (['owner', 'member'].includes(roleId)) {
      alert('Cannot delete default roles');
      return;
    }
    try {
      const api = getApiClient();
      await api.deleteRole(community.id, roleId);
      setRoles(roles.filter(r => r.id !== roleId));
    } catch (err) {
      console.error('Failed to delete role:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    }
  }, [community.id, roles]);

  // Toggle permission
  const togglePermission = useCallback((roleId: string, permission: Permission) => {
    setRoles(roles.map(role => {
      if (role.id !== roleId) return role;
      const hasPermission = role.permissions.includes(permission);
      return {
        ...role,
        permissions: hasPermission
          ? role.permissions.filter(p => p !== permission)
          : [...role.permissions, permission],
      };
    }));
  }, [roles]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-900 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col border border-dark-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h2 className="text-xl font-bold text-text-primary">
            {community.name} Settings
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Navigation */}
          <div className="w-48 bg-dark-950 border-r border-dark-700 p-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full text-left px-3 py-2 rounded mb-1 transition-colors ${
                activeTab === 'overview'
                  ? 'bg-primary-600 text-white'
                  : 'text-text-secondary hover:bg-dark-800'
              }`}
            >
              📋 Overview
            </button>
            <button
              onClick={() => setActiveTab('roles')}
              className={`w-full text-left px-3 py-2 rounded mb-1 transition-colors ${
                activeTab === 'roles'
                  ? 'bg-primary-600 text-white'
                  : 'text-text-secondary hover:bg-dark-800'
              }`}
            >
              🎭 Roles
            </button>
            <button
              onClick={() => setActiveTab('members')}
              className={`w-full text-left px-3 py-2 rounded mb-1 transition-colors ${
                activeTab === 'members'
                  ? 'bg-primary-600 text-white'
                  : 'text-text-secondary hover:bg-dark-800'
              }`}
            >
              👥 Members
            </button>
            <button
              onClick={() => setActiveTab('channels')}
              className={`w-full text-left px-3 py-2 rounded transition-colors ${
                activeTab === 'channels'
                  ? 'bg-primary-600 text-white'
                  : 'text-text-secondary hover:bg-dark-800'
              }`}
            >
              📺 Channels
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-text-primary mb-4">Community Overview</h3>
                  
                  {/* Community Icon */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Community Icon
                    </label>
                    <div className="flex items-center gap-4">
                      <div className="w-24 h-24 rounded-full bg-dark-800 flex items-center justify-center overflow-hidden border-2 border-dark-700">
                        {communityIcon ? (
                          <img src={communityIcon} alt="Community icon" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-4xl">{communityName.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={!canManage}
                          className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-dark-700 disabled:text-text-muted text-white rounded transition-colors"
                        >
                          Upload Icon
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleIconUpload}
                          className="hidden"
                          aria-label="Upload community icon"
                        />
                        <p className="text-xs text-text-muted mt-1">Recommended: 512x512px</p>
                      </div>
                    </div>
                  </div>

                  {/* Community Name */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Community Name
                    </label>
                    <input
                      type="text"
                      value={communityName}
                      onChange={(e) => setCommunityName(e.target.value)}
                      disabled={!canManage}
                      className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded text-text-primary disabled:opacity-50"
                      maxLength={100}
                    />
                  </div>

                  {/* Community Description */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Description
                    </label>
                    <textarea
                      value={communityDescription}
                      onChange={(e) => setCommunityDescription(e.target.value)}
                      disabled={!canManage}
                      className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded text-text-primary disabled:opacity-50 h-24 resize-none"
                      maxLength={500}
                      placeholder="What's this community about?"
                    />
                  </div>

                  {/* Invite Code */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Invite Code
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inviteCode}
                        readOnly
                        className="flex-1 px-3 py-2 bg-dark-800 border border-dark-700 rounded text-text-primary font-mono"
                        aria-label="Community invite code"
                      />
                      <button
                        onClick={regenerateInvite}
                        disabled={!canManage}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-dark-700 disabled:text-text-muted text-white rounded transition-colors"
                      >
                        Regenerate
                      </button>
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      Share this code to invite members
                    </p>
                  </div>

                  {/* Save Button */}
                  {canManage && (
                    <div className="flex flex-col gap-2 pt-4 border-t border-dark-700">
                      {error && (
                        <div className="p-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
                          {error}
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={onClose}
                          className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-primary rounded transition-colors"
                          disabled={isLoading}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded transition-colors disabled:opacity-50"
                          disabled={isLoading}
                        >
                          {isLoading ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Roles Tab */}
            {activeTab === 'roles' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-text-primary">Roles</h3>
                  {canManage && (
                    <button
                      onClick={createRole}
                      className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-sm transition-colors"
                    >
                      + Create Role
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {roles.sort((a, b) => b.position - a.position).map((role) => (
                    <div
                      key={role.id}
                      className="bg-dark-800 border border-dark-700 rounded-lg p-4 cursor-pointer hover:border-dark-600 transition-colors"
                      onClick={() => setSelectedRole(selectedRole?.id === role.id ? null : role)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: role.color }}
                          />
                          <span className="font-medium text-text-primary">{role.name}</span>
                          <span className="text-xs text-text-muted">
                            {role.permissions.length} permissions
                          </span>
                        </div>
                        {canManage && !['owner', 'member'].includes(role.id) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRole(role.id);
                            }}
                            className="text-red-500 hover:text-red-400 text-sm"
                          >
                            Delete
                          </button>
                        )}
                      </div>

                      {/* Expanded Role Details */}
                      {selectedRole?.id === role.id && (
                        <div className="mt-4 pt-4 border-t border-dark-700 space-y-3">
                          {/* Role Name */}
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Role Name</label>
                            <input
                              type="text"
                              value={role.name}
                              onChange={(e) => updateRole(role.id, { name: e.target.value })}
                              disabled={!canManage || ['owner', 'member'].includes(role.id)}
                              className="w-full px-2 py-1 bg-dark-900 border border-dark-700 rounded text-sm disabled:opacity-50"
                              aria-label="Role name"
                            />
                          </div>

                          {/* Role Color */}
                          <div>
                            <label className="block text-xs text-text-muted mb-1">Color</label>
                            <input
                              type="color"
                              value={role.color}
                              onChange={(e) => updateRole(role.id, { color: e.target.value })}
                              disabled={!canManage}
                              className="w-20 h-8 bg-dark-900 border border-dark-700 rounded cursor-pointer disabled:opacity-50"
                              aria-label="Role color"
                            />
                          </div>

                          {/* Permissions */}
                          <div>
                            <label className="block text-xs text-text-muted mb-2">Permissions</label>
                            <div className="grid grid-cols-2 gap-2">
                              {Object.values(Permission).map((permission) => (
                                <label
                                  key={permission}
                                  className="flex items-center gap-2 text-sm cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={role.permissions.includes(permission)}
                                    onChange={() => togglePermission(role.id, permission)}
                                    disabled={!canManage || role.permissions.includes(Permission.ADMINISTRATOR)}
                                    className="rounded"
                                  />
                                  <span className="text-text-secondary">{permission.replace(/_/g, ' ')}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Members Tab */}
            {activeTab === 'members' && (
              <div>
                <h3 className="text-lg font-bold text-text-primary mb-4">
                  Members ({members.length})
                </h3>

                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="bg-dark-800 border border-dark-700 rounded-lg p-3 flex items-center justify-between hover:border-dark-600 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold">
                          {member.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-text-primary">{member.displayName}</div>
                          <div className="text-sm text-text-muted">@{member.username}</div>
                        </div>
                        <div className="flex gap-1">
                          {member.roleIds.map((roleId) => {
                            const role = roles.find(r => r.id === roleId);
                            if (!role) return null;
                            return (
                              <span
                                key={roleId}
                                className="text-xs px-2 py-0.5 rounded"
                                style={{
                                  backgroundColor: role.color + '33',
                                  color: role.color,
                                  border: `1px solid ${role.color}66`
                                }}
                              >
                                {role.name}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {canManage && member.id !== user?.id && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedMember(selectedMember?.id === member.id ? null : member)}
                            className="text-sm text-primary-500 hover:text-primary-400"
                          >
                            Manage Roles
                          </button>
                          <button
                            onClick={() => kickMember(member.id)}
                            className="text-sm text-red-500 hover:text-red-400"
                          >
                            Kick
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Member Role Management Modal */}
                {selectedMember && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-dark-900 rounded-lg p-6 w-96 border border-dark-700">
                      <h4 className="text-lg font-bold text-text-primary mb-4">
                        Manage Roles for {selectedMember.displayName}
                      </h4>
                      
                      <div className="space-y-2 mb-4">
                        {roles.filter(r => r.id !== 'owner').map((role) => (
                          <label
                            key={role.id}
                            className="flex items-center gap-2 p-2 hover:bg-dark-800 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedMember.roleIds.includes(role.id)}
                              onChange={() => {
                                const hasRole = selectedMember.roleIds.includes(role.id);
                                if (hasRole) {
                                  removeRole(selectedMember.id, role.id);
                                } else {
                                  assignRole(selectedMember.id, role.id);
                                }
                              }}
                            />
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: role.color }}
                            />
                            <span className="text-text-primary">{role.name}</span>
                          </label>
                        ))}
                      </div>

                      <button
                        onClick={() => setSelectedMember(null)}
                        className="w-full py-2 bg-primary-600 hover:bg-primary-500 text-white rounded transition-colors"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Channels Tab */}
            {activeTab === 'channels' && (
              <div>
                <h3 className="text-lg font-bold text-text-primary mb-4">Channels</h3>
                
                <div className="space-y-2">
                  {community.channels.map((channel) => (
                    <div
                      key={channel.id}
                      className="bg-dark-800 border border-dark-700 rounded-lg p-3 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-text-primary">
                          # {channel.name}
                        </div>
                        {channel.description && (
                          <div className="text-sm text-text-muted">{channel.description}</div>
                        )}
                      </div>
                      {canManage && (
                        <button className="text-sm text-primary-500 hover:text-primary-400">
                          Edit
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canManage && (
                  <button className="mt-4 w-full py-2 border-2 border-dashed border-dark-600 rounded-lg text-text-muted hover:border-primary-600 hover:text-primary-500 transition-colors">
                    + Create Channel
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommunitySettingsModal;
