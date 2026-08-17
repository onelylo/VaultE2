# Vault2E — DM Cryptographic State Machine

**Author:** Senior Distributed Systems Engineer
**Date:** 2026-08-17
**Scope:** Deterministic state machine for per-device DM session lifecycle
**Basis:** X3DH key agreement + Double Ratchet protocol (dm-architecture.md)

---

## 1. State Definitions

| State | Description | Stored In |
|-------|-------------|-----------|
| `NEW_DEVICE` | Device created, no keys yet | — |
| `REGISTER_IDENTITY` | Generating IK, SPK, OPK pool; vault created | Dexie `deviceKeys` + server `users` |
| `PUBLISH_PREKEYS` | Uploading prekey bundle to server | Server `device_prekeys` |
| `SESSION_PENDING` | First message initiated; prekey bundle fetched | Client memory |
| `SESSION_ESTABLISHED` | X3DH completed; RK and initial CK derived | Dexie `ratchetSessions` |
| `ACTIVE` | Normal bidirectional messaging | Dexie `ratchetSessions` + `messages` |
| `RATCHETING` | DH ratchet step in progress (new ratchet public key received) | Client memory → Dexie |
| `MESSAGE_RECEIVED` | Decryption in progress; MK derived from chain | Client memory |
| `STATE_COMMITTED` | Ratchet state persisted to Dexie after decrypt | Dexie `ratchetSessions` |
| `ACKED` | Server acknowledged message receipt | Client memory |
| `OUT_OF_ORDER` | Message counter > expected; awaiting skipped keys | Client memory (skipped_keys) |
| `DUPLICATE` | Message ID already in Dexie (upsert idempotent) | Dexie `messages` |
| `REPLAY` | Same message key (ratchet_pub, n) consumed twice | Client memory |
| `SESSION_RESET` | Identity key change detected; session must restart | — |
| `IDENTITY_CHANGED` | Peer's IK fingerprint mismatch from TOFU store | Dexie `trustedKeys` |
| `DEVICE_REVOKED` | Peer device removed from account | Server notifies all peers |
| `DEVICE_REINSTALLED` | New device replacing old (same IK, new SPK/OPKs) | — |
| `BACKUP_RESTORED` | Vault restored from password-encrypted backup | Dexie `deviceKeys` |
| `DECRYPTION_FAILURE` | AES-GCM authentication tag invalid or key missing | Client memory |

---

## 2. State Transition Diagram

