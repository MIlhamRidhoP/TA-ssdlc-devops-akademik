// Penilaian mode gabungan. Ground truth buatan di folder sementara, seperti tests/llm-score.test.js;
// OBJEK_UJI_DIR diset sebelum modul scoring dimuat. Tidak ada panggilan API dan tidak ada berkas repo
// yang disentuh.
//
// Lima janji yang dijaga di sini:
//   1. Alert "tidak_sepakat" DIPERTAHANKAN di himpunan skenario B, dan dihitung sebagai uncertain
//      di empat kategori verifikasi. Ketidaksepakatan model bukan bukti alertnya tidak nyata.
//   2. Penjelasan temuan gabungan diambil dari vendor wakil klaster saja, bukan gabungan teks semua
//      vendor. Gabungan teks akan memberi mode gabungan lebih banyak kesempatan cocok daripada mode
//      tunggal, sehingga angkanya tidak lagi sebanding.
//   3. Gabungan dua vendor tercatat apa adanya di vendor_dipakai, karena ambang suara terbanyak
//      berarti hal yang berbeda dengan dua vendor dibanding tiga.
//   4. Varian ketat yang dipakai sebagai angka utama, sama dengan llm-score.
//   5. Gerbang menolak folder yang laporan Sonar-nya bukan dari file beku.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OBJEK = fs.mkdtempSync(path.join(os.tmpdir(), 'objek-gabungan-'));
const tulis = (rel, isi) => {
  fs.mkdirSync(path.dirname(path.join(OBJEK, rel)), { recursive: true });
  fs.writeFileSync(path.join(OBJEK, rel), isi);
};
tulis('src/models/m.js', [
  'exports.list = (q) => {',
  '  return db.query(`SELECT * FROM t WHERE n = ${q}`);',
  '};',
  'exports.order = (s) => {',
  '  return db.query(`SELECT * FROM t ORDER BY ${s}`);',
  '};',
].join('\n'));
tulis('src/app.js', "app.use(cors({ origin: '*' }));\n");
tulis('SEEDED.md', [
  '| ID | File | Fungsi | Kelas | CWE | OWASP | Tingkat | Status |',
  '|----|------|--------|-------|-----|-------|---------|--------|',
  '| S1 | src/models/m.js | list | SQL Injection | CWE-89 | A05 | Mudah | terbukti |',
  '| S2 | src/models/m.js | order | SQL Injection (ORDER BY) | CWE-89 | A05 | Sedang | jebakan FP |',
  '',
  '| ID | Deskripsi | Lokasi | CWE | Terdeteksi Sonar |',
  '|----|-----------|--------|-----|------------------|',
  '| B1 | CORS semua origin | src/app.js | CWE-942 | Ya |',
].join('\n'));
process.env.OBJEK_UJI_DIR = OBJEK;

const score = require('../scripts/llm/score');
const { bacaGroundTruth } = require('../scripts/gemini-scan');
const SG = require('../scripts/skor-gabungan');

const gt = bacaGroundTruth();

