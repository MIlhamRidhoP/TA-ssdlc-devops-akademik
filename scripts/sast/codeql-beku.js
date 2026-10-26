#!/usr/bin/env node
// Laporan CodeQL beku, sejajar scripts/llm/sonar-beku.js.
//
// Alasannya sama: setiap run eksperimen harus membaca alert dari satu berkas JSON yang isinya tidak
// bisa bergeser, bukan dari hasil analisis yang bisa dijalankan ulang dengan versi query berbeda.
// Isi berkas memuat alert yang sudah diurai beserta buktinya, sehingga pembacaan ulang TIDAK
// memerlukan berkas SARIF aslinya.
//
// Tiga perbedaan sengaja terhadap sonar-beku.js, dan ketiganya dijaga tes:
//
//   1. `dibuat` WAJIB diberikan, tidak ada bawaan waktu sekarang. sonar-beku memakai
//      new Date().toISOString(), yang membuat dua pembangunan atas data yang sama menghasilkan
//      sha256_isi berbeda. Di sini determinisme itu syarat, bukan kenyamanan.
//   2. Rujukan berkas SARIF ditulis sebagai NAMA BERKAS saja. Path absolut milik laptop tidak boleh
//      masuk berkas yang di-commit (AGENTS.md batas keras nomor 10), dan aturan itu ditegakkan di
//      sini, bukan diserahkan pada kedisiplinan pemanggil.
//   3. Verifikasi ulang memakai alert yang tersimpan, bukan menurunkannya kembali dari data mentah,
//      karena data mentah CodeQL adalah SARIF yang hidup di luar repo.
//
// Tidak memanggil API apa pun.
//
// Pemakaian:
//   node scripts/sast/codeql-beku.js --alert=<alert-codeql.json> --metadata=<metadata.json> \
//     --objek=<worktree objek uji> --out=<file>
const fs = require('fs');
const path = require('path');
const render = require('../llm/render');

const VERSI_FORMAT = 1;
const FILTER_ALERT = 'tingkat 1 (tag security) di dalam src/**, digabung per ruleId+file+baris, '
  + 'tanpa entri js/diagnostics/* dan js/summary/* (lihat scripts/sast/codeql-tahap1.js)';

const hashIsi = (isi) => render.sha256(JSON.stringify(isi));

// Nama berkas saja: tanpa pemisah path, tanpa huruf drive, tanpa naik folder.
const namaBerkasSaja = (nama) => {
  const s = String(nama ?? '');
  if (!s || s !== path.basename(s) || /[\\/]|^[A-Za-z]:/.test(s)) {
    throw new Error(`Rujukan SARIF harus nama berkas saja, bukan path: ${JSON.stringify(nama)}`);
  }
  return s;
};

// Teks laporan alert diturunkan dengan fungsi yang sama seperti jalur Sonar, supaya satu perkakas
// tidak pernah memformat alert dengan cara yang berbeda dari perkakas lain. alert-format.txt
// byte-identik di prompt v2 dan v3, jadi versi template tidak mengubah hash ini.
const turunkanAlert = (alert) => {
  const template = render.bacaTemplate();
  const terformat = alert.map((a) => render.formatAlert(a, template.alert.teks));
  const teks = render.laporanSonar(terformat);
  return { alert: alert.map((a, i) => ({ ...a, teks: terformat[i] })), teks, hash_laporan_alert: render.sha256(teks) };
};

const buatIsiBeku = ({ alert, sarif, lingkungan, treeSrc, saringan, gerbangSanity, dibuat }) => {
  if (!dibuat) throw new Error('dibuat wajib diisi: pembangunan berkas beku harus deterministik');
  if (!treeSrc) throw new Error('treeSrc wajib diisi');
  if (!Array.isArray(alert)) throw new Error('alert harus larik');
  const isi = {
    versi_format: VERSI_FORMAT,
    dibuat,
    sumber: 'CodeQL CLI, suite javascript-security-extended dan javascript-code-scanning, SARIF 2.1.0',
    lingkungan,
    sarif: sarif.map((s) => ({ ...s, nama: namaBerkasSaja(s.nama) })),
    tree_src: treeSrc,
    filter_alert: FILTER_ALERT,
    saringan,
    gerbang_sanity: gerbangSanity,
    alert,
  };
  const t = turunkanAlert(alert);
  isi.ringkasan = { jumlah_alert: alert.length, hash_laporan_alert: t.hash_laporan_alert };
  return { ...isi, sha256_isi: hashIsi(isi) };
};

