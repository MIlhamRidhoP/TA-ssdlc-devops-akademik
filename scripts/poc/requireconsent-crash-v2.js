#!/usr/bin/env node
// E7 - klaim "middleware async requireConsent melempar error tanpa try/catch atau next(err),
// sehingga pada Express 4 ini jadi unhandled promise rejection dan request menggantung, bisa
// memicu DoS atau crash proses" (src/middleware/requireConsent.js:6, CWE-755).
//
// DEFINISI MENANG (ditulis sebelum dijalankan): aplikasi ini memakai Express 5.2.1 (lihat
// package.json), yang MEMBUNGKUS middleware async dan meneruskan promise yang reject ke error
// handler secara otomatis (beda dari Express 4 yang diasumsikan klaim ini). MENANG (klaim
// terbukti) jika, saat requireConsent melempar AppError(403, CONSENT_REQUIRED) secara berulang,
// SALAH SATU dari berikut terjadi: (a) permintaan timeout/connection-reset bukannya dibalas JSON
// terstruktur, (b) /health berhenti merespons SETELAH pemicu dijalankan (indikasi proses
// crash/menggantung). TIDAK MENANG (klaim direfuted untuk versi Express ini) jika SELURUH
// percobaan dibalas JSON 403 CONSENT_REQUIRED yang rapi dan /health tetap sehat setiap saat.
//
// Bukan race condition; dijalankan sekuensial. TIDAK mengubah src/. Hanya localhost.
// Pemakaian: node requireconsent-crash-v2.js <jumlah_trial> <file_keluaran_jsonl>
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });

const B = process.env.BASE_URL || 'http://localhost:3000';
// Eka: minor, TANPA konsen (lihat scripts/seed-dummy.js) -> requireConsent pasti melempar
// AppError(403, CONSENT_REQUIRED) pada setiap panggilan ke rute yang memakainya.
const EMAIL = 'eka@mahasiswa.test';
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('SEED_USER_PASSWORD tidak ada di .env');

const req = async (method, pathUrl, token, timeoutMs = 10000) => {
  const mulai = new Date().toISOString();
  let res, json = null, teks = null, err = null;
  try {
    res = await fetch(`${B}${pathUrl}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
    teks = await res.text();
    try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  } catch (e) { err = e.message; }
  return { method, path: pathUrl, mulai, selesai: new Date().toISOString(), http_status: res ? res.status : null, err, json, teks_mentah: json ? null : teks };
};

const login = async (email, password) => {
  const r = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.success) throw new Error(`login gagal untuk ${email}: ${JSON.stringify(j)}`);
  return j.data.token;
};

// Tiga rute berbeda yang memasang requireConsent (krsRoutes, cutiRoutes, nilaiRoutes), supaya
// tidak hanya satu jalur yang diuji.
const RUTE = ['/api/krs/me', '/api/cuti/me', '/api/nilai/me'];

(async () => {
  const [n, outFile] = process.argv.slice(2);
  const N = Number(n);
  if (!N || !outFile) throw new Error('pemakaian: node requireconsent-crash-v2.js <jumlah_trial> <file_keluaran_jsonl>');
  const token = await login(EMAIL, PASSWORD);
  const out = fs.createWriteStream(outFile, { flags: 'w' });
  let anomali = 0, sehat = 0;
  for (let i = 1; i <= N; i += 1) {
    const rute = RUTE[(i - 1) % RUTE.length];
    const pemicu = await req('GET', rute, token);
    const health = await req('GET', '/health', null, 5000);
    const kodeBlokir = pemicu.json?.error?.code ?? null;
    const normal = pemicu.http_status === 403 && kodeBlokir === 'CONSENT_REQUIRED' && health.http_status === 200;
    if (normal) sehat += 1; else anomali += 1;
    const baris = { trial: i, rute, pemicu, health, normal_403_dan_health_ok: normal };
    out.write(JSON.stringify(baris) + '\n');
    if (i % 20 === 0) process.stderr.write(`${i}/${N} (normal=${sehat} anomali=${anomali})\n`);
  }
  out.end();
  console.log(JSON.stringify({ n: N, normal_403_dan_health_ok: sehat, anomali_atau_crash: anomali }));
})().catch((e) => { console.error(e); process.exit(1); });
