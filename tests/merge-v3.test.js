// Tes jalur hasil dua perkakas: scripts/merge-results.js dijalankan sebagai PROSES.
//
// Berkas ini ada karena alasan yang sama dengan tests/llm-scan-cli.test.js. scripts/llm/results-v3.js
// sudah lengkap dan punya tesnya sendiri, tetapi TIDAK ADA satu pun pemanggil di scripts/: mergeV2
// memaku susunHasilV2, sehingga run dua perkakas akan dirakit sebagai skema 2 dan medan sumber_sast,
// kembar_dengan, run.sast, serta run.codeql_beku hilang tanpa suara. Modul benar, jalurnya tidak
// pernah dijangkau — dan itu baru terasa setelah batch berbayar selesai.
//
// Karena itu yang diuji di sini adalah titik masuknya, bukan modulnya: folder keluaran llm-scan
// disusun di folder sementara, lalu merge dan publish dijalankan lewat child_process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKRIP = path.join(ROOT, 'scripts', 'merge-results.js');
const { validasiSkema } = require('../scripts/validasi-skema');
const skemaV2 = require('../docs/design/results-v2.schema.json');
const skemaV3 = require('../docs/design/results-v3.schema.json');

const jalan = (...argv) => spawnSync(process.execPath, [SKRIP, ...argv], { encoding: 'utf8', cwd: ROOT });
const bacaJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const CODEQL_BEKU = { nama: 'codeql-beku.json', sha256_isi: 'a'.repeat(64), jumlah_alert: 2 };

// Dua alert dari perkakas berbeda yang menunjuk satu item ground truth: bentuk yang paling mudah
// salah dirakit, karena di skema 2 keduanya akan tampak berasal dari Sonar.
const ALERT = [
  {
    id: 'SONAR-01', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', sumber: 'issue',
    file: 'src/models/mahasiswaModel.js', baris: 59, cwe: ['CWE-89'], pesan: 'SQL Injection',
    severity: 'BLOCKER', sumber_sast: 'sonar', kembar_dengan: ['CQL-01'],
  },
  {
    id: 'CQL-01', rule: 'js/sql-injection', tipe: 'SECURITY', sumber: 'codeql',
    file: 'src/models/mahasiswaModel.js', baris: 59, cwe: ['CWE-89'], pesan: 'This query depends on a user-provided value.',
    severity: '9.8', sumber_sast: 'codeql', kembar_dengan: ['SONAR-01'],
  },
];

// Folder keluaran llm-scan: summary.json, run-N.json, sonar-alert.json. `sast` dan `codeql_beku`
// hanya ditulis llm-scan kalau bukan 'sonar', jadi folder satu perkakas memang tidak memuatnya.
const folderRun = ({ sast = null, alert = ALERT } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-v3-'));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    versi_prompt: sast ? 'v3' : 'v2',
    vendor: 'google',
    model_diminta: 'gemini-3.1-pro-preview',
    kondisi: 'utama',
    skenario: 'B',
    objek_uji: { commit: 'c'.repeat(40), branch: 'eksperimen/seeded', tree_src: 'd'.repeat(40) },
    // Dua perkakas maupun satu, laporan SAST selalu dibaca dari berkas beku di batch eksperimen;
    // skema mewajibkan medan ini, jadi folder uji pun harus memuatnya.
    sumber_sonar: 'beku',
    ...(sast ? { sast, codeql_beku: CODEQL_BEKU } : {}),
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'run-1.json'), JSON.stringify({
    deteksi: {},
    verifikasi: alert.map((a) => ({
      id_alert: a.id, putusan: 'true_positive', keyakinan: 'high', alasan: 'terbukti', tanda: [],
    })),
    temuan: [],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'sonar-alert.json'), JSON.stringify(alert, null, 2));
  return dir;
};

const merge = (dir, ...tambahan) => {
  const out = path.join(dir, 'hasil.json');
  const r = jalan('merge', '--v2', `--folder=${dir}`, '--run=1', '--nomor=1', `--out=${out}`, ...tambahan);
  return { r, out, hasil: r.status === 0 ? bacaJson(out) : null };
};

// ---------- 1. Run dua perkakas dirakit sebagai skema 3 ----------

test('merge folder dua perkakas menghasilkan skema 3 yang sah', () => {
  const { r, hasil } = merge(folderRun({ sast: 'keduanya' }));
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  assert.equal(hasil.schema_version, 3);
  assert.deepEqual(validasiSkema(skemaV3, hasil), [], 'hasil harus sah terhadap skema 3');
  assert.notEqual(validasiSkema(skemaV2, hasil).length, 0, 'skema 2 harus menolaknya');
  assert.match(r.stdout, /results v3: .*sast keduanya/);
});

