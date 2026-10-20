#!/usr/bin/env node
// Menyusun results.json skema 2 untuk SKENARIO A: SAST saja, tanpa satu pun panggilan LLM.
//
// Pemakaian:
//   node scripts/hasil-skenario-a.js --objek=. --out=results-v2-a.json [--nomor=N --id=N --repo=o/r]
//
// Kenapa ada: jalur v1 menerbitkan skema 1 ke index-v1.json, sedangkan dashboard hanya membaca
// skema 2 dari index.json. Tanpa berkas ini, run skenario A berjalan dan sukses tetapi tidak pernah
// muncul di dashboard sama sekali.
//
// Alertnya dipilih dengan FUNGSI YANG SAMA dengan jalur B (render.pilihAlert atas ringkasan Sonar),
// bukan dengan penyaringan sendiri. Itu disengaja: kalau A dan B memilih alert dengan cara berbeda,
// angka keduanya tidak bisa dibandingkan dan skenario A kehilangan gunanya sebagai pembanding.
//
// Yang membedakannya dari B hanya ketiadaan verifikasi:
//   - findings kosong, karena tidak ada panggilan deteksi;
//   - tiap alert berputusan null dengan putusan_asal "tanpa-verifikasi", bukan null, supaya
//     "belum diverifikasi" tidak tertukar dengan "diverifikasi tetapi jawabannya tidak sah";
//   - biaya 0 dan status_panggilan nol, karena memang tidak ada panggilan.
//
// Skrip ini TIDAK memanggil API LLM mana pun. Satu-satunya jaringan yang disentuhnya adalah
// SonarCloud, lewat jalur yang sama dengan llm-scan.
const fs = require('node:fs');
const path = require('node:path');
const { periksaObjek, siapkanSonar } = require('./llm-scan');
const render = require('./llm/render');
const { susunHasilV2 } = require('./llm/results-v2');
const { parseCwe } = require('./merge-results');

const ambilArg = (nama) => {
  const p = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return p ? p.slice(nama.length + 3) : null;
};

const main = async () => {
  const objek = periksaObjek(ambilArg('objek') ?? '.');
  const keluar = path.resolve(ambilArg('out') ?? 'results-v2-a.json');
  const nomor = Number(ambilArg('nomor') ?? 0) || 0;
  const idArg = ambilArg('id');
  const repo = ambilArg('repo') || null;

  const mulai = new Date().toISOString();
  const { sonar, sumber } = await siapkanSonar(objek, null);
  const alert = render.pilihAlert(sonar.ringkasan);
  const selesai = new Date().toISOString();

  // Bentuk `summary` dan `run` mengikuti apa yang diharapkan susunHasilV2, supaya berkas skenario A
  // melewati perakit yang sama dengan skenario B dan C. Tidak ada perakit kedua yang bisa
  // menyimpang diam-diam dari yang pertama.
  const summary = {
    versi_prompt: render.VERSI_PROMPT,
    // Tidak ada model yang dipanggil, jadi tidak ada vendor maupun model yang bisa disebut. Skema
    // mengizinkan null di ketiganya; mengisinya dengan nama vendor mana pun adalah mengarang.
    vendor: null,
    model_diminta: null,
    kondisi: 'utama',
    skenario: 'A',
    objek_uji: { commit: objek.commit, branch: objek.branch, tree_src: objek.tree_src },
    analisis_sonar: sonar.laporan.analisis?.tanggal ?? null,
    revisi_analisis_sonar: sonar.laporan.analisis?.revisi ?? null,
    tree_src_analisis_sonar: sonar.tree_src_analisis ?? null,
    sumber_sonar: sumber,
    sonar_beku: null,
    sonar: {
      project: sonar.laporan.project,
      branch: sonar.laporan.branch,
      jumlah_issue: sonar.laporan.issues.length,
      jumlah_hotspot: sonar.laporan.hotspots.length,
      jumlah_alert: alert.length,
    },
    hash_kode_sumber: null,
    tarif: null,
  };

  const run = {
    nomor,
    skenario: 'A',
    mode_model: 'tunggal',
    model_menjawab: null,
    mulai,
    selesai,
    durasi_detik: Math.max(0, Math.round((Date.parse(selesai) - Date.parse(mulai)) / 1000)),
    // biaya_usd dan status_panggilan TIDAK diisi di sini: susunRun menurunkannya dari daftar
    // panggilan yang benar-benar terjadi. Karena tidak ada satu pun panggilan, keduanya menjadi
    // nol dengan sendirinya. Menuliskannya tetap akan terbaca seolah angka itu yang menentukan,
    // padahal diabaikan.
    //
    // Tidak ada prompt yang dirakit, jadi tidak ada hash prompt untuk dicatat.
    hash_prompt: { system: null, user_deteksi: null },
    // Tidak ada `deteksi`: ketiadaannya yang membuat jumlah panggilan nol, bukan nilai nol.
    temuan: [],
    verifikasi: [],
  };

  const hasil = susunHasilV2({
    summary, run, nomor, id: idArg ? Number(idArg) : null, alert, parseCwe, repo,
  });

  fs.writeFileSync(keluar, `${JSON.stringify(hasil, null, 2)}\n`, 'utf8');
  console.log(`Skenario A: ${hasil.alerts.length} alert Sonar, 0 temuan, 0 panggilan LLM -> ${keluar}`);
  console.log(`  Sonar ${sonar.laporan.project} branch ${sonar.laporan.branch}, sumber ${sumber}`);
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`Gagal menyusun hasil skenario A: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
