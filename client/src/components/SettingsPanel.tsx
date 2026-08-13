import React, { useState } from 'react';
import {
  X,
  Settings,
  Bell,
  BellOff,
  Moon,
  Sun,
  Monitor,
  Volume2,
  VolumeX,
  MessageSquare,
  Shield,
  Key,
  Trash2,
  ChevronRight,
  Lock,
  Palette,
  Globe,
  HardDrive
} from 'lucide-react';

interface SettingsPanelProps {
  onClose: () => void;
  sunlight: boolean;
  onToggleSunlight: () => void;
}

interface SettingToggleProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

const SettingToggle: React.FC<SettingToggleProps> = ({ icon, label, description, enabled, onToggle }) => (
  <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
    <div className="flex items-center space-x-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
        {icon}
      </div>
      <div>
        <div className="text-xs font-semibold" style={{ color: 'var(--text-main)' }}>{label}</div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{description}</div>
      </div>
    </div>
    <button
      onClick={onToggle}
      className="w-11 h-6 rounded-full transition-all duration-200 flex items-center"
      style={{
        backgroundColor: enabled ? 'var(--accent-primary)' : 'var(--border-color)',
        justifyContent: enabled ? 'flex-end' : 'flex-start',
      }}
    >
      <div className={`w-5 h-5 rounded-full mx-0.5 transition-all duration-200`}
        style={{ backgroundColor: enabled ? 'var(--bg-card)' : 'var(--text-muted)' }}
      />
    </button>
  </div>
);

interface SettingSelectProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

const SettingSelect: React.FC<SettingSelectProps> = ({ icon, label, description, value, options, onChange }) => (
  <div className="py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
    <div className="flex items-center space-x-3 mb-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
        {icon}
      </div>
      <div>
        <div className="text-xs font-semibold" style={{ color: 'var(--text-main)' }}>{label}</div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{description}</div>
      </div>
    </div>
    <div className="ml-11 flex space-x-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
          style={{
            backgroundColor: value === opt.value ? 'var(--accent-primary)' : 'var(--bg-card)',
            color: value === opt.value ? 'var(--accent-text)' : 'var(--text-muted)',
            border: value === opt.value ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
          }}
          onMouseEnter={e => { if (value !== opt.value) e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
          onMouseLeave={e => { if (value !== opt.value) e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  onClose,
  sunlight,
  onToggleSunlight,
}) => {
  const [notifications, setNotifications] = useState(true);
  const [sounds, setSounds] = useState(true);
  const [enterToSend, setEnterToSend] = useState(true);
  const [showReadReceipts, setShowReadReceipts] = useState(true);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-scaleIn"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
      >
        {/* Header */}
        <div className="h-14 px-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}>
              <Settings className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <h3 className="font-bold text-sm tracking-wider" style={{ color: 'var(--text-main)' }}>SETTINGS</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
            style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto">
          {/* Appearance */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h4 className="text-[10px] tracking-wider mb-3 flex items-center space-x-2" style={{ color: 'var(--text-muted)' }}>
              <Palette className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>APPEARANCE</span>
            </h4>
            <SettingSelect
              icon={sunlight ? <Sun className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> : <Moon className="w-4 h-4" style={{ color: '#60a5fa' }} />}
              label="Theme"
              description="Switch between dark and light mode"
              value={sunlight ? 'sunlight' : 'dark'}
              options={[
                { value: 'dark', label: 'DARK' },
                { value: 'sunlight', label: 'SUNLIGHT' },
              ]}
              onChange={(v) => {
                if ((v === 'sunlight') !== sunlight) onToggleSunlight();
              }}
            />
          </div>

          {/* Notifications */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h4 className="text-[10px] tracking-wider mb-3 flex items-center space-x-2" style={{ color: 'var(--text-muted)' }}>
              <Bell className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>NOTIFICATIONS</span>
            </h4>
            <SettingToggle
              icon={notifications ? <Bell className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> : <BellOff className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              label="Push Notifications"
              description="Receive alerts for new messages"
              enabled={notifications}
              onToggle={() => setNotifications(!notifications)}
            />
            <SettingToggle
              icon={sounds ? <Volume2 className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> : <VolumeX className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
              label="Message Sounds"
              description="Play sound on new messages"
              enabled={sounds}
              onToggle={() => setSounds(!sounds)}
            />
          </div>

          {/* Messaging */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h4 className="text-[10px] tracking-wider mb-3 flex items-center space-x-2" style={{ color: 'var(--text-muted)' }}>
              <MessageSquare className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>MESSAGING</span>
            </h4>
            <SettingToggle
              icon={<Globe className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />}
              label="Enter to Send"
              description="Press Enter to send, Shift+Enter for new line"
              enabled={enterToSend}
              onToggle={() => setEnterToSend(!enterToSend)}
            />
            <SettingToggle
              icon={<Shield className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />}
              label="Read Receipts"
              description="Show when you've read a message"
              enabled={showReadReceipts}
              onToggle={() => setShowReadReceipts(!showReadReceipts)}
            />
          </div>

          {/* Security */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <h4 className="text-[10px] tracking-wider mb-3 flex items-center space-x-2" style={{ color: 'var(--text-muted)' }}>
              <Lock className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>SECURITY</span>
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center space-x-3">
                  <Key className="w-4 h-4" style={{ color: '#34d399' }} />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-main)' }}>Encryption Status</div>
                    <div className="text-[10px]" style={{ color: '#34d399' }}>Active — E2EE Enabled</div>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-1 rounded" style={{ backgroundColor: 'rgba(52, 211, 153, 0.1)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                  ON
                </span>
              </div>
            </div>
          </div>

          {/* Storage */}
          <div className="p-5">
            <h4 className="text-[10px] tracking-wider mb-3 flex items-center space-x-2" style={{ color: 'var(--text-muted)' }}>
              <HardDrive className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
              <span>LOCAL STORAGE</span>
            </h4>
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-between p-3 rounded-xl transition-smooth"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-primary) 30%, transparent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              >
                <div className="flex items-center space-x-3">
                  <Trash2 className="w-4 h-4" style={{ color: '#f87171' }} />
                  <div className="text-left">
                    <div className="text-xs font-semibold" style={{ color: 'var(--text-main)' }}>Clear Local Cache</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Remove cached messages from this device</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
