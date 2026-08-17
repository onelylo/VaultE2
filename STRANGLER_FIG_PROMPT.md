# Vault2E Strangler Fig Extraction — Restore by Extracting from Working Monolith

## Strategy
**Source of truth**: `C:\Users\Lylo\Documents\petroshield-chat\client\src\App.tsx` (2853 lines, working)
**Target**: Vault2E hooks — each extraction verified against stable behavior

## CRITICAL RULES — Read Before Doing Anything

### 1. FULL STACK AWARENESS
Every extraction has **BOTH frontend AND backend components**. You MUST check both sides:
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

---

## Subagent Routing
| Phase | Subagent |
|---|---|
| Setup & verification | build |
| Domain extraction (each) | api + crypto + ui + socket as needed |
| Test writing | api |
| Hook implementation | api + crypto + ui + socket |
| Verification | build |

---

## Prerequisites (Run First)

### 0. Copy Stable Monolith into Vault2E
```bash
cp C:\Users\Lylo\Documents\petroshield-chat\client\src\App.tsx C:\Users\Lylo\Documents\Vault2E\App.stable.tsx
```
- Fix any import paths in `App.stable.tsx` to point to Vault2E's `src/` structure
- Verify: `npm run typecheck` passes, `npm run dev` works 100%

### 1. Write Behavioral Tests for Each Domain
Create test files that exercise the **stable monolith's behavior** (these become the oracle):
- `tests/stable-messages.test.ts` — send/edit/delete/forward/pin/star DMs + channels
- `tests/stable-channels.test.ts` — create/join/key rotation/member add/remove
- `tests/stable-crypto.test.ts` — TOFU, key rotation, trust, re-decryption
- `tests/stable-presence.test.ts` — typing, online/offline, profile updates
- `tests/stable-admin.test.ts` — role change, delete user, panel guard
- `tests/stable-keys.test.ts` — key distribution, rotation, re-keying

**Run**: `npm test` — all must pass against `App.stable.tsx`

---

## Extraction Phases (One Domain at a Time)

### Phase A: Messages Domain → `useMessages.ts`
**Source**: `App.stable.tsx` lines handling DM/channel messages
**Target**: `src/hooks/useMessages.ts`

**BEFORE EXTRACTING — Audit These Files**:
```
FRONTEND:
- client/src/App.stable.tsx — identify ALL message-related state/functions
- client/src/hooks/useMessages.ts — check current stubs
- client/src/lib/db.ts — check message CRUD functions
- client/src/lib/crypto.ts — check encryption/decryption functions

BACKEND:
- server/src/index.ts — check message socket handlers
- server/src/db/index.ts — check message database functions
```

| Step | Action |
|---|---|
| A1 | Identify all message-related state/functions in `App.stable.tsx` |
| A2 | Copy implementations into `useMessages.ts` (replace stubs) |
| A3 | Wire `useMessages` into `App.stable.tsx` (replace inline logic) |
| A4 | Run `tests/stable-messages.test.ts` — must pass |
| A5 | Delete extracted code from `App.stable.tsx` |
| A6 | Run full test suite — no regressions |

**REGRESSION CHECK**: After extracting messages, verify channels still work, badges still update, checkmarks still display

**Preserve from Vault2E**: `isDeletedForMe` field, `decryptPayloadImpl` retry logic

### Phase B: Channels Domain → `useChannels.ts`
**Source**: `App.stable.tsx` channel logic
**Target**: `src/hooks/useChannels.ts`

**BEFORE EXTRACTING — Audit These Files**:
```
FRONTEND:
- client/src/App.stable.tsx — identify ALL channel-related state/functions
- client/src/hooks/useChannels.ts — check current stubs
- client/src/lib/crypto.ts — check channel key functions
- client/src/lib/db.ts — check channel database functions

BACKEND:
- server/src/index.ts — check ALL channel socket handlers
- server/src/db/index.ts — check channel database functions
- server/src/db/schema.sql — check channels, channel_members, channel_keys tables
```

