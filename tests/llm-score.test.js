// Tes scoring prompt v2 dengan ground truth buatan. OBJEK_UJI_DIR diset sebelum modul scoring dimuat.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OBJEK = fs.mkdtempSync(path.join(os.tmpdir(), 'objek-skor-'));
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
tulis('src/c.js', 'exports.kirim = (p) => {\n  res.sendFile(p);\n};\n');
tulis('src/app.js', "app.use(cors({ origin: '*' }));\n");
tulis('src/lain.js', 'exports.lain = () => {\n  return 1;\n};\n');
tulis('SEEDED.md', [
  '| ID | File | Fungsi | Kelas | CWE | OWASP | Tingkat | Status |',
  '|----|------|--------|-------|-----|-------|---------|--------|',
  '| S1 | src/models/m.js | list | SQL Injection | CWE-89 | A05 | Mudah | terbukti |',
  '| S2 | src/models/m.js | order | SQL Injection (ORDER BY) | CWE-89 | A05 | Sedang | jebakan FP |',
  '| S6 | src/c.js | kirim | Path Traversal | CWE-22 | A01 | Sedang | laten |',
  '',
  '| ID | Deskripsi | Lokasi | CWE | Terdeteksi Sonar |',
  '|----|-----------|--------|-----|------------------|',
  '| B1 | CORS semua origin | src/app.js | CWE-942 | Ya |',
].join('\n'));
process.env.OBJEK_UJI_DIR = OBJEK;

const score = require('../scripts/llm/score');
const { bacaGroundTruth } = require('../scripts/gemini-scan');

