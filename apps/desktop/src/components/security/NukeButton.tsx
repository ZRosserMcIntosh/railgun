import { useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { SecureWipeService, WipeProgress } from '../../lib/secureWipe';
import nuclearSymbol from '../../assets/nuclear-symbol.png';

// Note: Inline styles used for dynamic progress bar - this is intentional

// ==================== Types ====================

interface NukeButtonProps {
  className?: string;
}

type NukeStage = 'idle' | 'armed' | 'confirming' | 'nuking' | 'complete';

// ==================== NukeButton Component ====================

export const NukeButton = ({ className = '' }: NukeButtonProps) => {
  const { logout } = useAuthStore();
  const [stage, setStage] = useState<NukeStage>('idle');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [wipeProgress, setWipeProgress] = useState<WipeProgress | null>(null);

  const REQUIRED_CONFIRM_TEXT = 'NUKE IT';

  // Toggle safety - single click to arm/disarm
  const toggleSafety = useCallback(() => {
    if (stage === 'idle') {
      setStage('armed');
    } else if (stage === 'armed') {
      setStage('idle');
    }
  }, [stage]);

  // Initiate the nuke sequence
  const initiateNuke = useCallback(() => {
    if (stage !== 'armed') return;
    setStage('confirming');
    setConfirmText('');
  }, [stage]);

  // Cancel and reset everything
  const cancelNuke = useCallback(() => {
    setStage('idle');
    setConfirmText('');
    setError(null);
    setCountdown(5);
  }, []);

  // Execute the actual nuke - MILITARY GRADE DESTRUCTION
  const executeNuke = useCallback(async () => {
    if (confirmText !== REQUIRED_CONFIRM_TEXT) {
      setError(`Type "${REQUIRED_CONFIRM_TEXT}" to confirm`);
      return;
    }

    setStage('nuking');
    setError(null);

    // Countdown before actual deletion
    for (let i = 5; i > 0; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }

    try {
      // Initialize the secure wipe service
      const wipeService = new SecureWipeService();
      
      // Execute military-grade secure deletion
      // This performs DoD 5220.22-M + Gutmann 35-pass patterns (100 total passes)
      await wipeService.executeNuke({
        method: 'railgun', // Maximum paranoia - 100 passes
        verifyOverwrite: true,
        destroyLocalKeys: true,
        destroyRemoteKeys: true,
        wipeLocalStorage: true,
        wipeIndexedDB: true,
        wipeSessionStorage: true,
        overwriteCount: 100,
        onProgress: (progress) => {
          setWipeProgress(progress);
        }
      });
      
      setStage('complete');
      
      // Logout and redirect after showing completion
      setTimeout(() => {
        logout();
        // Force hard reload to clear any cached state
        window.location.href = '/login';
      }, 3000);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to nuke account');
      setStage('armed');
    }
  }, [confirmText, logout]);

  // Idle state - just show the radioactive icon
  if (stage === 'idle') {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={toggleSafety}
          className="p-2 rounded-lg bg-dark-800/50 hover:bg-dark-700/80 transition-all group relative"
          title="Account Destruction"
          aria-label="Arm account destruction"
        >
          <img 
            src={nuclearSymbol} 
            alt="Nuclear symbol" 
            className="w-8 h-8 opacity-50 group-hover:opacity-70 transition-opacity"
          />
        </button>
      </div>
    );
  }

  // Armed state - show safety toggle and nuke button
  if (stage === 'armed') {
    return (
      <div className={`fixed bottom-20 right-4 z-50 ${className}`}>
        <div className="bg-dark-900 border-2 border-red-600/50 rounded-lg p-4 w-80 shadow-2xl animate-pulse-slow">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <img 
                src={nuclearSymbol} 
                alt="Nuclear symbol" 
                className="w-10 h-10 animate-pulse"
              />
              <div>
                <span className="text-red-500 font-bold text-lg">ARMED</span>
                <p className="text-xs text-yellow-500">Safety disengaged</p>
              </div>
            </div>
            <button
              onClick={cancelNuke}
              className="text-text-muted hover:text-text-primary text-xs font-bold"
            >
              ✕
            </button>
          </div>

          {/* Warning */}
          <div className="bg-red-950/30 border border-red-900/50 rounded p-3 mb-4">
            <p className="text-xs text-red-300">
              ⚠️ This will <span className="text-red-500 font-bold">permanently destroy</span> your 
              account, all messages, keys, and data. This action is <span className="text-red-500 font-bold">IRREVERSIBLE</span>.
            </p>
          </div>

          {/* Safety Toggle */}
          <div className="mb-4">
            <div className="flex items-center justify-between p-3 bg-dark-800 rounded-lg border border-yellow-600/30">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
                <span className="text-yellow-500 font-mono text-sm">SAFETY: OFF</span>
              </div>
              <button
                onClick={toggleSafety}
                className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded transition-colors"
              >
                RE-ENGAGE
              </button>
            </div>
          </div>

          {/* Nuke Button */}
          <button
            onClick={initiateNuke}
            className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-lg rounded-lg transition-all flex items-center justify-center gap-2 border-2 border-red-400"
          >
            <img src={nuclearSymbol} alt="Nuclear symbol" className="w-6 h-6" />
            INITIATE DESTRUCTION
            <img src={nuclearSymbol} alt="Nuclear symbol" className="w-6 h-6" />
          </button>
        </div>
      </div>
    );
  }

  // Confirming state - require text confirmation
  if (stage === 'confirming') {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="bg-dark-900 border-2 border-red-600 rounded-lg p-6 w-96 shadow-2xl">
          {/* Nuclear symbol animation */}
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 rounded-full bg-red-900/50 flex items-center justify-center animate-pulse">
              <img src={nuclearSymbol} alt="Nuclear symbol" className="w-12 h-12" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-red-500 text-center mb-2">
            ☢️ FINAL CONFIRMATION ☢️
          </h2>
          
          <p className="text-sm text-text-muted text-center mb-4">
            You are about to <span className="text-red-500 font-bold">permanently destroy</span> your account.
            All data will be wiped from existence. There is <span className="text-red-500 font-bold">NO RECOVERY</span>.
          </p>

          <div className="bg-dark-800 rounded-lg p-3 mb-4">
            <p className="text-xs text-text-muted mb-2">Type <span className="text-red-500 font-mono font-bold">{REQUIRED_CONFIRM_TEXT}</span> to confirm:</p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="Type here..."
              className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded text-text-primary 
                         focus:outline-none focus:border-red-500 font-mono"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 text-center mb-4">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={cancelNuke}
              className="flex-1 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-text-primary transition-colors"
            >
              ABORT
            </button>
            <button
              onClick={executeNuke}
              disabled={confirmText !== REQUIRED_CONFIRM_TEXT}
              className={`flex-1 py-2 rounded-lg font-bold transition-all ${
                confirmText === REQUIRED_CONFIRM_TEXT
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-dark-700 text-text-muted cursor-not-allowed'
              }`}
            >
              ☢️ NUKE IT ☢️
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Nuking state - military-grade destruction with detailed progress
  if (stage === 'nuking') {
    const progressPercent = wipeProgress?.percentComplete || 0;
    const currentPhase = wipeProgress?.phase || 'initializing';
    const currentOp = wipeProgress?.currentOperation || 'Initializing secure wipe...';
    const currentPass = wipeProgress?.currentPass || 0;
    const totalPasses = wipeProgress?.totalPasses || 100;
    
    // Phase display names
    const phaseNames: Record<string, string> = {
      'initializing': '🔧 INITIALIZING',
      'key_destruction': '🔑 DESTROYING KEYS',
      'overwrite_pass': '💾 OVERWRITING DATA',
      'memory_wipe': '🧠 WIPING MEMORY',
      'server_nuke': '☁️ SERVER DESTRUCTION',
      'verification': '✓ VERIFYING DESTRUCTION',
      'metadata_scrub': '🧹 SCRUBBING METADATA',
      'final_purge': '🔥 FINAL PURGE',
      'complete': '✅ COMPLETE'
    };

    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
        <div className="text-center max-w-md px-4">
          {/* Countdown phase */}
          {countdown > 0 ? (
            <>
              <img src={nuclearSymbol} alt="Nuclear symbol" className="w-32 h-32 mx-auto animate-spin" />
              <h2 className="text-4xl font-bold text-red-500 mt-6 animate-pulse">
                NUKING IN {countdown}...
              </h2>
              <p className="text-text-muted mt-2">Preparing for total destruction...</p>
            </>
          ) : (
            <>
              {/* Active destruction phase */}
              <img src={nuclearSymbol} alt="Nuclear symbol" className="w-24 h-24 mx-auto animate-pulse" />
              
              <h2 className="text-2xl font-bold text-red-500 mt-4">
                {phaseNames[currentPhase] || currentPhase.toUpperCase()}
              </h2>
              
              <p className="text-text-secondary mt-2 font-mono text-sm truncate">
                {currentOp}
              </p>
              
              {/* Pass counter */}
              <div className="mt-4 text-text-muted text-sm">
                Pass <span className="text-red-400 font-bold">{currentPass}</span> / {totalPasses}
              </div>
              
              {/* Progress bar */}
              <div className="mt-4 w-full h-3 bg-dark-800 rounded-full overflow-hidden border border-red-900">
                <div
                  className="h-full bg-gradient-to-r from-red-700 via-red-500 to-orange-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              
              <p className="text-red-400 text-xs mt-2 font-mono">
                {progressPercent.toFixed(1)}% DESTROYED
              </p>
              
              {/* Destruction stats */}
              <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
                <div className="bg-dark-900 border border-red-900/30 rounded p-2">
                  <div className="text-text-muted">Bytes Destroyed</div>
                  <div className="text-red-400 font-mono">
                    {(wipeProgress?.bytesDestroyed || 0).toLocaleString()}
                  </div>
                </div>
                <div className="bg-dark-900 border border-red-900/30 rounded p-2">
                  <div className="text-text-muted">Time Remaining</div>
                  <div className="text-red-400 font-mono">
                    {Math.ceil((wipeProgress?.estimatedTimeRemaining || 0) / 1000)}s
                  </div>
                </div>
              </div>
              
              {/* Warning text */}
              <p className="text-red-600/70 text-xs mt-6 animate-pulse">
                ⚠️ DO NOT CLOSE THIS WINDOW ⚠️
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Complete state
  if (stage === 'complete') {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
        <div className="text-center">
          <div className="text-8xl mb-6">💀</div>
          <h2 className="text-3xl font-bold text-red-500">ACCOUNT DESTROYED</h2>
          <p className="text-green-400 mt-2 font-mono">
            ✓ All data overwritten {wipeProgress?.totalPasses || 100}x
          </p>
          <p className="text-green-400 font-mono">
            ✓ Encryption keys shredded
          </p>
          <p className="text-green-400 font-mono">
            ✓ Server records purged
          </p>
          <p className="text-text-muted mt-4">Redirecting...</p>
        </div>
      </div>
    );
  }

  return null;
};

export default NukeButton;
