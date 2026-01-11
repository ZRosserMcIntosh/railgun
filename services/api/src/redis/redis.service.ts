/**
 * Redis Service - Wrapper around Redis client for dependency injection
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * RedisService provides a typed wrapper around the Redis client
 * for use in services that need Redis access.
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: RedisClientType
  ) {}

  /**
   * Get the underlying Redis client for direct operations
   */
  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * Check if Redis is connected
   */
  isConnected(): boolean {
    return this.client?.isOpen ?? false;
  }

  // ==================== String Operations ====================

  /**
   * Get a string value by key
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Set a string value with optional expiry
   */
  async set(key: string, value: string, expirySeconds?: number): Promise<void> {
    try {
      if (expirySeconds) {
        await this.client.set(key, value, { EX: expirySeconds });
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      this.logger.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      this.logger.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Set key expiry in seconds
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      this.logger.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  }

  // ==================== Set Operations ====================

  /**
   * Add member(s) to a set
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.client.sAdd(key, members);
    } catch (error) {
      this.logger.error(`Redis SADD error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get all members of a set
   */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.sMembers(key);
    } catch (error) {
      this.logger.error(`Redis SMEMBERS error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get the number of members in a set
   */
  async scard(key: string): Promise<number> {
    try {
      return await this.client.sCard(key);
    } catch (error) {
      this.logger.error(`Redis SCARD error for key ${key}:`, error);
      throw error;
    }
  }

  // ==================== Hash Operations ====================

  /**
   * Set a hash field
   */
  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.client.hSet(key, field, value);
    } catch (error) {
      this.logger.error(`Redis HSET error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get a hash field
   */
  async hget(key: string, field: string): Promise<string | undefined> {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      this.logger.error(`Redis HGET error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get all fields and values of a hash
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      this.logger.error(`Redis HGETALL error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Increment a hash field by integer value
   */
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    try {
      return await this.client.hIncrBy(key, field, increment);
    } catch (error) {
      this.logger.error(`Redis HINCRBY error for key ${key}:`, error);
      throw error;
    }
  }

  // ==================== List Operations ====================

  /**
   * Push element(s) to the left of a list
   */
  async lpush(key: string, ...elements: string[]): Promise<number> {
    try {
      return await this.client.lPush(key, elements);
    } catch (error) {
      this.logger.error(`Redis LPUSH error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get a range of elements from a list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      this.logger.error(`Redis LRANGE error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Trim a list to the specified range
   */
  async ltrim(key: string, start: number, stop: number): Promise<string> {
    try {
      return await this.client.lTrim(key, start, stop);
    } catch (error) {
      this.logger.error(`Redis LTRIM error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get the length of a list
   */
  async llen(key: string): Promise<number> {
    try {
      return await this.client.lLen(key);
    } catch (error) {
      this.logger.error(`Redis LLEN error for key ${key}:`, error);
      throw error;
    }
  }

  // ==================== Stream Operations ====================

  /**
   * Add to a stream
   */
  async xadd(
    key: string,
    id: string,
    fields: Record<string, string>
  ): Promise<string | null> {
    try {
      return await this.client.xAdd(key, id, fields);
    } catch (error) {
      this.logger.error(`Redis XADD error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Read from a stream
   */
  async xrange(
    key: string,
    start: string,
    end: string,
    count?: number
  ): Promise<Array<{ id: string; message: Record<string, string> }>> {
    try {
      const options = count ? { COUNT: count } : undefined;
      const result = await this.client.xRange(key, start, end, options);
      return result.map((entry) => ({
        id: entry.id,
        message: entry.message,
      }));
    } catch (error) {
      this.logger.error(`Redis XRANGE error for key ${key}:`, error);
      throw error;
    }
  }

  // ==================== Utility Operations ====================

  /**
   * Increment a key's value
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error(`Redis INCR error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Scan for keys matching a pattern
   */
  async scan(
    cursor: number,
    pattern: string,
    count?: number
  ): Promise<{ cursor: number; keys: string[] }> {
    try {
      const options: { MATCH: string; COUNT?: number } = { MATCH: pattern };
      if (count) {
        options.COUNT = count;
      }
      const result = await this.client.scan(cursor, options);
      return {
        cursor: result.cursor,
        keys: result.keys,
      };
    } catch (error) {
      this.logger.error(`Redis SCAN error:`, error);
      throw error;
    }
  }

  /**
   * Execute a transaction with multiple commands
   */
  async multi<T>(
    commands: (client: ReturnType<RedisClientType['multi']>) => void
  ): Promise<T[]> {
    try {
      const multi = this.client.multi();
      commands(multi);
      return (await multi.exec()) as T[];
    } catch (error) {
      this.logger.error(`Redis MULTI error:`, error);
      throw error;
    }
  }
}
