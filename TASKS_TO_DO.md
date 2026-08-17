# TASKS TO DO — VaultChat Security & Architecture Fixes
> **Source**: Full Project Scan (2026-08-15)  
> **Rule**: Update this file + commit after each task. Do NOT push until instructed.

---

## 🔴 CRITICAL — Security

### 1. PBKDF2: 100K → 600K iterations + vault migration
- **File**: `client/lib/crypto.ts:451`
- **Risk**: Brute-force faster than OWASP 2024 recommendation
- **Work**: 
  - [ ] Increase `iterations: 100000` → `600000` in `derivePasswordWrappingKey`
  - [ ] Add vault migration utility (re-wrap existing vaults on login)
  - [ ] Handle legacy vaults gracefully (detect iteration count, re-encrypt)
  - [ ] Test with existing user accounts
- **Status**: ⏳ PENDING

### 2. Add CSP headers + security middleware
- **File**: `server/src/index.ts`
- **Risk**: XSS surface if any injection exists
- **Work**:
  - [ ] Add `helmet` or manual CSP middleware
  - [ ] CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  - [ ] Add `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
  - [ ] Add HSTS header
- **Status**: ⏳ PENDING

### 3. Move JWT from localStorage to httpOnly cookies
- **Files**: `client/lib/socket.ts`, `server/src/index.ts`, `client/App.tsx`
- **Risk**: XSS = token theft
- **Work**:
  - [ ] Server: Set JWT in `httpOnly; Secure; SameSite=Strict` cookie on login
  - [ ] Server: Read JWT from cookie in socket auth middleware
  - [ ] Client: Remove `localStorage.setItem('vaultchat_jwt')` calls
  - [ ] Client: Update `getJwtToken()` to read from cookie (or omit - cookie sent automatically)
  - [ ] Handle logout: clear cookie server-side
  - [ ] Test socket reconnection with cookie auth
- **Status**: ⏳ PENDING

---

## 🟠 HIGH — Architecture & Performance

### 4. Add pagination to message APIs
- **Files**: `server/src/db/index.ts`, `server/src/index.ts`, `client/src/App.tsx`
- **Risk**: O(n) memory on large histories
- **Work**:
  - [ ] `getChannelMessages(channelId, limit, offset)` → add `limit`, `offset` params
  - [ ] `getDirectMessages(userA, userB, limit, offset)` → add pagination
  - [ ] `/api/messages` → add `?limit=&offset=&channelId=&peerId=`
  - [ ] Client: Update `fetchAllHistory` to paginate (load 50, then "load more")
  - [ ] Add "Load earlier messages" button in ChatArea
- **Status**: ⏳ PENDING

### 5. Split App.tsx into composable hooks
- **File**: `client/src/App.tsx` (2,495 lines)
- **Risk**: Unmaintainable, untestable, tight coupling
- **Work**:
  - [ ] Create `hooks/useAuth.ts` — auth state, login/logout, JWT handling
  - [ ] Create `hooks/useCrypto.ts` — key generation, derivation, encryption
  - [ ] Create `hooks/useSocket.ts` — socket connection, event registration, reconnection
  - [ ] Create `hooks/useChannels.ts` — channel state, creation, key distribution
  - [ ] Create `hooks/useMessages.ts` — send/receive, status, drafts, search
  - [ ] Create `hooks/usePresence.ts` — online/away/offline, typing indicators
  - [ ] Create `hooks/useUIState.ts` — modals, sidebar, active view, drafts
  - [ ] Create `hooks/useOfflineQueue.ts` — queue processing, flush logic
  - [ ] Refactor App.tsx to compose hooks (~200 lines)
  - [ ] Verify all functionality works post-refactor
- **Status**: ⏳ PENDING

---

## 🟡 MEDIUM — UX & Quality

### 6. Virtualize message list (react-window)
- **File**: `client/src/components/ChatArea.tsx`
- **Risk**: Lag on 500+ messages
- **Work**:
  - [ ] Install `react-window` + `react-window-infinite-loader`
  - [ ] Replace message map with `FixedSizeList` / `VariableSizeList`
  - [ ] Implement `loadMore` callback for infinite scroll up
  - [ ] Preserve scroll position on new messages
  - [ ] Test with 1000+ messages
- **Status**: ⏳ PENDING

### 7. Add basic tests for crypto, DB, socket handlers
- **Files**: `client/src/test/`, `server/src/test/` (new)
- **Risk**: No regression safety
- **Work**:
  - [ ] Set up Vitest (client) + Jest (server) or unified Vitest
  - [ ] Crypto tests: key gen, encrypt/decrypt round-trip, vault wrap/unwrap
  - [ ] DB tests: message CRUD, status transitions, channel key storage
  - [ ] Socket tests: message send/ack, channel create/join, key distribution
  - [ ] Add CI workflow (GitHub Actions)
- **Status**: ⏳ PENDING

---

## 🟢 LOW — Polish

### 8. Clean up ~40 console.log statements
- **Files**: Multiple (App.tsx, crypto.ts, index.ts, etc.)
- **Risk**: Info leakage in browser console
- **Work**:
  - [ ] Replace with `debug` module or conditional `if (import.meta.env.DEV) console.log`
  - [ ] Keep only critical security audit logs
  - [ ] Remove verbose flow logs
- **Status**: ⏳ PENDING

### 9. Add structured logging + error tracking
- **File**: `server/src/index.ts` (new logger module)
- **Risk**: No observability in production
- **Work**:
  - [ ] Create `server/src/lib/logger.ts` (Pino or Winston)
  - [ ] Replace `console.log/error` with structured logs
  - [ ] Add request logging middleware
  - [ ] Add error tracking (Sentry-compatible format)
  - [ ] Log security events (failed auth, key rotation, etc.)
- **Status**: ⏳ PENDING

---

## ✅ COMPLETED (This Session)
- [x] Channel key request fallback protocol (`channel:key:request`)
- [x] Creator auto-regenerates channel key when lost
- [x] Persist activeView (DMs/Channels tab) to localStorage
- [x] Attachment button focus returns to textarea after file pick
- [x] Multiple file attachments (input `multiple` + array state)
- [x] Official channel key upload fix (store all envelopes for public/official)
- [x] Server ACK error handling (failed status + error messages)
- [x] Toast notification system (replaced 18 `alert()` calls)
- [x] Channel settings modal unsaved-changes bug fix

## 🏗️ DESIGN PHILOSOPHY — Added After Analysis
> **Project Goal**: Discord-competition features with WhatsApp-grade E2EE where it matters
> 
> **Strategic Compromise** (the "Hybrid E2EE Model"):
> - **1:1 DMs**: Full end-to-end E2EE (Opus+AES-256-GCM via ECDH) — like WhatsApp ✅
> - **Group Channels**: SFrame encryption + Mediasoup SFU routing — media encrypted before hitting server, server routes ciphertext only ✅ In roadmap Phase 2-3
> - **1:1 Calls**: Direct P2P WebRTC Mesh — zero server bandwidth, like WhatsApp ✅ In roadmap Phase 1
> - **Group Calls**: SFU with SFrame — server relays but cannot decrypt ✅ In roadmap Phase 3-4
> - **Metadata** (who messages whom, when, channel membership): Visible to server — accept reality, design UI around it
> - **Fallback Mode**: Server-encrypted (AES-256-CBC) for performance-critical features (screen sharing, large groups) — optional toggle per channel
> - **Key Management**: Per-channel symmetric keys (generated by creator), distributed via ECDH to members — supports both E2EE and server-encrypted modes
> 
> **Why This Matters for App.tsx Split**: Modular hooks let us swap encryption strategies independently per-channel without breaking UI. `useCrypto.ts` handles both E2EE and server-encrypted modes. `useMessages.ts` filters by encryption type. No need to rewrite entire app.

---

## 📋 RULES
1. **One task at a time** — mark `⏳ IN_PROGRESS` when starting
2. **Update this file** after each task (change status, add notes)
3. **Commit** after each task with descriptive message
4. **DO NOT PUSH** until explicitly instructed
5. **Verify compiles** (`npx tsc --noEmit`) before committing