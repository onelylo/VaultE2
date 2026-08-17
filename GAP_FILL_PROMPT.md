# Vault2E GAP FILL — Everything Missing Between Current State and Peak Vaultchat

## What the Audit Found

### ALREADY WORKING (Don't Touch)
- All message CRUD (edit, delete, forward, pin, unpin) — fully implemented in useMessages.ts
- All channel handlers (create, join, key distribution, key rotation, member added) — fully implemented in useChannels.ts
- DeliveryIcon IS blue for read status (text-sky-500 with glow) — MessageItem.tsx lines 11-38
- Forwarded badge IS rendered — MessageItem.tsx lines 222-226
- Starred badge IS rendered — MessageItem.tsx line 311
- Unread badges ARE computed via Dexie liveQuery — App.tsx lines 90-112
- handleUpdateProfile DOES update local state + emit socket — App.tsx lines 688-713
- handleSelectUser DOES emit message:read — App.tsx lines 291-302
- handleSelectChannel DOES join room + request key — useChannels.ts lines 223-237
- Periodic flush IS 3s — App.tsx lines 258-265
- MessageSearch component EXISTS and is fully implemented (265 lines)
- UserAvatarMenu component EXISTS and is fully implemented (115 lines)
- handleRotateKey IS implemented in useCrypto.ts lines 103-189
- Token expiry check IS in useAuth.ts lines 121-130
- Toast system works (showToast from lib/toast, appends to DOM)
- Offline queue flush IS in App.tsx
- Recent DMs + preview text ARE in App.tsx lines 76-77, 597-599, 679-681
- Typing indicators work (emit user:typing/stop_typing in usePresence.ts lines 244-255)
- Server uses `user:status_change` not `user:offline` — this is correct, not a bug
- No duplicate socket handlers between usePresence and useChannels — verified clean
- Server has ALL endpoints: channel key, starred, user keys, channel CRUD, message CRUD
- blocked_users table EXISTS in schema.sql
- pinned_messages table EXISTS in schema.sql
- starred_messages table EXISTS in schema.sql

### ACTUALLY BROKEN (Fix These)
1. **Channel key 404 spam** — crypto.ts line 498 calls `/api/channels/:id/key` which returns 404 when no key stored. Need `.catch(() => null)` and graceful handling.
2. **Header.tsx DOESN'T EXIST** — pinned/starred contextual box can't render. Need to create it.
3. **No Ctrl+K shortcut** — missing keydown listener in App.tsx
4. **Forwarded message click doesn't navigate** — badge shows but no click handler to jump to conversation
5. **Starred jump button can't work** — depends on Header.tsx which doesn't exist
6. **Blocking server-side enforcement missing** — blocked_users table exists, block API exists, but server doesn't check on `message:send` if sender is blocked
7. **`full_name` column not `display_name`** — DB rename needed
8. **`role` column still exists** — needs removal or rename to `is_owner`
9. **No `friends` table** — DB schema missing
10. **No `hubs`/`groups` tables** — DB schema missing
11. **No banner_url/bio columns on users** — DB schema missing

### MISSING FROM RESTRUCTURE PROMPT (From Peak Vaultchat Vision)
1. **PBKDF2 100K → 600K** — security hardening, vault migration
2. **CSP headers + security middleware** — helmet configuration
3. **JWT → httpOnly cookies** — XSS protection
4. **Message pagination** — O(n) memory on large histories
5. **Message virtualization** — react-window for 500+ messages
6. **Testing suite** — Vitest + CI
7. **Structured logging** — Pino
8. **Console.log cleanup** — ~40 debug statements
9. **Deployment** — Docker + TLS
10. **WebRTC signaling** — P2P calls
11. **SFrame E2EE** — media encryption for group calls
12. **Mediasoup SFU** — group voice/screen channels

---

## CRITICAL RULES — Read Before Doing Anything

### 1. FULL STACK AWARENESS
Every issue has **BOTH frontend AND backend components**. Check both sides before changing anything.

### 2. ONE MINOR LETTER CAN BREAK EVERYTHING
Read the entire file before changing it. Check all imports/exports. Verify what other files depend on this file.

