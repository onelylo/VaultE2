/**
 * Phase 5 E2E Verification — Dual-Key ECDSA Key Rotation, TOFU chain, Reactive Roster, Admin RBAC
 *
 * Registers an ADMIN + MEMBER, each with a dedicated ECDSA signing keypair alongside
 * its ECDH identity key. Performs a REAL signed dual-key rotation (new ECDH + new
 * ECDSA, signed by the OLD ECDSA private key), exercises the TOFU key endpoint,
 * verifies reactive socket events, and tests admin enforcement.
 */
const { io } = require('socket.io-client');
const crypto = require('crypto');

const BASE = 'http://localhost:3001';
let passed = 0, failed = 0;

function ok(label, cond) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

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
function jsonPatch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(BASE + path, { method: 'PATCH', headers, body: JSON.stringify(body) }).then(r => r.json());
}
function jsonDel(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(BASE + path, { method: 'DELETE', headers }).then(r => r.json());
}

// ECDH P-256 identity pair (message encryption) → SPKI base64 + private JWK
async function genP256JwkPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  const pubB64 = Buffer.from(pub).toString('base64');
  const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { pubB64, privJwk };
}

// ECDSA P-256 signing pair (rotation proofs) → SPKI base64 + private JWK
async function genP256SignPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  const pubB64 = Buffer.from(pub).toString('base64');
  const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { pubB64, privJwk };
}

// Sign the dual-key rotation statement with the OLD ECDSA signing private key.
// IEEE P1363 (r || s) raw signature — matches Node's ieee-p1363 verify.
async function signRotation(newPub, newSignPub, oldPub, oldSignPrivJwk) {
  const signer = await crypto.subtle.importKey('jwk', oldSignPrivJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const msg = new TextEncoder().encode(`petroshield-key-rotation-v1\n${newPub}\n${newSignPub}\n${oldPub}`);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, msg);
  return Buffer.from(sig).toString('base64');
}

