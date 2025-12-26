import { useState } from 'react';
import { useVoipStore } from '../../stores/voipStore';
import VoipDialer from './VoipDialer';
import CallHistory from './CallHistory';
import ActiveCall from './ActiveCall';

// ==================== Icons ====================

const DialpadIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
);

const HistoryIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

// ==================== Tab Types ====================

type VoipTab = 'dialer' | 'history' | 'settings';

// ==================== Settings Panel ====================

const VoipSettings = () => {
  const { anonymousByDefault, setAnonymousByDefault, countryCode, setCountryCode } = useVoipStore();

  return (
    <div className="p-6 max-w-md mx-auto">
      <h3 className="text-lg font-semibold text-text-primary mb-6">VOIP Settings</h3>
      
      {/* Anonymous by Default */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-text-primary">Anonymous by Default</h4>
            <p className="text-xs text-text-muted mt-1">
              Always use *67 to hide caller ID
            </p>
          </div>
          <button
            onClick={() => setAnonymousByDefault(!anonymousByDefault)}
            title={anonymousByDefault ? 'Disable anonymous by default' : 'Enable anonymous by default'}
            aria-label={anonymousByDefault ? 'Disable anonymous by default' : 'Enable anonymous by default'}
            className={`w-12 h-6 rounded-full transition-colors ${
              anonymousByDefault ? 'bg-green-600' : 'bg-dark-600'
            } relative`}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                anonymousByDefault ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Country Code */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-primary mb-2">
          Default Country Code
        </label>
        <select
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value)}
          title="Select default country code"
          aria-label="Default country code"
          className="w-full px-3 py-2 bg-surface-elevated border border-dark-700 rounded-md text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="+1">+1 (USA/Canada)</option>
          <option value="+44">+44 (UK)</option>
          <option value="+49">+49 (Germany)</option>
          <option value="+33">+33 (France)</option>
          <option value="+81">+81 (Japan)</option>
          <option value="+86">+86 (China)</option>
          <option value="+91">+91 (India)</option>
          <option value="+61">+61 (Australia)</option>
        </select>
      </div>

      {/* Privacy Notice */}
      <div className="mt-8 p-4 bg-surface-elevated rounded-lg border border-dark-700">
        <h4 className="text-sm font-medium text-text-primary mb-2">🔒 Privacy Notice</h4>
        <ul className="text-xs text-text-muted space-y-2">
          <li>• Call history is stored locally only</li>
          <li>• Deleted records are permanently erased</li>
          <li>• *67 hides your caller ID from recipients</li>
          <li>• Carrier records may still exist on their end</li>
          <li>• For maximum privacy, use anonymous mode</li>
        </ul>
      </div>

      {/* VOIP Provider Notice */}
      <div className="mt-4 p-4 bg-yellow-900/20 rounded-lg border border-yellow-700/50">
        <h4 className="text-sm font-medium text-yellow-500 mb-2">⚠️ Provider Required</h4>
        <p className="text-xs text-text-muted">
          To make real phone calls, you'll need to configure a VOIP provider (Twilio, etc.) in the backend. 
          Contact your administrator to set this up.
        </p>
      </div>
    </div>
  );
};

// ==================== VoipPage Component ====================

export const VoipPage = () => {
  const [activeTab, setActiveTab] = useState<VoipTab>('dialer');
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const { activeCall, setDialerInput } = useVoipStore();

  const handleSelectNumber = (number: string) => {
    setDialerInput(number);
    setActiveTab('dialer');
  };

  const tabs = [
    { id: 'dialer' as VoipTab, label: 'Dialer', icon: <DialpadIcon /> },
    { id: 'history' as VoipTab, label: 'History', icon: <HistoryIcon /> },
    { id: 'settings' as VoipTab, label: 'Settings', icon: <SettingsIcon /> },
  ];

  return (
    <div className="flex flex-col h-full bg-surface-tertiary">
      {/* Header */}
      <div className="bg-surface-primary border-b border-dark-800 px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Anonymous Phone</h1>
            <p className="text-xs text-text-muted">Make private calls with *67</p>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex bg-surface-primary border-b border-dark-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'dialer' && (
          <div className="p-6">
            <VoipDialer />
          </div>
        )}
        {activeTab === 'history' && (
          <div className="h-full">
            <CallHistory onSelectNumber={handleSelectNumber} />
          </div>
        )}
        {activeTab === 'settings' && <VoipSettings />}
      </div>

      {/* Active Call Overlay */}
      {activeCall && (
        <ActiveCall
          minimized={isCallMinimized}
          onToggleMinimize={() => setIsCallMinimized(!isCallMinimized)}
        />
      )}
    </div>
  );
};

export default VoipPage;
