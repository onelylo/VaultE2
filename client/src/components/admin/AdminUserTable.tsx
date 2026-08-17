import React, { useState } from 'react';
import { Settings, Loader2, Shield, UserCog, Trash2, AlertCircle } from 'lucide-react';
import type { AdminUser } from '../../types/chat';

interface AdminUserTableProps {
  users: AdminUser[];
  currentUser: { userId: string };
  fingerprints: Record<string, string>;
  busyId: string | null;
  onEditUser: (user: AdminUser) => void;
  onToggleRole: (user: AdminUser) => Promise<void>;
  onDelete: (user: AdminUser) => Promise<void>;
}

export const AdminUserTable: React.FC<AdminUserTableProps> = ({
  users,
  currentUser,
  fingerprints,
  busyId,
  onEditUser,
  onToggleRole,
  onDelete,
}) => {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
      <div className="grid grid-cols-[1fr_100px_70px_110px_70px_70px] gap-2 px-4 py-3 text-[10px] font-bold tracking-wider" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-card) 60%, transparent)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
        <span>USER</span>
        <span>ROLE</span>
        <span className="text-center">STATUS</span>
        <span className="text-center">KEY</span>
        <span className="text-center">ACTIONS</span>
      </div>

      {users.map(user => {
        const isSelf = user.userId === currentUser.userId;
        const isBusy = busyId === user.userId;
        const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
        return (
          <div
            key={user.userId}
            className="grid grid-cols-[1fr_100px_70px_110px_70px_70px] gap-2 items-center px-4 py-3 transition-smooth"
            style={{ borderBottom: '1px solid var(--border-color)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className="relative flex-shrink-0">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.username} className="w-9 h-9 rounded-lg" style={{ border: '1px solid var(--border-color)' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : (
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                    {user.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2`} style={{ borderColor: 'var(--bg-card)', backgroundColor: user.isOnline ? '#34d399' : 'var(--text-muted)' }} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-xs truncate flex items-center space-x-1.5">
                  <span className="truncate" style={{ color: 'var(--text-main)' }}>{user.displayName || user.username}</span>
                  {isSelf && (
                    <span className="text-[9px] px-1 rounded shrink-0" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)', color: 'var(--accent-primary)' }}>YOU</span>
                  )}
                </div>
                <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                  @{user.username} · FP {fingerprints[user.userId] || '…'}
                </div>
              </div>
            </div>

            <div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                user.role === 'ADMIN' ? '' : ''
              }`}
                style={{
                  backgroundColor: user.role === 'ADMIN' ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)' : 'var(--bg-card)',
                  color: user.role === 'ADMIN' ? 'var(--accent-primary)' : 'var(--text-muted)',
                  border: user.role === 'ADMIN' ? '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' : '1px solid var(--border-color)',
                }}
              >
                {user.role}
              </span>
            </div>

            <div className="text-center">
              <span className={`inline-block w-2 h-2 rounded-full`} style={{ backgroundColor: user.isOnline ? '#34d399' : 'var(--text-muted)', boxShadow: user.isOnline ? '0 0 6px #34d399' : 'none' }} />
            </div>

            <div className="text-center">
              <span className="inline-flex items-center space-x-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <Settings className="w-3 h-3" style={{ color: 'var(--accent-primary)', opacity: 0.7 }} />
                <span>v{user.keyVersion ?? 1}</span>
              </span>
            </div>

            <div className="flex items-center justify-center">
              {isSelf ? (
                <span className="text-[9px] px-2" style={{ color: 'var(--text-muted)' }}>SELF</span>
              ) : (
                <>
                  <button
                    onClick={() => onEditUser(user)}
                    disabled={isBusy}
                    title="Manage User — Role, Status, Password, Keys"
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-smooth disabled:opacity-40"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-primary) 50%, transparent)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isBusy}
                    title="Delete User (preserves message history & keys for decryption)"
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-smooth disabled:opacity-40 ml-1"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                  {showDeleteConfirm && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
                      <div className="absolute inset-0 bg-black/70" />
                      <div className="relative z-10 w-full max-w-md rounded-2xl p-6 animate-scaleIn" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                        <div className="flex items-center gap-2 mb-4">
                          <AlertCircle className="w-6 h-6 flex-shrink-0" style={{ color: '#ef4444' }} />
                          <h3 className="text-lg font-bold" style={{ color: 'var(--text-main)' }}>Delete User</h3>
                        </div>
                        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                          Delete <strong style={{ color: 'var(--text-main)' }}>{user.displayName || user.username}</strong> (@{user.username})?
                          <br /><br />
                          <strong style={{ color: '#fbbf24' }}>⚠ This action cannot be undone.</strong>
                          <br /><br />
                          Message history and encryption keys will be preserved so existing conversations remain decryptable.
                          The user will not be able to log in.
                        </p>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setShowDeleteConfirm(false)}
                            className="px-4 py-2 text-sm font-medium rounded-lg transition-smooth"
                            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              setShowDeleteConfirm(true); // Keep modal open during request
                              await onDelete(user);
                              setShowDeleteConfirm(false);
                            }}
                            disabled={isBusy}
                            className="px-4 py-2 text-sm font-medium rounded-lg transition-smooth"
                            style={{ backgroundColor: '#ef4444', color: 'white', border: 'none' }}
                          >
                            {isBusy ? <Loader2 className="w-4 h-4 animate-spin inline-block" /> : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}

      {users.length === 0 && (
        <div className="p-10 text-center text-xs" style={{ color: 'var(--text-muted)' }}>NO REGISTERED USERS</div>
      )}
    </div>
  );
};
