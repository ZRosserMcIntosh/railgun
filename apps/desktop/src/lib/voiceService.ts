/**
 * Voice & Video Service - WebRTC Management
 * 
 * Handles voice channels and video calls with Pro feature gating.
 * Provides high-quality audio processing and graceful degradation.
 */

import { EventEmitter } from 'events';
import { hasCapability, Capability } from '../billing';

// ============================================================================
// TYPES
// ============================================================================

export interface VoiceChannel {
  id: string;
  communityId: string;
  name: string;
  type: 'VOICE';
  maxParticipants: number;
  participants: VoiceParticipant[];
}

export interface VoiceParticipant {
  userId: string;
  username: string;
  role: 'speaker' | 'listener';
  state: {
    muted: boolean;
    deafened: boolean;
    speaking: boolean;
    videoEnabled: boolean;
    screenshareEnabled: boolean;
  };
  stats: {
    rtt: number;
    jitter: number;
    packetLoss: number;
    bitrate: number;
    mos: number;
  };
}

export interface VoiceControlsState {
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenshareEnabled: boolean;
  
  selectedMicrophone?: string;
  selectedSpeaker?: string;
  selectedCamera?: string;
  
  inputVolume: number;
  outputVolume: number;
  perUserVolumes: Map<string, number>;
  
  noiseSuppression: boolean;
  autoOptimize: boolean;
  pushToTalk: boolean;
  pttKey: string;
  
  showStats: boolean;
}

export interface CallStats {
  transport: 'udp' | 'tcp' | 'turn';
  rtt: number;
  jitter: number;
  packetLoss: number;
  
  audioCodec: 'opus';
  audioBitrate: number;
  audioPackets: {
    sent: number;
    received: number;
    lost: number;
  };
  
  videoCodec?: 'vp8' | 'vp9' | 'h264';
  videoBitrate?: number;
  videoResolution?: string;
  videoFramerate?: number;
  
  mos: number;
  networkQuality: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface PreCallCheck {
  devices: {
    microphones: MediaDeviceInfo[];
    speakers: MediaDeviceInfo[];
    cameras: MediaDeviceInfo[];
  };
  
  inputLevel: number;
  outputLevel: number;
  
  echoTest: {
    status: 'idle' | 'recording' | 'playing' | 'complete';
    recordDuration: number;
    playbackDelay: number;
  };
  
  network: {
    rtt: number;
    bandwidth: number;
    status: 'good' | 'fair' | 'poor';
  };
}

export enum ScreenShareMode {
  ENTIRE_SCREEN = 'screen',
  WINDOW = 'window',
  TAB = 'tab',
}

// ============================================================================
// AUDIO CONSTRAINTS
// ============================================================================

/**
 * Requested audio constraints.
 * 
 * NOTE: These are REQUESTED constraints, not guarantees.
 * WebRTC implementations may treat them as "ideal" and ignore or approximate.
 * Actual behavior varies by browser/device.
 */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },      // Usually honored
  noiseSuppression: { ideal: true },      // Usually honored
  autoGainControl: { ideal: true },       // Usually honored
  sampleRate: { ideal: 48000 },           // May fall back to 44100
  channelCount: { exact: 1 },             // Force mono (should be exact)
  // latency: { ideal: 0.01 },            // Often ignored by browsers
};

/**
 * Noise suppression settings.
 * RNNoise is opt-in due to latency/CPU impact.
 */
export interface NoiseSuppression {
  mode: 'off' | 'auto' | 'always';
  
  // Auto mode: enable only when background noise detected
  autoEnableThreshold: {
    noiseFloorDb: number;    // Enable if noise > this (default: -40)
    durationMs: number;       // For at least this long (default: 5000)
  };
  
  // Disable on mobile (too much CPU)
  disableOnMobile: boolean;
}

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppression = {
  mode: 'off',  // Default off, user can enable
  autoEnableThreshold: {
    noiseFloorDb: -40,
    durationMs: 5000,
  },
  disableOnMobile: true,
};

export const OPUS_CONFIG = {
  free: {
    bitrate: 32000,  // 32 kbps
    complexity: 10,
    dtx: true,
    fec: true,
  },
  pro: {
    bitrate: 64000,  // 64 kbps
    complexity: 10,
    dtx: true,
    fec: true,
  },
} as const;

// ============================================================================
// VOICE SERVICE
// ============================================================================

