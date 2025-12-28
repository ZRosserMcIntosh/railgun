/**
 * Analytics Types - Shared between client and server
 */

// Import update types from existing module to avoid duplication
import type { UpdateChannel } from './updates.types.js';

// Re-export for convenience
export type { UpdateChannel };

// ============================================================================
// Event Types
// ============================================================================

export type EventCategory =
  | 'session'
  | 'navigation'
  | 'action'
  | 'feature'
  | 'performance'
  | 'update'
  | 'conversion';

export interface AnalyticsEvent {
  /** Event name */
  name: string;
  /** Event category */
  category: EventCategory;
  /** Pseudonymized user ID */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** App version */
  appVersion: string;
  /** Platform (darwin, win32, linux, web) */
  platform: string;
  /** Architecture */
  arch: string;
  /** Update channel */
  channel: string;
  /** Event-specific properties */
  properties?: Record<string, string | number | boolean>;
  /** Duration in milliseconds */
  duration?: number;
  /** Event sequence within session */
  sequence: number;
}

export interface EventBatch {
  events: AnalyticsEvent[];
}

// ============================================================================
// Session Types
// ============================================================================

export interface SessionSummary {
  sessionId: string;
  userId: string;
  startTime: string;
  endTime: string;
  duration: number;
  eventCount: number;
  platform: string;
  appVersion: string;
  channel: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface DailyActiveUsers {
  date: string;
  count: number;
  byPlatform: Record<string, number>;
  byVersion: Record<string, number>;
}

export interface SessionMetrics {
  date: string;
  totalSessions: number;
  averageDuration: number;
  medianDuration: number;
  p95Duration: number;
  averageEventsPerSession: number;
}

export interface FeatureUsageMetrics {
  featureName: string;
  totalUsage: number;
  uniqueUsers: number;
  byVersion: Record<string, number>;
}

export interface FunnelStep {
  step: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
}

export interface FunnelMetrics {
  funnelName: string;
  period: string;
  steps: FunnelStep[];
  overallConversionRate: number;
}

export interface UpdateHealthMetrics {
  version: string;
  channel: string;
  adoptionRate: number;
  errorRate: number;
  crashRate: number;
  rolloutPercentage: number;
  healthScore: number;
}

// ============================================================================
// Update Health Report
// ============================================================================

export interface UpdateHealthReport {
  version: string;
  channel: string;
  platform: string;
  arch: string;
  machineId: string;
  errors: number;
  crashes: number;
  timestamp: string;
}

// ============================================================================
// Feature Flags Types (Analytics specific)
// ============================================================================

export interface FeatureFlagConfig {
  key: string;
  enabled: boolean;
  rolloutPercentage?: number;
  allowList?: string[];
  denyList?: string[];
  minVersion?: string;
  maxVersion?: string;
  expiresAt?: string;
  description?: string;
}

export interface AnalyticsRemoteConfig {
  version: string;
  lastUpdated: string;
  emergencyKillSwitch: boolean;
  emergencyMessage?: string;
  flags: Record<string, FeatureFlagConfig>;
  announcements?: AnalyticsAnnouncement[];
  maintenance?: AnalyticsMaintenanceWindow;
}

export interface AnalyticsAnnouncement {
  id: string;
  type: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
  dismissible: boolean;
  showOnce: boolean;
  expiresAt?: string;
}

export interface AnalyticsMaintenanceWindow {
  active: boolean;
  message: string;
  startTime: string;
  endTime: string;
  allowReadOnly: boolean;
}
