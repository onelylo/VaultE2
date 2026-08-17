# Vault2E (PetroShield / VaultChat) - Full Project Inventory

> Generated: 2026-08-17 | Security Architecture Audit
> Source: Direct inspection of all source files

---

## 1. FRONTEND (client/src/)

### Framework
- React 18 with Vite (TypeScript)
- Tailwind CSS for styling
- Dexie.js for IndexedDB (local encrypted storage)
- Socket.io-client for real-time communication
- Vitest + jsdom for testing
- Lucide React for icons

### Hooks (client/src/hooks/)

| File | Purpose |
|------|---------|
| useAuth.ts | Session rehydration, JWT management, login/logout, key pair loading from Dexie |
| useCrypto.ts | Re-exports all crypto functions; implements handleRotateKey (key rotation flow) |
| useMessages.ts | Send/receive/edit/delete DM and channel messages; offline queue; attachment encrypt+upload; TOFU validation on send; starred/pinned messages; history pagination |
| useSocket.ts | Socket connection lifecycle; network status tracking via useNetworkStatus |
| useChannels.ts | Channel CRUD; AES key generation + ECDH-encrypted distribution to members; key request/response; key rotation on member removal |
| useFriends.ts | Friend list, add/accept/reject/remove via REST API |
| usePresence.ts | Online/away/typing state; user directory updates; key rotation MITM warnings |
| useAdmin.ts | Admin user management (role, delete) via REST; listens for user:removed, user:role_change, user:suspended |
| useUIState.ts | Theme, active view, modals, search, avatar menu state |

### Library Files (client/src/lib/)

| File | Purpose |
|------|---------|
| crypto.ts | Core E2EE engine - all cryptographic operations (detailed in Section 4) |
| db.ts | Dexie database schema (8 versions); CRUD for keys, messages, trusted keys, channels, channel keys, muted/blocked/hidden conversations, drafts, forwarded messages |
| socket.ts | Socket.io client singleton; JWT auth on connect; WebSocket-only transport |
| attachments.ts | Encrypted attachment upload/download pipeline; thumbnail generation; XHR progress tracking |
| queue.ts | Offline sync engine: useNetworkStatus hook + processOfflineQueue for pending_sync messages |
| notify.ts | Browser notification sound (Web Audio API oscillator) |
| toast.tsx | React toast notification system (portal-based) |
| emoji.tsx | Flag emoji rendering, country code mapping |

### Components (client/src/components/)

| File | Purpose |
|------|---------|
| AuthModal.tsx | Login/Register form |
| ChatArea.tsx | Main chat view (message list + input) |
| Sidebar.tsx | Channel/DM sidebar navigation |
| ProfileDrawer.tsx | User profile sidebar |
| ProfileModal.tsx | User profile modal |
| UserAvatarMenu.tsx | Context menu on avatar click |
| AdminDashboard.tsx | Admin panel (overview, users, infrastructure) |
| AttachmentMessage.tsx | Attachment display + download |
| AudioPlayer.tsx | Audio attachment player |
| MessageSearch.tsx | Message search UI |
| ReactionPicker.tsx | Emoji reaction picker |
| EmojiPicker.tsx | Full emoji picker |
| ConfirmDialog.tsx | Confirmation dialog |
| ErrorBoundary.tsx | React error boundary |
| OfflineBanner.tsx | Offline status banner |
| chat/MessageItem.tsx | Individual message bubble |
| chat/MarkdownRenderer.tsx | Markdown rendering in messages |
| chat/LinkPreview.tsx | URL preview cards |
| modals/AddFriendModal.tsx | Add friend dialog |
| modals/ConfirmModal.tsx | Generic confirm modal |
| modals/ForwardModal.tsx | Message forward modal |
| modals/ImageLightboxModal.tsx | Image lightbox viewer |
| channels/CreateChannelModal.tsx | Channel creation dialog |
| channels/ChannelSettingsModal.tsx | Channel settings editor |
| admin/AdminUserTable.tsx | Admin user list table |
| admin/EditUserModal.tsx | Admin user edit dialog |

