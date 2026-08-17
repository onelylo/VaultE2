# Vault2E RESTRUCTURE — Discord-Like Platform with Friends, Hubs, and Permissions

## CRITICAL RULES — Read Before Doing Anything

### 1. FULL STACK AWARENESS
Every issue has **BOTH frontend AND backend components**. You MUST check both sides:
- Frontend: `client/src/hooks/`, `client/src/components/`, `client/src/lib/`, `client/src/App.tsx`
- Backend: `server/src/index.ts`, `server/src/db/index.ts`, `server/src/db/schema.sql`
- One missing socket handler on the server breaks the entire feature on the client

### 2. ONE MINOR LETTER CAN BREAK EVERYTHING
Before changing ANY file:
- Read the entire file first
- Check all imports/exports
- Verify what other files depend on this file
- If you change a function signature, check EVERY file that calls it

### 3. AUDIT ALL FILES SINCE STRANGLER-FIG
Before fixing anything, verify the strangler-fig extraction left files in correct state:
- Check all hooks exist: `useAuth.ts`, `useCrypto.ts`, `useSocket.ts`, `useChannels.ts`, `useMessages.ts`, `usePresence.ts`, `useUIState.ts`
- Check all imports in `App.tsx` match what hooks actually export
- Check all socket event names match between client and server
- Check all API endpoints match between client fetch calls and server routes

### 4. REGRESSION CHECKS AFTER EVERY CHANGE
After EACH change, verify existing features still work:
- [ ] DMs still send/receive
- [ ] Sidebar still shows conversations
- [ ] Auth still works (login/logout)
- [ ] Existing checkmarks still display correctly
- [ ] Existing badges still display correctly
- If a fix breaks something else, REVERT and find a different approach

### 5. VERIFY BEFORE PROCEEDING
After each task group, STOP and ask: "Does everything work? Test these specific things." If anything is broken, FIX IT before moving to the next task.

### 6. COMMIT AFTER EACH PHASE
After completing each phase and verifying everything works, COMMIT with a clear descriptive message:
```bash
git add -A
git commit -m "phase-N: <short description of what was done>"
```
Examples:
- `phase-1: fix channel 404s, forwarded nav, starred jump, blocking, search styling`
- `phase-2: rename fullName→displayName, remove roles, hub/group schema`
- `phase-3: add friends system, DMs show displayName`
- `phase-4: profile customization (banner, avatar, bio)`

**Why**: This lets us revert to any phase if a later phase causes issues. Never commit partial work — only commit when the full phase is verified working.

---

## Console Errors to Fix First
```
GET http://localhost:3001/api/channels/weeew/key 404 (Not Found) — crypto.ts:498, useChannels.ts:43, useChannels.ts:76
GET http://localhost:3001/api/channels/testing/key 404 (Not Found) — crypto.ts:498, useChannels.ts:230, useMessages.ts:51, useMessages.ts:58
```
These 404s are from `getOrGenerateChannelKey` trying to fetch keys for channels that don't exist or have no keys stored. The function should gracefully return null instead of throwing.

---

## Phase 1: Bug Fixes (Do First — Verify All Before Proceeding)

### Task 1.1: Fix Channel Key 404 Spam
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/lib/crypto.ts — line 498, getOrGenerateChannelKey function
- client/src/hooks/useChannels.ts — lines 43, 76, 230, 235
- client/src/hooks/useMessages.ts — lines 51, 58, 500

BACKEND:
- server/src/index.ts — check /api/channels/:id/key route
- server/src/db/index.ts — check channel_keys table operations
- server/src/db/schema.sql — check channel_keys table exists
```

**Root Cause**: `getOrGenerateChannelKey` calls `/api/channels/:id/key` which returns 404 when no key is stored. The function should catch 404 and return null silently.

**Fix**:
- `crypto.ts` line 498: Add `.catch(() => null)` to the fetch call
- `useChannels.ts` lines 43, 76: Don't call `getOrGenerateChannelKey` if channel has no members
- `useMessages.ts` lines 51, 58: Don't retry key fetch if first attempt returns null

**REGRESSION CHECK**: Verify DMs still work, sidebar still shows, auth still works

### Task 1.2: Fix Forwarded Message Navigation
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/hooks/useMessages.ts — check handleForwardMessage
- client/src/components/chat/MessageItem.tsx — check forwarded message click handler
- client/src/components/ChatArea.tsx — check message navigation
```

**Root Cause**: Forwarded message doesn't navigate to the conversation with the person it was forwarded to.

**Fix**:
- After forwarding, navigate to the target conversation (DM or channel)
- Add click handler on "Forwarded from @user" badge to jump to original conversation

**REGRESSION CHECK**: Verify channels still work, badges still update, checkmarks still display

