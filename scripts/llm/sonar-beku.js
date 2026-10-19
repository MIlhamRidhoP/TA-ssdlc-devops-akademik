// Laporan SonarCloud beku untuk eksperimen prompt v2.
// Semua run eksperimen membaca alert Sonar dari satu file JSON yang di-commit di branch objek uji, bukan dari API,
// supaya analisis ulang atau perubahan aturan Sonar tidak mengubah alert di tengah eksperimen. Panggilan verifikasi
// (scripts/llm-scan.js) dan scoring Skenario A dan B (scripts/llm-score.js) memakai file yang sama.
//
// Isi file: data mentah API (issues, hotspots, cwe_rule) + revisi analisis + hash tree src/ pada revisi itu,
// dan sha256_isi = SHA-256 atas JSON.stringify isi tanpa field sha256_isi (urutan kunci seperti di file).
const fs = require('fs');
const { execFileSync } = require('child_process');
const render = require('./render');

const VERSI_FORMAT = 1;
const FILTER_ALERT = 'v2: issue VULNERABILITY, dampak SECURITY, semua hotspot, atau rule ber-CWE (sonarKeFormatTemuan)';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const treeSrc = (dir, commit) => {
  try {
    return git(dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}:src`);
  } catch {
    return null;
  }
};

const hashIsi = (isi) => render.sha256(JSON.stringify(isi));

// Alert dan teks laporan diturunkan dari data mentah dengan kode yang sama seperti run berbasis API.
const turunkanAlert = (laporan) => {
  const { ringkasSonar } = require('../gemini-scan');
  const template = render.bacaTemplate();
  const alert = render.pilihAlert(ringkasSonar(laporan)).map((a) => ({ ...a, teks: render.formatAlert(a, template.alert.teks) }));
  const sonarTeks = render.laporanSonar(alert.map((a) => a.teks));
  return { ringkasan: ringkasSonar(laporan), alert, sonarTeks, hash_laporan_sonar: render.sha256(sonarTeks) };
};

// laporan: hasil ambilLaporanSonar() yang sudah lolos cek (tanpa galat, tree src cocok).
const buatIsiBeku = ({ laporan, treeSrcAnalisis, dibuat = new Date().toISOString() }) => {
  const isi = {
    versi_format: VERSI_FORMAT,
    dibuat,
    sumber: 'SonarCloud Web API (api/project_analyses/search, api/issues/search, api/hotspots/search, api/rules/show)',
    project: laporan.project,
    branch: laporan.branch,
    analisis: laporan.analisis,
    tree_src: treeSrcAnalisis,
    filter_alert: FILTER_ALERT,
    issues: laporan.issues,
    hotspots: laporan.hotspots,
    cwe_rule: laporan.cwe_rule,
  };
  const { alert, hash_laporan_sonar: hashLaporan } = turunkanAlert({ ...isi, galat: [] });
  isi.ringkasan = { jumlah_issue: isi.issues.length, jumlah_hotspot: isi.hotspots.length, jumlah_alert: alert.length, hash_laporan_sonar: hashLaporan };
  return { ...isi, sha256_isi: hashIsi(isi) };
};

const tulisBeku = (file, isiBeku) => {
  fs.writeFileSync(file, `${JSON.stringify(isiBeku, null, 2)}\n`, 'utf8');
  return render.sha256(fs.readFileSync(file, 'utf8'));
};

// Baca dan verifikasi file beku terhadap objek uji. Mengembalikan laporan berformat ambilLaporanSonar() dan info sumber.
const bacaBeku = (file, objek) => {
  if (!file) throw new Error('File Sonar beku wajib diisi');
  if (!fs.existsSync(file)) throw new Error(`File Sonar beku tidak ditemukan: ${file}`);
  const teks = fs.readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(teks); } catch { throw new Error(`File Sonar beku bukan JSON valid: ${file}`); }
  const { sha256_isi: tercatat, ...isi } = data;
  if (data.versi_format !== VERSI_FORMAT) throw new Error(`Versi format file Sonar beku tidak dikenal: ${data.versi_format}`);
  if (!tercatat || hashIsi(isi) !== tercatat) throw new Error('Hash isi file Sonar beku tidak cocok, file ditolak');
  if (data.tree_src !== objek.tree_src) {
    throw new Error(`Hash tree src/ di file Sonar beku (${data.tree_src}) berbeda dengan objek uji ${objek.commit} (${objek.tree_src}). Run ditolak`);
  }
  const treeRevisi = treeSrc(objek.dir, data.analisis?.revisi);
  if (treeRevisi && treeRevisi !== data.tree_src) {
    throw new Error(`Hash tree src/ revisi ${data.analisis.revisi} di repo (${treeRevisi}) tidak sama dengan yang tercatat di file beku`);
  }
  const laporan = { project: data.project, branch: data.branch, analisis: data.analisis, issues: data.issues, hotspots: data.hotspots, cwe_rule: data.cwe_rule, galat: [] };
  const turunan = turunkanAlert(laporan);
  if (data.ringkasan?.hash_laporan_sonar !== turunan.hash_laporan_sonar) {
    throw new Error('Alert yang diturunkan dari file Sonar beku tidak sama dengan ringkasan di file (filter atau format alert berubah)');
  }
  return {
    laporan,
    ...turunan,
    tree_src_analisis: data.tree_src,
    info: { path: file, sha256_file: render.sha256(teks), sha256_isi: tercatat, revisi: data.analisis?.revisi ?? null, dibuat: data.dibuat },
  };
};

module.exports = { VERSI_FORMAT, FILTER_ALERT, hashIsi, buatIsiBeku, tulisBeku, bacaBeku, turunkanAlert };
