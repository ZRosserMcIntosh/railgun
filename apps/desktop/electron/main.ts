import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initAutoUpdater, getAutoUpdater } from './auto-updater';
import { initAnalytics, getAnalytics } from './analytics';
import { initFeatureFlags, getFeatureFlags } from './feature-flags';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Secure storage file path - stored in app's userData directory
const SECURE_STORAGE_FILE = path.join(app.getPath('userData'), 'secure-storage.enc');

// Production API URLs - configure via environment or build config
const PROD_API_URL = process.env.RAILGUN_API_URL || 'https://api.railgun.app';
const PROD_WS_URL = process.env.RAILGUN_WS_URL || 'wss://api.railgun.app';

// Handle uncaught exceptions to prevent app crashes from EPIPE errors
process.on('uncaughtException', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
    // Silently ignore EPIPE errors (common with console.log in Electron)
    return;
  }
  console.error('Uncaught exception:', error);
  
  // Track crash in analytics
  const analytics = getAnalytics();
  if (analytics) {
    analytics.trackError('uncaught_exception', error.message);
  }
  
  process.exit(1);
});

function createWindow() {
  const iconPath = isDev
    ? path.join(__dirname, '../resources/icon.icns')
    : path.join(process.resourcesPath, 'icon.icns');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // SECURITY: Proper isolation settings (CRITICAL)
      contextIsolation: true,      // Isolate preload from renderer context
      nodeIntegration: false,      // No Node.js APIs in renderer
      sandbox: true,               // Enable Chromium sandbox
      webSecurity: true,           // Enforce same-origin policy
      allowRunningInsecureContent: false,
    },
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Secure storage with file persistence
// The data is encrypted using OS-level encryption (Keychain on macOS, DPAPI on Windows)

interface SecureStoreData {
  [key: string]: string; // base64 encoded encrypted values
}

