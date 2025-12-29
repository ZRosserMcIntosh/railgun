/**
 * Identity Key Change Warning Component
 * 
 * Displays a prominent warning when a contact's identity key has changed.
 * This is critical for detecting potential MITM attacks.
 */

import { useState } from 'react';

interface IdentityChangeWarningProps {
  /** Username of the contact whose identity changed */
  username: string;
  
  /** User ID of the contact */
  userId: string;
  
  /** Called when user accepts the new identity (proceed with caution) */
  onAccept: () => void;
  
  /** Called when user wants to verify the new identity */
  onVerify: () => void;
  
  /** Called when user wants to block/report */
  onBlock: () => void;
  
  /** Called to dismiss without action */
  onDismiss: () => void;
}

export function IdentityChangeWarning({
  username,
  userId: _userId,
  onAccept,
  onVerify,
  onBlock,
  onDismiss,
}: IdentityChangeWarningProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-surface-primary rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border-2 border-red-500/50">
        {/* Warning Header */}
        <div className="px-6 py-4 bg-red-500/20 border-b border-red-500/30">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/30 rounded-full">
              <svg 
                className="w-8 h-8 text-red-400" 
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
            <div>
              <h2 className="text-lg font-bold text-red-400">
                Security Warning
              </h2>
              <p className="text-sm text-red-300">
                Identity Key Changed
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-text-primary mb-4">
            <span className="font-semibold">{username}</span>'s security key has changed.
          </p>

          <div className="space-y-3 text-sm text-text-muted">
            <p>
              This could mean:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>They reinstalled the app</li>
              <li>They got a new device</li>
              <li>⚠️ Someone may be intercepting your messages</li>
            </ul>
          </div>

          {/* Expandable Details */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="mt-4 flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-90' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Learn more about this warning
          </button>

          {showDetails && (
            <div className="mt-3 p-3 bg-surface-elevated rounded-lg text-sm text-text-muted">
              <p className="mb-2">
                Rail Gun uses end-to-end encryption with unique identity keys for each user. 
                When someone's key changes, it could indicate a man-in-the-middle attack 
                where an attacker intercepts and relays messages.
              </p>
              <p className="mb-2">
                <strong className="text-text-primary">Recommended:</strong> Contact{' '}
                <span className="text-text-primary">{username}</span> through another channel 
                (phone call, in person) to verify this change is legitimate.
              </p>
              <p>
                You can compare safety numbers to confirm you're talking to the real person.
              </p>
            </div>
          )}

          {/* Previously verified warning */}
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="flex gap-2">
              <svg 
                className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                />
              </svg>
              <p className="text-xs text-yellow-200">
                If you previously verified this contact's safety number, 
                that verification is no longer valid. You should verify again.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-dark-700 space-y-3">
          {/* Primary: Verify */}
          <button
            onClick={onVerify}
            className="w-full py-3 px-4 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Verify Safety Number
          </button>

          {/* Secondary: Accept risk */}
          <button
            onClick={onAccept}
            className="w-full py-2 px-4 bg-surface-elevated hover:bg-dark-700 text-text-muted hover:text-text-primary rounded-lg font-medium transition-colors text-sm"
          >
            Accept and Continue (Not Recommended)
          </button>

          {/* Tertiary: Block */}
          <div className="flex gap-3">
            <button
              onClick={onBlock}
              className="flex-1 py-2 px-4 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors text-sm"
            >
              Block Contact
            </button>
            <button
              onClick={onDismiss}
              className="flex-1 py-2 px-4 bg-surface-elevated hover:bg-dark-700 text-text-muted rounded-lg font-medium transition-colors text-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline warning banner for chat view
 */
interface IdentityChangeBannerProps {
  username: string;
  onVerify: () => void;
  onDismiss: () => void;
}

export function IdentityChangeBanner({
  username,
  onVerify,
  onDismiss,
}: IdentityChangeBannerProps) {
  return (
    <div className="bg-red-500/20 border-b border-red-500/30 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg 
            className="w-5 h-5 text-red-400 flex-shrink-0" 
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
          <span className="text-sm text-red-300">
            <span className="font-medium">{username}</span>'s identity key has changed.
            {' '}
            <button 
              onClick={onVerify}
              className="underline hover:text-red-200 transition-colors"
            >
              Verify safety number
            </button>
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300"
          aria-label="Dismiss warning"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Verified badge component
 */
interface VerifiedBadgeProps {
  verified: boolean;
  onClick?: () => void;
}

export function VerifiedBadge({ verified, onClick }: VerifiedBadgeProps) {
  if (!verified) return null;

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/20 rounded-full text-xs text-green-400 hover:bg-green-500/30 transition-colors"
      title="Identity verified"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" 
        />
      </svg>
      <span>Verified</span>
    </button>
  );
}

export default IdentityChangeWarning;
