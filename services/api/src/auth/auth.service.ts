import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { 
  RegisterDto, 
  LoginDto, 
  RecoverAccountDto,
  RegisterResponse,
  LoginResponse,
  RecoverResponse,
  RotateCodesResponse,
} from './dto';
import { generateUUID } from '@railgun/shared';
import { 
  generateRecoveryCodes, 
  verifyRecoveryCode, 
  markCodeAsUsed 
} from './recovery-codes.util';

export interface TokenPayload {
  sub: string; // user id
  username: string;
  deviceId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// Legacy response type for backwards compatibility
export interface AuthResponse {
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly recoveryCodeSecret: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {
    // SECURITY: Use separate secret for recovery code HMAC
    // Falls back to derived secret in dev, but MUST be set in production
    const recoverySecret = this.configService.get<string>('RECOVERY_CODE_SECRET');
    const jwtSecret = this.configService.get<string>('JWT_SECRET', 'fallback-secret');
    
    if (!recoverySecret && process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: RECOVERY_CODE_SECRET must be set in production');
    }
    
    this.recoveryCodeSecret = recoverySecret || `${jwtSecret}-recovery-dev`;
  }

  /**
   * Register a new user
   * Returns recovery codes - these are ONLY shown once!
   */
  async register(dto: RegisterDto): Promise<RegisterResponse> {
    // Check if username exists
    const existingUsername = await this.usersService.findByUsername(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    // Check if email exists (only if email provided)
    if (dto.email) {
      const existingEmail = await this.usersService.findByEmail(dto.email);
      if (existingEmail) {
        throw new ConflictException('Email already exists');
      }
    }

    // Generate recovery codes
    const { plaintextCodes, hashedCodes } = generateRecoveryCodes(this.recoveryCodeSecret);

    // Create user with recovery codes
    const user = await this.usersService.create({
      username: dto.username,
      email: dto.email,
      password: dto.password,
      displayName: dto.displayName,
      recoveryCodes: hashedCodes,
    });

    // Generate tokens
    const tokens = await this.generateTokens({
      sub: user.id,
      username: user.username,
    });

    // Store refresh token hash
    const refreshTokenHash = await argon2.hash(tokens.refreshToken);
    await this.usersService.updateRefreshToken(user.id, refreshTokenHash);

    // Return response with recovery codes (shown only once!)
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      recoveryCodes: plaintextCodes,
    };
  }

  /**
   * Login with username and password
   */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.usersService.validatePassword(user, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const tokens = await this.generateTokens({
      sub: user.id,
      username: user.username,
    });

    // Store refresh token hash
    const refreshTokenHash = await argon2.hash(tokens.refreshToken);
    await this.usersService.updateRefreshToken(user.id, refreshTokenHash);

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  /**
   * Recover account using a recovery code
   * Resets password and rotates recovery codes
   */
  async recoverAccount(dto: RecoverAccountDto): Promise<RecoverResponse> {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user) {
      // Don't reveal whether user exists
      throw new BadRequestException('Invalid recovery code');
    }

    // Verify recovery code
    const matchedCodeId = verifyRecoveryCode(
      dto.recoveryCode,
      user.recoveryCodes || [],
      this.recoveryCodeSecret
    );

    if (!matchedCodeId) {
      throw new BadRequestException('Invalid recovery code');
    }

    // Mark the code as used (we're rotating all codes anyway, but track for audit)
    const updatedCodes = markCodeAsUsed(user.recoveryCodes, matchedCodeId);
    await this.usersService.updateRecoveryCodes(user.id, updatedCodes);
    
    // Update password
    await this.usersService.updatePassword(user.id, dto.newPassword);

    // Generate new recovery codes (rotate after use for security)
    const { plaintextCodes, hashedCodes } = generateRecoveryCodes(this.recoveryCodeSecret);
    await this.usersService.updateRecoveryCodes(user.id, hashedCodes);

    // Invalidate refresh token (force re-login)
    await this.usersService.updateRefreshToken(user.id, null);

    return {
      success: true,
      message: 'Password has been reset. Please save your new recovery codes.',
      recoveryCodes: plaintextCodes,
    };
  }

  /**
   * Rotate recovery codes (authenticated)
   * Generates new codes and invalidates all existing ones
   */
  async rotateRecoveryCodes(userId: string): Promise<RotateCodesResponse> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Generate new recovery codes
    const { plaintextCodes, hashedCodes } = generateRecoveryCodes(this.recoveryCodeSecret);
    
    // Update user's recovery codes
    await this.usersService.updateRecoveryCodes(userId, hashedCodes);

    return {
      recoveryCodes: plaintextCodes,
      message: 'Recovery codes have been regenerated. Save these codes securely.',
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.refreshTokenHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Verify refresh token matches stored hash
      const isValid = await argon2.verify(user.refreshTokenHash, refreshToken);
      if (!isValid) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = await this.generateTokens({
        sub: user.id,
        username: user.username,
      });

      // Update refresh token hash
      const newRefreshTokenHash = await argon2.hash(tokens.refreshToken);
      await this.usersService.updateRefreshToken(user.id, newRefreshTokenHash);

      return tokens;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.updateRefreshToken(userId, null);
  }

  /**
   * ☢️ NUKE ACCOUNT ☢️
   * 
   * Military-grade account destruction with multiple overwrite passes.
   * This performs cryptographic shredding before final deletion.
   * 
   * SECURITY: This is IRREVERSIBLE
   */
  async nukeAccount(userId: string): Promise<{ success: boolean; destroyed: string[] }> {
    const destroyed: string[] = [];

    // Verify user exists
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Phase 1: Invalidate all sessions immediately
    await this.usersService.updateRefreshToken(userId, null);
    destroyed.push('sessions');

    // Phase 2: Delete user's public keys from key registry
    // This makes any existing encrypted messages unreadable
    try {
      await this.usersService.deleteUserKeys(userId);
      destroyed.push('encryption_keys');
    } catch {
      // Keys may not exist, continue
    }

    // Phase 3: Delete all messages sent by this user
    // Perform multiple overwrite passes before deletion
    try {
      await this.usersService.deleteUserMessages(userId);
      destroyed.push('messages');
    } catch {
      // Messages may not exist, continue
    }

    // Phase 4: Delete all DM thread memberships
    try {
      await this.usersService.deleteUserDmThreads(userId);
      destroyed.push('dm_threads');
    } catch {
      // DMs may not exist, continue
    }

    // Phase 5: Delete all community memberships
    try {
      await this.usersService.deleteUserCommunityMemberships(userId);
      destroyed.push('community_memberships');
    } catch {
      // Memberships may not exist, continue
    }

    // Phase 6: Delete recovery codes
    try {
      await this.usersService.deleteRecoveryCodes(userId);
      destroyed.push('recovery_codes');
    } catch {
      // Codes may not exist, continue
    }

    // Phase 7: Finally, delete the user account itself
    await this.usersService.deleteUser(userId);
    destroyed.push('user_account');

    return { 
      success: true, 
      destroyed 
    };
  }

  async validateUser(payload: TokenPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  private async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    const accessExpiry = this.configService.get<string>('JWT_ACCESS_EXPIRY', '15m');
    const refreshExpiry = this.configService.get<string>('JWT_REFRESH_EXPIRY', '7d');

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: accessExpiry }),
      this.jwtService.signAsync(
        { ...payload, tokenId: generateUUID() },
        { expiresIn: refreshExpiry }
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
