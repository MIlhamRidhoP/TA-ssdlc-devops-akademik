// Scoring hasil prompt v2 (scripts/llm-scan.js).
//
// Pemakaian:
//   node scripts/llm-score.js --objek=<worktree objek uji> --sonar-beku=<file> [--label-alert=<file>] [--out=<file>] <folder> [<folder> ...]
// --sonar-beku wajib kalau ada folder kondisi utama. --ground-truth-revisi mengizinkan SEEDED.md yang berbeda dengan
// commit objek uji folder; laporan lalu ditandai ground_truth_seeded.revisi = true.
// --label-alert-paksa=<file> menimpa label alert untuk analisis sensitivitas (tanpa mengubah SEEDED.md); laporan
// ditandai sensitivitas = true. Label alert hanya memengaruhi metrik verifikasi empat kategori, bukan Skenario A/B/C.
//
// Semua folder harus berasal dari satu commit objek uji yang hash tree src/-nya sama dengan worktree --objek.
// Satu folder per vendor per kondisi. Folder kondisi utama dinilai dengan Skenario A, B, C, dan verifikasi. Folder ablasi dinilai deteksinya saja.
// triase-manual.json (opsional) dibaca dari masing-masing folder.
// --triase=<file> memberi satu file triase gabungan untuk semua vendor sekaligus: { entri: { <vendor>: { "run-N.json": { "<idx>": {kategori, lokasi, ...} } } } }.
// Sub-pohon per vendor menimpa triase per folder. Kategori tp_di_luar_seeded/teoretis/informasional/duplikat tidak dihitung FP
// setelah triase; hanya kategori "fp" dan temuan "di luar ground truth" yang belum ditriase yang tetap FP. Tidak ada kategori yang
// menambah TP, jadi recall tetap. FP ketat (tanpa triase) tetap dilaporkan berdampingan di setiap run.
// --triase-konservatif memakai varian konservatif: kategori "teoretis" ikut dihitung FP (tp_di_luar_seeded, informasional,
// duplikat tetap keluar). Laporan mencatat triase_varian: "utama" (default) atau "konservatif".
//
// Laporan mencatat commit_kode_scoring: HEAD repo alat yang menjalankan scoring beserta status bersih file dalam lingkup.
// Field ini berbeda dari commit_kode di tiap folder run, yang mencatat kode alat saat panggilan LLM dijalankan.
const fs = require('fs');
const path = require('path');
const { periksaObjek } = require('./llm-scan');
const { execFileSync } = require('child_process');
const { bacaBeku } = require('./llm/sonar-beku');
const { infoKodeAlat } = require('./llm/lanjut');

const ROOT = path.resolve(__dirname, '..');

// HEAD repo alat yang menjalankan scoring, dicatat di laporan. Berbeda dengan commit_kode di tiap folder run, yang
// mencatat kode alat saat panggilan LLM dijalankan. Scoring tidak menolak repo alat yang belum bersih, hanya mencatat.
const infoKodeScoring = () => {
  const i = infoKodeAlat(ROOT);
  return { head: i.head, branch: i.branch, bersih: i.bersih, berubah: i.berubah, lingkup: i.lingkup };
};

const ambilArg = (nama) => {
  const arg = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return arg ? arg.slice(nama.length + 3) : null;
};
const bacaJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Folder kondisi utama wajib memakai laporan Sonar beku yang sama dengan file --sonar-beku, dan alert yang dikirim
// ke panggilan verifikasi (sonar-alert.json) harus identik dengan alert yang diturunkan dari file itu. Scoring
// Skenario A dan B memakai alert hasil turunan file beku, jadi verifikasi dan scoring berasal dari satu sumber.
const KUNCI_ALERT = ['id', 'rule', 'tipe', 'file', 'baris', 'cwe', 'teks'];
const ringkasAlert = (a) => JSON.stringify(KUNCI_ALERT.map((k) => a[k] ?? null));

