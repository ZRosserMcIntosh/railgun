import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GatewayModule } from './gateway/gateway.module';
import { MessagesModule } from './messages/messages.module';
import { CommunitiesModule } from './communities/communities.module';
import { CryptoModule } from './crypto/crypto.module';
import { RedisModule } from './redis/redis.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Event Emitter (for auth session events)
    EventEmitterModule.forRoot(),

    // Redis (global)
    RedisModule,

    // Database - Supports both individual params and DATABASE_URL (Supabase/production)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        const isProduction = configService.get<string>('NODE_ENV') === 'production';
        const isDevelopment = configService.get<string>('NODE_ENV') === 'development';

        // Base config
        const baseConfig = {
          type: 'postgres' as const,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          // NEVER use synchronize in production - use migrations
          synchronize: isDevelopment && !databaseUrl,
          logging: isDevelopment ? ['error' as const, 'warn' as const, 'migration' as const] : ['error' as const],
          // Connection pool settings
          extra: {
            // SSL required for Supabase/cloud databases
            ssl: databaseUrl ? { rejectUnauthorized: false } : false,
            // Connection pool limits (Supabase free tier has limits)
            max: configService.get<number>('DATABASE_POOL_MAX', 10),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
          },
          // Retry logic for serverless/cold starts
          retryAttempts: isProduction ? 10 : 3,
          retryDelay: 3000,
        };

        // If DATABASE_URL is provided (Supabase), use it directly
        if (databaseUrl) {
          return {
            ...baseConfig,
            url: databaseUrl,
          };
        }

        // Otherwise use individual connection params (local dev)
        return {
          ...baseConfig,
          host: configService.get<string>('DATABASE_HOST', 'localhost'),
          port: configService.get<number>('DATABASE_PORT', 5432),
          username: configService.get<string>('DATABASE_USER', 'railgun'),
          password: configService.get<string>('DATABASE_PASSWORD', 'railgun_dev_password'),
          database: configService.get<string>('DATABASE_NAME', 'railgun'),
        };
      },
    }),

    // Feature modules
    HealthModule,
    AuthModule,
    UsersModule,
    GatewayModule,
    MessagesModule,
    CommunitiesModule,
    CryptoModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
