const AppError = require('./AppError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) && d < new Date();
};

const requireUuid = (id) => {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ID tidak valid');
  }
};

// Panjang dicek dulu sebelum regex dijalankan
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

const isHttpsUrl = (v) => {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

// Teks bebas satu baris, tidak kosong setelah di-trim, tanpa karakter kontrol
const teks = (max) => (v) =>
  typeof v === 'string' && v.length <= max && v.trim().length > 0 && !/\p{Cc}/u.test(v);

module.exports = { UUID_RE, isValidDate, requireUuid, isEmail, isHttpsUrl, teks };
