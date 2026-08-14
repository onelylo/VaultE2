import Dexie, { type Table } from 'dexie';
import type {
  LocalMessage,
  UserKeyPair,
  TrustedKey,
  Channel,
  ChannelKey
} from '../types/chat';

export class VaultChatDatabase extends Dexie {
  keys!: Table<UserKeyPair, string>;
  messages!: Table<LocalMessage, string>;
  trustedKeys!: Table<TrustedKey, string>;
  channels!: Table<Channel, string>;
  channelKeys!: Table<ChannelKey, string>;
  mutedConversations!: Table<{ conversationId: string }, string>;
  blockedUsers!: Table<{ userId: string }, string>;
  drafts!: Table<{ conversationId: string; text: string }, string>;
  forwardedMessages!: Table<{ messageId: string }, string>;

  constructor() {
    super('VaultChatDB');

    // v1-v4: legacy schemas (kept for migration)
    this.version(1).stores({ keys: 'userId, username, createdAt', messages: 'id, senderId, recipientId, timestamp, [senderId+recipientId]' });
    this.version(2).stores({ keys: 'userId, username, createdAt', messages: 'id, senderId, recipientId, timestamp, status, [senderId+recipientId]' });
    this.version(3).stores({ keys: 'userId, username, role, createdAt', messages: 'id, senderId, recipientId, timestamp, status, [senderId+recipientId]', trustedKeys: 'peerUserId, fingerprint, firstSeenAt', emergencyAlerts: 'id, timestamp', shiftHandovers: 'id, channelId, timestamp' });
    this.version(4).stores({ keys: 'userId, username, role, createdAt', messages: 'id, tempId, senderId, recipientId, channelId, timestamp, status, [senderId+recipientId]', trustedKeys: 'peerUserId, fingerprint, firstSeenAt', emergencyAlerts: 'id, timestamp', shiftHandovers: 'id, channelId, timestamp', channels: 'id, name, type', channelKeys: 'channelId' });

    // v5: Remove emergency/shift tables, clean schema
    this.version(5).stores({
      keys:        'userId, username, role, createdAt',
      messages:    'id, tempId, senderId, recipientId, channelId, timestamp, status, [senderId+recipientId]',
      trustedKeys: 'peerUserId, fingerprint, firstSeenAt',
      channels:    'id, name, type',
      channelKeys: 'channelId',
      // Drop emergencyAlerts and shiftHandovers by omitting them
    }).upgrade(trans => {
      // Dexie will drop tables not listed; nothing else to migrate
      console.log('[DB] Migrated to v5 — emergency/shift tables removed');
    });

    // v6: Add muted conversations + blocked users
    this.version(6).stores({
      keys:        'userId, username, role, createdAt',
      messages:    'id, tempId, senderId, recipientId, channelId, timestamp, status, [senderId+recipientId]',
      trustedKeys: 'peerUserId, fingerprint, firstSeenAt',
      channels:    'id, name, type',
      channelKeys: 'channelId',
      mutedConversations: 'conversationId',
      blockedUsers: 'userId',
      drafts: 'conversationId',
      forwardedMessages: 'messageId',
    });
  }
}

export const db = new VaultChatDatabase();

// ── User Key Pair ──────────────────────────────────────────────────────────────

export async function saveUserKeyPair(keyPair: UserKeyPair): Promise<void> {
  await db.keys.put(keyPair);
}

export async function getUserKeyPair(userId: string): Promise<UserKeyPair | undefined> {
  return await db.keys.get(userId);
}

/** Returns the most-recently stored keypair (for single-account rehydration) */
export async function getAnyUserKeyPair(): Promise<UserKeyPair | undefined> {
  const all = await db.keys.orderBy('createdAt').reverse().limit(1).toArray();
  return all[0];
}

// ── Messages ───────────────────────────────────────────────────────────────────

