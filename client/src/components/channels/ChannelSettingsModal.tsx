import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Settings, X, Users, Trash2, UserPlus, UserMinus, Crown, Search } from 'lucide-react';
import type { Channel, User, UserKeyPair } from '../../types/chat';

export function ChannelSettingsModal({
  channel,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  allUsers,
  currentUser,
  onMemberClick,
}: {
  channel?: Channel;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Pick<Channel, 'name' | 'description' | 'memberIds' | 'isAnnouncement' | 'allowedRoles' | 'slowModeSeconds'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  allUsers: User[];
  currentUser?: User | UserKeyPair;
  onMemberClick?: (user: User) => void;
}) {
  if (!isOpen || !channel) return null;
  return (
    <ChannelSettingsModalInner
      channel={channel}
      onClose={onClose}
      onUpdate={onUpdate}
      onDelete={onDelete}
      allUsers={allUsers}
      currentUser={currentUser}
      onMemberClick={onMemberClick}
    />
  );
}

function ChannelSettingsModalInner({
  channel,
  onClose,
  onUpdate,
  onDelete,
  allUsers,
  currentUser,
  onMemberClick,
}: {
  channel: Channel;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Pick<Channel, 'name' | 'description' | 'memberIds' | 'isAnnouncement' | 'allowedRoles' | 'slowModeSeconds'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  allUsers: User[];
  currentUser?: User | UserKeyPair;
  onMemberClick?: (user: User) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || '');
  const [memberIds, setMemberIds] = useState<string[]>(channel.memberIds || []);
  const [memberSearch, setMemberSearch] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [slowMode, setSlowMode] = useState(channel.slowModeSeconds || 0);

  const canEditSettings = currentUser?.role === 'ADMIN' || channel.createdBy === currentUser?.userId;
  const canManageMembers = canEditSettings && (channel.type === 'team' || channel.type === 'private');

  const currentMembers = useMemo(() => {
    return memberIds.map(id => allUsers.find(u => u.userId === id)).filter(Boolean) as User[];
  }, [memberIds, allUsers]);

  const availableUsers = useMemo(() => {
    const searchLower = memberSearch.toLowerCase();
    return allUsers.filter(u =>
      !memberIds.includes(u.userId) &&
      (u.username.toLowerCase().includes(searchLower) || (u.fullName || '').toLowerCase().includes(searchLower))
    );
  }, [allUsers, memberIds, memberSearch]);

  const markChanged = () => setHasChanges(true);

  const handleAddMember = (userId: string) => {
    setMemberIds(prev => [...prev, userId]);
    setMemberSearch('');
    markChanged();
  };

  const handleRemoveMember = (userId: string) => {
    setMemberIds(prev => prev.filter(id => id !== userId));
    markChanged();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdate(channel.id, { name, description, memberIds, slowModeSeconds: slowMode });
    setHasChanges(false);
    onClose();
  };

  const typeLabels: Record<string, { label: string; color: string }> = {
    official: { label: 'OFFICIAL', color: '#f87171' },
    team: { label: 'TEAM', color: '#34d399' },
    public: { label: 'PUBLIC', color: '#60a5fa' },
    private: { label: 'PRIVATE', color: 'var(--accent-primary)' },
  };

  const typeInfo = typeLabels[channel.type] || typeLabels.private;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl p-6 relative max-h-[85vh] flex flex-col animate-scaleIn"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px var(--glow-color)'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="h-0.5 absolute top-0 left-0 right-0" style={{ background: 'linear-gradient(90deg, transparent, var(--accent-primary), transparent)' }} />

        <div className="flex items-center justify-between pb-4 mb-4 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}
            >
              <Settings className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <span className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>Channel Settings — #{channel.name}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-smooth"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Channel Info */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <span className="text-[9px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: typeInfo.color, border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}>
                {typeInfo.label}
              </span>
              {channel.isAnnouncement && (
                <span className="text-[9px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  ANNOUNCEMENT
                </span>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Channel Name</label>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); markChanged(); }}
                disabled={!canEditSettings}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => !canEditSettings || (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Channel Description</label>
              <input
                type="text"
                value={description}
                onChange={e => { setDescription(e.target.value); markChanged(); }}
                placeholder="Set channel description..."
                disabled={!canEditSettings}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => !canEditSettings || (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
            </div>

            {/* Slow Mode */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Slow Mode (seconds between messages)</label>
              <select
                value={slowMode}
                onChange={e => { setSlowMode(Number(e.target.value)); markChanged(); }}
                disabled={!canEditSettings}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
              >
                <option value={0}>Off</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
              </select>
            </div>
          </div>

          {/* Members Section */}
          {canManageMembers && (
            <div style={{ borderTop: '1px solid var(--border-color)' }} className="pt-4">
              <h4 className="text-[10px] font-bold tracking-wider flex items-center gap-2 mb-3" style={{ color: 'var(--text-muted)' }}>
                <Users className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span>MEMBERS ({currentMembers.length})</span>
              </h4>

              {/* Search to add members */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Search users to add..."
                  className="w-full rounded-xl py-2 pl-9 pr-3 text-xs focus:outline-none transition-smooth"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
                {memberSearch && availableUsers.length > 0 && (
                  <div
                    className="absolute top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-xl z-10 p-1"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}
                  >
                    {availableUsers.slice(0, 8).map(user => (
                      <button
                        key={user.userId}
                        onClick={() => handleAddMember(user.userId)}
                        className="w-full text-left px-3 py-2 rounded-lg flex items-center space-x-2 transition-smooth text-xs"
                        style={{ color: 'var(--text-main)' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[9px]"
                          style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                          {user.username.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="font-semibold truncate">{user.fullName || user.username}</span>
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>@{user.username}</span>
                        <UserPlus className="w-3 h-3 ml-1" style={{ color: '#34d399' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Current members list */}
              <div className="max-h-56 overflow-y-auto space-y-1 p-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                {currentMembers.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No members yet</p>
                ) : (
                  currentMembers.map(member => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between p-2 rounded-lg transition-smooth"
                      style={{ cursor: onMemberClick ? 'pointer' : 'default' }}
                      onClick={() => onMemberClick?.(member)}
                      onMouseEnter={e => onMemberClick && (e.currentTarget.style.backgroundColor = 'var(--hover-color)')}
                      onMouseLeave={e => onMemberClick && (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                          {member.username.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs truncate flex items-center space-x-1.5" style={{ color: 'var(--text-main)' }}>
                            <span className="font-semibold truncate">{member.fullName || member.username}</span>
                            {member.userId === channel.createdBy && (
                              <Crown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                            )}
                            {member.userId === currentUser?.userId && (
                              <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}>YOU</span>
                            )}
                          </div>
                          <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>@{member.username}</div>
                        </div>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleRemoveMember(member.userId);
                        }}
                        className="p-1.5 rounded-lg transition-smooth flex-shrink-0"
                        style={{ color: '#f87171' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        title="Remove member"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Read-only member view for non-manageable channels (skip for official) */}
          {!canManageMembers && channel.type !== 'official' && (
            <div style={{ borderTop: '1px solid var(--border-color)' }} className="pt-4">
              <h4 className="text-[10px] font-bold tracking-wider flex items-center gap-2 mb-3" style={{ color: 'var(--text-muted)' }}>
                <Users className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span>MEMBERS ({channel.memberIds?.length || 0})</span>
              </h4>
              <div className="flex flex-wrap gap-2">
                {(channel.memberIds || []).map(id => {
                  const user = allUsers.find(u => u.userId === id);
                  if (!user) return null;
                  return (
                    <div key={id} className="flex items-center space-x-1.5 px-2 py-1 rounded-lg text-xs"
                      style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                      <div className="w-5 h-5 rounded flex items-center justify-center font-bold text-[8px]"
                        style={{ backgroundColor: 'var(--bg-card)', color: 'var(--accent-primary)' }}>
                        {user.username.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="font-semibold">{user.fullName || user.username}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 shrink-0" style={{ borderTop: '1px solid var(--border-color)' }}>
          <button
            type="button"
            onClick={() => { onDelete(channel.id); onClose(); }}
            disabled={!canEditSettings}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
            style={{ color: '#f87171' }}
            onMouseEnter={e => !canEditSettings || (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)')}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Trash2 className="w-4 h-4" />
            Delete Channel
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-bold transition-smooth" style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              CLOSE
            </button>
            {canEditSettings && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges}
                className="px-4 py-2 text-xs font-bold rounded-xl transition-smooth active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}
              >
                {hasChanges ? 'SAVE CHANGES' : 'NO CHANGES'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
