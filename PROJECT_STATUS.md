# PROJECT STATUS — VaultChat
> **Last updated**: 2026-08-13  
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

---

## 3. KNOWN ISSUES & LIMITATIONS

### Unfixed Issues
| Severity | Issue | Status |
|----------|-------|--------|
| MEDIUM | Channel edit/delete broadcasts to ALL clients (no channel rooms) | Known limitation — needs channel room refactor |
| MEDIUM | `EditUserModal` save handler ignores fullName/status/newPassword/revokeKeys | No backend endpoints exist |
| MEDIUM | Browser `alert()` used for feedback (15 instances) | Should use inline UI |
| LOW | `isMobile` computed once per render (no resize listener) | Low priority |
| LOW | Fingerprint loading for all users runs expensive async crypto on every directory update | Performance |
| LOW | `formatBytes` duplicated in server files | Code smell |

### Security Notes
- JWT stored in localStorage (default) or sessionStorage (when "Stay logged in" unchecked)
- Socket auth uses `getJwtToken()` which checks both storages
- All socket handlers use `(socket as any).authenticatedUserId` for identity verification
- ECDH key cache keyed by peerId + publicKey prefix (invalidates on rotation)
- Legacy SHA-256 passwords use timing-safe comparison

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

## 5. HOW TO UPDATE THIS FILE

When fixing a bug or adding a feature:
1. Add entry to **Section 2** (Bugs Fixed) with date, commit hash, fix description, and file(s)
2. If it's a new feature, add to **Feature Additions** subsection
3. If it's a known limitation, add to **Section 3** (Known Issues)
4. Update the **Last updated** date at the top
5. If architecture changed, update **Section 4**
