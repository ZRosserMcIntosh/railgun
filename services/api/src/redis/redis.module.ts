import { Module, Global, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService): Promise<RedisClientType> => {
        const logger = new Logger('RedisModule');
        
        const client = createClient({
          url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
          socket: {
            reconnectStrategy: (retries: number) => {
              if (retries > 10) {
                logger.error('Redis: Max reconnection attempts reached');
                return new Error('Max reconnection attempts reached');
              }
              return Math.min(retries * 100, 3000);
            },
          },
        }) as RedisClientType;

        client.on('error', (err) => {
          logger.error('Redis Client Error:', err);
        });

        client.on('connect', () => {
          logger.log('Redis Client Connected');
        });

        client.on('reconnecting', () => {
          logger.warn('Redis Client Reconnecting...');
        });

        await client.connect();
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
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