const periksaSumberSonar = (utama, beku) => {
  if (!utama.length) return;
  if (!beku) throw new Error('Folder kondisi utama ada, tetapi --sonar-beku tidak diisi. Scoring eksperimen wajib memakai laporan Sonar beku');
  for (const d of utama) {
    if (d.summary.sumber_sonar !== 'beku') {
      throw new Error(`${d.folder} memakai laporan Sonar dari ${d.summary.sumber_sonar ?? 'sumber tidak tercatat'}, bukan file beku`);
    }
    if (d.summary.sonar_beku?.sha256_isi !== beku.info.sha256_isi) {
      throw new Error(`${d.folder} memakai file Sonar beku lain (sha256_isi ${d.summary.sonar_beku?.sha256_isi})`);
    }
    const dikirim = (d.alert ?? []).map(ringkasAlert);
    const turunan = beku.alert.map(ringkasAlert);
    if (dikirim.length !== turunan.length || dikirim.some((a, i) => a !== turunan[i])) {
      throw new Error(`${d.folder}: alert yang dikirim ke verifikasi tidak sama dengan alert dari file Sonar beku`);
    }
  }
};

// Objek uji dicocokkan lewat hash tree src/ (git rev-parse <commit>:src), seperti scripts/llm-scan.js, sehingga
// scoring tetap sah dari commit objek uji mana pun yang src/-nya sama, misalnya setelah hasil eksperimen di-commit.
// Semua folder harus dari commit objek uji yang sama. Laporan mencatat commit objek uji dari folder, bukan HEAD
// worktree tempat scoring dijalankan.
const periksaObjekFolder = (data, objek) => {
  for (const d of data) {
    const tree = d.summary.objek_uji?.tree_src;
    if (!tree) throw new Error(`${d.folder} tidak mencatat hash tree src/ objek uji`);
    if (tree !== objek.tree_src) {
      throw new Error(`${d.folder}: hash tree src/ objek uji ${tree} berbeda dengan worktree --objek ${objek.commit} (${objek.tree_src})`);
    }
  }
  const commit = [...new Set(data.map((d) => d.summary.objek_uji.commit))];
  const branch = [...new Set(data.map((d) => d.summary.objek_uji.branch))];
  if (commit.length > 1) throw new Error(`Folder berasal dari commit objek uji berbeda: ${commit.join(', ')}`);
  return { commit: commit[0], branch: branch.length === 1 ? branch[0] : branch };
};

// Ground truth (SEEDED.md) dibaca dari HEAD worktree --objek, yang bisa berbeda commit dengan run. Hash blob SEEDED.md
// pada commit objek uji yang tercatat di folder dibandingkan dengan HEAD:SEEDED.md. Berbeda berarti ground truth
// berubah sejak run; scoring ditolak kecuali opsi revisi diisi, dan laporan ditandai sebagai versi revisi.
const blobSeeded = (dir, rev) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', `${rev}:SEEDED.md`], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

const periksaGroundTruth = (objek, objekFolder, { revisi = false } = {}) => {
  const blobFolder = blobSeeded(objek.dir, objekFolder.commit);
  if (!blobFolder) throw new Error(`SEEDED.md pada commit objek uji folder ${objekFolder.commit} tidak ditemukan di repo --objek`);
  const blob = blobSeeded(objek.dir, 'HEAD');
  if (!blob) throw new Error(`SEEDED.md tidak ada di HEAD worktree --objek ${objek.commit}`);
  const berbeda = blob !== blobFolder;
  if (berbeda && !revisi) {
    throw new Error(`SEEDED.md di worktree --objek (blob ${blob}) berbeda dengan commit objek uji folder ${objekFolder.commit} (blob ${blobFolder}). `
      + 'Pakai --ground-truth-revisi kalau scoring memang memakai ground truth revisi');
  }
  return { blob, blob_commit_objek_uji: blobFolder, revisi: berbeda };
};

// Memetakan file triase gabungan { entri: { <vendor>: {...} } } ke sub-pohon per vendor. Menolak bentuk salah atau vendor
// yang tidak ada di folder yang dinilai, supaya salah ketik vendor tidak diam-diam membuat triase terlewat.
const petakanTriaseGabungan = (gabungan, vendorDinilai) => {
  if (!gabungan || typeof gabungan !== 'object' || typeof gabungan.entri !== 'object' || gabungan.entri === null) {
    throw new Error('File --triase harus punya objek "entri" berisi sub-pohon triase per vendor');
  }
  const dikenal = new Set(vendorDinilai);
  const peta = {};
  for (const [vendor, sub] of Object.entries(gabungan.entri)) {
    if (!dikenal.has(vendor)) throw new Error(`File --triase memuat vendor "${vendor}" yang tidak ada di folder yang dinilai (${[...dikenal].join(', ')})`);
    peta[vendor] = sub;
  }
  return peta;
};

