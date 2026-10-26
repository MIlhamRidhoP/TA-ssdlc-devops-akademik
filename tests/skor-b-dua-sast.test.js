// Penilai skenario B dan C untuk lengan dua perkakas SAST.
//
// Dua hal yang dijaga di sini, dan keduanya pernah menjadi cacat nyata di jalur lain:
//
//   1. scripts/llm-score.js:148 menolak setiap folder yang versi_prompt-nya bukan 'v2'. Berkas itu
//      terbeku, jadi penilai baru ini harus menerima v3 TANPA melonggarkan penolakan versi yang
//      memang tidak ada, dan daftar versinya harus datang dari render, bukan ditulis ulang.
//   2. Pemetaan K6 TIDAK berlaku untuk B dan C. Medan `tipe` hanya dipakai score.js di dalam
//      skenarioA, jadi menerapkan atau tidak menerapkan K6 harus menghasilkan angka B yang sama
//      persis. Kalau suatu saat tidak sama lagi, berarti ada yang menyentuh jalur itu.
//
// Lingkungannya sengaja hermetis: repo git sementara dengan SEEDED.md sendiri, berkas beku dibangun
// di tempat. Tidak ada yang bergantung pada worktree di mesin tertentu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKRIP = path.join(ROOT, 'scripts', 'sast', 'skor-b-dua-sast.js');
const penilai = require('../scripts/sast/skor-b-dua-sast');

const bacaJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Ground truth kecil dengan bentuk kolom yang sama dengan SEEDED.md asli: S butuh 8 sel, B butuh 5.
const SEEDED = `# Ground Truth Kerentanan Tertanam

| ID | File | Fungsi | Kelas | CWE | OWASP | Tingkat | Status |
|----|------|--------|-------|-----|-------|---------|--------|
| S1 | src/a.js | listFrom | SQL Injection | CWE-89 | A05 | Mudah | terbukti |
| S2 | src/a.js | cariNama | SQL Injection | CWE-89 | A05 | Sedang | jebakan FP |

## Temuan bawaan

| ID | Deskripsi | Lokasi | CWE | Terdeteksi Sonar |
|----|-----------|--------|-----|------------------|
| B1 | CORS mengizinkan semua origin | src/a.js | CWE-942 | Ya |
`;

const SUMBER = `const listFrom = (t) => pool.query(\`SELECT * FROM \${t}\`);
const cariNama = (n) => pool.query('SELECT 1 WHERE nama = $1', [n]);
module.exports = { listFrom, cariNama };
`;

// Urutan yang DIHARAPKAN dari gabungAlert: seluruh alert Sonar lebih dulu, baru CodeQL. Ditulis
// eksplisit, bukan dihitung ulang dengan memanggil penggabungnya, supaya urutannya ikut teruji.
const URUTAN_ALERT = [
  { id: 'SONAR-01', sumber_sast: 'sonar', file: 'src/a.js', baris: 1 },
  { id: 'SONAR-02', sumber_sast: 'sonar', file: 'src/a.js', baris: 2 },
  { id: 'CQL-01', sumber_sast: 'codeql', file: 'src/a.js', baris: 1 },
  { id: 'CQL-02', sumber_sast: 'codeql', file: 'src/a.js', baris: 2 },
];

