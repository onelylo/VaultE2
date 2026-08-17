# Vault2E vs Signal/WhatsApp Protocol Cross-Check

**Auditor:** Senior Security Architect  
**Date:** 2026-08-17  
**Scope:** Vault2E (VaultChat Enterprise) E2EE implementation compared against Signal Protocol and WhatsApp public documentation (Signal Protocol White Paper, WhatsApp E2E FAQ, X3DH specification, Double Ratchet specification).

---

## 1. Identity Keys

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Per-account identity key | ECDH P-256 keypair, one per account, generated client-side at registration (`crypto.ts:50-59`) | ECDH X25519 identity keypair, one per device (Signal); one per device (WhatsApp) | **Vault2E uses per-account, not per-device.** All devices share the same private key. | HIGH | Generate a separate identity keypair per device. Register each device independently. |
| Separate signing key | ECDSA P-256 signing keypair for key rotation proofs (`crypto.ts:98-104`) | Identity key signs SignedPreKeys and prekey bundles | **Vault2E signing key used only for rotation, not for prekey signing.** | LOW | Signing key should sign prekey bundles (if prekeys are adopted). |
| Key persistence | Private key in Dexie IndexedDB (JWK) + server-encrypted vault (PBKDF2+AES-GCM) | Private key stored locally on device only; never on server (Signal). WhatsApp backs up via iCloud/Google E2EE backup. | **Vault2E stores encrypted private key on server.** Signal explicitly avoids this. WhatsApp offers E2E encrypted backups as opt-in. | MEDIUM | Consider E2E backup as opt-in rather than always-on server vault. Or adopt Signal's approach: no server-side private key storage. |

## 2. Session Establishment

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Key agreement protocol | Simple static ECDH: `deriveSharedKey(my_priv, peer_pub)` -> AES-256-GCM key (`crypto.ts:229-246`) | X3DH (Extended Triple Diffie-Hellman): identity key + signed prekey + one-time prekey + ephemeral key | **Missing X3DH.** No ephemeral keys, no prekeys, no async session setup. | CRITICAL | Implement X3DH: generate signed prekeys + one-time prekeys; publish to server; fetch peer's prekey bundle before first message. |
| Asynchronous session setup | Not supported. Both parties must be online to exchange public keys via directory API / socket `user:join` event. | X3DH allows sender to initiate session while recipient is offline (prekey bundle fetched from server). | **Cannot initiate encrypted conversation while peer is offline.** | HIGH | Adopt prekey bundles so first message can be sent asynchronously. |
| Initial shared secret | `ECDH(static_priv, static_pub)` — single DH operation | `X3DH(IKa, SPKb, OTKb, EKa)` — four DH operations combined via HKDF | **No key stretching, no ephemeral contribution, no binding.** | CRITICAL | Replace with X3DH or equivalent (e.g., MLS key schedule). |

## 3. Prekeys / One-Time Prekeys

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Signed prekeys | Not implemented | Each device publishes a signed prekey to the server. Rotated periodically. Signed by identity key. | **Missing entirely.** | HIGH | Implement signed prekey generation, server storage, and periodic rotation. |
| One-time prekeys (OPKs) | Not implemented | Batch of one-time prekeys published to server. Consumed on use. Resupplied as pool depletes. | **Missing entirely.** | HIGH | Implement OPK generation, batch upload, consumption, and resupply logic. |
| Prekey bundle retrieval | Not applicable | Client fetches peer's prekey bundle (IK + SPK + OPK + signature) from server before X3DH. | **Missing.** | HIGH | Add prekey bundle API endpoint and client fetch logic. |
| Prekey resupply | Not applicable | Client monitors OPK pool depth and uploads new batches. | **Missing.** | MEDIUM | Implement OPK pool monitoring and automatic resupply. |

