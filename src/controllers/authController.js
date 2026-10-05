const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { sign } = require('../config/jwt');
const AppError = require('../utils/AppError');
const riwayatLogin = require('../models/riwayatLoginModel');

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// dipakai saat email tidak ditemukan, supaya waktu respons tetap sama
const DUMMY_HASH = bcrypt.hashSync('dummy-password-timing', SALT_ROUNDS);

const readCredentials = (body) => ({
  email: typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '',
  password: typeof body?.password === 'string' ? body.password : '',
});

exports.register = async (req, res) => {
  const { email, password } = readCredentials(req.body);

  if (!EMAIL_RE.test(email) || email.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Format email tidak valid');
  }
  // bcrypt hanya membaca 72 byte pertama
  if (
    password.length < 8 ||
    Buffer.byteLength(password) > 72 ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    throw new AppError(400, 'VALIDATION_ERROR',
      'Password 8 sampai 72 karakter, minimal 1 huruf besar dan 1 angka');
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  // role sengaja tidak diambil dari body, selalu default 'mahasiswa'
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, role, created_at`,
    [email, hash]
  );

  res.status(201).json({ success: true, data: rows[0] });
};

exports.login = async (req, res) => {
  const { email, password } = readCredentials(req.body);
  if (!email || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email dan password wajib diisi');
  }

  const { rows } = await pool.query(
    'SELECT id, password_hash, role FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (user) riwayatLogin.catat(req, user.id, valid ? 'berhasil' : 'gagal');

  if (!user || !valid) {
    throw new AppError(401, 'UNAUTHORIZED', 'Email atau password salah');
  }

  const token = sign({ sub: user.id, role: user.role });
  res.json({ success: true, data: { token, expires_in: 86400, role: user.role } });
};
