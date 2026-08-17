# Changes.md — VaultChat Architectural Improvements
> **Generated**: Post-design-analysis integration
> **Strategy**: Hybrid E2EE model + surgical App.tsx modularization
> **Philosophy**: Discord features + WhatsApp E2EE where it matters

---
## 1. Strategic Design Philosophy — Hybrid E2EE Model

> **Goal**: Discord-competition features with WhatsApp-grade E2EE where it matters.
> **Reality**: Not every Discord feature can be E2EE-encrypted equally. The strategic compromise is a hybrid model.
>
> **Encryption Tiers**:
> - **Tier 1 — Full E2EE** (like WhatsApp):
>   - 1:1 Direct Messages ✅ Already built in codebase
>   - 1:1 Audio/Video Calls (P2P WebRTC Mesh) — zero server bandwidth
>   - Sensitive 1:1 conversations, always E2EE
>
> - **Tier 2 — SFrame + SFU** (like Discord with E2EE):
>   - Group Channels with end-to-end encrypted media
>   - Media frames encrypted on client BEFORE sending to Mediasoup SFU
>   - Server routes ciphertext only — cannot inspect/record
>   - Optional SVC (spatial layers) for bandwidth adaptation
>   - Roadmap: Tasks 2-4 from VaultChatPlan.txt
>
> - **Tier 3 — Server-Encrypted fallback** (AES-256-CBC):
>   - Group channels where performance > privacy
>   - Optional toggle per channel: "Secure Channel" (E2EE) vs "Standard" (server-encrypted)
>   - Reactions, edits, threaded convos, bots work in this mode
>   - Searchable, indexable, compatible with all Discord-like features
>
> - **Metadata** (always visible to server):
>   - Who messages whom, when, channel membership
>   - Online/offline status
>   - Reaction actions
>   - **Design principle**: UI must be built around this reality; never pretend metadata is private
>
> **Why This Matters for App.tsx Split**:
> - `useCrypto.ts` handles all three tiers — strategy selected per-channel
> - `useMessages.ts` filters by encryption type; UI shows appropriate badge
> - `useSocket.ts` switches between P2P, SFU, or server-encrypted emit paths
> - No need to rewrite components when adding new encryption modes
> - Future: post-quantum crypto swap without touching UI hooks

---
## 2. Task Priority Order (Integrated from TASKS_TO_DO.md)

### 🔴 CRITICAL — Security (Weeks 1-2)
1. **PBKDF2: 100K → 600K iterations** + vault migration utility
   - File: `client/lib/crypto.ts:451` (derivePasswordWrappingKey)
   - Risk: Brute-force faster than OWASP 2024
   - Work: Increase iterations, add re-wrap on login, handle legacy vaults
2. **CSP Headers + Security Middleware**
   - File: `server/src/index.ts`
   - Risk: XSS surface
   - Work: helmet middleware + CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
   - Add: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS
3. **JWT Migration from localStorage to httpOnly Cookies**
   - Files: `client/lib/socket.ts`, `server/src/index.ts`, `client/App.tsx` (will be reduced after split)
   - Risk: XSS = token theft
   - Work: Server sets JWT in `httpOnly; Secure; SameSite=Strict` cookie; Client `getJwtToken()` reads from cookie (cookie sent auto); Remove all `localStorage.setItem('vaultchat_jwt')`; Handle logout: clear cookie server-side; Test socket reconnection with cookie auth

### 🟠 HIGH — Architecture & Performance (Weeks 3-4)
4. **Split App.tsx into Composable Hooks** (THIS IS THE CORE TASK)
   - Creates: `useAuth.ts`, `useCrypto.ts`, `useSocket.ts`, `useChannels.ts`, `useMessages.ts`, `usePresence.ts`, `useUIState.ts`
   - Refactors: `App.tsx` down to ~200 lines composing hooks
   - Enables: all other tasks become modular and testable
   - **See Section 3 for surgical steps**
5. **Message Pagination on API + Client**
   - Server: `getChannelMessages(channelId, limit, offset)`, `getDirectMessages(userA, userB, limit, offset)`
   - Client: `/api/messages` with `?limit=&offset=&channelId=&peerId=`
   - Client: Update `fetchAllHistory` to paginate (load 50, then "load more")
   - UI: "Load earlier messages" button in ChatArea
