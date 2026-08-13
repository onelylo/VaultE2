import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Fingerprint,
  Shield,
  LogOut,
  Palette,
  Sun,
  Moon,
  Camera,
  Save,
  Loader2,
  Check,
  KeyRound,
  Lock,
  User,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Info,
  Copy,
  Users,
  RotateCcw,
  UserX,
  ShieldCheck,
  Monitor,
  Zap,
} from 'lucide-react';
import type { UserKeyPair } from '../types/chat';
import { getFingerprint } from '../lib/crypto';

interface ProfileDrawerProps {
  currentUser: UserKeyPair;
  userFingerprint: string;
  onClose: () => void;
  onLogout: () => void;
  onUpdateProfile: (data: { fullName?: string; email?: string; avatar?: string; username?: string; statusMessage?: string }) => Promise<any>;
  theme: string;
  onThemeChange: (theme: string) => void;
}

const VAULT_THEMES = [
  { id: 'vault-dark', label: 'Vault Dark', icon: Moon, color: 'bg-sky-500' },
  { id: 'slate-fusion', label: 'Slate Fusion', icon: Monitor, color: 'bg-indigo-500' },
  { id: 'neon-pulse', label: 'Neon Pulse', icon: Zap, color: 'bg-pink-500' },
  { id: 'shadow-purple', label: 'Shadow Purple', icon: Moon, color: 'bg-purple-500' },
  { id: 'midnight-teal', label: 'Midnight Teal', icon: Moon, color: 'bg-teal-500' },
  { id: 'clean-light', label: 'Clean Light', icon: Sun, color: 'bg-gray-200' },
  { id: 'amber-light', label: 'Cream Light', icon: Sun, color: 'bg-amber-200' },
  { id: 'mint-fresh', label: 'Mint Fresh', icon: Sun, color: 'bg-emerald-400' },
  { id: 'ocean-mist', label: 'Ocean Mist', icon: Sun, color: 'bg-blue-400' },
  { id: 'rose-garden', label: 'Rose Garden', icon: Sun, color: 'bg-pink-400' },
];

