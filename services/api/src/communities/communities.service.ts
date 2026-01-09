import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunityEntity } from './community.entity';
import { ChannelEntity, ChannelType } from './channel.entity';
import { MemberEntity } from './member.entity';
import { RoleEntity } from './role.entity';
import { Permission } from '@railgun/shared';
import { randomBytes } from 'crypto';

/** DTO for creating a community */
export interface CreateCommunityDto {
  name: string;
  description?: string;
  iconUrl?: string;
  isPublic?: boolean;
}

/** DTO for creating a channel */
export interface CreateChannelDto {
  name: string;
  topic?: string;
  type?: ChannelType;
  category?: string;
  isPrivate?: boolean;
  position?: number;
}

/** DTO for creating a role */
export interface CreateRoleDto {
  name: string;
  color?: string;
  permissions?: Permission[];
  position?: number;
  isHoisted?: boolean;
  isMentionable?: boolean;
}

@Injectable()
export class CommunitiesService {
  constructor(
    @InjectRepository(CommunityEntity)
    private readonly communityRepository: Repository<CommunityEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
  ) {}

  /**
   * Generate a unique invite code.
   */
  private generateInviteCode(): string {
    return randomBytes(8).toString('base64url').slice(0, 8);
  }

  // ==================== COMMUNITY OPERATIONS ====================

  /**
   * Create a new community.
   */
  async createCommunity(
    ownerId: string,
    dto: CreateCommunityDto,
  ): Promise<CommunityEntity> {
    const inviteCode = this.generateInviteCode();

    const community = this.communityRepository.create({
      name: dto.name,
      description: dto.description,
      iconUrl: dto.iconUrl,
      ownerId,
      inviteCode,
      isPublic: dto.isPublic ?? false,
      memberCount: 1,
    });

    const savedCommunity = await this.communityRepository.save(community);

    // Create default role
    const defaultRole = this.roleRepository.create({
      name: '@everyone',
      communityId: savedCommunity.id,
      position: 0,
      permissions: [Permission.READ_MESSAGES, Permission.SEND_MESSAGES],
      isDefault: true,
      isManaged: true,
    });
    await this.roleRepository.save(defaultRole);

    // Add owner as member
    const ownerMember = this.memberRepository.create({
      userId: ownerId,
      communityId: savedCommunity.id,
      joinedAt: new Date(),
      roleId: defaultRole.id,
    });
    await this.memberRepository.save(ownerMember);

    // Create default general channel
    const generalChannel = this.channelRepository.create({
      name: 'general',
      topic: 'General discussion',
      communityId: savedCommunity.id,
      type: ChannelType.TEXT,
      position: 0,
    });
    await this.channelRepository.save(generalChannel);

    return savedCommunity;
  }

  /**
   * Get a community by ID.
   */
  async getCommunity(id: string): Promise<CommunityEntity> {
    const community = await this.communityRepository.findOne({
      where: { id },
      relations: ['channels', 'roles'],
    });

    if (!community) {
      throw new NotFoundException('Community not found');
    }

    return community;
  }

  /**
   * Get a community by invite code.
   */
  async getCommunityByInvite(inviteCode: string): Promise<CommunityEntity> {
    const community = await this.communityRepository.findOne({
      where: { inviteCode },
    });

    if (!community) {
      throw new NotFoundException('Invalid invite code');
    }

    return community;
  }