const lingkungan = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skor-b-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), SUMBER);
  fs.writeFileSync(path.join(dir, 'SEEDED.md'), SEEDED);
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t',
    '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  g('add', '.');
  g('commit', '-q', '-m', 'awal');
  const objek = { dir, commit: g('rev-parse', 'HEAD'), tree_src: g('rev-parse', 'HEAD:src') };

  // Berkas beku dibangun lewat modulnya sendiri, bukan dikarang sebagai JSON mentah, supaya gerbang
  // hash isi dan gerbang tree_src betul-betul dilalui seperti saat batch berjalan.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beku-b-'));
  const bekuSonar = require('../scripts/llm/sonar-beku');
  const fileSonar = path.join(tmp, 'sonar-beku.json');
  bekuSonar.tulisBeku(fileSonar, bekuSonar.buatIsiBeku({
    laporan: {
      project: 'p', branch: 'main', analisis: { tanggal: '2026-10-19T00:00:00+0000', revisi: objek.commit }, galat: [],
      issues: [1, 2].map((n) => ({
        rule: 'jssecurity:S3649', severity: 'BLOCKER', type: 'VULNERABILITY',
        component: 'p:src/a.js', line: n, message: `SQLi ${n}`, impacts: [],
      })),
      hotspots: [],
      cwe_rule: { 'jssecurity:S3649': ['CWE-89'] },
    },
    treeSrcAnalisis: objek.tree_src,
    dibuat: '2026-10-19T00:00:00.000Z',
  }));

  const bekuCodeql = require('../scripts/sast/codeql-beku');
  const fileCodeql = path.join(tmp, 'codeql-beku.json');
  bekuCodeql.tulisBeku(fileCodeql, bekuCodeql.buatIsiBeku({
    alert: [1, 2].map((n) => ({
      id: `CQL-0${n}`, rule: 'js/sql-injection', tipe: 'SECURITY', sumber: 'codeql',
      file: 'src/a.js', baris: n, cwe: ['CWE-89'], pesan: `This query depends on a user-provided value (${n}).`,
      severity_codeql: '9.8', severity_asal: 'codeql',
    })),
    sarif: [{ nama: 'hasil-extended.sarif', suite: 'extended', sha256: 'a'.repeat(64), jumlah_result: 2 }],
    lingkungan: { codeql: 'uji' },
    treeSrc: objek.tree_src,
    saringan: null,
    gerbangSanity: null,
    dibuat: '2026-10-26T00:00:00.000Z',
  }));

  return { objek, fileSonar, fileCodeql };
};

// Folder keluaran llm-scan buatan: summary.json, run-1.json, sonar-alert.json.
const folderRun = ({
  objek, versiPrompt = 'v3', sast = 'keduanya', vendor = 'google', kondisi = 'utama',
  alert = URUTAN_ALERT, putusan = {}, hashKode = 'e'.repeat(64),
} = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-b-'));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    versi_prompt: versiPrompt, vendor, model_diminta: 'gemini-3.1-pro-preview', kondisi, skenario: 'B',
    objek_uji: { commit: objek.commit, branch: 'eksperimen/seeded', tree_src: objek.tree_src },
    sumber_sonar: 'beku', hash_kode_sumber: hashKode,
    ...(sast === 'sonar' ? {} : { sast }),
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'run-1.json'), JSON.stringify({
    run: 1,
    parse_ok: true,
    // Blok `deteksi` wajib ada: score.hitungStatusPanggilan membaca r.deteksi.tugas untuk setiap run.
    // Bentuk medannya diambil dari run-1.json nyata batch 22 Okt, dipangkas ke yang benar-benar dibaca.
    deteksi: { tugas: 'deteksi', status: 'ok', parse_ok: true },
    temuan: [{ file: 'src/a.js', baris: 1, jenis: 'SQL Injection', cwe: 'CWE-89', sifat: null }],
    verifikasi: alert.map((a) => ({
      id_alert: a.id,
      putusan: putusan[a.id] ?? 'true_positive',
      keyakinan: 'high',
      alasan: 'terbukti',
      tanda: [],
      metadata: { tugas: 'verifikasi', status: 'ok', parse_ok: true },
    })),
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'sonar-alert.json'), JSON.stringify(alert, null, 2));
  return dir;
};

const nilai = (lg, folder, ...tambahan) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'out-b-')), 'skor.json');
  const r = spawnSync(process.execPath, [SKRIP, ...[].concat(folder),
    `--objek=${lg.objek.dir}`, `--sonar-beku=${lg.fileSonar}`, `--codeql-beku=${lg.fileCodeql}`,
    `--out=${out}`, ...tambahan], { encoding: 'utf8', cwd: ROOT });
  return { r, out, laporan: r.status === 0 ? bacaJson(out) : null };
};

// ---------- 1. Jalur utama: prompt v3 diterima dan dinilai ----------

test('folder prompt v3 dua perkakas dinilai sampai selesai', () => {
  const lg = lingkungan();
  const { r, laporan } = nilai(lg, folderRun({ objek: lg.objek }));
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  assert.equal(laporan.jumlah_alert, 4);
  assert.deepEqual(laporan.jumlah_alert_per_perkakas, { sonar: 2, codeql: 2 });
  assert.equal(laporan.per_model.length, 1);
  const m = laporan.per_model[0];
  assert.equal(m.versi_prompt, 'v3');
  assert.equal(m.sast, 'keduanya');
  for (const s of ['skenario_a', 'skenario_b', 'skenario_c']) {
    assert.equal(typeof m.rata_rata[s].f1, 'number', `${s} harus punya F1`);
  }
  assert.match(r.stdout, /sast keduanya: A P .* \| B P .* \| C P /);
});

