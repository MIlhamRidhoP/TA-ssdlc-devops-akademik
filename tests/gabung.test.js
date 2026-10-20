// Penggabung mode B gabungan. Seluruh hasil vendor adalah data tiruan: tes ini tidak pernah
// menyentuh API berbayar.
//
// Dua janji yang dijaga paling ketat:
//   1. Ketidaksepakatan model BUKAN bukti alert tidak nyata. Alert yang tidak meraih dua suara
//      dipertahankan dan ditandai, tidak pernah diperlakukan sebagai false positive.
//   2. Vendor yang gagal tidak menjatuhkan penggabungan, tetapi juga tidak hilang diam-diam.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const G = require('../scripts/llm/gabung');
const { validasiSkema } = require('../scripts/validasi-skema');
const skemaV2 = require('../docs/design/results-v2.schema.json');

const SHA = 'a'.repeat(40);
const alert = (id, putusan, { keyakinan = 'high', alasan = 'contoh', cwe = ['CWE-89'], file = 'src/a.js', baris = 10 } = {}) => ({
  id, rule: 'javascript:S3649', tipe: 'VULNERABILITY', sumber: 'issue', file, baris, cwe,
  pesan: 'contoh', severity_sonar: 'MAJOR', severity_asal: 'sonar',
  putusan, putusan_asal: putusan ? 'verifikasi-model' : null,
  keyakinan: putusan ? keyakinan : null, alasan: putusan ? alasan : null, tanda: [],
});
const temuan = (id, { file = 'src/a.js', baris = 10, fungsi = 'cari', cwe = ['CWE-89'], jenis = 'SQL Injection', penjelasan = 'contoh', sifat = 'vulnerability' } = {}) => ({
  id, file, baris, fungsi, jenis, cwe, kategori_owasp: 'A03', penjelasan, sifat,
  keyakinan: 'high', fingerprint: '0'.repeat(16), tanda: [], potongan_kode: null,
});
const hasilVendor = (vendor, { alerts = [], findings = [], biaya = 0.1, ok = 3, total = 3 } = {}) => ({
  schema_version: 2,
  run: {
    id: 1, nomor: 1, repo: 'o/r', asal: 'cli', vendor,
    model_diminta: `${vendor}-model`, model_menjawab: `${vendor}-model`, kondisi: 'utama',
    mulai: '2026-10-20T10:00:00.000Z', selesai: '2026-10-20T10:05:00.000Z', durasi_detik: 300,
    objek_uji: { commit: SHA, branch: 'feat/x', tree_src: 'b'.repeat(40) },
    commit_kode: { head: SHA, bersih: true },
    hash_prompt: { system: 'c'.repeat(64), user_deteksi: 'd'.repeat(64) },
    sumber_sonar: 'api',
    analisis_sonar: { tanggal: null, revisi: null, tree_src: null },
    sonar_beku: null, biaya_usd: biaya,
    status_panggilan: { total, ok, refusal: 0, truncated: 0, error: total - ok, parse_gagal: 0 },
    pipeline: null,
  },
  alerts, findings,
});

const tigaVendor = (per) => ['google', 'anthropic', 'openai'].map((v) => ({ vendor: v, hasil: hasilVendor(v, per[v]) }));

