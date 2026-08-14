# VaultChat — Security & E2EE Documentation

> **Last updated**: 2026-08-14  
> **Status**: E2EE properly implemented — one significant gap (channel key re-distribution)

---

## Executive Summary

VaultChat implements end-to-end encryption using **ECDH P-256** key exchange and **AES-256-GCM** message encryption. The server **never sees plaintext** — all messages, attachments, and channel keys are encrypted client-side before transmission. Private keys are encrypted with **PBKDF2 + AES-256-GCM** before server storage.

**Security Rating: Good** — strong crypto primitives, timing-safe comparisons, parameterized SQL, TOFU key verification. Falls short of "Strong" due to missing rate limits on sockets and key rotation, and a channel key re-distribution gap when members are added after creation.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT SIDE                          │
│                                                             │
│  ┌──────────┐    ECDH P-256     ┌──────────────────┐       │
│  │ User A   │ ───────────────── │ User B Public Key │       │
│  │ Private  │                   │ (from server)     │       │
│  │ Key      │                   └──────────────────┘       │
│  └──────────┘                                               │
│       │                                                     │
│       ▼                                                     │
│  deriveSharedKey() → AES-256-GCM shared key                │
│       │                                                     │
│       ▼                                                     │
│  encryptMessage(text, sharedKey) → {ciphertext, iv}        │
│       │                                                     │
└───────┼─────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                        SERVER SIDE                          │
│                                                             │
│  Stores: ciphertext + iv (NO plaintext)                    │
│  Stores: encrypted channel keys per member                 │
│  Never has access to private keys or shared keys           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Cryptographic Primitives

### 2.1 Key Exchange: ECDH P-256
- **Algorithm**: Elliptic Curve Diffie-Hellman on NIST P-256 curve
- **Purpose**: Derive a shared AES key between two peers without transmitting the key
- **WebCrypto API**: `crypto.subtle.deriveKey()` with `{ name: 'ECDH', public: peerPublicKey }`
- **Key properties**: `extractable: false`, usage `['encrypt', 'decrypt']`
- **Implementation**: `deriveSharedKey()` in `crypto.ts`

### 2.2 Message Encryption: AES-256-GCM
- **Algorithm**: AES-GCM (Galois/Counter Mode)
- **Key size**: 256 bits
- **IV**: Fresh random 12-byte (96-bit) IV for every message via `crypto.getRandomValues(new Uint8Array(12))`
- **Authentication**: GCM provides both confidentiality and integrity (16-byte auth tag appended to ciphertext)
- **Implementation**: `encryptMessage()` / `decryptMessage()` in `crypto.ts`

### 2.3 Key Generation: ECDH P-256 + ECDSA P-256
- **ECDH P-256**: For key exchange (client-to-client)
- **ECDSA P-256**: For key rotation signatures (separate key pair, required by WebCrypto)
- **Key pair generation**: `generateKeyPair()` and `generateSigningKeyPair()`
- **Key export**: SPKI format for transport, JWK for IndexedDB storage

### 2.4 Vault Encryption: PBKDF2 + AES-256-GCM
- **Password key derivation**: PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte random salt
- **Key wrapping**: Derived password key wraps the ECDH + ECDSA private key JWKs
- **Implementation**: `encryptKeyVaultPair()` / `decryptKeyVaultPair()` in `crypto.ts`

### 2.5 Key Rotation: ECDSA Signatures
- **Signing key**: ECDSA P-256 (separate from ECDH keys)
- **Statement format**: `petroshield-key-rotation-v1\n{newPublicKey}\n{newSigningPublicKey}\n{oldPublicKey}`
- **Verification**: `verifyKeyRotationSignature()` checks signature against old public key
- **TOFU**: First key encounter pins the fingerprint in IndexedDB

---

## 3. Security Properties

### 3.1 Confidentiality
- ✅ Messages encrypted with AES-256-GCM before leaving the client
- ✅ Attachments encrypted client-side before upload
- ✅ Channel keys wrapped per-member with ECDH shared keys
- ✅ Server stores only ciphertext + IV, never plaintext
- ✅ Private keys encrypted with PBKDF2 + AES-256-GCM before server storage

### 3.2 Integrity
- ✅ AES-GCM provides 16-byte authentication tag
- ✅ Tampered ciphertext will fail decryption with `OperationError`
- ✅ TOFU fingerprint comparison uses strict full-string equality (no prefix matching)

### 3.3 Authentication
- ✅ JWT (HS256) with timing-safe signature verification
- ✅ Bcrypt (12 rounds) for password hashing
- ✅ Legacy SHA-256 passwords use `crypto.timingSafeEqual` for timing-safe comparison
- ✅ Socket auth via JWT middleware — identity verified on every connection
- ✅ Server resolves roles from database, never trusts client-supplied role

### 3.4 Forward Secrecy
- ⚠️ **Partial** — No perfect forward secrecy (PFS). If a private key is compromised, all past messages encrypted with that key can be decrypted. Mitigated by key rotation (creates new ECDH key pairs) and TOFU verification.

### 3.5 Key Rotation
- ✅ ECDSA-signed rotation statements bind old and new keys
- ✅ Key version incremented on rotation
- ✅ TOFU verification checks old fingerprint matches
- ✅ `verifyKeyRotationSignature` is fail-closed (returns `false` on any error)
- ✅ Client-side `mitmWarnings` set on failed verification, blocking message send

---

## 4. Security Controls

| Control | Implementation | Status |
|---------|---------------|--------|
| JWT signature | `crypto.timingSafeEqual` | ✅ Timing-safe |
| Legacy password hash | `crypto.timingSafeEqual` | ✅ Timing-safe |
| Bcrypt | 12 rounds | ✅ OWASP compliant |
| SQL injection | Parameterized queries (`$1, $2...`) | ✅ |
| Rate limiting | Auth endpoints: 10 req/min | ✅ |
| Socket auth | JWT middleware on connection | ✅ |
| Role verification | Server-side DB lookup | ✅ |
| Input validation | Ciphertext type check, length limits | ✅ |
| CORS | Restricted origin | ✅ |
| Helmet | Security headers | ✅ |
| Fail-closed TOFU | Returns `false` on any error | ✅ |

---

## 5. Known Issues

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | **High** | Channel key not re-distributed when new members added after creation | Needs fix |
| 2 | **Medium** | No rate limiting on socket events (message/reaction/typing spam) | Needs fix |
| 3 | **Medium** | No rate limiting on `/api/auth/rotate-key` | Needs fix |
| 4 | **Medium** | PBKDF2 iterations (100K) below OWASP recommendation (600K) | Can upgrade |
| 5 | **Low** | JWT blocklist in-memory, resets on server restart | Acceptable (1h expiry) |
| 6 | **Low** | No rate limiting on attachment uploads | Low priority |

---

## 6. Recommendations

1. **[Critical] Fix channel key re-distribution**: When members are added to a channel, re-encrypt the channel key for each new member and POST envelopes to the server
2. **[High] Socket rate limiting**: Add per-user rate limits on `message:send`, `reaction:add`, `user:typing`
3. **[High] Key rotation rate limiting**: Add rate limit on `/api/auth/rotate-key` (3/hour/user)
4. **[Medium] PBKDF2 iterations**: Upgrade from 100K to 600K for OWASP compliance
5. **[Low] Attachment rate limiting**: Limit uploads to 10/min/user
