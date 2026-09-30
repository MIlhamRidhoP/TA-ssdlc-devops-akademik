const pool = require('../config/db');

// Sengaja tidak di-await: dipanggil setelah response dikirim
module.exports = (req, aksi, entitas, entitasId = null) => {
  pool
    .query(
      `INSERT INTO audit_trail (user_id, aksi, entitas, entitas_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user?.id ?? null, aksi, entitas, entitasId, req.ip]
    )
    .catch((err) => console.error('Audit gagal:', err.message));
};
