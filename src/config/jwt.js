require('dotenv').config();
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('JWT_SECRET wajib diisi, minimal 32 karakter');
}

const sign = (payload) =>
  jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '24h' });

const verify = (token) =>
  jwt.verify(token, SECRET, { algorithms: ['HS256'] });

module.exports = { sign, verify };
