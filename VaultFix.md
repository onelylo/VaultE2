# Vault2E vs PetroShield-Chat: Full Audit Report

## Executive Summary

The refactoring from monolithic `App.tsx` (2853 lines) to 7 hooks extracted ~80% of the logic but left **critical features as stubs or missing entirely**. The app can send/receive basic DMs and channels, but loses: edit/delete/forward/pin, unread badges, sidebar reactivity, message search, admin panel, key rotation, MITM protection, channel history loading, and many edge cases.

---

## CRITICAL (App is broken without these)

### 1. `resolveMessageKey` generates a NEW key instead of looking up existing one
- **Stable**: Calls `getOrGenerateChannelKey(channelId)` — looks up the stored key
- **Vault2E**: Calls `crypto.generateChannelSymmetricKey()` — generates a **random** key every time
- **Impact**: Any channel file operations or key-dependent operations will use wrong key
- **File**: `App.tsx:209`

### 2. All edit/delete/forward/pin/unpin are no-op stubs
- **Stable**: Full implementations with server calls, socket events, Dexie updates
- **Vault2E**: `handleForwardMessage`, `handleEditMessage`, `handleDeleteForMe`, `handleDeleteForEveryone`, `handlePinMessage`, `handleUnpinMessage` are all `async () => {}`
- **File**: `useMessages.ts:616-622`

### 3. `validatePeerKeyTofu` is a stub (always returns true)
- **Stable**: Full TOFU: checks `getTrustedKey()`, stores fingerprints, verifies signed key rotation chains
- **Vault2E**: Always returns `true` — zero MITM protection
- **File**: `crypto.ts:573-583`

### 4. `handleTrustNewKey` doesn't re-decrypt messages
- **Stable**: Saves trusted key, clears cache, re-fetches pubkey, re-derives key, re-decrypts ALL undecrypted DMs from that peer
- **Vault2E**: Just derives key + clears warning. Previously broken messages stay broken.
- **File**: `App.tsx:264-269`

### 5. No admin operations work
- `onSetRole`: `async () => false` (no-op)
- `onDeleteUser`: `async () => false` (no-op)
- No admin role guard — any user can trigger admin panel
- **File**: `App.tsx:597-598`

### 6. `handleRotateKey` is completely missing
- **Stable**: Full key rotation with ECDH+ECDSA, signing, vault re-wrap, server POST
- **Vault2E**: Doesn't exist anywhere
- **Impact**: Users cannot rotate compromised keys

### 7. No channel key distribution to members
- **Stable**: On channel creation, key is encrypted for each member and POSTed to server
- **Vault2E**: `handleCreateChannel` generates key but distribution is `// The full encryption logic is in App.tsx/socket handlers for now`
- **Impact**: New channel members can't decrypt anything

### 8. `onChannelMemberAdded` key distribution is a stub
- **Stable**: Fetches channel key, derives ECDH with new member, encrypts and POSTs
- **Vault2E**: `// Distribute channel key to new member` (comment only)

### 9. `onChannelKeyRotated` re-distribution is a stub
- **Stable**: Creator regenerates key, re-encrypts for all remaining members
- **Vault2E**: `// Distribute to remaining members - simplified` (comment only)

---

## HIGH (Major functionality broken)

### 10. Unread badges are always empty
- **Stable**: `unreadDMs` and `unreadChannels` computed from Dexie liveQuery, passed to Sidebar
- **Vault2E**: `unreadDMs={}` and `unreadChannels={}` hardcoded
- **File**: `App.tsx:559-560`

### 11. Recent DMs / sidebar order resets on refresh
- **Stable**: `recentDMs` loaded from `getActiveDMPartners()`, `latestDMMessages` shows preview text
- **Vault2E**: `recentDMs={}`, `latestDMMessages={}` hardcoded
- **File**: `App.tsx:561-562`

### 12. Channel messages missing from history rehydration
- **Stable**: `fetchAllHistory` decrypts ALL messages (DM + channel)
- **Vault2E**: `if (payload.channelId) return null;` — skips channels entirely
- **File**: `App.tsx:511`

### 13. No per-conversation history fetch
- **Stable**: `handleSelectPeer` fetches `GET /api/messages/direct/{userId}`, `handleSelectChannel` fetches channel key + history
- **Vault2E**: `handleSelectUser`/`handleSelectChannel` just set state — no server fetch
- **File**: `App.tsx:217-232`

### 14. No sidebar reorder on messages
- **Stable**: `upsertDMConversation()` called on send + receive to move conversation to top
- **Vault2E**: Missing entirely
- **Impact**: Sidebar order is static, doesn't reflect recent activity

### 15. `handleUpdateProfile` doesn't update local state
- **Stable**: Updates `currentUserKeys`, persists to IndexedDB, emits `user:join`
- **Vault2E**: Just PATCHes API, doesn't update local state or emit socket event
- **File**: `App.tsx:489-500`

### 16. Decryption retry doesn't invalidate stale cache
- **Stable**: Before retry, deletes stale entries from `sharedKeysCache`
- **Vault2E**: No cache invalidation — stale key stays cached, retries use same bad key
- **File**: `useMessages.ts:264-279`

### 17. `handleSelectChannel` doesn't join room or request keys
- **Stable**: Emits `channel:join`, requests key if missing, waits 1.5s, retries
- **Vault2E**: Just sets state

### 18. Upload progress is always null
- **Stable**: `uploadProgress` state updated during file upload
- **Vault2E**: `uploadProgress={null}` hardcoded, callback is no-op
- **File**: `App.tsx:629`

### 19. `fetchAllHistory` doesn't fetch fresh user directory first
- **Stable**: Fetches directory BEFORE decrypting (avoids stale keys)
- **Vault2E**: Uses whatever `allUsersRef.current` has (may be empty/stale)

