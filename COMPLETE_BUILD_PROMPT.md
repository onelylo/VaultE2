# Vault2E COMPLETE BUILD — Everything Needed to Ship

> **Goal**: From current broken state → fully working Discord-like app with WhatsApp E2EE, friends, hubs, profile customization, security hardening, and performance. One prompt to rule them all.

---

## CRITICAL RULES

1. **FULL STACK AWARENESS** — Every change has frontend AND backend. Check both before editing.
2. **ONE MINOR LETTER CAN BREAK EVERYTHING** — Read the entire file before changing it.
3. **DON'T REIMPLEMENT WHAT'S WORKING** — Only fix what's actually broken.
4. **REGRESSION CHECKS AFTER EVERY CHANGE** — If something breaks, REVERT.
5. **COMMIT AFTER EACH PHASE** — `git commit -m "phase-N: description"`
6. **VERIFY BEFORE PROCEEDING** — After each phase, STOP. Test everything. If broken, FIX before moving on.

---

## Phase 0: Fix the Lightbox (CRITICAL — Currently Corrupted)

The `ImageLightboxModal.tsx` file is **corrupted** — duplicate variable declarations, pasted upload code, missing JSX, missing `decryptMessage` prop. It will crash at runtime.

### Task 0.1: Audit Lightbox Chain
```
FRONTEND (audit all of these):
- client/src/components/modals/ImageLightboxModal.tsx — CORRUPTED, needs full rewrite
- client/src/components/ChatArea.tsx — lines 130, 278-288, 1153, 1358-1364 (activeLightbox state, openLightbox, render)
- client/src/components/chat/MessageItem.tsx — line 296 (onImageClick wrapper)
- client/src/components/AttachmentMessage.tsx — line 79 (onImageClick provides decrypted URL)
- client/src/components/ProfileModal.tsx — lines 87-96, 294 (avatar lightbox, media item click)

BACKEND:
- server/src/index.ts — GET /api/messages/:messageId (already exists)
- server/src/db/index.ts — getMessageById function
```

### Task 0.2: Rewrite ImageLightboxModal.tsx
The current file is corrupted. **Rewrite from scratch** with this spec:

```typescript
interface ImageLightboxModalProps {
  messageIds: string[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (index: number) => void;
}
```

**The lightbox must:**
1. Accept message IDs (not URLs) — fetch and decrypt on demand
2. Use `GET /api/messages/:messageId` to get attachment info
3. Use existing crypto functions to decrypt: `downloadEncryptedAttachment`, `decryptBinaryData`
4. Preload adjacent images (currentIndex ± 1)
5. Support keyboard nav (Escape, ArrowLeft, ArrowRight)
6. Support pinch-to-zoom on mobile
7. Support Ctrl+scroll zoom on desktop
8. Show loading spinner while decrypting
9. Show thumbnail strip at bottom for multi-image groups
10. Counter "2 / 5" at bottom center
11. Close button top-right

**Import from correct paths:**
```typescript
import { downloadEncryptedAttachment } from '../../lib/attachments';
import { decryptBinaryData, getOrGenerateChannelKey, getOrDeriveSharedKey } from '../../lib/crypto';
```

### Task 0.3: Fix ChatArea Lightbox Wiring
**Current issue**: ChatArea passes `messageIds` to lightbox, but the lightbox can't decrypt without knowing the key. The lightbox needs to derive the key from the message context.

**Fix in ChatArea.tsx:**
```typescript
const openLightbox = useCallback((messageId: string, groupMessageIds?: string[]) => {
  const messageIds = groupMessageIds || [messageId];
  const idx = messageIds.indexOf(messageId);
  if (idx < 0) return;
  setActiveLightbox({ messageIds, currentIndex: idx });
}, []);
```

**Fix MessageItem.tsx line 296** — pass message ID, not URL:
```typescript
onImageClick={(messageId: string) => openLightbox(messageId)}
```

### Task 0.4: Fix ProfileModal Media Click
ProfileModal's `onImageClick` passes `(msg.id, meta.fileName)` — ensure the chain works:
- ProfileModal → `onImageClick(msg.id)` → ChatArea `openLightbox(msg.id)` → Lightbox fetches + decrypts

**REGRESSION CHECK**: DMs, channels, badges, checkmarks all still work. Lightbox opens for all image types.

**COMMIT**: `git commit -m "phase-0: rewrite corrupted lightbox, fix image display chain"`

---

## Phase 1: Fix Core Bugs

### Task 1.1: Star Button Quick Access
**Current**: Star toggle is ONLY in the 3-dot overflow menu (MessageItem.tsx line 473-483).
**Fix**: Add standalone star button on hover next to 3-dot menu.

In `MessageItem.tsx`, add near action buttons (around line 380-410):
```tsx
<button
  onClick={() => onToggleStar?.(msg.id, isStarred)}
  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
  title={isStarred ? "Unstar" : "Star"}
>
  <Star className={`w-3.5 h-3.5 ${isStarred ? 'text-yellow-500 fill-yellow-500' : 'text-[var(--text-muted)]'}`} />
</button>
```

