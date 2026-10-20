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
  // Jumlahnya diturunkan dari workflow, bukan ditulis tetap: menambah job tidak boleh lolos
  // hanya karena angka di tes ikut disunting.
  assert.equal(pipeline.length, Object.keys(job).length, 'jumlah node graf');
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
  // analisis dan hasil adalah jalur v1; analisis-v2 dan terbit-v2 jalur v2; sisanya keduanya.
  const harap = {
    rencana: 'kedua', 'build-test': 'kedua', sonarcloud: 'kedua',
    analisis: 'v1', 'analisis-v2': 'v2', 'terbit-v2': 'v2', hasil: 'v1',
  };
  for (const n of pipeline) assert.equal(n.jalur, harap[n.id], `jalur ${n.id}`);
  // Isi workflow harus mendukung pembagian itu: job jalur v2 memang hanya jalan saat jalur v2.
  const blokAnalisisV2 = wf.slice(wf.indexOf('\n  analisis-v2:'), wf.indexOf('\n  terbit-v2:'));
  const blokTerbitV2 = wf.slice(wf.indexOf('\n  terbit-v2:'), wf.indexOf('\n  hasil:'));
  assert.match(blokAnalisisV2, /inputs\.jalur == 'v2'/);
  assert.match(blokTerbitV2, /inputs\.jalur == 'v2'/);
});

test('penerbitan hasil v2 ada tepat sekali, di job yang tidak bermatriks', () => {
  // Mode gabungan menjalankan analisis-v2 tiga kali. Kalau langkah terbit ada di job itu, hasil
  // terbit tiga kali dan yang terakhir menang tanpa aturan. Yang menahannya bukan sebuah kondisi,
  // melainkan tidak adanya langkah terbit di sana sama sekali.
  const blokAnalisisV2 = wf.slice(wf.indexOf('\n  analisis-v2:'), wf.indexOf('\n  terbit-v2:'));
  const blokTerbitV2 = wf.slice(wf.indexOf('\n  terbit-v2:'), wf.indexOf('\n  hasil:'));
  assert.ok(/strategy:/.test(blokAnalisisV2), 'analisis-v2 harus bermatriks vendor');
  assert.ok(!/matrix\./.test(blokTerbitV2), 'terbit-v2 tidak boleh bermatriks');
  assert.ok(!/merge-results\.js publish/.test(blokAnalisisV2), 'job bermatriks memuat langkah terbit');
  assert.ok(!/contents: write/.test(blokAnalisisV2), 'job bermatriks punya izin tulis');
  assert.equal([...blokTerbitV2.matchAll(/merge-results\.js publish/g)].length, 1,
    'terbit-v2 harus menerbitkan tepat sekali');
  // Tiap vendor menulis artifact sendiri, kalau tidak ketiganya saling menimpa.
  assert.match(blokAnalisisV2, /name: llm-v2-\$\{\{ matrix\.vendor \}\}-/);
});

// ---------- Rekaman run CI #54 untuk mode demo ----------
// Mode demo menggambar graf dari rekaman status job satu run yang benar-benar berjalan. Rekaman
// itu harus tetap sepadan dengan PIPELINE, dan tidak boleh memuat kredensial apa pun.
const rekaman = require('../dashboard/fixtures/v2/rekaman/run-54.json');

test('rekaman run CI hanya memuat job yang dikenal graf', () => {
  // Rekaman ini memotret run #54 yang benar-benar berjalan, jadi ia memotret pipeline pada saat itu
  // dan tidak ikut berubah ketika pipeline bertambah job. Menuntut kesamaan penuh berarti menuntut
  // rekaman masa lalu diubah, dan itu membuatnya berhenti menjadi rekaman. Yang harus selalu benar
  // adalah arah sebaliknya: setiap job di rekaman dikenal graf, kalau tidak statusnya tidak punya
  // node tempat ditampilkan dan hilang tanpa jejak di mode demo.
  const graf = new Set(bacaPipeline().map((n) => n.job));
  const asing = rekaman.jobs.map((j) => j.name).filter((n) => !graf.has(n));
  assert.deepEqual(asing, [], 'rekaman memuat job yang tidak ada di graf');
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
