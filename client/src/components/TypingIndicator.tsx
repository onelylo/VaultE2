import React from 'react';
import { Ellipsis } from 'lucide-react';

interface TypingIndicatorProps {
  usernames: string[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ usernames }) => {
  if (usernames.length === 0) return null;

  let text = '';
  if (usernames.length === 1) {
    text = `${usernames[0]} is typing`;
  } else if (usernames.length === 2) {
    text = `${usernames[0]} and ${usernames[1]} are typing`;
  } else {
    text = `${usernames[0]} and ${usernames.length - 1} others are typing`;
  }

  return (
    <div className="flex items-center gap-2 px-5 py-1.5" style={{ backgroundColor: 'var(--bg-surface)' }}>
      <div className="flex items-center gap-1">
        <div className="flex space-x-1">
          <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent-primary)', animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent-primary)', animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent-primary)', animationDelay: '300ms' }} />
        </div>
      </div>
      <span className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>{text}</span>
    </div>
  );
};