## 4. Double Ratchet

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Symmetric-key ratchet | Not implemented | Chain key ratchets forward with each message (CK -> MK + new CK). | **Missing.** | CRITICAL | Implement chain key ratchet: derive per-message message key from chain key, advance chain key. |
| Diffie-Hellman ratchet | Not implemented | New ephemeral ECDH keypair per ratchet step. DH output feeds into chain key. | **Missing.** | CRITICAL | Implement DH ratchet: generate new ephemeral keypair, perform DH with peer's current public key, mix into root key. |
| Root key evolution | Not implemented | Root key updated by DH ratchet output and chain key derivation via HKDF. | **Missing.** | CRITICAL | Implement HKDF-based root key schedule. |
| Message keys | Not implemented | Per-message symmetric key derived from chain key. Used once for AES-256-CBC + HMAC-SHA256 (Signal) or AES-256-GCM (WhatsApp). | **Vault2E uses static shared key directly for AES-256-GCM.** No per-message key derivation. | CRITICAL | Derive a unique message key per message from the chain key. Never reuse the shared key directly. |
| Skipped message keys | Not implemented | Receiver stores skipped message keys indexed by (ratchet pubkey, message number) for out-of-order delivery. Bounded storage (e.g., 1000 keys). | **Missing.** | HIGH | Implement skipped message key storage with a bounded cache and purging strategy. |

## 5. Forward Secrecy

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Per-message forward secrecy | Not implemented. Single static ECDH shared key used for all messages in a conversation. | Every message encrypted with a unique message key derived from the ratchet. Compromise of current chain key does not expose past messages. | **CRITICAL gap.** Compromise of the static ECDH private key exposes ALL past and future messages. | CRITICAL | Implement Double Ratchet so each message key is ephemeral. Even if chain key is compromised, past message keys are not recoverable (due to one-way chain). |
| Key rotation forward secrecy | Manual key rotation via `handleRotateKey()` (`useCrypto.ts:103-189`). Old private key is overwritten. ECDSA-signed rotation. | Automatic key rotation via DH ratchet. No manual intervention needed. | **Vault2E relies on manual rotation.** Rotation is infrequent and user-initiated. Between rotations, all messages share the same key. | HIGH | Replace manual rotation with automatic DH ratchet. Manual rotation can remain as a user-triggered emergency measure. |
| Post-rotation old message access | Old private key is overwritten at `useCrypto.ts:173`. Past messages become undecryptable if cache is cleared. | Old message keys are stored per-message. Rotation does not affect past messages. | **Vault2E loses old message access after rotation.** | HIGH | Preserve old private keys for a grace period, or use the Double Ratchet model where past message keys are independently stored. |

## 6. Post-Compromise Security (Break-in Recovery)

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Self-healing sessions | Not implemented. The static shared key remains compromised until the user manually rotates keys. | DH ratchet continuously rotates ephemeral keys. After the compromised party generates a new ephemeral key, the session heals. | **No self-healing.** Compromise persists indefinitely until manual rotation. | CRITICAL | Implement DH ratchet. After compromise, the next DH ratchet step with a new ephemeral key restores security. |
| Automatic recovery | Not applicable | Happens automatically with each DH ratchet step (every few messages). | **Missing.** | HIGH | Implement automatic DH ratchet. |
| Recovery time | Depends on user manually triggering rotation (hours to never). | One DH ratchet step (next message from either party). | **Recovery is manual and slow.** | HIGH | Automatic recovery via DH ratchet. |

## 7. Out-of-Order Delivery

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Message ordering tolerance | Each message is independently encrypted with AES-256-GCM + random IV (`crypto.ts:259`). No sequence numbers. Decryptable in any order. | Double Ratchet handles out-of-order via skipped message keys. Messages carry ratchet public key + message number. | **Vault2E tolerates out-of-order at the crypto layer** (random IV per message), but has no mechanism to handle ratchet state desync. | LOW (current model) / HIGH (if ratchet is added) | If Double Ratchet is implemented, add skipped message key storage. Current model is fine without ratchet. |
| Server message ordering | Server stores messages with `created_at` timestamp, serves in order. Socket relay is real-time. | Signal server does not order messages. Client handles ordering. | **Vault2E server orders messages.** This is fine for now but would need rethinking with a ratchet. | INFO | No change needed in current model. |

