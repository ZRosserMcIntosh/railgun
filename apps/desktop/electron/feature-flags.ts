/**
 * Feature Flags and Remote Configuration
 * 
 * Provides:
 * - Remote feature flag management
 * - Kill switches for bad releases
 * - A/B testing support
 * - Gradual feature rollout
 */

import { app, ipcMain, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  /** Percentage of users who get this feature (0-100) */
  rolloutPercentage?: number;
  /** Specific user IDs that get this feature */
  allowList?: string[];
  /** Specific user IDs that don't get this feature */
  denyList?: string[];
  /** Minimum app version required */
  minVersion?: string;
  /** Maximum app version (for deprecation) */
  maxVersion?: string;
  /** Feature expiration date */
  expiresAt?: string;
  /** Description for debugging */
  description?: string;
}

export interface RemoteConfig {
  version: string;
  lastUpdated: string;
  /** Global kill switch - halts all app functionality */
  emergencyKillSwitch: boolean;
  /** Message to show if kill switch is active */
  emergencyMessage?: string;
  /** Feature flags */
  flags: Record<string, FeatureFlag>;
  /** Announcement banners */
  announcements?: Announcement[];
  /** Maintenance windows */
  maintenance?: MaintenanceWindow;
}

export interface Announcement {
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

export interface MaintenanceWindow {
  active: boolean;
  message: string;
  startTime: string;
  endTime: string;
  allowReadOnly: boolean;
}

// ============================================================================
// Feature Flag Manager
// ============================================================================

const CONFIG_URL = process.env.RAILGUN_CONFIG_URL || 'https://config.railgun.app';
const CONFIG_FILE = path.join(app.getPath('userData'), 'remote-config.json');
const DISMISSED_ANNOUNCEMENTS_FILE = path.join(app.getPath('userData'), 'dismissed-announcements.json');

/**
 * Default feature flags applied when remote config is unavailable.
 * These ensure incomplete features are hidden at launch.
 */
const DEFAULT_FLAGS: Record<string, FeatureFlag> = {
  // Core messaging - enabled
  dm_messaging: { key: 'dm_messaging', enabled: true, description: 'Direct messaging' },
  community_chat: { key: 'community_chat', enabled: true, description: 'Community/server chat' },
  
  // Incomplete features - disabled for launch
  dex_swap: { key: 'dex_swap', enabled: false, description: 'DEX cryptocurrency swap (incomplete)' },
  p2p_networking: { key: 'p2p_networking', enabled: false, description: 'Peer-to-peer networking (incomplete)' },
  web_app: { key: 'web_app', enabled: false, description: 'Web application (incomplete)' },
  
  // Premium features - require Pro subscription
  voip_phone: { key: 'voip_phone', enabled: true, description: 'Anonymous VOIP phone (premium)' },
  
  // Bible reader - enabled (free feature)
  bible_reader: { key: 'bible_reader', enabled: true, description: 'Bible reader' },
  
  // Voice chat in communities - enabled but needs permission checks
  voice_channels: { key: 'voice_channels', enabled: true, description: 'Voice channels in communities' },
};

export class FeatureFlagManager {
  private config: RemoteConfig | null = null;
  private machineId: string;
  private refreshTimer: NodeJS.Timeout | null = null;
  private dismissedAnnouncements: Set<string> = new Set();

  constructor() {
    this.machineId = this.getMachineId();
    this.loadConfig();
    this.loadDismissedAnnouncements();
    this.setupIPC();
  }