const tulisBeku = (file, isiBeku) => {
  fs.writeFileSync(file, `${JSON.stringify(isiBeku, null, 2)}\n`, 'utf8');
  return render.sha256(fs.readFileSync(file, 'utf8'));
};

// Baca dan verifikasi berkas beku terhadap objek uji. Gerbang tree src/ menolak run, bukan
// memperingatkan: alert yang menggambarkan kode lain bukan data yang lebih lemah, ia data yang salah.
const bacaBeku = (file, objek) => {
  if (!file) throw new Error('File CodeQL beku wajib diisi');
  if (!fs.existsSync(file)) throw new Error(`File CodeQL beku tidak ditemukan: ${file}`);
  const teks = fs.readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(teks); } catch { throw new Error(`File CodeQL beku bukan JSON valid: ${file}`); }
  const { sha256_isi: tercatat, ...isi } = data;
  if (data.versi_format !== VERSI_FORMAT) throw new Error(`Versi format file CodeQL beku tidak dikenal: ${data.versi_format}`);
  if (!tercatat || hashIsi(isi) !== tercatat) throw new Error('Hash isi file CodeQL beku tidak cocok, file ditolak');
  if (!data.tree_src || data.tree_src !== objek.tree_src) {
    throw new Error(`Hash tree src/ di file CodeQL beku (${data.tree_src}) berbeda dengan objek uji ${objek.commit} (${objek.tree_src}). Run ditolak`);
  }
  const t = turunkanAlert(data.alert ?? []);
  if (data.ringkasan?.hash_laporan_alert !== t.hash_laporan_alert) {
    throw new Error('Alert yang diturunkan dari file CodeQL beku tidak sama dengan ringkasan di file (format alert berubah)');
  }
  return {
    alert: t.alert,
    teks: t.teks,
    tree_src_analisis: data.tree_src,
    info: {
      // Nama berkas saja, bukan path: info ini ikut tercatat di keluaran run.
      nama: path.basename(file),
      sha256_file: render.sha256(teks),
      sha256_isi: tercatat,
      jumlah_alert: data.ringkasan?.jumlah_alert ?? null,
      dibuat: data.dibuat,
    },
  };
};

const main = () => {
  const ambil = (n) => {
    const a = process.argv.find((x) => x.startsWith(`--${n}=`));
    return a ? a.slice(n.length + 3) : null;
  };
  const wajib = (n) => {
    const v = ambil(n);
    if (!v) throw new Error(`--${n} wajib`);
    return v;
  };
  const { execFileSync } = require('child_process');
  const objekDir = path.resolve(wajib('objek'));
  const bersih = execFileSync('git', ['-C', objekDir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (bersih) throw new Error(`Worktree objek uji tidak bersih:\n${bersih}`);
  const treeSrc = execFileSync('git', ['-C', objekDir, 'rev-parse', 'HEAD:src'], { encoding: 'utf8' }).trim();

  const alert = JSON.parse(fs.readFileSync(path.resolve(wajib('alert')), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.resolve(wajib('metadata')), 'utf8'));
  const isi = buatIsiBeku({
    alert,
    // dibuat diambil dari metadata Tahap 1, bukan dari waktu sekarang, supaya dua pembangunan atas
    // masukan yang sama menghasilkan sha256_isi yang sama.
    dibuat: meta.dibuat_pada,
    treeSrc,
    lingkungan: meta.lingkungan,
    sarif: (meta.sarif ?? []).map((s) => ({ nama: path.basename(s.file), suite: s.suite, sha256: s.sha256, jumlah_result: s.jumlah_result })),
    saringan: meta.saringan ?? null,
    gerbangSanity: meta.gerbang_sanity ?? null,
  });
  const keluar = path.resolve(wajib('out'));
  const shaFile = tulisBeku(keluar, isi);
  console.log(`File CodeQL beku: ${path.basename(keluar)}`);
  console.log(`  alert ${isi.ringkasan.jumlah_alert}, tree src ${treeSrc.slice(0, 12)}`);
  console.log(`  sha256_isi ${isi.sha256_isi}`);
  console.log(`  sha256_file ${shaFile}`);
};

module.exports = { VERSI_FORMAT, FILTER_ALERT, hashIsi, namaBerkasSaja, turunkanAlert, buatIsiBeku, tulisBeku, bacaBeku };

if (require.main === module) main();
