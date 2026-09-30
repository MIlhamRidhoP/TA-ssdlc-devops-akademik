require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');
const { KEY } = require('../src/config/crypto');
const { SEMESTER_AKTIF, BOBOT } = require('../src/config/akademik');

// Semua data di bawah ini fiktif, bukan data mahasiswa asli

const semesterSebelum = (s) => {
  const [tahun, periode] = s.split('-');
  return periode === 'genap' ? `${tahun}-ganjil` : `${Number(tahun) - 1}-genap`;
};

const tanggalUmur17 = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 17);
  return d.toISOString().slice(0, 10);
};

const AKTIF = SEMESTER_AKTIF;
const LALU = semesterSebelum(AKTIF);

const pub = (huruf) => ({ huruf, status: 'published' });
const draft = (huruf) => ({ huruf, status: 'draft' });

const MATA_KULIAH = [
  { kode: 'IF1001', nama: 'Algoritma dan Pemrograman', sks: 4 },
  { kode: 'IF1002', nama: 'Basis Data', sks: 4 },
  { kode: 'IF1003', nama: 'Jaringan Komputer', sks: 3 },
  { kode: 'IF1004', nama: 'Sistem Operasi', sks: 3 },
  { kode: 'IF1005', nama: 'Keamanan Informasi', sks: 3 },
  { kode: 'IF1006', nama: 'Etika Profesi', sks: 2 },
  { kode: 'IF1007', nama: 'Bahasa Inggris', sks: 2 },
  { kode: 'IF1008', nama: 'Struktur Data', sks: 4 },
  { kode: 'IF1009', nama: 'Rekayasa Perangkat Lunak', sks: 3 },
];

const MAHASISWA = [
  {
    // Dewasa, IPS semester lalu >= 3.00, kuota 24
    nama: 'Andi Pratama', email: 'andi@mahasiswa.test', nim: '103032300001',
    nik: '3276010101040001', tanggalLahir: '2004-03-12', telepon: '081300000001', minor: false,
    krs: [
      { semester: LALU, status: 'locked', items: [['IF1001', pub('A')], ['IF1003', pub('A')], ['IF1006', pub('B')]] },
      { semester: AKTIF, status: 'locked', items: [['IF1002', pub('A')], ['IF1004', pub('AB')], ['IF1005', draft('B')], ['IF1008', null]] },
    ],
  },
  {
    // Dewasa, IPS semester lalu 2.50 sampai 2.99, kuota 21
    nama: 'Budi Santoso', email: 'budi@mahasiswa.test', nim: '103032300002',
    nik: '3276010101040002', tanggalLahir: '2004-07-21', telepon: '081300000002', minor: false,
    krs: [
      { semester: LALU, status: 'locked', items: [['IF1001', pub('B')], ['IF1003', pub('C')], ['IF1006', pub('B')]] },
      { semester: AKTIF, status: 'submitted', items: [['IF1002', null], ['IF1004', null], ['IF1009', null]] },
    ],
  },
  {
    // Dewasa, IPS semester lalu < 2.00, kuota 15
    nama: 'Citra Lestari', email: 'citra@mahasiswa.test', nim: '103032300003',
    nik: '3276010101050003', tanggalLahir: '2005-01-05', telepon: '081300000003', minor: false,
    krs: [
      { semester: LALU, status: 'locked', items: [['IF1001', pub('D')], ['IF1003', pub('C')], ['IF1006', pub('D')]] },
      { semester: AKTIF, status: 'draft', items: [['IF1002', null], ['IF1007', null]] },
    ],
  },
  {
    // Di bawah 18 tahun, konsen approved
    nama: 'Dewi Anggraini', email: 'dewi@mahasiswa.test', nim: '103032300004',
    nik: '3276010101090004', tanggalLahir: tanggalUmur17(), nikOrangTua: '3276010101750004',
    telepon: '081300000004', minor: true,
    konsen: { namaWali: 'Siti Rahmawati', url: 'https://contoh.test/konsen/dewi.pdf', status: 'approved' },
    krs: [
      { semester: AKTIF, status: 'draft', items: [['IF1002', null], ['IF1003', null]] },
    ],
  },
  {
    // Di bawah 18 tahun, TANPA konsen, harus terblokir dari KRS dan nilai
    nama: 'Eka Putri', email: 'eka@mahasiswa.test', nim: '103032300005',
    nik: '3276010101090005', tanggalLahir: tanggalUmur17(), nikOrangTua: '3276010101760005',
    telepon: '081300000005', minor: true,
    krs: [],
  },
];

