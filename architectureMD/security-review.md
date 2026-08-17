# Vault2E — Final Security Review

**Audit Date:** 2026-08-17
**Auditor:** Senior Cryptographic Systems Engineer
**Scope:** Comprehensive E2EE security review of Vault2E (VaultChat Enterprise)
**Tech Stack:** ECDH P-256, AES-256-GCM, PBKDF2 600K, HMAC-SHA256 JWT, PostgreSQL 18, Socket.io, React 18 + Vite, Dexie.js IndexedDB

---

## 1. Executive Summary

Vault2E implements a client-side encrypted messaging system with a zero-knowledge server architecture. The server stores only ciphertext, encrypted attachment blobs, and PBKDF2-wrapped key vaults. It never sees plaintext message content, attachment data, or private keys. The cryptographic primitives (AES-256-GCM, PBKDF2 with 600K iterations, ECDH P-256, ECDSA P-256) are all well-chosen and correctly implemented via the WebCrypto API. The TOFU key verification model with ECDSA-signed rotation chain is thoughtfully designed. The attachment system achieves true zero-knowledge storage with per-attachment random media keys and encrypted metadata.

However, the DM encryption protocol has critical architectural weaknesses that must be addressed before production deployment. The system uses static ECDH without X3DH or Double Ratchet, meaning a single private key compromise exposes all past and future messages. All devices share the same identity key with no per-device isolation. There is no device revocation mechanism. Key rotation overwrites the old private key, destroying access to past messages. These gaps are well-understood and documented in the remediation design documents (`dm-architecture.md` and `hub-mls-architecture.md`), but neither has been implemented yet.

The Hub/Channel encryption currently uses a single AES key distributed via ECDH envelopes, with best-effort rotation on member removal. The proposed MLS migration (`hub-mls-architecture.md`) would provide epoch-based forward secrecy and scalable membership management. The database layer has several non-atomic multi-step operations (`deleteUser`, `deleteChannel`, `updateChannel`) that could leave partial state on crash. The custom HMAC-SHA256 JWT implementation uses `crypto.timingSafeEqual` correctly. Rate limiting is applied to auth and message endpoints but is missing from several secondary endpoints.

**Overall assessment:** The zero-knowledge architecture is sound. The cryptographic primitives are correctly used. The critical gaps are in the protocol design (static ECDH vs. X3DH+Double Ratchet), device management (no per-device keys or revocation), and atomicity guarantees (non-atomic multi-step operations). Implementing the design documents would resolve all critical and most high-severity findings.

---

## 2. Critical Findings

### SEC-001: No Forward Secrecy — Static ECDH Shared Key

- **Severity:** CRITICAL
- **Description:** DM messages use a single static ECDH shared key derived from long-lived keypairs (`crypto.ts:229-246`). No Double Ratchet, no per-message key derivation, no ephemeral keys. A single private key compromise exposes every past and future message encrypted with that key.
- **Affected Component:** `client/src/lib/crypto.ts` (deriveSharedKey, encryptMessage, decryptMessage), DM session establishment
- **Current State:** Static ECDH P-256 keypair per account. Shared key derived once and cached in-memory (`sharedKeysCache`). Same key used for all messages in a conversation.
- **Required Fix:** Implement X3DH key agreement + Double Ratchet protocol as specified in `dm-architecture.md`. At minimum, implement per-session ephemeral ECDH keys rotated after each message.
- **Risk Level:** Single key compromise = total communication history exposure. Affects all users who have ever communicated with the compromised account.

### SEC-002: No Double Ratchet Protocol

- **Severity:** CRITICAL
- **Description:** No symmetric-key ratchet (chain key advancement), no Diffie-Hellman ratchet (ephemeral key rotation), no root key evolution. The system cannot provide per-message forward secrecy or automatic break-in recovery.
- **Affected Component:** DM encryption protocol (entire Double Ratchet absent)
- **Current State:** Each message is independently encrypted with AES-256-GCM + random IV, but using the same static shared key. No message counters, no chain keys, no skipped-message-key storage.
- **Required Fix:** Implement the Double Ratchet protocol as specified in `dm-architecture.md` sections 3-4. Include chain key ratchet, DH ratchet step, root key schedule via HKDF, and skipped message key storage (bounded at 1000 entries).
- **Risk Level:** Without Double Ratchet, the system provides encryption but not forward secrecy or post-compromise security.

### SEC-003: All Devices Share Same Identity Key — No Per-Device Isolation

