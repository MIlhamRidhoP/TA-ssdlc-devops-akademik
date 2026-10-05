const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, loginSemua } = require('./helpers');

const AKTIF = process.env.SEMESTER_AKTIF;
let tokens;
let cutiBudi;
let lampiranBudi;
let lampiranCitra;

const bodyCuti = (tambahan = {}) => ({
  semester: AKTIF,
  kategori: 'kesehatan',
  alasan: 'Rawat inap',
  alamat_cuti: 'Jl. Uji No. 1, Bandung',
  nomor_telepon: '081311112222',
  ...tambahan,
});

before(async () => {
  tokens = await loginSemua();
  const list = await api('GET', '/api/cuti?q=budi', { token: tokens.admin });
  cutiBudi = list.body.data.find((c) => c.status === 'diajukan');

  const mhs = await api('GET', '/api/mahasiswa', { token: tokens.admin });
  const idOf = (nim) => mhs.body.data.find((m) => m.nim === nim).id;
  const docs = async (nim) => (await api('GET', `/api/mahasiswa/${idOf(nim)}/dokumen`, { token: tokens.admin })).body.data;
  lampiranBudi = (await docs('103032300002')).find((d) => d.jenis === 'lampiran_cuti');
  lampiranCitra = (await docs('103032300003')).find((d) => d.jenis === 'lampiran_cuti');
});

test('status dan catatan dari body diabaikan saat pengajuan dibuat', async () => {
  const r = await api('POST', '/api/cuti/me', {
    token: tokens.andi,
    body: bodyCuti({ status: 'disetujui', catatan_admin: 'Disetujui sendiri', mahasiswa_id: cutiBudi.mahasiswa_id }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.status, 'diajukan');
  assert.equal(r.body.data.catatan_admin, null);
  assert.equal(r.body.data.nim, '103032300001');
  assert.equal(r.body.data.alamat_cuti, 'Jl. Uji No. 1, Bandung');

  const batal = await api('POST', `/api/cuti/me/${r.body.data.id}/batal`, { token: tokens.andi });
  assert.equal(batal.status, 200);
  assert.equal(batal.body.data.status, 'dibatalkan');
  const lagi = await api('POST', `/api/cuti/me/${r.body.data.id}/batal`, { token: tokens.andi });
  assert.equal(lagi.status, 409);
});

test('pengajuan cuti milik mahasiswa lain tidak bisa diakses atau dibatalkan', async () => {
  assert.ok(cutiBudi, 'Data cuti budi tidak ada di seed');
  const lihat = await api('GET', `/api/cuti/me/${cutiBudi.id}`, { token: tokens.andi });
  assert.equal(lihat.status, 404);
  const batal = await api('POST', `/api/cuti/me/${cutiBudi.id}/batal`, { token: tokens.andi });
  assert.equal(batal.status, 404);
  const sendiri = await api('GET', `/api/cuti/me/${cutiBudi.id}`, { token: tokens.budi });
  assert.equal(sendiri.status, 200);
  assert.equal(sendiri.body.data.status, 'diajukan');

  const daftar = await api('GET', '/api/cuti/me', { token: tokens.andi });
  assert.ok(daftar.body.data.every((c) => c.id !== cutiBudi.id));
});

test('lampiran harus dokumen lampiran_cuti milik sendiri', async () => {
  const milikLain = await api('POST', '/api/cuti/me', {
    token: tokens.andi, body: bodyCuti({ dokumen_id: lampiranBudi.id }),
  });
  assert.equal(milikLain.status, 400);

  const ktp = (await api('GET', '/api/mahasiswa/me/dokumen', { token: tokens.andi })).body.data
    .find((d) => d.jenis === 'ktp');
  const bukanLampiran = await api('POST', '/api/cuti/me', {
    token: tokens.andi, body: bodyCuti({ dokumen_id: ktp.id }),
  });
  assert.equal(bukanLampiran.status, 400);

  const sah = await api('POST', '/api/cuti/me', {
    token: tokens.citra, body: bodyCuti({ dokumen_id: lampiranCitra.id }),
  });
  assert.equal(sah.status, 201);
  assert.equal(sah.body.data.dokumen_id, lampiranCitra.id);
  await api('POST', `/api/cuti/me/${sah.body.data.id}/batal`, { token: tokens.citra });
});

test('validasi pengajuan cuti', async () => {
  const kasus = [
    bodyCuti({ semester: '2020-ganjil' }),
    bodyCuti({ kategori: 'liburan' }),
    bodyCuti({ alasan: '' }),
    bodyCuti({ nomor_telepon: '12ab' }),
    bodyCuti({ alamat_cuti: undefined }),
  ];
  for (const body of kasus) {
    const r = await api('POST', '/api/cuti/me', { token: tokens.andi, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('satu pengajuan aktif per semester', async () => {
  const r = await api('POST', '/api/cuti/me', { token: tokens.budi, body: bodyCuti() });
  assert.equal(r.status, 409);
});

test('admin memutuskan pengajuan hanya dari status diajukan', async () => {
  const r = await api('POST', '/api/cuti/me', { token: tokens.andi, body: bodyCuti() });
  assert.equal(r.status, 201);
  const id = r.body.data.id;

  const salah = await api('PUT', `/api/cuti/${id}/status`, { token: tokens.admin, body: { status: 'dibatalkan' } });
  assert.equal(salah.status, 400);
  const tolak = await api('PUT', `/api/cuti/${id}/status`, {
    token: tokens.admin, body: { status: 'ditolak', catatan_admin: 'Lampiran belum ada' },
  });
  assert.equal(tolak.status, 200);
  assert.equal(tolak.body.data.status, 'ditolak');
  assert.equal(tolak.body.data.catatan_admin, 'Lampiran belum ada');

  const ulang = await api('PUT', `/api/cuti/${id}/status`, { token: tokens.admin, body: { status: 'disetujui' } });
  assert.equal(ulang.status, 409);
  const batal = await api('POST', `/api/cuti/me/${id}/batal`, { token: tokens.andi });
  assert.equal(batal.status, 409);
});

test('mahasiswa tidak bisa memakai endpoint admin cuti', async () => {
  const list = await api('GET', '/api/cuti', { token: tokens.andi });
  assert.equal(list.status, 403);
  const putus = await api('PUT', `/api/cuti/${cutiBudi.id}/status`, { token: tokens.budi, body: { status: 'disetujui' } });
  assert.equal(putus.status, 403);
});

test('mahasiswa di bawah umur tanpa konsen diblokir dari cuti', async () => {
  const r = await api('GET', '/api/cuti/me', { token: tokens.eka });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'CONSENT_REQUIRED');
});

test('list admin cuti memakai list-query dan tidak memuat data terenkripsi', async () => {
  const r = await api('GET', '/api/cuti?sort=nim&order=asc', { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('x-total-count'), /^\d+$/);
  assert.ok(!r.raw.includes('alamat_cuti'));
  assert.ok(!r.raw.includes('nomor_telepon'));
  const salah = await api('GET', '/api/cuti?sort=alamat_cuti', { token: tokens.admin });
  assert.equal(salah.status, 400);
});

test('ekspor memuat pengajuan cuti milik sendiri', async () => {
  const r = await api('GET', '/api/mahasiswa/me/ekspor', { token: tokens.budi });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.pengajuan_cuti.some((c) => c.id === cutiBudi.id && c.alamat_cuti));
});
