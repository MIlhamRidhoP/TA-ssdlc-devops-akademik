#!/usr/bin/env node
// Menjalankan tes yang TIDAK butuh server API maupun Postgres.
//
// Alasannya ada: perintah bash di AGENTS.md memakai `git ls-files | grep`, dan itu tidak jalan di
// PowerShell, yaitu shell yang dipakai sehari-hari di repo ini. Daftarnya tidak ditulis tangan di
// sini supaya berkas tes baru ikut terbawa tanpa ada yang perlu ingat memperbarui daftar; yang
// ditulis adalah pola nama berkas yang memanggil jaringan.
//
// Keluaran dan kode keluarnya diteruskan apa adanya dari `node --test`.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TES = path.join(ROOT, 'tests');

// Sama dengan pola di perintah bash AGENTS.md. Keduanya harus tetap sepadan; tes
// tests/skenario.test.js memeriksanya.
const BUTUH_SERVER = /api|cuti|khs|profil|list-query/;

const berkas = fs.readdirSync(TES)
  .filter((f) => f.endsWith('.test.js') && !BUTUH_SERVER.test(f))
  .sort()
  .map((f) => path.join('tests', f));

if (berkas.length === 0) {
  console.error('Tidak ada berkas tes yang cocok. Apakah folder tests/ kosong?');
  process.exit(1);
}

console.log(`Menjalankan ${berkas.length} berkas tes tanpa server:`);
for (const f of berkas) console.log(`  ${f}`);
console.log('');

const hasil = spawnSync(process.execPath, ['--test', ...berkas], { cwd: ROOT, stdio: 'inherit' });
process.exit(hasil.status === null ? 1 : hasil.status);