const gt = bacaGroundTruth();
const alert = [
  { id: 'SONAR-01', sumber: 'issue', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', file: 'src/models/m.js', baris: 2, pesan: 'SQLi', cwe: ['CWE-89'], keamanan: true },
  { id: 'SONAR-02', sumber: 'issue', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', file: 'src/models/m.js', baris: 5, pesan: 'SQLi', cwe: ['CWE-89'], keamanan: true },
  { id: 'SONAR-03', sumber: 'issue', rule: 'jssecurity:S2083', tipe: 'VULNERABILITY', file: 'src/c.js', baris: 2, pesan: 'Path', cwe: ['CWE-22'], keamanan: true },
  { id: 'SONAR-04', sumber: 'hotspot', rule: 'javascript:S5122', tipe: 'SECURITY_HOTSPOT', file: 'src/app.js', baris: 1, pesan: 'CORS', cwe: ['CWE-942'], keamanan: true },
  { id: 'SONAR-05', sumber: 'issue', rule: 'x:Y', tipe: 'CODE_SMELL', file: 'src/lain.js', baris: 2, pesan: 'lain', cwe: ['CWE-1'], keamanan: false },
];
const ver = (id_alert, putusan, ekstra = {}) => ({ id_alert, putusan, keyakinan: 'high', alasan: 'a', tanda: [], metadata: { status: 'ok', parse_ok: true }, ...ekstra });

test('label alert: otomatis dari ground truth, manual divalidasi', () => {
  const manual = { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } };
  const label = score.labelAlert(alert, gt, manual);
  assert.deepEqual(Object.fromEntries(Object.entries(label).map(([k, v]) => [k, [v.label, v.sumber]])), {
    'SONAR-01': ['nyata', 'otomatis'], 'SONAR-02': ['fp', 'otomatis'], 'SONAR-03': ['laten', 'otomatis'],
    'SONAR-04': ['nyata', 'otomatis'], 'SONAR-05': ['fp', 'manual'],
  });
  assert.equal(score.labelAlert(alert, gt)['SONAR-05'].label, null);
  assert.throws(() => score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:3' } }), /Lokasi/);
  assert.throws(() => score.labelAlert(alert, gt, { 'SONAR-01': { label: 'fp', lokasi: 'src/models/m.js:2' } }), /bertentangan/);
});

test('verifikasi: empat kategori, uncertain dipertahankan, laten terpisah, tanpa hasil', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  const k = score.kategoriVerifikasi([
    ver('SONAR-01', 'false_positive'),
    ver('SONAR-02', 'false_positive'),
    ver('SONAR-03', 'true_positive'),
    ver('SONAR-04', 'uncertain'),
    ver('SONAR-05', null, { metadata: { status: 'refusal', parse_ok: false } }),
  ], label);
  assert.deepEqual(k.jumlah, { identified_fp: 1, missed_fp: 0, misidentified_fp: 1, correct_retention: 1 });
  assert.deepEqual(k.kategori.misidentified_fp, ['SONAR-01']);
  assert.deepEqual(k.uncertain_dipertahankan, ['SONAR-04']);
  assert.deepEqual(k.laten.map((l) => [l.id_alert, l.putusan]), [['SONAR-03', 'true_positive']]);
  assert.deepEqual(k.tanpa_hasil.map((t) => t.status), ['refusal']);
  assert.deepEqual(k.metrik_fp_positif, { precision: 0.5, recall: 1, f1: 2 / 3 });
  const k2 = score.kategoriVerifikasi([ver('SONAR-02', 'true_positive'), ver('SONAR-05', 'uncertain')], label);
  assert.deepEqual(k2.jumlah, { identified_fp: 0, missed_fp: 2, misidentified_fp: 0, correct_retention: 0 });
});

const temuan = (ubah) => ({
  file: 'src/models/m.js', baris: 2, fungsi: 'list', jenis: 'SQL Injection', cwe: 'CWE-89', kategori_owasp: 'A05',
  penjelasan: 'x', sifat: 'vulnerability', keyakinan: 'high', tanda: [], ...ubah,
});
const run = {
  run: 1, parse_ok: true,
  temuan: [
    temuan(),
    temuan({ file: 'src/app.js', baris: 1, fungsi: '', jenis: 'Rate limiting', cwe: 'CWE-307', sifat: 'hardening' }),
    temuan({ file: 'src/lain.js', baris: 2, fungsi: 'lain', jenis: 'Info', cwe: 'CWE-200' }),
    temuan({ sifat: 'hardening' }),
  ],
  verifikasi: [ver('SONAR-01', 'false_positive'), ver('SONAR-02', 'false_positive'), ver('SONAR-03', 'true_positive'), ver('SONAR-04', 'uncertain'), ver('SONAR-05', 'true_positive')],
  deteksi: { tugas: 'deteksi', status: 'ok', parse_ok: true },
};

test('skenario A, B, C: hardening di luar ground truth tidak dihitung FP, B memakai alert yang dipertahankan', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  const a = score.skenarioA(alert, gt);
  assert.deepEqual(a.a_hanya_vulnerability.alert, ['SONAR-01', 'SONAR-02', 'SONAR-03']);
  assert.equal(a.b_filter_v2.ketat.tp, 1);
  assert.equal(a.b_filter_v2.rincian_fp.jebakan_terdeteksi, 1);
  assert.equal(a.b_filter_v2.rincian_fp.di_luar_ground_truth, 1); // SONAR-05

  const s = score.skorRunUtama({ run, alert, gt, label, triase: null });
  assert.deepEqual(s.skenario_c.ketat, { tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1, f1: 2 / 3 });
  assert.equal(s.skenario_c.hardening_di_luar_ground_truth, 1);
  assert.equal(s.skenario_c.hardening_cocok_seeded, 1);
  assert.deepEqual(s.sonar_setelah_verifikasi.alert, ['SONAR-03', 'SONAR-04', 'SONAR-05']);
  assert.equal(s.skenario_b.ketat.tp, 1);
  assert.equal(s.skenario_b.ketat.fp, 2); // temuan LLM di lain.js + SONAR-05 yang salah dipertahankan
  assert.equal(s.skenario_b.status_gt.S2, 'tidak');
});

test('skenario B: alert tanpa putusan sah tetap dipertahankan dan dihitung terpisah', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  const r = {
    ...run,
    verifikasi: [
      ver('SONAR-01', 'maybe', { tanda: ['nilai_tidak_valid'] }), // enum tidak valid
      ver('SONAR-02', null, { metadata: { status: 'refusal', parse_ok: false } }), // jebakan S2, ditolak model
      ver('SONAR-03', null, { metadata: { status: 'ok', parse_ok: false } }), // parse gagal
      ver('SONAR-05', 'false_positive'), // satu-satunya yang dibuang
      // SONAR-04 tanpa entri sama sekali
    ],
  };
  const s = score.skorRunUtama({ run: r, alert, gt, label, triase: null });
  assert.deepEqual(s.sonar_setelah_verifikasi.alert, ['SONAR-01', 'SONAR-02', 'SONAR-03', 'SONAR-04']);
  assert.deepEqual(s.skenario_b.alert_tanpa_putusan, ['SONAR-01', 'SONAR-02', 'SONAR-03', 'SONAR-04']);
  assert.equal(s.skenario_b.status_gt.S2, 'cocok');
  assert.equal(s.skenario_b.rincian_fp.jebakan_terdeteksi, 1);
  assert.deepEqual(s.verifikasi.jumlah, { identified_fp: 1, missed_fp: 0, misidentified_fp: 0, correct_retention: 0 });
  assert.deepEqual(s.verifikasi.tanpa_hasil.map((t) => t.id_alert), ['SONAR-01', 'SONAR-02']);
  assert.deepEqual(s.verifikasi.laten.map((l) => [l.id_alert, l.putusan]), [['SONAR-03', null]]);
});