test('asal tiap alert ikut ke berkas hasil, bukan hilang jadi sonar semua', () => {
  const { hasil } = merge(folderRun({ sast: 'keduanya' }));
  const perId = Object.fromEntries(hasil.alerts.map((a) => [a.id, a]));
  assert.equal(perId['SONAR-01'].sumber_sast, 'sonar');
  assert.equal(perId['CQL-01'].sumber_sast, 'codeql');
  assert.equal(perId['CQL-01'].severity_asal, 'codeql', 'severity alert CodeQL tidak boleh diklaim dari Sonar');
  assert.equal(perId['CQL-01'].severity, '9.8');
  // severity_sonar adalah nama medan skema 2 dan tidak boleh ikut terbawa.
  assert.ok(!('severity_sonar' in perId['CQL-01']), 'skema 3 memakai nama severity');
  // Kembar hanya metadata (keputusan K1): keduanya tetap alert tersendiri, tidak digabung.
  assert.deepEqual(perId['SONAR-01'].kembar_dengan, ['CQL-01']);
  assert.deepEqual(perId['CQL-01'].kembar_dengan, ['SONAR-01']);
  assert.equal(hasil.alerts.length, 2);
});

test('run menyimpan sumbu sast dan rujukan berkas CodeQL beku', () => {
  const { hasil } = merge(folderRun({ sast: 'keduanya' }));
  assert.equal(hasil.run.sast, 'keduanya');
  assert.deepEqual(hasil.run.codeql_beku, CODEQL_BEKU);
  // Rujukan berkas beku harus nama berkas saja, bukan path mesin (AGENTS.md batas keras nomor 10).
  assert.equal(hasil.run.codeql_beku.nama, path.basename(hasil.run.codeql_beku.nama));
});

test('sast=codeql saja juga dirakit sebagai skema 3', () => {
  const { r, hasil } = merge(folderRun({ sast: 'codeql', alert: [ALERT[1]] }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(hasil.schema_version, 3);
  assert.equal(hasil.run.sast, 'codeql');
  assert.deepEqual(validasiSkema(skemaV3, hasil), []);
});

test('nama berkas keluaran bawaan mengikuti skemanya', () => {
  const dir = folderRun({ sast: 'keduanya' });
  const r = jalan('merge', '--v2', `--folder=${dir}`, '--run=1', '--nomor=1');
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(bacaJson(path.join(ROOT, 'results-v3.json')).schema_version, 3);
  } finally {
    // Berkas bawaan ditulis di cwd; tidak boleh ditinggalkan di repo.
    fs.rmSync(path.join(ROOT, 'results-v3.json'), { force: true });
  }
});

// ---------- 2. Regresi: run satu perkakas tidak berubah sedikit pun ----------

test('folder satu perkakas tetap skema 2 dan tanpa medan baru apa pun', () => {
  const { r, hasil } = merge(folderRun({ alert: [ALERT[0]] }));
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  assert.equal(hasil.schema_version, 2);
  assert.deepEqual(validasiSkema(skemaV2, hasil), [], 'hasil harus sah terhadap skema 2');
  assert.ok(!('sast' in hasil.run), 'run satu perkakas tidak boleh punya medan sast');
  assert.ok(!('codeql_beku' in hasil.run));
  for (const a of hasil.alerts) {
    assert.ok(!('sumber_sast' in a), 'alert skema 2 tidak boleh punya sumber_sast');
    assert.ok(!('kembar_dengan' in a));
    assert.ok('severity_sonar' in a, 'skema 2 tetap memakai nama severity_sonar');
  }
  assert.match(r.stdout, /results v2: .*sast sonar/);
});

test('hasil satu perkakas identik dengan susunHasilV2 langsung', () => {
  // Penjaga kesepadanan: percabangan skema tidak boleh menggeser satu bita pun pada jalur lama,
  // karena angka yang sudah terbit dirakit oleh jalur itu.
  const dir = folderRun({ alert: [ALERT[0]] });
  const { hasil } = merge(dir);
  const { susunHasilV2 } = require('../scripts/llm/results-v2');
  const { parseCwe } = require('../scripts/merge-results');
  const langsung = susunHasilV2({
    summary: bacaJson(path.join(dir, 'summary.json')),
    run: bacaJson(path.join(dir, 'run-1.json')),
    alert: bacaJson(path.join(dir, 'sonar-alert.json')),
    nomor: 1, id: null, parseCwe, repo: null, eksperimen: null, potongan: null,
  });
  assert.deepEqual(hasil, langsung);
});

test('sast yang tidak dikenal di summary.json ditolak, bukan dirakit jadi berkas tidak sah', () => {
  // Ditemukan saat review diri: tanpa gerbang ini, satu salah tulis menghasilkan results.json yang
  // tidak sah terhadap skema mana pun, dan baru ketahuan saat penerbitan.
  const { r } = merge(folderRun({ sast: 'codeqI' })); // huruf I besar, bukan l
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sast "codeqI" yang tidak dikenal; yang ada: sonar, codeql, keduanya/);
});

