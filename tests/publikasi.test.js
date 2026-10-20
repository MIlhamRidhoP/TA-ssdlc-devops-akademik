// Tes penerbitan ke branch security-results: satu berkas index per skema, nomor run v2 berasal dari
// nomor run GitHub, dan tidak ada jalur penerbitan yang bisa membuang entri skema lain dari index.
//
// Latar: sebelum ini kedua skema memakai index.json yang sama dan saling menghapus. Pada run #46
// hasil v2 terbit lebih dulu, lalu penerbitan skema 1 dari job `hasil` menimpanya, sehingga hasil
// yang berbiaya itu hilang dari daftar dashboard. Tes di bawah mengunci kedua perbaikannya.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { susunHasil, terbitkan, FILE_INDEX } = require('../scripts/merge-results');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'merge');
const baca = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const geminiRun = baca(path.join(FIXTURE, 'run-1.json'));
const sonarTemuan = baca(path.join(FIXTURE, 'sonar-temuan.json'));
const rootKosong = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-root-'));

// Hasil skema 2 nyata dari eksperimen 19 Okt, dipakai apa adanya kecuali nomor dan id run.
const hasilV2 = (ubah = {}) => {
  const r = baca(path.join(ROOT, 'dashboard', 'fixtures', 'v2', 'eksperimen', 'seeded', '1.json'));
  return { ...r, run: { ...r.run, ...ubah } };
};

const hasilV1 = (ubah = {}) => susunHasil({
  meta: {
    id: 900, nomor: 46, repo: 'o/r', commit: '5cbf05c928cd375fa51f773a03ca4779dde42e70', branch: 'feat/prompt-v2',
    label: null, mulai: '2026-10-19T23:43:11Z', mode: 'sast-llm', model: 'gemini-3.8-flash', jobs: {}, ...ubah,
  },
  sonarTemuan,
  geminiRun,
  root: rootKosong,
});

const dirBaru = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pub-'));
const tulis = (dir, isi) => {
  const f = path.join(dir, 'results.json');
  fs.writeFileSync(f, JSON.stringify(isi));
  return f;
};
const bacaIndex = (dir, nama) => (fs.existsSync(path.join(dir, nama)) ? baca(path.join(dir, nama)) : null);

test('skema 2 terbit ke index.json, skema 1 ke index-v1.json', () => {
  assert.deepEqual(FILE_INDEX, { 1: 'index-v1.json', 2: 'index.json' });
  const dir = dirBaru();
  terbitkan(tulis(dir, hasilV2({ nomor: 46, id: 39343292014 })), dir);
  terbitkan(tulis(dir, hasilV1()), dir);

  const v2 = bacaIndex(dir, 'index.json');
  const v1 = bacaIndex(dir, 'index-v1.json');
  assert.equal(v2.schema_version, 2);
  assert.equal(v1.schema_version, 1);
  assert.deepEqual(v2.runs.map((x) => x.nomor), [46]);
  assert.deepEqual(v1.runs.map((x) => x.nomor), [46]);
  // Inti perbaikannya: penerbitan skema 1 tidak menyentuh index yang dibaca dashboard.
  // Branch pada entri v2 berasal dari objek uji, pada entri v1 dari branch run; keduanya terpisah.
  assert.equal(v2.runs[0].path, 'eksperimen/seeded/46.json');
  assert.equal(v1.runs[0].path, 'feat/prompt-v2/46.json');
});

test('penerbitan skema 1 tidak membuang entri skema 2 dari index utama, dan sebaliknya', () => {
  const dir = dirBaru();
  terbitkan(tulis(dir, hasilV2({ nomor: 46, id: 1 })), dir);
  const sebelum = bacaIndex(dir, 'index.json');

  for (let n = 47; n <= 49; n++) terbitkan(tulis(dir, hasilV1({ id: n, nomor: n })), dir);
  assert.deepEqual(bacaIndex(dir, 'index.json'), sebelum, 'index.json berubah gara-gara penerbitan skema 1');

  terbitkan(tulis(dir, hasilV2({ nomor: 50, id: 2, selesai: '2026-10-20T00:00:00Z' })), dir);
  assert.deepEqual(bacaIndex(dir, 'index.json').runs.map((x) => x.nomor), [50, 46]);
  assert.deepEqual(bacaIndex(dir, 'index-v1.json').runs.map((x) => x.nomor), [49, 48, 47]);
});

