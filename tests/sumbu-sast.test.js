// Sumbu `sast`: perkakas SAST mana yang memasok alert. Tes ini menjaga empat hal, dan yang pertama
// adalah yang paling mahal kalau lepas:
//
//   1. Baris sonar-saja IDENTIK dengan perilaku sebelum sumbu ini ada. Kalau ini bergeser, seluruh
//      angka yang sudah terbit kehilangan pembandingnya.
//   2. Berkas CodeQL beku menolak dirinya sendiri kalau isinya bergeser satu byte, dan menolak run
//      kalau tree src/ objek uji berbeda.
//   3. Penggabungan tidak pernah menomori ulang id dan urutannya tidak bergantung urutan masukan.
//   4. Kombinasi yang belum dirancang ditolak dengan pesan yang menyebut sebabnya.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const render = require('../scripts/llm/render');
const beku = require('../scripts/sast/codeql-beku');
const sumbu = require('../scripts/sast/sumbu-sast');

// Berkas sementara selalu di luar repo: tes tidak boleh meninggalkan jejak di pohon kerja.
const dirSementara = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sast-'));

const TREE = 'a'.repeat(40);
const OBJEK = { dir: '.', commit: 'b'.repeat(40), tree_src: TREE };

const alertCodeql = (n, file, baris, rule) => ({
  id: `CQL-${String(n).padStart(2, '0')}`,
  rule,
  tipe: 'SECURITY',
  sumber: 'codeql',
  file,
  baris,
  cwe: ['CWE-89'],
  pesan: `pesan ${rule}`,
});
const DUA_CQL = [
  alertCodeql(1, 'src/models/a.js', 10, 'js/sql-injection'),
  alertCodeql(2, 'src/routes/b.js', 4, 'js/missing-rate-limiting'),
];
const DUA_SONAR = [
  { id: 'SONAR-01', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/models/a.js', baris: 11, cwe: ['CWE-89'], pesan: 'SQLi' },
  { id: 'SONAR-02', rule: 'javascript:S5122', tipe: 'SECURITY_HOTSPOT', sumber: 'hotspot', file: 'src/app.js', baris: 10, cwe: ['CWE-942'], pesan: 'CORS' },
];

const isiBeku = (alert = DUA_CQL, tambahan = {}) => beku.buatIsiBeku({
  alert,
  dibuat: '2026-10-26T09:34:00.000Z',
  treeSrc: TREE,
  lingkungan: { cli: '2.27.3', pack: ['codeql/javascript-queries@2.4.8'], konfig_sha256: 'c'.repeat(64) },
  sarif: [{ nama: 'hasil-extended.sarif', suite: 'extended', sha256: 'd'.repeat(64), jumlah_result: 22 }],
  saringan: { tingkat2: 0, tingkat3: 0, luar_src: 4 },
  gerbangSanity: { src_js: 43, galat_ekstraksi: 0 },
  ...tambahan,
});

// ---------- 1. Baris sonar-saja tidak boleh bergeser ----------

test('regresi: pilihAlert tanpa awalan menghasilkan id yang sama dengan awalan SONAR eksplisit', () => {
  const ringkasan = [
    { file: 'src/b.js', baris: 9, rule: 'r:B', cwe: ['CWE-79'], keamanan: true, tipe: 'VULNERABILITY', pesan: 'x' },
    { file: 'src/a.js', baris: 2, rule: 'r:A', cwe: ['CWE-89'], keamanan: true, tipe: 'VULNERABILITY', pesan: 'y' },
    { file: 'src/a.js', baris: 1, rule: 'r:A', cwe: [], keamanan: false, tipe: 'CODE_SMELL', pesan: 'z' },
  ];
  const bawaan = render.pilihAlert(ringkasan);
  const eksplisit = render.pilihAlert(ringkasan, 'SONAR');
  assert.deepEqual(bawaan, eksplisit);
  // Urutan dan penomorannya juga harus tetap: berkas, lalu baris, lalu rule.
  assert.deepEqual(bawaan.map((a) => [a.id, a.file, a.baris]), [
    ['SONAR-01', 'src/a.js', 2],
    ['SONAR-02', 'src/b.js', 9],
  ]);
  assert.equal(render.AWALAN_ID_ALERT, 'SONAR');
});

test('regresi: awalan lain hanya mengubah awalan id, tidak mengubah isi atau urutan', () => {
  const ringkasan = [{ file: 'src/a.js', baris: 2, rule: 'r', cwe: ['CWE-89'], keamanan: true, tipe: 'VULNERABILITY', pesan: 'y' }];
  const s = render.pilihAlert(ringkasan);
  const c = render.pilihAlert(ringkasan, 'CQL');
  assert.equal(c[0].id, 'CQL-01');
  assert.deepEqual({ ...c[0], id: null }, { ...s[0], id: null });
});

test('awalan id alert harus huruf besar', () => {
  for (const salah of ['cql', 'CQL-', 'C1', '', 'CQL 2']) {
    assert.throws(() => render.pilihAlert([], salah), /Awalan id alert harus huruf besar/, `awalan ${JSON.stringify(salah)}`);
  }
});

test('regresi: rakitan prompt verifikasi untuk alert Sonar tidak bergantung pada sumbu sast', () => {
  // Enam medan yang dikirim ke model tidak memuat sumber_sast maupun kembar_dengan, jadi teks alert
  // yang sama harus menghasilkan prompt yang sama, dengan atau tanpa penggabungan.
  const template = render.bacaTemplate();
  const polos = DUA_SONAR[0];
  const lewatGabung = sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: DUA_CQL })
    .find((a) => a.id === 'SONAR-01');
  assert.equal(render.formatAlert(lewatGabung, template.alert.teks), render.formatAlert(polos, template.alert.teks));
});

