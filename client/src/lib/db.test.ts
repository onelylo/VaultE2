import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, saveMessage, updateMessageStatus, deleteMessageLocally, blockUser, unblockUser, isUserBlocked, getBlockedUsers } from './db';
import type { LocalMessage } from '../types/chat';

// Helper to create a test message
function createTestMessage(overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    senderId: 'user1',
    recipientId: 'user2',
    text: 'Test message',
    ciphertext: 'encrypted-text',
    iv: 'test-iv',
    timestamp: Date.now(),
    status: 'pending_sync',
    isDecrypted: true,
    ...overrides,
  };
}

describe('VaultChatDatabase - Messages', () => {
  beforeEach(async () => {
    // Clear the messages table before each test
    await db.messages.clear();
  });

  it('should save and retrieve a message', async () => {
    const msg = createTestMessage({ id: 'msg-1', text: 'Hello World' });
    await saveMessage(msg);

    const retrieved = await db.messages.get('msg-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.text).toBe('Hello World');
    expect(retrieved?.senderId).toBe('user1');
    expect(retrieved?.recipientId).toBe('user2');
  });

  it('should update an existing message', async () => {
    const msg = createTestMessage({ id: 'msg-2', text: 'Original text' });
    await saveMessage(msg);

    const updated = createTestMessage({ id: 'msg-2', text: 'Updated text' });
    await saveMessage(updated);

    const retrieved = await db.messages.get('msg-2');
    expect(retrieved?.text).toBe('Updated text');
  });

  it('should preserve higher status when saving existing message', async () => {
    const msg = createTestMessage({ id: 'msg-3', status: 'delivered' });
    await saveMessage(msg);

    // Try to save with lower status
    const lowerStatus = createTestMessage({ id: 'msg-3', status: 'sent' });
    await saveMessage(lowerStatus);

    const retrieved = await db.messages.get('msg-3');
    expect(retrieved?.status).toBe('delivered');
  });

  it('should delete a message locally', async () => {
    const msg = createTestMessage({ id: 'msg-4', text: 'To be deleted' });
    await saveMessage(msg);

    await deleteMessageLocally('msg-4');

    const retrieved = await db.messages.get('msg-4');
    expect(retrieved?.isDeleted).toBe(true);
  });

  it('should mark message as removed after second delete', async () => {
    const msg = createTestMessage({ id: 'msg-5', text: 'To be removed' });
    await saveMessage(msg);

    // First delete
    await deleteMessageLocally('msg-5');
    let retrieved = await db.messages.get('msg-5');
    expect(retrieved?.isDeleted).toBe(true);

    // Second delete
    await deleteMessageLocally('msg-5');
    retrieved = await db.messages.get('msg-5');
    expect(retrieved?.removed).toBe(true);
  });
});

describe('VaultChatDatabase - Status Transitions', () => {
  beforeEach(async () => {
    await db.messages.clear();
  });

  it('should update message status from pending_sync to sent', async () => {
    const msg = createTestMessage({ id: 'status-1', status: 'pending_sync' });
    await saveMessage(msg);

    await updateMessageStatus('status-1', 'sent');

    const retrieved = await db.messages.get('status-1');
    expect(retrieved?.status).toBe('sent');
  });

  it('should update message status from sent to delivered', async () => {
    const msg = createTestMessage({ id: 'status-2', status: 'sent' });
    await saveMessage(msg);

    await updateMessageStatus('status-2', 'delivered');

    const retrieved = await db.messages.get('status-2');
    expect(retrieved?.status).toBe('delivered');
  });

  it('should update message status from delivered to read', async () => {
    const msg = createTestMessage({ id: 'status-3', status: 'delivered' });
    await saveMessage(msg);

    await updateMessageStatus('status-3', 'read');

    const retrieved = await db.messages.get('status-3');
    expect(retrieved?.status).toBe('read');
  });

  it('should not downgrade status from read to sent', async () => {
    const msg = createTestMessage({ id: 'status-4', status: 'read' });
    await saveMessage(msg);

    await updateMessageStatus('status-4', 'sent');

    const retrieved = await db.messages.get('status-4');
    expect(retrieved?.status).toBe('read');
  });

  it('should not downgrade status from delivered to pending_sync', async () => {
    const msg = createTestMessage({ id: 'status-5', status: 'delivered' });
    await saveMessage(msg);

    await updateMessageStatus('status-5', 'pending_sync');

    const retrieved = await db.messages.get('status-5');
    expect(retrieved?.status).toBe('delivered');
  });
});

describe('VaultChatDatabase - Blocked Users', () => {
  beforeEach(async () => {
    await db.blockedUsers.clear();
  });

  it('should block a user', async () => {
    await blockUser('user-to-block');

    const blocked = await isUserBlocked('user-to-block');
    expect(blocked).toBe(true);
  });

  it('should unblock a user', async () => {
    await blockUser('user-to-unblock');
    await unblockUser('user-to-unblock');

    const blocked = await isUserBlocked('user-to-unblock');
    expect(blocked).toBe(false);
  });

  it('should return false for non-blocked user', async () => {
    const blocked = await isUserBlocked('non-blocked-user');
    expect(blocked).toBe(false);
  });

  it('should get all blocked users', async () => {
    await blockUser('blocked-1');
    await blockUser('blocked-2');
    await blockUser('blocked-3');

    const blockedUsers = await getBlockedUsers();
    expect(blockedUsers.size).toBe(3);
    expect(blockedUsers.has('blocked-1')).toBe(true);
    expect(blockedUsers.has('blocked-2')).toBe(true);
    expect(blockedUsers.has('blocked-3')).toBe(true);
  });

  it('should handle blocking same user twice', async () => {
    await blockUser('duplicate-block');
    await blockUser('duplicate-block');

    const blockedUsers = await getBlockedUsers();
    expect(blockedUsers.size).toBe(1);
  });
});
