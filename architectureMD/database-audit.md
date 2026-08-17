# Vault2E — Database Architecture Audit

**Author:** Senior Distributed Systems Engineer
**Date:** 2026-08-17
**Scope:** PostgreSQL schema, transaction boundaries, race conditions, crash recovery, ACK semantics, idempotency, index analysis
**Files:** `server/src/db/schema.sql`, `server/src/db/index.ts`

---

## 1. Tables Overview

17 tables total. All in `postgres` database on embedded PostgreSQL 18.

---

## 2. Table-by-Table Analysis

### 2.1 users

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Account identity, credentials, E2EE public keys, vault backup |
| **Columns** | `id` (TEXT PK, `usr_{username}`), `username` (TEXT UNIQUE), `display_name`, `email`, `role` (ADMIN/SUPERVISOR/MEMBER), `password_hash` (bcrypt), `public_key` (ECDH SPKI Base64), `encrypted_private_key` (PBKDF2+AES-GCM vault), `key_salt`, `key_version` (INTEGER, incremented on rotation), `key_rotation_signature` (ECDSA), `old_public_key`, `signing_public_key` (ECDSA SPKI), `old_signing_public_key`, `avatar_url`, `status` (ACTIVE/SUSPENDED), `status_message`, `phone`, `banner_url`, `bio`, `deleted_at` (TIMESTAMPTZ, soft-delete), `created_at` (BIGINT epoch ms) |
| **Indexes** | PK on `id`; UNIQUE on `username` (implicit index) |
| **Transaction Behavior** | Single-row operations (`UPDATE`, `INSERT`). `deleteUser` does 3 sequential operations (channel_members, channel_keys, messages soft-delete, users soft-delete) — **NOT in a transaction**. |
| **Risks** | (1) `deleteUser` is not atomic — crash between steps leaves partial state. (2) No index on `deleted_at` — queries filtering `deleted_at IS NULL` do sequential scan on large tables. (3) `role` column has no CHECK constraint — arbitrary values can be inserted. (4) `username` UNIQUE constraint prevents resurrection of deleted accounts (good). |

### 2.2 channels

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Chat channels (official, team, private) |
| **Columns** | `id` (TEXT PK, slug), `name` (TEXT UNIQUE), `description`, `type` (official/team/private), `created_by` (FK→users), `created_at`, `is_announcement` (BOOLEAN), `allowed_roles` (TEXT[]), `slow_mode_seconds` (INTEGER) |
| **Indexes** | PK on `id`; UNIQUE on `name` (implicit) |
| **Transaction Behavior** | Single-row operations. `deleteChannel` does 5 sequential deletes — **NOT in a transaction**. |
| **Risks** | (1) `deleteChannel` not atomic — crash between steps leaves orphaned data. (2) No FK constraint on `created_by` → `users.id`. (3) `type` has no CHECK constraint. (4) `allowed_roles` is PostgreSQL array — no validation of contained values. |

### 2.3 channel_keys

| Attribute | Detail |
|-----------|--------|
| **Purpose** | ECDH-encrypted AES channel keys, per member |
| **Columns** | `id` (SERIAL PK), `channel_id` (TEXT), `user_id` (TEXT), `encrypted_channel_key` (TEXT), `iv` (TEXT) |
| **Indexes** | PK on `id`; UNIQUE on `(channel_id, user_id)` (implicit) |
| **Transaction Behavior** | `upsertChannelKeys` does N sequential upserts — **NOT in a transaction**. |
| **Risks** | (1) Partial upsert leaves some members with old keys, some with new. (2) No FK constraints to `channels` or `users`. (3) No index on `channel_id` alone — queries like `getChannelKeysForChannel` use the UNIQUE index but `getMembersWithoutKeyEnvelope` does a LEFT JOIN which may not use it optimally. |

### 2.4 messages

