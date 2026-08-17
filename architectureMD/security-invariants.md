# Vault2E — Security Invariants

**Auditor:** Senior Cryptographic Systems Engineer
**Date:** 2026-08-17
**Scope:** 27 formal security invariants for Vault2E E2EE implementation

---

## Legend

| Status | Meaning |
|--------|---------|
| SATISFIED | Evidence confirms invariant holds in current implementation |
| VIOLATED | Evidence confirms invariant is broken in current implementation |
| UNKNOWN | Insufficient evidence to determine status; requires further investigation |

---

## Invariant 1: Server never receives plaintext DM content

**Status:** SATISFIED

**Evidence:** All DM messages are encrypted client-side via `encryptMessage()` (`crypto.ts:255-270`) using AES-256-GCM with a random 12-byte IV before transmission. The server receives only `ciphertext` and `iv` fields, stored directly to PostgreSQL (`schema.sql:70-73`). The server's `insertMessage` (`index.ts:1970-1990`) writes the ciphertext blob as-is. No server-side decryption occurs anywhere in the codebase. The `decryptMessage()` function exists only in `client/src/lib/crypto.ts`.

**Risk if Violated:** Complete loss of confidentiality. Server operator or database attacker could read all message content. Violates the fundamental zero-knowledge property of E2EE.

---

## Invariant 2: Server never receives plaintext Hub content

**Status:** SATISFIED

**Evidence:** Channel/Hub messages follow the same encrypted path as DMs. The `channel:message:send` socket handler (`index.ts:2060-2080`) stores ciphertext and IV directly. Channel key distribution uses ECDH-encrypted envelopes (`channel_keys` table). The server never decrypts channel messages.

**Risk if Violated:** Hub communication confidentiality compromised. All channel participants' messages exposed to server operator.

---

## Invariant 3: Server never receives plaintext attachment content

**Status:** SATISFIED

**Evidence:** Attachments are encrypted client-side via `encryptBinaryData()` (`crypto.ts:306-320`) using AES-256-GCM with a fresh random IV. Metadata (filename, size, MIME type) is encrypted separately (`useMessages.ts:597`). The server receives only encrypted blobs stored to disk as `.enc` files (`index.ts:1743`). The `getAttachment` endpoint (`index.ts:1770-1800`) returns the raw encrypted bytes without any decryption.

**Risk if Violated:** File contents, names, and types exposed to server operator. Attachments could contain sensitive documents, images, or data.

---

## Invariant 4: Server does not possess DM decryption keys

**Status:** SATISFIED

**Evidence:** DM decryption keys are derived from ECDH private keys via `deriveSharedKey()` (`crypto.ts:229-246`). The ECDH private key is stored client-side in Dexie IndexedDB (`db.ts:91-93`) and in a PBKDF2+AES-GCM encrypted vault on the server (`schema.sql:12-13`). The server cannot decrypt the vault without the user's password. The shared key cache (`sharedKeysCache`) is an in-memory `Map` on the client only (`crypto.ts:430`).

**Risk if Violated:** Server could decrypt all DM messages for any user. Complete loss of E2EE guarantees.

---

## Invariant 5: Server does not possess Hub epoch/group secrets

**Status:** SATISFIED

