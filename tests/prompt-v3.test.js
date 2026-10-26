// Prompt v3 adalah salinan v2 yang netral terhadap perkakas SAST. Tes ini menjaga tiga hal yang
// kalau lepas membuat angka eksperimen tidak bisa dipertanggungjawabkan:
//
//   1. v2 tetap bawaan, sehingga setiap pemanggil lama berperilaku persis seperti sebelumnya.
//   2. Perbedaan v3 terhadap v2 TEPAT tiga baris, bukan "kira-kira hanya kalimat itu".
//   3. Rakitan prompt mana yang identik byte per byte dan mana yang tidak. Ini yang menentukan
//      apakah batch dua perkakas wajib menjalankan ulang lengan kontrol.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const render = require('../scripts/llm/render');

const BERKAS_IDENTIK = ['alert-format.txt', 'detection.schema.json', 'source-header.txt',
  'system.txt', 'task-detection.txt', 'verification.schema.json'];
// Satu entri per baris yang berubah, berindeks 1 seperti yang dilihat manusia di editor.
const BARIS_BERUBAH = [
  { berkas: 'sonar-reference.txt', baris: 1, v2: 'SONARCLOUD REPORT', v3: 'STATIC ANALYSIS REPORT' },
  {
    berkas: 'sonar-reference.txt',
    baris: 3,
    v2: 'The following alerts were reported by SonarCloud for this code. They are provided for reference.',
    v3: 'The following alerts were reported by static analysis tools for this code. They are provided for reference.',
  },
  {
    berkas: 'task-verification.txt',
    baris: 3,
    v2: 'Below is one alert reported by SonarCloud for the source code above. Decide whether this alert, as reported, describes a real vulnerability in the current code.',
    v3: 'Below is one alert reported by a static analysis tool for the source code above. Decide whether this alert, as reported, describes a real vulnerability in the current code.',
  },
];

const hashBerkas = (versi, nama) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, 'prompts', versi, nama))).digest('hex');
const barisBerkas = (versi, nama) => fs
  .readFileSync(path.join(ROOT, 'prompts', versi, nama), 'utf8').split('\n');

const KODE = 'FILE: src/a.js\n1: const x = 1;\n';
const ALERT = 'Alert ID: SONAR-01\nRule: jssecurity:S3649\nType: VULNERABILITY\nLocation: src/a.js:1\nMessage: SQLi\nMapped CWE: CWE-89';
const LAPORAN = 'Alert ID: SONAR-01\nRule: jssecurity:S3649';

const rakit = (versi, opsi) => render.rakitPrompt({
  template: render.bacaTemplate(render.dirPrompt(versi)), kodeSumber: KODE, ...opsi,
});

// ---------- 1. v2 tetap bawaan ----------

test('v2 tetap versi bawaan, sehingga pemanggil lama tidak berubah perilaku', () => {
  assert.equal(render.VERSI_PROMPT, 'v2');
  assert.equal(render.PROMPT_DIR, path.join(ROOT, 'prompts', 'v2'));
  assert.equal(render.dirPrompt(), path.join(ROOT, 'prompts', 'v2'));
  // cekHashPrompt tanpa argumen harus tetap memeriksa v2, bukan versi terbaru.
  assert.equal(render.cekHashPrompt(), 8);
});

test('dirPrompt menerima v3 dan menolak versi yang tidak ada', () => {
  assert.equal(render.dirPrompt('v3'), path.join(ROOT, 'prompts', 'v3'));
  assert.deepEqual(render.VERSI_PROMPT_DIDUKUNG, ['v2', 'v3']);
  // Termasuk bentuk yang mudah lolos kalau folder cuma disusun dari string: beda huruf besar,
  // string kosong, dan percobaan keluar dari folder prompts/.
  for (const v of ['v1', 'v4', '', 'V3', '../v2']) {
    assert.throws(() => render.dirPrompt(v), /Versi prompt tidak dikenal/, `versi ${JSON.stringify(v)} harus ditolak`);
  }
});

