// Tes jalur v2: skema results-v2, pemetaan putusan verifikasi, sidik jari temuan, dan blok eksperimen.
// Berkas skor sumber dibaca dari branch eksperimen/seeded lewat `git show`, jadi tes tetap mandiri
// di dalam repo ini tanpa bergantung pada worktree objek uji yang kebetulan ada di sebelah.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const { validasiSkema } = require('../scripts/validasi-skema');
const { parseCwe } = require('../scripts/merge-results');
const {
  sidikJariTemuan, putusanSah, petakanTemuan, petakanAlert, susunEksperimen, entriIndexV2, rataRata,
} = require('../scripts/llm/results-v2');

const ROOT = path.resolve(__dirname, '..');
const skemaV2 = require('../docs/design/results-v2.schema.json');
const skemaV1 = require('../docs/design/results.schema.json');
const fixtureV2 = [1, 2, 3].map((n) => require(`../dashboard/fixtures/v2/eksperimen/seeded/${n}.json`));
const indexV2 = require('../dashboard/fixtures/v2/index.json');

const DIR_SKOR = 'eksperimen/seeded:hasil-eksperimen/20261019';
const bacaSkor = (nama) => JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${DIR_SKOR}/${nama}`], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}));

// ---------- Skema ----------

test('fixture v2 sah terhadap skema v2, dan fixture v1 tetap sah terhadap skema v1', () => {
  for (const [i, f] of fixtureV2.entries()) {
    assert.deepEqual(validasiSkema(skemaV2, f), [], `fixture v2 #${i + 1} harus sah`);
    assert.equal(f.schema_version, 2);
  }
  for (const n of [1, 2, 3]) {
    const v1 = require(`../dashboard/fixtures/eksperimen/seeded/${n}.json`);
    assert.deepEqual(validasiSkema(skemaV1, v1), [], `fixture v1 #${n} harus tetap sah`);
  }
  // Fixture v1 tidak boleh lolos skema v2 dan sebaliknya: keduanya memang tidak kompatibel.
  assert.notEqual(validasiSkema(skemaV2, require('../dashboard/fixtures/eksperimen/seeded/3.json')).length, 0);
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