### 3. DON'T REIMPLEMENT WHAT'S WORKING
The audit confirmed many features ARE implemented. Don't rewrite them. Only fix what's actually broken.

### 4. REGRESSION CHECKS AFTER EVERY CHANGE
After EACH change, verify existing features still work. If something breaks, REVERT.

### 5. VERIFY BEFORE PROCEEDING
After each task group, STOP and ask: "Does everything work?" If anything is broken, FIX IT before moving on.

### 6. COMMIT AFTER EACH PHASE
```bash
git add -A && git commit -m "phase-N: <description>"
```

---

## Phase 1: Fix What's Broken (Do First)

### Task 1.1: Fix Channel Key 404 Spam
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/lib/crypto.ts — line 498, getOrGenerateChannelKey fetch call
- client/src/hooks/useChannels.ts — lines 43, 76 (calling getOrGenerateChannelKey on mount)
- client/src/hooks/useMessages.ts — lines 51, 58 (calling getOrGenerateChannelKey for messages)

BACKEND:
- server/src/index.ts — /api/channels/:id/key route (lines 1364-1377, EXISTS and works)
```

**Root Cause**: `getOrGenerateChannelKey` in crypto.ts calls `/api/channels/:id/key` which returns 404 when no key is stored for that channel. The function doesn't catch the404 gracefully.

**Fix**:
1. `crypto.ts` line 498: Add `.catch(() => null)` to the fetch call so 404 returns null silently
2. `useChannels.ts` line 43: Don't call `getOrGenerateChannelKey` during mount if channel has no members loaded yet
3. `useMessages.ts` lines 51, 58: If first attempt returns null, don't retry — just return null

**REGRESSION CHECK**: Verify DMs still work, sidebar still shows, auth still works

### Task 1.2: Create Header.tsx with Pinned/Starred Contextual Box
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/components/Header.tsx — DOES NOT EXIST, need to create
- client/src/hooks/useUIState.ts — check showSearch, openSearch
- client/src/hooks/useMessages.ts — check pinnedMessages, starredSet
- client/src/App.tsx — check where header would be rendered
```

**Create `client/src/components/Header.tsx`**:
1. Search button → opens MessageSearch modal via `openSearch()`
2. Pinned/Starred button → opens contextual dropdown box
3. Contextual box shows:
   - Pinned messages (channel-scoped) with "Jump to" button
   - Starred messages (DM-scoped) with "Jump to" button
   - Hover message → show "Jump to" button
4. Jump-to: navigate to conversation → scroll to message → highlight for 1.5s

**Reference**: PetroShield `ProfileModal.tsx` lines 294-299 (jumpBtn implementation), `ChatArea.tsx` lines 1043-1074 (onJumpToMessage)

**REGRESSION CHECK**: Verify channels still work, badges still update, checkmarks still display

### Task 1.3: Add Ctrl+K Shortcut
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/App.tsx — check for keydown listener
- client/src/hooks/useUIState.ts — check openSearch function
```

**Fix**: Add `useEffect` in App.tsx with `keydown` listener for Ctrl+K → calls `openSearch()`

**REGRESSION CHECK**: Verify channels still work, badges still update

### Task 1.4: Fix Forwarded Message Navigation
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/components/chat/MessageItem.tsx — check forwarded badge (lines 222-226), check click handler
- client/src/components/ChatArea.tsx — check message navigation logic
- client/src/App.tsx — check handleSelectUser, handleSelectChannel
```

**Root Cause**: Forwarded badge renders but has no click handler to navigate to the conversation.

**Fix**:
1. Add `onClick` handler on forwarded badge in MessageItem.tsx
2. Navigate to the conversation with the user/channel the message was forwarded from
3. Scroll to the original message and highlight briefly

**REGRESSION CHECK**: Verify channels still work, badges still update, checkmarks still display

