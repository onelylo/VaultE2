import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, Key, UserCheck, AlertTriangle, Lock, RefreshCw } from 'lucide-react';

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
    status: string;
    phone?: string;
    newPassword?: string;
    revokeKeys?: boolean;
  }) => void;
}

export function EditUserModal({ user, isOpen, onClose, onSave }: EditUserModalProps) {
  const [role, setRole] = useState(user?.role || 'MEMBER');
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [status, setStatus] = useState(user?.status || 'ACTIVE');
  const [phone, setPhone] = useState(user?.phone || '');
  const [newPassword, setNewPassword] = useState('');
  const [revokeKeys, setRevokeKeys] = useState(false);
  const [shaking, setShaking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset state when user prop changes
  useEffect(() => {
    if (user) {
      setRole(user.role || 'MEMBER');
      setFullName(user.fullName || '');
      setStatus(user.status || 'ACTIVE');
      setPhone(user.phone || '');
      setNewPassword('');
      setRevokeKeys(false);
    }
  }, [user?.id]);

  if (!isOpen || !user) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Check if anything changed
    const hasChanges = role !== user.role || fullName !== (user.fullName || '') || status !== (user.status || 'ACTIVE') || phone !== (user.phone || '') || newPassword.trim() || revokeKeys;
    if (!hasChanges) {
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      return;
    }
    onSave({
      userId: user.id,
      role,
      fullName,
      status,
      phone: phone.trim() || undefined,
      newPassword: newPassword.trim() ? newPassword : undefined,
      revokeKeys,
    });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-fadeIn">
      <div className="w-full max-w-md glass-modal rounded-2xl p-6 bg-[var(--bg-surface)] text-[var(--text-main)] border border-[var(--border-color)] shadow-2xl relative">
        
        <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)] mb-4">
          <div className="flex items-center gap-2 text-[var(--accent-primary)] font-bold text-sm">
            <Shield className="w-5 h-5"/>
            <span>Manage User Account — @{user.username}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--hover-color)] text-[var(--text-muted)]">
            <X className="w-5 h-5"/>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className={`space-y-4 ${shaking ? 'animate-shake' : ''}`}>
          {/* Read-only info */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>USERNAME</span>
              <span className="text-xs" style={{ color: 'var(--text-main)' }}>@{user.username}</span>
            </div>
            {user.email && (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>EMAIL</span>
                <span className="text-xs" style={{ color: 'var(--text-main)' }}>{user.email}</span>
              </div>
            )}
          </div>

          {/* Full Legal Name */}
          <div>
            <label className="block text-xs font-mono uppercase text-[var(--text-muted)] mb-1">Full Legal Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="block text-xs font-mono uppercase text-[var(--text-muted)] mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9+\-\s()]/g, ''))}
              placeholder="e.g. +1 555 123 4567"
              className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          {/* Role Assignment */}
          <div>
            <label className="block text-xs font-mono uppercase text-[var(--text-muted)] mb-1">Assigned RBAC Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)]"
            >
              <option value="MEMBER">MEMBER (Basic Chat & Channel Creation)</option>
              <option value="SUPERVISOR">SUPERVISOR (Channel Management & Announcements)</option>
              <option value="ADMIN">ADMIN (Full System Rights & User Control)</option>
            </select>
          </div>

          {/* Account Status */}
          <div>
            <label className="block text-xs font-mono uppercase text-[var(--text-muted)] mb-1">Account State</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)]"
            >
              <option value="ACTIVE">ACTIVE (Authorized Access)</option>
              <option value="SUSPENDED">SUSPENDED (Access Denied)</option>
            </select>
          </div>

          {/* Emergency Password Override */}
          <div>
            <label className="block text-xs font-mono uppercase text-[var(--text-muted)] mb-1">Force Password Reset</label>
            <input
              type="password"
              placeholder="Enter new password to force update..."
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)]"
            />
          </div>

          {/* Revoke Key Material */}
          <div className="pt-2">
            <label className="flex items-center gap-3 p-3 bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={revokeKeys}
                onChange={(e) => setRevokeKeys(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--accent-primary)]"
              />
              <div className="text-xs">
                <span className="font-bold text-[var(--text-main)] block">Revoke E2EE Public Key Material</span>
                <span className="text-[var(--text-muted)]">Forces the user device to re-generate cryptography keys on next login.</span>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]">
              CANCEL
            </button>
            <button type="submit" className="px-5 py-2.5 text-xs font-bold rounded-xl bg-[var(--accent-primary)] text-[var(--accent-text)] shadow-lg hover:opacity-90">
              UPDATE USER ACCOUNT
            </button>
          </div>
        </form>

      </div>
    </div>,
    document.body
  );
}