test('triase: FP setelah triase, validasi lokasi dan status kandidat', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  const triase = { 'run-1.json': { 2: { kategori: 'teoretis', lokasi: 'src/lain.js:2' } } };
  const s = score.skorRunUtama({ run, alert, gt, label, triase });
  assert.equal(s.skenario_c.setelah_triase.fp, 0);
  assert.equal(s.skenario_c.setelah_triase.precision, 1);
  assert.equal(s.skenario_c.setelah_triase.rincian_triase.teoretis, 1);
  const perRun = { 1: s.penilaian_c };
  assert.doesNotThrow(() => score.validasiTriase(triase, [run], perRun));
  assert.throws(() => score.validasiTriase({ 'run-1.json': { 2: { kategori: 'fp', lokasi: 'src/lain.js:3' } } }, [run], perRun), /lokasi/);
  assert.throws(() => score.validasiTriase({ 'run-1.json': { 0: { kategori: 'fp', lokasi: 'src/models/m.js:2' } } }, [run], perRun), /bukan kandidat/);
  assert.throws(() => score.validasiTriase({ 'run-1.json': { 2: { kategori: 'aneh', lokasi: 'src/lain.js:2' } } }, [run], perRun), /kategori/);
});

test('triase gabungan: hanya kategori fp dan belum-ditriase yang tetap FP; tp_di_luar_seeded/teoretis/informasional/duplikat tidak; TP & recall tetap; FP ketat tetap dilaporkan', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  // Satu kandidat LLM di luar ground truth (src/lain.js:2, rujukan "2"). FP ketat skenario C = 1, TP = 1, recall = 1.
  const dasar = score.skorRunUtama({ run, alert, gt, label, triase: null });
  assert.equal(dasar.skenario_c.ketat.fp, 1);
  assert.equal(dasar.skenario_c.ketat.tp, 1);
  assert.equal(dasar.skenario_c.setelah_triase.fp, 1); // tanpa triase: konservatif, tetap FP

  const kasus = [
    ['fp', 1], ['tp_di_luar_seeded', 0], ['teoretis', 0], ['informasional', 0], ['duplikat', 0],
  ];
  for (const [kategori, fpHarap] of kasus) {
    const triase = { 'run-1.json': { 2: { kategori, lokasi: 'src/lain.js:2' } } };
    const s = score.skorRunUtama({ run, alert, gt, label, triase });
    const st = s.skenario_c.setelah_triase;
    assert.equal(st.fp, fpHarap, `kategori ${kategori}: FP setelah triase`);
    assert.equal(st.rincian_triase[kategori], 1, `kategori ${kategori}: tercatat di rincian`);
    assert.equal(st.belum_ditriase, 0, `kategori ${kategori}: tidak ada yang belum ditriase`);
    // Tidak ada kategori yang menambah TP: TP & recall sama dengan ketat.
    assert.equal(s.skenario_c.ketat.tp, 1, `kategori ${kategori}: TP ketat tidak berubah`);
    assert.equal(st.recall, s.skenario_c.ketat.recall, `kategori ${kategori}: recall tetap`);
    // FP ketat tetap dilaporkan berdampingan, tidak terpengaruh triase.
    assert.equal(s.skenario_c.ketat.fp, 1, `kategori ${kategori}: FP ketat tetap dilaporkan`);
  }
});

test('triase konservatif: teoretis ikut FP; tp_di_luar_seeded/informasional/duplikat tetap keluar; varian dicatat', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  const kasus = [
    ['teoretis', 1], ['tp_di_luar_seeded', 0], ['informasional', 0], ['duplikat', 0], ['fp', 1],
  ];
  for (const [kategori, fpKonservatif] of kasus) {
    const triase = { 'run-1.json': { 2: { kategori, lokasi: 'src/lain.js:2' } } };
    const u = score.skorRunUtama({ run, alert, gt, label, triase }); // default utama
    const k = score.skorRunUtama({ run, alert, gt, label, triase, opsiTriase: { konservatif: true } });
    assert.equal(u.skenario_c.setelah_triase.varian, 'utama');
    assert.equal(k.skenario_c.setelah_triase.varian, 'konservatif');
    assert.equal(k.skenario_c.setelah_triase.fp, fpKonservatif, `konservatif ${kategori}: FP`);
    // Utama: hanya fp yang tetap FP; teoretis keluar.
    assert.equal(u.skenario_c.setelah_triase.fp, kategori === 'fp' ? 1 : 0, `utama ${kategori}: FP`);
    // TP & recall sama di kedua varian (tak ada kategori yang menambah TP).
    assert.equal(k.skenario_c.ketat.tp, 1);
    assert.equal(k.skenario_c.setelah_triase.recall, k.skenario_c.ketat.recall);
    assert.equal(k.skenario_c.ketat.fp, 1); // FP ketat tetap berdampingan
  }
});