function loadSecureStore(): SecureStoreData {
  try {
    if (fs.existsSync(SECURE_STORAGE_FILE)) {
      const data = fs.readFileSync(SECURE_STORAGE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load secure store:', error);
  }
  return {};
}

function saveSecureStore(data: SecureStoreData): void {
  try {
    const dir = path.dirname(SECURE_STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // SECURITY: Restrict file permissions (owner read/write only)
    fs.writeFileSync(SECURE_STORAGE_FILE, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (error) {
    console.error('Failed to save secure store:', error);
  }
}

// Load store on startup
let secureStoreData: SecureStoreData = {};

// SECURITY: Validate IPC caller to prevent unauthorized access
function validateIPCSender(event: Electron.IpcMainInvokeEvent): boolean {
  if (!mainWindow) return false;
  if (event.sender.id !== mainWindow.webContents.id) {
    console.error('[Security] IPC call from unauthorized webContents:', event.sender.id);
    return false;
  }
  
  // In production, verify the URL origin
  if (!isDev) {
    const url = event.sender.getURL();
    if (!url.startsWith('file://') && !url.startsWith('app://')) {
      console.error('[Security] IPC call from unauthorized origin:', url);
      return false;
    }
  }
  
  return true;
}

// Secure storage handlers for tokens
ipcMain.handle('secure-store-set', async (event, key: string, value: string) => {
  // SECURITY: Validate caller
  if (!validateIPCSender(event)) return false;
  
  // Validate inputs
  if (typeof key !== 'string' || typeof value !== 'string') {
    console.error('[SecureStore] Invalid input types');
    return false;
  }
  if (key.length > 256 || value.length > 1024 * 1024) {
    console.error('[SecureStore] Input too large');
    return false;
  }
  
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      secureStoreData[key] = encrypted.toString('base64');
      saveSecureStore(secureStoreData);
      return true;
    }
    
    // SECURITY: In packaged apps, REFUSE to store without encryption
    if (!isDev) {
      console.error('[SecureStore] CRITICAL: Encryption unavailable in production - refusing to store');
      return false;
    }
    
    // Development fallback only
    console.warn('[SecureStore] ⚠️ DEV MODE: Storing WITHOUT encryption');
    secureStoreData[key] = Buffer.from(value).toString('base64');
    saveSecureStore(secureStoreData);
    return true;
  } catch (error) {
    console.error('[SecureStore] Failed to set value:', error);
    return false;
  }
});

ipcMain.handle('secure-store-get', async (event, key: string) => {
  if (!validateIPCSender(event)) return null;
  
  if (typeof key !== 'string' || key.length > 256) return null;
  
  try {
    const encrypted = secureStoreData[key];
    if (!encrypted) {
      return null;
    }
    
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      return decrypted;
    }
    
    // SECURITY: In production, refuse to read potentially unencrypted data
    if (!isDev) {
      console.error('[SecureStore] CRITICAL: Cannot read without encryption in production');
      return null;
    }
    
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  } catch (error) {
    console.error('[SecureStore] Failed to get value:', error);
    return null;
  }
});

ipcMain.handle('secure-store-delete', async (event, key: string) => {
  if (!validateIPCSender(event)) return false;
  if (typeof key !== 'string') return false;
  
  try {
    delete secureStoreData[key];
    saveSecureStore(secureStoreData);
    return true;
  } catch (error) {
    console.error('[SecureStore] Failed to delete value:', error);
    return false;
  }
});

ipcMain.handle('secure-store-clear', async (event) => {
  if (!validateIPCSender(event)) return false;
  
  try {
    secureStoreData = {};
    saveSecureStore(secureStoreData);
    return true;
  } catch (error) {
    console.error('[SecureStore] Failed to clear store:', error);
    return false;
  }
});

ipcMain.handle('secure-store-is-available', async (event) => {
  if (!validateIPCSender(event)) return false;
  return safeStorage.isEncryptionAvailable();
});

// Window control handlers with validation
ipcMain.on('window-minimize', (event) => {
  if (mainWindow && event.sender.id === mainWindow.webContents.id) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', (event) => {
  if (mainWindow && event.sender.id === mainWindow.webContents.id) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', (event) => {
  if (mainWindow && event.sender.id === mainWindow.webContents.id) {
    mainWindow.close();
  }
});

// App lifecycle
app.whenReady().then(() => {
  // Load secure store from disk
  secureStoreData = loadSecureStore();
  
  // Initialize analytics (privacy-first, with consent)
  const analytics = initAnalytics({
    debug: isDev,
    sampleRate: isDev ? 1.0 : 0.1, // 10% sampling in production
  });
  analytics.startSession();
  
  // Initialize feature flags
  const featureFlags = initFeatureFlags();
  featureFlags.startAutoRefresh();
  
  // Initialize auto-updater (production only)
  if (!isDev) {
    const updater = initAutoUpdater();
    updater.startAutoCheck();
  }
  
  createWindow();
  
  // Set main window for updater notifications
  if (mainWindow) {
    const updater = getAutoUpdater();
    if (updater) {
      updater.setMainWindow(mainWindow);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // End analytics session
  const analytics = getAnalytics();
  if (analytics) {
    analytics.endSession();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Ensure analytics are flushed before quit
  const analytics = getAnalytics();
  if (analytics) {
    analytics.flush();
  }
  
  // Stop auto-updater
  const updater = getAutoUpdater();
  if (updater) {
    updater.stopAutoCheck();
  }
  
  // Stop feature flag refresh
  const featureFlags = getFeatureFlags();
  if (featureFlags) {
    featureFlags.stopAutoRefresh();
  }
});

// Security: Configure session permissions
app.whenReady().then(() => {
  // SECURITY: Disable unnecessary permissions
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Only allow necessary permissions
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'notifications'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.warn(`[Security] Denied permission request: ${permission}`);
      callback(false);
    }
  });

  // SECURITY: Block geolocation, media devices, etc. by default
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'notifications'];
    return allowedPermissions.includes(permission);
  });
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowedOrigins = isDev 
      ? ['http://localhost:5173', 'file://']
      : ['file://', 'app://'];
    const isAllowed = allowedOrigins.some((origin) => url.startsWith(origin));
    if (!isAllowed) {
      console.warn(`[Security] Blocked navigation to: ${url}`);
      event.preventDefault();
    }
  });

  // SECURITY: Handle external links - open in system browser
  contents.setWindowOpenHandler(({ url }) => {
    // Only allow http/https URLs to be opened externally
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    } else {
      console.warn(`[Security] Blocked window.open to: ${url}`);
    }
    return { action: 'deny' };
  });

  // Extract API domain from URL for CSP
  const prodApiHost = new URL(PROD_API_URL).host;
  const prodWsProtocol = PROD_WS_URL.startsWith('wss://') ? 'wss://' : 'ws://';
  const prodWsHost = PROD_WS_URL.replace(/^wss?:\/\//, '');

  // Set CSP headers for both development and production
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    const cspPolicy = isDev
      ? // Development: Allow Vite dev server and HMR
        "default-src 'self' http://localhost:5173; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; " +
        "style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com; " +
        "style-src-elem 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com; " +
        "img-src 'self' data: blob: http://localhost:5173; " +
        "font-src 'self' data: http://localhost:5173 https://fonts.gstatic.com; " +
        "connect-src 'self' http://localhost:3001 ws://localhost:3001 http://localhost:5173 ws://localhost:5173; " +
        "media-src 'self' blob:; " +
        "worker-src 'self' blob:;"
      : // Production: Stricter policy with configured API endpoints
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data: https://fonts.gstatic.com; " +
        `connect-src 'self' https://${prodApiHost} ${prodWsProtocol}${prodWsHost}; ` +
        "media-src 'self' blob:; " +
        "worker-src 'self' blob:;";

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspPolicy]
      }
    });
  });
});
