const pool = require('../config/db');

const NILAI_COLS = 'id, krs_id, nilai_huruf, nilai_angka::float8 AS nilai_angka, status, updated_at';

exports.findKrsItem = async (krsId) => {
  const { rows } = await pool.query(
    `SELECT k.id, ks.status AS krs_status, ks.semester, ks.mahasiswa_id
     FROM krs k
     JOIN krs_semester ks ON ks.id = k.krs_semester_id
     WHERE k.id = $1`,
    [krsId]
  );
  return rows[0] || null;
};

// Insert atau update nilai; update hanya berhasil kalau status masih draft
exports.upsertDraft = async (krsId, huruf, angka) => {
  const { rows } = await pool.query(
    `INSERT INTO nilai (krs_id, nilai_huruf, nilai_angka)
     VALUES ($1, $2, $3)
     ON CONFLICT (krs_id) DO UPDATE SET
       nilai_huruf = EXCLUDED.nilai_huruf,
       nilai_angka = EXCLUDED.nilai_angka,
       updated_at = now()
     WHERE nilai.status = 'draft'
     RETURNING ${NILAI_COLS}`,
    [krsId, huruf, angka]
  );
  return rows[0] || null;
};

exports.publishByHeader = async (krsSemesterId) => {
  const { rows } = await pool.query(
    `UPDATE nilai n SET status = 'published', updated_at = now()
     FROM krs k
     WHERE k.id = n.krs_id
       AND k.krs_semester_id = $1
       AND n.status = 'draft'
     RETURNING n.id`,
    [krsSemesterId]
  );
  return rows.length;
};

exports.publishByMataKuliah = async (mataKuliahId, semester) => {
  const { rows } = await pool.query(
    `UPDATE nilai n SET status = 'published', updated_at = now()
     FROM krs k
     JOIN krs_semester ks ON ks.id = k.krs_semester_id
     WHERE k.id = n.krs_id
       AND k.mata_kuliah_id = $1
       AND ks.semester = $2::text
       AND n.status = 'draft'
     RETURNING n.id`,
    [mataKuliahId, semester]
  );
  return rows.length;
};

exports.SORT = {
  semester: 'ks.semester', nim: 'm.nim', nama: 'm.nama', kode: 'mk.kode',
  nilai_huruf: 'n.nilai_huruf', status: 'n.status',
};

const ADMIN_FROM = `
  FROM krs k
  JOIN krs_semester ks ON ks.id = k.krs_semester_id
  JOIN mahasiswa m ON m.id = ks.mahasiswa_id
  JOIN mata_kuliah mk ON mk.id = k.mata_kuliah_id
  LEFT JOIN nilai n ON n.krs_id = k.id
  WHERE ($1::text IS NULL OR ks.semester = $1::text)
    AND ($2::uuid IS NULL OR m.id = $2::uuid)
    AND ($3::uuid IS NULL OR mk.id = $3::uuid)
    AND ($4::text IS NULL OR m.nim ILIKE $4 ESCAPE '\\' OR m.nama ILIKE $4 ESCAPE '\\'
      OR mk.kode ILIKE $4 ESCAPE '\\' OR mk.nama ILIKE $4 ESCAPE '\\')`;

// Berangkat dari baris KRS supaya mata kuliah yang belum dinilai juga terlihat.
// orderBy berasal dari listQuery, sudah dibatasi ke ekspresi di SORT.
exports.listAdmin = async ({ semester, mahasiswaId, mataKuliahId }, { pola, orderBy, limit, offset }) => {
  const filter = [semester, mahasiswaId, mataKuliahId, pola];
  const total = await pool.query(`SELECT count(*)::int AS n ${ADMIN_FROM}`, filter);
  const { rows } = await pool.query(
    `SELECT k.id AS krs_id, ks.id AS krs_semester_id, ks.semester, ks.status AS krs_status,
            m.id AS mahasiswa_id, m.nim, m.nama,
            mk.id AS mata_kuliah_id, mk.kode, mk.nama AS nama_mata_kuliah, mk.sks,
            n.id AS nilai_id, n.nilai_huruf, n.nilai_angka::float8 AS nilai_angka, n.status AS nilai_status
     ${ADMIN_FROM}
     ORDER BY ${orderBy}, ks.semester, m.nim, mk.kode, k.id
     LIMIT $5 OFFSET $6`,
    [...filter, limit, offset]
  );
  return { rows, total: total.rows[0].n };
};

exports.publishedForMahasiswa = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ks.semester, mk.kode, mk.nama, mk.sks, n.nilai_huruf, n.nilai_angka::float8 AS nilai_angka
     FROM nilai n
     JOIN krs k ON k.id = n.krs_id
     JOIN krs_semester ks ON ks.id = k.krs_semester_id
     JOIN mata_kuliah mk ON mk.id = k.mata_kuliah_id
     WHERE ks.mahasiswa_id = $1
       AND n.status = 'published'
     ORDER BY mk.kode`,
    [mahasiswaId]
  );
  return rows;
};
