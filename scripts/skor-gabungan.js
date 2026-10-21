#!/usr/bin/env node
// Penilaian mode gabungan (suara terbanyak) untuk prompt v2.
//
// Terpisah dari scripts/llm-score.js dengan sengaja. llm-score menilai keluaran satu vendor per
// folder; mode gabungan menilai hasil yang sudah disatukan scripts/llm/gabung.js, yang bentuknya
// berbeda: alert punya putusan_gabungan (termasuk "tidak_sepakat") dan temuan sudah diklaster
// antar-vendor. Skrip ini TIDAK mengubah llm-score.js, llm/score.js, maupun buat-acuan-skor.js;
// seluruh aturan penilaian dipanggil dari fungsi yang sudah diekspor di sana, supaya angka mode
// gabungan dan mode tunggal tidak bisa menyimpang diam-diam.
//
// Pemakaian:
//   node scripts/skor-gabungan.js --objek=<worktree objek uji> --sonar-beku=<file> \
//        --gabungan=<dir berisi run-N.json hasil llm-gabung> [--triase=<file>] [--triase-konservatif] \
//        [--ground-truth-revisi] [--out=<file>] <folder vendor> [<folder vendor> ...]
//
// Folder vendor adalah folder keluaran llm-scan (berisi summary.json, run-N.json, sonar-alert.json).
// Folder itu TIDAK dinilai di sini; ia dipakai untuk menjalankan gerbang yang sama persis dengan
// llm-score, karena hanya folder yang menyimpan alert yang benar-benar dikirim ke verifikasi
// beserta teksnya. Berkas gabungan sendiri tidak memuat field `teks`, jadi perbandingan tujuh kunci
// alert tidak bisa dilakukan di atasnya.
//
// Tiga keputusan penilaian, ditetapkan sebelum run dan dicatat di laporan:
//   1. Penjelasan temuan gabungan direkonstruksi dari penjelasan_vendor milik VENDOR WAKIL klaster
//      (vendor_penemu[0], yaitu vendor yang lokasinya dipakai). Bukan gabungan teks semua vendor.
//      Alasannya: pencocokan ke ground truth memakai teks `jenis + penjelasan` untuk mencari sebutan
//      nama fungsi (scripts/gemini-scan.js:541, :552). Memakai gabungan teks tiga vendor memberi
//      mode gabungan lebih banyak kesempatan cocok daripada mode tunggal, dan angkanya tidak lagi
//      sebanding. Kalau penjelasan vendor wakil kosong, dibiarkan kosong.
//   2. Alert berputusan "tidak_sepakat" dipetakan ke "uncertain" untuk empat kategori verifikasi,
//      karena keduanya berarti hal yang sama di sisi keputusan: alert tidak dibuang. Jumlah
//      tidak_sepakat dilaporkan sebagai kolom tersendiri supaya tidak hilang di dalam uncertain.
//   3. Temuan berstatus "di luar ground truth" yang belum ditriase tetap dihitung FP (perilaku
//      bawaan metrikSetelahTriase), dan belum_ditriase dilaporkan apa adanya.
const fs = require('fs');
const path = require('path');
const { periksaObjek } = require('./llm-scan');
const { bacaBeku } = require('./llm/sonar-beku');
// Gerbang dipakai ulang dari llm-score, bukan ditulis ulang: dua salinan aturan yang sama pasti
// menyimpang suatu saat, dan yang menyimpang diam-diam di sini adalah gerbang keabsahan data.
const { periksaSumberSonar, periksaObjekFolder, periksaGroundTruth, infoKodeScoring } = require('./llm-score');

const TIDAK_SEPAKAT = 'tidak_sepakat';
const CARA_PENJELASAN = 'vendor-wakil-klaster';

const ambilArg = (nama) => {
  const arg = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return arg ? arg.slice(nama.length + 3) : null;
};
const bacaJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Bentuknya sama dengan bacaFolder di llm-score.js: summary, run-N.json terurut, dan sonar-alert.
const bacaFolder = (folder) => {
  const summary = bacaJson(path.join(folder, 'summary.json'));
  const runs = fs.readdirSync(folder).filter((f) => /^run-\d+\.json$/.test(f))
    .map((f) => bacaJson(path.join(folder, f))).sort((a, b) => a.run - b.run);
  const fileAlert = path.join(folder, 'sonar-alert.json');
  return { folder, summary, runs, alert: fs.existsSync(fileAlert) ? bacaJson(fileAlert) : null };
};

