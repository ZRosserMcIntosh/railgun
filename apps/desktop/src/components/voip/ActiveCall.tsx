import { useState, useEffect } from 'react';
import { useVoipStore, CallStatus } from '../../stores/voipStore';

// ==================== Icons ====================

const PhoneIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

const EndCallIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
  </svg>
);

const MicIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>
);

const MicOffIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
  </svg>
);

const SpeakerIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  </svg>
);

const DialpadIcon = () => (
  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const MicMaskIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
  </svg>
);

const MinimizeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// ==================== In-Call Dialpad ====================

interface InCallDialpadProps {
  onDigit: (digit: string) => void;
  onClose: () => void;
}

const InCallDialpad = ({ onDigit, onClose }: InCallDialpadProps) => {
  const dialpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  return (
    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm">
      <div className="grid grid-cols-3 gap-4 mb-8">
        {dialpadKeys.map((digit) => (
          <button
            key={digit}
            onClick={() => onDigit(digit)}
            className="w-16 h-16 rounded-full bg-surface-elevated/80 hover:bg-dark-600/80 text-2xl font-medium text-text-primary transition-colors"
          >
            {digit}
          </button>
        ))}
      </div>
      <button
        onClick={onClose}
        className="text-text-muted hover:text-text-primary transition-colors"
      >
        Close Dialpad
      </button>
    </div>
  );
};

// ==================== Helper Functions ====================

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getStatusText = (status: CallStatus): string => {
  switch (status) {
    case CallStatus.DIALING:
      return 'Dialing...';
    case CallStatus.RINGING:
      return 'Ringing...';
    case CallStatus.CONNECTED:
      return 'Connected';
    case CallStatus.BUSY:
      return 'Busy';
    case CallStatus.NO_ANSWER:
      return 'No Answer';
    case CallStatus.FAILED:
      return 'Failed';
    default:
      return '';
  }
};

// ==================== ActiveCall Component ====================

interface ActiveCallProps {
  minimized?: boolean;
  onToggleMinimize?: () => void;
}

