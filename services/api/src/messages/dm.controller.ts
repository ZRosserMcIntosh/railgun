import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { DmService, DmConversationDto } from './dm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitGuard, RateLimit } from '../auth/rate-limit.guard';
import { UserEntity } from '../users/user.entity';

interface AuthRequest extends Request {
  user: UserEntity;
}

interface StartDmByUsernameDto {
  username: string;
}

interface StartDmByUserIdDto {
  userId: string;
}

@Controller('dms')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class DmController {
  constructor(private readonly dmService: DmService) {}

  /**
   * Get all DM conversations for the current user.
   * GET /dms
   */
  @Get()
  async getDms(
    @Request() req: AuthRequest,
  ): Promise<{ conversations: DmConversationDto[] }> {
    const conversations = await this.dmService.getUserDms(req.user.id);
    return { conversations };
  }

  /**
   * Start a DM with another user by username.
   * POST /dms
   * 
   * Rate limited to prevent spam/abuse.
   */
  @Post()
  @RateLimit({ limit: 20, windowMs: 60000 }) // 20 DM starts per minute
  async startDm(
    @Request() req: AuthRequest,
    @Body() body: StartDmByUsernameDto,
  ): Promise<{
    conversationId: string;
    peerId: string;
    isNew: boolean;
  }> {
    return this.dmService.startDm(req.user.id, body.username);
  }

  /**
   * Start a DM with another user by user ID.
   * POST /dms/by-id
   * 
   * Rate limited to prevent spam/abuse.
   */
  @Post('by-id')
  @RateLimit({ limit: 20, windowMs: 60000 }) // 20 DM starts per minute
  async startDmById(
    @Request() req: AuthRequest,
    @Body() body: StartDmByUserIdDto,
  ): Promise<{
    conversationId: string;
    peerId: string;
    isNew: boolean;
  }> {
    return this.dmService.startDmByUserId(req.user.id, body.userId);
  }
}
