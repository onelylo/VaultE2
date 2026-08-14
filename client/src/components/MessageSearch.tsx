import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, MessageSquare, Hash, ArrowRight } from 'lucide-react';
import { db } from '../lib/db';
import type { LocalMessage, User, Channel } from '../types/chat';

interface MessageSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMessage: (message: LocalMessage) => void;
  allUsers: User[];
  channels: Channel[];
  selectedUser?: User | null;
  selectedChannel?: Channel | null;
  currentUserId?: string;
}

export const MessageSearch: React.FC<MessageSearchProps> = ({
  isOpen,
  onClose,
  onSelectMessage,
  allUsers,
  channels,
  selectedUser,
  selectedChannel,
  currentUserId,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Highlight matching text in search results
  const highlightMatch = (text: string, q: string): React.ReactNode => {
    if (!q.trim()) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + q.length);
    const after = text.slice(idx + q.length);
    return (
      <>
        {before}
        <mark className="bg-yellow-500/30 text-[var(--text-main)] rounded px-0.5">{match}</mark>
        {after}
      </>
    );
  };

  const userLookup = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const u of allUsers) {
      map.set(u.userId, u.fullName || u.username);
    }
    return map;
  }, [allUsers]);

  const channelLookup = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const c of channels) {
      map.set(c.id, c.name);
    }
    return map;
  }, [channels]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isOpen, onClose]);

  // Search messages — scoped to current DM/channel if one is open
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const allMessages = await db.messages.toArray();
        const lowerQuery = query.toLowerCase();
        let filtered = allMessages.filter(m => m.text && m.text.toLowerCase().includes(lowerQuery) && !m.isDeleted);
        // Scope to current conversation
        if (selectedChannel) {
          filtered = filtered.filter(m => m.channelId === selectedChannel.id);
        } else if (selectedUser && currentUserId) {
          // DM filter: messages between current user and selected user
          filtered = filtered.filter(m =>
            !m.channelId && (
              (m.senderId === currentUserId && m.recipientId === selectedUser.userId) ||
              (m.senderId === selectedUser.userId && m.recipientId === currentUserId)
            )
          );
        }
        const matches = filtered
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 50);
        setResults(matches);
        setSelectedIndex(0);
      } catch (e) {
        console.error('[Search] Error:', e);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, selectedUser, selectedChannel, currentUserId]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      onSelectMessage(results[selectedIndex]);
      onClose();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const el = resultsRef.current?.children[selectedIndex] as HTMLElement;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getConversationName = (msg: LocalMessage) => {
    if (msg.channelId) {
      return `#${channelLookup.get(msg.channelId) || 'channel'}`;
    }
    const otherId = msg.senderId === msg.recipientId ? msg.senderId : (msg.senderId || msg.recipientId);
    return `@${userLookup.get(otherId || '') || 'user'}`;
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] p-4 animate-fadeIn"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden animate-scaleIn"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <Search className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedChannel ? `Search in #${selectedChannel.name}…` : selectedUser ? `Search with ${selectedUser.fullName || selectedUser.username}…` : 'Search messages…'}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text-main)' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 rounded-lg transition-smooth" style={{ color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[50vh] overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Searching…
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              No messages found matching "{query}"
            </div>
          )}

          {!loading && results.map((msg, i) => (
            <button
              key={msg.id}
              onClick={() => { onSelectMessage(msg); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
              className="w-full text-left px-4 py-3 flex items-start gap-3 transition-smooth"
              style={{
                backgroundColor: i === selectedIndex ? 'var(--hover-color)' : 'transparent',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ backgroundColor: msg.channelId ? 'color-mix(in srgb, #60a5fa 12%, transparent)' : 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid var(--border-color)' }}>
                {msg.channelId ? (
                  <Hash className="w-4 h-4" style={{ color: '#60a5fa' }} />
                ) : (
                  <MessageSquare className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold" style={{ color: 'var(--accent-primary)' }}>{getConversationName(msg)}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>·</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatTime(msg.timestamp)}</span>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-main)' }}>
                  {highlightMatch(msg.text || '', query)}
                </p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100" style={{ color: 'var(--text-muted)' }} />
            </button>
          ))}

          {!query.trim() && (
            <div className="p-6 text-center">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selectedChannel ? `Search messages in #${selectedChannel.name}` : selectedUser ? `Search messages with ${selectedUser.fullName || selectedUser.username}` : 'Type to search across all messages'}</p>
              <div className="flex items-center justify-center gap-4 mt-3">
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>↑↓</kbd>
                  <span>Navigate</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>↵</kbd>
                  <span>Select</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>esc</kbd>
                  <span>Close</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
