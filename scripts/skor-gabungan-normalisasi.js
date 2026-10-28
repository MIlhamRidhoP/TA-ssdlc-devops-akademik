#!/usr/bin/env node
// Varian skor-gabungan.js dengan normalisasi nama fungsi sebelum klaster lintas vendor: awalan
// "exports." dan "module.exports." dibuang sebelum field `fungsi` dibandingkan (hanya itu, tanpa
// normalisasi huruf besar/kecil atau yang lain). scripts/llm/gabung.js dan scripts/skor-gabungan.js
// TIDAK DIUBAH -- skrip ini terpisah, memanggil fungsi aslinya (cweSekeluarga, angkaCwe,
// temuanCocok asli, dan seluruh scripts/llm/score.js) langsung dari modulnya, supaya jalur lama
// dan jalur ternormalisasi selalu bisa dibandingkan dari kode yang sama persis kecuali satu baris
// pembanding fungsi.
//
// MENGAPA NORMALISASI INI PERLU: temuanCocok (scripts/llm/gabung.js:50-62) membandingkan field
// `fungsi` dengan kesetaraan string PERSIS. Ketiga vendor tidak konsisten menulis "findOwned" vs
// "exports.findOwned" -- bahkan vendor yang sama berganti gaya antar run -- sehingga klaster yang
// semestinya satu temuan pecah jadi dua, masing-masing kesepakatan=1. Di eksperimen 1 (batch
// 20261022-gabungan) ini terjadi 16 kali pada 3 run, dan mengubah recall mode "2 dari 3" dari
// 0,556 menjadi 0,778 (lihat hasil-eksperimen/20261022-gabungan/normalisasi/README.md).
//
// TIGA SALINAN HELPER TAK-DIEKSPOR dari scripts/llm/gabung.js (teksTemuan, sebutFungsi, dekat),
// disalin verbatim karena gabung.js tidak mengekspornya. Kalau gabung.js berubah, bandingkan baris
// itu (gabung.js:33-40) dengan salinan di bawah.
//
// GERBANG POHON-KERJA-BERSIH (periksaObjek di llm-scan.js) SENGAJA TIDAK DIPANGGIL DI SINI. Skrip
// itu menolak worktree objek uji yang kotor karena ia merekam commit yang HARUS sama dengan kode
// yang baru saja dipanggil API. Skrip ini tidak memanggil API apa pun -- ia hanya membaca ulang
// run-N.json dan results.json yang sudah ada (yang masing-masing SUDAH merekam commit_kode dan
// commit_objek_uji sendiri saat dibuat) -- sehingga kebersihan worktree SAAT INI tidak relevan
// untuk sahnya angka yang dihitung ulang di sini. Komit dan status worktree objek uji tetap
// dicatat di keluaran, hanya tidak dijadikan alasan menolak.
//
// Pemakaian:
//   node scripts/skor-gabungan-normalisasi.js --objek=<worktree objek uji> \
//     --batch=<folder batch, default hasil-eksperimen/20261022-gabungan relatif ke --objek> \
//     --out-dir=<folder keluaran baru, default <batch>/normalisasi>
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ambilArg = (nama, bawaan = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.slice(nama.length + 3) : bawaan;
};

// gemini-scan.js membaca OBJEK_UJI_DIR SAAT DI-REQUIRE (bukan saat dipanggil), jadi env harus
// diset sebelum baris require ini -- pola yang sama dipakai scripts/llm-scan.js dan
// scripts/llm-score.js. Argumen --objek wajib diproses lebih dulu, sebelum modul lain dimuat.
process.env.OBJEK_UJI_DIR = path.resolve(ambilArg('objek') || '../objek-seeded');

const gabungModul = require('./llm/gabung');
const score = require('./llm/score');
const gs = require('./gemini-scan');

const { cweSekeluarga, angkaCwe, temuanCocok } = gabungModul;
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tulisJson = (f, isi) => fs.writeFileSync(f, JSON.stringify(isi, null, 2) + '\n');

