// Jalur graf pipeline dan keaktifan nodenya, per skenario.
//
// Cacat yang dijaga di sini: jalur graf dulu disimpulkan dari `schema_version`. Sejak skenario A
// ikut menerbitkan skema 2, versi skema berhenti menjadi penanda jalur mana yang berjalan — run A
// berskema 2, tetapi job yang berjalan adalah rantai v1. Akibatnya graf run #5 repo demo menandai
// job yang BENAR-BENAR berjalan dan sukses ("Analisis temuan (Sonar dan Gemini)" dan "Gabung dan
// terbitkan hasil") sebagai "digantikan jalur v2", dan job v2 yang tidak pernah ada sebagai
// "dilewati" — seolah penerbitan tidak terjadi.
//
// Aturan terpenting di berkas ini, dan yang paling murah membuktikannya: setiap job yang
// conclusion-nya success WAJIB tampil selesai di node yang cocok. Aturan jalur boleh salah; yang
// tidak boleh adalah graf menyangkal job yang jelas-jelas berjalan di GitHub.
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

// PIPELINE dibaca dari app.js, bukan disalin, supaya tes ini ikut berubah saat grafnya berubah.
const PIPELINE = (() => {
  const blok = app.slice(app.indexOf('const PIPELINE = ['), app.indexOf('\n  ];', app.indexOf('const PIPELINE = [')));
  const pola = /\{ key: '([^']+)', id: '([^']+)', job: '([^']+)', nama: '([^']*)', hasil: [^,]+, perlu: \[[^\]]*\], jalur: '([^']+)' \}/g;
  return [...blok.matchAll(pola)].map((m) => ({ key: m[1], id: m[2], job: m[3], nama: m[4], jalur: m[5] }));
})();