test('index berisi skema lain ditolak, bukan ditimpa diam-diam', () => {
  const dir = dirBaru();
  // Keadaan branch security-results setelah run #46: index.json masih memegang entri skema 1.
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ schema_version: 1, runs: [{ id: 1, nomor: 46 }] }));
  assert.throws(() => terbitkan(tulis(dir, hasilV2({ nomor: 47, id: 3 })), dir), /berisi skema 1, bukan 2/);
  // Berkas lama tidak disentuh, jadi tidak ada entri yang hilang sebelum dirapikan.
  assert.deepEqual(bacaIndex(dir, 'index.json').runs.map((x) => x.nomor), [46]);
});

test('nomor run v2 menentukan nama berkas, jadi dua run tidak saling menimpa', () => {
  const dir = dirBaru();
  terbitkan(tulis(dir, hasilV2({ nomor: 46, id: 1 })), dir);
  terbitkan(tulis(dir, hasilV2({ nomor: 47, id: 2, selesai: '2026-10-20T00:00:00Z' })), dir);
  assert.ok(fs.existsSync(path.join(dir, 'feat/prompt-v2'.split('/').join(path.sep), '46.json')) === false);
  for (const n of [46, 47]) {
    assert.ok(fs.existsSync(path.join(dir, 'eksperimen', 'seeded', `${n}.json`)), `berkas run ${n} tidak ada`);
  }
  assert.deepEqual(bacaIndex(dir, 'index.json').runs.map((x) => x.path),
    ['eksperimen/seeded/47.json', 'eksperimen/seeded/46.json']);
});

// Pemeriksaan tingkat workflow: --nomor dan gerbang jalur v2 mudah hilang saat workflow disunting,
// dan kehilangannya baru terlihat setelah run berbayar. Diperiksa sebagai teks supaya tes ini tidak
// menambah dependensi YAML ke repo.
test('workflow meneruskan nomor run GitHub ke penyusunan results.json v2', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  const langkah = wf.slice(wf.indexOf('- name: Susun results.json skema 2'));
  const perintah = langkah.slice(0, langkah.indexOf('- name: Unggah output v2'));
  assert.match(perintah, /merge-results\.js merge --v2/);
  assert.match(perintah, /--nomor="\$GITHUB_RUN_NUMBER"/);
  // id run GitHub berbeda dari nomor run; dashboard memakainya untuk menarik status job.
  assert.match(perintah, /--id="\$GITHUB_RUN_ID"/);
});

test('id run v2 terpisah dari nomor, dan ikut ke entri index', () => {
  const { susunHasilV2, entriIndexV2 } = require('../scripts/llm/results-v2');
  const sumber = {
    summary: {
      vendor: 'google', model_diminta: 'gemini-3.1-pro-preview', kondisi: 'utama',
      objek_uji: { commit: 'a'.repeat(40), branch: 'feat/prompt-v2', tree_src: 'b'.repeat(40) },
    },
    run: { deteksi: {}, verifikasi: [], temuan: [] },
    alert: [],
    parseCwe: () => [],
  };
  const dengan = susunHasilV2({ ...sumber, nomor: 46, id: 39343292014 });
  assert.equal(dengan.run.nomor, 46);
  assert.equal(dengan.run.id, 39343292014);
  assert.equal(entriIndexV2(dengan, 'a/46.json').id, 39343292014);
  // Dari CLI tidak ada run id GitHub; id ikut nomor seperti sebelumnya.
  assert.equal(susunHasilV2({ ...sumber, nomor: 3 }).run.id, 3);
});

