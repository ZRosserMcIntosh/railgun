import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus, Delete } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto, RecoverAccountDto, RequestPasswordResetDto, CompletePasswordResetDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimitGuard, RateLimit } from './rate-limit.guard';

interface AuthenticatedRequest {
  user: {
    id: string;
    username: string;
  };
}

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Register a new user
   * Returns recovery codes - these are ONLY shown once!
   * 
   * SECURITY: Recovery codes are never logged
   * SECURITY: Rate limited to prevent mass account creation
   */
  @Post('register')
  @RateLimit({ limit: 5, windowMs: 60000 }) // 5 registrations per minute per IP
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Login with username and password
   * 
   * SECURITY: Rate limited to prevent brute force attacks
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 60000 }) // 10 login attempts per minute per IP
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Refresh access token using refresh token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: 60000 }) // 30 refreshes per minute
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /**
   * Logout - invalidates refresh token
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: AuthenticatedRequest) {
    await this.authService.logout(req.user.id);
    return { success: true };
  }

  /**
   * Recover account using a recovery code
   * Used when user forgot their password
   * 
   * SECURITY: Recovery codes are never logged
   * SECURITY: Rate limited to prevent brute force
   */
  @Post('recover')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 300000 }) // 5 recovery attempts per 5 minutes
  async recover(@Body() dto: RecoverAccountDto) {
    return this.authService.recoverAccount(dto);
  }

  /**
   * Rotate recovery codes (authenticated)
   * Generates new codes and invalidates all existing ones
   * 
   * SECURITY: Recovery codes are never logged
   */
  @Post('recovery-codes/rotate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowMs: 60000 }) // 3 rotations per minute
  async rotateRecoveryCodes(@Request() req: AuthenticatedRequest) {
    return this.authService.rotateRecoveryCodes(req.user.id);
  }

  /**
   * ☢️ NUKE ACCOUNT ☢️
   * 
   * Military-grade account destruction:
   * - Deletes ALL messages (server-side)
   * - Deletes ALL encryption keys
   * - Deletes ALL community memberships
   * - Deletes ALL DM threads
   * - Deletes the user account itself
   * 
   * THIS IS IRREVERSIBLE. ALL DATA IS PERMANENTLY DESTROYED.
   * 
   * The server performs cryptographic shredding and multiple
   * overwrite passes on all user data before final deletion.
   * 
   * SECURITY: This endpoint is heavily rate-limited
   */
  @Delete('nuke')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 1, windowMs: 3600000 }) // 1 nuke per hour
  async nukeAccount(@Request() req: AuthenticatedRequest) {
    return this.authService.nukeAccount(req.user.id);
  }

  /**
   * Request password reset via email
   * 
   * SECURITY: Always returns success to prevent email enumeration
   * SECURITY: Rate limited to prevent abuse
   */
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowMs: 300000 }) // 3 requests per 5 minutes
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  /**
   * Complete password reset with token from email
   * 
   * SECURITY: Token is single-use and expires after 1 hour
   * SECURITY: Rate limited to prevent token brute force
   */
  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 300000 }) // 5 attempts per 5 minutes
  async completePasswordReset(@Body() dto: CompletePasswordResetDto) {
    return this.authService.completePasswordReset(dto.token, dto.newPassword);
  }
}
