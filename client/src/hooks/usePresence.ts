import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { db } from '../lib/db';
import { API_BASE } from '../lib/attachments';
import { showToast } from '../lib/toast';
import type { User, UserKeyPair } from '../types/chat';

// ── Presence State ──────────────────────────────────────────────────────
export const usePresence = (
  currentUserKeys: UserKeyPair | null,
  allUsers: User[],
  onlineIdsRef: React.MutableRefObject<Set<string>>,
  awayIdsRef: React.MutableRefObject<Set<string>>,
  setAllUsers: React.Dispatch<React.SetStateAction<User[]>>,
  setOnlineIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
  setAwayIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
  dispatch: any,
  selectedPeerRef: React.MutableRefObject<User | null>,
  selectedChannelRef: React.MutableRefObject<any>,
  setCurrentUserKeys: React.Dispatch<React.SetStateAction<UserKeyPair | null>>,
  setMitmWarnings: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
) => {
  // ── Local reactive state for online/away (triggers re-renders in App) ──
  const [onlineIdsState, setOnlineIdsState] = useState<Set<string>>(new Set());
  const [awayIdsState, setAwayIdsState] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});

  // ── Refs at top level (not inside useEffect) ───────────────────────────
  const allUsersRef = useRef(allUsers);
  allUsersRef.current = allUsers;

  const currentUserKeysRef = useRef(currentUserKeys);
  currentUserKeysRef.current = currentUserKeys;

  const selectedPeerRefInner = useRef(selectedPeerRef.current);
  selectedPeerRefInner.current = selectedPeerRef.current;

  // ── Load last viewed from localStorage ──────────────────────────────────
  const lastViewedDmsRef = useRef({});
  const lastViewedChannelsRef = useRef({});

  useEffect(() => {
    try { lastViewedDmsRef.current = JSON.parse(localStorage.getItem('vaultchat_lastViewedDms') || '{}'); } catch {}
    try { lastViewedChannelsRef.current = JSON.parse(localStorage.getItem('vaultchat_lastViewedChannels') || '{}'); } catch {}
  }, []);

  // ── Persist last viewed to localStorage ─────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem('vaultchat_lastViewedDms', JSON.stringify(lastViewedDmsRef.current)); } catch {}
    try { localStorage.setItem('vaultchat_lastViewedChannels', JSON.stringify(lastViewedChannelsRef.current)); } catch {}
  }, [lastViewedDmsRef, lastViewedChannelsRef]);

  // ── Socket Event Handlers ──────────────────────────────────────────────
  useEffect(() => {

    const onUsersDirectory = (usersList: User[]) => {
      setAllUsers(usersList);
      const online = new Set(usersList.filter(u => u.isOnline).map(u => u.userId));
      const away = new Set(usersList.filter(u => u.isAway && u.isOnline).map(u => u.userId));
      setOnlineIds(online);
      setAwayIds(away);
      setOnlineIdsState(online);
      setAwayIdsState(away);
      onlineIdsRef.current = online;
      awayIdsRef.current = away;
    };

    const onUsersPresence = (presence: { userId: string; isOnline: boolean; isAway?: boolean }[]) => {
      const online = new Set(presence.filter(p => p.isOnline).map(p => p.userId));
      const away = new Set(presence.filter(p => p.isAway && p.isOnline).map(p => p.userId));
      setOnlineIds(online);
      setAwayIds(away);
      setOnlineIdsState(online);
      setAwayIdsState(away);
      onlineIdsRef.current = online;
      awayIdsRef.current = away;
    };

    const onUserOnline = (user: User) => {
      setAllUsers((prev: User[]) => {
        const existing = prev.find((u: User) => u.userId === user.userId);
        if (existing) {
          return prev.map((u: User) => u.userId === user.userId ? { ...u, ...user, isOnline: true } : u);
        }
        return [...prev, { ...user, isOnline: true }];
      });
      setOnlineIds((prev: Set<string>) => {
        const next = new Set([...prev, user.userId]);
        setOnlineIdsState(next);
        onlineIdsRef.current = next;
        return next;
      });
    };

    const onUserStatusChange = (data: { userId: string; isOnline: boolean }) => {
      setOnlineIds((prev: Set<string>) => {
        const next = new Set(prev);
        if (data.isOnline) next.add(data.userId);
        else next.delete(data.userId);
        setOnlineIdsState(next);
        onlineIdsRef.current = next;
        return next;
      });
      // Also remove from awayIds when going offline
      if (!data.isOnline) {
        setAwayIds((prev: Set<string>) => {
          const next = new Set(prev);
          next.delete(data.userId);
          setAwayIdsState(next);
          awayIdsRef.current = next;
          return next;
        });
      }
      // Also update allUsers to reflect the online status
      setAllUsers((prev: User[]) => prev.map(u =>
        u.userId === data.userId ? { ...u, isOnline: data.isOnline } : u
      ));
    };

    const onUserRegistered = async () => {
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setAllUsers(data.users || []);
        }
      } catch {}
    };

    const onUserKeyRotated = async (data: any) => {
      setAllUsers((prev: User[]) => prev.map(u => u.userId === data.userId ? { ...u, ...data } : u));

      if (selectedPeerRef.current?.userId === data.userId) {
        const { validatePeerKeyTofu } = await import('../lib/crypto');
        const isValid = await validatePeerKeyTofu(data);
        if (!isValid) {
          setMitmWarnings(prev => ({ ...prev, [data.userId]: true }));
        }
      }
    };

    const onUserRemoved = (data: { userId: string }) => {
      setAllUsers((prev: User[]) => prev.map(u => u.userId === data.userId ? { ...u, isOnline: false, statusMessage: '[deleted]' } : u));
    };

    const onUserRoleChange = (data: { userId: string; role: string }) => {
      setAllUsers((prev: User[]) => prev.map(u =>
        u.userId === data.userId ? { ...u, role: data.role as User['role'] } : u
      ));
      if (data.userId === currentUserKeysRef.current?.userId) {
        setCurrentUserKeys(prev => prev ? { ...prev, role: data.role as UserKeyPair['role'] } : prev);
      }
    };

    const onUserProfileUpdate = (data: { userId: string; displayName?: string; username?: string; avatarUrl?: string; statusMessage?: string; phone?: string }) => {
      setAllUsers(prev => prev.map(u =>
        u.userId === data.userId ? { ...u, ...data } : u
      ));
      if (data.userId === currentUserKeysRef.current?.userId) {
        setCurrentUserKeys(prev => prev ? { ...prev, ...data } : prev);
      }
    };

    const onUserSuspended = () => {
      socket.disconnect();
      localStorage.removeItem('vaultchat_jwt');
      sessionStorage.removeItem('vaultchat_jwt');
      setCurrentUserKeys(null);
      showToast('Your account has been suspended', 'error');
      window.location.reload();
    };

    const onUserPasswordChanged = () => {
      socket.disconnect();
      localStorage.removeItem('vaultchat_jwt');
      sessionStorage.removeItem('vaultchat_jwt');
      setCurrentUserKeys(null);
      showToast('Your password was changed. Please log in again.', 'info');
      window.location.reload();
    };

    const onUserTyping = (data: { userId: string; username: string; channelId?: string; recipientId?: string }) => {
      const conversationId = data.channelId || data.recipientId || data.userId;
      setTypingUsers(prev => {
        const current = prev[conversationId] || [];
        if (current.includes(data.username)) return prev;
        return { ...prev, [conversationId]: [...current, data.username] };
      });
      // Auto-clear after 3 seconds
      setTimeout(() => {
        setTypingUsers(prev => {
          const current = prev[conversationId] || [];
          const next = current.filter(u => u !== data.username);
          if (next.length === 0) {
            const { [conversationId]: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, [conversationId]: next };
        });
      }, 3000);
    };

    const onUserStopTyping = (data: { userId: string; username?: string; channelId?: string; recipientId?: string }) => {
      const conversationId = data.channelId || data.recipientId || data.userId;
      setTypingUsers(prev => {
        const current = prev[conversationId] || [];
        const username = data.username || allUsersRef.current.find(u => u.userId === data.userId)?.username || data.userId;
        const next = current.filter(u => u !== username);
        if (next.length === 0) {
          const { [conversationId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [conversationId]: next };
      });
    };

    socket.on('users:directory', onUsersDirectory);
    socket.on('users:presence', onUsersPresence);
    socket.on('user:online', onUserOnline);
    socket.on('user:status_change', onUserStatusChange);
    socket.on('user:registered', onUserRegistered);
    socket.on('user:key_rotated', onUserKeyRotated);
    socket.on('user:removed', onUserRemoved);
    socket.on('user:role_change', onUserRoleChange);
    socket.on('user:profile-update', onUserProfileUpdate);
    socket.on('user:suspended', onUserSuspended);
    socket.on('user:password_changed', onUserPasswordChanged);
    socket.on('user:typing', onUserTyping);
    socket.on('user:stop_typing', onUserStopTyping);

    // Heartbeat pong — respond to server ping to keep presence alive
    const onPingHeartbeat = () => {
      socket.emit('pong:heartbeat');
    };
    socket.on('ping:heartbeat', onPingHeartbeat);

    return () => {
      socket.off('users:directory', onUsersDirectory);
      socket.off('users:presence', onUsersPresence);
      socket.off('user:online', onUserOnline);
      socket.off('user:status_change', onUserStatusChange);
      socket.off('user:registered', onUserRegistered);
      socket.off('user:key_rotated', onUserKeyRotated);
      socket.off('user:removed', onUserRemoved);
      socket.off('user:role_change', onUserRoleChange);
      socket.off('user:profile-update', onUserProfileUpdate);
      socket.off('user:suspended', onUserSuspended);
      socket.off('user:password_changed', onUserPasswordChanged);
      socket.off('user:typing', onUserTyping);
      socket.off('user:stop_typing', onUserStopTyping);
      socket.off('ping:heartbeat', onPingHeartbeat);
    };
  }, [currentUserKeys, setAllUsers, setOnlineIds, setAwayIds, dispatch, selectedPeerRef, selectedChannelRef, setCurrentUserKeys, setMitmWarnings]);

  // ── Typing Indicators ───────────────────────────────────────────────────
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    if (isTypingRef.current) return;
    isTypingRef.current = true;
    const payload: any = { userId: currentUserKeys?.userId, username: currentUserKeys?.username };
    if (selectedChannelRef.current) payload.channelId = selectedChannelRef.current.id;
    else if (selectedPeerRef.current) payload.recipientId = selectedPeerRef.current?.userId;
    else { isTypingRef.current = false; return; }
    socket.emit('user:typing', payload);

    const stopTyping = () => {
      isTypingRef.current = false;
      socket.emit('user:stop_typing', { userId: currentUserKeys?.userId });
    };

    setTimeout(stopTyping, 3000);
  }, [currentUserKeys, selectedChannelRef, selectedPeerRef]);

  // ── Unread Computation (simplified) ────────────────────────────────────
  useEffect(() => {
    if (!currentUserKeys) return;
    const myId = currentUserKeys.userId;
    const computeUnread = async () => {
      const selectedPeer = selectedPeerRef.current;
      const selectedChannel = selectedChannelRef.current;
      const activePeerId = selectedPeer?.userId;
      const activeChannelId = selectedChannel?.id;
      const incomingDMs = await db.messages.where('recipientId').equals(myId).toArray();
      const incomingChannel = await db.messages.where('channelId').above('').toArray();
      const incoming = [...incomingDMs, ...incomingChannel.filter(m => m.senderId !== myId)];
      for (const msg of incoming) {
        if (msg.channelId) {
          if (msg.channelId === activeChannelId) continue;
        } else {
          const partnerId = msg.senderId;
          if (!partnerId) continue;
          if (partnerId === activePeerId) continue;
        }
      }
    };
    computeUnread();
  }, [currentUserKeys, selectedPeerRef, selectedChannelRef]);

  // ── Return presence-related state and functions ─────────────────────────
  return {
    onlineIds: onlineIdsState,
    awayIds: awayIdsState,
    typingUsers,
  };
};
