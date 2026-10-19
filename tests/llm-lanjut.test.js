// Tes run berselang-seling (--lanjut) dan commit kode alat. Tanpa panggilan API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const render = require('../scripts/llm/render');
const {
  LINGKUP_KODE, infoKodeAlat, periksaKodeAlat, hashFilePrompt, bentukSidik, bedaSidik, rencanaNomorRun, periksaLanjut,
} = require('../scripts/llm/lanjut');

const repoAlat = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-alat-'));
  for (const [rel, isi] of Object.entries({ 'scripts/a.js': 'a\n', 'dashboard/b.js': 'b\n', 'package.json': '{}\n' })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), isi);
  }
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  g('add', '.');
  g('commit', '-q', '-m', 'awal');
  return { dir, g };
};

test('commit_kode: HEAD repo alat dan status bersih untuk file dalam lingkup', () => {
  const { dir, g } = repoAlat();
  const bersih = infoKodeAlat(dir);
  assert.equal(bersih.head, g('rev-parse', 'HEAD'));
  assert.equal(bersih.bersih, true);
  assert.deepEqual(bersih.lingkup, LINGKUP_KODE);
  assert.doesNotThrow(() => periksaKodeAlat(bersih));
  // Perubahan di luar lingkup (dashboard) tidak menghalangi run.
  fs.writeFileSync(path.join(dir, 'dashboard/b.js'), 'berubah\n');
  assert.equal(infoKodeAlat(dir).bersih, true);
  // Perubahan atau file baru di dalam lingkup menolak run.
  fs.writeFileSync(path.join(dir, 'scripts/a.js'), 'berubah\n');
  const kotor = infoKodeAlat(dir);
  assert.equal(kotor.bersih, false);
  assert.throws(() => periksaKodeAlat(kotor), /belum bersih, run ditolak/);
  g('checkout', '--', 'scripts/a.js');
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests/baru.test.js'), 'x\n');
  assert.throws(() => periksaKodeAlat(infoKodeAlat(dir)), /tests\//);
});

const sidikDasar = () => bentukSidik({
  versiPrompt: 'v2', vendor: 'google', model: 'gemini-3.1-pro-preview', kondisi: 'utama',
  objek: { commit: 'c'.repeat(40), tree_src: 't'.repeat(40) }, sumberSonar: 'beku', infoBeku: { sha256_isi: 's'.repeat(64) },
  hashKodeSumber: 'k', hashLaporanSonar: 'l', hashPrompt: hashFilePrompt(render.PROMPT_DIR),
  hashKering: [
    { tugas: 'deteksi', id_alert: null, prompt_system_kanonik: 'ps', prompt_user_kanonik: 'u0' },
    { tugas: 'verifikasi', id_alert: 'SONAR-01', prompt_system_kanonik: 'ps', prompt_user_kanonik: 'u1' },
  ],
  pengaturan: { sampling: 'bawaan', tingkat_thinking: 'high', batas_output: 64000, tools: 'none', fallback: 'none', parameter_vendor: {}, koneksi: { timeout_sdk_ms: 1200000, headers_timeout_ms: 1200000, body_timeout_ms: 1200000, fetch: 'undici 7.30.1' } },
  sdk: { node: 'v22', '@anthropic-ai/sdk': '0.135.0', openai: '7.39.0', undici: '7.30.1' },
  kodeAlat: { head: 'h'.repeat(40) },
});

test('sidik run memuat hash semua file prompt dan prompt kanonik per panggilan', () => {
  const s = sidikDasar();
  const hashes = Object.fromEntries(fs.readFileSync(path.join(render.PROMPT_DIR, 'HASHES.txt'), 'utf8')
    .trim().split(/\r?\n/).map((b) => b.trim().split(/\s+/).reverse()));
  assert.deepEqual(s.hash_file_prompt, Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1))));
  assert.deepEqual(s.prompt_user_kanonik, { deteksi: 'u0', 'SONAR-01': 'u1' });
  assert.equal(s.prompt_system_kanonik, 'ps');
  assert.equal(s.commit_kode, 'h'.repeat(40));
});

