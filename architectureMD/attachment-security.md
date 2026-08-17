# Vault2E — Attachment Security Lifecycle

**Author:** Senior Distributed Systems Engineer
**Date:** 2026-08-17
**Scope:** End-to-end encrypted attachment lifecycle, retry semantics, crash recovery
**Files:** `client/src/lib/attachments.ts`, `client/src/lib/crypto.ts`, `server/src/db/index.ts`, `server/src/db/schema.sql`

---

## 1. State Definitions

### Happy Path States

| State | Description | Location |
|-------|-------------|----------|
| `CREATE` | User selects file; File object obtained | Client memory |
| `GENERATE_RANDOM_MEDIA_KEY` | Fresh AES-256-GCM key generated for this attachment | Client memory |
| `ENCRYPT` | Binary payload encrypted with media key; metadata encrypted separately | Client memory |
| `HASH` | SHA-256 of ciphertext computed for integrity verification | Client memory |
| `UPLOAD_CIPHERTEXT` | Encrypted blob + metadata uploaded to server via XHR with progress | Client → Server disk |
| `SEND_E2EE_METADATA` | Media key wrapped by conversation key (DM ECDH or channel AES); sent with message | Client → Socket |
| `DOWNLOAD` | Client fetches encrypted blob from server | Server disk → Client memory |
| `VERIFY_HASH` | SHA-256 of downloaded ciphertext compared to expected hash | Client memory |
| `DECRYPT` | Media key unwrapped; AES-256-GCM decryption of binary payload | Client memory |
| `VERIFY_AUTHENTICATION_TAG` | AES-GCM authentication tag verified (implicit in decrypt) | Client memory (WebCrypto) |
| `READY` | Decrypted Blob URL created; attachment displayed | Client DOM |

### Failure States

| State | Description | Recovery |
|-------|-------------|----------|
| `UPLOAD_FAILED` | XHR error, network timeout, or server 4xx/5xx | Retry with exponential backoff |
| `DOWNLOAD_FAILED` | Fetch error, network timeout, or server error | Retry with exponential backoff |
| `HASH_MISMATCH` | SHA-256 of downloaded ciphertext ≠ expected hash | Re-download; if persistent, report corruption |
| `DECRYPTION_FAILED` | AES-GCM tag invalid or wrong key | Report to user; offer cleanup |
| `AUTHENTICATION_FAILED` | GCM authentication tag verification failed (subset of decryption failure) | Same as DECRYPTION_FAILED |
| `MISSING_BLOB` | Server returns 404 for attachment ID | Attachment never linked or orphaned; cleanup |
| `CORRUPTED_BLOB` | File on disk is truncated or tampered | Re-upload from client if sender; otherwise report |

---

## 2. State Transition Diagram — Upload

