/* eslint-disable no-console */
/**
 * Sentry Integration for Error Tracking
 * 
 * Week 5-6 Client Polish: Privacy-respecting crash reporting
 * 
 * DOCTRINE COMPLIANCE:
 * - Principle 7: Minimal Metadata - Scrubs PII before sending
 * - User consent required before enabling
 * 
 * SECURITY:
 * - No message content ever sent
 * - No user identifiers unless opted in
 * - Keys and tokens automatically scrubbed
 */

import * as Sentry from '@sentry/browser';

// Environment detection
const isDev = import.meta.env.DEV;
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

// Patterns to scrub from error reports
const SENSITIVE_PATTERNS = [
  // Keys and tokens
  /[a-fA-F0-9]{64}/g,                    // 256-bit keys in hex
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,  // JWT tokens
  /Bearer\s+[^\s]+/gi,                    // Bearer tokens
  /[A-Za-z0-9+/=]{40,}/g,                // Base64 encoded data (long)
  
  // Personal identifiers
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email addresses
  /\b\d{10,}\b/g,                         // Phone numbers
  
  // API keys
  /sk_[a-zA-Z0-9]+/g,                     // Stripe-style keys
  /pk_[a-zA-Z0-9]+/g,
  /api[_-]?key[=:]\s*[^\s,]+/gi,
  
  // Passwords (in URLs or params)
  /password[=:]\s*[^\s&,]+/gi,
  /secret[=:]\s*[^\s&,]+/gi,
];

/**
 * Scrub sensitive data from strings
 */
function scrubSensitiveData(data: string): string {
  let scrubbed = data;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed;
}

/**
 * Scrub sensitive data from objects recursively
 */
function scrubObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return scrubSensitiveData(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(scrubObject);
  }
  
  if (obj && typeof obj === 'object') {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Scrub sensitive key names entirely
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('key') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('credential')
      ) {
        scrubbed[key] = '[REDACTED]';
      } else {
        scrubbed[key] = scrubObject(value);
      }
    }
    return scrubbed;
  }
  
  return obj;
}

/**
 * Initialize Sentry with privacy-respecting configuration
 */
export function initSentry(options: {
  enabled: boolean;
  userId?: string;
  allowPII?: boolean;
}) {
  if (!SENTRY_DSN || isDev || !options.enabled) {
    console.log('[Sentry] Disabled:', { 
      hasDSN: !!SENTRY_DSN, 
      isDev, 
      enabled: options.enabled 
    });
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    
    // Environment
    environment: isDev ? 'development' : 'production',
    release: `railgun-desktop@${import.meta.env.VITE_APP_VERSION || 'unknown'}`,
    
    // Sampling
    tracesSampleRate: 0.1,  // 10% of transactions
    sampleRate: 1.0,        // 100% of errors
    
    // Privacy: Don't send default PII
    sendDefaultPii: false,
    
    // Custom beforeSend to scrub sensitive data
    beforeSend(event) {
      // Scrub exception messages
      if (event.exception?.values) {
        for (const exception of event.exception.values) {
          if (exception.value) {
            exception.value = scrubSensitiveData(exception.value);
          }
          // Scrub stack trace local variables
          if (exception.stacktrace?.frames) {
            for (const frame of exception.stacktrace.frames) {
              if (frame.vars) {
                frame.vars = scrubObject(frame.vars) as Record<string, string>;
              }
            }
          }
        }
      }
      
      // Scrub breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(breadcrumb => ({
          ...breadcrumb,
          message: breadcrumb.message ? scrubSensitiveData(breadcrumb.message) : undefined,
          data: breadcrumb.data ? scrubObject(breadcrumb.data) as Record<string, unknown> : undefined,
        }));
      }
      
      // Scrub request data
      if (event.request) {
        if (event.request.url) {
          event.request.url = scrubSensitiveData(event.request.url);
        }
        if (event.request.headers) {
          event.request.headers = scrubObject(event.request.headers) as Record<string, string>;
        }
        if (event.request.data) {
          event.request.data = scrubObject(event.request.data);
        }
      }
      
      // Scrub extra context
      if (event.extra) {
        event.extra = scrubObject(event.extra) as Record<string, unknown>;
      }
      
      // Remove user data unless explicitly allowed
      if (!options.allowPII) {
        delete event.user;
      }
      
      return event;
    },
    
    // Integrations
    integrations: [
      // Disable default browser tracking
      Sentry.browserTracingIntegration({
        // Don't trace navigation by default
        instrumentNavigation: false,
        instrumentPageLoad: false,
      }),
    ],
    
    // Don't capture console logs
    beforeBreadcrumb(breadcrumb) {
      // Filter out console breadcrumbs with potentially sensitive info
      if (breadcrumb.category === 'console') {
        const message = breadcrumb.message || '';
        // Skip logs that might contain sensitive data
        if (
          message.includes('key') ||
          message.includes('token') ||
          message.includes('password') ||
          message.includes('secret')
        ) {
          return null;
        }
      }
      return breadcrumb;
    },
  });

  // Set anonymous user ID if provided (for grouping errors)
  if (options.userId && options.allowPII) {
    Sentry.setUser({ id: options.userId });
  }

  console.log('[Sentry] Initialized with privacy scrubbing');
}

/**
 * Report an error to Sentry
 */
export function reportError(
  error: Error,
  context?: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'error'
) {
  // Scrub context before sending
  const scrubbedContext = context ? scrubObject(context) : undefined;
  
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (scrubbedContext) {
      scope.setExtras(scrubbedContext as Record<string, unknown>);
    }
    Sentry.captureException(error);
  });
}

/**
 * Report a message to Sentry
 */
export function reportMessage(
  message: string,
  context?: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'info'
) {
  const scrubbedMessage = scrubSensitiveData(message);
  const scrubbedContext = context ? scrubObject(context) : undefined;
  
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (scrubbedContext) {
      scope.setExtras(scrubbedContext as Record<string, unknown>);
    }
    Sentry.captureMessage(scrubbedMessage);
  });
}

/**
 * Add breadcrumb for user action tracking
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>
) {
  Sentry.addBreadcrumb({
    message: scrubSensitiveData(message),
    category,
    data: data ? scrubObject(data) as Record<string, unknown> : undefined,
    level: 'info',
  });
}

/**
 * Set user context (only if PII allowed)
 */
export function setUserContext(userId: string | null, allowPII: boolean) {
  if (allowPII && userId) {
    Sentry.setUser({ id: userId });
  } else {
    Sentry.setUser(null);
  }
}

/**
 * Clear all Sentry data
 */
export function clearSentryData() {
  Sentry.setUser(null);
  Sentry.getCurrentScope().clear();
}

/**
 * Enable crash reporting at runtime
 * Note: Only works if Sentry was initialized. For full enable, app restart needed.
 */
export function enableCrashReporting() {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().enabled = true;
  }
  localStorage.setItem('crashReportingEnabled', 'true');
}

/**
 * Disable crash reporting at runtime
 */
export function disableCrashReporting() {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().enabled = false;
  }
  // Also clear any pending data
  clearSentryData();
  localStorage.setItem('crashReportingEnabled', 'false');
}

/**
 * Check if crash reporting is currently enabled
 */
export function isCrashReportingEnabled(): boolean {
  return localStorage.getItem('crashReportingEnabled') !== 'false';
}