test('job hasil mundur saat analisis-v2 yang menerbitkan, supaya tidak terbit dua kali', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  const kondisi = (nama) => {
    const job = wf.slice(wf.indexOf(`\n  ${nama}:`));
    return job.slice(0, job.indexOf('runs-on:')).replace(/\s+/g, ' ');
  };
  // Jalur v2 berbiaya menerbitkan sendiri; mode sast tidak memanggil LLM dan tetap lewat job hasil.
  const kecuali = /inputs\.jalur != 'v2' \|\| needs\.rencana\.outputs\.mode == 'sast'/;
  assert.match(kondisi('hasil'), kecuali);
  assert.match(kondisi('analisis'), kecuali);
  // Tanpa syarat mode ini, dispatch mode=sast dengan jalur bawaan v2 akan memanggil LLM.
  assert.match(kondisi('analisis-v2'), /needs\.rencana\.outputs\.mode == 'sast-llm'/);
});

test('kedua langkah penerbitan berhenti saat publish gagal, bukan berakhir hijau', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  const langkah = wf.split('- name: Terbitkan ke branch security-results').slice(1);
  assert.equal(langkah.length, 2, 'harus ada dua langkah penerbitan: jalur v1 dan v2');
  for (const l of langkah) {
    const blok = l.slice(0, l.indexOf('exit 1'));
    // Tanpa set -e, galat publish tertelan dan push "berhasil" tanpa membawa hasil apa pun.
    assert.match(blok, /set -euo pipefail/);
    assert.match(blok, /diff --cached --quiet/);
  }
});

// Durasi run v2 dan asalnya. Keduanya metadata kecil yang mudah hilang diam-diam dan baru
// ketahuan setelah run berbayar: durasi dihitung dari panggilan pertama sampai terakhir, dan
// asal menentukan apakah dashboard boleh menyebut run itu dijalankan dari CLI.
test('durasi run v2 dihitung dari panggilan pertama sampai terakhir', () => {
  const { susunHasilV2 } = require('../scripts/llm/results-v2');
  const dasar = {
    summary: {
      vendor: 'google', model_diminta: 'gemini-3.1-pro-preview', kondisi: 'utama',
      objek_uji: { commit: 'a'.repeat(40), branch: 'feat/prompt-v2', tree_src: 'b'.repeat(40) },
    },
    alert: [],
    parseCwe: () => [],
  };
  const run = {
    deteksi: { waktu_mulai: '2026-10-20T00:52:14.869Z', waktu_selesai: '2026-10-20T00:53:00.000Z' },
    verifikasi: [{ metadata: { waktu_mulai: '2026-10-20T00:53:01.000Z', waktu_selesai: '2026-10-20T00:55:58.949Z' } }],
    temuan: [],
  };
  const h = susunHasilV2({ ...dasar, run, nomor: 49, id: 39350138907 });
  assert.equal(h.run.mulai, '2026-10-20T00:52:14.869Z');
  assert.equal(h.run.selesai, '2026-10-20T00:55:58.949Z');
  assert.equal(h.run.durasi_detik, 224, 'durasi run #49 yang sebenarnya');

  // Tanpa waktu, durasi null dan bukan angka karangan.
  const kosong = susunHasilV2({ ...dasar, run: { deteksi: {}, verifikasi: [], temuan: [] }, nomor: 1 });
  assert.equal(kosong.run.durasi_detik, null);
});

test('asal run dicatat, supaya run pipeline tidak dilabeli dijalankan dari CLI', () => {
  const { susunHasilV2 } = require('../scripts/llm/results-v2');
  const dasar = {
    summary: {
      vendor: 'google', model_diminta: 'gemini-3.1-pro-preview', kondisi: 'utama',
      objek_uji: { commit: 'a'.repeat(40), branch: 'feat/prompt-v2', tree_src: 'b'.repeat(40) },
    },
    run: { deteksi: {}, verifikasi: [], temuan: [] },
    alert: [],
    parseCwe: () => [],
  };
  // --id hanya diteruskan workflow, jadi keberadaannya menandai run CI.
  assert.equal(susunHasilV2({ ...dasar, nomor: 49, id: 39350138907 }).run.asal, 'workflow');
  assert.equal(susunHasilV2({ ...dasar, nomor: 3 }).run.asal, 'cli');
  // Fixture demo memang run CLI, dan dashboard memakainya untuk menyatakan asal.
  for (const n of [1, 2, 3]) {
    assert.equal(require(`../dashboard/fixtures/v2/eksperimen/seeded/${n}.json`).run.asal, 'cli');
  }
});
