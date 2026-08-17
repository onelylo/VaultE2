# Vault2E — DM End-to-End Encryption Architecture

**Author:** Senior Cryptographic Systems Engineer
**Date:** 2026-08-17
**Status:** Design Document (Production-Grade)
**Supersedes:** Current static ECDH implementation

---

## 1. Identity Key Model

### 1.1 Per-Device Identity Keys

Each device registered to a Vault2E account holds its own long-lived identity keypair. This is the foundation of device isolation.

```
┌─────────────────────────────────────────────────────────┐
│                    ACCOUNT LEVEL                         │
│  user_id: usr_alice                                     │
│  password_hash: bcrypt(...)                             │
│  display_name: "Alice"                                  │
└───────────────────────┬─────────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          │                           │
    ┌─────▼──────┐              ┌─────▼──────┐
    │  Device A  │              │  Device B  │
    │  (Laptop)  │              │  (Phone)   │
    ├────────────┤              ├────────────┤
    │ DeviceID_a │              │ DeviceID_b │
    │ IK_priv_a  │              │ IK_priv_b  │
    │ IK_pub_a   │              │ IK_pub_b   │
    │ SignedPK_a │              │ SignedPK_b │
    │ OPK_pool_a │              │ OPK_pool_b │
    └────────────┘              └────────────┘
```

**Key Types Per Device:**

| Key | Curve | Purpose | Lifetime |
|-----|-------|---------|----------|
| Identity Key (IK) | Ed25519 | Long-lived device credential | Device lifetime |
| Signed Prekey (SPK) | X25519 | Session establishment, rotated periodically | 7 days |
| One-Time Prekeys (OPKs) | X25519 | Single-use session setup, async delivery | Consumed on use |

**Why Ed25519/X25519 instead of P-256:**
- Ed25519 signatures are deterministic (no RNG failures during signing)
- X25519 provides constant-time scalar multiplication (no timing side-channels)
- Signal Protocol ecosystem uses Curve25519 — library compatibility
- Smaller key sizes (32 bytes vs 32 bytes raw, but Ed25519 signatures are 64 bytes vs ECDSA P-256 DER ~70 bytes)

**WebCrypto Mapping:**
WebCrypto does not expose Ed25519 or X25519 directly in all browsers. Two options:

1. **Recommended:** Use `@noble/ed25519` + `@noble/curve25519` (audited, no native dependencies, ~40KB bundled)
2. **Fallback:** Use ECDH P-256 with HKDF-based key derivation (existing codebase, less standard)

This design uses Curve25519 family as primary, with P-256 fallback path documented.

### 1.2 Key Storage — Vault Encryption

Device identity keys are encrypted and stored on the server for multi-device recovery.

```
Password
    │
    ▼
PBKDF2-SHA256(password, salt, 600_000 iterations)
    │
    ▼
AES-256-GCM wrapping_key
    │
    ▼
Encrypt: { IK_jwk, SPK_jwk, OPK_pool_jwk[] }
    │
    ▼
Server: users.encrypted_private_key + users.key_salt
```

**Vault Contents Per Device:**

```json
{
  "device_id": "dev_a1b2c3d4",
  "ik": "<JWK>",
  "spk": "<JWK>",
  "spk_signature": "<Ed25519 signature of SPK using IK>",
  "opk_pool": ["<JWK>", "<JWK>", "..."],
  "created_at": 1692278400000
}
```

**Vault Decryption Flow (Login/Recovery):**

1. User enters password on new device
2. Client fetches `encrypted_private_key` + `key_salt` from server
3. `PBKDF2-SHA256(password, salt, 600_000)` → wrapping key
4. `AES-256-GCM.decrypt(wrapping_key, iv, ciphertext)` → vault JSON
5. Import JWK keys into WebCrypto / noble library
6. Client generates new device keypair if vault doesn't exist for this device

---

## 2. Session Establishment — X3DH

### 2.1 Prekey Bundle Publication

Each device publishes a prekey bundle to the server. The server stores these but cannot decrypt anything.