### Task 1.5: Fix Starred Message Jump Button
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/components/Header.tsx — check if exists (created in Task 1.2)
- client/src/components/ChatArea.tsx — check scroll to message logic
```

**Depends on**: Task 1.2 (Header.tsx creation)

**Fix**: Wire jump button in Header contextual box to navigate to conversation + scroll to message + highlight

**REGRESSION CHECK**: Verify channels still work, badges still update

### Task 1.6: Fix Blocking Server-Side Enforcement
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/hooks/useMessages.ts — check message:receive handler for block check
- client/src/App.tsx — check handleBlockUser

BACKEND:
- server/src/index.ts — check message:send handler for block check
- server/src/db/index.ts — check blocked_users queries
- server/src/db/schema.sql — check blocked_users table (EXISTS)
```

**Root Cause**: blocked_users table exists and block API works, but server doesn't check on `message:send` if sender is blocked by recipient.

**Fix**:
1. Server `message:send` handler: Before relaying, check if sender is blocked by recipient → reject silently
2. Server `channel:message:send` handler: Same check
3. Client `message:receive` handler: Check if sender is blocked → drop message silently
4. Client: On block, immediately close DM and show "User blocked" message

**REGRESSION CHECK**: Verify channels still work, badges still update, checkmarks still display

### Task 1.7: Render ToastContainer in App.tsx
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/App.tsx — check JSX for ToastContainer
- client/src/lib/toast.tsx — check ToastContainer export
```

**Fix**: Import and render `<ToastContainer />` in App.tsx JSX (toasts currently work via DOM append but having the component ensures proper React integration)

**REGRESSION CHECK**: Verify channels still work, badges still update

---

## Phase 2: Database Restructuring (After Phase 1 Verified)

### Task 2.1: Rename `full_name` → `display_name`
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/types/chat.ts — check User type, fullName field
- client/src/hooks/useAuth.ts — check registration, profile update
- client/src/hooks/usePresence.ts — check user directory
- client/src/components/Sidebar.tsx — check name display
- client/src/components/ChatArea.tsx — check name display
- client/src/components/chat/MessageItem.tsx — check name display
- client/src/components/ProfileDrawer.tsx — check profile editing
- client/src/components/UserAvatarMenu.tsx — check name display
- client/src/components/MessageSearch.tsx — check name display

BACKEND:
- server/src/index.ts — check ALL references to full_name
- server/src/db/index.ts — check ALL queries referencing full_name
- server/src/db/schema.sql — check users table
```

**Changes**:
1. Database: `ALTER TABLE users RENAME COLUMN full_name TO display_name`
2. Backend: Update ALL queries from `full_name` → `display_name`
3. Frontend: Update ALL references from `fullName` → `displayName` in types, hooks, components
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
- client/src/components/Sidebar.tsx — check role display

BACKEND:
- server/src/index.ts — check role-based middleware, admin routes
- server/src/db/index.ts — check user queries
- server/src/db/schema.sql — check users table, role column
```

**Changes**:
1. Database: Remove `role` column or set all to 'MEMBER', add `is_owner` boolean for hub ownership
2. Backend: Remove role-based middleware for non-hub operations
3. Frontend: Remove role display from user profiles
4. Keep: Admin dashboard for user management (rename to "Settings")

**REGRESSION CHECK**: Verify DMs still work, channels still work, badges still update

### Task 2.3: Add User Profile Columns
**BEFORE FIXING — Audit These Files**:
```
BACKEND:
- server/src/db/schema.sql — check users table columns
- server/src/index.ts — check profile update endpoints
```

**Changes**:
1. Database: `ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT`
2. Database: `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`
3. Backend: Add `/api/users/me/banner` endpoint (upload)
4. Backend: Add `/api/users/me/bio` endpoint (update)
5. Frontend: Add banner and bio fields to ProfileDrawer

**REGRESSION CHECK**: Verify DMs still work, auth still works

### Task 2.4: Create Friends Table + API
**BEFORE FIXING — Audit These Files**:
```
BACKEND:
- server/src/db/schema.sql — check for friends table (MISSING)
- server/src/index.ts — check for friends routes

