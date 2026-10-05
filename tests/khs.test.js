const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { BASE, api, loginSemua } = require('./helpers');
const { escapeHtml } = require('../src/utils/html');

const AKTIF = process.env.SEMESTER_AKTIF;
let tokens;

const semesterSebelum = (s) => {
  const [tahun, periode] = s.split('-');
  return periode === 'genap' ? `${tahun}-ganjil` : `${Number(tahun) - 1}-genap`;
};

const khs = async (token, semester) => {
  const res = await fetch(`${BASE}/api/nilai/me/khs?semester=${encodeURIComponent(semester)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, type: res.headers.get('content-type'), html: await res.text() };
};

before(async () => {
  tokens = await loginSemua();
});

test('escapeHtml mengganti semua karakter khusus HTML', () => {
  assert.equal(escapeHtml(`<img src="x" onerror='a()'>&`),
    '&lt;img src=&quot;x&quot; onerror=&#39;a()&#39;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(3.5), '3.5');
});

test('KHS berupa HTML dengan nilai dinamis ter-escape', async () => {
  const r = await khs(tokens.andi, semesterSebelum(AKTIF));
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/html/);
  assert.ok(r.html.includes('Algoritma &amp; Pemrograman'));
  assert.ok(!r.html.includes('Algoritma & Pemrograman'));
  assert.ok(r.html.includes('103032300001'));
  assert.ok(r.html.includes('Andi Pratama'));
  assert.ok(r.html.includes('IPS: 3.78'));
});

test('KHS hanya memuat nilai published', async () => {
  const r = await khs(tokens.andi, AKTIF);
  assert.equal(r.status, 200);
  assert.ok(r.html.includes('IF1002') && r.html.includes('IF1004'));
  assert.ok(!r.html.includes('IF1005'), 'Nilai draft ikut tampil');
  assert.ok(!r.html.includes('IF1008'), 'Item belum dinilai ikut tampil');
  assert.ok(r.html.includes('IPS: 3.79'));
});

test('parameter semester wajib dan formatnya dicek', async () => {
  for (const s of ['', '<script>alert(1)</script>', '2026-pendek']) {
    const r = await khs(tokens.andi, s);
    assert.equal(r.status, 400, s);
    assert.ok(!r.html.includes('<script>'));
  }
});

test('KHS butuh konsen dan hanya untuk mahasiswa', async () => {
  const eka = await khs(tokens.eka, AKTIF);
  assert.equal(eka.status, 403);
  const admin = await api('GET', `/api/nilai/me/khs?semester=${AKTIF}`, { token: tokens.admin });
  assert.equal(admin.status, 403);
});