// Berkas gabungan diberi nama run-N.json atau gabungan-run-N.json oleh llm-gabung; keduanya
// diterima supaya penamaan folder arsip tidak memaksa satu bentuk.
const POLA_GABUNGAN = /^(?:gabungan-)?run-(\d+)\.json$/;
const bacaGabungan = (dir) => {
  if (!fs.existsSync(dir)) throw new Error(`--gabungan ${dir} tidak ada`);
  const berkas = fs.readdirSync(dir).map((f) => [f, POLA_GABUNGAN.exec(f)]).filter(([, m]) => m);
  if (!berkas.length) throw new Error(`Tidak ada run-N.json di ${dir}`);
  const hasil = berkas.map(([f, m]) => ({ indeks: Number(m[1]), file: f, isi: bacaJson(path.join(dir, f)) }))
    .sort((a, b) => a.indeks - b.indeks);
  for (const h of hasil) {
    if (h.isi.schema_version !== 2) throw new Error(`${h.file} bukan skema 2`);
    if ((h.isi.run?.mode_model ?? null) !== 'gabungan') {
      throw new Error(`${h.file} bukan hasil mode gabungan (mode_model ${h.isi.run?.mode_model ?? 'tidak ada'})`);
    }
  }
  const ganda = hasil.map((h) => h.indeks).filter((n, i, a) => a.indexOf(n) !== i);
  if (ganda.length) throw new Error(`Indeks run ganda di ${dir}: ${[...new Set(ganda)].join(', ')}`);
  return hasil;
};

// Triase diterima dalam dua bentuk: { "run-N.json": {...} } apa adanya, atau dibungkus
// { catatan, entri: { "run-N.json": {...} } } seperti berkas triase gabungan eksperimen utama.
const bacaTriase = (file) => {
  const isi = bacaJson(file);
  const sub = isi && typeof isi.entri === 'object' && isi.entri !== null ? isi.entri : isi;
  for (const k of Object.keys(sub)) {
    if (!/^run-\d+\.json$/.test(k)) throw new Error(`File triase memuat kunci "${k}", seharusnya "run-N.json"`);
  }
  return sub;
};

// ---------- Gerbang ----------

// Lima gerbang yang tidak memerlukan git. Gerbang ground truth butuh git dan dijalankan di main.
// Urutannya sengaja sama dengan llm-score.js supaya pesan galat yang muncul lebih dulu juga sama.
const periksaFolder = (data, objek, beku) => {
  for (const d of data) {
    if (d.summary.versi_prompt !== 'v2') throw new Error(`${d.folder} bukan hasil prompt v2`);
  }
  const objekFolder = periksaObjekFolder(data, objek);
  const kunci = data.map((d) => `${d.summary.vendor}/${d.summary.kondisi}`);
  const ganda = kunci.filter((k, i) => kunci.indexOf(k) !== i);
  if (ganda.length) throw new Error(`Lebih dari satu folder untuk ${[...new Set(ganda)].join(', ')}`);
  if (new Set(data.map((d) => d.summary.hash_kode_sumber)).size > 1) throw new Error('Hash kode sumber berbeda antar folder');
  periksaSumberSonar(data.filter((d) => d.summary.kondisi === 'utama'), beku);
  return objekFolder;
};

// Gerbang tambahan yang tidak ada di llm-score karena tidak diperlukan di sana: alert di berkas
// gabungan harus himpunan yang sama dengan alert dari file beku. Kalau berbeda, berkas gabungan
// berasal dari laporan Sonar lain dan angkanya tidak sebanding.
const periksaAlertGabungan = (gabungan, alertBeku) => {
  const idBeku = alertBeku.map((a) => a.id).join(',');
  for (const g of gabungan) {
    const id = (g.isi.alerts ?? []).map((a) => a.id).join(',');
    if (id !== idBeku) {
      throw new Error(`${g.file}: daftar alert (${id || 'kosong'}) tidak sama dengan alert dari file Sonar beku (${idBeku})`);
    }
  }
};