### Other Frontend Files

| File | Purpose |
|------|---------|
| App.tsx | Root component; orchestrates all hooks |
| main.tsx | React entry point |
| index.css | Global styles |
| types/chat.ts | TypeScript type definitions |
| test/setup.ts | Vitest test setup |

---

## 2. BACKEND (server/src/)

### Architecture
- Express.js HTTP server
- Embedded PostgreSQL 18 (embedded-postgres package) - file-backed, persistent
- Socket.io WebSocket server
- Pino logger (with pino-pretty in dev)
- Helmet for security headers (CSP, HSTS, etc.)
- express-rate-limit for auth endpoints
- multer for file uploads (memory storage)
- bcrypt for password hashing (12 rounds)
- Custom HMAC-SHA256 JWT implementation (not jsonwebtoken library)

### Server Source Files

| File | Purpose |
|------|---------|
| server/src/index.ts | Monolithic server (2743 lines): Express routes, Socket.io events, JWT helpers, RBAC, all business logic |
| server/src/db/index.ts | PostgreSQL persistence layer (1139 lines): embedded-postgres init, all SQL queries, type mappings |
| server/src/db/schema.sql | Database schema (227 lines): all CREATE TABLE + ALTER TABLE statements |
| server/src/logger.ts | Pino logger configuration |
| server/scripts/reset.ts | Reset instructions (prints text only) |

---

## 3. DATABASE SCHEMA (PostgreSQL)

### Tables

#### users
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Format: usr_{username} |
| username | TEXT UNIQUE | Display username |
| display_name | TEXT | |
| email | TEXT | |
| role | TEXT | ADMIN, SUPERVISOR, MEMBER |
| password_hash | TEXT | bcrypt (or legacy SHA-256) |
| public_key | TEXT | ECDH P-256 SPKI Base64 |
| encrypted_private_key | TEXT | PBKDF2+AES-GCM encrypted vault |
| key_salt | TEXT | PBKDF2 salt (Base64) |
| key_version | INTEGER | Incremented on rotation |
| key_rotation_signature | TEXT | ECDSA signature of rotation |
| old_public_key | TEXT | Previous ECDH public key |
| signing_public_key | TEXT | ECDSA P-256 SPKI Base64 |
| old_signing_public_key | TEXT | Previous ECDSA signing key |
| avatar_url | TEXT | |
| status | TEXT | ACTIVE or SUSPENDED |
| status_message | TEXT | |
| phone | TEXT | |
| banner_url | TEXT | |
| bio | TEXT | |
| deleted_at | TIMESTAMPTZ | Soft-delete timestamp |
| created_at | BIGINT | Unix epoch ms |

#### channels
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Slug format |
| name | TEXT UNIQUE | |
| description | TEXT | |
| type | TEXT | official, team, private |
| created_by | TEXT | FK to users |
| created_at | BIGINT | |
| is_announcement | BOOLEAN | |
| allowed_roles | TEXT[] | Role-based access |
| slow_mode_seconds | INTEGER | Rate limit per user |

#### channel_keys
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| channel_id | TEXT | |
| user_id | TEXT | |
| encrypted_channel_key | TEXT | ECDH-encrypted AES key |
| iv | TEXT | IV for the encrypted key |
| UNIQUE | (channel_id, user_id) | |

#### messages
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | srv_{timestamp} or temp_* |
| temp_id | TEXT | Client-generated temp ID |
| sender_id | TEXT | |
| recipient_id | TEXT | NULL for channel messages |
| channel_id | TEXT | NULL for DMs |
| ciphertext | TEXT | AES-256-GCM ciphertext (Base64) |
| iv | TEXT | 12-byte IV (Base64) |
| status | TEXT | sent, delivered, read |
| is_edited | BOOLEAN | |
| is_deleted | BOOLEAN | |
| reply_to | TEXT | |
| created_at | BIGINT | |

