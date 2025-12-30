import { create } from 'zustand';

// Simple UUID generator (no external dependency)
const generateId = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// ==================== Types ====================

export enum CallStatus {
  IDLE = 'IDLE',
  DIALING = 'DIALING',
  RINGING = 'RINGING',
  CONNECTED = 'CONNECTED',
  ENDED = 'ENDED',
  FAILED = 'FAILED',
  BUSY = 'BUSY',
  NO_ANSWER = 'NO_ANSWER',
}

export enum CallDirection {
  OUTBOUND = 'OUTBOUND',
  INBOUND = 'INBOUND',
}

export interface CallRecord {
  id: string;
  phoneNumber: string; // Raw number dialed (without *67)
  displayNumber: string; // Formatted display number
  direction: CallDirection;
  status: CallStatus;
  startTime: number; // Unix timestamp
  endTime?: number; // Unix timestamp
  duration?: number; // In seconds
  anonymous: boolean; // Was *67 used
  isDeleted: boolean; // Soft delete flag (for UI purposes only)
}

export interface ActiveCall {
  id: string;
  phoneNumber: string;
  displayNumber: string;
  direction: CallDirection;
  status: CallStatus;
  startTime: number;
  anonymous: boolean;
  voiceMaskEnabled: boolean; // Voice masking for anonymity
  isMuted: boolean;
  isSpeakerOn: boolean;
}

// ==================== Store ====================

interface VoipState {
  // Settings
  anonymousByDefault: boolean; // *67 prefix by default
  countryCode: string; // Default country code

  // Active call state
  activeCall: ActiveCall | null;

  // Call history - stored in memory only (not persisted for privacy)
  callHistory: CallRecord[];

  // Dialer state
  dialerInput: string;
  isAnonymousCall: boolean; // Current call anonymous toggle
  voiceMaskEnabled: boolean; // Voice masking toggle for anonymity

  // Actions - Settings
  setAnonymousByDefault: (enabled: boolean) => void;
  setCountryCode: (code: string) => void;

  // Actions - Dialer
  setDialerInput: (input: string) => void;
  appendDialerInput: (digit: string) => void;
  clearDialerInput: () => void;
  backspaceDialerInput: () => void;
  toggleAnonymousCall: () => void;
  toggleVoiceMask: () => void; // Toggle voice masking

  // Actions - Call Management
  initiateCall: (phoneNumber: string, anonymous?: boolean, voiceMask?: boolean) => Promise<void>;
  answerCall: () => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleVoiceMaskInCall: () => void; // Toggle voice mask during active call
  sendDTMF: (digit: string) => void;

  // Actions - Call History (Privacy-focused)
  deleteCallRecord: (id: string) => void; // Instant, permanent delete
  deleteAllCallHistory: () => void; // Nuclear option - delete everything
  getCallHistory: () => CallRecord[]; // Returns non-deleted records

  // Internal actions
  _updateCallStatus: (status: CallStatus) => void;
  _setActiveCall: (call: ActiveCall | null) => void;
  _addCallRecord: (record: CallRecord) => void;
}

// Format phone number for display
const formatPhoneNumber = (number: string): string => {
  // Remove all non-digits except +
  const cleaned = number.replace(/[^\d+]/g, '');
  
  // US number formatting
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  
  // With country code
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  
  // International format
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  return number;
};

// Strip *67 and format for dialing
const normalizePhoneNumber = (input: string): string => {
  // Remove *67 prefix if present
  let cleaned = input.replace(/^\*67\s*/, '');
  // Remove all non-digits except +
  cleaned = cleaned.replace(/[^\d+]/g, '');
  return cleaned;
};