test('--lanjut: sidik sama diterima, satu perbedaan apa pun ditolak', () => {
  const lama = { sidik_run: sidikDasar() };
  assert.doesNotThrow(() => periksaLanjut(lama, sidikDasar()));
  const ubah = [
    ['hash_file_prompt.task-detection.txt', (s) => { s.hash_file_prompt['task-detection.txt'] = 'x'; }],
    ['hash_file_prompt.detection.schema.json', (s) => { s.hash_file_prompt['detection.schema.json'] = 'x'; }],
    ['prompt_user_kanonik.SONAR-01', (s) => { s.prompt_user_kanonik['SONAR-01'] = 'x'; }],
    ['prompt_system_kanonik', (s) => { s.prompt_system_kanonik = 'x'; }],
    ['pengaturan.tingkat_thinking', (s) => { s.pengaturan.tingkat_thinking = 'medium'; }],
    ['pengaturan.batas_output', (s) => { s.pengaturan.batas_output = 32000; }],
    ['pengaturan.koneksi.body_timeout_ms', (s) => { s.pengaturan.koneksi.body_timeout_ms = 300000; }],
    ['sdk.openai', (s) => { s.sdk.openai = '7.40.0'; }],
    ['commit_kode', (s) => { s.commit_kode = 'lain'; }],
    ['sonar_beku_sha256_isi', (s) => { s.sonar_beku_sha256_isi = 'lain'; }],
    ['objek_uji.tree_src', (s) => { s.objek_uji.tree_src = 'lain'; }],
    ['hash_kode_sumber', (s) => { s.hash_kode_sumber = 'lain'; }],
    ['model_diminta', (s) => { s.model_diminta = 'lain'; }],
    ['vendor', (s) => { s.vendor = 'openai'; }],
  ];
  for (const [jalur, fn] of ubah) {
    const baru = sidikDasar();
    fn(baru);
    assert.deepEqual(bedaSidik(lama.sidik_run, baru), [jalur]);
    assert.throws(() => periksaLanjut(lama, baru), new RegExp(`run ditolak. Berbeda: ${jalur.replace(/[.]/g, '\\.')}`));
  }
  const tambahAlert = sidikDasar();
  tambahAlert.prompt_user_kanonik['SONAR-02'] = 'u2';
  assert.throws(() => periksaLanjut(lama, tambahAlert), /prompt_user_kanonik\.SONAR-02/);
  assert.throws(() => periksaLanjut({}, sidikDasar()), /tidak punya sidik_run/);
});

const folderRun = (nomor, ekstra = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-run-'));
  for (const n of nomor) fs.writeFileSync(path.join(dir, `run-${n}.json`), '{}');
  for (const f of ekstra) fs.writeFileSync(path.join(dir, f), '{}');
  return dir;
};

test('nomor run: dilanjutkan dari yang terakhir, tidak menimpa, dan tidak melewati target tanpa opsi eksplisit', () => {
  assert.deepEqual(rencanaNomorRun({ folder: folderRun([]), target: 3, jalankan: 1 }), [1]);
  assert.deepEqual(rencanaNomorRun({ folder: folderRun([]), target: 3, jalankan: 3 }), [1, 2, 3]);
  assert.deepEqual(rencanaNomorRun({ folder: folderRun([1]), target: 3, jalankan: 1 }), [2]);
  assert.deepEqual(rencanaNomorRun({ folder: folderRun([1, 2]), target: 3, jalankan: 1 }), [3]);
  assert.throws(() => rencanaNomorRun({ folder: folderRun([1, 2, 3]), target: 3, jalankan: 1 }), /berisi 3 dari 3 run.*--lewati-target/);
  assert.deepEqual(rencanaNomorRun({ folder: folderRun([1, 2, 3]), target: 3, jalankan: 1, lewatiTarget: true }), [4]);
  assert.throws(() => rencanaNomorRun({ folder: folderRun([1]), target: 3, jalankan: 3 }), /melewati target/);
  assert.throws(() => rencanaNomorRun({ folder: folderRun([1, 3]), target: 3, jalankan: 1 }), /tidak berurutan/);
  assert.throws(() => rencanaNomorRun({ folder: folderRun([1], ['run-2.raw.json']), target: 3, jalankan: 1 }), /run-2\.raw\.json sudah ada.*tidak ditimpa/);
  assert.throws(() => rencanaNomorRun({ folder: folderRun([]), target: 3, jalankan: 0 }), /--jalankan/);
});