#### attachments
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | att_{timestamp}_{hex} |
| message_id | TEXT | NULL until linked |
| file_path | TEXT | Filename on disk |
| encrypted_metadata | TEXT | AES-GCM encrypted JSON |
| iv | TEXT | Binary payload IV |
| metadata_iv | TEXT | Metadata IV |
| created_at | BIGINT | |

#### channel_members
| Column | Type | Notes |
|--------|------|-------|
| channel_id | TEXT | PK part 1 |
| user_id | TEXT | PK part 2 |
| assigned_by | TEXT | |
| created_at | BIGINT | |

#### message_reactions
| Column | Type | Notes |
|--------|------|-------|
| message_id | TEXT | PK part 1 |
| user_id | TEXT | PK part 2 |
| emoji | TEXT | PK part 3 |
| created_at | BIGINT | |

#### pinned_messages
| Column | Type | Notes |
|--------|------|-------|
| channel_id | TEXT | PK part 1 |
| message_id | TEXT | PK part 2 |
| pinned_by | TEXT | |
| pinned_at | BIGINT | |

#### starred_messages
| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT | PK part 1 |
| message_id | TEXT | PK part 2 |
| starred_at | BIGINT | |

#### blocked_users
| Column | Type | Notes |
|--------|------|-------|
| blocker_id | TEXT | PK part 1 |
| blocked_id | TEXT | PK part 2 |
| created_at | BIGINT | |

#### audit_log
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| actor_id | TEXT | |
| action | TEXT | role_change, user_deleted, etc. |
| target_type | TEXT | |
| target_id | TEXT | |
| details | TEXT | |
| created_at | BIGINT | |

#### token_blocklist
| Column | Type | Notes |
|--------|------|-------|
| token_hash | TEXT PK | SHA-256 hash of JWT |
| user_id | TEXT | |
| expires_at | BIGINT | |

#### friends
| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT | PK part 1, FK to users |
| friend_id | TEXT | PK part 2, FK to users |
| status | TEXT | pending, accepted, blocked |
| created_at | BIGINT | |

#### hubs
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| name | TEXT | |
| description | TEXT | |
| icon_url | TEXT | |
| banner_url | TEXT | |
| created_by | TEXT | FK to users |
| created_at | BIGINT | |

#### hub_members
| Column | Type | Notes |
|--------|------|-------|
| hub_id | TEXT | PK part 1, FK to hubs |
| user_id | TEXT | PK part 2, FK to users |
| role | TEXT | owner, admin, member |
| joined_at | BIGINT | |

#### groups
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| hub_id | TEXT | FK to hubs |
| name | TEXT | |
| description | TEXT | |
| type | TEXT | text, voice, announcement |
| position | INTEGER | |
| created_at | BIGINT | |

#### group_visibility
| Column | Type | Notes |
|--------|------|-------|
| group_id | TEXT | PK part 1, FK to groups |
| user_id | TEXT | PK part 2, FK to users |

---

## 4. CRYPTO LIBRARY (client/src/lib/crypto.ts)

### ALL Exported Functions (24 total)