```
                                    ┌──────────────┐
                                    │  NEW_DEVICE  │
                                    └──────┬───────┘
                                           │
                              registerIdentity()
                                           │
                                           ▼
                              ┌─────────────────────┐
                              │ REGISTER_IDENTITY    │
                              │ • Generate IK (Ed25519)
                              │ • Generate SPK (X25519)
                              │ • Sign SPK with IK
                              │ • Generate 100 OPKs
                              │ • Encrypt vault (PBKDF2+AES-GCM)
                              └──────────┬──────────┘
                                         │
                                publishPrekeys()
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │ PUBLISH_PREKEYS      │
                              │ • POST /api/prekeys  │
                              │ • Server stores bundle│
                              └──────────┬──────────┘
                                         │
                              ┌──────────┴──────────┐
                              │                     │
                       [Initiator]             [Responder]
                       sendFirstMsg()          waitForMsg()
                              │                     │
                              ▼                     ▼
                   ┌──────────────────┐  ┌──────────────────┐
                   │ SESSION_PENDING   │  │ SESSION_PENDING   │
                   │ • Fetch peer bundle│  │ • Wait on socket  │
                   │ • Verify SPK_sig  │  │                    │
                   └────────┬─────────┘  └────────┬─────────┘
                            │                      │
                   computeX3dh()          receiveX3dhMsg()
                            │                      │
                            ▼                      ▼
                   ┌──────────────────┐  ┌──────────────────┐
                   │ SESSION_ESTABLISHED│ │ SESSION_ESTABLISHED│
                   │ • RK derived     │  │ • RK derived      │
                   │ • CK_s initialized│  │ • CK_r initialized│
                   └────────┬─────────┘  └────────┬─────────┘
                            │                      │
                         send()                receive()
                            │                      │
                            └──────────┬───────────┘
                                       │
                                       ▼
                              ┌────────────────┐
                              │    ACTIVE       │◄─────────────────────┐
                              │ • Sending chain │                      │
                              │ • Receiving chain│                     │
                              └───┬────────┬───┘                      │
                                  │        │                           │
                         send(msg)│        │receive(msg)               │
                                  │        │                           │
                                  ▼        ▼                           │
                         ┌────────────┐  ┌────────────────┐           │
                         │ RATCHETING │  │ MESSAGE_RECEIVED│           │
                         │ (send side)│  │ • Derive MK     │           │
                         └─────┬──────┘  │ • Verify GCM tag│           │
                               │         └────────┬───────┘           │
                          persist()               │                    │
                               │          ┌───────┴────────┐          │
                               │          │                │          │
                               │     [n==expected]   [n>expected]     │
                               │          │                │          │
                               │          │          ┌─────▼──────┐   │
                               │          │          │ OUT_OF_ORDER│   │
                               │          │          │ • Store msg │   │
                               │          │          │ • Save MK   │   │
                               │          │          │   to skipped│   │
                               │          │          └─────┬──────┘   │
                               │          │                │          │
                               │          │     [later: n==expected]  │
                               │          │                │          │
                               ▼          ▼                ▼          │
                        ┌───────────────────────┐                    │
                        │   STATE_COMMITTED      │                    │
                        │ • Dexie ratchetSessions│                    │
                        │   updated atomically   │                    │
                        │ • Dexie messages.put() │                    │
                        └───────────┬───────────┘                    │
                                    │                                 │
                               send/receive                           │
                                    │                                 │
                                    ▼                                 │
                        ┌───────────────────────┐                    │
                        │       ACKED            │                    │
                        │ • Server ACK received  │                    │
                        │ • status = delivered   │────────────────────┘
                        └───────────────────────┘
```

---

## 3. Transition Specifications

### 3.1 NEW_DEVICE → REGISTER_IDENTITY

| Field | Value |
|-------|-------|
| **Trigger** | User completes registration or logs in on new device; vault not found |
| **Persistence** | Dexie `deviceKeys.put({device_id, ik_jwk, spk_jwk, spk_sig, opk_pool})` |
| **Failure** | WebCrypto `generateKey` fails → retry up to 3x with backoff. If vault exists, decrypt instead (`BACKUP_RESTORED` path). |
| **Atomicity** | Single Dexie `put()` — IndexedDB guarantees atomic writes per record. If crash occurs mid-generation, incomplete keys are never persisted. |

### 3.2 REGISTER_IDENTITY → PUBLISH_PREKEYS

| Field | Value |
|-------|-------|
| **Trigger** | Identity keys successfully generated and stored locally |
| **Persistence** | POST `/api/prekeys` → server stores `device_prekeys` row (IK, SPK, SPK_sig, OPKs) |
| **Failure** | HTTP 5xx or network failure → queue for retry with exponential backoff (1s, 2s, 4s, max 30s). Client remains in `REGISTER_IDENTITY` state until publish succeeds. |
| **Atomicity** | Server transaction: `INSERT INTO device_prekeys` for all OPKs + SPK in one transaction. If partial failure, all rolls back. Client retries. |

### 3.3 PUBLISH_PREKEYS → SESSION_PENDING

| Field | Value |
|-------|-------|
| **Trigger** | Server returns 201 Created; or user decides to send first message |
| **Persistence** | None (ephemeral state in client memory) |
| **Failure** | N/A — this is a decision point, not an I/O operation |
| **Atomicity** | N/A |

### 3.4 SESSION_PENDING → SESSION_ESTABLISHED (Initiator)

