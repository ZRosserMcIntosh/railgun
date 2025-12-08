import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { RegisterDto, LoginDto } from './dto';
import { generateUUID } from '@railgun/shared';

export interface TokenPayload {
  sub: string; // user id
  username: string;
  deviceId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    // Check if username exists
    const existingUsername = await this.usersService.findByUsername(dto.username);
    if (existingUsername) {
      throw new ConflictException('Username already exists');
    }

    // Check if email exists
    const existingEmail = await this.usersService.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // Create user
    const user = await this.usersService.create({
      username: dto.username,
      email: dto.email,
      password: dto.password,
      displayName: dto.displayName,
    });

    // Generate tokens
    const tokens = await this.generateTokens({
      sub: user.id,
      username: user.username,
    });

    // Store refresh token hash
    const refreshTokenHash = await argon2.hash(tokens.refreshToken);
    await this.usersService.updateRefreshToken(user.id, refreshTokenHash);

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      ...tokens,
    };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
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
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      ...tokens,
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
