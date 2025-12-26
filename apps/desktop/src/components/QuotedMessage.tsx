import { QuotedMessage as QuotedMessageType } from '../stores/chatStore';

interface QuotedMessageProps {
  quote: QuotedMessageType;
  onJumpToMessage?: () => void;
  onClear?: () => void;
  isCompact?: boolean; // For display in message input
}

export default function QuotedMessage({ quote, onJumpToMessage, onClear, isCompact }: QuotedMessageProps) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Truncate content for preview
  const truncatedContent = quote.content.length > 100 
    ? quote.content.slice(0, 100) + '...' 
    : quote.content;

  if (isCompact) {
    // Compact version for message input
    return (
      <div className="flex items-start gap-2 p-2 bg-surface-primary/50 border-l-2 border-primary-500 rounded">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary-400">
              {quote.senderUsername || 'Unknown'}
            </span>
            <span className="text-xs text-text-muted">{formatTime(quote.timestamp)}</span>
          </div>
          <p className="text-sm text-text-muted truncate">{truncatedContent}</p>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="p-1 hover:bg-surface-primary rounded text-text-muted hover:text-text-primary"
            title="Cancel reply"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // Full version displayed in message
  return (
    <button
      onClick={onJumpToMessage}
      className="flex flex-col gap-0.5 p-2 bg-surface-primary/30 border-l-2 border-primary-500/50 rounded text-left w-full hover:bg-surface-primary/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <svg className="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
        <span className="text-xs font-medium text-primary-400">
          {quote.senderUsername || 'Unknown'}
        </span>
      </div>
      <p className="text-xs text-text-muted line-clamp-2">{truncatedContent}</p>
    </button>
  );
}