## 8. Replay Protection

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Ciphertext replay | No protection. AES-GCM prevents tampering but not replay. No nonce tracking, no sequence counters. | Double Ratchet message keys are single-use. Replayed message would use a consumed key. | **Missing.** A captured valid ciphertext could be re-injected. | MEDIUM | Add message counter in AES-GCM AAD. Track seen counters per peer. Or rely on Double Ratchet message keys (single-use). |
| Transport-layer replay | TLS provides some transport protection. Socket.io has no built-in replay protection. | Signal uses TLS + padding + Sealed Sender. | **Vault2E relies solely on TLS.** | LOW | Add application-layer replay protection (nonce/counter in AAD). |

## 9. Multi-Device

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Per-device identity | Not implemented. All devices share the same ECDH private key recovered from vault. | Signal: each device has its own identity keypair. WhatsApp: linked devices share account key but have per-device sessions. | **No device isolation.** Compromise of one device = compromise of all devices. | CRITICAL | Generate per-device identity keys. Register each device separately. |
| Per-device sessions | Not implemented. All devices use the same shared key. | Signal: each device pair has its own Double Ratchet session. | **No per-device session isolation.** | HIGH | Implement per-device sessions. Each device pair should have its own ratchet state. |
| Simultaneous messaging | All devices receive the same message (broadcast via socket). Decrypted with the same key. | Signal: messages are sent to each device separately (via Signal Server). | **Vault2E broadcasts to all sockets of a user.** This is simpler but less secure. | MEDIUM | Consider per-device message delivery with per-device keys. |

## 10. Device Linking / Revocation

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Device registration | Not implemented. No device tracking on server. Server tracks socket connections per user (`activeUsers: Map<userId, Map<socketId, ActiveUser>>`). | Signal: device linked via QR code scan. WhatsApp: device linked via QR code / phone number verification. | **No device identity model.** | HIGH | Implement device registration with unique device keys and server-side device tracking. |
| Remote device revocation | Not implemented. Cannot revoke a specific device. `admin/revoke-keys` revokes ALL keys. | Signal: remove linked device remotely. WhatsApp: log out linked device remotely. | **No remote device revocation.** Compromised device cannot be isolated. | CRITICAL | Implement remote device revocation: delete device key from server, trigger re-keying on remaining devices. |
| Device listing | Not implemented. User cannot see which devices are logged in. | Signal: settings show linked devices. WhatsApp: settings show linked devices with last active time. | **No device visibility.** | MEDIUM | Add device listing endpoint and UI. |

