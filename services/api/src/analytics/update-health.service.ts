/**
 * Update Health Service - Monitor rollout health and trigger automatic halts
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import type { UpdateHealthReport, UpdateHealthMetrics } from '@railgun/shared';

// Thresholds for automatic rollout halt
const ERROR_RATE_THRESHOLD = 5; // 5% error rate
const CRASH_RATE_THRESHOLD = 1; // 1% crash rate
const MIN_SAMPLES = 100; // Minimum samples before enforcing thresholds

// Redis keys
const KEYS = {
  HEALTH_REPORTS: 'update:health:',
  ROLLOUT_STATUS: 'update:rollout:',
  VERSION_ERRORS: 'update:errors:',
  VERSION_CRASHES: 'update:crashes:',
  VERSION_INSTALLS: 'update:installs:',
};

export interface RolloutStatus {
  version: string;
  channel: string;
  rolloutPercentage: number;
  status: 'active' | 'paused' | 'halted' | 'complete';
  startedAt: string;
  totalInstalls: number;
  errorRate: number;
  crashRate: number;
  healthScore: number;
  haltReason?: string;
}

@Injectable()
export class UpdateHealthService {
  private readonly logger = new Logger(UpdateHealthService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Record a health report from a client
   */
  async recordHealthReport(report: UpdateHealthReport): Promise<void> {
    const client = this.redis.getClient();
    const versionKey = report.version.replace(/\./g, '_');

    // Validate and convert error/crash counts to safe integers
    const errors = Math.max(0, Number.parseInt(String(report.errors), 10) || 0);
    const crashes = Math.max(0, Number.parseInt(String(report.crashes), 10) || 0);

    // Increment counters with validated values
    try {
      await Promise.all([
        client.hIncrBy(`${KEYS.VERSION_INSTALLS}${versionKey}`, 'total', 1),
        client.hIncrBy(`${KEYS.VERSION_INSTALLS}${versionKey}`, report.platform, 1),
        client.hIncrBy(`${KEYS.VERSION_ERRORS}${versionKey}`, 'total', errors),
        client.hIncrBy(`${KEYS.VERSION_CRASHES}${versionKey}`, 'total', crashes),
      ]);
    } catch (error) {
      this.logger.error(
        `Failed to record health metrics for version ${report.version}: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
      throw error;
    }

    // Store individual report for detailed analysis
    await client.lPush(
      `${KEYS.HEALTH_REPORTS}${versionKey}`,
      JSON.stringify({
        ...report,
        receivedAt: new Date().toISOString(),
      })
    );

    // Trim to last 10000 reports
    await client.lTrim(`${KEYS.HEALTH_REPORTS}${versionKey}`, 0, 9999);

    // Set expiry (90 days)
    const expiry = 90 * 24 * 60 * 60;
    await Promise.all([
      client.expire(`${KEYS.VERSION_INSTALLS}${versionKey}`, expiry),
      client.expire(`${KEYS.VERSION_ERRORS}${versionKey}`, expiry),
      client.expire(`${KEYS.VERSION_CRASHES}${versionKey}`, expiry),
      client.expire(`${KEYS.HEALTH_REPORTS}${versionKey}`, expiry),
    ]);

    // Check if we should halt rollout
    await this.checkRolloutHealth(report.version);
  }

  /**
   * Check rollout health and potentially halt
   */
  private async checkRolloutHealth(version: string): Promise<void> {
    const health = await this.getVersionHealth(version);

    if (health.totalInstalls < MIN_SAMPLES) {
      return; // Not enough data yet
    }

    const shouldHalt =
      health.errorRate > ERROR_RATE_THRESHOLD ||
      health.crashRate > CRASH_RATE_THRESHOLD;

    if (shouldHalt) {
      await this.haltRollout(
        version,
        health.errorRate > ERROR_RATE_THRESHOLD
          ? `Error rate ${health.errorRate.toFixed(2)}% exceeds threshold`
          : `Crash rate ${health.crashRate.toFixed(2)}% exceeds threshold`
      );
    }
  }

  /**
   * Get health metrics for a version
   */
  async getVersionHealth(version: string): Promise<UpdateHealthMetrics & { totalInstalls: number }> {
    const client = this.redis.getClient();
    const versionKey = version.replace(/\./g, '_');

    const [installs, errors, crashes, rollout] = await Promise.all([
      client.hGetAll(`${KEYS.VERSION_INSTALLS}${versionKey}`),
      client.hGetAll(`${KEYS.VERSION_ERRORS}${versionKey}`),
      client.hGetAll(`${KEYS.VERSION_CRASHES}${versionKey}`),
      client.hGetAll(`${KEYS.ROLLOUT_STATUS}${versionKey}`),
    ]);

    const totalInstalls = parseInt(installs?.total || '0', 10);
    const totalErrors = parseInt(errors?.total || '0', 10);
    const totalCrashes = parseInt(crashes?.total || '0', 10);

    const errorRate = totalInstalls > 0 ? (totalErrors / totalInstalls) * 100 : 0;
    const crashRate = totalInstalls > 0 ? (totalCrashes / totalInstalls) * 100 : 0;

    // Calculate health score (0-100)
    // Starts at 100, decreases with error/crash rates
    let healthScore = 100;
    healthScore -= errorRate * 2; // Each 1% error rate = -2 points
    healthScore -= crashRate * 10; // Each 1% crash rate = -10 points
    healthScore = Math.max(0, Math.min(100, healthScore));

    return {
      version,
      channel: rollout?.channel || 'unknown',
      adoptionRate: 0, // Would need total user base to calculate
      errorRate,
      crashRate,
      rolloutPercentage: parseInt(rollout?.percentage || '0', 10),
      healthScore,
      totalInstalls,
    };
  }

  /**
   * Get health metrics for all versions
   */
  async getAllVersionHealth(): Promise<(UpdateHealthMetrics & { totalInstalls: number })[]> {
    const client = this.redis.getClient();
    const keys = await client.keys(`${KEYS.VERSION_INSTALLS}*`);

    const results: (UpdateHealthMetrics & { totalInstalls: number })[] = [];

    for (const key of keys) {
      const versionKey = key.replace(KEYS.VERSION_INSTALLS, '');
      const version = versionKey.replace(/_/g, '.');
      const health = await this.getVersionHealth(version);
      results.push(health);
    }

    return results.sort((a, b) => b.totalInstalls - a.totalInstalls);
  }

  /**
   * Get rollout status with health info
   */
  async getRolloutStatus(version: string): Promise<RolloutStatus> {
    const client = this.redis.getClient();
    const versionKey = version.replace(/\./g, '_');

    const [rollout, health] = await Promise.all([
      client.hGetAll(`${KEYS.ROLLOUT_STATUS}${versionKey}`),
      this.getVersionHealth(version),
    ]);

    return {
      version,
      channel: rollout?.channel || 'stable',
      rolloutPercentage: parseInt(rollout?.percentage || '0', 10),
      status: (rollout?.status as RolloutStatus['status']) || 'active',
      startedAt: rollout?.startedAt || new Date().toISOString(),
      totalInstalls: health.totalInstalls,
      errorRate: health.errorRate,
      crashRate: health.crashRate,
      healthScore: health.healthScore,
      haltReason: rollout?.haltReason,
    };
  }

  /**
   * Start a new rollout
   */
  async startRollout(
    version: string,
    channel: string,
    initialPercentage: number
  ): Promise<void> {
    const client = this.redis.getClient();
    const versionKey = version.replace(/\./g, '_');

    await client.hSet(`${KEYS.ROLLOUT_STATUS}${versionKey}`, {
      version,
      channel,
      percentage: initialPercentage,
      status: 'active',
      startedAt: new Date().toISOString(),
    });

    this.logger.log(`Started rollout for ${version} at ${initialPercentage}%`);
  }

  /**
   * Increase rollout percentage
   */
  async increaseRollout(version: string, newPercentage: number): Promise<boolean> {
    const client = this.redis.getClient();
    const versionKey = version.replace(/\./g, '_');

    const status = await client.hGet(`${KEYS.ROLLOUT_STATUS}${versionKey}`, 'status');
    
    if (status === 'halted') {
      this.logger.warn(`Cannot increase rollout for ${version} - rollout is halted`);
      return false;
    }

    await client.hSet(`${KEYS.ROLLOUT_STATUS}${versionKey}`, {
      percentage: newPercentage,
      lastUpdated: new Date().toISOString(),
    });

    this.logger.log(`Increased rollout for ${version} to ${newPercentage}%`);
    return true;
  }

  /**
   * Halt a rollout
   */
  async haltRollout(version: string, reason: string): Promise<void> {
    const client = this.redis.getClient();
    const versionKey = version.replace(/\./g, '_');

    await client.hSet(`${KEYS.ROLLOUT_STATUS}${versionKey}`, {
      status: 'halted',
      haltReason: reason,
      haltedAt: new Date().toISOString(),
    });

    this.logger.warn(`⚠️ HALTED rollout for ${version}: ${reason}`);

    // TODO: Emit alert to monitoring system (Slack, PagerDuty, etc.)
    // await this.alertService.sendAlert({
    //   severity: 'critical',
    //   title: `Rollout halted: ${version}`,
    //   message: reason,
    // });
  }

  /**
   * Resume a halted rollout
   */
  async resumeRollout(version: string): Promise<boolean> {
    const client = this.redis.getClient();
    const versionKey = version.replace(/\./g, '_');

    // Check current health before resuming
    const health = await this.getVersionHealth(version);
    
    if (health.errorRate > ERROR_RATE_THRESHOLD || health.crashRate > CRASH_RATE_THRESHOLD) {
      this.logger.warn(`Cannot resume rollout for ${version} - health metrics still poor`);
      return false;
    }

    await client.hSet(`${KEYS.ROLLOUT_STATUS}${versionKey}`, {
      status: 'active',
      resumedAt: new Date().toISOString(),
    });

    // Delete halt reason
    await client.hDel(`${KEYS.ROLLOUT_STATUS}${versionKey}`, ['haltReason', 'haltedAt']);

    this.logger.log(`Resumed rollout for ${version}`);
    return true;
  }
}