export const ActiveCall = ({ minimized = false, onToggleMinimize }: ActiveCallProps) => {
  const { activeCall, endCall, toggleMute, toggleSpeaker, toggleVoiceMaskInCall, sendDTMF } = useVoipStore();
  const [callDuration, setCallDuration] = useState(0);
  const [showDialpad, setShowDialpad] = useState(false);

  // Call duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (activeCall && activeCall.status === CallStatus.CONNECTED) {
      interval = setInterval(() => {
        const duration = Math.floor((Date.now() - activeCall.startTime) / 1000);
        setCallDuration(duration);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeCall?.status, activeCall?.startTime]);

  if (!activeCall) return null;

  // Minimized view (small floating widget)
  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 bg-surface-primary rounded-lg shadow-xl border border-dark-700 p-4 flex items-center gap-4 min-w-[300px] z-50">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-text-primary font-medium">{activeCall.displayNumber}</span>
            {activeCall.anonymous && (
              <span className="text-green-500" title="Anonymous call">
                <ShieldIcon />
              </span>
            )}
            {activeCall.voiceMaskEnabled && (
              <span className="text-purple-500" title="Voice masked">
                <MicMaskIcon />
              </span>
            )}
          </div>
          <div className="text-sm text-text-muted">
            {activeCall.status === CallStatus.CONNECTED
              ? formatDuration(callDuration)
              : getStatusText(activeCall.status)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeCall.status === CallStatus.CONNECTED && (
            <button
              onClick={toggleMute}
              className={`p-2 rounded-full transition-colors ${
                activeCall.isMuted
                  ? 'bg-red-600 text-white'
                  : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
              }`}
              title={activeCall.isMuted ? 'Unmute' : 'Mute'}
              aria-label={activeCall.isMuted ? 'Unmute' : 'Mute'}
            >
              {activeCall.isMuted ? <MicOffIcon /> : <MicIcon />}
            </button>
          )}

          <button
            onClick={endCall}
            className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
            title="End call"
            aria-label="End call"
          >
            <EndCallIcon />
          </button>

          {onToggleMinimize && (
            <button
              onClick={onToggleMinimize}
              className="p-2 text-text-muted hover:text-text-primary transition-colors"
              title="Expand"
              aria-label="Expand call view"
            >
              <MinimizeIcon />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full screen view
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-dark-900 to-dark-800 flex flex-col items-center justify-between py-12 z-50">
      {/* Call Info */}
      <div className="text-center">
        {activeCall.anonymous && (
          <div className="flex items-center justify-center gap-2 text-green-500 mb-2">
            <ShieldIcon />
            <span className="text-sm">Anonymous Call (*67)</span>
          </div>
        )}

        {activeCall.voiceMaskEnabled && (
          <div className="flex items-center justify-center gap-2 text-purple-500 mb-4">
            <MicMaskIcon />
            <span className="text-sm">Voice Masked</span>
          </div>
        )}
        
        <h2 className="text-3xl font-light text-text-primary mb-2">
          {activeCall.displayNumber}
        </h2>
        
        <div className="text-lg text-text-muted">
          {activeCall.status === CallStatus.CONNECTED ? (
            <span className="text-green-500">{formatDuration(callDuration)}</span>
          ) : (
            <span className="animate-pulse">{getStatusText(activeCall.status)}</span>
          )}
        </div>
      </div>

      {/* Call Animation */}
      <div className="relative">
        <div className="w-32 h-32 rounded-full bg-surface-elevated flex items-center justify-center">
          <PhoneIcon />
        </div>
        {(activeCall.status === CallStatus.DIALING || activeCall.status === CallStatus.RINGING) && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-primary-500 animate-ping opacity-25" />
            <div className="absolute -inset-4 rounded-full border border-primary-500/50 animate-pulse" />
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center gap-8">
        {/* Secondary Controls */}
        {activeCall.status === CallStatus.CONNECTED && (
          <div className="flex items-center gap-6">
            {/* Mute */}
            <button
              onClick={toggleMute}
              className={`flex flex-col items-center gap-2 ${
                activeCall.isMuted ? 'text-red-500' : 'text-text-secondary hover:text-text-primary'
              }`}
              title={activeCall.isMuted ? 'Unmute' : 'Mute'}
            >
              <div className={`p-4 rounded-full ${activeCall.isMuted ? 'bg-red-600/20' : 'bg-surface-elevated'}`}>
                {activeCall.isMuted ? <MicOffIcon /> : <MicIcon />}
              </div>
              <span className="text-xs">{activeCall.isMuted ? 'Unmute' : 'Mute'}</span>
            </button>

            {/* Speaker */}
            <button
              onClick={toggleSpeaker}
              className={`flex flex-col items-center gap-2 ${
                activeCall.isSpeakerOn ? 'text-primary-500' : 'text-text-secondary hover:text-text-primary'
              }`}
              title={activeCall.isSpeakerOn ? 'Speaker Off' : 'Speaker On'}
            >
              <div className={`p-4 rounded-full ${activeCall.isSpeakerOn ? 'bg-primary-600/20' : 'bg-surface-elevated'}`}>
                <SpeakerIcon />
              </div>
              <span className="text-xs">{activeCall.isSpeakerOn ? 'Speaker' : 'Speaker'}</span>
            </button>

            {/* Dialpad */}
            <button
              onClick={() => setShowDialpad(true)}
              className="flex flex-col items-center gap-2 text-text-secondary hover:text-text-primary"
              title="Dialpad"
            >
              <div className="p-4 rounded-full bg-surface-elevated">
                <DialpadIcon />
              </div>
              <span className="text-xs">Dialpad</span>
            </button>

            {/* Voice Mask Toggle */}
            <button
              onClick={toggleVoiceMaskInCall}
              className={`flex flex-col items-center gap-2 ${
                activeCall.voiceMaskEnabled ? 'text-purple-500' : 'text-text-secondary hover:text-text-primary'
              }`}
              title={activeCall.voiceMaskEnabled ? 'Disable Voice Mask' : 'Enable Voice Mask'}
            >
              <div className={`p-4 rounded-full ${activeCall.voiceMaskEnabled ? 'bg-purple-600/20' : 'bg-surface-elevated'}`}>
                <MicMaskIcon />
              </div>
              <span className="text-xs">{activeCall.voiceMaskEnabled ? 'Masked' : 'Mask'}</span>
            </button>
          </div>
        )}

        {/* End Call Button */}
        <button
          onClick={endCall}
          className="p-5 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors shadow-lg"
          title="End call"
          aria-label="End call"
        >
          <EndCallIcon />
        </button>

        {/* Minimize Button */}
        {onToggleMinimize && (
          <button
            onClick={onToggleMinimize}
            className="text-text-muted hover:text-text-primary transition-colors flex items-center gap-2"
          >
            <MinimizeIcon />
            <span className="text-sm">Minimize</span>
          </button>
        )}
      </div>

      {/* In-call Dialpad Overlay */}
      {showDialpad && (
        <InCallDialpad
          onDigit={sendDTMF}
          onClose={() => setShowDialpad(false)}
        />
      )}
    </div>
  );
};

export default ActiveCall;