test('gabungAlert dengan himpunan codeql kosong mengembalikan alert Sonar apa adanya', () => {
  const hasil = sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: [] });
  assert.deepEqual(hasil.map((a) => a.id), ['SONAR-02', 'SONAR-01']); // app.js:10 sebelum models/a.js:11
  for (const a of hasil) {
    const asal = DUA_SONAR.find((x) => x.id === a.id);
    assert.deepEqual({ ...a, sumber_sast: undefined }, { ...asal, sumber_sast: undefined });
  }
});

// ---------- 2. Berkas CodeQL beku ----------

test('berkas beku yang ditulis lalu dibaca ulang lolos verifikasi', () => {
  const dir = dirSementara();
  const file = path.join(dir, 'codeql-beku.json');
  const isi = isiBeku();
  beku.tulisBeku(file, isi);
  const b = beku.bacaBeku(file, OBJEK);
  assert.equal(b.info.sha256_isi, isi.sha256_isi);
  assert.equal(b.info.jumlah_alert, DUA_CQL.length);
  assert.equal(b.alert.length, DUA_CQL.length);
  // Nama berkas saja, bukan path: info ini ikut tercatat di keluaran run.
  assert.equal(b.info.nama, 'codeql-beku.json');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('membangun dua kali dari masukan yang sama menghasilkan sha256_isi identik', () => {
  const a = isiBeku();
  const b = isiBeku();
  assert.equal(b.sha256_isi, a.sha256_isi);
  assert.deepEqual(b, a);
});

test('dibuat wajib diisi, supaya pembangunan tidak bergantung waktu sekarang', () => {
  assert.throws(() => isiBeku(DUA_CQL, { dibuat: undefined }), /dibuat wajib diisi/);
  assert.throws(() => isiBeku(DUA_CQL, { treeSrc: undefined }), /treeSrc wajib diisi/);
});

test('berkas beku yang diubah satu byte ditolak', () => {
  const dir = dirSementara();
  const file = path.join(dir, 'codeql-beku.json');
  beku.tulisBeku(file, isiBeku());
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.alert[0].baris += 1; // satu angka, sha256_isi dibiarkan
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  assert.throws(() => beku.bacaBeku(file, OBJEK), /Hash isi file CodeQL beku tidak cocok/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rujukan SARIF harus nama berkas saja, bukan path', () => {
  // Nama folder dibuat netral: berkas yang di-commit tidak boleh memuat path mesin siapa pun
  // (AGENTS.md batas keras nomor 10), termasuk sebagai contoh di dalam tes.
  for (const salah of ['C:/folder/hasil.sarif', 'C:\\folder\\hasil.sarif', 'sub/hasil.sarif', '../hasil.sarif', '']) {
    assert.throws(
      () => isiBeku(DUA_CQL, { sarif: [{ nama: salah, suite: 'extended', sha256: 'd'.repeat(64), jumlah_result: 1 }] }),
      /Rujukan SARIF harus nama berkas saja/,
      `nama ${JSON.stringify(salah)}`,
    );
  }
  assert.equal(beku.namaBerkasSaja('hasil-extended.sarif'), 'hasil-extended.sarif');
});

// ---------- Gerbang tree src/ ----------

test('gerbang tree src: cocok, tidak cocok, dan berkas hilang', () => {
  const dir = dirSementara();
  const file = path.join(dir, 'codeql-beku.json');
  beku.tulisBeku(file, isiBeku());

  // cocok
  assert.equal(beku.bacaBeku(file, OBJEK).tree_src_analisis, TREE);

  // tidak cocok
  assert.throws(
    () => beku.bacaBeku(file, { ...OBJEK, tree_src: 'e'.repeat(40) }),
    /Hash tree src\/ di file CodeQL beku .* berbeda dengan objek uji .* Run ditolak/,
  );

  // berkas hilang
  const hilang = path.join(dir, 'tidak-ada.json');
  assert.throws(() => beku.bacaBeku(hilang, OBJEK), /File CodeQL beku tidak ditemukan/);
  assert.throws(() => beku.bacaBeku(null, OBJEK), /File CodeQL beku wajib diisi/);

  // bukan JSON
  const rusak = path.join(dir, 'rusak.json');
  fs.writeFileSync(rusak, '{bukan json');
  assert.throws(() => beku.bacaBeku(rusak, OBJEK), /bukan JSON valid/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('versi format yang tidak dikenal ditolak', () => {
  const dir = dirSementara();
  const file = path.join(dir, 'codeql-beku.json');
  const isi = isiBeku();
  beku.tulisBeku(file, { ...isi, versi_format: 99 });
  assert.throws(() => beku.bacaBeku(file, OBJEK), /Versi format file CodeQL beku tidak dikenal: 99/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 3. Penggabungan himpunan alert ----------

test('penggabungan menyatukan dua himpunan tanpa menomori ulang, perkakas lalu berkas lalu baris lalu id', () => {
  const hasil = sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: DUA_CQL });
  assert.equal(hasil.length, 4);
  assert.deepEqual(hasil.map((a) => `${a.id}@${a.file}:${a.baris}`), [
    'SONAR-02@src/app.js:10',
    'SONAR-01@src/models/a.js:11',
    'CQL-01@src/models/a.js:10',
    'CQL-02@src/routes/b.js:4',
  ]);
  assert.deepEqual(hasil.map((a) => a.sumber_sast), ['sonar', 'sonar', 'codeql', 'codeql']);
});

test('seluruh alert Sonar mendahului seluruh alert CodeQL, tanpa selang-seling', () => {
  // Keputusan 26 Okt 2026: lengan dua perkakas memverifikasi SONAR-01..05 lebih dulu, baru CQL-xx,
  // supaya urutan alert Sonar persis sama dengan batch satu perkakas dan keduanya bisa dibandingkan
  // baris demi baris. Diuji dengan himpunan yang SENGAJA menggoda urutan per berkas: alert CodeQL
  // di berkas yang secara alfabet lebih awal, dan di baris yang lebih kecil.
  const sonar = [
    { id: 'SONAR-01', rule: 'r', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/z.js', baris: 99, cwe: ['CWE-89'], pesan: 's1' },
    { id: 'SONAR-02', rule: 'r', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/y.js', baris: 50, cwe: ['CWE-89'], pesan: 's2' },
  ];
  const codeql = [
    alertCodeql(1, 'src/a.js', 1, 'js/sql-injection'),
    alertCodeql(2, 'src/b.js', 2, 'js/path-injection'),
  ];
  const hasil = sumbu.gabungAlert({ sonar, codeql });
  assert.deepEqual(hasil.map((a) => a.id), ['SONAR-02', 'SONAR-01', 'CQL-01', 'CQL-02']);

  // Dinyatakan juga sebagai sifat, bukan hanya sebagai urutan yang kebetulan benar: indeks terakhir
  // yang bersumber sonar harus lebih kecil dari indeks pertama yang bersumber codeql.
  const sumberUrut = hasil.map((a) => a.sumber_sast);
  const sonarTerakhir = sumberUrut.lastIndexOf('sonar');
  const codeqlPertama = sumberUrut.indexOf('codeql');
  assert.ok(sonarTerakhir < codeqlPertama, `sonar terakhir di ${sonarTerakhir}, codeql pertama di ${codeqlPertama}`);

  // Urutan di dalam kelompok Sonar sama dengan urutan Sonar sendirian.
  assert.deepEqual(
    hasil.filter((a) => a.sumber_sast === 'sonar').map((a) => a.id),
    sumbu.gabungAlert({ sonar }).map((a) => a.id),
  );
});

test('urutan hasil penggabungan tidak bergantung urutan masukan', () => {
  const a = sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: DUA_CQL });
  const b = sumbu.gabungAlert({ sonar: [...DUA_SONAR].reverse(), codeql: [...DUA_CQL].reverse() });
  assert.deepEqual(b.map((x) => x.id), a.map((x) => x.id));
});

test('id yang bertabrakan antar-perkakas adalah galat, bukan dinomori ulang', () => {
  assert.throws(
    () => sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: [{ ...DUA_CQL[0], id: 'SONAR-01' }] }),
    /Id alert bertabrakan antar-perkakas: SONAR-01/,
  );
  assert.throws(
    () => sumbu.gabungAlert({ sonar: [{ ...DUA_SONAR[0], id: undefined }], codeql: [] }),
    /alert tanpa id/,
  );
});

test('kasus batas: himpunan kosong di salah satu sisi, dan kosong keduanya', () => {
  assert.deepEqual(sumbu.gabungAlert({ sonar: [], codeql: [] }), []);
  assert.deepEqual(sumbu.gabungAlert(), []);
  assert.deepEqual(sumbu.gabungAlert({ sonar: DUA_SONAR }).map((a) => a.id), ['SONAR-02', 'SONAR-01']);
  assert.deepEqual(sumbu.gabungAlert({ codeql: DUA_CQL }).map((a) => a.id), ['CQL-01', 'CQL-02']);
});

test('tanpa ground truth, medan kembar_dengan tidak ditambahkan sama sekali', () => {
  // Proses pemindaian tidak boleh memuat ground truth; medan ini diisi penilai.
  for (const a of sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: DUA_CQL })) {
    assert.ok(!('kembar_dengan' in a), `${a.id} tidak boleh membawa kembar_dengan`);
  }
});

test('kembar_dengan hanya metadata: ia tidak pernah ikut ke teks alert yang dikirim ke model', () => {
  const template = render.bacaTemplate();
  const gt = [{ id: 'S2', file: ['src/models/a.js'], fungsi: [], cwe: [89], status: 'jebakan fp', rute: null }];
  const nilaiTemuan = () => ({ id: ['S2'], status: 'cocok' });
  const keV1 = (a) => ({ file: a.file, baris: a.baris, cwe: a.cwe.join(', '), jenis: a.rule, penjelasan: a.pesan });
  const hasil = sumbu.gabungAlert({ sonar: DUA_SONAR, codeql: DUA_CQL, opsiKembar: { gt, nilaiTemuan, keV1 } });

  // Kembar ditemukan, dan hanya ke perkakas yang BERBEDA.
  const s1 = hasil.find((a) => a.id === 'SONAR-01');
  assert.deepEqual(s1.kembar_dengan, ['CQL-01', 'CQL-02']);
  for (const a of hasil) {
    for (const idKembar of a.kembar_dengan) {
      assert.notEqual(hasil.find((x) => x.id === idKembar).sumber_sast, a.sumber_sast);
    }
  }
  // Keduanya tetap alert tersendiri: jumlahnya tidak berkurang (keputusan K1).
  assert.equal(hasil.length, 4);
  // Dan tidak satu pun id ground truth maupun medan metadata bocor ke teks alert.
  for (const a of hasil) {
    const teks = render.formatAlert(a, template.alert.teks);
    assert.ok(!teks.includes('S2'), `${a.id}: id ground truth bocor ke teks alert`);
    assert.ok(!/kembar_dengan|sumber_sast/.test(teks), `${a.id}: metadata bocor ke teks alert`);
  }
});

// ---------- 4. Kombinasi yang ditolak ----------

test('sumbu sast: nilai yang didukung dan perkakas yang dipakai tiap nilai', () => {
  assert.deepEqual(sumbu.SAST_DIDUKUNG, ['sonar', 'codeql', 'keduanya']);
  assert.equal(sumbu.SAST_BAWAAN, 'sonar');
  assert.deepEqual(sumbu.perkakasUntuk('sonar'), ['sonar']);
  assert.deepEqual(sumbu.perkakasUntuk('codeql'), ['codeql']);
  assert.deepEqual(sumbu.perkakasUntuk('keduanya'), ['sonar', 'codeql']);
});

test('nilai sumbu sast di luar daftar ditolak', () => {
  for (const salah of ['SONAR', 'sonarcloud', '', 'dua', undefined]) {
    assert.throws(
      () => sumbu.periksaKombinasi({ sast: salah, skenario: 'B', kondisi: 'utama' }),
      /--sast harus sonar, codeql, keduanya/,
      `sast ${JSON.stringify(salah)}`,
    );
  }
});

test('K7: skenario C dengan codeql atau keduanya ditolak, dengan sebabnya', () => {
  for (const sast of ['codeql', 'keduanya']) {
    assert.throws(
      () => sumbu.periksaKombinasi({ sast, skenario: 'C', kondisi: 'utama' }),
      /Skenario C tidak memakai alert SAST sama sekali/,
      `sast ${sast}`,
    );
  }
  // Sonar tetap sah di C: itulah perilaku yang sudah ada.
  assert.doesNotThrow(() => sumbu.periksaKombinasi({ sast: 'sonar', skenario: 'C', kondisi: 'utama' }));
});

test('K7: kondisi sonar_di_deteksi dengan codeql atau keduanya ditunda, dengan sebabnya', () => {
  for (const sast of ['codeql', 'keduanya']) {
    assert.throws(
      () => sumbu.periksaKombinasi({ sast, skenario: 'B', kondisi: 'sonar_di_deteksi' }),
      /DITUNDA, bukan tidak mungkin/,
      `sast ${sast}`,
    );
  }
  assert.doesNotThrow(() => sumbu.periksaKombinasi({ sast: 'sonar', skenario: 'B', kondisi: 'sonar_di_deteksi' }));
});

test('kombinasi yang memang dipakai batch pertama diterima: A dan B pada kondisi utama', () => {
  for (const sast of sumbu.SAST_DIDUKUNG) {
    assert.doesNotThrow(() => sumbu.periksaKombinasi({ sast, skenario: 'B', kondisi: 'utama' }));
  }
  // Skenario A tidak pernah sampai ke alat ini, tetapi gerbangnya tidak boleh menolaknya.
  for (const sast of sumbu.SAST_DIDUKUNG) {
    assert.doesNotThrow(() => sumbu.periksaKombinasi({ sast, skenario: 'A', kondisi: 'utama' }));
  }
});
