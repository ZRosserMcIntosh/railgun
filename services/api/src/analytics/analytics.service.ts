/**
 * Analytics Service - Business logic for event processing and metrics
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type {
  AnalyticsEvent,
  EventBatch,
  DailyActiveUsers,
  SessionMetrics,
  FeatureUsageMetrics,
} from '@railgun/shared';

// Redis key prefixes
const KEYS = {
  DAU: 'analytics:dau:', // Set of user IDs per day
  WAU: 'analytics:wau:', // Set of user IDs per week
  MAU: 'analytics:mau:', // Set of user IDs per month
  SESSION: 'analytics:session:', // Session data
  EVENTS: 'analytics:events:', // Event stream
  FEATURE: 'analytics:feature:', // Feature usage counters
  PLATFORM: 'analytics:platform:', // Platform breakdown
  VERSION: 'analytics:version:', // Version breakdown
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Process a batch of analytics events
   */
  async processEvents(batch: EventBatch): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    for (const event of batch.events) {
      try {
        await this.processEvent(event);
        processed++;
      } catch (error) {
        this.logger.error(`Failed to process event: ${event.name}`, error);
        errors++;
      }
    }

    return { processed, errors };
  }

  /**
   * Process a single analytics event
   */
  private async processEvent(event: AnalyticsEvent): Promise<void> {
    const client = this.redis.getClient();
    const dateKey = this.getDateKey(event.timestamp);
    const weekKey = this.getWeekKey(event.timestamp);
    const monthKey = this.getMonthKey(event.timestamp);

    // Track DAU/WAU/MAU
    await Promise.all([
      client.sAdd(`${KEYS.DAU}${dateKey}`, event.userId),
      client.sAdd(`${KEYS.WAU}${weekKey}`, event.userId),
      client.sAdd(`${KEYS.MAU}${monthKey}`, event.userId),
    ]);

    // Set expiry on DAU/WAU/MAU keys
    await Promise.all([
      client.expire(`${KEYS.DAU}${dateKey}`, 90 * 24 * 60 * 60), // 90 days
      client.expire(`${KEYS.WAU}${weekKey}`, 90 * 24 * 60 * 60),
      client.expire(`${KEYS.MAU}${monthKey}`, 365 * 24 * 60 * 60), // 1 year
    ]);

    // Track platform breakdown
    await client.hIncrBy(`${KEYS.PLATFORM}${dateKey}`, event.platform, 1);
    await client.expire(`${KEYS.PLATFORM}${dateKey}`, 90 * 24 * 60 * 60);

    // Track version breakdown
    await client.hIncrBy(`${KEYS.VERSION}${dateKey}`, event.appVersion, 1);
    await client.expire(`${KEYS.VERSION}${dateKey}`, 90 * 24 * 60 * 60);

    // Handle session events
    if (event.category === 'session') {
      await this.processSessionEvent(event);
    }

    // Handle feature events
    if (event.category === 'feature') {
      await this.processFeatureEvent(event);
    }

    // Store event in stream (for detailed analysis)
    await this.storeEvent(event);
  }

  /**
   * Process session-related events
   */
  private async processSessionEvent(event: AnalyticsEvent): Promise<void> {
    const client = this.redis.getClient();
    const sessionKey = `${KEYS.SESSION}${event.sessionId}`;

    if (event.name === 'session_start') {
      await client.hSet(sessionKey, {
        userId: event.userId,
        startTime: event.timestamp,
        platform: event.platform,
        appVersion: event.appVersion,
        channel: event.channel,
        eventCount: '0',
      });
      await client.expire(sessionKey, 24 * 60 * 60); // 24 hours
    } else if (event.name === 'session_end') {
      await client.hSet(sessionKey, {
        endTime: event.timestamp,
        duration: String(event.duration || 0),
        eventCount: String(event.properties?.event_count || 0),
      });

      // Track session duration histogram
      if (event.duration) {
        const dateKey = this.getDateKey(event.timestamp);
        const bucket = this.getDurationBucket(event.duration);
        await client.hIncrBy(`analytics:session_duration:${dateKey}`, bucket, 1);
      }
    } else if (event.name === 'session_heartbeat') {
      await client.hIncrBy(sessionKey, 'eventCount', 1);
      await client.hSet(sessionKey, 'lastActivity', event.timestamp);
    }
  }

  /**
   * Process feature usage events
   */
  private async processFeatureEvent(event: AnalyticsEvent): Promise<void> {
    const client = this.redis.getClient();
    const dateKey = this.getDateKey(event.timestamp);
    const featureName = event.name.replace('feature_', '');

    // Increment total usage
    await client.hIncrBy(`${KEYS.FEATURE}${dateKey}`, featureName, 1);
    await client.expire(`${KEYS.FEATURE}${dateKey}`, 90 * 24 * 60 * 60);

    // Track unique users per feature
    await client.sAdd(`${KEYS.FEATURE}${dateKey}:${featureName}:users`, event.userId);
    await client.expire(`${KEYS.FEATURE}${dateKey}:${featureName}:users`, 90 * 24 * 60 * 60);

    // Track by version
    await client.hIncrBy(`${KEYS.FEATURE}${dateKey}:${featureName}:version`, event.appVersion, 1);
    await client.expire(`${KEYS.FEATURE}${dateKey}:${featureName}:version`, 90 * 24 * 60 * 60);
  }

  /**
   * Store event for detailed analysis
   */
  private async storeEvent(event: AnalyticsEvent): Promise<void> {
    const client = this.redis.getClient();
    const streamKey = `${KEYS.EVENTS}stream`;

    // Use Redis streams for event storage with approximate trimming
    await client.xAdd(streamKey, '*', { data: JSON.stringify(event) });
    // Trim to keep approximately the last 100k events
    await client.xTrim(streamKey, 'MAXLEN', 100000, { strategyModifier: '~' });
  }

  /**
   * Get Daily Active Users
   */
  async getDAU(date?: string): Promise<DailyActiveUsers> {
    const client = this.redis.getClient();
    const dateKey = date || this.getDateKey(new Date().toISOString());

    const [count, byPlatform, byVersion] = await Promise.all([
      client.sCard(`${KEYS.DAU}${dateKey}`),
      client.hGetAll(`${KEYS.PLATFORM}${dateKey}`),
      client.hGetAll(`${KEYS.VERSION}${dateKey}`),
    ]);

    return {
      date: dateKey,
      count: count || 0,
      byPlatform: this.parseHashToNumbers(byPlatform),
      byVersion: this.parseHashToNumbers(byVersion),
    };
  }

  /**
   * Get Weekly Active Users
   */
  async getWAU(weekKey?: string): Promise<number> {
    const client = this.redis.getClient();
    const key = weekKey || this.getWeekKey(new Date().toISOString());
    return (await client.sCard(`${KEYS.WAU}${key}`)) || 0;
  }

  /**
   * Get Monthly Active Users
   */
  async getMAU(monthKey?: string): Promise<number> {
    const client = this.redis.getClient();
    const key = monthKey || this.getMonthKey(new Date().toISOString());
    return (await client.sCard(`${KEYS.MAU}${key}`)) || 0;
  }

  /**
   * Get session metrics for a date
   */
  async getSessionMetrics(date?: string): Promise<SessionMetrics> {
    const client = this.redis.getClient();
    const dateKey = date || this.getDateKey(new Date().toISOString());

    const durationBuckets = await client.hGetAll(`analytics:session_duration:${dateKey}`);
    const buckets = this.parseHashToNumbers(durationBuckets);

    // Calculate metrics from buckets
    let totalSessions = 0;
    let totalDuration = 0;
    const durations: number[] = [];

    for (const [bucket, count] of Object.entries(buckets)) {
      totalSessions += count;
      const midpoint = this.getBucketMidpoint(bucket);
      totalDuration += midpoint * count;
      for (let i = 0; i < count; i++) {
        durations.push(midpoint);
      }
    }

    durations.sort((a, b) => a - b);
    const medianDuration = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;
    const p95Index = Math.floor(durations.length * 0.95);
    const p95Duration = durations.length > 0 ? durations[p95Index] || durations[durations.length - 1] : 0;

    return {
      date: dateKey,
      totalSessions,
      averageDuration: totalSessions > 0 ? Math.round(totalDuration / totalSessions) : 0,
      medianDuration,
      p95Duration,
      averageEventsPerSession: 0, // Would need additional tracking
    };
  }

  /**
   * Get feature usage metrics
   */
  async getFeatureUsage(featureName: string, date?: string): Promise<FeatureUsageMetrics> {
    const client = this.redis.getClient();
    const dateKey = date || this.getDateKey(new Date().toISOString());

    const [totalUsage, uniqueUsers, byVersion] = await Promise.all([
      client.hGet(`${KEYS.FEATURE}${dateKey}`, featureName),
      client.sCard(`${KEYS.FEATURE}${dateKey}:${featureName}:users`),
      client.hGetAll(`${KEYS.FEATURE}${dateKey}:${featureName}:version`),
    ]);

    return {
      featureName,
      totalUsage: parseInt(totalUsage || '0', 10),
      uniqueUsers: uniqueUsers || 0,
      byVersion: this.parseHashToNumbers(byVersion),
    };
  }

  /**
   * Get retention cohort data
   */
  async getRetentionCohort(cohortDate: string, days: number = 30): Promise<number[]> {
    const client = this.redis.getClient();
    const cohortUsers = await client.sMembers(`${KEYS.DAU}${cohortDate}`);
    
    if (cohortUsers.length === 0) {
      return [];
    }

    const retention: number[] = [];
    const cohortSet = new Set(cohortUsers);

    for (let d = 0; d < days; d++) {
      const checkDate = new Date(cohortDate);
      checkDate.setDate(checkDate.getDate() + d);
      const dateKey = this.getDateKey(checkDate.toISOString());

      const activeUsers = await client.sMembers(`${KEYS.DAU}${dateKey}`);
      const retained = activeUsers.filter((u) => cohortSet.has(u)).length;
      retention.push(Math.round((retained / cohortUsers.length) * 100));
    }

    return retention;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getDateKey(timestamp: string): string {
    return timestamp.split('T')[0]; // YYYY-MM-DD
  }

  private getWeekKey(timestamp: string): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const week = this.getWeekNumber(date);
    return `${year}-W${week.toString().padStart(2, '0')}`;
  }

  private getMonthKey(timestamp: string): string {
    return timestamp.substring(0, 7); // YYYY-MM
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private getDurationBucket(durationMs: number): string {
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 30) return '0-30s';
    if (seconds < 60) return '30s-1m';
    if (seconds < 300) return '1-5m';
    if (seconds < 900) return '5-15m';
    if (seconds < 1800) return '15-30m';
    if (seconds < 3600) return '30m-1h';
    if (seconds < 7200) return '1-2h';
    return '2h+';
  }

  private getBucketMidpoint(bucket: string): number {
    const midpoints: Record<string, number> = {
      '0-30s': 15000,
      '30s-1m': 45000,
      '1-5m': 180000,
      '5-15m': 600000,
      '15-30m': 1350000,
      '30m-1h': 2700000,
      '1-2h': 5400000,
      '2h+': 10800000,
    };
    return midpoints[bucket] || 0;
  }

  private parseHashToNumbers(hash: Record<string, string> | null): Record<string, number> {
    if (!hash) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(hash)) {
      result[key] = parseInt(value, 10) || 0;
    }
    return result;
  }
}