6. **Message Virtualization with react-window**
   - Install: `react-window` + `react-window-infinite-loader`
   - Replace message map with `FixedSizeList` / `VariableSizeList`
   - Implement `loadMore` callback for infinite scroll up
   - Preserve scroll position on new messages
   - Test with 1000+ messages

### 🟡 MEDIUM — UX & Quality (Weeks 5-6)
7. **Testing Suite Setup**
   - Setup: Vitest (client) unified, or Jest + Vitest
   - Crypto tests: key gen, encrypt/decrypt round-trip, vault wrap/unwrap
   - DB tests: message CRUD, status transitions, channel key storage
   - Socket tests: message send/ack, channel create/join, key distribution
   - Add: CI workflow (GitHub Actions)
8. **Console Log Cleanup**
   - Replace with `debug` module or conditional `if (import.meta.env.DEV) console.log`
   - Keep only critical security audit logs
   - Remove verbose flow logs

### 🟢 LOW — Polish (Weeks 7-8)
9. **Structured Logging + Error Tracking**
   - Create: `server/src/lib/logger.ts` (Pino or Winston)
   - Replace: `console.log/error` with structured logs
   - Add: request logging middleware
   - Add: error tracking (Sentry-compatible format)
   - Log: security events (failed auth, key rotation, TOFU warnings)

---
## 3. Surgical Step-by-Step: Split App.tsx into Composable Hooks

> **Objective**: Break 2,853-line `App.tsx` into 7 specialized hooks + ~200-line composition component.
> **Pattern**: Each hook extracts related state + logic + returns minimal API for App.tsx.
> **Stabilization**: Use `useRef` pattern for callbacks that change frequently (same as existing App.tsx pattern at lines 2309-2322).

### 3.1 Create `useAuth.ts` — Auth State, JWT, Login/Logout

**Extract from App.tsx lines 76-102 + 976-1180 + 1182-1207**:

