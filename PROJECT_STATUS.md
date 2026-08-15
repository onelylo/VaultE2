# PROJECT STATUS — VaultChat
> **Last updated**: 2026-08-15 (latest fixes: official channel send failures, server ACK error paths, key upload for open channels)  
> **Maintainer**: Auto-generated, update on every fix/change  
> **Repo**: https://github.com/onelylo/petroshield-chat

---

## 1. PROJECT OVERVIEW

**VaultChat** is a secure, enterprise-grade real-time messaging platform with end-to-end encryption (E2EE). Built with React + TypeScript (client) and Node.js + Socket.IO + PostgreSQL (server).

### Core Features
- End-to-end encrypted DMs and channels (ECDH-P256 + AES-256-GCM)
- Real-time messaging with delivery/read receipts (✓ sent, ✓✓ delivered, ✓✓ blue = read)
- Encrypted file attachments (up to 25 MB) with thumbnail generation
- Voice message recording and playback
- Message editing and deletion (for self or everyone)
- Message pinning in channels
- Typing indicators (DMs + channels)
- Reply threading with quoted messages
- Shared media gallery in profile (WhatsApp-style: images, audio, video, docs with date grouping)
- WhatsApp-style contextual message menu (Reply, Edit, Copy, Delete)
- Image lightbox with zoom, pan, and slide-down-to-close
- "Take me there" jump-to-message from profile media gallery
- "Stay logged in" option with session persistence control
- DM message previews in sidebar
- Lazy message loading (50 msgs initially, load more on scroll)
- Emoji picker
- 12 custom themes (6 dark, 6 light)
- TOFU (Trust On First Use) key verification
- Admin dashboard with user management, roles (ADMIN/SUPERVISOR/MEMBER)
- IndexedDB local storage with Dexie.js
- Offline queue with auto-flush
- Keyboard shortcuts (Ctrl+K search)
- 3-state user presence: online (green), away >5min inactive (amber), offline (gray) with 60s heartbeat

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Client | React 18, TypeScript, Vite, Tailwind CSS, Dexie.js (IndexedDB) |
| Server | Node.js, Express, Socket.IO, PostgreSQL (embedded) |
| Crypto | Web Crypto API, ECDH-P256, AES-256-GCM, bcrypt |
| Auth | JWT (HS256), bcrypt password hashing |

---

## 2. BUGS FIXED (Chronological)

