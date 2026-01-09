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
import { MessagesService, CreateMessageDto } from './messages.service';
import { DmService } from './dm.service';
import { CommunitiesService } from '../communities/communities.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitGuard, RateLimit } from '../auth/rate-limit.guard';
import { MessageStatus } from '@railgun/shared';
import { UserEntity } from '../users/user.entity';

interface AuthRequest extends Request {
  user: UserEntity;
}

@Controller('messages')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly dmService: DmService,
    private readonly communitiesService: CommunitiesService,
  ) {}

  /**
   * Send a new message.
   * POST /messages
   * 
   * Rate limited to prevent spam.
   */
  @Post()
  @RateLimit({ limit: 60, windowMs: 60000 }) // 60 messages per minute
  async sendMessage(
    @Request() req: AuthRequest,
    @Body() dto: CreateMessageDto,
  ) {
    // Validate authorization
    if (dto.channelId) {
      // Channel message - check membership
      const canAccess = await this.communitiesService.canAccessChannel(
        dto.channelId,
        req.user.id,
      );
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this channel');
      }
    } else if (dto.recipientId) {
      // DM message - ensure recipient exists and create conversation if needed
      await this.dmService.startDmByUserId(req.user.id, dto.recipientId);
    }

    // Check for duplicate (idempotency via clientNonce)
    const existing = await this.messagesService.existsByClientNonce(
      req.user.id,
      dto.clientNonce,
    );
    if (existing) {
      return { message: existing, duplicate: true };
    }

    const message = await this.messagesService.create(req.user.id, dto);
    return { message, duplicate: false };
  }

  /**
   * Get messages for a channel.
   * GET /messages/channel/:channelId
   * 
   * Requires channel membership.
   */
  @Get('channel/:channelId')
  async getChannelMessages(
    @Request() req: AuthRequest,
    @Param('channelId') channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    // Check channel access
    const canAccess = await this.communitiesService.canAccessChannel(
      channelId,
      req.user.id,
    );
    if (!canAccess) {
      throw new ForbiddenException('You do not have access to this channel');
    }

    const messages = await this.messagesService.getChannelMessages(
      channelId,
      limit ? parseInt(limit, 10) : 50,
      before,
    );
    return { messages };
  }

  /**
   * Get DM messages with another user.
   * GET /messages/dm/:userId
   * 
   * Only accessible by the two participants.
   */
  @Get('dm/:userId')
  async getDmMessages(
    @Request() req: AuthRequest,
    @Param('userId') otherUserId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    // Verify participant - conversation ID is deterministic from sorted user IDs
    const conversationId = this.dmService.generateConversationId(
      req.user.id,
      otherUserId,
    );
    
    // Check if user is participant (if conversation exists)
    const dmExists = await this.dmService.getDm(conversationId);
    if (dmExists) {
      const isParticipant = await this.dmService.isParticipant(
        conversationId,
        req.user.id,
      );
      if (!isParticipant) {
        throw new ForbiddenException('You do not have access to this conversation');
      }
    }
    
    const messages = await this.messagesService.getDmMessages(
      req.user.id,
      otherUserId,
      limit ? parseInt(limit, 10) : 50,
      before,
    );
    return { messages };
  }

  /**
   * Get a single message.
   * GET /messages/:id
   */
  @Get(':id')
  async getMessage(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    const message = await this.messagesService.getById(id);
    
    // Validate access to this message
    if (message.channelId) {
      const canAccess = await this.communitiesService.canAccessChannel(
        message.channelId,
        req.user.id,
      );
      if (!canAccess) {
        throw new ForbiddenException('You do not have access to this message');
      }
    } else if (message.conversationId) {
      const isParticipant = await this.dmService.isParticipant(
        message.conversationId,
        req.user.id,
      );
      if (!isParticipant) {
        throw new ForbiddenException('You do not have access to this message');
      }
    }
    
    return { message };
  }

  /**
   * Update message status.
   * PATCH /messages/:id/status
   * 
   * SECURITY: Validates that the user has access to this message
   */
  @Patch(':id/status')
  async updateStatus(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { status: MessageStatus },
  ) {
    // SECURITY: Pass userId for authorization check
    const message = await this.messagesService.updateStatus(id, body.status, req.user.id);
    return { message };
  }

  /**
   * Edit a message.
   * PATCH /messages/:id
   */
  @Patch(':id')
  async editMessage(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { encryptedEnvelope: string },
  ) {
    const message = await this.messagesService.edit(
      id,
      req.user.id,
      body.encryptedEnvelope,
    );
    return { message };
  }

  /**
   * Delete a message.
   * DELETE /messages/:id
   */
  @Delete(':id')
  async deleteMessage(@Request() req: AuthRequest, @Param('id') id: string) {
    await this.messagesService.delete(id, req.user.id);
    return { message: 'Message deleted' };
  }

  /**
   * Batch update message statuses.
   * PATCH /messages/batch/status
   * 
   * SECURITY: Validates that the user has access to all messages
   */
  @Patch('batch/status')
  async batchUpdateStatus(
    @Request() req: AuthRequest,
    @Body() body: { messageIds: string[]; status: MessageStatus },
  ) {
    // SECURITY: Pass userId for authorization check
    await this.messagesService.batchUpdateStatus(body.messageIds, body.status, req.user.id);
    return { message: 'Statuses updated' };
  }
}
