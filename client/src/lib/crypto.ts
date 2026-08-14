/**
 * PetroShield E2EE Cryptographic Engine
 * Built on native browser WebCrypto API (ECDH P-256 + AES-256-GCM + PBKDF2 Vault Wrapping)
 */

// Helper functions for ArrayBuffer <-> Base64 conversion
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks to avoid call stack / O(n²) issues
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

const getWebCrypto = (): Crypto => {
  if (typeof window !== 'undefined' && window.crypto) {
    return window.crypto;
  }
  return globalThis.crypto;
};

/**
 * Normalizes fingerprint strings for case-insensitive, alphanumeric comparison
 */
export function compareFingerprints(keyA: string, keyB: string): boolean {
  if (!keyA || !keyB) return false;
  const cleanA = keyA.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  const cleanB = keyB.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (cleanA.length === 0 || cleanB.length === 0) return false;
  // L3: Strict full-string comparison only — prefix matching is insecure
  return cleanA === cleanB;
}

/**
 * 1. Generates an ECDH key pair (P-256 curve)
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await getWebCrypto().subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Exports a public CryptoKey to SPKI format as a Base64 string for WebSocket transport
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await getWebCrypto().subtle.exportKey('spki', key);
  return arrayBufferToBase64(exported);
}

/**
 * Imports a raw SPKI Base64 public key string into a CryptoKey object
 */
export async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(spkiBase64);
  return await getWebCrypto().subtle.importKey(
    'spki',
    buffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

/**
 * Export key to JWK for local Dexie storage
 */
export async function exportKeyToJwk(key: CryptoKey): Promise<JsonWebKey> {
  return await getWebCrypto().subtle.exportKey('jwk', key);
}

/**
 * Generates a dedicated ECDSA P-256 signing keypair for key-rotation proofs.
 * Kept separate from the ECDH message key because WebCrypto forbids signing
 * with ECDH-derived keys (key_ops mismatch).
 */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return await getWebCrypto().subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

/**
 * Signs a key-rotation statement with the OLD (pre-rotation) ECDSA signing
 * private key. Returns an IEEE P1363 (r || s) base64 signature — the exact form
 * verified by Node's `crypto.verify` with `dsaEncoding: 'ieee-p1363'`.
 */
export async function signKeyRotation(
  newPublicKey: string,
  newSigningPublicKey: string,
  oldPublicKey: string,
  oldSigningPrivateKeyJwk: JsonWebKey
): Promise<string> {
  const signer = await getWebCrypto().subtle.importKey(
    'jwk',
    oldSigningPrivateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const encoder = new TextEncoder();
  const statement = encoder.encode(
    `petroshield-key-rotation-v1\n${newPublicKey}\n${newSigningPublicKey}\n${oldPublicKey}`
  );
  const signature = await getWebCrypto().subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signer,
    statement
  );
  return arrayBufferToBase64(signature);
}

/**
 * Verifies a key-rotation signature against the peer's PREVIOUS ECDSA signing
 * public key (SPKI base64). Any contact can verify the rotation chain.
 */
export async function verifyKeyRotationSignature(
  newPublicKey: string,
  newSigningPublicKey: string,
  oldPublicKey: string,
  signatureBase64: string,
  oldSigningPublicKey: string
): Promise<boolean> {
  try {
    const verifier = await getWebCrypto().subtle.importKey(
      'spki',
      base64ToArrayBuffer(oldSigningPublicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const encoder = new TextEncoder();
    const statement = encoder.encode(
      `petroshield-key-rotation-v1\n${newPublicKey}\n${newSigningPublicKey}\n${oldPublicKey}`
    );
    return await getWebCrypto().subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifier,
      base64ToArrayBuffer(signatureBase64),
      statement
    );
  } catch {
    return false;
  }
}

/**
 * Wraps the ECDH + ECDSA private-key JWKs into a single password-encrypted
 * vault payload for multi-device recovery (JSON { ecdh, ecdsa }).
 */
export async function encryptKeyVaultPair(
  ecdhJwk: JsonWebKey,
  ecdsaJwk: JsonWebKey,
  password: string
): Promise<{ encryptedPrivateKey: string; keySalt: string }> {
  const salt = getWebCrypto().getRandomValues(new Uint8Array(16));
  const iv = getWebCrypto().getRandomValues(new Uint8Array(12));
  const wrappingKey = await derivePasswordWrappingKey(password, salt);
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify({ ecdh: ecdhJwk, ecdsa: ecdsaJwk }));
  const ciphertextBuffer = await getWebCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    data
  );
  const combined = new Uint8Array(iv.length + ciphertextBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBuffer), iv.length);
  return {
    encryptedPrivateKey: arrayBufferToBase64(combined),
    keySalt: arrayBufferToBase64(salt),
  };
}

