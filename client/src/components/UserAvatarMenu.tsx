import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, Image, Fingerprint, Copy, Info, MoreHorizontal } from 'lucide-react';
import type { User } from '../types/chat';

interface UserAvatarMenuProps {
  user: User;
  rect: DOMRect;
  onClose: () => void;
  onMessage: () => void;
  onViewPicture: () => void;
  onViewProfile: () => void;
  onCopyId: () => void;
  onShowFingerprint: () => void;
}

export const UserAvatarMenu: React.FC<UserAvatarMenuProps> = ({
  user,
  rect,
  onClose,
  onMessage,
  onViewPicture,
  onViewProfile,
  onCopyId,
  onShowFingerprint,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const top = rect.bottom + 8;
  const left = Math.min(rect.left, window.innerWidth - 200);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] animate-scaleIn"
      style={{ top: `${top}px`, left: `${left}px` }}
      onClick={e => e.stopPropagation()}
    >
      <div
        className="w-48 rounded-xl p-1 shadow-2xl"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        }}
      >
        <button
          onClick={() => { onMessage(); onClose(); }}
          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-bold rounded-lg transition-smooth"
          style={{ color: 'var(--text-main)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <MessageSquare className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>Message</span>
        </button>

        <button
          onClick={() => { onViewPicture(); onClose(); }}
          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-bold rounded-lg transition-smooth"
          style={{ color: 'var(--text-main)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <Image className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>View Picture</span>
        </button>

        <button
          onClick={() => { onViewProfile(); onClose(); }}
          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-bold rounded-lg transition-smooth"
          style={{ color: 'var(--text-main)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <Info className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>View Profile</span>
        </button>

        <button
          onClick={() => { onShowFingerprint(); onClose(); }}
          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-bold rounded-lg transition-smooth"
          style={{ color: 'var(--text-main)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <Fingerprint className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>Show Fingerprint</span>
        </button>

        <button
          onClick={() => { onCopyId(); onClose(); }}
          className="w-full flex items-center space-x-2 px-3 py-2 text-xs font-bold rounded-lg transition-smooth"
          style={{ color: 'var(--text-main)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <Copy className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span>Copy User ID</span>
        </button>
      </div>
    </div>,
    document.body
  );
};