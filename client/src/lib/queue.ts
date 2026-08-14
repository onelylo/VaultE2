/**
 * PetroShield Offline Sync Engine
 * - useNetworkStatus: tracks navigator.onLine + socket connection state
 * - processOfflineQueue: replays pending_sync messages on reconnect
 */
import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { EncryptedPayload, LocalMessage, AttachmentPayload } from '../types/chat';
import { getPendingSyncMessages, updateMessageStatus, clearPendingUpload, getChannelKey } from './db';
import { encryptMessage, deriveSharedKey, importPublicKey, importSymmetricKeyFromJwk } from './crypto';
import { uploadEncryptedAttachment } from './attachments';

// ─── Network Status Hook ──────────────────────────────────────────────────────

export interface NetworkStatus {
  isOnline: boolean;        // navigator.onLine
  isSocketConnected: boolean; // socket.connected
  isOffline: boolean;       // true if either layer is down
  pendingCount: number;     // number of queued messages awaiting sync
}

/**
 * Custom hook that tracks navigator.onLine and socket connection state.
 * Re-renders consumers only when either status changes.
 */
export function useNetworkStatus(
  socket: Socket,
  currentUserId: string | undefined
): NetworkStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [pendingCount, setPendingCount] = useState(0);

  // Track browser-level network
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Track socket-level connection
  useEffect(() => {
    const handleConnect = () => setIsSocketConnected(true);
    const handleDisconnect = () => setIsSocketConnected(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket]);

  // Refresh pending count whenever userId changes or connection restores
  useEffect(() => {
    if (!currentUserId) {
      setPendingCount(0);
      return;
    }
    getPendingSyncMessages(currentUserId).then(msgs => setPendingCount(msgs.length));
  }, [currentUserId, isSocketConnected, isOnline]);

  return {
    isOnline,
    isSocketConnected,
    isOffline: !isOnline || !isSocketConnected,
    pendingCount,
  };
}

// ─── Offline Queue Processor ──────────────────────────────────────────────────

interface QueueProcessorOptions {
  senderId: string;
  socket: Socket;
  /** JWT used to upload queued encrypted attachments */
  token: string;
  /** Map<peerUserId, CryptoKey> — already-derived shared keys cache */
  sharedKeysCache: Map<string, CryptoKey>;
  /** privateKey is needed if a shared key isn't cached yet */
  privateKey: CryptoKey | null;
  /** Active users list for public key lookup if a shared key is missing */
  activeUsers: Array<{ userId: string; publicKey: string }>;
  /** Called after each message is flushed so UI state can update */
  onMessageFlushed: (msg: LocalMessage) => void;
  /** Called when the flush is complete to refresh pending count */
  onQueueEmpty: () => void;
}

/**
 * Processes pending_sync messages in strict chronological order.
 * Each message is re-encrypted (using the cached shared key) and emitted
 * over the socket. Status is updated to 'sent' in IndexedDB on success.
 * Queued attachments are uploaded to the server first, then the message is
 * sent with the returned attachmentId.
 */
export async function processOfflineQueue(opts: QueueProcessorOptions): Promise<void> {
  const {
    senderId,
    socket,
    token,
    sharedKeysCache,
    privateKey,
    activeUsers,
    onMessageFlushed,
    onQueueEmpty,
  } = opts;

  const pending = await getPendingSyncMessages(senderId);
  if (pending.length === 0) {
    onQueueEmpty();
    return;
  }

  console.log(`[Queue] Flushing ${pending.length} pending message(s)…`);

  for (const msg of pending) {
    try {
      let sharedKey: CryptoKey | null = null;

      // Channel messages: use the channel symmetric key
      if (msg.channelId) {
        const stored = await getChannelKey(msg.channelId);
        if (stored?.keyJwk) {
          sharedKey = await importSymmetricKeyFromJwk(stored.keyJwk);
        }
        if (!sharedKey) {
          console.warn(`[Queue] No channel key for ${msg.channelId} — skipping message ${msg.id}`);
          continue;
        }
      } else {
        // DM messages: derive shared ECDH key for the recipient
        sharedKey = sharedKeysCache.get(msg.recipientId!) || null;

        if (!sharedKey && privateKey) {
          const peer = activeUsers.find(u => u.userId === msg.recipientId);
          if (peer) {
            const peerPubKey = await importPublicKey(peer.publicKey);
            sharedKey = await deriveSharedKey(privateKey, peerPubKey);
            sharedKeysCache.set(msg.recipientId!, sharedKey);
          }
        }

        if (!sharedKey) {
          console.warn(`[Queue] No shared key for ${msg.recipientId} — skipping message ${msg.id}`);
          continue;
        }
      }

      let ciphertext = msg.ciphertext;
      let iv = msg.iv;
      let attachment: AttachmentPayload | undefined;

      if (msg.pendingUpload) {
        // Upload the encrypted bytes first, then reference the server id
        const attachmentId = await uploadEncryptedAttachment(token, msg.pendingUpload);
        attachment = {
          attachmentId,
          encryptedMetadata: msg.pendingUpload.encryptedMetadata,
          iv: msg.pendingUpload.metadataIv,
          binaryIv: msg.pendingUpload.binaryIv,
        };
        await clearPendingUpload(msg.id);
        console.log(`[Queue] Uploaded queued attachment ${attachmentId} for message ${msg.id}`);
      } else if (msg.text) {
        // Re-encrypt with fresh IV (original IV was for the offline copy)
        const encrypted = await encryptMessage(msg.text, sharedKey);
        ciphertext = encrypted.ciphertext;
        iv = encrypted.iv;
      }

      const payload: EncryptedPayload = {
        id: msg.id,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        ciphertext,
        iv,
        timestamp: msg.timestamp,
        attachment,
      };

      if (msg.channelId) {
        payload.channelId = msg.channelId;
        socket.emit('channel:message:send', payload);
      } else {
        socket.emit('message:send', payload);
      }

      // Update DB and notify UI
      await updateMessageStatus(msg.id, 'sent');
      onMessageFlushed({ ...msg, ciphertext, iv, status: 'sent', attachment, pendingUpload: undefined });

      console.log(`[Queue] Flushed message ${msg.id} → ${msg.recipientId || msg.channelId}`);
    } catch (err) {
      console.error(`[Queue] Failed to flush message ${msg.id}:`, err);
      // Leave as pending_sync — will retry on next reconnect
    }
  }

  onQueueEmpty();
}
