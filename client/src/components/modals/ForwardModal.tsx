import React, { useState, useMemo } from 'react';
import { X, Search, Send, MessageSquare, Hash } from 'lucide-react';
import type { User, Channel } from '../../types/chat';

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onForward: (target: { type: 'dm'; userId: string } | { type: 'channel'; channelId: string }) => void;
  allUsers: User[];
  channels: Channel[];
  currentUserId: string;
  messageText: string;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  onForward,
  allUsers,
  channels,
  currentUserId,
  messageText,
}) => {
  const [query, setQuery] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<{ type: 'dm' | 'channel'; id: string } | null>(null);

  const filteredUsers = useMemo(() => {
    return allUsers.filter(u => u.userId !== currentUserId && (
      u.username.toLowerCase().includes(query.toLowerCase()) ||
      u.displayName.toLowerCase().includes(query.toLowerCase())
    ));
  }, [allUsers, currentUserId, query]);

  const filteredChannels = useMemo(() => {
    return channels.filter(ch =>
      ch.name.toLowerCase().includes(query.toLowerCase()) ||
      ch.description.toLowerCase().includes(query.toLowerCase())
    );
  }, [channels, query]);

  const handleForward = () => {
    if (!selectedTarget) return;
    if (selectedTarget.type === 'dm') {
      onForward({ type: 'dm', userId: selectedTarget.id });
    } else {
      onForward({ type: 'channel', channelId: selectedTarget.id });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-scaleIn"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>Forward Message</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="px-5 pt-4">
          <div className="p-3 rounded-xl text-xs max-h-20 overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
            {messageText.slice(0, 200)}{messageText.length > 200 ? '...' : ''}
          </div>
        </div>

        {/* Search */}
        <div className="px-5 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search users or channels..."
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs focus:outline-none"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-60 overflow-y-auto px-3 py-2">
          {/* Channels */}
          {filteredChannels.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Channels</div>
              {filteredChannels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedTarget({ type: 'channel', id: ch.id })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-all ${
                    selectedTarget?.id === ch.id ? 'ring-1' : 'hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: selectedTarget?.id === ch.id
                      ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)'
                      : 'transparent',
                    color: 'var(--text-main)',
                    ...(selectedTarget?.id === ch.id ? { ringColor: 'var(--accent-primary)' } : {}),
                  }}
                >
                  <Hash className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                  <span className="font-medium">{ch.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Users */}
          {filteredUsers.length > 0 && (
            <div>
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Direct Messages</div>
              {filteredUsers.map(user => (
                <button
                  key={user.userId}
                  onClick={() => setSelectedTarget({ type: 'dm', id: user.userId })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-all ${
                    selectedTarget?.id === user.userId ? 'ring-1' : 'hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: selectedTarget?.id === user.userId
                      ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)'
                      : 'transparent',
                    color: 'var(--text-main)',
                    ...(selectedTarget?.id === user.userId ? { ringColor: 'var(--accent-primary)' } : {}),
                  }}
                >
                  <MessageSquare className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{user.displayName || user.username}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>@{user.username}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {filteredChannels.length === 0 && filteredUsers.length === 0 && (
            <p className="text-center py-4 text-xs" style={{ color: 'var(--text-muted)' }}>No results</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 flex justify-end" style={{ borderTop: '1px solid var(--border-color)' }}>
          <button
            onClick={handleForward}
            disabled={!selectedTarget}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}
          >
            <Send className="w-3.5 h-3.5" />
            Forward
          </button>
        </div>
      </div>
    </div>
  );
};
