// Tes jalur v2: skema results-v2, pemetaan putusan verifikasi, sidik jari temuan, dan blok eksperimen.
// Berkas skor sumber dibaca dari branch eksperimen/seeded lewat `git show`, jadi tes tetap mandiri
// di dalam repo ini tanpa bergantung pada worktree objek uji yang kebetulan ada di sebelah.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const { validasiSkema } = require('../scripts/validasi-skema');
const { parseCwe } = require('../scripts/merge-results');
const {
  sidikJariTemuan, putusanSah, petakanTemuan, petakanAlert, susunEksperimen, entriIndexV2, rataRata,
} = require('../scripts/llm/results-v2');

const ROOT = path.resolve(__dirname, '..');
const acuan = require('./fixtures/acuan-skor-20261019.json');
const skemaV2 = require('../docs/design/results-v2.schema.json');
const skemaV1 = require('../docs/design/results.schema.json');
const fixtureV2 = [1, 2, 3].map((n) => require(`../dashboard/fixtures/v2/eksperimen/seeded/${n}.json`));
// Rekaman run CI #54: hasil yang benar-benar terbit, dipakai mode demo untuk menggambar graf
// pipeline. Ikut diperiksa di sini supaya index demo dan berkasnya tidak pernah berbeda.
// Fixture contoh lapis 2: alert dan temuan run #54 ditambah saran yang disusun sendiri sebagai
// contoh. Ikut diperiksa supaya index demo dan berkasnya tidak pernah berbeda.
// Fixture contoh mode gabungan dan skenario C ikut diperiksa dengan aturan yang sama: keduanya
// berkas demo, tetapi bentuknya harus persis sama dengan yang dihasilkan pipeline sungguhan.
const fixtureSemua = [
  ...fixtureV2,
  require('../dashboard/fixtures/v2/feat/prompt-v2/54.json'),
  require('../dashboard/fixtures/v2/contoh/rekomendasi-ai.json'),
  require('../dashboard/fixtures/v2/contoh/gabungan.json'),
  require('../dashboard/fixtures/v2/contoh/skenario-c.json'),
];
const indexV2 = require('../dashboard/fixtures/v2/index.json');