// ---------- Salinan verbatim helper tak-diekspor gabung.js:17,29,33-40 ----------
const JENDELA_BARIS = 5;
const normalFile = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const teksTemuan = (t) => `${t.jenis ?? ''} ${t.penjelasan ?? ''}`;
const sebutFungsi = (teks, nama) => new RegExp(`\\b${nama}\\b`).test(teks);
const dekat = (a, b) => {
  const ba = Number(a.baris);
  const bb = Number(b.baris);
  return Number.isFinite(ba) && Number.isFinite(bb) && Math.abs(ba - bb) <= JENDELA_BARIS;
};

// Satu-satunya perubahan dari gabung.js:50-62: fungsi dibandingkan setelah dibuang awalannya.
const normFungsi = (f) => (f ?? '').replace(/^module\.exports\./, '').replace(/^exports\./, '');
const temuanCocokNormalisasi = (a, b) => {
  if (normalFile(a.file) !== normalFile(b.file)) return false;
  if (!cweSekeluarga(angkaCwe(a.cwe), angkaCwe(b.cwe))) return false;
  const fa = normFungsi(a.fungsi);
  const fb = normFungsi(b.fungsi);
  if (fa && fb) return fa === fb;
  if (fa || fb) {
    const nama = fa || fb;
    const lain = fa ? b : a;
    return sebutFungsi(teksTemuan(lain), nama) || dekat(a, b);
  }
  return dekat(a, b);
};

// Salinan gabungTemuan (gabung.js:128-149), hanya mengambil fungsi pencocokan lewat parameter
// supaya satu salinan ini melayani jalur lama (temuanCocok asli) dan jalur baru (ternormalisasi)
// tanpa dua kali menyalin logika klaster yang sama.
const klasterMentah = (terpakai, cocokFn) => {
  const klaster = [];
  for (const { vendor, hasil } of terpakai) {
    for (const t of hasil.findings ?? []) {
      const k = klaster.find((c) => cocokFn(c.wakil, t));
      if (k) { k.anggota.push({ vendor, t }); continue; }
      klaster.push({ wakil: t, anggota: [{ vendor, t }] });
    }
  }
  return klaster;
};
const petakanKlaster = (klaster) => klaster.map((k) => {
  const w = k.wakil;
  const penjelasanVendor = {};
  for (const { vendor, t } of k.anggota) penjelasanVendor[vendor] = t.penjelasan ?? '';
  const vendorPenemu = [...new Set(k.anggota.map((x) => x.vendor))];
  return { ...w, penjelasan: null, penjelasan_vendor: penjelasanVendor, vendor_penemu: vendorPenemu, kesepakatan: vendorPenemu.length };
});

// ---------- Penjelasan wakil klaster dan alert gabungan, salinan skor-gabungan.js:124-128 ----------
const penjelasanWakil = (t) => {
  const w = (t.vendor_penemu ?? [])[0] ?? null;
  if (!w) return t.penjelasan ?? '';
  return (t.penjelasan_vendor ?? {})[w] ?? '';
};
const putusanGabungan = (a) => a.putusan_gabungan ?? a.putusan ?? null;
const alertDipertahankanGabungan = (hasilRunLama, alertBekuArr) => {
  const putusan = new Map((hasilRunLama.alerts ?? []).map((a) => [a.id, putusanGabungan(a)]));
  return alertBekuArr.filter((a) => putusan.get(a.id) !== 'false_positive');
};