test('rincian per perkakas terbawa ke laporan, bukan hanya angka gabungan', () => {
  const lg = lingkungan();
  // Model membuang satu alert Sonar dan satu alert CodeQL sebagai false positive.
  const folder = folderRun({ objek: lg.objek, putusan: { 'SONAR-02': 'false_positive', 'CQL-02': 'false_positive' } });
  const { r, laporan } = nilai(lg, folder);
  assert.equal(r.status, 0, r.stderr);
  const per = laporan.per_model[0].per_perkakas;
  assert.deepEqual(per.jumlah_alert, { sonar: 2, codeql: 2 });
  // Yang dipertahankan: satu dari tiap perkakas.
  assert.deepEqual(per.dipertahankan_per_run, [{ run: 1, sonar: 1, codeql: 1 }]);
  // Kategori verifikasi juga dipecah per perkakas, dan jumlah seluruh kategorinya tidak boleh nol:
  // kalau nol, label alert tidak terbentuk dan rinciannya tidak bermakna.
  const k = per.kategori_verifikasi_per_run[0];
  const total = ['identified_fp', 'missed_fp', 'misidentified_fp', 'correct_retention']
    .reduce((n, nama) => n + Object.values(k[nama]).reduce((x, y) => x + y, 0), 0);
  assert.ok(total > 0, 'kategori verifikasi per perkakas tidak boleh kosong semua');
});

// Dijalankan di PROSES TERPISAH, dan itu bukan pilihan gaya: SEEDED_FILE di gemini-scan.js dihitung
// saat modul dimuat dari OBJEK_UJI_DIR, sehingga menyetel variabel itu di tengah berkas tes tidak
// berpengaruh lagi kalau modulnya sudah pernah dimuat tes lain di berkas yang sama.
const CEK_K6 = `
const path = require('path');
const score = require(process.env.REPO + '/scripts/llm/score');
const { bacaGroundTruth } = require(process.env.REPO + '/scripts/gemini-scan');
const { petakanK6 } = require(process.env.REPO + '/scripts/sast/skor-dua-sast');
const sumbu = require(process.env.REPO + '/scripts/sast/sumbu-sast');
const alert = sumbu.gabungAlert({
  sonar: [1, 2].map((n) => ({
    id: 'SONAR-0' + n, sumber: 'issue', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY',
    file: 'src/a.js', baris: n, cwe: ['CWE-89'], pesan: 'SQLi', keamanan: true,
  })),
  codeql: [1, 2].map((n) => ({
    id: 'CQL-0' + n, sumber: 'codeql', rule: 'js/sql-injection', tipe: 'SECURITY',
    file: 'src/a.js', baris: n, cwe: ['CWE-89'], pesan: 'SQLi', keamanan: true,
  })),
});
const gt = bacaGroundTruth();
const label = score.labelAlert(alert, gt, {}, {});
const run = {
  run: 1, parse_ok: true,
  deteksi: { tugas: 'deteksi', status: 'ok', parse_ok: true },
  temuan: [{ file: 'src/a.js', baris: 1, jenis: 'SQL Injection', cwe: 'CWE-89', sifat: null }],
  verifikasi: alert.map((a) => ({
    id_alert: a.id, putusan: 'true_positive', keyakinan: 'high', alasan: 'x', tanda: [],
    metadata: { tugas: 'verifikasi', status: 'ok', parse_ok: true },
  })),
};
const tanpa = score.skorRunUtama({ run, alert, gt, label });
const dengan = score.skorRunUtama({ run, alert: petakanK6(alert), gt, label });
console.log(JSON.stringify({
  b_sama: JSON.stringify(dengan.skenario_b) === JSON.stringify(tanpa.skenario_b),
  c_sama: JSON.stringify(dengan.skenario_c) === JSON.stringify(tanpa.skenario_c),
  a_dengan: score.skenarioA(petakanK6(alert), gt).a_hanya_vulnerability.alert,
  a_tanpa: score.skenarioA(alert, gt).a_hanya_vulnerability.alert,
}));
`;

