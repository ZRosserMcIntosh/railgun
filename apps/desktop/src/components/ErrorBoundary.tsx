/**
 * Error Boundary Component
 * 
 * Week 5-6 Client Polish: Graceful error handling in the UI
 * 
 * DOCTRINE COMPLIANCE:
 * - Principle 7: Minimal Metadata - Error reports scrubbed
 * - User-friendly error display
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Generate a simple error ID for reference
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console in development
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);

    // Call optional error handler
    this.props.onError?.(error, errorInfo);

    // Report to Sentry if available
    try {
      // Dynamic import to avoid breaking if sentry not installed
      import('../lib/sentry').then(({ reportError }) => {
        reportError(error, {
          componentStack: errorInfo.componentStack,
          errorId: this.state.errorId,
        });
      }).catch(() => {
        // Sentry not available, that's fine
      });
    } catch {
      // Ignore sentry errors
    }
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorId: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="text-center max-w-md">
            {/* Error Icon */}
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            {/* Error Message */}
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Something went wrong
            </h2>
            <p className="text-text-secondary mb-6">
              An unexpected error occurred. This has been reported automatically.
            </p>

            {/* Error ID */}
            {this.state.errorId && (
              <p className="text-xs text-text-muted mb-6 font-mono bg-surface-tertiary rounded px-3 py-2">
                Error ID: {this.state.errorId}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-center">
              <Button variant="secondary" onClick={this.handleRetry}>
                Try Again
              </Button>
              <Button onClick={this.handleReload}>
                Reload App
              </Button>
            </div>

            {/* Technical Details (collapsed by default) */}
            <details className="mt-6 text-left">
              <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                Technical Details
              </summary>
              <pre className="mt-2 p-3 bg-surface-tertiary rounded text-xs text-text-muted overflow-auto max-h-32 font-mono">
                {this.state.error?.message || 'Unknown error'}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component for wrapping with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

/**
 * Inline error boundary for smaller components
 */
export function InlineErrorBoundary({ 
  children, 
  message = 'Failed to load' 
}: { 
  children: ReactNode; 
  message?: string;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 text-center text-text-muted text-sm">
          <span className="text-red-400">⚠️</span> {message}
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