| Field | Value |
|-------|-------|
| **Trigger** | Initiator fetches responder's prekey bundle, verifies SPK_sig, performs X3DH |
| **Persistence** | Dexie `ratchetSessions.put({session_id, peer_id, peer_device, rk, ck_s, ck_r, n_s, n_r, pn, dhr_s, dhr_r, skipped_keys})` |
| **Failure** | (a) Prekey bundle fetch fails → retry 3x. (b) SPK_sig invalid → abort, report `IDENTITY_CHANGED`. (c) X3DH computation fails (WebCrypto error) → abort session. (d) OPK consumed but not deleted server-side → server deletes on next access. |
| **Atomicity** | Dexie transaction wrapping `ratchetSessions.put()`. X3DH is pure computation with no partial persistence. |

### 3.5 SESSION_PENDING → SESSION_ESTABLISHED (Responder)

| Field | Value |
|-------|-------|
| **Trigger** | Responder receives X3DH initial message via socket |
| **Persistence** | Same as 3.4. Additionally, server deletes consumed OPK (`DELETE FROM device_prekeys WHERE opk_id = $1`). |
| **Failure** | If DH computation fails → reject message, log `DECRYPTION_FAILURE`. If OPK deletion fails server-side, no impact (OPK is single-use by design). |
| **Atomicity** | Server: OPK deletion is best-effort. Responder ratchet state: single Dexie `put()`. |

### 3.6 SESSION_ESTABLISHED ↔ ACTIVE

| Field | Value |
|-------|-------|
| **Trigger** | First successful encrypt (sender) or decrypt (receiver) |
| **Persistence** | Ratchet state already persisted in 3.4/3.5 |
| **Failure** | N/A — state transition is a logical marker |
| **Atomicity** | N/A |

### 3.7 ACTIVE → RATCHETING (Sending)

| Field | Value |
|-------|-------|
| **Trigger** | Sender has no new ratchet key from peer; advances sending chain |
| **Persistence** | In-memory only during computation. CK_s and n_s updated. |
| **Failure** | HMAC computation fails → abort, keep prior state. |
| **Atomicity** | Single-threaded computation, no persistence yet. |

### 3.8 ACTIVE → MESSAGE_RECEIVED

| Field | Value |
|-------|-------|
| **Trigger** | Socket receives `message:receive` event with encrypted payload |
| **Persistence** | Derive MK from CK_r (or retrieve from skipped_keys if out-of-order). Attempt AES-256-GCM decrypt. |
| **Failure** | (a) GCM tag invalid → `DECRYPTION_FAILURE`. (b) MK not found in skipped_keys → `REPLAY` (message key already consumed). (c) Peer ratchet key unknown → initiate DH ratchet step. |
| **Atomicity** | Decryption is pure computation. No persistence until STATE_COMMITTED. |

### 3.9 MESSAGE_RECEIVED → STATE_COMMITTED

| Field | Value |
|-------|-------|
| **Trigger** | Successful decryption; ratchet state must be persisted |
| **Persistence** | **Atomic Dexie transaction:** `db.transaction('rw', db.ratchetSessions, db.messages, async () => { put(message); put(ratchetState); })` |
| **Failure** | Dexie write fails → retry. If crash after message put but before ratchet put, on reload: message is present but ratchet state is stale. Duplicate decrypt is idempotent (message ID dedup). |
| **Atomicity** | **Critical:** Both writes succeed or both fail. Dexie transaction guarantees this. If crash occurs between puts, recovery rule applies (see §6). |

### 3.10 STATE_COMMITTED → ACKED

| Field | Value |
|-------|-------|
| **Trigger** | Server acknowledges receipt (implicit via message persist, or explicit `message:delivered` ACK) |
| **Persistence** | Client marks local message status as `delivered` (Dexie upsert, idempotent). Server already has message. |
| **Failure** | ACK lost in transit → on reconnect, server redelivers undelivered messages from `getUndeliveredMessages()`. Client's Dexie upsert with same message ID overwrites gracefully. |
| **Atomicity** | Status update is a single Dexie `put()` with status-rank guard (no downgrade). |

