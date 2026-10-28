#!/usr/bin/env node
// TOCTOU KRS v2 - U1 (submit vs banyak addItem paralel, kuota) dan U2 (item masuk ke KRS yang
// sudah submitted) diukur dari RACE YANG SAMA: satu panggilan submit bersamaan dengan N panggilan
// addItem paralel untuk N mata kuliah yang berbeda. Kedua kriteria "menang" dihitung dari status
// akhir KRS yang sama; ini bukan dua eksperimen terpisah yang kebetulan serupa, melainkan dua
// sudut pandang atas satu mekanisme (tidak ada transaksi yang menyatukan baca-kuota di submit
// dengan cek-status-draft di addItem). Lihat README.md di folder keluaran untuk rinciannya.
//
// TIDAK mengubah apa pun di src/. TIDAK menambah delay buatan atau mengubah isolasi transaksi;
// satu-satunya "pembukaan jendela" adalah mengirim lebih banyak permintaan addItem paralel (N
// percobaan race sekaligus), sesuai yang diminta. Hanya menembak localhost.
//
// Pemakaian: node toctou-krs-v2.js <jumlah_trial> <nomor_batch> <file_keluaran_jsonl>
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });

const B = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = 'citra@mahasiswa.test';
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('SEED_USER_PASSWORD tidak ada di .env');

const DEFAULT_KODE = ['IF1002', 'IF1007']; // selalu ada di KRS Citra, tidak pernah disentuh
const BASELINE_KODE = ['IF1001', 'IF1003']; // ditambahkan tiap reset -> total 6+4+3=13
const RACE_KODE = ['IF1004', 'IF1005', 'IF1006', 'IF1008', 'IF1009']; // N=5 percobaan addItem paralel

const req = async (method, pathUrl, token, body) => {
  const mulai = new Date().toISOString();
  let res, json = null, teks = null, err = null;
  try {
    res = await fetch(`${B}${pathUrl}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    teks = await res.text();
    try { json = JSON.parse(teks); } catch { /* bukan JSON, biarkan null */ }
  } catch (e) { err = e.message; }
  const selesai = new Date().toISOString();
  return { method, path: pathUrl, mulai, selesai, http_status: res ? res.status : null, err, json };
};

const login = async (email, password) => {
  const r = await req('POST', '/api/auth/login', '', { email, password });
  if (!r.json || !r.json.success) throw new Error(`login gagal untuk ${email}: ${JSON.stringify(r)}`);
  return r.json.data.token;
};

const mataKuliahIdByKode = async (token) => {
  const r = await req('GET', '/api/mata-kuliah?limit=20', token);
  const peta = {};
  for (const m of r.json.data) peta[m.kode] = m.id;
  return peta;
};

const krsMe = async (token) => (await req('GET', '/api/krs/me', token)).json.data;

const itemId = (krs, kode) => {
  const i = (krs.items || []).find((x) => x.kode === kode);
  return i ? i.id : null;
};

// Reset ke keadaan baku SEBELUM race: draft, baseline 13 SKS, tanpa item dari RACE_KODE.
const reset = async (token) => {
  let krs = await krsMe(token);
  if (krs.status === 'submitted') { await req('POST', '/api/krs/me/unsubmit', token); krs = await krsMe(token); }
  const adaKode = (k) => (krs.items || []).some((x) => x.kode === k);
  const hapus = RACE_KODE.filter(adaKode).map((k) => req('DELETE', `/api/krs/me/items/${itemId(krs, k)}`, token));
  await Promise.all(hapus);
  krs = await krsMe(token);
  // DEFAULT_KODE semestinya tidak pernah ikut terhapus di race U1/U2 (bukan bagian RACE_KODE), tapi
  // tetap dipulihkan di sini kalau-kalau skrip PoC lain sempat menghapusnya (menjaga reset idempoten
  // terlepas dari urutan skrip yang dijalankan sebelumnya pada akun Citra yang sama).
  const perluDitambah = [...DEFAULT_KODE, ...BASELINE_KODE].filter((k) => !(krs.items || []).some((x) => x.kode === k));
  const tambah = perluDitambah.map((k) => req('POST', '/api/krs/me/items', token, { mata_kuliah_id: MKID[k] }));
  await Promise.all(tambah);
  krs = await krsMe(token);
  const kodeSet = (krs.items || []).map((x) => x.kode).sort();
  const diharapkan = [...DEFAULT_KODE, ...BASELINE_KODE].sort();
  const cocok = krs.status === 'draft' && krs.total_sks === 13 && JSON.stringify(kodeSet) === JSON.stringify(diharapkan);
  return { cocok, krs };
};

let MKID = {};

const satuTrial = async (token, i, batch) => {
  const resetHasil = await reset(token);
  if (!resetHasil.cocok) {
    return { trial: i, batch, anomali_reset: true, krs_setelah_reset: resetHasil.krs };
  }
  const t0 = new Date().toISOString();
  const [submitRes, ...addRes] = await Promise.all([
    req('POST', '/api/krs/me/submit', token),
    ...RACE_KODE.map((k) => req('POST', '/api/krs/me/items', token, { mata_kuliah_id: MKID[k] })),
  ]);
  const t1 = new Date().toISOString();
  const akhir = await krsMe(token);
  const kodeAkhir = (akhir.items || []).map((x) => x.kode);
  const raceHadir = RACE_KODE.filter((k) => kodeAkhir.includes(k));
  const winU1 = akhir.status === 'submitted' && akhir.total_sks > 15;
  const winU2 = akhir.status === 'submitted' && raceHadir.length > 0;
  return {
    trial: i, batch, mulai_race: t0, selesai_race: t1,
    submit: { http_status: submitRes.http_status, body: submitRes.json },
    add_item: RACE_KODE.map((k, idx) => ({ kode: k, http_status: addRes[idx].http_status, mulai: addRes[idx].mulai, selesai: addRes[idx].selesai, body: addRes[idx].json })),
    akhir: { status: akhir.status, total_sks: akhir.total_sks, kuota: akhir.kuota, items_kode: kodeAkhir },
    race_item_hadir: raceHadir, win_u1: winU1, win_u2: winU2,
  };
};

(async () => {
  const [n, batch, outFile] = process.argv.slice(2);
  const N = Number(n); const BATCH = Number(batch);
  if (!N || !BATCH || !outFile) throw new Error('pemakaian: node toctou-krs-v2.js <jumlah_trial> <nomor_batch> <file_keluaran_jsonl>');
  const token = await login(EMAIL, PASSWORD);
  MKID = await mataKuliahIdByKode(token);
  const out = fs.createWriteStream(outFile, { flags: 'w' });
  let winU1 = 0, winU2 = 0, anomali = 0;
  for (let i = 1; i <= N; i += 1) {
    const hasil = await satuTrial(token, i, BATCH);
    out.write(JSON.stringify(hasil) + '\n');
    if (hasil.anomali_reset) anomali += 1;
    else { if (hasil.win_u1) winU1 += 1; if (hasil.win_u2) winU2 += 1; }
    if (i % 25 === 0) process.stderr.write(`batch ${BATCH}: ${i}/${N} (U1=${winU1} U2=${winU2} anomali=${anomali})\n`);
  }
  out.end();
  console.log(JSON.stringify({ batch: BATCH, n: N, win_u1: winU1, win_u2: winU2, anomali_reset: anomali }));
})().catch((e) => { console.error(e); process.exit(1); });
