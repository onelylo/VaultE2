import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket, connectSocket } from './lib/socket';
import { Loader2 } from 'lucide-react';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportKeyToJwk,
  importPrivateKeyFromJwk,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  getFingerprint,
  computePublicKeyFingerprint,
  generateChannelSymmetricKey,
  importSymmetricKeyFromJwk,
  decryptPrivateKeyVault,
  encryptKeyVaultPair,
  unwrapKeyVault,
  generateSigningKeyPair,
  encryptChannelKeyForUser,
  decryptChannelKeyForUser,
  compareFingerprints,
  encryptBinaryData,
  signKeyRotation,
  verifyKeyRotationSignature
} from './lib/crypto';
import {
  API_BASE,
  MAX_ATTACHMENT_BYTES,
  uploadEncryptedAttachment,
  readFileAsArrayBuffer,
  generateImageThumbnail
} from './lib/attachments';
import {
  db,
  saveUserKeyPair,
  getUserKeyPair,
  getAnyUserKeyPair,
  saveMessage,
  updateMessageStatus,
  editMessageLocally,
  deleteMessageLocally,
  markMessageDeletedLocally,
  getTrustedKey,
  saveTrustedKey,
  saveChannel,
  getStoredChannels,
  saveChannelKey,
  getChannelKey
} from './lib/db';
import { useNetworkStatus, processOfflineQueue } from './lib/queue';
import { playNotificationSound } from './lib/notify';
import type {
  User,
  Channel,
  LocalMessage,
  EncryptedPayload,
  UserKeyPair,
  UserRole,
  AttachmentMeta,
  AttachmentPayload,
  PendingUpload
} from './types/chat';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { AuthModal } from './components/AuthModal';
import { OfflineBanner } from './components/OfflineBanner';
import { ProfileDrawer } from './components/ProfileDrawer';
import { UserAvatarMenu } from './components/UserAvatarMenu';
import { ChannelSettingsModal } from './components/channels/ChannelSettingsModal';
import type { AdminUser } from './types/chat';