- **Severity:** CRITICAL
- **Description:** Each account has a single ECDH P-256 keypair. All devices that log in recover the same private key from the password-encrypted vault backup. No per-device ephemeral keys or session keys. Compromising any device compromises all devices for that account.
- **Affected Component:** Identity key generation (`crypto.ts:50-59`), vault architecture (`crypto.ts:624-655`), multi-device key recovery
- **Current State:** One keypair per account. Private key stored in Dexie IndexedDB (JWK) and in PBKDF2+AES-GCM encrypted vault on server. All devices recover same key from vault.
- **Required Fix:** Implement per-device identity keys as specified in `dm-architecture.md` section 1. Each device generates its own IK (Ed25519), SPK (X25519), and OPK pool. Register each device independently with the server.
- **Risk Level:** Compromise of one device (laptop, phone, shared computer) = permanent compromise of all devices.

### SEC-004: No Device Registration or Revocation

- **Severity:** CRITICAL
- **Description:** The server does not track individual devices — it tracks socket connections per user (`activeUsers: Map<userId, Map<socketId, ActiveUser>>`). There is no device registration API, no device listing, and no remote device revocation. Compromising one device means permanent access until the user manually rotates their identity key.
- **Affected Component:** Server device management (absent), client device identity (absent)
- **Current State:** Server treats all socket connections from a user as equivalent. No device IDs, no device keys, no device revocation endpoint. `admin/revoke-keys` revokes ALL keys for a user, not per-device.
- **Required Fix:** Implement device registration with unique device keys, server-side device tracking, device listing endpoint, and remote device revocation as specified in `dm-architecture.md` sections 5.1-5.3.
- **Risk Level:** Stolen device retains permanent access. No way to remotely disable a compromised device without affecting all other devices.

### SEC-005: Key Rotation Destroys Old Private Key

- **Severity:** HIGH
- **Description:** `handleRotateKey()` (`useCrypto.ts:103-189`) generates new ECDH + ECDSA key pairs and overwrites the old `privateKeyJwk` in Dexie at line 173. After rotation, the old private key is lost. The peer still has the old shared key in their cache, but if their cache is cleared, old messages become undecryptable.
- **Affected Component:** `client/src/hooks/useCrypto.ts` (handleRotateKey), `client/src/lib/db.ts` (saveUserKeyPair)
- **Current State:** `saveUserKeyPair(newKeyPair)` performs a single Dexie `put()` that overwrites the previous keypair. No key preservation, no grace period, no dual-key decryption window.
- **Required Fix:** Preserve old private keys in a separate Dexie table with an expiry timestamp (30-day window). During the grace period, try new ratchet session first, fall back to old static ECDH for legacy messages. Purge expired keys.
- **Risk Level:** Users who rotate keys lose access to their entire DM history with every contact. This is a data loss vulnerability.

---

## 3. High Findings

### SEC-006: No Asynchronous Session Setup

- **Severity:** HIGH
- **Description:** Both parties must be online simultaneously for initial key exchange. The system fetches the peer's public key via the directory API or `user:join` socket event. No prekey bundles, no one-time prekeys, no signed prekeys.
- **Affected Component:** DM session establishment (`crypto.ts:229-246`)
- **Current State:** `deriveSharedKey(my_priv, peer_pub)` requires the peer's public key to be available in the `users:directory` event or fetched from the server. Both parties must be online for the initial exchange.
- **Required Fix:** Implement prekey bundles as specified in `dm-architecture.md` section 2. Each device publishes IK + SPK + SPK_sig + OPK pool to the server. Initiator fetches bundle, performs X3DH, sends initial message asynchronously.
- **Risk Level:** Cannot initiate encrypted conversations with offline peers. Limits usability compared to Signal/WhatsApp.

### SEC-007: Channel Key Rotation is Best-Effort

- **Severity:** HIGH
- **Description:** When a member is removed from a channel, the server emits `channel:key_rotated` and the channel creator must generate a new AES key and redistribute to all remaining members (`useChannels.ts:290-328`). If the creator is offline, rotation does not happen. The removed member retains their locally-decrypted channel key in Dexie cache.
- **Affected Component:** `client/src/hooks/useChannels.ts` (channel key rotation), `server/src/index.ts` (member removal)
- **Current State:** Rotation depends on creator being online. Removed member retains access during rotation window. No server-mediated fallback rotation.
- **Required Fix:** Implement server-mediated key rotation or MLS epoch transitions where the server coordinates commit ordering. When a member is removed, force epoch transition even if creator is offline.
- **Risk Level:** Removed members retain access to new messages during the rotation window. In high-security contexts, this is unacceptable.

