import React, { useState, useRef, useEffect } from 'react';
import { X, Copy, ShieldCheck } from 'lucide-react';
import type { User } from '../types/chat';

interface ProfileModalProps {
  user: User;
  currentUserId: string;
  onClose: () => void;
  onStartDM?: () => void;
  onBlock?: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user,
  currentUserId,
  onClose,
  onStartDM,
  onBlock,
}) => {
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Full avatar overlay — z-index MUST be higher than the modal */}
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
          className="w-full max-w-xs rounded-2xl p-6 relative animate-[scaleIn_0.15s_ease-out]"
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
          <div className="flex flex-wrap gap-2">
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
        </div>
      </div>
    </>
  );
};
