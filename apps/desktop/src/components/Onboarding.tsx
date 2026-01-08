/**
 * Onboarding Flow Component
 * 
 * Week 5-6 Client Polish: First-run experience for new users
 * Guides users through key setup, backup, and privacy features.
 * 
 * DOCTRINE COMPLIANCE:
 * - Principle 3: User Keys, User Data - Educates about local key storage
 * - Principle 7: Minimal Metadata - Explains privacy-first approach
 */

import { useState, useEffect } from 'react';
import { Button } from './ui';
import railgunLogo from '../assets/railgun-logo.png';

interface OnboardingProps {
  onComplete: () => void;
  recoveryCodes?: string[];
}

type OnboardingStep = 'welcome' | 'privacy' | 'keys' | 'backup' | 'complete';

const ONBOARDING_STEPS: OnboardingStep[] = ['welcome', 'privacy', 'keys', 'backup', 'complete'];

export default function Onboarding({ onComplete, recoveryCodes }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [codesBackedUp, setCodesBackedUp] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const currentIndex = ONBOARDING_STEPS.indexOf(currentStep);
  const progress = ((currentIndex + 1) / ONBOARDING_STEPS.length) * 100;

  const goNext = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < ONBOARDING_STEPS.length) {
      setCurrentStep(ONBOARDING_STEPS[nextIndex]);
    }
  };

  const goBack = () => {
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(ONBOARDING_STEPS[prevIndex]);
    }
  };

  const handleCopyCodes = async () => {
    if (recoveryCodes) {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    }
  };

  const handleDownloadCodes = () => {
    if (recoveryCodes) {
      const content = `RAIL GUN RECOVERY CODES
========================
KEEP THESE CODES SAFE - THEY ARE YOUR ONLY WAY TO RECOVER YOUR ACCOUNT

${recoveryCodes.map((code, i) => `${i + 1}. ${code}`).join('\n')}

========================
Generated: ${new Date().toISOString()}
WARNING: Each code can only be used once. Store securely offline.`;

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'railgun-recovery-codes.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setCodesBackedUp(true);
    }
  };

  return (
    <div className="fixed inset-0 bg-surface-primary z-50 flex items-center justify-center">
      <div className="w-full max-w-xl p-8">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="h-1 bg-surface-tertiary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-text-muted">
            <span>Step {currentIndex + 1} of {ONBOARDING_STEPS.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-surface-secondary rounded-xl p-8 shadow-xl min-h-[400px] flex flex-col">
          {currentStep === 'welcome' && (
            <WelcomeStep onNext={goNext} />
          )}
          
          {currentStep === 'privacy' && (
            <PrivacyStep onNext={goNext} onBack={goBack} />
          )}
          
          {currentStep === 'keys' && (
            <KeysStep onNext={goNext} onBack={goBack} />
          )}
          
          {currentStep === 'backup' && (
            <BackupStep 
              recoveryCodes={recoveryCodes}
              codesBackedUp={codesBackedUp}
              copiedCodes={copiedCodes}
              onCopy={handleCopyCodes}
              onDownload={handleDownloadCodes}
              onNext={goNext}
              onBack={goBack}
            />
          )}
          
          {currentStep === 'complete' && (
            <CompleteStep onFinish={onComplete} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step Components
// ============================================================================

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <img 
        src={railgunLogo} 
        alt="Rail Gun" 
        className="w-24 h-24 mb-6"
      />
      <h1 className="text-3xl font-bold text-text-primary mb-4">
        Welcome to Rail Gun
      </h1>
      <p className="text-text-secondary mb-8 max-w-md">
        Sovereign communication. Your keys, your data, your rules.
        Let's get you set up in just a few steps.
      </p>
      <Button size="lg" onClick={onNext}>
        Get Started
      </Button>
    </div>
  );
}

function PrivacyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Privacy First</h2>
            <p className="text-sm text-text-muted">How Rail Gun protects you</p>
          </div>
        </div>

        <div className="space-y-4">
          <FeatureCard
            icon="🔐"
            title="End-to-End Encryption"
            description="Messages are encrypted on your device. Not even we can read them."
          />
          <FeatureCard
            icon="👤"
            title="Minimal Metadata"
            description="We don't track who you talk to, when, or how often."
          />
          <FeatureCard
            icon="🌐"
            title="No Phone Number Required"
            description="Create an account with just a username. Email is optional."
          />
          <FeatureCard
            icon="💥"
            title="Account Self-Destruct"
            description="Nuke your account at any time. All data is permanently destroyed."
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button className="flex-1" onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}

function KeysStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Your Keys, Your Data</h2>
            <p className="text-sm text-text-muted">Understanding ownership</p>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
          <p className="text-sm text-yellow-500 font-medium mb-2">Important</p>
          <p className="text-sm text-text-secondary">
            Your encryption keys are stored locally on this device. If you lose access 
            to this device AND your recovery codes, your account cannot be recovered.
          </p>
        </div>

        <div className="space-y-4">
          <FeatureCard
            icon="📱"
            title="Device Keys"
            description="Each device has unique keys. Sign in on multiple devices for backup."
          />
          <FeatureCard
            icon="🔑"
            title="Recovery Codes"
            description="One-time codes that can restore access if you lose your password."
          />
          <FeatureCard
            icon="📧"
            title="Optional Email"
            description="Adding email enables password reset but links identity to your account."
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button className="flex-1" onClick={onNext}>Continue</Button>
      </div>
    </div>
  );
}

