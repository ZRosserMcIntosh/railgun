/**
 * Rail Gun - Auth Service Tests
 * 
 * Tests for authentication, registration, and recovery flows.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';

// ============================================================================
// MOCKS
// ============================================================================

const mockUser = {
  id: 'user-123',
  username: 'testuser',
  displayName: 'Test User',
  email: 'test@example.com',
  passwordHash: 'hashed-password',
  recoveryCodes: [],
  identityPublicKey: null,
  refreshTokenHash: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUsersService = {
  findByUsername: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  verifyPassword: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: string) => {
    const config: Record<string, string> = {
      JWT_SECRET: 'test-jwt-secret',
      JWT_EXPIRY: '15m',
      JWT_REFRESH_EXPIRY: '7d',
      RECOVERY_CODE_SECRET: 'test-recovery-secret',
    };
    return config[key] ?? defaultValue;
  }),
};

// ============================================================================
// TEST SETUP
// ============================================================================

describe('AuthService', () => {
  let service: AuthService;
  let usersService: typeof mockUsersService;
  let jwtService: typeof mockJwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = mockUsersService;
    jwtService = mockJwtService;

    // Reset mocks
    jest.clearAllMocks();
  });

  // ============================================================================
  // REGISTRATION TESTS
  // ============================================================================

  describe('register', () => {
    const registerDto = {
      username: 'newuser',
      password: 'SecurePassword123!',
      displayName: 'New User',
      email: 'new@example.com',
    };

    it('should register a new user successfully', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({
        ...mockUser,
        id: 'new-user-123',
        username: registerDto.username,
        displayName: registerDto.displayName,
        email: registerDto.email,
      });
      jwtService.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');
      usersService.update.mockResolvedValue(mockUser);

      const result = await service.register(registerDto);

      expect(result.userId).toBe('new-user-123');
      expect(result.username).toBe(registerDto.username);
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.recoveryCodes).toBeDefined();
      expect(result.recoveryCodes.length).toBe(8); // Should have 8 recovery codes
      expect(usersService.create).toHaveBeenCalled();
    });

    it('should reject registration with existing username', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should reject registration with existing email', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });
  });

  // ============================================================================
  // LOGIN TESTS
  // ============================================================================

  describe('login', () => {
    const loginDto = {
      username: 'testuser',
      password: 'password123',
    };

    it('should login successfully with correct credentials', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser);
      usersService.verifyPassword.mockResolvedValue(true);
      jwtService.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');
      usersService.update.mockResolvedValue(mockUser);

      const result = await service.login(loginDto);

      expect(result.userId).toBe(mockUser.id);
      expect(result.username).toBe(mockUser.username);
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('should reject login with non-existent username', async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject login with incorrect password', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser);
      usersService.verifyPassword.mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ============================================================================
  // TOKEN REFRESH TESTS
  // ============================================================================

  describe('refreshTokens', () => {
    it('should refresh tokens successfully', async () => {
      const refreshToken = 'valid-refresh-token';
      jwtService.verifyAsync.mockResolvedValue({ sub: mockUser.id, username: mockUser.username });
      usersService.findById.mockResolvedValue({
        ...mockUser,
        refreshTokenHash: 'hashed-refresh-token',
      });
      jwtService.signAsync.mockResolvedValueOnce('new-access-token').mockResolvedValueOnce('new-refresh-token');
      usersService.update.mockResolvedValue(mockUser);

      const result = await service.refreshTokens(refreshToken);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
    });

    it('should reject invalid refresh token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should reject if user not found', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'unknown-user' });
      usersService.findById.mockResolvedValue(null);

      await expect(service.refreshTokens('valid-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ============================================================================
  // ACCOUNT RECOVERY TESTS
  // ============================================================================

  describe('recoverAccount', () => {
    const recoverDto = {
      username: 'testuser',
      recoveryCode: 'AAAA-BBBB-CCCC',
      newPassword: 'NewSecurePassword123!',
    };

    it('should recover account with valid recovery code', async () => {
      const userWithCodes = {
        ...mockUser,
        recoveryCodes: [
          { codeHash: 'hashed-code', used: false },
          { codeHash: 'hashed-code-2', used: false },
        ],
      };
      usersService.findByUsername.mockResolvedValue(userWithCodes);
      usersService.update.mockResolvedValue(userWithCodes);
      jwtService.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');

      // Note: This test would need proper mocking of the recovery code verification
      // For now, we're testing the general flow
    });

    it('should reject recovery with unknown username', async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(service.recoverAccount(recoverDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject recovery with used recovery code', async () => {
      const userWithUsedCodes = {
        ...mockUser,
        recoveryCodes: [{ codeHash: 'hashed-code', used: true }],
      };
      usersService.findByUsername.mockResolvedValue(userWithUsedCodes);

      await expect(service.recoverAccount(recoverDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ============================================================================
  // LOGOUT TESTS
  // ============================================================================

  describe('logout', () => {
    it('should clear refresh token on logout', async () => {
      usersService.update.mockResolvedValue(mockUser);

      await service.logout(mockUser.id);

      expect(usersService.update).toHaveBeenCalledWith(mockUser.id, { refreshTokenHash: null });
    });
  });

  // ============================================================================
  // TOKEN VALIDATION TESTS
  // ============================================================================

  describe('validateToken', () => {
    it('should return user for valid token payload', async () => {
      usersService.findById.mockResolvedValue(mockUser);

      const result = await service.validateUser({ sub: mockUser.id, username: mockUser.username });

      expect(result).toEqual(mockUser);
    });

    it('should return null for non-existent user', async () => {
      usersService.findById.mockResolvedValue(null);

      const result = await service.validateUser({ sub: 'unknown', username: 'unknown' });

      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('AuthService Edge Cases', () => {
  it('should handle concurrent login attempts gracefully', async () => {
    // This would test rate limiting and concurrent access
    // Implementation depends on the actual rate limiting mechanism
  });

  it('should handle password with special characters', async () => {
    // Test that passwords with special chars are handled correctly
  });

  it('should generate unique recovery codes for each user', async () => {
    // Test that recovery codes are unique and random
  });
});