### 3.11 MESSAGE_RECEIVED → OUT_OF_ORDER

| Field | Value |
|-------|-------|
| **Trigger** | Received message counter `n` > expected `n_r` |
| **Persistence** | Store message in skipped_keys buffer: `Map<(ratchet_pub, n), MK>`. Message itself stored in Dexie `messages` (idempotent put). |
| **Failure** | Skipped key buffer exceeds 1000 entries → purge oldest. Risk: messages using purged keys become undecryptable. |
| **Atomicity** | Client memory write (no persistence). Message put is separate from ratchet state. |

### 3.12 OUT_OF_ORDER → ACTIVE (or STATE_COMMITTED)

| Field | Value |
|-------|-------|
| **Trigger** | Missing message with counter `n` arrives; MK retrieved from skipped_keys |
| **Persistence** | Decrypt with stored MK. Advance receiving chain normally. Persist state. |
| **Failure** | MK not found → `REPLAY`. |
| **Atomicity** | Same as 3.9. |

### 3.13 Any → DUPLICATE

| Field | Value |
|-------|-------|
| **Trigger** | Message with same `id` already exists in Dexie `messages` |
| **Persistence** | Dexie `put()` is upsert — overwrites with same data. Status-rank guard prevents downgrade. |
| **Failure** | None — duplicates are inherently safe. |
| **Atomicity** | Single `put()` — atomic. |

### 3.14 Any → REPLAY

| Field | Value |
|-------|-------|
| **Trigger** | Received message with `n` already consumed (MK deleted from skipped_keys and not in chain) |
| **Persistence** | Reject message. Log security event. Do not decrypt. |
| **Failure** | N/A — rejection is the correct behavior. |
| **Atomicity** | N/A |

### 3.15 Any → SESSION_RESET

| Field | Value |
|-------|-------|
| **Trigger** | Peer's identity key changed (TOFU fingerprint mismatch, no valid rotation signature) |
| **Persistence** | Delete ratchet session for this peer from Dexie. Notify user. Optionally delete skipped_keys. |
| **Failure** | If delete fails → retry. Session is stale regardless. |
| **Atomicity** | Single Dexie `delete()` — atomic. |

### 3.16 Any → IDENTITY_CHANGED

| Field | Value |
|-------|-------|
| **Trigger** | `validatePeerKeyTofu()` returns false: IK fingerprint does not match trusted entry AND no valid ECDSA rotation signature |
| **Persistence** | Block message send. Show security warning. Do NOT update `trustedKeys`. |
| **Failure** | N/A — blocking is the intended behavior. |
| **Atomicity** | N/A |

### 3.17 Any → DEVICE_REVOKED

| Field | Value |
|-------|-------|
| **Trigger** | Server emits `device:revoked` event after admin or user revokes a device |
| **Persistence** | Delete ratchet session with revoked device. Server deletes device_prekeys. Re-establish sessions with remaining devices if needed. |
| **Failure** | If session delete fails → retry. Revoked device cannot re-establish (prekeys deleted server-side). |
| **Atomicity** | Server: DELETE device_prekeys + notify peers (best-effort notify). Client: single Dexie `delete()`. |

### 3.18 Any → DEVICE_REINSTALLED

| Field | Value |
|-------|-------|
| **Trigger** | Same user logs in on new device with same vault password; new device_id generated |
| **Persistence** | New device publishes fresh prekey bundle. Old device's sessions remain valid (same IK). |
| **Failure** | N/A — this is a normal multi-device flow. |
| **Atomicity** | N/A |

### 3.19 Any → BACKUP_RESTORED

