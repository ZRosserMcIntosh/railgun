import { IsString, IsEmail, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { VALIDATION } from '@railgun/shared';

/**
 * Registration DTO
 * Email and phone are OPTIONAL - only username and password required
 */
export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(VALIDATION.USERNAME, {
    message: 'Username must be 3-32 characters, alphanumeric and underscores only',
  })
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;
}

/**
 * Login DTO
 * Only username and password required
 */
export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

/**
 * Account Recovery DTO
 * Used when user forgot their password and has a recovery code
 */
export class RecoverAccountDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  username!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(20)
  recoveryCode!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

/**
 * Response types
 */
export interface AuthUserResponse {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterResponse {
  user: AuthUserResponse;
  tokens: AuthTokensResponse;
  recoveryCodes: string[];
}

export interface LoginResponse {
  user: AuthUserResponse;
  tokens: AuthTokensResponse;
}

export interface RecoverResponse {
  success: boolean;
  message: string;
  recoveryCodes?: string[]; // New codes if rotated
}

export interface RotateCodesResponse {
  recoveryCodes: string[];
  message: string;
}