```typescript
// client/src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { getJwtToken, setJwtToken, removeJwtToken, isTokenExpired } from '../lib/crypto';
import { socket, connectSocket } from '../lib/socket';
import type { UserKeyPair, User } from '../types/chat';

export function useAuth() {
  // State
  const [currentUserKeys, setCurrentUserKeys] = useState<UserKeyPair | null>(null);
  const [privateKeyObject, setPrivateKeyObject] = useState<CryptoKey | null>(null);
  const [userFingerprint, setUserFingerprint] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isRehydrating, setIsRehydrating] = useState(true);
  const [theme, setTheme] = useState<string>(() => {
    const guestSaved = localStorage.getItem('vaultchat_theme_guest');
    if (guestSaved && guestSaved !== 'undefined') {
      document.documentElement.setAttribute('data-theme', guestSaved);
      return guestSaved;
    }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const initial = prefersDark ? 'vault-dark' : 'clean-light';
    document.documentElement.setAttribute('data-theme', initial);
    localStorage.setItem('vaultchat_theme_guest', initial);
    return initial;
  });
  const [isLogoutOpen, setIsLogoutOpen] = useState(false);

  // JWT helpers (moved from App.tsx)
  const getJwtToken = () => {
    const token = localStorage.getItem('vaultchat_jwt');
    if (token) return token;
    return sessionStorage.getItem('vaultchat_jwt');
  };

  const setJwtToken = (token: string) => {
    const stayLoggedIn = localStorage.getItem('vaultchat_stayLoggedIn') !== 'false';
    if (stayLoggedIn) {
      localStorage.setItem('vaultchat_jwt', token);
    } else {
      sessionStorage.setItem('vaultchat_jwt', token);
    }
  };

  const removeJwtToken = () => {
    localStorage.removeItem('vaultchat_jwt');
    sessionStorage.removeItem('vaultchat_jwt');
  };

  // Login/Logout
  const handleLogout = () => {
    setIsLogoutOpen(true);
  };

  const handleLogoutConfirm = useCallback(() => {
    removeJwtToken();
    setCurrentUserKeys(null);
    setPrivateKeyObject(null);
    setSelectedPeer(null);
    setSelectedChannel(null);
    setAllUsers([]);
    setOnlineIds(new Set());
    setShowAdmin(false);
    setAvatarMenu(null);
    if (socket.connected) socket.disconnect();
    historyFetchedRef.current = false;
    db.transaction('rw', [db.keys, db.messages, db.trustedKeys, db.channels, db.channelKeys], async () => {
      await db.keys.clear();
      await db.messages.clear();
      await db.trustedKeys.clear();
      await db.channels.clear();
      await db.channelKeys.clear();
    }).catch(() => {});
  }, []);

  // Session Rehydration
  useEffect(() => {
    const rehydrate = async () => {
      const token = getJwtToken();
      if (!token) { setIsRehydrating(false); return; }
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.user) {
          let keyPair = await getUserKeyPair(data.user.userId) || await getAnyUserKeyPair();
          if (keyPair) {
            const privKey = await importPrivateKeyFromJwk(keyPair.privateKeyJwk);
            const fp = await getFingerprint(keyPair.publicKeyBase64);
            const enrichedKeyPair: UserKeyPair = {
              ...keyPair,
              fullName: data.user.fullName || keyPair.fullName,
              email: data.user.email || keyPair.email,
              avatarUrl: data.user.avatarUrl || keyPair.avatarUrl,
              statusMessage: data.user.statusMessage || keyPair.statusMessage,
              phone: data.user.phone || keyPair.phone,
              keyVersion: data.user.keyVersion ?? keyPair.keyVersion ?? 1,
            };
            setPrivateKeyObject(privKey);
            setCurrentUserKeys(enrichedKeyPair);
            setUserFingerprint(fp);
            setShowProfileDrawer(false);
            if (!socket.connected) connectSocket();
            socket.emit('user:join', {
              userId: enrichedKeyPair.userId, username: enrichedKeyPair.username,
              fullName: enrichedKeyPair.fullName, role: enrichedKeyPair.role,
              publicKey: enrichedKeyPair.publicKeyBase64,
              signingPublicKey: enrichedKeyPair.signingPublicKeyBase64
            });
            await fetchUserDirectory(token);
            socket.emit('channels:get');
            console.log(`[Rehydration] Session restored for ${enrichedKeyPair.username}`);
          }
        } else {
          removeJwtToken();
        }
      } catch (e) {
        console.error('[Rehydration] Error:', e);
      } finally {
        setIsRehydrating(false);
      }
    };
    rehydrate();
  }, [fetchUserDirectory]);

  // Token expiry check
  useEffect(() => {
    if (!currentUserKeys) return;
    const check = () => {
      if (isTokenExpired()) {
        handleLogoutConfirm();
      }
    };
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [currentUserKeys]);

  return {
    // State
    currentUserKeys, setCurrentUserKeys,
    privateKeyObject, setPrivateKeyObject,
    userFingerprint, setUserFingerprint,
    authError, setAuthError,
    isRehydrating,
    theme, setTheme,
    isLogoutOpen, setIsLogoutOpen,
    // Actions
    handleLogout, handleLogoutConfirm,
    getJwtToken, setJwtToken, removeJwtToken,
  };
}
```

### 3.2 Create `useCrypto.ts` — Key Generation, Derivation, Encryption/Decryption

**Extract from App.tsx lines 1-71 + 282-300 + 303-372 + 375-534 + 537-545 + all crypto functions**:

This hook extracts ALL crypto operations so App.tsx doesn't import directly from `./lib/crypto`. Instead it imports from `useCrypto`.

**Key functions to extract** (based on App.tsx usage):
- `generateKeyPair`, `exportPublicKey`, `importPublicKey`
- `exportKeyToJwk`, `importPrivateKeyFromJwk`
- `deriveSharedKey`, `encryptMessage`, `decryptMessage`
- `getFingerprint`, `computePublicKeyFingerprint`
- `compareFingerprints`
- Channel key: `generateChannelSymmetricKey`, `getOrGenerateChannelKey`, `getOrDeriveSharedKey` (partial - uses refs)
- Message decryption: `decryptPayload`
- TOFU: `validatePeerKeyTofu`, `handleTrustNewKey`
- Key rotation: `handleRotateKey`
- Profile: `handleUpdateProfile`

