import { contextBridge, ipcRenderer } from 'electron';

// SECURITY: Use contextBridge to safely expose APIs to renderer
// This creates a secure bridge that doesn't expose Node.js APIs
contextBridge.exposeInMainWorld('electronAPI', {
  // Secure storage for tokens (uses OS-level encryption)
  secureStore: {
    set: (key: string, value: string): Promise<boolean> => {
      // SECURITY: Validate inputs before sending to main process
      if (typeof key !== 'string' || typeof value !== 'string') {
        return Promise.resolve(false);
      }
      return ipcRenderer.invoke('secure-store-set', key, value);
    },
    get: (key: string): Promise<string | null> => {
      if (typeof key !== 'string') {
        return Promise.resolve(null);
      }
      return ipcRenderer.invoke('secure-store-get', key);
    },
    delete: (key: string): Promise<boolean> => {
      if (typeof key !== 'string') {
        return Promise.resolve(false);
      }
      return ipcRenderer.invoke('secure-store-delete', key);
    },
    clear: (): Promise<boolean> => {
      return ipcRenderer.invoke('secure-store-clear');
    },
    isAvailable: (): Promise<boolean> => {
      return ipcRenderer.invoke('secure-store-is-available');
    },
  },

  // Platform info (safe to expose as it's read-only)
  platform: process.platform,
  
  // Window controls (for custom title bar if needed)
  window: {
    minimize: (): void => {
      ipcRenderer.send('window-minimize');
    },
    maximize: (): void => {
      ipcRenderer.send('window-maximize');
    },
    close: (): void => {
      ipcRenderer.send('window-close');
    },
  },

  // Analytics (privacy-first, pseudonymized)
  analytics: {
    track: (name: string, properties?: Record<string, string | number | boolean>): void => {
      if (typeof name !== 'string') return;
      ipcRenderer.invoke('analytics:track', name, properties);
    },
    trackScreen: (screenName: string): void => {
      if (typeof screenName !== 'string') return;
      ipcRenderer.invoke('analytics:track-screen', screenName);
    },
    trackTiming: (name: string, duration: number, properties?: Record<string, string | number | boolean>): void => {
      if (typeof name !== 'string' || typeof duration !== 'number') return;
      ipcRenderer.invoke('analytics:track-timing', name, duration, properties);
    },
    setConsent: (consent: boolean): Promise<void> => {
      return ipcRenderer.invoke('analytics:set-consent', consent);
    },
    getConsent: (): Promise<boolean> => {
      return ipcRenderer.invoke('analytics:get-consent');
    },
    isEnabled: (): Promise<boolean> => {
      return ipcRenderer.invoke('analytics:is-enabled');
    },
    flush: (): Promise<void> => {
      return ipcRenderer.invoke('analytics:flush');
    },
  },

  // Auto-updater
  updater: {
    check: (): Promise<unknown> => {
      return ipcRenderer.invoke('updater:check');
    },
    download: (): Promise<boolean> => {
      return ipcRenderer.invoke('updater:download');
    },
    install: (): Promise<void> => {
      return ipcRenderer.invoke('updater:install');
    },
    getStatus: (): Promise<unknown> => {
      return ipcRenderer.invoke('updater:get-status');
    },
    getChannel: (): Promise<string> => {
      return ipcRenderer.invoke('updater:get-channel');
    },
    setChannel: (channel: string): Promise<void> => {
      if (typeof channel !== 'string') return Promise.resolve();
      return ipcRenderer.invoke('updater:set-channel', channel);
    },
    onStatusChange: (callback: (status: unknown) => void): void => {
      ipcRenderer.on('updater:status-changed', (_, status) => callback(status));
    },
  },

  // Feature flags
  featureFlags: {
    get: (key: string): Promise<boolean> => {
      if (typeof key !== 'string') return Promise.resolve(false);
      return ipcRenderer.invoke('feature-flags:get', key);
    },
    getAll: (): Promise<Record<string, boolean>> => {
      return ipcRenderer.invoke('feature-flags:get-all');
    },
    refresh: (): Promise<void> => {
      return ipcRenderer.invoke('feature-flags:refresh');
    },
    getAnnouncements: (): Promise<unknown[]> => {
      return ipcRenderer.invoke('feature-flags:get-announcements');
    },
    dismissAnnouncement: (id: string): Promise<void> => {
      if (typeof id !== 'string') return Promise.resolve();
      return ipcRenderer.invoke('feature-flags:dismiss-announcement', id);
    },
    getMaintenance: (): Promise<unknown> => {
      return ipcRenderer.invoke('feature-flags:get-maintenance');
    },
    isKillSwitchActive: (): Promise<{ active: boolean; message?: string }> => {
      return ipcRenderer.invoke('feature-flags:is-kill-switch-active');
    },
  },

  // SECURITY: Versioned API to detect tampering
  version: '2.0.0',
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      secureStore: {
        set: (key: string, value: string) => Promise<boolean>;
        get: (key: string) => Promise<string | null>;
        delete: (key: string) => Promise<boolean>;
        clear: () => Promise<boolean>;
        isAvailable: () => Promise<boolean>;
      };
      platform: NodeJS.Platform;
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
      };
      analytics: {
        track: (name: string, properties?: Record<string, string | number | boolean>) => void;
        trackScreen: (screenName: string) => void;
        trackTiming: (name: string, duration: number, properties?: Record<string, string | number | boolean>) => void;
        setConsent: (consent: boolean) => Promise<void>;
        getConsent: () => Promise<boolean>;
        isEnabled: () => Promise<boolean>;
        flush: () => Promise<void>;
      };
      updater: {
        check: () => Promise<unknown>;
        download: () => Promise<boolean>;
        install: () => Promise<void>;
        getStatus: () => Promise<unknown>;
        getChannel: () => Promise<string>;
        setChannel: (channel: string) => Promise<void>;
        onStatusChange: (callback: (status: unknown) => void) => void;
      };
      featureFlags: {
        get: (key: string) => Promise<boolean>;
        getAll: () => Promise<Record<string, boolean>>;
        refresh: () => Promise<void>;
        getAnnouncements: () => Promise<unknown[]>;
        dismissAnnouncement: (id: string) => Promise<void>;
        getMaintenance: () => Promise<unknown>;
        isKillSwitchActive: () => Promise<{ active: boolean; message?: string }>;
      };
      version: string;
    };
  }
}
