# Vault2E STABLE BUILD — Everything Needed for a Working Release

> **Goal**: Get Vault2E to a stable, working state with all core features functional. This prompt covers all known bugs, missing features from the lightbox corruption, star functionality improvements, and DM list persistence.

---

## CRITICAL RULES

1. **FULL STACK AWARENESS** — Every change has frontend AND backend implications. Check both.
2. **ONE MINOR LETTER CAN BREAK EVERYTHING** — Read the entire file before editing.
3. **DON'T REIMPLEMENT WHAT'S WORKING** — Only fix what's actually broken.
4. **REGRESSION CHECKS AFTER EVERY CHANGE** — If something breaks, REVERT.
5. **COMMIT AFTER EACH PHASE** — `git commit -m "phase-N: description"`

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
// openLightbox should work with both single messages and groups
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

**Fix AttachmentMessage.tsx line 79** — the component decrypts and creates a blob URL, but the lightbox expects message IDs. Change the chain so:
- AttachmentMessage passes `msg.id` to `onImageClick`
- Lightbox fetches and decrypts using the message ID

### Task 0.4: Fix ProfileModal Media Click
ProfileModal's `onImageClick` passes `(msg.id, meta.fileName)` — the lightbox needs message IDs. Ensure the chain works:
- ProfileModal → `onImageClick(msg.id)` → ChatArea `openLightbox(msg.id)` → Lightbox fetches + decrypts

**REGRESSION CHECK**: DMs, channels, badges, checkmarks all still work. Lightbox opens for: single image in DM, grouped images, channel images, profile media gallery images.

**COMMIT**: `git commit -m "phase-0: rewrite corrupted lightbox, fix image display chain"`

---

## Phase 1: Fix Star/Bookmark Functionality

### Task 1.1: Star Button Quick Access
**Current**: Star toggle is ONLY in the 3-dot overflow menu (MessageItem.tsx line 473-483).
**Fix**: Add a standalone star button that appears on hover next to the 3-dot menu, like Discord's pin icon.

In `MessageItem.tsx`, add near the action buttons (around line 380-410):
```tsx
<button
  onClick={() => onToggleStar?.(msg.id, isStarred)}
  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
  title={isStarred ? "Unstar" : "Star"}
>
  <Star className={`w-3.5 h-3.5 ${isStarred ? 'text-yellow-500 fill-yellow-500' : 'text-[var(--text-muted)]'}`} />
</button>
```

### Task 1.2: Star Attachments (Already Works — Just Verify)
The star operates on message IDs, so attachments ARE starred when the message is starred. No change needed — just verify the star badge shows on attachment messages.

### Task 1.3: Starred Panel Shows Attachment Info
In `ChatArea.tsx` starred section (lines 946-981), starred messages with attachments show `Message ${msgId.slice(0, 8)}...` fallback text. Fix to show attachment filename or "📷 Image" / "📄 Document" based on mimeType.

```tsx
const displayText = msg?.text 
  || (msg?.attachmentMeta?.mimeType?.startsWith('image/') ? '📷 Image' 
  : msg?.attachmentMeta?.mimeType?.startsWith('video/') ? '🎬 Video'
  : msg?.attachmentMeta?.mimeType?.startsWith('audio/') ? '🎵 Audio'
  : msg?.attachmentMeta?.fileName || `Message ${msgId.slice(0, 8)}...`);
```

### Task 1.4: Star Panel Jump Works for Attachments
The "Jump" button in the starred panel scrolls to the message. For attachment messages, ensure the scroll target exists (`msg-${messageId}` element) and the highlight animation works.

**REGRESSION CHECK**: Star/unstar works, badge shows, starred panel lists messages with attachment info, jump works.

**COMMIT**: `git commit -m "phase-1: star quick-access button, attachment info in starred panel"`

---

## Phase 2: DM List Position Persistence (Already Working — Just Verify + Fix Edge Cases)

### Task 2.1: Verify DM Order Persistence
**Current state** (from audit): DM order IS persisted to `localStorage` key `vaultchat_recentDMs`. On login, order is restored. New messages bump to top.

**Verify**: Login → send messages → logout → login → DM order is preserved.

### Task 2.2: Fix Edge Case — Hidden Conversations Not in localStorage
Hidden conversations (`vaultchat_hiddenConversations` in Dexie) are filtered out in Sidebar but not accounted for in the DM order. If a conversation is hidden then unhidden, it may lose its position.

**Fix**: Include hidden conversation IDs in the localStorage order, just filter display.

### Task 2.3: Fix Edge Case — Muted Conversations Order
Muted conversations should still be ordered by most recent message, just with a mute icon. Currently `getMutedConversations()` returns a Set from Dexie — verify this persists across sessions.

**REGRESSION CHECK**: DM order preserved across sessions. Hidden/muted conversations maintain position when unhidden/unmuted.