test('hash kedelapan berkas v3 cocok dengan HASHES.txt-nya sendiri', () => {
  assert.equal(render.cekHashPrompt(render.dirPrompt('v3')), 8);
});

// ---------- 2. Perbedaan v3 terhadap v2 tepat tiga baris ----------

test('enam berkas v3 byte-identik dengan v2', () => {
  for (const nama of BERKAS_IDENTIK) {
    assert.equal(hashBerkas('v3', nama), hashBerkas('v2', nama), `${nama} harus identik`);
  }
});

test('dua berkas v3 berbeda dari v2, dan perbedaannya tepat pada baris yang didaftarkan', () => {
  const diubah = [...new Set(BARIS_BERUBAH.map((x) => x.berkas))];
  assert.deepEqual(diubah, ['sonar-reference.txt', 'task-verification.txt']);

  for (const nama of diubah) {
    assert.notEqual(hashBerkas('v3', nama), hashBerkas('v2', nama), `${nama} harus berbeda`);
    const a = barisBerkas('v2', nama);
    const b = barisBerkas('v3', nama);
    assert.equal(a.length, b.length, `${nama}: jumlah baris harus sama`);

    const harusBeda = new Set(BARIS_BERUBAH.filter((x) => x.berkas === nama).map((x) => x.baris));
    const bedaNyata = [];
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) bedaNyata.push(i + 1);
    assert.deepEqual(bedaNyata, [...harusBeda].sort((x, y) => x - y), `${nama}: baris yang berbeda`);
  }

  for (const x of BARIS_BERUBAH) {
    assert.equal(barisBerkas('v2', x.berkas)[x.baris - 1], x.v2, `${x.berkas}:${x.baris} v2`);
    assert.equal(barisBerkas('v3', x.berkas)[x.baris - 1], x.v3, `${x.berkas}:${x.baris} v3`);
  }
});

test('tidak ada lagi kata SonarCloud di berkas prompt v3', () => {
  for (const nama of fs.readdirSync(render.dirPrompt('v3'))) {
    if (nama === 'README.md') continue; // README justru HARUS menerangkan asalnya dari v2
    const isi = fs.readFileSync(path.join(render.dirPrompt('v3'), nama), 'utf8');
    assert.ok(!/SonarCloud/i.test(isi), `${nama} masih menyebut SonarCloud`);
  }
});

test('HASHES.txt v3 memakai format v2: dua spasi, tanpa penanda biner', () => {
  // Bug nyata saat menyusun v3: `sha256sum` di Git Bash menulis "hash *nama" dalam mode biner.
  // Pembaca daftar di tests/kunci-prompt.test.js memecah dengan /\s+/, sehingga tanda bintang itu
  // terbaca sebagai bagian nama berkas dan gerbangnya gagal dengan pesan yang membingungkan.
  for (const versi of ['v2', 'v3']) {
    const teks = fs.readFileSync(path.join(render.dirPrompt(versi), 'HASHES.txt'), 'utf8');
    assert.ok(teks.endsWith('\n'), `${versi}: HASHES.txt harus berakhir LF`);
    for (const baris of teks.trim().split('\n')) {
      assert.match(baris, /^[0-9a-f]{64} {2}[^\s*][^\s]*$/, `${versi}: format baris "${baris}"`);
    }
  }
});

// ---------- 3. Rakitan prompt: mana yang identik byte per byte ----------

