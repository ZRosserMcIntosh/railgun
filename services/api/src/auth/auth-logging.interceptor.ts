import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Security Logging Interceptor
 * 
 * This interceptor sanitizes request/response logging for auth endpoints
 * to prevent sensitive data (passwords, recovery codes, tokens) from being logged.
 */
@Injectable()
export class AuthLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuthController');

  // Paths that contain sensitive data
  private readonly sensitiveAuthPaths = [
    '/auth/register',
    '/auth/login',
    '/auth/recover',
    '/auth/recovery-codes',
    '/auth/refresh',
  ];

  // Fields to redact from logs
  private readonly sensitiveFields = [
    'password',
    'newPassword',
    'confirmPassword',
    'recoveryCode',
    'recoveryCodes',
    'accessToken',
    'refreshToken',
    'tokens',
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    const now = Date.now();

    // Check if this is a sensitive endpoint
    const isSensitivePath = this.sensitiveAuthPaths.some(path => url.includes(path));

    if (isSensitivePath) {
      // Log sanitized request info only
      const sanitizedBody = this.sanitizeObject(body);
      this.logger.log(`${method} ${url} - Request (sanitized): ${JSON.stringify(sanitizedBody)}`);
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          const duration = Date.now() - now;
          
          if (isSensitivePath) {
            // Log sanitized response
            const sanitizedResponse = this.sanitizeObject(response);
            this.logger.log(`${method} ${url} - Response (sanitized) [${duration}ms]: ${JSON.stringify(sanitizedResponse)}`);
          }
        },
        error: (error) => {
          const duration = Date.now() - now;
          // Log error without sensitive details
          this.logger.error(
            `${method} ${url} - Error [${duration}ms]: ${error.message}`,
            error.stack
          );
        },
      })
    );
  }

  /**
   * Recursively sanitize an object, replacing sensitive fields with [REDACTED]
   */
  private sanitizeObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (this.sensitiveFields.includes(key)) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
      
      return sanitized;
    }

    return obj;
  }
}
