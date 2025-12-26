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

  // SECURITY: Versioned API to detect tampering
  version: '1.0.0',
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
      version: string;
    };
  }
}