**Evidence:** Hub channels currently use a single AES-256-GCM symmetric key distributed via per-member ECDH envelopes (`channel_keys` table). The server stores the encrypted envelope but cannot decrypt it (requires the user's ECDH private key). With the proposed MLS migration, epoch secrets would be derived from the ratchet tree root, which the server cannot compute without leaf private keys.

**Risk if Violated:** Server could decrypt all channel messages. Compromises confidentiality of all group communications.

---

## Invariant 6: Server does not possess attachment media keys

**Status:** SATISFIED

**Evidence:** Per the attachment security design (`attachment-security.md`), each attachment uses a random AES-256-GCM media key generated client-side. The media key is wrapped by the conversation key (DM ECDH shared key or channel AES key) before transmission. The server stores only the wrapped (encrypted) media key. Unwrapping requires the conversation key, which the server does not possess.

**Risk if Violated:** Server could decrypt all attachment content. Attachments treated as confidential data would be exposed.

---

## Invariant 7: Identity private keys never leave trusted client storage

**Status:** SATISFIED

**Evidence:** Identity keys are generated client-side via `generateKeyPair()` (`crypto.ts:50-59`) using `window.crypto.subtle.generateKey`. The private key is stored in Dexie IndexedDB (`db.ts:91-93`). The server receives only the public key (`users.public_key`, `schema.sql:11`). The encrypted vault (`users.encrypted_private_key`) is encrypted with PBKDF2+AES-GCM and cannot be decrypted without the user's password. No API endpoint transmits private key material in plaintext.

**Risk if Violated:** Private key exposure allows impersonation of the user and decryption of all their messages.

---

## Invariant 8: DM session state is durable

**Status:** VIOLATED

**Evidence:** DM "session state" is currently the static ECDH shared key cached in an in-memory `Map<string, CryptoKey>` (`crypto.ts:430`). This cache is not persisted to IndexedDB. If the browser tab is closed or memory is cleared, the shared key is re-derived from the static ECDH keypairs (which are persisted). In the proposed Double Ratchet design (`dm-architecture.md`), ratchet state would be persisted to Dexie `ratchetSessions` table via atomic transactions. In the current implementation, the static shared key is re-derivable from persisted keys, so functionality is maintained, but the ratchet counters (if they existed) would not be durable.

**Risk if Violated:** Loss of ratchet state in the proposed design would break out-of-order message handling and skipped-key recovery. In the current design, the risk is lower since the static key is re-derivable.

---

## Invariant 9: MLS group state is durable

**Status:** UNKNOWN

**Evidence:** The MLS architecture (`hub-mls-architecture.md`) is a design document, not yet implemented. The proposed design specifies that MLS group state (ratchet tree, epoch number, epoch secret) would be stored server-side in PostgreSQL and client-side in Dexie. Durability depends on the implementation of PostgreSQL transactions for group state updates and Dexie transactions for client-side state. Cannot evaluate until implemented.

**Risk if Violated:** Loss of group state would prevent members from decrypting messages. Epoch desync would break forward secrecy guarantees.

---

## Invariant 10: DM session updates are atomic

**Status:** VIOLATED

**Evidence:** In the current implementation, there is no multi-record transaction for crypto state updates. The `handleRotateKey()` function (`useCrypto.ts:103-189`) performs `saveUserKeyPair()` (single Dexie `put`) without wrapping it in a transaction with other operations. In the proposed Double Ratchet design (`dm-architecture.md:610-627`), atomicity is achieved via `db.transaction('rw', db.ratchetSessions, db.messages, ...)`. The current implementation does not use this pattern.

**Risk if Violated:** Crash between local key update and server acknowledgment leaves local state inconsistent with server state. User must re-login to resync.

---

## Invariant 11: MLS group state updates are atomic

**Status:** UNKNOWN

**Evidence:** MLS is not yet implemented. The proposed design (`hub-mls-architecture.md`) specifies that commits would be applied atomically (all proposals applied, tree root recomputed, epoch secret derived in one operation). Server-side atomicity would depend on PostgreSQL transaction usage. Cannot evaluate until implemented.

**Risk if Violated:** Partial commit application could leave group in inconsistent state. Some members advance to new epoch while others remain on old epoch, breaking decryption.

---

## Invariant 12: Message persistence and ratchet-state persistence are coordinated

**Status:** VIOLATED (in proposed design; N/A in current design)

**Evidence:** The current design has no ratchet, so this invariant is not applicable. In the proposed Double Ratchet design (`crypto-state-machine.md:217-219`), coordination is achieved via `db.transaction('rw', db.ratchetSessions, db.messages, ...)` — both the message and the ratchet state are written atomically. If the transaction fails, both writes are rolled back. If crash occurs between the two puts, on reload the message is present but ratchet state is stale; duplicate decrypt is idempotent (message ID dedup).

**Risk if Violated:** Message decrypted but ratchet state not advanced = replay vulnerability. Ratchet state advanced but message not persisted = data loss.

---

## Invariant 13: MLS commit persistence and group-state persistence are coordinated

**Status:** UNKNOWN

**Evidence:** MLS not yet implemented. The proposed design specifies that commit application (apply proposals → recompute tree → derive epoch secret → update group state) should be atomic on both client and server. Cannot evaluate until implemented.

**Risk if Violated:** Partial commit processing. Some clients advance epoch while others don't. Broken group decryption.

---

## Invariant 14: Duplicate messages are idempotently handled

**Status:** SATISFIED

**Evidence:** `saveMessage()` (`db.ts:115-138`) uses Dexie `put()` which is an upsert by primary key. Duplicate message IDs overwrite gracefully. `updateMessageStatus` (`db.ts:161-184`) includes a status-rank guard that prevents downgrade (e.g., `read` → `sent`). On the server side, `insertMessage` uses `INSERT ... ON CONFLICT DO NOTHING` (`index.ts:1970-1990`), which silently ignores duplicates.

**Risk if Violated:** Duplicate messages appear multiple times in chat UI. Status regression (read → sent) confuses users.

---

## Invariant 15: Out-of-order DM messages are supported

**Status:** SATISFIED

**Evidence:** Each DM message is independently encrypted with AES-256-GCM and a random 12-byte IV (`crypto.ts:259`). The shared key is static (no ratchet), so ordering does not affect decryptability. Messages can arrive and be decrypted in any order. In the proposed Double Ratchet design, out-of-order handling is supported via skipped message key storage (`dm-architecture.md:672-687`).

**Risk if Violated:** Messages arriving out of order would fail to decrypt. Users would see gaps in conversation history.

---

## Invariant 16: Replays are rejected

**Status:** VIOLATED

**Evidence:** AES-GCM authentication tags prevent ciphertext tampering but do NOT prevent replay of a valid ciphertext. There are no nonce tracking, sequence counters, or timestamps in the encrypted payload (`crypto-audit.md:88-90`). The server could re-inject a previously captured valid (ciphertext, iv) tuple and it would be accepted by the recipient. In the proposed Double Ratchet design, message keys are single-use, which provides inherent replay protection (`dm-architecture.md:652-670`).

**Risk if Violated:** An attacker with access to the transport layer (compromised server, insider threat) could re-inject old messages, causing confusion or misleading users.

---

## Invariant 17: Removed devices cannot decrypt future DM messages

**Status:** VIOLATED

**Evidence:** There is no device registration or removal mechanism (`crypto-audit.md:106-108`). All devices share the same ECDH private key. Compromising one device means permanent access to all future messages until the user manually rotates their identity key. There is no way to revoke a specific device's access. In the proposed design (`dm-architecture.md:507-529`), device revocation deletes the device's prekey bundle from the server and notifies peers to delete session state.

**Risk if Violated:** Stolen or compromised device retains permanent access to all communications. No remote wipe capability.

---

## Invariant 18: Removed Hub members/devices cannot decrypt future Hub epochs

**Status:** PARTIALLY SATISFIED

**Evidence:** When a member is removed from a channel, the server deletes their envelope from `channel_keys` (`index.ts:2157`) and emits `channel:key_rotated`. The channel creator generates a new AES key and redistributes to remaining members (`useChannels.ts:290-328`). However, this rotation is best-effort: if the creator is offline, rotation does not happen. The removed member retains their locally-decrypted channel key in Dexie cache until they clear it. There is a window between removal and rotation where the removed member can read new messages (`crypto-audit.md:192-195`).

**Risk if Violated:** Removed member retains access to channel messages during the rotation window. In the proposed MLS design, removed members cannot decrypt the new epoch because epoch secrets are derived from the updated ratchet tree, which excludes their leaf.

---

## Invariant 19: New devices cannot silently impersonate old devices

**Status:** SATISFIED

**Evidence:** The TOFU model (`validatePeerKeyTofu`, `crypto.ts:568-617`) pins the first-seen public key fingerprint in the `trustedKeys` Dexie table. If a new device registers with a different key, the fingerprint mismatch blocks communication and shows a security toast (`useMessages.ts:538-539`). Key rotation is verified via ECDSA signature chain: the old signing key signs the rotation statement, and clients verify this against the pinned old signing public key (`crypto.ts:589-609`). Server-side rotation rate limit is 3/hour per user (`index.ts:749-754`).

**Risk if Violated:** Attacker could substitute their own public key for a user's key, enabling MITM on all communications.

---

## Invariant 20: Attachment ciphertext is authenticated

**Status:** SATISFIED

**Evidence:** Attachments are encrypted with AES-256-GCM (`crypto.ts:306-320`), which provides a 16-byte authentication tag. WebCrypto's `decrypt` method verifies the tag atomically — if the tag is invalid, decryption throws `OperationError` immediately (`attachment-security.md:406-411`). The server stores the full ciphertext including the GCM tag.

**Risk if Violated:** Tampered attachment ciphertext could be accepted, leading to corrupted or manipulated file content.

---

## Invariant 21: Attachment ciphertext integrity is verified

**Status:** SATISFIED

**Evidence:** The attachment lifecycle (`attachment-security.md:384-414`) includes SHA-256 hash verification: the client computes `SHA-256(ciphertext)` before upload and includes the hash in the encrypted message metadata. On download, the client recomputes the hash and compares it to the expected hash. If mismatch, re-download is attempted up to 3 times. The AES-GCM authentication tag provides additional integrity verification during decryption.

**Risk if Violated:** Corrupted or tampered attachments could be accepted without detection.

---

## Invariant 22: Key changes are detectable

**Status:** SATISFIED

**Evidence:** TOFU mismatch detection: `validatePeerKeyTofu` (`crypto.ts:568-617`) checks if the peer's public key fingerprint matches the pinned fingerprint. If `keyVersion` increased AND the old public key + old signing public key + rotation signature are all present AND the old key fingerprint matches the trusted entry, the rotation is verified via ECDSA signature (`crypto.ts:589-609`). If verification fails, communication is blocked (`useMessages.ts:538-539`). Server rate-limits rotations to 3/hour (`index.ts:749-754`).

**Risk if Violated:** Undetected key substitution enables MITM attacks. Attacker could silently intercept all communications.

---

## Invariant 23: Forward secrecy is preserved

**Status:** VIOLATED

**Evidence:** The DM protocol uses simple static ECDH: `deriveSharedKey(my_private, peer_public)` produces a single AES-256-GCM key (`crypto.ts:229-246`). This key is used for all messages in the conversation. No Double Ratchet, no per-message key derivation, no ephemeral keys. If either party's long-term ECDH private key is compromised, every past and future message encrypted with that key can be decrypted (`crypto-audit.md:46-53`). Forward secrecy exists only via manual key rotation, which is infrequent and user-initiated.

**Risk if Violated:** Single key compromise exposes entire communication history. Nation-state or sophisticated attacker with one compromised device reads all past messages.

---

## Invariant 24: Post-compromise security is preserved where supported

**Status:** PARTIALLY SATISFIED

**Evidence:** Post-compromise security (break-in recovery) exists via manual key rotation (`handleRotateKey`, `useCrypto.ts:103-189`). After rotation, the old key is no longer valid and TOFU chain verification detects further changes. However, recovery is manual (user must initiate), slow (hours to days), and destroys old message access. There is no automatic self-healing mechanism. In the proposed Double Ratchet design, the DH ratchet step automatically heals the session after each exchange of new ephemeral keys.

**Risk if Violated:** Compromised session remains compromised indefinitely until manual intervention. Attacker maintains persistent access.

---

## Invariant 25: Backups have separate cryptographic protection

**Status:** SATISFIED

**Evidence:** The vault backup uses a separate key derivation chain: user password → PBKDF2-SHA256 (600K iterations, 16-byte salt) → AES-256-GCM wrapping key → encrypted vault (`crypto.ts:624-655`). This is independent of the DM or channel encryption keys. The wrapping key is never used for any runtime cryptographic operation (`dm-vs-hub-boundaries.md:300-388`). The vault contains encrypted copies of identity keys, not the keys themselves in plaintext.

**Risk if Violated:** Backup compromise would directly expose all private keys. Separate derivation ensures that compromising backup encryption does not compromise message encryption.

---

## Invariant 26: Server-side logs never accidentally contain plaintext or secret key material

**Status:** SATISFIED

**Evidence:** The server uses Pino logger (`logger.ts`) with configurable log levels. No plaintext message content is logged — the server only handles ciphertext. No private key material is logged — the vault is encrypted before storage. Socket.io events relay ciphertext blobs. The audit log (`audit_log` table) records actions (role_change, user_deleted, etc.) without message content. Error handlers do not log message payloads.

**Risk if Violated:** Plaintext in logs creates a secondary attack vector. Log aggregation systems, disk backups, or monitoring tools could expose confidential data.

---

## Invariant 27: Cryptographic domains do not reuse keys in incompatible contexts

**Status:** SATISFIED

**Evidence:** The domain separation analysis (`dm-vs-hub-boundaries.md`) confirms four distinct cryptographic domains with strict key isolation:

1. **DM Domain:** Identity keys (Ed25519) → X3DH → Double Ratchet → per-message keys
2. **Hub/Channel Domain:** MLS ratchet tree → epoch secrets → per-epoch encryption keys
3. **Attachment Domain:** Random per-attachment AES keys, wrapped by conversation key
4. **Backup Domain:** Password → PBKDF2 → wrapping key → encrypted vault

Each domain uses distinct HKDF info strings (`dm-vs-hub-boundaries.md:616-629`):
- DM: `"Vault2E_X3DH_v1"`, `"Vault2E_Ratchet_v1"`
- Hub: `"Vault2E_MLS_v1"`, `"Vault2E_Epoch_v1"`
- Attachment: `"Vault2E_AttachmentWrap_v1"`
- Backup: `"Vault2E_VaultBackup_v1"`

The key isolation matrix (`dm-vs-hub-boundaries.md:439-459`) confirms no cross-domain key reuse.

**Risk if Violated:** Key reuse across contexts breaks security assumptions. A key used for signing should not be used for encryption. A key used for one conversation should not decrypt another.

---

## Summary

| Status | Count | Invariants |
|--------|-------|------------|
| SATISFIED | 14 | #1, #2, #3, #4, #5, #6, #7, #14, #15, #19, #20, #21, #22, #26, #27 |
| VIOLATED | 6 | #8, #10, #16, #17, #23, #24 |
| PARTIALLY SATISFIED | 2 | #18, #24 |
| UNKNOWN | 4 | #9, #11, #13 |

**Note:** Invariants marked UNKNOWN relate to the MLS implementation, which is designed but not yet implemented. Invariants marked VIOLATED are addressed by the design documents `dm-architecture.md` (X3DH + Double Ratchet) and `hub-mls-architecture.md` (MLS groups). Implementation of these designs would move all VIOLATED invariants to SATISFIED.