const AdminDashboard = React.lazy(() => import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const MessageSearch = React.lazy(() => import('./components/MessageSearch').then(m => ({ default: m.MessageSearch })));

export const App: React.FC = () => {
  // ── Auth & Keys ──────────────────────────────────────────────────────────────
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
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'users' | 'infrastructure'>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState<{ user: User; rect: DOMRect } | null>(null);
  const [channelSettings, setChannelSettings] = useState<Channel | null>(null);

  // Apply user-specific theme when logged in
  useEffect(() => {
    const userId = currentUserKeys?.userId;
    if (userId) {
      const saved = localStorage.getItem(`vaultchat_theme_${userId}`);
      if (saved && saved !== 'undefined') {
        document.documentElement.setAttribute('data-theme', saved);
        setTheme(saved);
      }
    }
  }, [currentUserKeys?.userId]);

  // Persist theme changes
  useEffect(() => {
    const userId = currentUserKeys?.userId || 'guest';
    localStorage.setItem(`vaultchat_theme_${userId}`, theme);
  }, [theme, currentUserKeys?.userId]);

  // ── Directory & Presence ─────────────────────────────────────────────────────
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const allUsersRef = useRef<User[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  // Always keep allUsersRef synchronized with latest state
  useEffect(() => {
    allUsersRef.current = allUsers;
  }, [allUsers]);

  // ── Navigation & Workspace State ──────────────────────────────────────────────
  const [activeView, setActiveView] = useState<'channels' | 'dms'>('dms');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<User | null>(null);
  const selectedPeerRef = useRef<User | null>(null);
  useEffect(() => { selectedPeerRef.current = selectedPeer; }, [selectedPeer]);

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const selectedChannelRef = useRef<Channel | null>(null);
  useEffect(() => { selectedChannelRef.current = selectedChannel; }, [selectedChannel]);
  const [peerFingerprint, setPeerFingerprint] = useState<string>('');
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [unreadDMs, setUnreadDMs] = useState<Record<string, number>>({});
  const [lastViewedDms, setLastViewedDms] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('vaultchat_lastViewedDms') || '{}'); } catch { return {}; }
  });
  const [unreadChannels, setUnreadChannels] = useState<Record<string, number>>({});
  const [lastViewedChannels, setLastViewedChannels] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('vaultchat_lastViewedChannels') || '{}'); } catch { return {}; }
  });
  const [pinnedMessages, setPinnedMessages] = useState<Record<string, { messageId: string; pinnedBy: string; pinnedAt: number }[]>>({});

  // ── Security & Caches ─────────────────────────────────────────────────────────
  const [mitmWarnings, setMitmWarnings] = useState<Record<string, boolean>>({});
  const [sharedKeysCache, setSharedKeysCache] = useState<Map<string, CryptoKey>>(new Map());
  const [channelKeysCache, setChannelKeysCache] = useState<Map<string, CryptoKey>>(new Map());

  // ── Network ──────────────────────────────────────────────────────────────────
  const networkStatus = useNetworkStatus(socket, currentUserKeys?.userId);
  const { isOffline, pendingCount } = networkStatus;
  const isFlushing = useRef(false);

  // ── Recent DMs (instant sidebar updates) ─────────────────────────────────────
  const [recentDMs, setRecentDMs] = useState<User[]>([]);

  const upsertDMConversation = useCallback((peer: User, lastMessageText: string) => {
    setRecentDMs(prev => {
      const filtered = prev.filter(u => u.userId !== peer.userId);
      const updatedUser: User = {
        ...peer,
        isOnline: onlineIds.has(peer.userId),
      };
      return [updatedUser, ...filtered];
    });
  }, [onlineIds]);

  // ── On-Demand Public Key Fetch ───────────────────────────────────────────────
  const fetchUserPublicKey = useCallback(async (userId: string): Promise<string | null> => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = await res.json();
      const freshUsers: User[] = data.users || [];
      setAllUsers(prev => {
        const merged = [...prev];
        for (const u of freshUsers) {
          const idx = merged.findIndex(m => m.userId === u.userId);
          if (idx >= 0) merged[idx] = { ...merged[idx], ...u };
          else merged.push(u);
        }
        return merged;
      });
      return freshUsers.find(u => u.userId === userId)?.publicKey || null;
    } catch {
      return null;
    }
  }, []);

  // ── Helpers: Derive Shared ECDH Key for DMs ──────────────────────────────────
  const getOrDeriveSharedKey = useCallback(
    async (peerUserId: string, peerPublicKeyBase64: string): Promise<CryptoKey | null> => {
      if (!privateKeyObject) return null;
      if (sharedKeysCache.has(peerUserId)) return sharedKeysCache.get(peerUserId)!;
      try {
        const peerPubKey = await importPublicKey(peerPublicKeyBase64);
        const derivedKey = await deriveSharedKey(privateKeyObject, peerPubKey);
        setSharedKeysCache(prev => new Map(prev).set(peerUserId, derivedKey));
        return derivedKey;
      } catch (err) {
        console.error('[E2EE] Failed to derive shared key:', err);
        return null;
      }
    },
    [privateKeyObject, sharedKeysCache]
  );

  // ── Helpers: Group Channel Key Fetch / Distribution ─────────────────────────
  const getOrGenerateChannelKey = useCallback(async (channelId: string): Promise<CryptoKey | null> => {    if (channelKeysCache.has(channelId)) return channelKeysCache.get(channelId)!;
    try {
      // 1. Check local Dexie IndexedDB
      const stored = await getChannelKey(channelId);
      if (stored?.keyJwk) {
        const imported = await importSymmetricKeyFromJwk(stored.keyJwk);
        setChannelKeysCache(prev => new Map(prev).set(channelId, imported));
        return imported;
      }

      // 2. Fetch encrypted channel key envelope from server
      const token = localStorage.getItem('vaultchat_jwt');
      if (token && currentUserKeys) {
        const res = await fetch(`${API_BASE}/api/channels/${channelId}/key`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const { encryptedChannelKey, iv } = data.key;
          // Find creator/distributor public key or self shared key
          const creatorUserId = channels.find(c => c.id === channelId)?.createdBy || currentUserKeys.userId;
          const creatorUser = allUsers.find(u => u.userId === creatorUserId) || {
            userId: currentUserKeys.userId,
            publicKey: currentUserKeys.publicKeyBase64
          };

          const sharedKey = await getOrDeriveSharedKey(creatorUser.userId, creatorUser.publicKey);
          if (sharedKey) {
            const keyJwk = await decryptChannelKeyForUser(encryptedChannelKey, iv, sharedKey);
            const imported = await importSymmetricKeyFromJwk(keyJwk);
            await saveChannelKey({ channelId, keyJwk });
            setChannelKeysCache(prev => new Map(prev).set(channelId, imported));
            console.log(`[ChannelKeys] Successfully decrypted & stored channel key for #${channelId}`);
            return imported;
          }
        }
      }

      // 3. Fallback: generate local key if newly created
      const keyObj = await generateChannelSymmetricKey();
      const jwk = await exportKeyToJwk(keyObj);
      await saveChannelKey({ channelId, keyJwk: jwk });
      setChannelKeysCache(prev => new Map(prev).set(channelId, keyObj));
      return keyObj;
    } catch (e) {
      console.error('[E2EE] Channel key retrieval error:', e);
      return null;
    }
  }, [channelKeysCache, channels, allUsers, currentUserKeys, getOrDeriveSharedKey]);

  // ── Helper: Decrypt an EncryptedPayload into a LocalMessage ─────────────────
  const decryptPayload = useCallback(async (payload: EncryptedPayload, usersSource?: User[]): Promise<LocalMessage | null> => {
    if (!currentUserKeys) return null;
    const directory = usersSource || allUsersRef.current;
    let key: CryptoKey | null = null;

    if (payload.channelId) {
      key = await getOrGenerateChannelKey(payload.channelId);
    } else {
      const peerId = payload.senderId === currentUserKeys.userId ? payload.recipientId : payload.senderId;
      if (!peerId) return null;
      let peerPublicKey = peerId === currentUserKeys.userId
        ? currentUserKeys.publicKeyBase64
        : directory.find(u => u.userId === peerId)?.publicKey;

      // FALLBACK: If user or public key is missing from state, fetch directly from API
      if (!peerPublicKey && peerId !== currentUserKeys.userId) {
        const fetched = await fetchUserPublicKey(peerId);
        if (fetched) peerPublicKey = fetched;
      }

      if (peerPublicKey) key = await getOrDeriveSharedKey(peerId, peerPublicKey);
      else if (peerId !== currentUserKeys.userId) {
        console.error(`[E2EE] Cannot decrypt: missing public key for ${peerId}`);
      }
    }
    if (!key) return null;

    let text = '🔒 Unable to decrypt message';
    let isDecrypted = false;
    if (payload.ciphertext) {
      try {
        text = await decryptMessage(payload.ciphertext, payload.iv, key);
        isDecrypted = true;
      } catch (e) {
        console.error('[E2EE] Decrypt error:', e);
      }
    } else {
      text = '';
      isDecrypted = true; // attachment-only message
    }

    let attachmentMeta: AttachmentMeta | undefined;
    if (payload.attachment?.encryptedMetadata) {
      try {
        const metaJson = await decryptMessage(payload.attachment.encryptedMetadata, payload.attachment.iv, key);
        attachmentMeta = JSON.parse(metaJson);
      } catch (e) {
        console.error('[E2EE] Attachment metadata decrypt error:', e);
      }
    }

    return {
      id: payload.id,
      tempId: payload.tempId,
      senderId: payload.senderId,
      recipientId: payload.recipientId,
      channelId: payload.channelId,
      text,
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      timestamp: payload.timestamp || Date.now(),
      status: 'received' as const,
      isDecrypted,
      isEdited: payload.isEdited,
      isDeleted: payload.isDeleted,
      attachment: payload.attachment,
      attachmentMeta,
    };
  }, [currentUserKeys, getOrDeriveSharedKey, getOrGenerateChannelKey, fetchUserPublicKey]);

  // ── Helper: Resolve the AES-GCM key for a stored local message (for attachments)
  const resolveMessageKey = useCallback(async (msg: LocalMessage): Promise<CryptoKey | null> => {
    if (!currentUserKeys || !privateKeyObject) return null;
    if (msg.channelId) return await getOrGenerateChannelKey(msg.channelId);
    const peerId = msg.senderId === currentUserKeys.userId ? msg.recipientId : msg.senderId;
    if (!peerId) return null;
    const peer = allUsersRef.current.find(u => u.userId === peerId);
    if (!peer?.publicKey) return null;
    return await getOrDeriveSharedKey(peerId, peer.publicKey);
  }, [currentUserKeys, privateKeyObject, getOrDeriveSharedKey, getOrGenerateChannelKey]);

  // ── Full History Rehydration (GET /api/messages) ────────────────────────────
  const fetchAllHistory = useCallback(async (token: string) => {
    if (!currentUserKeys) return;
    try {
      // Fetch the directory fresh so decryption doesn't depend on UI state timing
      let usersSource: User[] = allUsersRef.current;
      try {
        const usersRes = await fetch(`${API_BASE}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          usersSource = usersData.users || [];
          const onlineSet = new Set<string>(usersSource.filter((u: User) => u.isOnline).map((u: User) => u.userId));
          setOnlineIds(onlineSet);
        }
      } catch { /* keep existing directory */ }

      const res = await fetch(`${API_BASE}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const payloads: EncryptedPayload[] = data.messages || [];
      const incoming: EncryptedPayload[] = [];
      for (const payload of payloads) {
        const local = await decryptPayload(payload, usersSource);
        if (local) {
          await saveMessage(local);
          if (payload.senderId !== currentUserKeys.userId) incoming.push(payload);
        }
      }
      // Notify senders that their offline messages reached our device
      for (const payload of incoming) {
        socket.emit('message:delivered', { messageId: payload.id, senderId: payload.senderId });
      }
      // Load reactions for all fetched messages
      console.log(`[History] Restored ${payloads.length} message(s) from PostgreSQL`);
    } catch (e) {
      console.error('[History] Global history fetch error:', e);
    }
  }, [currentUserKeys, decryptPayload]);

  // ── TOFU Key Pinning & Signed Rotation Chain Verification ────────────────────
  const validatePeerKeyTofu = useCallback(async (peer: User): Promise<boolean> => {
    try {
      const currentFp = await computePublicKeyFingerprint(peer.publicKey);
      const trusted = await getTrustedKey(peer.userId);
      if (!trusted) {
        await saveTrustedKey({
          peerUserId: peer.userId,
          fingerprint: currentFp,
          publicKey: peer.publicKey,
          keyVersion: peer.keyVersion ?? 1,
          firstSeenAt: Date.now(),
          lastValidatedAt: Date.now(),
        });
        setMitmWarnings(prev => ({ ...prev, [peer.userId]: false }));
        return true;
      }
      const matches = compareFingerprints(trusted.fingerprint, currentFp);
      if (matches) {
        setMitmWarnings(prev => ({ ...prev, [peer.userId]: false }));
        return true;
      }

      // Key changed → this is only legitimate if the rotation is cryptographically
      // signed by the OLD signing private key (verified against the pinned chain).
      const oldKey = peer.oldPublicKey;
      const oldSigningKey = peer.oldSigningPublicKey;
      const newSigningKey = peer.signingPublicKey;
      const rotationSig = peer.keyRotationSignature;
      const rotated = (peer.keyVersion ?? 1) > (trusted.keyVersion ?? 1)
        && !!oldKey && !!oldSigningKey && !!newSigningKey && !!rotationSig
        && compareFingerprints(await computePublicKeyFingerprint(oldKey), trusted.fingerprint);
      if (rotated) {
        const valid = await verifyKeyRotationSignature(peer.publicKey, newSigningKey, oldKey, rotationSig, oldSigningKey);
        if (valid) {
          await saveTrustedKey({
            peerUserId: peer.userId,
            fingerprint: currentFp,
            publicKey: peer.publicKey,
            keyVersion: peer.keyVersion ?? 1,
            firstSeenAt: trusted.firstSeenAt,
            lastValidatedAt: Date.now(),
          });
          setMitmWarnings(prev => ({ ...prev, [peer.userId]: false }));
          console.log(`[TOFU] Accepted signed key rotation for ${peer.username} (v${peer.keyVersion})`);
          return true;
        }
      }
      setMitmWarnings(prev => ({ ...prev, [peer.userId]: true }));
      return false;
    } catch { return true; }
  }, []);

  const handleTrustNewKey = async (peer: User) => {
    const currentFp = await computePublicKeyFingerprint(peer.publicKey);
    await saveTrustedKey({
      peerUserId: peer.userId,
      fingerprint: currentFp,
      publicKey: peer.publicKey,
      keyVersion: peer.keyVersion ?? 1,
      firstSeenAt: Date.now(),
      lastValidatedAt: Date.now(),
    });
    setMitmWarnings(prev => ({ ...prev, [peer.userId]: false }));
    const fp = await getFingerprint(peer.publicKey);
    setPeerFingerprint(fp);
    console.log(`[TOFU] Trusted & pinned new key fingerprint for ${peer.username}`);
  };

  // ── Signed Key Rotation (device compromise / vault resync) ───────────────────
  const handleRotateKey = useCallback(async (password: string): Promise<void> => {
    if (!currentUserKeys || !privateKeyObject) return;
    try {
      const oldPublicKey = currentUserKeys.publicKeyBase64;
      const rawPair = await generateKeyPair();
      const newPublicKey = await exportPublicKey(rawPair.publicKey);
      const newPrivJwk = await exportKeyToJwk(rawPair.privateKey);
      const newPubJwk = await exportKeyToJwk(rawPair.publicKey);

      const signPair = await generateSigningKeyPair();
      const newSignPub = await exportPublicKey(signPair.publicKey);
      const newSignPrivJwk = await exportKeyToJwk(signPair.privateKey);
      const newSignPubJwk = await exportKeyToJwk(signPair.publicKey);

      const signature = await signKeyRotation(
        newPublicKey, newSignPub, oldPublicKey,
        currentUserKeys.privateSigningKeyJwk as JsonWebKey
      );
      const vault = await encryptKeyVaultPair(newPrivJwk, newSignPrivJwk, password);

      const token = localStorage.getItem('vaultchat_jwt');
      const res = await fetch(`${API_BASE}/api/auth/rotate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          publicKey: newPublicKey,
          signingPublicKey: newSignPub,
          encryptedPrivateKey: vault.encryptedPrivateKey,
          keySalt: vault.keySalt,
          signature,
          oldPublicKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Key rotation failed');

      const keyPair: UserKeyPair = {
        ...currentUserKeys,
        publicKeyBase64: newPublicKey,
        privateKeyJwk: newPrivJwk,
        publicKeyJwk: newPubJwk,
        signingPublicKeyBase64: newSignPub,
        privateSigningKeyJwk: newSignPrivJwk,
        publicSigningKeyJwk: newSignPubJwk,
      };
      await saveUserKeyPair(keyPair);
      const privKey = await importPrivateKeyFromJwk(newPrivJwk);
      setCurrentUserKeys(keyPair);
      setPrivateKeyObject(privKey);
      const fp = await getFingerprint(newPublicKey);
      setUserFingerprint(fp);
      if (socket.connected) {
        socket.emit('user:join', {
          userId: keyPair.userId, username: keyPair.username,
          fullName: keyPair.fullName, role: keyPair.role,
          publicKey: newPublicKey, signingPublicKey: newSignPub,
        });
      }
      console.log(`[KeyRotation] Rotated identity key → ${fp} (server v${data.keyVersion})`);
      alert(`🔑 Identity key rotated successfully. New fingerprint: ${fp}`);
    } catch (e: any) {
      console.error('[KeyRotation] Failed:', e?.message || 'unknown');
      alert(`Key rotation failed: ${e?.message || 'unknown error'}`);
    }
  }, [currentUserKeys, privateKeyObject]);

  // ── Profile Update ────────────────────────────────────────────────────────────
  const handleUpdateProfile = useCallback(async (data: { fullName?: string; email?: string; avatar?: string; username?: string; statusMessage?: string }) => {
    if (!currentUserKeys) return;
    const token = localStorage.getItem('vaultchat_jwt');
    try {
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Profile update failed');
      setCurrentUserKeys(prev => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (data.fullName) updated.fullName = data.fullName;
        if (data.email) updated.email = data.email;
        if (data.avatar) updated.avatarUrl = data.avatar;
        if (data.statusMessage !== undefined) updated.statusMessage = data.statusMessage;
        return updated;
      });
      if (data.fullName && socket.connected) {
        socket.emit('user:join', {
          userId: currentUserKeys.userId, username: currentUserKeys.username,
          fullName: data.fullName, role: currentUserKeys.role,
          publicKey: currentUserKeys.publicKeyBase64,
          signingPublicKey: currentUserKeys.signingPublicKeyBase64,
        });
      }
      return result;
    } catch (e: any) {
      console.error('[Profile] Update failed:', e);
      throw e;
    }
  }, [currentUserKeys]);

  // ── Fetch User Directory ──────────────────────────────────────────────────────
  const fetchUserDirectory = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setAllUsers(data.users || []);
      const onlineSet = new Set<string>((data.users || []).filter((u: User) => u.isOnline).map((u: User) => u.userId));
      setOnlineIds(onlineSet);
    } catch (e) {
      console.error('[Directory] Failed to fetch user directory:', e);
    }
  }, []);

  // ── Session Rehydration on Page Refresh ──────────────────────────────────────
  useEffect(() => {
    const rehydrate = async () => {
      const token = localStorage.getItem('vaultchat_jwt');
      if (!token) { setIsRehydrating(false); return; }
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.user) {
          let keyPair = await getUserKeyPair(data.user.userId) || await getAnyUserKeyPair();
          if (keyPair) {
            const privKey = await importPrivateKeyFromJwk(keyPair.privateKeyJwk);
            const fp = await getFingerprint(keyPair.publicKeyBase64);
            // Merge server-side profile data (avatar, fullName, email, status) into the keypair
            const enrichedKeyPair: UserKeyPair = {
              ...keyPair,
              fullName: data.user.fullName || keyPair.fullName,
              email: data.user.email || keyPair.email,
              avatarUrl: data.user.avatarUrl || keyPair.avatarUrl,
              statusMessage: data.user.statusMessage || keyPair.statusMessage,
            };
            setPrivateKeyObject(privKey);
            setCurrentUserKeys(enrichedKeyPair);
            setUserFingerprint(fp);
            setShowProfileDrawer(false);
            if (!socket.connected) connectSocket();
            socket.emit('user:join', {
              userId: enrichedKeyPair.userId, username: enrichedKeyPair.username,
              fullName: enrichedKeyPair.fullName, role: enrichedKeyPair.role,
              publicKey: enrichedKeyPair.publicKeyBase64,
              signingPublicKey: enrichedKeyPair.signingPublicKeyBase64
            });
            await fetchUserDirectory(token);
            socket.emit('channels:get');
            console.log(`[Rehydration] Session restored for ${enrichedKeyPair.username}`);
          }
        } else {
          localStorage.removeItem('vaultchat_jwt');
        }
      } catch (e) {
        console.error('[Rehydration] Error:', e);
      } finally {
        setIsRehydrating(false);
      }
    };
    rehydrate();
  }, [fetchUserDirectory]);

  // Restore full chat history from PostgreSQL once the session is established.
  // Runs after login AND after a server restart + browser refresh.
  useEffect(() => {
    if (!currentUserKeys) return;
    const token = localStorage.getItem('vaultchat_jwt');
    if (token) fetchAllHistory(token);
  }, [currentUserKeys, fetchAllHistory]);

  // ── Authentication ────────────────────────────────────────────────────────────
  const handleAuthenticate = async (params: {
    username: string; fullName?: string; email?: string;
    password: string; role: UserRole; isRegister: boolean;
  }) => {
    setAuthError(null);
    const { username, fullName, email, password, role, isRegister } = params;
    const userId = `usr_${username.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    let keyPair = await getUserKeyPair(userId);
    let privKey: CryptoKey;
    let pubKeyBase64: string;

    if (isRegister) {
      const rawPair = await generateKeyPair();
      pubKeyBase64 = await exportPublicKey(rawPair.publicKey);
      const privJwk = await exportKeyToJwk(rawPair.privateKey);
      const pubJwk  = await exportKeyToJwk(rawPair.publicKey);
      const signPair = await generateSigningKeyPair();
      const signPub = await exportPublicKey(signPair.publicKey);
      const signPrivJwk = await exportKeyToJwk(signPair.privateKey);
      const signPubJwk = await exportKeyToJwk(signPair.publicKey);
      const vault = await encryptKeyVaultPair(privJwk, signPrivJwk, password);

      keyPair = {
        userId, username: username.trim(),
        fullName: fullName || username.trim(),
        email: email || `${username.toLowerCase()}@vaultchat.internal`,
        role, publicKeyBase64: pubKeyBase64,
        privateKeyJwk: privJwk, publicKeyJwk: pubJwk,
        signingPublicKeyBase64: signPub,
        privateSigningKeyJwk: signPrivJwk,
        publicSigningKeyJwk: signPubJwk,
        createdAt: Date.now()
      };
      await saveUserKeyPair(keyPair);
      privKey = rawPair.privateKey;

      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username, fullName, email, password, role,
          publicKey: pubKeyBase64,
          signingPublicKey: signPub,
          encryptedPrivateKey: vault.encryptedPrivateKey,
          keySalt: vault.keySalt
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      localStorage.setItem('vaultchat_jwt', data.token);
      const fp = await getFingerprint(pubKeyBase64);
      setPrivateKeyObject(privKey);
      const registeredKeyPair: UserKeyPair = {
        ...keyPair,
        fullName: data.user.fullName || keyPair.fullName,
        email: data.user.email || keyPair.email,
        avatarUrl: data.user.avatarUrl || keyPair.avatarUrl,
        statusMessage: data.user.statusMessage || keyPair.statusMessage,
      };
      await saveUserKeyPair(registeredKeyPair);
      setCurrentUserKeys(registeredKeyPair);
      setUserFingerprint(fp);
      setShowProfileDrawer(false);

      if (!socket.connected) connectSocket();
      socket.emit('user:join', { userId: registeredKeyPair.userId, username: registeredKeyPair.username, fullName: data.user.fullName, role: registeredKeyPair.role, publicKey: pubKeyBase64, signingPublicKey: registeredKeyPair.signingPublicKeyBase64 });
      await fetchUserDirectory(data.token);
      socket.emit('channels:get');
    } else {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      const serverUser = data.user;

      // Ensure the local keypair always carries a signing key. If a legacy
      // pair (pre-signing-keys) or the vault predates them, generate one,
      // re-wrap the vault and sync it so future rotations are possible.
      const ensureSigningKeys = async (kp: UserKeyPair): Promise<UserKeyPair> => {
        if (kp.signingPublicKeyBase64 && kp.privateSigningKeyJwk && kp.publicSigningKeyJwk) return kp;
        const signPair = await generateSigningKeyPair();
        const signPub = await exportPublicKey(signPair.publicKey);
        const signPrivJwk = await exportKeyToJwk(signPair.privateKey);
        const signPubJwk = await exportKeyToJwk(signPair.publicKey);
        const vault = await encryptKeyVaultPair(kp.privateKeyJwk, signPrivJwk, password);
        const updated: UserKeyPair = {
          ...kp,
          signingPublicKeyBase64: signPub,
          privateSigningKeyJwk: signPrivJwk,
          publicSigningKeyJwk: signPubJwk,
        };
        await saveUserKeyPair(updated);
        await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username, password,
            publicKey: kp.publicKeyBase64,
            signingPublicKey: signPub,
            encryptedPrivateKey: vault.encryptedPrivateKey,
            keySalt: vault.keySalt,
            forceKeyRotation: true
          })
        });
        return updated;
      };

      if (keyPair && keyPair.publicKeyBase64 === serverUser.publicKey) {
        keyPair = await ensureSigningKeys(keyPair);
        privKey = await importPrivateKeyFromJwk(keyPair.privateKeyJwk);
        pubKeyBase64 = keyPair.publicKeyBase64;
      } else if (serverUser.encryptedPrivateKey && serverUser.keySalt) {
        try {
          const decrypted = await decryptPrivateKeyVault(
            serverUser.encryptedPrivateKey,
            serverUser.keySalt,
            password
          );
          const { ecdh, ecdsa } = unwrapKeyVault(decrypted);
          privKey = await importPrivateKeyFromJwk(ecdh);
          pubKeyBase64 = serverUser.publicKey;

          keyPair = {
            userId, username: serverUser.username,
            fullName: serverUser.fullName, email: serverUser.email,
            role: serverUser.role, publicKeyBase64: pubKeyBase64,
            privateKeyJwk: ecdh, publicKeyJwk: {} as JsonWebKey,
            signingPublicKeyBase64: serverUser.signingPublicKey,
            createdAt: Date.now()
          };
          if (ecdsa) {
            keyPair.privateSigningKeyJwk = ecdsa;
          }
          keyPair = await ensureSigningKeys(keyPair);
          await saveUserKeyPair(keyPair);
          console.log(`[KeyVault] Successfully synchronized key pair from vault!`);
        } catch (e) {
          console.error('[KeyVault] Failed to decrypt private key vault');
          throw new Error('Key Vault decryption failed. Check password.');
        }
      } else {
        const rawPair = await generateKeyPair();
        pubKeyBase64 = await exportPublicKey(rawPair.publicKey);
        const privJwk = await exportKeyToJwk(rawPair.privateKey);
        const pubJwk  = await exportKeyToJwk(rawPair.publicKey);
        const signPair = await generateSigningKeyPair();
        const signPub = await exportPublicKey(signPair.publicKey);
        const signPrivJwk = await exportKeyToJwk(signPair.privateKey);
        const signPubJwk = await exportKeyToJwk(signPair.publicKey);
        const vault = await encryptKeyVaultPair(privJwk, signPrivJwk, password);

        keyPair = {
          userId, username: username.trim(),
          fullName: serverUser.fullName || username.trim(),
          email: serverUser.email || `${username.toLowerCase()}@vaultchat.internal`,
          role: serverUser.role || role,
          publicKeyBase64: pubKeyBase64,
          privateKeyJwk: privJwk, publicKeyJwk: pubJwk,
          signingPublicKeyBase64: signPub,
          privateSigningKeyJwk: signPrivJwk,
          publicSigningKeyJwk: signPubJwk,
          createdAt: Date.now()
        };
        await saveUserKeyPair(keyPair);
        privKey = rawPair.privateKey;

        await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username, password,
            publicKey: pubKeyBase64,
            signingPublicKey: signPub,
            encryptedPrivateKey: vault.encryptedPrivateKey,
            keySalt: vault.keySalt,
            forceKeyRotation: true
          })
        });
      }

      localStorage.setItem('vaultchat_jwt', data.token);
      const fp = await getFingerprint(pubKeyBase64);
      setPrivateKeyObject(privKey);
      const enrichedKeyPair: UserKeyPair = {
        ...keyPair,
        fullName: serverUser.fullName || keyPair.fullName,
        email: serverUser.email || keyPair.email,
        avatarUrl: serverUser.avatarUrl || keyPair.avatarUrl,
        statusMessage: serverUser.statusMessage || keyPair.statusMessage,
      };
      await saveUserKeyPair(enrichedKeyPair);
      setCurrentUserKeys(enrichedKeyPair);
      setUserFingerprint(fp);
      setShowProfileDrawer(false);

      if (!socket.connected) connectSocket();
      socket.emit('user:join', { userId: enrichedKeyPair.userId, username: enrichedKeyPair.username, fullName: serverUser.fullName || enrichedKeyPair.fullName, role: enrichedKeyPair.role, publicKey: pubKeyBase64, signingPublicKey: enrichedKeyPair.signingPublicKeyBase64 });

      await fetchUserDirectory(data.token);
      socket.emit('channels:get');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('vaultchat_jwt');
    setCurrentUserKeys(null);
    setPrivateKeyObject(null);
    setSelectedPeer(null);
    setSelectedChannel(null);
    setAllUsers([]);
    setOnlineIds(new Set());
    setShowAdmin(false);
    setAvatarMenu(null);
    if (socket.connected) socket.disconnect();
    // Clear IndexedDB to prevent stale data across users
    db.delete().catch(() => {});
  };

  // ── Admin RBAC Handlers ──────────────────────────────────────────────────────
  const fetchAdminUsers = useCallback(async (): Promise<AdminUser[]> => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (!token) return [];
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 403) alert('Admin access required.');
        return [];
      }
      const data = await res.json();
      return (data.users || []) as AdminUser[];
    } catch (e) {
      console.error('[Admin] Fetch error:', e);
      return [];
    }
  }, []);

  const handleAdminSetRole = useCallback(async (userId: string, role: UserRole) => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Role change failed');
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Admin] Role change error:', e);
      return false;
    }
  }, []);

  const handleAdminDeleteUser = useCallback(async (userId: string): Promise<boolean> => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'User deletion failed');
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Admin] Delete error:', e);
      return false;
    }
  }, []);

  // ── Socket Event Listeners ────────────────────────────────────────────────────
  useEffect(() => {
    const onUsersDirectory = (usersList: User[]) => {
      setAllUsers(usersList);
      const online = new Set(usersList.filter(u => u.isOnline).map(u => u.userId));
      setOnlineIds(online);
    };

    const onUsersPresence = (presence: { userId: string; isOnline: boolean }[]) => {
      const online = new Set(presence.filter(p => p.isOnline).map(p => p.userId));
      setOnlineIds(online);
    };

    const onChannelsUpdate = async (channelsList: Channel[]) => {
      setChannels(channelsList);
      for (const c of channelsList) await saveChannel(c);
    };

    const onMessageReceive = async (payload: EncryptedPayload) => {
      if (!currentUserKeys || !privateKeyObject) return;
      const localMsg = await decryptPayload(payload);
      if (!localMsg) return;
      await saveMessage(localMsg);

      // Instant DM list update — move sender to top of sidebar
      const senderUser = allUsersRef.current.find(u => u.userId === payload.senderId);
      if (senderUser) {
        upsertDMConversation(senderUser, localMsg.text || 'Attachment');
      }

      // 1. Emit delivery receipt back to server
      socket.emit('message:delivered', { messageId: payload.id, senderId: payload.senderId });

      // Play notification sound if not the active conversation
      if (selectedPeerRef.current?.userId !== payload.senderId) {
        playNotificationSound();
      }

      // 2. If recipient ALREADY has this conversation thread open, emit read receipt immediately!
      if (selectedPeerRef.current?.userId === payload.senderId) {
        socket.emit('message:read', { conversationId: currentUserKeys.userId, senderId: payload.senderId, lastReadMessageId: payload.id });
      }
    };

    const onChannelMessageReceive = async (payload: EncryptedPayload) => {
      if (!payload.channelId) return;
      const localMsg = await decryptPayload(payload);
      if (!localMsg) return;
      await saveMessage(localMsg);

      // Play notification sound if not the active channel
      if (selectedChannelRef.current?.id !== payload.channelId) {
        playNotificationSound();
      }

      // If recipient ALREADY has this channel open, emit read receipt immediately
      if (selectedChannelRef.current?.id === payload.channelId) {
        socket.emit('message:read', { conversationId: payload.channelId, senderId: payload.senderId, lastReadMessageId: payload.id });
      }
    };

    const onMessageAck = async ({ tempId, serverId, status }: { tempId: string; serverId: string; status: LocalMessage['status'] }) => {
      await updateMessageStatus(tempId, status, serverId);
    };

    const onMessageDeliveredAck = async ({ id }: { id: string }) => {
      await updateMessageStatus(id, 'delivered');
    };

    const onMessageReadAck = async ({ conversationId }: { conversationId: string }) => {
      // Sender's copy: upgrade messages sent to conversationId to 'read' status
      const allMsgs = await db.messages.toArray();
      const unreadSent = allMsgs.filter(m => m.recipientId === conversationId && m.senderId === currentUserKeys?.userId && m.status !== 'read');
      for (const m of unreadSent) {
        await updateMessageStatus(m.id, 'read');
      }
    };

    const onMessageEdited = async ({ id, newCiphertext, newIv }: { id: string; newCiphertext: string; newIv: string }) => {
      let decryptedText = '🔒 Unable to decrypt edited message';
      // Check if this is a channel message
      const existing = await db.messages.get(id);
      if (existing?.channelId) {
        const channelKey = await getOrGenerateChannelKey(existing.channelId);
        if (channelKey) { try { decryptedText = await decryptMessage(newCiphertext, newIv, channelKey); } catch {} }
      } else {
        const peer = selectedPeerRef.current;
        if (peer?.publicKey) {
          const sharedKey = await getOrDeriveSharedKey(peer.userId, peer.publicKey);
          if (sharedKey) { try { decryptedText = await decryptMessage(newCiphertext, newIv, sharedKey); } catch {} }
        }
      }
      await editMessageLocally(id, decryptedText, newCiphertext, newIv);
    };

    const onMessageDeleted = async ({ id }: { id: string }) => {
      await markMessageDeletedLocally(id);
    };

    // Reactive roster: a new user just registered — refresh the directory.
    const onUserRegistered = async () => {
      const token = localStorage.getItem('vaultchat_jwt');
      if (token) await fetchUserDirectory(token);
    };

    // Reactive roster: a user just came online — add their full data to allUsers
    // so E2EE decryption works for messages and attachments
    const onUserOnline = (user: User) => {
      setAllUsers(prev => {
        const existing = prev.find(u => u.userId === user.userId);
        if (existing) {
          // Update existing user with fresh data (public key may have changed)
          return prev.map(u => u.userId === user.userId ? { ...u, ...user, isOnline: true } : u);
        }
        // New user — add them
        return [...prev, { ...user, isOnline: true }];
      });
      setOnlineIds(prev => new Set([...prev, user.userId]));
    };

    // Reactive roster: presence changed — update online set instantly.
    const onUserStatusChange = (data: { userId: string; isOnline: boolean }) => {
      setOnlineIds(prev => {
        const next = new Set(prev);
        if (data.isOnline) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
      // If a user came online but we don't have their full data, fetch the directory
      if (data.isOnline && !allUsersRef.current.find(u => u.userId === data.userId)) {
        const token = localStorage.getItem('vaultchat_jwt');
        if (token) fetchUserDirectory(token);
      }
    };

    // Peer rotated their identity key — re-validate the signed chain locally.
    const onUserKeyRotated = async (data: { userId: string; publicKey: string; signingPublicKey: string; keyVersion: number; keyRotationSignature: string; oldPublicKey: string; oldSigningPublicKey?: string }) => {
      setAllUsers(prev => prev.map(u => u.userId === data.userId ? {
        ...u,
        publicKey: data.publicKey,
        signingPublicKey: data.signingPublicKey,
        keyVersion: data.keyVersion,
        keyRotationSignature: data.keyRotationSignature,
        oldPublicKey: data.oldPublicKey,
        oldSigningPublicKey: data.oldSigningPublicKey,
      } : u));
      if (selectedPeerRef.current?.userId === data.userId) {
        await validatePeerKeyTofu({ ...selectedPeerRef.current, ...data });
      }
    };

    const onUserRemoved = (data: { userId: string }) => {
      // Keep the user in allUsers but mark as deleted so their public key
      // is still available for decrypting cached messages
      setAllUsers(prev => prev.map(u => u.userId === data.userId ? { ...u, isOnline: false, statusMessage: '[deleted]' } : u));
    };

    const onUserRoleChange = async (data: { userId: string; role: UserRole }) => {
      setAllUsers(prev => prev.map(u => u.userId === data.userId ? { ...u, role: data.role } : u));
      if (currentUserKeys?.userId === data.userId) {
        const updated: UserKeyPair = { ...currentUserKeys, role: data.role };
        await saveUserKeyPair(updated);
        setCurrentUserKeys(updated);
      }
    };

    const onUserProfileUpdate = (data: { userId: string; fullName?: string; avatarUrl?: string; statusMessage?: string }) => {
      setAllUsers(prev => prev.map(u => u.userId === data.userId ? {
        ...u,
        fullName: data.fullName ?? u.fullName,
        avatarUrl: data.avatarUrl ?? u.avatarUrl,
        statusMessage: data.statusMessage !== undefined ? data.statusMessage : u.statusMessage,
      } : u));
      if (currentUserKeys?.userId === data.userId) {
        setCurrentUserKeys(prev => prev ? {
          ...prev,
          fullName: data.fullName ?? prev.fullName,
          avatarUrl: data.avatarUrl ?? prev.avatarUrl,
          statusMessage: data.statusMessage !== undefined ? data.statusMessage : prev.statusMessage,
        } : prev);
      }
    };

    const onChannelMemberAdded = (data: { channelId: string; userId: string }) => {
      // If the added member is the current user, refresh channels to show the new channel
      if (data.userId === currentUserKeys?.userId) {
        socket.emit('channels:get');
      }
      // Also update the channel in the local state
      setChannels(prev => prev.map(c => 
        c.id === data.channelId ? { ...c, memberIds: [...new Set([...(c.memberIds || []), data.userId])] } : c
      ));
    };

    const onChannelMemberRemoved = (data: { channelId: string; userId: string }) => {
      // If the removed member is the current user, refresh channels to remove the channel
      if (data.userId === currentUserKeys?.userId) {
        socket.emit('channels:get');
        // If the removed channel was selected, close it
        if (selectedChannel?.id === data.channelId) {
          setSelectedChannel(null);
        }
      }
      // Update the channel in the local state
      setChannels(prev => prev.map(c => 
        c.id === data.channelId ? { ...c, memberIds: (c.memberIds || []).filter(id => id !== data.userId) } : c
      ));
    };

    socket.on('users:directory', onUsersDirectory);
    socket.on('users:presence',  onUsersPresence);
    socket.on('channels:update', onChannelsUpdate);
    socket.on('message:receive', onMessageReceive);
    socket.on('channel:message:receive', onChannelMessageReceive);
    socket.on('message:ack',     onMessageAck);
    socket.on('message:delivered_ack', onMessageDeliveredAck);
    socket.on('message:read_ack', onMessageReadAck);
    socket.on('message:edited', onMessageEdited);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('user:registered', onUserRegistered);
    socket.on('user:online', onUserOnline);
    socket.on('user:status_change', onUserStatusChange);
    socket.on('user:key_rotated', onUserKeyRotated);
    socket.on('user:removed', onUserRemoved);
    socket.on('user:role_change', onUserRoleChange);
    socket.on('user:profile-update', onUserProfileUpdate);
    socket.on('channel:member_added', onChannelMemberAdded);
    socket.on('channel:member_removed', onChannelMemberRemoved);

    // Typing indicators
    const onUserTyping = (data: { userId: string; username: string; channelId?: string; recipientId?: string }) => {
      const conversationId = data.channelId || data.recipientId;
      if (!conversationId) return;
      if (data.userId === currentUserKeys?.userId) return;
      setTypingUsers(prev => {
        const existing = prev[conversationId] || [];
        if (existing.includes(data.username)) return prev;
        return { ...prev, [conversationId]: [...existing, data.username] };
      });
      // Auto-clear after 3 seconds
      setTimeout(() => {
        setTypingUsers(prev => {
          const existing = prev[conversationId] || [];
          const updated = existing.filter(u => u !== data.username);
          if (updated.length === 0) {
            const next = { ...prev };
            delete next[conversationId];
            return next;
          }
          return { ...prev, [conversationId]: updated };
        });
      }, 3000);
    };

    const onUserStopTyping = (data: { userId: string; channelId?: string; recipientId?: string }) => {
      const conversationId = data.channelId || data.recipientId;
      if (!conversationId) return;
      setTypingUsers(prev => {
        const existing = prev[conversationId] || [];
        const user = allUsers.find(u => u.userId === data.userId);
        const updated = existing.filter(u => u !== (user?.fullName || user?.username));
        if (updated.length === 0) {
          const next = { ...prev };
          delete next[conversationId];
          return next;
        }
        return { ...prev, [conversationId]: updated };
      });
    };

    socket.on('user:typing', onUserTyping);
    socket.on('user:stop_typing', onUserStopTyping);

    // Pinned messages
    const onChannelPinned = (data: { channelId: string; pinned: { messageId: string; pinnedBy: string; pinnedAt: number }[] }) => {
      setPinnedMessages(prev => ({ ...prev, [data.channelId]: data.pinned }));
    };
    socket.on('channel:pinned', onChannelPinned);

    return () => {
      socket.off('users:directory', onUsersDirectory);
      socket.off('users:presence',  onUsersPresence);
      socket.off('channels:update', onChannelsUpdate);
      socket.off('message:receive', onMessageReceive);
      socket.off('channel:message:receive', onChannelMessageReceive);
      socket.off('message:ack',     onMessageAck);
      socket.off('message:delivered_ack', onMessageDeliveredAck);
      socket.off('message:read_ack', onMessageReadAck);
      socket.off('message:edited', onMessageEdited);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('user:registered', onUserRegistered);
      socket.off('user:online', onUserOnline);
      socket.off('user:status_change', onUserStatusChange);
      socket.off('user:key_rotated', onUserKeyRotated);
      socket.off('user:removed', onUserRemoved);
      socket.off('user:role_change', onUserRoleChange);
      socket.off('user:profile-update', onUserProfileUpdate);
      socket.off('channel:member_added', onChannelMemberAdded);
      socket.off('channel:member_removed', onChannelMemberRemoved);
      socket.off('user:typing', onUserTyping);
      socket.off('user:stop_typing', onUserStopTyping);
      socket.off('channel:pinned', onChannelPinned);
    };
  }, [currentUserKeys, privateKeyObject, getOrDeriveSharedKey, getOrGenerateChannelKey, decryptPayload, fetchUserDirectory, validatePeerKeyTofu]);

  // ── Ctrl+K Search Shortcut ──────────────────────────────────────────────────
  useEffect(() => {
    const handleSearchShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  // ── Compute unread DMs & Channels ───────────────────────────────────────────
  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('vaultchat_lastViewedDms', JSON.stringify(lastViewedDms));
  }, [lastViewedDms]);

  useEffect(() => {
    localStorage.setItem('vaultchat_lastViewedChannels', JSON.stringify(lastViewedChannels));
  }, [lastViewedChannels]);

  useEffect(() => {
    if (!currentUserKeys) return;
    const myId = currentUserKeys.userId;
    const computeUnread = async () => {
      const allMsgs = await db.messages.toArray();
      const dmCounts: Record<string, number> = {};
      const channelCounts: Record<string, number> = {};
      for (const msg of allMsgs) {
        if (msg.senderId === myId) continue;
        if (msg.channelId) {
          const lastViewed = lastViewedChannelsRef.current[msg.channelId] || 0;
          if (msg.timestamp > lastViewed) {
            channelCounts[msg.channelId] = (channelCounts[msg.channelId] || 0) + 1;
          }
        } else {
          if (msg.recipientId !== myId) continue;
          const partnerId = msg.senderId;
          const lastViewed = lastViewedDmsRef.current[partnerId] || 0;
          if (msg.timestamp > lastViewed) {
            dmCounts[partnerId] = (dmCounts[partnerId] || 0) + 1;
          }
        }
      }
      setUnreadDMs(dmCounts);
      setUnreadChannels(channelCounts);
    };
    computeUnread();
    const interval = setInterval(computeUnread, 5000);
    return () => clearInterval(interval);
  }, [currentUserKeys]);

  // ── Offline Queue Auto-Flush ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUserKeys || !networkStatus.isSocketConnected || isFlushing.current) return;
    isFlushing.current = true;
    processOfflineQueue({
      senderId: currentUserKeys.userId,
      socket,
      token: localStorage.getItem('vaultchat_jwt') || '',
      sharedKeysCache, privateKey: privateKeyObject,
      activeUsers: allUsers,
      onMessageFlushed: () => {},
      onQueueEmpty: () => { isFlushing.current = false; }
    });
  }, [networkStatus.isSocketConnected]);

  // Load stored channels on mount
  useEffect(() => {
    getStoredChannels().then(setChannels);
  }, []);

  // ── Selection Handlers ────────────────────────────────────────────────────────

  const handleSelectPeer = async (user: User) => {
    setSelectedChannel(null);
    setSelectedPeer(user);
    if (!currentUserKeys) return;

    // Mark DM as viewed
    setLastViewedDms(prev => ({ ...prev, [user.userId]: Date.now() }));

    // Emit read receipt for this DM thread
    socket.emit('message:read', { conversationId: currentUserKeys.userId, senderId: user.userId });

    await validatePeerKeyTofu(user);
    const fp = await getFingerprint(user.publicKey);
    setPeerFingerprint(fp);

    const token = localStorage.getItem('vaultchat_jwt');
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/api/messages/direct/${user.userId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const serverMsgs: EncryptedPayload[] = data.messages || [];
          for (const payload of serverMsgs) {
            const local = await decryptPayload(payload);
            if (local) await saveMessage(local);
          }
        }
      } catch (e) {
        console.error('[History] Failed to fetch DM history:', e);
      }
    }
  };

  const handleSelectChannel = async (channel: Channel) => {
    setSelectedPeer(null);
    setSelectedChannel(channel);
    setLastViewedChannels(prev => ({ ...prev, [channel.id]: Date.now() }));
    await getOrGenerateChannelKey(channel.id);

    // Emit read receipt for this channel
    if (currentUserKeys) {
      socket.emit('message:read', { conversationId: channel.id, senderId: currentUserKeys.userId });
    }
  };

  const handleCloseChat = () => {
    setSelectedPeer(null);
    setSelectedChannel(null);
  };

  const handleUserAvatarClick = useCallback((user: User, rect: DOMRect) => {
    setAvatarMenu({ user, rect });
  }, []);

  const handleUserPictureClick = useCallback((user: User) => {
    setAvatarMenu(null);
    setShowProfileDrawer(true);
  }, []);

  const handleAvatarMessage = useCallback(() => {
    if (avatarMenu?.user) {
      handleSelectPeer(avatarMenu.user);
      setMobileSidebarOpen(false);
      setAvatarMenu(null);
    }
  }, [avatarMenu, handleSelectPeer]);

  const handleAvatarViewPicture = useCallback(() => {
    if (avatarMenu?.user) {
      setShowProfileDrawer(true);
      setAvatarMenu(null);
    }
  }, [avatarMenu]);

  const handleAvatarViewProfile = useCallback(() => {
    if (avatarMenu?.user) {
      setShowProfileDrawer(true);
      setAvatarMenu(null);
    }
  }, [avatarMenu]);

  const handleAvatarCopyId = useCallback(() => {
    if (avatarMenu?.user) {
      navigator.clipboard.writeText(avatarMenu.user.userId);
      setAvatarMenu(null);
    }
  }, [avatarMenu]);

  const handleAvatarShowFingerprint = useCallback(() => {
    if (avatarMenu?.user) {
      setShowFingerprintModal(true);
      setAvatarMenu(null);
    }
  }, [avatarMenu]);

  const handleCreateChannel = async (channelData: { name: string; description: string; type: 'official' | 'team' | 'public' | 'private'; isAnnouncement?: boolean; memberIds?: string[] }) => {
    if (!currentUserKeys) return;
    const channelId = channelData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // 1. Generate AES channel key
    const channelKeyObj = await generateChannelSymmetricKey();
    const channelKeyJwk = await exportKeyToJwk(channelKeyObj);
    await saveChannelKey({ channelId, keyJwk: channelKeyJwk });
    setChannelKeysCache(prev => new Map(prev).set(channelId, channelKeyObj));

    // 2. Encrypt channel key for selected members (or all for official channels)
    const token = localStorage.getItem('vaultchat_jwt');
    const keyEnvelopes: { userId: string; encryptedChannelKey: string; iv: string }[] = [];
    
    // Determine which members to encrypt for
    const membersToEncryptFor = channelData.memberIds && channelData.memberIds.length > 0
      ? allUsers.filter(u => channelData.memberIds!.includes(u.userId))
      : allUsers;

    for (const member of membersToEncryptFor) {
      if (member.publicKey) {
        const sharedKey = await getOrDeriveSharedKey(member.userId, member.publicKey);
        if (sharedKey) {
          const env = await encryptChannelKeyForUser(channelKeyJwk, sharedKey);
          keyEnvelopes.push({
            userId: member.userId,
            encryptedChannelKey: env.encryptedKey,
            iv: env.iv
          });
        }
      }
    }

    // Include self envelope
    const selfSharedKey = await getOrDeriveSharedKey(currentUserKeys.userId, currentUserKeys.publicKeyBase64);
    if (selfSharedKey) {
      const env = await encryptChannelKeyForUser(channelKeyJwk, selfSharedKey);
      keyEnvelopes.push({
        userId: currentUserKeys.userId,
        encryptedChannelKey: env.encryptedKey,
        iv: env.iv
      });
    }

    // 3. Post channel key envelopes to server
    if (token && keyEnvelopes.length > 0) {
      await fetch(`${API_BASE}/api/channels/${channelId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keys: keyEnvelopes })
      });
    }

    // 4. Emit channel creation event
    socket.emit('channel:create', { ...channelData, createdBy: currentUserKeys.userId });
  };

  const handleUpdateChannel = async (id: string, data: Partial<Pick<Channel, 'name' | 'description' | 'memberIds' | 'isAnnouncement' | 'allowedRoles'>>) => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/channels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to update channel');
        return;
      }
      const result = await res.json().catch(() => ({}));
      // Update the local Dexie channel immediately
      if (result.channel) {
        await saveChannel(result.channel);
        // Also update selectedChannel if it's the one being edited
        if (selectedChannel?.id === id) {
          setSelectedChannel(result.channel);
        }
      }
      // Also trigger full refresh via socket
      socket.emit('channels:get');
    } catch (e) {
      console.error('[Channel] Update error:', e);
      alert('Failed to update channel');
    }
  };

  const handleDeleteChannel = async (id: string) => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/channels/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to delete channel');
        return;
      }
      socket.emit('channels:get');
      setChannelSettings(null);
    } catch (e) {
      console.error('[Channel] Delete error:', e);
      alert('Failed to delete channel');
    }
  };

  // ── Pinning ─────────────────────────────────────────────────────────────────
  const handlePinMessage = useCallback((messageId: string) => {
    if (!currentUserKeys || !selectedChannel) return;
    socket.emit('message:pin', { channelId: selectedChannel.id, messageId, userId: currentUserKeys.userId });
  }, [currentUserKeys, selectedChannel]);

  const handleUnpinMessage = useCallback((messageId: string) => {
    if (!selectedChannel) return;
    socket.emit('message:unpin', { channelId: selectedChannel.id, messageId });
  }, [selectedChannel]);

  // ── Typing Indicators ──────────────────────────────────────────────────────
  const lastViewedDmsRef = useRef(lastViewedDms);
  useEffect(() => { lastViewedDmsRef.current = lastViewedDms; }, [lastViewedDms]);

  const lastViewedChannelsRef = useRef(lastViewedChannels);
  useEffect(() => { lastViewedChannelsRef.current = lastViewedChannels; }, [lastViewedChannels]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const handleTypingStart = useCallback(() => {
    if (isTypingRef.current) return;
    isTypingRef.current = true;
    const payload: any = { userId: currentUserKeys?.userId, username: currentUserKeys?.username };
    if (selectedChannel) payload.channelId = selectedChannel.id;
    else if (selectedPeer) payload.recipientId = selectedPeer.userId;
    else return;
    socket.emit('user:typing', payload);
  }, [currentUserKeys, selectedChannel, selectedPeer]);

  const handleTypingStop = useCallback(() => {
    if (!isTypingRef.current) return;
    isTypingRef.current = false;
    const payload: any = { userId: currentUserKeys?.userId };
    if (selectedChannel) payload.channelId = selectedChannel.id;
    else if (selectedPeer) payload.recipientId = selectedPeer.userId;
    else return;
    socket.emit('user:stop_typing', payload);
  }, [currentUserKeys, selectedChannel, selectedPeer]);

  const handleTyping = useCallback(() => {
    handleTypingStart();
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(handleTypingStop, 3000);
  }, [handleTypingStart, handleTypingStop]);

  // ── Send Message ─────────────────────────────────────────────────────────────
  const handleSendMessage = async (text: string, replyTo?: string) => {
    if (!currentUserKeys || (!selectedPeer && !selectedChannel) || !privateKeyObject) return;
    const tempId = `temp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();
    const status: LocalMessage['status'] = isOffline ? 'pending_sync' : 'sent';

    if (selectedChannel) {
      const channelKey = await getOrGenerateChannelKey(selectedChannel.id);
      if (!channelKey) return;
      const { ciphertext, iv } = await encryptMessage(text, channelKey);
      const localMsg: LocalMessage = { id: tempId, tempId, senderId: currentUserKeys.userId, channelId: selectedChannel.id, text, ciphertext, iv, timestamp, status, isDecrypted: true, replyTo };
      await saveMessage(localMsg);
      if (!isOffline) {
        socket.emit('channel:message:send', { id: tempId, tempId, senderId: currentUserKeys.userId, channelId: selectedChannel.id, ciphertext, iv, timestamp, replyTo });
      }
    } else if (selectedPeer) {
      const isValidKey = await validatePeerKeyTofu(selectedPeer);
      if (!isValidKey) { alert('⚠️ Security Alert: Peer identity key mismatch. Contact admin.'); return; }
      const sharedKey = await getOrDeriveSharedKey(selectedPeer.userId, selectedPeer.publicKey);
      if (!sharedKey) return;
      const { ciphertext, iv } = await encryptMessage(text, sharedKey);
      const localMsg: LocalMessage = { id: tempId, tempId, senderId: currentUserKeys.userId, recipientId: selectedPeer.userId, text, ciphertext, iv, timestamp, status, isDecrypted: true, replyTo };
      await saveMessage(localMsg);
      // Instant DM list update — move peer to top of sidebar
      upsertDMConversation(selectedPeer, text);
      if (!isOffline) {
        socket.emit('message:send', { id: tempId, tempId, senderId: currentUserKeys.userId, recipientId: selectedPeer.userId, ciphertext, iv, timestamp, replyTo });
      }
    }
  };

  // ── Send Encrypted File Attachment ──────────────────────────────────────────
  const handleSendFiles = async (files: File[], text?: string) => {
    if (!currentUserKeys || (!selectedPeer && !selectedChannel) || !privateKeyObject || files.length === 0) return;

    let keyObj: CryptoKey | null = null;
    if (selectedChannel) {
      keyObj = await getOrGenerateChannelKey(selectedChannel.id);
    } else if (selectedPeer) {
      const isValidKey = await validatePeerKeyTofu(selectedPeer);
      if (!isValidKey) { alert('⚠️ Security Alert: Peer identity key mismatch. Contact admin.'); return; }
      keyObj = await getOrDeriveSharedKey(selectedPeer.userId, selectedPeer.publicKey);
    }
    if (!keyObj) return;

    const token = localStorage.getItem('vaultchat_jwt') || '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_ATTACHMENT_BYTES) {
        alert(`File "${file.name}" exceeds the 25 MB limit.`);
        continue;
      }

      let thumbnailDataUrl: string | undefined;
      if (file.type.startsWith('image/')) {
        try { thumbnailDataUrl = await generateImageThumbnail(file); } catch { /* skip */ }
      }

      const buffer = await readFileAsArrayBuffer(file);
      const { ciphertext: encryptedBinary, iv: binaryIv } = await encryptBinaryData(buffer, keyObj);

      const meta: AttachmentMeta = {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        thumbnailDataUrl,
      };
      const { ciphertext: encryptedMetadata, iv: metadataIv } = await encryptMessage(JSON.stringify(meta), keyObj);

      let ciphertext = '';
      let ivStr = '';
      if (i === 0 && text && text.trim()) {
        const enc = await encryptMessage(text, keyObj);
        ciphertext = enc.ciphertext;
        ivStr = enc.iv;
      }

      const tempId = `temp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const timestamp = Date.now();
      const status: LocalMessage['status'] = isOffline ? 'pending_sync' : 'sent';
      const pendingUpload: PendingUpload = { encryptedBinary, binaryIv, encryptedMetadata, metadataIv };
      const attachment: AttachmentPayload = { attachmentId: '', encryptedMetadata, iv: metadataIv, binaryIv };

      const localMsg: LocalMessage = {
        id: tempId, tempId,
        senderId: currentUserKeys.userId,
        recipientId: selectedPeer?.userId,
        channelId: selectedChannel?.id,
        text: i === 0 ? (text || '') : '', ciphertext, iv: ivStr,
        timestamp, status, isDecrypted: true,
        attachment, attachmentMeta: meta,
        pendingUpload,
      };
      await saveMessage(localMsg);

      if (isOffline) {
        console.log('[Attachment] Queued for upload when reconnected.');
        continue;
      }

      try {
        setUploadProgress(0);
        const attachmentId = await uploadEncryptedAttachment(token, pendingUpload, (pct) => setUploadProgress(pct));
        setUploadProgress(null);
        attachment.attachmentId = attachmentId;
        const sentMsg: LocalMessage = { ...localMsg, attachment, pendingUpload: undefined };
        await saveMessage(sentMsg);

        if (selectedChannel) {
          socket.emit('channel:message:send', {
            id: tempId, tempId, senderId: currentUserKeys.userId, channelId: selectedChannel.id,
            ciphertext, iv: ivStr, timestamp, attachment,
          });
        } else if (selectedPeer) {
          socket.emit('message:send', {
            id: tempId, tempId, senderId: currentUserKeys.userId, recipientId: selectedPeer.userId,
            ciphertext, iv: ivStr, timestamp, attachment,
          });
        }
        console.log(`[Attachment] Uploaded ${file.name} (${file.size} bytes) encrypted.`);
      } catch (e) {
        setUploadProgress(null);
        console.error('[Attachment] Upload failed:', e);
        alert('Failed to upload encrypted attachment. It will retry automatically when reconnected.');
      }
    }
  };

  // ── Edit & Delete ─────────────────────────────────────────────────────────────
  const handleEditMessage = async (messageId: string, newText: string) => {
    if (!currentUserKeys) return;
    let keyObj: CryptoKey | null = null;
    if (selectedChannel) keyObj = await getOrGenerateChannelKey(selectedChannel.id);
    else if (selectedPeer)  keyObj = await getOrDeriveSharedKey(selectedPeer.userId, selectedPeer.publicKey);
    if (!keyObj) return;
    const { ciphertext, iv } = await encryptMessage(newText, keyObj);
    await editMessageLocally(messageId, newText, ciphertext, iv);
    socket.emit('message:edit', { id: messageId, newCiphertext: ciphertext, newIv: iv, recipientId: selectedPeer?.userId, channelId: selectedChannel?.id });
  };

  const handleDeleteForMe = async (messageId: string) => {
    await deleteMessageLocally(messageId);
  };

  const handleDeleteForEveryone = async (messageId: string) => {
    await markMessageDeletedLocally(messageId);
    socket.emit('message:delete', { id: messageId, recipientId: selectedPeer?.userId, channelId: selectedChannel?.id });
  };

  const usersWithPresence: User[] = allUsers.map(u => ({ ...u, isOnline: onlineIds.has(u.userId) }));

  if (isRehydrating) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center" style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-muted)' }}>
        <div className="w-12 h-12 rounded-full animate-spin mb-4" style={{ border: '2px solid var(--accent-primary)', borderTopColor: 'transparent' }} />
        <p className="text-xs tracking-widest">REHYDRATING VAULTCHAT SESSION…</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden font-sans select-none">
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
            selectedUser={selectedPeer}
            selectedChannel={selectedChannel}
            activeView={activeView}
            adminTab={adminTab}
            userFingerprint={userFingerprint}
            isAdmin={currentUserKeys.role === 'ADMIN'}
            showAdmin={showAdmin}
            onSelectView={(view) => { setShowAdmin(false); setActiveView(view); setMobileSidebarOpen(false); }}
            onSelectUser={(user) => { setShowAdmin(false); handleSelectPeer(user); setMobileSidebarOpen(false); }}
            onSelectChannel={(ch) => { setShowAdmin(false); handleSelectChannel(ch); setMobileSidebarOpen(false); }}
            onCreateChannel={handleCreateChannel}
            onShowFingerprintModal={() => setShowFingerprintModal(true)}
            onOpenProfileDrawer={() => setShowProfileDrawer(true)}
            onOpenChannelSettings={(channel) => setChannelSettings(channel)}
            onToggleAdmin={() => setShowAdmin(prev => !prev)}
            onSelectAdminTab={(tab) => { setShowAdmin(true); setAdminTab(tab); }}
            onLogout={handleLogout}
            unreadDMs={unreadDMs}
            unreadChannels={unreadChannels}
            recentDMs={recentDMs}
          />
          </div>
        </>
      )}

      {showAdmin && currentUserKeys?.role === 'ADMIN' ? (
        <React.Suspense fallback={<div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-app)' }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent-primary)' }} /></div>}>
          <AdminDashboard
            currentUser={currentUserKeys}
            fetchUsers={fetchAdminUsers}
            onSetRole={handleAdminSetRole}
            onDeleteUser={handleAdminDeleteUser}
            onClose={() => setShowAdmin(false)}
            activeTab={adminTab}
          />
        </React.Suspense>
      ) : (
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Offline Banner */}
        {isOffline && currentUserKeys && <OfflineBanner pendingCount={pendingCount} />}

        {/* Main Workspace Feed */}
        <div className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            <ChatArea
              selectedUser={selectedPeer}
              selectedChannel={selectedChannel}
              currentUserId={currentUserKeys?.userId || ''}
              currentUserKeys={currentUserKeys}
              allUsers={usersWithPresence}
              peerFingerprint={peerFingerprint}
              mitmWarning={selectedPeer ? mitmWarnings[selectedPeer.userId] : false}
              isConnected={networkStatus.isSocketConnected}
              typingUsers={selectedChannel ? (typingUsers[selectedChannel.id] || []) : selectedPeer ? (typingUsers[selectedPeer.userId] || []) : []}
              fingerprint={userFingerprint}
              showFingerprintModal={showFingerprintModal}
              onCloseChat={handleCloseChat}
              onTrustNewKey={handleTrustNewKey}
              onEditMessage={handleEditMessage}
              onDeleteForMe={handleDeleteForMe}
              onDeleteForEveryone={handleDeleteForEveryone}
              resolveMessageKey={resolveMessageKey}
              onSendMessage={handleSendMessage}
              onSendFiles={handleSendFiles}
              uploadProgress={uploadProgress}
              pinnedMessages={selectedChannel ? (pinnedMessages[selectedChannel.id] || []) : []}
              onPin={handlePinMessage}
              onUnpin={handleUnpinMessage}
              onOpenChannelSettings={(ch) => setChannelSettings(ch)}
              onOpenSearch={() => setShowSearch(true)}
              onOpenFingerprintModal={() => setShowFingerprintModal(true)}
              onCloseFingerprintModal={() => setShowFingerprintModal(false)}
              onToggleSidebar={() => setMobileSidebarOpen(prev => !prev)}
            />
          </div>
        </div>
      </div>
      )}

      {!currentUserKeys && (
        <AuthModal onAuthenticate={handleAuthenticate} error={authError} />
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

      {avatarMenu && (
        <UserAvatarMenu
          user={avatarMenu.user}
          rect={avatarMenu.rect}
          onClose={() => setAvatarMenu(null)}
          onMessage={handleAvatarMessage}
          onViewPicture={handleAvatarViewPicture}
          onViewProfile={handleAvatarViewProfile}
          onCopyId={handleAvatarCopyId}
          onShowFingerprint={handleAvatarShowFingerprint}
        />
      )}

      {channelSettings && currentUserKeys && (
        <ChannelSettingsModal
          channel={channelSettings}
          isOpen={true}
          onClose={() => setChannelSettings(null)}
          onUpdate={handleUpdateChannel}
          onDelete={handleDeleteChannel}
          allUsers={allUsers}
          currentUser={currentUserKeys}
          onMemberClick={(user) => {
            setChannelSettings(null);
            handleSelectPeer(user);
          }}
        />
      )}

      <React.Suspense fallback={null}>
        <MessageSearch
          isOpen={showSearch}
          onClose={() => setShowSearch(false)}
          onSelectMessage={(msg) => {
            if (msg.channelId) {
              const ch = channels.find(c => c.id === msg.channelId);
              if (ch) handleSelectChannel(ch);
            } else {
              const peer = allUsers.find(u => u.userId === msg.senderId || u.userId === msg.recipientId);
              if (peer) handleSelectPeer(peer);
            }
          }}
          allUsers={allUsers}
          channels={channels}
          selectedUser={selectedPeer}
          selectedChannel={selectedChannel}
          currentUserId={currentUserKeys?.userId}
        />
      </React.Suspense>
    </div>
  );
};
