import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';

/** Rate limit metadata key */
export const RATE_LIMIT_KEY = 'rateLimit';

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Optional: separate key prefix for different rate limit buckets */
  prefix?: string;
}

/** Decorator to set rate limit on a route */
export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);

/** In-memory rate limit store (fallback) */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly memoryStore = new Map<string, RateLimitEntry>();
  private useRedis = false;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {
    // Clean up expired memory entries every minute (fallback)
    setInterval(() => this.cleanupMemory(), 60000);
  }

  async onModuleInit(): Promise<void> {
    try {
      // Test Redis connection
      await this.redis.ping();
      this.useRedis = true;
      this.logger.log('Rate limiter using Redis store');
    } catch {
      this.logger.warn('Redis unavailable - falling back to in-memory rate limiting');
      this.useRedis = false;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // If no rate limit configured, allow
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const key = this.getKey(request, context, config.prefix);

    try {
      if (this.useRedis) {
        return await this.checkRedisLimit(key, config);
      } else {
        return this.checkMemoryLimit(key, config);
      }
    } catch (error) {
      // On Redis error, fall back to memory store
      this.logger.error('Redis rate limit check failed, using memory fallback:', error);
      return this.checkMemoryLimit(key, config);
    }
  }

  private async checkRedisLimit(key: string, config: RateLimitConfig): Promise<boolean> {
    const now = Date.now();
    const windowKey = `ratelimit:${key}:${Math.floor(now / config.windowMs)}`;

    // Atomic increment with TTL
    const count = await this.redis.incr(windowKey);
    
    // Set expiry on first request in window
    if (count === 1) {
      // Set TTL slightly longer than window to avoid edge cases
      await this.redis.expire(windowKey, Math.ceil(config.windowMs / 1000) + 1);
    }

    if (count > config.limit) {
      const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
      const retryAfter = Math.ceil((windowStart + config.windowMs - now) / 1000);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests. Please try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private checkMemoryLimit(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    let entry = this.memoryStore.get(key);

    // Create new entry if doesn't exist or window expired
    if (!entry || now > entry.resetAt) {
      entry = {
        count: 0,
        resetAt: now + config.windowMs,
      };
      this.memoryStore.set(key, entry);
    }

    entry.count++;

    // Check if over limit
    if (entry.count > config.limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests. Please try again later.',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getKey(request: any, _context: ExecutionContext, prefix?: string): string {
    // Use user ID if authenticated, otherwise IP
    const userId = request.user?.id;
    const ip = request.ip || request.connection?.remoteAddress || 'unknown';
    const path = request.route?.path || request.url;
    const keyPrefix = prefix || 'default';
    
    return userId 
      ? `${keyPrefix}:user:${userId}:${path}` 
      : `${keyPrefix}:ip:${ip}:${path}`;
  }

  private cleanupMemory(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryStore.entries()) {
      if (now > entry.resetAt) {
        this.memoryStore.delete(key);
      }
    }
  }
}