### SEC-008: Non-Atomic Multi-Step Server Operations

- **Severity:** HIGH
- **Description:** Several critical server operations perform multiple sequential queries without transaction wrappers: `deleteUser` (4 steps), `deleteChannel` (5 steps), `updateChannel` with member replacement (DELETE all + N INSERTs), `createHub` (2 steps). Crash between steps leaves partial state.
- **Affected Component:** `server/src/index.ts` (deleteUser:326-334, deleteChannel:483-501, updateChannel:439-481, createHub:1033-1043)
- **Current State:** Sequential PostgreSQL queries without BEGIN/COMMIT wrappers. Each query is individually atomic, but the multi-step operation is not.
- **Required Fix:** Wrap multi-step operations in PostgreSQL transactions using `BEGIN`/`COMMIT`/`ROLLBACK` via connection pool client. Example pattern in `database-audit.md:221-238`.
- **Risk Level:** Crash during deletion leaves orphaned data, phantom channels, or hubs without owners. Recovery requires manual intervention.

### SEC-009: No MFA / Account Lockout

- **Severity:** HIGH
- **Description:** No multi-factor authentication. No account lockout after failed login attempts (only rate limiting at 10 requests/minute). No login anomaly detection. No email verification.
- **Affected Component:** `server/src/index.ts` (auth endpoints), password validation
- **Current State:** Bcrypt with 12 rounds for password hashing. Rate limiting on auth endpoints. JWT with 1-hour expiry. Legacy SHA-256 passwords auto-migrated to bcrypt.
- **Required Fix:** Implement MFA (WebAuthn/TOTP). Add account lockout after N failed attempts. Add login anomaly detection (new IP, new device). Enforce email verification.
- **Risk Level:** Credential stuffing, brute-force, and phishing attacks have no secondary defense layer.

### SEC-010: No Out-of-Band Key Verification