test('infoKodeScoring: HEAD repo alat, branch, status bersih, dan lingkup; tidak melempar walau belum bersih', () => {
  const { infoKodeScoring } = require('../scripts/llm-score');
  const i = infoKodeScoring();
  assert.match(i.head, /^[0-9a-f]{40}$/);
  assert.equal(typeof i.branch, 'string');
  assert.ok(i.branch.length > 0);
  assert.equal(typeof i.bersih, 'boolean');
  assert.ok(Array.isArray(i.berubah));
  assert.equal(i.bersih, i.berubah.length === 0); // bersih konsisten dengan daftar perubahan
  // Lingkup kebersihan sama dengan yang dipakai saat run, supaya kedua field dapat dibandingkan.
  assert.deepEqual(i.lingkup, require('../scripts/llm/lanjut').LINGKUP_KODE);
});

test('petakanTriaseGabungan: sub-pohon per vendor, tolak vendor asing dan bentuk salah', () => {
  const { petakanTriaseGabungan } = require('../scripts/llm-score');
  const gabungan = { entri: { google: { 'run-1.json': { 2: { kategori: 'teoretis', lokasi: 'src/lain.js:2' } } }, openai: {} } };
  const peta = petakanTriaseGabungan(gabungan, ['google', 'openai', 'anthropic']);
  assert.deepEqual(peta.google, gabungan.entri.google);
  assert.deepEqual(peta.openai, {});
  assert.equal(peta.anthropic, undefined); // vendor tanpa entri: tidak ditriase
  assert.throws(() => petakanTriaseGabungan({ entri: { vendorX: {} } }, ['google']), /vendor "vendorX" yang tidak ada/);
  assert.throws(() => petakanTriaseGabungan({}, ['google']), /objek "entri"/);
  assert.throws(() => petakanTriaseGabungan(null, ['google']), /objek "entri"/);
});

test('tabel per item dan gabungan antar model', () => {
  const label = score.labelAlert(alert, gt, { 'SONAR-05': { label: 'fp', lokasi: 'src/lain.js:2' } });
  const skorA = score.skenarioA(alert, gt);
  const skorRun = [score.skorRunUtama({ run, alert, gt, label, triase: null })];
  const tabel = score.tabelPerItem({ gt, skorA, skorRun });
  const s1 = tabel.find((t) => t.id === 'S1');
  assert.equal(s1.sonar_b, 'cocok');
  assert.deepEqual(s1.skenario_c, { ketat: 1, longgar: 1, dari: 1 });
  const lain = { ...run, temuan: [], verifikasi: [ver('SONAR-02', 'true_positive')] };
  const g = score.gabunganAntarModel({ perModel: [{ vendor: 'x', runs: [run] }, { vendor: 'y', runs: [lain] }], alert, gt });
  assert.equal(g.runs.length, 1);
  assert.equal(g.runs[0].skenario_b.rincian_fp.jebakan_terdeteksi, 1);
});

test('hitung status panggilan per tugas', () => {
  const r = { ...run, deteksi: { tugas: 'deteksi', status: 'ok', parse_ok: false }, verifikasi: [
    { metadata: { tugas: 'verifikasi', status: 'refusal', parse_ok: false } },
    { metadata: { tugas: 'verifikasi', status: 'truncated', parse_ok: false } },
  ] };
  assert.deepEqual(score.hitungStatusPanggilan([r]), {
    deteksi: { total: 1, refusal: 0, truncated: 0, error: 0, parse_ok_false: 1 },
    verifikasi: { total: 2, refusal: 1, truncated: 1, error: 0, parse_ok_false: 0 },
  });
});