| Function | Purpose |
|----------|---------|
| arrayBufferToBase64 | Binary to Base64 |
| base64ToArrayBuffer | Base64 to binary |
| compareFingerprints | Case-insensitive hex fingerprint comparison |
| generateKeyPair | ECDH P-256 key pair generation |
| exportPublicKey | Export public key to SPKI Base64 |
| importPublicKey | Import SPKI Base64 to CryptoKey |
| exportKeyToJwk | Export any key to JWK |
| generateSigningKeyPair | ECDSA P-256 key pair generation |
| signKeyRotation | Sign key rotation statement |
| verifyKeyRotationSignature | Verify rotation signature |
| encryptKeyVaultPair | Encrypt both key JWKs for vault |
| unwrapKeyVault | Parse vault JSON (legacy compatible) |
| importPrivateKeyFromJwk | Import ECDH private key from JWK |
| deriveSharedKey | ECDH -> AES-256-GCM shared key |
| encryptMessage | AES-256-GCM encrypt string |
| decryptMessage | AES-256-GCM decrypt string |
| encryptBinaryData | AES-256-GCM encrypt binary |
| decryptBinaryData | AES-256-GCM decrypt binary |
| getFingerprint | 30-char hex fingerprint from SHA-256 |
| computePublicKeyFingerprint | Full SHA-256 hex of public key |
| generateChannelSymmetricKey | Generate AES-256-GCM key |
| importSymmetricKeyFromJwk | Import AES key from JWK |
| encryptChannelKeyForUser | Encrypt channel key with ECDH shared key |
| decryptChannelKeyForUser | Decrypt channel key envelope |
| getOrDeriveSharedKey | Cached ECDH derivation |
| clearSharedKeyCache | Invalidate shared key cache |
| getOrGenerateChannelKey | Channel key resolution (cache -> Dexie -> server -> ECDH) |
| resolveMessageKey | Resolve key for DM or channel message |
| validatePeerKeyTofu | Trust-On-First-Use + signed rotation verification |
| derivePasswordWrappingKey | PBKDF2 -> AES-256-GCM key |
| encryptPrivateKeyVault | Encrypt single private key for server vault |
| decryptPrivateKeyVault | Decrypt vault (tries 100k then 600k PBKDF2 iterations) |

### Crypto Primitives Used

| Primitive | Usage |
|-----------|-------|
| ECDH P-256 | Key agreement for DM shared keys |
| ECDSA P-256 | Key rotation signing/verification |
| AES-256-GCM | Symmetric encryption (messages, attachments, vault, channel keys) |
| PBKDF2-SHA256 | Password-based key derivation (600,000 iterations, 16-byte salt) |
| SHA-256 | Public key fingerprinting |
| HMAC-SHA256 | JWT signing (server-side) |

### Custom Crypto or Library-Backed?

Library-backed using Web Crypto API (window.crypto.subtle). All cryptographic operations delegate to the browser's native WebCrypto implementation. The project does NOT use any third-party crypto libraries (no tweetnacl, no forge, no libsodium). The code is a thin wrapper around WebCrypto primitives with custom serialization (Base64, JWK).

### Web Crypto API Usage

Yes -- exclusively. The getWebCrypto() helper resolves window.crypto or globalThis.crypto. Every generateKey, deriveKey, encrypt, decrypt, sign, verify, importKey, exportKey, digest, and getRandomValues call goes through getWebCrypto().subtle.

---

## 5. KEY MANAGEMENT

### ECDH Key Pairs (Message Encryption)

- Generated: client/src/lib/crypto.ts -> generateKeyPair() using ECDH P-256
- Stored (client): Dexie IndexedDB keys table as UserKeyPair (private key as JWK, public key as SPKI Base64)
- Stored (server): PostgreSQL users.public_key (SPKI Base64) and users.encrypted_private_key (PBKDF2+AES-GCM encrypted vault)
- Extractable: Yes (true), so keys can be exported to JWK for Dexie storage

### Signing Key Pairs (Key Rotation)

- Generated: client/src/lib/crypto.ts -> generateSigningKeyPair() using ECDSA P-256
- Stored (client): Dexie IndexedDB keys table (privateSigningKeyJwk, publicSigningKeyJwk)
- Stored (server): PostgreSQL users.signing_public_key (SPKI Base64)
- Purpose: Sign key rotation statements to prove identity continuity

### Channel Symmetric Keys

- Generated: client/src/lib/crypto.ts -> generateChannelSymmetricKey() -- random AES-256-GCM key
- Stored (client): Dexie IndexedDB channelKeys table as JWK; in-memory channelKeysCache Map
- Distribution: Channel creator encrypts the AES key JWK with ECDH shared key for each member, stored in PostgreSQL channel_keys table
- Rotation: On member removal/leave, channel:key_rotated event triggers creator to generate new key and redistribute

