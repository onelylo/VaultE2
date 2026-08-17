# Vault2E (VaultChat Enterprise) — E2EE Cryptographic Architecture Audit

**Auditor:** Senior Cryptographic Systems Engineer  
**Date:** 2026-08-17  
**Scope:** Full client+server E2EE implementation across `client/src/lib/crypto.ts`, `client/src/hooks/useCrypto.ts`, `client/src/hooks/useMessages.ts`, `client/src/hooks/useChannels.ts`, `server/src/index.ts`, `server/src/db/schema.sql`, `client/src/lib/db.ts`

---

## A. Identity Keys

### A1. Key Generation — Per-Account Identity Keys
- **Mechanism:** ECDH P-256 keypair generated via `window.crypto.subtle.generateKey` at account registration (`crypto.ts:50-59`).
- **Separate ECDSA signing keypair** generated via `generateSigningKeyPair()` (`crypto.ts:98-104`) — used exclusively for key rotation proofs.
- **Generated client-side only.** Server never sees plaintext private keys.
- **Severity:** INFO — Good separation of ECDH (encryption) and ECDSA (signing) keys. Standard WebCrypto usage.

### A2. Storage
- **Private keys:** Stored as JWK in Dexie (IndexedDB) via `saveUserKeyPair()` (`db.ts:91-93`). Also stored server-side encrypted with PBKDF2+AES-GCM as `encryptedPrivateKey` + `keySalt` in PostgreSQL (`schema.sql:12-13`).
- **Public keys:** Stored server-side in `users.public_key` (`schema.sql:11`). Shared via directory API and `user:join` socket event.
- **Key version tracking:** `key_version` integer column in `users` table (`schema.sql:14`).

### A3. Key Loss & Recovery
- **If local IndexedDB is cleared:** Private key is lost unless user can decrypt the server vault backup using their password (`encryptPrivateKeyVault` / `decryptPrivateKeyVault`).
- **Vault backup uses PBKDF2** with 600,000 iterations (or legacy 100,000), SHA-256, random 16-byte salt (`crypto.ts:624-655`).
- **Severity:** MEDIUM — No social recovery, no key escrow beyond password vault. If user forgets password AND clears local storage, all DM history is permanently undecryptable. Channel keys stored in Dexie are also lost. The encrypted server vault is useless without the password.

### A4. Public Key Authentication — TOFU Model
- **Trust On First Use (TOFU):** `validatePeerKeyTofu()` (`crypto.ts:568-617`) stores first-seen public key fingerprint in `trustedKeys` Dexie table.
- **Subsequent contacts:** Fingerprint is re-verified; mismatch blocks communication.
- **Key rotation detection:** If `keyVersion` increased AND old public key + old signing public key + rotation signature are all present AND old key fingerprint matches trusted entry, the rotation is verified via ECDSA signature (`crypto.ts:589-609`).
- **Severity:** LOW — TOFU is the industry standard for decentralized E2EE (Signal, Matrix). The signed rotation chain is well-implemented. However, **first-contact key exchange is unauthenticated** — there is no out-of-band verification mechanism beyond manual fingerprint comparison.

### A5. Key Change Detection
- **TOFU mismatch detected:** `validatePeerKeyTofu` returns `false`, `useMessages.ts:538-539` blocks the message send and shows a security toast.
- **Server-side rotation rate limit:** 3 rotations/hour per user (`index.ts:749-754`).
- **Severity:** INFO — Good protection against silent key substitution.

---

## B. Session Keys

### B1. DM Session Establishment
- **Simple static ECDH:** `deriveSharedKey()` (`crypto.ts:229-246`) computes `AES-256-GCM` key from `ECDH(my_private, peer_public)`.
- **No X3DH, no Triple Diffie-Hellman, no key agreement protocol.**
- **No prekeys, no one-time prekeys, no signed prekeys.**
- **Severity:** HIGH — This is the most significant architectural weakness.

**What is missing:**
1. **No forward secrecy.** If either party's long-term ECDH private key is compromised, **every past and future message** encrypted with that key can be decrypted. A single key compromise exposes the entire communication history.
2. **No break-in recovery.** There is no mechanism for the session to self-heal after a compromise — the same static key is used until one party manually rotates their identity key.
3. **No out-of-order delivery guarantee** from a ratchet perspective (though messages are individually random-IV AES-GCM, so this is partially mitigated).

### B2. Double Ratchet
- **Not implemented.** No sending/receiving chain ratcheting. No message counters. No skipped-message-key storage.
- **Severity:** HIGH — Standard Signal Protocol provides Double Ratchet specifically to achieve forward secrecy + break-in recovery + out-of-order message handling.

### B3. Prekeys
- **Not used.** There is no prekey bundle system, no prekey publication to server, no one-time prekey fetching.
- **Severity:** MEDIUM — Without prekeys, both parties must be online simultaneously for initial key agreement. This is inherent to the static ECDH model.

