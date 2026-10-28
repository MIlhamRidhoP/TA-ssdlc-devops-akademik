#!/usr/bin/env node
// TOCTOU KRS v2 - U3: item terhapus dari KRS yang berstatus submitted. Race antara satu submit
// dan N panggilan removeItem paralel untuk N item yang berbeda (akar masalah sama dengan U1/U2:
// removeItem mengecek status draft lalu DELETE tanpa transaksi yang menyatukannya dengan
// transition di submit).
//
// TIDAK mengubah apa pun di src/. TIDAK menambah delay buatan atau mengubah isolasi transaksi.
// Hanya menembak localhost. Lihat README.md di folder keluaran untuk rinciannya.
//
// Pemakaian: node toctou-krs-remove-v2.js <jumlah_trial> <nomor_batch> <file_keluaran_jsonl>
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });

const B = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = 'citra@mahasiswa.test';
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('SEED_USER_PASSWORD tidak ada di .env');

const DEFAULT_KODE = ['IF1002', 'IF1007']; // selalu ada
const EXTRA_KODE = ['IF1001', 'IF1003', 'IF1004', 'IF1005', 'IF1006', 'IF1008', 'IF1009']; // semua non-default
const U3_BASELINE_EXTRA = ['IF1003', 'IF1006', 'IF1009']; // ditambahkan tiap reset -> total 6+3+2+3=14
// Kelima item yang jadi target removeItem paralel (N=5): dua default + tiga baseline ekstra.
const TARGET_KODE = [...DEFAULT_KODE, ...U3_BASELINE_EXTRA];

const req = async (method, pathUrl, token, body) => {
  const mulai = new Date().toISOString();
  let res, json = null, err = null;
  try {
    res = await fetch(`${B}${pathUrl}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const teks = await res.text();
    try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
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
const itemId = (krs, kode) => { const i = (krs.items || []).find((x) => x.kode === kode); return i ? i.id : null; };

let MKID = {};

// Reset ke keadaan baku SEBELUM race: draft, total 14 SKS, lima item TARGET_KODE hadir, tanpa sisa
// item EXTRA_KODE lain.
const reset = async (token) => {
  let krs = await krsMe(token);
  if (krs.status === 'submitted') { await req('POST', '/api/krs/me/unsubmit', token); krs = await krsMe(token); }
  const adaKode = (k) => (krs.items || []).some((x) => x.kode === k);
  const hapus = EXTRA_KODE.filter(adaKode).map((k) => req('DELETE', `/api/krs/me/items/${itemId(krs, k)}`, token));
  await Promise.all(hapus);
  krs = await krsMe(token);
  // DEFAULT_KODE biasanya tidak pernah terhapus, TAPI trial U3 sengaja menghapusnya juga (keduanya
  // ada di TARGET_KODE), jadi reset harus bisa mengembalikannya juga, bukan hanya baseline ekstra.
  const perluDitambah = [...DEFAULT_KODE, ...U3_BASELINE_EXTRA].filter((k) => !(krs.items || []).some((x) => x.kode === k));
  const tambah = perluDitambah.map((k) => req('POST', '/api/krs/me/items', token, { mata_kuliah_id: MKID[k] }));
  await Promise.all(tambah);
  krs = await krsMe(token);
  const kodeSet = (krs.items || []).map((x) => x.kode).sort();
  const diharapkan = [...TARGET_KODE].sort();
  const cocok = krs.status === 'draft' && krs.total_sks === 14 && JSON.stringify(kodeSet) === JSON.stringify(diharapkan);
  return { cocok, krs };
};

const satuTrial = async (token, i, batch) => {
  const resetHasil = await reset(token);
  if (!resetHasil.cocok) return { trial: i, batch, anomali_reset: true, krs_setelah_reset: resetHasil.krs };
  const idPerKode = {};
  for (const k of TARGET_KODE) idPerKode[k] = itemId(resetHasil.krs, k);
  const t0 = new Date().toISOString();
  const [submitRes, ...delRes] = await Promise.all([
    req('POST', '/api/krs/me/submit', token),
    ...TARGET_KODE.map((k) => req('DELETE', `/api/krs/me/items/${idPerKode[k]}`, token)),
  ]);
  const t1 = new Date().toISOString();
  const akhir = await krsMe(token);
  const kodeAkhir = (akhir.items || []).map((x) => x.kode);
  const targetHilang = TARGET_KODE.filter((k) => !kodeAkhir.includes(k));
  const winU3 = akhir.status === 'submitted' && targetHilang.length > 0;
  return {
    trial: i, batch, mulai_race: t0, selesai_race: t1,
    submit: { http_status: submitRes.http_status, body: submitRes.json },
    remove_item: TARGET_KODE.map((k, idx) => ({ kode: k, item_id: idPerKode[k], http_status: delRes[idx].http_status, mulai: delRes[idx].mulai, selesai: delRes[idx].selesai, body: delRes[idx].json })),
    akhir: { status: akhir.status, total_sks: akhir.total_sks, kuota: akhir.kuota, items_kode: kodeAkhir },
    target_hilang: targetHilang, win_u3: winU3,
  };
};

(async () => {
  const [n, batch, outFile] = process.argv.slice(2);
  const N = Number(n); const BATCH = Number(batch);
  if (!N || !BATCH || !outFile) throw new Error('pemakaian: node toctou-krs-remove-v2.js <jumlah_trial> <nomor_batch> <file_keluaran_jsonl>');
  const token = await login(EMAIL, PASSWORD);
  MKID = await mataKuliahIdByKode(token);
  const out = fs.createWriteStream(outFile, { flags: 'w' });
  let winU3 = 0, anomali = 0;
  for (let i = 1; i <= N; i += 1) {
    const hasil = await satuTrial(token, i, BATCH);
    out.write(JSON.stringify(hasil) + '\n');
    if (hasil.anomali_reset) anomali += 1;
    else if (hasil.win_u3) winU3 += 1;
    if (i % 25 === 0) process.stderr.write(`batch ${BATCH}: ${i}/${N} (U3=${winU3} anomali=${anomali})\n`);
  }
  out.end();
  console.log(JSON.stringify({ batch: BATCH, n: N, win_u3: winU3, anomali_reset: anomali }));
})().catch((e) => { console.error(e); process.exit(1); });