// ---------- Penilaian satu run gabungan ----------

// Penjelasan temuan gabungan: milik vendor wakil klaster saja. gabungTemuan menyetel penjelasan
// menjadi null dan memindahkan teks tiap vendor ke penjelasan_vendor (scripts/llm/gabung.js:146-147),
// jadi tanpa langkah ini seluruh temuan kehilangan sinyal lokasi berbasis teks.
const penjelasanWakil = (t) => {
  const wakil = (t.vendor_penemu ?? [])[0] ?? null;
  if (!wakil) return t.penjelasan ?? '';
  return (t.penjelasan_vendor ?? {})[wakil] ?? '';
};

const temuanGabungan = (hasil) => (hasil.findings ?? []).map((t) => ({ ...t, penjelasan: penjelasanWakil(t) }));

const putusanGabungan = (a) => a.putusan_gabungan ?? a.putusan ?? null;

// Alert yang dipertahankan: semua yang TIDAK diputus false_positive oleh mayoritas. Aturannya
// sejajar dengan alertDipertahankan di scripts/llm/score.js:190-193; "tidak_sepakat" ikut
// dipertahankan, karena ketidaksepakatan model bukan bukti alertnya tidak nyata.
const alertDipertahankanGabungan = (hasil, alertBeku) => {
  const putusan = new Map((hasil.alerts ?? []).map((a) => [a.id, putusanGabungan(a)]));
  return alertBeku.filter((a) => putusan.get(a.id) !== 'false_positive');
};

// Entri verifikasi tiruan untuk kategoriVerifikasi. "tidak_sepakat" dipetakan ke "uncertain"
// (keputusan 2 di kepala berkas); keduanya ada di PUTUSAN_DIPERTAHANKAN (scripts/llm/score.js:146).
const entriVerifikasiGabungan = (hasil) => (hasil.alerts ?? []).map((a) => {
  const g = putusanGabungan(a);
  return {
    id_alert: a.id,
    putusan: g === TIDAK_SEPAKAT ? 'uncertain' : g,
    keyakinan: null,
    tanda: [],
    metadata: { status: 'ok', parse_ok: true },
  };
});

// Satu run gabungan dinilai dengan fungsi yang sama persis dengan mode tunggal.
// `score` disuntikkan supaya pemanggil mengatur OBJEK_UJI_DIR sebelum modul scoring dimuat.
const nilaiRunGabungan = ({ hasil, alertBeku, gt, score, triaseRun = null, opsiTriase = {} }) => {
  const temuan = temuanGabungan(hasil);
  const dipertahankan = alertDipertahankanGabungan(hasil, alertBeku);
  const eLlm = temuan.map((t, i) => ({ asal: 'llm', v1: score.temuanKeV1(t), sifat: t.sifat, rujukan: String(i) }));
  const eSonar = (daftar) => daftar.map((a) => ({ asal: 'sonar', v1: score.alertKeV1(a), sifat: null, rujukan: a.id }));

  const c = score.nilaiHimpunan(eLlm, gt);
  const b = score.nilaiHimpunan([...eSonar(dipertahankan), ...eLlm], gt);
  const sv = score.nilaiHimpunan(eSonar(dipertahankan), gt);

  const alerts = hasil.alerts ?? [];
  const tidakSepakat = alerts.filter((a) => putusanGabungan(a) === TIDAK_SEPAKAT).map((a) => a.id);
  // Dibedakan dari tidak_sepakat: di sini tidak ada satu pun vendor yang memberi putusan sah, jadi
  // yang terjadi bukan model berbeda pendapat melainkan tidak ada pendapat sama sekali.
  const tanpaPutusanVendor = alerts
    .filter((a) => Object.values(a.putusan_vendor ?? {}).every((p) => p === null || p === undefined))
    .map((a) => a.id);

  return {
    run: hasil.run?.nomor ?? null,
    vendor_dipakai: [...(hasil.run?.vendor_dipakai ?? [])],
    vendor_gagal: (hasil.run?.vendor_gagal ?? []).map((g) => ({ vendor: g.vendor ?? null, alasan: g.alasan ?? null })),
    jumlah_temuan: temuan.length,
    kesepakatan_temuan: {
      tiga: temuan.filter((t) => t.kesepakatan === 3).length,
      dua: temuan.filter((t) => t.kesepakatan === 2).length,
      satu: temuan.filter((t) => t.kesepakatan === 1).length,
    },
    alert_tidak_sepakat: tidakSepakat,
    alert_tanpa_putusan_vendor: tanpaPutusanVendor,
    skenario_c: {
      ...c.metrik,
      hardening_di_luar_ground_truth: c.hardening_di_luar_ground_truth,
      hardening_cocok_seeded: c.hardening_cocok_seeded,
      setelah_triase: score.metrikSetelahTriase(c, triaseRun, opsiTriase),
      status_gt: c.status_gt,
    },
    skenario_b: {
      ...b.metrik,
      hardening_di_luar_ground_truth: b.hardening_di_luar_ground_truth,
      hardening_cocok_seeded: b.hardening_cocok_seeded,
      setelah_triase: score.metrikSetelahTriase(b, triaseRun, opsiTriase),
      status_gt: b.status_gt,
      alert_dipertahankan: dipertahankan.map((a) => a.id),
    },
    sonar_setelah_verifikasi: { alert: dipertahankan.map((a) => a.id), ...sv.metrik, status_gt: sv.status_gt },
    penilaian_c: c.penilaian,
    temuan_dinilai: temuan,
  };
};

