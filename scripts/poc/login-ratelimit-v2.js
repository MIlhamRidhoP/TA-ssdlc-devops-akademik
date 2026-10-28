#!/usr/bin/env node
// E9 - klaim "tidak ada rate limiting pada login dan register" (src/controllers/authController.js
// login dan register, CWE-307). Duplikat dari B1 bawaan B3 di SEEDED.md (sudah diketahui, bukan
// temuan baru), tetapi belum pernah diuji dinamis secara eksplisit di batch manapun; dijalankan di
// sini untuk melengkapi data.
//
// DEFINISI MENANG (ditulis sebelum dijalankan): kirim 50 percobaan login BERURUTAN dengan
// password salah untuk satu akun yang sama, secepat mungkin (tanpa delay buatan). MENANG
// (klaim "tidak ada rate limiting" terbukti) jika SELURUH 50 percobaan dibalas kode normal
// (401 UNAUTHORIZED), TIDAK SATU PUN 429 Too Many Requests atau kode block lain. TIDAK MENANG
// (klaim direfuted, berarti rate limiting ada) jika ADA SATU PUN percobaan yang diblokir.
//
// Bukan race condition (sekuensial, bukan paralel - rate limiter yang nyata biasanya berbasis
// jumlah permintaan per jendela waktu, bukan konkurensi). TIDAK mengubah src/. Hanya localhost.
// Pemakaian: node login-ratelimit-v2.js <jumlah_percobaan> <file_keluaran_jsonl>
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });

const B = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = 'andi@mahasiswa.test';

const login = async (email, password) => {
  const mulai = new Date().toISOString();
  let res, json = null, err = null;
  try {
    res = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const teks = await res.text();
    try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  } catch (e) { err = e.message; }
  return { mulai, selesai: new Date().toISOString(), http_status: res ? res.status : null, err, body: json };
};

(async () => {
  const [n, outFile] = process.argv.slice(2);
  const N = Number(n);
  if (!N || !outFile) throw new Error('pemakaian: node login-ratelimit-v2.js <jumlah_percobaan> <file_keluaran_jsonl>');
  const out = fs.createWriteStream(outFile, { flags: 'w' });
  let diblokir = 0, normal401 = 0, lain = 0;
  const t0 = new Date().toISOString();
  for (let i = 1; i <= N; i += 1) {
    const r = await login(EMAIL, `salah-sengaja-percobaan-${i}`);
    out.write(JSON.stringify({ percobaan: i, ...r }) + '\n');
    if (r.http_status === 429) diblokir += 1;
    else if (r.http_status === 401) normal401 += 1;
    else lain += 1;
  }
  const t1 = new Date().toISOString();
  console.log(JSON.stringify({ n: N, mulai: t0, selesai: t1, status_401: normal401, status_429_diblokir: diblokir, status_lain: lain, win_e9_tidak_ada_rate_limit: diblokir === 0 && lain === 0 }));
})().catch((e) => { console.error(e); process.exit(1); });
