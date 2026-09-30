const pool = require('../config/db');

const COLS = 'id, kode, nama, sks';

exports.list = async (q) => {
  if (q) {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM mata_kuliah
       WHERE kode ILIKE '%' || $1 || '%' OR nama ILIKE '%' || $1 || '%'
       ORDER BY kode`,
      [q]
    );
    return rows;
  }
  const { rows } = await pool.query(`SELECT ${COLS} FROM mata_kuliah ORDER BY kode`);
  return rows;
};

exports.findById = async (id) => {
  const { rows } = await pool.query(`SELECT ${COLS} FROM mata_kuliah WHERE id = $1`, [id]);
  return rows[0] || null;
};

exports.create = async (d) => {
  const { rows } = await pool.query(
    `INSERT INTO mata_kuliah (kode, nama, sks) VALUES ($1, $2, $3) RETURNING ${COLS}`,
    [d.kode, d.nama, d.sks]
  );
  return rows[0];
};

exports.update = async (id, d) => {
  const { rows } = await pool.query(
    `UPDATE mata_kuliah SET
       kode = COALESCE($2, kode),
       nama = COALESCE($3, nama),
       sks = COALESCE($4, sks)
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, d.kode ?? null, d.nama ?? null, d.sks ?? null]
  );
  return rows[0] || null;
};

exports.remove = async (id) => {
  const { rowCount } = await pool.query('DELETE FROM mata_kuliah WHERE id = $1', [id]);
  return rowCount > 0;
};
