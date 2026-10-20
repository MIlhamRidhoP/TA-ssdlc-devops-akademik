// Skenario analisis B dan C di tingkat alat. Seluruh pemanggilan model memakai respons tiruan:
// tes ini tidak pernah menyentuh API berbayar.
//
// Janji terpenting yang dijaga: skenario C hanya menghilangkan verifikasi. Prompt deteksinya harus
// byte-identik dengan skenario B, kalau tidak angka deteksi kedua skenario tidak bisa dibandingkan
// dan eksperimen TA kehilangan dasar perbandingannya.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const render = require('../scripts/llm/render');
const { susunHasilV2 } = require('../scripts/llm/results-v2');
const { validasiSkema } = require('../scripts/validasi-skema');
const skemaV2 = require('../docs/design/results-v2.schema.json');
const { runKering } = require('../scripts/llm-scan');

const KODE = { teks: '1 | const a = 1;\n2 | module.exports = a;\n', file: ['src/a.js'] };
const ALERT = [
  { id: 'SONAR-01', teks: 'Alert ID: SONAR-01\nRule: javascript:S5122', rule: 'javascript:S5122', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/a.js', baris: 1, cwe: ['CWE-346'], pesan: 'contoh', severity: 'MAJOR' },
  { id: 'SONAR-02', teks: 'Alert ID: SONAR-02\nRule: javascript:S2068', rule: 'javascript:S2068', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/a.js', baris: 2, cwe: ['CWE-798'], pesan: 'contoh', severity: 'MINOR' },
];
const template = render.bacaTemplate(render.PROMPT_DIR);

test('skenario C tidak merakit satu pun prompt verifikasi', () => {
  const b = runKering({ template, kondisi: 'utama', kode: KODE, alert: ALERT, sonarTeks: null, skenario: 'B' });
  const c = runKering({ template, kondisi: 'utama', kode: KODE, alert: ALERT, sonarTeks: null, skenario: 'C' });
  assert.equal(b.length, 1 + ALERT.length, 'skenario B harus merakit deteksi dan satu verifikasi per alert');
  assert.equal(c.length, 1, 'skenario C hanya merakit prompt deteksi');
});

test('prompt deteksi skenario B dan C byte-identik', () => {
  const p = (skenario) => render.rakitPrompt({ template, kondisi: 'utama', tugas: 'deteksi', kodeSumber: KODE.teks, sonarTeks: null });
  const b = p('B');
  const c = p('C');
  assert.equal(b.system, c.system);
  assert.equal(b.user, c.user);
  assert.deepEqual(b.hash, c.hash, 'hash prompt deteksi harus sama di kedua skenario');
  // Dan hash keringnya pun sama untuk bagian deteksi.
  const kb = runKering({ template, kondisi: 'utama', kode: KODE, alert: ALERT, sonarTeks: null, skenario: 'B' });
  const kc = runKering({ template, kondisi: 'utama', kode: KODE, alert: ALERT, sonarTeks: null, skenario: 'C' });
  assert.deepEqual(kc[0], kb[0], 'entri deteksi di run kering harus identik');
});

test('skenario C tidak mengambil laporan SonarCloud sama sekali', () => {
  // Bukan sekadar menghemat satu panggilan API. siapkanSonar juga menolak run bila hash tree src/
  // pada revisi analisis Sonar berbeda dengan commit yang dianalisis. Kalau C tetap mengambilnya,
  // run C gagal karena data yang tidak pernah ia pakai, padahal hasilnya memang tidak memuat alert.
  const { perluSonar } = require('../scripts/llm-scan');
  assert.equal(perluSonar({ kondisi: 'utama', skenario: 'B' }), true);
  assert.equal(perluSonar({ kondisi: 'utama', skenario: 'C' }), false);
  assert.equal(perluSonar({ kondisi: 'sonar_di_deteksi', skenario: 'B' }), true);
  assert.equal(perluSonar({ kondisi: 'sonar_di_deteksi', skenario: 'C' }), false);
  // Kondisi komentar_menyesatkan sudah tidak memakai Sonar sejak sebelum sumbu skenario ada;
  // perilakunya tidak boleh ikut berubah.
  assert.equal(perluSonar({ kondisi: 'komentar_menyesatkan', skenario: 'B' }), false);
  assert.equal(perluSonar({ kondisi: 'komentar_menyesatkan', skenario: 'C' }), false);
});

test('skenario C tidak mengubah prompts/v2', () => {
  // Prompt deteksi harus datang apa adanya dari berkas terkunci, bukan dari varian baru.
  const daftar = fs.readFileSync(path.join(ROOT, 'prompts/v2/HASHES.txt'), 'utf8').trim().split('\n');
  const crypto = require('node:crypto');
  for (const baris of daftar) {
    const [hash, nama] = baris.trim().split(/\s+/);
    const isi = fs.readFileSync(path.join(ROOT, 'prompts/v2', nama));
    assert.equal(crypto.createHash('sha256').update(isi).digest('hex'), hash, `${nama} berubah`);
  }
});

// ---------- Hasil run ----------
const summaryDasar = {
  vendor: 'google', model_diminta: 'gemini-3.1-pro-preview', kondisi: 'utama',
  objek_uji: { commit: 'a'.repeat(40), branch: 'feat/x', tree_src: 'b'.repeat(40) },
  sumber_sonar: 'api', analisis_sonar: '2026-10-10T08:00:24+0000', revisi_analisis_sonar: 'c'.repeat(40),
  tree_src_analisis_sonar: 'b'.repeat(40),
};
const metaPanggilan = (status = 'ok') => ({
  status, waktu_mulai: '2026-10-20T10:00:00.000Z', waktu_selesai: '2026-10-20T10:01:00.000Z',
  model_menjawab: 'gemini-3.1-pro-preview', biaya_usd: 0.1, hash: { prompt_system_kanonik: 'd'.repeat(64), prompt_user_kanonik: 'e'.repeat(64) },
});
const temuanContoh = [{
  file: 'src/a.js', baris: 1, fungsi: 'f', jenis: 'SQL Injection', cwe: 'CWE-89',
  kategori_owasp: 'A03', penjelasan: 'contoh', sifat: 'vulnerability', keyakinan: 'high',
}];
const runDasar = (skenario, verifikasi) => ({
  kondisi: 'utama', skenario, model_diminta: 'gemini-3.1-pro-preview',
  commit_objek_uji: 'a'.repeat(40), branch_objek_uji: 'feat/x', tree_src_objek_uji: 'b'.repeat(40),
  commit_kode: { head: 'f'.repeat(40), bersih: true },
  parse_ok: true, temuan: temuanContoh, deteksi: metaPanggilan(), verifikasi,
});
const susun = (skenario, verifikasi) => susunHasilV2({
  summary: { ...summaryDasar, skenario }, run: runDasar(skenario, verifikasi), nomor: 7,
  alert: ALERT, parseCwe: (x) => (Array.isArray(x) ? x : [x]).filter(Boolean),
});

test('skenario B: alert ikut, dengan putusan model', () => {
  const h = susun('B', ALERT.map((a) => ({
    id_alert: a.id, putusan: 'true_positive', keyakinan: 'high', alasan: 'contoh', id_alert_model: a.id, tanda: [],
    metadata: metaPanggilan(),
  })));
  assert.equal(h.run.skenario, 'B');
  assert.equal(h.run.mode_model, 'tunggal');
  assert.equal(h.alerts.length, ALERT.length);
  assert.equal(h.alerts[0].putusan, 'true_positive');
  assert.equal(h.findings.length, 1);
  assert.equal(h.run.status_panggilan.total, 1 + ALERT.length);
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('skenario C: tidak ada alert sama sekali, temuan tetap utuh', () => {
  const h = susun('C', []);
  assert.equal(h.run.skenario, 'C');
  assert.deepEqual(h.alerts, [], 'skenario C tidak boleh membawa alert');
  assert.equal(h.findings.length, 1, 'temuan deteksi tetap ada');
  assert.equal(h.run.status_panggilan.total, 1, 'hanya satu panggilan, yaitu deteksi');
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('skenario C mengabaikan sisa verifikasi kalau entah bagaimana ada', () => {
  // Pertahanan berlapis: kalau berkas run C ternyata membawa verifikasi, hasilnya tetap tanpa
  // alert. Menampilkan putusan untuk alert yang tidak pernah dikirim adalah klaim yang salah.
  const h = susun('C', [{ id_alert: 'SONAR-01', putusan: 'false_positive', keyakinan: 'high', alasan: 'x', id_alert_model: 'SONAR-01', tanda: [], metadata: metaPanggilan() }]);
  assert.deepEqual(h.alerts, []);
});

test('run lama tanpa skenario dianggap B satu vendor', () => {
  const run = runDasar(undefined, ALERT.map((a) => ({
    id_alert: a.id, putusan: 'uncertain', keyakinan: 'low', alasan: 'x', id_alert_model: a.id, tanda: [], metadata: metaPanggilan(),
  })));
  delete run.skenario;
  const h = susunHasilV2({
    summary: summaryDasar, run, nomor: 8, alert: ALERT,
    parseCwe: (x) => (Array.isArray(x) ? x : [x]).filter(Boolean),
  });
  assert.equal(h.run.skenario, 'B');
  assert.equal(h.run.mode_model, 'tunggal');
  assert.equal(h.alerts.length, ALERT.length, 'run lama tetap membawa alertnya');
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('fixture dan run terbit lama tetap sah terhadap skema', () => {
  // Field baru opsional: berkas yang sudah terbit di security-results tidak boleh ikut ditolak.
  for (const f of ['eksperimen/seeded/1.json', 'feat/prompt-v2/54.json', 'contoh/rekomendasi-ai.json']) {
    const d = require(`../dashboard/fixtures/v2/${f}`);
    assert.ok(!('skenario' in d.run), `${f} belum punya skenario, dan memang tidak harus punya`);
    assert.deepEqual(validasiSkema(skemaV2, d), [], `${f} harus tetap sah`);
  }
});
