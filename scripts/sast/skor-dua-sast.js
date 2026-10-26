#!/usr/bin/env node
// Penilaian lengan dua perkakas SAST, skenario A.
//
// Terpisah dari scripts/llm-score.js dan scripts/skor-gabungan.js dengan sengaja, mengikuti
// preseden scripts/skor-gabungan.js:7-9: scripts/llm/score.js, scripts/llm-score.js, dan
// scripts/buat-acuan-skor.js TIDAK diubah, dan seluruh aturan penilaian dipanggil dari fungsi yang
// sudah diekspor di sana. Dengan begitu angka dua perkakas dan angka satu perkakas tidak bisa
// menyimpang diam-diam.
//
// Hanya skenario A. Itu bukan pembatasan sementara yang malas, melainkan satu-satunya yang bisa
// dinilai tanpa panggilan model: A tidak memakai LLM sama sekali. Skenario B dan C baru bisa dinilai
// setelah batch dijalankan, dan itu tahap berikutnya.
//
// PEMETAAN K6, dan ini mengubah angka sehingga wajib terbaca di keluaran:
// score.js:235 menyaring `tipe === 'VULNERABILITY'` untuk varian a_hanya_vulnerability. Nilai `tipe`
// itu milik SonarCloud (VULNERABILITY, SECURITY_HOTSPOT, CODE_SMELL) dan alert CodeQL tidak
// memilikinya, sehingga TANPA pemetaan seluruh alert CodeQL lenyap dari varian itu tanpa suara
// sementara varian b_filter_v2 tetap memuatnya. Keputusan K6: seluruh alert CodeQL tingkat 1
// diperlakukan setara VULNERABILITY. Pemetaan dilakukan di sini, bukan dengan menyentuh score.js,
// dan keluaran memuat kedua angka: dengan pemetaan dan tanpa pemetaan.
//
// Tidak memanggil API apa pun.
//
// Pemakaian:
//   node scripts/sast/skor-dua-sast.js --objek=<worktree objek uji> \
//     --sonar-beku=<file> --codeql-beku=<file> --out=<file>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ambilArg = (nama) => {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.slice(nama.length + 3) : null;
};
const wajib = (nama) => {
  const v = ambilArg(nama);
  if (!v) throw new Error(`--${nama} wajib`);
  return v;
};

const PEMETAAN_K6 = {
  keputusan: 'K6',
  aturan: 'Seluruh alert CodeQL tingkat 1 diperlakukan setara VULNERABILITY untuk varian a_hanya_vulnerability.',
  sebab: 'scripts/llm/score.js:235 menyaring tipe === "VULNERABILITY", dan nilai tipe itu milik SonarCloud. '
    + 'Tanpa pemetaan ini seluruh alert CodeQL lenyap dari varian a_hanya_vulnerability tanpa suara, '
    + 'sementara varian b_filter_v2 tetap memuatnya, sehingga kedua varian A diam-diam mengukur hal berbeda.',
  cara: 'Pemetaan dilakukan di scripts/sast/skor-dua-sast.js sebelum memanggil score.skenarioA; '
    + 'scripts/llm/score.js tidak diubah.',
  terpengaruh: 'varian a_hanya_vulnerability saja; b_filter_v2 tidak memakai medan tipe.',
};

// Alert CodeQL diberi tipe VULNERABILITY. Alert Sonar tidak disentuh.
const petakanK6 = (alert) => alert.map((a) => (a.sumber_sast === 'codeql' || a.sumber === 'codeql'
  ? { ...a, tipe: 'VULNERABILITY', tipe_asal: a.tipe ?? null }
  : a));

