interface TypingIndicatorProps {
  typingUsers: { userId: string; username: string; timestamp: number }[];
}

export default function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const formatTypingText = () => {
    if (typingUsers.length === 1) {
      return `${typingUsers[0].username} is typing`;
    } else if (typingUsers.length === 2) {
      return `${typingUsers[0].username} and ${typingUsers[1].username} are typing`;
    } else if (typingUsers.length === 3) {
      return `${typingUsers[0].username}, ${typingUsers[1].username}, and ${typingUsers[2].username} are typing`;
    } else {
      return `${typingUsers[0].username}, ${typingUsers[1].username}, and ${typingUsers.length - 2} others are typing`;
    }
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-text-muted">
      {/* Animated dots */}
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-text-muted rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
      <span>{formatTypingText()}</span>
    </div>
  );
}
