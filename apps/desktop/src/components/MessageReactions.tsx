import { useState, useRef, useEffect } from 'react';
import { MessageReaction } from '../stores/chatStore';

// Common emoji reactions
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐'],
  'Gestures': ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '💪', '🦾', '🖕'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💘', '💝'],
  'Objects': ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🎮', '🎯', '🔥', '💯', '✨', '⭐', '🌟', '💫', '⚡', '🌈', '☀️', '🌙', '💎', '🔔', '🎵', '🎶', '💡', '📌', '🔗', '✅', '❌', '⚠️', '❓', '❗', '💬', '👀', '👁️'],
};

interface MessageReactionsProps {
  reactions: MessageReaction[];
  messageId: string;
  onAddReaction: (emoji: string) => void;
  onRemoveReaction: (emoji: string) => void;
  currentUserId: string;
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState<string>('Smileys');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full right-0 mb-2 w-72 bg-surface-elevated rounded-lg shadow-xl border border-dark-700 z-50"
    >
      {/* Quick reactions */}
      <div className="p-2 border-b border-dark-700">
        <div className="flex gap-1">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onSelect(emoji)}
              className="p-2 hover:bg-surface-primary rounded-md text-xl transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex border-b border-dark-700 px-2">
        {Object.keys(EMOJI_CATEGORIES).map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              activeCategory === category
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="p-2 max-h-48 overflow-y-auto">
        <div className="grid grid-cols-8 gap-1">
          {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES].map((emoji) => (
            <button
              key={emoji}
              onClick={() => onSelect(emoji)}
              className="p-1.5 hover:bg-surface-primary rounded text-lg transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Group reactions by emoji
function groupReactions(reactions: MessageReaction[]): Map<string, MessageReaction[]> {
  const grouped = new Map<string, MessageReaction[]>();
  for (const reaction of reactions) {
    const existing = grouped.get(reaction.emoji) || [];
    existing.push(reaction);
    grouped.set(reaction.emoji, existing);
  }
  return grouped;
}

export default function MessageReactions({
  reactions,
  messageId,
  onAddReaction,
  onRemoveReaction,
  currentUserId,
}: MessageReactionsProps) {
  const [showPicker, setShowPicker] = useState(false);
  const grouped = groupReactions(reactions);

  const handleEmojiSelect = (emoji: string) => {
    onAddReaction(emoji);
    setShowPicker(false);
  };

  const handleReactionClick = (emoji: string) => {
    // Check if current user already reacted with this emoji
    const userReacted = reactions.some(
      (r) => r.emoji === emoji && r.userId === currentUserId
    );
    if (userReacted) {
      onRemoveReaction(emoji);
    } else {
      onAddReaction(emoji);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 relative">
      {/* Existing reactions */}
      {Array.from(grouped.entries()).map(([emoji, reactionList]) => {
        const userReacted = reactionList.some((r) => r.userId === currentUserId);
        const usernames = reactionList.map((r) => r.username).join(', ');

        return (
          <button
            key={`${messageId}-${emoji}`}
            onClick={() => handleReactionClick(emoji)}
            title={usernames}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-sm transition-colors ${
              userReacted
                ? 'bg-primary-500/20 border border-primary-500/50 text-primary-300'
                : 'bg-surface-primary/50 border border-transparent hover:border-dark-600 text-text-muted'
            }`}
          >
            <span>{emoji}</span>
            <span className="text-xs font-medium">{reactionList.length}</span>
          </button>
        );
      })}

      {/* Add reaction button */}
      <button
        onClick={() => setShowPicker(!showPicker)}
        className="flex items-center justify-center w-6 h-6 rounded-full bg-surface-primary/30 hover:bg-surface-primary text-text-muted hover:text-text-primary transition-colors"
        title="Add reaction"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {/* Emoji picker */}
      {showPicker && (
        <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowPicker(false)} />
      )}
    </div>
  );
}

export { EmojiPicker, QUICK_REACTIONS };
