/**
 * Group Settings Component
 * 
 * Allows group owners to configure join/post policies,
 * enable paid access, and manage the Stripe Connect account.
 */

import { useState, useCallback, useEffect } from 'react';
import { JoinPolicy, PostPolicy, GroupType } from '@railgun/shared';
import Button from '../ui/Button';

// ============================================================================
// ICONS
// ============================================================================

const GlobeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const LockIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

const CurrencyDollarIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ExclamationCircleIcon = () => (
  <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ============================================================================
// TYPES
// ============================================================================

interface GroupSettingsProps {
  groupId: string;
  currentSettings: {
    handle?: string;
    joinPolicy: JoinPolicy;
    postPolicy: PostPolicy;
    groupType: GroupType;
    isDiscoverable: boolean;
    isPaid: boolean;
    priceAmount?: number;
    priceCurrency?: string;
  };
  stripeConnectStatus?: {
    connected: boolean;
    accountId?: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  };
  onSave: (settings: Partial<GroupSettingsProps['currentSettings']>) => Promise<void>;
  onConnectStripe: () => Promise<void>;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function GroupSettings({
  groupId: _groupId,
  currentSettings,
  stripeConnectStatus,
  onSave,
  onConnectStripe,
}: GroupSettingsProps) {
  const [settings, setSettings] = useState(currentSettings);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Update local state when props change
  useEffect(() => {
    setSettings(currentSettings);
  }, [currentSettings]);

  const handleSave = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await onSave(settings);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsLoading(false);
    }
  }, [settings, onSave]);

  const handleConnectStripe = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await onConnectStripe();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Stripe');
    } finally {
      setIsLoading(false);
    }
  }, [onConnectStripe]);

  return (
    <div className="space-y-6">
      {/* Handle */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <GlobeIcon />
          Group Handle
        </h3>
        <p className="text-sm text-gray-400 mb-3">
          A unique @handle that users can use to find and join your group.
        </p>
        <div className="flex gap-2">
          <span className="text-gray-400 py-2">@</span>
          <input
            type="text"
            value={settings.handle || ''}
            onChange={(e) => setSettings(s => ({ ...s, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
            placeholder="yourgroup"
            maxLength={32}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Only lowercase letters, numbers, and underscores. Max 32 characters.
        </p>
      </div>

      {/* Join Policy */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
          <LockIcon />
          Join Policy
        </h3>
        <div className="space-y-2">
          {[
            { value: JoinPolicy.OPEN, label: 'Open', desc: 'Anyone can join instantly' },
            { value: JoinPolicy.APPROVAL_REQUIRED, label: 'Approval Required', desc: 'Members must be approved by admins' },
            { value: JoinPolicy.INVITE_ONLY, label: 'Invite Only', desc: 'Only users with an invite code can join' },
            { value: JoinPolicy.PAID, label: 'Paid', desc: 'Requires subscription to join' },
          ].map(option => (
            <label
              key={option.value}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                settings.joinPolicy === option.value 
                  ? 'bg-blue-600/20 border border-blue-500' 
                  : 'bg-gray-700 border border-transparent hover:bg-gray-650'
              }`}
            >
              <input
                type="radio"
                name="joinPolicy"
                value={option.value}
                checked={settings.joinPolicy === option.value}
                onChange={() => setSettings(s => ({ ...s, joinPolicy: option.value }))}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                settings.joinPolicy === option.value ? 'border-blue-500' : 'border-gray-500'
              }`}>
                {settings.joinPolicy === option.value && (
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                )}
              </div>
              <div>
                <span className="text-white font-medium">{option.label}</span>
                <p className="text-xs text-gray-400">{option.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Post Policy */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-3">Who Can Post</h3>
        <div className="space-y-2">
          {[
            { value: PostPolicy.OPEN, label: 'Everyone', desc: 'All members can send messages' },
            { value: PostPolicy.OWNER_ONLY, label: 'Owner Only', desc: 'Only you can send messages (broadcast)' },
            { value: PostPolicy.ROLE_BASED, label: 'Role-Based', desc: 'Members with POST_MESSAGES permission' },
          ].map(option => (
            <label
              key={option.value}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                settings.postPolicy === option.value 
                  ? 'bg-blue-600/20 border border-blue-500' 
                  : 'bg-gray-700 border border-transparent hover:bg-gray-650'
              }`}
            >
              <input
                type="radio"
                name="postPolicy"
                value={option.value}
                checked={settings.postPolicy === option.value}
                onChange={() => setSettings(s => ({ ...s, postPolicy: option.value }))}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                settings.postPolicy === option.value ? 'border-blue-500' : 'border-gray-500'
              }`}>
                {settings.postPolicy === option.value && (
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                )}
              </div>
              <div>
                <span className="text-white font-medium">{option.label}</span>
                <p className="text-xs text-gray-400">{option.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Visibility */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-3">Visibility</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.isDiscoverable}
            onChange={(e) => setSettings(s => ({ ...s, isDiscoverable: e.target.checked }))}
            className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
          />
          <div>
            <span className="text-white font-medium">Discoverable</span>
            <p className="text-xs text-gray-400">Show this group in public discovery listings</p>
          </div>
        </label>
      </div>

      {/* Paid Group Setup */}
      {settings.joinPolicy === JoinPolicy.PAID && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
            <CurrencyDollarIcon />
            Paid Group Settings
          </h3>

          {/* Stripe Connect Status */}
          <div className="mb-4 p-3 rounded-lg bg-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {stripeConnectStatus?.chargesEnabled ? (
                  <CheckCircleIcon />
                ) : (
                  <ExclamationCircleIcon />
                )}
                <span className="text-white">
                  {stripeConnectStatus?.connected 
                    ? stripeConnectStatus.chargesEnabled 
                      ? 'Stripe Connected' 
                      : 'Complete Stripe Setup'
                    : 'Connect Stripe'}
                </span>
              </div>
              {!stripeConnectStatus?.chargesEnabled && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConnectStripe}
                  disabled={isLoading}
                >
                  {stripeConnectStatus?.connected ? 'Complete Setup' : 'Connect'}
                </Button>
              )}
            </div>
            {!stripeConnectStatus?.chargesEnabled && (
              <p className="text-xs text-gray-400 mt-2">
                Connect your Stripe account to receive payments (minus 10% platform fee).
              </p>
            )}
          </div>

          {/* Price Settings */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Monthly Price</label>
              <div className="flex gap-2">
                <select
                  title="Currency"
                  value={settings.priceCurrency || 'usd'}
                  onChange={(e) => setSettings(s => ({ ...s, priceCurrency: e.target.value }))}
                  className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                >
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                  <option value="gbp">GBP</option>
                </select>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={(settings.priceAmount || 0) / 100}
                  onChange={(e) => setSettings(s => ({ 
                    ...s, 
                    priceAmount: Math.round(parseFloat(e.target.value) * 100) || 0 
                  }))}
                  placeholder="9.99"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                You'll receive {((settings.priceAmount || 0) * 0.9 / 100).toFixed(2)} {(settings.priceCurrency || 'usd').toUpperCase()} per subscriber/month after platform fees.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error/Success Messages */}
      {error && (
        <div className="p-3 bg-red-600/20 border border-red-500 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-600/20 border border-green-500 rounded-lg text-green-400 text-sm">
          Settings saved successfully!
        </div>
      )}

      {/* Save Button */}
      <Button
        variant="primary"
        className="w-full"
        onClick={handleSave}
        disabled={isLoading}
      >
        {isLoading ? 'Saving...' : 'Save Settings'}
      </Button>
    </div>
  );
}

export default GroupSettings;
