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
import { CommunitiesService, CreateChannelDto } from './communities.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';

interface AuthRequest extends Request {
  user: UserEntity;
}

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  /**
   * Get a channel by ID.
   * GET /channels/:id
   */
  @Get(':id')
  async getChannel(@Param('id') id: string) {
    const channel = await this.communitiesService.getChannel(id);
    return { channel };
  }

  /**
   * Get all channels for a community.
   * GET /channels/community/:communityId
   */
  @Get('community/:communityId')
  async getCommunityChannels(@Param('communityId') communityId: string) {
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
}
