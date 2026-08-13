import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Copy, Fingerprint, ShieldCheck, Info, MoreVertical, MessageSquare, Phone, Video, UserX } from 'lucide-react';
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user.avatarUrl) {
      setAvatarUrl(user.avatarUrl);
    }
  }, [user.avatarUrl]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (showFullAvatar) {
      window.addEventListener('mousedown', handleClick);
      return () => window.removeEventListener('mousedown', handleClick);
    }
  }, [showFullAvatar, onClose]);

  const handleCopyUserId = () => {
    navigator.clipboard.writeText(user.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAvatarClick = () => {
    if (avatarUrl) {
      setShowFullAvatar(true);
    }
  };

  return (
    <>
      {showFullAvatar && avatarUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowFullAvatar(false)}
        >
          <img
            src={avatarUrl}
            alt={`${user.fullName || user.username}'s avatar`}
            className="max-w-[90vw] max-h-[90vh] rounded-lg"
            style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          ref={modalRef}
          className="w-full max-w-md rounded-2xl p-6 relative animate-scaleIn"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px var(--glow-color)'
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="h-0.5 absolute top-0 left-0 right-0" style={{ background: 'linear-gradient(90deg, transparent, var(--accent-primary), transparent)' }} />

          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>{user.fullName || user.username}</h3>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-smooth" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col items-center space-y-4 mb-5">
            <div className="relative" onClick={handleAvatarClick}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="avatar"
                  className="w-24 h-24 rounded-xl object-cover"
                  style={{ border: '2px solid var(--border-color)' }}
                />
              ) : (
                <div className="w-24 h-24 rounded-xl flex items-center justify-center text-2xl font-bold" style={{ backgroundColor: 'var(--bg-input)', border: '2px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                  {user.username.substring(0, 2).toUpperCase()}
                </div>
              )}
              <div className="absolute bottom-1 right-1 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)', boxShadow: '0 0 10px var(--glow-color)' }}>
                <Camera className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Click avatar to enlarge</p>
          </div>

          <div className="space-y-3 mb-5" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <div className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center space-x-2">
                <Fingerprint className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>USER ID</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs" style={{ color: 'var(--text-main)' }}>{user.userId.substring(0, 16)}...</span>
                <button onClick={handleCopyUserId} className="p-1 rounded transition-smooth" style={{ color: 'var(--text-muted)' }} title={copied ? 'Copied!' : 'Copy User ID'}>
                  {copied ? <Copy className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4" style={{ color: '#34d399' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>SECURITY</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                {user.role}
              </span>
            </div>

            {user.email && (
              <div className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>EMAIL</span>
                </div>
                <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>{user.email}</span>
              </div>
            )}

            <div className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center space-x-2">
                <MoreVertical className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>STATUS</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: user.isOnline ? '#34d399' : 'var(--text-muted)', boxShadow: user.isOnline ? '0 0 6px #34d399' : 'none' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{user.isOnline ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {onStartDM && (
              <button onClick={onStartDM} className="flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-bold text-xs transition-smooth flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}>
                <MessageSquare className="w-3.5 h-3.5" />
                <span>MESSAGE</span>
              </button>
            )}
            {onBlock && (
              <button onClick={onBlock} className="flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-bold text-xs transition-smooth flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#f87171' }}>
                <UserX className="w-3.5 h-3.5" />
                <span>BLOCK</span>
              </button>
            )}
          </div>

          <div className="mt-4 pt-4 flex items-center space-x-2" style={{ borderTop: '1px solid var(--border-color)' }}>
            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>ECDH P-256 | AES-256-GCM | TOFU</span>
          </div>
        </div>
      </div>
    </>
  );
};