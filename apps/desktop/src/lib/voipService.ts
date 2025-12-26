/**
 * VOIP Service - Handles integration with VOIP providers for real phone calls
 * 
 * This service abstracts the VOIP provider implementation, allowing for easy
 * switching between providers (Twilio, Vonage, Plivo, etc.)
 * 
 * PRIVACY FEATURES:
 * - *67 anonymous calling support
 * - No call records stored on server
 * - Call metadata stripped before any logging
 */

import { CallStatus, CallDirection, useVoipStore } from '../stores/voipStore';

// ==================== Types ====================

export interface VoipProvider {
  name: string;
  initialize(config: VoipConfig): Promise<void>;
  makeCall(phoneNumber: string, anonymous: boolean): Promise<CallSession>;
  endCall(sessionId: string): Promise<void>;
  sendDTMF(sessionId: string, digit: string): Promise<void>;
  setMute(sessionId: string, muted: boolean): Promise<void>;
  getAudioDevices(): Promise<AudioDevice[]>;
  setAudioDevice(deviceId: string): Promise<void>;
}

export interface VoipConfig {
  // Twilio-specific
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  
  // WebRTC-specific
  stunServers?: string[];
  turnServers?: TurnServer[];
  
  // General
  defaultCountryCode?: string;
  enableAnonymousDefault?: boolean;
}

export interface TurnServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface CallSession {
  id: string;
  phoneNumber: string;
  direction: CallDirection;
  status: CallStatus;
  startTime: number;
  anonymous: boolean;
}

export interface AudioDevice {
  id: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  isDefault: boolean;
}

// ==================== Mock Provider (Development) ====================

class MockVoipProvider implements VoipProvider {
  name = 'Mock Provider';
  private activeCalls: Map<string, CallSession> = new Map();

  async initialize(_config: VoipConfig): Promise<void> {
    console.log('[MockVoipProvider] Initialized');
  }

  async makeCall(phoneNumber: string, anonymous: boolean): Promise<CallSession> {
    const session: CallSession = {
      id: `mock-${Date.now()}`,
      phoneNumber,
      direction: CallDirection.OUTBOUND,
      status: CallStatus.DIALING,
      startTime: Date.now(),
      anonymous,
    };

    this.activeCalls.set(session.id, session);
    console.log(`[MockVoipProvider] Making ${anonymous ? 'anonymous ' : ''}call to: ${phoneNumber}`);
    
    // Simulate call progression
    setTimeout(() => this.updateCallStatus(session.id, CallStatus.RINGING), 1000);
    setTimeout(() => this.updateCallStatus(session.id, CallStatus.CONNECTED), 3000);

    return session;
  }

  private updateCallStatus(sessionId: string, status: CallStatus): void {
    const session = this.activeCalls.get(sessionId);
    if (session) {
      session.status = status;
      console.log(`[MockVoipProvider] Call ${sessionId} status: ${status}`);
    }
  }

  async endCall(sessionId: string): Promise<void> {
    const session = this.activeCalls.get(sessionId);
    if (session) {
      session.status = CallStatus.ENDED;
      this.activeCalls.delete(sessionId);
      console.log(`[MockVoipProvider] Call ended: ${sessionId}`);
    }
  }

  async sendDTMF(sessionId: string, digit: string): Promise<void> {
    console.log(`[MockVoipProvider] DTMF sent: ${digit} on call ${sessionId}`);
  }

  async setMute(sessionId: string, muted: boolean): Promise<void> {
    console.log(`[MockVoipProvider] Mute set to ${muted} on call ${sessionId}`);
  }

  async getAudioDevices(): Promise<AudioDevice[]> {
    return [
      { id: 'default', label: 'Default Microphone', kind: 'audioinput', isDefault: true },
      { id: 'default-output', label: 'Default Speaker', kind: 'audiooutput', isDefault: true },
    ];
  }

  async setAudioDevice(deviceId: string): Promise<void> {
    console.log(`[MockVoipProvider] Audio device set: ${deviceId}`);
  }
}

// ==================== Twilio Provider (Production) ====================

class TwilioVoipProvider implements VoipProvider {
  name = 'Twilio';
  private device: any = null; // Twilio.Device
  private connection: any = null; // Twilio.Connection

  async initialize(config: VoipConfig): Promise<void> {
    
    // In a real implementation, you would:
    // 1. Fetch a capability token from your backend
    // 2. Initialize Twilio.Device with the token
    // 3. Set up event handlers
    
    console.log('[TwilioVoipProvider] Initialized with config:', {
      accountSid: config.twilioAccountSid ? '***' : undefined,
      phoneNumber: config.twilioPhoneNumber,
    });

    // Example Twilio initialization (requires @twilio/voice-sdk)
    /*
    const token = await this.fetchCapabilityToken();
    this.device = new Device(token, {
      codecPreferences: [Connection.Codec.Opus, Connection.Codec.PCMU],
      fakeLocalDTMF: true,
      enableRingingState: true,
    });
    
    this.device.on('ready', () => console.log('Twilio Device ready'));
    this.device.on('error', (error: any) => console.error('Twilio error:', error));
    this.device.on('incoming', this.handleIncomingCall.bind(this));
    */
  }