| Step | Action |
|---|---|
| B1 | Identify channel create/join/key distribution/rotation logic |
| B2 | Copy into `useChannels.ts` (implement all stubs) |
| B3 | Wire into `App.stable.tsx` |
| B4 | Run `tests/stable-channels.test.ts` — must pass |
| B5 | Delete from `App.stable.tsx` |
| B6 | Full test suite passes |

**REGRESSION CHECK**: After extracting channels, verify DMs still work, badges still update, checkmarks still display

**Preserve from Vault2E**: `usersWithPresence` for ChannelSettingsModal

### Phase C: Crypto/Keys Domain → `useCrypto.ts` + `crypto.ts`
**Source**: `App.stable.tsx` crypto logic + existing `crypto.ts`
**Target**: `src/hooks/useCrypto.ts`, `src/crypto.ts`

**BEFORE EXTRACTING — Audit These Files**:
```
FRONTEND:
- client/src/App.stable.tsx — identify ALL crypto-related state/functions
- client/src/hooks/useCrypto.ts — check current stubs
- client/src/lib/crypto.ts — check ALL crypto functions
- client/src/lib/db.ts — check trusted_keys, channel_keys tables

BACKEND:
- server/src/index.ts — check key rotation, key upload handlers
- server/src/db/index.ts — check key database functions
```

| Step | Action |
|---|---|
| C1 | Identify TOFU, key rotation, trust, ECDH, key derivation |
| C2 | Copy working implementations (replace Vault2E stubs) |
| C3 | Unify `sharedKeysCache` — single React state via context |
| C4 | Wire into `App.stable.tsx` |
| C5 | Run `tests/stable-crypto.test.ts` + `tests/stable-keys.test.ts` |
| C6 | Delete from `App.stable.tsx` |
| C7 | Full test suite passes |

**REGRESSION CHECK**: After extracting crypto, verify channels still work, DMs still work, badges still update

**Preserve from Vault2E**: `fetchUserPublicKey` fresh fetch, `decryptPayloadImpl` retry

### Phase D: Presence/Profile Domain → `usePresence.ts`
**Source**: `App.stable.tsx` presence + profile
**Target**: `src/hooks/usePresence.ts`

**BEFORE EXTRACTING — Audit These Files**:
```
FRONTEND:
- client/src/App.stable.tsx — identify ALL presence-related state/functions
- client/src/hooks/usePresence.ts — check current stubs
- client/src/lib/db.ts — check user database functions

BACKEND:
- server/src/index.ts — check presence socket handlers
- server/src/db/index.ts — check user database functions
```

| Step | Action |
|---|---|
| D1 | Identify typing, online/offline, profile update, socket events |
| D2 | Copy into `usePresence.ts` (fix duplicate handlers) |
| D3 | Fix `user:profile-update` event name (hyphen) |
| D4 | Wire into `App.stable.tsx` |
| D5 | Run `tests/stable-presence.test.ts` |
| D6 | Delete from `App.stable.tsx` |
| D7 | Full test suite passes |

**REGRESSION CHECK**: After extracting presence, verify channels still work, badges still update, checkmarks still display

### Phase E: Admin Domain → `useAdmin.ts` (new hook)
**Source**: `App.stable.tsx` admin logic
**Target**: `src/hooks/useAdmin.ts`

**BEFORE EXTRACTING — Audit These Files**:
```
FRONTEND:
- client/src/App.stable.tsx — identify ALL admin-related state/functions
- client/src/components/AdminDashboard.tsx — check admin UI

BACKEND:
- server/src/index.ts — check admin socket handlers
- server/src/db/index.ts — check admin database functions
```

| Step | Action |
|---|---|
| E1 | Extract role change, user delete, admin guard |
| E2 | Create new hook `useAdmin.ts` |
| E3 | Wire into `App.stable.tsx` |
| E4 | Run `tests/stable-admin.test.ts` |
| E5 | Delete from `App.stable.tsx` |
| E6 | Full test suite passes |

**REGRESSION CHECK**: After extracting admin, verify channels still work, badges still update, checkmarks still display