const main = () => {
  const objekDir = path.resolve(wajib('objek'));
  const bersih = execFileSync('git', ['-C', objekDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (bersih) throw new Error(`Worktree objek uji tidak bersih:\n${bersih}`);
  const commit = execFileSync('git', ['-C', objekDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const treeSrc = execFileSync('git', ['-C', objekDir, 'rev-parse', 'HEAD:src'], { encoding: 'utf8' }).trim();
  const objek = { dir: objekDir, commit, tree_src: treeSrc };

  process.env.OBJEK_UJI_DIR = objekDir;
  const score = require('../llm/score');
  const gs = require('../gemini-scan');
  const sumbu = require('./sumbu-sast');
  const bekuSonar = require('../llm/sonar-beku');
  const bekuCodeql = require('./codeql-beku');

  const s = bekuSonar.bacaBeku(path.resolve(wajib('sonar-beku')), objek);
  const c = bekuCodeql.bacaBeku(path.resolve(wajib('codeql-beku')), objek);
  const gt = gs.bacaGroundTruth();

  const render = require('../llm/render');
  const alertSonar = render.pilihAlert(s.ringkasan).map((a) => ({ ...a, teks: render.formatAlert(a, render.bacaTemplate().alert.teks) }));
  const himpunan = {
    sonar: alertSonar.map((a) => ({ ...a, sumber_sast: 'sonar' })),
    codeql: c.alert.map((a) => ({ ...a, sumber_sast: 'codeql' })),
    keduanya: sumbu.gabungAlert({ sonar: alertSonar, codeql: c.alert }),
  };

  const perSast = {};
  for (const [sast, alert] of Object.entries(himpunan)) {
    const denganK6 = score.skenarioA(petakanK6(alert), gt);
    const tanpaK6 = score.skenarioA(alert, gt);
    perSast[sast] = {
      jumlah_alert: alert.length,
      jumlah_per_perkakas: alert.reduce((o, a) => ({ ...o, [a.sumber_sast]: (o[a.sumber_sast] ?? 0) + 1 }), {}),
      skenario_a: denganK6,
      // Dilaporkan berdampingan, bukan disembunyikan: selisihnya adalah ukuran pengaruh K6.
      skenario_a_tanpa_pemetaan_k6: tanpaK6,
    };
  }

  const laporan = {
    dinilai_pada: new Date().toISOString(),
    catatan: 'Skenario A saja (SAST tanpa LLM). Skenario B dan C baru bisa dinilai setelah batch dijalankan.',
    aturan_penilaian: 'scripts/llm/score.js dan scripts/gemini-scan.js dipanggil apa adanya; keduanya tidak diubah.',
    aturan_hardening: score.ATURAN_HARDENING,
    pemetaan_k6: PEMETAAN_K6,
    objek_uji: { commit, tree_src: treeSrc },
    sonar_beku: { sha256_isi: s.info.sha256_isi, revisi: s.info.revisi },
    codeql_beku: { nama: c.info.nama, sha256_isi: c.info.sha256_isi, jumlah_alert: c.info.jumlah_alert },
    ground_truth: { jumlah_positif: gt.filter((g) => g.status === 'terbukti').length, jumlah_item: gt.length },
    per_sast: perSast,
  };

  const keluar = path.resolve(wajib('out'));
  fs.writeFileSync(keluar, `${JSON.stringify(laporan, null, 2)}\n`);
  const n3 = (x) => (typeof x === 'number' ? x.toFixed(3) : '-');
  for (const [sast, r] of Object.entries(perSast)) {
    const a = r.skenario_a.b_filter_v2.ketat;
    const h = r.skenario_a.a_hanya_vulnerability.ketat;
    const hTanpa = r.skenario_a_tanpa_pemetaan_k6.a_hanya_vulnerability.ketat;
    console.log(`${sast.padEnd(9)} ${String(r.jumlah_alert).padStart(2)} alert | b_filter_v2 P ${n3(a.precision)} R ${n3(a.recall)} F1 ${n3(a.f1)}`
      + ` | a_hanya_vulnerability P ${n3(h.precision)} R ${n3(h.recall)} F1 ${n3(h.f1)}`
      + ` (tanpa K6: P ${n3(hTanpa.precision)} R ${n3(hTanpa.recall)} F1 ${n3(hTanpa.f1)})`);
  }
  console.log(`Laporan: ${path.basename(keluar)}`);
};

module.exports = { PEMETAAN_K6, petakanK6 };

if (require.main === module) main();
