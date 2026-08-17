# Vault2E — Cryptographic Domain Separation

**Author:** Senior Cryptographic Systems Engineer
**Date:** 2026-08-17
**Status:** Design Document

---

## 1. Domain Overview

Vault2E uses four distinct cryptographic domains. Each domain has its own key hierarchy, encryption scope, and security properties. Keys from one domain are **never** reused in another.

```
┌──────────────────────────────────────────────────────────────┐
│                    CRYPTOGRAPHIC DOMAINS                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐         │
│  │   DOMAIN 1: DMs      │    │   DOMAIN 2: Hubs     │         │
│  │   (Signal-style)     │    │   (MLS-style)        │         │
│  │                      │    │                      │         │
│  │   X3DH + Double      │    │   MLS groups with    │         │
│  │   Ratchet per        │    │   ratchet tree       │         │
│  │   device pair        │    │   per channel        │         │
│  └──────────┬──────────┘    └──────────┬──────────┘         │
│             │                          │                     │
│             │    ┌─────────────────────┐│                     │
│             │    │   DOMAIN 3:         ││                     │
│             │    │   ATTACHMENTS        ││                     │
│             │    │   (independent       ││                     │
│             │    │    random keys)      ││                     │
│             │    └──────────┬──────────┘│                     │
│             │               │           │                     │
│             │    ┌──────────┴──────────┐│                     │
│             │    │   DOMAIN 4:         ││                     │
│             │    │   BACKUPS            ││                     │
│             │    │   (PBKDF2-derived    ││                     │
│             │    │    wrapping keys)    ││                     │
│             │    └─────────────────────┘│                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Domain 1 — Direct Messages (Signal-Style)

### 2.1 Key Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                    DM KEY HIERARCHY                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Identity Key (IK) — per device, Ed25519                    │
│    │                                                         │
│    ├── Signs: Signed Prekey (SPK), Key Packages              │
│    │                                                         │
│  X3DH Shared Secret                                         │
│    │                                                         │
│    ├── Root Key (RK)                                        │
│    │     │                                                  │
│    │     ├── Chain Key (CK)                                 │
│    │     │     │                                            │
│    │     │     └── Message Key (MK) — used once per message │
│    │     │                                                  │
│    │     └── DH Ratchet Step → new RK, new CK              │
│    │                                                         │
│    └── Session Key = AES-256-GCM key from MK               │
│                                                              │
│  Scope: Single DM conversation between two devices          │
│  Lifetime: Per-session (revoked on device removal)          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Key Material

| Key | Algorithm | Length | Lifetime | Usage |
|-----|-----------|--------|----------|-------|
| Identity Key (IK) | Ed25519 | 32 bytes | Device lifetime | Signs SPK, authenticates device |
| Signed Prekey (SPK) | X25519 | 32 bytes | 7 days | X3DH session setup |
| One-Time Prekey (OPK) | X25519 | 32 bytes | Single use | X3DH async setup |
| Ephemeral Key (EK) | X25519 | 32 bytes | Single session | X3DH + DH ratchet |
| Root Key (RK) | — | 32 bytes | Session lifetime | Ratchet state |
| Chain Key (CK) | — | 32 bytes | Per-message | Derives message keys |
| Message Key (MK) | — | 32 bytes | Single use | AES-256-GCM message encryption |

### 2.3 Server Visibility

| What Server Sees | What Server Cannot See |
|------------------|----------------------|
| Sender user ID | Message plaintext |
| Recipient user ID | Message keys |
| Ciphertext | Shared secret |
| Timestamp | Ratchet state |
| Online/offline status | Identity private keys |
| Message count | Prekey private keys |
| Ciphertext length | |

### 2.4 Domain Isolation Rules

```
DM keys are NEVER used for:
  ✗ Channel/Hub message encryption
  ✗ Attachment encryption (separate random key)
  ✗ Backup vault encryption (password-derived)
  ✗ Server authentication (JWT)

DM keys are used ONLY for:
  ✓ Encrypting/decrypting DM messages
  ✓ Encrypting/decrypting DM attachments
  ✓ Establishing DM sessions via X3DH
  ✓ Signing SPKs for device authentication