```
┌──────────────────────────────────────────────────┐
│              PREKEY BUNDLE (per device)           │
├──────────────────────────────────────────────────┤
│  IK    : Identity Public Key (Ed25519)           │
│  SPK   : Signed Prekey Public (X25519)           │
│  SPK_sig: Ed25519(IK_priv, serialize(SPK))      │
│  OPK   : One-Time Prekey Public (X25519) [opt]   │
└──────────────────────────────────────────────────┘
```

**Server Storage:**

```sql
CREATE TABLE device_prekeys (
    device_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    ik_public       BYTEA NOT NULL,        -- Ed25519 public key
    spk_public      BYTEA NOT NULL,        -- X25519 signed prekey public
    spk_signature   BYTEA NOT NULL,        -- Ed25519(SIK_priv, SPK)
    opk_public      BYTEA,                 -- X25519 one-time prekey (nullable)
    opk_id          INTEGER,               -- OPK identifier
    spk_created_at  BIGINT NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (device_id, is_active)
);
```

**Prekey Lifecycle:**

```
  Device generates                 Server stores              Session initiator
  ──────────────                   ────────────               ─────────────────
  Generate IK                      Store bundle               Fetch bundle
  Generate SPK                     Return bundle              Verify SPK_sig with IK
  Sign SPK with IK                 Mark old SPK inactive      Perform X3DH
  Generate 100 OPKs                Store OPKs                 Consume OPK
  Upload bundle                    ─────────                  Derive shared secret
  Periodic SPK rotation (7 days)   Delete consumed OPK        Start Double Ratchet
```

### 2.2 X3DH Protocol

```
Alice (initiator)                          Bob (responder)
─────────────────                          ───────────────
Own keys:                                  Published bundle:
  IK_a (identity)                            IK_b (identity)
                                              SPK_b (signed prekey)
                                              SPK_sig_b
                                              OPK_b (one-time prekey)

Alice generates:
  EK_a (ephemeral, fresh X25519)

Computes:
  DH1 = X25519(IKa_priv, SPKb_pub)
  DH2 = X25519(EKa_priv, IKb_pub)
  DH3 = X25519(EKa_priv, SPKb_pub)
  DH4 = X25519(EKa_priv, OPKb_pub)    [if OPK available]

SharedSecret = HKDF(
  input = DH1 || DH2 || DH3 || DH4,
  salt  = 0x0000000000000000,
  info  = "Vault2E_X3DH_v1",
  length = 32
)

→ IKM = SharedSecret
→ RootKey (RK) = IKM
→ ChainKey (CK) = 0 (empty chain)

Alice sends to Bob:
  Header = {
    IK_a_pub,
    EK_a_pub,
    OPK_id (if used)
  }
  Message1 = AES-256-GCM(CK, plaintext)
```

**X3DH Shared Secret Derivation:**

```
DH outputs (32 bytes each):
  DH1: IKa × SPKb   — binds initiator identity to responder's signed prekey
  DH2: EKa × IKb    — binds ephemeral to responder identity
  DH3: EKa × SPKb   — binds ephemeral to responder's signed prekey
  DH4: EKa × OPKb   — binds ephemeral to responder's one-time prekey (optional)

HKDF-SHA256(
  ikm = DH1 ‖ DH2 ‖ DH3 ‖ DH4,
  salt = 0x0000000000000000,
  info = "Vault2E_X3DH_v1",
  length = 32
)
→ IKM (input keying material)
```

**Why four DH operations:**
- DH1 provides forward secrecy from Alice's identity key compromise
- DH2 provides forward secrecy from Bob's identity key compromise  
- DH3 provides forward secrecy from Bob's signed prekey compromise
- DH4 provides one-time forward secrecy (OPK consumed, never reused)

### 2.3 X3DH State Machine

