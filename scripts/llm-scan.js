// Analisis keamanan dengan prompt v2 (deteksi dan verifikasi), model-agnostic. Spesifikasi: prompts/v2/README.md.
// Prompt v1 tetap dijalankan dengan scripts/gemini-scan.js.
//
// Pemakaian:
//   node scripts/llm-scan.js --vendor=google|anthropic|openai --kondisi=utama|sonar_di_deteksi|komentar_menyesatkan
//                            --objek=<worktree commit yang dianalisis> [--runs=N]
//
//   node scripts/llm-scan.js ... --sonar-beku=<file>     alert Sonar dari file beku (wajib untuk data eksperimen)
//   node scripts/llm-scan.js ... --kering                rakit prompt dan tampilkan hash tanpa memanggil API LLM
//   node scripts/llm-scan.js --bekukan-sonar --objek=<worktree> [--keluar=<file>]
//                                                        ambil laporan Sonar dari API sekali dan tulis file beku
//
// --objek harus worktree git tanpa perubahan yang belum di-commit. Tanpa --sonar-beku, kondisi utama dan
// sonar_di_deteksi mengambil laporan dari API (butuh SONAR_TOKEN, SONAR_PROJECT, SONAR_BRANCH), dan hash tree src/
// pada revisi analisis Sonar harus sama dengan objek uji. Metadata mencatat sumber_sonar: "beku" atau "api".
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const render = require('./llm/render');
const { validasiDeteksi, validasiVerifikasi } = require('./llm/validate');
const { panggilDenganUlang, ADAPTER } = require('./llm/panggil');
const { VENDOR, BATAS_OUTPUT, TINGKAT_THINKING, versiSdk, hitungBiaya } = require('./llm/vendor');
const { pengaturanKoneksi } = require('./llm/http');
const { buatIsiBeku, tulisBeku, bacaBeku } = require('./llm/sonar-beku');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'llm-output', 'v2');
const KUNCI_API = { google: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };
const NAMA_SKEMA = { deteksi: 'deteksi', verifikasi: 'verifikasi' };

const ambilArg = (nama) => {
  const arg = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return arg ? arg.slice(nama.length + 3) : null;
};
const tulisJson = (file, isi) => fs.writeFileSync(file, JSON.stringify(isi, null, 2));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

const capWaktu = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Objek uji harus worktree bersih supaya commit yang tercatat sama dengan kode yang dianalisis.
const periksaObjek = (dir) => {
  if (!dir) throw new Error('--objek wajib diisi (worktree commit yang dianalisis)');
  const objek = path.resolve(dir);
  if (!fs.existsSync(path.join(objek, 'src'))) throw new Error(`Folder src tidak ada di ${objek}`);
  const kotor = git(objek, 'status', '--porcelain');
  if (kotor) throw new Error(`Worktree objek uji punya perubahan yang belum di-commit, run ditolak:\n${kotor}`);
  return {
    dir: objek, commit: git(objek, 'rev-parse', 'HEAD'), branch: git(objek, 'rev-parse', '--abbrev-ref', 'HEAD'),
    tree_src: git(objek, 'rev-parse', 'HEAD:src'),
  };
};

const BRANCH_FRAMING = 'eksperimen/framing';
const periksaBranchKondisi = (kondisi, branch) => {
  if (kondisi === 'komentar_menyesatkan' && branch !== BRANCH_FRAMING) {
    throw new Error(`Kondisi komentar_menyesatkan harus dijalankan pada branch ${BRANCH_FRAMING}, bukan ${branch}. Run ditolak`);
  }
  if (kondisi !== 'komentar_menyesatkan' && branch === BRANCH_FRAMING) {
    console.warn(`Peringatan: kondisi ${kondisi} pada branch ${BRANCH_FRAMING}`);
  }
};