```

---

## 3. Domain 2 — Hubs/Channels (MLS-Style)

### 3.1 Key Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                    HUB/CHANNEL KEY HIERARCHY                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  MLS Group (per channel)                                    │
│    │                                                         │
│    ├── Ratchet Tree                                         │
│    │     │                                                  │
│    │     ├── Leaf Secrets (per device)                      │
│    │     │     ├── IK (Ed25519) — device identity           │
│    │     │     └── SPK (X25519) — signed prekey             │
│    │     │                                                  │
│    │     └── Interior Node Secrets (encrypted)             │
│    │           └── Tree Root Secret                        │
│    │                                                         │
│    └── Epoch Key Derivation                                │
│          │                                                  │
│          ├── Epoch Secret (ES)                              │
│          │     ├── EncKey = Derive(ES, "enc")              │
│          │     ├── MICKey = Derive(ES, "mic")              │
│          │     └── IVBase = Derive(ES, "iv")               │
│          │                                                  │
│          └── App Secret → per-app encryption keys          │
│                                                              │
│  Scope: All devices in a single channel                     │
│  Lifetime: Per-epoch (rotated on any membership change)     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Key Material

| Key | Algorithm | Length | Lifetime | Usage |
|-----|-----------|--------|----------|-------|
| Leaf IK | Ed25519 | 32 bytes | Device lifetime | Device identity in tree |
| Leaf SPK | X25519 | 32 bytes | Per-update | Leaf encryption in tree |
| Node Secret | — | 32 bytes | Per-commit | Interior tree node |
| Tree Root Secret | — | 32 bytes | Per-commit | Tree root |
| Epoch Secret (ES) | — | 32 bytes | Per-epoch | Key schedule root |
| EncKey | — | 32 bytes | Per-epoch | AES-256-GCM message encryption |
| MICKey | — | 32 bytes | Per-epoch | Message authentication |
| IVBase | — | 12 bytes | Per-epoch | IV derivation |

### 3.3 Server Visibility

| What Server Sees | What Server Cannot See |
|------------------|----------------------|
| Channel membership (user IDs) | Message plaintext |
| Commit timestamps | Epoch secrets |
| Ciphertext | Tree root secret |
| Message sizes | EncKey, MICKey |
| Epoch number | Device identity private keys |
| KeyPackage presence | Leaf path secrets |
| Online/offline status | Node secrets |

### 3.4 Domain Isolation Rules

```
Hub/Channel keys are NEVER used for:
  ✗ DM message encryption
  ✗ Attachment encryption (separate random key)
  ✗ Backup vault encryption (password-derived)
  ✗ Server authentication (JWT)

Hub/Channel keys are used ONLY for:
  ✓ Encrypting/decrypting channel messages
  ✓ Encrypting/decrypting channel attachments
  ✓ MLS tree operations (add, remove, update)
  ✓ Epoch transitions
  ✓ Commit confirmation MACs
```

---

## 4. Domain 3 — Attachments (Independent Random Keys)

### 4.1 Key Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                    ATTACHMENT KEY HIERARCHY                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Per-Attachment Random Key                                  │
│    │                                                         │
│    ├── Generated: crypto.getRandomValues(new Uint8Array(32)) │
│    ├── Imported: AES-GCM key from raw bytes                 │
│    │                                                         │
│    ├── Encrypts:                                            │
│    │     ├── File content (binary)                          │
│    │     └── Metadata (JSON: name, size, mime, thumbnail)   │
│    │                                                         │
│    └── Encrypted for storage:                               │
│          └── Wrap with conversation key (DM or channel)     │
│               ├── DM attachment: wrapped with DM session key│
│               └── Channel attachment: wrapped with EncKey   │
│                                                              │
│  Scope: Single file/attachment                              │
│  Lifetime: Permanent (attached to message forever)          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Key Material

| Key | Algorithm | Length | Lifetime | Usage |
|-----|-----------|--------|----------|-------|
| Media Key (MK) | AES-256-GCM | 32 bytes | Per-attachment | Encrypts file content + metadata |
| Wrap Key | DM/Channel session key | 32 bytes | Per-session/epoch | Encrypts MK for storage |

### 4.3 Attachment Encryption Flow

```
┌──────────────────────────────────────────────────────────────┐
│              ATTACHMENT ENCRYPTION                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Generate random media key:                              │
│     mediaKey = crypto.getRandomValues(new Uint8Array(32))   │
│                                                              │
│  2. Encrypt file content:                                   │
│     fileCiphertext = AES-GCM(mediaKey, fileContent)        │
│     fileIV = random 12 bytes                                │
│                                                              │
│  3. Encrypt metadata:                                       │
│     metadata = JSON.stringify({                              │
│       fileName, fileSize, mimeType, thumbnail               │
│     })                                                       │
│     metadataCiphertext = AES-GCM(mediaKey, metadata)       │
│     metadataIV = random 12 bytes                            │
│                                                              │
│  4. Wrap media key for recipient:                           │
│     IF DM:                                                  │
│       wrappedKey = AES-GCM(dmSessionKey, mediaKey)         │
│     IF Channel:                                             │
│       wrappedKey = AES-GCM(channelEncKey, mediaKey)        │
│                                                              │
│  5. Upload:                                                 │
│     POST /api/attachments/upload                            │
│     { fileCiphertext, fileIV, metadataCiphertext,          │
│       metadataIV, wrappedKey, message_id }                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.4 Server Visibility

