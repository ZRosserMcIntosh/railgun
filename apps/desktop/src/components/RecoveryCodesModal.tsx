import { useState } from 'react';
import { Button } from './ui';

interface RecoveryCodesModalProps {
  codes: string[];
  onConfirm: () => void;
  title?: string;
  isRotation?: boolean;
}

/**
 * Recovery Codes Modal
 * 
 * Displays recovery codes after registration or rotation.
 * User must acknowledge they have saved the codes before continuing.
 * 
 * SECURITY: Codes are only shown once - user must save them securely.
 */
export default function RecoveryCodesModal({
  codes,
  onConfirm,
  title = 'Save Your Recovery Codes',
  isRotation = false,
}: RecoveryCodesModalProps) {
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAll = async () => {
    const codesText = codes.join('\n');
    await navigator.clipboard.writeText(codesText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const codesText = [
      'Rail Gun Recovery Codes',
      '========================',
      '',
      'IMPORTANT: Keep these codes safe!',
      'Each code can only be used once.',
      'Without these codes and your password, you cannot recover your account.',
      '',
      'Generated: ' + new Date().toISOString(),
      '',
      ...codes.map((code, i) => `${i + 1}. ${code}`),
    ].join('\n');

    const blob = new Blob([codesText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'railgun-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary rounded-lg p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔐</div>
          <h2 className="text-xl font-bold text-text-primary mb-2">{title}</h2>
          <p className="text-text-secondary text-sm">
            {isRotation
              ? 'Your old recovery codes have been invalidated. Save these new codes securely.'
              : 'These codes are your only way to recover your account if you forget your password.'}
          </p>
        </div>

        {/* Warning */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
          <p className="text-yellow-500 text-sm font-medium">
            ⚠️ These codes will only be shown once. We cannot help you if you lose both your password and all of these codes.
          </p>
        </div>

        {/* Recovery Codes Grid */}
        <div className="bg-surface-tertiary rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-2">
            {codes.map((code, index) => (
              <div
                key={index}
                className="bg-surface-primary rounded px-3 py-2 font-mono text-sm text-text-primary text-center"
              >
                {code}
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mb-4">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={handleCopyAll}
          >
            {copied ? '✓ Copied!' : '📋 Copy All'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={handleDownload}
          >
            📥 Download
          </Button>
        </div>

        {/* Confirmation Checkbox */}
        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={hasConfirmed}
            onChange={(e) => setHasConfirmed(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-gray-600 bg-surface-tertiary text-primary-500 focus:ring-primary-500"
          />
          <span className="text-text-secondary text-sm">
            I have saved these recovery codes in a secure location. I understand that without these codes, I cannot recover my account if I forget my password.
          </span>
        </label>

        {/* Continue Button */}
        <Button
          className="w-full"
          size="lg"
          disabled={!hasConfirmed}
          onClick={onConfirm}
        >
          I've Saved My Codes - Continue
        </Button>
      </div>
    </div>
  );
}