const STATUS_RANK: Record<string, number> = {
  pending_sync: 0,
  received: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export async function saveMessage(msg: LocalMessage): Promise<void> {
  // Server messages always come with status 'received' from decryptPayload,
  // which would downgrade local 'delivered'/'read' status on re-fetch.
  // Preserve the higher of the two statuses.
  const existing = await db.messages.get(msg.id);
  if (existing) {
    const existingRank = STATUS_RANK[existing.status] ?? 0;
    const incomingRank = STATUS_RANK[msg.status ?? ''] ?? 0;
    if (existingRank > incomingRank) {
      await db.messages.put({ ...msg, status: existing.status });
      return;
    }
  }
  await db.messages.put(msg);
}

/** Returns unique userIds the current user has DM conversations with, sorted by most recent message */
export async function getActiveDMPartners(currentUserId: string): Promise<string[]> {
  const allMsgs = await db.messages.toArray();
  const dmMsgs = allMsgs.filter(m => !m.channelId && (m.senderId === currentUserId || m.recipientId === currentUserId));
  const partnerMap = new Map<string, number>();
  for (const msg of dmMsgs) {
    const partnerId = msg.senderId === currentUserId ? msg.recipientId : msg.senderId;
    if (partnerId && (!partnerMap.has(partnerId) || msg.timestamp > partnerMap.get(partnerId)!)) {
      partnerMap.set(partnerId, msg.timestamp);
    }
  }
  return Array.from(partnerMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

export async function getPendingSyncMessages(senderId: string): Promise<LocalMessage[]> {
  const pending = await db.messages.where('status').equals('pending_sync').toArray();
  return pending.filter(m => m.senderId === senderId).sort((a, b) => a.timestamp - b.timestamp);
}

export async function updateMessageStatus(
  id: string,
  status: LocalMessage['status'],
  newId?: string
): Promise<void> {
  // Try direct ID first
  const existing = await db.messages.get(id);
  const target = existing || await db.messages.where('tempId').equals(id).first();
  if (!target) return;

  // Prevent status downgrade (e.g. 'read' → 'sent' from stale ack)
  const existingRank = STATUS_RANK[target.status] ?? 0;
  const incomingRank = STATUS_RANK[status] ?? 0;
  if (incomingRank < existingRank) return;

  const targetId = target.id;
  if (newId && newId !== targetId) {
    await db.messages.delete(targetId);
    await db.messages.put({ ...target, id: newId, status });
  } else {
    await db.messages.update(targetId, { status });
  }
}

export async function bulkUpdateMessageStatus(
  ids: string[],
  status: LocalMessage['status']
): Promise<void> {
  const incomingRank = STATUS_RANK[status] ?? 0;
  const messages = await db.messages.bulkGet(ids);
  const updates = ids.map((id, i) => {
    const msg = messages[i];
    if (!msg) return Promise.resolve(0);
    const existingRank = STATUS_RANK[msg.status] ?? 0;
    if (incomingRank < existingRank) return Promise.resolve(0);
    return db.messages.update(id, { status });
  });
  await Promise.all(updates);
}

export async function editMessageLocally(id: string, newText: string, newCiphertext: string, newIv: string): Promise<void> {
  const msg = await db.messages.get(id);
  if (msg) await db.messages.update(id, { text: newText, ciphertext: newCiphertext, iv: newIv, isEdited: true });
}

/** Removes the queued upload from a message after its attachment reaches the server */
export async function clearPendingUpload(id: string): Promise<void> {
  const msg = await db.messages.get(id);
  if (msg) await db.messages.update(id, { pendingUpload: undefined });
}

export async function deleteMessageLocally(id: string): Promise<void> {
  await db.messages.delete(id);
}

export async function markMessageDeletedLocally(id: string): Promise<void> {
  const msg = await db.messages.get(id);
  if (msg) await db.messages.update(id, { text: '🚫 This message was deleted', isDeleted: true });
}

// ── TOFU Key Pinning ───────────────────────────────────────────────────────────

export async function getTrustedKey(peerUserId: string): Promise<TrustedKey | undefined> {
  return await db.trustedKeys.get(peerUserId);
}

export async function saveTrustedKey(key: TrustedKey): Promise<void> {
  await db.trustedKeys.put(key);
}

// ── Channels ───────────────────────────────────────────────────────────────────

export async function saveChannel(channel: Channel): Promise<void> {
  await db.channels.put(channel);
}

export async function getStoredChannels(): Promise<Channel[]> {
  return await db.channels.toArray();
}

export async function saveChannelKey(key: ChannelKey): Promise<void> {
  await db.channelKeys.put(key);
}

export async function getChannelKey(channelId: string): Promise<ChannelKey | undefined> {
  return await db.channelKeys.get(channelId);
}

// ── Muted Conversations ────────────────────────────────────────────────────────

export async function muteConversation(conversationId: string): Promise<void> {
  await db.mutedConversations.put({ conversationId });
}

export async function unmuteConversation(conversationId: string): Promise<void> {
  await db.mutedConversations.delete(conversationId);
}

export async function isConversationMuted(conversationId: string): Promise<boolean> {
  const entry = await db.mutedConversations.get(conversationId);
  return !!entry;
}

export async function getMutedConversations(): Promise<Set<string>> {
  const all = await db.mutedConversations.toArray();
  return new Set(all.map(e => e.conversationId));
}

// ── Blocked Users ──────────────────────────────────────────────────────────────

export async function blockUser(userId: string): Promise<void> {
  await db.blockedUsers.put({ userId });
}

export async function unblockUser(userId: string): Promise<void> {
  await db.blockedUsers.delete(userId);
}

export async function isUserBlocked(userId: string): Promise<boolean> {
  const entry = await db.blockedUsers.get(userId);
  return !!entry;
}

export async function getBlockedUsers(): Promise<Set<string>> {
  const all = await db.blockedUsers.toArray();
  return new Set(all.map(e => e.userId));
}

// ── Drafts ─────────────────────────────────────────────────────────────────────

export async function saveDraft(conversationId: string, text: string): Promise<void> {
  if (!text.trim()) {
    await db.drafts.delete(conversationId);
  } else {
    await db.drafts.put({ conversationId, text });
  }
}

export async function getDraft(conversationId: string): Promise<string> {
  const draft = await db.drafts.get(conversationId);
  return draft?.text || '';
}

export async function deleteDraft(conversationId: string): Promise<void> {
  await db.drafts.delete(conversationId);
}

// ── Forwarded Messages ─────────────────────────────────────────────────────────

export async function markForwarded(messageId: string): Promise<void> {
  await db.forwardedMessages.put({ messageId });
}

export async function getForwardedStatus(messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const all = await db.forwardedMessages.toArray();
  const idSet = new Set(messageIds);
  return new Set(all.filter(e => idSet.has(e.messageId)).map(e => e.messageId));
}