```
                    ┌──────────────┐
                    │   IDLE       │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
        [Initiator]               [Responder]
              │                         │
              ▼                         ▼
    ┌─────────────────┐     ┌─────────────────┐
    │ FETCH_BUNDLE     │     │ PUBLISH_BUNDLE   │
    │ - GET /prekeys/  │     │ - Upload IK,     │
    │   {userId}       │     │   SPK, SPK_sig,  │
    │ - Verify SPK_sig │     │   OPKs           │
    └────────┬────────┘     └────────┬────────┘
             │                       │
             ▼                       ▼
    ┌─────────────────┐     ┌─────────────────┐
    │ COMPUTE_X3DH    │     │ WAIT_FOR_INIT    │
    │ - Generate EK    │     │ - Listen on      │
    │ - DH1..DH4      │     │   socket for     │
    │ - HKDF → IKM    │     │   X3DH message   │
    │ - Derive RK, CK │     │                  │
    └────────┬────────┘     └────────┬────────┘
             │                       │
             ▼                       ▼
    ┌─────────────────┐     ┌─────────────────┐
    │ SEND_X3DH_MSG   │     │ RECEIVE_X3DH_MSG │
    │ - Header: IKa,  │     │ - Verify IKa_sig │
    │   EKa, OPK_id   │     │ - DH1..DH4       │
    │ - Encrypt msg1   │     │ - HKDF → IKM     │
    └────────┬────────┘     │ - Derive RK, CK  │
             │              │ - Decrypt msg1    │
             │              └────────┬────────┘
             │                       │
             └───────────┬───────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ DOUBLE_RATCHET   │
                │   (active)       │
                └──────────────────┘
```

---

## 3. Messaging Protocol — Double Ratchet

### 3.1 Ratchet Architecture

After X3DH establishes the initial `RK` and `CK`, the Double Ratchet provides per-message forward secrecy.

```
┌─────────────────────────────────────────────────────────────┐
│                    DOUBLE RATCHET STATE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  RK (Root Key, 32 bytes)                                     │
│    │                                                         │
│    ├── Sending Chain                                        │
│    │   ├── CK_s (Chain Key)                                 │
│    │   ├── n_s (Sending Counter)                            │
│    │   └── MK_0, MK_1, MK_2 ... (Message Keys)             │
│    │                                                         │
│    ├── Receiving Chain                                      │
│    │   ├── CK_r (Chain Key)                                 │
│    │   ├── n_r (Receiving Counter)                          │
│    │   ├── pn (Previous Sending Counter)                     │
│    │   └── MK_0, MK_1, MK_2 ... (Message Keys)             │
│    │                                                         │
│    └── DH Ratchet                                           │
│        ├── DHr_s (Current Ratchet Public Key, sending)      │
│        └── DHr_r (Current Ratchet Public Key, receiving)    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Message Key Derivation

```
Sending Chain:
  CK_s → HMAC-SHA256(CK_s, 0x01) → MK (message key)
  CK_s → HMAC-SHA256(CK_s, 0x02) → new CK_s

Receiving Chain:
  CK_r → HMAC-SHA256(CK_r, 0x01) → MK (message key)
  CK_r → HMAC-SHA256(CK_r, 0x02) → new CK_r

Each MK is used exactly once for AES-256-GCM encryption.
```

### 3.3 DH Ratchet Step

```
When receiving a message with a NEW ratchet public key:

  1. DH_output = X25519(DHr_priv, new_ratchet_pub)
  2. RK, CK_r = KDF(RK, DH_output)        // receiving chain
  3. RK, CK_s = KDF(RK, DH_output_new)    // sending chain (generate new DHr_s)

When sending (no new ratchet key from peer):

  Just advance sending chain: CK_s → MK + new CK_s
```

### 3.4 Wire Format

```
┌─────────────────────────────────────────────────────────┐
│                     MESSAGE ENVELOPE                     │
├─────────────────────────────────────────────────────────┤
│  dh_public   : X25519 ratchet public key (32 bytes)    │
│  n           : Sending counter (4 bytes, big-endian)    │
│  pn          : Previous sending counter (4 bytes)       │
│  mk_id       : Message key ID (4 bytes)                 │
│  ciphertext  : AES-256-GCM(MK, plaintext, AAD=header)  │
│  iv          : 12 bytes random                           │
│  tag         : 16 bytes GCM authentication tag          │
└─────────────────────────────────────────────────────────┘

Header (AAD for AES-GCM):
  = dh_public ‖ n ‖ pn
