import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
  };
}

interface HealthCheck {
  status: 'up' | 'down' | 'degraded';
  latencyMs?: number;
  message?: string;
}

interface ReadinessResponse {
  ready: boolean;
  checks: {
    database: boolean;
    redis: boolean;
  };
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT)
    private readonly redisClient: RedisClientType | { isConnected: boolean },
  ) {}
  
  @Get()
  async check(): Promise<HealthResponse> {
    const dbCheck = await this.checkDatabase();
    const redisCheck = await this.checkRedis();
    
    // Overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (dbCheck.status === 'down' || redisCheck.status === 'down') {
      status = 'unhealthy';
    } else if (dbCheck.status === 'degraded' || redisCheck.status === 'degraded') {
      status = 'degraded';
    }
    
    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: process.uptime(),
      checks: {
        database: dbCheck,
        redis: redisCheck,
      },
    };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    const dbReady = await this.isDatabaseReady();
    const redisReady = await this.isRedisReady();
    
    return {
      ready: dbReady && redisReady,
      checks: {
        database: dbReady,
        redis: redisReady,
      },
    };
  }

  @Get('live')
  live(): { live: boolean } {
    // Liveness just checks if the process is running
    return { live: true };
  }
  
  private async checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      if (!this.dataSource.isInitialized) {
        return { status: 'down', message: 'Database not initialized' };
      }
      
      // Run a simple query
      await this.dataSource.query('SELECT 1');
      const latencyMs = Date.now() - start;
      
      // Warn if latency is high
      if (latencyMs > 1000) {
        return { status: 'degraded', latencyMs, message: 'High latency' };
      }
      
      return { status: 'up', latencyMs };
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  private async checkRedis(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      // Check if it's a mock client
      if ('isConnected' in this.redisClient) {
        // Mock client - not real Redis
        return { 
          status: 'degraded', 
          message: 'Using mock Redis (in-memory)',
          latencyMs: 0,
        };
      }
      
      // Real Redis client
      await this.redisClient.ping();
      const latencyMs = Date.now() - start;
      
      if (latencyMs > 500) {
        return { status: 'degraded', latencyMs, message: 'High latency' };
      }
      
      return { status: 'up', latencyMs };
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  private async isDatabaseReady(): Promise<boolean> {
    try {
      if (!this.dataSource.isInitialized) {
        return false;
      }
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  
  private async isRedisReady(): Promise<boolean> {
    try {
      // Mock client is always "ready" (but degraded)
      if ('isConnected' in this.redisClient) {
        return true;
      }
      await this.redisClient.ping();
      return true;
    } catch {
      return false;
    }
  }
}
