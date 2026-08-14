import React, { useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, Trash2, UserPlus, UserMinus, Crown, Search, LogOut, Hash, Lock, Megaphone, Paperclip, Image, FileText, Film, Calendar, Mic } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db';
import type { Channel, User, UserKeyPair, LocalMessage } from '../../types/chat';

function getDateGroup(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= today) return 'Today';
  if (d >= new Date(today.getTime() - 86400000)) return 'Yesterday';
  if (d >= new Date(today.getTime() - 7 * 86400000)) return 'This Week';
  return 'Earlier';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function ChannelSettingsModal({
  channel, isOpen, onClose, onUpdate, onDelete, allUsers, currentUser, onMemberClick, onLeaveChannel,
}: {
  channel?: Channel; isOpen: boolean; onClose: () => void;
  onUpdate: (id: string, data: Partial<Pick<Channel, 'name' | 'description' | 'memberIds' | 'isAnnouncement' | 'allowedRoles' | 'slowModeSeconds'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  allUsers: User[]; currentUser?: User | UserKeyPair;
  onMemberClick?: (user: User) => void; onLeaveChannel?: (channelId: string) => void;
}) {
  if (!isOpen || !channel) return null;
  return <ChannelSettingsInner channel={channel} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete}
    allUsers={allUsers} currentUser={currentUser} onMemberClick={onMemberClick} onLeaveChannel={onLeaveChannel} />;
}

