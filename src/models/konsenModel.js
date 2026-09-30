const pool = require('../config/db');

const COLUMNS = 'id, mahasiswa_id, nama_wali, bukti_persetujuan_url, tanggal_persetujuan, status, created_at';

exports.findMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT m.id, u.is_minor
     FROM mahasiswa m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = $1`,
    [mahasiswaId]
  );
  return rows[0] || null;
};

exports.listByMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM konsen_orang_tua
     WHERE mahasiswa_id = $1
     ORDER BY created_at DESC`,
    [mahasiswaId]
  );
  return rows;
};

exports.create = async (d) => {
  const { rows } = await pool.query(
    `INSERT INTO konsen_orang_tua
       (mahasiswa_id, nama_wali, bukti_persetujuan_url, tanggal_persetujuan)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [d.mahasiswa_id, d.nama_wali, d.bukti_persetujuan_url ?? null, d.tanggal_persetujuan]
  );
  return rows[0];
};

// mahasiswa_id ikut dicek supaya konsen milik mahasiswa lain tidak bisa diubah lewat URL
exports.updateStatus = async (konsenId, mahasiswaId, status) => {
  const { rows } = await pool.query(
    `UPDATE konsen_orang_tua SET status = $3
     WHERE id = $1 AND mahasiswa_id = $2
     RETURNING ${COLUMNS}`,
    [konsenId, mahasiswaId, status]
  );
  return rows[0] || null;
};

// Status konsen terbaru milik user; dipakai middleware requireConsent
exports.consentStateByUserId = async (userId) => {
  const { rows } = await pool.query(
    `SELECT u.is_minor,
            (SELECT k.status
               FROM konsen_orang_tua k
               JOIN mahasiswa m ON m.id = k.mahasiswa_id
              WHERE m.user_id = u.id
              ORDER BY k.created_at DESC
              LIMIT 1) AS status
     FROM users u
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
};
