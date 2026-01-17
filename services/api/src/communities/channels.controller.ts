import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { CommunitiesService, CreateChannelDto } from './communities.service';
import { ChannelCryptoService } from './channel-crypto.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';

interface AuthRequest extends Request {
  user: UserEntity;
}

interface SendSenderKeyDto {
  recipientUserId: string;
  recipientDeviceId?: number; // Optional: target specific device
  distribution: string;
}

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(
    private readonly communitiesService: CommunitiesService,
    private readonly channelCryptoService: ChannelCryptoService,
  ) {}

  /**
   * Get a channel by ID.
   * GET /channels/:id
   * 
   * SECURITY: Only community members can view channel details
   */
  @Get(':id')
  async getChannel(@Request() req: AuthRequest, @Param('id') id: string) {
    const channel = await this.communitiesService.getChannel(id);
    
    // SECURITY: Check membership in the community
    const isMember = await this.communitiesService.isMember(channel.communityId, req.user.id);
    if (!isMember) {
      throw new ForbiddenException('You must be a member to view this channel');
    }
    
    return { channel };
  }

  /**
   * Get all channels for a community.
   * GET /channels/community/:communityId
   * 
   * SECURITY: Only community members can list channels
   */
  @Get('community/:communityId')
  async getCommunityChannels(
    @Request() req: AuthRequest,
    @Param('communityId') communityId: string,
  ) {
    // SECURITY: Check membership before listing channels
    const isMember = await this.communitiesService.isMember(communityId, req.user.id);
    if (!isMember) {
      throw new ForbiddenException('You must be a member to view channels');
    }
    
    const channels =
      await this.communitiesService.getCommunityChannels(communityId);
    return { channels };
  }

  /**
   * Create a channel.
   * POST /channels/community/:communityId
   */
  @Post('community/:communityId')
  async createChannel(
    @Request() req: AuthRequest,
    @Param('communityId') communityId: string,
    @Body() dto: CreateChannelDto,
  ) {
    const channel = await this.communitiesService.createChannel(
      communityId,
      req.user.id,
      dto,
    );
    return { channel };
  }

  /**
   * Update a channel.
   * PATCH /channels/:id
   */
  @Patch(':id')
  async updateChannel(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: Partial<CreateChannelDto>,
  ) {
    const channel = await this.communitiesService.updateChannel(
      id,
      req.user.id,
      dto,
    );
    return { channel };
  }

  /**
   * Delete a channel.
   * DELETE /channels/:id
   */
  @Delete(':id')
  async deleteChannel(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.communitiesService.deleteChannel(id, req.user.id);
    return { message: 'Channel deleted' };
  }

  // ==================== Channel Crypto Endpoints ====================

  /**
   * Get members of a channel for sender key distribution.
   * GET /channels/:id/members
   * 
   * Returns all community members who have access to this channel,
   * along with their device IDs for E2E key distribution.
   */
  @Get(':id/members')
  async getChannelMembers(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    const members = await this.channelCryptoService.getChannelMembers(
      id,
      req.user.id,
    );
    return { members };
  }

  /**
   * Send a sender key distribution to a channel member.
   * POST /channels/:id/sender-key
   * 
   * Used for distributing sender keys for E2E encrypted channel messages.
   * Supports per-device distribution for multi-device.
   */
  @Post(':id/sender-key')
  async sendSenderKey(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: SendSenderKeyDto,
  ) {
    // For multi-device, sender device ID should come from the request
    // For now, use 1 as default - client should specify their device ID
    const senderDeviceId = 1; // TODO: Get from request header or body

    await this.channelCryptoService.storeSenderKeyDistribution(
      id,
      req.user.id,
      senderDeviceId,
      dto.recipientUserId,
      dto.distribution,
      dto.recipientDeviceId, // Pass through for per-device distribution
    );
    return { success: true };
  }

  /**
   * Get pending sender key distributions for this user's device.
   * GET /channels/:id/sender-key?deviceId=1
   * 
   * Returns and deletes pending distributions (one-time fetch).
   */
  @Get(':id/sender-key')
  async getPendingSenderKeys(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Query('deviceId') deviceIdStr?: string,
  ) {
    const deviceId = deviceIdStr ? parseInt(deviceIdStr, 10) : undefined;
    const distributions = await this.channelCryptoService.getPendingSenderKeys(
      id,
      req.user.id,
      deviceId,
    );
    return { distributions };
  }
}
