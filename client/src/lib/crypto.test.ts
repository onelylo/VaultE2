import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportKeyToJwk,
  importPrivateKeyFromJwk,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  getFingerprint,
  encryptPrivateKeyVault,
  decryptPrivateKeyVault,
  encryptBinaryData,
  decryptBinaryData,
  arrayBufferToBase64,
  base64ToArrayBuffer
} from './crypto';

describe('PetroShield E2EE WebCrypto Utility', () => {
  it('should encrypt and decrypt plaintext string correctly: decrypt(encrypt(text)) === text', async () => {
    const keyPair = await generateKeyPair();
    const sharedKey = await deriveSharedKey(keyPair.privateKey, keyPair.publicKey);

    const originalText = 'Operational Status: Sector 4 Pressure Normal - 450 PSI';
    const { ciphertext, iv } = await encryptMessage(originalText, sharedKey);

    expect(ciphertext).toBeTypeOf('string');
    expect(ciphertext).not.toBe(originalText);
    expect(iv).toBeTypeOf('string');

    const decryptedText = await decryptMessage(ciphertext, iv, sharedKey);
    expect(decryptedText).toBe(originalText);
  });

  it('should perform ECDH key exchange between User A and User B and allow two-way encrypted messaging', async () => {
    // 1. User A generates keypair
    const aliceKeys = await generateKeyPair();
    const alicePublicBase64 = await exportPublicKey(aliceKeys.publicKey);

    // 2. User B generates keypair
    const bobKeys = await generateKeyPair();
    const bobPublicBase64 = await exportPublicKey(bobKeys.publicKey);

    // 3. User A imports User B's public key & derives shared key
    const importedBobPubKey = await importPublicKey(bobPublicBase64);
    const aliceSharedKey = await deriveSharedKey(aliceKeys.privateKey, importedBobPubKey);

    // 4. User B imports User A's public key & derives shared key
    const importedAlicePubKey = await importPublicKey(alicePublicBase64);
    const bobSharedKey = await deriveSharedKey(bobKeys.privateKey, importedAlicePubKey);

    // 5. User A encrypts message for User B
    const aliceSecretMessage = 'Emergency Valve Shutdown Code: 9942-ALPHA';
    const payloadFromAlice = await encryptMessage(aliceSecretMessage, aliceSharedKey);

    // 6. User B decrypts message using Bob's derived shared key
    const decryptedByBob = await decryptMessage(
      payloadFromAlice.ciphertext,
      payloadFromAlice.iv,
      bobSharedKey
    );

    expect(decryptedByBob).toBe(aliceSecretMessage);

    // 7. User B replies to User A
    const bobReplyMessage = 'Acknowledged Sector 4 shutdown order.';
    const payloadFromBob = await encryptMessage(bobReplyMessage, bobSharedKey);

    const decryptedByAlice = await decryptMessage(
      payloadFromBob.ciphertext,
      payloadFromBob.iv,
      aliceSharedKey
    );

    expect(decryptedByAlice).toBe(bobReplyMessage);
  });

  it('should generate consistent visual fingerprint snippets', async () => {
    const keyPair = await generateKeyPair();
    const pubKeyBase64 = await exportPublicKey(keyPair.publicKey);

    const fingerprint = await getFingerprint(pubKeyBase64);
    // Fingerprint is 30 hex chars (120 bits) formatted in groups of 4
    expect(fingerprint.length).toBeGreaterThanOrEqual(30);
    expect(fingerprint).toMatch(/^[0-9A-F ]+$/);
  });

  it('should encrypt private key into Key Vault format and decrypt it back with password', async () => {
    const keyPair = await generateKeyPair();
    const originalJwk = await exportKeyToJwk(keyPair.privateKey);
    const password = 'SuperSecretUserPassword123!';

    const { encryptedPrivateKey, keySalt } = await encryptPrivateKeyVault(originalJwk, password);

    expect(encryptedPrivateKey).toBeTypeOf('string');
    expect(keySalt).toBeTypeOf('string');

    const restoredJwk = await decryptPrivateKeyVault(encryptedPrivateKey, keySalt, password);
    expect(restoredJwk.crv).toBe(originalJwk.crv);
    expect(restoredJwk.d).toBe(originalJwk.d);

    const restoredPrivateKey = await importPrivateKeyFromJwk(restoredJwk);
    expect(restoredPrivateKey.algorithm.name).toBe('ECDH');
  });

  it('should encrypt and decrypt binary ArrayBuffer file data: decrypt(encrypt(buffer)) === buffer', async () => {
    const keyPair = await generateKeyPair();
    const sharedKey = await deriveSharedKey(keyPair.privateKey, keyPair.publicKey);

    // Simulate an encrypted image payload (raw binary bytes, not text)
    const raw = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);
    const original = raw.buffer;

    const { ciphertext, iv } = await encryptBinaryData(original, sharedKey);
    expect(ciphertext).toBeTypeOf('string');
    expect(iv).toBeTypeOf('string');

    const decrypted = await decryptBinaryData(base64ToArrayBuffer(ciphertext), iv, sharedKey);
    expect(new Uint8Array(decrypted)).toEqual(raw);
    expect(arrayBufferToBase64(decrypted)).toBe(arrayBufferToBase64(original));
  });
});