```

### 3.5 Double Ratchet State Machine

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────┐                                             │
│  │ INIT_RATCHET │ ← After X3DH, both parties have            │
│  └──────┬──────┘   RK, CK_s (or CK_r), DHr keys            │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────┐                                     │
│  │ SENDING              │                                    │
│  │ - Advance CK_s       │────┐                               │
│  │ - Derive MK          │    │                               │
│  │ - Encrypt with MK    │    │                               │
│  │ - Send (dh, n, pn,  │    │                               │
│  │   ciphertext)        │    │                               │
│  └──────────┬──────────┘    │                               │
│             │               │                               │
│  ┌──────────▼──────────┐    │   ┌────────────────────────┐  │
│  │ RECEIVING            │    │   │ DH_RATCHET_STEP        │  │
│  │ - Verify tag         │    │   │ - New ratchet pub?     │  │
│  │ - Check n vs expected│    │   │ - DH with new pub      │  │
│  │ - Decrypt with MK    │    │   │ - Update RK, CK_r     │  │
│  │ - Advance CK_r       │◄───┘   │ - Generate new DHr_s  │  │
│  └──────────┬──────────┘        │ - Update RK, CK_s     │  │
│             │                    └────────────────────────┘  │
│             │                                                │
│             ▼                                                │
│  ┌─────────────────────┐                                     │
│  │ SKIPPED_KEY_CHECK    │                                    │
│  │ - n > expected?      │──── Yes ──→ Store skipped keys     │
│  │ - n < expected?      │──── Yes ──→ Reuse MK from storage  │
│  │ - n == expected?     │──── Yes ──→ Normal decrypt         │
│  └──────────┬──────────┘                                     │
│             │                                                │
│             ▼                                                │
│  ┌─────────────────────┐                                     │
│  │ PERSIST_STATE        │                                    │
│  │ - Save to Dexie      │                                    │
│  │ - Atomic write       │                                    │
│  └──────────┬──────────┘                                     │
│             │                                                │
│             ▼                                                │
│         (back to SENDING)                                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Key Storage — Vault Architecture

### 4.1 Vault Encryption Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│                    VAULT ENCRYPTION                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Password ──→ PBKDF2-SHA256 ──→ AES-256-GCM ──→ Ciphertext │
│               (600K iter)        (key wrapping)              │
│               (16B salt)                                     │
│                                                              │
│  Vault Payload:                                              │
│  ┌──────────────────────────────────────────┐               │
│  │ {                                        │               │
│  │   "device_id": "dev_xxxx",              │               │
│  │   "ik": { ... JWK ... },               │               │
│  │   "spk": { ... JWK ... },              │               │
│  │   "spk_signature": "base64...",        │               │
│  │   "opk_pool": [ { ... JWK ... }, ... ] │               │
│  │ }                                        │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
│  Server Storage:                                             │
│  users.encrypted_private_key = AES-GCM ciphertext           │
│  users.key_salt = PBKDF2 salt                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 PBKDF2 Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Algorithm | PBKDF2-HMAC-SHA256 | NIST approved, WebCrypto native |
| Iterations | 600,000 | OWASP 2023+ recommendation for SHA-256 |
| Salt length | 16 bytes | Random, per-vault |
| Derived key length | 32 bytes | AES-256 key size |
| IV length | 12 bytes | AES-GCM standard |

### 4.3 Local Key Storage (Dexie IndexedDB)

```
┌──────────────────────────────────────────────────┐
│              Dexie Schema (per device)             │
├──────────────────────────────────────────────────┤
│                                                    │
│  Table: deviceKeys                                │
│  ┌──────────────────────────────────────┐        │
│  │ device_id    : string (PK)           │        │
│  │ ik_jwk       : string (JWK JSON)    │        │
│  │ ik_public    : string (Base64)       │        │
│  │ spk_jwk      : string (JWK JSON)    │        │
│  │ spk_public   : string (Base64)       │        │
│  │ spk_sig      : string (Base64)       │        │
│  │ opk_pool     : string (JSON array)   │        │
│  └──────────────────────────────────────┘        │
│                                                    │
│  Table: ratchetSessions                           │
│  ┌──────────────────────────────────────┐        │
│  │ session_id   : string (PK)           │        │
│  │ peer_id      : string                │        │
│  │ peer_device  : string                │        │
│  │ rk           : string (Base64)       │        │
│  │ ck_s         : string (Base64)       │        │
│  │ ck_r         : string (Base64)       │        │
│  │ n_s          : number                │        │
│  │ n_r          : number                │        │
│  │ pn           : number                │        │
│  │ dhr_s        : string (Base64)       │        │
│  │ dhr_r        : string (Base64)       │        │
│  │ skipped_keys : string (JSON)         │        │
│  └──────────────────────────────────────┘        │
│                                                    │
│  Table: trustedKeys (TOFU)                        │
│  ┌──────────────────────────────────────┐        │
│  │ user_id      : string (PK)           │        │
│  │ device_id    : string (PK)           │        │
│  │ ik_fingerprint: string               │        │
│  │ first_seen   : number                │        │
│  └──────────────────────────────────────┘        │
│                                                    │
└──────────────────────────────────────────────────┘
```

---

## 5. Multi-Device Architecture

### 5.1 Device Registration

```
┌──────────────────────────────────────────────────────────────┐
│                DEVICE REGISTRATION FLOW                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  New Device                    Server                        │
│  ──────────                    ──────                        │
│  1. Enter password             2. Verify password             │
│  3. Decrypt vault              4. Return encrypted vault      │
│  5. Extract IK, SPK, OPKs                                   │
│  6. Generate NEW device_id                                   │
│  7. Generate NEW SPK + OPKs                                  │
│  8. POST /api/devices/register                               │
│     { device_id, IK_pub, SPK, SPK_sig, OPKs[] }             │
│                                9. Store device record         │
│                                   Store prekey bundle         │
│                                10. Return 201 Created         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Device Revocation