async function main() {
  const ts = Date.now().toString(36);
  const uA = `alice_f5_${ts}`;
  const uB = `bob_f5_${ts}`;
  const uC = `carol_f5_${ts}`;

  const A = await genP256JwkPair();
  const A_s = await genP256SignPair();
  const B = await genP256JwkPair();
  const B_s = await genP256SignPair();

  // ── Register: ADMIN (alice) + MEMBER (bob) with signing keys ────────────────
  const regA = await jsonPost('/api/auth/register', {
    username: uA, fullName: 'Alice F5', password: 'pass1234', role: 'ADMIN',
    publicKey: A.pubB64, signingPublicKey: A_s.pubB64, encryptedPrivateKey: 'VAULT_A', keySalt: 'SALT_A'
  });
  const regB = await jsonPost('/api/auth/register', {
    username: uB, fullName: 'Bob F5', password: 'pass1234', role: 'MEMBER',
    publicKey: B.pubB64, signingPublicKey: B_s.pubB64, encryptedPrivateKey: 'VAULT_B', keySalt: 'SALT_B'
  });
  ok('register admin + member (with signing keys)', !!(regA.token && regB.token));
  console.log('[1] Users:', regA.user.userId, '|', regB.user.userId);

  // ── Reactive roster: user:registered + user:status_change events ────────────
  const listener = io(BASE, { forceNew: true, transports: ['websocket'], reconnection: false });
  await new Promise(res => listener.on('connect', res));
  listener.emit('user:join', { userId: regA.user.userId, username: uA, role: 'ADMIN', publicKey: A.pubB64, signingPublicKey: A_s.pubB64 });

  const registeredEvents = [];
  const statusEvents = [];
  const rotatedEvents = [];
  listener.on('user:registered', d => registeredEvents.push(d));
  listener.on('user:status_change', d => statusEvents.push(d));
  listener.on('user:key_rotated', d => rotatedEvents.push(d));

  // Trigger user:registered by creating a third user
  const C = await genP256JwkPair();
  const C_s = await genP256SignPair();
  await jsonPost('/api/auth/register', {
    username: uC, fullName: 'Carol F5', password: 'pass1234', role: 'MEMBER',
    publicKey: C.pubB64, signingPublicKey: C_s.pubB64, encryptedPrivateKey: 'VAULT_C', keySalt: 'SALT_C'
  });
  await new Promise(r => setTimeout(r, 500));
  ok('user:registered broadcast received', registeredEvents.some(e => e.user?.username === uC));
  ok('user:status_change online broadcast received', statusEvents.some(e => e.userId === regA.user.userId && e.isOnline === true));
  console.log('[2] Reactive roster events:', registeredEvents.length, 'registered,', statusEvents.length, 'status');

  // ── Negative rotation tests (pre-rotation, pinned v1 keys) ──────────────────
  const newA = await genP256JwkPair();
  const newA_s = await genP256SignPair();

  // Forged / tampered signature → 403
  const forgedSig = crypto.randomBytes(64).toString('base64');
  const rotBad = await jsonPost('/api/auth/rotate-key', {
    publicKey: newA.pubB64, signingPublicKey: newA_s.pubB64, encryptedPrivateKey: 'X', keySalt: 'Y',
    signature: forgedSig, oldPublicKey: A.pubB64
  }, regA.token);
  ok('forged signature rejected (403)', rotBad.error === 'Signature invalid: not signed by the previous private key');

  // Old-key mismatch → 409
  const goodSig = await signRotation(newA.pubB64, newA_s.pubB64, A.pubB64, A_s.privJwk);
  const rotMismatch = await jsonPost('/api/auth/rotate-key', {
    publicKey: newA.pubB64, signingPublicKey: newA_s.pubB64, encryptedPrivateKey: 'X', keySalt: 'Y',
    signature: goodSig, oldPublicKey: B.pubB64
  }, regA.token);
  ok('old-key mismatch rejected (409)', rotMismatch.error === 'Key rotation conflict: server is pinned to a different key');

  // ── Valid dual-key rotation: signed by the OLD ECDSA signing key ─────────────
  const rot = await jsonPost('/api/auth/rotate-key', {
    publicKey: newA.pubB64, signingPublicKey: newA_s.pubB64, encryptedPrivateKey: 'VAULT_A2', keySalt: 'SALT_A2',
    signature: goodSig, oldPublicKey: A.pubB64
  }, regA.token);
  ok('valid rotation accepted (v2)', rot.success === true && rot.keyVersion === 2);
  console.log('[3] Rotation accepted:', JSON.stringify(rot));

  await new Promise(r => setTimeout(r, 400));
  ok('user:key_rotated broadcast carries new signing key',
    rotatedEvents.some(e => e.userId === regA.user.userId && e.signingPublicKey === newA_s.pubB64 && e.oldPublicKey === A.pubB64));

  // TOFU endpoint now reflects the new key pair + signature + old pair
  const keys = await jsonGet(`/api/users/${regA.user.userId}/keys`, regB.token);
  ok('TOFU keys endpoint returns version/signature/old pair',
    keys.keyVersion === 2
    && !!keys.keyRotationSignature
    && keys.signingPublicKey === newA_s.pubB64
    && keys.oldPublicKey === A.pubB64
    && keys.publicKey === newA.pubB64);

  // Replay of the same old key must be rejected (already rotated / pending)
  const rotReplay = await jsonPost('/api/auth/rotate-key', {
    publicKey: newA.pubB64, signingPublicKey: newA_s.pubB64, encryptedPrivateKey: 'X', keySalt: 'Y',
    signature: goodSig, oldPublicKey: A.pubB64
  }, regA.token);
  ok('second rotation from stale old key rejected', !!rotReplay.error);

  // ── Admin RBAC: non-admin blocked ────────────────────────────────────────────
  const adminBlocked = await fetch(BASE + '/api/admin/users', { headers: { Authorization: `Bearer ${regB.token}` } });
  ok('MEMBER cannot access /api/admin/users (403)', adminBlocked.status === 403);

  const adminList = await jsonGet('/api/admin/users', regA.token);
  ok('ADMIN lists users', Array.isArray(adminList.users) && adminList.users.length >= 3);
  ok('admin list includes keyVersion', adminList.users.every(u => typeof u.keyVersion === 'number'));

  // ── Admin role change broadcast (user:role_change) ───────────────────────────
  const roleEvents = [];
  listener.on('user:role_change', d => roleEvents.push(d));
  const roleChange = await jsonPatch(`/api/admin/users/${regB.user.userId}/role`, { role: 'ADMIN' }, regA.token);
  ok('ADMIN promotes MEMBER → ADMIN', roleChange.success === true);
  await new Promise(r => setTimeout(r, 400));
  ok('user:role_change broadcast received', roleEvents.some(e => e.userId === regB.user.userId && e.role === 'ADMIN'));

  // Demote back for deletion test isolation
  await jsonPatch(`/api/admin/users/${regB.user.userId}/role`, { role: 'MEMBER' }, regA.token);

  // Admin cannot change own role
  const selfRole = await jsonPatch(`/api/admin/users/${regA.user.userId}/role`, { role: 'MEMBER' }, regA.token);
  ok('admin cannot demote self', selfRole.error === 'Cannot change your own role');

  // ── Admin deletes carol; user:removed broadcast; login then fails ────────────
  const removedEvents = [];
  listener.on('user:removed', d => removedEvents.push(d));
  const carolUserId = regA.user.userId.replace('alice', 'carol');
  const del = await jsonDel(`/api/admin/users/${carolUserId}`, regA.token);
  ok('admin deletes carol', del.success === true);
  await new Promise(r => setTimeout(r, 400));
  ok('user:removed broadcast received', removedEvents.some(e => e.userId === carolUserId));
  const carolLogin = await jsonPost('/api/auth/login', { username: uC, password: 'pass1234' });
  ok('deleted user cannot log in', !carolLogin.token);

  // Admin cannot delete self
  const selfDel = await jsonDel(`/api/admin/users/${regA.user.userId}`, regA.token);
  ok('admin cannot delete self', selfDel.error === 'Cannot delete your own account');

  // Directory no longer contains carol
  const dir = await jsonGet('/api/users', regA.token);
  ok('directory excludes deleted user', !dir.users.some(u => u.username === uC));

  // ── Health ────────────────────────────────────────────────────────────────────
  const health = await jsonGet('/health');
  ok('health ok', health.status === 'ok');
  console.log('[4] Health:', JSON.stringify(health));

  listener.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('PHASE5_DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
