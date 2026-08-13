const { Pool } = require('pg');
const pool = new Pool({ host:'127.0.0.1', port:5433, database:'postgres', user:'postgres', password:'postgres', max:1 });

async function run() {
  // Get all users
  const all = await pool.query('SELECT id, username, created_at FROM users ORDER BY created_at');
  console.log('All users:');
  all.rows.forEach(r => console.log(`  ${r.id} | ${r.username} | created: ${r.created_at}`));
  
  // Keep: Onelylo (real user), op (real user)
  // Delete all E2E test duplicates (alice_f5_*, bob_f5_*, carol_f5_*, alice_e2e, bob_e2e)
  const toDelete = all.rows.filter(r => 
    r.username.startsWith('alice_f5') || r.username.startsWith('bob_f5') || 
    r.username.startsWith('carol_f5') || r.username.startsWith('alice_e2e') || 
    r.username.startsWith('bob_e2e') || r.username.startsWith('wipe_')
  );
  
  console.log('\nDeleting:', toDelete.map(r => r.username).join(', '));
  
  for (const u of toDelete) {
    // Clean up related data first
    await pool.query('DELETE FROM channel_members WHERE user_id = $1', [u.id]);
    await pool.query('DELETE FROM channel_keys WHERE user_id = $1', [u.id]);
    await pool.query('DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE sender_id = $1 OR recipient_id = $1)', [u.id]);
    await pool.query('DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1', [u.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [u.id]);
    console.log(`  Deleted: ${u.username}`);
  }
  
  // Show remaining
  const remaining = await pool.query('SELECT id, username, role FROM users ORDER BY username');
  console.log('\nRemaining users:');
  remaining.rows.forEach(r => console.log(`  ${r.id} | ${r.username} | ${r.role}`));
  
  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