### B4. Session State Persistence
- **No session state.** There are no ratchet counters, no chain keys, no ephemeral keys to persist. The "session" is simply the static shared key derived from ECDH.
- **Shared key is cached** in an in-memory `Map<string, CryptoKey>` (`crypto.ts:430`).
- **Severity:** INFO — Simplified model, but as noted above, this comes at the cost of forward secrecy.

### B5. Crash Behavior
- **During decrypt:** AES-GCM decryption is atomic — either succeeds or fails. No partial state. Safe.
- **During ratchet:** N/A — no ratchet exists.
- **During ACK:** `message:delivered` and `message:read` are fire-and-forget socket events. If crash occurs between save and ACK, message is re-delivered on reconnect from server's undelivered queue (`index.ts:2029-2044`). Client `saveMessage` is idempotent (Dexie `put`). Safe.
- **Severity:** INFO — Crash safety is adequate for the current simple model.

---

## C. Message Ordering

### C1. Out-of-Order Delivery
- **Server stores messages** with `created_at` timestamps and serves them in order via SQL queries (`schema.sql:71-73`).
- **Socket relay is real-time**, so ordering depends on network delivery.
- **No message sequence numbers or ratchet counters.**
- **Severity:** INFO — Each message is independently encrypted with AES-GCM and a random 12-byte IV (`crypto.ts:259`), so ordering does not affect decryptability.

### C2. Duplicate Handling
- **`saveMessage()`** (`db.ts:115-138`) uses Dexie `put()` which is upsert by primary key. Duplicate message IDs overwrite gracefully.
- **Status rank checking** prevents downgrade (e.g., `read` → `sent`).
- **Severity:** INFO — Duplicates are handled safely.

### C3. Replay Protection
- **AES-GCM authentication tag** prevents ciphertext tampering, but does NOT prevent replay of a valid ciphertext.
- **No nonce tracking, no sequence counters, no timestamps in the encrypted payload.**
- **Severity:** MEDIUM — An attacker who captures a valid `(ciphertext, iv, sharedKey)` tuple can replay it. In practice this requires access to the shared key and is limited by transport security (TLS), but replay within the system is not prevented. For example, a compromised relay could re-inject old messages.

### C4. Skipped-Message Keys
- **Not applicable.** No ratchet, so no skipped-message key storage.
- **Severity:** INFO — Not needed in the current model.

---

## D. Multi-Device

### D1. Sessions Per-Device vs Per-Account
- **Per-account identity keys.** Each device that logs in recovers the same ECDH keypair from the password-encrypted vault backup (`decryptPrivateKeyVault`).
- **No per-device ephemeral keys or session keys.**
- **Severity:** HIGH — All devices share the same long-term private key. If any device is compromised, the attacker has the same private key as all other devices. There is no device isolation.

### D2. Device Registration/Removal
- **No explicit device registration.** The server does not track individual devices — it tracks socket connections per user (`activeUsers: Map<userId, Map<socketId, ActiveUser>>`).
- **No device removal API.** Compromising one device means permanent compromise of the identity key.
- **Severity:** HIGH — Standard E2EE protocols (Signal, WhatsApp) use per-device sessions precisely to enable remote device revocation. This system cannot revoke a single device's access.

### D3. Multi-Device Key Distribution
- **Channel keys** are distributed per-user via ECDH envelopes (`channel_keys` table). Each user gets one envelope. All devices of that user decrypt the same envelope.
- **Severity:** MEDIUM — Channel key compromise on one device affects all devices of that user.

---

## E. Key Rotation

### E1. Rotation Mechanism
- **Client-initiated:** `handleRotateKey()` in `useCrypto.ts:103-189`.
- **Process:**
  1. Generate new ECDH + ECDSA key pairs
  2. Sign rotation statement with OLD ECDSA signing private key
  3. Upload new public keys + signature to server
  4. Server verifies ECDSA signature against pinned `signing_public_key`
  5. Server bumps `key_version`, stores old keys for TOFU chain
  6. Client broadcasts `user:key_rotated` to online contacts

### E2. ECDSA Signing Chain Verification
- **Statement format:** `petroshield-key-rotation-v1\n{newEcdhPub}\n{newSigningPub}\n{oldEcdhPub}` (`crypto.ts:125-127`)
- **Server verification:** `crypto.verify` with `dsaEncoding: 'ieee-p1363'` (`index.ts:772-783`)
- **Client verification:** `verifyKeyRotationSignature()` (`crypto.ts:140-168`) uses WebCrypto `subtle.verify`
- **TOFU chain:** Clients verify the rotation chain using `validatePeerKeyTofu` (`crypto.ts:589-609`), which checks that the old key matches the trusted fingerprint AND the ECDSA signature is valid.
- **Severity:** INFO — The ECDSA signing chain is well-designed. Signature covers all critical fields. Server rate-limits rotations.

