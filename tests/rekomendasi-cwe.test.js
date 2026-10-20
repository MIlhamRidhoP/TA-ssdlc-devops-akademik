// Pemetaan CWE untuk lapis 1 rekomendasi perbaikan: panduan umum yang statis dan bersumber resmi.
// Tes ini menjaga tiga hal yang kalau lepas membuat panduannya tidak bisa dipercaya: strukturnya
// tetap, sumbernya hanya dari domain yang diizinkan, dan setiap CWE yang benar-benar muncul di
// data punya entri.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const peta = require('../dashboard/rekomendasi-cwe.json');

const DOMAIN_DIIZINKAN = ['cwe.mitre.org', 'cheatsheetseries.owasp.org'];

// CWE yang muncul di data yang benar-benar dipakai dashboard. Dibaca dari berkasnya, bukan
// ditulis tangan, supaya fixture baru yang membawa CWE baru langsung menggagalkan tes ini.
const cweDariFixture = () => {
  const dir = path.join(ROOT, 'dashboard', 'fixtures');
  const keluar = new Set();
  const telusur = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) telusur(p);
      else if (e.name.endsWith('.json')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/CWE-(\d+)\b/g)) keluar.add(`CWE-${m[1]}`);
      }
    }
  };
  telusur(dir);
  return [...keluar];
};

// CWE dari data eksperimen dan dari run yang sudah terbit. Dicatat di sini karena keduanya tidak
// ada di pohon kerja: eksperimen ada di branch lain, run terbit ada di branch security-results.
// Daftar ini berasal dari inventaris R0 dan ikut diperiksa supaya panduan tidak pernah kosong
// untuk CWE yang sudah pernah benar-benar dilaporkan.
const CWE_DARI_INVENTARIS = [
  'CWE-20', 'CWE-79', 'CWE-89', 'CWE-285', 'CWE-307', 'CWE-346', 'CWE-359', 'CWE-362',
  'CWE-367', 'CWE-400', 'CWE-639', 'CWE-770', 'CWE-799', 'CWE-862', 'CWE-863', 'CWE-915',
  'CWE-942', 'CWE-1333',
];

test('berkas pemetaan punya versi dan tanggal penyusunan', () => {
  assert.ok(Number.isInteger(peta.versi) && peta.versi >= 1, 'versi harus bilangan bulat >= 1');
  assert.match(peta.tanggal_disusun, /^\d{4}-\d{2}-\d{2}$/, 'tanggal_disusun harus YYYY-MM-DD');
  assert.ok(!Number.isNaN(Date.parse(peta.tanggal_disusun)), 'tanggal_disusun harus tanggal yang sah');
  assert.deepEqual(peta.sumber_diizinkan, DOMAIN_DIIZINKAN);
  assert.equal(typeof peta.catatan, 'string');
  assert.ok(peta.catatan.length > 40, 'catatan harus menerangkan sifat panduan ini');
});

test('setiap entri CWE berbentuk benar', () => {
  const entri = Object.entries(peta.cwe);
  assert.ok(entri.length >= 18, `hanya ${entri.length} entri CWE`);
  for (const [kunci, e] of entri) {
    assert.match(kunci, /^CWE-\d+$/, `kunci tidak berbentuk CWE-<angka>: ${kunci}`);
    assert.equal(e.id, kunci, `id di dalam entri ${kunci} tidak sama dengan kuncinya`);
    assert.equal(typeof e.judul, 'string', `${kunci} tanpa judul`);
    assert.ok(e.judul.length >= 5 && e.judul.length <= 90, `${kunci}: judul harus singkat, dapat ${e.judul.length} karakter`);

    assert.ok(Array.isArray(e.langkah), `${kunci}: langkah harus array`);
    assert.ok(e.langkah.length >= 2 && e.langkah.length <= 4, `${kunci}: langkah harus 2 sampai 4, dapat ${e.langkah.length}`);
    for (const l of e.langkah) {
      assert.equal(typeof l, 'string', `${kunci}: langkah bukan string`);
      assert.ok(l.length >= 20, `${kunci}: langkah terlalu pendek untuk bisa dikerjakan: "${l}"`);
      assert.ok(/[.!]$/.test(l.trim()), `${kunci}: langkah harus kalimat utuh berakhiran titik: "${l}"`);
    }
    assert.equal(new Set(e.langkah).size, e.langkah.length, `${kunci}: ada langkah yang terduplikasi`);

    assert.ok(Array.isArray(e.sumber) && e.sumber.length >= 1, `${kunci}: tanpa sumber`);
    // Tiga keadaan, masing-masing dengan keterangan wajibnya sendiri:
    //   perlu_dicek tidak ada   -> entri biasa, sumbernya langsung dari MITRE
    //   perlu_dicek true        -> belum ditinjau manusia, wajib menyebut alasannya
    //   perlu_dicek false       -> sudah ditinjau manusia, wajib menyebut hasil verifikasinya
    // Tanda tanpa keterangan tidak menolong siapa pun, ke arah mana pun.
    if ('perlu_dicek' in e) {
      assert.equal(typeof e.perlu_dicek, 'boolean', `${kunci}: perlu_dicek harus boolean atau tidak ada`);
      if (e.perlu_dicek) {
        assert.equal(typeof e.alasan_perlu_dicek, 'string', `${kunci}: perlu_dicek true tanpa alasan`);
        assert.ok(e.alasan_perlu_dicek.length > 40, `${kunci}: alasan perlu_dicek terlalu pendek`);
        assert.ok(!('catatan_verifikasi' in e), `${kunci}: perlu_dicek true tidak boleh membawa catatan_verifikasi`);
      } else {
        assert.equal(typeof e.catatan_verifikasi, 'string', `${kunci}: perlu_dicek false tanpa catatan_verifikasi`);
        assert.ok(e.catatan_verifikasi.length > 40, `${kunci}: catatan_verifikasi terlalu pendek`);
        assert.match(e.catatan_verifikasi, /Diverifikasi manual \d{4}-\d{2}-\d{2}/, `${kunci}: catatan_verifikasi tidak menyebut tanggal verifikasinya`);
        assert.ok(!('alasan_perlu_dicek' in e), `${kunci}: perlu_dicek false masih membawa alasan_perlu_dicek`);
      }
    } else {
      assert.ok(!('alasan_perlu_dicek' in e), `${kunci}: ada alasan_perlu_dicek tanpa perlu_dicek`);
      assert.ok(!('catatan_verifikasi' in e), `${kunci}: ada catatan_verifikasi tanpa perlu_dicek`);
    }
  }
});

