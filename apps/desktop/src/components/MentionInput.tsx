import { useState, useRef, useEffect } from 'react';

interface User {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  users: User[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// Parse mentions from text
export function parseMentions(text: string): { userId: string; username: string; startIndex: number; endIndex: number }[] {
  const mentions: { userId: string; username: string; startIndex: number; endIndex: number }[] = [];
  const regex = /@(\w+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      userId: '', // Would be filled by lookup
      username: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  return mentions;
}

// Highlight mentions in text
export function highlightMentions(text: string, currentUserId?: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /@(\w+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // Add highlighted mention
    const isSelfMention = match[1].toLowerCase() === currentUserId?.toLowerCase();
    parts.push(
      <span
        key={match.index}
        className={`px-1 rounded ${
          isSelfMention
            ? 'bg-yellow-500/20 text-yellow-400 font-medium'
            : 'bg-primary-500/20 text-primary-400'
        }`}
      >
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export default function MentionInput({
  value,
  onChange,
  onSubmit,
  users,
  placeholder,
  disabled,
  className,
}: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if we're in a mention context
    const cursorPos = inputRef.current?.selectionStart || value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase();
      const filtered = users.filter(
        (u) =>
          u.username.toLowerCase().includes(query) ||
          u.displayName?.toLowerCase().includes(query)
      ).slice(0, 5);

      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setMentionStartIndex(cursorPos - mentionMatch[0].length);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  }, [value, users]);

  const insertMention = (user: User) => {
    const beforeMention = value.slice(0, mentionStartIndex);
    const cursorPos = inputRef.current?.selectionStart || value.length;
    const afterMention = value.slice(cursorPos);
    const newValue = `${beforeMention}@${user.username} ${afterMention}`;
    onChange(newValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (suggestions[selectedIndex]) {
          e.preventDefault();
          insertMention(suggestions[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />

      {/* Mention suggestions dropdown */}
      {showSuggestions && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface-elevated rounded-lg shadow-xl border border-dark-700 overflow-hidden z-50">
          {suggestions.map((user, index) => (
            <button
              key={user.id}
              onClick={() => insertMention(user)}
              className={`w-full flex items-center gap-3 px-3 py-2 ${
                index === selectedIndex ? 'bg-surface-primary' : 'hover:bg-surface-primary/50'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-semibold">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  user.username.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm text-text-primary font-medium">{user.displayName || user.username}</div>
                <div className="text-xs text-text-muted">@{user.username}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
