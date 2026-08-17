import { useState, useEffect, useCallback } from 'react';
import { socket, connectSocket } from '../lib/socket';
import { db, getUserKeyPair, getAnyUserKeyPair } from '../lib/db';
import type { UserKeyPair, User } from '../types/chat';
import { importPrivateKeyFromJwk, getFingerprint } from '../lib/crypto';
import { API_BASE } from '../lib/attachments';

const isTokenExpired = (): boolean => {
  const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

export const useAuth = () => {
  // ── State ────────────────────────────────────────────────────────────
  const [currentUserKeys, setCurrentUserKeys] = useState<UserKeyPair | null>(null);
  const [privateKeyObject, setPrivateKeyObject] = useState<CryptoKey | null>(null);
  const [userFingerprint, setUserFingerprint] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isRehydrating, setIsRehydrating] = useState(true);
  const [theme, setTheme] = useState<string>(() => {
    const guestSaved = localStorage.getItem('vaultchat_theme_guest');
    if (guestSaved && guestSaved !== 'undefined') {
      document.documentElement.setAttribute('data-theme', guestSaved);
      return guestSaved;
    }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const initial = prefersDark ? 'vault-dark' : 'clean-light';
    document.documentElement.setAttribute('data-theme', initial);
    localStorage.setItem('vaultchat_theme_guest', initial);
    return initial;
  });
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);

  // ── JWT Helpers (moved from App.tsx) ──────────────────────────────────
  const getJwtToken = (): string | null => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (token) return token;
    return sessionStorage.getItem('vaultchat_jwt');
  };

  const setJwtToken = (token: string) => {
    const stayLoggedIn = localStorage.getItem('vaultchat_stayLoggedIn') !== 'false';
    if (stayLoggedIn) {
      localStorage.setItem('vaultchat_jwt', token);
    } else {
      sessionStorage.setItem('vaultchat_jwt', token);
    }
  };

  const removeJwtToken = () => {
    localStorage.removeItem('vaultchat_jwt');
    sessionStorage.removeItem('vaultchat_jwt');
  };

  // ── Session Rehydration on Page Refresh ──────────────────────────────
  useEffect(() => {
    const rehydrate = async () => {
      const token = getJwtToken();
      if (!token) {
        setIsRehydrating(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.user) {
          let keyPair = await getUserKeyPair(data.user.userId) || await getAnyUserKeyPair();
          if (keyPair) {
            const privKey = await importPrivateKeyFromJwk(keyPair.privateKeyJwk);
            const fp = await getFingerprint(keyPair.publicKeyBase64);
            // Merge server-side profile data into the keypair
            const enrichedKeyPair: UserKeyPair = {
              ...keyPair,
              fullName: data.user.fullName || keyPair.fullName,
              email: data.user.email || keyPair.email,
              avatarUrl: data.user.avatarUrl || keyPair.avatarUrl,
              statusMessage: data.user.statusMessage || keyPair.statusMessage,
              phone: data.user.phone || keyPair.phone,
              keyVersion: data.user.keyVersion ?? keyPair.keyVersion ?? 1,
            };
            setPrivateKeyObject(privKey);
            setCurrentUserKeys(enrichedKeyPair);
            setUserFingerprint(fp);
            setShowProfileDrawer(false);
            if (!socket.connected) connectSocket();
            socket.emit('user:join', {
              userId: enrichedKeyPair.userId,
              username: enrichedKeyPair.username,
              fullName: enrichedKeyPair.fullName,
              role: enrichedKeyPair.role,
              publicKey: enrichedKeyPair.publicKeyBase64,
              signingPublicKey: enrichedKeyPair.signingPublicKeyBase64,
            });
            // Note: fetchUserDirectory and socket.emit('channels:get') are
            // handled by the orchestrator App.tsx effect, not here to avoid
            // double-firing. The rehydrate effect here is focused on auth state.
            console.log(`[Rehydration] Session restored for ${enrichedKeyPair.username}`);
          }
        } else {
          removeJwtToken();
        }
      } catch (e) {
        console.error('[Rehydration] Error:', e);
      } finally {
        setIsRehydrating(false);
      }
    };
    rehydrate();
  }, []); // Run once on mount; dependencies managed by App.tsx orchestrator

  // ── Token Expiry Periodic Check ───────────────────────────────────────
  useEffect(() => {
    if (!currentUserKeys) return;
    const check = () => {
      if (isTokenExpired()) {
        handleLogoutConfirm();
      }
    };
    const interval = setInterval(check, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [currentUserKeys]);

  // ── Auth & Keys ────────────────────────────────────────────────────────
  const handleLogout = () => {
    setIsLogoutOpen(true);
  };

  const handleLogoutConfirm = useCallback(() => {
    removeJwtToken();
    setCurrentUserKeys(null);
    setPrivateKeyObject(null);
    if (socket.connected) socket.disconnect();
    // Clear IndexedDB tables
    db.transaction('rw', [db.keys, db.messages, db.trustedKeys, db.channels, db.channelKeys], async () => {
      await db.keys.clear();
      await db.messages.clear();
      await db.trustedKeys.clear();
      await db.channels.clear();
      await db.channelKeys.clear();
    }).catch(() => {});
  }, []);

  // ── Login / Register ──────────────────────────────────────────────────
  // handleAuthenticate is provided by App.tsx via callback pattern;
  // this hook exposes only state + utility functions needed internally.

  return {
    // State
    currentUserKeys,
    setCurrentUserKeys,
    privateKeyObject,
    setPrivateKeyObject,
    userFingerprint,
    setUserFingerprint,
    authError,
    setAuthError,
    isRehydrating,
    theme,
    setTheme,
    isLogoutOpen,
    setIsLogoutOpen,
    showProfileDrawer,
    setShowProfileDrawer,

    // Actions
    handleLogout,
    handleLogoutConfirm,
    getJwtToken,
    setJwtToken,
    removeJwtToken,
  };
};