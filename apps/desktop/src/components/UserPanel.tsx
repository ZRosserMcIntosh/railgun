import { useState } from 'react';
import { NukeButton } from './security';
import KeyBackup from './KeyBackup';
import RecoveryCodesModal from './RecoveryCodesModal';
import { getApiClient } from '../lib/api';
import { enableCrashReporting, disableCrashReporting } from '../lib/sentry';
import { useSettingsStore } from '../stores/settingsStore';

// Node Mode icon component
const NodeModeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
  </svg>
);

interface User {
  id: string;
  username: string;
  displayName: string;
}

interface UserPanelProps {
  user: User | null;
  onLogout: () => void;
}

export default function UserPanel({ user, onLogout }: UserPanelProps) {
  const [showKeyBackup, setShowKeyBackup] = useState(false);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [showPrivacySettings, setShowPrivacySettings] = useState(false);
  const [showNodeModeSettings, setShowNodeModeSettings] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(() => {
    return localStorage.getItem('crashReportingEnabled') !== 'false';
  });
  
  // Settings from store
  const { 
    autoSignoutEnabled, 
    autoSignoutMinutes, 
    setAutoSignout,
    nodeModeEnabled,
    nodeModeAutoConnect,
    nodeModeBluetooth,
    nodeModeWiFiDirect,
    nodeModeLAN,
    setNodeMode,
    setNodeModeSettings
  } = useSettingsStore();

  if (!user) return null;

  const handleRotateCodes = async () => {
    setLoadingCodes(true);
    try {
      const response = await getApiClient().rotateRecoveryCodes();
      setRecoveryCodes(response.recoveryCodes);
      setShowRecoveryCodes(true);
    } catch (error) {
      console.error('Failed to rotate recovery codes:', error);
    } finally {
      setLoadingCodes(false);
    }
  };

  const handleCrashReportingToggle = () => {
    const newValue = !crashReportingEnabled;
    setCrashReportingEnabled(newValue);
    if (newValue) {
      enableCrashReporting();
    } else {
      disableCrashReporting();
    }
  };

  return (
    <>
      <div className="w-60 bg-surface-secondary border-l border-dark-900 flex flex-col relative">
        {/* Nuke Button - Bottom Right Corner */}
        <div className="absolute bottom-20 right-2">
          <NukeButton />
        </div>

        {/* Header */}
        <div className="h-12 border-b border-dark-900 flex items-center px-4 drag-region">
          <h2 className="text-sm font-semibold text-text-secondary no-drag">
            User Settings
          </h2>
        </div>

        {/* User Info */}
        <div className="p-4 border-b border-dark-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary truncate">
                {user.displayName}
              </p>
              <p className="text-xs text-text-muted truncate">
                @{user.username}
              </p>
            </div>
            <div className="flex items-center">
              <span className="w-3 h-3 rounded-full bg-status-online" />
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-xs font-semibold uppercase text-text-muted mb-2">
            Status
          </h3>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface-elevated text-text-secondary">
            <span className="w-2 h-2 rounded-full bg-status-online" />
            <span className="text-sm">Online</span>
          </div>

          <h3 className="text-xs font-semibold uppercase text-text-muted mt-6 mb-2">
            Security
          </h3>
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              🔐 Device verified
            </p>
            <p className="text-xs text-text-muted">
              🔑 Keys stored locally
            </p>
          </div>

          {/* Security Actions */}
          <div className="mt-4 space-y-2">
            <button
              onClick={() => setShowKeyBackup(true)}
              className="w-full px-3 py-2 rounded-md text-sm text-left text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Backup Keys
            </button>
            <button
              onClick={handleRotateCodes}
              disabled={loadingCodes}
              className="w-full px-3 py-2 rounded-md text-sm text-left text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loadingCodes ? 'Generating...' : 'New Recovery Codes'}
            </button>
            <button
              onClick={() => setShowPrivacySettings(true)}
              className="w-full px-3 py-2 rounded-md text-sm text-left text-text-secondary hover:bg-surface-tertiary transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Privacy Settings
            </button>
            
            {/* Node Mode Button */}
            <button
              onClick={() => setShowNodeModeSettings(true)}
              className={`w-full px-3 py-2 rounded-md text-sm text-left transition-colors flex items-center gap-2 ${
                nodeModeEnabled 
                  ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30' 
                  : 'text-text-secondary hover:bg-surface-tertiary'
              }`}
            >
              <NodeModeIcon className="w-4 h-4" />
              <span className="flex-1">Node Mode</span>
              {nodeModeEnabled && (
                <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
              )}
            </button>
          </div>
        </div>

        {/* Logout Button */}
        <div className="p-4 border-t border-dark-900">
          <button
            onClick={onLogout}
            className="w-full px-4 py-2 rounded-md text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Key Backup Modal */}
      {showKeyBackup && (
        <KeyBackup onClose={() => setShowKeyBackup(false)} />
      )}

      {/* Recovery Codes Modal */}
      {showRecoveryCodes && recoveryCodes && (
        <RecoveryCodesModal
          codes={recoveryCodes}
          onConfirm={() => {
            setShowRecoveryCodes(false);
            setRecoveryCodes(null);
          }}
          title="New Recovery Codes Generated"
          isRotation={true}
        />
      )}

      {/* Privacy Settings Modal */}
      {showPrivacySettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-surface-secondary rounded-lg shadow-xl max-w-md w-full mx-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-dark-900">
              <h2 className="text-lg font-semibold text-text-primary">Privacy Settings</h2>
              <button
                onClick={() => setShowPrivacySettings(false)}
                title="Close privacy settings"
                className="p-1 hover:bg-surface-tertiary rounded transition-colors"
              >
                <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-6">
              {/* Auto-Signout Setting */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">Auto Sign-Out</h3>
                    <p className="text-xs text-text-muted mt-1">
                      Automatically sign out after period of inactivity
                    </p>
                  </div>
                  <button
                    onClick={() => setAutoSignout(!autoSignoutEnabled, autoSignoutMinutes)}
                    title={autoSignoutEnabled ? 'Disable auto sign-out' : 'Enable auto sign-out'}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      autoSignoutEnabled ? 'bg-primary-500' : 'bg-dark-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        autoSignoutEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {autoSignoutEnabled && (
                  <div>
                    <label className="block text-xs text-text-secondary mb-2">
                      Sign out after (minutes)
                    </label>
                    <div className="flex gap-2">
                      {[5, 10, 15, 30, 60].map((minutes) => (
                        <button
                          key={minutes}
                          onClick={() => setAutoSignout(true, minutes)}
                          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                            autoSignoutMinutes === minutes
                              ? 'bg-primary-500 text-white'
                              : 'bg-dark-700 text-text-secondary hover:bg-dark-600'
                          }`}
                        >
                          {minutes}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-dark-900" />

              {/* Crash Reporting Toggle */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">Crash Reporting</h3>
                    <p className="text-xs text-text-muted mt-1">
                      Help improve Railgun by sending anonymous crash reports
                    </p>
                  </div>
                  <button
                    onClick={handleCrashReportingToggle}
                    title={crashReportingEnabled ? 'Disable crash reporting' : 'Enable crash reporting'}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      crashReportingEnabled ? 'bg-primary-500' : 'bg-dark-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        crashReportingEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Privacy Info */}
                <div className="bg-dark-900 rounded-lg p-3 text-xs text-text-muted space-y-2">
                  <p className="font-medium text-text-secondary">What we collect:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Error type and stack trace</li>
                    <li>App version and OS type</li>
                    <li>Anonymous session ID</li>
                  </ul>
                  <p className="font-medium text-text-secondary mt-2">What we NEVER collect:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Message content or metadata</li>
                    <li>Your username or identity</li>
                    <li>IP addresses or location</li>
                    <li>Encryption keys or tokens</li>
                  </ul>
                </div>
              </div>

              {/* Additional Privacy Options */}
              <div className="border-t border-dark-900 pt-4">
                <h3 className="text-xs font-semibold uppercase text-text-muted mb-3">
                  Data Protection
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-text-secondary">
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm">End-to-end encryption enabled</span>
                  </div>
                  <div className="flex items-center gap-3 text-text-secondary">
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm">Keys stored locally only</span>
                  </div>
                  <div className="flex items-center gap-3 text-text-secondary">
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm">No message logs on servers</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-dark-900">
              <button
                onClick={() => setShowPrivacySettings(false)}
                className="w-full py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Node Mode Settings Modal */}
      {showNodeModeSettings && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-surface-secondary rounded-lg shadow-xl max-w-md w-full mx-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-dark-900">
              <div className="flex items-center gap-2">
                <NodeModeIcon className="w-5 h-5 text-primary-400" />
                <h2 className="text-lg font-semibold text-text-primary">Node Mode</h2>
              </div>
              <button
                onClick={() => setShowNodeModeSettings(false)}
                title="Close node mode settings"
                className="p-1 hover:bg-surface-tertiary rounded transition-colors"
              >
                <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-6">
              {/* Main Toggle */}
              <div className="bg-gradient-to-r from-primary-500/10 to-purple-500/10 rounded-lg p-4 border border-primary-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">Enable Node Mode</h3>
                    <p className="text-xs text-text-muted mt-1">
                      Connect directly with nearby devices without internet
                    </p>
                  </div>
                  <button
                    onClick={() => setNodeMode(!nodeModeEnabled)}
                    title={nodeModeEnabled ? 'Disable node mode' : 'Enable node mode'}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      nodeModeEnabled ? 'bg-primary-500' : 'bg-dark-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        nodeModeEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {nodeModeEnabled && (
                <>
                  {/* Connection Methods */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase text-text-muted">
                      Connection Methods
                    </h4>
                    
                    {/* Bluetooth */}
                    <div className="flex items-center justify-between p-3 bg-dark-900/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                        </svg>
                        <span className="text-sm text-text-secondary">Bluetooth</span>
                      </div>
                      <button
                        onClick={() => setNodeModeSettings({ nodeModeBluetooth: !nodeModeBluetooth })}
                        title={nodeModeBluetooth ? 'Disable Bluetooth' : 'Enable Bluetooth'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          nodeModeBluetooth ? 'bg-primary-500' : 'bg-dark-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            nodeModeBluetooth ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Wi-Fi Direct */}
                    <div className="flex items-center justify-between p-3 bg-dark-900/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0" />
                        </svg>
                        <span className="text-sm text-text-secondary">Wi-Fi Direct</span>
                      </div>
                      <button
                        onClick={() => setNodeModeSettings({ nodeModeWiFiDirect: !nodeModeWiFiDirect })}
                        title={nodeModeWiFiDirect ? 'Disable Wi-Fi Direct' : 'Enable Wi-Fi Direct'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          nodeModeWiFiDirect ? 'bg-primary-500' : 'bg-dark-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            nodeModeWiFiDirect ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* LAN Discovery */}
                    <div className="flex items-center justify-between p-3 bg-dark-900/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                        </svg>
                        <span className="text-sm text-text-secondary">LAN Discovery</span>
                      </div>
                      <button
                        onClick={() => setNodeModeSettings({ nodeModeLAN: !nodeModeLAN })}
                        title={nodeModeLAN ? 'Disable LAN Discovery' : 'Enable LAN Discovery'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          nodeModeLAN ? 'bg-primary-500' : 'bg-dark-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            nodeModeLAN ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Auto Connect */}
                  <div className="flex items-center justify-between p-3 bg-dark-900/50 rounded-lg">
                    <div>
                      <h4 className="text-sm text-text-secondary">Auto-connect to peers</h4>
                      <p className="text-xs text-text-muted mt-0.5">Automatically connect to trusted devices</p>
                    </div>
                    <button
                      onClick={() => setNodeModeSettings({ nodeModeAutoConnect: !nodeModeAutoConnect })}
                      title={nodeModeAutoConnect ? 'Disable auto-connect' : 'Enable auto-connect'}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        nodeModeAutoConnect ? 'bg-primary-500' : 'bg-dark-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          nodeModeAutoConnect ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Info Box */}
                  <div className="bg-dark-900 rounded-lg p-3 text-xs space-y-2">
                    <p className="font-medium text-text-secondary flex items-center gap-2">
                      <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      How Node Mode works
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-text-muted">
                      <li>Messages are encrypted end-to-end</li>
                      <li>Works without internet connection</li>
                      <li>Store-and-forward for offline peers</li>
                      <li>Messages sync when reconnected</li>
                    </ul>
                  </div>
                </>
              )}

              {!nodeModeEnabled && (
                <div className="bg-dark-900/50 rounded-lg p-4 text-center">
                  <NodeModeIcon className="w-12 h-12 mx-auto text-text-muted mb-3" />
                  <p className="text-sm text-text-secondary">
                    Enable Node Mode to communicate directly with nearby devices,
                    even without an internet connection.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-dark-900">
              <button
                onClick={() => setShowNodeModeSettings(false)}
                className="w-full py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