### Critical / Security Fixes
| Date | Commit | Fix | File(s) |
|------|--------|-----|---------|
| 2026-08-13 | `640c915` | Timestamp always valid at source — server relay + decryptPayload + display | `server/index.ts`, `client/App.tsx`, `MessageItem.tsx` |
| 2026-08-13 | `640c915` | Prevent status downgrade via STATUS_RANK guard in `updateMessageStatus` | `client/lib/db.ts` |
| 2026-08-13 | `17754c5` | Removed broken toast notification system entirely | `client/App.tsx`, `index.css` |
| 2026-08-13 | `752c484` | AudioContext resume on first user click for sound playback | `client/lib/notify.ts` |
| 2026-08-13 | `f32ca9c` | Image lightbox zoom-in effect | `client/modals/ImageLightboxModal.tsx` |
| 2026-08-13 | `e79126b` | Timestamp display: `Number(msg.timestamp ?? Date.now())` ensures valid date | `client/MessageItem.tsx` |
| 2026-08-13 | `fd60d33` | Darkened read-status checkmark (sky-400 → sky-500) | `client/MessageItem.tsx` |
| 2026-08-13 | `66f47ac` | Optimized DM queries (targeted DB queries instead of full table scan) | `client/ChatArea.tsx`, `client/App.tsx` |
| 2026-08-13 | `66f47ac` | DM order persists on refresh (loaded from IndexedDB on mount) | `client/App.tsx` |
| 2026-08-13 | `66f47ac` | Faster receipt updates (2s interval instead of 5s) | `client/App.tsx` |
| 2026-08-13 | `latest` | Typing indicators: store username on socket + auto-join channel rooms | `server/index.ts` |
| 2026-08-13 | `latest` | channel:create adds creator to channel_members | `server/index.ts` |
| 2026-08-13 | `latest` | Offline queue: fixed stale closures using refs | `client/App.tsx` |
| 2026-08-13 | `latest` | Offline queue: added try/catch to prevent isFlushing stuck on error | `client/App.tsx` |
| 2026-08-13 | `ea62461` | Remote DoS fix: validate ciphertext before `.length` in socket handlers | `server/index.ts` |
| 2026-08-13 | `ea62461` | Offline queue: channel message support (use channel symmetric key) | `client/lib/queue.ts` |
| 2026-08-13 | `ea62461` | `arrayBufferToBase64` O(n²) → 32KB chunking | `client/lib/crypto.ts` |
| 2026-08-13 | `ea62461` | channel:create persists invited `memberIds` | `server/index.ts` |
| 2026-08-13 | `ea62461` | Channel privacy: per-user filtered `broadcastChannels()` | `server/index.ts` |
| 2026-08-13 | `ea62461` | Attachment N+1 → batch `getAttachmentsByMessageIds` | `server/index.ts`, `server/db/index.ts` |
| 2026-08-13 | `ea62461` | `computeUnread` reactive via Dexie `liveQuery` (no 2s polling) | `client/App.tsx` |
| 2026-08-13 | `a299017` | Channel read receipts now match `channelId` | `client/App.tsx` |
| 2026-08-13 | `a299017` | `channel_members(user_id)` index added | `server/db/schema.sql` |
| 2026-08-13 | `a299017` | `fs.writeFileSync` → async `fs.promises.writeFile` | `server/index.ts` |
| 2026-08-13 | `a299017` | Token blocklist eviction via expiry map | `server/index.ts` |
| 2026-08-13 | `a299017` | Username editing now persisted (server + client) | `server/index.ts`, `server/db/index.ts`, `client/App.tsx` |
| 2026-08-13 | `a299017` | Typing indicator key mismatch fixed (username in stop event) | `server/index.ts`, `client/App.tsx` |
| 2026-08-13 | `a299017` | `CreateChannelModal` grants SUPERVISOR create | `CreateChannelModal.tsx` |
| 2026-08-13 | `a299017` | "Stay logged in" text corrected (not 30 days) | `AuthModal.tsx` |
| 2026-08-13 | `a299017` | Rules-of-hooks violation in ChannelSettingsModal | `ChannelSettingsModal.tsx` |
| 2026-08-13 | `a299017` | Removed unused imports + temp files | multiple |
| 2026-08-13 | `a299017` | N+1 channel member queries → batch | `server/db/index.ts` |
| 2026-08-13 | `latest` | AttachmentMessage: use getJwtToken helper (localStorage + sessionStorage) | `client/AttachmentMessage.tsx` |
| 2026-08-13 | `latest` | Reactions/pins: use socket.broadcast instead of io.emit | `server/index.ts` |
| 2026-08-13 | `0ca9f09` | Message/reaction/pin spoofing prevention (server uses authenticatedUserId) | `server/index.ts` |
| 2026-08-13 | `0ca9f09` | Timing-safe password comparison for legacy SHA-256 hashes | `server/index.ts` |
| 2026-08-13 | `0ca9f09` | EditUserModal stale state fix (useEffect resets state on user change) | `client/admin/EditUserModal.tsx` |
| 2026-08-13 | `0ca9f09` | Removed dead ReactionPicker component | `client/ReactionPicker.tsx` |
| 2026-08-13 | `faaffcd` | Checkmark flickering fix (rank-guard updateMessageStatus) | `client/lib/db.ts` |
| 2026-08-13 | `faaffcd` | DM order persists on refresh (loads from getActiveDMPartners) | `client/App.tsx` |
| 2026-08-13 | `4351cff` | Unread badge clear on DM open (skips active DM in computeUnread) | `client/App.tsx` |
| 2026-08-13 | `4351cff` | DM message preview in sidebar | `client/Sidebar.tsx`, `client/App.tsx` |
| 2026-08-13 | `8cface8` | Check mark updates via tempId in delivery ack chain | `client/App.tsx`, `server/index.ts` |
| 2026-08-13 | `8cface8` | Skip unread count for currently open DM/channel | `client/App.tsx` |
| 2026-08-13 | `5dc2a52` | Read receipt fix (targeted query instead of full table scan) | `client/App.tsx` |
| 2026-08-13 | `5dc2a52` | "Stay logged in" option with sessionStorage fallback | `client/AuthModal.tsx`, `client/App.tsx` |
| 2026-08-13 | `d27f577` | Scroll to bottom on conversation switch (justSwitchedRef pattern) | `client/ChatArea.tsx` |
| 2026-08-13 | `763cd69` | `removeJwtToken` infinite recursion fix | `client/App.tsx` |
| 2026-08-13 | `763cd69` | Socket JWT storage (localStorage + sessionStorage) | `client/lib/socket.ts` |
| 2026-08-13 | `763cd69` | Channel key upload 403 (type mismatch: `string[]` vs `{userId}`) | `server/index.ts` |
| 2026-08-13 | `763cd69` | `message:unpin` missing auth check | `server/index.ts` |
| 2026-08-13 | `763cd69` | Stale `allUsers` fallback → `allUsersRef.current` | `client/App.tsx` |
| 2026-08-13 | `763cd69` | Typing indicators spoofing (server uses authenticatedUserId) | `server/index.ts` |
| 2026-08-13 | `763cd69` | ProfileDrawer relative URLs → `${API_BASE}/api/...` | `client/ProfileDrawer.tsx` |
| 2026-08-13 | `763cd69` | ECDH key cache invalidated on peer key rotation (cache by publicKey prefix) | `client/App.tsx` |
| 2026-08-13 | `763cd69` | **Replies persist** — `decryptPayload` was missing `replyTo` field | `client/App.tsx` |
| 2026-08-13 | `ea62461` | Remote DoS fix: validate ciphertext before `.length` in socket handlers | `server/index.ts` |
| 2026-08-13 | `ea62461` | Offline queue: channel message support (use channel symmetric key) | `client/lib/queue.ts` |
| 2026-08-13 | `ea62461` | `arrayBufferToBase64` O(n²) → 32KB chunking | `client/lib/crypto.ts` |
| 2026-08-13 | `ea62461` | Channel privacy: per-user filtered `broadcastChannels()` | `server/index.ts` |
| 2026-08-13 | `ea62461` | Attachment N+1 → batch `getAttachmentsByMessageIds` | `server/index.ts`, `server/db/index.ts` |
| 2026-08-13 | `ea62461` | `computeUnread` reactive via Dexie `liveQuery` (no 2s polling) | `client/App.tsx` |
| 2026-08-13 | `a299017` | Channel read receipts now match `channelId` | `client/App.tsx` |
| 2026-08-13 | `a299017` | `channel_members(user_id)` index added | `server/db/schema.sql` |
| 2026-08-13 | `a299017` | `fs.writeFileSync` → async `fs.promises.writeFile` | `server/index.ts` |
| 2026-08-13 | `a299017` | Token blocklist eviction via expiry map | `server/index.ts` |
| 2026-08-13 | `a299017` | Username editing now persisted (server + client) | `server/index.ts`, `server/db/index.ts`, `client/App.tsx` |
| 2026-08-13 | `a299017` | Typing indicator key mismatch fixed (username in stop event) | `server/index.ts`, `client/App.tsx` |
| 2026-08-13 | `a299017` | `CreateChannelModal` grants SUPERVISOR create | `CreateChannelModal.tsx` |
| 2026-08-13 | `a299017` | "Stay logged in" text corrected | `AuthModal.tsx` |
| 2026-08-13 | `a299017` | Rules-of-hooks violation fixed (ChannelSettingsModal) | `ChannelSettingsModal.tsx` |
| 2026-08-13 | `a299017` | N+1 channel member queries → batch | `server/db/index.ts` |
| 2026-08-13 | `e8b752b` | Channel key redistribution on member add | `client/App.tsx` |
| 2026-08-13 | `e8b752b` | Socket rate limiting (10 messages/sec) | `server/index.ts` |
| 2026-08-13 | `e8b752b` | Key rotation rate limiting (3/hr/user) | `server/index.ts` |
| 2026-08-13 | `e8b752b` | PBKDF2 iterations 100K → 600K (OWASP compliant) | `client/lib/crypto.ts` |
| 2026-08-13 | `e8b752b` | Attachment upload rate limiting (10/min/user) | `server/index.ts` |
| 2026-08-15 | `90ae781` | Server-side attachment DB fallback for DM relay, channel broadcast, undelivered messages | `server/index.ts`, `server/db/index.ts` |
| 2026-08-15 | `4ea5786` | Fixed swapped IV mapping in all 3 attachment relay fallback paths (iv↔binaryIv) | `server/index.ts` |
| 2026-08-15 | `4ea5786` | Isolated linkAttachmentToMessage errors from insertMessage try-catch | `server/index.ts` |
| 2026-08-15 | `bf6565b` | Allow attachment-only messages (empty ciphertext) — server was silently dropping them | `server/index.ts` |
| 2026-08-15 | `bf6565b` | Real-time `socket.connected && navigator.onLine` check before emit (replaces stale `isOffline` state) | `client/App.tsx` |
| 2026-08-15 | `41f325c` | Channel attachment auth: use `channel_members` instead of `channel_keys` (key dist may fail) | `server/index.ts` |
| 2026-08-15 | `41f325c` | `getOrGenerateChannelKey`: try all users as candidates when `channels` state not loaded | `client/App.tsx` |
| 2026-08-15 | `41f325c` | Queue processor: remove premature `updateMessageStatus('sent')` — clock icon persists until server ACK | `client/lib/queue.ts` |
| 2026-08-15 | `8f250f6` | CRITICAL: `getUndeliveredMessages` SQL `ORDER BY timestamp` → `created_at` (column didn't exist) | `server/db/index.ts` |
| 2026-08-15 | `8f250f6` | CRITICAL: `handleCloseChat` no longer emits `channel:leave` (was destroying team/private membership) | `client/App.tsx` |
| 2026-08-15 | `8f250f6` | CRITICAL: `channel:members` now filters through `publicUser()` (was leaking password hashes) | `server/index.ts` |
| 2026-08-15 | `8f250f6` | HIGH: `user:online` broadcast no longer includes email field | `server/index.ts` |
| 2026-08-15 | `8f250f6` | HIGH: Server `updateMessageStatus` now checks status rank before update (prevents read→delivered downgrade) | `server/db/index.ts` |
| 2026-08-15 | `latest` | CRITICAL: Channel key distribution race — await server ACK + 3-attempt retry | `client/App.tsx` |
| 2026-08-15 | `latest` | CRITICAL: `onChannelKeyRotated` stale closures → use refs (`currentUserKeysRef`, `channelsRef`, `allUsersRef`) | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: Removed dangerous 404 fallback in `getOrGenerateChannelKey` (was generating incompatible keys) | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: Key distribution on member add via `onChannelMemberAdded` (creator distributes key to new members) | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: Unlinked attachment access denied (messageId=null → 403) | `server/index.ts` |
| 2026-08-15 | `latest` | HIGH: SSRF DNS rebinding fix (resolve DNS before IP check) | `server/index.ts` |
| 2026-08-15 | `latest` | HIGH: Server key upload filters envelopes to actual channel members only | `server/index.ts` |
| 2026-08-15 | `latest` | MEDIUM: `dangerouslySetInnerHTML` in ConfirmDialog → plain text | `client/ConfirmDialog.tsx` |
| 2026-08-15 | `latest` | MEDIUM: Rate limiters for reactions, channel creates, typing | `server/index.ts` |
| 2026-08-15 | `latest` | MEDIUM: Last admin demotion guard | `server/index.ts` |
| 2026-08-15 | `latest` | MEDIUM: `fetchAllHistory` skips delivery receipts for already-delivered messages | `client/App.tsx` |
| 2026-08-15 | `latest` | MEDIUM: `handleEditMessage` looks up message in DB for correct key | `client/App.tsx` |
| 2026-08-15 | `latest` | MEDIUM: Read receipts include `lastReadMessageId` on openDM/openChannel | `client/App.tsx` |
| 2026-08-15 | `latest` | MEDIUM: Removed redundant 2s polling (liveQuery handles reactivity) | `client/ChatArea.tsx` |
| 2026-08-15 | `latest` | MEDIUM: `isMobile` is now reactive to window resize | `client/Sidebar.tsx` |
| 2026-08-15 | `latest` | MEDIUM: Orphaned attachment cleanup (30-min interval + DB function) | `server/index.ts`, `server/db/index.ts` |
| 2026-08-15 | `latest` | LOW: `audio.play()` `.catch()` added | `client/AudioPlayer.tsx` |
| 2026-08-15 | `latest` | LOW: `navigator.clipboard.writeText` `.catch()` added | `client/MessageItem.tsx` |
| 2026-08-15 | `latest` | LOW: Empty draft auto-save guard | `client/ChatArea.tsx` |
| 2026-08-15 | `latest` | LOW: Reply lookup uses `allMessages` instead of `visibleMessages` | `client/ChatArea.tsx` |
| 2026-08-15 | `latest` | CRITICAL: `onChannelKeyRotated` — only creator generates+distributes rotated key (was every client generating different keys) | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: `getOrGenerateChannelKey` — self added as fallback candidate (allUsers excludes self) | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: `onChannelMemberAdded` — any online member can distribute keys (was creator-only) | `client/App.tsx` |
| 2026-08-15 | `latest` | LOW: Link preview cache persisted to localStorage (200 entries max) | `client/LinkPreview.tsx` |
| 2026-08-15 | `latest` | CRITICAL: Public/official channel auto-join now emits `channel:member_added` for key distribution | `server/index.ts` |
| 2026-08-15 | `latest` | MEDIUM: Channel settings modal unsaved-changes bug — `hasChanges` compares against saved snapshot, not original prop | `client/ChannelSettingsModal.tsx` |
| 2026-08-15 | `latest` | MEDIUM: All 18 `alert()` calls replaced with toast notification system (`showToast` + `ToastContainer`) | `client/App.tsx`, `client/ChatArea.tsx`, `client/ProfileDrawer.tsx`, `client/lib/toast.tsx` |
| 2026-08-15 | `latest` | CRITICAL: Official channel messages silently fail — `handleSendMessage` returns when channelKey is null with no user feedback | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: Server sends `status: 'failed'` ACK but client ignores error — `onMessageAck` doesn't handle failed status or show server error message | `client/App.tsx` |
| 2026-08-15 | `latest` | HIGH: Server silently drops invalid channel messages without any ACK (3 early-return paths) — client messages stuck as `pending_sync` forever | `server/src/index.ts` |
| 2026-08-15 | `latest` | HIGH: Server silently drops invalid DM messages without any ACK (2 early-return paths) — same stuck message issue | `server/src/index.ts` |
| 2026-08-15 | `latest` | CRITICAL: Key upload endpoint filters envelopes to channel_members only — official/public channels where all users auto-join never get stored envelopes, preventing decryption | `server/src/index.ts` |

### Feature Additions
| Date | Commit | Feature | File(s) |
|------|--------|---------|---------|
| 2026-08-13 | `c6d846d` | Restored DM onClick handler | `client/App.tsx` |
| 2026-08-13 | `8d86c25` | Theme transition animation (simplified) | `client/App.tsx` |
| 2026-08-13 | `f32ca9c` | Image lightbox zoom effect | `client/modals/ImageLightboxModal.tsx` |
| 2026-08-13 | `a06ce98` | Profile modal on click (username/avatar in DM header) | `client/ChatArea.tsx`, `client/ProfileModal.tsx` |
| 2026-08-13 | `5dc2a52` | "Stay logged in" option on login page | `client/AuthModal.tsx`, `client/App.tsx` |
| 2026-08-13 | `4351cff` | DM message preview in sidebar | `client/Sidebar.tsx`, `client/App.tsx` |
| 2026-08-13 | `b6bc1b9` | Shared media gallery in profile modal (images/audio/docs tabs) | `client/ProfileModal.tsx` |
| 2026-08-13 | `0eb0dcc` | Enhanced profile media gallery (date grouping, video tab, media stats) | `client/ProfileModal.tsx` |
| 2026-08-13 | `d5e49a5` | Clickable attachments + "Take me there" jump-to-message | `client/ProfileModal.tsx`, `client/ChatArea.tsx` |
| 2026-08-13 | `2fe595c` | ProfileModal rewrite (fixed black screen crash, clean MediaItem component) | `client/ProfileModal.tsx` |
| 2026-08-13 | `99207c0` | WhatsApp-style contextual message menu (Reply, Edit, 3-dot for Copy/Delete) | `client/MessageItem.tsx` |
| 2026-08-13 | `ef812bf` | Message actions side-by-side + spatial awareness dropdown | `client/MessageItem.tsx` |
| 2026-08-13 | `ce6e692` | Action menu closes on outside click and when another 3-dot is clicked | `client/MessageItem.tsx` |
| 2026-08-13 | `e76d732` | Reduced enlarged avatar size from 90vw to 50vw | `client/ProfileModal.tsx` |
| 2026-08-13 | `e76d732` | Image lightbox: hide title/X when zoomed, slide-down-to-close gesture | `client/modals/ImageLightboxModal.tsx` |
| 2026-08-13 | `dd12368` | 3-state presence (online/away/offline) with 60s heartbeat | `server/index.ts`, `client/App.tsx`, `client/lib/queue.ts` |
| 2026-08-13 | `dd12368` | Presence indicators: green=online, amber=away, gray=offline | `client/Sidebar.tsx`, `client/ChatArea.tsx`, `client/ProfileModal.tsx` |

---

## 3. KNOWN ISSUES & LIMITATIONS

### Fixed Issues (from Full Security/UI/Feature Scan — 2026-08-15)
| Severity | Issue | File(s) | Status |
|----------|-------|---------|--------|
| CRITICAL | `onChannelKeyRotated` every client generates different key → cascading decrypt failures | `client/App.tsx` | FIXED: only creator generates+distributes; others clear+wait |
| CRITICAL | `onChannelKeyRotated` handler uses stale closures — forward secrecy non-functional | `client/App.tsx` | FIXED: use `currentUserKeysRef`, `channelsRef`, `allUsersRef` |
| HIGH | Unlinked attachments (messageId=null) downloadable by any authenticated user | `server/index.ts` | FIXED: deny unlinked attachment access |
| HIGH | SSRF via DNS rebinding in URL preview (TOCTOU on hostname check) | `server/index.ts` | FIXED: resolve DNS before IP check |
| HIGH | Channel key distribution races with server channel creation (1s setTimeout) | `client/App.tsx` | FIXED: await `channel:create:ack` + 3-attempt retry |
| HIGH | Channel key fallback encrypts for ALL users on 404 | `client/App.tsx` | FIXED: removed dangerous 404 fallback, now returns null |
| HIGH | `getOrGenerateChannelKey` can't find self as candidate (allUsers excludes self) | `client/App.tsx` | FIXED: self added as fallback candidate |
| HIGH | New members added while creator offline never receive key envelopes | `client/App.tsx` | FIXED: any online member can distribute keys |
| HIGH | Official channel messages silently fail (channelKey null → no feedback; server ACK errors ignored) | `client/App.tsx`, `server/index.ts` | FIXED: toast on key failure, onMessageAck handles 'failed' status, server sends ACK for all validation paths |
| HIGH | Key upload filters envelopes to channel_members — official channels never get envelopes for auto-joined users | `server/index.ts` | FIXED: open channels (public/official) store all envelopes |
| MEDIUM | `dangerouslySetInnerHTML` in ConfirmDialog (XSS vector) | `client/ConfirmDialog.tsx` | FIXED: replaced with plain text |
| MEDIUM | No rate limiting on socket reactions, channel creates, typing | `server/index.ts` | FIXED: added per-socket rate limiters |
| MEDIUM | Last admin can be demoted (locks out all admins) | `server/index.ts` | FIXED: added last-admin guard |
| MEDIUM | `fetchAllHistory` sends delivery receipts for ALL messages on every refresh | `client/App.tsx` | FIXED: skip already-delivered/read messages |
| MEDIUM | `handleEditMessage` uses selected peer/channel key, not message's actual conversation | `client/App.tsx` | FIXED: look up msg in DB for correct key |
| MEDIUM | Read receipt marks entire thread read, not up to last-read message | `client/App.tsx` | FIXED: include `lastReadMessageId` on openDM/openChannel |
| MEDIUM | 2s polling for status updates instead of Dexie liveQuery | `client/ChatArea.tsx` | FIXED: removed redundant polling, liveQuery handles reactivity |
| MEDIUM | `isMobile` is static, not reactive to resize | `client/Sidebar.tsx` | FIXED: added resize event listener |
| MEDIUM | Orphaned attachment files never cleaned from disk | `server/index.ts` | FIXED: 30-min cleanup job + DB function |
| MEDIUM | `alert()` used 18 times for feedback | `client/App.tsx` multiple | FIXED: replaced with toast notification system |
| LOW | `audio.play()` without .catch() in AudioPlayer | `client/AudioPlayer.tsx` | FIXED: added catch handler |
| LOW | `navigator.clipboard.writeText` without try/catch | `client/MessageItem.tsx` | FIXED: added .catch() |
| LOW | Draft auto-save saves empty drafts | `client/ChatArea.tsx` | FIXED: guard non-empty |
| LOW | `visibleMessages` truncates reply lookup | `client/ChatArea.tsx` | FIXED: pass allMessages |
| LOW | Link preview cache lost on refresh | `client/LinkPreview.tsx` | FIXED: persist to localStorage (200 entries max) |

### Remaining Issues
| Severity | Issue | File(s) | Status |
|----------|-------|---------|--------|
| MEDIUM | PBKDF2 at 100K iterations (OWASP recommends 600K) — breaking change to upgrade | `client/crypto.ts:451` | Needs vault re-wrap migration |

### Previously Known Issues
| Severity | Issue | Status |
|----------|-------|--------|
| MEDIUM | `EditUserModal` save handler ignores fullName/status/newPassword/revokeKeys | No backend endpoints exist |
| MEDIUM | `/api/messages` returns unbounded history, no pagination | Needs pagination |
| MEDIUM | Reaction/pin handlers don't verify participant membership | Needs membership check |
| MEDIUM | JWT role changes take up to 1h to apply | By design (JWT expiry) |
| MEDIUM | `DB_PASS` regenerates every boot without env var | Needs persistent secret |
| LOW | Fingerprint loading runs expensive async crypto on every directory update | Performance |
| LOW | ~40 console.log debug statements in production | Cleanup |

### Security Notes
- JWT stored in localStorage (default) or sessionStorage (when "Stay logged in" unchecked)
- Socket auth uses `getJwtToken()` which checks both storages
- All socket handlers use `(socket as any).authenticatedUserId` for identity verification
- ECDH key cache keyed by peerId + publicKey prefix (invalidates on rotation)
- Legacy SHA-256 passwords use timing-safe comparison
- Socket message rate limiting: 10 messages/second per connection
- Reaction rate limiting: 10 reactions/10 seconds per connection
- Channel create rate limiting: 1 channel/30 seconds per connection
- Typing indicator rate limiting: 2/second per connection
- Key rotation rate limiting: 3 rotations/hour per user
- Attachment upload rate limiting: 10 uploads/minute per user
- Unlinked attachments (messageId=null) denied download to prevent auth bypass
- SSRF: DNS resolved before IP check (prevents DNS rebinding TOCTOU)
- Last admin demotion prevented (requires at least 1 admin)
- Orphaned attachments cleaned up every 30 minutes
- PBKDF2 iterations: 100,000 (600K requires vault migration)
- Channel keys re-distributed when new members are added (via `onChannelMemberAdded`)
- Channel key distribution uses server ACK + retry (no more setTimeout race)

---

## 4. ARCHITECTURE

### Message Flow
```
Client A sends → handleSendMessage() → encryptMessage(ECDH) → saveMessage(localMsg)
  → socket.emit('message:send') → Server validates → insertMessage PostgreSQL
  → socket.emit('message:ack') → Client A: updateMessageStatus(tempId → serverId)
  → socket.emit('message:receive') → Client B: decryptPayload() → saveMessage(localMsg)
  → Client B: socket.emit('message:delivered') → Server: socket.emit('message:delivered_ack')
  → Client A: updateMessageStatus(serverId, 'delivered')
  → Client B opens DM: socket.emit('message:read') → Server: socket.emit('message:read_ack')
  → Client A: updateMessageStatus → 'read'
```

### Status Progression
```
pending_sync (0) → sent (2) → delivered (3) → read (4)
```
- `STATUS_RANK` in `db.ts` prevents downgrades
- `onMessageAck` uses tempId → serverId swap with rank guard

### Key Files
| File | Purpose |
|------|---------|
| `client/App.tsx` | Main app state, auth, E2EE, socket handlers, message flow |
| `client/components/ChatArea.tsx` | Chat UI, message list, useLiveQuery, scroll behavior |
| `client/components/Sidebar.tsx` | DM/channel list, unread badges, search |
| `client/lib/crypto.ts` | ECDH key derivation, AES-256-GCM encrypt/decrypt |
| `client/lib/db.ts` | Dexie IndexedDB schema, message CRUD, status updates |
| `client/lib/socket.ts` | Socket.IO connection with JWT auth |
| `server/index.ts` | All API routes, socket handlers, message relay |
| `server/db/index.ts` | PostgreSQL queries, schema migrations |

---

## 5. E2EE VERIFICATION

### Encryption Flow (Verified: Truly End-to-End)
```
Client A                              Server                           Client B
   │                                    │                                │
   │── generateKeyPair() ──────────────>│                                │
   │<── export public key ──────────────│                                │
   │                                    │<── store public key ──────────│
   │                                    │── relay ciphertext ──────────>│
   │                                    │                                │── deriveSharedKey()
   │                                    │                                │── decryptMessage()
```

### What's Encrypted
- ✅ Message text (AES-256-GCM)
- ✅ File attachments (binary + metadata)
- ✅ Channel symmetric keys (wrapped per-member with ECDH)

### What's NOT on the Server
- ❌ Private keys (encrypted with user's password, stored in IndexedDB vault)
- ❌ Plaintext (only ciphertext + IV stored)
- ❌ Symmetric keys (derived client-side via ECDH)

### Key Management
- ECDH P-256 for key exchange (client-to-client)
- AES-256-GCM for message encryption
- PBKDF2 for vault key wrapping (user password → vault key, 600K iterations)
- ECDSA P-256 for key rotation signatures (separate from ECDH)
- bcrypt for password hashing (server-side)
- JWT HS256 for session tokens

### Security Notes
- Server never sees plaintext — stores only ciphertext + IV
- Private keys encrypted with PBKDF2-derived key from user password
- Key rotation uses ECDSA signatures to prove authenticity
- TOFU (Trust On First Use) for initial key pinning
- `timingSafeEqual` used for legacy SHA-256 password comparison

---

## 6. HOW TO UPDATE THIS FILE

When fixing a bug or adding a feature:
1. Add entry to **Section 2** (Bugs Fixed) with date, commit hash, fix description, and file(s)
2. If it's a new feature, add to **Feature Additions** subsection
3. If it's a known limitation, add to **Section 3** (Known Issues)
4. Update the **Last updated** date at the top
5. If architecture changed, update **Section 4**
