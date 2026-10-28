#!/usr/bin/env node
// E4 - race pada batas jumlah email tambahan (src/models/profilModel.js createEmail, CWE-362).
//
// DEFINISI MENANG (ditulis sebelum dijalankan): mahasiswa punya MAKS_EMAIL-1 (4) email
// tambahan. Kirim 5 permintaan POST /api/mahasiswa/me/email paralel, masing-masing dengan
// alamat email baru yang berbeda. MENANG jika jumlah email akhir > MAKS_EMAIL (5) - artinya
// lebih dari satu dari kelima permintaan lolos pemeriksaan "count(*) < MAKS_EMAIL" yang
// seharusnya hanya meloloskan SATU permintaan lagi (dari 4 ke 5, tidak boleh ke 6 atau lebih).
//
// Akar masalah (src/models/profilModel.js createEmail): INSERT ... SELECT ... WHERE
// (SELECT count(*) ...) < $4, tanpa penguncian. Setiap permintaan paralel menjalankan
// sub-SELECT count(*) secara independen; kalau beberapa permintaan membaca count yang sama
// (4) sebelum satu pun INSERT ter-commit, semuanya lolos pemeriksaan dan ter-INSERT.
//
// TIDAK mengubah src/. TIDAK ada delay buatan. Hanya localhost.
// Pemakaian: node email-race-v2.js <jumlah_trial> <nomor_batch> <file_keluaran_jsonl>
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });

const B = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = 'andi@mahasiswa.test'; // dewasa, tanpa batasan konsen
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('SEED_USER_PASSWORD tidak ada di .env');

const MAKS_EMAIL = 5;
const TIPE = ['pribadi', 'kerja', 'alternatif'];

const req = async (method, pathUrl, token, body) => {
  const mulai = new Date().toISOString();
  let res, json = null, err = null;
  try {
    res = await fetch(`${B}${pathUrl}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const teks = await res.text();
    try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  } catch (e) { err = e.message; }
  return { method, path: pathUrl, mulai, selesai: new Date().toISOString(), http_status: res ? res.status : null, err, json };
};

const login = async (email, password) => {
  const r = await req('POST', '/api/auth/login', '', { email, password });
  if (!r.json || !r.json.success) throw new Error(`login gagal untuk ${email}: ${JSON.stringify(r)}`);
  return r.json.data.token;
};

const listEmail = async (token) => (await req('GET', '/api/mahasiswa/me', token)).json.data.email_tambahan;

// Reset: hapus semua email tambahan, lalu tambahkan 4 (MAKS_EMAIL-1) email baseline unik per trial
// (supaya tidak kena UNIQUE constraint lintas trial).
const reset = async (token, trialId) => {
  let email = await listEmail(token);
  await Promise.all(email.map((e) => req('DELETE', `/api/mahasiswa/me/email/${e.id}`, token)));
  const baseline = [0, 1, 2, 3].map((i) => req('POST', '/api/mahasiswa/me/email', token, { tipe: TIPE[i % 3], email: `t${trialId}-base${i}@contoh.test` }));
  await Promise.all(baseline);
  email = await listEmail(token);
  return { cocok: email.length === MAKS_EMAIL - 1, email };
};

const satuTrial = async (token, i, batch) => {
  const resetHasil = await reset(token, `${batch}-${i}`);
  if (!resetHasil.cocok) return { trial: i, batch, anomali_reset: true, email_setelah_reset: resetHasil.email };
  const t0 = new Date().toISOString();
  const race = await Promise.all([0, 1, 2, 3, 4].map((k) => req('POST', '/api/mahasiswa/me/email', token, { tipe: TIPE[k % 3], email: `t${batch}-${i}-race${k}@contoh.test` })));
  const t1 = new Date().toISOString();
  const akhir = await listEmail(token);
  const win = akhir.length > MAKS_EMAIL;
  return {
    trial: i, batch, mulai_race: t0, selesai_race: t1,
    percobaan: race.map((r, k) => ({ k, http_status: r.http_status, mulai: r.mulai, selesai: r.selesai, body: r.json })),
    jumlah_email_akhir: akhir.length, win_e4: win,
  };
};

(async () => {
  const [n, batch, outFile] = process.argv.slice(2);
  const N = Number(n); const BATCH = Number(batch);
  if (!N || !BATCH || !outFile) throw new Error('pemakaian: node email-race-v2.js <jumlah_trial> <nomor_batch> <file_keluaran_jsonl>');
  const token = await login(EMAIL, PASSWORD);
  const out = fs.createWriteStream(outFile, { flags: 'w' });
  let win = 0, anomali = 0;
  for (let i = 1; i <= N; i += 1) {
    const hasil = await satuTrial(token, i, BATCH);
    out.write(JSON.stringify(hasil) + '\n');
    if (hasil.anomali_reset) anomali += 1; else if (hasil.win_e4) win += 1;
    if (i % 25 === 0) process.stderr.write(`batch ${BATCH}: ${i}/${N} (menang=${win} anomali=${anomali})\n`);
  }
  out.end();
  console.log(JSON.stringify({ batch: BATCH, n: N, menang: win, anomali_reset: anomali }));
})().catch((e) => { console.error(e); process.exit(1); });
