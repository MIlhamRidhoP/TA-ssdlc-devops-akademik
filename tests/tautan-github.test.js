// Pembangun URL GitHub di dashboard. Fungsinya hidup di dalam IIFE dashboard/app.js, jadi
// bloknya diambil apa adanya dari berkas itu lewat penanda komentar, lalu dijalankan di sini.
// Cara ini dipilih supaya yang diuji benar-benar kode yang dimuat browser, bukan salinannya.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'dashboard', 'app.js');
const sumber = fs.readFileSync(APP, 'utf8');

const AWAL = '// ---- awal blok tautan GitHub';
const AKHIR = '// ---- akhir blok tautan GitHub ----';

const ambilBlok = () => {
  const i = sumber.indexOf(AWAL);
  const j = sumber.indexOf(AKHIR);
  assert.ok(i > 0 && j > i, 'penanda blok tautan GitHub tidak ditemukan di dashboard/app.js');
  return sumber.slice(i, j);
};

const blok = ambilBlok();
// enc dan urlGithub adalah milik app.js juga; keduanya disalin dari berkas yang sama supaya tes
// tidak diam-diam menguji versi lain.
const barisUrlGithub = sumber.split('\n').find((b) => b.includes('const urlGithub = (owner, repo'));
assert.ok(barisUrlGithub, 'definisi urlGithub tidak ditemukan');

// eslint-disable-next-line no-new-func
const api = new Function(`
  const enc = encodeURIComponent;
  ${barisUrlGithub.trim()}
  ${blok}
  return { idGh, shaGh, urlRepoGh, urlRunGh, urlJobGh, urlCommitGh, urlBerkasGh };
`)();

const PROYEK = { owner: 'MIlhamRidhoP', repo: 'TA-ssdlc-devops-akademik' };
const DEMO_PALSU = { owner: 'contoh', repo: 'aplikasi-lain', demo_tanpa_workflow: true };
const SHA = '8b86320541d7efd95de841ee402b24a8fb358f1d';
const DASAR = 'https://github.com/MIlhamRidhoP/TA-ssdlc-devops-akademik';

test('URL run, job, commit, dan berkas dibangun benar', () => {
  assert.equal(api.urlRepoGh(PROYEK), DASAR);
  assert.equal(api.urlRunGh(PROYEK, 39367185645), `${DASAR}/actions/runs/39367185645`);
  assert.equal(api.urlJobGh(PROYEK, 39367185645, 118446652163), `${DASAR}/actions/runs/39367185645/job/118446652163`);
  assert.equal(api.urlCommitGh(PROYEK, SHA), `${DASAR}/commit/${SHA}`);
  assert.equal(api.urlBerkasGh(PROYEK, SHA, 'src/controllers/krsController.js', 110),
    `${DASAR}/blob/${SHA}/src/controllers/krsController.js#L110`);
});

test('berkas tanpa nomor baris tetap menghasilkan tautan, tanpa fragmen', () => {
  assert.equal(api.urlBerkasGh(PROYEK, SHA, 'src/app.js', null), `${DASAR}/blob/${SHA}/src/app.js`);
  assert.equal(api.urlBerkasGh(PROYEK, SHA, 'src/app.js', 0), `${DASAR}/blob/${SHA}/src/app.js`);
});

test('run tanpa id tidak menghasilkan tautan', () => {
  // Run dari CLI tidak punya run.id sama sekali: yang benar adalah tidak ada tautan, bukan tautan
  // ke halaman Actions umum.
  for (const nilai of [null, undefined, 0, -1, '', 'abc', '12a', 1.5, NaN, {}]) {
    assert.equal(api.urlRunGh(PROYEK, nilai), null, `run id ${JSON.stringify(nilai)} seharusnya ditolak`);
    assert.equal(api.urlJobGh(PROYEK, nilai, 118446652163), null);
  }
});

test('id job tidak valid tidak menghasilkan tautan job', () => {
  for (const nilai of [null, undefined, 0, 'x', '0', -5]) {
    assert.equal(api.urlJobGh(PROYEK, 39367185645, nilai), null, `job id ${JSON.stringify(nilai)} seharusnya ditolak`);
  }
});

test('SHA harus 40 heksadesimal', () => {
  assert.equal(api.urlCommitGh(PROYEK, '8b86320'), null);
  assert.equal(api.urlCommitGh(PROYEK, `${SHA}0`), null);
  assert.equal(api.urlCommitGh(PROYEK, SHA.replace('8', 'z')), null);
  assert.equal(api.urlCommitGh(PROYEK, null), null);
  // Huruf besar diterima dan dinormalkan, karena GitHub menerimanya juga.
  assert.equal(api.urlCommitGh(PROYEK, SHA.toUpperCase()), `${DASAR}/commit/${SHA}`);
  assert.equal(api.urlBerkasGh(PROYEK, '8b86320', 'src/app.js', 1), null);
});

test('project demo yang dibuat-buat tidak pernah ditautkan', () => {
  assert.equal(api.urlRepoGh(DEMO_PALSU), null);
  assert.equal(api.urlRunGh(DEMO_PALSU, 39367185645), null);
  assert.equal(api.urlJobGh(DEMO_PALSU, 39367185645, 118446652163), null);
  assert.equal(api.urlCommitGh(DEMO_PALSU, SHA), null);
  assert.equal(api.urlBerkasGh(DEMO_PALSU, SHA, 'src/app.js', 1), null);
});

test('owner dan repo di luar bentuk nama GitHub ditolak', () => {
  for (const p of [{ owner: 'a/b', repo: 'x' }, { owner: 'a', repo: '../x' }, { owner: '', repo: 'x' }, { owner: 'a', repo: null }]) {
    assert.equal(api.urlRepoGh(p), null, `${JSON.stringify(p)} seharusnya ditolak`);
  }
});

test('path berkas yang mencurigakan tidak menghasilkan tautan', () => {
  assert.equal(api.urlBerkasGh(PROYEK, SHA, '../../etc/passwd', 1), null);
  assert.equal(api.urlBerkasGh(PROYEK, SHA, '/etc/passwd', 1), null);
  assert.equal(api.urlBerkasGh(PROYEK, SHA, '', 1), null);
  assert.equal(api.urlBerkasGh(PROYEK, SHA, null, 1), null);
});

test('setiap tautan keluar di app.js membawa rel noopener noreferrer', () => {
  // Pola el('a', { ... }) yang memuat target: '_blank' harus selalu disertai rel yang benar.
  const potongan = sumber.split("target: '_blank'");
  for (let i = 1; i < potongan.length; i += 1) {
    const sekitar = potongan[i].slice(0, 80);
    assert.match(sekitar, /rel: 'noopener noreferrer'/, `target _blank ke-${i} tanpa rel yang benar: ${sekitar}`);
  }
  assert.ok(potongan.length > 5, 'tautan keluar tidak ditemukan, pola pencarian mungkin usang');
});

test('github.com tidak pernah muncul sebagai sasaran fetch', () => {
  // Tautan hanyalah href. Permintaan jaringan dashboard tetap terbatas pada api.github.com.
  for (const baris of sumber.split('\n')) {
    if (!baris.includes('github.com')) continue;
    assert.ok(!/\b(fetch|gh)\s*\(/.test(baris) || baris.includes('api.github.com'),
      `baris menautkan github.com ke dalam panggilan jaringan: ${baris.trim()}`);
  }
});
