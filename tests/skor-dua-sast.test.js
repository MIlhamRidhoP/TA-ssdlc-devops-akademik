// Pemetaan K6 pada penilaian dua perkakas. Yang dijaga di sini adalah satu cacat yang sangat mudah
// lolos: varian A `a_hanya_vulnerability` menyaring tipe === 'VULNERABILITY', dan nilai itu milik
// SonarCloud. Tanpa pemetaan, seluruh alert CodeQL lenyap dari varian itu TANPA SUARA, sementara
// varian b_filter_v2 tetap memuatnya, sehingga kedua varian A diam-diam mengukur hal yang berbeda.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.OBJEK_UJI_DIR = process.env.OBJEK_UJI_DIR
  ?? path.resolve(__dirname, '..', '..', 'objek-seeded');

const { PEMETAAN_K6, petakanK6 } = require('../scripts/sast/skor-dua-sast');

const sonar = (id, baris) => ({
  id, sumber: 'issue', sumber_sast: 'sonar', rule: 'jssecurity:S3649', tipe: 'VULNERABILITY',
  file: 'src/models/mahasiswaModel.js', baris, cwe: ['CWE-89'], pesan: 'SQLi', keamanan: true,
});
const codeql = (id, baris) => ({
  id, sumber: 'codeql', sumber_sast: 'codeql', rule: 'js/sql-injection', tipe: 'SECURITY',
  file: 'src/models/mahasiswaModel.js', baris, cwe: ['CWE-89'], pesan: 'SQLi', keamanan: true,
});

test('pemetaan K6 memberi tipe VULNERABILITY hanya pada alert CodeQL', () => {
  const asal = [sonar('SONAR-01', 59), codeql('CQL-01', 61)];
  const hasil = petakanK6(asal);

  const s = hasil.find((a) => a.id === 'SONAR-01');
  assert.deepEqual(s, asal[0], 'alert Sonar tidak boleh disentuh sama sekali');

  const c = hasil.find((a) => a.id === 'CQL-01');
  assert.equal(c.tipe, 'VULNERABILITY');
  // Nilai asalnya disimpan, bukan dibuang: pembaca harus bisa melihat apa yang dipetakan.
  assert.equal(c.tipe_asal, 'SECURITY');
  // Masukan tidak diubah di tempat.
  assert.equal(asal[1].tipe, 'SECURITY');
});

test('pemetaan dikenali dari medan sumber_sast maupun dari medan sumber', () => {
  // Dua jalan masuk, karena alert dari berkas beku membawa sumber: 'codeql' sedangkan alert yang
  // lewat penggabung membawa sumber_sast: 'codeql'. Keduanya harus tertangkap.
  const lewatSumber = petakanK6([{ ...codeql('CQL-01', 1), sumber_sast: undefined }]);
  assert.equal(lewatSumber[0].tipe, 'VULNERABILITY');
  const lewatSumberSast = petakanK6([{ ...codeql('CQL-02', 2), sumber: undefined }]);
  assert.equal(lewatSumberSast[0].tipe, 'VULNERABILITY');
});

test('tanpa pemetaan K6, seluruh alert CodeQL lenyap dari varian a_hanya_vulnerability', () => {
  // Inti cacatnya, dinyatakan sebagai angka. score.js tidak diubah; ia dipanggil apa adanya.
  const score = require('../scripts/llm/score');
  const { bacaGroundTruth } = require('../scripts/gemini-scan');
  const gt = bacaGroundTruth();
  const alert = [codeql('CQL-01', 59), codeql('CQL-02', 61)];

  const tanpa = score.skenarioA(alert, gt);
  assert.deepEqual(tanpa.a_hanya_vulnerability.alert, [], 'tanpa pemetaan, varian pertama harus kosong');
  assert.equal(tanpa.a_hanya_vulnerability.ketat.tp, 0);

  const dengan = score.skenarioA(petakanK6(alert), gt);
  assert.deepEqual(dengan.a_hanya_vulnerability.alert, ['CQL-01', 'CQL-02'], 'dengan pemetaan, keduanya ikut');
  assert.ok(dengan.a_hanya_vulnerability.ketat.tp > 0, 'dengan pemetaan, S1 tertangkap');

  // Varian kedua tidak memakai medan tipe, jadi ia sama dengan atau tanpa pemetaan.
  assert.deepEqual(dengan.b_filter_v2, tanpa.b_filter_v2, 'b_filter_v2 tidak boleh terpengaruh K6');
});

test('pemetaan K6 tidak menggeser angka lengan sonar-saja', () => {
  const score = require('../scripts/llm/score');
  const { bacaGroundTruth } = require('../scripts/gemini-scan');
  const gt = bacaGroundTruth();
  const alert = [sonar('SONAR-01', 59), sonar('SONAR-02', 61)];
  assert.deepEqual(score.skenarioA(petakanK6(alert), gt), score.skenarioA(alert, gt));
});

test('pemetaan K6 terdokumentasi di keluaran, bukan hanya di komentar kode', () => {
  // Keputusan K6 menyatakan pemetaan harus tercatat di dokumentasi DAN di keluaran skor, karena ia
  // mengubah angka. Tes ini menjaga bahwa penjelasannya tidak pernah hilang dari laporan.
  // `keputusan` adalah pengenal, bukan prosa, jadi ia tidak ikut diperiksa panjangnya.
  assert.equal(PEMETAAN_K6.keputusan, 'K6');
  for (const k of ['aturan', 'sebab', 'cara', 'terpengaruh']) {
    assert.equal(typeof PEMETAAN_K6[k], 'string', `pemetaan_k6.${k} harus ada`);
    assert.ok(PEMETAAN_K6[k].length > 20, `pemetaan_k6.${k} terlalu pendek untuk menerangkan apa pun`);
  }
  assert.match(PEMETAAN_K6.sebab, /score\.js:235/, 'sebab harus menunjuk baris yang menyaring tipe');
  assert.match(PEMETAAN_K6.cara, /tidak diubah/, 'cara harus menegaskan score.js tidak disentuh');
});

test('petakanK6 deterministik dan tidak bergantung urutan', () => {
  const alert = [codeql('CQL-02', 61), sonar('SONAR-01', 59), codeql('CQL-01', 1)];
  assert.deepEqual(petakanK6(alert), petakanK6(alert));
  assert.deepEqual(petakanK6([...alert]).map((a) => a.id), alert.map((a) => a.id), 'urutan tidak boleh berubah');
});
