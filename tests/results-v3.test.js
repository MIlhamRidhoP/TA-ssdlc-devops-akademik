// Skema 3: skema 2 ditambah sumbu `sast`. Tes ini menjaga tiga hal:
//
//   1. Skema 2 TIDAK dilonggarkan. Kalau pola id alert atau `severity_asal` di skema 2 ikut
//      dilebarkan agar alert CodeQL lolos di sana, ketujuh belas fixture lama berhenti menjadi
//      penjaga dan kesebandingan angka hilang tanpa suara.
//   2. Ketujuh belas fixture skema 2 tetap sah TANPA diubah.
//   3. Hasil skema 3 sah terhadap skema 3, dan run satu perkakas tidak mendapat medan baru apa pun.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { validasiSkema } = require('../scripts/validasi-skema');
const skemaV2 = require('../docs/design/results-v2.schema.json');
const skemaV3 = require('../docs/design/results-v3.schema.json');
const v3 = require('../scripts/llm/results-v3');

// Satu run nyata batch 22 Okt, satu perkakas. Dipakai sebagai dasar supaya yang diuji adalah data
// yang benar-benar pernah terbit, bukan bentuk karangan.
const dasarV2 = require('../dashboard/fixtures/v2/eksperimen/seeded/2211.json');

const CQL = {
  id: 'CQL-01',
  rule: 'js/sql-injection',
  tipe: 'SECURITY',
  sumber: 'codeql',
  file: 'src/models/mahasiswaModel.js',
  baris: 59,
  cwe: ['CWE-89'],
  pesan: 'This query depends on a user-provided value.',
  severity_sonar: '8.8',
  severity_asal: 'sonar',
  putusan: 'true_positive',
  putusan_asal: 'verifikasi-model',
  keyakinan: 'high',
  alasan: 'a',
  tanda: [],
};

// Alert masukan: daftar yang dipasang scripts/sast/sumbu-sast.js, pembawa sumber_sast.
const masukan = (kembar = false) => [
  ...dasarV2.alerts.map((a) => ({ id: a.id, sumber_sast: 'sonar', ...(kembar ? { kembar_dengan: ['CQL-01'] } : {}) })),
  { id: 'CQL-01', sumber_sast: 'codeql', ...(kembar ? { kembar_dengan: ['SONAR-05'] } : {}) },
];

const hasilV3 = ({ sast = 'keduanya', kembar = false } = {}) => ({
  ...dasarV2,
  schema_version: 3,
  run: v3.naikkanRun(dasarV2.run, { sast, codeqlBeku: sast === 'sonar' ? null : { nama: 'codeql-beku.json', sha256_isi: 'a'.repeat(64), jumlah_alert: 18 } }),
  alerts: v3.naikkanAlert([...dasarV2.alerts, CQL], masukan(kembar)),
});

// ---------- 1. Skema 2 tidak boleh dilonggarkan ----------

test('skema 2 tetap memaku versi 2, awalan SONAR, dan severity dari Sonar', () => {
  const A = skemaV2.properties.alerts.items.properties;
  assert.equal(skemaV2.properties.schema_version.const, 2);
  assert.equal(A.id.pattern, '^SONAR-[0-9]{2,}$');
  assert.deepEqual(A.sumber.enum, ['issue', 'hotspot']);
  assert.equal(A.severity_asal.const, 'sonar');
  assert.ok('severity_sonar' in A, 'skema 2 harus tetap memakai nama severity_sonar');
  assert.ok(!('sumber_sast' in A), 'skema 2 tidak boleh mengenal sumber_sast');
  assert.ok(!('sast' in skemaV2.properties.run.properties), 'skema 2 tidak boleh mengenal run.sast');
});

test('skema 3 memakai pola id berawalan perkakas dan severity dua perkakas', () => {
  const A = skemaV3.properties.alerts.items.properties;
  assert.equal(skemaV3.properties.schema_version.const, 3);
  assert.equal(A.id.pattern, '^[A-Z]+-[0-9]{2,}$');
  assert.deepEqual(A.sumber.enum, ['issue', 'hotspot', 'codeql']);
  assert.deepEqual(A.severity_asal.enum, ['sonar', 'codeql']);
  assert.ok('severity' in A && !('severity_sonar' in A), 'skema 3 memakai severity, bukan severity_sonar');
  assert.deepEqual(skemaV3.properties.run.properties.sast.enum, ['sonar', 'codeql', 'keduanya']);
});

// ---------- 2. Fixture skema 2 tetap sah tanpa diubah ----------