**The hook returns a clean API**:
```typescript
export function useCrypto() {
  return {
    // Key generation
    generateKeyPair,
    exportPublicKey, importPublicKey,
    // JWK <-> CryptoKey
    exportKeyToJwk, importPrivateKeyFromJwk,
    // ECDH operations
    deriveSharedKey,
    // Crypto operations
    encryptMessage, decryptMessage,
    // Fingerprint utilities
    getFingerprint, computePublicKeyFingerprint,
    compareFingerprints,
    // Channel keys
    generateChannelSymmetricKey,
    // TOFU
    validatePeerKeyTofu,
    // Key rotation
    handleRotateKey,
    // Profile
    handleUpdateProfile,
  };
}
```

### 3.3 Create `useSocket.ts` — Socket Connection, Event Registration, Reconnection

**Extract from App.tsx lines 3 + 6 + all socket event handlers (lines 1271-1774) + rehydration + offline queue**:

This is the biggest extraction. The socket event handlers are the densest part of App.tsx (lines 1271-1774 = 500+ lines).

**Extract pattern**:
- Stabilize handlers with `useRef` (existing pattern at lines 2309-2322)
- Return cleanup function
- Expose only what App.tsx needs

**useSocket.ts structure**:
```typescript
export function useSocket(currentUserKeys, privateKeyObject, allUsers, channels, selectedPeer, selectedChannel) {
  // Refs to stabilize frequently-changing callbacks
  const currentUserKeysRef = useRef(currentUserKeys);
  currentUserKeysRef.current = currentUserKeys;
  const privateKeyObjectRef = useRef(privateKeyObject);
  privateKeyObjectRef.current = privateKeyObject;
  // ... more refs for decryptPayload, fetchUserDirectory, validatePeerKeyTofu,
  //     getOrDeriveSharedKey, getOrGenerateChannelKey

  // Connect/disconnect
  useEffect(() => {
    if (currentUserKeys) connectSocket();
    return () => { if (socket.connected) socket.disconnect(); };
  }, [currentUserKeys]);

  // Event handlers - extracted from App.tsx lines 1271-1774
  // Each handler uses refs for latest state

  // Return only what App.tsx needs
  return { socket, isOffline, pendingCount, networkStatus };
}
```

### 3.4 Create `useChannels.ts` — Channel State, Creation, Key Distribution

**Extract from App.tsx lines**:
- Channel state: `channels`, `selectedChannel`, `channelsRef`
- Effects: lines 1973-1982 (load stored channels + fetch from server)
- Creation: `handleCreateChannel` (lines 2105-2191)
- Member management: `handleChannelMemberAdded/Removed` (lines 1538-1587)
- Key rotation: `onChannelKeyRotated` (lines 1589-1635)
- Ownership transfer: `onChannelOwnershipTransferred` (lines 1637-1641)
- Key request: `onChannelKeyRequest` (lines 1643-1668)
- Key distribution: `getOrGenerateChannelKey`, `getOrDeriveSharedKey` (used within)
- Channel settings: `channelSettings`, `setChannelSettings`
- Update channel: `handleUpdateChannel` (lines 2193-2255)
- Delete channel: `handleDeleteChannel` (lines 2257-2276)
- Leave channel: `handleLeaveChannel` (lines 2278-2285)

**Hook returns**:
- State: `channels`, `selectedChannel`, `channelSettings`
- Actions: `handleCreateChannel`, `handleUpdateChannel`, `handleDeleteChannel`, `handleLeaveChannel`
- Refreshed: `refreshChannels` (re-fetch from server)

### 3.5 Create `useMessages.ts` — Send/Receive, Status, Drafts, Search