```
┌──────────────────────────────────────────────────────────────┐
│                DEVICE REVOCATION FLOW                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Revoking Device              Server                         │
│  ───────────────              ──────                         │
│  1. POST /api/devices/revoke   2. Delete device record        │
│     { device_id }                Delete prekey bundle         │
│                                  Notify all peers             │
│                                3. Return 200 OK               │
│                                                              │
│  Remaining Devices            Server                         │
│  ─────────────────            ──────                         │
│  4. Receive device:revoked    5. (already deleted)           │
│  5. Delete session state                                   │
│     with revoked device                                     │
│  6. Re-establish sessions                                   │
│     if needed                                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.3 Multi-Device Message Delivery

```
  Alice (device_a)          Server              Bob (device_b, device_c)
  ─────────────────         ──────              ────────────────────────
  Encrypt for Bob_device_b
  Send to server     ─────→  Store ciphertext
                             Route to device_b
                             ─────────────────→  Decrypt (device_b)
                             Route to device_c
                             ─────────────────→  Decrypt (device_c)

  Bob receives on whichever device is online.
  Each device has its own ratchet session with Alice.
```

---

## 6. Session Persistence & Crash Recovery

### 6.1 Atomic State Transitions

```
┌──────────────────────────────────────────────────────────────┐
│              SESSION STATE TRANSITION MACHINE                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    decrypt()     ┌──────────┐                  │
│  │ LOADED  │ ───────────────→ │ DECRYPTED │                  │
│  │ (from   │                  │ (keys     │                  │
│  │  Dexie) │                  │  in mem)  │                  │
│  └─────────┘                  └────┬─────┘                  │
│                                     │                         │
│                          ┌──────────┴──────────┐            │
│                          │                     │            │
│                    send(msg)             receive(msg)        │
│                          │                     │            │
│                          ▼                     ▼            │
│                   ┌──────────┐          ┌──────────┐        │
│                   │ ENCRYPTED │          │ DECRYPTED │        │
│                   │ (ciphertext│          │ (plaintext│        │
│                   │  ready)   │          │  ready)   │        │
│                   └────┬─────┘          └────┬─────┘        │
│                        │                     │               │
│                   persist()             persist()            │
│                        │                     │               │
│                        ▼                     ▼               │
│                   ┌──────────┐          ┌──────────┐        │
│                   │ PERSISTED │          │ PERSISTED │        │
│                   │ (Dexie    │          │ (Dexie    │        │
│                   │  written) │          │  written) │        │
│                   └────┬─────┘          └────┬─────┘        │
│                        │                     │               │
│                     send()                send()            │
│                     (socket)              (socket)          │
│                        │                     │               │
│                        ▼                     ▼               │
│                   ┌──────────┐          ┌──────────┐        │
│                   │ SENT      │          │ DELIVERED │        │
│                   │ (ACK      │          │ (ACK      │        │
│                   │  pending) │          │  received)│        │
│                   └──────────┘          └──────────┘        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Crash Recovery Rules

