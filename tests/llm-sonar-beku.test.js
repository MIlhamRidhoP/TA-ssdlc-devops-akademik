// Tes laporan SonarCloud beku: pembuatan, verifikasi hash, cek hash tree src/, dan penolakan di llm-score.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const render = require('../scripts/llm/render');
const beku = require('../scripts/llm/sonar-beku');
const { periksaObjek, siapkanSonar, runKering } = require('../scripts/llm-scan');
const { periksaSumberSonar, periksaObjekFolder, periksaGroundTruth } = require('../scripts/llm-score');

const repoUji = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objek-beku-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const q = 1;\nquery(`x ${q}`);\n');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  const commit = (pesan) => { g('add', '.'); g('commit', '-q', '-m', pesan); return g('rev-parse', 'HEAD'); };
  return { dir, g, commit };
};

const laporanUji = (revisi) => ({
  project: 'p', branch: 'main', analisis: { tanggal: '2026-10-10T10:58:15+0000', revisi }, galat: [],
  issues: [
    { rule: 'jssecurity:S3649', severity: 'BLOCKER', type: 'VULNERABILITY', component: 'p:src/a.js', line: 2, message: 'SQL Injection', impacts: [] },
    { rule: 'javascript:S7772', severity: 'MINOR', type: 'CODE_SMELL', component: 'p:src/a.js', line: 1, message: 'Prefer node:fs', impacts: [] },
  ],
  hotspots: [],
  cwe_rule: { 'jssecurity:S3649': ['CWE-89'], 'javascript:S7772': [] },
});

const siapkan = () => {
  const r = repoUji();
  const c1 = r.commit('awal');
  const objek = periksaObjek(r.dir);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'beku-')), 'sonar-beku.json');
  const isi = beku.buatIsiBeku({ laporan: laporanUji(c1), treeSrcAnalisis: objek.tree_src, dibuat: '2026-10-19T00:00:00.000Z' });
  const shaFile = beku.tulisBeku(file, isi);
  return { ...r, c1, objek, file, isi, shaFile };
};

test('file beku valid diterima; alert diturunkan dengan filter v2', async () => {
  const { objek, file, isi, shaFile, c1 } = siapkan();
  assert.deepEqual(isi.ringkasan.jumlah_issue, 2);
  assert.equal(isi.ringkasan.jumlah_alert, 1); // code smell tanpa CWE tidak ikut
  const b = beku.bacaBeku(file, objek);
  assert.equal(b.info.sha256_file, shaFile);
  assert.equal(b.info.sha256_isi, isi.sha256_isi);
  assert.equal(b.info.revisi, c1);
  assert.deepEqual(b.alert.map((a) => [a.id, a.rule, a.file, a.baris]), [['SONAR-01', 'jssecurity:S3649', 'src/a.js', 2]]);
  assert.equal(b.hash_laporan_sonar, isi.ringkasan.hash_laporan_sonar);
  const s = await siapkanSonar(objek, file);
  assert.equal(s.sumber, 'beku');
  assert.equal(s.infoBeku.sha256_isi, isi.sha256_isi);
});

test('hash isi file beku tidak cocok ditolak', () => {
  const { objek, file } = siapkan();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.issues[0].line = 3; // alert diubah tanpa memperbarui sha256_isi
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  assert.throws(() => beku.bacaBeku(file, objek), /Hash isi file Sonar beku tidak cocok/);
  const tanpaHash = { ...data };
  delete tanpaHash.sha256_isi;
  fs.writeFileSync(file, JSON.stringify(tanpaHash));
  assert.throws(() => beku.bacaBeku(file, objek), /Hash isi/);
  assert.throws(() => beku.bacaBeku(`${file}.tidak-ada`, objek), /tidak ditemukan/);
});

test('hash tree src berbeda ditolak; commit tanpa perubahan src tetap lolos', () => {
  const { dir, commit, file } = siapkan();
  fs.writeFileSync(path.join(dir, 'SEEDED.md'), 'A05\n');
  commit('ubah dokumen saja');
  assert.doesNotThrow(() => beku.bacaBeku(file, periksaObjek(dir)));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'berubah\n');
  commit('ubah src');
  assert.throws(() => beku.bacaBeku(file, periksaObjek(dir)), /Hash tree src\/ di file Sonar beku .* berbeda dengan objek uji/);
});

const folderUtama = (ubah = {}) => ({
  folder: 'llm-output/v2/x-google-utama',
  summary: { kondisi: 'utama', sumber_sonar: 'beku', sonar_beku: { sha256_isi: 'abc' }, ...ubah.summary },
  alert: ubah.alert,
});

test('llm-score: kondisi utama tanpa file beku, dari API, file beku lain, atau alert berbeda ditolak', () => {
  const { objek, file } = siapkan();
  const b = beku.bacaBeku(file, objek);
  const alertDikirim = b.alert.map((a) => ({ ...a, hash: render.sha256(a.teks) }));
  const sah = folderUtama({ summary: { sonar_beku: { sha256_isi: b.info.sha256_isi } }, alert: alertDikirim });
  assert.doesNotThrow(() => periksaSumberSonar([sah], b));
  assert.doesNotThrow(() => periksaSumberSonar([], null)); // hanya ablasi: file beku tidak wajib
  assert.throws(() => periksaSumberSonar([sah], null), /--sonar-beku tidak diisi/);
  assert.throws(() => periksaSumberSonar([{ ...sah, summary: { ...sah.summary, sumber_sonar: 'api' } }], b), /dari api, bukan file beku/);
  assert.throws(() => periksaSumberSonar([{ ...sah, summary: { ...sah.summary, sonar_beku: { sha256_isi: 'lain' } } }], b), /file Sonar beku lain/);
  assert.throws(() => periksaSumberSonar([{ ...sah, alert: [{ ...alertDikirim[0], baris: 9 }] }], b), /tidak sama dengan alert dari file Sonar beku/);
});

