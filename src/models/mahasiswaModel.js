const pool = require('../config/db');
const { KEY } = require('../config/crypto');

// $1 selalu berisi kunci enkripsi
const DETAIL_SELECT = `
  SELECT m.id, m.user_id, u.email, m.nama, m.nim,
         pgp_sym_decrypt(m.nik, $1) AS nik,
         pgp_sym_decrypt(m.tanggal_lahir, $1) AS tanggal_lahir,
         pgp_sym_decrypt(m.nik_orang_tua, $1) AS nik_orang_tua,
         pgp_sym_decrypt(m.nomor_telepon, $1) AS nomor_telepon,
         u.is_minor,
         (SELECT k.status FROM konsen_orang_tua k
           WHERE k.mahasiswa_id = m.id
           ORDER BY k.created_at DESC LIMIT 1) AS status_konsen,
         m.created_at, m.updated_at
  FROM mahasiswa m
  JOIN users u ON u.id = m.user_id`;

const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.findById = async (id) => {
  const { rows } = await pool.query(`${DETAIL_SELECT} WHERE m.id = $2`, [KEY, id]);
  return rows[0] || null;
};

exports.findByUserId = async (userId) => {
  const { rows } = await pool.query(`${DETAIL_SELECT} WHERE m.user_id = $2`, [KEY, userId]);
  return rows[0] || null;
};

exports.list = async () => {
  const { rows } = await pool.query(
    `SELECT m.id, m.nim, m.nama, u.email
     FROM mahasiswa m
     JOIN users u ON u.id = m.user_id
     ORDER BY m.nim`
  );
  return rows;
};

exports.findUserRole = async (userId) => {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role || null;
};

exports.create = (d) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO mahasiswa
         (user_id, nama, nim, nik, tanggal_lahir, nik_orang_tua, nomor_telepon)
       VALUES ($2, $3, $4,
         pgp_sym_encrypt($5::text, $1),
         pgp_sym_encrypt($6::text, $1),
         pgp_sym_encrypt($7::text, $1),
         pgp_sym_encrypt($8::text, $1))
       RETURNING id`,
      [KEY, d.user_id, d.nama, d.nim, d.nik, d.tanggal_lahir,
       d.nik_orang_tua ?? null, d.nomor_telepon]
    );
    await client.query(
      'UPDATE users SET is_minor = $2, updated_at = now() WHERE id = $1',
      [d.user_id, d.is_minor]
    );
    return rows[0].id;
  });

// Field yang tidak dikirim (null) tidak diubah
exports.update = (id, d) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE mahasiswa SET
         nama = COALESCE($3, nama),
         nim = COALESCE($4, nim),
         nik = COALESCE(pgp_sym_encrypt($5::text, $1), nik),
         tanggal_lahir = COALESCE(pgp_sym_encrypt($6::text, $1), tanggal_lahir),
         nik_orang_tua = COALESCE(pgp_sym_encrypt($7::text, $1), nik_orang_tua),
         nomor_telepon = COALESCE(pgp_sym_encrypt($8::text, $1), nomor_telepon),
         updated_at = now()
       WHERE id = $2
       RETURNING user_id`,
      [KEY, id, d.nama ?? null, d.nim ?? null, d.nik ?? null,
       d.tanggal_lahir ?? null, d.nik_orang_tua ?? null, d.nomor_telepon ?? null]
    );
    if (!rows[0]) return false;
    if (d.is_minor !== undefined) {
      await client.query(
        'UPDATE users SET is_minor = $2, updated_at = now() WHERE id = $1',
        [rows[0].user_id, d.is_minor]
      );
    }
    return true;
  });

exports.updatePhoneByUserId = async (userId, nomorTelepon) => {
  const { rows } = await pool.query(
    `UPDATE mahasiswa
     SET nomor_telepon = pgp_sym_encrypt($3::text, $1), updated_at = now()
     WHERE user_id = $2
     RETURNING id`,
    [KEY, userId, nomorTelepon]
  );
  return rows[0]?.id || null;
};

// Hapus akun user; profil mahasiswa dan data konsen ikut terhapus lewat CASCADE
exports.remove = async (id) => {
  const { rows } = await pool.query(
    `DELETE FROM users
     WHERE id = (SELECT user_id FROM mahasiswa WHERE id = $1)
     RETURNING id`,
    [id]
  );
  return rows.length > 0;
};
