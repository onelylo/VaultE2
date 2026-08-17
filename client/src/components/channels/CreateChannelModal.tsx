import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Hash, Lock, Users, Megaphone } from 'lucide-react';
import type { User, UserKeyPair } from '../../types/chat';

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChannel: (channel: { name: string; description: string; type: 'official' | 'team' | 'private'; isAnnouncement?: boolean; memberIds?: string[] }) => void;
  users: User[];
  currentUser?: User | UserKeyPair;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  onClose,
  onCreateChannel,
  users,
  currentUser,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'private' | 'team' | 'official'>('private');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const isAdmin = currentUser?.role === 'ADMIN';

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const channelType = isAdmin ? type : 'private';
    onCreateChannel({
      name: name.trim(),
      description: description.trim(),
      type: channelType,
      isAnnouncement: channelType === 'official',
      memberIds: (channelType === 'team' || channelType === 'private') ? selectedUserIds : undefined,
    });
    setName('');
    setDescription('');
    setType('private');
    setSelectedUserIds([]);
    onClose();
  };

  const channelTypes = [
    { key: 'private' as const, icon: Lock, label: 'Private', desc: 'Invite-only channel', color: 'var(--accent-primary)' },
    { key: 'team' as const, icon: Users, label: 'Team', desc: 'Collaborative group', color: '#34d399' },
    { key: 'official' as const, icon: Megaphone, label: 'Official', desc: 'Announcement channel', color: '#f87171' },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 relative max-h-[90vh] overflow-y-auto animate-scaleIn"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px var(--glow-color)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent */}
        <div className="h-0.5 absolute top-0 left-0 right-0" style={{ background: 'linear-gradient(90deg, transparent, var(--accent-primary), transparent)' }} />

        <div className="flex items-center justify-between pb-4 mb-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}
            >
              <Hash className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <span className="font-bold text-base tracking-wide" style={{ color: 'var(--text-main)' }}>Create Channel</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-smooth"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Channel Type</label>
            <div className={`grid gap-3 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {channelTypes.filter(ct => isAdmin || ct.key !== 'official').map(ct => {
                const Icon = ct.icon;
                const isSelected = type === ct.key;
                return (
                  <button
                    key={ct.key}
                    type="button"
                    onClick={() => setType(ct.key)}
                    className="p-3 rounded-xl border text-left transition-smooth"
                    style={{
                      borderColor: isSelected ? ct.color : 'var(--border-color)',
                      backgroundColor: isSelected ? 'color-mix(in srgb, var(--accent-primary) 10%, var(--bg-surface))' : 'var(--bg-card)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4" style={{ color: ct.color }} />
                      <div className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>{ct.label}</div>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{ct.desc}</div>
                  </button>
                );
              })}
            </div>
            {!isAdmin && (
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>Only admins can create official channels.</p>
            )}
          </div>

          {(type === 'private' || type === 'team') && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Select Members</label>
              <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                {users.map(u => (
                  <label key={u.userId} className="flex items-center justify-between p-2 rounded-lg cursor-pointer transition-smooth" style={{ backgroundColor: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)', color: 'var(--accent-primary)' }}
                      >
                        {u.username.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-main)' }}>{u.displayName || u.username}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(u.userId)}
                      onChange={e => {
                        setSelectedUserIds(e.target.checked
                          ? [...selectedUserIds, u.userId]
                          : selectedUserIds.filter(id => id !== u.userId)
                        );
                      }}
                      className="w-4 h-4 rounded accent-[var(--accent-primary)]"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Channel Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. logistics-general"
              className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Purpose of this channel..."
              className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold transition-smooth" style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-bold rounded-xl transition-smooth active:scale-95"
              style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}
            >
              CREATE CHANNEL
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