```
┌──────────────────────────────────────────────────────────────────────┐
│                         UPLOAD LIFECYCLE                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐                                                       │
│  │  CREATE   │  User selects file via <input type="file">            │
│  └────┬─────┘                                                       │
│       │                                                              │
│       │  validateFile(file)                                         │
│       │  • Check MIME type                                           │
│       │  • Check size ≤ 25 MB                                        │
│       │  • Reject if invalid                                         │
│       │                                                              │
│       ▼                                                              │
│  ┌──────────────────────────┐                                       │
│  │ GENERATE_RANDOM_MEDIA_KEY │                                       │
│  │ • crypto.getRandomValues()│                                       │
│  │   for 32-byte AES key    │                                       │
│  └────────────┬─────────────┘                                       │
│               │                                                      │
│               ▼                                                      │
│  ┌──────────────────────┐                                           │
│  │       ENCRYPT         │                                           │
│  │ 1. Read file as       │                                           │
│  │    ArrayBuffer         │                                           │
│  │ 2. Generate random    │                                           │
│  │    12-byte IV          │                                           │
│  │ 3. AES-256-GCM encrypt│                                           │
│  │    binary payload      │                                           │
│  │ 4. Encrypt metadata:  │                                           │
│  │    {fileName, size,    │                                           │
│  │     mimeType, thumb}  │                                           │
│  │    with same key       │                                           │
│  │    separate IV         │                                           │
│  └────────────┬──────────┘                                           │
│               │                                                      │
│               ▼                                                      │
│  ┌──────────────────┐                                               │
│  │      HASH         │                                               │
│  │ SHA-256(ciphertext)│                                               │
│  │ → integrity hash   │                                               │
│  └────────┬─────────┘                                               │
│           │                                                          │
│           ▼                                                          │
│  ┌──────────────────────┐      FAIL        ┌──────────────┐        │
│  │  UPLOAD_CIPHERTEXT    │ ───────────────→ │ UPLOAD_FAILED │        │
│  │ POST /api/attachments │                   │               │        │
│  │ FormData:             │      RETRY       │ • Exponential │        │
│  │  • encrypted blob     │ ←─────────────── │   backoff     │        │
│  │  • encrypted metadata │                   │ • Max 5 tries │        │
│  │  • IV (binary)        │                   └──────────────┘        │
│  │  • IV (metadata)      │                                           │
│  └────────────┬─────────┘                                           │
│               │ 201 Created                                          │
│               ▼                                                      │
│  ┌──────────────────────────┐                                       │
│  │  SEND_E2EE_METADATA      │                                       │
│  │ • Wrap media key with    │                                       │
│  │   conversation key       │                                       │
│  │ • Include in message:    │                                       │
│  │   { attachmentId,        │                                       │
│  │     wrappedMediaKey,     │                                       │
│  │     iv, metadataIv,      │                                       │
│  │     hash }               │                                       │
│  │ • socket.emit(           │                                       │
│  │   'message:send', msg)   │                                       │
│  └──────────────────────────┘                                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. State Transition Diagram — Download

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DOWNLOAD LIFECYCLE                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐      FAIL        ┌───────────────┐           │
│  │     DOWNLOAD       │ ──────────────→ │ DOWNLOAD_FAILED│           │
│  │ GET /api/          │                  │                │           │
│  │  attachments/:id   │     RETRY       │ • Exponential  │           │
│  │ Response: binary   │ ←────────────── │   backoff      │           │
│  │  encrypted blob    │                  │ • Max 5 tries  │           │
│  └────────┬──────────┘                  └───────────────┘           │
│           │ 200 OK                                                   │
│           ▼                                                          │
│  ┌──────────────────────┐      FAIL     ┌────────────────┐         │
│  │    VERIFY_HASH        │ ───────────→ │ HASH_MISMATCH   │         │
│  │ SHA-256(ciphertext)  │               │                  │         │
│  │ == expected hash?    │  RE-DOWNLOAD  │ • Re-download    │         │
│  └────────┬─────────────┘ ←──────────── │ • Max 3 tries   │         │
│           │ PASS                         │ • Report corrupt │         │
│           ▼                              └────────────────┘         │
│  ┌──────────────────────┐                                           │
│  │       DECRYPT         │                                           │
│  │ 1. Unwrap media key   │                                           │
│  │    with conversation  │                                           │
│  │    key (ECDH/channel) │                                           │
│  │ 2. AES-256-GCM.decrypt│                                           │
│  │    (mediaKey, iv,     │                                           │
│  │     ciphertext)       │                                           │
│  └────────┬─────────────┘                                           │
│           │                                                          │
│      ┌────┴────┐                                                    │
│      │         │                                                    │
│   [PASS]    [FAIL]                                                   │
│      │         │                                                    │
│      │         ▼                                                    │
│      │  ┌─────────────────────────┐                                 │
│      │  │ DECRYPTION_FAILED /      │                                 │
│      │  │ AUTHENTICATION_FAILED     │                                 │
│      │  │ • GCM tag invalid        │                                 │
│      │  │ • Wrong key              │                                 │
│      │  │ • Show error to user     │                                 │
│      │  │ • Offer cleanup button   │                                 │
│      │  └─────────────────────────┘                                 │
│      │                                                              │
│      ▼                                                              │
│  ┌──────────────────────────┐                                       │
│  │ VERIFY_AUTHENTICATION_TAG │                                       │
│  │ (Implicit in AES-GCM     │                                       │
│  │  decrypt — WebCrypto      │                                       │
│  │  rejects if tag invalid)  │                                       │
│  └────────────┬─────────────┘                                       │
│               │                                                      │
│               ▼                                                      │
│  ┌──────────────────┐                                               │
│  │      READY        │                                               │
│  │ • Blob URL created│                                               │
│  │ • Display in UI   │                                               │
│  │ • Revoke on unmount│                                              │
│  └──────────────────┘                                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Hierarchy

```
┌─────────────────────────────────────────────────────┐
│              ATTACHMENT KEY HIERARCHY                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  DM Attachment:                                     │
│    ECDH(my_private, peer_public)                    │
│         │                                           │
│         ▼                                           │
│    ConversationKey (AES-256-GCM)                    │
│         │                                           │
│         ├── wraps MediaKey (random per-attachment)  │
│         │                                           │
│         └── MediaKey encrypts:                      │
│               • Binary payload (AES-256-GCM)        │
│               • Metadata JSON (AES-256-GCM)         │
│                                                     │
│  Channel Attachment:                                │
│    ChannelSymmetricKey (AES-256-GCM, per-channel)   │
│         │                                           │
│         ├── wraps MediaKey (random per-attachment)  │
│         │                                           │
│         └── MediaKey encrypts:                      │
│               • Binary payload (AES-256-GCM)        │
│               • Metadata JSON (AES-256-GCM)         │
│                                                     │
│  Per-Attachment Key好处:                             │
│  • Conversation key rotation does NOT require        │
│    re-encrypting old attachments                     │
│  • Compromising one attachment key does NOT expose   │
│    other attachments                                 │
│  • Media key is short-lived (only during encrypt/   │
│    decrypt); never stored persistently               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 5. Wire Format