const nilaiKlaster = (klasterTerpetakan, run, triaseRun, alertBeku, runLama) => {
  const temuan = klasterTerpetakan.map((t) => ({ ...t, penjelasan: penjelasanWakil(t) }));
  const eLlm = temuan.map((t, i) => ({ asal: 'llm', v1: score.temuanKeV1(t), sifat: t.sifat, rujukan: String(i) }));
  const dipertahankan = alertDipertahankanGabungan(runLama, alertBeku);
  const eSonar = dipertahankan.map((a) => ({ asal: 'sonar', v1: score.alertKeV1(a), sifat: null, rujukan: a.id }));
  const gt = gs.bacaGroundTruth();
  const c = score.nilaiHimpunan(eLlm, gt);
  const b = score.nilaiHimpunan([...eSonar, ...eLlm], gt);
  return {
    c: { ketat: c.metrik.ketat, triase: score.metrikSetelahTriase(c, triaseRun, {}), penilaian: c.penilaian },
    b: { ketat: b.metrik.ketat, triase: score.metrikSetelahTriase(b, triaseRun, {}), penilaian: b.penilaian },
  };
};

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ringkas3Run = (perRun) => {
  const out = {};
  for (const sk of ['b', 'c']) {
    const ketat = perRun.map((r) => r[sk].ketat);
    const triase = perRun.map((r) => r[sk].triase);
    const sTp = ketat.reduce((s, k) => s + k.tp, 0);
    const sFp = ketat.reduce((s, k) => s + k.fp, 0);
    const sFn = ketat.reduce((s, k) => s + k.fn, 0);
    out[sk] = {
      per_run: perRun.map((r, i) => ({ run: i + 1, ketat: r[sk].ketat, tinjauan: { fp: r[sk].triase.fp, precision: r[sk].triase.precision, f1: r[sk].triase.f1 } })),
      jumlah_3_run_ketat: { tp: sTp, fp: sFp, fn: sFn, precision: sTp / (sTp + sFp), recall: sTp / (sTp + sFn) },
      rata_rata_per_run_ketat: { precision: avg(ketat.map((k) => k.precision)), recall: avg(ketat.map((k) => k.recall)), f1: avg(ketat.map((k) => k.f1)) },
      rata_rata_per_run_tinjauan: { precision: avg(triase.map((t) => t.precision)), f1: avg(triase.map((t) => t.f1)), jumlah_fp_tinjauan_3_run: triase.reduce((s, t) => s + t.fp, 0) },
    };
  }
  return out;
};

const gitInfo = (dir) => {
  const git = (...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim(); } catch { return null; } };
  const kotor = git('status', '--porcelain');
  return { commit: git('rev-parse', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), bersih: kotor === '', detail_kotor: kotor || null };
};

