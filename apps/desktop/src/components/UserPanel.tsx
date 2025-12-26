import { NukeButton } from './security';

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
  if (!user) return null;

  return (
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
      <div className="p-4 flex-1">
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
        <p className="text-xs text-text-muted">
          🔐 Device verified
        </p>
        <p className="text-xs text-text-muted mt-1">
          🔑 Keys stored locally
        </p>
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
  );
}