export const ProfileDrawer: React.FC<ProfileDrawerProps> = ({
  currentUser,
  userFingerprint,
  onClose,
  onLogout,
  onUpdateProfile,
  theme,
  onThemeChange,
}) => {
  const [username, setUsername] = useState(currentUser.username || '');
  const [fullName] = useState(currentUser.fullName || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'appearance' | 'notifications' | 'security'>('profile');
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem('vaultchat_sound') !== 'false'
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    localStorage.getItem('vaultchat_notifications') !== 'false'
  );
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('vaultchat_sound', String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem('vaultchat_notifications', String(notificationsEnabled));
    if (notificationsEnabled && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [notificationsEnabled]);

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 256;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.82);
        setAvatarUrl(compressedBase64);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let finalAvatarUrl = avatarUrl;
      if (avatarUrl && avatarUrl.startsWith('data:')) {
        const token = localStorage.getItem('vaultchat_jwt');
        if (token) {
          const res = await fetch('/api/users/me/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ avatarData: avatarUrl }),
          });
          if (res.ok) {
            const data = await res.json();
            finalAvatarUrl = data.avatarUrl;
          }
        }
      }
      await onUpdateProfile({ fullName, email, avatar: finalAvatarUrl, username });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('[Profile] Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyFingerprint = () => {
    navigator.clipboard.writeText(userFingerprint);
    setCopiedFingerprint(true);
    setTimeout(() => setCopiedFingerprint(false), 2000);
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) return;
    setPasswordSaving(true);
    setPasswordSaved(false);
    try {
      const token = localStorage.getItem('vaultchat_jwt');
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Password change failed');
      }
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPasswordSaved(false), 2000);
    } catch (e: any) {
      console.error('[Password] Change failed:', e);
      alert(e?.message || 'Password change failed');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleThemeChange = (themeName: string) => {
    const userId = currentUser?.userId || 'guest';
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem(`vaultchat_theme_${userId}`, themeName);
  };

  const displayAvatar = avatarUrl || currentUser.avatarUrl;

  return (
    <div className="fixed inset-0 z-[200] flex">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-96 max-w-[85vw] h-full flex flex-col bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] shadow-2xl text-[var(--text-main)] font-mono"
        style={{ animation: 'slideInLeft 0.2s ease-out' }}
      >
        {/* Settings Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] shrink-0">
          <h2 className="text-xl font-bold tracking-wide text-[var(--text-main)]">SETTINGS & PROFILE</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--hover-color)] text-[var(--text-muted)]">
            <X className="w-5 h-5"/>
          </button>
        </div>

        {/* Settings Navigation Bar - Full Labels, No Truncation */}
        <div className="flex items-center gap-1.5 p-1.5 bg-[var(--bg-app)]/80 border-b border-[var(--border-color)] overflow-x-auto scrollbar-none shrink-0">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all flex items-center gap-2 ${
              activeTab === 'profile'
                ? 'bg-[var(--accent-primary)] text-[var(--accent-text)] shadow-[0_0_15px_var(--glow-color)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--hover-color)]'
            }`}
          >
            <User className="w-4 h-4"/>
            <span>PROFILE</span>
          </button>

          <button
            onClick={() => setActiveTab('appearance')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all flex items-center gap-2 ${
              activeTab === 'appearance'
                ? 'bg-[var(--accent-primary)] text-[var(--accent-text)] shadow-[0_0_15px_var(--glow-color)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--hover-color)]'
            }`}
          >
            <Palette className="w-4 h-4"/>
            <span>APPEARANCE</span>
          </button>

          <button
            onClick={() => setActiveTab('notifications')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all flex items-center gap-2 ${
              activeTab === 'notifications'
                ? 'bg-[var(--accent-primary)] text-[var(--accent-text)] shadow-[0_0_15px_var(--glow-color)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--hover-color)]'
            }`}
          >
            <Bell className="w-4 h-4"/>
            <span>NOTIFICATIONS</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition-all flex items-center gap-2 ${
              activeTab === 'security'
                ? 'bg-[var(--accent-primary)] text-[var(--accent-text)] shadow-[0_0_15px_var(--glow-color)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--hover-color)]'
            }`}
          >
            <Shield className="w-4 h-4"/>
            <span>SECURITY</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'profile' && (
            <>
              <div className="flex flex-col items-center space-y-3">
                <div
                  className="relative w-20 h-20 rounded-xl border-2 border-[var(--border-color)] overflow-hidden cursor-pointer group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {displayAvatar ? (
                    <img
                      src={displayAvatar}
                      alt="avatar"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full bg-[var(--bg-card)] flex items-center justify-center text-2xl font-bold text-[var(--accent-primary)]">
                      {currentUser.username.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFileChange}
                />
                <div className="text-xs text-[var(--text-muted)]">
                  Click to change avatar (max 256x256px, compressed)
                </div>
              </div>

              <div className="space-y-3">
                {/* Full Name - Fixed Identifier */}
                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] mb-1 uppercase">Full Name (Legal Identity)</label>
                  <input
                    type="text"
                    value={fullName}
                    disabled
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-muted)] cursor-not-allowed font-medium"
                  />
                </div>

                {/* Username - Editable Handle */}
                <div>
                  <label className="block text-xs font-mono text-[var(--text-muted)] mb-1 uppercase">Username Handle</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-xl py-2.5 px-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)] transition-all font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 tracking-wider">
                    EMAIL
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg text-[var(--text-main)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
                  />
                </div>
              </div>

              <div className="p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-wider">
                    PUBLIC KEY FINGERPRINT
                  </span>
                  <button
                    onClick={handleCopyFingerprint}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
                    title="Copy fingerprint"
                  >
                    {copiedFingerprint ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <Fingerprint className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-xs font-mono text-[var(--text-main)] break-all">
                    {userFingerprint}
                  </span>
                </div>
                <div className="mt-2 flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-[var(--text-muted)]">
                    E2EE Active • v1
                  </span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              <div>
                <h3 className="text-[10px] font-bold text-[var(--text-muted)] mb-3 tracking-wider">
                  VS CODE THEME PRESETS
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {VAULT_THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleThemeChange(t.id)}
                      className={`p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                        theme === t.id
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                          : 'border-[var(--border-color)] hover:border-[var(--text-muted)]'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg ${t.color} flex items-center justify-center`}>
                        <t.icon className="w-4 h-4 text-white" />
                      </div>
                      <span className={`text-xs font-bold ${theme === t.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`}>
                        {t.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === 'notifications' && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                  <div className="flex items-center space-x-3">
                    {soundEnabled ? (
                      <Volume2 className="w-5 h-5 text-[var(--accent-primary)]" />
                    ) : (
                      <VolumeX className="w-5 h-5 text-[var(--text-muted)]" />
                    )}
                    <div>
                      <div className="text-sm font-bold text-[var(--text-main)]">
                        Message Sounds
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        Play audio cues for new messages
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      soundEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-card)] border border-[var(--border-color)]'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        soundEnabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                  <div className="flex items-center space-x-3">
                    {notificationsEnabled ? (
                      <Bell className="w-5 h-5 text-[var(--accent-primary)]" />
                    ) : (
                      <BellOff className="w-5 h-5 text-[var(--text-muted)]" />
                    )}
                    <div>
                      <div className="text-sm font-bold text-[var(--text-main)]">
                        Desktop Notifications
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        Show browser notifications for messages
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      notificationsEnabled ? 'bg-[var(--accent-primary)]' : 'bg-[var(--bg-card)] border border-[var(--border-color)]'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        notificationsEnabled ? 'translate-x-6' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                <div className="flex items-center space-x-2 mb-2">
                  <Info className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-wider">
                    AUDIO SYNTHESIZER
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Uses Web Audio API to generate beep tones for message alerts. No external files required.
                </p>
              </div>
            </>
          )}

          {activeTab === 'security' && (
            <>
              <div className="p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                <div className="flex items-center space-x-2 mb-3">
                  <KeyRound className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-wider">
                    ACTIVE SESSION
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">User</span>
                    <span className="text-[var(--text-main)] font-bold">{currentUser.username}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Role</span>
                    <span className="text-[var(--accent-primary)] font-bold">{currentUser.role}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Key Version</span>
                    <span className="text-[var(--text-main)] font-bold">v1</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                <div className="flex items-center space-x-2 mb-3">
                  <Lock className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-[10px] font-bold text-[var(--text-muted)] tracking-wider">
                    CHANGE PASSWORD
                  </span>
                </div>
                <div className="space-y-2">
                  <input
                    type="password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                  <input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                  <button 
                    onClick={handleChangePassword}
                    disabled={!currentPassword || !newPassword || passwordSaving}
                    className="w-full py-2 text-xs font-bold btn-shiny rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {passwordSaving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>UPDATING...</span></>
                    ) : passwordSaved ? (
                      <><Check className="w-3.5 h-3.5" /><span>UPDATED</span></>
                    ) : (
                      'UPDATE PASSWORD'
                    )}
                  </button>
                </div>
              </div>

              {/* Admin User Management is now handled via dedicated portal modals (EditUserModal) */}
            </>
          )}
        </div>

        <div className="p-4 border-t border-[var(--border-color)] flex items-center justify-between shrink-0">
          <button
            onClick={onLogout}
            className="px-4 py-2 text-xs font-bold text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors flex items-center space-x-2"
          >
            <LogOut className="w-4 h-4" />
            <span>LOG OUT</span>
          </button>

          {activeTab === 'profile' && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-shiny px-4 py-2 text-xs font-bold rounded-lg flex items-center space-x-2 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <Check className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'SAVING...' : saved ? 'SAVED' : 'SAVE'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