test('ketujuh belas fixture skema 2 tetap sah terhadap skema 2', () => {
  const dir = path.join(ROOT, 'dashboard', 'fixtures', 'v2');
  const berkas = [];
  const telusur = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) telusur(p);
      else if (e.name.endsWith('.json') && e.name !== 'index.json' && !p.includes('rekaman')) berkas.push(p);
    }
  };
  telusur(dir);
  assert.equal(berkas.length, 17, `fixture hasil skema 2 ada ${berkas.length}, diharapkan 17`);
  for (const p of berkas) {
    const isi = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(isi.schema_version, 2, path.basename(p));
    assert.deepEqual(validasiSkema(skemaV2, isi), [], `${path.basename(p)} harus sah terhadap skema 2`);
  }
});

test('hasil skema 3 TIDAK sah terhadap skema 2, dan sebaliknya', () => {
  assert.notEqual(validasiSkema(skemaV2, hasilV3()).length, 0, 'skema 2 harus menolak hasil skema 3');
  assert.notEqual(validasiSkema(skemaV3, dasarV2).length, 0, 'skema 3 harus menolak hasil skema 2');
});

// ---------- 3. Hasil skema 3 ----------

test('hasil skema 3 sah terhadap skema 3', () => {
  assert.deepEqual(validasiSkema(skemaV3, hasilV3()), []);
  assert.deepEqual(validasiSkema(skemaV3, hasilV3({ kembar: true })), []);
});

test('run satu perkakas tidak mendapat medan baru apa pun', () => {
  const run = v3.naikkanRun(dasarV2.run, { sast: 'sonar', codeqlBeku: null });
  assert.deepEqual(Object.keys(run), Object.keys(dasarV2.run));
  assert.ok(!('sast' in run) && !('codeql_beku' in run));
  // Juga saat sast tidak disebut sama sekali.
  assert.deepEqual(Object.keys(v3.naikkanRun(dasarV2.run, {})), Object.keys(dasarV2.run));
});

test('severity_sonar menjadi severity, dan severity_asal mengikuti perkakasnya', () => {
  const alerts = v3.naikkanAlert([...dasarV2.alerts, CQL], masukan());
  for (const a of alerts) {
    assert.ok(!('severity_sonar' in a), `${a.id} masih memakai severity_sonar`);
    assert.ok('severity' in a, `${a.id} tidak punya severity`);
  }
  const sonar = alerts.find((a) => a.id === 'SONAR-01');
  const cql = alerts.find((a) => a.id === 'CQL-01');
  assert.equal(sonar.severity, dasarV2.alerts.find((a) => a.id === 'SONAR-01').severity_sonar);
  assert.equal(sonar.severity_asal, 'sonar');
  assert.equal(sonar.sumber_sast, 'sonar');
  // severity_asal alert CodeQL diturunkan dari perkakasnya, bukan disalin dari masukan yang salah.
  assert.equal(cql.severity_asal, 'codeql');
  assert.equal(cql.sumber_sast, 'codeql');
  assert.equal(cql.severity, '8.8');
});

test('kembar_dengan hanya muncul kalau memang ada di masukan', () => {
  for (const a of v3.naikkanAlert([...dasarV2.alerts, CQL], masukan(false))) {
    assert.ok(!('kembar_dengan' in a), `${a.id} tidak boleh membawa kembar_dengan`);
  }
  const dengan = v3.naikkanAlert([...dasarV2.alerts, CQL], masukan(true));
  assert.deepEqual(dengan.find((a) => a.id === 'CQL-01').kembar_dengan, ['SONAR-05']);
});

test('alert tanpa entri di masukan dianggap berasal dari sonar', () => {
  // Jaring untuk kasus batas: daftar masukan tidak lengkap tidak boleh menghasilkan
  // sumber_sast undefined, yang akan ditolak skema dengan pesan yang membingungkan.
  const alerts = v3.naikkanAlert(dasarV2.alerts, []);
  for (const a of alerts) {
    assert.equal(a.sumber_sast, 'sonar', a.id);
    assert.equal(a.severity_asal, 'sonar', a.id);
  }
});

test('uji negatif: bentuk yang harus ditolak skema 3', () => {
  const rusak = (ubah) => {
    const d = JSON.parse(JSON.stringify(hasilV3()));
    ubah(d);
    return validasiSkema(skemaV3, d);
  };
  // Pesan galat validator berbahasa Indonesia; polanya disamakan dengan scripts/validasi-skema.js.
  assert.match(rusak((d) => { d.alerts[0].id = 'sonar-01'; })[0], /tidak cocok pola/);
  assert.match(rusak((d) => { d.alerts[0].id = 'SONAR01'; })[0], /tidak cocok pola/);
  assert.match(rusak((d) => { d.alerts[0].id = 'CQL-1'; })[0], /tidak cocok pola/);
  assert.match(rusak((d) => { d.alerts[0].severity_asal = 'semgrep'; })[0], /harus salah satu \["sonar","codeql"\]/);
  assert.match(rusak((d) => { d.alerts[0].sumber_sast = 'semgrep'; })[0], /harus salah satu/);
  assert.match(rusak((d) => { d.run.sast = 'ketiganya'; })[0], /harus salah satu/);
  assert.match(rusak((d) => { d.alerts[0].kembar_dengan = ['sonar-02']; })[0], /tidak cocok pola/);
  assert.match(rusak((d) => { d.run.codeql_beku = { nama: 'x', sha256_isi: 'bukan-hash', jumlah_alert: 1 }; })[0], /tidak cocok pola/);
  assert.match(rusak((d) => { d.schema_version = 2; })[0], /harus 3/);
  assert.match(rusak((d) => { d.alerts[0].severity_sonar = 'BLOCKER'; })[0], /tidak dikenal/);
});