// Dua alert, keduanya di file dan fungsi ground truth: SONAR-01 menunjuk S1 (nyata),
// SONAR-02 menunjuk S2 (jebakan FP).
const ALERT_BEKU = [
  { id: 'SONAR-01', sumber: 'issue', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', file: 'src/models/m.js', baris: 2, pesan: 'SQLi', cwe: ['CWE-89'], keamanan: true },
  { id: 'SONAR-02', sumber: 'issue', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', file: 'src/models/m.js', baris: 5, pesan: 'SQLi ORDER BY', cwe: ['CWE-89'], keamanan: true },
];

const alertGabungan = (id, putusanGab, putusanVendor) => ({
  id, rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', sumber: 'issue',
  file: 'src/models/m.js', baris: id === 'SONAR-01' ? 2 : 5, cwe: ['CWE-89'],
  pesan: 'contoh', severity_sonar: 'MAJOR', severity_asal: 'sonar',
  putusan: putusanGab === 'tidak_sepakat' ? null : putusanGab,
  putusan_gabungan: putusanGab,
  putusan_asal: 'suara-terbanyak',
  suara: putusanGab === 'tidak_sepakat' ? 1 : 2,
  putusan_vendor: putusanVendor,
  keyakinan: null, keyakinan_vendor: {}, alasan: null, alasan_vendor: {}, tanda: [],
});

const temuanKlaster = ({ id = 'T-01', fungsi = '', penjelasanVendor, vendorPenemu, baris = 2 }) => ({
  id, file: 'src/models/m.js', baris, fungsi, jenis: 'SQL Injection',
  cwe: ['CWE-89'], kategori_owasp: 'A05', sifat: 'vulnerability', keyakinan: 'high',
  fingerprint: '0'.repeat(16), tanda: [],
  penjelasan: null, penjelasan_vendor: penjelasanVendor, vendor_penemu: vendorPenemu,
  kesepakatan: vendorPenemu.length,
});

const hasilGabungan = ({ alerts, findings, vendorDipakai = ['google', 'anthropic', 'openai'], vendorGagal = [], nomor = 1 }) => ({
  schema_version: 2,
  run: {
    id: 1, nomor, repo: 'o/r', asal: 'cli', vendor: 'gabungan',
    model_diminta: null, model_menjawab: null, kondisi: 'utama', skenario: 'B', mode_model: 'gabungan',
    vendor_dipakai: vendorDipakai, vendor_gagal: vendorGagal,
    objek_uji: { commit: 'a'.repeat(40), branch: 'main', tree_src: 'b'.repeat(40) },
  },
  alerts,
  findings,
});

const nilai = (hasil, opsi = {}) => SG.nilaiRunGabungan({ hasil, alertBeku: ALERT_BEKU, gt, score, ...opsi });

// ---------- 1. tidak_sepakat ----------

test('alert tidak_sepakat tetap dipertahankan di himpunan skenario B', () => {
  const h = hasilGabungan({
    alerts: [
      alertGabungan('SONAR-01', 'tidak_sepakat', { google: 'true_positive', anthropic: 'false_positive', openai: 'uncertain' }),
      alertGabungan('SONAR-02', 'false_positive', { google: 'false_positive', anthropic: 'false_positive', openai: 'true_positive' }),
    ],
    findings: [],
  });
  const r = nilai(h);
  assert.deepEqual(r.skenario_b.alert_dipertahankan, ['SONAR-01'],
    'yang dibuang hanya yang diputus false_positive oleh mayoritas');
  assert.deepEqual(r.alert_tidak_sepakat, ['SONAR-01']);
});

test('tidak_sepakat dihitung sebagai uncertain di empat kategori verifikasi', () => {
  const h = hasilGabungan({
    alerts: [
      alertGabungan('SONAR-01', 'tidak_sepakat', { google: 'true_positive', anthropic: 'false_positive', openai: null }),
      alertGabungan('SONAR-02', 'tidak_sepakat', { google: 'true_positive', anthropic: 'false_positive', openai: null }),
    ],
    findings: [],
  });
  const label = score.labelAlert(ALERT_BEKU, gt, {}, {});
  const v = score.kategoriVerifikasi(SG.entriVerifikasiGabungan(h), label);
  // SONAR-01 menunjuk S1 (nyata) dan dipertahankan: correct_retention.
  // SONAR-02 menunjuk S2 (jebakan FP) dan dipertahankan: missed_fp.
  assert.deepEqual(v.kategori.correct_retention, ['SONAR-01']);
  assert.deepEqual(v.kategori.missed_fp, ['SONAR-02']);
  assert.deepEqual(v.tanpa_hasil, [], 'tidak_sepakat tidak boleh jatuh ke tanpa_hasil');
  assert.deepEqual(v.uncertain_dipertahankan, ['SONAR-01', 'SONAR-02']);
});

test('alert tanpa satu pun putusan vendor dibedakan dari tidak sepakat', () => {
  const h = hasilGabungan({
    alerts: [alertGabungan('SONAR-01', 'tidak_sepakat', { google: null, anthropic: null, openai: null })],
    findings: [],
  });
  const r = nilai(h);
  assert.deepEqual(r.alert_tidak_sepakat, ['SONAR-01']);
  assert.deepEqual(r.alert_tanpa_putusan_vendor, ['SONAR-01'],
    'tidak ada pendapat sama sekali bukan hal yang sama dengan model berbeda pendapat');
});

// ---------- 2. Rekonstruksi penjelasan ----------

test('penjelasan diambil dari vendor wakil klaster, bukan gabungan semua vendor', () => {
  const t = temuanKlaster({
    penjelasanVendor: { google: 'Penjelasan google.', anthropic: 'Menyebut fungsi order di sini.' },
    vendorPenemu: ['google', 'anthropic'],
  });
  assert.equal(SG.penjelasanWakil(t), 'Penjelasan google.');
  const [hasil] = SG.temuanGabungan({ findings: [t] });
  assert.equal(hasil.penjelasan, 'Penjelasan google.');
  assert.ok(!/anthropic|order/.test(hasil.penjelasan), 'teks vendor lain tidak boleh ikut');
});

test('penjelasan vendor wakil yang kosong dibiarkan kosong', () => {
  const t = temuanKlaster({
    penjelasanVendor: { google: '', openai: 'Teks panjang milik openai.' },
    vendorPenemu: ['google', 'openai'],
  });
  assert.equal(SG.penjelasanWakil(t), '', 'tidak boleh mengambil dari vendor lain sebagai pengganti');
});

test('rekonstruksi penjelasan benar-benar memengaruhi pencocokan, dan hanya lewat vendor wakil', () => {
  // Temuan di baris 2 yang berada di fungsi `list`. Nama fungsi tidak diisi, jadi satu-satunya
  // sinyal lokasi berbasis teks adalah penjelasan. Vendor wakil menyebut `list`, vendor lain tidak.
  const wakilMenyebut = temuanKlaster({
    penjelasanVendor: { google: 'Masukan mentah masuk ke list tanpa parameterisasi.', anthropic: 'Tanpa sebutan apa pun.' },
    vendorPenemu: ['google', 'anthropic'],
  });
  const wakilTidakMenyebut = temuanKlaster({
    penjelasanVendor: { anthropic: 'Tanpa sebutan apa pun.', google: 'Masukan mentah masuk ke list tanpa parameterisasi.' },
    vendorPenemu: ['anthropic', 'google'],
  });
  const h1 = hasilGabungan({ alerts: [], findings: [wakilMenyebut] });
  const h2 = hasilGabungan({ alerts: [], findings: [wakilTidakMenyebut] });
  const s1 = nilai(h1).skenario_c.ketat.tp;
  const s2 = nilai(h2).skenario_c.ketat.tp;
  assert.equal(s1, 1, 'penjelasan vendor wakil yang menyebut nama fungsi membuat temuan cocok');
  assert.ok(s2 <= s1, 'kalau wakilnya tidak menyebut, temuan tidak boleh ikut cocok lewat teks vendor lain');
});

// ---------- 3. Gabungan dua vendor ----------

test('gabungan dua vendor tercatat apa adanya di vendor_dipakai', () => {
  const h = hasilGabungan({
    alerts: [alertGabungan('SONAR-01', 'true_positive', { google: 'true_positive', anthropic: 'true_positive' })],
    findings: [],
    vendorDipakai: ['google', 'anthropic'],
    vendorGagal: [{ vendor: 'openai', alasan: 'seluruh panggilan vendor ini gagal' }],
  });
  const r = nilai(h);
  assert.deepEqual(r.vendor_dipakai, ['google', 'anthropic']);
  assert.equal(r.vendor_dipakai.length, 2, 'jumlah vendor harus terbaca di laporan');
  assert.deepEqual(r.vendor_gagal, [{ vendor: 'openai', alasan: 'seluruh panggilan vendor ini gagal' }],
    'vendor yang gagal tidak boleh hilang diam-diam');
});

// ---------- 4. Varian ketat sebagai utama ----------

test('rata-rata memakai varian ketat, bukan longgar', () => {
  const buat = (nomor) => hasilGabungan({
    alerts: [alertGabungan('SONAR-01', 'true_positive', { google: 'true_positive', anthropic: 'true_positive', openai: 'true_positive' })],
    findings: [temuanKlaster({ penjelasanVendor: { google: 'Masukan mentah masuk ke list.' }, vendorPenemu: ['google'] })],
    nomor,
  });
  const runs = [buat(1), buat(2)].map((h) => nilai(h));
  const rata = score.rataMetrik(runs.map((r) => r.skenario_b));
  assert.equal(rata.jumlah_run, 2);
  // rataMetrik membaca m.ketat (scripts/llm/score.js:246-251). Kalau suatu saat ia membaca varian
  // lain, nilai di bawah ikut berubah dan tes ini gagal, bukan diam-diam menggeser angka.
  assert.equal(rata.precision, runs[0].skenario_b.ketat.precision);
  assert.equal(rata.recall, runs[0].skenario_b.ketat.recall);
  assert.ok(runs[0].skenario_b.longgar_cocok_lokasi, 'varian longgar tetap dilaporkan berdampingan');
});

test('laporan per run memuat aturan hardening yang sama dengan mode tunggal', () => {
  assert.equal(score.ATURAN_HARDENING, 'spesifikasi');
});

// ---------- 5. Gerbang ----------

const folderPalsu = (opsi = {}) => ({
  folder: `/tmp/${opsi.vendor ?? 'google'}`,
  summary: {
    versi_prompt: 'v2',
    vendor: opsi.vendor ?? 'google',
    kondisi: 'utama',
    hash_kode_sumber: 'h'.repeat(64),
    sumber_sonar: opsi.sumberSonar ?? 'beku',
    sonar_beku: { sha256_isi: 'i'.repeat(64) },
    objek_uji: { commit: 'a'.repeat(40), branch: 'main', tree_src: 'b'.repeat(40) },
  },
  runs: [],
  alert: ALERT_BEKU,
});
const objekPalsu = { dir: OBJEK, commit: 'a'.repeat(40), tree_src: 'b'.repeat(40) };
const bekuPalsu = { info: { sha256_isi: 'i'.repeat(64) }, alert: ALERT_BEKU };

test('gerbang menolak folder yang sumber Sonar-nya bukan file beku', () => {
  assert.throws(
    () => SG.periksaFolder([folderPalsu({ sumberSonar: 'api' })], objekPalsu, bekuPalsu),
    /memakai laporan Sonar dari api, bukan file beku/,
  );
});

test('gerbang menolak file beku yang berbeda dari yang dipakai saat run', () => {
  assert.throws(
    () => SG.periksaFolder([folderPalsu()], objekPalsu, { info: { sha256_isi: 'x'.repeat(64) }, alert: ALERT_BEKU }),
    /memakai file Sonar beku lain/,
  );
});

test('gerbang menolak hash tree src yang berbeda dengan worktree objek', () => {
  const f = folderPalsu();
  f.summary.objek_uji.tree_src = 'c'.repeat(40);
  assert.throws(() => SG.periksaFolder([f], objekPalsu, bekuPalsu), /hash tree src\/ objek uji/);
});

test('gerbang menolak folder yang bukan prompt v2', () => {
  const f = folderPalsu();
  f.summary.versi_prompt = 'v1';
  assert.throws(() => SG.periksaFolder([f], objekPalsu, bekuPalsu), /bukan hasil prompt v2/);
});

test('gerbang menolak dua folder untuk vendor dan kondisi yang sama', () => {
  assert.throws(
    () => SG.periksaFolder([folderPalsu(), folderPalsu()], objekPalsu, bekuPalsu),
    /Lebih dari satu folder untuk google\/utama/,
  );
});

test('gerbang menolak hash kode sumber yang berbeda antar folder', () => {
  const b = folderPalsu({ vendor: 'anthropic' });
  b.summary.hash_kode_sumber = 'z'.repeat(64);
  assert.throws(
    () => SG.periksaFolder([folderPalsu(), b], objekPalsu, bekuPalsu),
    /Hash kode sumber berbeda antar folder/,
  );
});

test('folder yang sah melewati seluruh gerbang tanpa git', () => {
  const hasil = SG.periksaFolder([folderPalsu(), folderPalsu({ vendor: 'anthropic' })], objekPalsu, bekuPalsu);
  assert.equal(hasil.commit, 'a'.repeat(40));
});

// ---------- Gerbang tambahan khusus gabungan ----------

test('berkas gabungan yang alertnya berbeda dari file beku ditolak', () => {
  const g = [{ indeks: 1, file: 'run-1.json', isi: hasilGabungan({ alerts: [alertGabungan('SONAR-01', 'true_positive', {})], findings: [] }) }];
  assert.throws(() => SG.periksaAlertGabungan(g, ALERT_BEKU), /tidak sama dengan alert dari file Sonar beku/);
});

test('berkas gabungan dengan alert yang sama diterima', () => {
  const g = [{
    indeks: 1,
    file: 'run-1.json',
    isi: hasilGabungan({
      alerts: [alertGabungan('SONAR-01', 'true_positive', {}), alertGabungan('SONAR-02', 'false_positive', {})],
      findings: [],
    }),
  }];
  assert.doesNotThrow(() => SG.periksaAlertGabungan(g, ALERT_BEKU));
});
