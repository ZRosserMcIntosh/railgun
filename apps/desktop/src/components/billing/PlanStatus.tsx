/**
 * Rail Gun Pro - Plan Status Component
 * 
 * Displays current subscription status in settings.
 * Shows plan type, expiration, and options to upgrade/manage.
 */

import { useState, useCallback, useRef } from 'react';
import {
  useBillingStore,
  useIsPro,
  useSubscriptionInfo,
} from '../../stores/billingStore';
import {
  PRO_PRICING,
  getProBenefits,
} from '../../billing';
import Button from '../ui/Button';

// ============================================================================
// ICONS
// ============================================================================

const CrownIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l3.5 7L12 6l3.5 4L19 3M5 3v18h14V3M5 21h14" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const WarningIcon = () => (
  <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

const UploadIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

export function PlanStatus() {
  const isPro = useIsPro();
  const subscriptionInfo = useSubscriptionInfo();
  const { openPaywall, exportToken, importToken, isLoading } = useBillingStore();
  
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportedToken, setExportedToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export token
  const handleExport = useCallback(async () => {
    const token = await exportToken();
    if (token) {
      setExportedToken(token);
      setShowExportModal(true);
    }
  }, [exportToken]);

  // Copy token to clipboard
  const handleCopyToken = useCallback(async () => {
    if (exportedToken) {
      try {
        await navigator.clipboard.writeText(exportedToken);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = exportedToken;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      }
    }
  }, [exportedToken]);

  // Download token as file
  const handleDownloadToken = useCallback(() => {
    if (exportedToken) {
      const blob = new Blob([exportedToken], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'railgun_pro.railgun-token';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [exportedToken]);

  // Import token
  const handleImport = useCallback(async () => {
    if (!tokenInput.trim()) {
      setImportError('Please enter a token');
      return;
    }
    
    setImportError(null);
    const result = await importToken(tokenInput.trim());
    
    if (result.success) {
      setShowImportModal(false);
      setTokenInput('');
    } else {
      setImportError(result.errorMessage || 'Failed to import token');
    }
  }, [tokenInput, importToken]);

  // Import from file
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      setTokenInput(text.trim());
      setImportError(null);
    } catch {
      setImportError('Failed to read file');
    }
  }, []);

  const benefits = getProBenefits();

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className={`rounded-xl p-6 ${isPro ? 'bg-gradient-to-r from-primary-600/20 to-primary-500/10 border border-primary-500/30' : 'bg-surface-elevated border border-dark-600'}`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isPro ? 'bg-primary-500/20 text-primary-400' : 'bg-dark-600 text-text-secondary'}`}>
              <CrownIcon />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                {isPro ? 'Rail Gun Pro' : 'Free Plan'}
              </h3>
              {isPro && subscriptionInfo.billingPeriod && (
                <p className="text-sm text-text-secondary">
                  {subscriptionInfo.billingPeriod === 'monthly' ? 'Monthly' : 'Annual'} subscription
                </p>
              )}
            </div>
          </div>
          
          {isPro && (
            <span className="px-3 py-1 bg-primary-500/20 text-primary-400 text-xs font-medium rounded-full">
              Active
            </span>
          )}
        </div>

        {/* Expiration info for Pro */}
        {isPro && subscriptionInfo.expiresAt && (
          <div className={`flex items-center gap-2 mb-4 p-3 rounded-lg ${
            subscriptionInfo.isExpiringSoon 
              ? 'bg-yellow-500/10 border border-yellow-500/30' 
              : 'bg-surface-primary'
          }`}>
            {subscriptionInfo.isExpiringSoon && <WarningIcon />}
            <span className="text-sm text-text-secondary">
              {subscriptionInfo.isExpiringSoon 
                ? `Expires in ${subscriptionInfo.daysRemaining} days` 
                : `Expires ${subscriptionInfo.expiresAt}`}
            </span>
          </div>
        )}

        {/* Benefits list */}
        <div className="space-y-2 mb-6">
          {(isPro ? benefits : benefits.slice(0, 2)).map((benefit) => (
            <div key={benefit.capability} className="flex items-center gap-2">
              <CheckIcon />
              <span className="text-sm text-text-secondary">{benefit.description}</span>
            </div>
          ))}
          {!isPro && (
            <p className="text-xs text-text-muted mt-2">
              + {benefits.length - 2} more features with Pro
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          {!isPro ? (
            <>
              <Button variant="primary" onClick={() => openPaywall()}>
                Upgrade to Pro
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2"
              >
                <UploadIcon />
                Import Token
              </Button>
            </>
          ) : (
            <>
              <Button 
                variant="secondary" 
                onClick={handleExport}
                className="flex items-center gap-2"
              >
                <DownloadIcon />
                Export Token
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2"
              >
                <UploadIcon />
                Import Token
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Pricing info for free users */}
      {!isPro && (
        <div className="bg-surface-elevated rounded-lg p-4">
          <p className="text-sm text-text-secondary mb-2">
            Pro pricing:
          </p>
          <div className="flex gap-4 text-sm">
            <span className="text-text-primary font-medium">
              ${PRO_PRICING.MONTHLY_PRICE}/mo
            </span>
            <span className="text-text-muted">or</span>
            <span className="text-text-primary font-medium">
              ${PRO_PRICING.ANNUAL_PRICE}/yr
            </span>
            <span className="text-green-500 text-xs">(save ~17%)</span>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && exportedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-primary rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Export Pro Token
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Save this token to transfer your subscription to another device or as a backup.
            </p>
            
            <div className="bg-surface-elevated rounded-lg p-3 mb-4 font-mono text-xs text-text-primary break-all max-h-24 overflow-y-auto">
              {exportedToken}
            </div>
            
            <div className="flex gap-3">
              <Button 
                variant="primary"
                onClick={handleCopyToken}
                className="flex-1"
              >
                {copySuccess ? 'Copied!' : 'Copy'}
              </Button>
              <Button 
                variant="secondary"
                onClick={handleDownloadToken}
                className="flex-1 flex items-center justify-center gap-2"
              >
                <DownloadIcon />
                Download
              </Button>
            </div>
            
            <button
              onClick={() => {
                setShowExportModal(false);
                setExportedToken(null);
              }}
              className="w-full mt-4 text-center text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-primary rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Import Pro Token
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Token String
                </label>
                <textarea
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="RAILGUN_PRO_V1.xxxxx.yyyyy"
                  className="w-full h-24 px-3 py-2 bg-surface-elevated border border-dark-600 rounded-lg text-text-primary placeholder-text-muted text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".railgun-token,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                  aria-label="Import token file"
                  title="Select a token file to import"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2"
                >
                  <UploadIcon />
                  From File
                </Button>
              </div>
              
              {importError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
                  {importError}
                </div>
              )}
              
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  onClick={handleImport}
                  loading={isLoading}
                  disabled={!tokenInput.trim()}
                  className="flex-1"
                >
                  Import
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowImportModal(false);
                    setTokenInput('');
                    setImportError(null);
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlanStatus;