### Vault (Private Key Backup)

- Encryption: encryptPrivateKeyVault() or encryptKeyVaultPair()
- Algorithm: PBKDF2-SHA256 (600,000 iterations) -> AES-256-GCM wrapping key
- Salt: 16 random bytes
- IV: 12 random bytes
- Payload: { ecdh: JWK, ecdsa: JWK } JSON, encrypted
- Storage: Server users.encrypted_private_key and users.key_salt
- Decrypt: decryptPrivateKeyVault() tries legacy 100k iterations first, then 600k

---

## 6. MESSAGE FLOW

### DM Encryption/Decryption

1. Send: Sender derives ECDH shared key from own private key + peer's public key
2. Encrypt: encryptMessage(text, sharedKey) -> AES-256-GCM with fresh random 12-byte IV
3. Transport: Ciphertext + IV sent via Socket.io message:send event
4. Server: Stores ciphertext + IV in PostgreSQL (never sees plaintext)
5. Receive: Recipient derives same ECDH shared key from own private key + sender's public key
6. Decrypt: decryptMessage(ciphertext, iv, sharedKey) -> plaintext

### Channel Message Encryption/Decryption

1. Setup: Channel creator generates AES-256-GCM symmetric key
2. Distribution: Creator encrypts key JWK with ECDH shared key per member; stored on server
3. Send: Sender encrypts with channel symmetric key: encryptMessage(text, channelKey)
4. Transport: Ciphertext + IV sent via channel:message:send Socket.io event
5. Server: Stores ciphertext + IV (never sees plaintext)
6. Receive: Recipients decrypt with same channel key: decryptMessage(ciphertext, iv, channelKey)

### Key Agreement Protocol

Simple ECDH (not X3DH, not Triple DH):
- Each user has one ECDH P-256 key pair
- Shared key = ECDH(my_private_key, peer_public_key) -> AES-256-GCM via deriveKey
- This is a static-static ECDH (long-lived key pairs)

### Double Ratchet?

NO. There is no Double Ratchet protocol. The system uses simple static ECDH with per-peer shared keys. The shared key is derived once from the two static key pairs and cached. There is no per-message ratcheting, no forward secrecy beyond key rotation, and no break-in recovery mechanism.

### Key Rotation

- Server-side: POST /api/auth/rotate-key with ECDSA signature proving possession of old signing key
- Client-side: handleRotateKey() in useCrypto.ts generates new ECDH + ECDSA pairs
- TOFU chain: Clients verify rotation via validatePeerKeyTofu() which checks ECDSA signature against old signing public key

---

## 7. ATTACHMENT FLOW

### Encryption

1. Read file: readFileAsArrayBuffer(file) -> raw ArrayBuffer
2. Generate thumbnail: For images, canvas downscale to 300px max (stored in encrypted metadata)
3. Encrypt binary: encryptBinaryData(buffer, key) -> AES-256-GCM with fresh IV
4. Encrypt metadata: encryptMessage(JSON.stringify({fileName, fileSize, mimeType, thumbnail}), key) -> AES-256-GCM
5. Upload: uploadEncryptedAttachment() sends FormData with encrypted blob + encrypted metadata + both IVs
6. Server: Stores encrypted bytes to disk as .enc file; stores metadata in attachments table

### Keys Used

- DM attachments: ECDH shared key between sender and recipient (same key as messages)
- Channel attachments: Channel symmetric AES-256-GCM key (same key as channel messages)

### Download

1. Client fetches encrypted binary from GET /api/attachments/:id
2. Decrypts locally: decryptBinaryData(ciphertext, iv, key)
3. Creates Blob URL for display

---

## 8. SERVER ARCHITECTURE

### Authentication