```
┌───────────────────────────────────────────────────────────────┐
│                 ATTACHMENT UPLOAD (FormData)                    │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Field: "blob"                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ AES-256-GCM encrypted binary payload                    │ │
│  │ IV: 12 bytes random (included in field "iv")            │ │
│  │ Tag: 16 bytes (appended by WebCrypto)                   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  Field: "metadata"                                            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ AES-256-GCM encrypted JSON string                       │ │
│  │ IV: 12 bytes random (included in field "metadata_iv")   │ │
│  │                                                          │ │
│  │ Plaintext JSON:                                          │ │
│  │ {                                                        │ │
│  │   "fileName": "photo.jpg",                              │ │
│  │   "fileSize": 1048576,                                  │ │
│  │   "mimeType": "image/jpeg",                             │ │
│  │   "thumbnail": "base64..."  (optional, images only)     │ │
│  │ }                                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  Fields: "iv", "metadata_iv" (Base64 strings)                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

```
┌───────────────────────────────────────────────────────────────┐
│           MESSAGE METADATA (in message ciphertext)             │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  {                                                            │
│    "text": "Check this out",                                 │
│    "attachment": {                                            │
│      "id": "att_1692278400_a1b2c3d4",                       │
│      "wrappedMediaKey": "base64...",  // AES-GCM encrypted   │
│      "mediaKeyIv": "base64...",         // with convo key    │
│      "hash": "sha256hex..."           // of ciphertext       │
│    }                                                          │
│  }                                                            │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 6. Retry Semantics

### 6.1 Upload Retry

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | 0ms | Initial upload attempt |
| 2 | 1000ms | Retry with same FormData (idempotent server: `ON CONFLICT DO NOTHING`) |
| 3 | 2000ms | Retry |
| 4 | 4000ms | Retry |
| 5 | 8000ms | Final retry; after failure, transition to `UPLOAD_FAILED` |

**Server idempotency:** Attachment ID is client-generated (`att_{timestamp}_{hex}`). Duplicate uploads with same ID overwrite via `INSERT ... ON CONFLICT (id) DO UPDATE` (implicit in `upsertChannelKeys` pattern). However, `insertAttachment` uses plain `INSERT` — duplicate upload would fail with PK conflict. Client should check if attachment already exists before retrying.

**Recommended fix:** Change `insertAttachment` to use `INSERT ... ON CONFLICT (id) DO NOTHING` for idempotent uploads.

