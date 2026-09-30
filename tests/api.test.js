require('dotenv').config();
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Uji ini hanya membaca data, tidak mengubah database.
// Membutuhkan database yang sudah di-seed (seed:admin dan seed:dummy).

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* bukan JSON */ }
  return { status: res.status, body: json, raw: text };
};

const login = async (email, password) => {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `Login ${email} gagal`);
  return r.body.data.token;
};

const tokens = {};
let idBudi;

before(async () => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) break;
    } catch { /* server belum siap */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  tokens.admin = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  for (const nama of ['andi', 'budi', 'citra', 'dewi', 'eka']) {
    tokens[nama] = await login(`${nama}@mahasiswa.test`, process.env.SEED_USER_PASSWORD);
  }

  const list = await api('GET', '/api/mahasiswa', { token: tokens.admin });
  idBudi = list.body.data.find((m) => m.nim === '103032300002').id;
});

test('health check', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
});

test('tanpa token ditolak 401', async () => {
  const r = await api('GET', '/api/mahasiswa/me');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHORIZED');
});

test('login gagal tidak membedakan email salah dan password salah', async () => {
  const a = await api('POST', '/api/auth/login', { body: { email: 'andi@mahasiswa.test', password: 'SalahSekali1' } });
  const b = await api('POST', '/api/auth/login', { body: { email: 'tidakada@mahasiswa.test', password: 'SalahSekali1' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
});

test('mahasiswa tidak bisa akses endpoint admin (403)', async () => {
  const r = await api('GET', '/api/mahasiswa', { token: tokens.andi });
  assert.equal(r.status, 403);
});

test('mahasiswa tidak bisa membuka data mahasiswa lain (authorization bypass)', async () => {
  const r = await api('GET', `/api/mahasiswa/${idBudi}`, { token: tokens.andi });
  assert.equal(r.status, 403);
});

test('list mahasiswa tidak mengandung field sensitif', async () => {
  const r = await api('GET', '/api/mahasiswa', { token: tokens.admin });
  assert.equal(r.status, 200);
  for (const m of r.body.data) {
    for (const f of ['nik', 'tanggal_lahir', 'nik_orang_tua', 'nomor_telepon']) {
      assert.ok(!(f in m), `Field ${f} bocor di list`);
    }
  }
});

test('password_hash tidak pernah muncul di respons', async () => {
  const r = await api('GET', '/api/mahasiswa/me', { token: tokens.andi });
  assert.ok(!r.raw.includes('password_hash'));
});

test('ID bukan UUID ditolak 400', async () => {
  const r = await api('GET', '/api/mahasiswa/bukan-uuid', { token: tokens.admin });
  assert.equal(r.status, 400);
});

test('payload SQL Injection di pencarian mata kuliah diperlakukan sebagai teks', async () => {
  const q = encodeURIComponent("' OR '1'='1");
  const r = await api('GET', `/api/mata-kuliah?q=${q}`, { token: tokens.andi });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, []);
});

test('kuota SKS sesuai IPS semester sebelumnya', async () => {
  const harapan = { andi: [3.78, 24], budi: [2.67, 21], citra: [1.33, 15], dewi: [null, 19] };
  for (const [nama, [ips, kuota]] of Object.entries(harapan)) {
    const r = await api('GET', '/api/krs/me', { token: tokens[nama] });
    assert.equal(r.status, 200, nama);
    assert.equal(r.body.data.ips_sebelumnya, ips, `IPS ${nama}`);
    assert.equal(r.body.data.kuota, kuota, `Kuota ${nama}`);
  }
});

test('mahasiswa di bawah umur tanpa konsen diblokir dari KRS dan nilai', async () => {
  const krs = await api('GET', '/api/krs/me', { token: tokens.eka });
  const nilai = await api('GET', '/api/nilai/me', { token: tokens.eka });
  assert.equal(krs.status, 403);
  assert.equal(krs.body.error.code, 'CONSENT_REQUIRED');
  assert.equal(nilai.status, 403);
  assert.equal(nilai.body.error.code, 'CONSENT_REQUIRED');
});

test('nilai draft dan item belum dinilai tidak terlihat oleh mahasiswa', async () => {
  const r = await api('GET', '/api/nilai/me', { token: tokens.andi });
  assert.equal(r.status, 200);
  const aktif = r.body.data.find((s) => s.semester === process.env.SEMESTER_AKTIF);
  assert.ok(aktif, 'Semester aktif tidak ditemukan');
  assert.deepEqual(aktif.items.map((i) => i.kode).sort(), ['IF1002', 'IF1004']);
  assert.equal(aktif.ips, 3.79);
});

test('mahasiswa tidak bisa mengubah nilai', async () => {
  const r = await api('PUT', '/api/nilai/00000000-0000-0000-0000-000000000000', {
    token: tokens.andi,
    body: { nilai_huruf: 'A' },
  });
  assert.equal(r.status, 403);
});