  /**
   * Get stable machine identifier
   */
  private getMachineId(): string {
    const idFile = path.join(app.getPath('userData'), '.machine-id');
    
    try {
      if (fs.existsSync(idFile)) {
        return fs.readFileSync(idFile, 'utf-8').trim();
      }
    } catch {
      // Generate new ID
    }

    const id = crypto.randomUUID();
    try {
      fs.writeFileSync(idFile, id, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Use in-memory
    }
    return id;
  }

  /**
   * Calculate rollout percentile (0-100)
   */
  private getPercentile(): number {
    const hash = crypto.createHash('sha256').update(this.machineId).digest();
    return hash.readUInt32BE(0) % 100;
  }

  /**
   * Calculate feature-specific percentile
   */
  private getFeaturePercentile(featureKey: string): number {
    const hash = crypto.createHash('sha256')
      .update(this.machineId + ':' + featureKey)
      .digest();
    return hash.readUInt32BE(0) % 100;
  }

  /**
   * Load cached config from disk
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        this.config = JSON.parse(data);
        console.log('[FeatureFlags] Loaded cached config');
      }
    } catch (error) {
      console.error('[FeatureFlags] Failed to load cached config:', error);
    }
  }

  /**
   * Save config to disk
   */
  private saveConfig(): void {
    try {
      if (this.config) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), {
          encoding: 'utf-8',
          mode: 0o600,
        });
      }
    } catch (error) {
      console.error('[FeatureFlags] Failed to save config:', error);
    }
  }

  /**
   * Load dismissed announcements
   */
  private loadDismissedAnnouncements(): void {
    try {
      if (fs.existsSync(DISMISSED_ANNOUNCEMENTS_FILE)) {
        const data = JSON.parse(fs.readFileSync(DISMISSED_ANNOUNCEMENTS_FILE, 'utf-8'));
        this.dismissedAnnouncements = new Set(data);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Save dismissed announcements
   */
  private saveDismissedAnnouncements(): void {
    try {
      fs.writeFileSync(
        DISMISSED_ANNOUNCEMENTS_FILE,
        JSON.stringify([...this.dismissedAnnouncements]),
        { encoding: 'utf-8', mode: 0o600 }
      );
    } catch {
      // Ignore
    }
  }

  /**
   * Setup IPC handlers
   */
  private setupIPC(): void {
    ipcMain.handle('feature-flags:get', (_, key: string) => this.isEnabled(key));
    ipcMain.handle('feature-flags:get-all', () => this.getAllFlags());
    ipcMain.handle('feature-flags:refresh', () => this.refresh());
    ipcMain.handle('feature-flags:get-announcements', () => this.getActiveAnnouncements());
    ipcMain.handle('feature-flags:dismiss-announcement', (_, id: string) => {
      this.dismissedAnnouncements.add(id);
      this.saveDismissedAnnouncements();
    });
    ipcMain.handle('feature-flags:get-maintenance', () => this.getMaintenanceStatus());
    ipcMain.handle('feature-flags:is-kill-switch-active', () => this.isKillSwitchActive());
  }

  /**
   * Start automatic config refresh
   */
  startAutoRefresh(intervalMs: number = 5 * 60 * 1000): void {
    // Initial fetch
    this.refresh();
    
    // Periodic refresh
    this.refreshTimer = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  /**
   * Stop automatic refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Fetch latest config from server
   */
  async refresh(): Promise<void> {
    try {
      const response = await this.fetchConfig();
      if (response) {
        this.config = response;
        this.saveConfig();
        console.log('[FeatureFlags] Config refreshed');
      }
    } catch (error) {
      console.error('[FeatureFlags] Failed to refresh config:', error);
    }
  }

  /**
   * Fetch config from server
   */
  private fetchConfig(): Promise<RemoteConfig | null> {
    return new Promise((resolve) => {
      const url = `${CONFIG_URL}/config.json?v=${app.getVersion()}&m=${this.machineId}`;
      
      const request = net.request({
        method: 'GET',
        url,
        redirect: 'follow',
      });

      let data = '';

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }

        response.on('data', (chunk) => {
          data += chunk.toString();
        });

        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      });

      request.on('error', () => resolve(null));
      request.end();
    });
  }

  /**
   * Compare semver versions
   */
  private compareVersions(a: string, b: string): number {
    const parseVersion = (v: string) => v.split('-')[0].split('.').map(Number);
    const va = parseVersion(a);
    const vb = parseVersion(b);
    
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const na = va[i] || 0;
      const nb = vb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  /**
   * Check if a feature flag is enabled for this user
   */
  isEnabled(key: string, defaultValue?: boolean): boolean {
    // Get the flag from config or default flags
    const configFlag = this.config?.flags[key];
    const defaultFlag = DEFAULT_FLAGS[key];
    const flag = configFlag || defaultFlag;
    
    // If no flag defined anywhere, use the provided default or false
    if (!flag) {
      return defaultValue ?? false;
    }

    // Check deny list first
    if (flag.denyList?.includes(this.machineId)) {
      return false;
    }

    // Check allow list
    if (flag.allowList?.includes(this.machineId)) {
      return flag.enabled;
    }

    // Check version constraints
    const currentVersion = app.getVersion();
    if (flag.minVersion && this.compareVersions(currentVersion, flag.minVersion) < 0) {
      return false;
    }
    if (flag.maxVersion && this.compareVersions(currentVersion, flag.maxVersion) > 0) {
      return false;
    }

    // Check expiration
    if (flag.expiresAt && new Date(flag.expiresAt) < new Date()) {
      return false;
    }

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const percentile = this.getFeaturePercentile(key);
      if (percentile >= flag.rolloutPercentage) {
        return false;
      }
    }

    return flag.enabled;
  }

  /**
   * Get all feature flags with their effective values
   */
  getAllFlags(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    
    // Start with default flags
    for (const key of Object.keys(DEFAULT_FLAGS)) {
      result[key] = this.isEnabled(key);
    }
    
    // Add any additional flags from remote config
    if (this.config) {
      for (const key of Object.keys(this.config.flags)) {
        result[key] = this.isEnabled(key);
      }
    }
    
    return result;
  }

  /**
   * Check if emergency kill switch is active
   */
  isKillSwitchActive(): { active: boolean; message?: string } {
    if (!this.config) {
      return { active: false };
    }

    return {
      active: this.config.emergencyKillSwitch,
      message: this.config.emergencyMessage,
    };
  }

  /**
   * Get active announcements
   */
  getActiveAnnouncements(): Announcement[] {
    if (!this.config?.announcements) {
      return [];
    }

    const now = new Date();
    
    return this.config.announcements.filter((announcement) => {
      // Check if expired
      if (announcement.expiresAt && new Date(announcement.expiresAt) < now) {
        return false;
      }

      // Check if dismissed
      if (announcement.showOnce && this.dismissedAnnouncements.has(announcement.id)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get maintenance status
   */
  getMaintenanceStatus(): MaintenanceWindow | null {
    if (!this.config?.maintenance?.active) {
      return null;
    }

    const now = new Date();
    const maintenance = this.config.maintenance;
    const start = new Date(maintenance.startTime);
    const end = new Date(maintenance.endTime);

    if (now >= start && now <= end) {
      return maintenance;
    }

    return null;
  }

  /**
   * Get config for debugging
   */
  getDebugInfo(): object {
    return {
      machineId: this.machineId.substring(0, 8) + '...',
      percentile: this.getPercentile(),
      configVersion: this.config?.version,
      lastUpdated: this.config?.lastUpdated,
      flagCount: this.config ? Object.keys(this.config.flags).length : 0,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let featureFlagManager: FeatureFlagManager | null = null;

export function initFeatureFlags(): FeatureFlagManager {
  if (!featureFlagManager) {
    featureFlagManager = new FeatureFlagManager();
  }
  return featureFlagManager;
}

export function getFeatureFlags(): FeatureFlagManager | null {
  return featureFlagManager;
}
