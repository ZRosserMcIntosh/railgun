/**
 * Rail Gun - Logger Utility
 * 
 * Centralized logging wrapper that provides:
 * - Structured log levels (debug, info, warn, error)
 * - Namespace prefixes for easy filtering
 * - Production vs development mode handling
 * - ESLint no-console rule compliance
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  showTimestamp: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const defaultConfig: LoggerConfig = {
  enabled: import.meta.env.DEV || import.meta.env.MODE === 'development',
  minLevel: 'debug',
  showTimestamp: false,
};

class Logger {
  private namespace: string;
  private config: LoggerConfig;

  constructor(namespace: string, config: Partial<LoggerConfig> = {}) {
    this.namespace = namespace;
    this.config = { ...defaultConfig, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled && level !== 'error') return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(message: string): string {
    const prefix = `[${this.namespace}]`;
    if (this.config.showTimestamp) {
      const timestamp = new Date().toISOString();
      return `${timestamp} ${prefix} ${message}`;
    }
    return `${prefix} ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      // eslint-disable-next-line no-console
      console.log(this.formatMessage(message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      // eslint-disable-next-line no-console
      console.info(this.formatMessage(message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      // eslint-disable-next-line no-console
      console.warn(this.formatMessage(message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    // Always log errors, even in production
    // eslint-disable-next-line no-console
    console.error(this.formatMessage(message), ...args);
  }
}

/**
 * Create a namespaced logger instance.
 * @param namespace - The prefix for all log messages (e.g., 'App', 'RailGunCrypto')
 */
export function createLogger(namespace: string): Logger {
  return new Logger(namespace);
}

// Pre-configured loggers for common modules
export const appLogger = createLogger('App');
export const cryptoLogger = createLogger('RailGunCrypto');
export const keyStoreLogger = createLogger('LocalKeyStore');
export const authLogger = createLogger('Auth');
export const groupsLogger = createLogger('Groups');
export const billingLogger = createLogger('Billing');

export default Logger;
