const { Pool } = require('pg');
const pool = new Pool({ host:'127.0.0.1', port:5433, database:'postgres', user:'postgres', password:'postgres', max:1 });
const USER_COLS = 'id, username, deleted_at, created_at';
async function run() {
  try {
    const r1 = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1 AND deleted_at IS NULL`, ['usr_alicef5mso34gte']);
    console.log('getUserById result:', r1.rows.length ? r1.rows[0] : 'NOT FOUND');
    const r2 = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, ['usr_alicef5mso34gte']);
    console.log('getUserByIdIncludingDeleted result:', r2.rows.length ? r2.rows[0] : 'NOT FOUND');
  } catch(e) { console.error('ERROR:', e.message); }
  await pool.end();
}
run();