// ---------- main ----------

const main = () => {
  const folder = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
  if (!folder.length) throw new Error('Sebutkan minimal satu folder vendor hasil llm-scan (dipakai untuk gerbang)');
  const dirGabungan = ambilArg('gabungan');
  if (!dirGabungan) throw new Error('--gabungan wajib: direktori berisi run-N.json hasil llm-gabung.js');
  const fileBeku = ambilArg('sonar-beku');
  if (!fileBeku) throw new Error('--sonar-beku wajib: penilaian eksperimen memakai laporan Sonar beku');

  const objek = periksaObjek(ambilArg('objek'));
  // Harus diset SEBELUM modul scoring dimuat: gemini-scan.js membaca OBJEK_UJI_DIR saat require
  // (scripts/gemini-scan.js:18-21), jadi require yang terlalu awal membaca worktree yang salah.
  process.env.OBJEK_UJI_DIR = objek.dir;
  // eslint-disable-next-line global-require
  const score = require('./llm/score');
  // eslint-disable-next-line global-require
  const { bacaGroundTruth } = require('./gemini-scan');

  const data = folder.map(bacaFolder);
  const beku = bacaBeku(path.resolve(fileBeku), objek);
  const objekFolder = periksaFolder(data, objek, beku);
  const groundTruthSeeded = periksaGroundTruth(objek, objekFolder, { revisi: process.argv.includes('--ground-truth-revisi') });
  if (groundTruthSeeded.revisi) console.warn(`Peringatan: scoring memakai ground truth revisi (SEEDED.md blob ${groundTruthSeeded.blob})`);

  const gabungan = bacaGabungan(path.resolve(dirGabungan));
  periksaAlertGabungan(gabungan, beku.alert);

  const fileTriase = ambilArg('triase');
  const triase = fileTriase ? bacaTriase(path.resolve(fileTriase)) : null;
  const opsiTriase = { konservatif: process.argv.includes('--triase-konservatif') };

  const gt = bacaGroundTruth();
  const label = score.labelAlert(beku.alert, gt, {}, {});

  const perRun = gabungan.map((g) => nilaiRunGabungan({
    hasil: g.isi,
    alertBeku: beku.alert,
    gt,
    score,
    triaseRun: triase?.[`run-${g.indeks}.json`] ?? null,
    opsiTriase,
  }));
  // Triase diperiksa dengan fungsi yang sama dengan mode tunggal: lokasi tiap entri harus cocok
  // dengan temuan pada indeks itu, dan indeksnya harus memang kandidat triase.
  if (triase) {
    const runSemu = gabungan.map((g, i) => ({ run: g.indeks, temuan: perRun[i].temuan_dinilai }));
    score.validasiTriase(triase, runSemu, Object.fromEntries(gabungan.map((g, i) => [g.indeks, perRun[i].penilaian_c])));
  }

  const verifikasi = gabungan.map((g) => score.kategoriVerifikasi(entriVerifikasiGabungan(g.isi), label));

  const laporan = {
    dinilai_pada: new Date().toISOString(),
    mode: 'gabungan',
    catatan: 'Penilaian mode gabungan (suara terbanyak). Terpisah dari llm-score.js; seluruh aturan penilaian dipanggil dari scripts/llm/score.js tanpa mengubahnya.',
    commit_kode_scoring: infoKodeScoring(),
    aturan_hardening: score.ATURAN_HARDENING,
    keputusan_penilaian: {
      rekonstruksi_penjelasan: CARA_PENJELASAN,
      rekonstruksi_penjelasan_catatan: 'Penjelasan temuan gabungan diambil dari penjelasan_vendor milik vendor_penemu[0], yaitu vendor wakil klaster. Bukan gabungan teks semua vendor, supaya pencocokan setara dengan mode tunggal. Kosong dibiarkan kosong.',
      tidak_sepakat_dipetakan_ke: 'uncertain',
      belum_ditriase_dihitung_fp: true,
    },
    objek_uji: objekFolder,
    ground_truth_seeded: groundTruthSeeded,
    ground_truth: gt.map((g) => ({ id: g.id, kelas: g.kelas, klasifikasi: g.status })),
    sonar_beku: { ...beku.info, path: path.relative(objek.dir, path.resolve(fileBeku)).split(path.sep).join('/') },
    folder_vendor: data.map((d) => ({
      folder: path.relative(process.cwd(), d.folder).split(path.sep).join('/'),
      vendor: d.summary.vendor, kondisi: d.summary.kondisi, jumlah_run: d.runs.length,
    })),
    gabungan: gabungan.map((g) => ({ indeks: g.indeks, file: g.file })),
    triase_varian: opsiTriase.konservatif ? 'konservatif' : 'utama',
    ...(fileTriase ? { triase: { path: path.relative(process.cwd(), path.resolve(fileTriase)).split(path.sep).join('/') } } : {}),
    label_alert: label,
    runs: perRun.map(({ penilaian_c: _p, temuan_dinilai: _t, ...r }, i) => ({ ...r, verifikasi: verifikasi[i] })),
    rata_rata: {
      skenario_b: score.rataMetrik(perRun.map((r) => r.skenario_b)),
      skenario_c: score.rataMetrik(perRun.map((r) => r.skenario_c)),
      sonar_setelah_verifikasi: score.rataMetrik(perRun.map((r) => r.sonar_setelah_verifikasi)),
    },
  };

  const out = path.resolve(ambilArg('out') ?? 'skor-gabungan.json');
  fs.writeFileSync(out, `${JSON.stringify(laporan, null, 2)}\n`);

  const f = (x) => (x === null || x === undefined ? '-' : x.toFixed(3));
  for (const [i, r] of laporan.runs.entries()) {
    console.log(`run ${r.run ?? gabungan[i].indeks} (${r.vendor_dipakai.length} vendor: ${r.vendor_dipakai.join(', ') || '-'}): `
      + `B P ${f(r.skenario_b.ketat.precision)} R ${f(r.skenario_b.ketat.recall)} F1 ${f(r.skenario_b.ketat.f1)} | `
      + `C P ${f(r.skenario_c.ketat.precision)} R ${f(r.skenario_c.ketat.recall)} F1 ${f(r.skenario_c.ketat.f1)} | `
      + `tidak sepakat ${r.alert_tidak_sepakat.length}`);
  }
  const rb = laporan.rata_rata.skenario_b;
  const rc = laporan.rata_rata.skenario_c;
  console.log(`rata-rata (${rb.jumlah_run} run, varian ketat): B P ${f(rb.precision)} R ${f(rb.recall)} F1 ${f(rb.f1)} | C P ${f(rc.precision)} R ${f(rc.recall)} F1 ${f(rc.f1)}`);
  console.log(`Laporan skor gabungan disimpan di ${out}`);
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  main, bacaFolder, bacaGabungan, bacaTriase, periksaFolder, periksaAlertGabungan,
  penjelasanWakil, temuanGabungan, alertDipertahankanGabungan, entriVerifikasiGabungan,
  nilaiRunGabungan, CARA_PENJELASAN, TIDAK_SEPAKAT,
};
