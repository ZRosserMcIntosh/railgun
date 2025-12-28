/**
 * Rail Gun Pro - Paywall Upsell Modal
 * 
 * Modal displayed when user tries to use a Pro-only feature.
 * Shows pricing, benefits, and token import options.
 */

import { useState, useCallback, useRef } from 'react';
import { useBillingStore, usePaywall } from '../../stores/billingStore';
import {
  PRO_PRICING,
  getProBenefits,
  getCapabilityDescription,
  formatFileSize,
  FREE_TIER_LIMITS,
} from '../../billing';
import Button from '../ui/Button';

// ============================================================================
// ICONS (inline SVG for simplicity)
// ============================================================================

const CheckIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SparklesIcon = () => (
  <svg className="w-8 h-8 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const UploadIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

type TabType = 'pricing' | 'import';

export function ProUpsellModal() {
  const { isOpen, context, close } = usePaywall();
  const { importToken, isLoading, error } = useBillingStore();
  
  const [activeTab, setActiveTab] = useState<TabType>('pricing');
  const [tokenInput, setTokenInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportSubmit = useCallback(async () => {
    if (!tokenInput.trim()) {
      setImportError('Please enter a token');
      return;
    }
    
    setImportError(null);
    const result = await importToken(tokenInput.trim());
    
    if (!result.success) {
      setImportError(result.errorMessage || 'Failed to import token');
    }
    // If success, store will close modal
  }, [tokenInput, importToken]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      setTokenInput(text.trim());
      setActiveTab('import');
      setImportError(null);
    } catch {
      setImportError('Failed to read file');
    }
  }, []);

  const handleOpenPaymentLink = useCallback((period: 'monthly' | 'annual') => {
    // In production, this would open Stripe checkout or payment page
    // For now, open a placeholder URL
    const baseUrl = 'https://railgun.app/pro/checkout';
    const url = `${baseUrl}?plan=${period}`;
    
    // Open in default browser
    window.open(url, '_blank');
  }, []);

  if (!isOpen) return null;

  const benefits = getProBenefits();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-primary rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-primary-600 to-primary-500 px-6 py-8 text-white">
          <button
            onClick={close}
            className="absolute top-4 right-4 p-1 rounded-full hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
          
          <div className="flex items-center gap-3 mb-3">
            <SparklesIcon />
            <h2 className="text-2xl font-bold">Rail Gun Pro</h2>
          </div>
          
          <p className="text-white/90 text-sm">
            Support the network & unlock heavy bandwidth features
          </p>
          
          {/* Context message */}
          {context?.capability && (
            <div className="mt-4 bg-white/10 rounded-lg px-4 py-3 text-sm">
              <span className="font-medium">You tried to use:</span>{' '}
              {getCapabilityDescription(context.capability)}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-600">
          <button
            onClick={() => setActiveTab('pricing')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'pricing'
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Pricing
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'import'
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Import Token
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === 'pricing' ? (
            <div className="space-y-6">
              {/* Benefits */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
                  Pro Features
                </h3>
                <ul className="space-y-2">
                  {benefits.map((benefit) => (
                    <li key={benefit.capability} className="flex items-start gap-3">
                      <CheckIcon />
                      <span className="text-sm text-text-primary">{benefit.description}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Free tier info */}
              <div className="bg-surface-elevated rounded-lg p-4">
                <p className="text-xs text-text-secondary">
                  Free tier includes: text, voice calls, images up to {FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION}px,
                  {' '}videos up to {FREE_TIER_LIMITS.MAX_VIDEO_SECONDS}s, files up to {formatFileSize(FREE_TIER_LIMITS.MAX_FILE_BYTES)}
                </p>
              </div>

              {/* Pricing cards */}
              <div className="grid grid-cols-2 gap-4">
                {/* Monthly */}
                <div className="border border-dark-600 rounded-lg p-4">
                  <div className="text-lg font-bold text-text-primary">
                    ${PRO_PRICING.MONTHLY_PRICE}
                    <span className="text-sm font-normal text-text-secondary">/mo</span>
                  </div>
                  <div className="text-xs text-text-secondary mb-4">Billed monthly</div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => handleOpenPaymentLink('monthly')}
                  >
                    Choose Monthly
                  </Button>
                </div>

                {/* Annual */}
                <div className="border-2 border-primary-500 rounded-lg p-4 relative">
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary-500 text-white text-xs px-2 py-0.5 rounded-full">
                    Save ~17%
                  </div>
                  <div className="text-lg font-bold text-text-primary">
                    ${PRO_PRICING.ANNUAL_PRICE}
                    <span className="text-sm font-normal text-text-secondary">/yr</span>
                  </div>
                  <div className="text-xs text-text-secondary mb-4">
                    ${(PRO_PRICING.ANNUAL_PRICE / 12).toFixed(2)}/mo
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    onClick={() => handleOpenPaymentLink('annual')}
                  >
                    Choose Annual
                  </Button>
                </div>
              </div>

              {/* Alternative payment */}
              <p className="text-center text-xs text-text-secondary">
                Payment options: Card or Crypto
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Already have a Pro token? Import it below to activate your subscription.
              </p>

              {/* Token input */}
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

              {/* File import */}
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
                  Import from File
                </Button>
                <span className="text-xs text-text-muted">.railgun-token or .txt</span>
              </div>

              {/* Error message */}
              {(importError || error) && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
                  {importError || error}
                </div>
              )}

              {/* Submit */}
              <Button
                variant="primary"
                className="w-full"
                onClick={handleImportSubmit}
                loading={isLoading}
                disabled={!tokenInput.trim()}
              >
                Activate Token
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-elevated border-t border-dark-600">
          <button
            onClick={close}
            className="w-full text-center text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Continue with Free
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProUpsellModal;
