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
         m.tempat_lahir, m.nisn,
         m.alamat_asal, m.kab_kota_asal, m.kode_pos_asal,
         m.nama_ayah, m.nama_ibu,
         pgp_sym_decrypt(m.nomor_hp_orang_tua, $1) AS nomor_hp_orang_tua,
         m.alamat_domisili, m.kab_kota_domisili, m.kode_pos_domisili,
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

exports.SORT = { nim: 'm.nim', nama: 'm.nama', email: 'u.email', created_at: 'm.created_at' };

const LIST_FROM = `
  FROM mahasiswa m
  JOIN users u ON u.id = m.user_id
  WHERE ($1::text IS NULL
    OR m.nim ILIKE $1 ESCAPE '\\' OR m.nama ILIKE $1 ESCAPE '\\' OR u.email ILIKE $1 ESCAPE '\\')`;

// orderBy berasal dari listQuery, sudah dibatasi ke ekspresi di SORT
exports.list = async ({ pola, orderBy, limit, offset }) => {
  const total = await pool.query(`SELECT count(*)::int AS n ${LIST_FROM}`, [pola]);
  const { rows } = await pool.query(
    `SELECT m.id, m.nim, m.nama, u.email
     ${LIST_FROM}
     ORDER BY ${orderBy}, m.id
     LIMIT $2 OFFSET $3`,
    [pola, limit, offset]
  );
  return { rows, total: total.rows[0].n };
};

exports.findUserRole = async (userId) => {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role || null;
};

exports.create = (d) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO mahasiswa
         (user_id, nama, nim, nik, tanggal_lahir, nik_orang_tua, nomor_telepon,
          tempat_lahir, nisn, alamat_asal, kab_kota_asal, kode_pos_asal,
          nama_ayah, nama_ibu, nomor_hp_orang_tua)
       VALUES ($2, $3, $4,
         pgp_sym_encrypt($5::text, $1),
         pgp_sym_encrypt($6::text, $1),
         pgp_sym_encrypt($7::text, $1),
         pgp_sym_encrypt($8::text, $1),
         $9, $10, $11, $12, $13, $14, $15,
         pgp_sym_encrypt($16::text, $1))
       RETURNING id`,
      [KEY, d.user_id, d.nama, d.nim, d.nik, d.tanggal_lahir,
       d.nik_orang_tua ?? null, d.nomor_telepon,
       d.tempat_lahir ?? null, d.nisn ?? null, d.alamat_asal ?? null,
       d.kab_kota_asal ?? null, d.kode_pos_asal ?? null,
       d.nama_ayah ?? null, d.nama_ibu ?? null, d.nomor_hp_orang_tua ?? null]
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
         tempat_lahir = COALESCE($9, tempat_lahir),
         nisn = COALESCE($10, nisn),
         alamat_asal = COALESCE($11, alamat_asal),
         kab_kota_asal = COALESCE($12, kab_kota_asal),
         kode_pos_asal = COALESCE($13, kode_pos_asal),
         nama_ayah = COALESCE($14, nama_ayah),
         nama_ibu = COALESCE($15, nama_ibu),
         nomor_hp_orang_tua = COALESCE(pgp_sym_encrypt($16::text, $1), nomor_hp_orang_tua),
         updated_at = now()
       WHERE id = $2
       RETURNING user_id`,
      [KEY, id, d.nama ?? null, d.nim ?? null, d.nik ?? null,
       d.tanggal_lahir ?? null, d.nik_orang_tua ?? null, d.nomor_telepon ?? null,
       d.tempat_lahir ?? null, d.nisn ?? null, d.alamat_asal ?? null,
       d.kab_kota_asal ?? null, d.kode_pos_asal ?? null,
       d.nama_ayah ?? null, d.nama_ibu ?? null, d.nomor_hp_orang_tua ?? null]
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

// Simpan profil oleh mahasiswa sendiri: telepon, domisili, dan rekening dalam satu transaksi
exports.updateByUserId = (userId, d, rekening) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE mahasiswa SET
         nomor_telepon = pgp_sym_encrypt($3::text, $1),
         alamat_domisili = COALESCE($4, alamat_domisili),
         kab_kota_domisili = COALESCE($5, kab_kota_domisili),
         kode_pos_domisili = COALESCE($6, kode_pos_domisili),
         updated_at = now()
       WHERE user_id = $2
       RETURNING id`,
      [KEY, userId, d.nomor_telepon, d.alamat_domisili ?? null,
       d.kab_kota_domisili ?? null, d.kode_pos_domisili ?? null]
    );
    const id = rows[0]?.id;
    if (!id) return null;

    if (rekening) {
      await client.query(
        `INSERT INTO rekening_mahasiswa (mahasiswa_id, nama_bank, nomor_rekening, nama_pemilik)
         VALUES ($2, $3, pgp_sym_encrypt($4::text, $1), $5)
         ON CONFLICT (mahasiswa_id) DO UPDATE SET
           nama_bank = EXCLUDED.nama_bank,
           nomor_rekening = EXCLUDED.nomor_rekening,
           nama_pemilik = EXCLUDED.nama_pemilik,
           updated_at = now()`,
        [KEY, id, rekening.nama_bank, rekening.nomor_rekening, rekening.nama_pemilik]
      );
    }
    return id;
  });

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
