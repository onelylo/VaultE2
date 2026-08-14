import React, { useState, useRef, useEffect } from 'react';
import { X, ShieldCheck, Image, FileText, Camera, Mic, Paperclip, Film, Calendar, ArrowRight } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { User, LocalMessage } from '../types/chat';

interface ProfileModalProps {
  user: User;
  currentUserId: string;
  onClose: () => void;
  onStartDM?: () => void;
  onBlock?: () => void;
  onImageClick?: (url: string, name?: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}

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

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user, currentUserId, onClose, onStartDM, onBlock, onImageClick, onJumpToMessage,
}) => {
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'images' | 'audio' | 'video' | 'docs'>('all');

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { showFullAvatar ? setShowFullAvatar(false) : onClose(); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [showFullAvatar, onClose]);

  const sharedMessages = useLiveQuery(async () => {
    const all = await db.messages.toArray();
    return all
      .filter(m => m.attachmentMeta &&
        ((m.senderId === currentUserId && m.recipientId === user.userId) ||
         (m.senderId === user.userId && m.recipientId === currentUserId)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [currentUserId, user.userId]) || [];

  const images = sharedMessages.filter(m => m.attachmentMeta?.mimeType?.startsWith('image/'));
  const audio = sharedMessages.filter(m => m.attachmentMeta?.mimeType?.startsWith('audio/'));
  const video = sharedMessages.filter(m => m.attachmentMeta?.mimeType?.startsWith('video/'));
  const docs = sharedMessages.filter(m => m.attachmentMeta?.mimeType && !m.attachmentMeta.mimeType.startsWith('image/') && !m.attachmentMeta.mimeType.startsWith('audio/') && !m.attachmentMeta.mimeType.startsWith('video/'));

  const currentList = activeTab === 'all' ? sharedMessages : activeTab === 'images' ? images : activeTab === 'video' ? video : activeTab === 'audio' ? audio : docs;
  const totalSize = sharedMessages.reduce((s, m) => s + (m.attachmentMeta?.fileSize || 0), 0);

  // Group by date
  const grouped: { label: string; items: LocalMessage[] }[] = [];
  let lastGroup = '';
  for (const msg of currentList) {
    const g = getDateGroup(msg.timestamp || 0);
    if (g !== lastGroup) { grouped.push({ label: g, items: [] }); lastGroup = g; }
    grouped[grouped.length - 1].items.push(msg);
  }

  const tabs = [
    { id: 'all' as const, label: 'All', icon: FileText },
    { id: 'images' as const, label: 'Photos', icon: Image },
    { id: 'video' as const, label: 'Video', icon: Film },
    { id: 'audio' as const, label: 'Audio', icon: Mic },
    { id: 'docs' as const, label: 'Docs', icon: Paperclip },
  ];
  const tabCounts = { all: sharedMessages.length, images: images.length, video: video.length, audio: audio.length, docs: docs.length };

  return (
    <>
      {showFullAvatar && user.avatarUrl && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
          style={{ backgroundColor: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowFullAvatar(false)}>
          <img src={user.avatarUrl} alt="avatar"
            className="max-w-[50vw] max-h-[50vh] rounded-xl object-cover"
            style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()} />
        </div>
      )}

      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}>
        <div className="w-full max-w-sm rounded-2xl relative animate-[scaleIn_0.15s_ease-out] max-h-[85vh] flex flex-col overflow-hidden"
          style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5), 0 0 30px var(--glow-color)' }}
          onClick={e => e.stopPropagation()}>

          <button onClick={onClose} className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center z-10"
            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>

          <div className="overflow-y-auto flex-1 p-6">
            {/* Avatar + name */}
            <div className="flex flex-col items-center space-y-3 mb-4">
              <div className={`relative ${user.avatarUrl ? 'cursor-pointer' : ''}`}
                onClick={() => user.avatarUrl && setShowFullAvatar(true)}>
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="avatar" className="w-20 h-20 rounded-2xl object-cover" style={{ border: '3px solid var(--border-color)' }} />
                ) : (
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '3px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                    {user.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2"
                  style={{ borderColor: 'var(--bg-surface)', backgroundColor: user.isOnline ? (user.isAway ? '#f59e0b' : '#34d399') : 'var(--text-muted)', boxShadow: user.isOnline ? (user.isAway ? '0 0 8px #f59e0b' : '0 0 8px #34d399') : 'none' }} />
              </div>
              <div className="text-center">
                <h3 className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>{user.fullName || user.username}</h3>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{user.username}</span>
              </div>
            </div>

            {/* Status + Role */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>STATUS</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: user.isOnline ? (user.isAway ? '#f59e0b' : '#34d399') : 'var(--text-muted)', boxShadow: user.isOnline ? (user.isAway ? '0 0 6px #f59e0b' : '0 0 6px #34d399') : 'none' }} />
                  <span className="text-[11px]" style={{ color: user.isOnline ? (user.isAway ? '#f59e0b' : '#34d399') : 'var(--text-muted)' }}>{user.isOnline ? (user.isAway ? 'Away' : 'Online') : 'Offline'}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>ROLE</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1" style={{
                  backgroundColor: user.role === 'ADMIN' ? 'rgba(239,68,68,0.1)' : user.role === 'SUPERVISOR' ? 'rgba(245,158,11,0.1)' : 'rgba(100,116,139,0.1)',
                  color: user.role === 'ADMIN' ? '#ef4444' : user.role === 'SUPERVISOR' ? '#f59e0b' : '#94a3b8',
                  border: `1px solid ${user.role === 'ADMIN' ? 'rgba(239,68,68,0.3)' : user.role === 'SUPERVISOR' ? 'rgba(245,158,11,0.3)' : 'rgba(100,116,139,0.3)'}`,
                }}>
                  {user.role === 'ADMIN' && <ShieldCheck className="w-3 h-3" />}
                  {user.role}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {onStartDM && (
                <button onClick={onStartDM} className="flex-1 py-2 px-3 rounded-xl font-bold text-xs"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}>MESSAGE</button>
              )}
              {onBlock && (
                <button onClick={onBlock} className="flex-1 py-2 px-3 rounded-xl font-bold text-xs"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#f87171' }}>BLOCK</button>
              )}
            </div>

            {/* Shared Media */}
            {sharedMessages.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>SHARED MEDIA</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{formatSize(totalSize)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>{sharedMessages.length}</span>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-3 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                  {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[9px] font-bold transition-all"
                      style={{ backgroundColor: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent', color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-muted)' }}>
                      <tab.icon className="w-3 h-3" />
                      <span className="hidden sm:inline">{tab.label}</span>
                      {tabCounts[tab.id] > 0 && <span className="ml-0.5 opacity-70">{tabCounts[tab.id]}</span>}
                    </button>
                  ))}
                </div>

                {/* Media */}
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
                          {group.items.map(msg => <MediaItem key={msg.id} msg={msg} activeTab={activeTab} onImageClick={onImageClick} onJumpToMessage={onJumpToMessage} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Paperclip className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No {activeTab !== 'all' ? tabs.find(t => t.id === activeTab)?.label.toLowerCase() : ''} shared yet</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// Separate component so it gets fresh props when grouped list changes
function MediaItem({ msg, activeTab, onImageClick, onJumpToMessage }: {
  msg: LocalMessage; activeTab: string;
  onImageClick?: (url: string, name?: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const meta = msg.attachmentMeta!;
  if (!meta) return null;
  const isImage = meta.mimeType?.startsWith('image/');
  const isAudio = meta.mimeType?.startsWith('audio/');
  const isVideo = meta.mimeType?.startsWith('video/');
  const ts = new Date(msg.timestamp || 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const size = meta.fileSize < 1024 ? `${meta.fileSize} B` : meta.fileSize < 1048576 ? `${(meta.fileSize / 1024).toFixed(1)} KB` : `${(meta.fileSize / 1048576).toFixed(1)} MB`;

  const jumpBtn = onJumpToMessage && (
    <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); onJumpToMessage(msg.id); }}
      className="text-[8px] text-sky-400 font-bold whitespace-nowrap px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-sky-300"
      style={{ backgroundColor: 'rgba(56,189,248,0.1)' }}>
      Go <ArrowRight className="w-2 h-2 inline" />
    </button>
  );

  if (isImage && activeTab === 'images') {
    return (
      <div className="aspect-square rounded-lg overflow-hidden relative group cursor-default" style={{ border: '1px solid var(--border-color)' }}>
        <div className="w-full h-full cursor-pointer" onClick={() => onImageClick?.(meta.thumbnailDataUrl || '', meta.fileName)}>
          {meta.thumbnailDataUrl ? (
            <img src={meta.thumbnailDataUrl} alt={meta.fileName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: 'var(--bg-input)' }}><Camera className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></div>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <p className="text-[8px] text-white truncate flex-1">{meta.fileName}</p>
          {jumpBtn}
        </div>
      </div>
    );
  }

  if (isVideo && activeTab === 'video') {
    return (
      <div className="aspect-video rounded-lg overflow-hidden relative group cursor-default" style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
        <div className="w-full h-full cursor-pointer" onClick={() => onImageClick?.(meta.thumbnailDataUrl || '', meta.fileName)}>
          {meta.thumbnailDataUrl ? <img src={meta.thumbnailDataUrl} alt={meta.fileName} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Film className="w-6 h-6" style={{ color: 'var(--text-muted)' }} /></div>}
          <div className="absolute inset-0 flex items-center justify-center"><div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}><div className="w-0 h-0 border-l-[8px] border-l-white border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent ml-0.5" /></div></div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <p className="text-[8px] text-white truncate flex-1">{meta.fileName} • {size}</p>
          {jumpBtn}
        </div>
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg group cursor-default" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer" style={{ backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}
          onClick={() => onImageClick?.('', meta.fileName)}>
          <Mic className="w-4 h-4" style={{ color: '#10b981' }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold truncate" style={{ color: 'var(--text-main)' }}>{meta.fileName}</p>
          <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{size} • {ts}</p>
        </div>
        {jumpBtn}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg group cursor-default" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer" style={{ backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)' }}
        onClick={() => onImageClick?.('', meta.fileName)}>
        <FileText className="w-4 h-4" style={{ color: '#6366f1' }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold truncate" style={{ color: 'var(--text-main)' }}>{meta.fileName}</p>
        <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{size} • {ts}</p>
      </div>
      {jumpBtn}
    </div>
  );
}
