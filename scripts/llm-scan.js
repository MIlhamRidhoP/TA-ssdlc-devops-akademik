// Analisis keamanan dengan prompt v2 (deteksi dan verifikasi), model-agnostic. Spesifikasi: prompts/v2/README.md.
// Prompt v1 tetap dijalankan dengan scripts/gemini-scan.js.
//
// Pemakaian:
//   node scripts/llm-scan.js --vendor=google|anthropic|openai --kondisi=utama|sonar_di_deteksi|komentar_menyesatkan
//                            [--skenario=B|C]
//
// Skenario adalah sumbu TERPISAH dari kondisi. Kondisi adalah variabel eksperimen TA (apa yang
// diberikan ke model); skenario adalah bentuk analisisnya:
//   B (bawaan) = deteksi LLM + verifikasi tiap alert SonarCloud. Perilaku yang sudah ada.
//   C          = deteksi LLM saja. Tidak ada panggilan verifikasi dan tidak ada alert di hasil,
//                jadi laporan SonarCloud tidak diambil sama sekali dan gerbang kesepadanan
//                analisis Sonar tidak berlaku. Prompt deteksinya byte-identik dengan B.
// Skenario A tidak punya panggilan LLM sama sekali, jadi tidak pernah sampai ke skrip ini.
//                            --objek=<worktree commit yang dianalisis> [--runs=N]
//
//   node scripts/llm-scan.js ... --sonar-beku=<file>     alert Sonar dari file beku (wajib untuk data eksperimen)
//   node scripts/llm-scan.js ... --kering                rakit prompt dan tampilkan hash tanpa memanggil API LLM
//   node scripts/llm-scan.js ... --runs=3 --jalankan=1   buat folder dengan target 3 run, jalankan run-1 saja
//   node scripts/llm-scan.js ... --lanjut=<folder>       tambah run berikutnya ke folder itu (bawaan 1 run);
//                                                        ditolak kalau sidik run berbeda atau target sudah tercapai
//                                                        (--lewati-target untuk sengaja melewati target)
//
// Setiap run mencatat commit_kode (HEAD repo alat); run ditolak kalau file dalam lingkup repo alat belum bersih.
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
const {
  infoKodeAlat, periksaKodeAlat, hashFilePrompt, bentukSidik, rencanaNomorRun, periksaLanjut,
} = require('./llm/lanjut');

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
// Skenario A tidak memanggil LLM, jadi bukan urusan skrip ini; yang sah di sini hanya B dan C.
const SKENARIO_ALAT = ['B', 'C'];