---

## MEDIUM (Missing features / degraded behavior)

### 20. No typing indicators sent from App
- **Stable**: `handleTyping`/`handleTypingStart`/`handleTypingStop` wired to ChatArea
- **Vault2E**: Typing receive handlers exist in usePresence, but no send handlers in App

### 21. No Ctrl+K search shortcut
- **Stable**: Keyboard shortcut toggles `showSearch`
- **Vault2E**: `MessageSearch` component exists but is NOT rendered in App.tsx

### 22. `UserAvatarMenu` component missing
- **Stable**: Right-click context menu with 6 actions (message, view pic, profile, copy ID, fingerprint)
- **Vault2E**: Not rendered

### 23. `ToastContainer` missing
- **Stable**: Rendered at root level
- **Vault2E**: Not rendered (toasts may not display)

### 24. Ctrl+scroll zoom prevention missing
- **Stable**: Blocks Ctrl+wheel zoom except in lightbox
- **Vault2E**: Missing

### 25. No token expiry check
- **Stable**: Checks JWT expiry, forces logout if expired
- **Vault2E**: Missing

### 26. `handleSelectPeer` doesn't emit read receipt
- **Stable**: Emits `message:read` when opening a conversation
- **Vault2E**: Just sets state

### 27. `fetchAllHistory` doesn't send delivery receipts
- **Stable**: Sends `message:delivered` for incoming messages
- **Vault2E**: Missing

### 28. No undecryptable message cleanup
- **Stable**: Deletes undecryptable messages from Dexie, requests server cleanup
- **Vault2E**: Missing

### 29. Periodic flush is 30s instead of 3s
- **Stable**: Every 3 seconds
- **Vault2E**: Every 30 seconds
- **Impact**: Slower offline message delivery

### 30. `user:profile-update` event name mismatch
- **Stable**: `user:profile-update` (hyphen)
- **Vault2E**: `user:profile_update` (underscore)
- **Impact**: Handler may never fire if server uses hyphen

### 31. Duplicate socket handlers (5 events)
- `channel:member_added`, `channel:member_removed`, `channel:key_rotated`, `channel:ownership_transferred`, `channel:key_request` are registered in BOTH `usePresence.ts` AND `useChannels.ts`
- **Impact**: Double-processing, race conditions

### 32. `channel:create:ack` handler missing
- **Stable**: Handles channel creation confirmation
- **Vault2E**: No handler anywhere

### 33. Proactive channel key distribution on startup missing
- **Stable**: Iterates channels, finds members without keys, encrypts and distributes
- **Vault2E**: Missing

### 34. Three separate shared keys caches
- Stable: One `sharedKeysCache` (React state) shared everywhere
- Vault2E: `sharedKeysCacheRef` in App + module-level Map in `crypto.ts` + non-caching version in `useCrypto.ts`
- **Impact**: Cache misses, redundant ECDH derivations

---

## What Vault2E Does BETTER (keep these)

1. **`usersWithPresence` for ChannelSettingsModal** — passes online/away flags (stable passes raw `allUsers`)
2. **`isDeletedForMe` field** — Vault2E adds it, stable doesn't
3. **Hook separation** — architectural improvement for maintainability once bugs are fixed
4. **`fetchUserPublicKey` with fresh fetch** — always fetches from server instead of stale cache
5. **`decryptPayloadImpl` retry logic** — tries fresh key on decryption failure

---

## Priority Task List to Restore Functionality

### Phase 1 — Critical (get app working) ✅ COMPLETE
1. ✅ Fix `resolveMessageKey` — now uses `getOrGenerateChannelKey` instead of generating new key
2. ✅ Implement `handleEditMessage` fully
3. ✅ Implement `handleDeleteForMe` / `handleDeleteForEveryone` fully
4. ✅ Implement `handleForwardMessage` fully
5. ✅ Implement `handlePinMessage` / `handleUnpinMessage` fully
6. ✅ Restore `validatePeerKeyTofu` from stable — full TOFU with signed rotation chain verification
7. ✅ Restore `handleTrustNewKey` with re-decryption
8. ✅ Wire up admin `onSetRole` / `onDeleteUser` with real API calls
9. ✅ Add admin role guard (`showAdmin && role === 'ADMIN'`)
10. ✅ Fix `onChannelMemberAdded` key distribution
11. Fix `onChannelKeyRotated` re-distribution
12. Add proactive channel key distribution on startup

### Phase 2 — High (core features)
13. Compute and pass `unreadDMs` / `unreadChannels` to Sidebar
14. Pass `recentDMs` / `latestDMMessages` to Sidebar
15. Fix `fetchAllHistory` to include channel messages
16. Add fresh user directory fetch before decryption in `fetchAllHistory`
17. Add per-conversation history fetch on peer/channel select
18. Add sidebar reorder on send/receive
19. Fix `handleUpdateProfile` to update local state + emit socket event
20. Add decryption retry cache invalidation
21. Add `handleSelectChannel` room join + key request
22. Wire upload progress to ChatArea

### Phase 3 — Medium (polish)
23. Add typing indicator send handlers
24. Wire `MessageSearch` component into App
25. Add `UserAvatarMenu` component
26. Add `ToastContainer`
27. Fix `user:profile-update` event name
28. Remove duplicate socket handlers from `usePresence.ts`
29. Add `channel:create:ack` handler
30. Add token expiry check
31. Add Ctrl+scroll zoom prevention
32. Add Ctrl+K shortcut
33. Add delivery receipts on history load
34. Add undecryptable message cleanup
35. Change periodic flush from 30s to 3s
36. Unify shared keys cache architecture