// ---------- 3. Penerbitan: satu berkas index per skema ----------

const terbitkan = (hasil) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terbit-v3-'));
  const file = path.join(dir, 'hasil.json');
  fs.writeFileSync(file, JSON.stringify(hasil, null, 2));
  const keluar = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-v3-'));
  return { r: jalan('publish', `--results=${file}`, `--dir=${keluar}`), keluar };
};

test('hasil skema 3 terbit ke index-v3.json dan tidak menyentuh index.json', () => {
  const { hasil } = merge(folderRun({ sast: 'keduanya' }));
  const { r, keluar } = terbitkan(hasil);
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  assert.ok(fs.existsSync(path.join(keluar, 'index-v3.json')), 'index-v3.json harus dibuat');
  assert.ok(!fs.existsSync(path.join(keluar, 'index.json')), 'index.json milik skema 2, jangan disentuh');
  const index = bacaJson(path.join(keluar, 'index-v3.json'));
  assert.equal(index.schema_version, 3);
  assert.equal(index.runs.length, 1);
  assert.equal(index.runs[0].sast, 'keduanya');
  assert.deepEqual(index.runs[0].jumlah_alert_per_sast, { sonar: 1, codeql: 1 });
});

test('path terbit skema 3 diambil dari branch objek uji, bukan folder "undefined"', () => {
  // Skema 1 memakai run.branch, skema 2 dan 3 memakai run.objek_uji.branch. Memperlakukan skema 3
  // seperti skema 1 membuat pathBranch menerima undefined dan menulis ke folder bernama "undefined".
  const { hasil } = merge(folderRun({ sast: 'keduanya' }));
  const { keluar } = terbitkan(hasil);
  assert.ok(fs.existsSync(path.join(keluar, 'eksperimen', 'seeded', '1.json')), 'hasil harus ada di eksperimen/seeded/1.json');
  assert.ok(!fs.existsSync(path.join(keluar, 'undefined')), 'tidak boleh ada folder bernama undefined');
  assert.equal(bacaJson(path.join(keluar, 'eksperimen', 'seeded', '1.json')).schema_version, 3);
});

test('index-v3.json yang berisi skema lain menolak penerbitan, bukan menimpanya', () => {
  const { hasil } = merge(folderRun({ sast: 'keduanya' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terbit-campur-'));
  const file = path.join(dir, 'hasil.json');
  fs.writeFileSync(file, JSON.stringify(hasil, null, 2));
  const keluar = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-campur-'));
  fs.writeFileSync(path.join(keluar, 'index-v3.json'), JSON.stringify({ schema_version: 2, runs: [] }));
  const r = jalan('publish', `--results=${file}`, `--dir=${keluar}`);
  assert.notEqual(r.status, 0, 'entri skema lain tidak boleh terbuang');
  assert.match(r.stderr, /index-v3\.json berisi skema 2, bukan 3/);
});

test('hasil skema 2 tetap terbit ke index.json', () => {
  const { hasil } = merge(folderRun({ alert: [ALERT[0]] }));
  const { r, keluar } = terbitkan(hasil);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(keluar, 'index.json')), 'skema 2 tetap ke index.json');
  assert.ok(!fs.existsSync(path.join(keluar, 'index-v3.json')));
  assert.equal(bacaJson(path.join(keluar, 'index.json')).schema_version, 2);
});

// ---------- 4. Satu sumber kebenaran pemilih skema ----------

test('merge-results.js tidak lagi memaku susunHasilV2 sebagai satu-satunya perakit', () => {
  const src = fs.readFileSync(SKRIP, 'utf8');
  assert.equal(/susunHasilV3/.test(src), true, 'jalur dua perkakas harus memanggil susunHasilV3');
  assert.equal(/entriIndexV3/.test(src), true, 'entri index skema 3 harus dipakai');
  // Pemilihnya dari isi berkas, bukan dari flag --v2 di baris perintah.
  assert.equal(/summary\.sast/.test(src), true, 'skema diturunkan dari summary.json');
});
