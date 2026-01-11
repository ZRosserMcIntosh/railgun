import { Module, Global, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

// Re-export for backwards compatibility
export { REDIS_CLIENT } from './redis.constants';

/**
 * Mock Redis client for development when Redis is unavailable
 */
class MockRedisClient {
  private store = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();
  private lists = new Map<string, string[]>();
  private logger = new Logger('MockRedisClient');

  constructor() {
    this.logger.warn('Using in-memory mock Redis client - NOT FOR PRODUCTION');
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<string> {
    this.store.set(key, value);
    if (options?.EX) {
      setTimeout(() => this.store.delete(key), options.EX * 1000);
    }
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key) || this.sets.has(key) || this.hashes.has(key) || this.lists.has(key);
    this.store.delete(key);
    this.sets.delete(key);
    this.hashes.delete(key);
    this.lists.delete(key);
    return existed ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return (this.store.has(key) || this.sets.has(key) || this.hashes.has(key) || this.lists.has(key)) ? 1 : 0;
  }

  async expire(_key: string, _seconds: number): Promise<boolean> {
    // Mock implementation - just return true
    return true;
  }

  async incr(key: string): Promise<number> {
    const current = parseInt(this.store.get(key) || '0', 10);
    const next = current + 1;
    this.store.set(key, next.toString());
    return next;
  }

  // Set operations
  async sAdd(key: string, members: string | string[]): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    const set = this.sets.get(key)!;
    const arr = Array.isArray(members) ? members : [members];
    let added = 0;
    for (const m of arr) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    return added;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.sAdd(key, members);
  }

  async sMembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async sCard(key: string): Promise<number> {
    const set = this.sets.get(key);
    return set ? set.size : 0;
  }

  // Hash operations
  async hSet(key: string, field: string, value: string): Promise<number> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    const hash = this.hashes.get(key)!;
    const isNew = !hash.has(field);
    hash.set(field, value);
    return isNew ? 1 : 0;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    const hash = this.hashes.get(key);
    return hash?.get(field);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    const hash = this.hashes.get(key)!;
    const current = parseInt(hash.get(field) || '0', 10);
    const next = current + increment;
    hash.set(field, next.toString());
    return next;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.hIncrBy(key, field, increment);
  }

  // List operations
  async lPush(key: string, elements: string | string[]): Promise<number> {
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    const list = this.lists.get(key)!;
    const arr = Array.isArray(elements) ? elements : [elements];
    list.unshift(...arr);
    return list.length;
  }

  async lpush(key: string, ...elements: string[]): Promise<number> {
    return this.lPush(key, elements);
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) || [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    const list = this.lists.get(key);
    if (list) {
      const end = stop < 0 ? list.length + stop + 1 : stop + 1;
      this.lists.set(key, list.slice(start, end));
    }
    return 'OK';
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return this.lTrim(key, start, stop);
  }

  async lLen(key: string): Promise<number> {
    const list = this.lists.get(key);
    return list ? list.length : 0;
  }

  // Stream operations
  async xAdd(_key: string, id: string, _fields: Record<string, string>): Promise<string | null> {
    // Simple mock - just return an ID
    return id === '*' ? `${Date.now()}-0` : id;
  }

  async xRange(_key: string, _start: string, _end: string, _options?: { COUNT?: number }): Promise<Array<{ id: string; message: Record<string, string> }>> {
    return [];
  }

  async scan(_cursor: number, _options?: { MATCH?: string; COUNT?: number }): Promise<{ cursor: number; keys: string[] }> {
    return { cursor: 0, keys: [] };
  }

  multi(): MockRedisClient {
    return this;
  }

  async exec(): Promise<unknown[]> {
    return [];
  }

  async quit(): Promise<string> {
    this.store.clear();
    this.sets.clear();
    this.hashes.clear();
    this.lists.clear();
    return 'OK';
  }

  isOpen = true;
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService): Promise<RedisClientType | MockRedisClient> => {
        const logger = new Logger('RedisModule');
        const isDev = configService.get<string>('NODE_ENV') === 'development';
        
        const client = createClient({
          url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
          socket: {
            reconnectStrategy: (retries: number) => {
              if (retries > 3) {
                logger.warn('Redis: Connection failed after 3 attempts');
                return new Error('Redis connection failed');
              }
              return Math.min(retries * 100, 1000);
            },
            connectTimeout: 5000,
          },
        }) as RedisClientType;

        client.on('error', (err) => {
          if (!isDev) {
            logger.error('Redis Client Error:', err);
          }
        });

        client.on('connect', () => {
          logger.log('Redis Client Connected');
        });

        try {
          await client.connect();
          return client;
        } catch (error) {
          if (isDev) {
            logger.warn('Redis unavailable in development - using mock client');
            return new MockRedisClient() as unknown as RedisClientType;
          }
          throw error;
        }
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnModuleDestroy {
  private static client: RedisClientType | null = null;

  constructor() {
    // Store reference for cleanup
  }

  static setClient(client: RedisClientType): void {
    RedisModule.client = client;
  }

  async onModuleDestroy(): Promise<void> {
    if (RedisModule.client) {
      await RedisModule.client.quit();
    }
  }
}
