const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, upload, download, loginSemua, PNG } = require('./helpers');

let tokens;
let idAndi;
let idBudi;
let dokumenBudi;

before(async () => {
  tokens = await loginSemua();
  const list = await api('GET', '/api/mahasiswa', { token: tokens.admin });
  idAndi = list.body.data.find((m) => m.nim === '103032300001').id;
  idBudi = list.body.data.find((m) => m.nim === '103032300002').id;
  const docs = await api('GET', `/api/mahasiswa/${idBudi}/dokumen`, { token: tokens.admin });
  dokumenBudi = docs.body.data;
});

test('GET /me menampilkan field baru dan rekening tersamar', async () => {
  const r = await api('GET', '/api/mahasiswa/me', { token: tokens.andi });
  assert.equal(r.status, 200);
  const d = r.body.data;
  for (const f of ['nik', 'tanggal_lahir', 'nomor_telepon', 'status_konsen', 'nisn', 'nama_ayah',
    'nomor_hp_orang_tua', 'alamat_domisili', 'kode_pos_asal']) {
    assert.ok(f in d, `Field ${f} tidak ada`);
  }
  assert.equal(d.rekening.nama_bank, 'BNI');
  assert.equal(d.rekening.nomor_rekening, '****7890');
  assert.ok(!r.raw.includes('1234567890'));
  assert.ok(Array.isArray(d.email_tambahan) && d.email_tambahan.length > 0);
  assert.ok(Array.isArray(d.akun_sosial) && d.akun_sosial.length > 0);
});

test('ekspor menampilkan nomor rekening utuh dan tidak memuat path file', async () => {
  const r = await api('GET', '/api/mahasiswa/me/ekspor', { token: tokens.andi });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.rekening.nomor_rekening, '1234567890');
  assert.equal(r.body.data.profil.nim, '103032300001');
  assert.ok(r.body.data.dokumen.length >= 2);
  assert.ok(!r.raw.includes('path_file'));
  assert.ok(!r.raw.includes('password_hash'));
});

test('PUT /me mengabaikan field identitas, asal, dan keluarga', async () => {
  const before = await api('GET', '/api/mahasiswa/me', { token: tokens.andi });
  const r = await api('PUT', '/api/mahasiswa/me', {
    token: tokens.andi,
    body: {
      nomor_telepon: '081300000001',
      kab_kota_domisili: 'Kabupaten Bandung',
      nama: 'Nama Diubah',
      nim: '999999999999',
      nisn: '9999999999',
      tempat_lahir: 'Diubah',
      alamat_asal: 'Diubah',
      nama_ayah: 'Diubah',
      nomor_hp_orang_tua: '089999999999',
      user_id: idBudi,
      rekening: { nama_bank: 'BNI', nomor_rekening: '1234567890', nama_pemilik: 'Andi Pratama' },
    },
  });
  assert.equal(r.status, 200);
  const after = await api('GET', '/api/mahasiswa/me', { token: tokens.andi });
  for (const f of ['nama', 'nim', 'nisn', 'tempat_lahir', 'alamat_asal', 'nama_ayah', 'nomor_hp_orang_tua', 'user_id']) {
    assert.equal(after.body.data[f], before.body.data[f], `Field ${f} ikut berubah`);
  }
});

test('PUT /me menolak rekening dengan bank di luar daftar', async () => {
  const r = await api('PUT', '/api/mahasiswa/me', {
    token: tokens.andi,
    body: {
      nomor_telepon: '081300000001',
      rekening: { nama_bank: 'Bank Fiktif', nomor_rekening: '1234567890', nama_pemilik: 'Andi' },
    },
  });
  assert.equal(r.status, 400);
});

test('upload menolak ekstensi yang tidak diizinkan', async () => {
  const r = await upload(tokens.andi, {
    jenis: 'lampiran_cuti', nama: 'skrip.exe', isi: PNG, mime: 'application/octet-stream',
  });
  assert.equal(r.status, 400);
  const r2 = await upload(tokens.andi, { jenis: 'lampiran_cuti', nama: 'gambar.png.html', isi: PNG, mime: 'image/png' });
  assert.equal(r2.status, 400);
});

test('upload menolak file lebih dari 2 MB', async () => {
  const besar = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  const r = await upload(tokens.andi, { jenis: 'lampiran_cuti', nama: 'besar.png', isi: besar, mime: 'image/png' });
  assert.equal(r.status, 400);
});

test('upload menolak isi file yang tidak sesuai tipenya', async () => {
  const r = await upload(tokens.andi, {
    jenis: 'lampiran_cuti', nama: 'palsu.png', isi: Buffer.from('<html></html>'), mime: 'image/png',
  });
  assert.equal(r.status, 400);
});