Custom HMAC-SHA256 JWT (not the jsonwebtoken library):
- Signed with JWT_SECRET env var (min 32 chars required)
- Expiry: 1 hour
- Delivered via: httpOnly cookie + sessionStorage for Socket.io
- Token blocklist: PostgreSQL token_blocklist table (SHA-256 hash of token)

### REST Endpoints (All /api/* routes)

#### Auth
| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/auth/me | Get current user profile + vault keys |
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login with credentials |
| POST | /api/auth/logout | Logout (block token) |
| PUT | /api/auth/profile | Update profile |
| PUT | /api/user/profile | Update profile (alias) |
| PUT | /api/auth/password | Change password |
| POST | /api/auth/rotate-key | Key rotation with signature |

#### Users
| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/users | User directory |
| GET | /api/users/:id/keys | TOFU key metadata |
| POST | /api/users/me/avatar | Upload avatar |

#### Messages
| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/messages | Full message history for user |
| GET | /api/messages/direct/:recipientId | DM history |
| GET | /api/messages/channel/:channelId | Channel history |
| GET | /api/messages/:messageId | Single message |
| POST | /api/messages/cleanup | Delete undecryptable messages |

#### Channels
| Method | Route | Purpose |
|--------|-------|---------|
| PATCH | /api/channels/:channelId | Update channel |
| DELETE | /api/channels/:channelId | Delete channel |
| GET | /api/channels/:channelId/missing-keys | Members without key envelope |
| POST | /api/channels/:channelId/keys | Store encrypted key envelopes |
| GET | /api/channels/:channelId/key | Fetch own key envelope |

#### Admin
| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/admin/users | List all users |
| PATCH | /api/admin/users/:id/role | Change user role |
| PATCH | /api/admin/users/:id/profile | Admin edit profile |
| PATCH | /api/admin/users/:id/password | Force password reset |
| PATCH | /api/admin/users/:id/revoke-keys | Revoke E2EE keys |
| PATCH | /api/admin/users/:id/status | Suspend/activate |
| DELETE | /api/admin/users/:id | Delete user |
| GET | /api/admin/stats | Database statistics |
| GET | /api/admin/health | Server health/metrics |
| GET | /api/admin/audit-log | Audit log |

#### Attachments
| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/attachments/upload | Upload encrypted attachment |
| GET | /api/attachments/:id | Download encrypted attachment |

#### Reactions
| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/reactions/batch | Batch fetch reactions |

#### Starred
| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/starred | Star message |
| DELETE | /api/starred/:messageId | Unstar message |
| GET | /api/starred | Get starred messages |
| POST | /api/starred/batch | Batch star status |

#### Block
| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/block/:userId | Block user |
| DELETE | /api/block/:userId | Unblock user |
| GET | /api/block/status/:userId | Block status |

#### Friends
| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/friends/add | Send friend request |
| POST | /api/friends/accept | Accept friend request |
| POST | /api/friends/remove | Remove friend |
| GET | /api/friends | List friends + requests |

#### Hubs
| Method | Route | Purpose |
|--------|-------|---------|
| POST | /api/hubs | Create hub |
| GET | /api/hubs | List user hubs |
| GET | /api/hubs/:hubId | Get hub details |
| POST | /api/hubs/:hubId/join | Join hub |
| POST | /api/hubs/:hubId/leave | Leave hub |
| DELETE | /api/hubs/:hubId | Delete hub |

#### URL Preview
| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/url-preview | Fetch OG tags with SSRF protection |

#### Health
| Method | Route | Purpose |
|--------|-------|---------|
| GET | /health | Health check (admin-only in production) |

### Socket.io Events (Server Handlers)

#### Authentication Middleware
- Verifies JWT from socket.handshake.auth.token
- Attaches authenticatedUserId to socket
- Checks for suspended accounts

#### Incoming Events (socket.on)

