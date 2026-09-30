require('dotenv').config();

const KEY = process.env.PGCRYPTO_KEY;
if (!KEY || KEY.length < 32) {
  throw new Error('PGCRYPTO_KEY wajib diisi, minimal 32 karakter');
}

module.exports = { KEY };