interface BackupStepProps {
  recoveryCodes?: string[];
  codesBackedUp: boolean;
  copiedCodes: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onNext: () => void;
  onBack: () => void;
}

function BackupStep({ 
  recoveryCodes, 
  codesBackedUp, 
  copiedCodes,
  onCopy, 
  onDownload, 
  onNext, 
  onBack 
}: BackupStepProps) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Backup Your Codes</h2>
            <p className="text-sm text-text-muted">Save your recovery codes now</p>
          </div>
        </div>

        {recoveryCodes && recoveryCodes.length > 0 ? (
          <>
            <div className="bg-surface-tertiary rounded-lg p-4 mb-4 font-mono text-sm">
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code, i) => (
                  <div key={i} className="text-text-primary">
                    <span className="text-text-muted">{i + 1}.</span> {code}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mb-6">
              <Button 
                variant="secondary" 
                className="flex-1"
                onClick={onCopy}
              >
                {copiedCodes ? '✓ Copied!' : 'Copy Codes'}
              </Button>
              <Button 
                variant="secondary" 
                className="flex-1"
                onClick={onDownload}
              >
                Download File
              </Button>
            </div>

            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-sm text-red-500 font-medium mb-2">⚠️ Warning</p>
              <ul className="text-sm text-text-secondary space-y-1">
                <li>• Each code can only be used <strong>once</strong></li>
                <li>• Store codes in a <strong>secure offline location</strong></li>
                <li>• <strong>Never share</strong> these codes with anyone</li>
                <li>• Codes are shown only once - save them now!</li>
              </ul>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-text-muted">
            <p>No recovery codes to display.</p>
            <p className="text-sm mt-2">You can generate new codes in Settings.</p>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button 
          className="flex-1" 
          onClick={onNext}
          disabled={recoveryCodes && recoveryCodes.length > 0 && !codesBackedUp}
        >
          {codesBackedUp || !recoveryCodes?.length ? 'Continue' : 'Save Codes First'}
        </Button>
      </div>
    </div>
  );
}

function CompleteStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-text-primary mb-3">
        You're All Set!
      </h2>
      <p className="text-text-secondary mb-8 max-w-sm">
        Your account is secure and ready to use. Welcome to Rail Gun.
      </p>
      
      <div className="space-y-3 w-full max-w-xs mb-8">
        <QuickTip icon="💬" text="Start a conversation with /dm username" />
        <QuickTip icon="🔒" text="Verify contacts with Safety Numbers" />
        <QuickTip icon="⚙️" text="Customize your experience in Settings" />
      </div>

      <Button size="lg" onClick={onFinish}>
        Start Messaging
      </Button>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex gap-3 p-3 rounded-lg bg-surface-tertiary">
      <span className="text-2xl">{icon}</span>
      <div>
        <h3 className="font-medium text-text-primary text-sm">{title}</h3>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
    </div>
  );
}

function QuickTip({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2 text-left text-sm text-text-secondary">
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
