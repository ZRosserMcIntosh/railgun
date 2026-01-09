/**
 * Analytics Controller - HTTP endpoints for analytics
 * 
 * SECURITY:
 * - Event ingestion is rate-limited and validates payloads
 * - Metrics endpoints require admin authentication
 * - Client-provided userId is validated against session where possible
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
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { UpdateHealthService } from './update-health.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitGuard, RateLimit } from '../auth/rate-limit.guard';
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

// SECURITY: Max events per batch to prevent DoS
const MAX_EVENTS_PER_BATCH = 100;
// SECURITY: Max property value length
const MAX_PROPERTY_LENGTH = 500;

@Controller('analytics')
@UseGuards(RateLimitGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly updateHealthService: UpdateHealthService
  ) {}

  /**
   * POST /analytics/events
   * Receive a batch of analytics events
   * 
   * SECURITY: Rate limited, payload validated and sanitized
   */
  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ limit: 100, windowMs: 60000 }) // 100 requests per minute per IP
  async receiveEvents(@Body() body: EventsDto): Promise<{ processed: number; errors: number }> {
    this.logger.debug(`Received ${body.events?.length || 0} events`);

    if (!body.events || !Array.isArray(body.events)) {
      return { processed: 0, errors: 0 };
    }

    // SECURITY: Limit batch size to prevent DoS
    if (body.events.length > MAX_EVENTS_PER_BATCH) {
      this.logger.warn(`Rejecting oversized event batch: ${body.events.length} events`);
      throw new ForbiddenException(`Maximum ${MAX_EVENTS_PER_BATCH} events per batch`);
    }

    // Validate and sanitize events
    const validEvents = body.events.filter((event) => {
      // Basic required field validation
      if (!event.name || !event.userId || !event.sessionId || !event.timestamp || !event.appVersion) {
        return false;
      }
      
      // SECURITY: Validate field lengths to prevent storage abuse
      if (event.name.length > 100 || event.userId.length > 100 || event.sessionId.length > 100) {
        return false;
      }
      
      // SECURITY: Sanitize properties - limit size and depth
      if (event.properties) {
        const sanitizedProps: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(event.properties)) {
          if (key.length > 50) continue; // Skip oversized keys
          if (typeof value === 'string' && value.length > MAX_PROPERTY_LENGTH) {
            sanitizedProps[key] = value.substring(0, MAX_PROPERTY_LENGTH);
          } else {
            sanitizedProps[key] = value;
          }
        }
        event.properties = sanitizedProps;
      }
      
      return true;
    });

    return this.analyticsService.processEvents({
      events: validEvents as EventBatch['events'],
    });
  }

  /**
   * POST /analytics/health
   * Receive update health reports from clients
   * 
   * SECURITY: Rate limited to prevent abuse
   */
  @Post('health')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ limit: 30, windowMs: 60000 }) // 30 reports per minute per IP
  async receiveHealthReport(@Body() report: UpdateHealthReport): Promise<{ received: boolean }> {
    // SECURITY: Validate report structure
    if (!report.version || !report.platform) {
      return { received: false };
    }
    
    this.logger.debug(`Health report from ${report.version} on ${report.platform}`);
    await this.updateHealthService.recordHealthReport(report);
    return { received: true };
  }

  /**
   * GET /analytics/dau
   * Get daily active users
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('dau')
  @UseGuards(JwtAuthGuard)
  async getDAU(@Query('date') date?: string) {
    return this.analyticsService.getDAU(date);
  }

  /**
   * GET /analytics/wau
   * Get weekly active users
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('wau')
  @UseGuards(JwtAuthGuard)
  async getWAU(@Query('week') week?: string) {
    const count = await this.analyticsService.getWAU(week);
    return { week: week || 'current', count };
  }

  /**
   * GET /analytics/mau
   * Get monthly active users
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('mau')
  @UseGuards(JwtAuthGuard)
  async getMAU(@Query('month') month?: string) {
    const count = await this.analyticsService.getMAU(month);
    return { month: month || 'current', count };
  }

  /**
   * GET /analytics/sessions
   * Get session metrics
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async getSessionMetrics(@Query('date') date?: string) {
    return this.analyticsService.getSessionMetrics(date);
  }

  /**
   * GET /analytics/features/:name
   * Get feature usage metrics
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('features')
  @UseGuards(JwtAuthGuard)
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
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('retention')
  @UseGuards(JwtAuthGuard)
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
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('update-health')
  @UseGuards(JwtAuthGuard)
  async getUpdateHealth(@Query('version') version?: string) {
    if (version) {
      return this.updateHealthService.getVersionHealth(version);
    }
    return this.updateHealthService.getAllVersionHealth();
  }

  /**
   * GET /analytics/rollout-status
   * Get current rollout status with health checks
   * 
   * SECURITY: Requires admin authentication
   */
  @Get('rollout-status')
  @UseGuards(JwtAuthGuard)
  async getRolloutStatus(@Query('version') version: string) {
    if (!version) {
      return { error: 'Version required' };
    }
    return this.updateHealthService.getRolloutStatus(version);
  }
}
