// Scoring hasil prompt v2 (scripts/llm-scan.js).
//
// Pemakaian:
//   node scripts/llm-score.js --objek=<worktree objek uji> --sonar-beku=<file> [--label-alert=<file>] [--out=<file>] <folder> [<folder> ...]
// --sonar-beku wajib kalau ada folder kondisi utama.
//
// Semua folder harus berasal dari commit objek uji yang sama dengan HEAD --objek. Satu folder per vendor per
// kondisi. Folder kondisi utama dinilai dengan Skenario A, B, C, dan verifikasi. Folder ablasi dinilai deteksinya saja.
// triase-manual.json (opsional) dibaca dari masing-masing folder.
const fs = require('fs');
const path = require('path');
const { periksaObjek } = require('./llm-scan');
const { bacaBeku } = require('./llm/sonar-beku');

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
    if (d.summary.objek_uji.commit !== objek.commit) {
      throw new Error(`${d.folder} dari commit ${d.summary.objek_uji.commit}, objek uji ${objek.commit}`);
    }
  }
  const kunci = data.map((d) => `${d.summary.vendor}/${d.summary.kondisi}`);
  const ganda = kunci.filter((k, i) => kunci.indexOf(k) !== i);
  if (ganda.length) throw new Error(`Lebih dari satu folder untuk ${[...new Set(ganda)].join(', ')}`);
  if (new Set(data.map((d) => d.summary.hash_kode_sumber)).size > 1) throw new Error('Hash kode sumber berbeda antar folder');

  const gt = bacaGroundTruth();
  const utama = data.filter((d) => d.summary.kondisi === 'utama');
  const ablasi = data.filter((d) => d.summary.kondisi !== 'utama');
  const laporan = {
    dinilai_pada: new Date().toISOString(),
    objek_uji: { commit: objek.commit, branch: objek.branch },
    ground_truth: gt.map((g) => ({ id: g.id, kelas: g.kelas, klasifikasi: g.status })),
    folder: data.map((d) => ({ folder: path.relative(process.cwd(), d.folder).split(path.sep).join('/'), vendor: d.summary.vendor, kondisi: d.summary.kondisi, jumlah_run: d.runs.length })),
  };

  const fileBeku = ambilArg('sonar-beku');
  const beku = fileBeku ? bacaBeku(path.resolve(fileBeku), objek) : null;
  periksaSumberSonar(utama, beku);
  if (beku) laporan.sonar_beku = { ...beku.info, path: path.relative(objek.dir, path.resolve(fileBeku)).split(path.sep).join('/') };

  if (utama.length) {
    if (new Set(utama.map((d) => d.summary.hash_laporan_sonar)).size > 1) throw new Error('Alert Sonar berbeda antar folder utama');
    const { alert } = beku;
    const fileLabel = ambilArg('label-alert');
    const label = score.labelAlert(alert, gt, fileLabel ? bacaJson(path.resolve(fileLabel)) : {});
    const skorA = score.skenarioA(alert, gt);
    const perModel = utama.map((d) => {
      const skorRun = d.runs.map((run) => score.skorRunUtama({ run, alert, gt, label, triase: d.triase }));
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
      const skorRun = d.runs.map((run) => score.skorRunDeteksi({ run, gt, triase: d.triase }));
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

module.exports = { periksaSumberSonar };