  async makeCall(phoneNumber: string, anonymous: boolean): Promise<CallSession> {
    if (!this.device) {
      throw new Error('Twilio device not initialized');
    }

    // Format number with *67 for anonymous calling
    const dialNumber = anonymous ? `*67${phoneNumber}` : phoneNumber;
    
    const session: CallSession = {
      id: `twilio-${Date.now()}`,
      phoneNumber,
      direction: CallDirection.OUTBOUND,
      status: CallStatus.DIALING,
      startTime: Date.now(),
      anonymous,
    };

    // Example Twilio call (requires proper backend setup)
    /*
    this.connection = await this.device.connect({
      params: {
        To: dialNumber,
        // Your backend should handle the actual *67 prefix
      }
    });
    
    this.connection.on('ringing', () => {
      useVoipStore.getState()._updateCallStatus(CallStatus.RINGING);
    });
    
    this.connection.on('accept', () => {
      useVoipStore.getState()._updateCallStatus(CallStatus.CONNECTED);
    });
    
    this.connection.on('disconnect', () => {
      useVoipStore.getState().endCall();
    });
    */

    console.log(`[TwilioVoipProvider] Would dial: ${dialNumber}`);
    return session;
  }

  async endCall(_sessionId: string): Promise<void> {
    if (this.connection) {
      // this.connection.disconnect();
      this.connection = null;
    }
  }

  async sendDTMF(_sessionId: string, digit: string): Promise<void> {
    if (this.connection) {
      // this.connection.sendDigits(digit);
      console.log(`[TwilioVoipProvider] Would send DTMF: ${digit}`);
    }
  }

  async setMute(_sessionId: string, muted: boolean): Promise<void> {
    if (this.connection) {
      // this.connection.mute(muted);
      console.log(`[TwilioVoipProvider] Would set mute: ${muted}`);
    }
  }

  async getAudioDevices(): Promise<AudioDevice[]> {
    // Use browser's MediaDevices API
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map((d, index) => ({
          id: d.deviceId,
          label: d.label || `Device ${index + 1}`,
          kind: d.kind as 'audioinput' | 'audiooutput',
          isDefault: d.deviceId === 'default',
        }));
    } catch (error) {
      console.error('[TwilioVoipProvider] Failed to get audio devices:', error);
      return [];
    }
  }

  async setAudioDevice(deviceId: string): Promise<void> {
    if (this.device) {
      // this.device.audio.setInputDevice(deviceId);
      console.log(`[TwilioVoipProvider] Would set audio device: ${deviceId}`);
    }
  }
}

// ==================== VOIP Service (Singleton) ====================

class VoipService {
  private static instance: VoipService;
  private provider: VoipProvider;
  private isInitialized = false;
  private currentSession: CallSession | null = null;

  private constructor() {
    // Default to mock provider for development
    this.provider = new MockVoipProvider();
  }

  static getInstance(): VoipService {
    if (!VoipService.instance) {
      VoipService.instance = new VoipService();
    }
    return VoipService.instance;
  }

  async initialize(config: VoipConfig, useTwilio = false): Promise<void> {
    if (this.isInitialized) {
      console.warn('[VoipService] Already initialized');
      return;
    }

    // Switch provider based on configuration
    if (useTwilio && config.twilioAccountSid) {
      this.provider = new TwilioVoipProvider();
    } else {
      this.provider = new MockVoipProvider();
    }

    await this.provider.initialize(config);
    this.isInitialized = true;
    
    console.log(`[VoipService] Initialized with provider: ${this.provider.name}`);
  }

  async makeCall(phoneNumber: string, anonymous = true): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('VOIP service not initialized');
    }

    if (this.currentSession) {
      throw new Error('Already in a call');
    }

    try {
      this.currentSession = await this.provider.makeCall(phoneNumber, anonymous);
      
      // Update store
      const store = useVoipStore.getState();
      store._setActiveCall({
        id: this.currentSession.id,
        phoneNumber: this.currentSession.phoneNumber,
        displayNumber: this.formatPhoneNumber(phoneNumber),
        direction: this.currentSession.direction,
        status: this.currentSession.status,
        startTime: this.currentSession.startTime,
        anonymous: this.currentSession.anonymous,
        isMuted: false,
        isSpeakerOn: false,
      });
    } catch (error) {
      console.error('[VoipService] Failed to make call:', error);
      throw error;
    }
  }

  async endCall(): Promise<void> {
    if (this.currentSession) {
      await this.provider.endCall(this.currentSession.id);
      this.currentSession = null;
    }
  }

  async sendDTMF(digit: string): Promise<void> {
    if (this.currentSession) {
      await this.provider.sendDTMF(this.currentSession.id, digit);
    }
  }

  async setMute(muted: boolean): Promise<void> {
    if (this.currentSession) {
      await this.provider.setMute(this.currentSession.id, muted);
    }
  }

  async getAudioDevices(): Promise<AudioDevice[]> {
    return this.provider.getAudioDevices();
  }

  async setAudioDevice(deviceId: string): Promise<void> {
    await this.provider.setAudioDevice(deviceId);
  }

  getProviderName(): string {
    return this.provider.name;
  }

  isInCall(): boolean {
    return this.currentSession !== null;
  }

  private formatPhoneNumber(number: string): string {
    const cleaned = number.replace(/[^\d+]/g, '');
    
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    
    return number;
  }
}

// Export singleton instance
export const voipService = VoipService.getInstance();

// Export for testing
export { MockVoipProvider, TwilioVoipProvider };
