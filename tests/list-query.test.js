const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { api, loginSemua } = require('./helpers');

let tokens;
const ENDPOINT = ['/api/mahasiswa', '/api/krs', '/api/nilai'];

before(async () => {
  tokens = await loginSemua();
});

test('sort di luar daftar ditolak 400', async () => {
  for (const path of ENDPOINT) {
    for (const sort of ['password_hash', 'nik', 'm.nim; DROP TABLE users', '__proto__', 'constructor']) {
      const r = await api('GET', `${path}?sort=${encodeURIComponent(sort)}`, { token: tokens.admin });
      assert.equal(r.status, 400, `${path} sort=${sort}`);
      assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    }
  }
});

test('order, page, dan limit yang salah ditolak 400', async () => {
  for (const qs of ['order=naik', 'limit=101', 'limit=0', 'page=0', 'page=-1', 'limit=abc', 'order=asc,desc']) {
    const r = await api('GET', `/api/mahasiswa?${qs}`, { token: tokens.admin });
    assert.equal(r.status, 400, qs);
  }
});

test('respons tetap array dan total dikirim lewat header X-Total-Count', async () => {
  for (const path of ENDPOINT) {
    const r = await api('GET', path, { token: tokens.admin });
    assert.equal(r.status, 200, path);
    assert.ok(Array.isArray(r.body.data), path);
    assert.match(r.headers.get('x-total-count') || '', /^\d+$/, path);
    assert.ok(Number(r.headers.get('x-total-count')) >= r.body.data.length, path);
  }
  const mhs = await api('GET', '/api/mahasiswa', { token: tokens.admin });
  assert.equal(mhs.headers.get('x-total-count'), '5');
});

test('paginasi dan sorting mahasiswa', async () => {
  const p1 = await api('GET', '/api/mahasiswa?sort=nim&order=desc&limit=2&page=1', { token: tokens.admin });
  const p3 = await api('GET', '/api/mahasiswa?sort=nim&order=desc&limit=2&page=3', { token: tokens.admin });
  assert.deepEqual(p1.body.data.map((m) => m.nim), ['103032300005', '103032300004']);
  assert.deepEqual(p3.body.data.map((m) => m.nim), ['103032300001']);
  assert.equal(p3.headers.get('x-total-count'), '5');

  const lewat = await api('GET', '/api/mahasiswa?page=9', { token: tokens.admin });
  assert.deepEqual(lewat.body.data, []);
  assert.equal(lewat.headers.get('x-total-count'), '5');
});

test('pencarian q memakai ILIKE dengan % dan _ sebagai karakter biasa', async () => {
  const budi = await api('GET', '/api/mahasiswa?q=SANTOSO', { token: tokens.admin });
  assert.deepEqual(budi.body.data.map((m) => m.nama), ['Budi Santoso']);

  for (const q of ['%', '_', "' OR '1'='1"]) {
    const r = await api('GET', `/api/mahasiswa?q=${encodeURIComponent(q)}`, { token: tokens.admin });
    assert.equal(r.status, 200, q);
    assert.deepEqual(r.body.data, [], q);
    assert.equal(r.headers.get('x-total-count'), '0', q);
  }
});

test('pencarian dan sorting di KRS dan nilai', async () => {
  const krs = await api('GET', '/api/krs?q=andi&sort=total_sks&order=desc', { token: tokens.admin });
  assert.equal(krs.status, 200);
  assert.deepEqual(krs.body.data.map((k) => k.nama), ['Andi Pratama']);

  const nilai = await api('GET', '/api/nilai?q=IF1002&sort=nim', { token: tokens.admin });
  assert.equal(nilai.status, 200);
  assert.ok(nilai.body.data.length > 0);
  assert.ok(nilai.body.data.every((n) => n.kode === 'IF1002'));
  const nim = nilai.body.data.map((n) => n.nim);
  assert.deepEqual(nim, [...nim].sort());
});

test('mahasiswa tetap tidak bisa memakai endpoint list admin', async () => {
  for (const path of ENDPOINT) {
    const r = await api('GET', `${path}?sort=nim`, { token: tokens.andi });
    assert.equal(r.status, 403, path);
  }
});