export const useVoipStore = create<VoipState>()((set, get) => ({
  // Default settings - anonymous by default for privacy
  anonymousByDefault: true,
  countryCode: '+1',

  // Initial states
  activeCall: null,
  callHistory: [], // In-memory only - never persisted
  dialerInput: '',
  isAnonymousCall: true, // Mirrors anonymousByDefault
  voiceMaskEnabled: false, // Voice masking off by default

  // ==================== Settings Actions ====================

  setAnonymousByDefault: (enabled) => {
    set({ 
      anonymousByDefault: enabled,
      isAnonymousCall: enabled, // Update current state to match default
    });
  },

  setCountryCode: (code) => set({ countryCode: code }),

  // ==================== Dialer Actions ====================

  setDialerInput: (input) => set({ dialerInput: input }),

  appendDialerInput: (digit) => {
    const { dialerInput } = get();
    // Limit input length
    if (dialerInput.length < 20) {
      set({ dialerInput: dialerInput + digit });
    }
  },

  clearDialerInput: () => set({ dialerInput: '' }),

  backspaceDialerInput: () => {
    const { dialerInput } = get();
    set({ dialerInput: dialerInput.slice(0, -1) });
  },

  toggleAnonymousCall: () => {
    set((state) => ({ isAnonymousCall: !state.isAnonymousCall }));
  },

  toggleVoiceMask: () => {
    set((state) => ({ voiceMaskEnabled: !state.voiceMaskEnabled }));
  },

  // ==================== Call Management ====================

  initiateCall: async (phoneNumber, anonymous, voiceMask) => {
    const state = get();
    
    // Don't allow multiple calls
    if (state.activeCall) {
      console.warn('[VOIP] Already in a call');
      return;
    }

    const normalizedNumber = normalizePhoneNumber(phoneNumber);
    if (!normalizedNumber) {
      console.error('[VOIP] Invalid phone number');
      return;
    }

    const isAnonymous = anonymous ?? state.isAnonymousCall;
    const isVoiceMasked = voiceMask ?? state.voiceMaskEnabled;
    const callId = generateId();

    // Create active call
    const newCall: ActiveCall = {
      id: callId,
      phoneNumber: normalizedNumber,
      displayNumber: formatPhoneNumber(normalizedNumber),
      direction: CallDirection.OUTBOUND,
      status: CallStatus.DIALING,
      startTime: Date.now(),
      anonymous: isAnonymous,
      voiceMaskEnabled: isVoiceMasked,
      isMuted: false,
      isSpeakerOn: false,
    };

    set({ 
      activeCall: newCall,
      dialerInput: '', // Clear dialer on call start
    });

    // TODO: Integrate with actual VOIP provider (Twilio, etc.)
    // The actual number to dial would be: isAnonymous ? `*67${normalizedNumber}` : normalizedNumber
    console.log(`[VOIP] Initiating ${isAnonymous ? 'anonymous ' : ''}${isVoiceMasked ? 'voice-masked ' : ''}call to: ${normalizedNumber}`);
    
    // Simulate connection for now
    setTimeout(() => {
      const currentCall = get().activeCall;
      if (currentCall && currentCall.id === callId && currentCall.status === CallStatus.DIALING) {
        get()._updateCallStatus(CallStatus.RINGING);
        
        // Simulate answer after 2 more seconds
        setTimeout(() => {
          const stillCalling = get().activeCall;
          if (stillCalling && stillCalling.id === callId && stillCalling.status === CallStatus.RINGING) {
            get()._updateCallStatus(CallStatus.CONNECTED);
          }
        }, 2000);
      }
    }, 1000);
  },

  answerCall: async () => {
    const { activeCall } = get();
    if (activeCall && activeCall.status === CallStatus.RINGING) {
      get()._updateCallStatus(CallStatus.CONNECTED);
    }
  },

  endCall: () => {
    const { activeCall, _addCallRecord } = get();
    
    if (!activeCall) return;

    const endTime = Date.now();
    const duration = Math.floor((endTime - activeCall.startTime) / 1000);

    // Create call record
    const record: CallRecord = {
      id: activeCall.id,
      phoneNumber: activeCall.phoneNumber,
      displayNumber: activeCall.displayNumber,
      direction: activeCall.direction,
      status: activeCall.status === CallStatus.CONNECTED ? CallStatus.ENDED : activeCall.status,
      startTime: activeCall.startTime,
      endTime,
      duration: activeCall.status === CallStatus.CONNECTED ? duration : undefined,
      anonymous: activeCall.anonymous,
      isDeleted: false,
    };

    // Add to history
    _addCallRecord(record);

    // Clear active call
    set({ activeCall: null });

    console.log('[VOIP] Call ended:', record);
  },

  toggleMute: () => {
    const { activeCall } = get();
    if (activeCall) {
      set({
        activeCall: { ...activeCall, isMuted: !activeCall.isMuted },
      });
    }
  },

  toggleSpeaker: () => {
    const { activeCall } = get();
    if (activeCall) {
      set({
        activeCall: { ...activeCall, isSpeakerOn: !activeCall.isSpeakerOn },
      });
    }
  },

  toggleVoiceMaskInCall: () => {
    const { activeCall } = get();
    if (activeCall) {
      set({
        activeCall: { ...activeCall, voiceMaskEnabled: !activeCall.voiceMaskEnabled },
      });
    }
  },

  sendDTMF: (digit) => {
    const { activeCall } = get();
    if (activeCall && activeCall.status === CallStatus.CONNECTED) {
      // TODO: Send DTMF tone through VOIP provider
      console.log(`[VOIP] DTMF: ${digit}`);
    }
  },

  // ==================== Call History (Privacy-First) ====================

  deleteCallRecord: (id) => {
    // INSTANT PERMANENT DELETE - No recovery possible
    set((state) => ({
      callHistory: state.callHistory.filter((record) => record.id !== id),
    }));
    console.log('[VOIP] Call record permanently deleted:', id);
  },

  deleteAllCallHistory: () => {
    // NUCLEAR OPTION - Delete everything immediately
    set({ callHistory: [] });
    console.log('[VOIP] All call history permanently deleted');
  },

  getCallHistory: () => {
    return get().callHistory.filter((r) => !r.isDeleted);
  },

  // ==================== Internal Actions ====================

  _updateCallStatus: (status) => {
    const { activeCall } = get();
    if (activeCall) {
      set({
        activeCall: { ...activeCall, status },
      });
    }
  },

  _setActiveCall: (call) => set({ activeCall: call }),

  _addCallRecord: (record) => {
    set((state) => ({
      callHistory: [record, ...state.callHistory].slice(0, 100), // Keep last 100 calls max
    }));
  },
}));

// Export for external VOIP service integration
export type { VoipState };