| Event | Purpose |
|-------|---------|
| user:join | Register user, broadcast presence, send directory + channels |
| message:send | Send DM (persist + relay + ACK) |
| channel:message:send | Send channel message (persist + broadcast + ACK) |
| message:delivered | Delivery receipt (DM + channel) |
| message:read | Read receipt (DM + channel) |
| message:edit | Edit message (auth check: sender only) |
| message:delete | Delete message (auth check: sender only) |
| message:pin | Pin message in channel |
| message:unpin | Unpin message |
| reaction:add | Add emoji reaction |
| reaction:remove | Remove emoji reaction |
| user:typing | Typing indicator |
| user:stop_typing | Stop typing |
| user:heartbeat | Client heartbeat (updates lastSeen) |
| pong:heartbeat | Heartbeat response |
| channel:create | Create channel |
| channels:get | Request channel list |
| channel:join | Join channel room |
| channel:leave | Leave channel |
| channel:key:request | Request channel key from members |

#### Outgoing Events (io.emit / socket.emit)

| Event | Purpose |
|-------|---------|
| users:directory | Full user directory |
| users:presence | Presence list |
| user:online | User came online |
| user:status_change | Online/offline status |
| user:registered | New user registered |
| user:key_rotated | Key rotation broadcast |
| user:removed | User deleted |
| user:role_change | Role changed |
| user:profile-update | Profile updated |
| user:suspended | Account suspended |
| user:password_changed | Password changed |
| user:typing | Typing indicator |
| user:stop_typing | Stop typing |
| message:receive | DM received |
| message:ack | Send acknowledgment |
| message:delivered_ack | Delivery confirmation |
| message:read_ack | Read confirmation |
| message:edited | Message edited |
| message:deleted | Message deleted |
| message:reactions | Reactions updated |
| channel:create:ack | Channel creation confirmed |
| channel:message:receive | Channel message received |
| channel:member_added | Member added |
| channel:member_removed | Member removed |
| channel:key_rotated | Channel key rotated |
| channel:key_request | Key request from member |
| channel:key_response | Key delivered to requester |
| channel:ownership_transferred | Channel ownership changed |
| channel:pinned | Pinned messages updated |
| channel:unpinned | Unpinned message |
| channels:update | Channel list updated |
| ping:heartbeat | Server heartbeat ping |
| pong:heartbeat | Client heartbeat pong |

---

## 9. TESTS

### Test Files

| File | Framework | Tests |
|------|-----------|-------|
| client/src/lib/crypto.test.ts | Vitest | 5 tests: encrypt/decrypt plaintext, ECDH key exchange, fingerprint generation, vault encrypt/decrypt, binary encrypt/decrypt |
| client/src/lib/db.test.ts | Vitest | 11 tests: save/retrieve/update messages, status transitions (no downgrade), blocked users CRUD |
| client/src/test/attachments.test.ts | Vitest | 2 tests: formatFileSize, MAX_ATTACHMENT_BYTES constant |
| client/src/test/setup.ts | Vitest | Test setup (likely jsdom globals) |

### Test Configuration
- vite.config.ts configures Vitest with jsdom environment, globals enabled, CSS processing

---

## 10. CONFIGURATION

### Environment Variables

#### Server (server/.env and server/.env.example)