### E3. Old Messages After Rotation
- **DM messages encrypted with old static shared key** remain decryptable using the OLD private key, which is still in local Dexie storage (the `privateKeyJwk` is updated in place at `useCrypto.ts:173`).
- **Old private keys are NOT explicitly preserved.** The `saveUserKeyPair` call at line 173 overwrites the previous keypair.
- **Severity:** HIGH — After key rotation, ALL past DM messages with a given peer become undecryptable because the old private key is overwritten. The peer still has the old shared key in their cache (`sharedKeysCache`), but if their cache is cleared, those messages are lost. There is no key rollover period or dual-key decryption window.

**Specific failure scenario:**
1. Alice and Bob exchange messages with shared key derived from `Alice_old_priv × Bob_pub`
2. Alice rotates keys → her `privateKeyJwk` is overwritten with new key
3. Bob's cache may still hold the old shared key, so Bob can decrypt old messages
4. If Bob clears cache or re-derives, old messages become undecryptable
5. If Alice's cache is cleared, Alice can never re-decrypt old messages

---

## F. Attachments

### F1. Encryption Mechanism
- **Binary content:** Encrypted with AES-256-GCM using the same shared key (DM or channel key) as messages (`crypto.ts:306-320`).
- **Fresh random 12-byte IV** per attachment (`crypto.ts:310`).
- **Metadata (filename, size, mime type):** Encrypted separately with AES-256-GCM using the same key (`useMessages.ts:597`).

### F2. Key Per Attachment
- **No random per-attachment key.** Attachments use the same shared key as the conversation.
- **Severity:** MEDIUM — This means compromising the DM/channel key exposes all attachments. A per-attachment random AES key, encrypted with the conversation key, would provide better isolation and allow key rotation without re-encrypting all attachments.

### F3. Server Visibility
- **Server receives:** Encrypted binary blob, encrypted metadata, IVs. Stored as-is to disk (`index.ts:1743`).
- **Server never sees:** Plaintext file contents, filenames, or any metadata.
- **Severity:** INFO — True zero-knowledge attachment storage. Well-implemented.

### F4. Attachment Access Control
- **DM attachments:** Only sender and recipient can download (`index.ts:1776-1782`).
- **Channel attachments:** Only channel members can download (`index.ts:1777-1779`).
- **Unlinked attachments** (message not yet created): Blocked from download (`index.ts:1788`).
- **Path traversal protection:** `abs.startsWith(uploadsDir)` check (`index.ts:1793`).
- **Severity:** INFO — Access control is solid.

---

## G. Channel Key Distribution

### G1. Distribution Mechanism
- **AES-GCM symmetric key** generated per channel (`crypto.ts:376-385`).
- **Per-member ECDH envelope:** Channel key JWK is encrypted with ECDH shared key between channel creator/distributor and each member (`crypto.ts:408-415`).
- **Envelopes stored** in `channel_keys` table (`schema.sql:46-52`), keyed by `(channel_id, user_id)`.

### G2. Key Distribution Flow
1. **Channel creation** (`useChannels.ts:81-136`): Creator generates channel key, encrypts for each member, POSTs to `/api/channels/:id/keys`.
2. **Member addition** (`useChannels.ts:245-279`): Creator distributes key to new member via ECDH envelope.
3. **Key request** (`useChannels.ts:2169-2179`): Online members can respond to `channel:key_request` by distributing the key to the requester.
4. **Proactive distribution** (`useChannels.ts:36-78`): On mount, clients check for members missing key envelopes and distribute proactively.

### G3. ECDH Envelope Per Member
- **Yes.** Each member gets their own envelope encrypted with the ECDH shared key derived from `(my_private, member_public)`.
- **Severity:** INFO — Standard approach. Good.

### G4. Key Rotation on Member Removal
- **Server emits `channel:key_rotated`** when a member is removed (`index.ts:1658`).
- **Client handler** (`useChannels.ts:290-328`): Channel creator generates new symmetric key, distributes to all remaining members.
- **Removed member's envelope is deleted** from `channel_keys` table (`index.ts:2157`).
- **Severity:** MEDIUM — The rotation is best-effort. If the creator is offline, rotation does not happen. There is no guarantee that a removed member cannot read messages sent between removal and rotation. The removed member retains their locally-decrypted channel key cache until they clear it.

### G5. Key Request Flood
- **No rate limiting** on `channel:key:request` socket event.
- **Severity:** LOW — An attacker could spam key requests to all online members. Each member responds with an ECDH derivation + fetch, which is moderately expensive but not catastrophic.

---

## H. Local Persistence