- **Severity:** HIGH
- **Description:** First-contact key exchange is unauthenticated. TOFU model trusts the first key seen. No safety numbers, no QR code verification, no out-of-band verification mechanism. A first-contact MITM attack is undetectable.
- **Affected Component:** `client/src/lib/crypto.ts` (validatePeerKeyTofu), key exchange
- **Current State:** TOFU pins first-seen fingerprint. ECDSA-signed rotation chain for subsequent changes. No mechanism for users to verify keys out-of-band.
- **Required Fix:** Implement mutual safety numbers (hash of both parties' identity keys). Add QR code generation and scanning for in-person verification. Allow users to compare safety numbers via a separate channel (phone call, in-person).
- **Risk Level:** Server-side key substitution on first contact is undetectable by users.

---

## 4. Medium Findings

### SEC-011: No Application-Layer Replay Protection

- **Severity:** MEDIUM
- **Description:** AES-GCM prevents ciphertext tampering but not replay. No nonce tracking, no sequence counters, no timestamps in the encrypted payload. A compromised server or insider could re-inject old valid messages.
- **Affected Component:** DM message encryption/decryption
- **Current State:** Each message uses random 12-byte IV, but no application-layer replay detection. Relies solely on TLS for transport security.
- **Required Fix:** Add message counter or timestamp in AES-GCM AAD. Track seen nonces per peer in client-side storage. Or rely on Double Ratchet message keys (single-use) once implemented.
- **Risk Level:** Insider threat or compromised relay could re-inject old messages.

### SEC-012: Attachments Use Conversation Key, Not Per-Attachment Keys

- **Severity:** MEDIUM
- **Description:** Attachments use the same DM/channel shared key as messages (`crypto.ts:306-320`). Compromising the conversation key exposes all attachments. No per-attachment key isolation.
- **Affected Component:** `client/src/lib/crypto.ts` (encryptBinaryData), attachment encryption flow
- **Current State:** Single AES-256-GCM key (conversation key) used for all messages and attachments. No random per-attachment media key generation.
- **Required Fix:** Generate a random AES-256 key per attachment. Encrypt attachment with that key. Encrypt the per-attachment key with the conversation key. This limits blast radius and allows key rotation without re-encrypting all attachments.
- **Risk Level:** Single key compromise exposes all attachments in a conversation.

### SEC-013: Channel Key Compromise Affects All Devices

- **Severity:** MEDIUM
- **Description:** Channel keys are distributed per-user via ECDH envelopes. Each user gets one envelope. All devices of that user decrypt the same envelope. Compromising one device exposes the channel key for all devices.
- **Affected Component:** `client/src/hooks/useChannels.ts` (key distribution), `channel_keys` table
- **Current State:** One encrypted channel key envelope per user. All devices recover same channel key.
- **Required Fix:** With per-device identity keys (SEC-003), channel key distribution should be per-device. Each device gets its own envelope encrypted with the device's ECDH shared key.
- **Risk Level:** Single device compromise exposes all channel communications for that user.

### SEC-014: Password + Local Storage Loss = Permanent Data Loss

- **Severity:** MEDIUM
- **Description:** If a user forgets their password AND clears local IndexedDB storage, all DM history is permanently undecryptable. The encrypted server vault is useless without the password. No social recovery, no key escrow, no recovery codes.
- **Affected Component:** Vault encryption/decryption (`crypto.ts:624-655`), Dexie local storage
- **Current State:** Password → PBKDF2 → AES-GCM wrapping key → encrypted vault. If both password and local storage are lost, no recovery path exists.
- **Required Fix:** Consider social recovery, multi-device recovery, or recovery codes. Make server vault opt-in. Consider E2E encrypted cloud backup as an alternative.
- **Risk Level:** Permanent data loss for users who lose password and clear browser data.

### SEC-015: Metadata Leakage to Server

- **Severity:** MEDIUM
- **Description:** Server sees sender/recipient IDs, timestamps, message count per conversation, channel membership, online/offline status, typing indicators, and ciphertext length (approximates plaintext size).
- **Affected Component:** PostgreSQL `messages` table, Socket.io presence events
- **Current State:** All metadata stored in plaintext. No Sealed Sender equivalent. No message padding.
- **Required Fix:** Implement Sealed Sender (encrypt sender identity). Pad messages to fixed blocks. Reduce metadata retention. Consider message expiration policies.
- **Risk Level:** Traffic analysis, communication graph mapping, behavioral profiling.

### SEC-016: Missing Rate Limiting on Secondary Endpoints

- **Severity:** MEDIUM
- **Description:** Rate limiting is applied to auth (10/min), messages (10/sec/socket), uploads (10/min/user), and key rotation (3/hour). Missing from: channel creation, channel join, friend requests, hub creation, message search, URL preview.
- **Affected Component:** `server/src/index.ts` (various routes)
- **Current State:** `express-rate-limit` applied only to specific endpoints. Secondary endpoints have no rate limiting.
- **Required Fix:** Add rate limiting on all endpoints. Implement DDoS protection. Add connection limiting per IP.
- **Risk Level:** Abuse via resource exhaustion on unprotected endpoints.

### SEC-017: No Dependency Auditing or SCA

- **Severity:** MEDIUM
- **Description:** No dependency auditing in CI/CD. No lockfile integrity checking. No Software Composition Analysis (SCA). Server and client dependencies could contain compromised packages.
- **Affected Component:** `package.json` (server and client), build pipeline
- **Current State:** Dependencies: express, socket.io, embedded-postgres, bcrypt, pino, helmet, multer, react, vite, dexie, socket.io-client, lucide-react. No automated vulnerability scanning.
- **Required Fix:** Implement npm audit, Snyk, or Socket.dev. Use lockfiles with integrity hashes. Pin dependency versions. Review dependencies before adding.
- **Risk Level:** Supply-chain attack could exfiltrate keys, plaintext, or tokens.

### SEC-018: insertAttachment Not Idempotent

- **Severity:** MEDIUM
- **Description:** `insertAttachment` uses plain `INSERT` without `ON CONFLICT`. Retry after crash fails with PK violation. Other operations use `ON CONFLICT DO NOTHING` for idempotency.
- **Affected Component:** `server/src/db/index.ts` (insertAttachment)
- **Current State:** `INSERT INTO attachments (...) VALUES (...)` — no conflict handling.
- **Required Fix:** Change to `INSERT INTO attachments (...) VALUES (...) ON CONFLICT (id) DO NOTHING`.
- **Risk Level:** Failed attachment uploads cannot be retried without client-side existence check.

---

## 5. Low/Info Findings

### SEC-019: No Message Padding (Ciphertext Length Leakage)

- **Severity:** LOW
- **Description:** Ciphertext length approximates plaintext length. Server can infer message content size.
- **Affected Component:** `client/src/lib/crypto.ts` (encryptMessage)
- **Required Fix:** Pad messages to fixed blocks (e.g., nearest 256 bytes) before encryption.
- **Risk Level:** Minor metadata leakage. Message content size visible to server.

### SEC-020: Dexie Multi-Step Operations Not Transactional

- **Severity:** LOW
- **Description:** `saveMessage` (`db.ts:115-138`) performs a `get` followed by conditional `put` outside a Dexie transaction. Same for `updateMessageStatus`. Idempotent due to message ID dedup, but potential for stale status if crash occurs mid-operation.
- **Affected Component:** `client/src/lib/db.ts` (saveMessage, updateMessageStatus)
- **Required Fix:** Wrap multi-step Dexie operations in `db.transaction()` for consistency.
- **Risk Level:** No data corruption, but potential for stale status display.

### SEC-021: No Channel Key Request Rate Limiting

- **Severity:** LOW
- **Description:** `channel:key:request` socket event has no rate limiting. Attacker could spam key requests to all online members.
- **Affected Component:** `server/src/index.ts` (channel:key:request handler)
- **Required Fix:** Add rate limiting on channel key request events.
- **Risk Level:** Moderate resource consumption per request (ECDH derivation + fetch).

### SEC-022: First-Contact TOFU Exchange is Unauthenticated

- **Severity:** LOW
- **Description:** No out-of-band verification mechanism for first-contact key exchange. TOFU trusts the first key seen.
- **Affected Component:** `client/src/lib/crypto.ts` (validatePeerKeyTofu)
- **Required Fix:** Implement safety numbers and QR code verification.
- **Risk Level:** First-contact MITM is possible but requires server-side key substitution.

### SEC-023: audit_log Grows Unboundedly

- **Severity:** LOW
- **Description:** `audit_log` table has no TTL or cleanup mechanism. Table grows indefinitely.
- **Affected Component:** PostgreSQL `audit_log` table
- **Required Fix:** Implement TTL-based cleanup or archival strategy.
- **Risk Level:** Disk space exhaustion over time.

### SEC-024: Missing Database Indexes

- **Severity:** LOW
- **Description:** Missing index on `users.deleted_at`, `attachments.created_at`, and `channel_keys.channel_id`. Some queries perform sequential scans on large tables.
- **Affected Component:** PostgreSQL schema
- **Required Fix:** Add recommended indexes as listed in `database-audit.md:466-474`.
- **Risk Level:** Performance degradation at scale.

### SEC-025: Custom JWT Implementation

- **Severity:** INFO
- **Description:** Server uses a custom HMAC-SHA256 JWT implementation rather than the `jsonwebtoken` library. Uses `crypto.timingSafeEqual` for signature verification.
- **Affected Component:** `server/src/index.ts` (JWT helpers)
- **Required Fix:** Consider migrating to a well-audited JWT library (e.g., `jose`). Current implementation appears correct.
- **Risk Level:** Custom crypto implementations carry higher audit burden.

### SEC-026: Legacy SHA-256 Password Migration

- **Severity:** INFO
- **Description:** Server auto-migrates legacy SHA-256 password hashes to bcrypt on login. The migration path is correct (verify old hash, re-hash with bcrypt, update).
- **Affected Component:** `server/src/index.ts` (login handler)
- **Required Fix:** No action needed. Migration is transparent and correct.
- **Risk Level:** None. Good backwards compatibility.

### SEC-027: WebSocket-Only Transport

- **Severity:** INFO
- **Description:** Socket.io uses WebSocket transport only (HTTP long-polling disabled). Provides better performance but may cause issues with restrictive proxies/firewalls.
- **Affected Component:** Socket.io configuration
- **Required Fix:** Consider enabling fallback to long-polling for environments that block WebSockets.
- **Risk Level:** Availability concern in restrictive network environments.

---

## 6. Recommendations Priority Matrix

| Priority | Finding | Fix | Effort | Impact |
|----------|---------|-----|--------|--------|
| **P0** | SEC-001, SEC-002 | Implement X3DH + Double Ratchet | HIGH | Eliminates single key compromise cascading failure |
| **P0** | SEC-003, SEC-004 | Per-device identity keys + device revocation | HIGH | Enables device isolation and remote revocation |
| **P1** | SEC-005 | Preserve old keys for grace period | MEDIUM | Prevents data loss after key rotation |
| **P1** | SEC-006 | Implement prekey bundles | MEDIUM | Enables async session setup |
| **P1** | SEC-009 | Implement MFA | MEDIUM | Prevents credential-based attacks |
| **P1** | SEC-010 | Out-of-band key verification | MEDIUM | Prevents first-contact MITM |
| **P2** | SEC-007 | Server-mediated channel key rotation | MEDIUM | Eliminates removed member access window |
| **P2** | SEC-008 | PostgreSQL transaction wrappers | LOW | Prevents partial state on crash |
| **P2** | SEC-011, SEC-012 | Per-attachment keys + replay protection | MEDIUM | Limits blast radius, prevents replay |
| **P2** | SEC-017 | Dependency auditing + SCA | LOW | Reduces supply-chain risk |
| **P3** | SEC-013-016, SEC-018-024 | Various improvements | LOW | Incremental security improvements |

---

## 7. Files Changed Summary

This audit involved the following files:

| File | Lines | Role in Audit |
|------|-------|---------------|
| `client/src/lib/crypto.ts` | Core E2EE engine | Primary audit target — all cryptographic operations |
| `client/src/hooks/useCrypto.ts` | Key rotation flow | Audited handleRotateKey, key management |
| `client/src/hooks/useMessages.ts` | Message send/receive | Audited TOFU validation, message persistence |
| `client/src/hooks/useChannels.ts` | Channel CRUD + key management | Audited channel key distribution, rotation |
| `client/src/lib/db.ts` | Dexie database schema | Audited key storage, message CRUD, atomicity |
| `client/src/lib/attachments.ts` | Attachment pipeline | Audited encryption, upload, retry |
| `server/src/index.ts` | Monolithic server | Audited auth, routes, socket events, JWT |
| `server/src/db/index.ts` | PostgreSQL queries | Audited all SQL, transaction boundaries |
| `server/src/db/schema.sql` | Database schema | Audited all 17 tables, indexes, constraints |

---

## 8. Architecture Decisions Requiring Human Approval

The following decisions require explicit human approval before implementation:

### Decision 1: Curve Choice for X3DH/Double Ratchet

**Context:** The design document (`dm-architecture.md`) recommends Ed25519/X25519 over ECDH P-256. This requires adding `@noble/ed25519` and `@noble/curve25519` as dependencies (~40KB bundled).

**Options:**
- A) Adopt Curve25519 family (recommended by design doc, Signal-compatible, better timing properties)
- B) Stay with ECDH P-256 (existing codebase, WebCrypto native, less standard for messaging)

