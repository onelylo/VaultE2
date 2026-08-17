import { useRef, useCallback } from 'react';
import { saveUserKeyPair } from '../lib/db';
import { generateKeyPair, exportPublicKey, importPublicKey, exportKeyToJwk, importPrivateKeyFromJwk } from '../lib/crypto';
import {
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  getFingerprint,
  computePublicKeyFingerprint,
  compareFingerprints,
  generateChannelSymmetricKey,
  importSymmetricKeyFromJwk,
  decryptPrivateKeyVault,
  encryptKeyVaultPair,
  unwrapKeyVault,
  generateSigningKeyPair,
  signKeyRotation,
  verifyKeyRotationSignature,
  encryptBinaryData,
  encryptPrivateKeyVault,
} from '../lib/crypto';

/**
 * useCrypto - Extracted cryptographic operations from App.tsx
 * 
 * All functions from ./lib/crypto are re-exported through this hook
 * so App.tsx imports crypto logic through useCrypto instead of directly
 * from ./lib/crypto. This enables:
 * - Easier security audits (crypto logic in one place)
 * - Swappable encryption strategies (E2EE vs server-encrypted fallback)
 * - Independent unit testing of all crypto operations
 * - Future: post-quantum crypto swap without touching UI hooks
 */
export const useCrypto = (privateKeyObject: CryptoKey | null) => {
  // Refs to stabilize callbacks that reference frequently-changing state
  const deriveSharedKeyRef = useRef(deriveSharedKey);
  deriveSharedKeyRef.current = deriveSharedKey;

  const getOrDeriveSharedKey = useCallback(
    async (privateKey: CryptoKey, peerPublicKeyBase64: string): Promise<CryptoKey | null> => {
      if (!peerPublicKeyBase64 || !privateKey) return null;
      const cacheKey = peerPublicKeyBase64.slice(0, 32);
      try {
        const peerPubKey = await importPublicKey(peerPublicKeyBase64);
        const derivedKey = await deriveSharedKeyRef.current(privateKey, peerPubKey);
        return derivedKey;
      } catch (err) {
        console.error('[useCrypto] Failed to derive shared key:', err);
        return null;
      }
    },
    []
  );

  // ── Export all crypto functions for App.tsx consumption ──────────────
  return {
    // Key pair generation
    generateKeyPair,

    // Public key <-> Base64
    exportPublicKey,
    importPublicKey,

    // JWK <-> CryptoKey (for Dexie storage)
    exportKeyToJwk,
    importPrivateKeyFromJwk,

    // ECDH shared key derivation
    deriveSharedKey: deriveSharedKeyRef.current,
    getOrDeriveSharedKey,

    // Crypto operations
    encryptMessage,
    decryptMessage,

    // Fingerprint utilities
    getFingerprint,
    computePublicKeyFingerprint,
    compareFingerprints,

    // Channel symmetric key generation
    generateChannelSymmetricKey,

    // Key import from stored JWK
    importSymmetricKeyFromJwk,

    // Vault operations (PBKDF2 wrapped key storage)
    decryptPrivateKeyVault,
    encryptKeyVaultPair,
    unwrapKeyVault,

    // Signing key operations (ECDSA separate from ECDH)
    generateSigningKeyPair,

    // Key rotation signing
    signKeyRotation,
    verifyKeyRotationSignature,

    // Binary data encryption (for attachments)
    encryptBinaryData,

    // Key rotation
    handleRotateKey: async (password: string, currentUserKeys: any, privateSigningKeyJwk: any, socket: any) => {
      if (!currentUserKeys || !privateSigningKeyJwk) throw new Error('Missing keys for rotation');

      // 1. Generate new ECDH + ECDSA key pairs
      const newEcdhPair = await generateKeyPair();
      const newSigningPair = await generateSigningKeyPair();
      const newEcdhPub = await exportPublicKey(newEcdhPair.publicKey);
      const newSigningPub = await exportPublicKey(newSigningPair.publicKey);

      // 2. Sign the rotation with the old signing key (JWK format)
      const rotationSignature = await signKeyRotation(
        newEcdhPub,
        newSigningPub,
        currentUserKeys.publicKeyBase64,
        privateSigningKeyJwk
      );

      // 3. Encrypt both private keys for vault backup
      const newEcdhPrivJwk = await exportKeyToJwk(newEcdhPair.privateKey);
      const newSigningPrivJwk = await exportKeyToJwk(newSigningPair.privateKey);
      const ecdhVault = await encryptPrivateKeyVault(newEcdhPrivJwk, password);
      const signingVault = await encryptPrivateKeyVault(newSigningPrivJwk, password);

      // 4. Prepare rotation payload
      const rotationPayload = {
        oldPublicKey: currentUserKeys.publicKeyBase64,
        newPublicKey: newEcdhPub,
        newSigningPublicKey: newSigningPub,
        rotationSignature,
        keyVersion: (currentUserKeys.keyVersion || 1) + 1,
        encryptedPrivateKey: ecdhVault.encryptedPrivateKey,
        keySalt: ecdhVault.keySalt,
        encryptedSigningPrivateKey: signingVault.encryptedPrivateKey,
        signingKeySalt: signingVault.keySalt,
      };

      // 5. POST to server
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/auth/rotate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          publicKey: newEcdhPub,
          signingPublicKey: newSigningPub,
          encryptedPrivateKey: ecdhVault.encryptedPrivateKey,
          keySalt: ecdhVault.keySalt,
          signature: rotationSignature,
          oldPublicKey: currentUserKeys.publicKeyBase64,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Key rotation failed');
      }

      // 6. Update local key pair
      const newKeyPair = {
        ...currentUserKeys,
        publicKeyBase64: newEcdhPub,
        privateKeyJwk: await exportKeyToJwk(newEcdhPair.privateKey),
        publicKeyJwk: await exportKeyToJwk(newEcdhPair.publicKey),
        signingPublicKeyBase64: newSigningPub,
        privateSigningKeyJwk: await exportKeyToJwk(newSigningPair.privateKey),
        publicSigningKeyJwk: await exportKeyToJwk(newSigningPair.publicKey),
        keyVersion: rotationPayload.keyVersion,
      };

      await saveUserKeyPair(newKeyPair);

      // 7. Emit key:rotated socket event for contacts
      if (socket?.connected) {
        socket.emit('user:key_rotated', {
          userId: currentUserKeys.userId,
          publicKey: newEcdhPub,
          signingPublicKey: newSigningPub,
          keyVersion: rotationPayload.keyVersion,
          oldPublicKey: currentUserKeys.publicKeyBase64,
          oldSigningPublicKey: currentUserKeys.signingPublicKeyBase64,
          keyRotationSignature: rotationSignature,
        });
      }

      return newKeyPair;
    },
  };
};