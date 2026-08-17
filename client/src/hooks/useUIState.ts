import { useState, useEffect, useCallback } from 'react';
import type { User, Channel } from '../types/chat';

// ── UI State ──────────────────────────────────────────────────────────────
export const useUIState = () => {
  // ── Theme ──────────────────────────────────────────────────────────────
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── Active View (DMs/Channels) ─────────────────────────────────────────
  const [activeView, setActiveView] = useState<'channels' | 'dms'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vaultchat_activeView');
      if (saved === 'channels' || saved === 'dms') return saved;
    }
    return 'dms';
  });

  useEffect(() => {
    localStorage.setItem('vaultchat_activeView', activeView);
  }, [activeView]);

  // ── Modals ──────────────────────────────────────────────────────────────
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'users' | 'infrastructure'>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState<{ user: User; rect: DOMRect } | null>(null);
  const [channelSettings, setChannelSettings] = useState<Channel | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);

  // ── Toggle handlers ─────────────────────────────────────────────────────
  const toggleSidebar = useCallback(() => setMobileSidebarOpen(prev => !prev), []);
  const toggleAdmin = useCallback(() => setShowAdmin(prev => !prev), []);
  const toggleAdminTab = useCallback((tab: 'overview' | 'users' | 'infrastructure') => { setShowAdmin(true); setAdminTab(tab); }, []);
  const closeProfileDrawer = useCallback(() => setShowProfileDrawer(false), []);
  const closeLogout = useCallback(() => setIsLogoutOpen(false), []);
  const closeFingerprintModal = useCallback(() => setShowFingerprintModal(false), []);

  // ── Avatar menu ─────────────────────────────────────────────────────────
  const setAvatarUser = useCallback((user: User, rect: DOMRect) => setAvatarMenu({ user, rect }), []);
  const clearAvatarMenu = useCallback(() => setAvatarMenu(null), []);
  const closeAvatarAndOpenProfile = useCallback(() => { setAvatarMenu(null); setShowProfileDrawer(true); }, []);
  const closeAvatarAndShowFingerprint = useCallback(() => { setAvatarMenu(null); setShowFingerprintModal(true); }, []);

  // ── Search ──────────────────────────────────────────────────────────────
  const openSearch = useCallback(() => setShowSearch(true), []);
  const closeSearch = useCallback(() => setShowSearch(false), []);

  // ── Logout confirmation ─────────────────────────────────────────────────
  const openLogout = useCallback(() => setIsLogoutOpen(true), []);
  const closeLogoutConfirm = useCallback(() => setIsLogoutOpen(false), []);

  // ── Return all UI state for App.tsx composition ─────────────────────────
  return {
    // Theme
    theme, setTheme,
    // Active view
    activeView, setActiveView,
    // Modals
    showAdmin, setShowAdmin, adminTab, setAdminTab,
    mobileSidebarOpen, setMobileSidebarOpen,
    showProfileDrawer, setShowProfileDrawer,
    isLogoutOpen, setIsLogoutOpen,
    avatarMenu, setAvatarMenu,
    setAvatarUser, clearAvatarMenu,
    closeProfileDrawer, closeLogout, closeFingerprintModal,
    closeAvatarAndOpenProfile, closeAvatarAndShowFingerprint,
    // Search
    showSearch, setShowSearch,
    openSearch, closeSearch,
    // Fingerprint modal
    showFingerprintModal, setShowFingerprintModal,
    // Toast (would be imported from useToast or separate hook)
  };
};