### H1. Atomicity of Crypto State Updates
- **Dexie `put()`** is used for all key and message operations (`db.ts`). Each `put()` is a single atomic write in IndexedDB.
- **No multi-record transactions** are used for crypto state updates. For example, `handleRotateKey` does:
  1. `saveUserKeyPair(newKeyPair)` — single `put` on `keys` table
  2. This is NOT wrapped in a Dexie transaction with other operations.
- **Severity:** MEDIUM — If crash occurs between `saveUserKeyPair` (local) and the server accepting the rotation, the local keypair is updated but the server still has the old key. On reconnect, the server will reject messages signed with the new key's old public key. Recovery requires re-login.

### H2. Crash During Decrypt
- **AES-GCM decrypt is atomic.** No intermediate state is written. Safe.
- **Severity:** INFO

### H3. Dexie Transaction Behavior
- **`saveMessage`** (`db.ts:115-138`): Performs a `get` followed by conditional `put`. These are NOT in a single Dexie transaction. If crash occurs between `get` and `put`, the message may be re-inserted on next load. Since the same message ID is used, this is idempotent.
- **`updateMessageStatus`** (`db.ts:161-184`): Two-step operation (get + conditional put/update). Same idempotency applies.
- **Severity:** LOW — No data corruption risk, but potential for stale status if crash occurs mid-operation. Message content is never lost because the `put` is based on the incoming payload.

### H4. Cache Coherence
- **`sharedKeysCache`** is a module-level `Map` (`crypto.ts:430`). Not persisted. Rebuilt on demand.
- **`channelKeysCache`** is a module-level `Map` (`crypto.ts:431`). Not persisted.
- **Dexie `channelKeys` table** serves as durable cache. On cold start, keys are re-imported from Dexie JWK.
- **Severity:** INFO — Cache is purely for performance; Dexie is the source of truth.

---

## Summary of Findings

| ID | Finding | Severity |
|----|---------|----------|
| B1 | No forward secrecy — static ECDH shared key, single key compromise exposes all past/future messages | **CRITICAL** |
| B2 | No Double Ratchet protocol | **HIGH** |
| D1 | All devices share same private key — no per-device isolation | **HIGH** |
| D2 | No device registration/removal — compromised device cannot be revoked | **HIGH** |
| E3 | Key rotation overwrites old private key — past DMs become undecryptable | **HIGH** |
| A3 | Password + local storage loss = permanent data loss (no social recovery) | **MEDIUM** |
| D3 | Channel key compromise on one device exposes all devices of that user | **MEDIUM** |
| C3 | No replay protection on encrypted messages | **MEDIUM** |
| F2 | Attachments use conversation key, not per-attachment keys | **MEDIUM** |
| G4 | Channel key rotation is best-effort; removed member may retain access during rotation window | **MEDIUM** |
| H1 | Key rotation local+server update not atomic — crash can desync state | **MEDIUM** |
| G5 | No rate limiting on channel key requests | **LOW** |
| H2 | Dexie multi-step operations not transactional (idempotent, no data loss) | **LOW** |
| A4 | First-contact TOFU exchange is unauthenticated (no out-of-band verification) | **LOW** |

---

## Recommendations (Priority Order)

### P0 — Forward Secrecy (CRITICAL)
Implement the Signal Protocol's X3DH key agreement + Double Ratchet. This is the single most impactful improvement. At minimum, implement per-session ephemeral ECDH keys that are rotated after each message, so that long-term key compromise does not expose past messages.

### P1 — Per-Device Keys (HIGH)
Register each device with its own ephemeral identity key. Publish signed prekeys + one-time prekeys to the server. Enable remote device revocation. This is standard in modern E2EE (Signal, WhatsApp, Matrix).

### P2 — Key Rotation Continuity (HIGH)
When rotating keys, preserve old private keys in local storage (encrypted or tagged) for a grace period (e.g., 30 days) to allow dual-key decryption of old messages. Only discard old keys after a re-encryption sweep or explicit expiry.

### P3 — Per-Attachment Keys (MEDIUM)
Generate a random AES-256 key per attachment. Encrypt the attachment with that key. Encrypt the per-attachment key with the conversation key. This limits blast radius and allows conversation key rotation without re-encrypting attachments.

### P4 — Replay Protection (MEDIUM)
Include a message counter or timestamp in the AES-GCM additional authenticated data (AAD). Track seen nonces per peer to reject replays.

### P5 — Channel Rotation Guarantee (MEDIUM)
When a member is removed, force channel key rotation even if the creator is offline. Consider a server-mediated key rotation protocol where the server triggers rotation and coordinates envelope replacement.

### P6 — Atomic Crypto State (MEDIUM)
Wrap key rotation operations (local save + server ack) in a retry/recovery mechanism. If the server rejects the rotation, roll back the local keypair change.