| Crash Point | State | Recovery |
|-------------|-------|----------|
| Before ratchet advance | Ratchet state unchanged | Re-derive same message key, retry |
| After ratchet advance, before persist | Ratchet advanced in memory but not on disk | On reload, re-derive state from last persisted ratchet. May produce duplicate decrypt (idempotent due to message ID dedup) |
| After persist, before send | Ciphertext ready, not sent | Re-send on reconnect (offline queue) |
| After send, before ACK | Sent but unconfirmed | Server has ciphertext. Reconnect → redeliver if needed (idempotent message IDs) |
| During X3DH | Shared secret not derived | Restart X3DH from prekey bundle fetch |

### 6.3 Dexie Transaction Safety

```typescript
// Atomic ratchet state update
async function advanceRatchetAtomic(
  sessionId: string, 
  newState: RatchetState, 
  message: StoredMessage
): Promise<void> {
  await db.transaction('rw', db.ratchetSessions, db.messages, async () => {
    // 1. Write message first (idempotent put)
    await db.messages.put(message);
    // 2. Then advance ratchet state
    await db.ratchetSessions.put({
      ...newState,
      session_id: sessionId
    });
    // Both succeed or both fail — no partial state
  });
}
```

---

## 7. Message Ordering & Replay Protection

### 7.1 Ratchet Counter Ordering

The Double Ratchet naturally provides ordering via counters:

```
Message: { dh_public, n, pn, ciphertext }

Receiving side:
  if n == expected_n:
    → Normal decrypt, advance receiving chain
  elif n > expected_n:
    → Out-of-order (future message)
    → Store message, save skipped keys for range [expected_n, n)
  elif n < expected_n:
    → Old message, look up skipped key by (dh_public, n)
    → If found: decrypt with stored MK
    → If not found: message key already consumed (replay or too old)
```

### 7.2 Replay Detection

```
┌──────────────────────────────────────────────────────────────┐
│                  REPLAY PROTECTION                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Each message key MK is used exactly once                 │
│  2. After decryption, MK is deleted from skipped_keys        │
│  3. Duplicate message IDs are rejected by Dexie upsert       │
│  4. AES-GCM authentication tag binds ciphertext to header    │
│     (dh_public + n + pn) — tamper detection                  │
│  5. AAD binding prevents ciphertext substitution             │
│                                                              │
│  Maximum skipped keys: 1000 (configurable)                   │
│  Oldest skipped key: purged when limit exceeded              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 Skipped Message Key Storage

```
SkippedKeys = Map<(ratchet_pub, message_number), MessageKey>

Limit: 1000 entries max

Purge strategy:
  1. When new entry added and count > 1000
  2. Remove oldest entries (by insertion order)
  3. Log warning: "Skipped key cache overflow, oldest keys purged"

  Risk: Messages using purged keys cannot be decrypted.
  Mitigation: 1000 is generous for typical usage. Users with
  extreme out-of-order delivery should be rare.
```

---

## 8. Migration Path — Static ECDH to Double Ratchet

### 8.1 Migration Strategy

The migration must be backward-compatible. Old and new clients will coexist during transition.

```
┌──────────────────────────────────────────────────────────────┐
│                MIGRATION PHASES                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 0: Preparation (current state)                       │
│  ─────────────────────────────────────                      │
│  - Static ECDH, per-account keys                            │
│  - Server vault with PBKDF2-wrapped keys                    │
│                                                              │
│  Phase 1: Dual-Protocol Support                             │
│  ────────────────────────────────                            │
│  - Add X3DH prekey bundle endpoints                         │
│  - Add Double Ratchet session management                    │
│  - New clients generate per-device keys                     │
│  - New clients attempt X3DH first, fall back to static      │
│  - Server stores both old ECDH keys and new IK/SPK/OPKs    │
│                                                              │
│  Phase 2: Automatic Upgrade                                  │
│  ──────────────────────────                                  │
│  - When both peers support Double Ratchet, use it           │
│  - When one peer is old, fall back to static ECDH           │
│  - Old peers are notified to upgrade                        │
│                                                              │
│  Phase 3: Deprecation                                        │
│  ─────────────────────                                       │
│  - Remove static ECDH fallback                              │
│  - Require per-device key registration                      │
│  - Migrate all vaults to new format                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Capability Negotiation

