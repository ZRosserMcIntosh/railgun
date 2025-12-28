/**
 * Privacy-First Analytics for Rail Gun
 * 
 * Design Principles:
 * - Privacy by default - no PII collection
 * - Pseudonymized identifiers (hashed machine IDs)
 * - Configurable sampling and opt-out
 * - Minimal data retention
 * - Event batching for efficiency
 * - Offline support with retry
 * 
 * Metrics Captured:
 * - DAU/WAU/MAU (daily/weekly/monthly active users)
 * - Session counts and durations
 * - Feature usage events
 * - Performance metrics (latency, errors)
 * - Update adoption and health
 * - Funnel conversions
 */

import { app, ipcMain, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types - Event Schema
// ============================================================================

export type EventCategory =
  | 'session'        // Session lifecycle
  | 'navigation'     // Screen/page views
  | 'action'         // User interactions
  | 'feature'        // Feature usage
  | 'performance'    // Timing and errors
  | 'update'         // Auto-update events
  | 'conversion';    // Funnel events

export interface AnalyticsEvent {
  /** Event name (e.g., 'session_start', 'message_sent', 'conversation_opened') */
  name: string;
  /** Event category */
  category: EventCategory;
  /** Pseudonymized user ID (hashed machine ID) */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** Event timestamp (ISO 8601) */
  timestamp: string;
  /** App version */
  appVersion: string;
  /** Platform (darwin, win32, linux) */
  platform: string;
  /** Architecture (x64, arm64) */
  arch: string;
  /** Update channel (stable, beta, canary) */
  channel: string;
  /** Event-specific properties */
  properties?: Record<string, string | number | boolean>;
  /** Duration in milliseconds (for timed events) */
  duration?: number;
  /** Sequence number within session */
  sequence: number;
}

export interface SessionData {
  id: string;
  startTime: string;
  lastActivityTime: string;
  eventCount: number;
  isActive: boolean;
}

export interface AnalyticsConfig {
  /** Analytics endpoint URL */
  endpoint: string;
  /** Whether analytics is enabled */
  enabled: boolean;
  /** Sampling rate (0-1, where 1 = 100%) */
  sampleRate: number;
  /** Max events to batch before sending */
  batchSize: number;
  /** Flush interval in milliseconds */
  flushInterval: number;
  /** Heartbeat interval for session tracking */
  heartbeatInterval: number;
  /** Max offline events to retain */
  maxOfflineEvents: number;
  /** Enable debug logging */
  debug: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AnalyticsConfig = {
  endpoint: process.env.RAILGUN_ANALYTICS_URL || 'https://analytics.railgun.app',
  enabled: true,
  sampleRate: 1.0, // 100% by default
  batchSize: 50,
  flushInterval: 30000, // 30 seconds
  heartbeatInterval: 60000, // 1 minute
  maxOfflineEvents: 1000,
  debug: process.env.NODE_ENV === 'development',
};

const ANALYTICS_DIR = path.join(app.getPath('userData'), 'analytics');
const CONFIG_FILE = path.join(ANALYTICS_DIR, 'config.json');
const QUEUE_FILE = path.join(ANALYTICS_DIR, 'event-queue.json');
const CONSENT_FILE = path.join(ANALYTICS_DIR, 'consent.json');

// ============================================================================
// Analytics Client
// ============================================================================

export class AnalyticsClient {
  private config: AnalyticsConfig;
  private userId: string;
  private session: SessionData | null = null;
  private eventQueue: AnalyticsEvent[] = [];
  private sequence: number = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private userConsent: boolean = true;
  private isSampled: boolean = true;

  constructor(config?: Partial<AnalyticsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.userId = this.generateUserId();
    this.isSampled = Math.random() < this.config.sampleRate;
    
    this.ensureDirectoryExists();
    this.loadConfig();
    this.loadConsent();
    this.loadOfflineQueue();
    this.setupIPC();
  }

  /**
   * Generate pseudonymized user ID from machine ID
   */
  private generateUserId(): string {
    const machineIdFile = path.join(app.getPath('userData'), '.machine-id');
    let machineId: string;

    try {
      if (fs.existsSync(machineIdFile)) {
        machineId = fs.readFileSync(machineIdFile, 'utf-8').trim();
      } else {
        machineId = crypto.randomUUID();
        fs.writeFileSync(machineIdFile, machineId, { encoding: 'utf-8', mode: 0o600 });
      }
    } catch {
      machineId = crypto.randomUUID();
    }

    // Hash the machine ID for privacy
    return crypto.createHash('sha256')
      .update(machineId + ':analytics')
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Ensure analytics directory exists
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(ANALYTICS_DIR)) {
        fs.mkdirSync(ANALYTICS_DIR, { recursive: true, mode: 0o700 });
      }
    } catch (error) {
      console.error('[Analytics] Failed to create directory:', error);
    }
  }

  /**
   * Load persisted config
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        this.config = { ...this.config, ...saved };
      }
    } catch {
      // Use defaults
    }
  }

  /**
   * Save config
   */
  private saveConfig(): void {
    try {
      const toSave = { enabled: this.config.enabled };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Ignore
    }
  }

  /**
   * Load user consent preference
   */
  private loadConsent(): void {
    try {
      if (fs.existsSync(CONSENT_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf-8'));
        this.userConsent = data.consent ?? true;
      }
    } catch {
      this.userConsent = true;
    }
  }

  /**
   * Save user consent preference
   */
  private saveConsent(): void {
    try {
      fs.writeFileSync(
        CONSENT_FILE,
        JSON.stringify({ consent: this.userConsent, timestamp: new Date().toISOString() }),
        { encoding: 'utf-8', mode: 0o600 }
      );
    } catch {
      // Ignore
    }
  }

  /**
   * Load offline event queue
   */
  private loadOfflineQueue(): void {
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        this.eventQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
        // Trim to max size
        if (this.eventQueue.length > this.config.maxOfflineEvents) {
          this.eventQueue = this.eventQueue.slice(-this.config.maxOfflineEvents);
        }
      }
    } catch {
      this.eventQueue = [];
    }
  }

  /**
   * Save offline event queue
   */
  private saveOfflineQueue(): void {
    try {
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.eventQueue), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // Ignore
    }
  }

  /**
   * Setup IPC handlers for renderer
   */
  private setupIPC(): void {
    ipcMain.handle('analytics:track', (_, name: string, properties?: Record<string, unknown>) => {
      this.track(name, properties as Record<string, string | number | boolean>);
    });
    
    ipcMain.handle('analytics:track-screen', (_, screenName: string) => {
      this.trackScreen(screenName);
    });
    
    ipcMain.handle('analytics:track-timing', (_, name: string, duration: number, properties?: Record<string, unknown>) => {
      this.trackTiming(name, duration, properties as Record<string, string | number | boolean>);
    });
    
    ipcMain.handle('analytics:set-consent', (_, consent: boolean) => {
      this.setConsent(consent);
    });
    
    ipcMain.handle('analytics:get-consent', () => this.userConsent);
    
    ipcMain.handle('analytics:is-enabled', () => this.isEnabled());
    
    ipcMain.handle('analytics:flush', () => this.flush());
  }

  /**
   * Check if analytics is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.userConsent && this.isSampled;
  }

  /**
   * Set user consent
   */
  setConsent(consent: boolean): void {
    this.userConsent = consent;
    this.saveConsent();
    
    if (!consent) {
      // Clear data when user opts out
      this.eventQueue = [];
      this.saveOfflineQueue();
    }
  }

  /**
   * Start session tracking
   */
  startSession(): void {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    this.session = {
      id: sessionId,
      startTime: now,
      lastActivityTime: now,
      eventCount: 0,
      isActive: true,
    };
    
    this.sequence = 0;
    
    // Track session start
    this.trackEvent({
      name: 'session_start',
      category: 'session',
    });
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Start flush timer
    this.startFlushTimer();
    
    if (this.config.debug) {
      console.log('[Analytics] Session started:', sessionId);
    }
  }

  /**
   * End session tracking
   */
  endSession(): void {
    if (!this.session) return;
    
    const duration = new Date().getTime() - new Date(this.session.startTime).getTime();
    
    this.trackEvent({
      name: 'session_end',
      category: 'session',
      duration,
      properties: {
        event_count: this.session.eventCount,
      },
    });
    
    // Final flush
    this.flush();
    
    this.stopHeartbeat();
    this.stopFlushTimer();
    
    this.session = null;
    
    if (this.config.debug) {
      console.log('[Analytics] Session ended, duration:', duration);
    }
  }

  /**
   * Start heartbeat for session duration tracking
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.session) {
        this.session.lastActivityTime = new Date().toISOString();
        this.trackEvent({
          name: 'session_heartbeat',
          category: 'session',
        });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Start flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  /**
   * Stop flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Track generic event
   */
  track(name: string, properties?: Record<string, string | number | boolean>): void {
    this.trackEvent({
      name,
      category: 'action',
      properties,
    });
  }

  /**
   * Track screen/page view
   */
  trackScreen(screenName: string, properties?: Record<string, string | number | boolean>): void {
    this.trackEvent({
      name: 'screen_view',
      category: 'navigation',
      properties: {
        screen_name: screenName,
        ...properties,
      },
    });
  }

  /**
   * Track feature usage
   */
  trackFeature(featureName: string, properties?: Record<string, string | number | boolean>): void {
    this.trackEvent({
      name: `feature_${featureName}`,
      category: 'feature',
      properties,
    });
  }

  /**
   * Track timing/performance
   */
  trackTiming(name: string, duration: number, properties?: Record<string, string | number | boolean>): void {
    this.trackEvent({
      name,
      category: 'performance',
      duration,
      properties,
    });
  }

  /**
   * Track error
   */
  trackError(errorType: string, message: string, stack?: string): void {
    this.trackEvent({
      name: 'error',
      category: 'performance',
      properties: {
        error_type: errorType,
        error_message: message.substring(0, 500), // Truncate
        has_stack: !!stack,
      },
    });
  }

  /**
   * Track conversion funnel event
   */
  trackConversion(funnelName: string, step: string, properties?: Record<string, string | number | boolean>): void {
    this.trackEvent({
      name: `funnel_${funnelName}`,
      category: 'conversion',
      properties: {
        step,
        ...properties,
      },
    });
  }

  /**
   * Track update events
   */
  trackUpdate(eventName: string, properties?: Record<string, string | number | boolean>): void {
    this.trackEvent({
      name: eventName,
      category: 'update',
      properties,
    });
  }

  /**
   * Core event tracking
   */
  private trackEvent(params: {
    name: string;
    category: EventCategory;
    properties?: Record<string, string | number | boolean>;
    duration?: number;
  }): void {
    if (!this.isEnabled()) return;

    const event: AnalyticsEvent = {
      name: params.name,
      category: params.category,
      userId: this.userId,
      sessionId: this.session?.id || 'no-session',
      timestamp: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      channel: process.env.RAILGUN_UPDATE_CHANNEL || 'stable',
      properties: params.properties,
      duration: params.duration,
      sequence: this.sequence++,
    };

    this.eventQueue.push(event);
    
    if (this.session) {
      this.session.eventCount++;
      this.session.lastActivityTime = new Date().toISOString();
    }

    // Auto-flush if batch size reached
    if (this.eventQueue.length >= this.config.batchSize) {
      this.flush();
    }

    // Save queue for offline support
    if (this.eventQueue.length % 10 === 0) {
      this.saveOfflineQueue();
    }

    if (this.config.debug) {
      console.log('[Analytics] Event:', params.name, params.properties);
    }
  }

  /**
   * Flush events to server
   */
  async flush(): Promise<void> {
    if (!this.isEnabled() || this.eventQueue.length === 0) return;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];

    try {
      const success = await this.sendEvents(eventsToSend);
      
      if (!success) {
        // Re-queue events if send failed
        this.eventQueue = [...eventsToSend, ...this.eventQueue];
        // Trim to max size
        if (this.eventQueue.length > this.config.maxOfflineEvents) {
          this.eventQueue = this.eventQueue.slice(-this.config.maxOfflineEvents);
        }
      }
      
      this.saveOfflineQueue();
    } catch (error) {
      console.error('[Analytics] Flush failed:', error);
      this.eventQueue = [...eventsToSend, ...this.eventQueue];
      this.saveOfflineQueue();
    }
  }

  /**
   * Send events to analytics endpoint
   */
  private sendEvents(events: AnalyticsEvent[]): Promise<boolean> {
    return new Promise((resolve) => {
      const request = net.request({
        method: 'POST',
        url: `${this.config.endpoint}/events`,
        redirect: 'follow',
      });

      request.setHeader('Content-Type', 'application/json');
      request.setHeader('User-Agent', `RailGun/${app.getVersion()}`);

      request.on('response', (response) => {
        resolve(response.statusCode === 200 || response.statusCode === 202);
      });

      request.on('error', () => {
        resolve(false);
      });

      request.write(JSON.stringify({ events }));
      request.end();
    });
  }

  /**
   * Get debug info
   */
  getDebugInfo(): object {
    return {
      enabled: this.isEnabled(),
      consent: this.userConsent,
      sampled: this.isSampled,
      userId: this.userId.substring(0, 8) + '...',
      sessionId: this.session?.id?.substring(0, 8) + '...',
      queueLength: this.eventQueue.length,
      sessionEvents: this.session?.eventCount,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let analyticsClient: AnalyticsClient | null = null;

export function initAnalytics(config?: Partial<AnalyticsConfig>): AnalyticsClient {
  if (!analyticsClient) {
    analyticsClient = new AnalyticsClient(config);
  }
  return analyticsClient;
}

export function getAnalytics(): AnalyticsClient | null {
  return analyticsClient;
}
