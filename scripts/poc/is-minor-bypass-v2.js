#!/usr/bin/env node
// E8 - klaim "mahasiswa yang memperbarui data lewat updateMe dapat mengubah kolom is_minor,
// karena updateMe menerima { ...req.body } tanpa whitelist, dan kontrol konsen orang tua
// bergantung pada is_minor" (dirujuk ke src/controllers/konsenController.js:35, akar klaim
// sebenarnya di updateMe/updateByUserId, sama dengan sink S9).
//
// DEFINISI MENANG (ditulis sebelum dijalankan, dua sub-uji independen):
//
// E8a - mahasiswa MINOR tanpa konsen approved (Eka) mengirim PUT /api/mahasiswa/me dengan
// body {"is_minor": false}, lalu memanggil GET /api/krs/me (dilindungi requireConsent).
// MENANG jika permintaan PUT diterima TANPA galat server (status 200/201) DAN panggilan
// GET /api/krs/me sesudahnya TIDAK LAGI diblokir 403 CONSENT_REQUIRED (yaitu gerbang konsen
// berhasil dilewati). TIDAK MENANG jika PUT gagal (misalnya galat kolom tidak dikenal di
// database) atau GET sesudahnya tetap 403 CONSENT_REQUIRED.
//
// E8b - mahasiswa DEWASA (Andi, is_minor=false) mengirim PUT /api/mahasiswa/me dengan body
// {"is_minor": true}, lalu GET /api/mahasiswa/me untuk melihat apakah field is_minor benar
// berubah jadi true. MENANG jika field is_minor pada respons GET menjadi true (pembacaan
// murni, tidak menguji konsekuensi lanjutan).
//
// Bukan race condition. TIDAK mengubah src/. Hanya localhost. Kedua sub-uji dikembalikan ke
// keadaan semula di akhir setiap trial (Eka -> is_minor:true lewat akun admin kalau berhasil
// diubah; Andi -> is_minor:false).
//
// Pemakaian: node is-minor-bypass-v2.js <jumlah_trial> <file_keluaran_jsonl>
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });

const B = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_USER_PASSWORD;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('.env tidak lengkap (SEED_USER_PASSWORD/ADMIN_EMAIL/ADMIN_PASSWORD)');

const req = async (method, pathUrl, token, body) => {
  const mulai = new Date().toISOString();
  let res, json = null, err = null;
  try {
    res = await fetch(`${B}${pathUrl}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const teks = await res.text();
    try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  } catch (e) { err = e.message; }
  return { method, path: pathUrl, mulai, selesai: new Date().toISOString(), http_status: res ? res.status : null, err, json };
};

const login = async (email, password) => {
  const r = await req('POST', '/api/auth/login', null, { email, password });
  if (!r.json || !r.json.success) throw new Error(`login gagal untuk ${email}: ${JSON.stringify(r)}`);
  return r.json.data.token;
};

(async () => {
  const [n, outFile] = process.argv.slice(2);
  const N = Number(n);
  if (!N || !outFile) throw new Error('pemakaian: node is-minor-bypass-v2.js <jumlah_trial> <file_keluaran_jsonl>');

  const ekaTok = await login('eka@mahasiswa.test', PASSWORD);
  const andiTok = await login('andi@mahasiswa.test', PASSWORD);
  const adminTok = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const eka = (await req('GET', '/api/mahasiswa/me', ekaTok)).json.data;
  const andi = (await req('GET', '/api/mahasiswa/me', andiTok)).json.data;
  // Jalur admin (controller.update) menghitung is_minor dari tanggal_lahir, tidak menerima
  // is_minor langsung (lihat mahasiswaController.js:162). Pemulihan karena itu memakai
  // tanggal_lahir asli, bukan is_minor langsung.
  if (!eka.tanggal_lahir || !andi.tanggal_lahir) throw new Error('tanggal_lahir tidak ada di respons GET /api/mahasiswa/me, cek profilLengkap');

  const out = fs.createWriteStream(outFile, { flags: 'w' });
  let winA = 0, winB = 0;
  for (let i = 1; i <= N; i += 1) {
    // E8a
    const putEka = await req('PUT', '/api/mahasiswa/me', ekaTok, { is_minor: false });
    const krsEka = await req('GET', '/api/krs/me', ekaTok);
    const kodeBlokir = krsEka.json?.error?.code ?? null;
    const winE8a = (putEka.http_status === 200 || putEka.http_status === 201) && krsEka.http_status !== 403 && kodeBlokir !== 'CONSENT_REQUIRED';
    // Pulihkan Eka lewat jalur admin, memakai tanggal_lahir asli (admin update menghitung ulang
    // is_minor darinya; tidak menerima is_minor langsung).
    const pulihEka = await req('PUT', `/api/mahasiswa/${eka.id}`, adminTok, { tanggal_lahir: eka.tanggal_lahir });

    // E8b
    const putAndi = await req('PUT', '/api/mahasiswa/me', andiTok, { is_minor: true });
    const getAndi = await req('GET', '/api/mahasiswa/me', andiTok);
    const winE8b = getAndi.json?.data?.is_minor === true;
    const pulihAndi = await req('PUT', `/api/mahasiswa/${andi.id}`, adminTok, { tanggal_lahir: andi.tanggal_lahir });

    if (winE8a) winA += 1; if (winE8b) winB += 1;
    out.write(JSON.stringify({ trial: i, e8a: { put: putEka, krs_setelah: krsEka, win: winE8a, pulih: pulihEka }, e8b: { put: putAndi, get_setelah: getAndi, win: winE8b, pulih: pulihAndi } }) + '\n');
    if (i % 10 === 0) process.stderr.write(`${i}/${N} (E8a=${winA} E8b=${winB})\n`);
  }
  out.end();
  console.log(JSON.stringify({ n: N, win_e8a: winA, win_e8b: winB }));
})().catch((e) => { console.error(e); process.exit(1); });
