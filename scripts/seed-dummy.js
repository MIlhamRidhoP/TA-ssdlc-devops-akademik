require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');
const { UPLOAD_DIR } = require('../src/config/upload');
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

// File contoh berukuran kecil yang valid sebagai pdf dan png
const FILE_CONTOH = {
  pdf: {
    mime: 'application/pdf',
    isi: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
      + '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
  },
  png: {
    mime: 'image/png',
    isi: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  },
};

const KOTA = ['Bandung', 'Kabupaten Bogor', 'Surabaya', 'Kota Semarang', 'Kabupaten Sleman'];

// Data profil tambahan, dibuat dari urutan mahasiswa supaya tetap fiktif dan konsisten
const profilTambahan = (m, i) => ({
  tempatLahir: KOTA[i].replace('Kabupaten ', '').replace('Kota ', ''),
  nisn: `00${m.nim.slice(-8)}`,
  alamatAsal: `Jl. Contoh Asal No. ${i + 1}`,
  kabKotaAsal: KOTA[i],
  kodePosAsal: `4${i}111`,
  namaAyah: `Ayah ${m.nama.split(' ')[0]}`,
  namaIbu: `Ibu ${m.nama.split(' ')[0]}`,
  hpOrangTua: `08120000000${i + 1}`,
  alamatDomisili: `Jl. Telekomunikasi Gg. ${i + 1} No. ${10 + i}`,
  kabKotaDomisili: 'Kabupaten Bandung',
  kodePosDomisili: '40257',
});

