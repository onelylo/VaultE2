import React, { useState } from 'react';
import { ShieldCheck, Key, ArrowRight, Loader2, Cpu } from 'lucide-react';

interface LoginModalProps {
  onLogin: (username: string) => Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && !isGenerating) {
      setIsGenerating(true);
      try {
        await onLogin(username.trim());
      } finally {
        setIsGenerating(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none"
      style={{ backgroundColor: 'color-mix(in srgb, var(--bg-app) 90%, transparent)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 shadow-[0_0_50px_rgba(0,0,0,0.8)] relative overflow-hidden animate-scaleIn"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}
      >
        {/* Glow accent line */}
        <div className="h-1 absolute top-0 left-0 right-0" style={{ background: 'linear-gradient(90deg, transparent, var(--accent-primary), transparent)' }} />

        {/* Brand Icon */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)',
            boxShadow: '0 0 20px var(--glow-color)',
            color: 'var(--accent-primary)'
          }}
        >
          <ShieldCheck className="w-10 h-10" />
        </div>

        <div className="text-center mb-8">
          <h2 className="text-xl font-bold tracking-wider" style={{ color: 'var(--text-main)' }}>
            PETRO<span style={{ color: 'var(--accent-primary)' }}>SHIELD</span> CHAT
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            INDUSTRIAL END-TO-END ENCRYPTED COMMUNICATIONS
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold mb-2 tracking-wider" style={{ color: 'var(--text-muted)' }}>
              USERNAME
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={isGenerating}
                placeholder="e.g. Operator-Alpha"
                required
                className="w-full rounded-xl px-4 py-3.5 text-sm focus:outline-none transition-smooth"
                style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
              <div className="absolute right-3 top-3.5">
                <Key className="w-4 h-4" style={{ color: 'var(--accent-primary)', opacity: 0.7 }} />
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl text-[11px] space-y-1" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-app) 60%, transparent)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
            <div className="flex items-center space-x-1.5 font-semibold" style={{ color: '#34d399' }}>
              <Cpu className="w-3.5 h-3.5" />
              <span>LOCAL WEBCRYPTO ENGINE</span>
            </div>
            <p>
              Submitting generates an isolated WebCrypto ECDH (P-256) keypair inside your browser. Private keys never leave local device memory.
            </p>
          </div>

          <button
            type="submit"
            disabled={!username.trim() || isGenerating}
            className="w-full font-bold rounded-xl py-3.5 px-4 flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed transition-smooth text-sm tracking-wider"
            style={{
              minHeight: '48px',
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--accent-text)',
              boxShadow: '0 0 20px var(--glow-color)',
            }}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>GENERATING ECDH KEYS...</span>
              </>
            ) : (
              <>
                <span>ESTABLISH SECURE SESSION</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>PETROSHIELD E2EE MVP • AES-256-GCM + ECDH-P256</span>
        </div>
      </div>
    </div>
  );
};