### Task 1.3: Fix Starred Message Jump Button
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/components/Header.tsx — check contextual box, jump button
- client/src/components/ProfileModal.tsx — check onJumpToMessage
- client/src/components/ChatArea.tsx — check scroll to message logic
```

**Root Cause**: Jump button in starred messages contextual box doesn't work — likely missing `onJumpToMessage` handler or broken navigation.

**Fix**:
- Wire jump button to navigate to conversation + scroll to message + highlight
- Copy working implementation from `ProfileModal.tsx` `MediaItem` `jumpBtn`

**REGRESSION CHECK**: Verify channels still work, badges still update, checkmarks still display

### Task 1.4: Fix Offline Message Read Receipts
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/hooks/useMessages.ts — check message:receive handler, message:read emission
- client/src/App.tsx — check handleSelectUser, handleSelectChannel

BACKEND:
- server/src/index.ts — check message:read handler, message:read_ack emission
```

**Root Cause**: Offline messages that get sent when recipient comes online don't turn blue (read) when seen.

**Fix**:
- On `message:receive` for offline messages: emit `message:delivered` immediately
- On `handleSelectUser`/`handleSelectChannel`: emit `message:read` for all unread messages
- Server: `message:read` handler must emit `message:read_ack` back to sender
- Sender: `message:read_ack` handler must mark all messages to that conversation as read

**REGRESSION CHECK**: Verify channels still work, badges still update

### Task 1.5: Fix Blocking — Bidirectional Enforcement
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/hooks/useMessages.ts — check message:receive handler, block check
- client/src/App.tsx — check handleBlockUser
- client/src/lib/db.ts — check blockUser, getBlockedUsers

BACKEND:
- server/src/index.ts — check /api/block/:id route, message:send block check
- server/src/db/index.ts — check blocked_users table
- server/src/db/schema.sql — check blocked_users table exists
```

**Root Cause**: Blocking someone requires clicking on DM again to see blocked. Blocked user can still send messages.

**Fix**:
- Server: On `message:send`, check if sender is blocked by recipient → reject silently
- Client: On `message:receive`, check if sender is blocked → drop message silently
- Client: On block, immediately close DM with blocked user and show "User blocked" message
- Client: On block, emit `user:blocked` socket event so server can enforce

**REGRESSION CHECK**: Verify channels still work, badges still update, checkmarks still display

### Task 1.6: Fix Channels — Complete Channel Infrastructure
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/hooks/useChannels.ts — ALL functions and socket handlers
- client/src/hooks/useMessages.ts — channel:message:receive handler
- client/src/App.tsx — useChannels integration, channel list loading
- client/src/components/Sidebar.tsx — channel list rendering
- client/src/components/ChatArea.tsx — channel message display

BACKEND:
- server/src/index.ts — ALL channel socket handlers
- server/src/db/index.ts — ALL channel database functions
- server/src/db/schema.sql — channels, channel_members, channel_keys tables
```

**Root Cause**: Channels completely broken — can't create, join, send, receive, or see messages.

**Fix** (comprehensive):
1. Server: Verify ALL channel endpoints exist:
   - `channel:create` → create channel + distribute keys
   - `channel:join` → join channel room
   - `channel:leave` → leave channel room
   - `channel:message:send` → relay message to channel members
   - `channel:key:request` → request key from online members
   - `channel:key:upload` → store key envelopes
   - `channel:member_added` → notify members + distribute key
   - `channel:key_rotated` → notify members + re-distribute key
   - `channel:create:ack` → confirm channel creation
2. Client: Verify ALL channel hooks work:
   - `handleCreateChannel` → generate key + encrypt for members + POST
   - `handleSelectChannel` → join room + request key + wait + retry
   - `channel:message:receive` → decrypt + save + display
   - `channel:key_response` → store key + decrypt pending
3. Database: Verify tables exist and are correct:
   - `channels` table with all required columns
   - `channel_members` table with foreign keys
   - `channel_keys` table with encrypted key envelopes

**REGRESSION CHECK**: Verify DMs still work, badges still update, checkmarks still display

### Task 1.7: Fix Search Bar Styling
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/components/MessageSearch.tsx — check input styling
- client/src/components/Sidebar.tsx — check search input styling
```

**Fix**: Make search bar input text pretty and rounder — match the rest of the UI styling (rounded-xl or rounded-2xl, proper padding, focus ring)

**REGRESSION CHECK**: Verify channels still work, badges still update

### Task 1.8: Fix Header Name Hover Underline
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/components/ChatArea.tsx — check header name rendering
- client/src/components/Sidebar.tsx — check header name rendering
```

