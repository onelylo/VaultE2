import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, Key, Lock, RefreshCw, UserCheck, AlertTriangle } from 'lucide-react';

interface EditUserModalProps {
  user: {
    id: string;
    username: string;
    fullName?: string;
    email?: string;
    role: string;
    status?: string;
    phone?: string;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedData: {
    userId: string;
    role: string;
    fullName: string;
    email?: string;
    username?: string;
    status: string;
    phone?: string;
    newPassword?: string;
    revokeKeys?: boolean;
  }) => void;
}

export function EditUserModal({ user, isOpen, onClose, onSave }: EditUserModalProps) {
  const [role, setRole] = useState(user?.role || 'MEMBER');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [username, setUsername] = useState(user?.username || '');
  const [status, setStatus] = useState(user?.status || 'ACTIVE');
  const [phone, setPhone] = useState(user?.phone || '');
  const [newPassword, setNewPassword] = useState('');
  const [revokeKeys, setRevokeKeys] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'save' | null>(null);

  useEffect(() => {
    if (user) {
      setRole(user.role || 'MEMBER');
      setFullName(user.fullName || '');
      setEmail(user.email || '');
      setUsername(user.username || '');
      setStatus(user.status || 'ACTIVE');
      setPhone(user.phone || '');
      setNewPassword('');
      setRevokeKeys(false);
    }
  }, [user?.id]);

  if (!isOpen || !user) return null;

  const hasChanges = role !== user.role || fullName !== (user.fullName || '') || email !== (user.email || '') || username !== user.username || status !== (user.status || 'ACTIVE') || phone !== (user.phone || '') || newPassword.trim() || revokeKeys;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) {
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      return;
    }
    setConfirmAction('save');
  };

  const handleConfirmSave = () => {
    onSave({
      userId: user.id,
      role,
      fullName,
      email,
      username,
      status,
      phone: phone.trim() || undefined,
      newPassword: newPassword.trim() ? newPassword : undefined,
      revokeKeys,
    });
    setConfirmAction(null);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fadeIn">
      <div className="w-full max-w-sm max-h-[85vh] rounded-2xl bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-color)] shadow-2xl relative flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-3 border-b border-[var(--border-color)] shrink-0">
          <div className="flex items-center gap-2 text-[var(--accent-primary)] font-bold text-sm">
            <Shield className="w-5 h-5"/>
            <span>Edit User — @{user.username}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--hover-color)] text-[var(--text-muted)]">
            <X className="w-5 h-5"/>
          </button>
        </div>

        {/* Scrollable content */}
        <form ref={undefined} onSubmit={handleSubmit} className={`flex flex-col flex-1 min-h-0 ${shaking ? 'animate-shake' : ''}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Username */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>USERNAME</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            </div>

            {/* Full Name */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>FULL NAME</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            </div>

            {/* Email */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>EMAIL</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>PHONE</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/[^0-9+\-\s()]/g, ''))}
                placeholder="+1 555 123 4567"
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            </div>

            {/* Role */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>ROLE</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                <option value="MEMBER">MEMBER</option>
                <option value="SUPERVISOR">SUPERVISOR</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>STATUS</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
            </div>

            {/* Force Password Reset */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>FORCE PASSWORD RESET</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new password..."
                className="w-full rounded-xl py-2 px-3 text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            </div>

            {/* Revoke Keys */}
            <button type="button" onClick={() => setRevokeKeys(prev => !prev)}
              className="w-full flex items-center justify-between p-3 rounded-xl transition-all"
              style={{ backgroundColor: revokeKeys ? 'rgba(239,68,68,0.1)' : 'var(--bg-input)', border: `1px solid ${revokeKeys ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'}` }}>
              <div>
                <span className="text-[10px] font-bold uppercase block" style={{ color: 'var(--text-muted)' }}>REVOKE E2EE KEYS</span>
                <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Force key regeneration on next login</p>
              </div>
              <div className="relative w-10 h-5 rounded-full transition-colors"
                style={{ backgroundColor: revokeKeys ? '#ef4444' : 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <span className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full transition-transform"
                  style={{ backgroundColor: 'white', transform: revokeKeys ? 'translateX(20px)' : 'translateX(0)' }} />
              </div>
            </button>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 p-4 border-t border-[var(--border-color)] shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              CANCEL
            </button>
            <button type="submit" disabled={!hasChanges}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: hasChanges ? '#ef4444' : 'var(--accent-primary)', color: 'var(--accent-text)' }}>
              {hasChanges ? 'SAVE CHANGES' : 'CLOSE'}
            </button>
          </div>
        </form>

        {/* Save Confirmation */}
        {confirmAction === 'save' && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 animate-[fadeIn_0.15s_ease-out]"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setConfirmAction(null)}>
            <div className="w-full max-w-xs rounded-2xl p-5 animate-[scaleIn_0.15s_ease-out]"
              style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
              onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-main)' }}>Save Changes</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Are you sure you want to update <strong>@{user.username}</strong>'s account?
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmAction(null)} className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>Cancel</button>
                <button onClick={handleConfirmSave} className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{ backgroundColor: '#ef4444', color: '#fff' }}>Save</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
}