test('pemetaan K6 tidak menggeser angka skenario B maupun C', () => {
  // Klaim yang dicatat di kepala skor-b-dua-sast.js, dinyatakan sebagai angka: medan `tipe` hanya
  // dipakai score.js di dalam skenarioA, jadi B dan C harus identik dengan atau tanpa pemetaan.
  const lg = lingkungan();
  const skrip = path.join(lg.objek.dir, '..', `cek-k6-${process.pid}.js`);
  fs.writeFileSync(skrip, CEK_K6);
  const r = spawnSync(process.execPath, [skrip], {
    encoding: 'utf8',
    env: { ...process.env, OBJEK_UJI_DIR: lg.objek.dir, REPO: ROOT.split(path.sep).join('/') },
  });
  assert.equal(r.status, 0, `stderr:\n${r.stderr}`);
  const h = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(h.b_sama, true, 'skenario B tidak boleh terpengaruh K6');
  assert.equal(h.c_sama, true, 'skenario C tidak boleh terpengaruh K6');
  // Sedangkan skenario A memang terpengaruh; itu sebabnya K6 ada. Pada himpunan GABUNGAN, varian
  // a_hanya_vulnerability tanpa pemetaan menyisakan alert Sonar saja — bukan kosong — karena alert
  // Sonar memang bertipe VULNERABILITY. Yang hilang tanpa suara adalah seluruh alert CodeQL.
  assert.deepEqual(h.a_tanpa, ['SONAR-01', 'SONAR-02'], 'tanpa K6, hanya alert Sonar yang tersisa');
  assert.deepEqual(h.a_dengan, ['SONAR-01', 'SONAR-02', 'CQL-01', 'CQL-02'], 'dengan K6, keempatnya ikut');
});

test('laporan mencatat bahwa K6 hanya berlaku untuk skenario A', () => {
  const lg = lingkungan();
  const { laporan } = nilai(lg, folderRun({ objek: lg.objek }));
  assert.equal(laporan.pemetaan_k6.keputusan, 'K6');
  assert.match(laporan.pemetaan_k6.berlaku_di_berkas_ini, /skenario A saja/);
});