test('entriIndexV3 menambah hitungan per perkakas hanya pada run dua perkakas', () => {
  const dua = v3.entriIndexV3(hasilV3(), 'eksperimen/seeded/9001.json');
  assert.equal(dua.sast, 'keduanya');
  assert.deepEqual(dua.jumlah_alert_per_sast, { sonar: 5, codeql: 1 });
  assert.equal(dua.jumlah.alert, 6);

  const satu = v3.entriIndexV3({ ...hasilV3({ sast: 'sonar' }), run: dasarV2.run }, 'eksperimen/seeded/2211.json');
  assert.ok(!('sast' in satu), 'run satu perkakas tidak boleh membawa sast di index');
  assert.ok(!('jumlah_alert_per_sast' in satu));
});

// ---------- Bentuk masukan nyata dari llm-scan ----------

test('severity alert CodeQL dibaca dari severity_codeql, dan alert Sonar tidak tersentuh', () => {
  // Alert CodeQL dari berkas beku membawa severity_codeql, bukan severity. Perakit skema 2 hanya
  // membaca `severity`, jadi tanpa pembacaan ini setiap alert CodeQL berseverity null.
  const dasar = [
    { id: 'SONAR-01', severity_sonar: 'BLOCKER', severity_asal: 'sonar' },
    { id: 'CQL-01', severity_sonar: null, severity_asal: 'sonar' },
    { id: 'CQL-02', severity_sonar: null, severity_asal: 'sonar' },
  ];
  const masukan = [
    { id: 'SONAR-01', sumber_sast: 'sonar' },
    { id: 'CQL-01', sumber_sast: 'codeql', severity_codeql: '7.5' },
    { id: 'CQL-02', sumber_sast: 'codeql' }, // tanpa severity sama sekali: null, bukan undefined
  ];
  const hasil = Object.fromEntries(v3.naikkanAlert(dasar, masukan).map((a) => [a.id, a]));
  assert.equal(hasil['SONAR-01'].severity, 'BLOCKER');
  assert.equal(hasil['CQL-01'].severity, '7.5');
  assert.equal(hasil['CQL-02'].severity, null);
  // Severity CodeQL tidak boleh bocor ke alert Sonar yang kebetulan tidak punya severity.
  const sonarKosong = v3.naikkanAlert([{ id: 'SONAR-09', severity_sonar: null }],
    [{ id: 'SONAR-09', sumber_sast: 'sonar', severity_codeql: '9.9' }]);
  assert.equal(sonarKosong[0].severity, null, 'alert Sonar tidak boleh mengambil severity_codeql');
});

test('run.codeql_beku hanya memuat medan yang dikenal skema 3', () => {
  // Info yang dicatat llm-scan memuat lima medan; skema 3 mengenal tiga. Meneruskan seluruh objek
  // menghasilkan berkas yang tidak sah, seperti sonar_beku di skema 2 yang juga dipilih medannya.
  const info = {
    nama: 'codeql-beku.json', sha256_file: 'b'.repeat(64), sha256_isi: 'a'.repeat(64),
    jumlah_alert: 18, dibuat: '2026-10-26T02:48:55.621Z',
  };
  const run = v3.naikkanRun({}, { sast: 'keduanya', codeqlBeku: info });
  assert.deepEqual(run.codeql_beku, { nama: 'codeql-beku.json', sha256_isi: 'a'.repeat(64), jumlah_alert: 18 });
  assert.equal(v3.naikkanRun({}, { sast: 'keduanya', codeqlBeku: null }).codeql_beku, null);
  // Run satu perkakas tetap tidak mendapat medan baru apa pun.
  assert.deepEqual(v3.naikkanRun({ a: 1 }, { sast: 'sonar', codeqlBeku: info }), { a: 1 });
  const sah = validasiSkema(skemaV3, { ...hasilV3(), run: { ...hasilV3().run, codeql_beku: run.codeql_beku } });
  assert.deepEqual(sah, [], 'hasil dengan codeql_beku terpilih harus sah terhadap skema 3');
});