test('seluruh sumber berasal dari domain yang diizinkan dan memakai https', () => {
  for (const [kunci, e] of Object.entries(peta.cwe)) {
    for (const u of e.sumber) {
      const url = new URL(u);
      assert.equal(url.protocol, 'https:', `${kunci}: sumber bukan https: ${u}`);
      assert.ok(DOMAIN_DIIZINKAN.includes(url.hostname), `${kunci}: domain sumber tidak diizinkan: ${url.hostname}`);
      // Tautan CWE harus menunjuk definisi CWE itu sendiri, bukan halaman lain yang kebetulan
      // ada di domain yang sama.
      if (url.hostname === 'cwe.mitre.org') {
        const n = kunci.split('-')[1];
        assert.equal(url.pathname, `/data/definitions/${n}.html`, `${kunci}: tautan MITRE menunjuk halaman lain: ${u}`);
      }
    }
  }
});

test('entri yang sumbernya bukan MITRE selalu menerangkan sebabnya', () => {
  // Halaman MITRE tanpa Potential Mitigations adalah satu-satunya alasan memakai OWASP. Entri
  // seperti itu harus menyatakan keadaan itu, entah sebagai alasan yang belum ditinjau atau
  // sebagai hasil verifikasi manual.
  for (const [kunci, e] of Object.entries(peta.cwe)) {
    const adaMitre = e.sumber.some((u) => new URL(u).hostname === 'cwe.mitre.org');
    if (adaMitre) continue;
    const keterangan = e.alasan_perlu_dicek ?? e.catatan_verifikasi;
    assert.equal(typeof keterangan, 'string', `${kunci}: memakai sumber non-MITRE tanpa keterangan`);
    assert.match(keterangan, /Potential Mitigations/, `${kunci}: keterangan tidak menyebut sebab tidak memakai MITRE`);
  }
});

test('setiap CWE di fixture dashboard punya entri panduan', () => {
  const kurang = cweDariFixture().filter((c) => !peta.cwe[c]);
  assert.deepEqual(kurang, [], `CWE di fixture tanpa panduan: ${kurang.join(', ')}`);
});

test('setiap CWE dari inventaris R0 punya entri panduan', () => {
  const kurang = CWE_DARI_INVENTARIS.filter((c) => !peta.cwe[c]);
  assert.deepEqual(kurang, [], `CWE dari inventaris tanpa panduan: ${kurang.join(', ')}`);
});

test('panduan tidak memuat cara mengeksploitasi', () => {
  // Panduan ini bersifat pola perbaikan. Muatan yang mengajari cara menyerang tidak boleh masuk,
  // termasuk payload contoh yang bisa disalin apa adanya.
  const dilarang = [
    /\bUNION\s+SELECT\b/i,
    /<script\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bOR\s+1\s*=\s*1\b/i,
    /\bjavascript:/i,
    /\balert\s*\(/i,
    /\.\.\//,
  ];
  for (const [kunci, e] of Object.entries(peta.cwe)) {
    const teks = [e.judul, ...e.langkah].join(' ');
    for (const pola of dilarang) {
      assert.ok(!pola.test(teks), `${kunci}: panduan memuat pola yang menyerupai eksploitasi (${pola})`);
    }
  }
});

test('berkas pemetaan dimuat dashboard dari origin sendiri, bukan dari jaringan', () => {
  // Panduan harus menjadi data lokal. Kalau suatu saat ia diambil lewat fetch ke luar, CSP akan
  // memblokirnya dan bagian rekomendasi diam-diam kosong.
  const app = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');
  for (const baris of app.split('\n')) {
    if (!baris.includes('rekomendasi-cwe.json')) continue;
    assert.ok(!/https?:\/\//.test(baris), `rekomendasi-cwe.json dimuat dari URL luar: ${baris.trim()}`);
  }
});