const tmn = (ubah) => ({
  file: 'src/models/m.js', baris: 5, fungsi: 'order', jenis: 'SQL Injection ORDER BY', cwe: 'CWE-89', kategori_owasp: 'A05',
  penjelasan: 'x', sifat: 'vulnerability', keyakinan: 'high', tanda: [], ...ubah,
});
const entriLlm = (ts) => ts.map((t, i) => ({ asal: 'llm', v1: score.temuanKeV1(t), sifat: t.sifat, rujukan: String(i) }));

test('aturan hardening spesifikasi: hardening cocok jebakan tidak dihitung FP ketat, tetapi tetap terdeteksi; TP dari hardening tetap dihitung', () => {
  // S2 (jebakan, m.js:5 order) terdeteksi hanya oleh temuan hardening.
  const hard = score.nilaiHimpunan(entriLlm([tmn({ sifat: 'hardening', keyakinan: 'low' })]), gt);
  assert.equal(hard.aturan_hardening, 'spesifikasi');
  assert.equal(hard.metrik.ketat.fp, 0); // tidak dihitung FP
  assert.deepEqual(hard.metrik.rincian_fp, { di_luar_ground_truth: 0, n1: 0, jebakan_terdeteksi: 0 });
  assert.equal(hard.status_gt.S2, 'cocok'); // tetap terdeteksi di tabel per item
  assert.equal(hard.hardening_cocok_seeded, 1);

  // Jebakan yang sama terdeteksi oleh temuan vulnerability: dihitung FP.
  const vuln = score.nilaiHimpunan(entriLlm([tmn({ sifat: 'vulnerability' })]), gt);
  assert.equal(vuln.metrik.ketat.fp, 1);
  assert.equal(vuln.metrik.rincian_fp.jebakan_terdeteksi, 1);

  // TP tetap dihitung tanpa memandang sifat (B2): hardening yang cocok item terbukti S1 jadi TP.
  const tp = score.nilaiHimpunan(entriLlm([tmn({ file: 'src/models/m.js', baris: 2, fungsi: 'list', jenis: 'SQLi', sifat: 'hardening', keyakinan: 'low' })]), gt);
  assert.equal(tp.metrik.ketat.tp, 1);
  assert.equal(tp.metrik.ketat.fp, 0);
  assert.equal(tp.status_gt.S1, 'cocok');

  // Jebakan terdeteksi oleh hardening DAN vulnerability sekaligus: tetap FP (karena ada non-hardening).
  const campur = score.nilaiHimpunan(entriLlm([tmn({ sifat: 'hardening', keyakinan: 'low' }), tmn({ sifat: 'vulnerability', baris: 5 })]), gt);
  assert.equal(campur.metrik.rincian_fp.jebakan_terdeteksi, 1);
});

test('labelAlert paksa: menimpa label otomatis untuk sensitivitas, dengan validasi lokasi dan label awal', () => {
  // SONAR-02 di m.js:5 cocok S2 (jebakan) -> otomatis fp. Paksa jadi nyata.
  const paksa = { 'SONAR-02': { label: 'nyata', lokasi: 'src/models/m.js:5', alasan: 'uji sensitivitas' } };
  const l = score.labelAlert(alert, gt, {}, paksa);
  assert.equal(l['SONAR-02'].label, 'nyata');
  assert.equal(l['SONAR-02'].sumber, 'paksa');
  assert.equal(l['SONAR-02'].label_awal, 'fp');
  assert.equal(l['SONAR-02'].alasan_paksa, 'uji sensitivitas');
  // Alert lain tetap otomatis.
  assert.equal(l['SONAR-01'].sumber, 'otomatis');
  assert.equal(l['SONAR-01'].label_awal, l['SONAR-01'].label);
  // Validasi: lokasi salah dan label tidak dikenal ditolak.
  assert.throws(() => score.labelAlert(alert, gt, {}, { 'SONAR-02': { label: 'nyata', lokasi: 'src/models/m.js:9' } }), /Lokasi label paksa/);
  assert.throws(() => score.labelAlert(alert, gt, {}, { 'SONAR-02': { label: 'maybe', lokasi: 'src/models/m.js:5' } }), /Label paksa .* tidak dikenal/);
  // Paksa memengaruhi verifikasi empat kategori: alert fp->nyata membuat putusan false_positive jadi misidentified.
  const kA = score.kategoriVerifikasi([ver('SONAR-02', 'false_positive')], score.labelAlert(alert, gt));
  const kP = score.kategoriVerifikasi([ver('SONAR-02', 'false_positive')], l);
  assert.equal(kA.jumlah.identified_fp, 1);
  assert.equal(kP.jumlah.misidentified_fp, 1);
});
