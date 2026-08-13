/**
 * Phase 4 E2E Verification — Step 2 (after server restart)
 * Logs in again and confirms history + encrypted attachment recover fully from PostgreSQL.
 */
const crypto = require('crypto');

const BASE = 'http://localhost:3001';

async function main() {
  // Alice logs back in after the restart
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice_e2e', password: 'pass1234' })
  }).then(r => r.json());
  if (!login.token) { console.error('Login failed:', login); process.exit(1); }
  console.log('[1] Login restored for', login.user.userId);

  // Global history feed (GET /api/messages) — used by the client on rehydration
  const hist = await fetch(BASE + '/api/messages', {
    headers: { Authorization: `Bearer ${login.token}` }
  }).then(r => r.json());
  const msgs = hist.messages || [];
  console.log('[2] History from PostgreSQL:', msgs.length, 'messages');
  for (const m of msgs) {
    console.log(`    - ${m.id} | ${m.senderId} → ${m.recipientId || '#' + m.channelId} | status=${m.status} | attach=${m.attachment?.attachmentId || 'none'}`);
  }

  const m1 = msgs.find(m => m.id === 'm1');
  const m2 = msgs.find(m => m.id === 'm2');
  const m3 = msgs.find(m => m.id === 'm3');
  if (!m1 || !m2 || !m3 || m1.ciphertext !== 'CT1' || m3.channelId !== 'general') {
    console.error('FAIL: history incomplete/mismatched');
    process.exit(1);
  }

  // Download the encrypted attachment binary
  const attId = m2.attachment.attachmentId;
  const dlRes = await fetch(BASE + '/api/attachments/' + attId, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  if (dlRes.status !== 200) { console.error('FAIL: attachment download', dlRes.status); process.exit(1); }
  const buf = Buffer.from(await dlRes.arrayBuffer());
  console.log('[3] Attachment download OK:', attId, '—', buf.length, 'encrypted bytes');

  // Bob logs in too and fetches the DM thread from the other side
  const loginB = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bob_e2e', password: 'pass1234' })
  }).then(r => r.json());
  const thread = await fetch(BASE + `/api/messages/direct/${login.user.userId}`, {
    headers: { Authorization: `Bearer ${loginB.token}` }
  }).then(r => r.json());
  console.log('[4] Bob DM thread after restart:', (thread.messages || []).length, 'messages (m2 attachment included:', (thread.messages || []).some(m => m.id === 'm2' && m.attachment?.attachmentId), ')');

  const health = await fetch(BASE + '/health').then(r => r.json());
  console.log('[5] Health:', JSON.stringify(health));
  console.log('STEP2_DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
