import { useRef, useEffect } from 'react';

interface MessageContextMenuProps {
  position: { x: number; y: number };
  onClose: () => void;
  onReply: () => void;
  onReact: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin: () => void;
  onCopy: () => void;
  isOwnMessage: boolean;
  isPinned: boolean;
}

export default function MessageContextMenu({
  position,
  onClose,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onPin,
  onCopy,
  isOwnMessage,
  isPinned,
}: MessageContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Calculate position to keep menu in viewport
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 100,
  };

  const MenuItem = ({
    icon,
    label,
    onClick,
    danger,
  }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      onClick={() => {
        onClick();
        onClose();
      }}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${
        danger
          ? 'text-status-error hover:bg-status-error/10'
          : 'text-text-primary hover:bg-surface-primary'
      } transition-colors`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      style={menuStyle}
      className="w-48 bg-surface-elevated rounded-lg shadow-xl border border-dark-700 py-1 overflow-hidden"
    >
      <MenuItem
        icon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        }
        label="Reply"
        onClick={onReply}
      />

      <MenuItem
        icon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        label="Add Reaction"
        onClick={onReact}
      />

      <MenuItem
        icon={
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        }
        label="Copy Text"
        onClick={onCopy}
      />

      <MenuItem
        icon={
          isPinned ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4.5 9a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0zM8 12.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z" />
            </svg>
          )
        }
        label={isPinned ? 'Unpin' : 'Pin Message'}
        onClick={onPin}
      />

      {isOwnMessage && (
        <>
          <div className="my-1 border-t border-dark-700" />

          {onEdit && (
            <MenuItem
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
              label="Edit"
              onClick={onEdit}
            />
          )}

          {onDelete && (
            <MenuItem
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              }
              label="Delete"
              onClick={onDelete}
              danger
            />
          )}
        </>
      )}
    </div>
  );
}
