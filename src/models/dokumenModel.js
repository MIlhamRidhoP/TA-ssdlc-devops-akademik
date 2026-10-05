const pool = require('../config/db');

// path_file sengaja tidak ikut, hanya dipakai di server
const COLS = 'id, mahasiswa_id, jenis, nama_file_asli, mime, ukuran, status_verifikasi, created_at, updated_at';

exports.create = async (d) => {
  const { rows } = await pool.query(
    `INSERT INTO dokumen_mahasiswa (mahasiswa_id, jenis, nama_file_asli, path_file, mime, ukuran)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLS}`,
    [d.mahasiswa_id, d.jenis, d.nama_file_asli, d.path_file, d.mime, d.ukuran]
  );
  return rows[0];
};

exports.existsJenis = async (mahasiswaId, jenis) => {
  const { rows } = await pool.query(
    'SELECT 1 FROM dokumen_mahasiswa WHERE mahasiswa_id = $1 AND jenis = $2',
    [mahasiswaId, jenis]
  );
  return rows.length > 0;
};

exports.listByMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM dokumen_mahasiswa
     WHERE mahasiswa_id = $1
     ORDER BY created_at DESC`,
    [mahasiswaId]
  );
  return rows;
};

// Dokumen hanya ditemukan kalau milik mahasiswa yang bersangkutan
exports.findOwned = async (id, mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ${COLS}, path_file FROM dokumen_mahasiswa
     WHERE id = $1 AND mahasiswa_id = $2`,
    [id, mahasiswaId]
  );
  return rows[0] || null;
};

exports.updateStatus = async (id, mahasiswaId, status) => {
  const { rows } = await pool.query(
    `UPDATE dokumen_mahasiswa SET status_verifikasi = $3, updated_at = now()
     WHERE id = $1 AND mahasiswa_id = $2
     RETURNING ${COLS}`,
    [id, mahasiswaId, status]
  );
  return rows[0] || null;
};

exports.pathsByMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    'SELECT path_file FROM dokumen_mahasiswa WHERE mahasiswa_id = $1',
    [mahasiswaId]
  );
  return rows.map((r) => r.path_file);
};