test('blok eksperimen menyalin angka apa adanya dari berkas skor', () => {
  const utama = bacaSkor('skor-utama.json');
  const triase = bacaSkor('skor-setelah-triase.json');
  const kons = bacaSkor('skor-setelah-triase-konservatif.json');
  const sens = bacaSkor('skor-sensitivitas-sonar03.json');

  for (const fix of fixtureV2) {
    const eks = fix.eksperimen;
    assert.ok(eks, 'blok eksperimen harus ada di fixture');
    assert.equal(eks.sumber.commit_kode_scoring, utama.commit_kode_scoring.head);
    // Label SONAR-03 berbeda antara analisis utama dan analisis sensitivitas; keduanya harus terbawa.
    assert.equal(eks.label_alert['SONAR-03'].label, utama.utama.label_alert['SONAR-03'].label);
    assert.equal(eks.label_alert_sensitivitas['SONAR-03'].label, sens.utama.label_alert['SONAR-03'].label);
    assert.notEqual(eks.label_alert['SONAR-03'].label, eks.label_alert_sensitivitas['SONAR-03'].label);
    assert.equal(eks.sumber.aturan_hardening, utama.aturan_hardening);
    assert.equal(eks.per_model.length, utama.utama.per_model.length);

    for (const m of eks.per_model) {
      const sumber = utama.utama.per_model.find((x) => x.vendor === m.vendor);
      assert.ok(sumber, `vendor ${m.vendor} ada di skor sumber`);
      assert.equal(m.model, sumber.model);
      assert.equal(m.jumlah_run, sumber.runs.length);

      // Skenario A: disalin dari skenario_a.b_filter_v2.ketat (sama untuk semua model).
      const a = utama.utama.skenario_a.b_filter_v2.ketat;
      assert.deepEqual(m.skenario_a, { tp: a.tp, fp: a.fp, fn: a.fn, precision: a.precision, recall: a.recall, f1: a.f1 });

      for (const r of m.runs) {
        const rs = sumber.runs.find((x) => x.run === r.run);
        const rt = triase.utama.per_model.find((x) => x.vendor === m.vendor).runs.find((x) => x.run === r.run);
        const rk = kons.utama.per_model.find((x) => x.vendor === m.vendor).runs.find((x) => x.run === r.run);

        for (const sk of ['skenario_b', 'skenario_c']) {
          const k = rs[sk].ketat;
          assert.deepEqual(r[sk].ketat, { tp: k.tp, fp: k.fp, fn: k.fn, precision: k.precision, recall: k.recall, f1: k.f1 },
            `${m.vendor} run ${r.run} ${sk} ketat harus identik`);

          const tu = rt[sk].setelah_triase;
          assert.equal(r[sk].triase_utama.varian, 'utama');
          assert.equal(r[sk].triase_utama.fp, tu.fp, `${m.vendor} run ${r.run} ${sk} fp triase utama`);
          assert.equal(r[sk].triase_utama.precision, tu.precision);
          assert.equal(r[sk].triase_utama.recall, tu.recall);
          assert.equal(r[sk].triase_utama.f1, tu.f1);
          assert.deepEqual(r[sk].triase_utama.rincian_triase, tu.rincian_triase);

          const tk = rk[sk].setelah_triase;
          assert.equal(r[sk].triase_konservatif.varian, 'konservatif');
          assert.equal(r[sk].triase_konservatif.fp, tk.fp, `${m.vendor} run ${r.run} ${sk} fp triase konservatif`);
          assert.equal(r[sk].triase_konservatif.precision, tk.precision);
        }

        // Verifikasi empat kategori disalin apa adanya.
        assert.deepEqual(r.verifikasi.jumlah, rs.verifikasi.jumlah, `${m.vendor} run ${r.run} verifikasi`);
        assert.deepEqual(r.verifikasi.metrik_fp_positif, rs.verifikasi.metrik_fp_positif);

        // Varian sensitivitas SONAR-03 juga disalin apa adanya, dari berkas skor sensitivitas.
        const rsen = sens.utama.per_model.find((x) => x.vendor === m.vendor).runs.find((x) => x.run === r.run);
        assert.deepEqual(r.verifikasi.sensitivitas.jumlah, rsen.verifikasi.jumlah, `${m.vendor} run ${r.run} verifikasi sensitivitas`);
        assert.deepEqual(r.verifikasi.sensitivitas.metrik_fp_positif, rsen.verifikasi.metrik_fp_positif);
      }

      // rata_rata ketat disalin; rata_rata triase dihitung dengan aturan rataRata yang sama dengan score.js.
      for (const sk of ['skenario_b', 'skenario_c']) {
        assert.equal(m.rata_rata[sk].ketat.precision, sumber.rata_rata[sk].precision, `${m.vendor} ${sk} rata ketat precision`);
        assert.equal(m.rata_rata[sk].ketat.recall, sumber.rata_rata[sk].recall);
        assert.equal(m.rata_rata[sk].ketat.f1, sumber.rata_rata[sk].f1);
        for (const [varian, lap] of [['triase_utama', triase], ['triase_konservatif', kons]]) {
          const runs = lap.utama.per_model.find((x) => x.vendor === m.vendor).runs;
          assert.equal(m.rata_rata[sk][varian].precision, rataRata(runs.map((x) => x[sk].setelah_triase.precision)),
            `${m.vendor} ${sk} rata ${varian} precision`);
          assert.equal(m.rata_rata[sk][varian].f1, rataRata(runs.map((x) => x[sk].setelah_triase.f1)));
        }
      }
    }
  }
});

test('susunEksperimen tanpa berkas triase tetap menghasilkan varian ketat saja', () => {
  const utama = bacaSkor('skor-utama.json');
  const eks = susunEksperimen({ utama, triaseUtama: null, triaseKonservatif: null, sumber: { skor_utama: 'skor-utama.json' } });
  const r = eks.per_model[0].runs[0];
  assert.ok(r.skenario_b.ketat, 'ketat tetap ada');
  assert.equal(r.skenario_b.triase_utama, undefined, 'tanpa berkas triase, varian triase tidak dikarang');
  assert.equal(eks.per_model[0].rata_rata.skenario_b.triase_utama, undefined);
  assert.equal(eks.sumber.skor_triase_utama, null);
  assert.deepEqual(validasiSkema(skemaV2, { ...fixtureV2[0], eksperimen: eks }), []);
});

// ---------- Index ----------

test('index v2 konsisten dengan fixture yang ditunjuknya', () => {
  assert.equal(indexV2.schema_version, 2);
  assert.equal(indexV2.runs.length, 3);
  for (const e of indexV2.runs) {
    const fix = fixtureV2.find((f) => f.run.nomor === e.nomor);
    assert.ok(fix, `fixture untuk run ${e.nomor} ada`);
    assert.deepEqual(entriIndexV2(fix, e.path), e, `entri index run ${e.nomor} harus cocok dengan fixture`);
    assert.equal(e.jumlah.alert, fix.alerts.length);
    assert.equal(e.jumlah.temuan, fix.findings.length);
    // Jumlah putusan di index harus cocok dengan isi alerts.
    const n = (p) => fix.alerts.filter((a) => a.putusan === p).length;
    assert.equal(e.jumlah.true_positive, n('true_positive'));
    assert.equal(e.jumlah.false_positive, n('false_positive'));
    assert.equal(e.jumlah.uncertain, n('uncertain'));
  }
  // Tiga vendor berbeda, supaya tab Operasional bisa membandingkan model.
  assert.equal(new Set(indexV2.runs.map((r) => r.vendor)).size, 3);
});
