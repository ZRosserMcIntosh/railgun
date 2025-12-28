/**
 * Analytics Controller - HTTP endpoints for analytics
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { UpdateHealthService } from './update-health.service.js';
import type { EventBatch, UpdateHealthReport } from '@railgun/shared';

// DTO for event validation
interface EventsDto {
  events: Array<{
    name: string;
    category: string;
    userId: string;
    sessionId: string;
    timestamp: string;
    appVersion: string;
    platform: string;
    arch: string;
    channel: string;
    properties?: Record<string, string | number | boolean>;
    duration?: number;
    sequence: number;
  }>;
}

@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly updateHealthService: UpdateHealthService
  ) {}

  /**
   * POST /analytics/events
   * Receive a batch of analytics events
   */
  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  async receiveEvents(@Body() body: EventsDto): Promise<{ processed: number; errors: number }> {
    this.logger.debug(`Received ${body.events?.length || 0} events`);

    if (!body.events || !Array.isArray(body.events)) {
      return { processed: 0, errors: 0 };
    }

    // Validate and sanitize events
    const validEvents = body.events.filter((event) => {
      return (
        event.name &&
        event.userId &&
        event.sessionId &&
        event.timestamp &&
        event.appVersion
      );
    });

    return this.analyticsService.processEvents({
      events: validEvents as EventBatch['events'],
    });
  }

  /**
   * POST /analytics/health
   * Receive update health reports from clients
   */
  @Post('health')
  @HttpCode(HttpStatus.ACCEPTED)
  async receiveHealthReport(@Body() report: UpdateHealthReport): Promise<{ received: boolean }> {
    this.logger.debug(`Health report from ${report.version} on ${report.platform}`);
    await this.updateHealthService.recordHealthReport(report);
    return { received: true };
  }

  /**
   * GET /analytics/dau
   * Get daily active users (requires auth in production)
   */
  @Get('dau')
  async getDAU(@Query('date') date?: string) {
    return this.analyticsService.getDAU(date);
  }

  /**
   * GET /analytics/wau
   * Get weekly active users
   */
  @Get('wau')
  async getWAU(@Query('week') week?: string) {
    const count = await this.analyticsService.getWAU(week);
    return { week: week || 'current', count };
  }

  /**
   * GET /analytics/mau
   * Get monthly active users
   */
  @Get('mau')
  async getMAU(@Query('month') month?: string) {
    const count = await this.analyticsService.getMAU(month);
    return { month: month || 'current', count };
  }

  /**
   * GET /analytics/sessions
   * Get session metrics
   */
  @Get('sessions')
  async getSessionMetrics(@Query('date') date?: string) {
    return this.analyticsService.getSessionMetrics(date);
  }

  /**
   * GET /analytics/features/:name
   * Get feature usage metrics
   */
  @Get('features')
  async getFeatureUsage(
    @Query('name') name: string,
    @Query('date') date?: string
  ) {
    if (!name) {
      return { error: 'Feature name required' };
    }
    return this.analyticsService.getFeatureUsage(name, date);
  }

  /**
   * GET /analytics/retention
   * Get retention cohort
   */
  @Get('retention')
  async getRetention(
    @Query('cohort') cohort: string,
    @Query('days') days?: string
  ) {
    if (!cohort) {
      return { error: 'Cohort date required (YYYY-MM-DD)' };
    }
    const retention = await this.analyticsService.getRetentionCohort(
      cohort,
      days ? parseInt(days, 10) : 30
    );
    return { cohort, retention };
  }

  /**
   * GET /analytics/update-health
   * Get update health metrics for rollout monitoring
   */
  @Get('update-health')
  async getUpdateHealth(@Query('version') version?: string) {
    if (version) {
      return this.updateHealthService.getVersionHealth(version);
    }
    return this.updateHealthService.getAllVersionHealth();
  }

  /**
   * GET /analytics/rollout-status
   * Get current rollout status with health checks
   */
  @Get('rollout-status')
  async getRolloutStatus(@Query('version') version: string) {
    if (!version) {
      return { error: 'Version required' };
    }
    return this.updateHealthService.getRolloutStatus(version);
  }
}
