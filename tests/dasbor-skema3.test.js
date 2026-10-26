// Dasbor membaca skema 3 (sumbu sast). Tiga hal yang dijaga, dan ketiganya pernah menjadi cacat:
//
//   1. SKEMA_DIDUKUNG dulu [1, 2], jadi results.json skema 3 ditolak sebagai "format tidak
//      dikenali" — hasil batch dua perkakas tidak bisa dibuka sama sekali.
//   2. Severity alert bernama severity_sonar di skema 2 dan severity di skema 3. Dibaca lewat satu
//      fungsi; kalau tidak, salah satu skema menampilkan "—" untuk seluruh alertnya.
//   3. Pilihan label sensitivitas dulu memaku id "SONAR-03". Itu kebetulan benar untuk batch 19 dan
//      22 Oktober dan salah untuk lengan dua perkakas, yang id alertnya CQL-xx.
//
// Potongan sumber dijalankan lewat new Function, mengikuti cara tes dasbor lain di repo ini, supaya
// yang diuji benar-benar kode yang dipakai halaman dan bukan salinannya.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');

// Potong dari penanda awal sampai penanda akhir, keduanya harus unik.
const potong = (awal, akhir) => {
  assert.equal(APP.split(awal).length - 1, 1, `penanda awal tidak unik: ${awal}`);
  const i = APP.indexOf(awal);
  const j = APP.indexOf(akhir, i);
  assert.ok(j > i, `penanda akhir tidak ditemukan sesudah awal: ${akhir}`);
  return APP.slice(i, j + akhir.length);
};

const validator = () => {
  const src = potong('const SKEMA_DIDUKUNG = [1, 2, 3];', 'return r;\n  };');
  // GhError disuntik: validasiHasil melemparnya, dan di tes kita cuma perlu pesannya terbaca.
  return new Function('GhError', `${src}\n  return { SKEMA_DIDUKUNG, SKEMA_LLM, skemaLlm, validasiHasil };`)(
    class GhError extends Error {
      constructor(jenis, pesan) { super(pesan); this.jenis = jenis; }
    },
  );
};

const bantu = () => {
  const src = potong('const severityAlert = (a) =>', '...ada.filter((k) => !(k in NAMA_SAST)),\n    ];\n  };');
  return new Function(`${src}\n  return { severityAlert, perkakasAlert, NAMA_SAST, namaSast, perkakasDipakai };`)();
};

const label = (eks) => {
  const src = potong('const idLabelBeda = () => {', "ids.map((id) => `${id} = ${peta?.[id]?.label ?? '—'}`).join(', ')})` : '';\n    };");
  return new Function('eks', `${src}\n  return { idLabelBeda, ketLabel };`)(eks);
};

const runV2 = { nomor: 1, objek_uji: { branch: 'eksperimen/seeded' } };
const hasil = (v, lebih = {}) => ({ schema_version: v, run: runV2, findings: [], alerts: [], ...lebih });

// ---------- 1. Skema yang diterima dan yang ditolak ----------

test('skema 1, 2, dan 3 diterima; skema lain ditolak', () => {
  const V = validator();
  assert.deepEqual(V.SKEMA_DIDUKUNG, [1, 2, 3]);
  assert.deepEqual(V.SKEMA_LLM, [2, 3]);
  for (const v of [2, 3]) assert.equal(V.validasiHasil(hasil(v)).schema_version, v);
  assert.doesNotThrow(() => V.validasiHasil({ schema_version: 1, run: runV2, findings: [], sonar_verification: {} }));
  for (const v of [0, 4, '2', null, undefined]) {
    assert.throws(() => V.validasiHasil(hasil(v)), /Format results\.json tidak dikenali/, `skema ${v} harus ditolak`);
  }
  assert.throws(() => V.validasiHasil(null), /Format results\.json tidak dikenali/);
  // Pesan galatnya harus menyebut ketiga versi, bukan dua seperti dulu.
  assert.throws(() => V.validasiHasil(hasil(4)), /skema versi 1, 2, 3/);
});