| What Server Sees | What Server Cannot See |
|------------------|----------------------|
| Encrypted file bytes | File content |
| Encrypted metadata | File name |
| File IV | File size (only ciphertext size) |
| Metadata IV | MIME type |
| Wrapped media key (opaque blob) | Media key |
| File size (on disk) | Thumbnail content |
| Upload timestamp | |

### 4.5 Domain Isolation Rules

```
Attachment keys are NEVER used for:
  ✗ Message encryption (messages use session/epoch keys)
  ✗ DM session establishment
  ✗ Channel MLS operations
  ✗ Backup vault encryption

Attachment keys are used ONLY for:
  ✓ Encrypting/decrypting a single file
  ✓ Encrypting/decrypting that file's metadata
  ✓ Wrapped by the conversation key for storage
```

**Why independent keys:** If a conversation key is compromised, only the wrapped media keys are exposed. The attacker still needs to unwrap each media key individually. If an attachment key is somehow exposed, only that single file is compromised — not the conversation and not other attachments.

---

## 5. Domain 4 — Backups (Password-Derived)

### 5.1 Key Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│                    BACKUP KEY HIERARCHY                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  User Password                                              │
│    │                                                         │
│    └── PBKDF2-SHA256(password, salt, 600_000)              │
│          │                                                  │
│          └── Wrapping Key (AES-256-GCM)                    │
│                │                                            │
│                └── Encrypts:                                │
│                      ├── Device IK (JWK)                   │
│                      ├── Device SPK (JWK)                  │
│                      ├── SPK signature                      │
│                      └── OPK pool (JWK[])                   │
│                                                              │
│  Scope: Per-device vault (private key backup)               │
│  Lifetime: Until password change or vault re-encryption     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Key Material

| Key | Algorithm | Length | Lifetime | Usage |
|-----|-----------|--------|----------|-------|
| Password | — | variable | Until change | User authentication |
| Salt | — | 16 bytes | Per-vault | PBKDF2 input |
| Wrapping Key | AES-256-GCM | 32 bytes | Derived from password | Encrypts vault contents |
| Vault IV | — | 12 bytes | Per-vault | AES-GCM IV |

### 5.3 Backup Encryption Flow

```
┌──────────────────────────────────────────────────────────────┐
│              VAULT ENCRYPTION (BACKUP)                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Collect device keys:                                    │
│     vault = { ik: IK_jwk, spk: SPK_jwk,                   │
│               spk_signature: sig, opk_pool: [...] }         │
│                                                              │
│  2. Derive wrapping key:                                    │
│     salt = crypto.getRandomValues(new Uint8Array(16))      │
│     password_key = PBKDF2-SHA256(password, salt, 600000)   │
│                                                              │
│  3. Encrypt vault:                                          │
│     iv = crypto.getRandomValues(new Uint8Array(12))        │
│     ciphertext = AES-GCM(password_key, iv, JSON(vault))   │
│                                                              │
│  4. Store on server:                                        │
│     users.encrypted_private_key = ciphertext               │
│     users.key_salt = salt                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.4 Server Visibility

| What Server Sees | What Server Cannot See |
|------------------|----------------------|
| Encrypted vault blob | Private keys |
| PBKDF2 salt | Password |
| Key version number | Vault contents |
| Vault creation timestamp | Device identity |
| | OPK pool |

### 5.5 Domain Isolation Rules

```
Backup keys are NEVER used for:
  ✗ Message encryption
  ✗ Attachment encryption
  ✗ DM session establishment
  ✗ Channel MLS operations
  ✗ Any runtime cryptographic operation

