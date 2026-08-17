import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import { saveMessage, updateMessageStatus, markMessageDeletedLocally, editMessageLocally, deleteMessageLocally, getChannelKey, saveChannelKey, markForwarded } from '../lib/db';
import { getOrDeriveSharedKey, getOrGenerateChannelKey, resolveMessageKey, encryptMessage, encryptBinaryData, validatePeerKeyTofu, decryptMessage, importPublicKey, deriveSharedKey, importSymmetricKeyFromJwk, decryptChannelKeyForUser, clearSharedKeyCache } from '../lib/crypto';
import { uploadEncryptedAttachment, readFileAsArrayBuffer, generateImageThumbnail } from '../lib/attachments';
import { MAX_ATTACHMENT_BYTES, API_BASE } from '../lib/attachments';
import { showToast } from '../lib/toast';
import { playNotificationSound } from '../lib/notify';
import { socket } from '../lib/socket';
import { liveQuery } from 'dexie';
import type { LocalMessage, User, Channel, AttachmentMeta, AttachmentPayload, PendingUpload } from '../types/chat';

const genTempId = () => `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const useMessages = (
  currentUserKeys: any,
  privateKeyObject: any,
  selectedPeer: any,
  selectedChannel: any,
  allUsers: any[],
  onlineIds: Set<string>,
  lastViewedDmsRef: any,
  lastViewedChannelsRef: any,
  dispatch: any,
  setOnlineIds?: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void,
  onUpsertDMConversation?: (peer: any, lastMessageText: string) => void
) => {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<Record<string, { messageId: string; pinnedBy: string; pinnedAt: number }[]>>({});
  const [starredSet, setStarredSet] = useState<Set<string>>(new Set());

  // ── Refs for socket handlers ────────────────────────────────────────────────
  const currentUserKeysRef = useRef(currentUserKeys);
  currentUserKeysRef.current = currentUserKeys;

  const privateKeyObjectRef = useRef(privateKeyObject);
  privateKeyObjectRef.current = privateKeyObject;

  const selectedPeerRef = useRef(selectedPeer);
  selectedPeerRef.current = selectedPeer;

  const selectedChannelRef = useRef(selectedChannel);
  selectedChannelRef.current = selectedChannel;

  const allUsersRef = useRef(allUsers);
  allUsersRef.current = allUsers;

  // ── Full channel key fetch: cache → Dexie → server → ECDH decrypt → save
  const getOrGenerateChannelKeyFull = useCallback(async (channelId: string): Promise<CryptoKey | null> => {
    // 1. Try base lib version (cache + Dexie)
    const base = await getOrGenerateChannelKey(channelId, db);
    if (base) return base;

    // 2. Fetch encrypted key envelope from server
    try {
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (!token) return null;
      const res = await fetch(`${API_BASE}/api/channels/${channelId}/key`, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => null);
      if (!res || !res.ok) return null;
      const data = await res.json();
      const { encryptedChannelKey, iv } = data.key || {};
      if (!encryptedChannelKey || !iv) return null;

      // 3. Try to decrypt with ECDH shared key for each channel member
      const channel = allUsersRef.current;
      const candidateIds = channel.map((u: any) => u.userId);
      // Also try self
      if (currentUserKeysRef.current) candidateIds.push(currentUserKeysRef.current.userId);

      for (const candidateId of candidateIds) {
        const candidateUser = candidateId === currentUserKeysRef.current?.userId
          ? { userId: currentUserKeysRef.current.userId, publicKey: currentUserKeysRef.current.publicKeyBase64 }
          : allUsersRef.current.find((u: any) => u.userId === candidateId);
        if (!candidateUser?.publicKey) continue;
        try {
          const sharedKey = await getOrDeriveSharedKeyRef.current(privateKeyObjectRef.current, candidateUser.publicKey);
          if (!sharedKey) continue;
          const keyJwk = await decryptChannelKeyForUser(encryptedChannelKey, iv, sharedKey);
          const imported = await importSymmetricKeyFromJwk(keyJwk);
          // Save to Dexie for future use
          await saveChannelKey({ channelId, keyJwk });
          return imported;
        } catch {
          // This candidate didn't encrypt this envelope
        }
      }
    } catch (e) {
      console.error(`[ChannelKey] Server fetch failed for ${channelId}:`, e);
    }
    return null;
  }, [currentUserKeys]);

  const getOrGenerateChannelKeyRef = useRef(getOrGenerateChannelKeyFull);
  getOrGenerateChannelKeyRef.current = getOrGenerateChannelKeyFull;

  const getOrDeriveSharedKeyRef = useRef(getOrDeriveSharedKey);
  getOrDeriveSharedKeyRef.current = getOrDeriveSharedKey;

  // ── Fetch fresh public key from server ───────────────────────────────────
  const fetchUserPublicKey = useCallback(async (userId: string): Promise<string | null> => {
    try {
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (!token) return null;
      const res = await fetch(`${API_BASE}/api/users/${userId}/keys`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.publicKey || null;
    } catch {
      return null;
    }
  }, []);

  const fetchUserPublicKeyRef = useRef(fetchUserPublicKey);
  fetchUserPublicKeyRef.current = fetchUserPublicKey;

  // ── decryptPayload implementation using refs ──────────────────────────────
  const decryptPayloadImpl = useCallback(async (payload: any): Promise<any> => {
    if (!payload) return null;
    if (!currentUserKeysRef.current || !privateKeyObjectRef.current) {
      return {
        id: payload.id,
        tempId: payload.tempId,
        senderId: payload.senderId,
        recipientId: payload.recipientId,
        channelId: payload.channelId,
        text: '🔒 Unable to decrypt: missing keys',
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        timestamp: payload.timestamp ?? Date.now(),
        status: (payload.status as any) || 'received',
        isDecrypted: false,
        isEdited: payload.isEdited,
        isDeleted: payload.isDeleted,
        replyTo: payload.replyTo,
        attachment: payload.attachment,
        attachmentMeta: undefined,
        decryptionError: 'Missing keys',
      };
    }

    let key: CryptoKey | null = null;
    let decryptionError: string | undefined = undefined;

    if (payload.channelId) {
      // Channel message - get channel key
      const channelKey = await getOrGenerateChannelKeyRef.current(payload.channelId);
      if (!channelKey) {
        return {
          id: payload.id,
          tempId: payload.tempId,
          senderId: payload.senderId,
          recipientId: payload.recipientId,
          channelId: payload.channelId,
          text: '🔒 Unable to decrypt: channel key not available',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: payload.timestamp ?? Date.now(),
          status: (payload.status as any) || 'received',
          isDecrypted: false,
          isEdited: payload.isEdited,
          isDeleted: payload.isDeleted,
          replyTo: payload.replyTo,
          attachment: payload.attachment,
          attachmentMeta: undefined,
          decryptionError: 'Channel key not available',
        };
      }
      key = channelKey;
    } else {
      // DM message - derive shared key
      const peerId = payload.senderId === currentUserKeysRef.current?.userId 
        ? payload.recipientId 
        : payload.senderId;
      if (!peerId) {
        return {
          id: payload.id,
          tempId: payload.tempId,
          senderId: payload.senderId,
          recipientId: payload.recipientId,
          channelId: payload.channelId,
          text: '🔒 Unable to decrypt: missing peer ID',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: payload.timestamp ?? Date.now(),
          status: (payload.status as any) || 'received',
          isDecrypted: false,
          isEdited: payload.isEdited,
          isDeleted: payload.isDeleted,
          replyTo: payload.replyTo,
          attachment: payload.attachment,
          attachmentMeta: undefined,
          decryptionError: 'Missing peer ID',
        };
      }

      // Get peer's public key — always fetch fresh from server for DMs
      let peerPublicKey = peerId === currentUserKeysRef.current?.userId
        ? currentUserKeysRef.current?.publicKeyBase64
        : allUsersRef.current.find(u => u.userId === peerId)?.publicKey;

      if (peerId !== currentUserKeysRef.current?.userId) {
        const fetched = await fetchUserPublicKeyRef.current(peerId);
        if (fetched) peerPublicKey = fetched;
      }

      if (peerPublicKey) {
        key = await getOrDeriveSharedKeyRef.current(privateKeyObjectRef.current, peerPublicKey);
      } else if (peerId !== currentUserKeysRef.current?.userId) {
        console.error(`[E2EE] Cannot decrypt: missing public key for ${peerId}`);
        decryptionError = `Missing public key for peer ${peerId}`;
      }

      if (!key) {
        return {
          id: payload.id,
          tempId: payload.tempId,
          senderId: payload.senderId,
          recipientId: payload.recipientId,
          channelId: payload.channelId,
          text: '🔒 Unable to decrypt message',
          ciphertext: payload.ciphertext,
          iv: payload.iv,
          timestamp: payload.timestamp ?? Date.now(),
          status: (payload.status as any) || 'received',
          isDecrypted: false,
          isEdited: payload.isEdited,
          isDeleted: payload.isDeleted,
          replyTo: payload.replyTo,
          attachment: payload.attachment,
          attachmentMeta: undefined,
          decryptionError: decryptionError ?? 'Unable to derive decryption key',
        };
      }
    }

    if (!key) {
      return {
        id: payload.id,
        tempId: payload.tempId,
        senderId: payload.senderId,
        recipientId: payload.recipientId,
        channelId: payload.channelId,
        text: '🔒 Unable to decrypt: no key',
        ciphertext: payload.ciphertext,
        iv: payload.iv,
        timestamp: payload.timestamp ?? Date.now(),
        status: (payload.status as any) || 'received',
        isDecrypted: false,
        isEdited: payload.isEdited,
        isDeleted: payload.isDeleted,
        replyTo: payload.replyTo,
        attachment: payload.attachment,
        attachmentMeta: undefined,
        decryptionError: 'No decryption key',
      };
    }

    let text = '🔒 Unable to decrypt message';
    let isDecrypted = false;
    if (payload.ciphertext) {
      try {
        text = await decryptMessage(payload.ciphertext, payload.iv, key);
        isDecrypted = true;
      } catch (e) {
        // Retry: clear cache, fetch fresh pubkey, re-derive shared key
        if (!payload.channelId && payload.senderId !== currentUserKeysRef.current?.userId) {
          try {
            // Clear stale shared key cache for this peer
            const peerPubKey = allUsersRef.current.find((u: any) => u.userId === payload.senderId)?.publicKey;
            if (peerPubKey) clearSharedKeyCache(payload.senderId, peerPubKey);
            
            const freshPubKey = await fetchUserPublicKeyRef.current(payload.senderId);
            if (freshPubKey && privateKeyObjectRef.current) {
              const peerPubKey = await importPublicKey(freshPubKey);
              const freshKey = await deriveSharedKey(privateKeyObjectRef.current, peerPubKey);
              text = await decryptMessage(payload.ciphertext, payload.iv, freshKey);
              isDecrypted = true;
              console.log('[E2EE] Decryption succeeded on retry with fresh key');
            }
          } catch (retryErr) {
            console.error('[E2EE] Decrypt retry also failed:', retryErr);
            decryptionError = 'Decryption failed (key mismatch)';
          }
        } else {
          return {
            id: payload.id,
            tempId: payload.tempId,
            senderId: payload.senderId,
            recipientId: payload.recipientId,
            channelId: payload.channelId,
            text: '🔒 Unable to decrypt: decryption failed',
            ciphertext: payload.ciphertext,
            iv: payload.iv,
            timestamp: payload.timestamp ?? Date.now(),
            status: (payload.status as any) || 'received',
            isDecrypted: false,
            isEdited: payload.isEdited,
            isDeleted: payload.isDeleted,
            replyTo: payload.replyTo,
            attachment: payload.attachment,
            attachmentMeta: undefined,
            decryptionError: 'Decryption failed',
          };
        }
      }
    } else {
      text = '';
      isDecrypted = true; // attachment-only message
    }

    let attachmentMeta: any = undefined;
    if (payload.attachment?.encryptedMetadata) {
      try {
        const metaJson = await decryptMessage(payload.attachment.encryptedMetadata, payload.attachment.iv, key);
        attachmentMeta = JSON.parse(metaJson);
      } catch (e) {
        console.error('[E2EE] Attachment metadata decrypt error:', e);
        attachmentMeta = undefined;
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
      timestamp: payload.timestamp ?? Date.now(),
      status: (payload.status as any) || 'received',
      isDecrypted,
      isEdited: payload.isEdited,
      isDeleted: payload.isDeleted,
      replyTo: payload.replyTo,
      attachment: payload.attachment,
      attachmentMeta,
      decryptionError: undefined,
    };
  }, [getOrGenerateChannelKeyRef, getOrDeriveSharedKeyRef]);

  const decryptPayloadRef = useRef(decryptPayloadImpl);
  decryptPayloadRef.current = decryptPayloadImpl;

  // ── Socket Event Handlers ──────────────────────────────────────────────────
  useEffect(() => {

    const onMessageReceive = async (payload: any & { isForwarded?: boolean }) => {
      if (!currentUserKeysRef.current || !privateKeyObjectRef.current) return;
      
      // Drop messages from blocked users
      if (payload.senderId !== currentUserKeysRef.current.userId) {
        const blockedUsers = await db.blockedUsers.toArray();
        const blockedIds = new Set(blockedUsers.map(b => b.userId));
        if (blockedIds.has(payload.senderId)) return;
      }
      
      const localMsg = await decryptPayloadRef.current(payload);
      await saveMessage(localMsg);

      if (payload.isForwarded && payload.forwardedFrom) {
        localMsg.forwardedFrom = payload.forwardedFrom;
        await saveMessage(localMsg);
        await markForwarded(localMsg.id);
      }

      // Play notification sound for incoming DMs (not from self)
      if (payload.senderId !== currentUserKeysRef.current?.userId) {
        playNotificationSound();
      }

      socket.emit('message:delivered', { messageId: payload.id, tempId: payload.tempId, senderId: payload.senderId });

      if (selectedPeerRef.current?.userId === payload.senderId) {
        socket.emit('message:read', { conversationId: currentUserKeysRef.current?.userId, senderId: payload.senderId, lastReadMessageId: payload.id });
      }

      // Update recent DMs sidebar for incoming message
      if (!payload.channelId && payload.senderId !== currentUserKeysRef.current?.userId) {
        const peer = allUsersRef.current.find((u: any) => u.userId === payload.senderId);
        if (peer) {
          onUpsertDMConversation?.(peer, localMsg.text || '');
        }
      }
    };

    const onChannelMessageReceive = async (payload: any & { isForwarded?: boolean }) => {
      if (!payload.channelId) return;
      
      // Drop messages from blocked users
      if (payload.senderId !== currentUserKeysRef.current?.userId) {
        const blockedUsers = await db.blockedUsers.toArray();
        const blockedIds = new Set(blockedUsers.map(b => b.userId));
        if (blockedIds.has(payload.senderId)) return;
      }
      
      const localMsg = await decryptPayloadRef.current(payload);
      await saveMessage(localMsg);

      if (payload.isForwarded && payload.forwardedFrom) {
        localMsg.forwardedFrom = payload.forwardedFrom;
        await saveMessage(localMsg);
        await markForwarded(localMsg.id);
      }

      // Play notification sound for incoming channel messages (not from self)
      if (payload.senderId !== currentUserKeysRef.current?.userId) {
        playNotificationSound();
      }

      socket.emit('message:delivered', { messageId: payload.id, tempId: payload.tempId, channelId: payload.channelId });

      if (selectedChannelRef.current?.id === payload.channelId) {
        socket.emit('message:read', { conversationId: payload.channelId, lastReadMessageId: payload.id });
      }
    };

    const onMessageAck = async ({ tempId, serverId, status, error }: { tempId: string; serverId: string; status: any; error?: string }) => {
      if (status === 'failed') {
        if (error) showToast(error, 'error');
        const existing = await db.messages.get(tempId) || await db.messages.where('tempId').equals(tempId).first();
        if (existing) await db.messages.delete(existing.id);
        return;
      }
      await updateMessageStatus(tempId, status, serverId);
    };

    const onMessageDeliveredAck = async ({ id, tempId }: { id: string; tempId?: string }) => {
      const lookupId = tempId || id;
      await updateMessageStatus(lookupId, 'delivered');
    };

    const onMessageReadAck = async ({ conversationId }: { conversationId: string }) => {
      const myId = currentUserKeysRef.current?.userId;
      if (!myId) return;
      const sentMsgs = await db.messages.where('senderId').equals(myId).toArray();
      const unreadSent = sentMsgs.filter(m => 
        (m.recipientId === conversationId || m.channelId === conversationId) && 
        m.status !== 'read'
      );
      for (const m of unreadSent) {
        await db.messages.put({ ...m, status: 'read' as const });
      }
    };

    const onMessageEdited = async ({ id, newCiphertext, newIv }: { id: string; newCiphertext: string; newIv: string }) => {
      let decryptedText = '🔒 Unable to decrypt edited message';
      const existing = await db.messages.get(id);
      if (existing?.channelId) {
        const channelKey = await getOrGenerateChannelKeyRef.current(existing.channelId);
        if (channelKey) { try { decryptedText = await decryptMessage(newCiphertext, newIv, channelKey); } catch {} }
      } else {
        const myId = currentUserKeysRef.current?.userId;
        const peerId = existing?.senderId === myId ? existing?.recipientId : existing?.senderId;
        if (peerId) {
          const peer = allUsersRef.current.find(u => u.userId === peerId);
          if (peer?.publicKey) {
            const sharedKey = await getOrDeriveSharedKeyRef.current(privateKeyObjectRef.current, peer.publicKey);
            if (sharedKey) { try { decryptedText = await decryptMessage(newCiphertext, newIv, sharedKey); } catch {} }
          }
        }
      }
      await editMessageLocally(id, decryptedText, newCiphertext, newIv);
    };

    const onMessageDeleted = async ({ id }: { id: string }) => {
      await markMessageDeletedLocally(id);
    };

    const onChannelPinned = (data: { channelId: string; pinned: { messageId: string; pinnedBy: string; pinnedAt: number }[] }) => {
      setPinnedMessages(prev => ({ ...prev, [data.channelId]: data.pinned }));
    };

    const onChannelUnpinned = (data: { channelId: string; unpinnedMessageId: string }) => {
      setPinnedMessages(prev => ({
        ...prev,
        [data.channelId]: (prev[data.channelId] || []).filter(p => p.messageId !== data.unpinnedMessageId),
      }));
    };

    socket.on('message:receive', onMessageReceive);
    socket.on('channel:message:receive', onChannelMessageReceive);
    socket.on('message:ack', onMessageAck);
    socket.on('message:delivered_ack', onMessageDeliveredAck);
    socket.on('message:read_ack', onMessageReadAck);
    socket.on('message:edited', onMessageEdited);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('channel:pinned', onChannelPinned);
    socket.on('channel:unpinned', onChannelUnpinned);

    return () => {
      socket.off('message:receive', onMessageReceive);
      socket.off('channel:message:receive', onChannelMessageReceive);
      socket.off('message:ack', onMessageAck);
      socket.off('message:delivered_ack', onMessageDeliveredAck);
      socket.off('message:read_ack', onMessageReadAck);
      socket.off('message:edited', onMessageEdited);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('channel:pinned', onChannelPinned);
      socket.off('channel:unpinned', onChannelUnpinned);
    };
  }, []);

  // ── Send Message (1:1 DM or Channel) ────────────────────────────────────
  const handleSendMessage = useCallback(async (text: string, replyTo?: string) => {
    if (!currentUserKeys || (!selectedPeer && !selectedChannel) || !privateKeyObject) return;
    const tempId = genTempId();
    const timestamp = Date.now();
    const canSend = socket.connected && navigator.onLine;
    const status: LocalMessage['status'] = canSend ? 'sent' : 'pending_sync';

    if (selectedChannel) {
      const channelKey = await getOrGenerateChannelKeyRef.current(selectedChannel.id);
      if (!channelKey) {
        socket.emit('channel:key:request', { channelId: selectedChannel.id });
        showToast('Channel key unavailable, message pending', 'warning');
        return;
      }
      const { ciphertext, iv } = await encryptMessage(text, channelKey);
      const localMsg: LocalMessage = {
        id: tempId, tempId, senderId: currentUserKeys.userId, channelId: selectedChannel.id,
        text, ciphertext, iv, timestamp, status, isDecrypted: true, replyTo,
        isEdited: false, isDeleted: false, removed: false,
        attachment: undefined, attachmentMeta: undefined, pendingUpload: undefined,
        decryptionError: undefined
      };
      await saveMessage(localMsg);
      if (canSend) {
        socket.emit('channel:message:send', { id: tempId, tempId, senderId: currentUserKeys.userId, channelId: selectedChannel.id, ciphertext, iv, timestamp, replyTo });
      }
    } else if (selectedPeer) {
      const isValidKey = await validatePeerKeyTofu(selectedPeer);
      if (!isValidKey) {
        showToast('Security Alert: Peer identity key mismatch', 'error');
        return;
      }
      const sharedKey = await getOrDeriveSharedKeyRef.current(privateKeyObject, selectedPeer.publicKey);
      if (!sharedKey) return;
      const { ciphertext, iv } = await encryptMessage(text, sharedKey);
      const localMsg: LocalMessage = {
        id: tempId, tempId, senderId: currentUserKeys.userId, recipientId: selectedPeer.userId,
        text, ciphertext, iv, timestamp, status, isDecrypted: true, replyTo,
        isEdited: false, isDeleted: false, removed: false,
        attachment: undefined, attachmentMeta: undefined, pendingUpload: undefined,
        decryptionError: undefined
      };
      await saveMessage(localMsg);
      if (canSend) {
        socket.emit('message:send', { id: tempId, tempId, senderId: currentUserKeys.userId, recipientId: selectedPeer.userId, ciphertext, iv, timestamp, replyTo });
      }
      onUpsertDMConversation?.(selectedPeer, text);
    }
  }, [currentUserKeys, privateKeyObject, selectedPeer, selectedChannel, allUsers, onlineIds, onUpsertDMConversation]);

  // ── Send Files (Attachment) ─────────────────────────────────────────────
  const handleSendFiles = useCallback(async (files: File[], text?: string) => {
    if (!currentUserKeys || (!selectedPeer && !selectedChannel) || !privateKeyObject || files.length === 0) return;

    let keyObj: CryptoKey | null = null;
    if (selectedChannel) {
      keyObj = await getOrGenerateChannelKeyRef.current(selectedChannel.id);
    } else if (selectedPeer) {
      const isValidKey = await validatePeerKeyTofu(selectedPeer);
      if (!isValidKey) { showToast('Security Alert: Peer identity key mismatch. Contact admin.', 'error'); return; }
      keyObj = await getOrDeriveSharedKeyRef.current(privateKeyObject, selectedPeer.publicKey);
    }
    if (!keyObj) return;

    const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt') || '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > MAX_ATTACHMENT_BYTES) {
        showToast(`File "${file.name}" exceeds the 25 MB limit.`, 'error');
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
      const canSend = socket.connected && navigator.onLine;
      const status: LocalMessage['status'] = canSend ? 'sent' : 'pending_sync';
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
        isEdited: false, isDeleted: false, removed: false,
        decryptionError: undefined,
      };
      await saveMessage(localMsg);

      if (!canSend) {
        console.log('[Attachment] Queued for upload when reconnected.');
        continue;
      }

      try {
        const attachmentId = await uploadEncryptedAttachment(token, pendingUpload, (pct: number) => {
          setUploadProgress(pct);
        });
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
          onUpsertDMConversation?.(selectedPeer, text || file.name);
        }
        console.log(`[Attachment] Uploaded ${file.name} (${file.size} bytes) encrypted.`);
      } catch (e) {
        setUploadProgress(null);
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Attachment] Upload failed:', msg);
        showToast(`Failed to upload attachment: ${msg}`, 'error');
      }
    }
  }, [currentUserKeys, privateKeyObject, selectedPeer, selectedChannel, allUsers, onlineIds, onUpsertDMConversation]);

  // ── Edit Message ──────────────────────────────────────────────────────
  const handleEditMessage = useCallback(async (messageId: string, newText: string) => {
    if (!currentUserKeysRef.current) return;
    const msg = await db.messages.get(messageId);
    let keyObj: CryptoKey | null = null;
    if (msg?.channelId) {
      keyObj = await getOrGenerateChannelKeyRef.current(msg.channelId);
    } else if (msg) {
      const peerId = msg.senderId === currentUserKeysRef.current.userId ? msg.recipientId : msg.senderId;
      if (peerId) {
        const peer = allUsersRef.current.find((u: any) => u.userId === peerId);
        if (peer?.publicKey) keyObj = await getOrDeriveSharedKeyRef.current(privateKeyObjectRef.current, peer.publicKey);
      }
    }
    if (!keyObj) return;
    const { ciphertext, iv } = await encryptMessage(newText, keyObj);
    await editMessageLocally(messageId, newText, ciphertext, iv);
    socket.emit('message:edit', { id: messageId, newCiphertext: ciphertext, newIv: iv, recipientId: msg?.recipientId, channelId: msg?.channelId });
  }, []);

  // ── Delete For Me ─────────────────────────────────────────────────────
  const handleDeleteForMe = useCallback(async (messageId: string) => {
    await deleteMessageLocally(messageId);
  }, []);

  // ── Delete For Everyone ───────────────────────────────────────────────
  const handleDeleteForEveryone = useCallback(async (messageId: string) => {
    await markMessageDeletedLocally(messageId);
    const msg = await db.messages.get(messageId);
    const payload = { id: messageId, recipientId: msg?.recipientId, channelId: msg?.channelId };
    if (socket.connected) {
      socket.emit('message:delete', payload);
    } else {
      const retryHandler = () => { socket.emit('message:delete', payload); };
      socket.once('connect', retryHandler);
      setTimeout(() => socket.off('connect', retryHandler), 30000);
    }
  }, []);

  // ── Forward Message ───────────────────────────────────────────────────
  const handleForwardMessage = useCallback(async (originalText: string, target: { type: 'dm'; userId: string } | { type: 'channel'; channelId: string }) => {
    if (!currentUserKeysRef.current || !privateKeyObjectRef.current) return;
    const tempId = `temp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();
    const canSend = socket.connected && navigator.onLine;
    const status: LocalMessage['status'] = canSend ? 'sent' : 'pending_sync';

    if (target.type === 'channel') {
      let channelKey = await getOrGenerateChannelKeyRef.current(target.channelId);
      if (!channelKey) {
        socket.emit('channel:key:request', { channelId: target.channelId });
        await new Promise(r => setTimeout(r, 1500));
        channelKey = await getOrGenerateChannelKeyRef.current(target.channelId);
        if (!channelKey) {
          showToast('Cannot forward: channel key unavailable.', 'error');
          return;
        }
      }
      const { ciphertext, iv } = await encryptMessage(originalText, channelKey);
      const localMsg: LocalMessage = {
        id: tempId, tempId, senderId: currentUserKeysRef.current.userId, channelId: target.channelId,
        text: originalText, ciphertext, iv, timestamp, status, isDecrypted: true,
        isEdited: false, isDeleted: false, removed: false,
        forwardedFrom: currentUserKeysRef.current.userId,
        attachment: undefined, attachmentMeta: undefined, pendingUpload: undefined, decryptionError: undefined,
      };
      await saveMessage(localMsg);
      await markForwarded(localMsg.id);
      if (canSend) {
        socket.emit('channel:message:send', { id: tempId, tempId, senderId: currentUserKeysRef.current.userId, channelId: target.channelId, ciphertext, iv, timestamp, isForwarded: true, forwardedFrom: currentUserKeysRef.current.userId });
      }
    } else {
      const peer = allUsersRef.current.find((u: any) => u.userId === target.userId);
      if (!peer) return;
      const sharedKey = await getOrDeriveSharedKeyRef.current(privateKeyObjectRef.current, peer.publicKey);
      if (!sharedKey) return;
      const { ciphertext, iv } = await encryptMessage(originalText, sharedKey);
      const localMsg: LocalMessage = {
        id: tempId, tempId, senderId: currentUserKeysRef.current.userId, recipientId: peer.userId,
        text: originalText, ciphertext, iv, timestamp, status, isDecrypted: true,
        isEdited: false, isDeleted: false, removed: false,
        forwardedFrom: currentUserKeysRef.current.userId,
        attachment: undefined, attachmentMeta: undefined, pendingUpload: undefined, decryptionError: undefined,
      };
      await saveMessage(localMsg);
      await markForwarded(localMsg.id);
      if (canSend) {
        socket.emit('message:send', { id: tempId, tempId, senderId: currentUserKeysRef.current.userId, recipientId: peer.userId, ciphertext, iv, timestamp, isForwarded: true, forwardedFrom: currentUserKeysRef.current.userId });
      }
    }
  }, []);

  // ── Pin Message ───────────────────────────────────────────────────────
  const handlePinMessage = useCallback(async (messageId: string) => {
    if (!currentUserKeysRef.current || !selectedChannelRef.current) return;
    socket.emit('message:pin', { channelId: selectedChannelRef.current.id, messageId, userId: currentUserKeysRef.current.userId });
  }, []);

  // ── Unpin Message ─────────────────────────────────────────────────────
  const handleUnpinMessage = useCallback(async (messageId: string) => {
    if (!selectedChannelRef.current) return;
    socket.emit('message:unpin', { channelId: selectedChannelRef.current.id, messageId });
  }, []);

  // ── Full History Rehydration (GET /api/messages) ────────────────────────
  const fetchAllHistory = useCallback(async (token: string) => {
    if (!currentUserKeysRef.current) return;
    try {
      // Fetch the directory fresh so decryption doesn't depend on UI state timing
      let usersSource: User[] = allUsersRef.current;
      try {
        const usersRes = await fetch(`${API_BASE}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          usersSource = usersData.users || [];
          if (setOnlineIds) {
            setOnlineIds(prev => {
              const next = new Set(prev);
              for (const u of usersSource) {
                if (u.isOnline) next.add(u.userId);
              }
              return next;
            });
          }
        }
      } catch { /* keep existing directory */ }

      const res = await fetch(`${API_BASE}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const payloads: any[] = data.messages || [];
      const incoming: any[] = [];
      for (const payload of payloads) {
        try {
          const localMsg = await decryptPayloadRef.current(payload);
          if (localMsg) {
            await saveMessage(localMsg);
            if (payload.senderId !== currentUserKeysRef.current.userId) incoming.push(payload);
          }
        } catch {
          // Skip undecryptable messages
        }
      }
      // Notify senders that their offline messages reached our device
      for (const payload of incoming) {
        const localMsg = await db.messages.get(payload.id);
        if (localMsg?.status === 'delivered' || localMsg?.status === 'read') continue;
        socket.emit('message:delivered', { messageId: payload.id, senderId: payload.senderId });
      }
      console.log(`[History] Restored ${payloads.length} message(s) from server`);
    } catch (e) {
      console.error('[History] Global history fetch error:', e);
    }
  }, [currentUserKeys, setOnlineIds]);

  // ── Starred Messages ──────────────────────────────────────────────────────
  const fetchStarredMessages = useCallback(async (token: string, messageIds: string[]) => {
    if (!token || messageIds.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/starred/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageIds }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const starred = new Set(Object.keys(data.status || {}).filter(k => data.status[k]));
      setStarredSet(starred);
    } catch {}
  }, []);

  const handleToggleStar = useCallback(async (messageId: string, isStarred: boolean) => {
    const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
    if (!token) return;
    if (isStarred) {
      setStarredSet(prev => { const next = new Set(prev); next.delete(messageId); return next; });
      await fetch(`${API_BASE}/api/starred/${messageId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    } else {
      setStarredSet(prev => new Set(prev).add(messageId));
      await fetch(`${API_BASE}/api/starred`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageId }),
      }).catch(() => {});
    }
  }, []);

  // ── Return all functions for App.tsx consumption ────────────────────────
  return {
    handleSendMessage,
    handleForwardMessage,
    handleSendFiles,
    handleEditMessage,
    handleDeleteForMe,
    handleDeleteForEveryone,
    handlePinMessage,
    handleUnpinMessage,
    pinnedMessages,
    fetchAllHistory,
    uploadProgress,
    starredSet,
    handleToggleStar,
    fetchStarredMessages,
    decryptPayload: decryptPayloadRef.current,
  };
};