test('deteksi kondisi utama: rakitan v2 dan v3 IDENTIK byte per byte', () => {
  // sonar-reference.txt hanya disisipkan untuk kondisi sonar_di_deteksi (render.js:134-137), jadi
  // kondisi utama tidak pernah memuatnya dan satu-satunya berkas yang berubah tidak ikut terpakai.
  // Inilah dasar klaim bahwa angka skenario C tetap sebanding antara v2 dan v3.
  for (const kondisi of ['utama', 'komentar_menyesatkan']) {
    const a = rakit('v2', { kondisi, tugas: 'deteksi' });
    const b = rakit('v3', { kondisi, tugas: 'deteksi' });
    assert.equal(b.system, a.system, `${kondisi}: system`);
    assert.equal(b.user, a.user, `${kondisi}: user`);
    assert.deepEqual(b.blok_user, a.blok_user, `${kondisi}: blok_user`);
    assert.equal(b.hash.prompt_system_kanonik, a.hash.prompt_system_kanonik, `${kondisi}: hash system`);
    assert.equal(b.hash.prompt_user_kanonik, a.hash.prompt_user_kanonik, `${kondisi}: hash user`);
  }
});

test('verifikasi kondisi utama: rakitan v3 berbeda dari v2 TEPAT satu baris', () => {
  const a = rakit('v2', { kondisi: 'utama', tugas: 'verifikasi', alertTeks: ALERT });
  const b = rakit('v3', { kondisi: 'utama', tugas: 'verifikasi', alertTeks: ALERT });
  assert.equal(b.system, a.system, 'system tidak boleh berubah');
  assert.notEqual(b.hash.prompt_user_kanonik, a.hash.prompt_user_kanonik);

  const ba = a.user.split('\n');
  const bb = b.user.split('\n');
  assert.equal(ba.length, bb.length);
  const beda = [];
  for (let i = 0; i < ba.length; i += 1) if (ba[i] !== bb[i]) beda.push(i);
  assert.equal(beda.length, 1, 'harus tepat satu baris berbeda');
  assert.match(ba[beda[0]], /reported by SonarCloud/);
  assert.match(bb[beda[0]], /reported by a static analysis tool/);
  // Blok 1 adalah titik cache dan berisi kode sumber; ia tidak boleh ikut bergeser.
  assert.equal(b.blok_user[0], a.blok_user[0], 'blok 1 (titik cache) harus identik');
});

test('deteksi kondisi sonar_di_deteksi: rakitan v3 berbeda dari v2 TEPAT dua baris', () => {
  const a = rakit('v2', { kondisi: 'sonar_di_deteksi', tugas: 'deteksi', sonarTeks: LAPORAN });
  const b = rakit('v3', { kondisi: 'sonar_di_deteksi', tugas: 'deteksi', sonarTeks: LAPORAN });
  const ba = a.user.split('\n');
  const bb = b.user.split('\n');
  assert.equal(ba.length, bb.length);
  const beda = [];
  for (let i = 0; i < ba.length; i += 1) if (ba[i] !== bb[i]) beda.push(i);
  assert.equal(beda.length, 2, 'harus tepat dua baris berbeda');
  assert.equal(ba[beda[0]], 'SONARCLOUD REPORT');
  assert.equal(bb[beda[0]], 'STATIC ANALYSIS REPORT');
  assert.match(ba[beda[1]], /reported by SonarCloud/);
  assert.match(bb[beda[1]], /reported by static analysis tools/);
  // Hash laporan Sonar diturunkan dari teks laporan, bukan dari templatenya, jadi harus tetap sama.
  assert.equal(b.hash.laporan_sonar, a.hash.laporan_sonar);
});

test('rakitan prompt deterministik: dua panggilan menghasilkan hash yang sama', () => {
  for (const versi of ['v2', 'v3']) {
    const satu = rakit(versi, { kondisi: 'utama', tugas: 'verifikasi', alertTeks: ALERT });
    const dua = rakit(versi, { kondisi: 'utama', tugas: 'verifikasi', alertTeks: ALERT });
    assert.equal(dua.hash.prompt_user_kanonik, satu.hash.prompt_user_kanonik, `${versi}: user`);
    assert.equal(dua.hash.prompt_system_kanonik, satu.hash.prompt_system_kanonik, `${versi}: system`);
  }
});