Backup keys are used ONLY for:
  ✓ Encrypting private keys for server storage
  ✓ Decrypting private keys on new device login
  ✓ Multi-device key recovery
  ✓ Password change → re-encryption of vault
```

---

## 6. Identity Keys — Long-Lived Credentials

### 6.1 Identity Key Role Across Domains

Identity keys are the root of trust for all domains but are used differently in each:

```
┌──────────────────────────────────────────────────────────────┐
│              IDENTITY KEY USAGE PER DOMAIN                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Domain          │ IK Usage                                  │
│  ────────────────│────────────────────────────────────────── │
│  DMs             │ Signs SPK for X3DH                        │
│                  │ Authenticates device in TOFU model        │
│                  │ Signs key rotation statements             │
│                                                              │
│  Hubs/Channels   │ Signs leaf node in MLS ratchet tree      │
│                  │ Signs commits (via leaf signature)        │
│                  │ Authenticates device in MLS group         │
│                                                              │
│  Attachments     │ Not directly used (wrapped by session key)│
│                                                              │
│  Backups         │ Stored encrypted in vault                │
│                  │ Recovered via password + PBKDF2           │
│                                                              │
│  Server Auth     │ NOT used (JWT is password-based)         │
│                  │ Consider adding IK-based auth in future   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Identity Key Lifecycle

```
  Generate          Publish           Use               Rotate
  ────────          ───────           ───               ──────
  Device            Upload IK_pub     Sign SPK           Generate new IK
  registration      to server         Sign leaf          Sign rotation
  (new device)      Upload KeyPkg     Verify peers       Publish new IK
                    to MLS server     Sign commits       Old IK preserved
                                      TOFU pinning       for 30 days
```

---

## 7. Complete Key Isolation Matrix

