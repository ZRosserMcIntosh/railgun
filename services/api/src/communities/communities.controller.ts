import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  CommunitiesService,
  CreateCommunityDto,
  CreateRoleDto,
} from './communities.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';

interface AuthRequest extends Request {
  user: UserEntity;
}

@Controller('communities')
@UseGuards(JwtAuthGuard)
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  /**
   * Create a new community.
   * POST /communities
   */
  @Post()
  async create(@Request() req: AuthRequest, @Body() dto: CreateCommunityDto) {
    const community = await this.communitiesService.createCommunity(
      req.user.id,
      dto,
    );
    return { community };
  }

  /**
   * Get user's communities.
   * GET /communities
   */
  @Get()
  async getUserCommunities(@Request() req: AuthRequest) {
    const communities = await this.communitiesService.getUserCommunities(
      req.user.id,
    );
    return { communities };
  }

  /**
   * Get a community by ID.
   * GET /communities/:id
   */
  @Get(':id')
  async getCommunity(@Param('id') id: string) {
    const community = await this.communitiesService.getCommunity(id);
    return { community };
  }

  /**
   * Get a community by invite code.
   * GET /communities/invite/:code
   */
  @Get('invite/:code')
  async getCommunityByInvite(@Param('code') code: string) {
    const community = await this.communitiesService.getCommunityByInvite(code);
    return {
      community: {
        id: community.id,
        name: community.name,
        description: community.description,
        iconUrl: community.iconUrl,
        memberCount: community.memberCount,
      },
    };
  }

  /**
   * Update a community.
   * PATCH /communities/:id
   */
  @Patch(':id')
  async update(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: Partial<CreateCommunityDto>,
  ) {
    const community = await this.communitiesService.updateCommunity(
      id,
      req.user.id,
      dto,
    );
    return { community };
  }

  /**
   * Delete a community.
   * DELETE /communities/:id
   */
  @Delete(':id')
  async delete(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.communitiesService.deleteCommunity(id, req.user.id);
    return { message: 'Community deleted' };
  }

  /**
   * Regenerate invite code.
   * POST /communities/:id/invite/regenerate
   */
  @Post(':id/invite/regenerate')
  async regenerateInvite(@Request() req: AuthRequest, @Param('id') id: string) {
    const inviteCode = await this.communitiesService.regenerateInviteCode(
      id,
      req.user.id,
    );
    return { inviteCode };
  }

  /**
   * Join a community.
   * POST /communities/:id/join
   */
  @Post(':id/join')
  async join(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { inviteCode?: string },
  ) {
    const member = await this.communitiesService.joinCommunity(
      id,
      req.user.id,
      body.inviteCode,
    );
    return { member };
  }

  /**
   * Leave a community.
   * POST /communities/:id/leave
   */
  @Post(':id/leave')
  async leave(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.communitiesService.leaveCommunity(id, req.user.id);
    return { message: 'Left community' };
  }

  /**
   * Get community members.
   * GET /communities/:id/members
   */
  @Get(':id/members')
  async getMembers(@Param('id') id: string) {
    const members = await this.communitiesService.getMembers(id);
    return {
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        username: m.user?.username,
        displayName: m.user?.displayName,
        avatarUrl: m.user?.avatarUrl,
        nickname: m.nickname,
        role: m.role
          ? { id: m.role.id, name: m.role.name, color: m.role.color }
          : null,
        joinedAt: m.joinedAt,
      })),
    };
  }

  /**
   * Kick a member.
   * DELETE /communities/:id/members/:userId
   */
  @Delete(':id/members/:userId')
  async kickMember(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    await this.communitiesService.kickMember(id, userId, req.user.id);
    return { message: 'Member kicked' };
  }

  /**
   * Get community roles.
   * GET /communities/:id/roles
   */
  @Get(':id/roles')
  async getRoles(@Param('id') id: string) {
    const roles = await this.communitiesService.getCommunityRoles(id);
    return { roles };
  }

  /**
   * Create a role.
   * POST /communities/:id/roles
   */
  @Post(':id/roles')
  async createRole(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: CreateRoleDto,
  ) {
    const role = await this.communitiesService.createRole(
      id,
      req.user.id,
      dto,
    );
    return { role };
  }

  /**
   * Assign a role to a member.
   * POST /communities/:id/members/:userId/role
   */
  @Post(':id/members/:userId/role')
  async assignRole(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: { roleId: string },
  ) {
    const member = await this.communitiesService.assignRole(
      id,
      userId,
      body.roleId,
      req.user.id,
    );
    return { member };
  }
}