test('skema 3 tanpa alerts atau findings ditolak, dan pesannya menyebut skemanya', () => {
  const V = validator();
  assert.throws(() => V.validasiHasil({ schema_version: 3, run: runV2, findings: [] }), /skema 3 tanpa findings atau alerts/);
  assert.throws(() => V.validasiHasil({ schema_version: 3, run: runV2, alerts: [] }), /skema 3 tanpa findings atau alerts/);
  // Skema 2 tetap memberi pesannya sendiri, bukan pesan skema 3.
  assert.throws(() => V.validasiHasil({ schema_version: 2, run: runV2, findings: [] }), /skema 2 tanpa findings atau alerts/);
});

test('skemaLlm memisahkan jalur LLM dari arsip skema 1', () => {
  const V = validator();
  assert.equal(V.skemaLlm({ schema_version: 2 }), true);
  assert.equal(V.skemaLlm({ schema_version: 3 }), true);
  assert.equal(V.skemaLlm({ schema_version: 1 }), false);
  // Tidak boleh melempar untuk masukan kosong: renderNav memanggilnya sebelum hasil ada.
  assert.equal(V.skemaLlm(null), false);
  assert.equal(V.skemaLlm(undefined), false);
});

test('jalur run diturunkan dari skema, dan skema 3 ikut jalur v2', () => {
  // Skema 3 adalah jalur v2 juga: sumbu sast mengubah asal alert, bukan bentuk pipelinenya.
  // Perbandingan "=== 2" di sini akan membuat run skema 3 digambar sebagai pipeline v1.
  // Dicari baris yang menurunkan jalur DARI SKEMA. Baris lain juga memuat "? 'v2' : 'v1'", yaitu
  // penurunan dari mode workflow, dan baris itu tidak ada hubungannya dengan skema.
  const baris = APP.split('\n').filter((b) => b.includes('schema_version') && b.includes("'v1'"));
  assert.equal(baris.length, 1, `harus ada tepat satu baris penurun jalur dari skema, dapat ${baris.length}`);
  assert.match(baris[0], /schema_version >= 2/, 'jalur harus diturunkan dengan >= 2, bukan === 2');
});

// ---------- 2. Severity dan perkakas ----------

test('severity dibaca dari kedua nama medan', () => {
  const { severityAlert } = bantu();
  assert.equal(severityAlert({ severity_sonar: 'BLOCKER' }), 'BLOCKER', 'nama medan skema 2');
  assert.equal(severityAlert({ severity: '9.8' }), '9.8', 'nama medan skema 3');
  // Kalau keduanya ada, yang skema 3 menang: itu nama medan yang berlaku untuk berkas itu.
  assert.equal(severityAlert({ severity: '9.8', severity_sonar: 'BLOCKER' }), '9.8');
  for (const a of [{}, null, undefined]) assert.equal(severityAlert(a), null, 'tanpa severity harus null, bukan undefined');
});

test('perkakas alert bawaannya sonar, dan nama yang tidak dikenal tidak dikarang', () => {
  const { perkakasAlert, namaSast } = bantu();
  assert.equal(perkakasAlert({ sumber_sast: 'codeql' }), 'codeql');
  // Alert skema 2 tidak punya medannya dan memang selalu dari Sonar.
  assert.equal(perkakasAlert({ id: 'SONAR-01' }), 'sonar');
  assert.equal(perkakasAlert(null), 'sonar');
  assert.equal(namaSast('sonar'), 'SonarCloud');
  assert.equal(namaSast('codeql'), 'CodeQL');
  // Perkakas ketiga yang belum dikenal ditampilkan apa adanya, bukan diberi nama tebakan.
  assert.equal(namaSast('semgrep'), 'semgrep');
});

test('daftar perkakas yang dipakai urut, tanpa duplikat, dan kosong untuk himpunan kosong', () => {
  const { perkakasDipakai } = bantu();
  const a = (sast) => (sast ? { sumber_sast: sast } : { id: 'SONAR-01' });
  assert.deepEqual(perkakasDipakai([a('codeql'), a('sonar'), a('codeql')]), ['sonar', 'codeql'],
    'urutannya Sonar lebih dulu, sama dengan urutan verifikasi');
  assert.deepEqual(perkakasDipakai([a(null), a(null)]), ['sonar'], 'data lama hanya satu perkakas');
  assert.deepEqual(perkakasDipakai([]), [], 'himpunan kosong tidak boleh melaporkan perkakas');
  assert.deepEqual(perkakasDipakai(null), [], 'tanpa alert sama sekali tidak boleh melempar');
  // Perkakas di luar daftar nama ikut dilaporkan, di belakang yang dikenal.
  assert.deepEqual(perkakasDipakai([a('semgrep'), a('sonar')]), ['sonar', 'semgrep']);
});