```
┌──────────────────────────────────────────────────────────────┐
│              KEY ISOLATION MATRIX                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              DM Key  │ Hub Key │ Media Key │ Backup Key      │
│  ───────────────────┼─────────┼───────────┼──────────────── │
│  DM Key             │   ✓     │    ✗      │     ✗     ✗    │
│  Hub Key            │   ✗     │    ✓      │     ✗     ✗    │
│  Media Key          │   ✗     │    ✗      │     ✓     ✗    │
│  Backup Key         │   ✗     │    ✗      │     ✗     ✓    │
│  Identity Key       │   ✗*    │    ✗*     │     ✗     ✗*   │
│  ─────────────────────────────────────────────────────────── │
│  * Identity key is used for signing/authentication only,     │
│    never for symmetric encryption.                           │
│                                                              │
│  RULE: No key from one domain is ever used as input to      │
│  another domain's key derivation.                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Server Knowledge — Complete Reference

### 8.1 Per-Domain Server Visibility

```
┌──────────────────────────────────────────────────────────────┐
│              SERVER KNOWLEDGE MAP                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  DOMAIN 1: DMs                                               │
│  ┌──────────────────────────────────────────────┐           │
│  │ ✓ Sender/Recipient user IDs                  │           │
│  │ ✓ Ciphertext (encrypted)                     │           │
│  │ ✓ Timestamps                                 │           │
│  │ ✓ Online/offline status                      │           │
│  │ ✓ Message count per conversation             │           │
│  │ ✓ Ciphertext length (≈ plaintext length)     │           │
│  │                                              │           │
│  │ ✗ Plaintext messages                         │           │
│  │ ✗ Message content                            │           │
│  │ ✗ Encryption keys                            │           │
│  │ ✗ Ratchet state                              │           │
│  │ ✗ Session keys                               │           │
│  │ ✗ Identity private keys                      │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  DOMAIN 2: Hubs/Channels                                     │
│  ┌──────────────────────────────────────────────┐           │
│  │ ✓ Channel membership (user IDs)              │           │
│  │ ✓ Commit timestamps                          │           │
│  │ ✓ Ciphertext                                 │           │
│  │ ✓ Epoch number                               │           │
│  │ ✓ Message sizes                              │           │
│  │ ✓ KeyPackage presence                        │           │
│  │                                              │           │
│  │ ✗ Message plaintext                          │           │
│  │ ✗ Epoch secrets                              │           │
│  │ ✗ EncKey / MICKey                            │           │
│  │ ✗ Tree root secret                           │           │
│  │ ✗ Leaf path secrets                          │           │
│  │ ✗ Device identity private keys               │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  DOMAIN 3: Attachments                                       │
│  ┌──────────────────────────────────────────────┐           │
│  │ ✓ Encrypted file bytes (on disk)             │           │
│  │ ✓ Encrypted metadata                         │           │
│  │ ✓ File IVs                                   │           │
│  │ ✓ Wrapped media key (opaque blob)            │           │
│  │ ✓ File size (on disk)                        │           │
│  │                                              │           │
│  │ ✗ File content                               │           │
│  │ ✗ File name                                  │           │
│  │ ✗ MIME type                                  │           │
│  │ ✗ Media key                                  │           │
│  │ ✗ Thumbnail content                          │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  DOMAIN 4: Backups                                           │
│  ┌──────────────────────────────────────────────┐           │
│  │ ✓ Encrypted vault blob                       │           │
│  │ ✓ PBKDF2 salt                               │           │
│  │ ✓ Key version number                         │           │
│  │                                              │           │
│  │ ✗ Private keys                               │           │
│  │ ✗ Password                                   │           │
│  │ ✗ Vault contents                             │           │
│  │ ✗ Device identity details                    │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 What Server Can Never Do

```
┌──────────────────────────────────────────────────────────────┐
│              SERVER PROHIBITIONS                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  The server CANNOT:                                          │
│                                                              │
│  1. Decrypt any message (DM or channel)                     │
│  2. Read any attachment content                             │
│  3. Derive any session/epoch keys                           │
│  4. Forge valid MLS commits (no signing keys)               │
│  5. Add members to MLS groups (no proposal signing)         │
│  6. Impersonate a device (no identity private keys)         │
│  7. Decrypt vault contents (no password)                    │
│  8. Decrypt wrapped media keys (no session/epoch keys)      │
│  9. Read file names or metadata                             │
│  10. Decrypt private key backups                            │
│                                                              │
│  The server CAN:                                             │
│                                                              │
│  1. Store encrypted blobs                                   │
│  2. Relay ciphertexts                                       │
│  3. Order MLS commits (prevents split-brain)                │
│  4. Validate commit signatures (has IK public keys)         │
│  5. Enforce permission checks                               │
│  6. Track membership and online status                      │
│  7. Delete key material (device revocation)                 │
│  8. Deliver Welcome messages                                │
│  9. Store pending commits for offline members               │
│  10. Rate-limit operations                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Key Cross-Domain Interaction Rules

### 9.1 Allowed Cross-Domain Operations

```
┌──────────────────────────────────────────────────────────────┐
│              CROSS-DOMAIN OPERATIONS                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ✓ ALLOWED:                                                  │
│  ──────────                                                  │
│  1. DM session key wraps attachment media key               │
│     (DM domain → Attachment domain, one-way wrap)           │
│                                                              │
│  2. Channel EncKey wraps attachment media key               │
│     (Hub domain → Attachment domain, one-way wrap)          │
│                                                              │
│  3. Identity key signs SPK (DM domain)                      │
│     Identity key signs leaf node (Hub domain)               │
│     (Same key, different contexts, both signing)            │
│                                                              │
│  4. Password derives wrapping key (Backup domain)           │
│     Wrapping key encrypts identity keys                     │
│     (Backup domain → all domains, recovery only)            │
│                                                              │
│  ✗ FORBIDDEN:                                                │
│  ────────────                                                │
│  1. DM session key used for channel encryption              │
│  2. Channel EncKey used for DM encryption                   │
│  3. Attachment media key used for message encryption        │
│  4. Backup wrapping key used for any runtime operation      │
│  5. Any key reused across domains for encryption            │
│  6. Any key used for both signing and encryption            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 9.2 Key Derivation Separation

