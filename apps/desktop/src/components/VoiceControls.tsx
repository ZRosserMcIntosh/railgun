/**
 * Voice Controls Component
 * 
 * Provides UI for voice channel controls with Pro feature gating.
 */

import { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  Volume2,
  VolumeX,
  Lock,
  Activity,
  Shield,
} from 'lucide-react';
import { getVoiceService, type VoiceControlsState, type CallStats, type PreCallCheck } from '../lib/voiceService';

interface VoiceControlsProps {
  channelId: string;
  isPro: boolean;
  onUpgradeClick?: () => void;
}

export function VoiceControls({ isPro, onUpgradeClick }: VoiceControlsProps) {
  const voiceService = getVoiceService();
  const [state, setState] = useState<VoiceControlsState>(voiceService.getState());
  const [stats, setStats] = useState<CallStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  
  useEffect(() => {
    const updateState = (newState: VoiceControlsState) => setState(newState);
    voiceService.on('state:changed', updateState);
    
    // Update stats every second
    const statsInterval = setInterval(async () => {
      if (showStats) {
        const currentStats = await voiceService.getCallStats();
        setStats(currentStats);
      }
    }, 1000);
    
    return () => {
      voiceService.off('state:changed', updateState);
      clearInterval(statsInterval);
    };
  }, [showStats]);
  
  const handleMuteToggle = async () => {
    await voiceService.toggleMute();
  };
  
  const handleDeafenToggle = async () => {
    await voiceService.toggleDeafen();
  };
  
  const handleVideoToggle = async () => {
    const success = await voiceService.toggleVideo();
    if (!success && onUpgradeClick) {
      // Show upgrade modal
      onUpgradeClick();
    }
  };
  
  const handleScreenShareToggle = async () => {
    const success = await voiceService.toggleScreenShare();
    if (!success && onUpgradeClick) {
      // Show upgrade modal
      onUpgradeClick();
    }
  };
  
  const handleVoiceMaskToggle = async () => {
    await voiceService.toggleVoiceChanger();
  };
  
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-elevated p-4">
      {/* Main Controls */}
      <div className="flex items-center gap-2">
        {/* Mute */}
        <button
          onClick={handleMuteToggle}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            state.muted
              ? 'bg-danger-500 text-white hover:bg-danger-600'
              : 'bg-surface-base text-text-primary hover:bg-surface-elevated'
          }`}
          title={state.muted ? 'Unmute' : 'Mute'}
        >
          {state.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        
        {/* Deafen */}
        <button
          onClick={handleDeafenToggle}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            state.deafened
              ? 'bg-danger-500 text-white hover:bg-danger-600'
              : 'bg-surface-base text-text-primary hover:bg-surface-elevated'
          }`}
          title={state.deafened ? 'Undeafen' : 'Deafen'}
        >
          {state.deafened ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        
        {/* Voice Mask - for anonymity */}
        <button
          onClick={handleVoiceMaskToggle}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            state.voiceChangerEnabled
              ? 'bg-primary-500 text-white hover:bg-primary-600'
              : 'bg-surface-base text-text-primary hover:bg-surface-elevated'
          }`}
          title={state.voiceChangerEnabled 
            ? 'Disable voice masking' 
            : 'Mask voice for anonymity (distorts your voice to protect identity)'
          }
        >
          <Shield className="h-5 w-5" />
        </button>
        
        {/* Video */}
        <button
          onClick={handleVideoToggle}
          disabled={!isPro}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            !isPro
              ? 'cursor-not-allowed bg-surface-base/50 text-text-muted'
              : state.videoEnabled
              ? 'bg-primary-500 text-white hover:bg-primary-600'
              : 'bg-surface-base text-text-primary hover:bg-surface-elevated'
          }`}
          title={isPro ? (state.videoEnabled ? 'Stop Video' : 'Start Video') : 'Video (Pro Only)'}
        >
          {!isPro && <Lock className="absolute h-3 w-3 translate-x-2 -translate-y-2" />}
          {state.videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        
        {/* Screen Share */}
        <button
          onClick={handleScreenShareToggle}
          disabled={!isPro}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            !isPro
              ? 'cursor-not-allowed bg-surface-base/50 text-text-muted'
              : state.screenshareEnabled
              ? 'bg-primary-500 text-white hover:bg-primary-600'
              : 'bg-surface-base text-text-primary hover:bg-surface-elevated'
          }`}
          title={isPro ? (state.screenshareEnabled ? 'Stop Sharing' : 'Share Screen') : 'Screen Share (Pro Only)'}
        >
          {!isPro && <Lock className="absolute h-3 w-3 translate-x-2 -translate-y-2" />}
          <MonitorUp className="h-5 w-5" />
        </button>
        
        {/* Settings */}
        <button
          onClick={() => setShowStats(!showStats)}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg bg-surface-base text-text-primary transition-colors hover:bg-surface-elevated"
          title="Show Stats"
        >
          <Activity className="h-5 w-5" />
        </button>
      </div>
      
      {/* Volume Controls */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="input-volume" className="text-sm text-text-secondary">Input</label>
          <input
            id="input-volume"
            type="range"
            min="0"
            max="200"
            value={state.inputVolume * 100}
            onChange={(e) => voiceService.setInputVolume(Number(e.target.value) / 100)}
            className="flex-1"
            title="Input volume"
          />
          <span className="w-12 text-right text-sm text-text-secondary">
            {Math.round(state.inputVolume * 100)}%
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <label htmlFor="output-volume" className="text-sm text-text-secondary">Output</label>
          <input
            id="output-volume"
            type="range"
            min="0"
            max="100"
            value={state.outputVolume * 100}
            onChange={(e) => voiceService.setOutputVolume(Number(e.target.value) / 100)}
            className="flex-1"
            title="Output volume"
          />
          <span className="w-12 text-right text-sm text-text-secondary">
            {Math.round(state.outputVolume * 100)}%
          </span>
        </div>
      </div>
      
      {/* Stats Overlay */}
      {showStats && stats && (
        <div className="rounded-lg bg-surface-base p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">Call Stats</span>
            <span
              className={`text-xs font-medium ${
                stats.networkQuality === 'excellent'
                  ? 'text-success-500'
                  : stats.networkQuality === 'good'
                  ? 'text-primary-500'
                  : stats.networkQuality === 'fair'
                  ? 'text-warning-500'
                  : 'text-danger-500'
              }`}
            >
              {stats.networkQuality.toUpperCase()}
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-text-muted">RTT:</span>
              <span className="ml-1 text-text-secondary">{stats.rtt.toFixed(0)}ms</span>
            </div>
            
            <div>
              <span className="text-text-muted">Jitter:</span>
              <span className="ml-1 text-text-secondary">{stats.jitter.toFixed(1)}ms</span>
            </div>
            
            <div>
              <span className="text-text-muted">Packet Loss:</span>
              <span className="ml-1 text-text-secondary">
                {(stats.packetLoss * 100).toFixed(1)}%
              </span>
            </div>
            
            <div>
              <span className="text-text-muted">MOS:</span>
              <span className="ml-1 text-text-secondary">{stats.mos.toFixed(2)}</span>
            </div>
            
            <div>
              <span className="text-text-muted">Audio:</span>
              <span className="ml-1 text-text-secondary">{stats.audioBitrate.toFixed(0)} kbps</span>
            </div>
            
            {stats.videoBitrate && (
              <div>
                <span className="text-text-muted">Video:</span>
                <span className="ml-1 text-text-secondary">{stats.videoBitrate.toFixed(0)} kbps</span>
              </div>
            )}
            
            <div className="col-span-2">
              <span className="text-text-muted">Transport:</span>
              <span className="ml-1 text-text-secondary">{stats.transport.toUpperCase()}</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Pro Upgrade CTA */}
      {!isPro && (
        <div className="rounded-lg border border-primary-500/20 bg-primary-500/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary-500" />
            <span className="text-sm font-semibold text-primary-500">Unlock Pro Features</span>
          </div>
          <p className="mb-3 text-xs text-text-secondary">
            Upgrade to Rail Gun Pro for video calling and screen sharing.
          </p>
          {onUpgradeClick && (
            <button
              onClick={onUpgradeClick}
              className="w-full rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
            >
              Upgrade to Pro
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PRE-CALL DIAGNOSTICS COMPONENT
// ============================================================================

interface PreCallDiagnosticsProps {
  onJoin: () => void;
  onCancel: () => void;
}

export function PreCallDiagnostics({ onJoin, onCancel }: PreCallDiagnosticsProps) {
  const voiceService = getVoiceService();
  const [checking, setChecking] = useState(true);
  const [devices, setDevices] = useState<PreCallCheck['devices'] | null>(null);
  const [networkStatus, setNetworkStatus] = useState<'good' | 'fair' | 'poor'>('good');
  const [echoTestStatus, setEchoTestStatus] = useState<'idle' | 'recording' | 'playing' | 'complete'>('idle');
  
  useEffect(() => {
    runCheck();
  }, []);
  
  const runCheck = async () => {
    setChecking(true);
    
    const result = await voiceService.runPreCallCheck();
    setDevices(result.devices);
    setNetworkStatus(result.network.status);
    
    setChecking(false);
  };
  
  const runEchoTest = async () => {
    setEchoTestStatus('recording');
    
    voiceService.on('echo:test:playing', () => setEchoTestStatus('playing'));
    voiceService.on('echo:test:complete', () => setEchoTestStatus('complete'));
    
    await voiceService.runEchoTest();
  };
  
  return (
    <div className="flex min-h-[400px] flex-col gap-4 rounded-xl bg-surface-elevated p-6">
      <h2 className="text-xl font-semibold text-text-primary">Voice Check</h2>
      
      {checking ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-500 border-t-transparent"></div>
            <p className="text-text-secondary">Checking your devices...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Devices */}
          <div className="space-y-3">
            <div>
              <label htmlFor="microphone-select" className="mb-1 block text-sm text-text-secondary">Microphone</label>
              <select
                id="microphone-select"
                className="w-full rounded-lg bg-surface-base px-3 py-2 text-text-primary"
                title="Select microphone"
              >
                {devices?.microphones.map((device: MediaDeviceInfo) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label htmlFor="speaker-select" className="mb-1 block text-sm text-text-secondary">Speakers</label>
              <select
                id="speaker-select"
                className="w-full rounded-lg bg-surface-base px-3 py-2 text-text-primary"
                title="Select speakers"
              >
                {devices?.speakers.map((device: MediaDeviceInfo) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Network Status */}
          <div className="rounded-lg bg-surface-base p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm text-text-secondary">Network Quality</span>
              <span
                className={`text-sm font-medium ${
                  networkStatus === 'good'
                    ? 'text-success-500'
                    : networkStatus === 'fair'
                    ? 'text-warning-500'
                    : 'text-danger-500'
                }`}
              >
                {networkStatus.toUpperCase()}
              </span>
            </div>
            {networkStatus === 'poor' && (
              <p className="text-xs text-text-muted">
                Your connection may affect call quality. Consider using a wired connection.
              </p>
            )}
          </div>
          
          {/* Echo Test */}
          <div className="rounded-lg bg-surface-base p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-text-secondary">Echo Test</span>
              {echoTestStatus === 'complete' && (
                <span className="text-sm font-medium text-success-500">PASSED</span>
              )}
            </div>
            
            {echoTestStatus === 'idle' && (
              <button
                onClick={runEchoTest}
                className="w-full rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
              >
                Test Microphone & Speakers
              </button>
            )}
            
            {echoTestStatus === 'recording' && (
              <div className="text-center">
                <p className="mb-2 text-sm text-text-primary">Speak now...</p>
                <div className="mx-auto h-2 w-full rounded-full bg-surface-elevated">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary-500"></div>
                </div>
              </div>
            )}
            
            {echoTestStatus === 'playing' && (
              <div className="text-center">
                <p className="text-sm text-text-primary">Can you hear yourself?</p>
              </div>
            )}
            
            {echoTestStatus === 'complete' && (
              <p className="text-xs text-text-muted">
                If you heard an echo, use headphones or reduce speaker volume.
              </p>
            )}
          </div>
          
          {/* Actions */}
          <div className="mt-auto flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 rounded-lg bg-surface-base px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-elevated"
            >
              Cancel
            </button>
            
            <button
              onClick={onJoin}
              className="flex-1 rounded-lg bg-success-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success-600"
            >
              Join Voice
            </button>
          </div>
        </>
      )}
    </div>
  );
}