// ---------- 3. Label sensitivitas diturunkan dari data ----------

const lbl = (x) => ({ label: x });

test('regresi data lama: alert yang divariasikan tetap terbaca SONAR-03', () => {
  // Bentuk ini persis seperti berkas skor batch 19 dan 22 Oktober, dan keterangannya harus sama
  // dengan yang dulu ditulis keras.
  const { ketLabel, idLabelBeda } = label({
    label_alert: { 'SONAR-01': lbl('nyata'), 'SONAR-03': lbl('fp') },
    label_alert_sensitivitas: { 'SONAR-01': lbl('nyata'), 'SONAR-03': lbl('nyata') },
  });
  assert.deepEqual(idLabelBeda(), ['SONAR-03']);
  assert.equal(ketLabel({ 'SONAR-03': lbl('fp') }), ' (SONAR-03 = fp)');
  assert.equal(ketLabel({ 'SONAR-03': lbl('nyata') }), ' (SONAR-03 = nyata)');
});

test('lengan dua perkakas: alert CodeQL yang divariasikan ikut terbaca', () => {
  const { ketLabel, idLabelBeda } = label({
    label_alert: { 'SONAR-01': lbl('nyata'), 'CQL-07': lbl('fp') },
    label_alert_sensitivitas: { 'SONAR-01': lbl('nyata'), 'CQL-07': lbl('nyata') },
  });
  assert.deepEqual(idLabelBeda(), ['CQL-07'], 'id yang divariasikan tidak harus berawalan SONAR');
  assert.equal(ketLabel({ 'CQL-07': lbl('nyata') }), ' (CQL-07 = nyata)');
});

test('tanpa varian sensitivitas, keterangannya kosong dan bukan tanda hubung', () => {
  // "SONAR-03 = —" terbaca seolah alert itu ada dan labelnya tidak diketahui.
  const { ketLabel, idLabelBeda } = label({ label_alert: { 'SONAR-01': lbl('nyata') } });
  assert.deepEqual(idLabelBeda(), []);
  assert.equal(ketLabel({ 'SONAR-01': lbl('nyata') }), '');
  assert.equal(label({}).ketLabel(undefined), '', 'berkas skor tanpa label_alert sama sekali');
});

test('lebih dari satu alert divariasikan: semuanya disebut, urut', () => {
  const { ketLabel, idLabelBeda } = label({
    label_alert: { 'CQL-02': lbl('fp'), 'SONAR-03': lbl('fp') },
    label_alert_sensitivitas: { 'CQL-02': lbl('nyata'), 'SONAR-03': lbl('nyata') },
  });
  assert.deepEqual(idLabelBeda(), ['CQL-02', 'SONAR-03']);
  assert.equal(ketLabel({ 'CQL-02': lbl('nyata'), 'SONAR-03': lbl('nyata') }),
    ' (CQL-02 = nyata, SONAR-03 = nyata)');
});

test('alert yang hanya ada di varian sensitivitas dihitung sebagai berbeda', () => {
  const { idLabelBeda } = label({
    label_alert: {},
    label_alert_sensitivitas: { 'CQL-01': lbl('nyata') },
  });
  assert.deepEqual(idLabelBeda(), ['CQL-01']);
});

// ---------- 4. Riwayat membaca kedua berkas index ----------

const indexer = () => {
  const src = potong("const BERKAS_INDEX = ['index.json', 'index-v3.json'];", 'runs: (daftar ?? []).flatMap((x) => (Array.isArray(x?.runs) ? x.runs : [])),\n  });');
  return new Function(`${src}\n  return { BERKAS_INDEX, gabungIndex };`)();
};

