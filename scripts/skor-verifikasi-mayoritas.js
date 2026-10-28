#!/usr/bin/env node
// F1 verifikasi (false positive sebagai kelas positif) untuk putusan MAYORITAS tiga vendor,
// dengan tiga pelabelan alert (utama, dan dua varian sensitivitas satu-label-diubah), eksperimen 1.
//
// MENGAPA SKRIP INI PERLU: nilaiRunGabungan (scripts/skor-gabungan.js) menghitung skenario B dan C
// untuk mode gabungan, tapi TIDAK PERNAH memanggil kategoriVerifikasi -- tidak ada field verifikasi
// sama sekali di keluarannya. Metrik F1 verifikasi per vendor ADA (skorRunUtama di scripts/llm/score.js,
// dipanggil scripts/llm-score.js, dan punya --label-alert-paksa untuk sensitivitas), tapi tidak ada
// jalur yang sama untuk putusan MAYORITAS tiga vendor. Baris "Majority of three" x "SONAR-03 real"
// pada draf paper sebelumnya ditulis "n/a" karena memang tidak ada kode yang menghasilkannya -- bukan
// karena nilainya tak terdefinisi secara matematis (skrip ini membuktikan nilainya 0,711, terdefinisi
// baik di ketiga run).
//
// Skrip ini TIDAK mengubah scripts/skor-gabungan.js maupun scripts/llm/score.js. Ia memanggil ulang
// dua fungsi yang SUDAH diekspor dari situ:
//   - entriVerifikasiGabungan (scripts/skor-gabungan.js): mengambil putusan_gabungan tiap alert dari
//     gabungan/run-N.json, hasil suaraTerbanyak (SUARA_MINIMUM=2, scripts/llm/gabung.js) yang sudah
//     dihitung lebih dulu oleh scripts/llm-gabung.js -- bukan dihitung ulang voting-nya di sini.
//   - kategoriVerifikasi (scripts/llm/score.js): metrik identified/missed/misidentified_fp dan
//     correct_retention yang sama persis dipakai untuk baris per-vendor Tabel III.
// Sensitivitas label (SONAR-03 real, SONAR-01 FP) dibuat dengan menyalin label_alert dari
// skor-tunggal-triase-v3.json lalu mengubah SATU field `.label`, pola yang sama dengan
// --label-alert-paksa di scripts/llm-score.js, hanya diterapkan manual karena kategoriVerifikasi
// menerima argumen label langsung.
//
// Pemakaian:
//   node scripts/skor-verifikasi-mayoritas.js --objek=<worktree objek uji> \
//     --batch=<folder batch, default hasil-eksperimen/20261022-gabungan relatif ke --objek> \
//     --out=<file JSON keluaran, default <batch>/verifikasi-mayoritas.json>
'use strict';
const fs = require('fs');
const path = require('path');

const ambilArg = (nama, bawaan = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.slice(nama.length + 3) : bawaan;
};

// score.js membaca OBJEK_UJI_DIR saat di-require (lihat scripts/llm-scan.js, scripts/skor-gabungan-normalisasi.js
// untuk pola yang sama); --objek wajib diproses sebelum require di bawah.
process.env.OBJEK_UJI_DIR = path.resolve(ambilArg('objek') || '../objek-seeded');

const sg = require('./skor-gabungan');
const score = require('./llm/score');

const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Tiga pelabelan yang dibandingkan di Tabel III: utama (label asli jalur v2/v3), dan dua varian
// yang masing-masing mengubah SATU label dari utama -- bentuk sensitivitas yang sama dengan
// Threats to Validity paper ("SONAR-01 is counted as real... we also report the opposite label";
// "we also report the case where SONAR-03 is real").
const VARIAN = [
  { nama: 'utama', ubah: null },
  { nama: 'SONAR-03 real', ubah: { id: 'SONAR-03', label: 'nyata' } },
  { nama: 'SONAR-01 FP', ubah: { id: 'SONAR-01', label: 'fp' } },
];

(() => {
  const objek = process.env.OBJEK_UJI_DIR;
  const batch = path.resolve(objek, ambilArg('batch', 'hasil-eksperimen/20261022-gabungan'));
  const outFile = path.resolve(ambilArg('out', path.join(batch, 'verifikasi-mayoritas.json')));

  const labelAsli = J(path.join(batch, 'skor-tunggal-triase-v3.json')).utama.label_alert;

  const hasilVarian = {};
  for (const { nama, ubah } of VARIAN) {
    const label = JSON.parse(JSON.stringify(labelAsli));
    if (ubah) label[ubah.id] = { ...label[ubah.id], label: ubah.label };

    const perRun = [];
    for (const run of [1, 2, 3]) {
      const hasilGabungan = J(path.join(batch, 'gabungan', `run-${run}.json`));
      const verifikasi = sg.entriVerifikasiGabungan(hasilGabungan);
      const kv = score.kategoriVerifikasi(verifikasi, label);
      perRun.push({ run, jumlah: kv.jumlah, metrik: kv.metrik_fp_positif });
    }
    hasilVarian[nama] = {
      label_dipakai: label,
      per_run: perRun,
      rata_rata: {
        precision: avg(perRun.map((r) => r.metrik.precision)),
        recall: avg(perRun.map((r) => r.metrik.recall)),
        f1: avg(perRun.map((r) => r.metrik.f1)),
      },
    };
  }

  const laporan = {
    dibuat: new Date().toISOString(),
    catatan: 'F1 verifikasi (FP sebagai kelas positif) untuk putusan mayoritas tiga vendor (suaraTerbanyak, '
      + 'SUARA_MINIMUM=2, scripts/llm/gabung.js), dihitung lewat entriVerifikasiGabungan dan kategoriVerifikasi '
      + '(keduanya diekspor apa adanya dari scripts/skor-gabungan.js dan scripts/llm/score.js, tidak diubah). '
      + 'Dibuat untuk menjawab kenapa sel "Majority of three" x "SONAR-03 real" sebelumnya tidak dilaporkan: '
      + 'skor-gabungan.js tidak pernah memanggil kategoriVerifikasi untuk mode gabungan sama sekali, jadi sel '
      + 'itu bukan tak-terdefinisi, hanya belum pernah dihitung.',
    sumber: {
      label_alert_asal: path.relative(objek, path.join(batch, 'skor-tunggal-triase-v3.json')),
      gabungan_run: path.relative(objek, path.join(batch, 'gabungan')),
    },
    varian: hasilVarian,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(laporan, null, 2) + '\n');

  for (const [nama, h] of Object.entries(hasilVarian)) {
    console.log(`${nama}: F1 per run = ${h.per_run.map((r) => r.metrik.f1.toFixed(3)).join(', ')} | rata-rata = ${h.rata_rata.f1.toFixed(3)}`);
  }
  console.log(`Keluaran ditulis ke ${outFile}`);
})();
