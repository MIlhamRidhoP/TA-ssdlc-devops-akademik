const pool = require('../config/db');
const { KEY } = require('../config/crypto');

exports.findRekening = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT nama_bank, pgp_sym_decrypt(nomor_rekening, $1) AS nomor_rekening, nama_pemilik, updated_at
     FROM rekening_mahasiswa
     WHERE mahasiswa_id = $2`,
    [KEY, mahasiswaId]
  );
  return rows[0] || null;
};

exports.listEmail = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT id, tipe, email, created_at FROM email_mahasiswa
     WHERE mahasiswa_id = $1
     ORDER BY created_at`,
    [mahasiswaId]
  );
  return rows;
};

// Insert hanya terjadi kalau jumlah email milik mahasiswa masih di bawah batas
exports.createEmail = async (mahasiswaId, tipe, email, maks) => {
  const { rows } = await pool.query(
    `INSERT INTO email_mahasiswa (mahasiswa_id, tipe, email)
     SELECT $1, $2, $3
     WHERE (SELECT count(*) FROM email_mahasiswa WHERE mahasiswa_id = $1) < $4
     RETURNING id, tipe, email, created_at`,
    [mahasiswaId, tipe, email, maks]
  );
  return rows[0] || null;
};

exports.removeEmail = async (id, mahasiswaId) => {
  const { rowCount } = await pool.query(
    'DELETE FROM email_mahasiswa WHERE id = $1',
    [id]
  );
  return rowCount > 0;
};

exports.listAkunSosial = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT id, platform, id_akun, url, created_at FROM akun_sosial_mahasiswa
     WHERE mahasiswa_id = $1
     ORDER BY platform`,
    [mahasiswaId]
  );
  return rows;
};

exports.createAkunSosial = async (mahasiswaId, d) => {
  const { rows } = await pool.query(
    `INSERT INTO akun_sosial_mahasiswa (mahasiswa_id, platform, id_akun, url)
     VALUES ($1, $2, $3, $4)
     RETURNING id, platform, id_akun, url, created_at`,
    [mahasiswaId, d.platform, d.id_akun, d.url]
  );
  return rows[0];
};

exports.removeAkunSosial = async (id, mahasiswaId) => {
  const { rowCount } = await pool.query(
    'DELETE FROM akun_sosial_mahasiswa WHERE id = $1 AND mahasiswa_id = $2',
    [id, mahasiswaId]
  );
  return rowCount > 0;
};

exports.listKonsen = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT nama_wali, bukti_persetujuan_url, tanggal_persetujuan, status, created_at
     FROM konsen_orang_tua
     WHERE mahasiswa_id = $1
     ORDER BY created_at`,
    [mahasiswaId]
  );
  return rows;
};

// Riwayat studi untuk ekspor: semua mata kuliah di KRS, nilai hanya yang published
exports.listRiwayatStudi = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ks.semester, ks.status AS status_krs, mk.kode, mk.nama, mk.sks,
            CASE WHEN n.status = 'published' THEN n.nilai_huruf END AS nilai_huruf
     FROM krs_semester ks
     JOIN krs k ON k.krs_semester_id = ks.id
     JOIN mata_kuliah mk ON mk.id = k.mata_kuliah_id
     LEFT JOIN nilai n ON n.krs_id = k.id
     WHERE ks.mahasiswa_id = $1
     ORDER BY ks.semester, mk.kode`,
    [mahasiswaId]
  );
  return rows;
};