Each domain uses distinct HKDF info strings to prevent key material overlap:

```
DM Domain:
  X3DH:     info = "Vault2E_X3DH_v1"
  Ratchet:  info = "Vault2E_Ratchet_v1"

Hub Domain:
  MLS:      info = "Vault2E_MLS_v1"
  Epoch:    info = "Vault2E_Epoch_v1"

Attachment Domain:
  Wrap:     info = "Vault2E_AttachmentWrap_v1"

Backup Domain:
  Vault:    info = "Vault2E_VaultBackup_v1"
```

---

## 10. Domain Separation Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  USER PASSWORD                                                       │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────┐                                                │
│  │ PBKDF2 600K      │                                                │
│  └────────┬────────┘                                                │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐     ┌──────────────────────────────────┐       │
│  │ WRAPPING KEY     │     │ DOMAIN 4: BACKUP                  │       │
│  │ (AES-256-GCM)   │────→│ Encrypts device private keys      │       │
│  └─────────────────┘     │ Stored on server (encrypted)      │       │
│                          └──────────────────────────────────┘       │
│                                                                      │
│  ┌─────────────────┐     ┌──────────────────────────────────┐       │
│  │ IDENTITY KEY     │     │ DOMAIN 1: DMs                      │       │
│  │ (Ed25519,        │────→│ Signs SPK, authenticates device   │       │
│  │  per device)     │     │ X3DH + Double Ratchet sessions    │       │
│  └─────────────────┘     └──────────────────────────────────┘       │
│           │                                                          │
│           │              ┌──────────────────────────────────┐       │
│           └─────────────→│ DOMAIN 2: HUBS/CHANNELS            │       │
│                          │ Signs leaf node, signs commits    │       │
│                          │ MLS ratchet tree per channel      │       │
│                          └──────────────────────────────────┘       │
│                                                                      │
│  ┌─────────────────┐     ┌──────────────────────────────────┐       │
│  │ MEDIA KEY        │     │ DOMAIN 3: ATTACHMENTS              │       │
│  │ (random AES-256, │────→│ Encrypts single file + metadata   │       │
│  │  per file)       │     │ Wrapped by DM/channel key         │       │
│  └─────────────────┘     └──────────────────────────────────┘       │
│                                                                      │
│  ┌─────────────────┐     ┌──────────────────────────────────┐       │
│  │ SESSION/EPOCH    │     │ MESSAGE ENCRYPTION                │       │
│  │ KEYS             │────→│ DM: Double Ratchet MK             │       │
│  │ (derived)        │     │ Hub: MLS EncKey per epoch         │       │
│  └─────────────────┘     └──────────────────────────────────┘       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 11. Security Guarantees Summary

| Guarantee | DM Domain | Hub Domain | Attachment Domain | Backup Domain |
|-----------|-----------|------------|-------------------|---------------|
| Forward Secrecy | ✓ Per-message | ✓ Per-epoch | N/A (random key) | N/A (static) |
| Post-Compromise | ✓ DH ratchet | ✓ Key update | N/A | N/A |
| Key Isolation | ✓ Per-session | ✓ Per-epoch | ✓ Per-file | ✓ Per-vault |
| Server Blind | ✓ ✓ | ✓ ✓ | ✓ ✓ | ✓ ✓ |
| Replay Protection | ✓ Single-use MK | ✓ Single-use MK | ✓ AES-GCM tag | ✓ N/A |
| Device Revocation | ✓ Per-device IK | ✓ Per-leaf removal | N/A | ✓ Re-encrypt vault |
| Async Delivery | ✓ Prekey bundles | ✓ Welcome msg | ✓ N/A | ✓ N/A |
| Offline Recovery | ✓ Session resync | ✓ Epoch sync | ✓ N/A | ✓ Password decrypt |
