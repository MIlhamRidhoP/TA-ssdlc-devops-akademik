// Pemakaian vendor di dalam job bermatriks pada .github/workflows/devsecops.yml.
//
// Cacat yang dijaga di sini pernah menjatuhkan seluruh run mode gabungan (run #6 repo demo).
// Langkah "Pastikan secret vendor tersedia" memakai `inputs.vendor_v2`, padahal di mode gabungan
// input itu bernilai "gabungan", yang bukan nama vendor mana pun. Pencarian di models.json
// menghasilkan undefined, `m.secret` melempar TypeError, ketiga sel matriks gagal, lalu job terbit
// ikut gagal karena tidak ada satu pun hasil vendor di artifact.
//
// Aturannya: di job yang punya `strategy.matrix`, vendor yang dipakai satu sel HARUS datang dari
// `matrix.vendor`. `inputs.vendor_v2` adalah pilihan pengguna untuk SELURUH run, bukan vendor sel
// ini, dan nilainya bisa "gabungan" yang tidak pernah cocok dengan satu vendor pun.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
const models = require('../dashboard/models.json').models;

// Memotong teks satu job: dari barisnya sendiri sampai job berikutnya di indentasi dua spasi.
const blokJob = (id) => {
  const i = wf.indexOf(`\n  ${id}:`);
  assert.ok(i > 0, `job ${id} tidak ada di devsecops.yml`);
  const sisa = wf.slice(i + 1);
  const j = sisa.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return j > 0 ? sisa.slice(0, j) : sisa;
};

// Job yang memakai matriks, dibaca dari workflow, bukan ditulis tetap.
const jobBermatriks = () => {
  const hasil = [];
  for (const m of wf.matchAll(/\n {2}([a-z][a-z0-9-]*):\n/g)) {
    const id = m[1];
    if (/strategy:\s*\n\s+fail-fast|strategy:\s*\n\s+matrix|\n {4}strategy:/.test(blokJob(id))) hasil.push(id);
  }
  return hasil;
};

test('job bermatriks terbaca, dan analisis-v2 salah satunya', () => {
  // Kalau pembacanya rusak, seluruh tes di bawah lolos tanpa menguji apa pun.
  const daftar = jobBermatriks();
  assert.ok(daftar.includes('analisis-v2'), `job bermatriks terbaca: ${daftar.join(', ') || '(kosong)'}`);
  assert.match(blokJob('analisis-v2'), /matrix:\s*\n\s+vendor:/, 'analisis-v2 harus bermatriks vendor');
});

test('job bermatriks tidak pernah memakai inputs.vendor_v2 sebagai VENDOR', () => {
  // Inti cacatnya. Dicari sebagai pasangan env VENDOR, bukan sekadar kemunculan vendor_v2, supaya
  // pesannya langsung menunjuk langkah yang salah.
  for (const id of jobBermatriks()) {
    const blok = blokJob(id);
    const salah = [...blok.matchAll(/^\s+VENDOR[A-Z_]*:\s*\$\{\{\s*inputs\.vendor_v2\s*\}\}/gm)];
    assert.deepEqual(salah.map((m) => m[0].trim()), [],
      `job ${id} bermatriks tetapi memakai inputs.vendor_v2 sebagai VENDOR; seharusnya matrix.vendor`);
  }
});

test('setiap langkah yang memakai VENDOR di analisis-v2 mengambilnya dari matriks', () => {
  const blok = blokJob('analisis-v2');
  const dipakai = [...blok.matchAll(/^\s+VENDOR:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(dipakai.length >= 3, `langkah ber-env VENDOR di analisis-v2: ${dipakai.length}`);
  for (const nilai of dipakai) {
    assert.match(nilai, /\$\{\{\s*matrix\.vendor\s*\}\}/, `VENDOR harus dari matrix.vendor, bukan ${nilai}`);
  }
});

test('langkah pemeriksa secret menolak vendor tak dikenal, bukan melempar TypeError', () => {
  // Pengaman ini yang membuat salah konfigurasi serupa muncul sebagai pesan yang bisa dibaca,
  // bukan sebagai "Cannot read properties of undefined (reading 'secret')".
  const blok = blokJob('analisis-v2');
  const i = blok.indexOf('- name: Pastikan secret vendor tersedia');
  assert.ok(i > 0, 'langkah pemeriksa secret tidak ada');
  const langkah = blok.slice(i, blok.indexOf('- name:', i + 10));
  assert.match(langkah, /if \(!m\)/, 'tidak ada penjagaan saat vendor tidak ditemukan');
  assert.match(langkah, /process\.exit\(1\)/);
  // Dan ia harus memeriksa keberadaan secret SETELAH memastikan vendornya ada.
  assert.ok(langkah.indexOf('if (!m)') < langkah.indexOf('m.secret'),
    'penjagaan vendor harus mendahului pembacaan m.secret');
});

test('vendor matriks berasal dari daftar yang sama dengan models.json', () => {
  // Daftar vendor di job rencana dan daftar model jalur v2 harus sepakat; kalau tidak, matriks bisa
  // menjalankan vendor yang tidak punya entri model sama sekali.
  const vendorModel = [...new Set(models.filter((m) => m.jalur === 'v2').map((m) => m.vendor))].sort();
  const dariRencana = wf.match(/vendors='(\[[^']+\])'/);
  assert.ok(dariRencana, 'daftar vendor gabungan tidak ditemukan di job rencana');
  assert.deepEqual(JSON.parse(dariRencana[1]).sort(), vendorModel,
    'daftar vendor mode gabungan harus sama dengan vendor jalur v2 di models.json');
});

test('vendor rekomendasi di job terbit tidak pernah membaca "gabungan" sebagai nama vendor', () => {
  // terbit-v2 BUKAN job matriks, jadi inputs.vendor_v2 memang tepat di sana. Yang harus dijaga:
  // saat mode gabungan, vendor penyusun rekomendasi diambil dari vendor_rekomendasi, karena
  // "gabungan" bukan vendor yang bisa dipanggil.
  const blok = blokJob('terbit-v2');
  assert.ok(!/strategy:/.test(blok), 'terbit-v2 tidak boleh bermatriks');
  const i = blok.indexOf('- name: Rekomendasi perbaikan AI');
  assert.ok(i > 0, 'langkah rekomendasi tidak ada');
  const langkah = blok.slice(i, blok.indexOf('- name:', i + 10) > 0 ? blok.indexOf('- name:', i + 10) : undefined);
  assert.match(langkah, /VENDOR_REKOM:\s*\$\{\{\s*inputs\.vendor_rekomendasi\s*\}\}/);
  assert.match(langkah, /if \[ "\$GABUNGAN" = "true" \]; then vendor="\$VENDOR_REKOM"; else vendor="\$VENDOR_RUN"; fi/,
    'mode gabungan harus memakai vendor_rekomendasi, bukan vendor_v2');
});
