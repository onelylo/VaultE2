import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { useCrypto } from './hooks/useCrypto';
import { useSocket } from './hooks/useSocket';
import { useChannels } from './hooks/useChannels';
import { useMessages } from './hooks/useMessages';
import { usePresence } from './hooks/usePresence';
import { useAdmin } from './hooks/useAdmin';
import { useUIState } from './hooks/useUIState';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ProfileDrawer } from './components/ProfileDrawer';
import { AuthModal } from './components/AuthModal';
import { OfflineBanner } from './components/OfflineBanner';
import { AdminDashboard } from './components/AdminDashboard';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { ChannelSettingsModal } from './components/channels/ChannelSettingsModal';
import { MessageSearch } from './components/MessageSearch';
import { socket, connectSocket } from './lib/socket';
import { processOfflineQueue } from './lib/queue';
import { db, blockUser, unblockUser, saveUserKeyPair, saveMessage, saveTrustedKey, getActiveDMPartners } from './lib/db';
import { liveQuery } from 'dexie';
import type { User, Channel, UserKeyPair, LocalMessage, EncryptedPayload } from './types/chat';
import { getFingerprint, getOrGenerateChannelKey, getOrDeriveSharedKey, validatePeerKeyTofu } from './lib/crypto';
import { showToast, ToastContainer } from './lib/toast';

