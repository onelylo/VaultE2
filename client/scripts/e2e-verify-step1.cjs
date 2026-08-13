/**
 * Phase 4 E2E Verification — Step 1 (before server restart)
 * Registers two users, sends DMs + a channel message + an encrypted attachment.
 */
const { io } = require('socket.io-client');
const crypto = require('crypto');

const BASE = 'http://localhost:3001';

function jsonGet(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(BASE + path, { headers }).then(r => r.json());
}
function jsonPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.json());
}

async function main() {
  const pubKeyA = 'A' + crypto.randomBytes(32).toString('base64');
  const pubKeyB = 'B' + crypto.randomBytes(32).toString('base64');

  const regA = await jsonPost('/api/auth/register', {
    username: 'alice_e2e', fullName: 'Alice E2E', password: 'pass1234',
    role: 'MEMBER', publicKey: pubKeyA, encryptedPrivateKey: 'VAULT_A', keySalt: 'SALT_A'
  });
  const regB = await jsonPost('/api/auth/register', {
    username: 'bob_e2e', fullName: 'Bob E2E', password: 'pass1234',
    role: 'MEMBER', publicKey: pubKeyB, encryptedPrivateKey: 'VAULT_B', keySalt: 'SALT_B'
  });
  if (!regA.token || !regB.token) {
    console.error('Register failed:', regA, regB);
    process.exit(1);
  }
  console.log('[1] Registered:', regA.user.userId, '+', regB.user.userId);

  // Upload an "encrypted" binary attachment (server never sees plaintext)
  const form = new FormData();
  form.append('file', new Blob([crypto.randomBytes(512)], { type: 'application/octet-stream' }), 'att.enc');
  form.append('encryptedMetadata', 'ENC_METADATA');
  form.append('binaryIv', 'BIN_IV');
  const upRes = await fetch(BASE + '/api/attachments/upload', {
    method: 'POST', headers: { Authorization: `Bearer ${regA.token}` }, body: form
  });
  const up = await upRes.json();
  if (!up.attachmentId) { console.error('Upload failed:', up); process.exit(1); }
  console.log('[2] Uploaded encrypted attachment:', up.attachmentId);

  // Socket: join as A and send DMs + a channel message
  const socketA = io(BASE, { forceNew: true, transports: ['websocket'], reconnection: false });
  await new Promise(res => socketA.on('connect', res));
  socketA.emit('user:join', { userId: regA.user.userId, username: 'alice_e2e', role: 'MEMBER', publicKey: pubKeyA });

  const now = Date.now();
  socketA.emit('message:send', {
    id: 'm1', tempId: 'm1', senderId: regA.user.userId, recipientId: regB.user.userId,
    ciphertext: 'CT1', iv: 'IV1', timestamp: now
  });
  socketA.emit('message:send', {
    id: 'm2', tempId: 'm2', senderId: regA.user.userId, recipientId: regB.user.userId,
    ciphertext: '', iv: '', timestamp: now + 1,
    attachment: { attachmentId: up.attachmentId, encryptedMetadata: 'ENC_METADATA', iv: 'META_IV', binaryIv: 'BIN_IV' }
  });
  socketA.emit('channel:message:send', {
    id: 'm3', tempId: 'm3', senderId: regA.user.userId, channelId: 'general',
    ciphertext: 'CH_CT1', iv: 'CH_IV1', timestamp: now + 2
  });

  await new Promise(r => setTimeout(r, 600));
  socketA.close();

  const health = await jsonGet('/health');
  console.log('[3] Health after send:', JSON.stringify(health));
  console.log('STEP1_DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