// Berkas skor hidup di branch lain. Runner CI hanya mengambil satu branch, jadi `git show` tidak
// selalu bisa. Angkanya karena itu disalin ke tests/fixtures/acuan-skor-20261019.json beserta
// provenance (commit, path, sha256). Bila branch kebetulan tersedia, acuan ikut dilintas-periksa
// supaya tidak bisa menyimpang diam-diam dari sumbernya.
const DIR_SKOR = `${acuan.sumber.branch}:${acuan.sumber.dir}`;
const bacaSkorMentah = (nama) => execFileSync('git', ['-C', ROOT, 'show', `${DIR_SKOR}/${nama}`], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const skorTersedia = (() => {
  try {
    execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', acuan.sumber.branch], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
})();

// ---------- Skema ----------

test('fixture v2 sah terhadap skema v2, dan fixture v1 tetap sah terhadap skema v1', () => {
  for (const [i, f] of fixtureV2.entries()) {
    assert.deepEqual(validasiSkema(skemaV2, f), [], `fixture v2 #${i + 1} harus sah`);
    assert.equal(f.schema_version, 2);
  }
  for (const n of [1, 2, 3]) {
    const v1 = require(`../docs/arsip/pilot-20261010/eksperimen/seeded/${n}.json`);
    assert.deepEqual(validasiSkema(skemaV1, v1), [], `fixture v1 #${n} harus tetap sah`);
  }
  // Fixture v1 tidak boleh lolos skema v2 dan sebaliknya: keduanya memang tidak kompatibel.
  assert.notEqual(validasiSkema(skemaV2, require('../docs/arsip/pilot-20261010/eksperimen/seeded/3.json')).length, 0);
  assert.notEqual(validasiSkema(skemaV1, fixtureV2[0]).length, 0);
});

test('validator menolak cacat yang disengaja di hasil v2', () => {
  const rusak = (ubah) => {
    const d = JSON.parse(JSON.stringify(fixtureV2[0]));
    ubah(d);
    return validasiSkema(skemaV2, d);
  };
  assert.match(rusak((d) => { d.alerts[0].putusan = 'mungkin'; })[0], /putusan/);
  assert.match(rusak((d) => { d.alerts[0].severity_asal = 'tebakan'; })[0], /severity_asal/);
  assert.match(rusak((d) => { d.findings[0].sifat = 'lainnya'; })[0], /sifat/);
  assert.match(rusak((d) => { d.findings[0].fingerprint = 'xyz'; })[0], /fingerprint/);
  assert.match(rusak((d) => { delete d.findings[0].id; })[0], /field wajib "id"/);
  assert.match(rusak((d) => { d.run.vendor = 'vendor-lain'; })[0], /vendor/);
  assert.match(rusak((d) => { d.run.tambahan = 1; })[0], /tidak dikenal/);
  assert.match(rusak((d) => { d.schema_version = 1; })[0], /harus 2/);
});

// ---------- Pemetaan putusan ----------

const alertContoh = [{ id: 'SONAR-01', rule: 'r', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/a.js', baris: 2, cwe: ['CWE-89'], pesan: 'p', severity: 'BLOCKER' }];
const ver = (ubah = {}) => ({
  id_alert: 'SONAR-01', putusan: 'false_positive', keyakinan: 'high', alasan: 'a', tanda: [],
  metadata: { status: 'ok', parse_ok: true }, ...ubah,
});

test('putusan alert berasal dari putusan model, dan putusan tidak sah menjadi null', () => {
  const sah = petakanAlert(alertContoh, [ver()])[0];
  assert.equal(sah.putusan, 'false_positive');
  assert.equal(sah.putusan_asal, 'verifikasi-model');
  assert.equal(sah.keyakinan, 'high');
  assert.equal(sah.alasan, 'a');
  // Severity tetap apa adanya dari Sonar, tidak diterjemahkan dan tidak ditebak ulang.
  assert.equal(sah.severity_sonar, 'BLOCKER');
  assert.equal(sah.severity_asal, 'sonar');

  const tidakSah = [
    ['panggilan error', ver({ metadata: { status: 'error', parse_ok: true } })],
    ['parse gagal', ver({ metadata: { status: 'ok', parse_ok: false } })],
    ['enum tidak valid', ver({ putusan: 'mungkin' })],
    ['ditandai nilai_tidak_valid', ver({ tanda: ['nilai_tidak_valid'] })],
    ['putusan kosong', ver({ putusan: null })],
  ];
  for (const [nama, v] of tidakSah) {
    const a = petakanAlert(alertContoh, [v])[0];
    assert.equal(a.putusan, null, `${nama}: putusan harus null`);
    assert.equal(a.putusan_asal, null, `${nama}: putusan_asal harus null`);
    assert.equal(a.alasan, null, `${nama}: alasan tidak dipakai bila putusan tidak sah`);
    assert.equal(putusanSah(v), false, nama);
  }
  // Alert tanpa entri verifikasi sama sekali.
  const tanpa = petakanAlert(alertContoh, [])[0];
  assert.equal(tanpa.putusan, null);
  assert.equal(tanpa.putusan_asal, null);

  // uncertain adalah putusan sah tersendiri, bukan kegagalan.
  const unc = petakanAlert(alertContoh, [ver({ putusan: 'uncertain' })])[0];
  assert.equal(unc.putusan, 'uncertain');
  assert.equal(unc.putusan_asal, 'verifikasi-model');
});

// ---------- Sidik jari ----------

test('sidik jari temuan: 16 heksa, stabil, dan berubah saat file, baris, cwe, atau jenis berubah', () => {
  const t = { file: 'src/a.js', baris: 10, jenis: 'SQL Injection' };
  const dasar = sidikJariTemuan(t, ['CWE-89']);
  assert.match(dasar, /^[0-9a-f]{16}$/);
  assert.equal(sidikJariTemuan({ ...t }, ['CWE-89']), dasar, 'harus stabil');
  // Urutan CWE tidak boleh mengubah sidik jari.
  assert.equal(sidikJariTemuan(t, ['CWE-89', 'CWE-20']), sidikJariTemuan(t, ['CWE-20', 'CWE-89']));
  // Huruf besar-kecil jenis tidak mengubah sidik jari (mengikuti aturan v1).
  assert.equal(sidikJariTemuan({ ...t, jenis: 'sql injection' }, ['CWE-89']), dasar);
  for (const beda of [{ file: 'src/b.js' }, { baris: 11 }, { jenis: 'XSS' }]) {
    assert.notEqual(sidikJariTemuan({ ...t, ...beda }, ['CWE-89']), dasar, `harus berubah untuk ${JSON.stringify(beda)}`);
  }
  assert.notEqual(sidikJariTemuan(t, ['CWE-20']), dasar, 'harus berubah untuk cwe berbeda');
});

test('pemetaan temuan: id berurutan, cwe jadi array, sifat dan keyakinan tervalidasi', () => {
  const f = petakanTemuan([
    { file: 'src/a.js', baris: 1, fungsi: 'x', jenis: 'SQLi', cwe: 'CWE-89, CWE-90', kategori_owasp: 'A03', penjelasan: 'p', sifat: 'vulnerability', keyakinan: 'high', tanda: [] },
    { file: 'src/b.js', baris: 2, jenis: 'Rate limit', cwe: '', sifat: 'hardening', keyakinan: 'medium' },
  ], parseCwe);
  assert.deepEqual(f.map((x) => x.id), ['T-01', 'T-02']);
  assert.deepEqual(f[0].cwe, ['CWE-89', 'CWE-90']);
  assert.deepEqual(f[1].cwe, []);
  assert.equal(f[1].sifat, 'hardening');
  assert.equal(f[1].fungsi, null);
  assert.equal(f[0].fingerprint, sidikJariTemuan({ file: 'src/a.js', baris: 1, jenis: 'SQLi' }, ['CWE-89', 'CWE-90']));
  // Temuan v2 tidak punya severity sama sekali.
  assert.ok(!('severity' in f[0]), 'temuan v2 tidak boleh punya severity');
});

// ---------- Blok eksperimen: harus identik dengan berkas skor sumber ----------

test('blok eksperimen di fixture identik dengan acuan angka skor', () => {
  for (const fix of fixtureV2) {
    const eks = fix.eksperimen;
    assert.ok(eks, 'blok eksperimen harus ada di fixture');
    assert.equal(eks.sumber.commit_kode_scoring, acuan.commit_kode_scoring);
    assert.equal(eks.sumber.aturan_hardening, acuan.aturan_hardening);
    assert.equal(eks.sumber.objek_uji_commit, acuan.objek_uji_commit);
    assert.equal(eks.per_model.length, acuan.per_model.length);

    // Label SONAR-03 berbeda antara analisis utama dan sensitivitas; keduanya harus terbawa.
    assert.equal(eks.label_alert['SONAR-03'].label, acuan.label_alert['SONAR-03'].label);
    assert.equal(eks.label_alert_sensitivitas['SONAR-03'].label, acuan.label_alert_sensitivitas['SONAR-03'].label);
    assert.notEqual(eks.label_alert['SONAR-03'].label, eks.label_alert_sensitivitas['SONAR-03'].label);

    for (const m of acuan.per_model) {
      const got = eks.per_model.find((x) => x.vendor === m.vendor);
      assert.ok(got, `vendor ${m.vendor} ada di fixture`);
      assert.equal(got.model, m.model);
      assert.equal(got.jumlah_run, m.jumlah_run);
      assert.deepEqual(got.skenario_a, m.skenario_a, `${m.vendor} skenario A`);

      for (const r of m.runs) {
        const gr = got.runs.find((x) => x.run === r.run);
        assert.ok(gr, `${m.vendor} run ${r.run} ada`);
        for (const sk of ['skenario_b', 'skenario_c']) {
          assert.deepEqual(gr[sk].ketat, r[sk].ketat, `${m.vendor} run ${r.run} ${sk} ketat`);
          assert.deepEqual(gr[sk].triase_utama, r[sk].triase_utama, `${m.vendor} run ${r.run} ${sk} triase utama`);
          assert.deepEqual(gr[sk].triase_konservatif, r[sk].triase_konservatif, `${m.vendor} run ${r.run} ${sk} triase konservatif`);
        }
        assert.deepEqual(gr.verifikasi.jumlah, r.verifikasi.jumlah, `${m.vendor} run ${r.run} verifikasi`);
        assert.deepEqual(gr.verifikasi.metrik_fp_positif, r.verifikasi.metrik_fp_positif);
        assert.deepEqual(gr.verifikasi.sensitivitas.jumlah, r.verifikasi.sensitivitas.jumlah, `${m.vendor} run ${r.run} sensitivitas`);
        assert.deepEqual(gr.verifikasi.sensitivitas.metrik_fp_positif, r.verifikasi.sensitivitas.metrik_fp_positif);
      }

      // rata_rata ketat disalin; rata_rata triase dihitung dengan aturan rataRata yang sama dengan score.js.
      for (const sk of ['skenario_b', 'skenario_c']) {
        assert.equal(got.rata_rata[sk].ketat.precision, m.rata_rata[sk].precision, `${m.vendor} ${sk} rata ketat precision`);
        assert.equal(got.rata_rata[sk].ketat.recall, m.rata_rata[sk].recall);
        assert.equal(got.rata_rata[sk].ketat.f1, m.rata_rata[sk].f1);
        for (const varian of ['triase_utama', 'triase_konservatif']) {
          const nilai = (k) => rataRata(m.runs.map((x) => x[sk][varian][k]));
          assert.equal(got.rata_rata[sk][varian].precision, nilai('precision'), `${m.vendor} ${sk} rata ${varian} precision`);
          assert.equal(got.rata_rata[sk][varian].f1, nilai('f1'));
        }
      }
    }
  }
});

test('acuan angka skor masih cocok dengan berkas skor aslinya', (t) => {
  if (!skorTersedia) {
    t.skip(`branch ${acuan.sumber.branch} tidak tersedia di klon ini; perbandingan dengan acuan sudah dilakukan di tes sebelumnya`);
    return;
  }
  // sha256 tiap berkas sumber harus sama dengan yang tercatat saat acuan dibuat.
  for (const [nama, sha] of Object.entries(acuan.sumber.sha256)) {
    const kini = crypto.createHash('sha256').update(bacaSkorMentah(nama)).digest('hex');
    assert.equal(kini, sha, `${nama} berubah sejak acuan dibuat; jalankan ulang scripts/buat-acuan-skor.js`);
  }
  // Dan angkanya benar-benar sama, bukan hanya hash berkasnya.
  const utama = JSON.parse(bacaSkorMentah('skor-utama.json'));
  for (const m of acuan.per_model) {
    const sumber = utama.utama.per_model.find((x) => x.vendor === m.vendor);
    assert.equal(sumber.model, m.model);
    for (const r of m.runs) {
      const rs = sumber.runs.find((x) => x.run === r.run);
      const k = rs.skenario_b.ketat;
      assert.deepEqual(r.skenario_b.ketat, { tp: k.tp, fp: k.fp, fn: k.fn, precision: k.precision, recall: k.recall, f1: k.f1 },
        `${m.vendor} run ${r.run} skenario_b ketat di acuan`);
      assert.deepEqual(r.verifikasi.jumlah, rs.verifikasi.jumlah);
    }
  }
});

test('susunEksperimen tanpa berkas triase tetap menghasilkan varian ketat saja', (t) => {
  if (!skorTersedia) { t.skip(`branch ${acuan.sumber.branch} tidak tersedia di klon ini`); return; }
  const utama = JSON.parse(bacaSkorMentah('skor-utama.json'));
  const eks = susunEksperimen({ utama, triaseUtama: null, triaseKonservatif: null, sumber: { skor_utama: 'skor-utama.json' } });
  const r = eks.per_model[0].runs[0];
  assert.ok(r.skenario_b.ketat, 'ketat tetap ada');
  assert.equal(r.skenario_b.triase_utama, undefined, 'tanpa berkas triase, varian triase tidak dikarang');
  assert.equal(eks.per_model[0].rata_rata.skenario_b.triase_utama, undefined);
  assert.equal(eks.sumber.skor_triase_utama, null);
  assert.deepEqual(validasiSkema(skemaV2, { ...fixtureV2[0], eksperimen: eks }), []);
});

// ---------- Index ----------

test('metadata analisis Sonar tercatat, dan tree src-nya sama dengan objek uji', () => {
  for (const f of fixtureV2) {
    const a = f.run.analisis_sonar;
    assert.ok(a, 'run.analisis_sonar harus ada');
    assert.match(a.revisi, /^[0-9a-f]{40}$/, 'revisi analisis Sonar tercatat');
    // Inilah jaminan bahwa data Sonar cocok dengan kode yang dianalisis; aturan yang sama
    // dipakai llm-scan dan oleh gerbang kesiapan di workflow.
    assert.equal(a.tree_src, f.run.objek_uji.tree_src,
      'hash tree src analisis Sonar harus sama dengan objek uji');
  }
});

test('index v2 konsisten dengan fixture yang ditunjuknya', () => {
  assert.equal(indexV2.schema_version, 2);
  assert.equal(indexV2.runs.length, fixtureSemua.length);
  for (const e of indexV2.runs) {
    const fix = fixtureSemua.find((f) => f.run.nomor === e.nomor);
    assert.ok(fix, `fixture untuk run ${e.nomor} ada`);
    assert.deepEqual(entriIndexV2(fix, e.path), e, `entri index run ${e.nomor} harus cocok dengan fixture`);
    assert.equal(e.jumlah.alert, fix.alerts.length);
    assert.equal(e.jumlah.temuan, fix.findings.length);
    // Jumlah putusan di index harus cocok dengan isi alerts.
    // putusan_gabungan dibaca lebih dulu: mode gabungan mengosongkan putusan saat tidak sepakat,
    // dan index harus menghitungnya terpisah, bukan sebagai panggilan yang gagal.
    const n = (p) => fix.alerts.filter((a) => (a.putusan_gabungan ?? a.putusan) === p).length;
    assert.equal(e.jumlah.true_positive, n('true_positive'));
    assert.equal(e.jumlah.false_positive, n('false_positive'));
    assert.equal(e.jumlah.uncertain, n('uncertain'));
    assert.equal(e.jumlah.tidak_sepakat, n('tidak_sepakat'));
    assert.equal(e.jumlah.tanpa_putusan, n(null));
  }
  // Tiga vendor berbeda di eksperimen, supaya tab Operasional bisa membandingkan model.
  assert.equal(new Set(indexV2.runs.filter((r) => r.branch === 'eksperimen/seeded').map((r) => r.vendor)).size, 3);
});
