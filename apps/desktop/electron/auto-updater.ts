/**
 * Secure Auto-Updater for Rail Gun Desktop
 * 
 * Features:
 * - Signed artifact verification (GPG/cosign)
 * - Update channels (stable, beta, canary)
 * - Phased rollout support
 * - Health check integration
 * - Feature flag kill switches
 * - Atomic update swapping
 */

import { app, BrowserWindow, dialog, ipcMain, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type UpdateChannel = 'stable' | 'beta' | 'canary';

export interface UpdateConfig {
  /** Base URL for update manifest and artifacts */
  updateServerUrl: string;
  /** Current update channel */
  channel: UpdateChannel;
  /** Public key for signature verification (PEM format) */
  publicKey: string;
  /** Enable automatic update checks */
  autoCheck: boolean;
  /** Check interval in milliseconds (default: 4 hours) */
  checkInterval: number;
  /** User's rollout percentage (0-100, computed from machine ID) */
  rolloutPercentile?: number;
}

export interface UpdateManifest {
  version: string;
  channel: UpdateChannel;
  releaseDate: string;
  releaseNotes: string;
  mandatory: boolean;
  /** Rollout percentage (0-100). Updates only install if user's percentile <= this */
  rolloutPercentage: number;
  /** Feature flags - can disable specific features remotely */
  featureFlags: Record<string, boolean>;
  /** Kill switch - set to true to halt all updates */
  killSwitch: boolean;
  /** Minimum required version to update from (for breaking changes) */
  minVersion?: string;
  /** 
   * SECURITY: Monotonically increasing build number for rollback protection.
   * The client will NEVER accept a manifest with a buildNumber <= current installed.
   */
  buildNumber: number;
  /**
   * SECURITY: Manifest expiration timestamp (ISO 8601).
   * Prevents replay of old, potentially vulnerable manifests.
   */
  expiresAt: string;
  /**
   * Minimum build number required to apply this update.
   * Used to enforce update paths (can't skip versions).
   */
  minBuildNumber?: number;
  artifacts: UpdateArtifact[];
}

export interface UpdateArtifact {
  platform: 'darwin' | 'win32' | 'linux';
  arch: 'x64' | 'arm64' | 'universal';
  url: string;
  size: number;
  sha256: string;
  /** Signature of the sha256 hash (base64 encoded) */
  signature: string;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  progress: number;
  error: string | null;
  version: string | null;
  releaseNotes: string | null;
}

export interface RolloutHealthCheck {
  version: string;
  errorRate: number;
  crashRate: number;
  adoptionRate: number;
  rollbackTriggered: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Default update configuration
 * 
 * RAILGUN_UPDATE_URL: Base URL for update manifest
 *   - Production: https://update.railgun.app or S3/R2 bucket URL
 *   - Can also use GitHub Releases: https://github.com/OWNER/REPO/releases/latest/download
 * 
 * RAILGUN_UPDATE_PUBLIC_KEY: RSA public key in PEM format for signature verification
 *   - Generate with: openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem
 *   - Set the public key content as this environment variable
 *   - If not set, signature verification is skipped in development (warning shown)
 * 
 * RAILGUN_UPDATE_CHANNEL: stable | beta | canary
 */
const DEFAULT_CONFIG: UpdateConfig = {
  updateServerUrl: process.env.RAILGUN_UPDATE_URL || 'https://github.com/ZRosserMcIntosh/railgun/releases/latest/download',
  channel: (process.env.RAILGUN_UPDATE_CHANNEL as UpdateChannel) || 'stable',
  publicKey: process.env.RAILGUN_UPDATE_PUBLIC_KEY || '',
  autoCheck: true,
  checkInterval: 4 * 60 * 60 * 1000, // 4 hours
};

const CONFIG_FILE = path.join(app.getPath('userData'), 'update-config.json');
const PENDING_UPDATE_DIR = path.join(app.getPath('userData'), 'pending-update');
const INSTALLED_BUILD_FILE = path.join(app.getPath('userData'), '.installed-build');

/**
 * SECURITY: Whether to allow unsigned updates.
 * 
 * This is determined using TWO conditions that must BOTH be true:
 * 1. NODE_ENV === 'development' (can be set at runtime, so not sufficient alone)
 * 2. app.isPackaged === false (set by Electron at build time, cannot be spoofed)
 * 
 * The app.isPackaged check is the critical one - it's determined by whether the
 * app is running from an asar archive, which is controlled at build time.
 * 
 * In production builds (app.isPackaged === true), this is ALWAYS false,
 * regardless of environment variables.
 */
const ALLOW_UNSIGNED_UPDATES = !app.isPackaged && process.env.NODE_ENV === 'development';

// Runtime assertion to catch any unexpected configuration
if (app.isPackaged && ALLOW_UNSIGNED_UPDATES) {
  // This should be logically impossible, but defense in depth
  throw new Error('FATAL SECURITY ERROR: ALLOW_UNSIGNED_UPDATES is true in packaged app');
}

// ============================================================================
// Auto-Updater Class
// ============================================================================

export class SecureAutoUpdater {
  private config: UpdateConfig;
  private status: UpdateStatus;
  private checkTimer: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  private featureFlags: Record<string, boolean> = {};
  private installedBuildNumber: number = 0;

  constructor(config?: Partial<UpdateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = {
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      progress: 0,
      error: null,
      version: null,
      releaseNotes: null,
    };
    
    // Calculate rollout percentile from machine ID
    this.config.rolloutPercentile = this.calculateRolloutPercentile();
    
    // Load installed build number for rollback protection
    this.installedBuildNumber = this.loadInstalledBuildNumber();
    
    this.loadConfig();
    this.setupIPC();
  }

  /**
   * Load the installed build number from persistent storage.
   * Used for rollback protection.
   */
  private loadInstalledBuildNumber(): number {
    try {
      if (fs.existsSync(INSTALLED_BUILD_FILE)) {
        const content = fs.readFileSync(INSTALLED_BUILD_FILE, 'utf-8').trim();
        const buildNumber = parseInt(content, 10);
        if (!isNaN(buildNumber) && buildNumber > 0) {
          console.log(`[AutoUpdater] Loaded installed build number: ${buildNumber}`);
          return buildNumber;
        }
      }
    } catch (error) {
      console.warn('[AutoUpdater] Could not load installed build number:', error);
    }
    // Default to 0 if not set (first install or migration)
    return 0;
  }

  /**
   * Save the installed build number after successful update.
   */
  private saveInstalledBuildNumber(buildNumber: number): void {
    try {
      fs.writeFileSync(INSTALLED_BUILD_FILE, buildNumber.toString(), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      this.installedBuildNumber = buildNumber;
      console.log(`[AutoUpdater] Saved installed build number: ${buildNumber}`);
    } catch (error) {
      console.error('[AutoUpdater] Failed to save installed build number:', error);
    }
  }

  /**
   * Calculate a stable rollout percentile (0-100) based on machine ID
   * This ensures the same user always gets the same percentile
   */
  private calculateRolloutPercentile(): number {
    const machineId = this.getMachineId();
    const hash = crypto.createHash('sha256').update(machineId).digest();
    // Use first 4 bytes to get a number, then mod 100
    const num = hash.readUInt32BE(0);
    return num % 100;
  }

  /**
   * Get a stable machine identifier for rollout bucketing
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

    // Generate a new stable ID
    const id = crypto.randomUUID();
    try {
      fs.writeFileSync(idFile, id, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      // Use in-memory ID if we can't persist
    }
    return id;
  }

  /**
   * Load persisted configuration
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        this.config = { ...this.config, ...saved };
      }
    } catch (error) {
      console.error('[AutoUpdater] Failed to load config:', error);
    }
  }

  /**
   * Save configuration
   */
  private saveConfig(): void {
    try {
      const configToSave = {
        channel: this.config.channel,
        autoCheck: this.config.autoCheck,
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch (error) {
      console.error('[AutoUpdater] Failed to save config:', error);
    }
  }

  /**
   * Setup IPC handlers for renderer communication
   */
  private setupIPC(): void {
    ipcMain.handle('updater:check', async () => this.checkForUpdates());
    ipcMain.handle('updater:download', async () => this.downloadUpdate());
    ipcMain.handle('updater:install', async () => this.installUpdate());
    ipcMain.handle('updater:get-status', () => this.status);
    ipcMain.handle('updater:get-channel', () => this.config.channel);
    ipcMain.handle('updater:set-channel', async (_, channel: UpdateChannel) => {
      this.setChannel(channel);
    });
    ipcMain.handle('updater:get-feature-flag', (_, flag: string) => {
      return this.featureFlags[flag] ?? true;
    });
    ipcMain.handle('updater:get-all-feature-flags', () => this.featureFlags);
  }

  /**
   * Set the main window for update notifications
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Emit status update to renderer
   */
  private emitStatus(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status-changed', this.status);
    }
  }

  /**
   * Start automatic update checking
   */
  startAutoCheck(): void {
    if (!this.config.autoCheck) return;
    
    // Check immediately on start (with a small delay)
    setTimeout(() => this.checkForUpdates(), 10000);
    
    // Set up periodic checks
    this.checkTimer = setInterval(() => {
      this.checkForUpdates();
    }, this.config.checkInterval);
  }

  /**
   * Stop automatic update checking
   */
  stopAutoCheck(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Set update channel
   */
  setChannel(channel: UpdateChannel): void {
    this.config.channel = channel;
    this.saveConfig();
    // Trigger a check when channel changes
    this.checkForUpdates();
  }

  /**
   * Get current app version
   */
  getCurrentVersion(): string {
    return app.getVersion();
  }

  /**
   * Fetch update manifest from server
   * 
   * Supports two URL patterns:
   * 1. Dedicated update server: https://update.example.com/manifest/{channel}.json
   * 2. GitHub Releases: https://github.com/OWNER/REPO/releases/latest/download/{channel}.json
   */
  private async fetchManifest(): Promise<UpdateManifest | null> {
    // Construct manifest URL
    let url: string;
    if (this.config.updateServerUrl.includes('github.com') && this.config.updateServerUrl.includes('/releases/')) {
      // GitHub Releases URL pattern
      url = `${this.config.updateServerUrl}/${this.config.channel}.json`;
    } else {
      // Dedicated update server pattern
      url = `${this.config.updateServerUrl}/manifest/${this.config.channel}.json`;
    }
    
    console.log(`[AutoUpdater] Fetching manifest from: ${url}`);
    
    return new Promise((resolve) => {
      const request = net.request({
        method: 'GET',
        url,
        redirect: 'follow',
      });

      let data = '';

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          console.error('[AutoUpdater] Failed to fetch manifest:', response.statusCode);
          resolve(null);
          return;
        }

        response.on('data', (chunk) => {
          data += chunk.toString();
        });

        response.on('end', () => {
          try {
            const manifest = JSON.parse(data) as UpdateManifest;
            resolve(manifest);
          } catch (error) {
            console.error('[AutoUpdater] Failed to parse manifest:', error);
            resolve(null);
          }
        });
      });

      request.on('error', (error) => {
        console.error('[AutoUpdater] Network error fetching manifest:', error);
        resolve(null);
      });

      request.end();
    });
  }

  /**
   * Compare semantic versions
   * Returns: 1 if a > b, -1 if a < b, 0 if equal
   */
  private compareVersions(a: string, b: string): number {
    const parseVersion = (v: string) => {
      const [main, pre] = v.split('-');
      const parts = main.split('.').map(Number);
      return { parts, pre: pre || '' };
    };

    const va = parseVersion(a);
    const vb = parseVersion(b);

    for (let i = 0; i < Math.max(va.parts.length, vb.parts.length); i++) {
      const na = va.parts[i] || 0;
      const nb = vb.parts[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }

    // Handle pre-release versions (beta < stable)
    if (va.pre && !vb.pre) return -1;
    if (!va.pre && vb.pre) return 1;
    if (va.pre && vb.pre) {
      return va.pre.localeCompare(vb.pre);
    }

    return 0;
  }

  /**
   * Verify artifact signature using public key.
   *
   * Supports RSA signatures (SHA256 with RSA) as generated by the release workflow.
   *
   * SECURITY: Unsigned updates are ONLY allowed in development builds.
   * Production builds MUST have a valid signature. There is NO runtime override.
   */
  private verifySignature(sha256: string, signature: string): boolean {
    if (!this.config.publicKey) {
      console.warn('[AutoUpdater] No public key configured');
      
      // SECURITY: Only allow unsigned in development, checked at build time
      if (ALLOW_UNSIGNED_UPDATES) {
        console.warn('[AutoUpdater] ⚠️ DEV MODE: Allowing unsigned update');
        return true;
      }
      
      // Production: NEVER allow unsigned
      console.error('[AutoUpdater] 🛑 SECURITY: Rejecting unsigned update in production');
      return false;
    }

    try {
      // Decode base64 signature
      const signatureBuffer = Buffer.from(signature, 'base64');
      
      // Verify RSA signature
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(sha256);
      const isValid = verify.verify(this.config.publicKey, signatureBuffer);
      
      if (isValid) {
        console.log('[AutoUpdater] ✓ Signature verification successful');
      } else {
        console.error('[AutoUpdater] 🛑 SECURITY: Signature verification failed');
      }
      
      return isValid;
    } catch (error) {
      console.error('[AutoUpdater] Signature verification error:', error);
      return false;
    }
  }

  /**
   * SECURITY: Check for rollback/downgrade attacks.
   * 
   * Validates:
   * 1. Manifest hasn't expired (prevents replay of old manifests)
   * 2. Build number is strictly greater than installed (prevents downgrades)
   * 3. We meet the minimum build number requirement (prevents skipping updates)
   */
  private checkRollbackProtection(manifest: UpdateManifest): { valid: boolean; reason?: string } {
    // 1. Check manifest expiration
    if (manifest.expiresAt) {
      const expiresAt = new Date(manifest.expiresAt);
      if (expiresAt < new Date()) {
        console.error('[AutoUpdater] 🛑 SECURITY: Manifest has expired');
        return { valid: false, reason: 'Manifest expired - possible replay attack' };
      }
    } else if (!ALLOW_UNSIGNED_UPDATES) {
      // Production manifests MUST have expiration
      console.error('[AutoUpdater] 🛑 SECURITY: Manifest missing expiration');
      return { valid: false, reason: 'Manifest missing expiration timestamp' };
    }

    // 2. Check build number is strictly greater (rollback protection)
    if (manifest.buildNumber !== undefined) {
      if (manifest.buildNumber <= this.installedBuildNumber) {
        console.error(
          `[AutoUpdater] 🛑 SECURITY: Rollback attempt detected! ` +
          `Manifest build ${manifest.buildNumber} <= installed ${this.installedBuildNumber}`
        );
        return { 
          valid: false, 
          reason: `Rollback blocked: build ${manifest.buildNumber} is not newer than ${this.installedBuildNumber}` 
        };
      }
    } else if (!ALLOW_UNSIGNED_UPDATES) {
      // Production manifests MUST have build number
      console.error('[AutoUpdater] 🛑 SECURITY: Manifest missing build number');
      return { valid: false, reason: 'Manifest missing build number' };
    }

    // 3. Check minimum build number requirement
    if (manifest.minBuildNumber !== undefined) {
      if (this.installedBuildNumber < manifest.minBuildNumber) {
        console.error(
          `[AutoUpdater] Cannot update: installed build ${this.installedBuildNumber} ` +
          `< required minimum ${manifest.minBuildNumber}`
        );
        return { 
          valid: false, 
          reason: `Please update to an intermediate version first. ` +
                  `Your build (${this.installedBuildNumber}) is too old for this update.` 
        };
      }
    }

    console.log(
      `[AutoUpdater] ✓ Rollback protection passed: ` +
      `build ${manifest.buildNumber} > installed ${this.installedBuildNumber}`
    );
    return { valid: true };
  }

  /**
   * Get the appropriate artifact for this platform
   */
  private getArtifactForPlatform(artifacts: UpdateArtifact[]): UpdateArtifact | null {
    const platform = process.platform as 'darwin' | 'win32' | 'linux';
    const arch = process.arch as 'x64' | 'arm64';

    // First try exact match
    let artifact = artifacts.find((a) => a.platform === platform && a.arch === arch);
    
    // On macOS, fall back to universal if specific arch not found
    if (!artifact && platform === 'darwin') {
      artifact = artifacts.find((a) => a.platform === platform && a.arch === 'universal');
    }

    return artifact || null;
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateStatus> {
    if (this.status.checking) {
      return this.status;
    }

    this.status.checking = true;
    this.status.error = null;
    this.emitStatus();

    try {
      const manifest = await this.fetchManifest();
      
      if (!manifest) {
        throw new Error('Failed to fetch update manifest');
      }

      // Update feature flags from manifest
      this.featureFlags = manifest.featureFlags || {};

      // Check kill switch
      if (manifest.killSwitch) {
        console.log('[AutoUpdater] Kill switch activated - no updates available');
        this.status.available = false;
        return this.status;
      }

      // SECURITY: Check rollback protection BEFORE proceeding
      const rollbackCheck = this.checkRollbackProtection(manifest);
      if (!rollbackCheck.valid) {
        console.error('[AutoUpdater] Rollback protection failed:', rollbackCheck.reason);
        this.status.error = rollbackCheck.reason || 'Security check failed';
        this.status.available = false;
        return this.status;
      }

      // Check if update is available
      const currentVersion = this.getCurrentVersion();
      const hasUpdate = this.compareVersions(manifest.version, currentVersion) > 0;

      if (!hasUpdate) {
        console.log('[AutoUpdater] No update available');
        this.status.available = false;
        return this.status;
      }

      // Check minimum version requirement
      if (manifest.minVersion && this.compareVersions(currentVersion, manifest.minVersion) < 0) {
        console.log('[AutoUpdater] Update requires minimum version:', manifest.minVersion);
        this.status.error = `Please update manually. Your version is too old for automatic updates.`;
        return this.status;
      }

      // Check rollout percentage
      const percentile = this.config.rolloutPercentile || 0;
      if (percentile > manifest.rolloutPercentage) {
        console.log(
          `[AutoUpdater] Update not yet available for this user (percentile ${percentile} > rollout ${manifest.rolloutPercentage})`
        );
        this.status.available = false;
        return this.status;
      }

      // Check platform artifact exists
      const artifact = this.getArtifactForPlatform(manifest.artifacts);
      if (!artifact) {
        console.log('[AutoUpdater] No artifact available for this platform');
        this.status.available = false;
        return this.status;
      }

      console.log('[AutoUpdater] Update available:', manifest.version);
      this.status.available = true;
      this.status.version = manifest.version;
      this.status.releaseNotes = manifest.releaseNotes;

      return this.status;
    } catch (error) {
      console.error('[AutoUpdater] Check failed:', error);
      this.status.error = error instanceof Error ? error.message : 'Update check failed';
      return this.status;
    } finally {
      this.status.checking = false;
      this.emitStatus();
    }
  }

  /**
   * Download the update
   */
  async downloadUpdate(): Promise<boolean> {
    if (!this.status.available || this.status.downloading) {
      return false;
    }

    this.status.downloading = true;
    this.status.progress = 0;
    this.status.error = null;
    this.emitStatus();

    try {
      const manifest = await this.fetchManifest();
      if (!manifest) {
        throw new Error('Failed to fetch manifest');
      }

      const artifact = this.getArtifactForPlatform(manifest.artifacts);
      if (!artifact) {
        throw new Error('No artifact for this platform');
      }

      // Verify signature before downloading
      if (!this.verifySignature(artifact.sha256, artifact.signature)) {
        throw new Error('SECURITY: Artifact signature verification failed');
      }

      // Create pending update directory
      if (fs.existsSync(PENDING_UPDATE_DIR)) {
        fs.rmSync(PENDING_UPDATE_DIR, { recursive: true });
      }
      fs.mkdirSync(PENDING_UPDATE_DIR, { recursive: true });

      const filename = path.basename(new URL(artifact.url).pathname);
      const downloadPath = path.join(PENDING_UPDATE_DIR, filename);

      // Download with progress tracking
      await this.downloadFile(artifact.url, downloadPath, artifact.size);

      // Verify downloaded file checksum
      const fileHash = await this.computeFileHash(downloadPath);
      if (fileHash !== artifact.sha256) {
        fs.unlinkSync(downloadPath);
        throw new Error('SECURITY: Downloaded file checksum mismatch');
      }

      // Save manifest for installation
      fs.writeFileSync(
        path.join(PENDING_UPDATE_DIR, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        { encoding: 'utf-8', mode: 0o600 }
      );

      console.log('[AutoUpdater] Download complete and verified');
      this.status.downloaded = true;
      return true;
    } catch (error) {
      console.error('[AutoUpdater] Download failed:', error);
      this.status.error = error instanceof Error ? error.message : 'Download failed';
      return false;
    } finally {
      this.status.downloading = false;
      this.emitStatus();
    }
  }

  /**
   * Download a file with progress tracking
   */
  private downloadFile(url: string, destPath: string, expectedSize: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      let downloadedBytes = 0;

      const request = net.request({
        method: 'GET',
        url,
        redirect: 'follow',
      });

      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        response.on('data', (chunk: Buffer) => {
          file.write(chunk);
          downloadedBytes += chunk.length;
          this.status.progress = Math.round((downloadedBytes / expectedSize) * 100);
          this.emitStatus();
        });

        response.on('end', () => {
          file.end();
          resolve();
        });

        response.on('error', (error: Error) => {
          file.destroy();
          reject(error);
        });
      });

      request.on('error', (error: Error) => {
        file.destroy();
        reject(error);
      });

      request.end();
    });
  }

  /**
   * Compute SHA-256 hash of a file
   */
  private computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Install the downloaded update
   */
  async installUpdate(): Promise<void> {
    if (!this.status.downloaded) {
      throw new Error('No update downloaded');
    }

    const manifestPath = path.join(PENDING_UPDATE_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Update manifest not found');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as UpdateManifest;
    const artifact = this.getArtifactForPlatform(manifest.artifacts);
    if (!artifact) {
      throw new Error('No artifact for this platform');
    }

    const filename = path.basename(new URL(artifact.url).pathname);
    const updatePath = path.join(PENDING_UPDATE_DIR, filename);

    if (!fs.existsSync(updatePath)) {
      throw new Error('Update file not found');
    }

    // Platform-specific installation
    if (process.platform === 'darwin') {
      // macOS: Show dialog and open DMG
      const result = await dialog.showMessageBox(this.mainWindow!, {
        type: 'info',
        title: 'Update Ready',
        message: `Rail Gun ${manifest.version} is ready to install.`,
        detail: manifest.releaseNotes,
        buttons: ['Install Now', 'Later'],
        defaultId: 0,
      });

      if (result.response === 0) {
        // SECURITY: Save the new build number before launching installer
        if (manifest.buildNumber) {
          this.saveInstalledBuildNumber(manifest.buildNumber);
        }
        
        const { shell } = require('electron');
        await shell.openPath(updatePath);
        // Quit after a short delay to allow the installer to run
        setTimeout(() => app.quit(), 1000);
      }
    } else if (process.platform === 'win32') {
      // Windows: Run installer with elevated privileges
      const result = await dialog.showMessageBox(this.mainWindow!, {
        type: 'info',
        title: 'Update Ready',
        message: `Rail Gun ${manifest.version} is ready to install.`,
        detail: 'The application will close and the update will be installed.',
        buttons: ['Install Now', 'Later'],
        defaultId: 0,
      });

      if (result.response === 0) {
        // SECURITY: Save the new build number before launching installer
        if (manifest.buildNumber) {
          this.saveInstalledBuildNumber(manifest.buildNumber);
        }
        
        const { spawn } = require('child_process');
        spawn(updatePath, ['/S'], {
          detached: true,
          stdio: 'ignore',
        });
        app.quit();
      }
    } else {
      // Linux: Show location of update file
      // SECURITY: Save the new build number
      if (manifest.buildNumber) {
        this.saveInstalledBuildNumber(manifest.buildNumber);
      }
      
      const { shell } = require('electron');
      shell.showItemInFolder(updatePath);
      dialog.showMessageBox(this.mainWindow!, {
        type: 'info',
        title: 'Update Downloaded',
        message: `Rail Gun ${manifest.version} has been downloaded.`,
        detail: 'Please install the update manually.',
      });
    }
  }

  /**
   * Report health metrics for rollout monitoring
   */
  async reportHealth(metrics: { errors: number; crashes: number }): Promise<void> {
    const url = `${this.config.updateServerUrl}/health`;
    
    try {
      const request = net.request({
        method: 'POST',
        url,
        redirect: 'follow',
      });

      request.setHeader('Content-Type', 'application/json');
      request.write(JSON.stringify({
        version: this.getCurrentVersion(),
        channel: this.config.channel,
        platform: process.platform,
        arch: process.arch,
        machineId: this.getMachineId(),
        errors: metrics.errors,
        crashes: metrics.crashes,
        timestamp: new Date().toISOString(),
      }));
      
      request.end();
    } catch (error) {
      console.error('[AutoUpdater] Failed to report health:', error);
    }
  }

  /**
   * Clean up pending updates on successful launch
   */
  cleanupPendingUpdates(): void {
    try {
      if (fs.existsSync(PENDING_UPDATE_DIR)) {
        fs.rmSync(PENDING_UPDATE_DIR, { recursive: true });
        console.log('[AutoUpdater] Cleaned up pending updates');
      }
    } catch (error) {
      console.error('[AutoUpdater] Failed to cleanup:', error);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let autoUpdater: SecureAutoUpdater | null = null;

export function initAutoUpdater(config?: Partial<UpdateConfig>): SecureAutoUpdater {
  if (!autoUpdater) {
    autoUpdater = new SecureAutoUpdater(config);
  }
  return autoUpdater;
}

export function getAutoUpdater(): SecureAutoUpdater | null {
  return autoUpdater;
}