```
┌──────────────────────────────────────────────────────────────┐
│              CLIENT CAPABILITY ADVERTISEMENT                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  On user:join, each client includes:                         │
│  {                                                           │
│    "crypto_version": "v2",           // "v1" = static ECDH │
│    "device_id": "dev_xxxx",          // null if v1          │
│    "supports_x3dh": true,                                 │
│    "supports_double_ratchet": true                         │
│  }                                                           │
│                                                              │
│  Server stores in activeUsers map.                          │
│  Client checks peer capabilities before sending:            │
│                                                              │
│  if (peer.supports_double_ratchet && my_device_id) {       │
│    // Use X3DH + Double Ratchet                             │
│  } else {                                                   │
│    // Fall back to static ECDH (legacy)                    │
│  }                                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.3 Vault Migration

```
Old vault format:
  { ecdh: <JWK>, ecdsa: <JWK> }

New vault format:
  {
    "device_id": "dev_xxxx",
    "ik": <JWK>,
    "spk": <JWK>,
    "spk_signature": <Base64>,
    "opk_pool": [<JWK>, ...]
  }

Migration on first login after upgrade:
  1. Decrypt old vault with password
  2. Generate new per-device IK (Ed25519)
  3. Generate new SPK + OPKs (X25519)
  4. Sign SPK with IK
  5. Encrypt new vault with same password
  6. Upload to server
  7. Preserve old ECDH keys for legacy fallback (30-day window)
```

### 8.4 Dual-Key Decryption Window

```
During migration, both old and new keys must work:

  Time ──────────────────────────────────────────────→

  │◀── Old ECDH keys active ──▶│
  │                              │◀── Old keys expired ──▶│
  │         │◀───── Dual-key window ─────▶│
  │         │                              │
  Day 0    Day 7                         Day 30
  Upgrade   All peers upgraded           Old keys purged

  - During dual-key window, decrypt tries new ratchet first,
    falls back to old static ECDH
  - Old private keys stored in separate Dexie table with
    expiry timestamp
  - After expiry, old keys are purged
```

---

## 9. Security Properties Summary

| Property | Before (Static ECDH) | After (X3DH + Double Ratchet) |
|----------|----------------------|-------------------------------|
| Forward Secrecy | None (manual rotation only) | Per-message via ratchet |
| Post-Compromise Security | Manual rotation | Automatic via DH ratchet |
| Async Session Setup | No (both must be online) | Yes (via prekey bundles) |
| Per-Device Isolation | No (shared key) | Yes (per-device IK + sessions) |
| Device Revocation | No | Yes (delete device + re-key) |
| Replay Protection | None | Message keys single-use |
| Out-of-Order Handling | Random IV only | Skipped message keys |
| Key Continuity | TOFU + ECDSA chain | TOFU + prekey signatures |

---

## 10. Library Dependencies

| Purpose | Library | Size | Audit Status |
|---------|---------|------|--------------|
| Ed25519 signatures | `@noble/ed25519` | ~15KB | Widely audited |
| X25519 key agreement | `@noble/curve25519` | ~15KB | Widely audited |
| HKDF | `@noble/hashes` (HKDF) | ~5KB | Widely audited |
| AES-GCM | WebCrypto API | Native | Browser-native |
| PBKDF2 | WebCrypto API | Native | Browser-native |
| Random bytes | `crypto.getRandomValues()` | Native | Browser-native |

**Alternative:** If Curve25519 is not adopted, all operations can be performed with WebCrypto ECDH P-256 + HKDF. The protocol structure remains the same; only the curve changes.