**COMMIT**: `git commit -m "phase-2: DM list persistence edge cases fixed"`

---

## Phase 3: Fix Remaining Console Errors

### Task 3.1: Channel Key 404 Spam
**File**: `client/src/lib/crypto.ts` line 498
**Fix**: Add `.catch(() => null)` to the fetch call. Also in `useChannels.ts` lines 43, 76 — don't call `getOrGenerateChannelKey` if channel has no members.

### Task 3.2: Forwarded Message Navigation
**File**: `client/src/components/chat/MessageItem.tsx` lines 222-226
**Fix**: Add `onClick` handler on forwarded badge to navigate to the source conversation and scroll to the original message.

**REGRESSION CHECK**: No 404 spam in console. Forward click navigates.

**COMMIT**: `git commit -m "phase-3: fix 404 spam, forwarded message navigation"`

---

## Phase 4: Blocking Server-Side Enforcement

### Task 4.1: Server Blocks on message:send
**File**: `server/src/index.ts` — `message:send` handler
**Fix**: Before relaying, check if sender is blocked by recipient:
```typescript
const isBlocked = await isUserBlockedBy(recipientId, senderId);
if (isBlocked) return; // silently drop
```

### Task 4.2: Server Blocks on channel:message:send
Same check for channel messages — if sender is blocked by any channel member, drop for that member.

### Task 4.3: Client Drops Blocked Messages
**File**: `client/src/hooks/useMessages.ts` — `onMessageReceive` handler
**Fix**: Check if sender is in `blockedUsers` Set → drop message silently.

**REGRESSION CHECK**: Block user → they can't message you. Unblock → messages work again.

**COMMIT**: `git commit -m "phase-4: blocking server-side enforcement"`

---

## Phase 5: Header.tsx with Pinned/Starred + Ctrl+K

### Task 5.1: Create Header.tsx
Create `client/src/components/Header.tsx`:
- Search button → opens MessageSearch modal via `openSearch()`
- Pinned/Starred button → opens contextual dropdown
- Dropdown shows: pinned messages (channel-scoped) + starred messages (DM-scoped)
- Each message has "Jump to" button on hover
- Jump: navigate to conversation → scroll to message → highlight 1.5s

### Task 5.2: Wire Header into App.tsx
Render `<Header />` above the main content area.

### Task 5.3: Ctrl+K Shortcut
In `App.tsx`, add `useEffect` with keydown listener for Ctrl+K → `openSearch()`.

**REGRESSION CHECK**: Header renders, search opens, pinned/starred dropdown works, Ctrl+K works.

**COMMIT**: `git commit -m "phase-5: Header.tsx with pinned/starred box, Ctrl+K shortcut"`

---

## Phase 6: ToastContainer + Read Receipts Fix

### Task 6.1: Render ToastContainer
**File**: `App.tsx` — import and render `<ToastContainer />` at root level.

### Task 6.2: Read Receipts Update Without Sending New Message
**Current**: Read receipts (blue checkmarks) only update when a new message is sent.
**Fix**: In `handleSelectUser` and `handleSelectChannel`, emit `message:read` for the conversation. The server should reply with `message:read_ack` which updates the status in Dexie.

**File**: `App.tsx` lines 291-302 (handleSelectUser) — ensure `message:read` is emitted with the last message ID.

**REGRESSION CHECK**: Open a conversation → all messages from that peer turn blue checkmark without sending a new message.

**COMMIT**: `git commit -m "phase-6: ToastContainer, read receipts update on open"`

---

## Verification After All Phases

```bash
npm run typecheck
npm run lint
```

**Manual smoke test:**
- [ ] Lightbox opens for single images, grouped images, channel images, profile media
- [ ] Lightbox shows full-quality decrypted images (not thumbnails)
- [ ] Star button accessible on hover (not just in 3-dot menu)
- [ ] Starred panel shows attachment info (image/video/audio/doc icons)
- [ ] Starred panel jump works for all message types
- [ ] DM list order persists across sessions
- [ ] No 404 spam in console
- [ ] Forward click navigates to source
- [ ] Blocked user can't send messages
- [ ] Header with pinned/starred dropdown works
- [ ] Ctrl+K opens search
- [ ] ToastContainer renders
- [ ] Read receipts update on conversation open (not just on send)
- [ ] Unread badges update correctly
- [ ] Channels work (create, join, send, receive, key distribution)
- [ ] Offline queue auto-flushes on reconnect

**FINAL COMMIT**: `git commit -m "stable: all core features working, lightbox fixed, stars working, blocking enforced"`

---

## Notes
- **Lightbox is the biggest fix** — the file is corrupted and needs a full rewrite
- **Star functionality is mostly working** — just needs quick-access button and attachment info display
- **DM persistence is already working** — just verify edge cases
- **Blocking needs server enforcement** — client-side check exists but server doesn't check
- **Don't touch what's working** — DMs, channels, crypto, auth, presence all work