const PROFIL = {
  'andi@mahasiswa.test': {
    rekening: { bank: 'BNI', nomor: '1234567890', pemilik: 'Andi Pratama' },
    email: [['pribadi', 'andi.pratama@contoh.test'], ['alternatif', 'andi.p@contoh.test']],
    sosial: [['github', 'andipratama', 'https://github.com/andipratama'], ['linkedin', 'andi-pratama', 'https://www.linkedin.com/in/andi-pratama']],
    dokumen: [['ktp', 'ktp_andi.png', 'png', 'terverifikasi'], ['ijazah', 'ijazah_andi.pdf', 'pdf', 'menunggu']],
    login: ['berhasil', 'gagal', 'berhasil'],
    cuti: [],
  },
  'budi@mahasiswa.test': {
    rekening: { bank: 'BRI', nomor: '0987654321012', pemilik: 'Budi Santoso' },
    email: [['pribadi', 'budi.santoso@contoh.test']],
    sosial: [['instagram', 'budi.santoso', 'https://www.instagram.com/budi.santoso']],
    dokumen: [['kartu_keluarga', 'kk_budi.pdf', 'pdf', 'ditolak'], ['lampiran_cuti', 'surat_keterangan_budi.pdf', 'pdf', 'menunggu']],
    login: ['gagal', 'gagal', 'berhasil'],
    cuti: [{ semester: AKTIF, kategori: 'kesehatan', alasan: 'Perawatan pasca operasi', alamat: 'Jl. Contoh Rawat No. 2, Bandung', status: 'diajukan', lampiran: true }],
  },
  'citra@mahasiswa.test': {
    rekening: { bank: 'Mandiri', nomor: '1300011122233', pemilik: 'Citra Lestari' },
    email: [['kerja', 'citra@kantor-contoh.test']],
    sosial: [],
    dokumen: [['ktp', 'ktp_citra.png', 'png', 'menunggu'], ['lampiran_cuti', 'lampiran_citra.pdf', 'pdf', 'terverifikasi']],
    login: ['berhasil'],
    cuti: [{ semester: LALU, kategori: 'ekonomi', alasan: 'Membantu usaha keluarga', alamat: 'Jl. Contoh Asal No. 3, Surabaya', status: 'ditolak', catatan: 'Pengajuan melewati batas waktu', lampiran: true }],
  },
  'dewi@mahasiswa.test': {
    rekening: null,
    email: [],
    sosial: [['x', 'dewi_ang', 'https://x.com/dewi_ang']],
    dokumen: [['ktp', 'kartu_pelajar_dewi.pdf', 'pdf', 'menunggu']],
    login: ['berhasil'],
    cuti: [{ semester: AKTIF, kategori: 'keluarga', alasan: 'Mendampingi orang tua', alamat: 'Jl. Contoh Asal No. 4, Semarang', status: 'dibatalkan' }],
  },
  'eka@mahasiswa.test': {
    rekening: null,
    email: [],
    sosial: [],
    dokumen: [],
    login: ['gagal'],
    cuti: [],
  },
};

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

    const fileBaru = [];
    let jumlahCuti = 0;
    const mkId = {};
    for (const mk of MATA_KULIAH) {
      const r = await client.query(
        'INSERT INTO mata_kuliah (kode, nama, sks) VALUES ($1, $2, $3) RETURNING id',
        [mk.kode, mk.nama, mk.sks]
      );
      mkId[mk.kode] = r.rows[0].id;
    }

    for (const [i, m] of MAHASISWA.entries()) {
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

      const pt = profilTambahan(m, i);
      await client.query(
        `UPDATE mahasiswa SET
           tempat_lahir = $3, nisn = $4, alamat_asal = $5, kab_kota_asal = $6, kode_pos_asal = $7,
           nama_ayah = $8, nama_ibu = $9, nomor_hp_orang_tua = pgp_sym_encrypt($10::text, $1),
           alamat_domisili = $11, kab_kota_domisili = $12, kode_pos_domisili = $13
         WHERE id = $2`,
        [KEY, mahasiswaId, pt.tempatLahir, pt.nisn, pt.alamatAsal, pt.kabKotaAsal, pt.kodePosAsal,
         pt.namaAyah, pt.namaIbu, pt.hpOrangTua, pt.alamatDomisili, pt.kabKotaDomisili, pt.kodePosDomisili]
      );

      const profil = PROFIL[m.email];
      if (profil.rekening) {
        await client.query(
          `INSERT INTO rekening_mahasiswa (mahasiswa_id, nama_bank, nomor_rekening, nama_pemilik)
           VALUES ($2, $3, pgp_sym_encrypt($4::text, $1), $5)`,
          [KEY, mahasiswaId, profil.rekening.bank, profil.rekening.nomor, profil.rekening.pemilik]
        );
      }
      for (const [tipe, email] of profil.email) {
        await client.query(
          'INSERT INTO email_mahasiswa (mahasiswa_id, tipe, email) VALUES ($1, $2, $3)',
          [mahasiswaId, tipe, email]
        );
      }
      for (const [platform, idAkun, url] of profil.sosial) {
        await client.query(
          'INSERT INTO akun_sosial_mahasiswa (mahasiswa_id, platform, id_akun, url) VALUES ($1, $2, $3, $4)',
          [mahasiswaId, platform, idAkun, url]
        );
      }
      let lampiranId = null;
      for (const [jenis, namaAsli, tipe, status] of profil.dokumen) {
        const file = FILE_CONTOH[tipe];
        const namaDisk = `${crypto.randomUUID()}.${tipe}`;
        const d = await client.query(
          `INSERT INTO dokumen_mahasiswa
             (mahasiswa_id, jenis, nama_file_asli, path_file, mime, ukuran, status_verifikasi)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [mahasiswaId, jenis, namaAsli, namaDisk, file.mime, file.isi.length, status]
        );
        if (jenis === 'lampiran_cuti') lampiranId = d.rows[0].id;
        fileBaru.push([namaDisk, file.isi]);
      }
      for (const c of profil.cuti) {
        await client.query(
          `INSERT INTO pengajuan_cuti
             (mahasiswa_id, semester, kategori, alasan, alamat_cuti, nomor_telepon, dokumen_id,
              status, catatan_admin)
           VALUES ($2, $3, $4, $5, pgp_sym_encrypt($6::text, $1), pgp_sym_encrypt($7::text, $1),
             $8, $9, $10)`,
          [KEY, mahasiswaId, c.semester, c.kategori, c.alasan, c.alamat, m.telepon,
           c.lampiran ? lampiranId : null, c.status, c.catatan ?? null]
        );
        jumlahCuti++;
      }
      for (const [n, status] of profil.login.entries()) {
        await client.query(
          `INSERT INTO riwayat_login (user_id, waktu, ip, user_agent, status)
           VALUES ($1, now() - make_interval(days => $2), $3, $4, $5)`,
          [u.rows[0].id, profil.login.length - n, `10.0.0.${i + 1}`, 'Mozilla/5.0 (seed)', status]
        );
      }

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
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    for (const [nama, isi] of fileBaru) {
      await fs.writeFile(path.join(UPLOAD_DIR, nama), isi);
    }
    console.log(`Seed selesai: ${MATA_KULIAH.length} mata kuliah, ${MAHASISWA.length} mahasiswa, ${fileBaru.length} dokumen, ${jumlahCuti} pengajuan cuti (semester aktif ${AKTIF}, riwayat ${LALU})`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