### Task 1.2: Starred Panel Shows Attachment Info
In `ChatArea.tsx` starred section (lines 946-981), fix attachment-only messages showing fallback text:
```tsx
const displayText = msg?.text 
  || (msg?.attachmentMeta?.mimeType?.startsWith('image/') ? '📷 Image' 
  : msg?.attachmentMeta?.mimeType?.startsWith('video/') ? '🎬 Video'
  : msg?.attachmentMeta?.mimeType?.startsWith('audio/') ? '🎵 Audio'
  : msg?.attachmentMeta?.fileName || `Message ${msgId.slice(0, 8)}...`);
```

### Task 1.3: Channel Key 404 Spam
**File**: `client/src/lib/crypto.ts` line 498
**Fix**: Add `.catch(() => null)` to fetch call. Also in `useChannels.ts` lines 43, 76 — don't call if no members.

### Task 1.4: Forwarded Message Navigation
**File**: `client/src/components/chat/MessageItem.tsx` lines 222-226
**Fix**: Add `onClick` handler on forwarded badge to navigate to source conversation.

### Task 1.5: Blocking Server-Side Enforcement
**File**: `server/src/index.ts` — `message:send` handler
**Fix**: Before relaying, check if sender is blocked by recipient → reject silently.
```typescript
const isBlocked = await isUserBlockedBy(recipientId, senderId);
if (isBlocked) return;
```

### Task 1.6: Read Receipts Update Without Sending
**File**: `App.tsx` lines 291-302 (handleSelectUser)
**Fix**: Emit `message:read` with last message ID when opening conversation. Server replies with `message:read_ack` → updates all messages to blue checkmark.

### Task 1.7: Render ToastContainer
**File**: `App.tsx` — import and render `<ToastContainer />` at root.

### Task 1.8: Create Header.tsx with Pinned/Starred Box
Create `client/src/components/Header.tsx`:
- Search button → opens MessageSearch modal
- Pinned/Starred button → contextual dropdown with jump-to
- Wire Ctrl+K shortcut in App.tsx

### Task 1.9: DM List Persistence Edge Cases
- Include hidden conversation IDs in localStorage order
- Verify muted conversations persist across sessions

**REGRESSION CHECK**: All features work after Phase 1.

**COMMIT**: `git commit -m "phase-1: lightbox fix, stars, blocking, receipts, header, 404 spam"`

---

## Phase 2: Database Restructuring (Enterprise → Social)

### Task 2.1: Rename `full_name` → `display_name`
```
BACKEND:
- server/src/db/schema.sql — ALTER TABLE users RENAME COLUMN full_name TO display_name
- server/src/index.ts — update ALL queries from full_name → display_name
- server/src/db/index.ts — update ALL queries

FRONTEND:
- client/src/types/chat.ts — update User type
- client/src/hooks/useAuth.ts — update registration
- client/src/hooks/usePresence.ts — update user directory
- ALL components referencing fullName → displayName
```

### Task 2.2: Remove Company Roles — All Users Are Members
```
BACKEND:
- server/src/db/schema.sql — set all users role='MEMBER', add is_owner boolean
- server/src/index.ts — remove role-based middleware

FRONTEND:
- client/src/types/chat.ts — remove role from User type
- client/src/components/AdminDashboard.tsx — rename to "Settings"
```

### Task 2.3: Add User Profile Columns
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
```
Backend: Add `/api/users/me/banner`, `/api/users/me/bio` endpoints.
Frontend: Add banner/bio fields to ProfileDrawer.

### Task 2.4: Create Friends Table + API
```sql
CREATE TABLE friends (
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  friend_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id)
);
```
Backend: `/api/friends/add`, `/api/friends/accept`, `/api/friends/remove`, `/api/friends/list`
Frontend: Add Friend button in sidebar, friend requests, friend-based DMs only.

### Task 2.5: Create Hub/Group Tables (Discord-like Structure)
```sql
CREATE TABLE hubs (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon_url TEXT,
  banner_url TEXT,
  created_by VARCHAR(255) REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hub_members (
  hub_id VARCHAR(255) REFERENCES hubs(id) ON DELETE CASCADE,
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hub_id, user_id)
);