const { jobsDariApi, JALUR_SKENARIO, simpulAktif } = (() => {
  const sumber = [
    // Dipotong TEPAT sebelum jalurAktif: blok ini hanya butuh JALUR_SKENARIO dan skenarioAktif,
    // dan jalurAktif sendiri bergantung pada state dashboard yang tidak ada di sini.
    app.slice(app.indexOf('  const JALUR_SKENARIO = {'), app.indexOf('  const jalurAktif = (live)')),
    potong('  const bacaStatus = (status, conclusion) => {', '\n  };'),
    potong('  const lamaDetik = (mulai, selesai) => {', '\n  };'),
    potong('  const cocokJobNode = (namaJob, namaNode) => {', '\n  };'),
    potong('  const statusSatuJob = (job) => {', '\n  };'),
    potong('  const statusNodeDariJob = (jobs, selesai = false) => {', '\n  };'),
    potong('  const jobsDariApi = (daftar, node', '\n    }));'),
    potong('  const simpulAktif = (n, jalur) =>', '\n'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`
    const state = {};
    const jalurTerpilih = () => 'v2';
    const nodeJalur = () => [];
    ${sumber}
    return { jobsDariApi, JALUR_SKENARIO, simpulAktif };
  `)();
})();

const nodeJalur = (jalur) => PIPELINE.filter((n) => n.jalur === 'kedua' || n.jalur === jalur);
const jobNode = (key) => PIPELINE.find((n) => n.key === key).job;

const job = (nama, { c = 'success', id = 1 } = {}) => ({
  name: nama, status: 'completed', conclusion: c, id,
  started_at: '2026-10-20T10:00:00Z', completed_at: '2026-10-20T10:03:00Z', steps: null,
});

// Jawaban jobs API yang bentuknya seperti aslinya. Job yang dilewati GitHub tetap muncul di daftar
// dengan conclusion "skipped"; itu yang membedakannya dari job yang tidak ada sama sekali.
const RESPONS = {
  'A (run #5, skema 2)': {
    jalur: 'v1',
    jobs: [
      job(jobNode('rencana'), { id: 1 }), job(jobNode('build'), { id: 2 }), job(jobNode('sonar'), { id: 3 }),
      job(jobNode('analisis'), { id: 4 }), job(jobNode('hasil'), { id: 5 }),
      job(jobNode('analisis-v2'), { c: 'skipped', id: 6 }), job(jobNode('terbit-v2'), { c: 'skipped', id: 7 }),
    ],
    sukses: ['rencana', 'build', 'sonar', 'analisis', 'hasil'],
  },
  'A lama (run #3, jalur v1)': {
    jalur: 'v1',
    jobs: [
      job(jobNode('rencana'), { id: 1 }), job(jobNode('build'), { id: 2 }), job(jobNode('sonar'), { id: 3 }),
      job(jobNode('analisis'), { id: 4 }), job(jobNode('hasil'), { id: 5 }),
    ],
    sukses: ['rencana', 'build', 'sonar', 'analisis', 'hasil'],
  },
  'B tunggal': {
    jalur: 'v2',
    jobs: [
      job(jobNode('rencana'), { id: 1 }), job(jobNode('build'), { id: 2 }), job(jobNode('sonar'), { id: 3 }),
      job(`${jobNode('analisis-v2')} (google)`, { id: 4 }), job(jobNode('terbit-v2'), { id: 5 }),
      job(jobNode('analisis'), { c: 'skipped', id: 6 }), job(jobNode('hasil'), { c: 'skipped', id: 7 }),
    ],
    sukses: ['rencana', 'build', 'sonar', 'analisis-v2', 'terbit-v2'],
  },
  'B gabungan': {
    jalur: 'v2',
    jobs: [
      job(jobNode('rencana'), { id: 1 }), job(jobNode('build'), { id: 2 }), job(jobNode('sonar'), { id: 3 }),
      job(`${jobNode('analisis-v2')} (google)`, { id: 4 }),
      job(`${jobNode('analisis-v2')} (anthropic)`, { id: 5 }),
      job(`${jobNode('analisis-v2')} (openai)`, { id: 6 }),
      job(jobNode('terbit-v2'), { id: 7 }),
    ],
    sukses: ['rencana', 'build', 'sonar', 'analisis-v2', 'terbit-v2'],
  },
  C: {
    jalur: 'v2',
    jobs: [
      job(jobNode('rencana'), { id: 1 }), job(jobNode('build'), { id: 2 }), job(jobNode('sonar'), { id: 3 }),
      job(`${jobNode('analisis-v2')} (openai)`, { id: 4 }), job(jobNode('terbit-v2'), { id: 5 }),
    ],
    sukses: ['rencana', 'build', 'sonar', 'analisis-v2', 'terbit-v2'],
  },
};

test('skenario menentukan jalur graf, bukan versi skema', () => {
  // Inti cacatnya: skenario A berskema 2 tetapi berjalan di rantai v1.
  assert.equal(JALUR_SKENARIO.A, 'v1');
  assert.equal(JALUR_SKENARIO.B, 'v2');
  assert.equal(JALUR_SKENARIO.C, 'v2');
});

test('node aktif skenario A persis rantai v1', () => {
  const aktif = nodeJalur('v1').map((n) => n.key);
  assert.deepEqual(aktif, ['rencana', 'build', 'sonar', 'analisis', 'hasil'],
    'skenario A memakai mode analisis, build dan uji, SonarCloud, job analisis, dan job hasil');
  // Dan node v2 memang bukan bagian dari jalur itu.
  for (const k of ['analisis-v2', 'terbit-v2']) {
    assert.equal(simpulAktif(PIPELINE.find((n) => n.key === k), 'v1'), false, `${k} tidak aktif di jalur v1`);
  }
});

test('setiap job yang sukses tampil selesai di node yang cocok', () => {
  // Aturan paling penting di berkas ini, dan berlaku untuk SEMUA skenario: graf tidak boleh
  // menyangkal job yang berjalan dan sukses di GitHub.
  for (const [nama, kasus] of Object.entries(RESPONS)) {
    const st = jobsDariApi(kasus.jobs, PIPELINE, true);
    for (const key of kasus.sukses) {
      assert.equal(st[key].s, 'done', `${nama}: node ${key} harus selesai`);
      assert.ok((st[key].per ?? []).length > 0, `${nama}: node ${key} harus punya job yang cocok`);
    }
    // Tidak ada job sukses di jawaban API yang kehilangan nodenya.
    for (const j of kasus.jobs.filter((x) => x.conclusion === 'success')) {
      const cocok = Object.entries(st).filter(([, v]) => (v.per ?? []).some((p) => p.id === j.id));
      assert.equal(cocok.length, 1, `${nama}: job "${j.name}" harus dipetakan ke tepat satu node`);
      assert.equal(cocok[0][1].s, 'done', `${nama}: job "${j.name}" sukses tetapi nodenya ${cocok[0][1].s}`);
    }
  }
});

test('job yang benar-benar berjalan tidak pernah ditandai luar jalur', () => {
  // Penjagaan terhadap aturan jalur yang salah: node di luar jalur hanya boleh ditandai begitu
  // kalau memang tidak ada job yang cocok dengannya. Di skenario A, job analisis dan hasil ADA,
  // jadi apa pun yang dikatakan aturan jalur, keduanya tidak boleh dianggap tak terpakai.
  const kasus = RESPONS['A (run #5, skema 2)'];
  const st = jobsDariApi(kasus.jobs, PIPELINE, true);
  for (const key of ['analisis', 'hasil']) {
    assert.ok((st[key].per ?? []).length > 0, `node ${key} punya job di jawaban API`);
    assert.equal(st[key].s, 'done');
  }
  // Job v2 dilewati GitHub: statusnya "dilewati" apa adanya, bukan dikarang.
  for (const key of ['analisis-v2', 'terbit-v2']) {
    assert.equal(st[key].s, 'skip', `node ${key} dilewati GitHub, jadi statusnya dilewati`);
  }
});

test('skenario A tanpa job v2 sama sekali: node v2 tidak ada di run ini', () => {
  // Run A lama tidak punya job v2 di daftarnya. Statusnya "absen", dan di layar node itu ditandai
  // tidak dipakai; yang penting ia tidak diklaim "dilewati", karena tidak ada yang melewatinya.
  const kasus = RESPONS['A lama (run #3, jalur v1)'];
  const st = jobsDariApi(kasus.jobs, PIPELINE, true);
  for (const key of ['analisis-v2', 'terbit-v2']) {
    assert.equal(st[key].s, 'absen', `node ${key} tidak ada di run lama`);
    assert.deepEqual(st[key].per, []);
  }
});

test('label node analisis mengikuti skenario, bukan pilihan di drawer', () => {
  // Sebelumnya label diambil dari `mode`, yang tidak ada di skema 2 sehingga jatuh ke modeTerpilih()
  // milik drawer: label run tersimpan berubah mengikuti apa yang kebetulan dipilih pengguna.
  const blok = app.slice(app.indexOf('const nama = dipakai && n.key =='), app.indexOf('const langkah =', app.indexOf('const nama = dipakai')));
  assert.match(blok, /skenarioGraf === 'A'/, 'label harus diturunkan dari skenario run');
  assert.match(blok, /Ambil temuan Sonar/, 'skenario A memakai label yang sama dengan run #3');
  // skenarioAktif membaca skenario run, bukan keadaan drawer.
  const sa = app.slice(app.indexOf('const skenarioAktif = (live) =>'), app.indexOf('\n', app.indexOf('const skenarioAktif = (live) =>')));
  assert.match(sa, /state\.hasil\?\.run\?\.skenario/);
  assert.ok(!/modeTerpilih/.test(sa), 'skenario tidak boleh diambil dari drawer');
});

test('teks node tak terpakai menyebut sebab yang benar', () => {
  const blok = potong('    const teksLuarJalur = (n) => {', '\n    };');
  assert.match(blok, /tidak dipakai di skenario A/);
  assert.match(blok, /digantikan jalur v2/);
  // Job v2 yang tidak dipakai tidak boleh dikatakan "digantikan jalur v2" oleh dirinya sendiri.
  assert.match(blok, /tidak dipakai di jalur v1/);
});
