const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  susunHasil, gabungTemuan, ringkasanMarkdown, perbaruiIndex, entriIndex, pathBranch, parseCwe, potonganKode,
} = require('../scripts/merge-results');

// Fixture disalin apa adanya dari hasil-eksperimen/20261010 (branch eksperimen/seeded):
// flash/run-1.json, flash/run-1.score.json, ci-run/sonar-temuan.json
const FIXTURE = path.join(__dirname, 'fixtures', 'merge');
const baca = (nama) => JSON.parse(fs.readFileSync(path.join(FIXTURE, nama), 'utf8'));
const geminiRun = baca('run-1.json');
const sonarTemuan = baca('sonar-temuan.json');
const skor = baca('run-1.score.json');
const rootKosong = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-root-'));

const meta = (ubah = {}) => ({
  id: 123, nomor: 42, repo: 'MIlhamRidhoP/TA-ssdlc-devops-akademik', commit: '5cbf05c928cd375fa51f773a03ca4779dde42e70',
  branch: 'main', label: 'dash-abc', mulai: '2026-10-13T07:00:00Z', selesai: '2026-10-13T07:04:12Z',
  mode: 'sast-llm', model: 'gemini-3.8-flash', jobs: { build_test: 'success' }, ...ubah,
});

test('parseCwe menormalkan berbagai format CWE', () => {
  assert.deepEqual(parseCwe('CWE-20, CWE-89'), ['CWE-20', 'CWE-89']);
  assert.deepEqual(parseCwe(['cwe 79', 'CWE-79']), ['CWE-79']);
  assert.deepEqual(parseCwe(''), []);
  assert.deepEqual(parseCwe(null), []);
});

test('mode sast-llm: semua temuan Sonar dan Gemini masuk, yang cocok jadi both', () => {
  const r = susunHasil({ meta: meta(), sonarTemuan, geminiRun, skor, root: rootKosong });
  const both = r.findings.filter((f) => f.sumber === 'both');
  const sonar = r.findings.filter((f) => f.sumber === 'sonar');
  const gemini = r.findings.filter((f) => f.sumber === 'gemini');

  assert.equal(r.schema_version, 1);
  assert.equal(both.length + sonar.length, sonarTemuan.temuan.length);
  assert.equal(both.length + gemini.length, geminiRun.temuan.length);
  // cutiModel.js:93 dilaporkan keduanya dengan CWE-89
  assert.ok(both.some((f) => f.file === 'src/models/cutiModel.js' && f.baris === 93));
  assert.ok(both.every((f) => f.status_ai === 'confirmed'));
  assert.ok(sonar.every((f) => f.status_ai === 'rejected'));
  assert.ok(gemini.every((f) => f.status_ai === 'new'));
  assert.ok(r.findings.every((f) => f.status_ai_asal === 'turunan-pencocokan'));
  assert.ok(r.findings.every((f) => f.rekomendasi === null));
  assert.deepEqual(r.sonar_verification, {
    dikonfirmasi: both.length, ditolak: sonar.length, perlu_review: 0, asal: 'turunan-pencocokan',
  });
});

test('metadata run dan metrik disalin, id temuan berurutan dari severity terparah', () => {
  const r = susunHasil({ meta: meta(), sonarTemuan, geminiRun, skor, root: rootKosong });
  assert.equal(r.run.durasi_detik, 252);
  assert.equal(r.run.prompt_sha256, geminiRun.prompt_sha256);
  assert.equal(r.run.model, 'gemini-3.8-flash');
  assert.equal(r.run.gemini.status, 'ok');
  assert.equal(r.metrics.jumlah_positif, skor.metrik.jumlah_positif);
  assert.deepEqual(r.findings.map((f) => f.id), r.findings.map((_, i) => `T-${String(i + 1).padStart(2, '0')}`));
  const urutan = ['kritis', 'tinggi', 'sedang', 'rendah'];
  const peringkat = r.findings.map((f) => urutan.indexOf(f.severity));
  assert.deepEqual(peringkat, [...peringkat].sort((a, b) => a - b));
  assert.ok(new Set(r.findings.map((f) => f.fingerprint)).size === r.findings.length);
});

test('mode sast: Gemini dilewati, temuan Sonar perlu review, tanpa model dan hash prompt', () => {
  const r = susunHasil({ meta: meta({ mode: 'sast' }), sonarTemuan, geminiRun: null, root: rootKosong });
  assert.equal(r.findings.length, sonarTemuan.temuan.length);
  assert.ok(r.findings.every((f) => f.sumber === 'sonar' && f.status_ai === null && f.status_ai_asal === null));
  assert.equal(r.run.gemini.status, 'dilewati');
  assert.equal(r.run.model, null);
  assert.equal(r.run.prompt_sha256, null);
  assert.equal(r.sonar_verification.perlu_review, sonarTemuan.temuan.length);
  assert.equal(r.metrics, undefined);
});