test('upload menolak jenis kedua untuk dokumen yang sudah ada', async () => {
  const r = await upload(tokens.andi, { jenis: 'ktp', nama: 'ktp.png', isi: PNG, mime: 'image/png' });
  assert.equal(r.status, 409);
});

test('upload lampiran yang valid bisa diunduh kembali oleh pemiliknya', async () => {
  const r = await upload(tokens.dewi, { jenis: 'lampiran_cuti', nama: 'surat.png', isi: PNG, mime: 'image/png' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.status_verifikasi, 'menunggu');
  assert.ok(!('path_file' in r.body.data));

  const f = await download(`/api/mahasiswa/me/dokumen/${r.body.data.id}`, tokens.dewi);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/png');
  assert.ok(f.buffer.equals(PNG));
});

test('daftar dokumen sendiri tidak memuat path file', async () => {
  const r = await api('GET', '/api/mahasiswa/me/dokumen', { token: tokens.andi });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length >= 2);
  assert.ok(!r.raw.includes('path_file'));
});

test('dokumen milik mahasiswa lain tidak bisa diakses', async () => {
  assert.ok(dokumenBudi.length > 0);
  for (const d of dokumenBudi) {
    const f = await download(`/api/mahasiswa/me/dokumen/${d.id}`, tokens.andi);
    assert.equal(f.status, 404);
  }
  const lintas = await download(`/api/mahasiswa/${idAndi}/dokumen/${dokumenBudi[0].id}`, tokens.admin);
  assert.equal(lintas.status, 404);
  const admin = await api('GET', `/api/mahasiswa/${idBudi}/dokumen`, { token: tokens.andi });
  assert.equal(admin.status, 403);
});

test('admin bisa mengunduh dan memverifikasi dokumen mahasiswa', async () => {
  const d = dokumenBudi.find((x) => x.mime === 'application/pdf');
  const f = await download(`/api/mahasiswa/${idBudi}/dokumen/${d.id}`, tokens.admin);
  assert.equal(f.status, 200);
  assert.ok(f.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')));

  const salah = await api('PUT', `/api/mahasiswa/${idBudi}/dokumen/${d.id}/verifikasi`, {
    token: tokens.admin, body: { status_verifikasi: 'disetujui' },
  });
  assert.equal(salah.status, 400);
  const ok = await api('PUT', `/api/mahasiswa/${idBudi}/dokumen/${d.id}/verifikasi`, {
    token: tokens.admin, body: { status_verifikasi: d.status_verifikasi },
  });
  assert.equal(ok.status, 200);
});

test('riwayat login hanya milik sendiri, terbaru dulu', async () => {
  const r = await api('GET', '/api/mahasiswa/me/riwayat-login', { token: tokens.budi });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length > 0 && r.body.data.length <= 50);
  const waktu = r.body.data.map((x) => new Date(x.waktu).getTime());
  assert.deepEqual(waktu, [...waktu].sort((a, b) => b - a));
  assert.ok(!('user_id' in r.body.data[0]));
});

test('akun sosial wajib URL https', async () => {
  for (const url of ['http://github.com/andi', 'javascript:alert(1)', 'bukan url']) {
    const r = await api('POST', '/api/mahasiswa/me/akun-sosial', {
      token: tokens.citra, body: { platform: 'github', id_akun: 'citra', url },
    });
    assert.equal(r.status, 400, url);
  }
});

test('email tambahan bisa ditambah dan dihapus pemiliknya saja', async () => {
  const salah = await api('POST', '/api/mahasiswa/me/email', {
    token: tokens.citra, body: { tipe: 'pribadi', email: 'bukan-email' },
  });
  assert.equal(salah.status, 400);

  const r = await api('POST', '/api/mahasiswa/me/email', {
    token: tokens.citra, body: { tipe: 'alternatif', email: `uji.${Date.now()}@contoh.test` },
  });
  assert.equal(r.status, 201);
  const orangLain = await api('DELETE', `/api/mahasiswa/me/email/${r.body.data.id}`, { token: tokens.andi });
  assert.equal(orangLain.status, 404);
  const hapus = await api('DELETE', `/api/mahasiswa/me/email/${r.body.data.id}`, { token: tokens.citra });
  assert.equal(hapus.status, 200);
});

test('admin menolak NISN dan kode pos yang salah format', async () => {
  const r = await api('PUT', `/api/mahasiswa/${idBudi}`, { token: tokens.admin, body: { nisn: '12ab' } });
  assert.equal(r.status, 400);
  const r2 = await api('PUT', `/api/mahasiswa/${idBudi}`, { token: tokens.admin, body: { kode_pos_asal: '123' } });
  assert.equal(r2.status, 400);
});
