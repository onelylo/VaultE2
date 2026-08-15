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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  // Track the last-saved snapshot so hasChanges resets after save
  const savedRef = useRef({ name: channel.name, description: channel.description || '', memberIds: channel.memberIds || [], slowMode: channel.slowModeSeconds || 0, isAnnouncement: channel.isAnnouncement || false });

  const isOwner = channel.createdBy === currentUser?.userId;
  const canEditSettings = channel.type === 'official' ? currentUser?.role === 'ADMIN' : isOwner;
  const canManageMembers = canEditSettings && (channel.type === 'team' || channel.type === 'private');

  const hasChanges = name !== savedRef.current.name || description !== savedRef.current.description ||
    slowMode !== savedRef.current.slowMode || isAnnouncement !== savedRef.current.isAnnouncement ||
    JSON.stringify(memberIds) !== JSON.stringify(savedRef.current.memberIds);

  // All channels show all users as members (including self)
  const baseMemberIds = (channel.type === 'official' || channel.type === 'team')
    ? allUsers.map(u => u.userId)
    : channel.memberIds || [];
  // Always include current user
  const effectiveMemberIds = currentUser && !baseMemberIds.includes(currentUser.userId)
    ? [...baseMemberIds, currentUser.userId]
    : baseMemberIds;

  // Sort: owner first, then current user, then alphabetical
  const sortedMemberIds = [...effectiveMemberIds].sort((a, b) => {
    if (a === channel.createdBy && b !== channel.createdBy) return -1;
    if (b === channel.createdBy && a !== channel.createdBy) return 1;
    if (a === currentUser?.userId && b !== currentUser?.userId) return -1;
    if (b === currentUser?.userId && a !== currentUser?.userId) return 1;
    const ua = allUsers.find(u => u.userId === a) || (currentUser?.userId === a ? currentUser : null);
    const ub = allUsers.find(u => u.userId === b) || (currentUser?.userId === b ? currentUser : null);
    return ((ua as User)?.username || '').localeCompare((ub as User)?.username || '');
  });

  // Helper to find a user (includes current user who is excluded from allUsers)
  const findMember = (id: string): User | undefined => {
    if (id === currentUser?.userId) return currentUser as User;
    return allUsers.find(u => u.userId === id);
  };

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
    // Update saved snapshot so hasChanges resets immediately
    savedRef.current = { name, description, memberIds, slowMode, isAnnouncement };
    onClose();
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

  const renderMemberRow = (member: User) => (
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
            {member.userId === channel.createdBy && (
              <Crown className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
            )}
            {member.userId === currentUser?.userId && (
              <span className="text-[8px] px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', color: 'var(--accent-primary)' }}>YOU</span>
            )}
          </div>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>@{member.username}</span>
        </div>
      </div>
      {canManageMembers && member.userId !== channel.createdBy && (
        <button onClick={e => { e.stopPropagation(); handleRemoveMember(member.userId); }}
          className="p-1.5 rounded-lg flex-shrink-0" style={{ color: '#f87171' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
          <UserMinus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}>
      <div ref={modalRef}
        className={`w-full max-w-md rounded-2xl relative animate-[scaleIn_0.15s_ease-out] max-h-[85vh] flex flex-col overflow-hidden ${shaking ? 'animate-shake' : ''}`}
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 30px var(--glow-color)' }}
        onClick={e => e.stopPropagation()}>

        <button onClick={handleClose} className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center z-10"
          style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          <X className="w-4 h-4" />
        </button>

        <div className="overflow-y-auto flex-1 p-6">
          {/* Channel Identity */}
          <div className="flex flex-col items-center space-y-2 mb-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '3px solid var(--border-color)', color: 'var(--accent-primary)' }}>
              #
            </div>
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

          {/* Description */}
          {canEditSettings && editingField === 'description' ? (
            <div className="mb-4">
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
            <div className="mb-4 cursor-pointer hover:opacity-80" onDoubleClick={() => canEditSettings && setEditingField('description')}>
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

          {/* Editable fields */}
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
                  <div>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>READ ONLY</span>
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Only admins can post</p>
                  </div>
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
              <h4 className="text-[11px] font-bold tracking-wider" style={{ color: 'var(--text-muted)' }}>SHARED MEDIA</h4>
              {sharedMessages.length > 0 && <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{formatSize(totalSize)} &middot; {sharedMessages.length}</span>}
            </div>
            <div className="flex gap-1 mb-3 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              {mediaTabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[9px] font-bold transition-all"
                  style={{ backgroundColor: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent', color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-muted)' }}>
                  <tab.icon className="w-3 h-3" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tabCounts[tab.id] > 0 && <span className="ml-0.5 opacity-70">{tabCounts[tab.id]}</span>}
                </button>
              ))}
            </div>
            {grouped.length > 0 ? (
              <div className="space-y-3">
                {grouped.map(group => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>{group.label}</span>
                      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-color)' }} />
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{group.items.length} {group.items.length === 1 ? 'item' : 'items'}</span>
                    </div>
                    <div className={activeTab === 'images' || activeTab === 'video' ? 'grid grid-cols-3 gap-1.5' : 'space-y-1.5'}>
                      {group.items.map(msg => {
                        const meta = msg.attachmentMeta!;
                        const isImage = meta.mimeType?.startsWith('image/');
                        const isVideo = meta.mimeType?.startsWith('video/');
                        return (
                          <div key={msg.id} className="flex items-center gap-2 p-2 rounded-lg text-[10px]"
                            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                            {isImage && meta.thumbnailDataUrl ? (
                              <img src={meta.thumbnailDataUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                            ) : isVideo && meta.thumbnailDataUrl ? (
                              <img src={meta.thumbnailDataUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: 'var(--bg-card)', color: 'var(--accent-primary)' }}>
                                <Paperclip className="w-4 h-4" />
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
              <div className="text-center py-6">
                <Paperclip className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No files shared yet</p>
              </div>
            )}
          </div>

          {/* Members */}
          <div className="mb-4">
            <h4 className="text-[11px] font-bold tracking-wider flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
              <Users className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>MEMBERS ({sortedMemberIds.length})</span>
            </h4>
            {canManageMembers && (
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
            )}
              <div className="space-y-1 rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                {sortedMemberIds.map(id => {
                  const member = findMember(id);
                  if (!member) return null;
                  return renderMemberRow(member);
                })}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-4 shrink-0" style={{ borderTop: '1px solid var(--border-color)' }}>
          {canEditSettings && hasChanges && (
            <button onClick={handleSave}
              className="w-full py-2.5 px-3 rounded-xl font-bold text-xs transition-all active:scale-95"
              style={{ backgroundColor: '#ef4444', color: 'var(--accent-text)' }}>
              SAVE CHANGES
            </button>
          )}
          {!canEditSettings && (channel.type === 'team' || channel.type === 'private') && onLeaveChannel && (
            <button onClick={() => { onLeaveChannel(channel.id); onClose(); }}
              className="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
              <LogOut className="w-3 h-3" /> LEAVE CHANNEL
            </button>
          )}
          {canEditSettings && (
            <button onClick={() => setConfirmDelete(true)}
              className="w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
              <Trash2 className="w-3 h-3" /> DELETE CHANNEL
            </button>
          )}
        </div>

        {/* Delete Confirmation */}
        {confirmDelete && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setConfirmDelete(false)}>
            <div className="w-full max-w-xs rounded-2xl p-5 animate-[scaleIn_0.15s_ease-out]"
              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
              onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-main)' }}>Delete Channel</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Are you sure you want to delete <strong>#{channel.name}</strong>? This will permanently delete all messages and remove all members.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Cancel</button>
                <button onClick={() => { onDelete(channel.id); onClose(); }} className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ backgroundColor: '#ef4444', color: '#fff' }}>Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
