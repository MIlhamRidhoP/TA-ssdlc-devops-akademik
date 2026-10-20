// Graf pipeline di dashboard digambar dari satu konfigurasi, PIPELINE di dashboard/app.js.
// Tes ini membandingkannya dengan .github/workflows/devsecops.yml: id job, nama job, dan
// ketergantungannya. Tanpa ini, graf bisa diam-diam menggambarkan pipeline yang tidak pernah
// berjalan, dan itu justru jenis kesalahan yang paling sulit dilihat di layar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');

// Satu entri PIPELINE = satu baris. Dibaca dengan pola, bukan dieksekusi: app.js adalah berkas
// browser, dan tes tidak perlu menjalankannya untuk memeriksa bentuk datanya.
const bacaPipeline = () => {
  const blok = app.slice(app.indexOf('const PIPELINE = ['), app.indexOf('\n  ];', app.indexOf('const PIPELINE = [')));
  const pola = /\{ key: '([^']+)', id: '([^']+)', job: '([^']+)', nama: '[^']*', hasil: [^,]+, perlu: \[([^\]]*)\], jalur: '([^']+)' \}/g;
  return [...blok.matchAll(pola)].map((m) => ({
    key: m[1],
    id: m[2],
    job: m[3],
    perlu: m[4].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean),
    jalur: m[5],
  }));
};

// Pembaca seadanya untuk bagian jobs: id job di indentasi 2 spasi, name dan needs di 4 spasi.
const bacaWorkflow = () => {
  const baris = wf.slice(wf.indexOf('\njobs:')).split('\n');
  const job = {};
  let kini = null;
  for (const b of baris) {
    const kepala = b.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (kepala) { kini = kepala[1]; job[kini] = { nama: null, needs: [] }; continue; }
    if (!kini) continue;
    const nama = b.match(/^ {4}name:\s*(.+?)\s*$/);
    if (nama) { job[kini].nama = nama[1].replace(/^['"]|['"]$/g, ''); continue; }
    const needs = b.match(/^ {4}needs:\s*(.+?)\s*$/);
    if (needs) {
      const isi = needs[1].trim();
      job[kini].needs = (isi.startsWith('[') ? isi.slice(1, -1).split(',') : [isi])
        .map((x) => x.trim()).filter(Boolean);
    }
  }
  return job;
};

const pipeline = bacaPipeline();
const job = bacaWorkflow();

test('PIPELINE terbaca dan mencakup seluruh job workflow', () => {
  assert.equal(pipeline.length, 6, 'jumlah node graf');
  const idGraf = pipeline.map((n) => n.id).sort();
  const idWf = Object.keys(job).sort();
  assert.deepEqual(idGraf, idWf, 'setiap job workflow punya node, dan sebaliknya');
});

test('nama job di graf sama dengan name di workflow', () => {
  // Dashboard mencocokkan status job dari GitHub API lewat nama ini; salah satu huruf saja
  // membuat seluruh node tampak "menunggu" selamanya.
  for (const n of pipeline) {
    assert.equal(n.job, job[n.id].nama, `nama job ${n.id}`);
  }
});

test('ketergantungan di graf sama dengan needs di workflow', () => {
  const idDari = Object.fromEntries(pipeline.map((n) => [n.key, n.id]));
  for (const n of pipeline) {
    const grafik = n.perlu.map((k) => {
      assert.ok(idDari[k], `node ${n.key} menyebut ${k} yang tidak ada di PIPELINE`);
      return idDari[k];
    }).sort();
    assert.deepEqual(grafik, [...job[n.id].needs].sort(), `needs job ${n.id}`);
  }
});

test('jalur tiap node sesuai jalur yang menjalankannya di workflow', () => {
  // analisis dan hasil adalah jalur v1; analisis-v2 jalur v2; sisanya dipakai keduanya.
  const harap = {
    rencana: 'kedua', 'build-test': 'kedua', sonarcloud: 'kedua',
    analisis: 'v1', 'analisis-v2': 'v2', hasil: 'v1',
  };
  for (const n of pipeline) assert.equal(n.jalur, harap[n.id], `jalur ${n.id}`);
  // Isi workflow harus mendukung pembagian itu: job jalur v2 memang hanya jalan saat jalur v2.
  const blokV2 = wf.slice(wf.indexOf('\n  analisis-v2:'), wf.indexOf('\n  hasil:'));
  assert.match(blokV2, /inputs\.jalur == 'v2'/);
});

// ---------- Rekaman run CI #54 untuk mode demo ----------
// Mode demo menggambar graf dari rekaman status job satu run yang benar-benar berjalan. Rekaman
// itu harus tetap sepadan dengan PIPELINE, dan tidak boleh memuat kredensial apa pun.
const rekaman = require('../dashboard/fixtures/v2/rekaman/run-54.json');

test('rekaman run CI memuat tepat job yang ada di graf', () => {
  const graf = bacaPipeline().map((n) => n.job).sort();
  const direkam = rekaman.jobs.map((j) => j.name).sort();
  assert.deepEqual(direkam, graf);
});

test('rekaman run CI menyebut run yang bisa ditelusuri', () => {
  assert.equal(rekaman.run.nomor, 54);
  assert.ok(Number.isSafeInteger(rekaman.run.id) && rekaman.run.id > 0, 'run.id harus bilangan bulat positif');
  assert.match(rekaman.run.commit, /^[0-9a-f]{40}$/);
  assert.equal(rekaman.run.repo, 'MIlhamRidhoP/TA-ssdlc-devops-akademik');
  assert.equal(rekaman.run.kesimpulan, 'success');
  for (const j of rekaman.jobs) {
    assert.ok(Number.isSafeInteger(j.id) && j.id > 0, `job ${j.name} tanpa id yang sah`);
    assert.ok(['success', 'skipped', 'failure', 'cancelled'].includes(j.conclusion), `kesimpulan job ${j.name}: ${j.conclusion}`);
  }
  // Job yang dilewati memang tidak punya langkah; yang berjalan harus punya.
  for (const j of rekaman.jobs) {
    if (j.conclusion === 'skipped') assert.equal(j.steps.length, 0);
    else assert.ok(j.steps.length > 0, `job ${j.name} berjalan tetapi tanpa langkah`);
  }
});

test('rekaman run CI tidak memuat token, URL, atau rahasia', () => {
  // Nama job dan nama langkah ditulis manusia di workflow, salah satunya menyebut kata "secret".
  // Yang dilarang adalah NILAI berbentuk kredensial atau URL, jadi nama dikecualikan.
  const nilai = [];
  const kumpul = (x, kunci) => {
    if (Array.isArray(x)) x.forEach((v) => kumpul(v));
    else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => kumpul(v, k));
    else if (typeof x === 'string' && kunci !== 'name') nilai.push(x);
  };
  kumpul({ run: rekaman.run, jobs: rekaman.jobs });
  for (const v of nilai) {
    if (/^[0-9a-f]{40}$/.test(v)) continue; // SHA commit
    assert.doesNotMatch(v, /(github_pat_|ghs_|ghp_|gho_|Bearer |https?:\/\/|X-Amz|[A-Za-z0-9_-]{40,})/, `nilai mencurigakan: ${v}`);
  }
});