  /**
   * Update a community.
   */
  async updateCommunity(
    id: string,
    userId: string,
    updates: Partial<CreateCommunityDto>,
  ): Promise<CommunityEntity> {
    const community = await this.getCommunity(id);

    if (community.ownerId !== userId) {
      const member = await this.getMember(id, userId);
      if (!this.hasPermission(member, Permission.MANAGE_COMMUNITY)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    Object.assign(community, updates);
    return this.communityRepository.save(community);
  }

  /**
   * Delete a community.
   */
  async deleteCommunity(id: string, userId: string): Promise<void> {
    const community = await this.getCommunity(id);

    if (community.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete the community');
    }

    await this.communityRepository.remove(community);
  }

  /**
   * Regenerate invite code.
   */
  async regenerateInviteCode(
    communityId: string,
    userId: string,
  ): Promise<string> {
    const community = await this.getCommunity(communityId);

    if (community.ownerId !== userId) {
      const member = await this.getMember(communityId, userId);
      if (!this.hasPermission(member, Permission.INVITE_MEMBERS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    community.inviteCode = this.generateInviteCode();
    await this.communityRepository.save(community);
    return community.inviteCode;
  }

  // ==================== MEMBER OPERATIONS ====================

  /**
   * Join a community.
   */
  async joinCommunity(
    communityId: string,
    userId: string,
    inviteCode?: string,
  ): Promise<MemberEntity> {
    const community = await this.getCommunity(communityId);

    // Check if already a member
    const existingMember = await this.memberRepository.findOne({
      where: { communityId, userId },
    });

    if (existingMember) {
      throw new ConflictException('Already a member of this community');
    }

    // Check invite code for private communities
    if (!community.isPublic && community.inviteCode !== inviteCode) {
      throw new ForbiddenException('Invalid invite code');
    }

    // Check max members
    if (community.maxMembers > 0 && community.memberCount >= community.maxMembers) {
      throw new ForbiddenException('Community is full');
    }

    // Get default role
    const defaultRole = await this.roleRepository.findOne({
      where: { communityId, isDefault: true },
    });

    const member = this.memberRepository.create({
      userId,
      communityId,
      joinedAt: new Date(),
      roleId: defaultRole?.id,
    });

    await this.memberRepository.save(member);

    // Update member count
    community.memberCount++;
    await this.communityRepository.save(community);

    return member;
  }

  /**
   * Leave a community.
   */
  async leaveCommunity(communityId: string, userId: string): Promise<void> {
    const community = await this.getCommunity(communityId);

    if (community.ownerId === userId) {
      throw new ForbiddenException('Owner cannot leave. Transfer ownership first.');
    }

    const member = await this.getMember(communityId, userId);
    await this.memberRepository.remove(member);

    // Update member count
    community.memberCount--;
    await this.communityRepository.save(community);
  }

  /**
   * Get a member.
   */
  async getMember(communityId: string, userId: string): Promise<MemberEntity> {
    const member = await this.memberRepository.findOne({
      where: { communityId, userId },
      relations: ['role'],
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return member;
  }

  /**
   * Check if a user is a member of a community.
   * Returns true if member, false otherwise.
   */
  async isMember(communityId: string, userId: string): Promise<boolean> {
    const member = await this.memberRepository.findOne({
      where: { communityId, userId },
      select: ['id'], // Only need to check existence
    });
    return !!member;
  }

  /**
   * Get all members of a community.
   */
  async getMembers(communityId: string): Promise<MemberEntity[]> {
    return this.memberRepository.find({
      where: { communityId },
      relations: ['user', 'role'],
      order: { joinedAt: 'ASC' },
    });
  }

  /**
   * Kick a member from a community.
   */
  async kickMember(
    communityId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const community = await this.getCommunity(communityId);

    if (targetUserId === community.ownerId) {
      throw new ForbiddenException('Cannot kick the owner');
    }

    if (targetUserId === actorUserId) {
      throw new ForbiddenException('Cannot kick yourself');
    }

    // Check permissions
    if (community.ownerId !== actorUserId) {
      const actorMember = await this.getMember(communityId, actorUserId);
      if (!this.hasPermission(actorMember, Permission.KICK_MEMBERS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const targetMember = await this.getMember(communityId, targetUserId);
    await this.memberRepository.remove(targetMember);

    // Update member count
    community.memberCount--;
    await this.communityRepository.save(community);
  }

  /**
   * Get communities a user belongs to.
   */
  async getUserCommunities(userId: string): Promise<CommunityEntity[]> {
    const members = await this.memberRepository.find({
      where: { userId },
      relations: ['community'],
    });

    return members.map((m) => m.community);
  }

  // ==================== CHANNEL OPERATIONS ====================

  /**
   * Create a channel.
   */
  async createChannel(
    communityId: string,
    userId: string,
    dto: CreateChannelDto,
  ): Promise<ChannelEntity> {
    const community = await this.getCommunity(communityId);

    if (community.ownerId !== userId) {
      const member = await this.getMember(communityId, userId);
      if (!this.hasPermission(member, Permission.MANAGE_CHANNELS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const channel = this.channelRepository.create({
      name: dto.name,
      topic: dto.topic,
      communityId,
      type: dto.type ?? ChannelType.TEXT,
      category: dto.category,
      isPrivate: dto.isPrivate ?? false,
      position: dto.position ?? 0,
    });

    return this.channelRepository.save(channel);
  }

  /**
   * Get a channel.
   */
  async getChannel(id: string): Promise<ChannelEntity> {
    const channel = await this.channelRepository.findOne({
      where: { id },
      relations: ['community'],
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  /**
   * Get all channels in a community.
   */
  async getCommunityChannels(communityId: string): Promise<ChannelEntity[]> {
    return this.channelRepository.find({
      where: { communityId, isArchived: false },
      order: { category: 'ASC', position: 'ASC' },
    });
  }

  /**
   * Update a channel.
   */
  async updateChannel(
    id: string,
    userId: string,
    updates: Partial<CreateChannelDto>,
  ): Promise<ChannelEntity> {
    const channel = await this.getChannel(id);
    const community = await this.getCommunity(channel.communityId);

    if (community.ownerId !== userId) {
      const member = await this.getMember(channel.communityId, userId);
      if (!this.hasPermission(member, Permission.MANAGE_CHANNELS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    Object.assign(channel, updates);
    return this.channelRepository.save(channel);
  }

  /**
   * Delete a channel.
   */
  async deleteChannel(id: string, userId: string): Promise<void> {
    const channel = await this.getChannel(id);
    const community = await this.getCommunity(channel.communityId);

    if (community.ownerId !== userId) {
      const member = await this.getMember(channel.communityId, userId);
      if (!this.hasPermission(member, Permission.MANAGE_CHANNELS)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    await this.channelRepository.remove(channel);
  }

  // ==================== ROLE OPERATIONS ====================

  /**
   * Create a role.
   */
  async createRole(
    communityId: string,
    userId: string,
    dto: CreateRoleDto,
  ): Promise<RoleEntity> {
    const community = await this.getCommunity(communityId);

    if (community.ownerId !== userId) {
      const member = await this.getMember(communityId, userId);
      if (!this.hasPermission(member, Permission.MANAGE_ROLES)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const role = this.roleRepository.create({
      name: dto.name,
      color: dto.color ?? '99aab5',
      communityId,
      permissions: dto.permissions ?? [Permission.READ_MESSAGES, Permission.SEND_MESSAGES],
      position: dto.position ?? 0,
      isHoisted: dto.isHoisted ?? false,
      isMentionable: dto.isMentionable ?? false,
    });

    return this.roleRepository.save(role);
  }

  /**
   * Get all roles in a community.
   */
  async getCommunityRoles(communityId: string): Promise<RoleEntity[]> {
    return this.roleRepository.find({
      where: { communityId },
      order: { position: 'DESC' },
    });
  }

  /**
   * Assign a role to a member.
   */
  async assignRole(
    communityId: string,
    targetUserId: string,
    roleId: string,
    actorUserId: string,
  ): Promise<MemberEntity> {
    const community = await this.getCommunity(communityId);

    if (community.ownerId !== actorUserId) {
      const actorMember = await this.getMember(communityId, actorUserId);
      if (!this.hasPermission(actorMember, Permission.MANAGE_ROLES)) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const targetMember = await this.getMember(communityId, targetUserId);
    targetMember.roleId = roleId;
    return this.memberRepository.save(targetMember);
  }

  // ==================== PERMISSION HELPERS ====================

  /**
   * Check if a member has a specific permission.
   */
  hasPermission(member: MemberEntity, permission: Permission): boolean {
    if (!member.role) return false;
    return (
      member.role.permissions.includes(Permission.ADMINISTRATOR) ||
      member.role.permissions.includes(permission)
    );
  }

  /**
   * Check if a user can access a channel.
   */
  async canAccessChannel(channelId: string, userId: string): Promise<boolean> {
    const channel = await this.getChannel(channelId);

    try {
      const member = await this.getMember(channel.communityId, userId);
      
      if (!channel.isPrivate) {
        return true;
      }

      // For private channels, check if member has permission
      return this.hasPermission(member, Permission.READ_MESSAGES);
    } catch {
      return false;
    }
  }

  /**
   * Validate if a user can access a voice channel.
   * Checks: channel exists, user is member, channel is voice type, user has CONNECT_VOICE permission.
   */
  async validateVoiceAccess(
    userId: string,
    channelId: string,
  ): Promise<{
    allowed: boolean;
    reason?: string;
    permissions?: Permission[];
  }> {
    try {
      // Get channel and verify it's a voice channel
      const channel = await this.getChannel(channelId);
      
      if (channel.type !== ChannelType.VOICE) {
        return { allowed: false, reason: 'Channel is not a voice channel' };
      }

      // Get member and check they're part of the community
      const member = await this.getMember(channel.communityId, userId);

      // Check for CONNECT_VOICE permission
      if (!this.hasPermission(member, Permission.CONNECT_VOICE)) {
        return { allowed: false, reason: 'Missing CONNECT_VOICE permission' };
      }

      // For private channels, check additional access
      if (channel.isPrivate && !this.hasPermission(member, Permission.READ_MESSAGES)) {
        return { allowed: false, reason: 'No access to private channel' };
      }

      // Collect all permissions the user has for the response
      const userPermissions = member.role?.permissions || [];

      return { allowed: true, permissions: userPermissions };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { allowed: false, reason: 'Channel or membership not found' };
      }
      throw error;
    }
  }
}
