const pool = require('../config/db');
const { KEY } = require('../config/crypto');

const RINGKAS_COLS = 'c.id, c.semester, c.kategori, c.status, c.created_at, c.updated_at';

// $1 selalu berisi kunci enkripsi
const DETAIL_SELECT = `
  SELECT c.id, c.mahasiswa_id, m.nim, m.nama, c.semester, c.kategori, c.alasan,
         pgp_sym_decrypt(c.alamat_cuti, $1) AS alamat_cuti,
         pgp_sym_decrypt(c.nomor_telepon, $1) AS nomor_telepon,
         c.dokumen_id, c.status, c.catatan_admin, c.created_at, c.updated_at
  FROM pengajuan_cuti c
  JOIN mahasiswa m ON m.id = c.mahasiswa_id`;

exports.create = async (d) => {
  const { rows } = await pool.query(
    `INSERT INTO pengajuan_cuti
       (mahasiswa_id, semester, kategori, alasan, alamat_cuti, nomor_telepon, dokumen_id)
     VALUES ($2, $3, $4, $5, pgp_sym_encrypt($6::text, $1), pgp_sym_encrypt($7::text, $1), $8)
     RETURNING id`,
    [KEY, d.mahasiswa_id, d.semester, d.kategori, d.alasan, d.alamat_cuti, d.nomor_telepon,
     d.dokumen_id ?? null]
  );
  return rows[0].id;
};

exports.listByMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ${RINGKAS_COLS} FROM pengajuan_cuti c
     WHERE c.mahasiswa_id = $1
     ORDER BY c.created_at DESC`,
    [mahasiswaId]
  );
  return rows;
};

exports.listDetailByMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `${DETAIL_SELECT} WHERE c.mahasiswa_id = $2 ORDER BY c.created_at`,
    [KEY, mahasiswaId]
  );
  return rows;
};

exports.findById = async (id) => {
  const { rows } = await pool.query(`${DETAIL_SELECT} WHERE c.id = $2`, [KEY, id]);
  return rows[0] || null;
};

// Pengajuan hanya ditemukan kalau milik mahasiswa yang bersangkutan
exports.findOwned = async (id, mahasiswaId) => {
  const { rows } = await pool.query(
    `${DETAIL_SELECT} WHERE c.id = $2 AND c.mahasiswa_id = $3`,
    [KEY, id, mahasiswaId]
  );
  return rows[0] || null;
};

// Update hanya berhasil kalau status saat ini masih diajukan
exports.batal = async (id, mahasiswaId) => {
  const { rows } = await pool.query(
    `UPDATE pengajuan_cuti SET status = 'dibatalkan', updated_at = now()
     WHERE id = $1 AND mahasiswa_id = $2 AND status = 'diajukan'
     RETURNING id`,
    [id, mahasiswaId]
  );
  return rows[0]?.id || null;
};

exports.putuskan = async (id, status, catatan) => {
  const { rows } = await pool.query(
    `UPDATE pengajuan_cuti SET status = $2, catatan_admin = $3, updated_at = now()
     WHERE id = $1 AND status = 'diajukan'
     RETURNING id`,
    [id, status, catatan]
  );
  return rows[0]?.id || null;
};

exports.SORT = {
  created_at: 'c.created_at', semester: 'c.semester', status: 'c.status',
  kategori: 'c.kategori', nim: 'm.nim', nama: 'm.nama',
};

const ADMIN_FROM = `
  FROM pengajuan_cuti c
  JOIN mahasiswa m ON m.id = c.mahasiswa_id
  WHERE ($1::text IS NULL OR m.nim ILIKE $1 ESCAPE '\\' OR m.nama ILIKE $1 ESCAPE '\\'
    OR c.kategori ILIKE $1 ESCAPE '\\')`;

// orderBy berasal dari listQuery, sudah dibatasi ke ekspresi di SORT
exports.listAdmin = async ({ pola, orderBy, limit, offset }) => {
  const total = await pool.query(`SELECT count(*)::int AS n ${ADMIN_FROM}`, [pola]);
  const { rows } = await pool.query(
    `SELECT ${RINGKAS_COLS}, m.id AS mahasiswa_id, m.nim, m.nama
     ${ADMIN_FROM}
     ORDER BY ${orderBy}, c.id
     LIMIT $2 OFFSET $3`,
    [pola, limit, offset]
  );
  return { rows, total: total.rows[0].n };
};
