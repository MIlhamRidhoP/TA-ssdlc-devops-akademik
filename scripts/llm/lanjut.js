// Dukungan run berselang-seling antar vendor (--lanjut) dan pencatatan commit kode alat.
//
// Sidik run = semua hal yang harus sama persis antara run dalam satu folder: vendor, model, kondisi, objek uji,
// laporan Sonar beku, hash semua file prompt dan skema, hash prompt kanonik setiap panggilan, pengaturan model
// (thinking, batas output, timeout koneksi), versi SDK, dan commit kode alat. Satu saja berbeda, run ditolak.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// File dalam lingkup yang harus bersih di repo alat, sama dengan daftar cek sebelum eksperimen.
const LINGKUP_KODE = [
  'scripts', 'prompts', 'tests', 'package.json', 'package-lock.json', '.github/workflows', '.gitignore', 'src',
  'docker-compose.yml', 'Dockerfile',
];

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

// HEAD repo alat dan status bersih untuk file dalam lingkup (termasuk file baru yang belum di-track).
const infoKodeAlat = (dir) => {
  const kotor = git(dir, 'status', '--porcelain', '--', ...LINGKUP_KODE);
  return {
    head: git(dir, 'rev-parse', 'HEAD'),
    branch: git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    bersih: kotor === '',
    berubah: kotor ? kotor.split('\n') : [],
    lingkup: LINGKUP_KODE,
  };
};

const periksaKodeAlat = (info) => {
  if (!info.bersih) {
    throw new Error(`File dalam lingkup di repo alat belum bersih, run ditolak:\n${info.berubah.join('\n')}`);
  }
  return info;
};

// Hash byte setiap file prompt dan skema yang terdaftar di HASHES.txt.
const hashFilePrompt = (dirPrompt) => {
  const baris = fs.readFileSync(path.join(dirPrompt, 'HASHES.txt'), 'utf8').split(/\r?\n/).filter((b) => b.trim());
  return Object.fromEntries(baris.map((b) => {
    const nama = b.trim().split(/\s+\*?/)[1];
    return [nama, crypto.createHash('sha256').update(fs.readFileSync(path.join(dirPrompt, nama))).digest('hex')];
  }).sort(([a], [b]) => (a < b ? -1 : 1)));
};

const bentukSidik = ({
  versiPrompt, vendor, model, kondisi, objek, sumberSonar, infoBeku, hashKodeSumber, hashLaporanSonar,
  hashPrompt, hashKering, pengaturan, sdk, kodeAlat,
}) => ({
  versi_prompt: versiPrompt,
  vendor,
  model_diminta: model,
  kondisi,
  objek_uji: { commit: objek.commit, tree_src: objek.tree_src },
  sumber_sonar: sumberSonar,
  sonar_beku_sha256_isi: infoBeku?.sha256_isi ?? null,
  hash_kode_sumber: hashKodeSumber,
  hash_laporan_sonar: hashLaporanSonar,
  hash_file_prompt: hashPrompt,
  prompt_system_kanonik: hashKering[0]?.prompt_system_kanonik ?? null,
  prompt_user_kanonik: Object.fromEntries(hashKering.map((h) => [h.id_alert ?? h.tugas, h.prompt_user_kanonik])),
  pengaturan,
  sdk,
  commit_kode: kodeAlat.head,
});

// Daftar path yang berbeda antara dua nilai JSON (rekursif).
const bedaSidik = (lama, baru, awalan = '') => {
  if (lama !== null && baru !== null && typeof lama === 'object' && typeof baru === 'object' && !Array.isArray(lama) && !Array.isArray(baru)) {
    const kunci = [...new Set([...Object.keys(lama), ...Object.keys(baru)])].sort();
    return kunci.flatMap((k) => bedaSidik(lama[k], baru[k], awalan ? `${awalan}.${k}` : k));
  }
  return JSON.stringify(lama) === JSON.stringify(baru) ? [] : [awalan || '(akar)'];
};

const nomorRunAda = (folder) => fs.readdirSync(folder)
  .map((f) => f.match(/^run-(\d+)\.json$/)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);

// Tentukan nomor run yang akan dijalankan. Tidak pernah menimpa run yang sudah ada, dan menolak melewati target
// kecuali lewatiTarget diisi.
const rencanaNomorRun = ({ folder, target, jalankan, lewatiTarget = false }) => {
  if (!Number.isInteger(jalankan) || jalankan < 1) throw new Error('--jalankan harus bilangan bulat >= 1');
  const ada = nomorRunAda(folder);
  const terakhir = ada.length ? ada[ada.length - 1] : 0;
  if (ada.some((n, i) => n !== i + 1)) throw new Error(`Nomor run di ${folder} tidak berurutan: ${ada.join(', ')}`);
  const nomor = Array.from({ length: jalankan }, (_, i) => terakhir + 1 + i);
  if (!lewatiTarget && nomor[nomor.length - 1] > target) {
    throw new Error(`Folder sudah berisi ${terakhir} dari ${target} run; run ${nomor.join(', ')} melewati target. Pakai --lewati-target kalau memang disengaja`);
  }
  for (const n of nomor) {
    for (const f of [`run-${n}.json`, `run-${n}.raw.json`]) {
      if (fs.existsSync(path.join(folder, f))) throw new Error(`${f} sudah ada di ${folder}, tidak ditimpa`);
    }
  }
  return nomor;
};

// Cek folder lama untuk --lanjut: sidik harus sama persis.
const periksaLanjut = (summaryLama, sidikBaru) => {
  if (!summaryLama.sidik_run) throw new Error('Folder tidak punya sidik_run (dibuat sebelum dukungan --lanjut), tidak bisa dilanjutkan');
  const beda = bedaSidik(summaryLama.sidik_run, sidikBaru);
  if (beda.length) throw new Error(`Konfigurasi run berbeda dari folder yang dilanjutkan, run ditolak. Berbeda: ${beda.join(', ')}`);
};

module.exports = {
  LINGKUP_KODE, infoKodeAlat, periksaKodeAlat, hashFilePrompt, bentukSidik, bedaSidik, nomorRunAda, rencanaNomorRun, periksaLanjut,
};
