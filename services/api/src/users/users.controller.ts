import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitGuard, RateLimit } from '../auth/rate-limit.guard';

/** Public user profile - safe to expose */
export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  presence: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get current authenticated user.
   * GET /users/me
   */
  @Get('me')
  async getCurrentUser(@Request() req: any): Promise<{ user: UserProfile }> {
    const userId = req.user.sub; // JWT payload contains user ID in 'sub' field
    const user = await this.usersService.findById(userId);
    
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        presence: user.presence,
      },
    };
  }

  /**
   * Search users by username prefix.
   * GET /users/search?query=<string>
   * 
   * Rate limited to prevent enumeration attacks.
   */
  @Get('search')
  @RateLimit({ limit: 10, windowMs: 60000 }) // 10 requests per minute
  async searchUsers(
    @Query('query') query: string,
  ): Promise<{ users: UserProfile[] }> {
    if (!query || query.length < 2) {
      throw new BadRequestException('Query must be at least 2 characters');
    }

    if (query.length > 32) {
      throw new BadRequestException('Query too long');
    }

    const users = await this.usersService.searchByUsername(query, 10);
    
    return {
      users: users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        presence: user.presence,
      })),
    };
  }

  /**
   * Get user by username.
   * GET /users/by-username/:username
   */
  @Get('by-username/:username')
  @RateLimit({ limit: 30, windowMs: 60000 }) // 30 requests per minute
  async getUserByUsername(
    @Param('username') username: string,
  ): Promise<{ user: UserProfile }> {
    const user = await this.usersService.findByUsername(username);
    
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        presence: user.presence,
      },
    };
  }

  /**
   * Get user by ID.
   * GET /users/:id
   */
  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<{ user: UserProfile }> {
    const user = await this.usersService.findById(id);
    
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        presence: user.presence,
      },
    };
  }
}
