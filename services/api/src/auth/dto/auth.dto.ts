import { IsString, IsEmail, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { VALIDATION } from '@railgun/shared';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(VALIDATION.USERNAME, {
    message: 'Username must be 3-32 characters, alphanumeric and underscores only',
  })
  username!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;
}

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
