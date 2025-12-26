import { useState, useEffect, useCallback } from 'react';
import { useVoipStore } from '../../stores/voipStore';

// ==================== Icons ====================

const PhoneIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const BackspaceIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

// ==================== Dialpad Button ====================

interface DialpadButtonProps {
  digit: string;
  letters?: string;
  onClick: () => void;
}

const DialpadButton = ({ digit, letters, onClick }: DialpadButtonProps) => (
  <button
    onClick={onClick}
    className="w-16 h-16 rounded-full bg-surface-elevated hover:bg-dark-600 active:bg-dark-500 transition-colors flex flex-col items-center justify-center"
  >
    <span className="text-2xl font-medium text-text-primary">{digit}</span>
    {letters && (
      <span className="text-xs text-text-muted tracking-widest">{letters}</span>
    )}
  </button>
);

// ==================== VoipDialer Component ====================

export const VoipDialer = () => {
  const {
    dialerInput,
    isAnonymousCall,
    anonymousByDefault,
    activeCall,
    appendDialerInput,
    backspaceDialerInput,
    clearDialerInput,
    toggleAnonymousCall,
    initiateCall,
  } = useVoipStore();

  const [isHoldingBackspace, setIsHoldingBackspace] = useState(false);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      // Number keys
      if (/^[0-9]$/.test(e.key)) {
        appendDialerInput(e.key);
      }
      // * and # keys
      else if (e.key === '*' || e.key === '#') {
        appendDialerInput(e.key);
      }
      // + key (with shift)
      else if (e.key === '+') {
        appendDialerInput('+');
      }
      // Backspace
      else if (e.key === 'Backspace') {
        backspaceDialerInput();
      }
      // Enter to dial
      else if (e.key === 'Enter' && dialerInput) {
        handleCall();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialerInput, appendDialerInput, backspaceDialerInput]);

  // Handle long press backspace for clear
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isHoldingBackspace) {
      timeout = setTimeout(() => {
        clearDialerInput();
        setIsHoldingBackspace(false);
      }, 800);
    }
    return () => clearTimeout(timeout);
  }, [isHoldingBackspace, clearDialerInput]);

  const handleCall = useCallback(() => {
    if (dialerInput && !activeCall) {
      initiateCall(dialerInput);
    }
  }, [dialerInput, activeCall, initiateCall]);

  const dialpadKeys = [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'ABC' },
    { digit: '3', letters: 'DEF' },
    { digit: '4', letters: 'GHI' },
    { digit: '5', letters: 'JKL' },
    { digit: '6', letters: 'MNO' },
    { digit: '7', letters: 'PQRS' },
    { digit: '8', letters: 'TUV' },
    { digit: '9', letters: 'WXYZ' },
    { digit: '*', letters: '' },
    { digit: '0', letters: '+' },
    { digit: '#', letters: '' },
  ];

  return (
    <div className="flex flex-col items-center p-6 bg-surface-primary rounded-lg shadow-lg max-w-xs mx-auto">
      {/* Anonymous Caller ID Toggle */}
      <div className="w-full mb-6">
        <button
          onClick={toggleAnonymousCall}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
            isAnonymousCall
              ? 'bg-green-900/30 border border-green-600'
              : 'bg-surface-elevated border border-dark-600'
          }`}
        >
          <div className="flex items-center gap-3">
            <ShieldIcon />
            <div className="text-left">
              <div className="text-sm font-medium text-text-primary">
                Anonymous (*67)
              </div>
              <div className="text-xs text-text-muted">
                {isAnonymousCall ? 'Caller ID hidden' : 'Caller ID visible'}
              </div>
            </div>
          </div>
          <div
            className={`w-10 h-6 rounded-full transition-colors ${
              isAnonymousCall ? 'bg-green-600' : 'bg-dark-600'
            } relative`}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                isAnonymousCall ? 'left-5' : 'left-1'
              }`}
            />
          </div>
        </button>
        {anonymousByDefault && (
          <p className="text-xs text-text-muted mt-2 text-center">
            Anonymous calling is enabled by default
          </p>
        )}
      </div>

      {/* Number Display */}
      <div className="w-full h-16 flex items-center justify-center mb-4 relative">
        <div className="text-2xl font-light text-text-primary tracking-wider">
          {dialerInput || (
            <span className="text-text-muted">Enter number</span>
          )}
        </div>
        {dialerInput && (
          <button
            onClick={backspaceDialerInput}
            onMouseDown={() => setIsHoldingBackspace(true)}
            onMouseUp={() => setIsHoldingBackspace(false)}
            onMouseLeave={() => setIsHoldingBackspace(false)}
            className="absolute right-0 p-2 text-text-secondary hover:text-text-primary transition-colors"
            title="Backspace (hold to clear)"
            aria-label="Backspace"
          >
            <BackspaceIcon />
          </button>
        )}
      </div>

      {/* Dialpad */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {dialpadKeys.map(({ digit, letters }) => (
          <DialpadButton
            key={digit}
            digit={digit}
            letters={letters}
            onClick={() => appendDialerInput(digit)}
          />
        ))}
      </div>

      {/* Call Button */}
      <button
        onClick={handleCall}
        disabled={!dialerInput || !!activeCall}
        title={isAnonymousCall ? 'Make anonymous call' : 'Make call'}
        aria-label={isAnonymousCall ? 'Make anonymous call' : 'Make call'}
        className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
          dialerInput && !activeCall
            ? 'bg-green-600 hover:bg-green-700 text-white'
            : 'bg-dark-600 text-text-muted cursor-not-allowed'
        }`}
      >
        <PhoneIcon />
      </button>

      {/* Status indicator */}
      {activeCall && (
        <div className="mt-4 text-sm text-primary-400">
          Call in progress...
        </div>
      )}
    </div>
  );
};

export default VoipDialer;