FRONTEND:
- client/src/types/chat.ts — check for friend types
- client/src/components/Sidebar.tsx — check for friend list
```

**Changes**:
1. Database: Create `friends` table:
   ```sql
   CREATE TABLE friends (
     user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
     friend_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
     status VARCHAR(50) DEFAULT 'pending',
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (user_id, friend_id)
   );
   ```
2. Backend: Add `/api/friends/add` (accepts username)
3. Backend: Add `/api/friends/accept`
4. Backend: Add `/api/friends/remove`
5. Backend: Add `/api/friends/list`
6. Frontend: Add "Add Friend" button in sidebar
7. Frontend: Show friend requests in sidebar
8. Frontend: Only show friends in DM list

**REGRESSION CHECK**: Verify DMs still work, channels still work

### Task 2.5: Create Hub/Group Tables
**BEFORE FIXING — Audit These Files**:
```
BACKEND:
- server/src/db/schema.sql — check for hubs/groups tables (MISSING)
- server/src/db/index.ts — check for hub CRUD functions
- server/src/index.ts — check for hub routes

FRONTEND:
- client/src/types/chat.ts — check for hub/group types
- client/src/components/Sidebar.tsx — check for hub list
```

**Changes**:
1. Database: Create `hubs` table:
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
   ```
2. Database: Create `hub_members` table
3. Database: Create `groups` table (sub-channels within hubs)
4. Database: Create `group_visibility` table (which members can see which groups)
5. Database: Create `group_messages` table
6. Backend: Add hub CRUD endpoints
7. Backend: Add group CRUD endpoints
8. Backend: Add visibility management endpoints
9. Frontend: Add hub list in sidebar
10. Frontend: Add hub settings modal
11. Frontend: Add group list within hub view
12. Frontend: Add group visibility management

**REGRESSION CHECK**: Verify DMs still work, auth still works

---

## Phase 3: Friends + Display Name (After Phase 2 Verified)

### Task 3.1: DMs Show Display Name
**Changes**:
- Sidebar: Show `displayName` instead of `fullName` in DM list
- ChatArea header: Show `displayName`
- MessageItem: Show `displayName` for sender
- ProfileDrawer: Show `displayName`
- UserAvatarMenu: Show `displayName`

**REGRESSION CHECK**: Verify channels still work, badges still update

### Task 3.2: Friend-Based DMs
**Changes**:
- Sidebar DM list: Only show friends (not all users)
- Add friend request flow in sidebar
- Accept/reject friend requests
- Remove friends

**REGRESSION CHECK**: Verify channels still work, badges still update

---

## Phase 4: Profile Customization (After Phase 3 Verified)

### Task 4.1: Profile Customization
**Changes**:
1. ProfileDrawer: Add banner upload
2. ProfileDrawer: Add avatar upload
3. ProfileDrawer: Add display name edit
4. ProfileDrawer: Add bio edit
5. Backend: Add upload endpoints for banner/avatar
6. Backend: Add display name/bio update endpoints

**REGRESSION CHECK**: Verify channels still work, badges still update

---

## Phase 5: Security Hardening (After Phase 4 Verified)

### Task 5.1: PBKDF2 100K → 600K
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/lib/crypto.ts — check derivePasswordWrappingKey (line ~451)
```

**Changes**:
1. Increase iterations from 100000 to 600000
2. Add vault migration utility (re-wrap on login)
3. Handle legacy vaults gracefully

**REGRESSION CHECK**: Verify existing users can still login

### Task 5.2: CSP Headers + Security Middleware
**BEFORE FIXING — Audit These Files**:
```
BACKEND:
- server/src/index.ts — check helmet configuration
```

**Changes**:
1. Configure helmet with CSP headers
2. Add X-Content-Type-Options, X-Frame-Options, Referrer-Policy
3. Add HSTS header

**REGRESSION CHECK**: Verify app still loads and works

### Task 5.3: JWT → httpOnly Cookies
**BEFORE FIXING — Audit These Files**:
```
FRONTEND:
- client/src/hooks/useAuth.ts — check getJwtToken
- client/src/lib/socket.ts — check socket auth