CREATE TABLE groups (
  id VARCHAR(255) PRIMARY KEY,
  hub_id VARCHAR(255) REFERENCES hubs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) DEFAULT 'text',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_visibility (
  group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_messages (
  id VARCHAR(255) PRIMARY KEY,
  group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
  sender_id VARCHAR(255) REFERENCES users(id),
  ciphertext TEXT,
  iv TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_edited BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  reply_to VARCHAR(255)
);
```
Backend: Hub CRUD endpoints, group CRUD endpoints, visibility management.
Frontend: Hub list in sidebar, hub settings modal, group list, visibility management.

**REGRESSION CHECK**: DMs, auth, registration all work.

**COMMIT**: `git commit -m "phase-2: display_name, remove roles, friends, hubs/groups schema"`

---

## Phase 3: Friends + Display Name

### Task 3.1: DMs Show Display Name
- Sidebar: Show `displayName` instead of `fullName`
- ChatArea header: Show `displayName`
- MessageItem: Show `displayName` for sender
- ProfileDrawer: Show `displayName`

### Task 3.2: Friend-Based DMs
- Sidebar DM list: Only show friends (not all users)
- Add friend request flow in sidebar
- Accept/reject friend requests
- Remove friends

### Task 3.3: Profile Customization
- ProfileDrawer: Add banner upload
- ProfileDrawer: Add avatar upload (improved)
- ProfileDrawer: Add display name edit
- ProfileDrawer: Add bio edit
- Backend: Upload endpoints for banner/avatar
- Backend: Display name/bio update endpoints

**REGRESSION CHECK**: Friends, DMs, display names, profile editing all work.

**COMMIT**: `git commit -m "phase-3: friends system, DMs show displayName, profile customization"`

---

## Phase 4: Security Hardening

### Task 4.1: PBKDF2 100K → 600K
**File**: `client/src/lib/crypto.ts` line ~451
- Increase iterations from 100000 to 600000
- Add vault migration utility (re-wrap on login)
- Handle legacy vaults gracefully

### Task 4.2: CSP Headers + Security Middleware
**File**: `server/src/index.ts`
- Configure helmet with CSP headers
- Add X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- Add HSTS header

### Task 4.3: JWT → httpOnly Cookies
**Files**: `client/src/hooks/useAuth.ts`, `client/src/lib/socket.ts`, `server/src/index.ts`
- Server: Set JWT in httpOnly cookie on login
- Server: Read JWT from cookie in socket auth
- Client: Remove localStorage.setItem for JWT
- Client: Update getJwtToken to read from cookie

**REGRESSION CHECK**: Login works, security headers present, socket reconnects.

**COMMIT**: `git commit -m "phase-4: PBKDF2 600K, CSP headers, httpOnly cookies"`

---

## Phase 5: Performance + Production

### Task 5.1: Message Pagination
**Files**: `server/src/db/index.ts`, `client/src/hooks/useMessages.ts`, `client/src/components/ChatArea.tsx`
- Server: Add limit/offset params to message endpoints
- Client: Update fetchAllHistory to paginate (load 50, then "load more")
- UI: Add "Load earlier messages" button in ChatArea

### Task 5.2: Message Virtualization
- Install react-window + react-window-infinite-loader
- Replace message map with FixedSizeList
- Implement loadMore callback for infinite scroll up
- Preserve scroll position on new messages

### Task 5.3: Testing Suite
- Set up Vitest for client
- Crypto tests: key gen, encrypt/decrypt round-trip
- DB tests: message CRUD, status transitions
- Socket tests: message send/ack

### Task 5.4: Structured Logging + Cleanup
- Create server logger (Pino)
- Replace console.log with structured logs
- Clean up ~40 debug console.log statements

**REGRESSION CHECK**: Pagination works, virtualization works, tests pass.

**COMMIT**: `git commit -m "phase-5: pagination, virtualization, tests, logging"`

---

## Verification After All Phases

```bash
npm run typecheck
npm run lint
npm test
```

**Full smoke test:**
- [ ] Lightbox opens for all image types (single, grouped, channel, profile)
- [ ] Star button accessible on hover, starred panel shows attachment info
- [ ] DM list order persists across sessions
- [ ] No 404 spam in console
- [ ] Forward click navigates to source
- [ ] Blocked user can't send messages
- [ ] Header with pinned/starred dropdown works
- [ ] Ctrl+K opens search
- [ ] ToastContainer renders
- [ ] Read receipts update on conversation open
- [ ] Unread badges update correctly
- [ ] Channels work (create, join, send, receive, key distribution)
- [ ] Offline queue auto-flushes on reconnect
- [ ] Display name shows everywhere (not fullName)
- [ ] Friends system works (add, accept, remove, friend-based DMs)
- [ ] Profile customization works (banner, avatar, bio, display name)
- [ ] Security headers present
- [ ] PBKDF2 at 600K iterations
- [ ] Pagination works for large message histories
- [ ] Tests pass

**FINAL COMMIT**: `git commit -m "stable: all features working, security hardened, performance optimized"`

---

## Notes
- **Lightbox is the biggest fix** — file is corrupted, needs full rewrite
- **Phase 1 fixes bugs, Phase 2+ adds features** — don't skip Phase 1
- **Hub/group tables replace channels** — the Discord-like structure
- **Friends replace all-users DM list** — only friends show in DMs
- **Display name replaces full name** — everywhere in the codebase
- **Security hardening is non-negotiable** — PBKDF2, CSP, httpOnly cookies