function ChannelSettingsInner({
  channel, onClose, onUpdate, onDelete, allUsers, currentUser, onMemberClick, onLeaveChannel,
}: {
  channel: Channel; onClose: () => void;
  onUpdate: (id: string, data: Partial<Pick<Channel, 'name' | 'description' | 'memberIds' | 'isAnnouncement' | 'allowedRoles' | 'slowModeSeconds'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  allUsers: User[]; currentUser?: User | UserKeyPair;
  onMemberClick?: (user: User) => void; onLeaveChannel?: (channelId: string) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || '');
  const [memberIds, setMemberIds] = useState<string[]>(channel.memberIds || []);
  const [memberSearch, setMemberSearch] = useState('');
  const [slowMode, setSlowMode] = useState(channel.slowModeSeconds || 0);
  const [isAnnouncement, setIsAnnouncement] = useState(channel.isAnnouncement || false);
  const [activeTab, setActiveTab] = useState<'all' | 'images' | 'audio' | 'video' | 'docs'>('all');
  const [shaking, setShaking] = useState(false);
  const [editingField, setEditingField] = useState<'name' | 'description' | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const isOwner = channel.createdBy === currentUser?.userId;
  const canEditSettings = channel.type === 'official' ? currentUser?.role === 'ADMIN' : isOwner;
  const canManageMembers = canEditSettings && (channel.type === 'team' || channel.type === 'private');

  const hasChanges = name !== channel.name || description !== (channel.description || '') ||
    slowMode !== (channel.slowModeSeconds || 0) || isAnnouncement !== (channel.isAnnouncement || false) ||
    JSON.stringify(memberIds) !== JSON.stringify(channel.memberIds || []);

  // For official channels, all users are members; for team, all except self
  const effectiveMemberIds = channel.type === 'official'
    ? allUsers.map(u => u.userId)
    : channel.type === 'team'
      ? allUsers.filter(u => u.userId !== currentUser?.userId).map(u => u.userId)
      : channel.memberIds || [];

  const sharedMessages = useLiveQuery(async () => {
    const all = await db.messages.toArray();
    return all.filter(m => m.channelId === channel.id && m.attachmentMeta).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [channel.id]) || [];

  const images = sharedMessages.filter(m => m.attachmentMeta?.mimeType?.startsWith('image/'));
  const audio = sharedMessages.filter(m => m.attachmentMeta?.mimeType?.startsWith('audio/'));
  const video = sharedMessages.filter(m => m.attachmentMeta?.mimeType?.startsWith('video/'));
  const docs = sharedMessages.filter(m => m.attachmentMeta?.mimeType && !m.attachmentMeta.mimeType.startsWith('image/') && !m.attachmentMeta.mimeType.startsWith('audio/') && !m.attachmentMeta.mimeType.startsWith('video/'));
  const currentMedia = activeTab === 'all' ? sharedMessages : activeTab === 'images' ? images : activeTab === 'video' ? video : activeTab === 'audio' ? audio : docs;
  const totalSize = sharedMessages.reduce((s, m) => s + (m.attachmentMeta?.fileSize || 0), 0);

  const grouped: { label: string; items: LocalMessage[] }[] = [];
  let lastGroup = '';
  for (const msg of currentMedia) {
    const g = getDateGroup(msg.timestamp || 0);
    if (g !== lastGroup) { grouped.push({ label: g, items: [] }); lastGroup = g; }
    grouped[grouped.length - 1].items.push(msg);
  }

  const currentMembers = useMemo(() => memberIds.map(id => allUsers.find(u => u.userId === id)).filter(Boolean) as User[], [memberIds, allUsers]);
  const availableUsers = useMemo(() => {
    const sl = memberSearch.toLowerCase();
    return allUsers.filter(u => !memberIds.includes(u.userId) && (u.username.toLowerCase().includes(sl) || (u.fullName || '').toLowerCase().includes(sl)));
  }, [allUsers, memberIds, memberSearch]);

  const triggerShake = useCallback(() => {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }, []);

  const handleClose = useCallback(() => {
    if (hasChanges) { triggerShake(); return; }
    onClose();
  }, [hasChanges, onClose, triggerShake]);

  const handleAddMember = (userId: string) => { setMemberIds(prev => [...prev, userId]); setMemberSearch(''); };
  const handleRemoveMember = (userId: string) => { setMemberIds(prev => prev.filter(id => id !== userId)); };

  const handleSave = async () => {
    await onUpdate(channel.id, { name, description, memberIds, slowModeSeconds: slowMode, isAnnouncement });
  };

  const SLOW_OPTIONS = [
    { value: 0, label: 'Off' }, { value: 5, label: '5s' }, { value: 10, label: '10s' },
    { value: 30, label: '30s' }, { value: 60, label: '1m' }, { value: 120, label: '2m' }, { value: 300, label: '5m' },
  ];

  const typeConfig: Record<string, { label: string; color: string; icon: typeof Hash }> = {
    official: { label: 'OFFICIAL', color: '#f87171', icon: Megaphone },
    team: { label: 'TEAM', color: '#34d399', icon: Users },
    public: { label: 'PUBLIC', color: '#60a5fa', icon: Hash },
    private: { label: 'PRIVATE', color: 'var(--accent-primary)', icon: Lock },
  };
  const typeInfo = typeConfig[channel.type] || typeConfig.private;
  const TypeIcon = typeInfo.icon;
  const mediaTabs = [
    { id: 'all' as const, label: 'All', icon: FileText }, { id: 'images' as const, label: 'Photos', icon: Image },
    { id: 'video' as const, label: 'Video', icon: Film }, { id: 'audio' as const, label: 'Audio', icon: Mic },
    { id: 'docs' as const, label: 'Docs', icon: Paperclip },
  ];
  const tabCounts = { all: sharedMessages.length, images: images.length, video: video.length, audio: audio.length, docs: docs.length };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}>
      <div ref={modalRef}
        className={`w-full max-w-sm rounded-2xl relative animate-[scaleIn_0.15s_ease-out] max-h-[85vh] flex flex-col overflow-hidden ${shaking ? 'animate-shake' : ''}`}
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 30px var(--glow-color)' }}
        onClick={e => e.stopPropagation()}>

        <button onClick={handleClose} className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center z-10"
          style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          <X className="w-4 h-4" />
        </button>

        <div className="overflow-y-auto flex-1 p-6">
          {/* Channel Identity with double-click to edit */}
          <div className="flex flex-col items-center space-y-2 mb-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '3px solid var(--border-color)', color: 'var(--accent-primary)' }}>
              #
            </div>
            {/* Channel name - double-click to edit */}
            {canEditSettings && editingField === 'name' ? (
              <div className="w-full max-w-[220px]">
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  onBlur={() => setEditingField(null)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditingField(null); if (e.key === 'Escape') { setName(channel.name); setEditingField(null); } }}
                  autoFocus
                  className="w-full rounded-xl py-2 px-4 text-sm text-center font-bold focus:outline-none transition-all"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--accent-primary)', color: 'var(--text-main)' }}
                />
              </div>
            ) : (
              <h3 className="font-bold text-sm cursor-pointer hover:underline"
                style={{ color: 'var(--text-main)' }}
                onDoubleClick={() => canEditSettings && setEditingField('name')}>
                #{name}
              </h3>
            )}
            <div className="flex items-center justify-center gap-1.5">
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1"
                style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: typeInfo.color, border: `1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)` }}>
                <TypeIcon className="w-2.5 h-2.5" />{typeInfo.label}
              </span>
              {isAnnouncement && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                  style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>READ ONLY</span>
              )}
            </div>
          </div>

          {/* Description - double-click to edit */}
          {canEditSettings && editingField === 'description' ? (
            <div className="mb-3">
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Set description..."
                onBlur={() => setEditingField(null)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingField(null); if (e.key === 'Escape') { setDescription(channel.description || ''); setEditingField(null); } }}
                autoFocus
                className="w-full rounded-xl py-2 px-4 text-sm focus:outline-none transition-all"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--accent-primary)', color: 'var(--text-main)' }}
              />
            </div>
          ) : (
            <div className="mb-3 cursor-pointer hover:opacity-80" onDoubleClick={() => canEditSettings && setEditingField('description')}>
              {channel.description ? (
                <div className="px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                  <span className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>DESCRIPTION</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-main)' }}>{channel.description}</span>
                </div>
              ) : canEditSettings ? (
                <div className="px-3 py-2 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-input)', border: '1px dashed var(--border-color)' }}>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Double-click to add description</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Editable fields for owner/admin */}
          {canEditSettings && (
            <div className="space-y-2 mb-4">
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>SLOW MODE</label>
                <select value={slowMode} onChange={e => setSlowMode(Number(e.target.value))}
                  className="w-full rounded-xl py-2 px-3 text-xs focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                  {SLOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {channel.type === 'official' && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>READ ONLY</span>
                  <button type="button" onClick={() => setIsAnnouncement(prev => !prev)}
                    className="relative w-10 h-5 rounded-full transition-colors"
                    style={{ backgroundColor: isAnnouncement ? 'var(--accent-primary)' : 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                    <span className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full transition-transform"
                      style={{ backgroundColor: 'white', transform: isAnnouncement ? 'translateX(20px)' : 'translateX(0)' }} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Shared Media */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-muted)' }}>SHARED MEDIA</h4>
              {sharedMessages.length > 0 && <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{formatSize(totalSize)} · {sharedMessages.length}</span>}
            </div>
            <div className="flex gap-0.5 mb-2 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              {mediaTabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-bold transition-all"
                  style={{ backgroundColor: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent', color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-muted)' }}>
                  <tab.icon className="w-2.5 h-2.5" />
                  {tabCounts[tab.id] > 0 && <span className="ml-0.5 opacity-70">{tabCounts[tab.id]}</span>}
                </button>
              ))}
            </div>
            {grouped.length > 0 ? (
              <div className="space-y-2">
                {grouped.map(group => (
                  <div key={group.label}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Calendar className="w-2.5 h-2.5" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-[9px] font-bold" style={{ color: 'var(--text-muted)' }}>{group.label}</span>
                      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-color)' }} />
                    </div>
                    <div className="space-y-1">
                      {group.items.map(msg => {
                        const meta = msg.attachmentMeta!;
                        const isImage = meta.mimeType?.startsWith('image/');
                        return (
                          <div key={msg.id} className="flex items-center gap-2 p-1.5 rounded-lg text-[10px]"
                            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                            {isImage && meta.thumbnailDataUrl ? (
                              <img src={meta.thumbnailDataUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--accent-primary)' }}>
                                <Paperclip className="w-3 h-3" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="font-bold truncate" style={{ color: 'var(--text-main)' }}>{meta.fileName}</p>
                              <p style={{ color: 'var(--text-muted)' }}>{formatSize(meta.fileSize || 0)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <Paperclip className="w-5 h-5 mx-auto mb-1" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No files shared yet</p>
              </div>
            )}
          </div>

          {/* Editable Members (team/private) - list style */}
          {canManageMembers && (
            <div className="mb-4">
              <h4 className="text-[10px] font-bold tracking-wider flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
                <Users className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>MEMBERS ({currentMembers.length})</span>
              </h4>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                <input type="search" value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Add members..."
                  className="w-full rounded-xl py-1.5 pl-8 pr-3 text-[11px] focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
                {memberSearch && availableUsers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 max-h-32 overflow-y-auto rounded-xl z-10 p-1"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    {availableUsers.slice(0, 5).map(user => (
                      <button key={user.userId} onClick={() => handleAddMember(user.userId)}
                        className="w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 text-[11px]"
                        style={{ color: 'var(--text-main)' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                        <span className="font-semibold truncate">{user.fullName || user.username}</span>
                        <UserPlus className="w-3 h-3 ml-auto" style={{ color: '#34d399' }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Member list - full rows */}
              <div className="space-y-1 rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                {currentMembers.map(member => (
                  <div key={member.userId}
                    className="flex items-center justify-between px-3 py-2 transition-colors"
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: onMemberClick ? 'pointer' : 'default' }}
                    onClick={() => onMemberClick?.(member)}
                    onMouseEnter={e => onMemberClick && (e.currentTarget.style.backgroundColor = 'var(--hover-color)')}
                    onMouseLeave={e => onMemberClick && (e.currentTarget.style.backgroundColor = 'transparent')}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                        {member.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-main)' }}>
                            {member.fullName || member.username}
                          </span>
                          {member.userId === currentUser?.userId && (
                            <span className="text-[8px] px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}>YOU</span>
                          )}
                          {member.userId === channel.createdBy && (
                            <Crown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                          )}
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>@{member.username}</span>
                      </div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleRemoveMember(member.userId); }}
                      className="p-1.5 rounded-lg flex-shrink-0" style={{ color: '#f87171' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Read-only Members - list style */}
          {!canManageMembers && (
            <div className="mb-4">
              <h4 className="text-[10px] font-bold tracking-wider flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
                <Users className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                <span>MEMBERS ({effectiveMemberIds.length})</span>
              </h4>
              <div className="space-y-1 rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                {effectiveMemberIds.map(id => {
                  const user = allUsers.find(u => u.userId === id);
                  if (!user) return null;
                  return (
                    <div key={id} className="flex items-center gap-2.5 px-3 py-2"
                      style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                        style={{ backgroundColor: 'var(--bg-card)', color: 'var(--accent-primary)' }}>
                        {user.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-main)' }}>{user.fullName || user.username}</span>
                          {id === currentUser?.userId && (
                            <span className="text-[8px] px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}>YOU</span>
                          )}
                          {id === channel.createdBy && (
                            <Crown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                          )}
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>@{user.username}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Actions - at the bottom */}
        <div className="flex items-center gap-2 p-4 shrink-0" style={{ borderTop: '1px solid var(--border-color)' }}>
          {canEditSettings && (
            <button onClick={handleSave} disabled={!hasChanges}
              className="flex-1 py-2 px-3 rounded-xl font-bold text-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: hasChanges ? '#ef4444' : 'var(--accent-primary)', color: 'var(--accent-text)' }}>
              {hasChanges ? 'SAVE' : 'CLOSE'}
            </button>
          )}
          {!canEditSettings && (channel.type === 'team' || channel.type === 'private') && onLeaveChannel && (
            <button onClick={() => { onLeaveChannel(channel.id); onClose(); }}
              className="flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
              <LogOut className="w-3 h-3" /> LEAVE
            </button>
          )}
          {canEditSettings && (
            <button onClick={() => { onDelete(channel.id); onClose(); }}
              className="py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