/**
 * Unwraps a decrypted vault into its key pair. Handles legacy single-JWK vaults
 * from before signing keys existed (ecdsa will be undefined).
 */
export function unwrapKeyVault(decryptedJson: JsonWebKey | any): { ecdh: JsonWebKey; ecdsa?: JsonWebKey } {
  if (decryptedJson?.ecdh && decryptedJson?.ecdsa) {
    return { ecdh: decryptedJson.ecdh, ecdsa: decryptedJson.ecdsa };
  }
  // Legacy vault: the whole JSON was the ECDH private JWK.
  return { ecdh: decryptedJson };
}

/**
 * Import key from JWK for restoring keypair from Dexie storage
 */
export async function importPrivateKeyFromJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await getWebCrypto().subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 3. Derives an AES-GCM 256-bit symmetric shared key from my private key and peer's public key
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  return await getWebCrypto().subtle.deriveKey(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false, // Shared key does not need to be extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * 4. Encrypts plaintext string into AES-256-GCM ciphertext + 12-byte IV (both Base64)
 */
export async function encryptMessage(
  text: string,
  sharedKey: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  // Generate fresh random 12-byte (96-bit) IV for each message
  const iv = getWebCrypto().getRandomValues(new Uint8Array(12));

  const encryptedBuffer = await getWebCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    sharedKey,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv)
  };
}

/**
 * 5. Decrypts AES-256-GCM ciphertext + IV back to plaintext string
 */
export async function decryptMessage(
  ciphertextBase64: string,
  ivBase64: string,
  sharedKey: CryptoKey
): Promise<string> {
  const ciphertextBuffer = base64ToArrayBuffer(ciphertextBase64);
  const ivBuffer = base64ToArrayBuffer(ivBase64);

  const decryptedBuffer = await getWebCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(ivBuffer)
    },
    sharedKey,
    ciphertextBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

// ── BINARY FILE ATTACHMENT ENCRYPTION (AES-256-GCM over ArrayBuffer) ─────────

/**
 * 6. Encrypts a raw binary ArrayBuffer (file contents) with AES-256-GCM.
 * Returns Base64 ciphertext + a fresh random 12-byte IV.
 */
export async function encryptBinaryData(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const iv = getWebCrypto().getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await getWebCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return {
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv)
  };
}

/**
 * 7. Decrypts an encrypted binary payload (ArrayBuffer) back to plain ArrayBuffer
 * using the given IV. No text decoding is performed — the raw file bytes are
 * returned so the client can build a Blob URL.
 */
export async function decryptBinaryData(
  ciphertext: ArrayBuffer | string,
  ivBase64: string,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const ivBuffer = new Uint8Array(base64ToArrayBuffer(ivBase64));
  const ciphertextBuffer = typeof ciphertext === 'string'
    ? base64ToArrayBuffer(ciphertext)
    : ciphertext;

  return await getWebCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    ciphertextBuffer
  );
}

/**
 * Generates an 8-character uppercase visual fingerprint snippet from a public key Base64 string
 */