**Extract from App.tsx**:
- Message sending: `handleSendMessage` (lines 2354-2443), `handleForwardMessage` (lines 2446-2503), `handleSendFiles` (lines 2506-2603)
- Editing/deleting: `handleEditMessage` (lines 2606-2624), `handleDeleteForMe` (lines 2626-2628), `handleDeleteForEveryone` (lines 2630-2641)
- Pinning: `handlePinMessage`/`handleUnpinMessage` (lines 2288-2291)
- Status updates: `onMessageAck`/`onMessageDeliveredAck`/`onMessageReadAck` (lines 1373-1402)
- Offline queue: `flushOfflineQueue` (lines 1874-1895), `processOfflineQueue`
- Message status: `updateMessageStatus`, `markMessageDeletedLocally`, `editMessageLocally`
- Search: `MessageSearch` component integration, `onOpenSearch`, `setShowSearch`
- Unread counts: `computeUnreadRef`, `computeUnread`, `lastViewedDms`, `lastViewedChannels`, `unreadDMs`, `unreadChannels`, `latestDMMessages`

**Hook returns clean API** for App.tsx composition.

### 3.6 Create `usePresence.ts` — Online/Away/Offline, Typing Indicators

**Extract from App.tsx**:
- User directory/presence: `allUsers`, `onlineIds`, `awayIds`, `setAllUsers`, `setOnlineIds`, `setAwayIds`
- Socket events: `onUsersDirectory`, `onUsersPresence`, `onUserOnline`, `onUserStatusChange`, `onUserRegistered` (lines 1271-1463)
- Typing: `typingUsers`, `setTypingUsers`, `handleTypingStart`/`handleTypingStop`/`handleTyping` (lines 2327-2351)
- Last viewed: `lastViewedDms`, `lastViewedChannels`, `setLastViewedDms`, `setLastViewedChannels`
- Unread counts: `unreadDMs`, `unreadChannels`, `computeUnreadRef`, `computeUnread`
- Latest DMs: `recentDMs`, `setRecentDMs`, `upsertDMConversation`
- Presence refs: `allUsersRef`, `selectedPeerRef`, `selectedChannelRef`

**Hook returns**:
- State: `allUsers`, `onlineIds`, `awayIds`, `typingUsers`
- Actions: `refreshDirectory`, `setTyping`, `clearTyping`
- Refs: `allUsersRef`, `selectedPeerRef`, `selectedChannelRef`

### 3.7 Create `useUIState.ts` — Modals, Sidebar, Active View, Drafts

**Extract from App.tsx**:
- Theme: `theme`, `setTheme`, `showTheme` UI
- Active view: `activeView`, `setActiveView`, `mobileSidebarOpen`, `setMobileSidebarOpen`
- Modals: `showAdmin`, `setShowAdmin`, `adminTab`, `setAdminTab`
- Profile drawer: `showProfileDrawer`, `setShowProfileDrawer`
- Avatar menu: `avatarMenu`, `setAvatarMenu`, `UserAvatarMenu` integration
- Channel settings: `channelSettings`, `setChannelSettings`
- Search: `showSearch`, `setShowSearch`
- Fingerprint modal: `showFingerprintModal`, `setShowFingerprintModal`
- Logout confirmation: `isLogoutOpen`, `setIsLogoutOpen`
- Confirm modal: `ConfirmModal` integration
- Toast: `showToast`, `ToastContainer` (imported from `./lib/toast`)
- Admin dashboard: `showAdmin`, `fetchAdminUsers`, `handleAdminSetRole`, `handleAdminDeleteUser`
- Lazy-loaded: `AdminDashboard`, `MessageSearch`

**Hook returns compact UI state object** for App.tsx.

### 3.8 Refactor App.tsx to Compose Hooks (~200 lines)

**New App.tsx structure** (example - ~200 lines, down from 2,853):