test('dua vendor dinilai dalam satu laporan', () => {
  const lg = lingkungan();
  const a = folderRun({ objek: lg.objek, vendor: 'google' });
  const b = folderRun({ objek: lg.objek, vendor: 'openai' });
  const { r, laporan } = nilai(lg, [a, b]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(laporan.per_model.map((m) => m.vendor), ['google', 'openai']);
});

// ---------- 2. Gerbang: yang harus ditolak ----------

test('versi prompt yang tidak ada ditolak dengan daftar versi yang tersedia', () => {
  const lg = lingkungan();
  const { r } = nilai(lg, folderRun({ objek: lg.objek, versiPrompt: 'v9' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /versi_prompt "v9" tidak dikenal; yang ada: v2, v3/);
});

test('dua perkakas dengan prompt v2 ditolak oleh penjaga yang sama dengan jalur pemindaian', () => {
  const lg = lingkungan();
  const { r } = nilai(lg, folderRun({ objek: lg.objek, versiPrompt: 'v2' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tidak boleh dipakai dengan --prompt=v2/);
});

test('sast yang tidak dikenal ditolak', () => {
  const lg = lingkungan();
  const { r } = nilai(lg, folderRun({ objek: lg.objek, sast: 'codeqI' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sast "codeqI" tidak dikenal/);
});

test('sonar-alert.json yang tidak sama dengan berkas beku ditolak', () => {
  // Gerbang terpenting di berkas ini: kalau berkas beku yang diberikan bukan yang dipakai saat
  // memindai, penilaiannya mengukur himpunan alert yang berbeda dari yang dikirim ke model.
  const lg = lingkungan();
  const alertGeser = URUTAN_ALERT.map((a) => (a.id === 'CQL-02' ? { ...a, baris: 99 } : a));
  const { r } = nilai(lg, folderRun({ objek: lg.objek, alert: alertGeser }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sonar-alert\.json tidak sama dengan alert yang dibangun ulang dari berkas beku/);
});

test('urutan alert di folder harus Sonar lebih dulu, baru CodeQL', () => {
  const lg = lingkungan();
  const terbalik = [...URUTAN_ALERT].reverse();
  const { r } = nilai(lg, folderRun({ objek: lg.objek, alert: terbalik }));
  assert.notEqual(r.status, 0, 'urutan berbeda berarti himpunan yang dikirim ke model bukan yang ini');
  assert.match(r.stderr, /tidak sama dengan alert yang dibangun ulang/);
});

test('tree src yang berbeda dengan objek uji sekarang ditolak', () => {
  const lg = lingkungan();
  const folder = folderRun({ objek: { ...lg.objek, tree_src: 'f'.repeat(40) } });
  const { r } = nilai(lg, folder);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tree src\/ saat memindai .* berbeda dengan objek uji sekarang/);
});

test('worktree objek uji yang tidak bersih ditolak', () => {
  const lg = lingkungan();
  const folder = folderRun({ objek: lg.objek });
  fs.writeFileSync(path.join(lg.objek.dir, 'src', 'baru.js'), '// belum di-commit\n');
  const { r } = nilai(lg, folder);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Worktree objek uji tidak bersih/);
});

test('folder yang menilai kode sumber berbeda tidak boleh digabung', () => {
  const lg = lingkungan();
  const a = folderRun({ objek: lg.objek, vendor: 'google' });
  const b = folderRun({ objek: lg.objek, vendor: 'openai', hashKode: '9'.repeat(64) });
  const { r } = nilai(lg, [a, b]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Hash kode sumber berbeda antar folder/);
});

test('folder ganda untuk satu vendor dan kondisi ditolak', () => {
  const lg = lingkungan();
  const a = folderRun({ objek: lg.objek, vendor: 'google' });
  const b = folderRun({ objek: lg.objek, vendor: 'google' });
  const { r } = nilai(lg, [a, b]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Lebih dari satu folder untuk google\/utama/);
});

test('tanpa folder sama sekali ditolak', () => {
  const lg = lingkungan();
  const { r } = nilai(lg, []);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Sebutkan minimal satu folder/);
});

// ---------- 3. Fungsi bantu ----------

test('perPerkakas menghitung per asal dan menandai id yang tidak dikenal', () => {
  const asal = new Map([['SONAR-01', 'sonar'], ['CQL-01', 'codeql']]);
  assert.deepEqual(penilai.perPerkakas(['SONAR-01', 'CQL-01', 'CQL-01'], asal), { sonar: 1, codeql: 2 });
  assert.deepEqual(penilai.perPerkakas([], asal), {}, 'himpunan kosong menghasilkan objek kosong');
  // Id di luar himpunan alert tidak boleh dihitung sebagai milik salah satu perkakas.
  assert.deepEqual(penilai.perPerkakas(['XX-01'], asal), { tidak_dikenal: 1 });
});

test('sidikAlert memasukkan perkakas asal, bukan hanya id dan lokasi', () => {
  const satu = penilai.sidikAlert([{ id: 'A-01', sumber_sast: 'sonar', file: 'src/a.js', baris: 1 }]);
  const dua = penilai.sidikAlert([{ id: 'A-01', sumber_sast: 'codeql', file: 'src/a.js', baris: 1 }]);
  assert.notEqual(satu, dua, 'alert dengan asal berbeda tidak boleh bersidik sama');
  // Alert tanpa medan sumber_sast dianggap sonar, mengikuti bawaan sumbu.
  assert.equal(penilai.sidikAlert([{ id: 'A-01', file: 'src/a.js', baris: 1 }]), satu);
});

test('kategoriPerPerkakas tahan terhadap verifikasi tanpa kategori', () => {
  const asal = new Map([['SONAR-01', 'sonar']]);
  const kosong = penilai.kategoriPerPerkakas({}, asal);
  assert.deepEqual(Object.keys(kosong).sort(),
    ['correct_retention', 'identified_fp', 'misidentified_fp', 'missed_fp']);
  for (const v of Object.values(kosong)) assert.deepEqual(v, {});
});

// ---------- 4. Lengan kontrol (sast=sonar) dinilai bersama lengan uji ----------
// Satu batch nyata menghasilkan dua jenis folder untuk tiap vendor: lengan uji (dua perkakas, 23
// alert) dan lengan kontrol (Sonar saja, 5 alert). Penilai ini semula membandingkan SEMUA folder
// dengan himpunan dua perkakas dan memakai vendor/kondisi sebagai kunci, jadi lengan kontrol ditolak
// dan dua lengan satu vendor dianggap folder ganda. Tak satu pun tes memakai folder kontrol.

// Alert lengan kontrol persis seperti yang ditulis llm-scan untuk sast=sonar: tanpa sumber_sast,
// karena jalur itu tidak pernah melewati penggabung.
const SONAR_SAJA = URUTAN_ALERT.filter((a) => a.sumber_sast === 'sonar').map(({ sumber_sast: _, ...a }) => a);

test('lengan kontrol (Sonar saja, prompt v3) dinilai terhadap himpunannya sendiri', () => {
  const lg = lingkungan();
  const { r, laporan } = nilai(lg, folderRun({ objek: lg.objek, sast: 'sonar', alert: SONAR_SAJA }));
  assert.equal(r.status, 0, `lengan kontrol harus dapat dinilai; stderr:\n${r.stderr}`);
  const m = laporan.per_model[0];
  assert.equal(m.sast, 'sonar');
  assert.equal(m.versi_prompt, 'v3');
  assert.equal(m.jumlah_alert, 2, 'lengan kontrol hanya menerima alert Sonar');
  assert.deepEqual(m.per_perkakas.jumlah_alert, { sonar: 2 });
  // Alert CodeQL tidak pernah dikirim ke lengan ini, jadi tidak boleh ikut "dipertahankan".
  assert.deepEqual(m.per_perkakas.dipertahankan_per_run, [{ run: 1, sonar: 2 }]);
  assert.equal(Object.keys(m.label_alert).length, 2);
});

test('lengan uji dan lengan kontrol satu vendor dinilai dalam satu laporan', () => {
  const lg = lingkungan();
  const uji = folderRun({ objek: lg.objek, sast: 'keduanya' });
  const kontrol = folderRun({ objek: lg.objek, sast: 'sonar', alert: SONAR_SAJA });
  const { r, laporan } = nilai(lg, [uji, kontrol]);
  assert.equal(r.status, 0, `dua lengan satu vendor adalah rancangan batch, bukan folder ganda; stderr:\n${r.stderr}`);
  assert.deepEqual(laporan.per_model.map((m) => [m.vendor, m.sast, m.jumlah_alert]),
    [['google', 'keduanya', 4], ['google', 'sonar', 2]]);
  // Ringkasan atas tetap himpunan penuh sebagai rujukan.
  assert.equal(laporan.jumlah_alert, 4);
});

test('lengan kontrol yang membawa himpunan dua perkakas ditolak', () => {
  // Kebalikan dari tes di atas: folder yang mengaku Sonar saja tetapi memuat alert CodeQL berarti
  // berkas yang dinilai bukan yang dikirim ke model.
  const lg = lingkungan();
  const { r } = nilai(lg, folderRun({ objek: lg.objek, sast: 'sonar', alert: URUTAN_ALERT }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tidak sama dengan alert yang dibangun ulang/);
});

test('dua folder dengan vendor, kondisi, dan sumbu sast yang sama tetap ditolak', () => {
  const lg = lingkungan();
  const a = folderRun({ objek: lg.objek, sast: 'sonar', alert: SONAR_SAJA });
  const b = folderRun({ objek: lg.objek, sast: 'sonar', alert: SONAR_SAJA });
  const { r } = nilai(lg, [a, b]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Lebih dari satu folder untuk google\/utama\/sonar/);
});

test('alertUntuk meniru llm-scan untuk ketiga nilai sumbu sast', () => {
  const sumbu = require('../scripts/sast/sumbu-sast');
  const sonar = [{ id: 'SONAR-01', file: 'src/a.js', baris: 1 }, { id: 'SONAR-02', file: 'src/a.js', baris: 2 }];
  const codeql = [{ id: 'CQL-01', file: 'src/a.js', baris: 1 }];
  const sumber = { alertSonar: sonar, alertCodeql: codeql, gabungAlert: sumbu.gabungAlert, perkakasUntuk: sumbu.perkakasUntuk };
  const id = (sast) => penilai.alertUntuk(sast, sumber).map((a) => a.id);
  assert.deepEqual(id('sonar'), ['SONAR-01', 'SONAR-02']);
  assert.deepEqual(id('codeql'), ['CQL-01']);
  assert.deepEqual(id('keduanya'), ['SONAR-01', 'SONAR-02', 'CQL-01'], 'Sonar lebih dulu, lalu CodeQL');
  // sast=sonar tidak pernah melewati penggabung di llm-scan, jadi alertnya tidak membawa sumber_sast.
  assert.ok(penilai.alertUntuk('sonar', sumber).every((a) => !('sumber_sast' in a)));
  assert.ok(penilai.alertUntuk('keduanya', sumber).every((a) => 'sumber_sast' in a));
});