// ======================================================================================
(() => {
  const objek = process.env.OBJEK_UJI_DIR;
  const batch = path.resolve(objek, ambilArg('batch', 'hasil-eksperimen/20261022-gabungan'));
  const outDir = path.resolve(ambilArg('out-dir', path.join(batch, 'normalisasi')));
  fs.mkdirSync(outDir, { recursive: true });

  const gt = gs.bacaGroundTruth();
  const alertBeku = (J(path.join(objek, 'hasil-eksperimen/20261019/sonar-beku.json')).alert) ?? [];
  const triaseLama = J(path.join(batch, 'triase-gabungan-v3.json'));

  const terpakaiRun = (run) => ['google', 'anthropic', 'openai'].map((vendor) => {
    const hasil = J(path.join(batch, 'gabungan/per-vendor', `run-${run}`, vendor, 'results.json'));
    hasil.findings = (hasil.findings ?? []).map((t, idx) => ({ ...t, _vendor: vendor, _idxAsal: idx }));
    return { vendor, hasil };
  });

  const semuaRun = [1, 2, 3];
  const triaseBaru = { catatan: '', metode_pewarisan: '', konflik: [], entri: {} };
  const perRunUnion = [], perRun2dari3Laporan = [];
  const fpUnionDaftar = [], fp2dari3Daftar = [];
  const identitasPangkat = {}; // untuk bagian 5: identitas -> posisi klaster lama, dipakai verifikasi

  for (const run of semuaRun) {
    const terpakai = terpakaiRun(run);
    const runLama = J(path.join(batch, 'gabungan', `run-${run}.json`));
    const triaseRunLama = triaseLama.entri[`run-${run}.json`] ?? {};

    // Klaster lama (dibangun ulang dari fungsi asli temuanCocok, BUKAN dibaca dari run-N.json)
    // supaya posisi klaster bisa ditautkan balik ke identitas (vendor, idx-asal) tiap anggota.
    // Bagian 5 membuktikan urutan dan isinya identik dengan run-N.json yang sudah ada.
    const klasterLamaMentah = klasterMentah(terpakai, temuanCocok);
    const identitasKePosisiLama = {};
    klasterLamaMentah.forEach((k, posisi) => {
      for (const { vendor, t } of k.anggota) identitasKePosisiLama[`${vendor}|${t._idxAsal}`] = posisi;
    });
    identitasPangkat[run] = identitasKePosisiLama;

    // Klaster baru, ternormalisasi.
    const klasterBaruMentah = klasterMentah(terpakai, temuanCocokNormalisasi);
    const triaseRunBaru = {};
    klasterBaruMentah.forEach((k, posisiBaru) => {
      const posisiLamaSet = new Set(k.anggota.map(({ vendor, t }) => identitasKePosisiLama[`${vendor}|${t._idxAsal}`]));
      const labelTerkait = [...posisiLamaSet].map((p) => triaseRunLama[String(p)]).filter(Boolean);
      const labelUnik = [...new Set(labelTerkait.map((l) => l.kategori))];
      if (labelUnik.length > 1) {
        triaseBaru.konflik.push({
          run, posisi_klaster_baru: posisiBaru, file: k.wakil.file, baris: k.wakil.baris,
          anggota: k.anggota.map(({ vendor, t }) => ({ vendor, idx_asal: t._idxAsal, fungsi: t.fungsi, posisi_klaster_lama: identitasKePosisiLama[`${vendor}|${t._idxAsal}`] })),
          label_per_posisi_lama: [...posisiLamaSet].map((p) => ({ posisi_lama: p, label: triaseRunLama[String(p)] ?? null })),
          status: 'perlu keputusan',
        });
      } else if (labelUnik.length === 1) {
        triaseRunBaru[String(posisiBaru)] = { ...labelTerkait[0], dasar: `${labelTerkait[0].dasar} [diwariskan ke klaster ternormalisasi dari klaster lama posisi ${[...posisiLamaSet].join(',')}, run-${run}.json]` };
      }
      // labelUnik.length === 0: tidak ada entri triase untuk diwariskan (klaster TP atau belum
      // ditriase di jalur lama); dibiarkan tanpa entri, sama seperti perilaku bawaan skor-gabungan.js.
    });
    triaseBaru.entri[`run-${run}.json`] = triaseRunBaru;

    const klasterBaruTerpetakan = petakanKlaster(klasterBaruMentah);
    const klasterBaru2dari3 = klasterBaruTerpetakan.filter((t) => t.kesepakatan >= 2);

    perRunUnion.push(nilaiKlaster(klasterBaruTerpetakan, run, triaseRunBaru, alertBeku, runLama));
    perRun2dari3Laporan.push(nilaiKlaster(klasterBaru2dari3, run, triaseRunBaru, alertBeku, runLama));
  }

  // Jangkauan untuk konflik yang belum diputuskan: dihitung dua varian skenario_c union saja
  // (variabel yang dipakai paper), batas bawah = seluruh klaster konflik dihitung FP, batas atas
  // = seluruh klaster konflik dikeluarkan dari FP (seolah label paling lunak di antara yang
  // bertentangan dipakai untuk semuanya). Dua varian ini TIDAK memutuskan konflik, hanya
  // membatasi rentang angka yang mungkin sampai manusia memutuskan.
  const konflikPerRun = {};
  triaseBaru.konflik.forEach((k) => { (konflikPerRun[k.run] = konflikPerRun[k.run] || []).push(k); });
  const hitungJangkauan = () => {
    const batasBawah = [], batasAtas = []; // bawah = konflik tetap FP, atas = konflik dikeluarkan
    for (const run of semuaRun) {
      const terpakai = terpakaiRun(run);
      const runLama = J(path.join(batch, 'gabungan', `run-${run}.json`));
      const klasterBaruMentah = klasterMentah(terpakai, temuanCocokNormalisasi);
      const klasterBaruTerpetakan = petakanKlaster(klasterBaruMentah);
      const triaseRunBaru = triaseBaru.entri[`run-${run}.json`];
      const konflikRun = konflikPerRun[run] ?? [];
      const triaseAtas = { ...triaseRunBaru };
      konflikRun.forEach((k) => { triaseAtas[String(k.posisi_klaster_baru)] = { kategori: 'tp_di_luar_seeded', lokasi: k.file, dasar: 'sementara untuk batas atas jangkauan: konflik dikeluarkan dari FP' }; });
      batasBawah.push(nilaiKlaster(klasterBaruTerpetakan, run, triaseRunBaru, alertBeku, runLama).c);
      batasAtas.push(nilaiKlaster(klasterBaruTerpetakan, run, triaseAtas, alertBeku, runLama).c);
    }
    return { batas_bawah_konflik_tetap_fp: ringkas3Run(batasBawah.map((c) => ({ c, b: c }))).c, batas_atas_konflik_dikeluarkan: ringkas3Run(batasAtas.map((c) => ({ c, b: c }))).c };
  };

  // ----- (c) 2 dari 3 tingkat butir -----
  const ITEM = ['S1', 'S3', 'S4', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'];
  const skorTunggal = J(path.join(batch, 'skor-tunggal-triase-v3.json'));
  const perRunButir = [];
  for (const run of semuaRun) {
    const statusPerVendor = {};
    for (const v of ['google', 'anthropic', 'openai']) {
      const m = skorTunggal.utama.per_model.find((x) => x.vendor === v);
      statusPerVendor[v] = m.runs.find((r) => r.run === run).skenario_c.status_gt;
    }
    const tp = ITEM.filter((id) => ['google', 'anthropic', 'openai'].filter((v) => statusPerVendor[v][id] === 'cocok').length >= 2).length;
    const fn = ITEM.length - tp;
    const terpakai = terpakaiRun(run);
    const klasterBaruMentah = klasterMentah(terpakai, temuanCocokNormalisasi);
    const klasterBaru2dari3 = petakanKlaster(klasterBaruMentah).filter((t) => t.kesepakatan >= 2);
    const triaseRunBaru = triaseBaru.entri[`run-${run}.json`];
    const runLama = J(path.join(batch, 'gabungan', `run-${run}.json`));
    const nilaiC = nilaiKlaster(klasterBaru2dari3, run, triaseRunBaru, alertBeku, runLama).c;
    const fp = nilaiC.ketat.fp;
    const fpTri = nilaiC.triase.fp;
    const p = tp / (tp + fp); const r = tp / (tp + fn); const f1 = p && r ? 2 * p * r / (p + r) : 0;
    const pT = tp / (tp + fpTri); const f1T = pT && r ? 2 * pT * r / (pT + r) : 0;
    perRunButir.push({ run, tp, fn, fp_ketat: fp, p_ketat: p, r, f1_ketat: f1, fp_tinjauan: fpTri, p_tinjauan: pT, f1_tinjauan: f1T });
    nilaiC.penilaian.filter((x) => x.status === 'di luar ground truth' || x.status === 'perlu cek manual').forEach((x) => {
      fp2dari3Daftar.push({ run, file: x.file, baris: x.baris, cwe: x.cwe, status: x.status });
    });
  }
  const sTpB = perRunButir.reduce((s, r) => s + r.tp, 0), sFnB = perRunButir.reduce((s, r) => s + r.fn, 0), sFpB = perRunButir.reduce((s, r) => s + r.fp_ketat, 0);
  const ringkasButir = {
    per_run: perRunButir,
    jumlah_3_run_ketat: { tp: sTpB, fn: sFnB, fp: sFpB, precision: sTpB / (sTpB + sFpB), recall: sTpB / (sTpB + sFnB) },
    rata_rata_per_run_ketat: { precision: avg(perRunButir.map((r) => r.p_ketat)), f1: avg(perRunButir.map((r) => r.f1_ketat)), recall: avg(perRunButir.map((r) => r.r)) },
    rata_rata_per_run_tinjauan: { precision: avg(perRunButir.map((r) => r.p_tinjauan)), f1: avg(perRunButir.map((r) => r.f1_tinjauan)) },
  };

  // ----- Daftar FP union dan FP 2-dari-3 yang tersisa (ketat), diambil dari run terakhir yang
  // sudah dihitung di atas (dipakai lagi di sini supaya tidak menghitung dua kali) -----
  for (const run of semuaRun) {
    const terpakai = terpakaiRun(run);
    const klasterBaruTerpetakan = petakanKlaster(klasterMentah(terpakai, temuanCocokNormalisasi));
    const runLama = J(path.join(batch, 'gabungan', `run-${run}.json`));
    const triaseRunBaru = triaseBaru.entri[`run-${run}.json`];
    const nc = nilaiKlaster(klasterBaruTerpetakan, run, triaseRunBaru, alertBeku, runLama).c;
    nc.penilaian.filter((x) => x.status === 'di luar ground truth' || x.status === 'perlu cek manual').forEach((x, i) => {
      const k = klasterBaruTerpetakan[x.indeks];
      fpUnionDaftar.push({ run, file: x.file, baris: x.baris, cwe: x.cwe, fungsi_wakil: k.fungsi, vendor_penemu: k.vendor_penemu, kesepakatan: k.kesepakatan, status: x.status, kategori_triase: (triaseRunBaru[String(x.indeks)] ?? null)?.kategori ?? 'belum ditriase' });
    });
  }

  triaseBaru.catatan = `Diturunkan dari ${path.relative(objek, path.join(batch, 'triase-gabungan-v3.json'))} lewat skrip scripts/skor-gabungan-normalisasi.js. Setiap klaster ternormalisasi mewarisi label dari klaster lama yang memuat anggotanya, dicocokkan lewat identitas temuan asal (vendor, indeks di results.json per-vendor), bukan indeks posisi klaster. Klaster yang anggotanya berasal dari klaster lama berlabel BERBEDA dicatat di bagian "konflik" dengan status "perlu keputusan" dan TIDAK diberi entri di "entri" (default: tetap dihitung FP, konservatif).`;
  triaseBaru.metode_pewarisan = 'identitas (vendor, idx_asal_di_results.json) -> posisi klaster lama -> label triase lama';

  tulisJson(path.join(outDir, 'triase-gabungan-v3-normalisasi.json'), triaseBaru);
  const ringkasanAkhir = {
    dibuat: new Date().toISOString(),
    git_objek_uji: gitInfo(objek),
    jumlah_konflik_triase: triaseBaru.konflik.length,
    a_union: ringkas3Run(perRunUnion),
    b_2dari3_laporan: ringkas3Run(perRun2dari3Laporan),
    c_2dari3_butir: ringkasButir,
    jangkauan_jika_ada_konflik: triaseBaru.konflik.length ? hitungJangkauan() : null,
    fp_union_tersisa: fpUnionDaftar,
    fp_2dari3_tersisa: fp2dari3Daftar,
  };
  tulisJson(path.join(outDir, 'skor-gabungan-normalisasi.json'), ringkasanAkhir);

  console.log(`Konflik triase: ${triaseBaru.konflik.length}`);
  console.log('a) union ketat (rata per run):', JSON.stringify(ringkasanAkhir.a_union.c.rata_rata_per_run_ketat));
  console.log('b) 2-dari-3 laporan ketat (rata per run):', JSON.stringify(ringkasanAkhir.b_2dari3_laporan.c.rata_rata_per_run_ketat));
  console.log('c) 2-dari-3 butir ketat (rata per run):', JSON.stringify(ringkasButir.rata_rata_per_run_ketat));
  console.log(`Keluaran ditulis ke ${outDir}`);
})();