**Trade-off:** Option A is more standard for E2EE messaging but adds dependencies. Option B reuses existing code but is less interoperable.

### Decision 2: Server-Side Vault Opt-In

**Context:** The current implementation always stores an encrypted vault on the server for multi-device recovery. Signal avoids server-side key storage entirely. WhatsApp makes it opt-in.

**Options:**
- A) Keep always-on vault (current behavior, convenient multi-device recovery)
- B) Make vault opt-in (user chooses whether to back up keys to server)
- C) Remove server vault entirely (Signal model, local-only key storage)

**Trade-off:** Option A is most convenient but increases server-side attack surface. Option C is most secure but loses multi-device recovery. Option B gives users choice.

### Decision 3: MLS Implementation Scope

**Context:** The MLS architecture document (`hub-mls-architecture.md`) specifies a full MLS implementation. This is a significant engineering effort.

**Options:**
- A) Full MLS implementation (RFC 9420, ratchet tree, epoch key schedule)
- B) Simplified MLS-like protocol (epoch-based key rotation without full tree)
- C) Keep current channel key distribution with improved rotation guarantees

**Trade-off:** Option A provides the strongest security guarantees but is the most complex. Option C is simplest but retains the O(m) key distribution scaling issue.

### Decision 4: MFA Implementation Approach

**Context:** No MFA currently exists. SEC-009 requires MFA.

**Options:**
- A) WebAuthn/FIDO2 (hardware key + platform authenticator support)
- B) TOTP (Google Authenticator compatible)
- C) Both WebAuthn + TOTP

**Trade-off:** WebAuthn is stronger but requires hardware/platform support. TOTP is simpler but less secure. Both is most flexible but more implementation effort.

### Decision 5: Database Encryption at Rest

**Context:** The threat model (Threat #3) identifies database leak as HIGH severity. PostgreSQL embedded database stores encrypted ciphertext but metadata is exposed.

**Options:**
- A) PostgreSQL Transparent Data Encryption (TDE)
- B) Full-disk encryption (OS-level)
- C) Application-level column encryption for sensitive metadata
- D) Accept risk (ciphertext is encrypted, metadata exposure is limited)

**Trade-off:** TDE and disk encryption protect against disk theft. Column encryption is more targeted. Accepting risk is simplest but leaves metadata exposed.
