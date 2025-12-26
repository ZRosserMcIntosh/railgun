import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus, Delete } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto, RecoverAccountDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface AuthenticatedRequest {
  user: {
    id: string;
    username: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Register a new user
   * Returns recovery codes - these are ONLY shown once!
   * 
   * SECURITY: Recovery codes are never logged
   */
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Login with username and password
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Refresh access token using refresh token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
   */
  @Post('recover')
  @HttpCode(HttpStatus.OK)
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
  async nukeAccount(@Request() req: AuthenticatedRequest) {
    return this.authService.nukeAccount(req.user.id);
  }
}