const bacaFolder = (folder) => {
  const summary = bacaJson(path.join(folder, 'summary.json'));
  const runs = fs.readdirSync(folder).filter((f) => /^run-\d+\.json$/.test(f))
    .map((f) => bacaJson(path.join(folder, f))).sort((a, b) => a.run - b.run);
  const fileAlert = path.join(folder, 'sonar-alert.json');
  const fileTriase = path.join(folder, 'triase-manual.json');
  return {
    folder, summary, runs,
    alert: fs.existsSync(fileAlert) ? bacaJson(fileAlert) : null,
    triase: fs.existsSync(fileTriase) ? bacaJson(fileTriase) : null,
  };
};

const main = () => {
  const folder = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
  if (!folder.length) throw new Error('Sebutkan minimal satu folder hasil llm-scan');
  const objek = periksaObjek(ambilArg('objek'));
  process.env.OBJEK_UJI_DIR = objek.dir;
  const score = require('./llm/score');
  const { bacaGroundTruth } = require('./gemini-scan');

  const data = folder.map(bacaFolder);
  for (const d of data) {
    if (d.summary.versi_prompt !== 'v2') throw new Error(`${d.folder} bukan hasil prompt v2`);
  }
  // --triase=<file> memberi satu file triase gabungan untuk semua folder: { entri: { <vendor>: { "run-N.json": {...} } } }.
  // Sub-pohon per vendor dipetakan ke d.triase, bentuknya sama dengan triase-manual.json per folder. Menimpa file per folder.
  const fileTriaseGabungan = ambilArg('triase');
  if (fileTriaseGabungan) {
    const peta = petakanTriaseGabungan(bacaJson(path.resolve(fileTriaseGabungan)), data.map((d) => d.summary.vendor));
    for (const d of data) d.triase = peta[d.summary.vendor] ?? null;
  }
  // Varian triase: utama (default) atau konservatif (--triase-konservatif), yang ikut menghitung kategori "teoretis" sebagai FP.
  const opsiTriase = { konservatif: process.argv.includes('--triase-konservatif') };
  const objekFolder = periksaObjekFolder(data, objek);
  const groundTruthSeeded = periksaGroundTruth(objek, objekFolder, { revisi: process.argv.includes('--ground-truth-revisi') });
  if (groundTruthSeeded.revisi) console.warn(`Peringatan: scoring memakai ground truth revisi (SEEDED.md blob ${groundTruthSeeded.blob})`);
  const kunci = data.map((d) => `${d.summary.vendor}/${d.summary.kondisi}`);
  const ganda = kunci.filter((k, i) => kunci.indexOf(k) !== i);
  if (ganda.length) throw new Error(`Lebih dari satu folder untuk ${[...new Set(ganda)].join(', ')}`);
  if (new Set(data.map((d) => d.summary.hash_kode_sumber)).size > 1) throw new Error('Hash kode sumber berbeda antar folder');

  const gt = bacaGroundTruth();
  const utama = data.filter((d) => d.summary.kondisi === 'utama');
  const ablasi = data.filter((d) => d.summary.kondisi !== 'utama');
  const laporan = {
    dinilai_pada: new Date().toISOString(),
    commit_kode_scoring: infoKodeScoring(),
    aturan_hardening: score.ATURAN_HARDENING,
    objek_uji: objekFolder,
    ground_truth_seeded: groundTruthSeeded,
    ground_truth: gt.map((g) => ({ id: g.id, kelas: g.kelas, klasifikasi: g.status })),
    folder: data.map((d) => ({ folder: path.relative(process.cwd(), d.folder).split(path.sep).join('/'), vendor: d.summary.vendor, kondisi: d.summary.kondisi, jumlah_run: d.runs.length })),
  };
  if (fileTriaseGabungan) laporan.triase_gabungan = { path: path.relative(process.cwd(), path.resolve(fileTriaseGabungan)).split(path.sep).join('/') };
  laporan.triase_varian = opsiTriase.konservatif ? 'konservatif' : 'utama';

  const fileBeku = ambilArg('sonar-beku');
  const beku = fileBeku ? bacaBeku(path.resolve(fileBeku), objek) : null;
  periksaSumberSonar(utama, beku);
  if (beku) laporan.sonar_beku = { ...beku.info, path: path.relative(objek.dir, path.resolve(fileBeku)).split(path.sep).join('/') };

  if (utama.length) {
    if (new Set(utama.map((d) => d.summary.hash_laporan_sonar)).size > 1) throw new Error('Alert Sonar berbeda antar folder utama');
    const { alert } = beku;
    const fileLabel = ambilArg('label-alert');
    const filePaksa = ambilArg('label-alert-paksa');
    const paksa = filePaksa ? bacaJson(path.resolve(filePaksa)) : {};
    const label = score.labelAlert(alert, gt, fileLabel ? bacaJson(path.resolve(fileLabel)) : {}, paksa);
    laporan.sensitivitas = Object.values(label).some((l) => l.sumber === 'paksa');
    if (laporan.sensitivitas) {
      laporan.label_alert_paksa = { path: path.relative(objek.dir, path.resolve(filePaksa)).split(path.sep).join('/') };
      console.warn(`Peringatan: analisis sensitivitas, label alert dipaksa: ${Object.entries(label).filter(([, l]) => l.sumber === 'paksa').map(([k, l]) => `${k}=${l.label} (awal ${l.label_awal})`).join(', ')}`);
    }
    const skorA = score.skenarioA(alert, gt);
    const perModel = utama.map((d) => {
      const skorRun = d.runs.map((run) => score.skorRunUtama({ run, alert, gt, label, triase: d.triase, opsiTriase }));
      score.validasiTriase(d.triase, d.runs, Object.fromEntries(skorRun.map((s) => [s.run, s.penilaian_c])));
      return {
        vendor: d.summary.vendor, model: d.summary.model_diminta, runs: d.runs, skorRun,
        ringkasan: {
          vendor: d.summary.vendor,
          model: d.summary.model_diminta,
          status_panggilan: score.hitungStatusPanggilan(d.runs),
          rata_rata: {
            skenario_a: score.rataMetrik([skorA.b_filter_v2]),
            skenario_b: score.rataMetrik(skorRun.map((s) => s.skenario_b)),
            skenario_c: score.rataMetrik(skorRun.map((s) => s.skenario_c)),
          },
          runs: skorRun.map(({ penilaian_c: _, ...s }) => s),
          tabel_per_item: score.tabelPerItem({ gt, skorA, skorRun }),
        },
      };
    });
    laporan.utama = {
      label_alert: label,
      skenario_a: skorA,
      per_model: perModel.map((m) => m.ringkasan),
      eksploratif_gabungan_model: perModel.length > 1 ? score.gabunganAntarModel({ perModel, alert, gt }) : null,
    };
  }
  if (ablasi.length) {
    laporan.ablasi = ablasi.map((d) => {
      const skorRun = d.runs.map((run) => score.skorRunDeteksi({ run, gt, triase: d.triase, opsiTriase }));
      score.validasiTriase(d.triase, d.runs, Object.fromEntries(skorRun.map((s) => [s.run, s.penilaian])));
      return {
        vendor: d.summary.vendor, model: d.summary.model_diminta, kondisi: d.summary.kondisi,
        status_panggilan: score.hitungStatusPanggilan(d.runs),
        rata_rata: score.rataMetrik(skorRun.map((s) => s.deteksi)),
        runs: skorRun.map(({ penilaian: _, ...s }) => s),
      };
    });
  }

  const out = path.resolve(ambilArg('out') ?? 'llm-score.json');
  fs.writeFileSync(out, JSON.stringify(laporan, null, 2));
  const f = (x) => (x === null || x === undefined ? '-' : x.toFixed(3));
  for (const m of laporan.utama?.per_model ?? []) {
    const r = m.rata_rata;
    console.log(`${m.vendor} (${m.model}): A P ${f(r.skenario_a.precision)} R ${f(r.skenario_a.recall)} F1 ${f(r.skenario_a.f1)} | `
      + `B P ${f(r.skenario_b.precision)} R ${f(r.skenario_b.recall)} F1 ${f(r.skenario_b.f1)} | `
      + `C P ${f(r.skenario_c.precision)} R ${f(r.skenario_c.recall)} F1 ${f(r.skenario_c.f1)}`);
  }
  for (const a of laporan.ablasi ?? []) {
    console.log(`${a.vendor} ${a.kondisi}: P ${f(a.rata_rata.precision)} R ${f(a.rata_rata.recall)} F1 ${f(a.rata_rata.f1)}`);
  }
  console.log(`Laporan skor disimpan di ${out}`);
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { periksaSumberSonar, periksaObjekFolder, periksaGroundTruth, petakanTriaseGabungan, infoKodeScoring };
