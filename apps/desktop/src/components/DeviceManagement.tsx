import { useState } from 'react';

interface Device {
  id: string;
  name: string;
  platform: 'desktop' | 'mobile' | 'web';
  lastActive: number;
  isCurrentDevice: boolean;
  createdAt: number;
}

interface DeviceManagementProps {
  devices: Device[];
  onRevokeDevice: (deviceId: string) => Promise<void>;
  onRenameDevice: (deviceId: string, newName: string) => Promise<void>;
  onClose: () => void;
}

const PlatformIcon = ({ platform }: { platform: Device['platform'] }) => {
  switch (platform) {
    case 'desktop':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case 'mobile':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    case 'web':
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      );
  }
};

function formatLastActive(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

export default function DeviceManagement({
  devices,
  onRevokeDevice,
  onRenameDevice,
  onClose,
}: DeviceManagementProps) {
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showConfirmRevoke, setShowConfirmRevoke] = useState<string | null>(null);

  const handleStartEdit = (device: Device) => {
    setEditingDevice(device.id);
    setEditName(device.name);
  };

  const handleSaveEdit = async (deviceId: string) => {
    if (editName.trim()) {
      await onRenameDevice(deviceId, editName.trim());
    }
    setEditingDevice(null);
    setEditName('');
  };

  const handleRevoke = async (deviceId: string) => {
    setRevoking(deviceId);
    try {
      await onRevokeDevice(deviceId);
    } finally {
      setRevoking(null);
      setShowConfirmRevoke(null);
    }
  };

  const sortedDevices = [...devices].sort((a, b) => {
    if (a.isCurrentDevice) return -1;
    if (b.isCurrentDevice) return 1;
    return b.lastActive - a.lastActive;
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-primary rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-dark-700 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Linked Devices
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              {devices.length} device{devices.length !== 1 ? 's' : ''} linked to your account
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
            title="Close"
            aria-label="Close dialog"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Device List */}
        <div className="flex-1 overflow-y-auto">
          <div className="divide-y divide-dark-700">
            {sortedDevices.map((device) => (
              <div key={device.id} className="px-6 py-4">
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`p-2 rounded-lg ${
                    device.isCurrentDevice ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-elevated text-text-muted'
                  }`}>
                    <PlatformIcon platform={device.platform} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {editingDevice === device.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 bg-surface-elevated rounded text-text-primary text-sm"
                          autoFocus
                          placeholder="Device name"
                          aria-label="Device name"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(device.id);
                            if (e.key === 'Escape') {
                              setEditingDevice(null);
                              setEditName('');
                            }
                          }}
                        />
                        <button
                          onClick={() => handleSaveEdit(device.id)}
                          className="px-2 py-1 bg-primary-500 text-white rounded text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingDevice(null);
                            setEditName('');
                          }}
                          className="px-2 py-1 bg-surface-elevated text-text-muted rounded text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">
                          {device.name}
                        </span>
                        {device.isCurrentDevice && (
                          <span className="px-2 py-0.5 bg-primary-500/20 text-primary-400 text-xs font-medium rounded">
                            This device
                          </span>
                        )}
                      </div>
                    )}
                    
                    <div className="flex items-center gap-3 mt-1 text-sm text-text-muted">
                      <span className="capitalize">{device.platform}</span>
                      <span>•</span>
                      <span>Active {formatLastActive(device.lastActive)}</span>
                    </div>
                    
                    <div className="text-xs text-text-muted mt-1">
                      Linked {new Date(device.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Actions */}
                  {!device.isCurrentDevice && editingDevice !== device.id && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleStartEdit(device)}
                        className="p-2 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
                        title="Rename device"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setShowConfirmRevoke(device.id)}
                        className="p-2 hover:bg-red-500/10 rounded text-text-muted hover:text-red-400"
                        title="Revoke device"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Revoke confirmation */}
                {showConfirmRevoke === device.id && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-sm text-red-400 mb-3">
                      Are you sure you want to unlink "{device.name}"? This device will no longer be able to access your messages.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRevoke(device.id)}
                        disabled={revoking === device.id}
                        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50"
                      >
                        {revoking === device.id ? 'Revoking...' : 'Unlink Device'}
                      </button>
                      <button
                        onClick={() => setShowConfirmRevoke(null)}
                        className="px-3 py-1.5 bg-surface-elevated hover:bg-dark-700 text-text-primary rounded text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-dark-700 flex-shrink-0">
          <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm text-yellow-200">
                If you don't recognize a device, unlink it immediately and change your password.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