test('tiga vendor sukses: suara bulat, kesepakatan 3, biaya dijumlahkan', () => {
  const h = G.gabungkan(tigaVendor({
    google: { alerts: [alert('SONAR-01', 'true_positive')], findings: [temuan('T-01')], biaya: 0.5 },
    anthropic: { alerts: [alert('SONAR-01', 'true_positive')], findings: [temuan('T-01')], biaya: 0.3 },
    openai: { alerts: [alert('SONAR-01', 'true_positive')], findings: [temuan('T-01')], biaya: 0.2 },
  }), { nomor: 77, id: 999, repo: 'o/r' });

  assert.equal(h.run.skenario, 'B');
  assert.equal(h.run.mode_model, 'gabungan');
  assert.equal(h.run.vendor, 'gabungan');
  assert.deepEqual(h.run.vendor_dipakai, ['google', 'anthropic', 'openai']);
  assert.deepEqual(h.run.vendor_gagal, []);
  assert.equal(h.run.biaya_usd, 1);
  assert.equal(h.run.status_panggilan.total, 9);
  assert.equal(h.run.status_panggilan.ok, 9);
  assert.equal(Object.keys(h.run.per_vendor).length, 3);
  assert.equal(h.run.per_vendor.google.biaya_usd, 0.5);

  assert.equal(h.alerts[0].putusan_gabungan, 'true_positive');
  assert.equal(h.alerts[0].putusan, 'true_positive');
  assert.equal(h.alerts[0].suara, 3);
  assert.equal(h.alerts[0].putusan_asal, 'suara-terbanyak');
  assert.deepEqual(Object.keys(h.alerts[0].putusan_vendor).sort(), ['anthropic', 'google', 'openai']);

  assert.equal(h.findings.length, 1, 'temuan yang sama dari tiga vendor menjadi satu');
  assert.equal(h.findings[0].kesepakatan, 3);
  assert.deepEqual(h.findings[0].vendor_penemu, ['google', 'anthropic', 'openai']);
  assert.equal(Object.keys(h.findings[0].penjelasan_vendor).length, 3);
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('satu vendor gagal: penggabungan jalan dengan sisanya, kegagalan tercatat', () => {
  const h = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { alerts: [alert('SONAR-01', 'false_positive')], findings: [temuan('T-01')] }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { alerts: [alert('SONAR-01', 'false_positive')], findings: [temuan('T-01')] }) },
    { vendor: 'openai', alasan: 'hasil vendor ini tidak ditemukan di artifact' },
  ], {});
  assert.deepEqual(h.run.vendor_dipakai, ['google', 'anthropic']);
  assert.equal(h.run.vendor_gagal.length, 1);
  assert.equal(h.run.vendor_gagal[0].vendor, 'openai');
  assert.match(h.run.vendor_gagal[0].alasan, /tidak ditemukan/);
  assert.equal(h.run.per_vendor.openai.gagal, true);
  // Dua suara sama sudah memenuhi ambang, meski vendor ketiga tidak ikut.
  assert.equal(h.alerts[0].putusan_gabungan, 'false_positive');
  assert.equal(h.alerts[0].suara, 2);
  // putusan_vendor hanya memuat vendor yang IKUT. Vendor yang gagal tidak punya putusan sama
  // sekali dan tercatat di run.vendor_gagal; null di dalam putusan_vendor berarti hal lain, yaitu
  // vendor ikut tetapi tidak memberi putusan yang sah.
  assert.ok(!('openai' in h.alerts[0].putusan_vendor), 'vendor gagal tidak boleh muncul sebagai putusan null');
  assert.deepEqual(Object.keys(h.alerts[0].putusan_vendor).sort(), ['anthropic', 'google']);
  assert.equal(h.findings[0].kesepakatan, 2);
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('dua vendor gagal: sisa satu tetap digabung, tetapi tidak pernah meraih dua suara', () => {
  const h = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { alerts: [alert('SONAR-01', 'true_positive')], findings: [temuan('T-01')] }) },
    { vendor: 'anthropic', alasan: 'hasil vendor ini tidak ditemukan di artifact' },
    { vendor: 'openai', alasan: 'seluruh panggilan vendor ini gagal' },
  ], {});
  assert.deepEqual(h.run.vendor_dipakai, ['google']);
  assert.equal(h.run.vendor_gagal.length, 2);
  // Satu suara tidak cukup: alert dipertahankan, bukan dianggap sudah diputuskan.
  assert.equal(h.alerts[0].putusan_gabungan, 'tidak_sepakat');
  assert.equal(h.alerts[0].putusan, null, 'tidak_sepakat tidak boleh menjadi putusan biasa');
  assert.equal(h.findings[0].kesepakatan, 1);
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('semua vendor gagal: penggabungan berhenti dengan sebab yang jelas', () => {
  assert.throws(() => G.gabungkan([
    { vendor: 'google', alasan: 'tidak ditemukan' },
    { vendor: 'anthropic', alasan: 'seluruh panggilan vendor ini gagal' },
    { vendor: 'openai', alasan: 'tidak ditemukan' },
  ], {}), /tidak ada hasil vendor yang bisa dipakai.*google.*anthropic.*openai/s);
});