// Apakah run ini perlu laporan SonarCloud sama sekali. Dua keadaan tidak memerlukannya, dan
// keduanya karena alasan yang berbeda:
//   kondisi komentar_menyesatkan — variabel eksperimen: model sengaja tidak diberi laporan Sonar.
//   skenario C                   — bentuk analisis: tidak ada verifikasi, dan hasilnya tidak
//                                  memuat alert sama sekali (lihat scripts/llm/results-v2.js).
// Mengambilnya tetap bukan sekadar pemborosan satu panggilan API: siapkanSonar juga menolak run
// bila hash tree src/ pada revisi analisis Sonar berbeda dengan commit yang dianalisis. Tanpa
// pemisahan ini, skenario C gagal karena data yang tidak pernah ia pakai.
const perluSonar = ({ kondisi, skenario }) => kondisi !== 'komentar_menyesatkan' && skenario !== 'C';

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
  commit_kode: { head: konteks.kodeAlat.head, bersih: konteks.kodeAlat.bersih },
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
  const { template, kode, alert, kondisi, skenario } = konteks;
  const mentah = { deteksi: null, verifikasi: {} };
  const promptDeteksi = render.rakitPrompt({
    template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks: kondisi === 'sonar_di_deteksi' ? konteks.sonarTeks : null,
  });
  console.log(`Run ${n}: deteksi...`);
  const hasilDeteksi = await kirim(konteks, promptDeteksi, 'deteksi');
  mentah.deteksi = hasilDeteksi.percobaan;
  const validDeteksi = hasilDeteksi.status === 'ok' ? validasiDeteksi(hasilDeteksi.teks, kode.file) : { parse_ok: false, temuan: [] };
  const catatan = {
    versi_prompt: render.VERSI_PROMPT, kondisi, skenario, vendor: konteks.vendor, model_diminta: konteks.model, run: n,
    commit_objek_uji: konteks.objek.commit, branch_objek_uji: konteks.objek.branch, tree_src_objek_uji: konteks.objek.tree_src,
    analisis_sonar: konteks.analisisSonar, revisi_analisis_sonar: konteks.revisiSonar,
    sumber_sonar: konteks.sumberSonar, sonar_beku: konteks.infoBeku,
    commit_kode: { head: konteks.kodeAlat.head, bersih: konteks.kodeAlat.bersih },
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

  // Skenario C berhenti di deteksi: tidak ada panggilan verifikasi, dan karena itu tidak ada
  // putusan alert sama sekali. Prompt deteksinya sendiri tidak berubah sedikit pun dari skenario B.
  if (kondisi === 'utama' && skenario !== 'C') {
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
    // Waktu mulai dan selesai run (panggilan pertama dan terakhir), bukti urutan run berselang-seling antar vendor.
    waktu_mulai: c.deteksi.waktu_mulai, waktu_selesai: (c.verifikasi.at(-1)?.metadata ?? c.deteksi).waktu_selesai,
    commit_kode: c.commit_kode.head,
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
const runKering = ({ template, kondisi, kode, alert, sonarTeks, skenario = 'B' }) => {
  const deteksi = render.rakitPrompt({ template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks: kondisi === 'sonar_di_deteksi' ? sonarTeks : null });
  const hasil = [{ tugas: 'deteksi', id_alert: null, ...deteksi.hash }];
  if (kondisi === 'utama' && skenario !== 'C') {
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
  // Bawaan B: dispatch dan pemanggilan lama yang tidak menyebut skenario tetap berperilaku persis
  // seperti sebelumnya.
  const skenario = (ambilArg('skenario') ?? 'B').toUpperCase();
  if (!SKENARIO_ALAT.includes(skenario)) throw new Error(`--skenario harus ${SKENARIO_ALAT.join(' atau ')}`);
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
  if (perluSonar({ kondisi, skenario })) {
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
    for (const h of runKering({ template, kondisi, kode, alert, sonarTeks, skenario })) {
      console.log(`  ${(h.id_alert ?? h.tugas).padEnd(9)} prompt_user_kanonik ${h.prompt_user_kanonik}`);
    }
    const kodeKering = infoKodeAlat(ROOT);
    console.log(`  kode alat ${kodeKering.head} (${kodeKering.branch}), file dalam lingkup ${kodeKering.bersih ? 'bersih' : `BELUM BERSIH: ${kodeKering.berubah.join('; ')}`}`);
    console.log('Tidak ada panggilan API LLM dan tidak ada file yang ditulis.');
    return;
  }

  const model = VENDOR[vendor].model;
  const kodeAlat = periksaKodeAlat(infoKodeAlat(ROOT));
  const pengaturan = {
    sampling: 'bawaan', tingkat_thinking: TINGKAT_THINKING, batas_output: BATAS_OUTPUT, tools: 'none', fallback: 'none',
    parameter_vendor: ADAPTER[vendor].parameter, koneksi: pengaturanKoneksi(),
  };
  const sdk = versiSdk();
  const hashLaporanSonar = sonarTeks === null ? null : render.sha256(sonarTeks);
  const sidik = bentukSidik({
    versiPrompt: render.VERSI_PROMPT, vendor, model, kondisi, objek, sumberSonar, infoBeku,
    hashKodeSumber: render.sha256(kode.teks), hashLaporanSonar, hashPrompt: hashFilePrompt(render.PROMPT_DIR),
    hashKering: runKering({ template, kondisi, kode, alert, sonarTeks, skenario }), pengaturan, sdk, kodeAlat,
  });

  // Folder baru, atau folder lama untuk run berselang-seling (--lanjut). Folder lama hanya diterima kalau sidiknya
  // sama persis, dan run yang sudah ada tidak pernah ditimpa.
  const folderLanjut = ambilArg('lanjut');
  let folder;
  let summaryLama = null;
  if (folderLanjut) {
    folder = path.resolve(folderLanjut);
    summaryLama = JSON.parse(fs.readFileSync(path.join(folder, 'summary.json'), 'utf8'));
    periksaLanjut(summaryLama, sidik);
    if (ambilArg('runs') !== null && jumlahRun !== summaryLama.total_run_diminta) {
      throw new Error(`--runs=${jumlahRun} berbeda dengan target folder (${summaryLama.total_run_diminta})`);
    }
  } else {
    folder = path.join(OUTPUT_DIR, `${capWaktu()}-${vendor}-${kondisi}`);
    fs.mkdirSync(folder, { recursive: true });
  }
  const target = summaryLama ? summaryLama.total_run_diminta : jumlahRun;
  const nomor = rencanaNomorRun({
    folder, target, jalankan: Number(ambilArg('jalankan') ?? (summaryLama ? 1 : target)), lewatiTarget: process.argv.includes('--lewati-target'),
  });

  if (!summaryLama) {
    if (sonar) {
      tulisJson(path.join(folder, 'sonar-issues.json'), sonar.laporan.issues);
      tulisJson(path.join(folder, 'sonar-hotspots.json'), sonar.laporan.hotspots);
      tulisJson(path.join(folder, 'sonar-ringkasan.json'), sonar.ringkasan);
      tulisJson(path.join(folder, 'sonar-alert.json'), alert.map((a) => ({ ...a, hash: render.sha256(a.teks) })));
    }
    const contoh = render.rakitPrompt({ template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks });
    fs.writeFileSync(path.join(folder, 'prompt-system.txt'), contoh.system, 'utf8');
    fs.writeFileSync(path.join(folder, 'prompt-user-deteksi.txt'), contoh.user, 'utf8');
  }
  const konteks = {
    vendor, model, kondisi, skenario, objek, kode, template, alert, sonarTeks, folder, sdk,
    analisisSonar: sonar ? sonar.laporan.analisis.tanggal : null,
    revisiSonar: sonar ? sonar.laporan.analisis.revisi : null,
    sumberSonar, infoBeku, kodeAlat,
  };
  console.log(`Vendor ${vendor} (${model}), skenario ${skenario}, kondisi ${kondisi}, objek ${objek.branch}@${objek.commit.slice(0, 7)}, kode ${kodeAlat.head.slice(0, 7)}, `
    + `${kode.file.length} file, ${alert.length} alert, run ${nomor.join(', ')} dari ${target}${summaryLama ? ' (lanjut)' : ''}`);

  const ringkasan = [...(summaryLama?.runs ?? [])];
  let galat = summaryLama?.galat ?? null;
  const tulisSummary = () => tulisJson(path.join(folder, 'summary.json'), {
    dibuat: summaryLama?.dibuat ?? new Date().toISOString(), diperbarui: new Date().toISOString(),
    versi_prompt: render.VERSI_PROMPT, vendor, model_diminta: model, kondisi, skenario,
    objek_uji: { commit: objek.commit, branch: objek.branch, tree_src: objek.tree_src },
    analisis_sonar: konteks.analisisSonar, revisi_analisis_sonar: konteks.revisiSonar,
    tree_src_analisis_sonar: sonar ? sonar.tree_src_analisis : null,
    sumber_sonar: sumberSonar, sonar_beku: infoBeku,
    sonar: sonar ? { project: sonar.laporan.project, branch: sonar.laporan.branch, jumlah_issue: sonar.laporan.issues.length, jumlah_hotspot: sonar.laporan.hotspots.length, jumlah_alert: alert.length } : null,
    hash_laporan_sonar: hashLaporanSonar,
    hash_kode_sumber: render.sha256(kode.teks), jumlah_file: kode.file.length,
    commit_kode: kodeAlat,
    pengaturan,
    tarif: VENDOR[vendor].tarif, sdk, total_run_diminta: target, galat,
    sidik_run: sidik,
    biaya_total_usd: Number(ringkasan.reduce((s, r) => s + r.biaya_usd, 0).toFixed(6)),
    runs: ringkasan,
  });
  for (const n of nomor) {
    try {
      ringkasan.push(ringkasRun(await jalankanSatuRun(konteks, n)));
      tulisSummary(); // diperbarui setelah setiap run
    } catch (err) {
      if (!(err instanceof RunDibuang)) throw err;
      galat = `${err.message}. Run dibuang: perbaiki kode, lalu ulang seluruh run (README bagian 8)`;
      console.error(galat);
      break;
    }
  }
  tulisSummary();
  console.log(`Selesai. Hasil di ${path.relative(ROOT, folder).split(path.sep).join('/')}/`);
  if (galat) process.exitCode = 1;
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, periksaObjek, periksaBranchKondisi, ambilSonar, siapkanSonar, runKering, perluSonar, treeSrc, percobaanGagal, biayaPercobaanGagal };