export class VoiceService extends EventEmitter {
  private localStream: MediaStream | null = null;
  private localVideoStream: MediaStream | null = null;
  private localScreenStream: MediaStream | null = null;
  
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private remoteStreams: Map<string, MediaStream> = new Map();
  
  private currentChannelId: string | null = null;
  private isPro: boolean = false;
  
  private state: VoiceControlsState = {
    muted: false,
    deafened: false,
    videoEnabled: false,
    screenshareEnabled: false,
    inputVolume: 1.0,
    outputVolume: 1.0,
    perUserVolumes: new Map(),
    noiseSuppression: true,
    autoOptimize: true,
    pushToTalk: false,
    pttKey: 'Space',
    showStats: false,
  };
  
  private audioContext?: AudioContext;
  private audioNodes: Map<string, {
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    analyser: AnalyserNode;
  }> = new Map();
  
  constructor() {
    super();
  }
  
  // ========================================================================
  // INITIALIZATION
  // ========================================================================
  
  async init(isPro: boolean): Promise<void> {
    this.isPro = isPro;
    this.audioContext = new AudioContext();
    
    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', () => {
      this.emit('devices:changed');
    });
  }
  
  // ========================================================================
  // PRE-CALL DIAGNOSTICS
  // ========================================================================
  
  async runPreCallCheck(): Promise<PreCallCheck> {
    const devices = await this.enumerateDevices();
    
    const result: PreCallCheck = {
      devices,
      inputLevel: 0,
      outputLevel: 0,
      echoTest: {
        status: 'idle',
        recordDuration: 3000,
        playbackDelay: 500,
      },
      network: {
        rtt: 0,
        bandwidth: 0,
        status: 'good',
      },
    };
    
    // Network test (ping signaling server)
    try {
      const start = Date.now();
      await fetch('/api/v1/health');
      result.network.rtt = Date.now() - start;
      
      if (result.network.rtt < 50) result.network.status = 'good';
      else if (result.network.rtt < 150) result.network.status = 'fair';
      else result.network.status = 'poor';
    } catch (error) {
      console.error('[VoiceService] Network test failed:', error);
      result.network.status = 'poor';
    }
    
    return result;
  }
  
  async enumerateDevices(): Promise<PreCallCheck['devices']> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    return {
      microphones: devices.filter(d => d.kind === 'audioinput'),
      speakers: devices.filter(d => d.kind === 'audiooutput'),
      cameras: devices.filter(d => d.kind === 'videoinput'),
    };
  }
  
  async testMicrophone(deviceId?: string): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId 
        ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } }
        : AUDIO_CONSTRAINTS,
      video: false,
    });
    
    // Set up level meter
    if (this.audioContext) {
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const dbfs = 20 * Math.log10(average / 255);
        
        this.emit('mic:level', dbfs);
        
        requestAnimationFrame(checkLevel);
      };
      
      checkLevel();
    }
    
    return stream;
  }
  
  async runEchoTest(): Promise<void> {
    const chunks: Blob[] = [];
    const stream = await this.testMicrophone();
    
    const mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      // Stop mic stream
      stream.getTracks().forEach(track => track.stop());
      
      // Wait playback delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Playback
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      this.emit('echo:test:playing');
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.emit('echo:test:complete');
      };
      
      await audio.play();
    };
    
    // Record for 3 seconds
    this.emit('echo:test:recording');
    mediaRecorder.start();
    
    setTimeout(() => {
      mediaRecorder.stop();
    }, 3000);
  }
  
  // ========================================================================
  // VOICE CHANNEL OPERATIONS
  // ========================================================================
  
  async joinChannel(channelId: string): Promise<void> {
    if (this.currentChannelId) {
      await this.leaveChannel();
    }
    
    this.currentChannelId = channelId;
    
    // Get local audio stream
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: this.state.selectedMicrophone
        ? { ...AUDIO_CONSTRAINTS, deviceId: { exact: this.state.selectedMicrophone } }
        : AUDIO_CONSTRAINTS,
      video: false,
    });
    
    // Apply audio processing
    await this.applyAudioProcessing(this.localStream);
    
    // Notify server
    this.emit('channel:join', { channelId });
  }
  
  async leaveChannel(): Promise<void> {
    if (!this.currentChannelId) return;
    
    // Stop all streams
    this.stopAllStreams();
    
    // Close peer connections
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.remoteStreams.clear();
    
    // Notify server
    this.emit('channel:leave', { channelId: this.currentChannelId });
    
    this.currentChannelId = null;
  }
  
  // ========================================================================
  // CONTROLS
  // ========================================================================
  
  async toggleMute(): Promise<void> {
    this.state.muted = !this.state.muted;
    
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.state.muted;
      });
    }
    
    this.emit('state:changed', this.state);
  }
  
  async toggleDeafen(): Promise<void> {
    this.state.deafened = !this.state.deafened;
    
    // Mute output from all remote streams
    this.audioNodes.forEach(node => {
      node.gain.gain.value = this.state.deafened ? 0 : this.state.outputVolume;
    });
    
    // Also mute self
    if (!this.state.muted && this.state.deafened) {
      await this.toggleMute();
    }
    
    this.emit('state:changed', this.state);
  }
  
  async toggleVideo(): Promise<boolean> {
    // Check Pro capability
    if (!this.isPro) {
      this.emit('capability:required', {
        capability: Capability.VIDEO_CALLING,
        feature: 'video calling',
      });
      return false;
    }
    
    this.state.videoEnabled = !this.state.videoEnabled;
    
    if (this.state.videoEnabled) {
      // Start video
      this.localVideoStream = await navigator.mediaDevices.getUserMedia({
        video: this.state.selectedCamera
          ? { deviceId: { exact: this.state.selectedCamera } }
          : true,
        audio: false,
      });
      
      this.emit('video:started', this.localVideoStream);
    } else {
      // Stop video
      if (this.localVideoStream) {
        this.localVideoStream.getTracks().forEach(track => track.stop());
        this.localVideoStream = null;
      }
      
      this.emit('video:stopped');
    }
    
    this.emit('state:changed', this.state);
    return true;
  }
  
  async toggleScreenShare(): Promise<boolean> {
    // Check Pro capability
    if (!this.isPro) {
      this.emit('capability:required', {
        capability: Capability.SCREEN_SHARE,
        feature: 'screen sharing',
      });
      return false;
    }
    
    this.state.screenshareEnabled = !this.state.screenshareEnabled;
    
    if (this.state.screenshareEnabled) {
      // Start screen share
      this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { max: 30 },
          cursor: 'always',
        } as any,
        audio: false,
      });
      
      // Handle stop button in browser UI
      this.localScreenStream.getVideoTracks()[0].onended = () => {
        this.state.screenshareEnabled = false;
        this.emit('screenshare:stopped');
        this.emit('state:changed', this.state);
      };
      
      this.emit('screenshare:started', this.localScreenStream);
    } else {
      // Stop screen share
      if (this.localScreenStream) {
        this.localScreenStream.getTracks().forEach(track => track.stop());
        this.localScreenStream = null;
      }
      
      this.emit('screenshare:stopped');
    }
    
    this.emit('state:changed', this.state);
    return true;
  }
  
  setInputVolume(volume: number): void {
    this.state.inputVolume = Math.max(0, Math.min(2, volume));
    // Apply to local stream gain node
    this.emit('state:changed', this.state);
  }
  
  setOutputVolume(volume: number): void {
    this.state.outputVolume = Math.max(0, Math.min(1, volume));
    
    // Apply to all remote streams
    this.audioNodes.forEach(node => {
      if (!this.state.deafened) {
        node.gain.gain.value = this.state.outputVolume;
      }
    });
    
    this.emit('state:changed', this.state);
  }
  
  setPerUserVolume(userId: string, volume: number): void {
    volume = Math.max(0, Math.min(2, volume));
    this.state.perUserVolumes.set(userId, volume);
    
    // Apply to specific user's audio node
    const node = this.audioNodes.get(userId);
    if (node && !this.state.deafened) {
      node.gain.gain.value = this.state.outputVolume * volume;
    }
    
    this.emit('state:changed', this.state);
  }
  
  // ========================================================================
  // AUDIO PROCESSING
  // ========================================================================
  
  private async applyAudioProcessing(stream: MediaStream): Promise<void> {
    if (!this.audioContext) return;
    
    const source = this.audioContext.createMediaStreamSource(stream);
    const gainNode = this.audioContext.createGain();
    const analyserNode = this.audioContext.createAnalyser();
    
    // Set up processing chain
    gainNode.gain.value = this.state.inputVolume;
    analyserNode.fftSize = 256;
    
    source.connect(gainNode);
    gainNode.connect(analyserNode);
    
    // VAD for speaking detection
    this.setupVAD(analyserNode);
    
    // Store for cleanup
    this.audioNodes.set('local', { source, gain: gainNode, analyser: analyserNode });
  }
  
  private setupVAD(analyser: AnalyserNode): void {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const THRESHOLD = 0.01; // Adjust based on testing
    let speaking = false;
    
    const checkVAD = () => {
      analyser.getByteTimeDomainData(dataArray);
      
      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      
      const nowSpeaking = rms > THRESHOLD;
      
      if (nowSpeaking !== speaking) {
        speaking = nowSpeaking;
        this.emit('speaking:changed', speaking);
      }
      
      if (this.currentChannelId) {
        requestAnimationFrame(checkVAD);
      }
    };
    
    checkVAD();
  }
  
  // ========================================================================
  // STATS & MONITORING
  // ========================================================================
  
  async getCallStats(): Promise<CallStats | null> {
    // Get first peer connection for stats
    const pc = Array.from(this.peerConnections.values())[0];
    if (!pc) return null;
    
    const stats = await pc.getStats();
    const result: Partial<CallStats> = {
      audioCodec: 'opus',
      transport: 'udp',
      rtt: 0,
      jitter: 0,
      packetLoss: 0,
      audioBitrate: 0,
      audioPackets: { sent: 0, received: 0, lost: 0 },
    };
    
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        result.rtt = report.currentRoundTripTime * 1000;
        result.transport = report.localCandidateType === 'relay' ? 'turn' : 'udp';
      }
      
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        result.jitter = report.jitter * 1000;
        result.packetLoss = report.packetsLost / (report.packetsReceived + report.packetsLost);
        result.audioPackets.received = report.packetsReceived;
        result.audioPackets.lost = report.packetsLost;
      }
      
      if (report.type === 'outbound-rtp' && report.kind === 'audio') {
        result.audioBitrate = report.bytesSent * 8 / report.timestamp * 1000; // kbps
        result.audioPackets.sent = report.packetsSent;
      }
      
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        result.videoCodec = report.codecId as any;
        result.videoBitrate = report.bytesSent * 8 / report.timestamp * 1000;
        result.videoFramerate = report.framesPerSecond;
      }
    });
    
    // Calculate MOS
    result.mos = this.calculateMOS(result.rtt || 0, result.packetLoss || 0);
    
    // Network quality
    if (result.mos >= 4) result.networkQuality = 'excellent';
    else if (result.mos >= 3.5) result.networkQuality = 'good';
    else if (result.mos >= 2.5) result.networkQuality = 'fair';
    else result.networkQuality = 'poor';
    
    return result as CallStats;
  }
  
  private calculateMOS(rtt: number, packetLoss: number): number {
    // E-model (ITU-T G.107)
    const R = 93.2 - (rtt * 0.024) - (packetLoss * 100 * 2.5);
    
    if (R < 0) return 1.0;
    if (R > 100) return 4.5;
    
    return 1 + (0.035 * R) + (0.000007 * R * (R - 60) * (100 - R));
  }
  
  // ========================================================================
  // CLEANUP
  // ========================================================================
  
  private stopAllStreams(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach(track => track.stop());
      this.localVideoStream = null;
    }
    
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach(track => track.stop());
      this.localScreenStream = null;
    }
    
    // Cleanup audio nodes
    this.audioNodes.forEach(node => {
      node.source.disconnect();
      node.gain.disconnect();
      node.analyser.disconnect();
    });
    this.audioNodes.clear();
  }
  
  async destroy(): Promise<void> {
    await this.leaveChannel();
    
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = undefined;
    }
    
    this.removeAllListeners();
  }
  
  // ========================================================================
  // GETTERS
  // ========================================================================
  
  getState(): VoiceControlsState {
    return { ...this.state };
  }
  
  getCurrentChannelId(): string | null {
    return this.currentChannelId;
  }
  
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }
  
  getLocalVideoStream(): MediaStream | null {
    return this.localVideoStream;
  }
  
  getLocalScreenStream(): MediaStream | null {
    return this.localScreenStream;
  }
  
  getRemoteStreams(): Map<string, MediaStream> {
    return new Map(this.remoteStreams);
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let voiceService: VoiceService | null = null;

export function getVoiceService(): VoiceService {
  if (!voiceService) {
    voiceService = new VoiceService();
  }
  return voiceService;
}

export function initVoiceService(isPro: boolean): Promise<void> {
  const service = getVoiceService();
  return service.init(isPro);
}
