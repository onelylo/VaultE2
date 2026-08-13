import React, { useState, useRef, useEffect } from 'react';
import { X, Copy, ShieldCheck, Image, Music, FileText, Camera, Mic, Paperclip } from 'lucide-react';
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
}

type MediaTab = 'all' | 'images' | 'audio' | 'docs';

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user,
  currentUserId,
  onClose,
  onStartDM,
  onBlock,
  onImageClick,
}) => {
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<MediaTab>('all');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showFullAvatar) setShowFullAvatar(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showFullAvatar, onClose]);

  // Fetch all messages with attachments between current user and this user
  const sharedMessages = useLiveQuery(async () => {
    const all = await db.messages.toArray();
    return all
      .filter(m =>
        m.attachmentMeta &&
        ((m.senderId === currentUserId && m.recipientId === user.userId) ||
         (m.senderId === user.userId && m.recipientId === currentUserId))
      )
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [currentUserId, user.userId]);

  // Categorize
  const images = sharedMessages?.filter(m => m.attachmentMeta?.mimeType?.startsWith('image/')) || [];
  const audio = sharedMessages?.filter(m => m.attachmentMeta?.mimeType?.startsWith('audio/')) || [];
  const docs = sharedMessages?.filter(m =>
    m.attachmentMeta?.mimeType &&
    !m.attachmentMeta.mimeType.startsWith('image/') &&
    !m.attachmentMeta.mimeType.startsWith('audio/')
  ) || [];
  const allMedia = sharedMessages || [];

  const currentList = activeTab === 'all' ? allMedia : activeTab === 'images' ? images : activeTab === 'audio' ? audio : docs;
  const tabCounts = { all: allMedia.length, images: images.length, audio: audio.length, docs: docs.length };

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const tabs: { id: MediaTab; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All', icon: <FileText className="w-3 h-3" /> },
    { id: 'images', label: 'Photos', icon: <Image className="w-3 h-3" /> },
    { id: 'audio', label: 'Audio', icon: <Mic className="w-3 h-3" /> },
    { id: 'docs', label: 'Docs', icon: <Paperclip className="w-3 h-3" /> },
  ];

  return (
    <>
      {/* Full avatar overlay */}
      {showFullAvatar && user.avatarUrl && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowFullAvatar(false)}
        >
          <img
            src={user.avatarUrl}
            alt={`${user.fullName || user.username}'s avatar`}
            className="max-w-[90vw] max-h-[90vh] rounded-xl object-cover"
            style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Profile modal */}
      <div
        className="fixed inset-0 z-[99999] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          ref={modalRef}
          className="w-full max-w-sm rounded-2xl relative animate-[scaleIn_0.15s_ease-out] max-h-[85vh] flex flex-col overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px var(--glow-color)'
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Close button */}
          <button onClick={onClose} className="absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center transition-smooth z-10"
            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>

          <div className="overflow-y-auto flex-1 p-6 pt-6">
            {/* Avatar + name */}
            <div className="flex flex-col items-center space-y-3 mb-4">
              <div
                className={`relative ${user.avatarUrl ? 'cursor-pointer' : ''}`}
                onClick={() => user.avatarUrl && setShowFullAvatar(true)}
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt="avatar"
                    className="w-20 h-20 rounded-2xl object-cover"
                    style={{ border: '3px solid var(--border-color)' }}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '3px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                    {user.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <span
                  className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2"
                  style={{
                    borderColor: 'var(--bg-surface)',
                    backgroundColor: user.isOnline ? '#34d399' : 'var(--text-muted)',
                    boxShadow: user.isOnline ? '0 0 8px #34d399' : 'none',
                  }}
                />
              </div>

              <div className="text-center">
                <h3 className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>
                  {user.fullName || user.username}
                </h3>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>@{user.username}</span>
              </div>
            </div>

            {/* Role + Online status */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>STATUS</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: user.isOnline ? '#34d399' : 'var(--text-muted)', boxShadow: user.isOnline ? '0 0 6px #34d399' : 'none' }} />
                  <span className="text-[11px]" style={{ color: user.isOnline ? '#34d399' : 'var(--text-muted)' }}>
                    {user.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>ROLE</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1"
                  style={{
                    backgroundColor: user.role === 'ADMIN' ? 'rgba(239, 68, 68, 0.1)' : user.role === 'SUPERVISOR' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                    color: user.role === 'ADMIN' ? '#ef4444' : user.role === 'SUPERVISOR' ? '#f59e0b' : '#94a3b8',
                    border: `1px solid ${user.role === 'ADMIN' ? 'rgba(239, 68, 68, 0.3)' : user.role === 'SUPERVISOR' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`,
                  }}>
                  {user.role === 'ADMIN' && <ShieldCheck className="w-3 h-3" />}
                  {user.role}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {onStartDM && (
                <button onClick={onStartDM}
                  className="flex-1 py-2 px-3 rounded-xl font-bold text-xs transition-smooth"
                  style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}>
                  MESSAGE
                </button>
              )}
              {onBlock && (
                <button onClick={onBlock}
                  className="flex-1 py-2 px-3 rounded-xl font-bold text-xs transition-smooth"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#f87171' }}>
                  BLOCK
                </button>
              )}
            </div>

            {/* Shared Media */}
            {allMedia.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                    SHARED MEDIA
                  </h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                    {allMedia.length}
                  </span>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-3 p-0.5 rounded-lg"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[9px] font-bold transition-all"
                      style={{
                        backgroundColor: activeTab === tab.id ? 'var(--accent-primary)' : 'transparent',
                        color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-muted)',
                      }}
                    >
                      {tab.icon}
                      {tab.label}
                      {tabCounts[tab.id] > 0 && (
                        <span className="ml-0.5 opacity-70">{tabCounts[tab.id]}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Media Grid */}
                {currentList.length > 0 ? (
                  <div className={activeTab === 'images' ? 'grid grid-cols-3 gap-1.5' : 'space-y-1.5'}>
                    {currentList.map(msg => {
                      const meta = msg.attachmentMeta!;
                      const isImage = meta.mimeType?.startsWith('image/');
                      const isAudio = meta.mimeType?.startsWith('audio/');

                      if (isImage) {
                        return (
                          <div
                            key={msg.id}
                            className="aspect-square rounded-lg overflow-hidden cursor-pointer relative group"
                            style={{ border: '1px solid var(--border-color)' }}
                            onClick={() => onImageClick?.(msg.attachmentMeta?.thumbnailDataUrl || '', meta.fileName)}
                          >
                            {meta.thumbnailDataUrl ? (
                              <img src={meta.thumbnailDataUrl} alt={meta.fileName}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center"
                                style={{ backgroundColor: 'var(--bg-input)' }}>
                                <Camera className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (isAudio) {
                        return (
                          <div key={msg.id}
                            className="flex items-center gap-2 p-2 rounded-lg cursor-pointer"
                            style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}
                            onClick={() => onImageClick?.(msg.attachmentMeta?.thumbnailDataUrl || '', meta.fileName)}
                          >
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              <Mic className="w-4 h-4" style={{ color: '#10b981' }} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold truncate" style={{ color: 'var(--text-main)' }}>{meta.fileName}</p>
                              <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{formatSize(meta.fileSize)}</p>
                            </div>
                          </div>
                        );
                      }

                      // Document
                      return (
                        <div key={msg.id}
                          className="flex items-center gap-2 p-2 rounded-lg cursor-pointer"
                          style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}
                          onClick={() => onImageClick?.('', meta.fileName)}
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                            <FileText className="w-4 h-4" style={{ color: '#6366f1' }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold truncate" style={{ color: 'var(--text-main)' }}>{meta.fileName}</p>
                            <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{formatSize(meta.fileSize)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-4">
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