test('putusan seri: alert dipertahankan, bukan dianggap false positive', () => {
  const h = G.gabungkan(tigaVendor({
    google: { alerts: [alert('SONAR-01', 'true_positive')] },
    anthropic: { alerts: [alert('SONAR-01', 'false_positive')] },
    openai: { alerts: [alert('SONAR-01', 'uncertain')] },
  }), {});
  const a = h.alerts[0];
  assert.equal(a.putusan_gabungan, 'tidak_sepakat');
  assert.equal(a.putusan, null);
  assert.notEqual(a.putusan, 'false_positive', 'seri tidak boleh berubah menjadi false positive');
  assert.deepEqual(a.putusan_vendor, { google: 'true_positive', anthropic: 'false_positive', openai: 'uncertain' });
  assert.equal(Object.keys(a.alasan_vendor).length, 3, 'alasan tiap vendor tetap disimpan');
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('seri dua lawan dua mustahil dengan tiga vendor, tetapi seri 1-1 ditangani', () => {
  // Dua vendor sah dengan putusan berbeda: tidak ada yang meraih dua suara.
  const h = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { alerts: [alert('SONAR-01', 'true_positive')] }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { alerts: [alert('SONAR-01', 'false_positive')] }) },
    { vendor: 'openai', alasan: 'tidak ditemukan' },
  ], {});
  assert.equal(h.alerts[0].putusan_gabungan, 'tidak_sepakat');
  assert.equal(h.alerts[0].suara, 1);
});

test('putusan tidak sah tidak ikut dihitung sebagai suara', () => {
  const h = G.gabungkan(tigaVendor({
    google: { alerts: [alert('SONAR-01', 'true_positive')] },
    anthropic: { alerts: [alert('SONAR-01', null)] },
    openai: { alerts: [alert('SONAR-01', 'true_positive')] },
  }), {});
  assert.equal(h.alerts[0].putusan_gabungan, 'true_positive');
  assert.equal(h.alerts[0].suara, 2, 'putusan null tidak menambah maupun menghalangi suara');
  assert.equal(h.alerts[0].putusan_vendor.anthropic, null);
});

test('temuan dari satu vendor saja tetap muncul, dengan kesepakatan 1', () => {
  const h = G.gabungkan(tigaVendor({
    google: { findings: [temuan('T-01'), temuan('T-02', { file: 'src/b.js', fungsi: 'lain', cwe: ['CWE-79'], jenis: 'XSS' })] },
    anthropic: { findings: [temuan('T-01')] },
    openai: { findings: [temuan('T-01')] },
  }), {});
  assert.equal(h.findings.length, 2);
  const sendiri = h.findings.find((t) => t.file === 'src/b.js');
  assert.equal(sendiri.kesepakatan, 1);
  assert.deepEqual(sendiri.vendor_penemu, ['google']);
  assert.deepEqual(Object.keys(sendiri.penjelasan_vendor), ['google']);
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('temuan berdekatan dengan CWE beda kelas tetap dua temuan', () => {
  // Baris berdekatan di file yang sama, tetapi SQL injection dan XSS adalah dua masalah.
  // Menggabungkannya akan menyembunyikan salah satunya.
  const h = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { findings: [temuan('T-01', { baris: 10, fungsi: null, cwe: ['CWE-89'] })] }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { findings: [temuan('T-02', { baris: 11, fungsi: null, cwe: ['CWE-79'], jenis: 'XSS' })] }) },
    { vendor: 'openai', alasan: 'tidak ditemukan' },
  ], {});
  assert.equal(h.findings.length, 2, 'CWE beda kelas tidak boleh digabung meski barisnya berdekatan');
  assert.equal(h.findings[0].kesepakatan, 1);
  assert.equal(h.findings[1].kesepakatan, 1);
});

test('CWE sekeluarga di baris berdekatan digabung', () => {
  // CWE-89 dan CWE-564 satu keluarga sqli menurut aturan yang sama dengan skrip penilaian.
  const h = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { findings: [temuan('T-01', { baris: 10, fungsi: null, cwe: ['CWE-89'] })] }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { findings: [temuan('T-02', { baris: 12, fungsi: null, cwe: ['CWE-564'] })] }) },
    { vendor: 'openai', alasan: 'tidak ditemukan' },
  ], {});
  assert.equal(h.findings.length, 1);
  assert.equal(h.findings[0].kesepakatan, 2);
});

test('temuan di fungsi berbeda tidak digabung meski file dan CWE sama', () => {
  const h = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { findings: [temuan('T-01', { fungsi: 'cari' })] }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { findings: [temuan('T-02', { fungsi: 'simpan' })] }) },
    { vendor: 'openai', alasan: 'tidak ditemukan' },
  ], {});
  assert.equal(h.findings.length, 2, 'fungsi adalah penentu lokasi, bukan hanya nama file');
});

