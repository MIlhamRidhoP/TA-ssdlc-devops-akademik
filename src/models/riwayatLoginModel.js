const pool = require('../config/db');

// Sengaja tidak di-await supaya waktu respons login tidak berubah
exports.catat = (req, userId, status) => {
  const userAgent = req.get('user-agent');
  pool
    .query(
      'INSERT INTO riwayat_login (user_id, ip, user_agent, status) VALUES ($1, $2, $3, $4)',
      [userId, req.ip, userAgent ? userAgent.slice(0, 255) : null, status]
    )
    .catch((err) => console.error('Riwayat login gagal dicatat:', err.message));
};

exports.listByUser = async (userId, limit) => {
  const { rows } = await pool.query(
    `SELECT waktu, ip, user_agent, status FROM riwayat_login
     WHERE user_id = $1
     ORDER BY waktu DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
};
