/**
 * Analytics Module - Backend service for collecting and processing analytics
 */
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { UpdateHealthService } from './update-health.service.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [RedisModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, UpdateHealthService],
  exports: [AnalyticsService, UpdateHealthService],
})
export class AnalyticsModule {}
