// Pemetaan job GitHub Actions ke node graf pipeline.
//
// Sejak analisis-v2 bermatriks vendor, GitHub menamai jobnya "<nama job> (<nilai matriks>)".
// Pencocokan nama yang persis membuat node itu tidak menemukan job apa pun, sehingga run yang
// jelas-jelas berhasil tampil "tidak ada di run ini" — persis yang terjadi di run #2 repo demo
// untuk skenario C vendor openai.
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

// Potongan diambil berurutan karena saling memanggil: bacaStatus dan lamaDetik dipakai
// statusSatuJob, yang dipakai statusNodeDariJob, yang dipakai jobsDariApi.
const { jobsDariApi, cocokJobNode } = (() => {
  const sumber = [
    potong('  const bacaStatus = (status, conclusion) => {', '\n  };'),
    potong('  const lamaDetik = (mulai, selesai) => {', '\n  };'),
    potong('  const cocokJobNode = (namaJob, namaNode) => {', '\n  };'),
    potong('  const statusSatuJob = (job) => {', '\n  };'),
    potong('  const statusNodeDariJob = (jobs, selesai = false) => {', '\n  };'),
    potong('  const jobsDariApi = (daftar, node', '\n    }));'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${sumber}\n  return { jobsDariApi, cocokJobNode };`)();
})();

// Node graf yang relevan, memakai nama job persis seperti di PIPELINE dan di devsecops.yml.
const NODE = [
  { key: 'analisis-v2', job: 'Analisis LLM v2 (deteksi dan verifikasi)' },
  { key: 'terbit-v2', job: 'Gabung dan terbitkan hasil v2' },
  { key: 'hasil', job: 'Gabung dan terbitkan hasil' },
  { key: 'build', job: 'Build dan uji API' },
];

const job = (nama, { s = 'completed', c = 'success', id = 1, mulai = '2026-10-20T10:00:00Z', selesai = '2026-10-20T10:03:00Z', steps = null } = {}) => ({
  name: nama, status: s, conclusion: c, id, started_at: mulai, completed_at: selesai, steps,
});

test('nama job matriks dikenali, dan awalan yang mirip tidak ikut tertangkap', () => {
  assert.deepEqual(cocokJobNode('Analisis LLM v2 (deteksi dan verifikasi)', 'Analisis LLM v2 (deteksi dan verifikasi)'),
    { cocok: true, varian: null });
  assert.deepEqual(cocokJobNode('Analisis LLM v2 (deteksi dan verifikasi) (openai)', 'Analisis LLM v2 (deteksi dan verifikasi)'),
    { cocok: true, varian: 'openai' });
  // Inti jebakannya: nama satu node adalah awalan nama node lain.
  assert.equal(cocokJobNode('Gabung dan terbitkan hasil v2', 'Gabung dan terbitkan hasil').cocok, false);
  assert.equal(cocokJobNode('Gabung dan terbitkan hasil', 'Gabung dan terbitkan hasil v2').cocok, false);
  assert.equal(cocokJobNode('Analisis LLM v2 (deteksi dan verifikasi) (openai)', 'Gabung dan terbitkan hasil').cocok, false);
});

test('satu vendor: job bermatriks tetap mengisi nodenya', () => {
  // Bentuk yang benar-benar dikembalikan API untuk run #2 repo demo, skenario C openai.
  const daftar = [
    job('Build dan uji API', { id: 10 }),
    job('Analisis LLM v2 (deteksi dan verifikasi) (openai)', { id: 11, steps: [
      { name: 'Jalankan llm-scan', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:10Z', completed_at: '2026-10-20T10:02:50Z' },
    ] }),
    job('Gabung dan terbitkan hasil v2', { id: 12 }),
  ];
  const st = jobsDariApi(daftar, NODE, true);
  assert.equal(st['analisis-v2'].s, 'done', 'node analisis-v2 harus selesai, bukan absen');
  assert.notEqual(st['analisis-v2'].s, 'absen');
  // Satu job: tautan lognya tetap ada seperti sebelumnya.
  assert.equal(st['analisis-v2'].id, 11);
  assert.equal(st['analisis-v2'].durasi, 180);
  // Satu vendor tidak perlu label varian di tiap langkah; itu hanya menambah bising.
  assert.equal(st['analisis-v2'].langkah.length, 1);
  assert.equal(st['analisis-v2'].langkah[0].varian, undefined);
  assert.equal(st['terbit-v2'].s, 'done');
  assert.equal(st.build.s, 'done');
  // Node yang memang tidak ada job cocoknya tetap absen pada run yang sudah selesai.
  assert.equal(st.hasil.s, 'absen');
});

test('gabungan tiga vendor: satu gagal membuat nodenya gagal, rinciannya utuh', () => {
  const daftar = [
    job('Analisis LLM v2 (deteksi dan verifikasi) (google)', { id: 21, mulai: '2026-10-20T10:00:00Z', selesai: '2026-10-20T10:04:00Z', steps: [
      { name: 'Jalankan llm-scan', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:00Z', completed_at: '2026-10-20T10:04:00Z' },
    ] }),
    job('Analisis LLM v2 (deteksi dan verifikasi) (anthropic)', { id: 22, c: 'failure', mulai: '2026-10-20T10:00:05Z', selesai: '2026-10-20T10:01:00Z', steps: [
      { name: 'Jalankan llm-scan', status: 'completed', conclusion: 'failure', started_at: '2026-10-20T10:00:05Z', completed_at: '2026-10-20T10:01:00Z' },
    ] }),
    job('Analisis LLM v2 (deteksi dan verifikasi) (openai)', { id: 23, mulai: '2026-10-20T10:00:02Z', selesai: '2026-10-20T10:05:00Z', steps: [
      { name: 'Jalankan llm-scan', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:02Z', completed_at: '2026-10-20T10:05:00Z' },
    ] }),
  ];
  const st = jobsDariApi(daftar, NODE, true)['analisis-v2'];
  // Tidak pernah lebih optimistis dari kenyataan: satu vendor gagal, nodenya gagal.
  assert.equal(st.s, 'fail');
  // Rinciannya tidak hilang, hanya ringkasannya.
  assert.deepEqual(st.per.map((v) => [v.varian, v.s]), [['google', 'done'], ['anthropic', 'fail'], ['openai', 'done']]);
  assert.deepEqual(st.per.map((v) => v.id), [21, 22, 23]);
  // Job matriks berjalan paralel: lamanya rentang dinding jam, bukan jumlah ketiganya.
  // Mulai paling awal 10:00:00, selesai paling akhir 10:05:00 = 300 detik, bukan 240+55+298.
  assert.equal(st.durasi, 300);
  // Tidak ada satu log yang mewakili tiga job, jadi kartunya tidak menautkan apa pun; tautan per
  // vendor disediakan panel langkah.
  assert.equal(st.id, null);
  // Langkah ketiganya digabung dan masing-masing membawa nama variannya.
  assert.equal(st.langkah.length, 3);
  assert.deepEqual(st.langkah.map((l) => l.varian), ['google', 'anthropic', 'openai']);
});

test('gabungan: semua sukses selesai, semua dilewati dilewati, ada yang berjalan berjalan', () => {
  const tiga = (bentuk) => jobsDariApi(
    bentuk.map((b, i) => job(`Analisis LLM v2 (deteksi dan verifikasi) (v${i})`, b)), NODE, true,
  )['analisis-v2'].s;
  assert.equal(tiga([{}, {}, {}]), 'done');
  assert.equal(tiga([{ c: 'skipped' }, { c: 'skipped' }, { c: 'skipped' }]), 'skip');
  assert.equal(tiga([{}, { s: 'in_progress', c: null }, {}]), 'run');
  assert.equal(tiga([{}, { c: 'cancelled' }, {}]), 'fail', 'cancelled bukan keberhasilan');
  // Sebagian selesai dan sebagian belum mulai berarti masih berjalan, bukan menunggu.
  assert.equal(tiga([{}, { s: 'queued', c: null }, {}]), 'run');
  // Belum ada satu pun yang mulai: menunggu.
  assert.equal(tiga([{ s: 'queued', c: null }, { s: 'queued', c: null }, { s: 'queued', c: null }]), 'wait');
  // Campur selesai dan dilewati bukan kegagalan.
  assert.equal(tiga([{}, { c: 'skipped' }, {}]), 'done');
});

test('run lama tanpa matriks tetap terbaca seperti sebelumnya', () => {
  // Run #54 berjalan sebelum analisis-v2 bermatriks: nama jobnya tanpa akhiran apa pun.
  const daftar = [
    job('Build dan uji API', { id: 1 }),
    job('Analisis LLM v2 (deteksi dan verifikasi)', { id: 2 }),
  ];
  const st = jobsDariApi(daftar, NODE, true);
  assert.equal(st['analisis-v2'].s, 'done');
  assert.equal(st['analisis-v2'].id, 2, 'satu job: tautan log tetap menunjuk job itu');
  assert.deepEqual(st['analisis-v2'].per.map((v) => v.varian), [null]);
  // Job terbit-v2 belum ada saat run itu berjalan, dan itu harus terbaca apa adanya.
  assert.equal(st['terbit-v2'].s, 'absen');
});

test('run yang masih berjalan: job yang belum muncul berarti menunggu, bukan absen', () => {
  const daftar = [job('Build dan uji API', { s: 'in_progress', c: null })];
  const st = jobsDariApi(daftar, NODE, false);
  assert.equal(st.build.s, 'run');
  assert.equal(st['analisis-v2'].s, 'wait', 'run berjalan: job yang belum ada masih mungkin berjalan');
  assert.equal(st['terbit-v2'].s, 'wait');
});

test('rekaman run CI #54 di fixture tetap menghasilkan status yang sama', () => {
  // Mode demo menggambar graf dari rekaman ini. Perubahan pencocokan nama job tidak boleh
  // menggeser satu pun statusnya.
  const rekaman = require('../dashboard/fixtures/v2/rekaman/run-54.json');
  const node = [
    { key: 'rencana', job: 'Tentukan mode analisis' },
    { key: 'build', job: 'Build dan uji API' },
    { key: 'sonar', job: 'Analisis SonarCloud' },
    { key: 'analisis', job: 'Analisis temuan (Sonar dan Gemini)' },
    { key: 'analisis-v2', job: 'Analisis LLM v2 (deteksi dan verifikasi)' },
    { key: 'terbit-v2', job: 'Gabung dan terbitkan hasil v2' },
    { key: 'hasil', job: 'Gabung dan terbitkan hasil' },
  ];
  const st = jobsDariApi(rekaman.jobs, node, true);
  for (const n of node) {
    const cocok = rekaman.jobs.filter((j) => j.name === n.job);
    if (!cocok.length) {
      assert.equal(st[n.key].s, 'absen', `${n.key} tanpa job di rekaman harus absen`);
      continue;
    }
    assert.equal(st[n.key].per.length, cocok.length, `${n.key} harus cocok dengan ${cocok.length} job`);
    assert.equal(st[n.key].id, cocok[0].id, `${n.key} menautkan job yang benar`);
    assert.notEqual(st[n.key].s, 'absen', `${n.key} punya job di rekaman, tidak boleh absen`);
  }
  // Rekaman #54 memotret pipeline sebelum matriks ada, jadi tidak satu pun jobnya bervarian.
  for (const k of Object.keys(st)) {
    assert.ok((st[k].per ?? []).every((v) => v.varian === null), `${k} tidak boleh punya varian di rekaman #54`);
  }
});