// Hash tree src/ pada sebuah commit, atau null kalau commit tidak ada di repo objek uji.
const treeSrc = (dir, commit) => {
  try {
    return git(dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}:src`);
  } catch {
    return null;
  }
};

// Analisis Sonar sah kalau isi src/ pada revisinya sama dengan src/ objek uji (hash tree sama), walaupun commit-nya
// berbeda, misalnya karena SEEDED.md di-commit setelah analisis.
// ambil bisa disuntik untuk tes; bawaannya mengambil dari API SonarCloud.
const ambilSonar = async (objek, { ambil } = {}) => {
  const { ambilLaporanSonar, ringkasSonar } = require('./gemini-scan');
  const laporan = await (ambil ?? ambilLaporanSonar)();
  if (laporan.galat.length) throw new Error(`Data SonarCloud tidak lengkap, run ditolak: ${laporan.galat.join('; ')}`);
  if (!laporan.analisis) throw new Error(`SonarCloud tidak punya analisis untuk ${laporan.project} branch ${laporan.branch}`);
  const treeAnalisis = laporan.analisis.revisi ? treeSrc(objek.dir, laporan.analisis.revisi) : null;
  if (!treeAnalisis) throw new Error(`Revisi analisis Sonar ${laporan.analisis.revisi} tidak ditemukan di repo objek uji. Run ditolak`);
  if (treeAnalisis !== objek.tree_src) {
    throw new Error(`src/ pada revisi analisis Sonar ${laporan.analisis.revisi} (tree ${treeAnalisis}) berbeda dengan objek uji `
      + `${objek.commit} (tree ${objek.tree_src}). Run ditolak`);
  }
  return { laporan, ringkasan: ringkasSonar(laporan), tree_src_analisis: treeAnalisis };
};

// Percobaan yang gagal: semua percobaan sebelum yang terakhir (karena diulang), ditambah percobaan terakhir kalau error.
const percobaanGagal = (percobaan) => percobaan
  .filter((p, i) => i < percobaan.length - 1 || p.status === 'error')
  .map(({ ke, waktu_mulai: mulai, waktu_selesai: selesai, http_status: http, status, detail_status: detail, usage }) => ({
    ke, waktu_mulai: mulai, waktu_selesai: selesai, http_status: http, status, detail_status: detail, usage,
  }));

const biayaPercobaanGagal = (gagal, tarif) => {
  if (gagal.some((p) => p.usage === 'tidak_tercatat')) return 'tidak_tercatat';
  return Number(gagal.reduce((s, p) => s + (hitungBiaya(p.usage, tarif) ?? 0), 0).toFixed(6));
};

const metadata = ({ konteks, tugas, run, idAlert, prompt, hasil, parseOk }) => ({
  versi_prompt: render.VERSI_PROMPT,
  kondisi: konteks.kondisi,
  tugas,
  run,
  id_alert: idAlert,
  vendor: konteks.vendor,
  model_diminta: konteks.model,
  model_menjawab: hasil.model_menjawab ?? null,
  cara_akses: 'api',
  waktu_mulai: hasil.waktu_mulai,
  waktu_selesai: hasil.waktu_selesai,
  pengaturan: {
    sampling: 'bawaan', tingkat_thinking: TINGKAT_THINKING, batas_output: BATAS_OUTPUT, tools: 'none', fallback: 'none',
    parameter_vendor: ADAPTER[konteks.vendor].parameter,
    koneksi: pengaturanKoneksi(),
  },
  hash: prompt.hash,
  commit_objek_uji: konteks.objek.commit,
  tree_src_objek_uji: konteks.objek.tree_src,
  analisis_sonar: konteks.analisisSonar,
  revisi_analisis_sonar: konteks.revisiSonar,
  sumber_sonar: konteks.sumberSonar,
  sonar_beku: konteks.infoBeku,
  status: hasil.status,
  detail_status: hasil.detail_status ?? '',
  parse_ok: parseOk,
  percobaan: hasil.percobaan.length,
  percobaan_gagal: percobaanGagal(hasil.percobaan),
  durasi_ms: new Date(hasil.waktu_selesai) - new Date(hasil.waktu_mulai),
  durasi_percobaan_terakhir_ms: new Date(hasil.percobaan.at(-1).waktu_selesai) - new Date(hasil.percobaan.at(-1).waktu_mulai),
  usage: hasil.usage ?? null,
  biaya_usd: hitungBiaya(hasil.usage, VENDOR[konteks.vendor].tarif),
  biaya_percobaan_gagal_usd: biayaPercobaanGagal(percobaanGagal(hasil.percobaan), VENDOR[konteks.vendor].tarif),
  sdk: konteks.sdk,
});

const kirim = (konteks, prompt, tugas) => panggilDenganUlang({
  vendor: konteks.vendor, model: konteks.model, system: prompt.system, user: prompt.user, blokUser: prompt.blok_user,
  skema: prompt.skema, namaSkema: NAMA_SKEMA[tugas], batasOutput: BATAS_OUTPUT, tingkatThinking: TINGKAT_THINKING,
});

class RunDibuang extends Error {}

const jalankanSatuRun = async (konteks, n) => {
  const { template, kode, alert, kondisi } = konteks;
  const mentah = { deteksi: null, verifikasi: {} };
  const promptDeteksi = render.rakitPrompt({
    template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks: kondisi === 'sonar_di_deteksi' ? konteks.sonarTeks : null,
  });
  console.log(`Run ${n}: deteksi...`);
  const hasilDeteksi = await kirim(konteks, promptDeteksi, 'deteksi');
  mentah.deteksi = hasilDeteksi.percobaan;
  const validDeteksi = hasilDeteksi.status === 'ok' ? validasiDeteksi(hasilDeteksi.teks, kode.file) : { parse_ok: false, temuan: [] };
  const catatan = {
    versi_prompt: render.VERSI_PROMPT, kondisi, vendor: konteks.vendor, model_diminta: konteks.model, run: n,
    commit_objek_uji: konteks.objek.commit, branch_objek_uji: konteks.objek.branch, tree_src_objek_uji: konteks.objek.tree_src,
    analisis_sonar: konteks.analisisSonar, revisi_analisis_sonar: konteks.revisiSonar,
    sumber_sonar: konteks.sumberSonar, sonar_beku: konteks.infoBeku,
    parse_ok: validDeteksi.parse_ok,
    temuan: validDeteksi.temuan,
    deteksi: metadata({ konteks, tugas: 'deteksi', run: n, idAlert: null, prompt: promptDeteksi, hasil: hasilDeteksi, parseOk: validDeteksi.parse_ok }),
    verifikasi: [],
  };
  const simpan = () => {
    tulisJson(path.join(konteks.folder, `run-${n}.json`), catatan);
    tulisJson(path.join(konteks.folder, `run-${n}.raw.json`), mentah);
  };
  if (hasilDeteksi.fatal) {
    simpan();
    throw new RunDibuang(`Deteksi run ${n}: ${hasilDeteksi.detail_status}`);
  }
  console.log(`  deteksi ${hasilDeteksi.status}, parse_ok ${validDeteksi.parse_ok}, ${validDeteksi.temuan.length} temuan`);

  if (kondisi === 'utama') {
    for (const a of alert) {
      const promptVer = render.rakitPrompt({ template, kondisi, tugas: 'verifikasi', kodeSumber: kode.teks, alertTeks: a.teks });
      console.log(`Run ${n}: verifikasi ${a.id}...`);
      const hasilVer = await kirim(konteks, promptVer, 'verifikasi');
      mentah.verifikasi[a.id] = hasilVer.percobaan;
      const validVer = hasilVer.status === 'ok' ? validasiVerifikasi(hasilVer.teks, a.id) : { parse_ok: false, hasil: null };
      catatan.verifikasi.push({
        id_alert: a.id,
        putusan: validVer.hasil?.putusan ?? null,
        keyakinan: validVer.hasil?.keyakinan ?? null,
        alasan: validVer.hasil?.alasan ?? null,
        id_alert_model: validVer.hasil?.id_alert ?? null,
        tanda: validVer.hasil?.tanda ?? [],
        metadata: metadata({ konteks, tugas: 'verifikasi', run: n, idAlert: a.id, prompt: promptVer, hasil: hasilVer, parseOk: validVer.parse_ok }),
      });
      if (hasilVer.fatal) {
        simpan();
        throw new RunDibuang(`Verifikasi ${a.id} run ${n}: ${hasilVer.detail_status}`);
      }
      console.log(`  ${a.id} ${hasilVer.status}, putusan ${validVer.hasil?.putusan ?? '-'}`);
    }
  }
  simpan();
  return catatan;
};

const ringkasRun = (c) => {
  const semua = [c.deteksi, ...c.verifikasi.map((v) => v.metadata)];
  const hitung = (pred) => semua.filter(pred).length;
  return {
    run: c.run, file: `run-${c.run}.json`, file_raw: `run-${c.run}.raw.json`,
    deteksi: { status: c.deteksi.status, parse_ok: c.deteksi.parse_ok, jumlah_temuan: c.temuan.length },
    verifikasi: c.verifikasi.map((v) => ({ id_alert: v.id_alert, status: v.metadata.status, parse_ok: v.metadata.parse_ok, putusan: v.putusan })),
    panggilan: {
      total: semua.length, refusal: hitung((m) => m.status === 'refusal'), truncated: hitung((m) => m.status === 'truncated'),
      error: hitung((m) => m.status === 'error'), parse_gagal: hitung((m) => m.status === 'ok' && !m.parse_ok),
    },
    biaya_usd: Number(semua.reduce((s, m) => s + (m.biaya_usd ?? 0), 0).toFixed(6)),
  };
};

// Ambil data Sonar dari file beku (eksperimen) atau dari API (run uji dan pengembangan).
const siapkanSonar = async (objek, fileBeku) => {
  if (fileBeku) {
    const b = bacaBeku(path.resolve(fileBeku), objek);
    return { sonar: { laporan: b.laporan, ringkasan: b.ringkasan, tree_src_analisis: b.tree_src_analisis }, sumber: 'beku', infoBeku: b.info };
  }
  return { sonar: await ambilSonar(objek), sumber: 'api', infoBeku: null };
};

const infoBekuRelatif = (info, objek) => (info ? {
  ...info, path: path.relative(objek.dir, path.resolve(info.path)).split(path.sep).join('/'),
} : null);

// --bekukan-sonar: ambil laporan dari API sekali (dengan cek hash tree src/), lalu tulis file beku di worktree objek uji.
const bekukanSonar = async (objek) => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const keluar = path.resolve(ambilArg('keluar') ?? path.join(objek.dir, 'hasil-eksperimen', `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`, 'sonar-beku.json'));
  if (fs.existsSync(keluar)) throw new Error(`File sudah ada, tidak ditimpa: ${keluar}`);
  const sonar = await ambilSonar(objek);
  const isi = buatIsiBeku({ laporan: sonar.laporan, treeSrcAnalisis: sonar.tree_src_analisis });
  fs.mkdirSync(path.dirname(keluar), { recursive: true });
  const shaFile = tulisBeku(keluar, isi);
  console.log(`File Sonar beku: ${keluar}`);
  console.log(`  project ${isi.project}, branch ${isi.branch}, analisis ${isi.analisis.tanggal} revisi ${isi.analisis.revisi}, tree src ${isi.tree_src}`);
  console.log(`  issue ${isi.ringkasan.jumlah_issue}, hotspot ${isi.ringkasan.jumlah_hotspot}, alert terpilih ${isi.ringkasan.jumlah_alert}`);
  console.log(`  hash laporan Sonar ${isi.ringkasan.hash_laporan_sonar}`);
  console.log(`  sha256_isi ${isi.sha256_isi}`);
  console.log(`  SHA-256 file ${shaFile}`);
};

// --kering: rakit semua prompt satu run dan tampilkan hash-nya tanpa memanggil API LLM dan tanpa menulis file.
const runKering = ({ template, kondisi, kode, alert, sonarTeks }) => {
  const deteksi = render.rakitPrompt({ template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks: kondisi === 'sonar_di_deteksi' ? sonarTeks : null });
  const hasil = [{ tugas: 'deteksi', id_alert: null, ...deteksi.hash }];
  if (kondisi === 'utama') {
    for (const a of alert) {
      const v = render.rakitPrompt({ template, kondisi, tugas: 'verifikasi', kodeSumber: kode.teks, alertTeks: a.teks });
      hasil.push({ tugas: 'verifikasi', id_alert: a.id, ...v.hash });
    }
  }
  return hasil;
};

const main = async () => {
  const prompt = ambilArg('prompt') ?? 'v2';
  if (prompt === 'v1') throw new Error('Prompt v1 dijalankan dengan: node scripts/gemini-scan.js --runs=N');
  if (prompt !== 'v2') throw new Error(`Versi prompt tidak dikenal: ${prompt}`);
  if (process.argv.includes('--bekukan-sonar')) {
    const objek = periksaObjek(ambilArg('objek'));
    process.env.OBJEK_UJI_DIR = objek.dir;
    return bekukanSonar(objek);
  }
  const kering = process.argv.includes('--kering');
  const vendor = ambilArg('vendor');
  const kondisi = ambilArg('kondisi');
  if (!VENDOR[vendor]) throw new Error('--vendor harus google, anthropic, atau openai');
  if (!render.KONDISI.includes(kondisi)) throw new Error(`--kondisi harus ${render.KONDISI.join(', ')}`);
  if (!kering && !process.env[KUNCI_API[vendor]]) throw new Error(`${KUNCI_API[vendor]} tidak diset`);
  const jumlahRun = Number(ambilArg('runs') ?? 1);
  if (!Number.isInteger(jumlahRun) || jumlahRun < 1) throw new Error('--runs harus bilangan bulat >= 1');

  render.cekHashPrompt();
  const objek = periksaObjek(ambilArg('objek'));
  process.env.OBJEK_UJI_DIR = objek.dir;
  periksaBranchKondisi(kondisi, objek.branch);

  const kode = render.bentukKodeSumber(objek.dir);
  const template = render.bacaTemplate();
  let alert = [];
  let sonarTeks = null;
  let sonar = null;
  let sumberSonar = null;
  let infoBeku = null;
  if (kondisi !== 'komentar_menyesatkan') {
    ({ sonar, sumber: sumberSonar, infoBeku } = await siapkanSonar(objek, ambilArg('sonar-beku')));
    alert = render.pilihAlert(sonar.ringkasan).map((a) => ({ ...a, teks: render.formatAlert(a, template.alert.teks) }));
    sonarTeks = render.laporanSonar(alert.map((a) => a.teks));
  }
  infoBeku = infoBekuRelatif(infoBeku, objek);

  if (kering) {
    console.log(`Run kering: vendor ${vendor}, kondisi ${kondisi}, objek ${objek.branch}@${objek.commit.slice(0, 7)}, sumber Sonar ${sumberSonar ?? '-'}`);
    if (infoBeku) console.log(`  file beku ${infoBeku.path} (SHA-256 ${infoBeku.sha256_file}, revisi ${infoBeku.revisi})`);
    console.log(`  hash kode_sumber ${render.sha256(kode.teks)}`);
    if (sonarTeks !== null) console.log(`  hash laporan Sonar ${render.sha256(sonarTeks)}, ${alert.length} alert`);
    for (const h of runKering({ template, kondisi, kode, alert, sonarTeks })) {
      console.log(`  ${(h.id_alert ?? h.tugas).padEnd(9)} prompt_user_kanonik ${h.prompt_user_kanonik}`);
    }
    console.log('Tidak ada panggilan API LLM dan tidak ada file yang ditulis.');
    return;
  }

  const model = VENDOR[vendor].model;
  const folder = path.join(OUTPUT_DIR, `${capWaktu()}-${vendor}-${kondisi}`);
  fs.mkdirSync(folder, { recursive: true });
  if (sonar) {
    tulisJson(path.join(folder, 'sonar-issues.json'), sonar.laporan.issues);
    tulisJson(path.join(folder, 'sonar-hotspots.json'), sonar.laporan.hotspots);
    tulisJson(path.join(folder, 'sonar-ringkasan.json'), sonar.ringkasan);
    tulisJson(path.join(folder, 'sonar-alert.json'), alert.map((a) => ({ ...a, hash: render.sha256(a.teks) })));
  }
  const konteks = {
    vendor, model, kondisi, objek, kode, template, alert, sonarTeks, folder, sdk: versiSdk(),
    analisisSonar: sonar ? sonar.laporan.analisis.tanggal : null,
    revisiSonar: sonar ? sonar.laporan.analisis.revisi : null,
    sumberSonar, infoBeku,
  };
  const contoh = render.rakitPrompt({ template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks });
  fs.writeFileSync(path.join(folder, 'prompt-system.txt'), contoh.system, 'utf8');
  fs.writeFileSync(path.join(folder, 'prompt-user-deteksi.txt'), contoh.user, 'utf8');
  console.log(`Vendor ${vendor} (${model}), kondisi ${kondisi}, objek ${objek.branch}@${objek.commit.slice(0, 7)}, ${kode.file.length} file, ${alert.length} alert`);

  const ringkasan = [];
  let galat = null;
  for (let n = 1; n <= jumlahRun; n++) {
    try {
      ringkasan.push(ringkasRun(await jalankanSatuRun(konteks, n)));
    } catch (err) {
      if (!(err instanceof RunDibuang)) throw err;
      galat = `${err.message}. Run dibuang: perbaiki kode, lalu ulang seluruh run (README bagian 8)`;
      console.error(galat);
      break;
    }
  }
  tulisJson(path.join(folder, 'summary.json'), {
    dibuat: new Date().toISOString(), versi_prompt: render.VERSI_PROMPT, vendor, model_diminta: model, kondisi,
    objek_uji: { commit: objek.commit, branch: objek.branch, tree_src: objek.tree_src },
    analisis_sonar: konteks.analisisSonar, revisi_analisis_sonar: konteks.revisiSonar,
    tree_src_analisis_sonar: sonar ? sonar.tree_src_analisis : null,
    sumber_sonar: sumberSonar, sonar_beku: infoBeku,
    sonar: sonar ? { project: sonar.laporan.project, branch: sonar.laporan.branch, jumlah_issue: sonar.laporan.issues.length, jumlah_hotspot: sonar.laporan.hotspots.length, jumlah_alert: alert.length } : null,
    hash_laporan_sonar: sonarTeks === null ? null : render.sha256(sonarTeks),
    hash_kode_sumber: render.sha256(kode.teks), jumlah_file: kode.file.length,
    pengaturan: {
      sampling: 'bawaan', tingkat_thinking: TINGKAT_THINKING, batas_output: BATAS_OUTPUT, tools: 'none', fallback: 'none',
      parameter_vendor: ADAPTER[vendor].parameter, koneksi: pengaturanKoneksi(),
    },
    tarif: VENDOR[vendor].tarif, sdk: konteks.sdk, total_run_diminta: jumlahRun, galat,
    biaya_total_usd: Number(ringkasan.reduce((s, r) => s + r.biaya_usd, 0).toFixed(6)),
    runs: ringkasan,
  });
  console.log(`Selesai. Hasil di ${path.relative(ROOT, folder).split(path.sep).join('/')}/`);
  if (galat) process.exitCode = 1;
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { periksaObjek, periksaBranchKondisi, ambilSonar, siapkanSonar, runKering, treeSrc, percobaanGagal, biayaPercobaanGagal };