### 6.2 Download Retry

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | 0ms | Initial download |
| 2 | 1000ms | Retry |
| 3 | 2000ms | Retry |
| 4 | 4000ms | Retry |
| 5 | 8000ms | Final retry; transition to `DOWNLOAD_FAILED` |

**Hash verification:** After each successful download, compute `SHA-256(ciphertext)` and compare to expected hash. If mismatch, re-download (up to 3 times total). If persistent, transition to `HASH_MISMATCH`.

### 6.3 Decrypt Retry

No retry for decryption. AES-GCM is deterministic — same inputs always produce same output. If decrypt fails, it will always fail. Transition to `DECRYPTION_FAILED` immediately.

---

## 7. Crash Recovery

### 7.1 Crash During Upload

| Crash Point | State | Recovery |
|-------------|-------|----------|
| Before FormData assembly | File in memory only | User must re-select file |
| During XHR upload (progress) | Partial upload on server | Server has partial `.enc` file; orphaned attachment cleanup runs after 30 min (`cleanupOrphanedAttachments`). Client retries from start. |
| After 201 response, before message send | Attachment stored, not linked to message | Orphaned attachment cleanup. Client re-uploads or re-links. |
| After message send, before ACK | Message persisted server-side; attachment linked | Server has everything. ACK redelivered on reconnect. |

### 7.2 Crash During Download

| Crash Point | State | Recovery |
|-------------|-------|----------|
| Before fetch | Nothing in memory | Re-fetch on next render |
| During fetch (partial download) | Partial ciphertext in memory | Discard; re-fetch on next render |
| After fetch, before decrypt | Full ciphertext in memory | Re-derive key, re-decrypt (idempotent) |
| After decrypt, before Blob URL creation | Plaintext in memory | Re-decrypt (idempotent); plaintext is ephemeral |
| After Blob URL, before display | Blob URL created | Browser GC handles; re-create on next render |

### 7.3 Crash During Key Wrap/Unwrap

| Crash Point | State | Recovery |
|-------------|-------|----------|
| During media key generation | No key generated | Re-generate on retry (new random key) |
| During conversation key derivation (ECDH) | Shared key not derived | Re-derive from cached or re-computed ECDH |
| During media key wrap (for sending) | Key not wrapped | Re-wrap on retry |
| During media key unwrap (for receiving) | Key not unwrapped | Re-unwrap using stored wrapped key |

---

## 8. Server-Side Attachment Handling

### 8.1 Storage

```
Server receives:
  1. Encrypted binary blob → stored as uploads/{att_id}.enc
  2. Encrypted metadata → stored in attachments.encrypted_metadata
  3. Both IVs → stored in attachments.iv and attachments.metadata_iv
  4. message_id → initially NULL, linked after message creation
```

### 8.2 Access Control

| Attachment Type | Download Condition | Code Reference |
|----------------|-------------------|----------------|
| DM attachment | `sender_id == userId OR recipient_id == userId` | `index.ts:1776-1782` |
| Channel attachment | `user_id IN channel_members(channel_id)` | `index.ts:1777-1779` |
| Unlinked (message_id IS NULL) | Rejected (403) | `index.ts:1788` |

### 8.3 Path Traversal Protection

```typescript
const abs = path.resolve(path.join(uploadsDir, attachment.file_path));
if (!abs.startsWith(uploadsDir)) {
  return res.status(403).json({ error: 'Access denied' });
}
```

### 8.4 Orphaned Attachment Cleanup

- Runs every 30 minutes on server
- Deletes `attachments` where `message_id IS NULL AND created_at < (now - 30min)`
- Deletes corresponding `.enc` files from disk
- Prevents storage exhaustion from abandoned uploads

---

