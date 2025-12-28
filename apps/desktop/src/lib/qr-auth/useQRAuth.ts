import { useState, useEffect, useCallback, useRef } from 'react';
import {
  QRAuthSessionStatus,
  CreateSessionResponse,
  SessionStatusResponse,
  TokenExchangeResponse,
} from '@railgun/shared';

const API_BASE_URL = 'http://localhost:3001/api/v1';
const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

/**
 * Hook state
 */
export interface QRAuthState {
  /** Current status of the auth flow */
  status: 'idle' | 'loading' | 'pending' | 'scanned' | 'completed' | 'error' | 'expired';
  /** QR code payload to display (JSON string for QR encoding) */
  qrPayload: string | null;
  /** Session ID */
  sessionId: string | null;
  /** Time remaining until expiry (seconds) */
  timeRemaining: number;
  /** JWT token after successful auth */
  token: string | null;
  /** Error message if any */
  error: string | null;
}

/**
 * Hook return type
 */
export interface UseQRAuthReturn extends QRAuthState {
  /** Start a new auth session */
  startSession: () => Promise<void>;
  /** Cancel the current session */
  cancelSession: () => Promise<void>;
  /** Reset state to idle */
  reset: () => void;
}

/**
 * useQRAuth
 * 
 * React hook for QR-based authentication flow.
 * 
 * Usage:
 * ```tsx
 * const { status, qrPayload, timeRemaining, token, startSession, cancelSession } = useQRAuth({
 *   onAuthenticated: (token) => {
 *     // Store token, redirect, etc.
 *   },
 * });
 * 
 * return (
 *   <div>
 *     <button onClick={startSession}>Login with QR</button>
 *     {status === 'pending' && <QRCode value={qrPayload} />}
 *     {status === 'scanned' && <p>Scanned! Confirming...</p>}
 *     {timeRemaining > 0 && <p>Expires in {timeRemaining}s</p>}
 *   </div>
 * );
 * ```
 */
export function useQRAuth(options?: {
  onAuthenticated?: (token: string) => void;
  onError?: (error: string) => void;
  clientType?: 'web' | 'desktop';
}): UseQRAuthReturn {
  const { onAuthenticated, onError, clientType = 'desktop' } = options ?? {};

  const [state, setState] = useState<QRAuthState>({
    status: 'idle',
    qrPayload: null,
    sessionId: null,
    timeRemaining: 0,
    token: null,
    error: null,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const expiresAtRef = useRef<Date | null>(null);

  // Cleanup intervals
  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // Update countdown timer
  const updateCountdown = useCallback(() => {
    if (!expiresAtRef.current) return;
    
    const remaining = Math.max(0, Math.floor((expiresAtRef.current.getTime() - Date.now()) / 1000));
    
    setState(prev => {
      if (remaining === 0 && prev.status === 'pending') {
        cleanup();
        return { ...prev, status: 'expired', timeRemaining: 0 };
      }
      return { ...prev, timeRemaining: remaining };
    });
  }, [cleanup]);

  // Poll for session status
  const pollStatus = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/sessions/${sessionId}`);
      
      if (!response.ok) {
        throw new Error('Failed to get session status');
      }

      const data: SessionStatusResponse = await response.json();

      switch (data.status) {
        case QRAuthSessionStatus.SCANNED:
          setState(prev => ({ ...prev, status: 'scanned' }));
          break;

        case QRAuthSessionStatus.COMPLETED:
          // Exchange for token
          const tokenResponse = await fetch(`${API_BASE_URL}/auth/sessions/${sessionId}/exchange`, {
            method: 'POST',
          });
          
          if (!tokenResponse.ok) {
            throw new Error('Failed to exchange session for token');
          }

          const tokenData: TokenExchangeResponse = await tokenResponse.json();
          
          cleanup();
          setState(prev => ({
            ...prev,
            status: 'completed',
            token: tokenData.token,
          }));
          
          onAuthenticated?.(tokenData.token);
          break;

        case QRAuthSessionStatus.EXPIRED:
        case QRAuthSessionStatus.CANCELLED:
          cleanup();
          setState(prev => ({
            ...prev,
            status: data.status === QRAuthSessionStatus.EXPIRED ? 'expired' : 'idle',
          }));
          break;
      }
    } catch (err) {
      console.error('Poll error:', err);
      // Don't stop polling on transient errors
    }
  }, [cleanup, onAuthenticated]);

  // Start a new session
  const startSession = useCallback(async () => {
    cleanup();
    
    setState({
      status: 'loading',
      qrPayload: null,
      sessionId: null,
      timeRemaining: 0,
      token: null,
      error: null,
    });

    try {
      const response = await fetch(`${API_BASE_URL}/auth/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientType }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create session');
      }

      const data: CreateSessionResponse = await response.json();

      expiresAtRef.current = new Date(data.expiresAt);
      const initialRemaining = Math.max(0, Math.floor((expiresAtRef.current.getTime() - Date.now()) / 1000));

      setState({
        status: 'pending',
        qrPayload: data.qrPayload,
        sessionId: data.sessionId,
        timeRemaining: initialRemaining,
        token: null,
        error: null,
      });

      // Start polling
      pollIntervalRef.current = setInterval(() => {
        pollStatus(data.sessionId);
      }, POLL_INTERVAL_MS);

      // Start countdown
      countdownIntervalRef.current = setInterval(updateCountdown, 1000);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({ ...prev, status: 'error', error: message }));
      onError?.(message);
    }
  }, [cleanup, clientType, pollStatus, updateCountdown, onError]);

  // Cancel session
  const cancelSession = useCallback(async () => {
    const { sessionId } = state;
    
    cleanup();

    if (sessionId) {
      try {
        await fetch(`${API_BASE_URL}/auth/sessions/${sessionId}/cancel`, {
          method: 'POST',
        });
      } catch {
        // Ignore cancel errors
      }
    }

    setState({
      status: 'idle',
      qrPayload: null,
      sessionId: null,
      timeRemaining: 0,
      token: null,
      error: null,
    });
  }, [state.sessionId, cleanup]);

  // Reset to idle
  const reset = useCallback(() => {
    cleanup();
    setState({
      status: 'idle',
      qrPayload: null,
      sessionId: null,
      timeRemaining: 0,
      token: null,
      error: null,
    });
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    ...state,
    startSession,
    cancelSession,
    reset,
  };
}
