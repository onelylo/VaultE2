import { useEffect, useRef, useCallback, useState } from 'react';
import { socket } from '../lib/socket';
import { db, saveChannel, getStoredChannels, saveChannelKey, getChannelKey } from '../lib/db';
import { generateChannelSymmetricKey, exportKeyToJwk, getOrGenerateChannelKey, getOrDeriveSharedKey, encryptChannelKeyForUser, decryptChannelKeyForUser, importPrivateKeyFromJwk } from '../lib/crypto';
import * as cryptoLib from '../lib/crypto';
import type { Channel, UserKeyPair, User } from '../types/chat';

const API = import.meta.env.VITE_API_BASE || '';

// ── Channel State ──────────────────────────────────────────────────────
export const useChannels = (
  currentUserKeys: UserKeyPair | null,
  privateKeyObject: CryptoKey | null,
  allUsers: User[],
  setAllUsers: any,
  dispatch: any
) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelSettings, setChannelSettings] = useState<Channel | null>(null);

  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const allUsersRef = useRef(allUsers);
  allUsersRef.current = allUsers;

  // ── Load stored channels on mount ──────────────────────────────────────
  useEffect(() => {
    getStoredChannels().then((stored) => {
      setChannels(stored);
    });
  }, [currentUserKeys]);

  // ── Proactive key distribution for official channels ──────────────────
  useEffect(() => {
    if (!currentUserKeys || !privateKeyObject || channels.length === 0) return;
    const distributeMissingKeys = async () => {
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (!token) return;
      for (const ch of channels) {
        if (ch.type !== 'official') continue;
        if (!ch.memberIds || ch.memberIds.length === 0) continue;
        const myKey = await getOrGenerateChannelKey(ch.id, db);
        if (!myKey) continue;
        try {
          const res = await fetch(`${API}/api/channels/${ch.id}/missing-keys`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!res.ok) continue;
          const { members: missingIds } = await res.json();
          if (!missingIds || missingIds.length === 0) continue;
          const exportedKey = await crypto.subtle.exportKey('jwk', myKey);
          const keyEnvelopes: { userId: string; encryptedChannelKey: string; iv: string }[] = [];
          for (const memberId of missingIds) {
            if (memberId === currentUserKeys.userId) continue;
            const member = allUsersRef.current.find(u => u.userId === memberId);
            if (!member?.publicKey) continue;
            try {
              const sharedKey = await getOrDeriveSharedKey(privateKeyObject, member.publicKey);
              if (!sharedKey) continue;
              const env = await encryptChannelKeyForUser(exportedKey, sharedKey);
              keyEnvelopes.push({ userId: memberId, encryptedChannelKey: env.encryptedKey, iv: env.iv });
            } catch { /* skip */ }
          }
          if (keyEnvelopes.length > 0) {
            await fetch(`${API}/api/channels/${ch.id}/keys`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ keys: keyEnvelopes }),
            });
            console.log(`[ChannelKey] Proactively distributed key for ${ch.id} to ${keyEnvelopes.length} member(s)`);
          }
        } catch { /* best-effort */ }
      }
    };
    distributeMissingKeys();
  }, [channels, currentUserKeys, privateKeyObject]);

  // ── Channel creation ───────────────────────────────────────────────────
  const handleCreateChannel = useCallback(async (channelData: any) => {
    if (!currentUserKeys) return;
    const channelId = channelData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // 1. Emit channel:create and wait for ack
    const ackPromise = new Promise<any>((resolve) => {
      socket.once('channel:create:ack', resolve);
      setTimeout(() => resolve(null), 5000);
    });
    socket.emit('channel:create', { ...channelData, id: channelId });
    const ack = await ackPromise;

    // 2. Generate AES channel key
    const channelKeyObj = await generateChannelSymmetricKey();
    const channelKeyJwk = await exportKeyToJwk(channelKeyObj);

    // 3. Save channel locally
    await saveChannel({ channelId, keyJwk: channelKeyJwk, ...channelData, id: channelId } as any);
    setChannels(prev => {
      const newCh = { ...channelData, id: channelId, keyJwk: channelKeyObj } as Channel;
      return [...prev, newCh].filter(c => c.id !== channelId || prev.some(existing => existing.id === channelId));
    });

    // 4. Encrypt and distribute key to members with retry
    if (privateKeyObject && channelData.memberIds?.length) {
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (token) {
        const membersToEncrypt = channelData.type === 'official'
          ? allUsersRef.current.map(u => u.userId)
          : channelData.memberIds;

        for (const memberId of membersToEncrypt) {
          if (memberId === currentUserKeys.userId) continue;
          const member = allUsersRef.current.find(u => u.userId === memberId);
          if (!member?.publicKey) continue;

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const sharedKey = await getOrDeriveSharedKey(privateKeyObject, member.publicKey);
              if (!sharedKey) continue;
              const exportedKey = await crypto.subtle.exportKey('jwk', channelKeyObj);
              const encryptedData = await encryptChannelKeyForUser(exportedKey, sharedKey);
              await fetch(`${API}/api/channels/${channelId}/keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userId: memberId, encryptedChannelKey: encryptedData.encryptedKey, iv: encryptedData.iv }),
              });
              break; // Success
            } catch (e) {
              if (attempt === 2) console.error(`[ChannelKey] Failed after 3 attempts for ${memberId}:`, e);
              else await new Promise(r => setTimeout(r, 1000));
            }
          }
        }
      }
    }

    // 5. Refresh channel list
    socket.emit('channels:get');
  }, [currentUserKeys, privateKeyObject]);

  // ── Channel update ─────────────────────────────────────────────────────
  const handleUpdateChannel = useCallback(async (id: string, data: any) => {
    if (!currentUserKeys) return;
    const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
    if (token) {
      await fetch(`${API}/api/channels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
    }

    // Update local state
    await saveChannel({ ...data, id } as any);
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    if (selectedChannel?.id === id) {
      setSelectedChannel({ ...selectedChannel, ...data });
    }

    // Distribute key to new members if memberIds changed
    if (data.memberIds && privateKeyObject) {
      const oldChannel = channelsRef.current.find(c => c.id === id);
      const oldMemberIds = oldChannel?.memberIds || [];
      const newMemberIds = data.memberIds.filter((m: string) => !oldMemberIds.includes(m));

      const channelKey = await getOrGenerateChannelKey(id, db);
      if (channelKey && newMemberIds.length > 0) {
        const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
        if (token) {
          for (const memberId of newMemberIds) {
            const member = allUsersRef.current.find(u => u.userId === memberId);
            if (!member?.publicKey) continue;
            try {
              const sharedKey = await getOrDeriveSharedKey(privateKeyObject, member.publicKey);
              if (!sharedKey) continue;
              const exportedKey = await crypto.subtle.exportKey('jwk', channelKey);
              const encryptedData = await encryptChannelKeyForUser(exportedKey, sharedKey);
              await fetch(`${API}/api/channels/${id}/keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ userId: memberId, encryptedChannelKey: encryptedData.encryptedKey, iv: encryptedData.iv }),
              });
            } catch (e) {
              console.error(`[ChannelKey] Failed to distribute to new member ${memberId}:`, e);
            }
          }
        }
      }
    }

    // Refresh channel list
    socket.emit('channels:get');
  }, [currentUserKeys, privateKeyObject, selectedChannel]);

  // ── Channel delete ─────────────────────────────────────────────────────
  const handleDeleteChannel = useCallback(async (id: string) => {
    if (!currentUserKeys) return;
    const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
    if (token) {
      await fetch(`${API}/api/channels/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await db.channelKeys.delete(id);
    setChannels(prev => prev.filter(c => c.id !== id));
    if (selectedChannel?.id === id) {
      setSelectedChannel(null);
    }
    setChannelSettings(null);
    socket.emit('channels:get');
  }, [currentUserKeys, selectedChannel]);

  // ── Leave channel ──────────────────────────────────────────────────────
  const handleLeaveChannel = useCallback((channelId: string) => {
    socket.emit('channel:leave', { channelId });
    if (selectedChannel?.id === channelId) {
      setSelectedChannel(null);
    }
  }, [selectedChannel]);

  // ── Select channel ───────────────────────────────────────────────────
  const handleSelectChannel = useCallback(async (channel: Channel) => {
    setSelectedChannel(channel);

    // Join channel room FIRST so we receive key distribution events
    socket.emit('channel:join', { channelId: channel.id });

    // Try to get channel key, request if missing
    let key = await getOrGenerateChannelKey(channel.id, db);
    if (!key) {
      socket.emit('channel:key:request', { channelId: channel.id });
      // Wait and retry
      await new Promise(r => setTimeout(r, 1500));
      key = await getOrGenerateChannelKey(channel.id, db);
    }
  }, []);

  // ── Socket event handlers ──────────────────────────────────────────────
  const currentUserKeysRef = useRef(currentUserKeys);
  currentUserKeysRef.current = currentUserKeys;

  useEffect(() => {
    const onChannelMemberAdded = async (data: any) => {
      setChannels(prev => prev.map(c =>
        c.id === data.channelId ? { ...c, memberIds: [...new Set([...(c.memberIds || []), data.userId])] } : c
      ));
      // If someone else was added and we are the channel creator, distribute the key
      if (data.userId === currentUserKeys?.userId) {
        // We were added — request the key
        socket.emit('channel:key:request', { channelId: data.channelId });
        return;
      }
      if (!currentUserKeys || !privateKeyObject) return;
      const channel = channelsRef.current.find(c => c.id === data.channelId);
      if (!channel || channel.createdBy !== currentUserKeys.userId) return;
      // We are the creator — distribute key to new member
      try {
        const channelKey = await getOrGenerateChannelKey(data.channelId, db);
        if (!channelKey) return;
        const newMember = allUsersRef.current.find(u => u.userId === data.userId);
        if (!newMember?.publicKey) return;
        const sharedKey = await getOrDeriveSharedKey(privateKeyObject, newMember.publicKey);
        if (!sharedKey) return;
        const exportedKey = await crypto.subtle.exportKey('jwk', channelKey);
        const encryptedData = await encryptChannelKeyForUser(exportedKey, sharedKey);
        const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
        if (token) {
          await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/channels/${data.channelId}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ userId: data.userId, encryptedChannelKey: encryptedData.encryptedKey, iv: encryptedData.iv }),
          });
        }
      } catch (e) {
        console.error('[ChannelKey] Failed to distribute key to new member:', e);
      }
    };

    const onChannelMemberRemoved = (data: any) => {
      setChannels(prev => prev.map(c =>
        c.id === data.channelId ? { ...c, memberIds: (c.memberIds || []).filter(id => id !== data.userId) } : c
      ));
      if (selectedChannel?.id === data.channelId) {
        setSelectedChannel(null);
      }
    };

    const onChannelKeyRotated = async (data: any) => {
      // Clear local key cache
      setChannels(prev => prev.map(c => c.id === data.channelId ? { ...c, keyJwk: null } : c));
      try { await db.channelKeys.delete(data.channelId); } catch {}
      // Only the creator generates + distributes new key
      const channel = channelsRef.current.find(c => c.id === data.channelId);
      if (!channel || channel.createdBy !== currentUserKeys?.userId) return;
      try {
        const newKeyObj = await generateChannelSymmetricKey();
        const newKeyJwk = await exportKeyToJwk(newKeyObj);
        setChannels(prev => prev.map(c => c.id === data.channelId ? { ...c, keyJwk: newKeyObj } : c));
        await saveChannelKey({ channelId: data.channelId, keyJwk: newKeyJwk });
        // Distribute to all remaining members
        if (!privateKeyObject) return;
        const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
        if (!token) return;
        const memberIds = channel.memberIds || [];
        for (const memberId of memberIds) {
          if (memberId === currentUserKeys.userId) continue;
          const member = allUsersRef.current.find(u => u.userId === memberId);
          if (!member?.publicKey) continue;
          try {
            const sharedKey = await getOrDeriveSharedKey(privateKeyObject, member.publicKey);
            if (!sharedKey) continue;
            const exportedKey = await crypto.subtle.exportKey('jwk', newKeyObj);
            const encryptedData = await encryptChannelKeyForUser(exportedKey, sharedKey);
            await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/channels/${data.channelId}/keys`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ userId: memberId, encryptedChannelKey: encryptedData.encryptedKey, iv: encryptedData.iv }),
            });
          } catch (e) {
            console.error(`[ChannelKey] Failed to distribute to ${memberId}:`, e);
          }
        }
      } catch (e) {
        console.error('[ChannelKey] Rotation failed:', e);
      }
    };

    const onChannelOwnershipTransferred = (data: any) => {
      setChannels(prev => prev.map(c =>
        c.id === data.channelId ? { ...c, createdBy: data.toUserId } : c
      ));
    };

    const onChannelKeyRequest = async (data: any) => {
      if (!currentUserKeys || !privateKeyObject) return;
      if (data.requesterId === currentUserKeys?.userId) return; // Don't respond to self
      const channelKey = await getOrGenerateChannelKey(data.channelId, db);
      if (!channelKey) return; // We don't have the key either
      const requester = allUsersRef.current.find(u => u.userId === data.requesterId);
      if (!requester?.publicKey) return;
      try {
        const sharedKey = await getOrDeriveSharedKey(privateKeyObject, requester.publicKey);
        if (!sharedKey) return;
        const exportedKey = await crypto.subtle.exportKey('jwk', channelKey);
        const encryptedData = await encryptChannelKeyForUser(exportedKey, sharedKey);
        const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
        if (token) {
          await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/channels/${data.channelId}/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ keys: [{ userId: data.requesterId, encryptedChannelKey: encryptedData.encryptedKey, iv: encryptedData.iv }] }),
          });
          console.log(`[ChannelKey] Delivered key to requesting user ${data.requesterId} for channel ${data.channelId}`);
        }
      } catch (e) {
        console.error(`[ChannelKey] Failed to respond to key request:`, e);
      }
    };

    // ── Channels Update (from server) ──────────────────────────────────────
    const onChannelsUpdate = async (channelsList: any[]) => {
      setChannels(channelsList);
      // Also update selectedChannel if its properties changed
      setSelectedChannel(prev => {
        if (!prev) return prev;
        const updated = channelsList.find(c => c.id === prev.id);
        return updated ? { ...prev, ...updated } : prev;
      });
      // Clean up deleted channels from IndexedDB
      const serverIds = new Set(channelsList.map(c => c.id));
      const stored = await getStoredChannels();
      for (const ch of stored) {
        if (!serverIds.has(ch.id)) {
          await db.channels.delete(ch.id);
        }
      }
      for (const c of channelsList) await saveChannel(c);
    };

    socket.on('channel:member_added', onChannelMemberAdded);
    socket.on('channel:member_removed', onChannelMemberRemoved);
    socket.on('channel:key_rotated', onChannelKeyRotated);
    socket.on('channel:ownership_transferred', onChannelOwnershipTransferred);
    socket.on('channel:key_request', onChannelKeyRequest);
    socket.on('channels:update', onChannelsUpdate);
    socket.on('channel:key_response', async (data: { channelId: string; encryptedKey: string; iv: string; fromUserId: string }) => {
      if (!privateKeyObject) return;
      try {
        const fromUser = allUsersRef.current.find(u => u.userId === data.fromUserId);
        if (!fromUser?.publicKey) return;
        const sharedKey = await getOrDeriveSharedKey(privateKeyObject, fromUser.publicKey);
        if (!sharedKey) return;
        const keyJwk = await decryptChannelKeyForUser(data.encryptedKey, data.iv, sharedKey);
        await saveChannelKey({ channelId: data.channelId, keyJwk });
        console.log(`[ChannelKey] Received key for channel ${data.channelId} from ${data.fromUserId}`);
      } catch (e) {
        console.error('[ChannelKey] Failed to process key response:', e);
      }
    });

    return () => {
      socket.off('channel:member_added', onChannelMemberAdded);
      socket.off('channel:member_removed', onChannelMemberRemoved);
      socket.off('channel:key_rotated', onChannelKeyRotated);
      socket.off('channel:ownership_transferred', onChannelOwnershipTransferred);
      socket.off('channel:key_request', onChannelKeyRequest);
      socket.off('channels:update', onChannelsUpdate);
      socket.off('channel:key_response');
    };
  }, [currentUserKeys]);

  return {
    channels,
    selectedChannel,
    setSelectedChannel,
    channelSettings,
    setChannelSettings,
    handleCreateChannel,
    handleUpdateChannel,
    handleDeleteChannel,
    handleLeaveChannel,
    handleSelectChannel,
    getOrGenerateChannelKey,
  };
};