test('aturan keluarga CWE diambil dari sumber yang sama dengan skrip penilaian', () => {
  // Kalau penggabung memakai salinan daftar sendiri, keduanya bisa menyimpang tanpa ketahuan.
  const gs = require('../scripts/gemini-scan');
  const dariGabung = require('../scripts/llm/gabung');
  assert.ok(gs.KELUARGA_CWE && Object.keys(gs.KELUARGA_CWE).length > 0);
  // cweSekeluarga di penggabung harus sepakat dengan daftar itu untuk tiap keluarga.
  for (const [, daftar] of Object.entries(gs.KELUARGA_CWE)) {
    if (daftar.length < 2) continue;
    const [a, b] = daftar;
    assert.equal(dariGabung.cweSekeluarga([a], [b]), true, `CWE-${a} dan CWE-${b} seharusnya sekeluarga`);
  }
});

test('skrip penilaian tidak disentuh penggabung', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.resolve(__dirname, '..');
  const g = fs.readFileSync(path.join(ROOT, 'scripts/llm/gabung.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/score['"]\)/.test(g), 'penggabung tidak boleh bergantung pada skrip penilaian');
  // Yang diuji adalah field mode gabungan, bukan kata "gabungan": score.js sudah lama punya
  // gabunganAntarModel, analisis eksploratif yang tidak berkaitan dengan mode ini.
  for (const f of ['scripts/llm/score.js', 'scripts/llm-score.js']) {
    const teks = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const field of ['mode_model', 'vendor_penemu', 'vendor_dipakai', 'putusan_gabungan', 'penjelasan_vendor', 'per_vendor']) {
      assert.ok(!teks.includes(field), `${f} membaca field mode gabungan: ${field}`);
    }
  }
});

// ---------- Satu vendor melaporkan fungsi, vendor lain tidak ----------
// Keadaan ini nyata: tiap vendor mengisi field fungsi sesukanya. Perlakuannya mengikuti bentuk
// yang dipakai skrip penilaian, yang ketika nama fungsi tidak bisa ditentukan tidak langsung
// menggugurkan pencocokan melainkan jatuh ke apakah teks temuan menyebut nama fungsi itu.
const sebagian = (fungsiA, bOpsi) => G.gabungkan([
  { vendor: 'google', hasil: hasilVendor('google', { findings: [temuan('T-01', { fungsi: fungsiA })] }) },
  { vendor: 'anthropic', hasil: hasilVendor('anthropic', { findings: [temuan('T-02', bOpsi)] }) },
  { vendor: 'openai', alasan: 'tidak ditemukan' },
], {});

test('fungsi hanya di satu vendor: cocok bila teks vendor lain menyebut nama fungsinya', () => {
  const h = sebagian('cari', { fungsi: null, baris: 400, penjelasan: 'Query di fungsi cari tidak diparameterkan.' });
  assert.equal(h.findings.length, 1, 'sebutan nama fungsi di teks sudah cukup, sejauh apa pun barisnya');
  assert.equal(h.findings[0].kesepakatan, 2);
});

test('fungsi hanya di satu vendor: cocok bila barisnya berdekatan', () => {
  const h = sebagian('cari', { fungsi: null, baris: 12, penjelasan: 'tanpa menyebut nama fungsi' });
  assert.equal(h.findings.length, 1);
  assert.equal(h.findings[0].kesepakatan, 2);
});

test('fungsi hanya di satu vendor: tidak cocok bila tidak menyebut dan barisnya jauh', () => {
  const h = sebagian('cari', { fungsi: null, baris: 400, penjelasan: 'tanpa menyebut nama fungsi' });
  assert.equal(h.findings.length, 2, 'tanpa sinyal lokasi apa pun, keduanya temuan berbeda');
  assert.equal(h.findings[0].kesepakatan, 1);
});

test('sebutan nama fungsi harus utuh, bukan potongan kata', () => {
  // "pencarian" memuat "cari" sebagai substring, tetapi bukan sebutan fungsi itu.
  const h = sebagian('cari', { fungsi: null, baris: 400, penjelasan: 'ada masalah pada pencarian data' });
  assert.equal(h.findings.length, 2, 'batas kata harus dihormati, sama seperti skrip penilaian');
});