```typescript
// client/src/App.tsx - REFACTORED
import React, { useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useCrypto } from './hooks/useCrypto';
import { useSocket } from './hooks/useSocket';
import { useChannels } from './hooks/useChannels';
import { useMessages } from './hooks/useMessages';
import { usePresence } from './hooks/usePresence';
import { useUIState } from './hooks/useUIState';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { AuthModal } from './components/AuthModal';
import { OfflineBanner } from './components/OfflineBanner';
import { ProfileDrawer } from './components/ProfileDrawer';
import { UserAvatarMenu } from './components/UserAvatarMenu';
import { ChannelSettingsModal } from './components/channels/ChannelSettingsModal';
import { ConfirmModal } from './components/ConfirmModal';
import { MessageSearch } from './components/MessageSearch';
import { ToastContainer } from './lib/toast';
import type { User, Channel } from './types/chat';

export const App: React.FC = () => {
  // Compose all hooks - each returns only what App.tsx needs
  const { currentUserKeys, authError, theme, isRehydrating, ...authActions } = useAuth();
  const { ...cryptoAPI } = useCrypto();
  const { socket, isOffline, pendingCount, networkStatus } = useSocket(
    currentUserKeys, 
    cryptoAPI.privateKeyObject, // or whatever privateKeyObject resolution is
    /* other deps */
  );
  const { channels, selectedChannel, channelSettings, ...channelActions } = useChannels();
  const { handleSendMessage, handleSendFiles, handleEditMessage, handleDeleteForMe, handleDeleteForEveryone, ...messageAPI } = useMessages();
  const { allUsers, onlineIds, awayIds, typingUsers, ...presenceAPI } = usePresence();
  const { theme: uiTheme, showAdmin, setShowAdmin, adminTab, setAdminTab, mobileSidebarOpen, setMobileSidebarOpen, showProfileDrawer, setShowProfileDrawer, showSearch, setShowSearch, showFingerprintModal, setShowFingerprintModal, isLogoutOpen, setIsLogoutOpen, confirmModalOpen, setConfirmModalOpen, ...uiAPI } = useUIState();

  // Minimal event handlers that compose hook APIs
  const handleAuthenticate = async (params) => { /* ... or delegate to authActions ... */ };
  const handleLogout = () => { authActions.handleLogoutConfirm(); };
  const handleSendMessage = async (text, replyTo) => { messageAPI.handleSendMessage(text, replyTo); };
  // ... etc, minimal ~200 lines

  // Theme application (from useUIState)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme);
  }, [uiTheme]);

  // Render - much cleaner
  return (
    <div className="h-screen w-screen flex font-sans select-none">
      {currentUserKeys ? (
        <>
          <Sidebar
            users={presenceAPI.allUsers || []}
            channels={channels}
            currentUser={currentUserKeys}
            /* ... pass only needed props from composed hooks */
          />
          <ChatArea
            selectedUser={/* from presence */}
            selectedChannel={selectedChannel}
            currentUserId={currentUserKeys?.userId || ''}
            currentUserKeys={currentUserKeys}
            allUsers={presenceAPI.allUsers || []}
            /* ... pass only needed props */
          />
        </>
      ) : (
        <AuthModal onAuthenticate={handleAuthenticate} error={authError} />
      )}
      {showProfileDrawer && <ProfileDrawer ... />}
      <ConfirmModal isOpen={isLogoutOpen} ... />
      {avatarMenu && <UserAvatarMenu ... />}
      {channelSettings && <ChannelSettingsModal ... />}
      <React.Suspense fallback={null}>
        <MessageSearch ... />
      </React.Suspense>
      <ToastContainer />
    </div>
  );
};
```

**Key benefits of this refactor**:
1. App.tsx down from 2,853 → ~200 lines (93% reduction!)
2. Each hook can be unit-tested independently
3. Crypto logic isolated - security audits focused
4. Socket events modular - can switch P2P/SFU/Server-encrypted per-channel
5. New developers can learn one hook at a time
6. Parallel development: 7 developers can work on 7 hooks simultaneously
7. Future: swap encryption strategy without touching UI

---
## 4. Parallel Task Integration

### 4.1 PBKDF2 Vault Migration ( integrated as Task 1 )
- **Before split**: Modify `client/lib/crypto.ts:451` directly
- **After split**: `useCrypto.ts` wraps `derivePasswordWrappingKey` — migration is hook-internal
- **Surgical edit**: Increase iterations from 100000 → 600000, add migration utility that detects iteration count and re-encrypts on login

### 4.2 CSP Headers ( integrated as Task 2 )
- **File**: `server/src/index.ts`
- **Action**: Add helmet middleware configuration after existing imports
- **Note**: Already has `import helmet from 'helmet'` at line 8 — just need to configure it