BACKEND:
- server/src/index.ts — check login endpoint, socket auth middleware
```

**Changes**:
1. Server: Set JWT in httpOnly cookie on login
2. Server: Read JWT from cookie in socket auth
3. Client: Remove localStorage.setItem for JWT
4. Client: Update getJwtToken to read from cookie
5. Handle logout: clear cookie server-side

**REGRESSION CHECK**: Verify login/logout works, socket reconnects

---

## Phase 6: Performance + Production (After Phase 5 Verified)

### Task 6.1: Message Pagination
**Changes**:
1. Server: Add limit/offset params to message endpoints
2. Client: Update fetchAllHistory to paginate (load 50, then "load more")
3. UI: Add "Load earlier messages" button in ChatArea

**REGRESSION CHECK**: Verify messages still load and display

### Task 6.2: Message Virtualization
**Changes**:
1. Install react-window + react-window-infinite-loader
2. Replace message map with FixedSizeList
3. Implement loadMore callback for infinite scroll up
4. Preserve scroll position on new messages

**REGRESSION CHECK**: Verify messages still load and scroll

### Task 6.3: Testing Suite
**Changes**:
1. Set up Vitest for client
2. Crypto tests: key gen, encrypt/decrypt round-trip
3. DB tests: message CRUD, status transitions
4. Socket tests: message send/ack

**REGRESSION CHECK**: Verify all tests pass

### Task 6.4: Structured Logging + Cleanup
**Changes**:
1. Create server logger (Pino)
2. Replace console.log with structured logs
3. Clean up ~40 debug console.log statements

**REGRESSION CHECK**: Verify app still works

---

## Execution Order

### Phase 1: Fix What's Broken
1. Fix Channel Key 404 Spam
2. Create Header.tsx with Pinned/Starred Contextual Box
3. Add Ctrl+K Shortcut
4. Fix Forwarded Message Navigation
5. Fix Starred Message Jump Button
6. Fix Blocking Server-Side Enforcement
7. Render ToastContainer in App.tsx

**VERIFY**: DMs, channels, badges, checkmarks, search, blocking all work

**COMMIT**: `git add -A && git commit -m "phase-1: fix 404s, create Header.tsx, Ctrl+K, forwarded nav, starred jump, blocking, toast"`

### Phase 2: Database Restructuring
8. Rename full_name → display_name
9. Remove Company Roles
10. Add User Profile Columns (banner, bio)
11. Create Friends Table + API
12. Create Hub/Group Tables

**VERIFY**: DMs, auth, registration all work

**COMMIT**: `git add -A && git commit -m "phase-2: display_name, remove roles, friends table, hub/group schema"`

### Phase 3: Friends + Display Name
13. DMs Show Display Name
14. Friend-Based DMs

**VERIFY**: Friends, DMs, display names all work

**COMMIT**: `git add -A && git commit -m "phase-3: friends system, DMs show displayName"`

### Phase 4: Profile Customization
15. Profile Customization (banner, avatar, bio, display name)

**VERIFY**: Profile editing works

**COMMIT**: `git add -A && git commit -m "phase-4: profile customization (banner, avatar, bio)"`

### Phase 5: Security Hardening
16. PBKDF2 100K → 600K
17. CSP Headers
18. JWT → httpOnly Cookies

**VERIFY**: Login works, security headers present

**COMMIT**: `git add -A && git commit -m "phase-5: PBKDF2 600K, CSP headers, httpOnly cookies"`

### Phase 6: Performance + Production
19. Message Pagination
20. Message Virtualization
21. Testing Suite
22. Structured Logging + Cleanup

**VERIFY**: Pagination works, virtualization works, tests pass

**COMMIT**: `git add -A && git commit -m "phase-6: pagination, virtualization, tests, logging"`

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

---

## Notes for Agents
- **DON'T REIMPLEMENT WHAT'S WORKING** — the audit confirmed most features ARE implemented. Only fix what's actually broken.
- **404 spam is cosmetic but annoying** — fix it first for clean console
- **Header.tsx is the biggest missing piece** — create it for pinned/starred contextual box
- **Channels ARE implemented** — the issue is likely just the 404 spam breaking things
- **Blocking needs server-side enforcement** — the client-side check exists but server doesn't check on message:send
- **ONE MINOR LETTER CAN BREAK EVERYTHING** — read the entire file before changing it
- **REGRESSION CHECKS AFTER EVERY CHANGE** — if something breaks, REVERT
