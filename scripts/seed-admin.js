require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

(async () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password || password.length < 12) {
    console.error('ADMIN_EMAIL dan ADMIN_PASSWORD (minimal 12 karakter) wajib diisi di .env');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const { rowCount } = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [email, hash]
  );

  console.log(rowCount ? 'Akun admin dibuat' : 'Akun admin sudah ada, tidak diubah');
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