**Fix**: Remove underline on hover for names in header — add `hover:no-underline` or remove `hover:underline` class

**REGRESSION CHECK**: Verify channels still work, badges still update

---

## Phase 2: Database Restructuring (After Phase 1 Verified)

### Task 2.1: Rename Full Name → Display Name
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/types/chat.ts — check User type, fullName field
- client/src/hooks/useAuth.ts — check registration, profile update
- client/src/components/ProfileDrawer.tsx — check profile editing
- client/src/components/Sidebar.tsx — check name display
- client/src/components/ChatArea.tsx — check name display
- client/src/components/chat/MessageItem.tsx — check name display

BACKEND:
- server/src/index.ts — check registration, profile update endpoints
- server/src/db/index.ts — check user queries
- server/src/db/schema.sql — check users table, full_name column
```

**Changes**:
1. Database: `ALTER TABLE users RENAME COLUMN full_name TO display_name`
2. Backend: Update all queries referencing `full_name` → `display_name`
3. Frontend: Update all references to `fullName` → `displayName` in types, hooks, components
4. Registration: Make display name optional (default to username)
5. Profile: Allow user to change display name anytime

**REGRESSION CHECK**: Verify DMs still work, channels still work, badges still update

### Task 2.2: Remove Company Roles — All Users Are Members
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/types/chat.ts — check User type, role field
- client/src/hooks/useAuth.ts — check registration
- client/src/components/AdminDashboard.tsx — check role management
- client/src/components/ProfileDrawer.tsx — check role display

BACKEND:
- server/src/index.ts — check role-based middleware
- server/src/db/index.ts — check user queries
- server/src/db/schema.sql — check users table, role column
```

**Changes**:
1. Database: Remove `role` column or set all users to 'MEMBER'
2. Backend: Remove role-based middleware (all users are members)
3. Frontend: Remove role display, admin panel, role management
4. Keep: One user can be designated as "owner" of a hub (for permissions)

**REGRESSION CHECK**: Verify DMs still work, channels still work, badges still update

### Task 2.3: Clean Old Channel Data
**BEFORE FIXING — Audit These Files**:
```
BACKEND:
- server/src/db/schema.sql — check channels, channel_members, channel_keys tables
- server/src/db/index.ts — check channel CRUD functions
```

**Changes**:
1. Database: Drop old channel tables if they exist
2. Create new hub/group structure (see Task 2.4)

**REGRESSION CHECK**: Verify DMs still work, auth still works

### Task 2.4: Implement Hub/Group Structure (Discord-Like)
**New Database Schema**:
```sql
-- Hubs (servers/guilds)
CREATE TABLE hubs (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon_url TEXT,
  banner_url TEXT,
  created_by VARCHAR(255) REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Hub members
CREATE TABLE hub_members (
  hub_id VARCHAR(255) REFERENCES hubs(id) ON DELETE CASCADE,
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hub_id, user_id)
);

-- Groups within hubs (categories/channels)
CREATE TABLE groups (
  id VARCHAR(255) PRIMARY KEY,
  hub_id VARCHAR(255) REFERENCES hubs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) DEFAULT 'text', -- text, voice, announcement
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Group visibility (which members can see/access)
CREATE TABLE group_visibility (
  group_id VARCHAR(255) REFERENCES groups(id) ON DELETE CASCADE,
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- Messages in groups
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

-- Friends system
CREATE TABLE friends (
  user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  friend_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, blocked
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id)
);

-- User profiles (extended)
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
```

**REGRESSION CHECK**: Verify DMs still work, auth still works

---

## Phase 3: Friends System (After Phase 2 Verified)

### Task 3.1: Add Friend by Username
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/types/chat.ts — check User type
- client/src/hooks/usePresence.ts — check user directory
- client/src/components/Sidebar.tsx — check user list

