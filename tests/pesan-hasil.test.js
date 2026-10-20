// Pesan saat hasil run tidak ditemukan di index.json.
//
// Tiga keadaan yang sangat berbeda pernah dilaporkan dengan kalimat yang sama, dan salah satunya
// berbohong: dispatch skenario A ke repo demo berhasil (204), runnya berjalan dan SUKSES, tetapi
// hasilnya terbit sebagai skema 1 sehingga tidak ada di index.json. Dashboard menulis "Run tidak
// jadi dijalankan" — persis kebalikan dari yang terjadi.
//
// Fungsinya hidup di dalam IIFE dashboard/app.js, jadi diambil apa adanya dari berkas itu lalu
// dijalankan di sini: yang diuji benar-benar kode yang dimuat browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');

const potong = (awal, akhir) => {
  const i = app.indexOf(awal);
  assert.ok(i > 0, `${awal.trim()} tidak ditemukan di dashboard/app.js`);
  const j = app.indexOf(akhir, i);
  assert.ok(j > i, `akhir blok untuk ${awal.trim()} tidak ditemukan`);
  return app.slice(i, j + akhir.length);
};

// GhError dan galatHasilTakAda diambil apa adanya. gh() dan repoPath distub: yang diuji
// pengambilan keputusannya, bukan lapisan jaringannya.
const buat = (jawabanRun) => {
  const sumber = [
    potong('  class GhError extends Error {', '\n  }'),
    potong('  const galatHasilTakAda = async (p, run, jalur) => {', '\n  };'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('ghStub', `
    const repoPath = () => '/repos/o/r';
    const gh = ghStub;
    const el = () => null;
    const linkRun = (url, teks) => teks;
    ${sumber}
    return galatHasilTakAda;
  `)(jawabanRun);
};

const RUN = { id: 99, run_number: 3, html_url: 'https://github.com/o/r/actions/runs/99' };
const panggil = async (info, jalur = 'v1') => {
  const f = buat(async () => info);
  return f({ owner: 'o', repo: 'r' }, RUN, jalur);
};

test('run gagal: dikatakan gagal, bukan tidak jadi dijalankan', async () => {
  const err = await panggil({ ...RUN, status: 'completed', conclusion: 'failure' });
  assert.equal(err.jenis, 'hasil');
  assert.equal(err.judul, 'Run #3 gagal.');
  assert.ok(!/tidak jadi dijalankan/i.test(`${err.judul} ${err.message}`), 'tidak boleh menyebut "tidak jadi dijalankan"');
  assert.match(err.message, /tidak ada hasil yang diterbitkan/);
});

test('run dibatalkan dan kehabisan waktu punya kata masing-masing', async () => {
  assert.equal((await panggil({ ...RUN, status: 'completed', conclusion: 'cancelled' })).judul, 'Run #3 dibatalkan.');
  assert.equal((await panggil({ ...RUN, status: 'completed', conclusion: 'timed_out' })).judul, 'Run #3 kehabisan waktu.');
  // Kesimpulan yang tidak dikenal tetap disebut apa adanya, bukan diterjemahkan menjadi "gagal".
  assert.equal((await panggil({ ...RUN, status: 'completed', conclusion: 'neutral' })).judul, 'Run #3 neutral.');
});

test('run masih berjalan: bukan kegagalan, hanya belum waktunya', async () => {
  const err = await panggil({ ...RUN, status: 'in_progress', conclusion: null });
  assert.equal(err.judul, 'Run #3 masih berjalan.');
  assert.ok(!/gagal|tidak jadi dijalankan/i.test(`${err.judul} ${err.message}`), 'tidak boleh terbaca sebagai kegagalan');
  assert.match(err.message, /akan muncul sendiri/);
});

test('run sukses tetapi hasilnya tidak ada: disebut berhasil, dan sebabnya ditunjuk', async () => {
  // Keadaan yang benar-benar dilaporkan: jalur v1, terbit sebagai skema 1.
  const v1 = await panggil({ ...RUN, status: 'completed', conclusion: 'success' }, 'v1');
  assert.equal(v1.judul, 'Run #3 berhasil, tetapi hasilnya tidak muncul di dashboard.');
  assert.ok(!/tidak jadi dijalankan/i.test(`${v1.judul} ${v1.message}`));
  assert.match(v1.message, /berhasil/);
  assert.match(v1.message, /index-v1\.json/, 'sebab paling sering harus disebut: hasilnya terbit sebagai skema 1');
  assert.match(v1.message, /Gabung dan terbitkan hasil/);

  // Jalur v2: sebab skema 1 tidak berlaku, dan job terbit yang ditunjuk harus yang benar.
  const v2 = await panggil({ ...RUN, status: 'completed', conclusion: 'success' }, 'v2');
  assert.ok(!/index-v1\.json/.test(v2.message), 'jalur v2 tidak menerbitkan skema 1');
  assert.match(v2.message, /Gabung dan terbitkan hasil v2/, 'job penerbit jalur v2 harus disebut dengan nama barunya');
});

test('nama job penerbit yang disebut benar-benar ada di workflow', () => {
  // Pesan yang menyuruh membuka log job bernama X tidak berguna kalau job X tidak ada.
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  for (const nama of ['Gabung dan terbitkan hasil v2', 'Gabung dan terbitkan hasil']) {
    assert.ok(wf.includes(`name: ${nama}\n`), `job "${nama}" tidak ada di devsecops.yml`);
  }
});

test('keadaan GitHub ditanyakan ulang, bukan ditebak dari data lama', async () => {
  // Run bisa berubah keadaan selama dashboard menunggu hasilnya terbit. Yang dipakai harus jawaban
  // terbaru, bukan potret saat pemantauan berhenti.
  const f = buat(async () => ({ ...RUN, status: 'completed', conclusion: 'failure' }));
  const err = await f({ owner: 'o', repo: 'r' }, { ...RUN, status: 'completed', conclusion: 'success' }, 'v1');
  assert.equal(err.judul, 'Run #3 gagal.', 'harus memakai jawaban terbaru dari GitHub');
});

test('kalau GitHub tidak bisa ditanya, tetap memakai yang diketahui tanpa menebak', async () => {
  const f = buat(async () => { throw new Error('jaringan'); });
  const err = await f({ owner: 'o', repo: 'r' }, { ...RUN, status: 'completed', conclusion: 'success' }, 'v1');
  assert.equal(err.judul, 'Run #3 berhasil, tetapi hasilnya tidak muncul di dashboard.');
});
