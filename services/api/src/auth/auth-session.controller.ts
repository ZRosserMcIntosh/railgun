import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthSessionService } from './auth-session.service';
import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { RateLimitGuard, RateLimit } from './rate-limit.guard';

/**
 * DTO for creating an auth session
 */
export class CreateSessionDto {
  @IsIn(['web', 'desktop'])
  clientType!: 'web' | 'desktop';
}

/**
 * DTO for completing an auth session
 */
export class CompleteSessionDto {
  @IsString()
  @IsNotEmpty()
  secret!: string;

  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  userPublicKey!: string;
}

/**
 * Response for session creation
 */
interface CreateSessionResponse {
  sessionId: string;
  qrPayload: string;
  expiresAt: string;
  pollUrl: string;
}

/**
 * Response for session status
 */
interface SessionStatusResponse {
  sessionId: string;
  status: string;
  expiresAt: string;
  ready: boolean;
}

/**
 * Response for session completion
 */
interface CompleteSessionResponse {
  success: boolean;
  message: string;
  exchangeToken: string; // One-time token to exchange for JWT
}

/**
 * DTO for exchanging session for token
 */
export class ExchangeTokenDto {
  @IsString()
  @IsNotEmpty()
  exchangeToken!: string;
}

/**
 * Response for token exchange
 */
interface TokenExchangeResponse {
  token: string;
  expiresIn: number;
}

/**
 * AuthSessionController
 * 
 * REST endpoints for QR-based authentication bridge.
 * 
 * Endpoints:
 * - POST /auth/sessions          Create new QR auth session
 * - GET  /auth/sessions/:id      Get session status (for polling)
 * - POST /auth/sessions/:id/scan Mark session as scanned (optional)
 * - POST /auth/sessions/:id/complete  Complete session with user credentials
 * - POST /auth/sessions/:id/exchange  Exchange completed session for JWT
 * - POST /auth/sessions/:id/cancel    Cancel a session
 * 
 * Flow:
 * 1. Web creates session → displays QR code
 * 2. Web polls /sessions/:id for status updates
 * 3. Mobile scans QR → calls /sessions/:id/complete
 * 4. Web sees status=completed → calls /sessions/:id/exchange for JWT
 * 
 * SECURITY: Rate limiting applied to prevent abuse
 */
@Controller('auth/sessions')
@UseGuards(RateLimitGuard)
export class AuthSessionController {
  private readonly logger = new Logger(AuthSessionController.name);

  constructor(private readonly authSessionService: AuthSessionService) {}

  /**
   * Create a new QR auth session
   * 
   * POST /auth/sessions
   * Body: { clientType: 'web' | 'desktop' }
   * Returns: { sessionId, qrPayload, expiresAt, pollUrl }
   * 
   * SECURITY: Rate limited to prevent session flooding
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 10, windowMs: 60000 }) // 10 sessions per minute per IP
  async createSession(
    @Body() dto: CreateSessionDto,
    @Req() req: Request,
  ): Promise<CreateSessionResponse> {
    const ip = this.getClientIp(req);
    const userAgent = req.get('User-Agent');

    const result = await this.authSessionService.createSession(
      dto.clientType,
      ip,
      userAgent,
    );

    this.logger.log(`Session created: ${result.sessionId} from ${ip}`);

    return {
      sessionId: result.sessionId,
      qrPayload: result.qrPayload,
      expiresAt: result.expiresAt.toISOString(),
      pollUrl: `/auth/sessions/${result.sessionId}`,
    };
  }

  /**
   * Get session status
   * 
   * GET /auth/sessions/:id
   * Returns: { sessionId, status, expiresAt, ready }
   */
  @Get(':id')
  async getSessionStatus(
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<SessionStatusResponse> {
    const result = await this.authSessionService.getSessionStatus(sessionId);

    return {
      sessionId: result.sessionId,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
      ready: result.status === 'completed',
    };
  }

  /**
   * Mark session as scanned (optional)
   * 
   * POST /auth/sessions/:id/scan
   * Returns: { success: true }
   */
  @Post(':id/scan')
  @HttpCode(HttpStatus.OK)
  async markScanned(
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<{ success: boolean }> {
    await this.authSessionService.markScanned(sessionId);
    return { success: true };
  }

  /**
   * Complete session authentication
   * Called by mobile app after scanning QR code
   * 
   * POST /auth/sessions/:id/complete
   * Body: { secret, userId, userPublicKey }
   * Returns: { success, message, exchangeToken }
   * 
   * SECURITY: The exchangeToken must be passed to the web client to exchange for JWT
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async completeSession(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: CompleteSessionDto,
    @Req() req: Request,
  ): Promise<CompleteSessionResponse> {
    const ip = this.getClientIp(req);

    const result = await this.authSessionService.completeSession(
      sessionId,
      dto.secret,
      dto.userId,
      dto.userPublicKey,
      ip,
    );

    return {
      success: true,
      message: 'Session completed successfully',
      exchangeToken: result.exchangeToken, // Pass to web client for exchange
    };
  }

  /**
   * Exchange completed session for JWT token
   * Called by web client after session is completed
   * 
   * POST /auth/sessions/:id/exchange
   * Body: { exchangeToken }
   * Returns: { token, expiresIn }
   * 
   * SECURITY: Requires one-time exchangeToken from mobile app, can only be used once
   */
  @Post(':id/exchange')
  @HttpCode(HttpStatus.OK)
  async exchangeForToken(
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: ExchangeTokenDto,
  ): Promise<TokenExchangeResponse> {
    const token = await this.authSessionService.exchangeForToken(sessionId, dto.exchangeToken);

    return {
      token,
      expiresIn: 86400, // 24 hours in seconds
    };
  }

  /**
   * Cancel a session
   * 
   * POST /auth/sessions/:id/cancel
   * Returns: { success: true }
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSession(
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<{ success: boolean }> {
    await this.authSessionService.cancelSession(sessionId);
    return { success: true };
  }

  /**
   * Extract client IP from request
   */
  private getClientIp(req: Request): string | undefined {
    const forwarded = req.get('X-Forwarded-For');
    if (forwarded) {
      return forwarded.split(',')[0]?.trim();
    }
    return req.ip;
  }
}