export async function getFingerprint(publicKeyBase64: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(publicKeyBase64);
    const hashBuffer = await getWebCrypto().subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 8).toUpperCase();
  } catch {
    return publicKeyBase64.substring(0, 8).toUpperCase();
  }
}

/**
 * Computes full SHA-256 hash hex string of public key Base64
 */
export async function computePublicKeyFingerprint(publicKeyBase64: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(publicKeyBase64);
  const hashBuffer = await getWebCrypto().subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a symmetric AES-256-GCM key for Group Channels
 */
export async function generateChannelSymmetricKey(): Promise<CryptoKey> {
  return await getWebCrypto().subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Import symmetric key from JWK for group channels
 */
export async function importSymmetricKeyFromJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await getWebCrypto().subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// ── GROUP CHANNEL KEY ENCRYPTION & DECRYPTION FOR USER DISTRIBUTION ─────────

/**
 * Encrypts a channel's symmetric key JWK using an ECDH shared key derived for a specific target user
 */
export async function encryptChannelKeyForUser(
  channelKeyJwk: JsonWebKey,
  userSharedKey: CryptoKey
): Promise<{ encryptedKey: string; iv: string }> {
  const jwkString = JSON.stringify(channelKeyJwk);
  const { ciphertext, iv } = await encryptMessage(jwkString, userSharedKey);
  return { encryptedKey: ciphertext, iv };
}

/**
 * Decrypts a channel's symmetric key JWK using an ECDH shared key derived for a specific target user
 */
export async function decryptChannelKeyForUser(
  encryptedKeyBase64: string,
  ivBase64: string,
  userSharedKey: CryptoKey
): Promise<JsonWebKey> {
  const jwkString = await decryptMessage(encryptedKeyBase64, ivBase64, userSharedKey);
  return JSON.parse(jwkString);
}

// ── ENCRYPTED KEY VAULT (PBKDF2 + AES-GCM) ───────────────────────────────────

/**
 * Derives a 256-bit AES-GCM wrapping key from a user password using PBKDF2
 */
export async function derivePasswordWrappingKey(
  password: string,
  saltBuffer: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const baseKey = await getWebCrypto().subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return await getWebCrypto().subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts private key JWK with a password-derived key for server vault backup
 */
export async function encryptPrivateKeyVault(
  privateKeyJwk: JsonWebKey,
  password: string
): Promise<{ encryptedPrivateKey: string; keySalt: string }> {
  const salt = getWebCrypto().getRandomValues(new Uint8Array(16));
  const iv = getWebCrypto().getRandomValues(new Uint8Array(12));

  const wrappingKey = await derivePasswordWrappingKey(password, salt);
  const jwkString = JSON.stringify(privateKeyJwk);
  const encoder = new TextEncoder();
  const data = encoder.encode(jwkString);

  const ciphertextBuffer = await getWebCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    wrappingKey,
    data
  );

  // Combine IV (12 bytes) + Ciphertext into a single Base64 payload
  const combined = new Uint8Array(iv.length + ciphertextBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertextBuffer), iv.length);

  return {
    encryptedPrivateKey: arrayBufferToBase64(combined),
    keySalt: arrayBufferToBase64(salt)
  };
}

/**
 * Decrypts private key JWK from server vault using user password
 */
export async function decryptPrivateKeyVault(
  encryptedPrivateKeyBase64: string,
  keySaltBase64: string,
  password: string
): Promise<JsonWebKey> {
  const combinedBuffer = new Uint8Array(base64ToArrayBuffer(encryptedPrivateKeyBase64));
  const saltBuffer = new Uint8Array(base64ToArrayBuffer(keySaltBase64));

  const iv = combinedBuffer.slice(0, 12);
  const ciphertext = combinedBuffer.slice(12);

  const wrappingKey = await derivePasswordWrappingKey(password, saltBuffer);

  const decryptedBuffer = await getWebCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    wrappingKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  const jwkString = decoder.decode(decryptedBuffer);
  return JSON.parse(jwkString);
}
