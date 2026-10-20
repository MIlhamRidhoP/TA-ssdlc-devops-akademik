// Urutan riwayat run di dashboard. Fungsi pengurutnya hidup di dalam IIFE dashboard/app.js, jadi
// diambil apa adanya dari berkas itu lalu dijalankan di sini — yang diuji benar-benar kode yang
// dimuat browser.
//
// Yang dijaga: "run terbaru" harus selalu menunjuk run yang sama, berapa kali pun daftarnya
// diurutkan dan apa pun urutan berkasnya.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'dashboard', 'app.js');
const sumber = fs.readFileSync(APP, 'utf8');

const ambilUrutEntri = () => {
  const i = sumber.indexOf('  const urutEntri = (a, b) => {');
  const j = sumber.indexOf('\n  };', i);
  assert.ok(i > 0 && j > i, 'urutEntri tidak ditemukan di dashboard/app.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${sumber.slice(i, j + 5)}\n  return urutEntri;`)();
};

const urutEntri = ambilUrutEntri();
const urut = (daftar) => daftar.slice().sort(urutEntri).map((e) => e.nomor);

test('terbaru menurut waktu selesai ada di atas', () => {
  const daftar = [
    { nomor: 46, selesai: '2026-10-19T23:48:22.777Z' },
    { nomor: 54, selesai: '2026-10-20T04:03:18.308Z' },
    { nomor: 52, selesai: '2026-10-20T03:49:44.399Z' },
    { nomor: 53, selesai: '2026-10-20T03:56:04.307Z' },
    { nomor: 49, selesai: '2026-10-20T00:55:58.949Z' },
  ];
  assert.deepEqual(urut(daftar), [54, 53, 52, 49, 46]);
});

test('waktu selesai sama diputus nomor run, bukan urutan berkas', () => {
  // Keadaan ini bukan teoretis: dua entri di fixture demo berbagi stempel waktu yang sama persis.
  const sama = '2026-10-20T04:03:18.308Z';
  const a = [{ nomor: 54, selesai: sama }, { nomor: 9001, selesai: sama }];
  const b = [{ nomor: 9001, selesai: sama }, { nomor: 54, selesai: sama }];
  assert.deepEqual(urut(a), [9001, 54]);
  assert.deepEqual(urut(b), [9001, 54], 'urutan berkas tidak boleh memengaruhi hasil');
});

test('run tanpa waktu selesai jatuh ke bawah, dan saling diurutkan nomornya', () => {
  const daftar = [
    { nomor: 7, selesai: null },
    { nomor: 54, selesai: '2026-10-20T04:03:18.308Z' },
    { nomor: 9, selesai: null },
    { nomor: 8 },
  ];
  assert.deepEqual(urut(daftar), [54, 9, 8, 7]);
});

test('urutan tidak bergantung pada urutan masukan', () => {
  const daftar = [
    { nomor: 1, selesai: '2026-10-19T13:08:21.636Z' },
    { nomor: 2, selesai: '2026-10-19T12:54:35.824Z' },
    { nomor: 3, selesai: '2026-10-19T12:59:12.908Z' },
  ];
  // Run CLI eksperimen: nomor memang tidak searah dengan waktu, dan waktulah yang benar.
  const harap = [1, 3, 2];
  assert.deepEqual(urut(daftar), harap);
  assert.deepEqual(urut(daftar.slice().reverse()), harap);
  assert.deepEqual(urut([daftar[1], daftar[2], daftar[0]]), harap);
});

test('nomor hanya pemutus seri, bukan kunci utama', () => {
  // Run bernomor lebih kecil yang selesai belakangan tetap di atas: waktu yang menentukan.
  const daftar = [
    { nomor: 60, selesai: '2026-10-20T01:00:00.000Z' },
    { nomor: 10, selesai: '2026-10-20T09:00:00.000Z' },
  ];
  assert.deepEqual(urut(daftar), [10, 60]);
});

test('seluruh pemakai memakai pengurutan yang sama', () => {
  // Pernah ada tiga salinan pengurutan: entriBranch, branchRunTerbaru, dan alertTerakhir. Kalau
  // ketiganya berbeda, "run terbaru" bisa berarti tiga run yang berlainan di satu halaman yang
  // sama: branch yang dibuka, run yang ditampilkan, dan jumlah alert yang dipakai perkiraan biaya.
  const pakai = [...sumber.matchAll(/\.sort\(urutEntri\)/g)].length;
  assert.equal(pakai, 3, 'urutEntri harus dipakai bertiga: entriBranch, branchRunTerbaru, alertTerakhir');
  // Salinan pengurutan yang tertinggal dalam bentuk apa pun, termasuk yang nama parameternya lain.
  const salinan = [...sumber.matchAll(/localeCompare\(String\(\w+\.selesai/g)].length;
  assert.equal(salinan, 0, 'masih ada salinan pengurutan lama di app.js');
});