test('riwayat membaca index.json dan index-v3.json', () => {
  // Satu berkas index per skema (scripts/merge-results.js). Kalau hanya index.json yang dibaca, run
  // dua perkakas tidak pernah muncul di dashboard walaupun berkas hasilnya sudah terbit.
  const { BERKAS_INDEX } = indexer();
  assert.deepEqual(BERKAS_INDEX, ['index.json', 'index-v3.json']);
});

test('gabungIndex menyambung daftar run tanpa mengurutnya', () => {
  // Tidak mengurut itu keputusan, bukan kelalaian: urutEntri satu-satunya pengurutan run di app.js,
  // dan menyalinnya ke sini membuat tests/urutan-run.test.js gagal dengan benar.
  const { gabungIndex } = indexer();
  const a = { runs: [{ nomor: 1, selesai: '2026-10-01T00:00:00.000Z' }] };
  const b = { runs: [{ nomor: 2, selesai: '2026-10-26T00:00:00.000Z' }] };
  assert.deepEqual(gabungIndex([a, b]).runs.map((x) => x.nomor), [1, 2], 'urutan masukan dipertahankan');
  assert.deepEqual(gabungIndex([b, a]).runs.map((x) => x.nomor), [2, 1]);
});

test('index skema 3 yang belum ada tidak mengubah apa pun', () => {
  // Keadaan normal untuk hampir semua proyek: index-v3.json belum terbit.
  const { gabungIndex } = indexer();
  const a = { runs: [{ nomor: 46 }, { nomor: 45 }] };
  assert.deepEqual(gabungIndex([a, { runs: [] }]), { runs: [{ nomor: 46 }, { nomor: 45 }] });
});

test('gabungIndex tahan terhadap berkas index yang bentuknya rusak', () => {
  // Berkas index berasal dari branch security-results dan bisa saja rusak; dashboard tidak boleh
  // melempar TypeError dan membuat seluruh halaman riwayat kosong tanpa sebab.
  const { gabungIndex } = indexer();
  assert.deepEqual(gabungIndex([null, undefined, {}, { runs: null }, { runs: 'bukan array' }]), { runs: [] });
  assert.deepEqual(gabungIndex([]), { runs: [] });
  assert.deepEqual(gabungIndex(null), { runs: [] });
  assert.deepEqual(gabungIndex(undefined), { runs: [] });
});

// ---------- 5. Aturan dasbor yang tidak boleh ikut longgar ----------

test('perubahan ini tidak memasukkan innerHTML maupun host baru ke CSP', () => {
  // Dua aturan keras dashboard: data hanya lewat createElement/textContent, dan CSP tidak berubah.
  // Yang dilarang adalah PEMAKAIANNYA, bukan kata itu muncul: komentar "Pembuat elemen tanpa
  // innerHTML" di app.js justru menerangkan aturannya dan harus tetap boleh ada.
  assert.equal(/\.innerHTML/.test(APP), false, 'app.js tidak boleh memakai innerHTML');
  assert.equal(/insertAdjacentHTML|outerHTML/.test(APP), false, 'tidak boleh menyusun HTML dari string');
  const html = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');
  // Dicocokkan sebagai arahan utuh, bukan sebagai substring: "memuat api.github.com" tetap benar
  // walaupun ada host lain yang diselipkan sesudahnya.
  const csp = html.match(/connect-src ([^;]+);/);
  assert.ok(csp, 'arahan connect-src tidak ditemukan di CSP');
  assert.equal(csp[1].trim(), "'self' https://api.github.com");
});

test('lencana perkakas hanya muncul kalau run memuat lebih dari satu perkakas', () => {
  // Data lama harus tampil persis seperti sebelumnya: satu perkakas tidak diberi label.
  assert.match(APP, /const banyakPerkakas = perkakas\.length > 1;/);
  assert.match(APP, /banyakPerkakas\s*\n?\s*\? el\('span', \{ class: 'chip chip-rule'/);
  // Kartu tumpang tindih hanya kalau medan kembar_dengan memang ada, bukan 0 yang dikarang.
  assert.match(APP, /const adaKembar = h\.alerts\.some\(\(a\) => Array\.isArray\(a\.kembar_dengan\)\);/);
  assert.match(APP, /adaKembar \? kartu\('Tumpang tindih'/);
});