test('run kering memakai alert dari file beku dan menghasilkan hash yang sama dengan perakitan langsung', () => {
  const { objek, file } = siapkan();
  const b = beku.bacaBeku(file, objek);
  const template = render.bacaTemplate();
  const kode = render.bentukKodeSumber(objek.dir);
  const hasil = runKering({ template, kondisi: 'utama', kode, alert: b.alert, sonarTeks: b.sonarTeks });
  assert.deepEqual(hasil.map((h) => h.id_alert), [null, 'SONAR-01']);
  const langsung = render.rakitPrompt({ template, kondisi: 'utama', tugas: 'verifikasi', kodeSumber: kode.teks, alertTeks: b.alert[0].teks });
  assert.equal(hasil[1].prompt_user_kanonik, langsung.hash.prompt_user_kanonik);
});

test('llm-score: objek uji dicocokkan lewat hash tree src, bukan commit', () => {
  const { dir, commit, c1 } = siapkan();
  const folderDari = (summaryObjek, nama = 'llm-output/v2/x-google-utama') => ({ folder: nama, summary: { objek_uji: summaryObjek } });
  const asal = periksaObjek(dir);
  const f = folderDari({ commit: c1, branch: 'eksperimen/seeded', tree_src: asal.tree_src });
  // Commit baru tanpa perubahan src (misalnya hasil eksperimen di-commit): diterima, laporan memakai commit dari folder.
  fs.mkdirSync(path.join(dir, 'hasil-eksperimen'));
  fs.writeFileSync(path.join(dir, 'hasil-eksperimen', 'skor.json'), '{}\n');
  const c2 = commit('data: hasil');
  const objekBaru = periksaObjek(dir);
  assert.notEqual(objekBaru.commit, c1);
  assert.deepEqual(periksaObjekFolder([f], objekBaru), { commit: c1, branch: 'eksperimen/seeded' });
  assert.notEqual(c2, c1);
  // Folder tanpa tree tercatat, atau dari commit objek uji berbeda, ditolak.
  assert.throws(() => periksaObjekFolder([folderDari({ commit: c1, branch: 'b' })], objekBaru), /tidak mencatat hash tree src/);
  assert.throws(() => periksaObjekFolder([f, folderDari({ commit: c2, branch: 'eksperimen/seeded', tree_src: asal.tree_src }, 'y')], objekBaru), /commit objek uji berbeda/);
  // src berubah: tree berbeda, ditolak.
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'berubah\n');
  commit('ubah src');
  assert.throws(() => periksaObjekFolder([f], periksaObjek(dir)), /hash tree src\/ objek uji .* berbeda dengan worktree --objek/);
});

test('llm-score: SEEDED.md dibandingkan dengan blob di commit objek uji folder; revisi hanya dengan opsi eksplisit', () => {
  const { dir, commit, g } = repoUji();
  fs.writeFileSync(path.join(dir, 'SEEDED.md'), '| S1 | src/a.js | x | SQLi | CWE-89 | A05 | Mudah | terbukti |\n');
  const c1 = commit('ground truth awal');
  const blob1 = g('rev-parse', `${c1}:SEEDED.md`);
  const folderC1 = { commit: c1, branch: 'eksperimen/seeded' };
  // HEAD sama dengan commit run: diterima, revisi false.
  assert.deepEqual(periksaGroundTruth(periksaObjek(dir), folderC1), { blob: blob1, blob_commit_objek_uji: blob1, revisi: false });
  // Commit lain yang tidak mengubah SEEDED.md: tetap diterima.
  fs.writeFileSync(path.join(dir, 'catatan.md'), 'x\n');
  commit('dokumen lain');
  assert.equal(periksaGroundTruth(periksaObjek(dir), folderC1).revisi, false);
  // SEEDED.md berubah (misalnya reklasifikasi): ditolak tanpa opsi, diterima dan ditandai revisi dengan opsi.
  fs.writeFileSync(path.join(dir, 'SEEDED.md'), '| S1 | src/a.js | x | SQLi | CWE-89 | A05 | Mudah | jebakan FP |\n');
  commit('reklasifikasi');
  const objekBaru = periksaObjek(dir);
  assert.throws(() => periksaGroundTruth(objekBaru, folderC1), /SEEDED\.md di worktree --objek .* berbeda .*--ground-truth-revisi/);
  const revisi = periksaGroundTruth(objekBaru, folderC1, { revisi: true });
  assert.equal(revisi.revisi, true);
  assert.equal(revisi.blob_commit_objek_uji, blob1);
  assert.equal(revisi.blob, g('rev-parse', 'HEAD:SEEDED.md'));
  assert.notEqual(revisi.blob, blob1);
  // Commit objek uji folder yang tidak ada di repo: ditolak.
  assert.throws(() => periksaGroundTruth(objekBaru, { commit: '0'.repeat(40), branch: 'x' }), /tidak ditemukan/);
});