| Variable | Required | Description |
|----------|----------|-------------|
| JWT_SECRET | YES (min 32 chars) | HMAC-SHA256 signing secret |
| CORS_ORIGIN | YES | Frontend URL (default: http://localhost:5173) |
| PORT | No | Server port (default: 3001) |
| VAULTCHAT_PGDATA | No | PostgreSQL data directory (default: .pgdata) |
| VAULTCHAT_PGPORT | No | PostgreSQL port (default: 5433) |
| VAULTCHAT_PGUSER | No | PostgreSQL user (default: vaultchat) |
| VAULTCHAT_PGPASSWORD | No | PostgreSQL password (random if not set) |
| VAULTCHAT_UPLOADS | No | Attachments directory (default: uploads/) |
| ADMIN_PASSWORD | No | Password for seeded admin account |
| NODE_ENV | No | production enables secure cookies + health auth |
| LOG_LEVEL | No | Pino log level (default: info) |

#### Client (Vite Environment)

| Variable | Description |
|----------|-------------|
| VITE_SERVER_URL | Backend URL (default: http://localhost:3001) |
| VITE_API_BASE | API base URL (used in some hooks) |

### Configuration Files

| File | Purpose |
|------|---------|
| package.json (root) | Monorepo scripts: install:all, dev:server, dev:client, test:client |
| server/package.json | Server dependencies and scripts |
| server/tsconfig.json | TypeScript config for server |
| client/vite.config.ts | Vite config with proxy + Vitest |
| client/tsconfig.json | TypeScript config for client |
| client/tailwind.config.js | Tailwind CSS configuration |
| .gitignore | Git ignore rules |
| .gitattributes | Git attributes |
| server/.env | Active environment config |

### Security Configuration (Server)

| Setting | Value |
|---------|-------|
| Bcrypt rounds | 12 |
| JWT expiry | 1 hour |
| Auth rate limit | 10 requests/minute |
| Message rate limit | 10/second per socket |
| Upload rate limit | 10/minute per user |
| Key rotation rate limit | 3/hour per user |
| Max attachment size | 25 MB |
| Max avatar size | 2 MB |
| Max ciphertext length | 10 KB |
| HTTP buffer size | 26 MB |
| Stale connection cleanup | 3 minutes |
| Heartbeat interval | 30 seconds (server) / 60 seconds (client) |
| Orphaned attachment cleanup | 30 minutes |

---

## SECURITY ARCHITECTURE SUMMARY

### What the Server Sees
- Ciphertext for all messages (never plaintext)
- Encrypted attachment binaries (never plaintext)
- Encrypted metadata (file names, sizes -- encrypted with same key as messages)
- Encrypted private key vault (PBKDF2-wrapped)
- Public keys (ECDH + ECDSA)
- JWT tokens (for auth)

### What the Server Never Sees
- Plaintext messages
- Plaintext file contents
- Plaintext file names (encrypted in metadata)
- Private keys (only encrypted vault)
- ECDH shared keys
- Channel symmetric keys

### Cryptographic Properties

| Property | Status |
|----------|--------|
| End-to-End Encryption | YES -- all content encrypted client-side |
| Forward Secrecy | PARTIAL -- only via manual key rotation (no Double Ratchet) |
| Post-Compromise Security | PARTIAL -- key rotation with ECDSA signature chain |
| Identity Verification | TOFU + ECDSA-signed key rotation |
| Server-Side Decryption | NO -- zero-knowledge for message content |
| Metadata Protection | MINIMAL -- ciphertext length, timing, and sender/recipient IDs visible to server |
| Group Key Management | Per-member ECDH-encrypted AES key distribution |
| Offline Support | YES -- pending_sync queue with re-encryption on reconnect |

### Notable Security Observations

1. Static ECDH (no ratcheting): Each DM uses one long-lived shared key derived from static key pairs. No per-message forward secrecy.
2. TOFU model: First-use key pinning with ECDSA-signed rotation chain for continuity verification.
3. Custom JWT: Hand-rolled HMAC-SHA256 JWT (not a library) -- uses crypto.timingSafeEqual for signature verification.
4. Legacy SHA-256 password migration: Server auto-migrates legacy password hashes to bcrypt on login.
5. Channel key rotation: Triggered on member removal; new AES key generated and redistributed.
6. Server stores encrypted vault: Password-derived key wrapping for multi-device recovery.
7. WebSocket-only transport: HTTP long-polling disabled for socket connections.
8. CSP + Helmet: Content Security Policy, HSTS, CORS restrictions enforced.
9. SSRF protection: URL preview endpoint resolves DNS and checks for private IPs before fetching.
10. Token blocklist: Logout and password change invalidate JWTs via PostgreSQL-backed blocklist.