### 4.3 JWT Migration ( integrated as Task 3 )
- **Before split**: Modify `client/lib/socket.ts`, `server/src/index.ts`, `client/App.tsx` directly
- **After split**: `useAuth.ts` handles all JWT logic — `getJwtToken()` reads from cookie automatically; `App.tsx` no longer has `localStorage.setItem('vaultchat_jwt')` calls
- **Surgical edit**: Remove all `localStorage.getItem('vaultchat_jwt')` and `sessionStorage.getItem('vaultchat_jwt')` from App.tsx (they're now in useAuth.ts); Server sets cookie on login; Client `getJwtToken()` from useAuth reads from cookie

### 4.4 Message Pagination ( integrated as Task 4 )
- **Server**: Add `limit`, `offset` params to `getChannelMessages` and `getDirectMessages` in `server/src/db/index.ts`
- **Client**: Update `useMessages.ts` `fetchAllHistory` to paginate — first load 50, then "load more" button
- **UI**: Add "Load earlier messages" button in ChatArea (separate component, not affected by App.tsx split)

### 4.5 Message Virtualization ( integrated as Task 6 )
- **Install**: `react-window` + `react-window-infinite-loader`
- **In**: `ChatArea.tsx` — replace message map with `FixedSizeList` / `VariableSizeList`
- **Independence**: ChatArea is already a separate component — App.tsx split doesn't affect this; it just needs `useMessages.ts` to provide paginated message data

### 4.6 Tests Suite ( integrated as Task 7 )
- **Setup**: Vitest configuration in `client/src/test/`
- **Crypto tests**: Test key gen, encrypt/decrypt round-trip, vault wrap/unwrap from `useCrypto.ts`
- **DB tests**: Message CRUD, status transitions from `useMessages.ts`
- **Socket tests**: Message send/ack from `useSocket.ts`
- **CI**: GitHub Actions workflow

### 4.7 Console Log Cleanup ( integrated as Task 8 )
- **Replace**: `console.log` with debug module or `if (import.meta.env.DEV) console.log`
- **In**: All 7 hooks + App.tsx — but now focused per-hook, easier to audit
- **Keep**: Only critical security audit logs (TOFU warnings, key rotation)

### 4.8 Structured Logging ( integrated as Task 9 )
- **Create**: `server/src/lib/logger.ts` (Pino or Winston)
- **In**: `server/src/index.ts` — replace console with structured logs
- **Middleware**: Request logging, error tracking (Sentry-compatible)
- **Security events**: Failed auth, key rotation, TOFU warnings

---
## 5. Verification & Next Steps

### Verification Gates (from ECC orchestration plan)
```
/ecc security-scan --target "client,server"
/ecc verify --coverage "80+"
/ecc plan vaultchat-security-hardening
```
After each phase:
```
/ecc verify --milestone "week1-complete"
/ecc verify --milestone "week2-complete"
/ecc verify --milestone "week3-complete"
```

### Final Validation
```
/ecc verify --coverage "100%" --security --e2e --performance
/ecc e2e-runner --target "chat-app,security-flows,auth-migration"
/ecc security-scan --comprehensive
```

### Implementation Roadmap
1. **Week 1**: PBKDF2 migration + CSP headers + JWT cookie migration
   - Update `client/lib/crypto.ts` iterations
   - Add helmet CSP middleware to `server/src/index.ts`
   - Create `useAuth.ts`, remove JWT logic from App.tsx, migrate to cookie-based auth
   
2. **Week 2**: **Split App.tsx into hooks** (CORE TASK)
   - Create 7 hooks: useAuth, useCrypto, useSocket, useChannels, useMessages, usePresence, useUIState
   - Refactor App.tsx to compose hooks (~200 lines)
   - Verify all functionality works post-refactor
   
3. **Week 3**: Message pagination + virtualization + tests setup
   - Pagination API + client
   - react-window implementation in ChatArea
   - Vitest setup + initial test suites
   
4. **Week 4**: Polish + structured logging + console cleanup
   - Replace console.log with conditional logging
   - Add server-side structured logger
   - Final verification and coverage check

---
**This file is the master plan**. Execute tasks in order; update TASKS_TO_DO.md status after each. Do not push until instructed. Verify compiles (`npx tsc --noEmit`) before committing.