## 11. Key Rotation

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Rotation mechanism | Manual: `handleRotateKey()` generates new ECDH + ECDSA pairs, signs rotation with old ECDSA key, uploads to server (`useCrypto.ts:103-189`). | Automatic: DH ratchet rotates keys every few messages. Identity key rotation is a separate, rare operation. | **Vault2E rotation is manual and infrequent.** Signal rotation is automatic and continuous. | HIGH | Add automatic key rotation via DH ratchet. Manual rotation remains as emergency action. |
| Rotation propagation | Server broadcasts `user:key_rotated` to online contacts. Offline contacts discover rotation via TOFU chain on next contact. | Signal: rotation is implicit in the ratchet. No broadcast needed. | **Vault2E requires explicit broadcast.** Offline contacts may miss rotation. | MEDIUM | Ratchet-based rotation is implicit. No broadcast needed. |
| Rotation rate limiting | Server: 3 rotations/hour per user (`index.ts:749-754`). | Signal: no explicit rate limit on ratchet (it's automatic). Identity key rotation is rare. | **Vault2E rate limit is appropriate for manual rotation.** | INFO | No change needed. |
| Old message accessibility after rotation | Old private key overwritten. Past DMs become undecryptable. | Old message keys stored per-message. Rotation does not affect past messages. | **Vault2E loses past messages after rotation.** | HIGH | Preserve old keys for a grace period, or use ratchet model where past keys are stored per-message. |

## 12. Attachment Encryption

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Per-message key for attachments | Not implemented. Attachments use the same DM/channel shared key as messages (`crypto.ts:306-320`). | Signal: each attachment encrypted with a random AES key, which is encrypted with the message key. WhatsApp: similar per-attachment key. | **Vault2E reuses the conversation key for all attachments.** Compromising the conversation key exposes all attachments. | MEDIUM | Generate a random AES-256 key per attachment. Encrypt attachment with that key. Encrypt the per-attachment key with the message/conversation key. |
| Metadata encryption | Encrypted separately with AES-256-GCM using the same shared key (`useMessages.ts:597`). | Signal: attachment metadata encrypted with message key. | **Vault2E metadata encryption is similar to Signal.** | INFO | No change needed. |
| Thumbnail encryption | Thumbnail stored in encrypted metadata blob. | Signal: thumbnails encrypted with message key. | **Vault2E thumbnail handling is consistent.** | INFO | No change needed. |

## 13. Backup Encryption

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Encrypted backup | Server-stored vault: PBKDF2(600K iterations, SHA-256) -> AES-256-GCM wrapping of private key JWK. | Signal: no cloud backup (local only, or Signal PIN-based registration lock). WhatsApp: E2E encrypted backup to iCloud/Google Drive (opt-in, uses a random key wrapped by user passphrase or 64-digit key). | **Vault2E always stores encrypted vault on server.** Signal avoids server-side key storage. WhatsApp makes it opt-in. | MEDIUM | Consider making server vault opt-in. Or adopt Signal's approach: no server-side private key storage, rely on local-only storage. |
| Backup key derivation | PBKDF2-SHA256, 600K iterations, 16-byte salt (`crypto.ts:624-655`). | WhatsApp: Argon2 or PBKDF2 for backup key derivation. Signal: no cloud backup. | **Vault2E PBKDF2 600K is reasonable.** Industry recommends 600K+ for PBKDF2-SHA256. | INFO | No change needed on iteration count. Consider Argon2id for better GPU/ASIC resistance. |
| Backup recovery | Decrypt vault with password -> recover private keys. | WhatsApp: decrypt backup with passphrase -> recover message history. Signal: re-register with phone number + PIN. | **Vault2E recovery is password-based.** If password is forgotten AND local storage is cleared, all data is lost. | MEDIUM | Consider social recovery, multi-device recovery, or recovery codes. |

## 14. Safety Numbers / Key Verification

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Safety number generation | Fingerprint: 30-char hex from SHA-256 of public key (`getFingerprint` in `crypto.ts`). Full SHA-256 hex also available (`computePublicKeyFingerprint`). | Signal: 60-digit number (or QR code) derived from both parties' identity keys via fingerprint generation. Compares both directions. WhatsApp: security code based on both parties' keys. | **Vault2E fingerprint is one-directional** (hash of one party's key). Signal's safety number is a mutual fingerprint (both parties' keys combined). | MEDIUM | Generate mutual safety numbers: hash(AB) where A = my identity key, B = peer's identity key. Display QR code for out-of-band verification. |
| QR code verification | Not implemented. | Signal: QR code scan for in-person verification. WhatsApp: QR code / 60-digit number comparison. | **Missing.** No visual verification mechanism. | MEDIUM | Implement QR code generation and scanning for mutual safety number verification. |
| Out-of-band verification | Manual fingerprint comparison only (`compareFingerprints` in `crypto.ts`). | Signal: QR code scan or safety number comparison via separate channel (phone call, in-person). | **Vault2E has no structured out-of-band verification.** | MEDIUM | Add QR code scanning and visual safety number comparison UI. |
| Key change notification | TOFU mismatch blocks communication and shows toast (`useMessages.ts:538-539`). | Signal: "Changed safety number" notification with option to verify or accept. WhatsApp: similar notification. | **Vault2E blocks on mismatch (more restrictive).** Signal allows the user to accept after verification. | LOW | Consider allowing the user to accept a changed key after explicit verification, rather than hard-blocking. |

## 15. Server Knowledge / Metadata

| Feature | Vault2E | Signal/WhatsApp | Gap | Risk | Required Change |
|---------|---------|-----------------|-----|------|-----------------|
| Message content | Server never sees plaintext. All messages are AES-256-GCM encrypted client-side. | Signal: server never sees plaintext. WhatsApp: server never sees plaintext. | **Vault2E matches Signal/WhatsApp on content encryption.** | INFO | No change needed. |
| Sender/recipient IDs | Server stores `sender_id` and `recipient_id` in plaintext in the `messages` table. | Signal: uses Sealed Sender (sender identity encrypted). WhatsApp: server sees sender/recipient. | **Vault2E exposes sender/recipient to server.** Signal hides this via Sealed Sender. | MEDIUM | Implement Sealed Sender or equivalent: encrypt sender identity so server cannot correlate messages with users. |
| Message timestamps | Server stores `created_at` as BigInt. | Signal: server sees timestamps. WhatsApp: server sees timestamps. | **Vault2E matches.** Timestamps are visible to server. | INFO | Consider padding timestamps to reduce timing metadata. |
| Ciphertext length | Server stores full ciphertext. Length reveals approximate plaintext length. | Signal: pads messages to fixed sizes. WhatsApp: pads to reduce length analysis. | **Vault2E does not pad messages.** Ciphertext length leaks plaintext length. | LOW | Pad messages to fixed blocks (e.g., nearest 256 bytes) before encryption. |
| Online/offline status | Server broadcasts presence (`user:online`, `user:status_change`). | Signal: server sees online status. WhatsApp: server sees online status. | **Vault2E matches.** Presence is visible to server. | INFO | Consider hiding presence from server if needed (rarely done in practice). |
| Message count / frequency | Server can observe message frequency and volume per user. | Signal: minimal metadata retention. WhatsApp: retains some metadata. | **Vault2E stores all messages server-side.** Server can observe communication patterns. | MEDIUM | Consider message expiration, reduced retention, or metadata protection techniques. |
| Group membership | Server stores `channel_members` and `hub_members` tables. | Signal: server sees group membership. WhatsApp: server sees group membership. | **Vault2E matches.** | INFO | No change needed. |
| Device IP / connection info | Not explicitly logged in schema. Socket.io may expose IP. | Signal: minimizes IP logging. WhatsApp: retains IP logs. | **Vault2E does not explicitly log IPs.** | INFO | Consider IP anonymization or minimal retention. |

---

## Summary Table

| Category | Vault2E Status | Signal/WhatsApp Parity | Priority |
|----------|----------------|------------------------|----------|
| Identity Keys | Per-account (not per-device) | Per-device | P1 |
| Session Establishment | Simple static ECDH | X3DH | P0 |
| Prekeys | Not implemented | Full prekey system | P0 |
| Double Ratchet | Not implemented | Full implementation | P0 |
| Forward Secrecy | Manual rotation only | Automatic per-message | P0 |
| Post-Compromise Security | Manual rotation only | Automatic DH ratchet | P0 |
| Out-of-Order Delivery | Tolerated (random IV) | Handled by skipped keys | P2 (if ratchet added) |
| Replay Protection | None | Inherent in ratchet | P1 |
| Multi-Device | Single key, all devices | Per-device keys + sessions | P0 |
| Device Linking/Revocation | Not implemented | Full device management | P0 |
| Key Rotation | Manual, infrequent | Automatic, continuous | P1 |
| Attachment Encryption | Conversation key reused | Per-attachment random key | P1 |
| Backup Encryption | Server-stored vault (always) | Opt-in E2E backup / local only | P2 |
| Safety Numbers | One-directional fingerprint | Mutual fingerprint + QR | P2 |
| Server Metadata | Sender/recipient visible | Sealed Sender (Signal) | P2 |

---

## Critical Gaps (P0)

1. **No X3DH** — Cannot do asynchronous session setup, no forward secrecy from ephemeral keys.
2. **No Double Ratchet** — No per-message forward secrecy, no break-in recovery.
3. **No per-device identity** — Single key compromise exposes all devices.
4. **No device revocation** — Compromised device cannot be remotely disabled.
5. **No prekey system** — Both parties must be online for session establishment.

## High Gaps (P1)

6. **Manual key rotation only** — No automatic forward secrecy recovery.
7. **No replay protection** — Application layer has no nonce/counter tracking.
8. **Conversation key reused for attachments** — No per-attachment isolation.
9. **Old messages lost after rotation** — Old private key overwritten.
10. **Sender/recipient IDs visible to server** — No Sealed Sender equivalent.
