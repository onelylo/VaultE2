import React from 'react';
import { X, Fingerprint, Shield, ShieldCheck, Info, Search, Menu } from 'lucide-react';
import type { UserKeyPair, User, Channel } from '../types/chat';

interface HeaderProps {
  currentUser: UserKeyPair | null;
  selectedUser: User | null;
  selectedChannel: Channel | null;
  fingerprint: string;
  peerFingerprint?: string;
  peerUsername?: string;
  isConnected: boolean;
  onCloseChat: () => void;
  showFingerprintModal: boolean;
  onCloseFingerprintModal: () => void;
  onOpenFingerprintModal: () => void;
  onOpenChannelSettings?: (channel: Channel) => void;
  onOpenSearch?: () => void;
  onToggleSidebar?: () => void;
  typingUsers?: string[];
}

interface FingerprintModalProps {
  onClose: () => void;
  ownFingerprint: string;
  ownUsername: string;
  ownRole?: string;
  peerFingerprint?: string;
  peerUsername?: string;
}

const FingerprintModal: React.FC<FingerprintModalProps> = ({
  onClose,
  ownFingerprint,
  ownUsername,
  ownRole,
  peerFingerprint,
  peerUsername,
}) => (
  <div
    className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-fadeIn"
    style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
    onClick={onClose}
  >
    <div
      className="w-full max-w-sm rounded-2xl p-6 relative overflow-hidden animate-scaleIn"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px var(--glow-color)'
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="h-0.5 absolute top-0 left-0 right-0" style={{ background: 'linear-gradient(90deg, transparent, #34d399, transparent)' }} />

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, #34d399 12%, transparent)', border: '1px solid color-mix(in srgb, #34d399 25%, transparent)' }}>
            <ShieldCheck className="w-4 h-4" style={{ color: '#34d399' }} />
          </div>
          <div>
            <h3 className="font-bold text-sm tracking-wider" style={{ color: 'var(--text-main)' }}>SECURITY</h3>
            <p className="text-[10px] font-bold" style={{ color: '#34d399' }}>TOFU Verified E2EE</p>
          </div>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-smooth" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[11px] mb-5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Public keys are validated on first use (TOFU) and pinned locally. Any mismatch blocks messaging to protect against MITM attacks.
      </p>

      <div className="space-y-3">
        <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center space-x-1.5">
              <Fingerprint className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-muted)' }}>YOUR KEY</span>
            </div>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
              {ownRole || 'MEMBER'}
            </span>
          </div>
          <div className="text-sm font-bold tracking-widest" style={{ color: 'var(--accent-primary)' }}>{ownFingerprint || '---'}</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{ownUsername}</div>
        </div>

        {peerUsername ? (
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid color-mix(in srgb, #34d399 20%, transparent)' }}>
            <div className="flex items-center space-x-1.5 mb-2">
              <Fingerprint className="w-3.5 h-3.5" style={{ color: '#34d399' }} />
              <span className="text-[10px] font-bold tracking-wider" style={{ color: 'var(--text-muted)' }}>PEER KEY</span>
            </div>
            <div className="text-sm font-bold tracking-widest" style={{ color: '#34d399' }}>{peerFingerprint || 'Not established'}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{peerUsername}</div>
          </div>
        ) : (
          <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px dashed var(--border-color)' }}>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Select a contact to view peer key</p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 flex items-center space-x-2" style={{ borderTop: '1px solid var(--border-color)' }}>
        <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>ECDH P-256 | AES-256-GCM | SHA-256 TOFU</span>
      </div>
    </div>
  </div>
);

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  selectedUser,
  selectedChannel,
  fingerprint,
  peerFingerprint,
  peerUsername,
  isConnected,
  onCloseChat,
  showFingerprintModal,
  onCloseFingerprintModal,
  onOpenFingerprintModal,
  onOpenChannelSettings,
  onOpenSearch,
  onToggleSidebar,
  typingUsers = [],
}) => {
  return (
    <>
      <header
        className="h-14 px-5 flex items-center justify-between flex-shrink-0 z-10 select-none"
        style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center space-x-3 min-w-0">
          {selectedChannel ? (
            <>
              <div onClick={() => onOpenChannelSettings?.(selectedChannel)} className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer transition-smooth flex-shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)', color: 'var(--accent-primary)' }}>
                #
              </div>
              <div onClick={() => onOpenChannelSettings?.(selectedChannel)} className="cursor-pointer hover:opacity-80 transition-opacity rounded-lg px-2 py-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>#{selectedChannel.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                    {selectedChannel.type.toUpperCase()}
                  </span>
                  {selectedChannel.isAnnouncement && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1 flex-shrink-0" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b' }}>
                      <Info className="w-2.5 h-2.5" />READ-ONLY
                    </span>
                  )}
                </div>
                <p className="text-[10px] truncate max-w-xs" style={{ color: 'var(--text-muted)' }}>{selectedChannel.description || 'Channel'}</p>
              </div>
            </>
          ) : selectedUser ? (
            <>
              <div className="relative flex-shrink-0" style={{ cursor: 'default' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)', color: 'var(--accent-primary)' }}>
                  {selectedUser.username.substring(0, 2).toUpperCase()}
                </div>
                {selectedUser.avatarUrl && (
                  <img
                    src={selectedUser.avatarUrl}
                    alt={selectedUser.username}
                    className="w-8 h-8 rounded-lg absolute inset-0 object-cover cursor-zoom-in"
                    style={{ opacity: 0.9 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.9'}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>
              <div className="min-w-0 ml-3">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-main)' }}>
                    {selectedUser.fullName || selectedUser.username}
                  </span>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: selectedUser.isOnline ? '#34d399' : 'var(--text-muted)', boxShadow: selectedUser.isOnline ? '0 0 6px #34d399' : 'none' }} />
                </div>
                <span className="text-[10px] block" style={{ color: 'var(--text-muted)' }}>@{selectedUser.username}</span>
                {typingUsers.length > 0 ? (
                  <div className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color: 'var(--accent-primary)' }}>
                    <div className="flex space-x-0.5">
                      <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent-primary)', animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent-primary)', animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent-primary)', animationDelay: '300ms' }} />
                    </div>
                    <span className="italic">{typingUsers[0]} is typing</span>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex items-center space-x-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="font-bold">VAULTCHAT WORKSPACE</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {onToggleSidebar && (
            <button onClick={onToggleSidebar} title="Open sidebar" className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
              <Menu className="w-4 h-4" />
            </button>
          )}

          {(selectedUser || selectedChannel) && onOpenSearch && (
            <button onClick={onOpenSearch} title="Search messages (Ctrl+K)" className="w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
              <Search className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center space-x-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isConnected ? '#34d399' : '#f59e0b', boxShadow: isConnected ? '0 0 6px #34d399' : 'none', animation: !isConnected ? 'pulse-soft 2s infinite' : 'none' }} />
            <span className="hidden sm:inline font-bold">{isConnected ? 'ONLINE' : 'RECONNECTING'}</span>
          </div>

          {(selectedUser || selectedChannel) && (
            <button onClick={onCloseChat} title="Close Conversation" className="w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {showFingerprintModal && currentUser && (
        <FingerprintModal onClose={onCloseFingerprintModal} ownFingerprint={fingerprint} ownUsername={currentUser.username} ownRole={currentUser.role} peerFingerprint={peerFingerprint} peerUsername={peerUsername} />
      )}
    </>
  );
};