(async () => {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    console.error('SEED_USER_PASSWORD wajib diisi di .env: minimal 8 karakter, ada huruf besar dan angka');
    process.exitCode = 1;
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT (SELECT count(*) FROM mahasiswa) + (SELECT count(*) FROM mata_kuliah) AS n'
    );
    if (Number(rows[0].n) > 0) {
      console.error('Database sudah berisi data. Reset volume dulu kalau ingin seed ulang.');
      process.exitCode = 1;
      return;
    }

    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);

    const mkId = {};
    for (const mk of MATA_KULIAH) {
      const r = await client.query(
        'INSERT INTO mata_kuliah (kode, nama, sks) VALUES ($1, $2, $3) RETURNING id',
        [mk.kode, mk.nama, mk.sks]
      );
      mkId[mk.kode] = r.rows[0].id;
    }

    for (const m of MAHASISWA) {
      const u = await client.query(
        `INSERT INTO users (email, password_hash, role, is_minor)
         VALUES ($1, $2, 'mahasiswa', $3) RETURNING id`,
        [m.email, hash, m.minor]
      );

      const mh = await client.query(
        `INSERT INTO mahasiswa
           (user_id, nama, nim, nik, tanggal_lahir, nik_orang_tua, nomor_telepon)
         VALUES ($2, $3, $4,
           pgp_sym_encrypt($5::text, $1),
           pgp_sym_encrypt($6::text, $1),
           pgp_sym_encrypt($7::text, $1),
           pgp_sym_encrypt($8::text, $1))
         RETURNING id`,
        [KEY, u.rows[0].id, m.nama, m.nim, m.nik, m.tanggalLahir, m.nikOrangTua ?? null, m.telepon]
      );
      const mahasiswaId = mh.rows[0].id;

      if (m.konsen) {
        await client.query(
          `INSERT INTO konsen_orang_tua
             (mahasiswa_id, nama_wali, bukti_persetujuan_url, tanggal_persetujuan, status)
           VALUES ($1, $2, $3, now(), $4)`,
          [mahasiswaId, m.konsen.namaWali, m.konsen.url, m.konsen.status]
        );
      }

      for (const k of m.krs) {
        const h = await client.query(
          `INSERT INTO krs_semester (mahasiswa_id, semester, status, submitted_at, locked_at)
           VALUES ($1, $2, $3::text,
             CASE WHEN $3::text IN ('submitted', 'locked') THEN now() END,
             CASE WHEN $3::text = 'locked' THEN now() END)
           RETURNING id`,
          [mahasiswaId, k.semester, k.status]
        );

        for (const [kode, nilai] of k.items) {
          const item = await client.query(
            'INSERT INTO krs (krs_semester_id, mata_kuliah_id) VALUES ($1, $2) RETURNING id',
            [h.rows[0].id, mkId[kode]]
          );
          if (nilai) {
            await client.query(
              `INSERT INTO nilai (krs_id, nilai_huruf, nilai_angka, status)
               VALUES ($1, $2, $3, $4)`,
              [item.rows[0].id, nilai.huruf, BOBOT[nilai.huruf], nilai.status]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log(`Seed selesai: ${MATA_KULIAH.length} mata kuliah, ${MAHASISWA.length} mahasiswa (semester aktif ${AKTIF}, riwayat ${LALU})`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