| Attribute | Detail |
|-----------|--------|
| **Purpose** | All DM and channel messages (encrypted ciphertext) |
| **Columns** | `id` (TEXT PK, `srv_{timestamp}` or `temp_*`), `temp_id` (TEXT), `sender_id` (TEXT), `recipient_id` (TEXT, NULL for channels), `channel_id` (TEXT, NULL for DMs), `ciphertext` (TEXT), `iv` (TEXT), `status` (sent/delivered/read), `is_edited` (BOOLEAN), `is_deleted` (BOOLEAN), `reply_to` (TEXT), `created_at` (BIGINT) |
| **Indexes** | `idx_messages_dm` on `(sender_id, recipient_id, created_at)`, `idx_messages_channel` on `(channel_id, created_at)`, `idx_messages_inbox` on `(recipient_id, status)` |
| **Transaction Behavior** | `insertMessage` uses `ON CONFLICT DO NOTHING` — atomic and idempotent. `updateMessageStatus` does SELECT then conditional UPDATE — **NOT in a transaction**. |
| **Risks** | (1) `updateMessageStatus` race: two concurrent reads see same status, both pass rank check, both write — last writer wins but result is correct (monotonic upgrade). (2) `temp_id` column unused by server queries. (3) `sender_id`, `recipient_id`, `channel_id` have no FK constraints. (4) No index on `id` alone needed (PK covers it). (5) `getMessagesForUser` does subquery on `channel_members` — may be slow for users in many channels. |

### 2.5 attachments

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Encrypted file storage metadata (binary on disk) |
| **Columns** | `id` (TEXT PK, `att_{timestamp}_{hex}`), `message_id` (TEXT, NULL until linked), `file_path` (TEXT), `encrypted_metadata` (TEXT), `iv` (TEXT), `metadata_iv` (TEXT), `created_at` (BIGINT) |
| **Indexes** | `idx_attachments_message` on `(message_id)` |
| **Transaction Behavior** | Single-row `INSERT` and `UPDATE`. `linkAttachmentToMessage` does SELECT then UPDATE — not atomic. |
| **Risks** | (1) Orphaned attachments: `message_id` NULL until linked; if crash occurs after upload but before message creation, attachment is orphaned (cleaned up after 30 min). (2) No FK to `messages`. (3) `insertAttachment` does NOT use `ON CONFLICT` — retry after crash may fail with PK violation. (4) `cleanupOrphanedAttachments` uses `RETURNING` but no transaction wrapping file deletion. |

### 2.6 channel_members

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Channel membership (who can access which channels) |
| **Columns** | `channel_id` (TEXT, PK part 1), `user_id` (TEXT, PK part 2), `assigned_by` (TEXT), `created_at` (BIGINT) |
| **Indexes** | PK on `(channel_id, user_id)`; `idx_channel_members_user` on `(user_id)` |
| **Transaction Behavior** | `addChannelMember` uses `ON CONFLICT DO NOTHING` — idempotent. `updateChannel` does DELETE all + N INSERTs — **NOT in a transaction**. |
| **Risks** | (1) `updateChannel` member replacement: crash after DELETE but before INSERTs leaves channel with no members. (2) No FK constraints to `channels` or `users`. (3) `assigned_by` has no FK. |