export const App: React.FC = () => {
  const auth = useAuth();
  const {
    currentUserKeys, setCurrentUserKeys,
    privateKeyObject, setPrivateKeyObject,
    userFingerprint, setUserFingerprint,
    authError, setAuthError,
    isRehydrating, theme, setTheme,
    isLogoutOpen, setIsLogoutOpen,
    showProfileDrawer, setShowProfileDrawer,
    handleLogout, getJwtToken, setJwtToken, removeJwtToken,
  } = auth;

  const crypto = useCrypto(privateKeyObject);
  const {
    generateKeyPair, exportPublicKey, importPublicKey,
    exportKeyToJwk, importPrivateKeyFromJwk,
    deriveSharedKey, deriveSharedKey: deriveSharedKeyFn,
    encryptMessage, decryptMessage,
    getFingerprint: cryptoGetFingerprint,
    computePublicKeyFingerprint, compareFingerprints,
    generateChannelSymmetricKey,
    importSymmetricKeyFromJwk,
    decryptPrivateKeyVault, encryptKeyVaultPair,
    unwrapKeyVault, generateSigningKeyPair,
    signKeyRotation, verifyKeyRotationSignature,
    encryptBinaryData,
  } = crypto;

  const socket = useSocket(currentUserKeys);
  const { socket: socketObj, isOffline, pendingCount, networkStatus, emit, joinRoom } = socket;

  const dispatchRef = useRef({});
  useEffect(() => { dispatchRef.current = {}; }, []);

  const allUsersRef = useRef<User[]>([]);
  const onlineIdsRef = useRef<Set<string>>(new Set());
  const awayIdsRef = useRef<Set<string>>(new Set());
  const selectedPeerRef = useRef<User | null>(null);
  const selectedChannelRef = useRef<Channel | null>(null);
  const lastViewedDmsRef = useRef<Record<string, number>>({});
  const lastViewedChannelsRef = useRef<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [mitmWarnings, setMitmWarnings] = useState<Record<string, boolean>>({});
  
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [unreadDMs, setUnreadDMs] = useState<Record<string, number>>({});
  const [unreadChannels, setUnreadChannels] = useState<Record<string, number>>({});
  const [recentDMs, setRecentDMs] = useState<User[]>([]);
  const [latestDMMessages, setLatestDMMessages] = useState<Record<string, string>>({});
  const [, forceUpdate] = useState({});
  const setAllUsers = useCallback((updater: User[] | ((prev: User[]) => User[])) => {
    if (typeof updater === 'function') {
      allUsersRef.current = updater(allUsersRef.current);
    } else {
      allUsersRef.current = updater;
    }
    forceUpdate({});
  }, []);

  // ── Unread badge counts (reactive via Dexie liveQuery) ───────────────────────
  const currentUserId = currentUserKeys?.userId || '';
  useEffect(() => {
    if (!currentUserId) return;
    const sub = liveQuery(() => db.messages.toArray()).subscribe((allMsgs) => {
      const dmCounts: Record<string, number> = {};
      const chCounts: Record<string, number> = {};
      for (const msg of allMsgs) {
        if (msg.removed || msg.senderId === currentUserId) continue;
        if (msg.status === 'read') continue;
        // Skip messages from the currently open conversation
        if (msg.channelId && msg.channelId === selectedChannelRef.current?.id) continue;
        if (!msg.channelId && msg.senderId === selectedPeerRef.current?.userId) continue;
        if (msg.channelId) {
          chCounts[msg.channelId] = (chCounts[msg.channelId] || 0) + 1;
        } else {
          const peerId = msg.senderId;
          if (peerId) dmCounts[peerId] = (dmCounts[peerId] || 0) + 1;
        }
      }
      setUnreadDMs(dmCounts);
      setUnreadChannels(chCounts);
    });
    return () => sub.unsubscribe();
  }, [currentUserId]);

  const upsertDMConversation = useCallback((peer: User, lastMessageText: string) => {
    const updatedUser = { ...peer, isOnline: onlineIdsRef.current.has(peer.userId) };
    setRecentDMs(prev => {
      const filtered = prev.filter(u => u.userId !== peer.userId);
      return [updatedUser, ...filtered];
    });
    setLatestDMMessages(prev => ({ ...prev, [peer.userId]: lastMessageText }));
  }, []);

  useEffect(() => {
    if (recentDMs.length > 0) {
      console.log('Saving recentDMs:', recentDMs.map(u => u.userId));
      localStorage.setItem('vaultchat_recentDMs', JSON.stringify(recentDMs.map(u => u.userId)));
    }
  }, [recentDMs]);

  // Prevent Ctrl+scroll zoom (except when lightbox is open)
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey && !document.querySelector('[data-lightbox-open]')) {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
  }, []);

  const channelsHook = useChannels(
    currentUserKeys,
    privateKeyObject,
    allUsersRef.current,
    (users: User[]) => { allUsersRef.current = users; },
    dispatchRef.current
  );
  const { channels, selectedChannel: channelsSelectedChannel, setSelectedChannel: setChannelsSelectedChannel, channelSettings, setChannelSettings, handleCreateChannel, handleUpdateChannel, handleDeleteChannel, handleLeaveChannel, handleSelectChannel: hookHandleSelectChannel, getOrGenerateChannelKey: hookGetOrGenerateChannelKey } = channelsHook;

  const messagesHook = useMessages(
    currentUserKeys,
    privateKeyObject,
    selectedUser,
    selectedChannel,
    allUsersRef.current,
    onlineIdsRef.current,
    lastViewedDmsRef,
    lastViewedChannelsRef,
    dispatchRef.current,
    (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => { if (ids instanceof Set) onlineIdsRef.current = ids; else onlineIdsRef.current = ids(onlineIdsRef.current); },
    upsertDMConversation
  );
  const { handleSendMessage, handleForwardMessage, handleSendFiles, handleEditMessage, handleDeleteForMe, handleDeleteForEveryone, handlePinMessage, handleUnpinMessage, pinnedMessages, fetchAllHistory, uploadProgress, decryptPayload } = messagesHook;

  const presenceHook = usePresence(
    currentUserKeys,
    allUsersRef.current,
    onlineIdsRef,
    awayIdsRef,
    (users: User[] | ((prev: User[]) => User[])) => { if (Array.isArray(users)) allUsersRef.current = users; else allUsersRef.current = users(allUsersRef.current); },
    (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => { if (ids instanceof Set) onlineIdsRef.current = ids; else onlineIdsRef.current = ids(onlineIdsRef.current); },
    (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => { if (ids instanceof Set) awayIdsRef.current = ids; else awayIdsRef.current = ids(awayIdsRef.current); },
    dispatchRef.current,
    selectedPeerRef,
    selectedChannelRef,
    setCurrentUserKeys,
    setMitmWarnings
  );
  const { onlineIds, awayIds } = presenceHook;

  const adminHook = useAdmin(currentUserKeys, (users: User[] | ((prev: User[]) => User[])) => {
    if (Array.isArray(users)) allUsersRef.current = users;
    else allUsersRef.current = users(allUsersRef.current);
  }, setCurrentUserKeys);
  const { fetchAdminUsers, handleSetRole, handleDeleteUser } = adminHook;

  const uiState = useUIState();
  const {
    theme: uiTheme, setTheme: setUITheme,
    activeView, setActiveView,
    showAdmin, setShowAdmin, adminTab, setAdminTab,
    mobileSidebarOpen, setMobileSidebarOpen,
    showProfileDrawer: uiShowProfileDrawer, setShowProfileDrawer: uiSetShowProfileDrawer,
    isLogoutOpen: uiIsLogoutOpen, setIsLogoutOpen: uiSetIsLogoutOpen,
    avatarMenu, setAvatarMenu,
    closeProfileDrawer, closeLogout, closeFingerprintModal,
    closeAvatarAndOpenProfile, closeAvatarAndShowFingerprint,
    showSearch, openSearch, closeSearch,
    showFingerprintModal, setShowFingerprintModal,
  } = uiState;

  useEffect(() => {
    if (currentUserKeys && !socketObj.connected) {
      // joinRoom handled by useSocket
    }
    return () => { if (socketObj.connected) socketObj.disconnect(); };
  }, [currentUserKeys]);

  // ── Offline Queue Flush on Reconnect ──────────────────────────────────────
  const isFlushingRef = useRef(false);
  const sharedKeysCacheRef = useRef(new Map<string, CryptoKey>());
  const offlineQueueRef = useRef({ privateKeyObject, allUsers: allUsersRef.current });
  useEffect(() => { offlineQueueRef.current = { privateKeyObject, allUsers: allUsersRef.current }; }, [privateKeyObject, allUsersRef.current]);

  const flushOfflineQueue = useCallback(() => {
    if (!currentUserKeys || isFlushingRef.current || !getJwtToken()) return;
    if (!socketObj.connected || !navigator.onLine) return;
    isFlushingRef.current = true;
    const safetyTimer = setTimeout(() => { isFlushingRef.current = false; }, 15000);
    processOfflineQueue({
      senderId: currentUserKeys.userId,
      socket: socketObj,
      token: getJwtToken() || '',
      sharedKeysCache: sharedKeysCacheRef.current,
      privateKey: offlineQueueRef.current.privateKeyObject,
      activeUsers: offlineQueueRef.current.allUsers,
      onMessageFlushed: (msg) => {
        if (msg.channelId) socketObj.emit('channels:get');
      },
      onQueueEmpty: () => { clearTimeout(safetyTimer); isFlushingRef.current = false; }
    }).catch(() => { clearTimeout(safetyTimer); isFlushingRef.current = false; });
  }, [currentUserKeys, getJwtToken]);

  // Flush when socket connects
  useEffect(() => {
    const handleConnect = () => {
      if (currentUserKeys) {
        socketObj.emit('user:join', {
          userId: currentUserKeys.userId,
          username: currentUserKeys.username,
          displayName: currentUserKeys.displayName,
          role: currentUserKeys.role,
          publicKey: currentUserKeys.publicKeyBase64,
          signingPublicKey: currentUserKeys.signingPublicKeyBase64,
        });
        socketObj.emit('channels:get');
      }
      const timer = setTimeout(() => {
        if (socketObj.connected && navigator.onLine) flushOfflineQueue();
      }, 1000);
    };
    socketObj.on('connect', handleConnect);
    return () => { socketObj.off('connect', handleConnect); };
  }, [flushOfflineQueue, currentUserKeys]);

  // Restart socket when browser comes back online
  useEffect(() => {
    const handleOnline = () => {
      if (!socketObj.connected && currentUserKeys) connectSocket();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [currentUserKeys]);

  // Periodic flush every 3s
  useEffect(() => {
    if (!currentUserKeys) return;
    const interval = setInterval(() => {
      if (socketObj.connected && !isFlushingRef.current) flushOfflineQueue();
    }, 3000);
    return () => clearInterval(interval);
  }, [currentUserKeys, flushOfflineQueue]);

  const [peerFingerprint, setPeerFingerprint] = useState('');
  const [isConnected, setIsConnected] = useState(true);

  const resolveMessageKey = useCallback(async (msg: LocalMessage): Promise<CryptoKey | null> => {
    if (!currentUserKeys || !privateKeyObject) return null;
    if (msg.channelId) {
      const channelKey = await getOrGenerateChannelKey(msg.channelId);
      return channelKey || null;
    }
    const peerId = msg.senderId === currentUserKeys.userId ? msg.recipientId : msg.senderId;
    if (!peerId) return null;
    const peer = allUsersRef.current.find(u => u.userId === peerId);
    if (!peer?.publicKey) return null;
    return await getOrDeriveSharedKey(privateKeyObject, peer.publicKey);
  }, [currentUserKeys, privateKeyObject, getOrDeriveSharedKey, getOrGenerateChannelKey]);

  const handleSelectUser = useCallback(async (user: User) => {
    selectedPeerRef.current = user;
    selectedChannelRef.current = null;
    setSelectedUser(user);
    setSelectedChannel(null);
    setActiveView('dms');

    // Emit read receipt for all unread DMs from this peer
    if (socketObj.connected && currentUserKeys) {
      socketObj.emit('message:read', { conversationId: user.userId, lastReadMessageId: '', userId: currentUserKeys.userId });
    }

    // Mark all messages from this peer as read in Dexie
    const unreadFromPeer = await db.messages
      .where('senderId').equals(user.userId)
      .and(m => m.status !== 'read' && !m.channelId)
      .toArray();
    for (const m of unreadFromPeer) {
      await db.messages.put({ ...m, status: 'read' as const });
    }

    // Validate peer key via TOFU
    const isValid = await validatePeerKeyTofu(user);
    if (!isValid) {
      setMitmWarnings(prev => ({ ...prev, [user.userId]: true }));
    } else {
      setMitmWarnings(prev => {
        const next = { ...prev };
        delete next[user.userId];
        return next;
      });
    }
  }, [setActiveView, socketObj, currentUserKeys]);

  const handleSelectChannel = useCallback(async (channel: Channel) => {
    selectedChannelRef.current = channel;
    selectedPeerRef.current = null;
    setSelectedChannel(channel);
    setSelectedUser(null);
    setActiveView('channels');

    // Delegate to hook for socket join and key request
    hookHandleSelectChannel(channel);

    // Emit read receipt for all unread messages in this channel
    if (socketObj.connected && currentUserKeys) {
      socketObj.emit('message:read', { conversationId: channel.id, lastReadMessageId: '' });
    }
  }, [setActiveView, hookHandleSelectChannel, socketObj, currentUserKeys]);

  const handleCloseChat = useCallback(() => {
    selectedPeerRef.current = null;
    selectedChannelRef.current = null;
    setSelectedUser(null);
    setSelectedChannel(null);
  }, []);

  const handleLogoutConfirm = useCallback(() => {
    // Call the auth hook's logout confirm to clear auth state and IndexedDB
    auth.handleLogoutConfirm();
    // Clear local state
    setSelectedUser(null);
    setSelectedChannel(null);
    setAllUsers([]);
    setShowAdmin(false);
    setShowProfileDrawer(false);
    setIsLogoutOpen(false);
    setShowFingerprintModal(false);
    setActiveView('dms');
    setAdminTab('overview');
    // Clear refs
    selectedPeerRef.current = null;
    selectedChannelRef.current = null;
    allUsersRef.current = [];
    onlineIdsRef.current = new Set();
    awayIdsRef.current = new Set();
    lastViewedDmsRef.current = {};
    lastViewedChannelsRef.current = {};
  }, []);

  const handleTrustNewKey = useCallback(async (peer: User) => {
    if (!currentUserKeys || !privateKeyObject) return;
    const peerPubKey = await crypto.importPublicKey(peer.publicKey);
    await crypto.deriveSharedKey(privateKeyObject, peerPubKey);
    setMitmWarnings(prev => ({ ...prev, [peer.userId]: false }));

    // Persist the trusted key
    const peerFingerprint = await crypto.getFingerprint(peer.publicKey);
    await saveTrustedKey({
      peerUserId: peer.userId,
      publicKey: peer.publicKey,
      fingerprint: peerFingerprint,
      firstSeenAt: Date.now(),
      lastValidatedAt: Date.now(),
      keyVersion: peer.keyVersion || 1,
    });

    // Re-derive and cache the shared key
    try {
      const freshSharedKey = await crypto.deriveSharedKey(privateKeyObject, peerPubKey);
      // Cache will be populated on next use
    } catch (e) {
      console.error('[TOFU] Failed to re-derive shared key after trust:', e);
    }

    // Re-decrypt all undecrypted DMs from this peer
    try {
      const undecrypted = await db.messages
        .where('senderId').equals(peer.userId)
        .and(m => !m.isDecrypted && !!m.ciphertext && !m.channelId)
        .toArray();
      for (const msg of undecrypted) {
        const payload: EncryptedPayload = {
          id: msg.id, tempId: msg.tempId, senderId: msg.senderId,
          recipientId: msg.recipientId, ciphertext: msg.ciphertext!,
          iv: msg.iv!, timestamp: msg.timestamp, status: msg.status,
        };
        try {
          const sharedKey = await crypto.deriveSharedKey(privateKeyObject, peerPubKey);
          if (!sharedKey) continue;
          const text = await crypto.decryptMessage(payload.ciphertext, payload.iv, sharedKey);
          await saveMessage({ ...msg, text, isDecrypted: true, decryptionError: undefined });
        } catch {}
      }
      // Also re-decrypt outgoing messages (sent TO this peer)
      const undecryptedSelf = await db.messages
        .where('recipientId').equals(peer.userId)
        .and(m => !m.isDecrypted && !!m.ciphertext && !m.channelId)
        .toArray();
      for (const msg of undecryptedSelf) {
        try {
          const sharedKey = await crypto.deriveSharedKey(privateKeyObject, peerPubKey);
          if (!sharedKey) continue;
          const text = await crypto.decryptMessage(msg.ciphertext!, msg.iv!, sharedKey);
          await saveMessage({ ...msg, text, isDecrypted: true, decryptionError: undefined });
        } catch {}
      }
    } catch (e) {
      console.error('[TOFU] Failed to re-decrypt messages:', e);
    }
  }, [currentUserKeys, crypto, privateKeyObject]);

  const handleOnSendMessage = useCallback(async (text: string, replyTo?: string) => {
    await handleSendMessage(text, replyTo);
  }, [handleSendMessage]);

  const handleOnSendFiles = useCallback(async (files: File[], text?: string) => {
    await handleSendFiles(files, text);
  }, [handleSendFiles]);

  const handleOnEditMessage = useCallback(async (messageId: string, newText: string) => {
    await handleEditMessage(messageId, newText);
  }, [handleEditMessage]);

  const handleOnDeleteForMe = useCallback(async (messageId: string) => {
    await handleDeleteForMe(messageId);
  }, [handleDeleteForMe]);

  const handleOnDeleteForEveryone = useCallback(async (messageId: string) => {
    await handleDeleteForEveryone(messageId);
  }, [handleDeleteForEveryone]);

  const handleOnPinMessage = useCallback(async (messageId: string) => {
    await handlePinMessage(messageId);
  }, [handlePinMessage]);

  const handleOnUnpinMessage = useCallback(async (messageId: string) => {
    await handleUnpinMessage(messageId);
  }, [handleUnpinMessage]);

  const handleOnForwardMessage = useCallback(async (originalText: string, target: { type: 'dm'; userId: string } | { type: 'channel'; channelId: string }) => {
    await handleForwardMessage(originalText, target);
    // Navigate to the target conversation after forwarding
    if (target.type === 'channel') {
      const ch = channels.find(c => c.id === target.channelId);
      if (ch) handleSelectChannel(ch);
    } else {
      const peer = allUsersRef.current.find(u => u.userId === target.userId);
      if (peer) handleSelectUser(peer);
    }
  }, [handleForwardMessage, channels, handleSelectChannel, handleSelectUser]);

  const handleOnBlockUser = useCallback(async (userId: string) => {
    await blockUser(userId);
    // Emit socket event so server can enforce blocking
    if (socketObj.connected) {
      socketObj.emit('user:blocked', { userId });
    }
    // Close DM with blocked user
    if (selectedUser?.userId === userId) {
      setSelectedUser(null);
      setActiveView('dms');
    }
  }, [socketObj, selectedUser]);

  const handleOnUnblockUser = useCallback(async (userId: string) => {
    await unblockUser(userId);
    // Emit socket event
    if (socketObj.connected) {
      socketObj.emit('user:unblocked', { userId });
    }
  }, [socketObj]);

  const handleOpenChannelSettings = useCallback((channel: Channel) => {
    setChannelSettings(channel);
  }, [setChannelSettings]);

  const handleOnOpenSearch = useCallback(() => {
    openSearch();
  }, [openSearch]);

  const handleOnOpenFingerprintModal = useCallback(() => {
    setShowFingerprintModal(true);
  }, [setShowFingerprintModal]);

  const handleOnCloseFingerprintModal = useCallback(() => {
    setShowFingerprintModal(false);
  }, [setShowFingerprintModal]);

  const handleOnToggleSidebar = useCallback(() => {
    setMobileSidebarOpen(prev => !prev);
  }, [setMobileSidebarOpen]);

  // ── Fetch User Directory ──────────────────────────────────────────────────────
  const fetchUserDirectory = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setAllUsers(data.users || []);
      const onlineSet = new Set<string>((data.users || []).filter((u: User) => u.isOnline).map((u: User) => u.userId));
      onlineIdsRef.current = onlineSet;
    } catch (e) {
      console.error('[Directory] Failed to fetch user directory:', e);
    }
  }, []);

  const handleAuthenticate = useCallback(async (params: { username: string; displayName?: string; email?: string; password: string; role: string; isRegister: boolean }) => {
    const { username, displayName, email, password, role, isRegister } = params;
    const userId = `usr_${username.trim().replace(/[^a-zA-Z0-9]/g, '')}`;

    let keyPair: any;
    let privKey: CryptoKey;
    let pubKeyBase64: string;

    if (isRegister) {
      // REGISTRATION: Generate keys first, send to server
      const rawPair = await crypto.generateKeyPair();
      pubKeyBase64 = await crypto.exportPublicKey(rawPair.publicKey);
      const privJwk = await crypto.exportKeyToJwk(rawPair.privateKey);
      const pubJwk  = await crypto.exportKeyToJwk(rawPair.publicKey);
      const signPair = await crypto.generateSigningKeyPair();
      const signPub = await crypto.exportPublicKey(signPair.publicKey);
      const signPrivJwk = await crypto.exportKeyToJwk(signPair.privateKey);
      const signPubJwk = await crypto.exportKeyToJwk(signPair.publicKey);
      const vault = await crypto.encryptKeyVaultPair(privJwk, signPrivJwk, password);

      keyPair = {
        userId, username: username.trim(),
        displayName: displayName || username.trim(),
        email: email || `${username.toLowerCase()}@petroshield.internal`,
        role, publicKeyBase64: pubKeyBase64,
        privateKeyJwk: privJwk, publicKeyJwk: pubJwk,
        signingPublicKeyBase64: signPub,
        privateSigningKeyJwk: signPrivJwk,
        publicSigningKeyJwk: signPubJwk,
        createdAt: Date.now()
      };
      await saveUserKeyPair(keyPair);
      privKey = rawPair.privateKey;

      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, displayName, email, password, role,
          publicKey: pubKeyBase64,
          signingPublicKey: signPub,
          encryptedPrivateKey: vault.encryptedPrivateKey,
          keySalt: vault.keySalt
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      setJwtToken(data.token);
      const fp = await crypto.getFingerprint(pubKeyBase64);
      setPrivateKeyObject(privKey);
      const registeredKeyPair = {
        ...keyPair,
        displayName: data.user.displayName || keyPair.displayName,
        email: data.user.email || keyPair.email,
        avatarUrl: data.user.avatarUrl || keyPair.avatarUrl,
        statusMessage: data.user.statusMessage || keyPair.statusMessage,
      };
      await saveUserKeyPair(registeredKeyPair);
      setCurrentUserKeys(registeredKeyPair);
      setUserFingerprint(fp);
      setShowProfileDrawer(false);

      if (!socketObj.connected) connectSocket();
      socketObj.emit('user:join', { userId: registeredKeyPair.userId, username: registeredKeyPair.username, displayName: data.user.displayName, role: registeredKeyPair.role, publicKey: pubKeyBase64, signingPublicKey: registeredKeyPair.signingPublicKeyBase64 });
      await fetchUserDirectory(data.token);
      // Initialize recent DMs from active partners
      const activePartnerIds = await getActiveDMPartners(registeredKeyPair.userId);
      const savedOrder: string[] = JSON.parse(localStorage.getItem('vaultchat_recentDMs') || '[]');
      const orderMap = new Map(savedOrder.map((id: string, idx: number) => [id, idx]));
      const partnerUsers = allUsersRef.current
        .filter((u: User) => activePartnerIds.includes(u.userId))
        .sort((a: User, b: User) => {
          const aIdx = orderMap.get(a.userId) ?? savedOrder.length;
          const bIdx = orderMap.get(b.userId) ?? savedOrder.length;
          return aIdx - bIdx;
        });
      setRecentDMs(partnerUsers);
      socketObj.emit('channels:get');
      // Fetch full message history from server
      fetchAllHistory(data.token).catch(() => {});
    } else {
      // LOGIN
      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      const serverUser = data.user;

      const ensureSigningKeys = async (kp: any): Promise<any> => {
        if (kp.signingPublicKeyBase64 && kp.privateSigningKeyJwk && kp.publicSigningKeyJwk) return kp;
        const signPair = await crypto.generateSigningKeyPair();
        const signPub = await crypto.exportPublicKey(signPair.publicKey);
        const signPrivJwk = await crypto.exportKeyToJwk(signPair.privateKey);
        const signPubJwk = await crypto.exportKeyToJwk(signPair.publicKey);
        const vault = await crypto.encryptKeyVaultPair(kp.privateKeyJwk, signPrivJwk, password);
        const updated = { ...kp, signingPublicKeyBase64: signPub, privateSigningKeyJwk: signPrivJwk, publicSigningKeyJwk: signPubJwk };
        await saveUserKeyPair(updated);
        await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, publicKey: kp.publicKeyBase64, signingPublicKey: signPub, encryptedPrivateKey: vault.encryptedPrivateKey, keySalt: vault.keySalt, forceKeyRotation: true })
        });
        return updated;
      };

      if (keyPair && keyPair.publicKeyBase64 === serverUser.publicKey) {
        keyPair = await ensureSigningKeys(keyPair);
        privKey = await crypto.importPrivateKeyFromJwk(keyPair.privateKeyJwk);
        pubKeyBase64 = keyPair.publicKeyBase64;
      } else if (serverUser.encryptedPrivateKey && serverUser.keySalt) {
        try {
          const decrypted = await crypto.decryptPrivateKeyVault(serverUser.encryptedPrivateKey, serverUser.keySalt, password);
          const { ecdh, ecdsa } = crypto.unwrapKeyVault(decrypted);
          privKey = await crypto.importPrivateKeyFromJwk(ecdh);
          pubKeyBase64 = serverUser.publicKey;
          keyPair = { userId, username: serverUser.username, displayName: serverUser.displayName, email: serverUser.email, role: serverUser.role, publicKeyBase64: pubKeyBase64, privateKeyJwk: ecdh, publicKeyJwk: {} as any, signingPublicKeyBase64: serverUser.signingPublicKey, createdAt: Date.now() };
          if (ecdsa) keyPair.privateSigningKeyJwk = ecdsa;
          keyPair = await ensureSigningKeys(keyPair);
          await saveUserKeyPair(keyPair);
          console.log(`[KeyVault] Successfully synchronized key pair from vault!`);
        } catch (e) {
          console.error('[KeyVault] Failed to decrypt private key vault');
          throw new Error('Key Vault decryption failed. Check password.');
        }
      } else {
        const rawPair = await crypto.generateKeyPair();
        pubKeyBase64 = await crypto.exportPublicKey(rawPair.publicKey);
        const privJwk = await crypto.exportKeyToJwk(rawPair.privateKey);
        const pubJwk  = await crypto.exportKeyToJwk(rawPair.publicKey);
        const signPair = await crypto.generateSigningKeyPair();
        const signPub = await crypto.exportPublicKey(signPair.publicKey);
        const signPrivJwk = await crypto.exportKeyToJwk(signPair.privateKey);
        const signPubJwk = await crypto.exportKeyToJwk(signPair.publicKey);
        const vault = await crypto.encryptKeyVaultPair(privJwk, signPrivJwk, password);

        keyPair = { userId, username: username.trim(), displayName: serverUser.displayName || username.trim(), email: serverUser.email || `${username.toLowerCase()}@petroshield.internal`, role: serverUser.role || role, publicKeyBase64: pubKeyBase64, privateKeyJwk: privJwk, publicKeyJwk: pubJwk, signingPublicKeyBase64: signPub, privateSigningKeyJwk: signPrivJwk, publicSigningKeyJwk: signPubJwk, createdAt: Date.now() };
        await saveUserKeyPair(keyPair);
        privKey = rawPair.privateKey;
        await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, publicKey: pubKeyBase64, signingPublicKey: signPub, encryptedPrivateKey: vault.encryptedPrivateKey, keySalt: vault.keySalt, forceKeyRotation: true }) });
      }

      setJwtToken(data.token);
      const fp = await crypto.getFingerprint(pubKeyBase64);
      setPrivateKeyObject(privKey);
      const enrichedKeyPair = { ...keyPair, displayName: serverUser.displayName || keyPair.displayName, email: serverUser.email || keyPair.email, avatarUrl: serverUser.avatarUrl || keyPair.avatarUrl, statusMessage: serverUser.statusMessage || keyPair.statusMessage, keyVersion: serverUser.keyVersion ?? keyPair.keyVersion ?? 1 };
      await saveUserKeyPair(enrichedKeyPair);
      setCurrentUserKeys(enrichedKeyPair);
      setUserFingerprint(fp);
      setShowProfileDrawer(false);

      if (!socketObj.connected) connectSocket();
      socketObj.emit('user:join', { userId: enrichedKeyPair.userId, username: enrichedKeyPair.username, displayName: serverUser.displayName || enrichedKeyPair.displayName, role: enrichedKeyPair.role, publicKey: pubKeyBase64, signingPublicKey: enrichedKeyPair.signingPublicKeyBase64 });
      await fetchUserDirectory(data.token);
      // Initialize recent DMs from active partners
      const activePartnerIds = await getActiveDMPartners(enrichedKeyPair.userId);
      const savedOrder: string[] = JSON.parse(localStorage.getItem('vaultchat_recentDMs') || '[]');
      const orderMap = new Map(savedOrder.map((id: string, idx: number) => [id, idx]));
      const partnerUsers = allUsersRef.current
        .filter((u: User) => activePartnerIds.includes(u.userId))
        .sort((a: User, b: User) => {
          const aIdx = orderMap.get(a.userId) ?? savedOrder.length;
          const bIdx = orderMap.get(b.userId) ?? savedOrder.length;
          return aIdx - bIdx;
        });
      setRecentDMs(partnerUsers);
      socketObj.emit('channels:get');
      // Fetch full message history from server
      fetchAllHistory(data.token).catch(() => {});
    }
  }, [crypto, setJwtToken, setCurrentUserKeys, setPrivateKeyObject, setUserFingerprint, setShowProfileDrawer, fetchUserDirectory]);

  const handleUpdateProfile = useCallback(async (data: { displayName?: string; email?: string; avatar?: string; username?: string; statusMessage?: string; phone?: string; bio?: string; bannerUrl?: string }) => {
    const token = getJwtToken();
    if (!token) throw new Error('Not authenticated');
    
    const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    const updatedUser = await res.json();
    
    // Update local state
    if (currentUserKeys) {
      const updatedKeys = { ...currentUserKeys, ...updatedUser };
      setCurrentUserKeys(updatedKeys);
      await saveUserKeyPair(updatedKeys);
      
      // Emit profile update to other clients
      if (socketObj.connected) {
        socketObj.emit('user:profile-update', { userId: currentUserKeys.userId, ...updatedUser });
      }
    }
    
    return updatedUser;
  }, [getJwtToken, currentUserKeys]);

  // Create usersWithPresence for Sidebar
  const usersWithPresence: User[] = allUsersRef.current.map(u => ({
    ...u,
    isOnline: onlineIdsRef.current.has(u.userId),
    isAway: onlineIdsRef.current.has(u.userId) && awayIdsRef.current.has(u.userId),
  }));

  if (isRehydrating) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-app)' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[var(--accent-primary)] border-t-transparent" />
      </div>
    );
  }

  if (!currentUserKeys) {
    return (
      <AuthModal
        onAuthenticate={handleAuthenticate}
        error={authError}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden font-sans select-none" style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}>
      {/* Primary Sidebar Navigation (Logo, Channels, DMs, Collapsible Toggle, Profile Footer) */}
      {currentUserKeys && (
        <>
          {/* Mobile backdrop */}
          <div
            className={`mobile-backdrop ${mobileSidebarOpen ? 'open' : ''}`}
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className={`mobile-sidebar ${mobileSidebarOpen ? 'mobile-sidebar-open' : ''}`}>
          <Sidebar
            users={usersWithPresence}
            channels={channels}
            currentUser={currentUserKeys}
            selectedUser={selectedUser}
            selectedChannel={selectedChannel}
            activeView={activeView}
            adminTab={adminTab}
            userFingerprint={userFingerprint}
            isAdmin={currentUserKeys?.role === 'ADMIN'}
            showAdmin={showAdmin}
            setShowAdmin={setShowAdmin}
            onSelectView={(view) => { setShowAdmin(false); setActiveView(view); setMobileSidebarOpen(false); }}
            onSelectUser={(user) => { setShowAdmin(false); handleSelectUser(user); setMobileSidebarOpen(false); }}
            onSelectChannel={(ch) => { setShowAdmin(false); handleSelectChannel(ch); setMobileSidebarOpen(false); }}
            onCreateChannel={handleCreateChannel}
            onShowFingerprintModal={handleOnOpenFingerprintModal}
            onOpenProfileDrawer={() => setShowProfileDrawer(true)}
            onOpenChannelSettings={(channel) => setChannelSettings(channel)}
            onToggleAdmin={(show: boolean) => setShowAdmin(show)}
            onSelectAdminTab={setAdminTab}
            onLogout={handleLogout}
            unreadDMs={unreadDMs}
            unreadChannels={unreadChannels}
            recentDMs={recentDMs}
            latestDMMessages={latestDMMessages}
            onCloseDM={(userId) => {
              if (selectedUser?.userId === userId) {
                setSelectedUser(null);
                setActiveView('channels');
              }
            }}
          />
          </div>
        </>
      )}

      {showAdmin && currentUserKeys?.role === 'ADMIN' ? (
        <React.Suspense fallback={<div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-app)' }}><div className="animate-spin rounded-full h-8 w-8 border-4 border-[var(--accent-primary)] border-t-transparent" /></div>}>
          <AdminDashboard
            currentUser={currentUserKeys}
            fetchUsers={fetchAdminUsers}
            onSetRole={handleSetRole}
            onDeleteUser={handleDeleteUser}
            onClose={() => setShowAdmin(false)}
            activeTab={adminTab}
          />
        </React.Suspense>
      ) : (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Offline Banner - inside content, not absolute */}
          {isOffline && currentUserKeys && <OfflineBanner pendingCount={pendingCount} />}

          {/* Main Workspace Feed */}
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <ChatArea
              showAdmin={showAdmin}
              selectedUser={selectedUser}
              selectedChannel={selectedChannel}
              currentUserId={currentUserKeys.userId}
              currentUserKeys={currentUserKeys}
              allUsers={usersWithPresence}
              peerFingerprint={peerFingerprint}
              mitmWarning={selectedUser ? mitmWarnings[selectedUser.userId] : false}
              isConnected={networkStatus.isSocketConnected}
              typingUsers={selectedChannel ? (typingUsers[selectedChannel.id as string] || []) : selectedUser ? (typingUsers[selectedUser.userId as string] || []) : []}
              fingerprint={userFingerprint}
              showFingerprintModal={showFingerprintModal}
              onCloseChat={handleCloseChat}
              onTrustNewKey={handleTrustNewKey}
              onEditMessage={handleOnEditMessage}
              onDeleteForMe={handleOnDeleteForMe}
              onDeleteForEveryone={handleOnDeleteForEveryone}
              resolveMessageKey={resolveMessageKey}
              onSendMessage={handleOnSendMessage}
              onSendFiles={handleOnSendFiles}
              uploadProgress={uploadProgress}
              pinnedMessages={selectedChannel ? (pinnedMessages[selectedChannel.id] || []) : []}
              onPin={handleOnPinMessage}
              onUnpin={handleOnUnpinMessage}
              onOpenChannelSettings={(ch) => setChannelSettings(ch)}
              onOpenSearch={handleOnOpenSearch}
              onOpenFingerprintModal={handleOnOpenFingerprintModal}
              onCloseFingerprintModal={handleOnCloseFingerprintModal}
              onToggleSidebar={() => setMobileSidebarOpen(prev => !prev)}
              onForwardMessage={handleOnForwardMessage}
              channels={channels}
              onBlockUser={(userId) => {
                setAllUsers(prev => prev.map(u => u.userId === userId ? { ...u, blockedByMe: true } : u));
              }}
              onUnblockUser={(userId) => {
                setAllUsers(prev => prev.map(u => u.userId === userId ? { ...u, blockedByMe: false } : u));
              }}
            />
          </div>
        </div>
      )}

      {showProfileDrawer && currentUserKeys && (
        <ProfileDrawer
          currentUser={currentUserKeys}
          userFingerprint={userFingerprint}
          onClose={() => setShowProfileDrawer(false)}
          onLogout={handleLogout}
          onUpdateProfile={handleUpdateProfile}
          theme={theme}
          onThemeChange={setTheme}
        />
      )}

      {showFingerprintModal && selectedUser && (
        <div className="fixed inset-0 z-[99998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowFingerprintModal(false)} />
          <div className="w-full max-w-md rounded-2xl bg-[var(--bg-sidebar)] border border-[var(--border-color)] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">FINGERPRINT VERIFICATION</h2>
                <button onClick={() => setShowFingerprintModal(false)} className="p-1 rounded hover:bg-[var(--hover-color)]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-[var(--text-muted)] tracking-wide">YOUR FINGERPRINT</span>
                  <button onClick={() => { navigator.clipboard.writeText(userFingerprint); showToast('Copied!', 'success'); }} className="ml-auto p-1 rounded hover:bg-[var(--hover-color)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono break-all">{userFingerprint}</span>
                </div>
              </div>
              <div className="p-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-[var(--text-muted)] tracking-wide">{selectedUser.username}'S FINGERPRINT</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono break-all">{peerFingerprint || 'Loading...'}</span>
                </div>
                {peerFingerprint && peerFingerprint !== userFingerprint && (
                  <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs">
                    <strong>MISMATCH DETECTED</strong> - This contact's fingerprint doesn't match your records.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirmation modal */}
      <ConfirmModal
        isOpen={isLogoutOpen}
        title="Log out?"
        description="Are you sure you want to log out?"
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        isDangerous={true}
        onConfirm={handleLogoutConfirm}
        onClose={() => setIsLogoutOpen(false)}
      />

      {/* Channel Settings Modal */}
      {channelSettings && currentUserKeys && (
        <ChannelSettingsModal
          channel={channelSettings}
          isOpen={true}
          onClose={() => setChannelSettings(null)}
          onUpdate={handleUpdateChannel}
          onDelete={handleDeleteChannel}
          allUsers={usersWithPresence}
          currentUser={currentUserKeys}
          onMemberClick={(user) => {
            setChannelSettings(null);
            handleSelectUser(user);
          }}
          onLeaveChannel={handleLeaveChannel}
          onJumpToMessage={async (messageId: string) => {
            setChannelSettings(null);
            const msg = await db.messages.get(messageId);
            if (msg?.channelId) {
              const ch = channels.find(c => c.id === msg.channelId);
              if (ch) handleSelectChannel(ch);
            }
          }}
        />
      )}

      {/* Message Search Modal */}
      {showSearch && currentUserKeys && (
        <MessageSearch
          isOpen={showSearch}
          onClose={closeSearch}
          onSelectMessage={async (msg: LocalMessage) => {
            if (msg.channelId) {
              const ch = channels.find(c => c.id === msg.channelId);
              if (ch) handleSelectChannel(ch);
            } else {
              const peerId = msg.senderId === currentUserId ? msg.recipientId : msg.senderId;
              const peer = allUsersRef.current.find(u => u.userId === peerId);
              if (peer) handleSelectUser(peer);
            }
            closeSearch();
          }}
          allUsers={usersWithPresence}
          channels={channels}
          selectedUser={selectedUser}
          selectedChannel={selectedChannel}
          currentUserId={currentUserId}
        />
      )}

      <ToastContainer />
    </div>
  );
};