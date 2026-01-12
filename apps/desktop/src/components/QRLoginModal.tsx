import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useQRAuth } from '../lib/qr-auth';
import { useAuthStore } from '../stores/authStore';

/**
 * QRLoginModal
 * 
 * Modal component for QR-based authentication.
 * Displays a QR code that can be scanned by the mobile app to authenticate.
 * 
 * Flow:
 * 1. User opens modal → session created → QR displayed
 * 2. User scans QR with mobile app
 * 3. Mobile app confirms → web receives token
 * 4. User is logged in
 */
interface QRLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated?: (token: string) => void;
}

export function QRLoginModal({ isOpen, onClose, onAuthenticated }: QRLoginModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setTokens = useAuthStore(state => state.setTokens);

  const {
    status,
    qrPayload,
    timeRemaining,
    error,
    startSession,
    cancelSession,
    reset,
  } = useQRAuth({
    clientType: 'desktop',
    onAuthenticated: async (token) => {
      // Store token (using same token for both access and refresh for now)
      await setTokens(token, token);
      onAuthenticated?.(token);
      onClose();
    },
    onError: (error) => {
      console.error('QR Auth error:', error);
    },
  });

  // Start session when modal opens
  useEffect(() => {
    if (isOpen) {
      startSession();
    } else {
      reset();
    }
  }, [isOpen, startSession, reset]);

  // Render QR code when payload changes
  useEffect(() => {
    if (qrPayload && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrPayload, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
    }
  }, [qrPayload]);

  // Handle close
  const handleClose = () => {
    cancelSession();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface-tertiary rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl border border-border">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-text-primary">
            Login with Mobile App
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-center">
          {/* Loading state */}
          {status === 'loading' && (
            <div className="w-64 h-64 flex items-center justify-center bg-surface-primary rounded-lg">
              <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full" />
            </div>
          )}

          {/* QR Code */}
          {(status === 'pending' || status === 'scanned') && (
            <div className="bg-white p-4 rounded-lg">
              <canvas ref={canvasRef} />
            </div>
          )}

          {/* Expired state */}
          {status === 'expired' && (
            <div className="w-64 h-64 flex flex-col items-center justify-center bg-surface-primary rounded-lg text-center p-4">
              <svg className="w-12 h-12 text-status-idle mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-text-primary font-medium">Session Expired</p>
              <button
                onClick={startSession}
                className="mt-4 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="w-64 h-64 flex flex-col items-center justify-center bg-surface-primary rounded-lg text-center p-4">
              <svg className="w-12 h-12 text-status-dnd mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-text-primary font-medium">Error</p>
              <p className="text-text-secondary text-sm mt-1">{error}</p>
              <button
                onClick={startSession}
                className="mt-4 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Status text */}
          <div className="mt-6 text-center">
            {status === 'pending' && (
              <>
                <p className="text-text-primary font-medium">
                  Scan with Rail Gun Mobile
                </p>
                <p className="text-text-secondary text-sm mt-1">
                  Open the app and scan this QR code
                </p>
                {timeRemaining > 0 && (
                  <p className="text-text-muted text-sm mt-2">
                    Expires in {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
                  </p>
                )}
              </>
            )}
            
            {status === 'scanned' && (
              <>
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-pulse w-2 h-2 bg-status-online rounded-full" />
                  <p className="text-status-online font-medium">
                    QR Code Scanned!
                  </p>
                </div>
                <p className="text-text-secondary text-sm mt-1">
                  Confirm the login on your mobile device
                </p>
              </>
            )}

            {status === 'completed' && (
              <div className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 text-status-online" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-status-online font-medium">
                  Authenticated!
                </p>
              </div>
            )}
          </div>

          {/* Help text */}
          <div className="mt-6 pt-6 border-t border-border w-full">
            <p className="text-text-muted text-xs text-center">
              Don't have the mobile app?{' '}
              <a href="https://railgun.app/download" className="text-accent-light hover:underline">
                Download it here
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