BACKEND:
- server/src/index.ts — check /api/friends routes
- server/src/db/index.ts — check friends table operations
```

**Changes**:
1. Backend: Add `/api/friends/add` endpoint (accepts username)
2. Backend: Add `/api/friends/accept` endpoint
3. Backend: Add `/api/friends/remove` endpoint
4. Backend: Add `/api/friends/list` endpoint
5. Frontend: Add "Add Friend" button in sidebar
6. Frontend: Show friend requests in sidebar
7. Frontend: Only show friends in DM list (not all users)

**REGRESSION CHECK**: Verify channels still work, badges still update

### Task 3.2: DMs Show Display Name
**Changes**:
- Sidebar: Show `displayName` instead of `fullName` in DM list
- ChatArea header: Show `displayName`
- MessageItem: Show `displayName` for sender

**REGRESSION CHECK**: Verify channels still work, badges still update

---

## Phase 4: User Customization (After Phase 3 Verified)

### Task 4.1: Profile Customization
**Changes**:
1. ProfileDrawer: Add banner upload
2. ProfileDrawer: Add avatar upload
3. ProfileDrawer: Add display name edit
4. ProfileDrawer: Add bio edit
5. Backend: Add `/api/users/me/banner` endpoint
6. Backend: Add `/api/users/me/avatar` endpoint
7. Backend: Add `/api/users/me/display-name` endpoint
8. Backend: Add `/api/users/me/bio` endpoint

**REGRESSION CHECK**: Verify channels still work, badges still update

---

## Execution Order

### Phase 1: Bug Fixes (VERIFY ALL BEFORE PROCEEDING)
1. Fix Channel Key 404 Spam
2. Fix Forwarded Message Navigation
3. Fix Starred Message Jump Button
4. Fix Offline Message Read Receipts
5. Fix Blocking — Bidirectional Enforcement
6. Fix Channels — Complete Channel Infrastructure
7. Fix Search Bar Styling
8. Fix Header Name Hover Underline

**VERIFY**: Run full smoke test — DMs, channels, badges, checkmarks, search, blocking all work

**COMMIT**: `git add -A && git commit -m "phase-1: fix channel 404s, forwarded nav, starred jump, blocking, search styling"`

### Phase 2: Database Restructuring (VERIFY ALL BEFORE PROCEEDING)
9. Rename Full Name → Display Name
10. Remove Company Roles — All Users Are Members
11. Clean Old Channel Data
12. Implement Hub/Group Structure

**VERIFY**: Run full smoke test — DMs, auth, registration all work

**COMMIT**: `git add -A && git commit -m "phase-2: rename fullName→displayName, remove roles, hub/group schema"`

### Phase 3: Friends System (VERIFY ALL BEFORE PROCEEDING)
13. Add Friend by Username
14. DMs Show Display Name

**VERIFY**: Run full smoke test — friends, DMs, display names all work

**COMMIT**: `git add -A && git commit -m "phase-3: add friends system, DMs show displayName"`

### Phase 4: User Customization (VERIFY ALL BEFORE PROCEEDING)
15. Profile Customization

**VERIFY**: Run full smoke test — profile editing, banner, avatar all work

**COMMIT**: `git add -A && git commit -m "phase-4: profile customization (banner, avatar, bio)"`

---

## Verification Gates (After Each Phase)
```bash
npm run typecheck
npm run lint
npm test
```

**REGRESSION CHECKLIST (verify after EACH task)**:
- [ ] DMs still send/receive
- [ ] Sidebar still shows conversations
- [ ] Auth still works (login/logout)
- [ ] Existing checkmarks still display correctly
- [ ] Existing badges still display correctly
- [ ] No 404 errors in console
- [ ] No broken features from previous phase

**SMOKE TEST (after each phase)**:
- [ ] Login → see sidebar with DMs and channels
- [ ] Send DM → recipient receives → check marks work
- [ ] Open channel → send message → others receive
- [ ] Search works (Ctrl+K)
- [ ] Badges update on send/receive
- [ ] Offline queue works
- [ ] No console errors

---

## Files to Delete After Implementation
Remove old phase prompts that have been superseded by this restructure:
- `PHASE1_FIXES_PROMPT.md` — superseded by Phase 1 of this prompt
- `PHASE2_PROMPT.md` — superseded by Phase 2 of this prompt
- `PHASE3_PROMPT.md` — superseded by Phase 3 of this prompt
- `PHASE_UI_FIXES_PROMPT.md` — superseded by Phase 1 of this prompt
- `PHASE_REMAINING_FIXES_PROMPT.md` — superseded by Phase 1 of this prompt

Keep:
- `STRANGLER_FIG_PROMPT.md` — reference for extraction methodology
- `PeakVaultchat.md` — vision document
- `Changes.md` — hybrid E2EE model reference
- `VaultFix.md` — audit reference
- `SECURITY.md` — security documentation
- `PROJECT_STATUS.md` — bug fix history

---

## Notes for Agents
- **Channels are the priority** — nothing else matters if channels don't work
- **Don't break working features** — DMs, sidebar, auth all work; don't touch them unless fixing the specific issue above
- **Test each fix independently** — don't batch all changes and hope they work together
- **Console 404s are cosmetic** — fix them but don't let them block channel/read receipt fixes
- **ONE MINOR LETTER CAN BREAK EVERYTHING** — read the entire file before changing it, check all imports/exports, verify what other files depend on this file
- **REGRESSION CHECKS AFTER EVERY CHANGE** — if a fix breaks something else, REVERT and find a different approach
- **VERIFY BEFORE PROCEEDING** — after each task group, STOP and ask if everything works