### 2.7 message_reactions

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Emoji reactions on messages |
| **Columns** | `message_id` (TEXT, PK part 1), `user_id` (TEXT, PK part 2), `emoji` (TEXT, PK part 3), `created_at` (BIGINT) |
| **Indexes** | PK on `(message_id, user_id, emoji)`; `idx_reactions_message` on `(message_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE with `ON CONFLICT DO NOTHING`. |
| **Risks** | Minimal. No FK constraints. Duplicate reactions safely handled by PK. |

### 2.8 pinned_messages

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Pinned messages in channels |
| **Columns** | `channel_id` (TEXT, PK part 1), `message_id` (TEXT, PK part 2), `pinned_by` (TEXT), `pinned_at` (BIGINT) |
| **Indexes** | PK on `(channel_id, message_id)`; `idx_pinned_channel` on `(channel_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE with `ON CONFLICT DO NOTHING`. |
| **Risks** | Minimal. No FK constraints. |

### 2.9 starred_messages

| Attribute | Detail |
|-----------|--------|
| **Purpose** | User-starred messages (personal bookmarks) |
| **Columns** | `user_id` (TEXT, PK part 1), `message_id` (TEXT, PK part 2), `starred_at` (BIGINT) |
| **Indexes** | PK on `(user_id, message_id)`; `idx_starred_user` on `(user_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE with `ON CONFLICT DO NOTHING`. |
| **Risks** | Minimal. No FK constraints. |

### 2.10 blocked_users

| Attribute | Detail |
|-----------|--------|
| **Purpose** | User blocking relationships |
| **Columns** | `blocker_id` (TEXT, PK part 1), `blocked_id` (TEXT, PK part 2), `created_at` (BIGINT) |
| **Indexes** | PK on `(blocker_id, blocked_id)`; `idx_blocked_blocker` on `(blocker_id)`; `idx_blocked_blocked` on `(blocked_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE with `ON CONFLICT DO NOTHING`. |
| **Risks** | Minimal. Good index coverage. |

### 2.11 audit_log

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Security/admin audit trail |
| **Columns** | `id` (SERIAL PK), `actor_id` (TEXT), `action` (TEXT), `target_type` (TEXT), `target_id` (TEXT), `details` (TEXT), `created_at` (BIGINT) |
| **Indexes** | `idx_audit_actor` on `(actor_id)`; `idx_audit_action` on `(action)`; `idx_audit_created` on `(created_at)` |
| **Transaction Behavior** | Single-row INSERT. Append-only (no updates/deletes in application code). |
| **Risks** | (1) No FK constraints. (2) No TTL/cleanup — table grows unboundedly. (3) `details` is unstructured TEXT — no schema enforcement. |

### 2.12 token_blocklist

| Attribute | Detail |
|-----------|--------|
| **Purpose** | JWT token revocation (logout, password change) |
| **Columns** | `token_hash` (TEXT PK, SHA-256 of JWT), `user_id` (TEXT), `expires_at` (BIGINT) |
| **Indexes** | PK on `token_hash`; `idx_token_blocklist_user` on `(user_id)`; `idx_token_blocklist_expires` on `(expires_at)` |
| **Transaction Behavior** | Single-row INSERT/DELETE. `cleanupExpiredTokens` deletes expired rows. |
| **Risks** | (1) `cleanupExpiredTokens` is periodic — expired tokens may persist for up to cleanup interval. (2) No FK to users. (3) Good: `isTokenBlocked` checks both hash AND `expires_at > now()` — belt-and-suspenders. |

### 2.13 friends

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Friend relationships (pending, accepted, blocked) |
| **Columns** | `user_id` (TEXT, PK part 1, FK→users ON DELETE CASCADE), `friend_id` (TEXT, PK part 2, FK→users ON DELETE CASCADE), `status` (TEXT: pending/accepted/blocked), `created_at` (BIGINT) |
| **Indexes** | PK on `(user_id, friend_id)`; `idx_friends_user` on `(user_id)`; `idx_friends_friend` on `(friend_id)`; `idx_friends_status` on `(status)` |
| **Transaction Behavior** | Single-row INSERT/UPDATE/DELETE. `acceptFriend` does conditional UPDATE. |
| **Risks** | (1) `acceptFriend` uses `(user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)` — matches both directions. Good. (2) `status` has no CHECK constraint — any string accepted. (3) Only table with FK constraints (CASCADE delete). |

### 2.14 hubs

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Discord-like servers/guilds |
| **Columns** | `id` (TEXT PK), `name` (TEXT), `description` (TEXT), `icon_url` (TEXT), `banner_url` (TEXT), `created_by` (TEXT, FK→users), `created_at` (BIGINT) |
| **Indexes** | PK on `id` |
| **Transaction Behavior** | Single-row operations. `createHub` does two sequential INSERTs (hubs + hub_members) — **NOT in a transaction**. |
| **Risks** | (1) `createHub` not atomic — crash between hub insert and member insert leaves hub with no owner. (2) No UNIQUE on `name`. (3) `created_by` FK present but no ON DELETE behavior defined. |

### 2.15 hub_members

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Hub membership with roles |
| **Columns** | `hub_id` (TEXT, PK part 1, FK→hub ON DELETE CASCADE), `user_id` (TEXT, PK part 2, FK→users ON DELETE CASCADE), `role` (TEXT: owner/admin/member), `joined_at` (BIGINT) |
| **Indexes** | PK on `(hub_id, user_id)`; `idx_hub_members_user` on `(user_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE with `ON CONFLICT DO NOTHING`. |
| **Risks** | (1) `role` has no CHECK constraint. (2) Good: CASCADE deletes from both `hubs` and `users`. |

### 2.16 groups

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Categories/channels within hubs |
| **Columns** | `id` (TEXT PK), `hub_id` (TEXT, FK→hub ON DELETE CASCADE), `name` (TEXT), `description` (TEXT), `type` (TEXT: text/voice/announcement), `position` (INTEGER), `created_at` (BIGINT) |
| **Indexes** | PK on `id`; `idx_groups_hub` on `(hub_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE. |
| **Risks** | (1) No UNIQUE on `(hub_id, name)` — duplicate group names possible. (2) `type` has no CHECK constraint. |

### 2.17 group_visibility

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Per-user group visibility (hide/show groups) |
| **Columns** | `group_id` (TEXT, PK part 1, FK→group ON DELETE CASCADE), `user_id` (TEXT, PK part 2, FK→users ON DELETE CASCADE) |
| **Indexes** | PK on `(group_id, user_id)`; `idx_group_visibility_user` on `(user_id)` |
| **Transaction Behavior** | Single-row INSERT/DELETE with `ON CONFLICT DO NOTHING`. |
| **Risks** | Minimal. Good FK cascade behavior. |

---

## 3. Transaction Boundary Analysis

### 3.1 Operations That SHOULD Be Atomic but Are NOT

| Operation | Code Location | Steps | Risk |
|-----------|---------------|-------|------|
| `deleteUser` | `index.ts:326-334` | 4 sequential queries (channel_members, channel_keys, messages, users) | Crash between steps: partial cleanup |
| `deleteChannel` | `index.ts:483-501` | 5 sequential queries (channel_keys, channel_members, attachments, messages, channels) + file deletion | Crash between steps: orphaned data |
| `updateChannel` (with memberIds) | `index.ts:439-481` | UPDATE channels + DELETE all members + N INSERTs + N key deletes | Crash after DELETE leaves channel with no members |
| `upsertChannelKeys` | `index.ts:505-516` | N sequential upserts | Partial key distribution |
| `createHub` | `index.ts:1033-1043` | INSERT hubs + INSERT hub_members | Hub without owner |

### 3.2 Operations That ARE Atomic

| Operation | Mechanism |
|-----------|-----------|
| `insertMessage` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `addChannelMember` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `addReaction` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `pinMessage` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `starMessage` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `blockUserOnServer` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `blockToken` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `addFriend` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| `joinHub` | Single `INSERT ... ON CONFLICT DO NOTHING` |
| All single-row UPDATE/DELETE | PostgreSQL statement-level atomicity |

### 3.3 Missing Transaction Wrappers

**Recommended pattern:**

```typescript
async function deleteUserAtomic(userId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM channel_keys WHERE user_id = $1', [userId]);
    await client.query('UPDATE messages SET is_deleted = TRUE WHERE sender_id = $1 OR recipient_id = $1', [userId]);
    await client.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

---

## 4. Race Condition Analysis

### 4.1 Two Messages Arriving Simultaneously

**Scenario:** Alice sends DM to Bob at the exact same time as Charlie sends DM to Bob.

**Behavior:**
- Both messages hit `insertMessage` concurrently
- Both use `ON CONFLICT DO NOTHING` — safe (different message IDs)
- Both are stored; Bob sees both on next fetch
- No data corruption

**Verdict:** ✅ Safe. Message IDs are unique (`srv_{timestamp}` or UUID-based).

### 4.2 Concurrent MLS Commits (Channel Key Rotation)

**Scenario:** Two admins rotate channel keys simultaneously.

**Behavior:**
- `upsertChannelKeys` does N sequential upserts
- First admin's keys are upserted
- Second admin's keys overwrite first admin's keys (ON CONFLICT DO UPDATE)
- Final state: second admin's keys win (last writer)
- Removed members may briefly have access to new key

**Verdict:** ⚠️ Last-writer-wins. No locking. In practice, channel key rotation is rare and typically single-initiator. Acceptable but not ideal.

### 4.3 Concurrent Message Status Updates

**Scenario:** `message:delivered` and `message:read` arrive simultaneously for same message.

**Behavior:**
- `updateMessageStatus` does SELECT → conditional UPDATE
- Race: both see `status = 'sent'`, both pass rank check
- Both write: `delivered` then `read` (or vice versa)
- Last writer sets final status
- If `read` wins: correct (higher rank)
- If `delivered` wins: next `read` receipt will upgrade it

**Verdict:** ✅ Safe. Status rank check prevents downgrade. Final state converges to highest rank received.

### 4.4 Concurrent Friend Requests

**Scenario:** Alice and Bob both send friend requests to each other simultaneously.

**Behavior:**
- Alice: `INSERT INTO friends (user_id, friend_id, status) VALUES ('alice', 'bob', 'pending')`
- Bob: `INSERT INTO friends (user_id, friend_id, status) VALUES ('bob', 'alice', 'pending')`
- Both succeed (different PKs: `(alice, bob)` vs `(bob, alice)`)
- Two pending rows exist

**Verdict:** ⚠️ Two separate pending requests instead of automatic acceptance. Acceptable UX but not ideal. `acceptFriend` handles both directions with `OR` clause.

### 4.5 Concurrent Channel Member Updates

**Scenario:** Admin removes Alice while Alice is sending a message.

**Behavior:**
- `updateChannel` deletes all members then re-adds
- Alice's message arrives after DELETE but before INSERT
- Server processes message: checks `channel_members` — Alice not found
- Message rejected or sent to no one

**Verdict:** ⚠️ Alice may lose messages during member update. Acceptable since member update is admin-initiated and infrequent.

---

## 5. Crash Recovery Analysis

### 5.1 Server Process Crash During Decrypt

**Scenario:** Server is relaying a message (not decrypting — server never decrypts). Crash during DB write.

**Behavior:**
- PostgreSQL WAL (Write-Ahead Log) ensures durability
- If crash before COMMIT: transaction rolled back, message not stored
- If crash after COMMIT: message stored, client ACK may not have been sent
- On restart: client reconnects, server redelivers undelivered messages

**Verdict:** ✅ Safe. PostgreSQL ACID guarantees. Client idempotent upsert handles redelivery.

### 5.2 Server Process Crash During Encrypt

**Scenario:** Server does NOT encrypt — encryption is client-side only. Server receives pre-encrypted ciphertext.

**Behavior:** N/A — server never performs encryption.

**Verdict:** ✅ Not applicable.

### 5.3 Server Process Crash During User Deletion

**Scenario:** `deleteUser` partially completes (e.g., channel_members deleted, channel_keys deleted, crash before messages soft-delete).

**Behavior:**
- On restart: user still has channel_keys deleted, channel_members deleted
- Messages not soft-deleted (still visible to other participants)
- User record not soft-deleted (can still login if password known)

**Verdict:** ⚠️ Partial state. User can still login. Other users' message history intact but channel membership lost. Recovery: re-run deletion manually.

### 5.4 Server Process Crash During Channel Deletion

**Scenario:** `deleteChannel` partially completes.

**Behavior:**
- Crash after deleting channel_keys, before deleting messages: messages orphaned
- Crash after deleting messages, before deleting channel record: phantom channel
- Physical `.enc` files not deleted if crash before file unlink

**Verdict:** ⚠️ Partial state. Orphaned data accumulates. No automatic cleanup for partial deletions.

---

## 6. ACK Semantics

### 6.1 Message Send ACK

**Flow:**
1. Client sends `message:send` via socket
2. Server persists message to PostgreSQL (`INSERT ... ON CONFLICT DO NOTHING`)
3. Server emits `message:ack` to sender
4. Server emits `message:receive` to recipient(s)

**If DB write succeeds but ACK fails:**
- Server has message stored
- Sender does not receive ACK
- Sender retries on reconnect? No — current implementation does NOT retry sends
- Message is lost from sender's perspective (but server has it)

**Verdict:** ⚠️ Sender may not see confirmation. On reconnect, `getMessagesForUser` will return the message. No data loss, but UX gap.

### 6.2 Message Delivery ACK

**Flow:**
1. Recipient comes online
2. Server sends undelivered messages
3. Client processes and marks as delivered
4. Client emits `message:delivered` to server
5. Server updates `status = 'delivered'`

**If client ACK fails:**
- Server has `status = 'sent'`
- Next time recipient connects, server sends same messages again
- Client's Dexie upsert with same message ID overwrites (idempotent)

**Verdict:** ✅ Safe. Idempotent upsert handles redelivery.

### 6.3 Read Receipt ACK

**Flow:** Similar to delivery ACK but with `status = 'read'`.

**Verdict:** ✅ Safe. Same idempotency guarantees.

---

## 7. Idempotency Analysis

| Operation | Idempotent? | Mechanism |
|-----------|-------------|-----------|
| `insertMessage` | ✅ YES | `ON CONFLICT DO NOTHING` — duplicate ID silently ignored |
| `addChannelMember` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `addReaction` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `pinMessage` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `starMessage` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `blockUserOnServer` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `blockToken` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `addFriend` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `joinHub` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `insertChannel` | ✅ YES | `ON CONFLICT DO NOTHING` |
| `insertAttachment` | ❌ NO | Plain `INSERT` — retry after crash fails with PK violation |
| `updateMessageStatus` | ✅ YES | Status rank guard prevents downgrade; re-applying same status is no-op |
| `deleteUser` | ⚠️ PARTIAL | First call succeeds; second call: channel_members/channel_keys already deleted (no-op), messages already soft-deleted (no-op), user already soft-deleted (no-op) |
| `deleteChannel` | ⚠️ PARTIAL | Similar to deleteUser — subsequent calls find nothing to delete |
| `upsertChannelKeys` | ✅ YES | `ON CONFLICT DO UPDATE` — overwrites with same data |

### 7.1 Idempotency Gap: insertAttachment

**Current code:**
```typescript
await getPool().query(
  `INSERT INTO attachments (...) VALUES (...)`,
  [...]
);
```

**Recommended fix:**
```typescript
await getPool().query(
  `INSERT INTO attachments (...) VALUES (...) ON CONFLICT (id) DO NOTHING`,
  [...]
);
```

---

## 8. Index Analysis

### 8.1 Index Inventory

| Table | Index Name | Columns | Purpose | Used By |
|-------|-----------|---------|---------|---------|
| messages | `idx_messages_dm` | `(sender_id, recipient_id, created_at)` | DM history queries | `getDirectMessages` |
| messages | `idx_messages_channel` | `(channel_id, created_at)` | Channel history queries | `getChannelMessages` |
| messages | `idx_messages_inbox` | `(recipient_id, status)` | Undelivered message fetch | `getUndeliveredMessages`, `markIncomingDelivered` |
| attachments | `idx_attachments_message` | `(message_id)` | Attachment lookup by message | `getAttachmentByMessageId`, `getAttachmentsByMessageIds` |
| channel_members | `idx_channel_members_user` | `(user_id)` | User's channel list | `getChannelsForUser` |
| message_reactions | `idx_reactions_message` | `(message_id)` | Reactions per message | `getReactionsForMessage` |
| pinned_messages | `idx_pinned_channel` | `(channel_id)` | Pinned messages per channel | `getPinnedMessages` |
| starred_messages | `idx_starred_user` | `(user_id)` | User's starred list | `getStarredMessages`, `getStarredStatus` |
| blocked_users | `idx_blocked_blocker` | `(blocker_id)` | Block list lookup | `getBlockedUsersOf` |
| blocked_users | `idx_blocked_blocked` | `(blocked_id)` | Who blocked me | `getBlockedByUsers` |
| audit_log | `idx_audit_actor` | `(actor_id)` | Audit by actor | `getAuditLog` (filter) |
| audit_log | `idx_audit_action` | `(action)` | Audit by action type | `getAuditLog` (filter) |
| audit_log | `idx_audit_created` | `(created_at)` | Audit by time range | `getAuditLog` (ORDER BY) |
| token_blocklist | `idx_token_blocklist_user` | `(user_id)` | User token lookup | — (unused in current code) |
| token_blocklist | `idx_token_blocklist_expires` | `(expires_at)` | Cleanup expired tokens | `cleanupExpiredTokens` |
| friends | `idx_friends_user` | `(user_id)` | User's friends list | `getFriends` |
| friends | `idx_friends_friend` | `(friend_id)` | Incoming friend requests | `getFriendRequests` |
| friends | `idx_friends_status` | `(status)` | Filter by status | — (unused in current code) |
| hub_members | `idx_hub_members_user` | `(user_id)` | User's hubs | `getUserHubs` |
| groups | `idx_groups_hub` | `(hub_id)` | Groups per hub | `getHubGroups` |
| group_visibility | `idx_group_visibility_user` | `(user_id)` | User's visible groups | `getVisibleGroups` |

### 8.2 Missing Indexes

| Table | Recommended Index | Reason |
|-------|------------------|--------|
| users | `(deleted_at)` | `getUserById`, `getUserByUsername`, `getAllUsers` all filter `deleted_at IS NULL` |
| users | `(status)` | Admin queries filtering active/suspended users |
| messages | `(temp_id)` | `deleteUndecryptableMessages` filters `id LIKE 'temp_%'` — full table scan |
| channel_keys | `(channel_id)` | `getChannelKeysForChannel` — relies on UNIQUE index which may not be optimal for range scans |
| attachments | `(created_at)` | `cleanupOrphanedAttachments` filters `created_at < $1` — full table scan |
| audit_log | Composite `(action, created_at)` | Common query pattern: filter by action + sort by time |

### 8.3 Unused Indexes

| Index | Reason |
|-------|--------|
| `idx_token_blocklist_user` | No query filters by `user_id` on token_blocklist |
| `idx_friends_status` | No query filters by `status` alone |

### 8.4 Query Performance Concerns

| Query | Concern | Recommendation |
|-------|---------|----------------|
| `getMessagesForUser` | Subquery on `channel_members` for each user; no covering index | Add composite index or materialize channel list |
| `getAllChannels` | Fetches ALL channels then filters in JS | Push type filter to SQL |
| `getDirectMessages` | OR condition on `(sender_id, recipient_id)` — may not use single index | Consider UNION or pg_hint |
| `getReactionsForMessages` | `ANY($1)` with array — depends on array size | Batch if >100 message IDs |

---

## 9. Summary of Risks

| # | Risk | Severity | Table(s) |
|---|------|----------|----------|
| 1 | `deleteUser` not atomic — partial cleanup on crash | **HIGH** | users, channel_members, channel_keys, messages |
| 2 | `deleteChannel` not atomic — orphaned data | **HIGH** | channels, messages, attachments, channel_keys, channel_members |
| 3 | `updateChannel` member replacement not atomic | **HIGH** | channel_members, channel_keys |
| 4 | `insertAttachment` not idempotent — retry fails on PK | **MEDIUM** | attachments |
| 5 | Missing index on `users.deleted_at` | **MEDIUM** | users |
| 6 | Missing index on `attachments.created_at` | **LOW** | attachments |
| 7 | No CHECK constraints on `role`, `status`, `type` columns | **LOW** | users, channels, friends, hub_members, groups |
| 8 | No FK constraints on most tables | **LOW** | All except friends, hub_members, groups, group_visibility |
| 9 | `audit_log` grows unboundedly — no TTL | **LOW** | audit_log |
| 10 | `token_blocklist` cleanup depends on periodic job | **LOW** | token_blocklist |