| Field | Value |
|-------|-------|
| **Trigger** | User enters password on new device; vault decrypted successfully |
| **Persistence** | Dexie `deviceKeys.put()` with restored IK, SPK, OPKs. All ratchet sessions lost (must re-establish via X3DH). |
| **Failure** | Wrong password → vault decryption fails → stay at `NEW_DEVICE`. |
| **Atomicity** | Single Dexie `put()` — atomic. Ratchet sessions are absent (new device). |

### 3.20 Any → DECRYPTION_FAILURE

| Field | Value |
|-------|-------|
| **Trigger** | AES-256-GCM authentication tag verification fails |
| **Persistence** | Store message with `decryptable: false` flag in Dexie. Show "Unable to decrypt" in UI. |
| **Failure** | N/A — message is undecryptable. Offer cleanup via `/api/messages/cleanup`. |
| **Atomicity** | Single Dexie `put()` — atomic. |

---

## 4. Crash Recovery Matrix

| Crash Point | Persisted State | Recovery Action | Data Loss |
|-------------|----------------|-----------------|-----------|
| Before ratchet advance | Ratchet state unchanged in Dexie | Re-derive same MK on next receive; retry decrypt | None |
| After ratchet advance, before Dexie persist | Ratchet advanced in memory only | On reload, re-derive from last persisted ratchet. May produce duplicate decrypt (idempotent) | None (duplicate safe) |
| After Dexie persist, before socket send | Ciphertext + ratchet state on disk | Re-send on reconnect via offline queue | None |
| After socket send, before ACK | Server has ciphertext; client has ratchet state | Server redelivers undelivered on reconnect; client upserts (idempotent) | None |
| During X3DH computation | Nothing persisted | Restart from prekey bundle fetch | None |
| During vault decryption (login) | Nothing persisted | Retry password entry | None |
| During key rotation | Local key updated; server may not have it | On reconnect, server rejects; user must re-login to resync | None (re-login recovers) |
| During channel key distribution | Some envelopes persisted, others not | Proactive distribution on next mount fills gaps | Temporary |

---

## 5. Atomicity Guarantees Summary

| Operation | Mechanism | Atomicity Level |
|-----------|-----------|-----------------|
| Identity key generation | WebCrypto `generateKey` | All-or-nothing (native) |
| Vault encryption | PBKDF2 + AES-GCM | All-or-nothing (native) |
| Dexie `deviceKeys.put()` | IndexedDB record write | Atomic per record |
| Dexie `ratchetSessions.put()` | IndexedDB record write | Atomic per record |
| Dexie `messages.put()` | IndexedDB record write | Atomic per record |
| Ratchet + message persist | Dexie `db.transaction('rw', ...)` | **Atomic across tables** |
| Server `device_prekeys` insert | PostgreSQL transaction | Atomic (multi-row insert) |
| Server message insert | PostgreSQL `INSERT ... ON CONFLICT DO NOTHING` | Atomic per statement |
| Server key rotation | PostgreSQL single `UPDATE` | Atomic (single statement) |
| Server OPK deletion | PostgreSQL `DELETE` | Atomic per statement |

---

## 6. Edge Cases

### 6.1 Simultaneous Send + Receive

Both parties send at the same time. Each party advances their own sending chain independently. The DH ratchet step occurs when a message with a new ratchet public key is received. This is handled by the `RATCHETING` state — receiving a new `dhr_r` triggers a chain re-key.

### 6.2 Multiple Devices Per Account

Each device maintains independent ratchet sessions. Message from Alice's device_a to Bob's device_b and device_c uses different shared secrets (different IK pairs). Server routes to all online devices.

### 6.3 Vault Restore on Active Session

If user restores vault on a device that already has an active session, the restored keys replace the current ones. Existing ratchet sessions remain valid (same IK). New sessions use the restored SPK/OPKs.

### 6.4 Skipped Key Overflow

When skipped_keys exceeds 1000 entries, oldest entries are purged. Messages using purged keys cannot be decrypted. This is a documented trade-off — 1000 is generous for typical usage. Mitigation: server timestamps messages; very old out-of-order messages are likely stale.