### Phase F: UI Components (Sidebar, ChatArea, Modals)
**Source**: `App.stable.tsx` inline components
**Target**: Existing Vault2E components (Sidebar.tsx, ChatArea.tsx, etc.)

**BEFORE EXTRACTING — Audit These Files**:
```
FRONTEND:
- client/src/App.stable.tsx — identify ALL UI-related state/functions
- client/src/components/Sidebar.tsx — check current implementation
- client/src/components/ChatArea.tsx — check current implementation
- client/src/components/ProfileModal.tsx — check current implementation
- client/src/components/ChannelSettingsModal.tsx — check current implementation
```

| Step | Action |
|---|---|
| F1 | Unread badges + dot (Dexie liveQuery) |
| F2 | Recent DMs + preview text |
| F3 | Sidebar reorder on send/receive (`upsertDMConversation`) |
| F4 | MessageSearch (Ctrl+K) |
| F5 | UserAvatarMenu (right-click) |
| F6 | ToastContainer |
| F7 | Upload progress |
| F8 | Ctrl+scroll zoom prevention |
| F9 | Delivery receipts UI (sent/delivered/read) |
| F10 | Pin dropdown in channel header, Starred section in sidebar |

**REGRESSION CHECK**: After extracting UI, verify channels still work, badges still update, checkmarks still display

---

## Final Phase: Delete Monolith, Verify

1. **Delete `App.stable.tsx`** — all logic now in hooks
2. **Rename `App.tsx` (current Vault2E) → `App.hooks.tsx`**
3. **Create new `App.tsx`** that only composes hooks + renders components
4. **Run full test suite** — all pass
5. **Manual smoke test** — every feature works

---

## Vault2E Improvements to Preserve (Only These 5)
1. `usersWithPresence` for ChannelSettingsModal
2. `isDeletedForMe` field on messages
3. Hook separation architecture (the result of this process)
4. `fetchUserPublicKey` with fresh server fetch
5. `decryptPayloadImpl` retry logic with cache invalidation

**Everything else** → extract from stable monolith.

---

## Verification Gates (After Each Phase)
```bash
npm run typecheck
npm run lint
npm test
```

**Manual test per phase** (matching stable behavior exactly):
- Phase A: All message CRUD + forward/star works
- Phase B: Channel create/join/key distribution/rotation works
- Phase C: TOFU, trust, rotation, re-decryption works
- Phase D: Typing, presence, profile updates work
- Phase E: Admin panel, role change, delete work
- Phase F: All UI features match stable

**REGRESSION CHECKLIST (verify after EACH phase)**:
- [ ] DMs still send/receive
- [ ] Sidebar still shows conversations
- [ ] Auth still works (login/logout)
- [ ] Existing checkmarks still display correctly
- [ ] Existing badges still display correctly

---

## Execution Command
```bash
/vault strangler-fig
```

**Runs sequentially** — each phase must pass all gates before next starts. No parallelization within a phase (depends on previous phase's deletions).

---

## Time Estimate
| Phase | Est. Time |
|---|---|
| 0-1 (Setup + Tests) | 2-4 hrs |
| A (Messages) | 2-3 hrs |
| B (Channels) | 2-3 hrs |
| C (Crypto/Keys) | 3-4 hrs |
| D (Presence) | 1-2 hrs |
| E (Admin) | 1 hr |
| F (UI) | 2-3 hrs |
| Final | 1 hr |
| **Total** | **~14-20 hrs** |

**Vs current path**: 36 tasks × unknown debugging = likely 40+ hrs with regressions.

---

## Notes for Agents
- **Never reimplement** — always copy from `App.stable.tsx` and adapt
- **Tests are the contract** — if stable test passes, extraction is correct
- **Delete from monolith immediately** after wiring — keeps `App.stable.tsx` shrinking
- **Preserve only the 5 Vault2E improvements** — document why each is kept
- **If stuck**: compare Vault2E hook vs stable implementation side-by-side
- **ONE MINOR LETTER CAN BREAK EVERYTHING** — read the entire file before changing it
- **REGRESSION CHECKS AFTER EVERY CHANGE** — if a fix breaks something else, REVERT