test('mode sast-llm dengan Gemini gagal: status gagal dan galat tercatat', () => {
  const gagal = { ...geminiRun, parse_ok: false, temuan: [], galat: 'kuota habis' };
  const r = susunHasil({ meta: meta(), sonarTemuan, geminiRun: gagal, root: rootKosong });
  assert.equal(r.run.gemini.status, 'gagal');
  assert.equal(r.run.gemini.galat, 'kuota habis');
  assert.ok(r.findings.every((f) => f.sumber === 'sonar' && f.status_ai === null));
});

test('tanpa bahan sama sekali: nol temuan, tidak error', () => {
  const r = susunHasil({ meta: meta({ mode: 'sast' }), sonarTemuan: null, geminiRun: null, root: rootKosong });
  assert.deepEqual(r.findings, []);
  assert.match(ringkasanMarkdown(r), /Tidak ada temuan/);
});

test('potongan kode hanya dibaca dari dalam root, path keluar repo ditolak', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-src-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'].join('\n'));
  assert.deepEqual(potonganKode(root, 'src/a.js', 5), { mulai: 2, baris: ['l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'] });
  assert.equal(potonganKode(root, '../etc/passwd', 1), null);
  assert.equal(potonganKode(root, path.join(os.tmpdir(), 'x.js'), 1), null);
  assert.equal(potonganKode(root, 'src/a.js', 99), null);
});

test('teks dari LLM dinetralkan di Job Summary', () => {
  const findings = gabungTemuan({
    sonar: [],
    gemini: [{ file: 'src/a.js', baris: 1, cwe: 'CWE-79', jenis: '<img src=x onerror=alert(1)> | x', penjelasan: 'p' }],
    geminiBerjalan: true, root: rootKosong,
  });
  const r = susunHasil({ meta: meta(), sonarTemuan: { temuan: [] }, geminiRun, root: rootKosong });
  const md = ringkasanMarkdown({ ...r, findings });
  assert.ok(!md.includes('<img'));
  assert.ok(md.includes('&#60;img'));
  assert.ok(md.split('\n').filter((l) => l.startsWith('| T-01')).every((l) => l.split('|').length === 8));
});

test('index: entri terbaru di depan, id ganda diganti, maksimal 50', () => {
  let index = null;
  for (let n = 1; n <= 55; n++) {
    const r = susunHasil({
      meta: meta({ id: n, nomor: n, selesai: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString() }),
      sonarTemuan, geminiRun, root: rootKosong,
    });
    index = perbaruiIndex(index, entriIndex(r, `main/${n}.json`));
  }
  assert.equal(index.runs.length, 50);
  assert.equal(index.runs[0].nomor, 55);
  const ulang = susunHasil({ meta: meta({ id: 55, nomor: 55, selesai: '2026-10-02T00:00:00Z' }), sonarTemuan, geminiRun, root: rootKosong });
  index = perbaruiIndex(index, entriIndex(ulang, 'main/55.json'));
  assert.equal(index.runs.filter((x) => x.id === 55).length, 1);
});

test('nama branch aman dipakai sebagai path', () => {
  assert.equal(pathBranch('feat/security-dashboard'), 'feat/security-dashboard');
  assert.equal(pathBranch('../../etc'), 'etc');
  assert.equal(pathBranch('fix/a b'), 'fix/a_b');
});

test('data Sonar tidak tersedia ditandai, bukan dianggap nol temuan', () => {
  const galatApi = { sonar: { branch: 'feat/x', analisis: null, galat: ['issues: Organization is not allowed to access data from non main branches.'] } };
  const r = susunHasil({ meta: meta({ mode: 'sast' }), sonarTemuan: { temuan: [] }, geminiRun: null, ringkasan: galatApi, root: rootKosong });
  assert.equal(r.run.sast.status, 'tidak-tersedia');
  assert.match(r.run.sast.galat, /non main branches/);
  assert.match(ringkasanMarkdown(r), /Data SonarCloud tidak tersedia/);

  const tanpaAnalisis = susunHasil({ meta: meta({ mode: 'sast' }), sonarTemuan: { temuan: [] }, geminiRun: null, ringkasan: { sonar: { branch: 'feat/x', analisis: null, galat: [] } }, root: rootKosong });
  assert.equal(tanpaAnalisis.run.sast.status, 'tidak-tersedia');

  const ok = susunHasil({ meta: meta(), sonarTemuan, geminiRun, ringkasan: { sonar: { branch: 'main', analisis: { revisi: meta().commit }, galat: [] } }, root: rootKosong });
  assert.equal(ok.run.sast.status, 'ok');
  assert.equal(ok.run.sast.sesuai_commit, true);
});
