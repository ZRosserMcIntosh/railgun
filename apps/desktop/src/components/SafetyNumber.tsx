import { useState } from 'react';

interface SafetyNumberProps {
  ownFingerprint: string;
  peerFingerprint: string;
  peerUsername: string;
  onVerified: () => void;
  onClose: () => void;
}

// Format fingerprint for display (groups of 5 digits)
function formatFingerprint(fingerprint: string): string[][] {
  // Create 12 groups of 5 characters for a 60-char fingerprint
  const groups: string[][] = [];
  const cleaned = fingerprint.replace(/\s/g, '').toUpperCase();
  
  for (let row = 0; row < 3; row++) {
    const rowGroups: string[] = [];
    for (let col = 0; col < 4; col++) {
      const start = (row * 4 + col) * 5;
      rowGroups.push(cleaned.slice(start, start + 5));
    }
    groups.push(rowGroups);
  }
  
  return groups;
}

export default function SafetyNumber({
  ownFingerprint,
  peerFingerprint,
  peerUsername,
  onVerified,
  onClose,
}: SafetyNumberProps) {
  const [showQR, setShowQR] = useState(false);
  const [verified, setVerified] = useState(false);

  // Combine fingerprints for safety number display
  // In Signal, this is done by sorting and concatenating
  const combinedFingerprint = [ownFingerprint, peerFingerprint]
    .sort()
    .join('');
  
  const formattedNumber = formatFingerprint(combinedFingerprint.slice(0, 60));
  // QR data for future use when QR library is integrated
  // const qrData = generateQRData(ownFingerprint, peerFingerprint);

  const handleVerify = () => {
    setVerified(true);
    onVerified();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-primary rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            Verify Safety Number
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
            title="Close"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-sm text-text-muted mb-4">
            To verify end-to-end encryption with <span className="text-text-primary font-medium">{peerUsername}</span>,
            compare the numbers below with their device. You can also scan each other's QR codes.
          </p>

          {/* Toggle view */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setShowQR(false)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                !showQR
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-elevated text-text-muted hover:text-text-primary'
              }`}
            >
              Numbers
            </button>
            <button
              onClick={() => setShowQR(true)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                showQR
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-elevated text-text-muted hover:text-text-primary'
              }`}
            >
              QR Code
            </button>
          </div>

          {showQR ? (
            /* QR Code View */
            <div className="flex flex-col items-center py-4">
              <div className="w-48 h-48 bg-white rounded-lg p-4 flex items-center justify-center">
                {/* Placeholder QR code - in production use a QR library */}
                <div className="w-full h-full border-2 border-dashed border-gray-300 rounded flex items-center justify-center">
                  <span className="text-gray-400 text-xs text-center px-2">
                    QR Code<br/>
                    (requires qrcode library)
                  </span>
                </div>
              </div>
              <p className="text-xs text-text-muted mt-3 text-center">
                Ask your contact to scan this code
              </p>
            </div>
          ) : (
            /* Numbers View */
            <div className="bg-surface-elevated rounded-lg p-4">
              <div className="grid gap-2 font-mono text-lg">
                {formattedNumber.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex justify-center gap-4">
                    {row.map((group, colIndex) => (
                      <span
                        key={colIndex}
                        className="text-text-primary tracking-wider"
                      >
                        {group}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Security info */}
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <div className="flex gap-2">
              <svg className="w-5 h-5 text-yellow-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-yellow-200">
                If these numbers don't match, your connection may be compromised. 
                Do not verify unless you've confirmed the numbers match through a 
                secure channel (in person, video call, etc.).
              </p>
            </div>
          </div>

          {/* Verified status */}
          {verified && (
            <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span className="text-sm text-green-400 font-medium">
                  Safety number verified
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-dark-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-surface-elevated hover:bg-dark-700 text-text-primary rounded-lg font-medium transition-colors"
          >
            Close
          </button>
          {!verified && (
            <button
              onClick={handleVerify}
              className="flex-1 py-2 px-4 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
            >
              Mark as Verified
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