## 9. Integrity Verification Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    INTEGRITY CHAIN                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  UPLOAD:                                                     │
│  1. Client: SHA-256(ciphertext) → hash                       │
│  2. Client: hash included in message metadata                 │
│  3. Server: stores ciphertext + hash (in encrypted metadata)  │
│                                                               │
│  DOWNLOAD:                                                   │
│  1. Client: fetch ciphertext from server                      │
│  2. Client: SHA-256(fetched_ciphertext) → computed_hash       │
│  3. Client: compare computed_hash == expected_hash             │
│  4. If match → proceed to decrypt                             │
│  5. If mismatch → re-download (up to 3x)                      │
│                                                               │
│  DECRYPT:                                                    │
│  1. Client: AES-256-GCM.decrypt(mediaKey, iv, ciphertext)    │
│  2. WebCrypto: verifies 16-byte authentication tag            │
│  3. If tag valid → plaintext returned                         │
│  4. If tag invalid → OperationError thrown → DECRYPTION_FAILED│
│                                                               │
│  NOTE: GCM tag verification is implicit in decrypt.           │
│  There is no separate "verify tag" step — WebCrypto does it   │
│  atomically. If tag is invalid, decrypt throws immediately.   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Failure State Details

### 10.1 UPLOAD_FAILED

**Causes:** Network timeout, server 5xx, server disk full, rate limit exceeded (10/min/user)
**Client behavior:** Show retry button. Exponential backoff for auto-retry.
**Server state:** Partial `.enc` file may exist. Cleaned up by orphan cleanup.
**User impact:** Message not sent. Attachment not stored.

### 10.2 DOWNLOAD_FAILED

**Causes:** Network timeout, server 5xx, attachment deleted, access denied
**Client behavior:** Show retry button. Exponential backoff.
**Server state:** No change.
**User impact:** Cannot view attachment.

### 10.3 HASH_MISMATCH

**Causes:** Server stored corrupted data, network bit-flip (extremely rare with TLS), tampered file
**Client behavior:** Auto-re-download up to 3 times. If persistent, show "Attachment may be corrupted" warning.
**Server state:** Potentially corrupted `.enc` file.
**User impact:** Cannot verify attachment integrity.

### 10.4 DECRYPTION_FAILED

**Causes:** Wrong key (key rotated, peer changed), corrupted ciphertext, missing media key
**Client behavior:** Show "Unable to decrypt attachment" with option to cleanup.
**Server state:** No change.
**User impact:** Cannot view attachment content.

### 10.5 AUTHENTICATION_FAILED

**Causes:** Subset of DECRYPTION_FAILED — specifically GCM tag mismatch
**Client behavior:** Same as DECRYPTION_FAILED.
**Server state:** No change.
**User impact:** Same as DECRYPTION_FAILED.

### 10.6 MISSING_BLOB

**Causes:** Attachment ID references non-existent file, orphaned attachment cleaned up
**Client behavior:** Show "Attachment not found" message.
**Server state:** No `.enc` file on disk; DB record may or may not exist.
**User impact:** Cannot download attachment.

### 10.7 CORRUPTED_BLOB

**Causes:** File truncated on disk, disk I/O error, incomplete write
**Client behavior:** Hash mismatch detection triggers re-download. If sender, offer re-upload.
**Server state:** Corrupted `.enc` file on disk.
**User impact:** Cannot decrypt; data loss if sender no longer has original.

---

## 11. Thumbnail Handling

- Generated client-side for images: canvas downscale to 300px max dimension
- Stored inside encrypted metadata JSON as base64 data URL
- Encrypted with same media key as binary payload
- Serves as preview without downloading full attachment
- Size limit: ~10KB base64 string (negligible overhead)

---

## 12. Security Properties

| Property | Mechanism | Status |
|----------|-----------|--------|
| Confidentiality | AES-256-GCM with random media key per attachment | ✅ |
| Integrity | SHA-256 hash + GCM authentication tag | ✅ |
| Forward Secrecy | Per-attachment random key; key not persisted | ✅ |
| Replay Protection | None (same as messages) | ⚠️ |
| Access Control | Server-side DM/channel membership check | ✅ |
| Path Traversal | `abs.startsWith(uploadsDir)` check | ✅ |
| Metadata Privacy | Filename, size, type encrypted | ✅ |
| Denial of Service | 25MB max size, rate limit 10/min/user | ✅ |
| Orphan Cleanup | 30-minute TTL for unlinked attachments | ✅ |
