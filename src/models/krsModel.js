const pool = require('../config/db');

const HEADER_COLS = 'id, mahasiswa_id, semester, status, submitted_at, locked_at, created_at, updated_at';

exports.mahasiswaIdByUserId = async (userId) => {
  const { rows } = await pool.query('SELECT id FROM mahasiswa WHERE user_id = $1', [userId]);
  return rows[0]?.id || null;
};

exports.findHeader = async (mahasiswaId, semester) => {
  const { rows } = await pool.query(
    `SELECT ${HEADER_COLS} FROM krs_semester WHERE mahasiswa_id = $1 AND semester = $2`,
    [mahasiswaId, semester]
  );
  return rows[0] || null;
};

exports.findHeaderById = async (id) => {
  const { rows } = await pool.query(`SELECT ${HEADER_COLS} FROM krs_semester WHERE id = $1`, [id]);
  return rows[0] || null;
};

exports.getOrCreateHeader = async (mahasiswaId, semester) => {
  await pool.query(
    `INSERT INTO krs_semester (mahasiswa_id, semester) VALUES ($1, $2)
     ON CONFLICT (mahasiswa_id, semester) DO NOTHING`,
    [mahasiswaId, semester]
  );
  return exports.findHeader(mahasiswaId, semester);
};

exports.listItems = async (headerId) => {
  const { rows } = await pool.query(
    `SELECT k.id, mk.id AS mata_kuliah_id, mk.kode, mk.nama, mk.sks
     FROM krs k
     JOIN mata_kuliah mk ON mk.id = k.mata_kuliah_id
     WHERE k.krs_semester_id = $1
     ORDER BY mk.kode`,
    [headerId]
  );
  return rows;
};

exports.addItem = async (headerId, mataKuliahId) => {
  const { rows } = await pool.query(
    'INSERT INTO krs (krs_semester_id, mata_kuliah_id) VALUES ($1, $2) RETURNING id',
    [headerId, mataKuliahId]
  );
  return rows[0].id;
};

// Item hanya ditemukan kalau milik mahasiswa yang bersangkutan
exports.findItemOwned = async (itemId, mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT k.id, ks.status
     FROM krs k
     JOIN krs_semester ks ON ks.id = k.krs_semester_id
     WHERE k.id = $1 AND ks.mahasiswa_id = $2`,
    [itemId, mahasiswaId]
  );
  return rows[0] || null;
};

exports.removeItem = async (itemId) => {
  await pool.query('DELETE FROM krs WHERE id = $1', [itemId]);
};

// Update hanya berhasil kalau status saat ini sama dengan `from`
exports.transition = async (headerId, from, to) => {
  const { rows } = await pool.query(
    `UPDATE krs_semester SET
       status = $3::text,
       updated_at = now(),
       submitted_at = CASE WHEN $3::text = 'submitted' THEN now() ELSE submitted_at END,
       locked_at = CASE WHEN $3::text = 'locked' THEN now() ELSE locked_at END
     WHERE id = $1 AND status = $2
     RETURNING ${HEADER_COLS}`,
    [headerId, from, to]
  );
  return rows[0] || null;
};

exports.SORT = {
  nim: 'm.nim', nama: 'm.nama', status: 'ks.status', total_sks: 'total_sks', submitted_at: 'ks.submitted_at',
};

const HEADER_FILTER = `
  WHERE ks.semester = $1 AND ($2::uuid IS NULL OR ks.mahasiswa_id = $2)
    AND ($3::text IS NULL OR m.nim ILIKE $3 ESCAPE '\\' OR m.nama ILIKE $3 ESCAPE '\\')`;

// orderBy berasal dari listQuery, sudah dibatasi ke ekspresi di SORT
exports.listHeaders = async (semester, mahasiswaId, { pola, orderBy, limit, offset }) => {
  const total = await pool.query(
    `SELECT count(*)::int AS n
     FROM krs_semester ks
     JOIN mahasiswa m ON m.id = ks.mahasiswa_id
     ${HEADER_FILTER}`,
    [semester, mahasiswaId, pola]
  );
  const { rows } = await pool.query(
    `SELECT ks.id, ks.semester, ks.status, ks.submitted_at, ks.locked_at,
            m.id AS mahasiswa_id, m.nim, m.nama,
            COALESCE(SUM(mk.sks), 0)::int AS total_sks
     FROM krs_semester ks
     JOIN mahasiswa m ON m.id = ks.mahasiswa_id
     LEFT JOIN krs k ON k.krs_semester_id = ks.id
     LEFT JOIN mata_kuliah mk ON mk.id = k.mata_kuliah_id
     ${HEADER_FILTER}
     GROUP BY ks.id, m.id
     ORDER BY ${orderBy}, ks.id
     LIMIT $4 OFFSET $5`,
    [semester, mahasiswaId, pola, limit, offset]
  );
  return { rows, total: total.rows[0].n };
};

exports.publishedGrades = async (mahasiswaId) => {
  const { rows } = await pool.query(
    `SELECT ks.semester, n.nilai_huruf, mk.sks
     FROM nilai n
     JOIN krs k ON k.id = n.krs_id
     JOIN krs_semester ks ON ks.id = k.krs_semester_id
     JOIN mata_kuliah mk ON mk.id = k.mata_kuliah_id
     WHERE ks.mahasiswa_id = $1
       AND n.status = 'published'
       AND n.nilai_huruf IS NOT NULL`,
    [mahasiswaId]
  );
  return rows;
};
