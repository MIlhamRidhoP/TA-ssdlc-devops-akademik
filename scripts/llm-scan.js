// Analisis keamanan dengan prompt v2 atau v3 (deteksi dan verifikasi), model-agnostic.
// Spesifikasi: prompts/v2/README.md; v3 adalah salinan netral perkakas, lihat prompts/v3/README.md.
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
//   node scripts/llm-scan.js ... --sast=sonar|codeql|keduanya   perkakas SAST pemasok alert (bawaan sonar)
//   node scripts/llm-scan.js ... --codeql-beku=<file>    alert CodeQL dari file beku (wajib kalau sast memuat codeql)
//   node scripts/llm-scan.js ... --prompt=v2|v3          versi folder prompt (bawaan v2)
//   node scripts/llm-scan.js ... --kering                rakit prompt dan tampilkan hash tanpa memanggil API LLM
//   node scripts/llm-scan.js ... --runs=3 --jalankan=1   buat folder dengan target 3 run, jalankan run-1 saja
//   node scripts/llm-scan.js ... --lanjut=<folder>       tambah run berikutnya ke folder itu (bawaan 1 run);
//                                                        ditolak kalau sidik run berbeda atau target sudah tercapai
//                                                        (--lewati-target untuk sengaja melewati target)
//
// Deteksi yang gagal setelah semua percobaan ulang (koneksi putus, timeout) MENGHENTIKAN run dengan kode
// keluar 1, tanpa verifikasi. Nomor run itu tidak terpakai: tidak ada run-N.json, hanya run-N.gagal-K.json
// dan catatan di summary.json (runs_gagal), sehingga --lanjut menjalankan nomor yang sama lagi.
//
// Setiap run mencatat commit_kode (HEAD repo alat); run ditolak kalau file dalam lingkup repo alat belum bersih.
//   node scripts/llm-scan.js --bekukan-sonar --objek=<worktree> [--keluar=<file>]
//                                                        ambil laporan Sonar dari API sekali dan tulis file beku
//
// sast adalah sumbu KETIGA, terpisah dari kondisi dan dari skenario; tidak ada "skenario D".
// Bawaannya sonar, sehingga pemanggilan yang tidak menyebutnya berperilaku persis seperti sebelum
// sumbu ini ada: daftar alertnya tidak pernah melewati penggabung, dan run-N.json maupun summary.json
// tidak memuat medan sast sama sekali. Dua kombinasi ditolak di scripts/sast/sumbu-sast.js, masing-
// masing dengan sebabnya sendiri: skenario C (tidak memakai alert sama sekali) dan kondisi
// sonar_di_deteksi (bentuk laporan gabungan dua perkakas belum dirancang).
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
const { SAST_BAWAAN, perkakasUntuk, periksaKombinasi, gabungAlert } = require('./sast/sumbu-sast');
const { bacaBeku: bacaBekuCodeql } = require('./sast/codeql-beku');
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

// `tanda` menandai keadaan yang perlu dibedakan walaupun panggilannya berhasil. Yang pertama dan
// sejauh ini satu-satunya: "deteksi_kosong", yaitu jawaban yang lolos skema tetapi tidak berisi satu
// temuan pun. Tanpa penanda ini, jawaban `{"temuan": []}` tidak terbedakan dari analisis sungguhan
// yang kebetulan bersih: keduanya tercatat `status: ok`, `parse_ok: true`, nol temuan. Di repo demo
// Gemini dua kali menjawab begitu setelah berpikir hanya 258 dan 2.372 token, dibanding 23.305 token
// pada run yang menemukan tujuh temuan pada kode yang sama persis.
//
// Arti `status` sengaja tidak diubah: panggilannya memang berhasil dan finishReason-nya memang STOP.
// Yang kurang selama ini penandanya, bukan statusnya, dan mengubah `status` akan menggeser
// status_panggilan di seluruh data eksperimen yang sudah diambil.
const metadata = ({ konteks, tugas, run, idAlert, prompt, hasil, parseOk, tanda = [] }) => ({
  versi_prompt: konteks.versiPrompt,
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
  tanda,
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

// Jawaban deteksi yang lolos skema tetapi nol temuan. Dipisah sebagai fungsi supaya bisa diuji
// tanpa menjalankan satu panggilan pun.
const tandaDeteksi = (valid) => (valid.parse_ok && valid.temuan.length === 0 ? ['deteksi_kosong'] : []);

class RunDibuang extends Error {}

// Run yang BERHENTI karena deteksinya gagal habis (percobaan ulang sudah terpakai, tetapi galatnya bukan
// fatal): biasanya jaringan atau sisi vendor yang putus-putus, bukan kesalahan kode. Berbeda dari
// RunDibuang, yang artinya "perbaiki kode lalu ulang seluruh run".
//
// Run seperti ini TIDAK menghabiskan satu nomor: run-N.json tidak ditulis, sehingga --lanjut menjalankan
// nomor yang sama lagi di folder yang sama, dan nomor run tetap berurutan 1..target tanpa lubang. Bukti
// kegagalannya disimpan di run-N.gagal-K.json (tidak pernah ditimpa) dan dicatat di summary.json.
class RunGagal extends Error {
  constructor(pesan, catatan) {
    super(pesan);
    this.catatan = catatan;
  }
}

// Nama berkas bukti kegagalan berikutnya untuk satu nomor run: tidak menimpa yang sudah ada.
const berkasGagalBerikutnya = (folder, n) => {
  const pola = new RegExp(`^run-${n}\\.gagal-(\\d+)\\.json$`);
  const ada = fs.readdirSync(folder).map((f) => f.match(pola)).filter(Boolean).map((m) => Number(m[1]));
  return `run-${n}.gagal-${(ada.length ? Math.max(...ada) : 0) + 1}.json`;
};

const jalankanSatuRun = async (konteks, n) => {
  const { template, kode, alert, kondisi, skenario } = konteks;
  // konteks.kirim hanya ada supaya tes bisa menyuntik panggilan palsu; alat sungguhan selalu memakai kirim.
  const kirimPanggilan = konteks.kirim ?? kirim;
  const mentah = { deteksi: null, verifikasi: {} };
  const promptDeteksi = render.rakitPrompt({
    template, kondisi, tugas: 'deteksi', kodeSumber: kode.teks, sonarTeks: kondisi === 'sonar_di_deteksi' ? konteks.sonarTeks : null,
  });
  console.log(`Run ${n}: deteksi...`);
  const hasilDeteksi = await kirimPanggilan(konteks, promptDeteksi, 'deteksi');
  mentah.deteksi = hasilDeteksi.percobaan;
  const validDeteksi = hasilDeteksi.status === 'ok' ? validasiDeteksi(hasilDeteksi.teks, kode.file) : { parse_ok: false, temuan: [] };
  const catatan = {
    versi_prompt: konteks.versiPrompt, kondisi, skenario, vendor: konteks.vendor, model_diminta: konteks.model, run: n,
    commit_objek_uji: konteks.objek.commit, branch_objek_uji: konteks.objek.branch, tree_src_objek_uji: konteks.objek.tree_src,
    analisis_sonar: konteks.analisisSonar, revisi_analisis_sonar: konteks.revisiSonar,
    sumber_sonar: konteks.sumberSonar, sonar_beku: konteks.infoBeku,
    // Ditulis hanya kalau bukan nilai bawaan, mengikuti cara `skenario` dulu diperkenalkan: run
    // sonar-saja karena itu menghasilkan berkas yang byte-identik dengan sebelum sumbu ini ada, dan
    // run yang TIDAK menyebut sast memang berarti sonar saja.
    ...(konteks.sast !== 'sonar' ? { sast: konteks.sast, codeql_beku: konteks.infoBekuCodeql } : {}),
    commit_kode: { head: konteks.kodeAlat.head, bersih: konteks.kodeAlat.bersih },
    parse_ok: validDeteksi.parse_ok,
    temuan: validDeteksi.temuan,
    deteksi: metadata({
      konteks, tugas: 'deteksi', run: n, idAlert: null, prompt: promptDeteksi, hasil: hasilDeteksi,
      parseOk: validDeteksi.parse_ok, tanda: tandaDeteksi(validDeteksi),
    }),
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

  // Deteksi yang gagal habis (status error, bukan fatal) menghentikan run di sini. Sebelumnya alat terus
  // ke 23 verifikasi, dan pada pilot 26 Oktober 2026 itu menghasilkan run yang separuh sah: verifikasinya
  // tersimpan dan ditagih, deteksinya kosong, dan angkanya ikut terhitung. Hanya status `error` yang
  // berhenti. refusal, truncated, dan parse_ok false tetap berjalan seperti sebelumnya: itu keadaan
  // jawaban model yang dicatat sebagai panggilan tanpa hasil, bukan kegagalan menjangkau vendor.
  if (hasilDeteksi.status === 'error') {
    const berkas = berkasGagalBerikutnya(konteks.folder, n);
    tulisJson(path.join(konteks.folder, berkas), {
      run: n, sebab: 'deteksi_gagal_setelah_percobaan_ulang', detail_status: hasilDeteksi.detail_status,
      deteksi: catatan.deteksi, mentah: mentah.deteksi,
    });
    throw new RunGagal(
      `Run ${n} dihentikan: deteksi gagal setelah ${hasilDeteksi.percobaan.length} percobaan (${hasilDeteksi.detail_status}). `
      + `Verifikasi tidak dijalankan. Bukti di ${berkas} dan summary.json (runs_gagal). `
      + 'Nomor run ini belum terpakai: ulangi dengan --lanjut',
      {
        run: n, sebab: 'deteksi_gagal_setelah_percobaan_ulang', detail_status: hasilDeteksi.detail_status,
        percobaan: hasilDeteksi.percobaan.length, waktu_mulai: hasilDeteksi.waktu_mulai, waktu_selesai: hasilDeteksi.waktu_selesai,
        berkas, commit_kode: konteks.kodeAlat.head,
      },
    );
  }

  // Skenario C berhenti di deteksi: tidak ada panggilan verifikasi, dan karena itu tidak ada
  // putusan alert sama sekali. Prompt deteksinya sendiri tidak berubah sedikit pun dari skenario B.
  if (kondisi === 'utama' && skenario !== 'C') {
    for (const a of alert) {
      const promptVer = render.rakitPrompt({ template, kondisi, tugas: 'verifikasi', kodeSumber: kode.teks, alertTeks: a.teks });
      console.log(`Run ${n}: verifikasi ${a.id}...`);
      const hasilVer = await kirimPanggilan(konteks, promptVer, 'verifikasi');
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

// Menjalankan nomor-nomor run berurutan dan berhenti di kegagalan pertama. Diekstrak dari main() supaya
// perilaku berhenti dan pencatatannya bisa diuji tanpa melewati gerbang "kode alat bersih", yang menolak
// run apa pun selama pohon kerja berubah.
//   galat        pesan RunDibuang (perbaiki kode, ulang seluruh run); permanen di summary.json
//   gagalDeteksi true bila berhenti karena RunGagal; kegagalannya masuk runsGagal, BUKAN galat, karena
//                galat ikut terbawa ke setiap --lanjut dan akan membuat run yang berhasil berikutnya
//                tetap berkode keluar non-nol
const jalankanDaftarRun = async (konteks, nomor, { ringkasan, runsGagal, tulisSummary }) => {
  let galat = null;
  let gagalDeteksi = false;
  for (const n of nomor) {
    try {
      ringkasan.push(ringkasRun(await jalankanSatuRun(konteks, n)));
      tulisSummary(); // diperbarui setelah setiap run
    } catch (err) {
      if (err instanceof RunGagal) {
        runsGagal.push(err.catatan);
        console.error(err.message);
        gagalDeteksi = true;
        break;
      }
      if (!(err instanceof RunDibuang)) throw err;
      galat = `${err.message}. Run dibuang: perbaiki kode, lalu ulang seluruh run (README bagian 8)`;
      console.error(galat);
      break;
    }
  }
  return { galat, gagalDeteksi };
};

const ringkasRun = (c) => {
  const semua = [c.deteksi, ...c.verifikasi.map((v) => v.metadata)];
  const hitung = (pred) => semua.filter(pred).length;
  return {
    run: c.run, file: `run-${c.run}.json`, file_raw: `run-${c.run}.raw.json`,
    // Waktu mulai dan selesai run (panggilan pertama dan terakhir), bukti urutan run berselang-seling antar vendor.
    waktu_mulai: c.deteksi.waktu_mulai, waktu_selesai: (c.verifikasi.at(-1)?.metadata ?? c.deteksi).waktu_selesai,
    commit_kode: c.commit_kode.head,
    deteksi: {
      status: c.deteksi.status, parse_ok: c.deteksi.parse_ok, jumlah_temuan: c.temuan.length,
      tanda: [...(c.deteksi.tanda ?? [])], thinking: c.deteksi.usage?.thinking ?? null,
    },
    verifikasi: c.verifikasi.map((v) => ({ id_alert: v.id_alert, status: v.metadata.status, parse_ok: v.metadata.parse_ok, putusan: v.putusan })),
    panggilan: {
      total: semua.length, refusal: hitung((m) => m.status === 'refusal'), truncated: hitung((m) => m.status === 'truncated'),
      error: hitung((m) => m.status === 'error'), parse_gagal: hitung((m) => m.status === 'ok' && !m.parse_ok),
      deteksi_kosong: hitung((m) => (m.tanda ?? []).includes('deteksi_kosong')),
    },
    // Token thinking dijumlahkan dari angka yang SUDAH dicatat adapter; tidak ada panggilan tambahan.
    // Inilah yang membedakan jawaban kosong karena model nyaris tidak berpikir dari analisis sungguhan.
    thinking_token: semua.reduce((s, m) => s + (m.usage?.thinking ?? 0), 0),
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
  // Versi prompt, bawaan v2: pemanggilan yang tidak menyebutnya memakai folder prompt yang persis
  // sama dengan sebelum sumbu ini ada. Diturunkan SEKALI di sini dan dipakai sampai bawah.
  //
  // Dulu ada dua penurunan: satu di sini yang memaku 'v2', satu lagi di bawah yang memakai
  // render.VERSI_PROMPT. Yang di atas menang karena berjalan lebih dulu, sehingga --prompt=v3
  // ditolak dengan "Versi prompt tidak dikenal: v3" di CLI nyata padahal render.dirPrompt('v3')
  // sudah lama menerimanya. Daftar versi karena itu diambil dari render, satu sumber kebenaran.
  //
  // Tetap diperiksa paling awal, sebelum --bekukan-sonar dan sebelum penjaga argumen lain, supaya
  // versi yang tidak ada tidak sempat menjalankan apa pun.
  const versiPrompt = (ambilArg('prompt') ?? render.VERSI_PROMPT).toLowerCase();
  // v1 BUKAN "tidak dikenal": ia ada, hanya dijalankan skrip lain. Pesannya dipisah supaya pemanggil
  // yang salah skrip diarahkan ke skrip yang benar, bukan disuruh mengganti versi.
  if (versiPrompt === 'v1') throw new Error('Prompt v1 dijalankan dengan: node scripts/gemini-scan.js --runs=N');
  if (!render.VERSI_PROMPT_DIDUKUNG.includes(versiPrompt)) {
    throw new Error(`Versi prompt tidak dikenal: ${versiPrompt}. Yang ada: ${render.VERSI_PROMPT_DIDUKUNG.join(', ')}`);
  }
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
  // Sumbu sast, bawaan sonar: pemanggilan yang tidak menyebutnya berperilaku persis seperti
  // sebelumnya, termasuk tidak pernah melewati penggabung alert. Diperiksa setelah kondisi dan
  // skenario sah, supaya pesan galat yang muncul lebih dulu adalah yang paling dekat ke sebabnya.
  const sast = (ambilArg('sast') ?? SAST_BAWAAN).toLowerCase();
  // versiPrompt sudah diturunkan dan diperiksa di awal main(); di sini tinggal folder promptnya.
  const dirPrompt = render.dirPrompt(versiPrompt);
  periksaKombinasi({ sast, skenario, kondisi, versiPrompt });
  if (!kering && !process.env[KUNCI_API[vendor]]) throw new Error(`${KUNCI_API[vendor]} tidak diset`);
  const jumlahRun = Number(ambilArg('runs') ?? 1);
  if (!Number.isInteger(jumlahRun) || jumlahRun < 1) throw new Error('--runs harus bilangan bulat >= 1');

  render.cekHashPrompt(dirPrompt);
  const objek = periksaObjek(ambilArg('objek'));
  process.env.OBJEK_UJI_DIR = objek.dir;
  periksaBranchKondisi(kondisi, objek.branch);

  const kode = render.bentukKodeSumber(objek.dir);
  const template = render.bacaTemplate(dirPrompt);
  let alert = [];
  let sonarTeks = null;
  let sonar = null;
  let sumberSonar = null;
  let infoBeku = null;
  let infoBekuCodeql = null;
  if (perluSonar({ kondisi, skenario })) {
    let alertSonar = [];
    if (perkakasUntuk(sast).includes('sonar')) {
      ({ sonar, sumber: sumberSonar, infoBeku } = await siapkanSonar(objek, ambilArg('sonar-beku')));
      alertSonar = render.pilihAlert(sonar.ringkasan).map((a) => ({ ...a, teks: render.formatAlert(a, template.alert.teks) }));
    }
    let alertCodeql = [];
    if (perkakasUntuk(sast).includes('codeql')) {
      const fileCodeql = ambilArg('codeql-beku');
      if (!fileCodeql) throw new Error(`--codeql-beku wajib untuk --sast=${sast}`);
      const b = bacaBekuCodeql(path.resolve(fileCodeql), objek);
      infoBekuCodeql = b.info;
      alertCodeql = b.alert;
    }
    // sast=sonar memakai daftar alert itu apa adanya dan tidak pernah melewati penggabung, sehingga
    // perilakunya identik dengan sebelum sumbu ini ada. Penggabungan hanya untuk sumbu yang memang
    // memuat lebih dari satu perkakas.
    alert = sast === 'sonar' ? alertSonar : gabungAlert({ sonar: alertSonar, codeql: alertCodeql });
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
    versiPrompt, vendor, model, kondisi, objek, sumberSonar, infoBeku,
    hashKodeSumber: render.sha256(kode.teks), hashLaporanSonar, hashPrompt: hashFilePrompt(dirPrompt),
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
    sumberSonar, infoBeku, kodeAlat, sast, infoBekuCodeql, versiPrompt,
  };
  console.log(`Vendor ${vendor} (${model}), skenario ${skenario}, kondisi ${kondisi}, objek ${objek.branch}@${objek.commit.slice(0, 7)}, kode ${kodeAlat.head.slice(0, 7)}, `
    + `${kode.file.length} file, ${alert.length} alert, run ${nomor.join(', ')} dari ${target}${summaryLama ? ' (lanjut)' : ''}`);

  const ringkasan = [...(summaryLama?.runs ?? [])];
  let galat = summaryLama?.galat ?? null;
  // Run yang berhenti karena deteksi gagal habis, termasuk yang dicatat folder ini sebelum --lanjut.
  const runsGagal = [...(summaryLama?.runs_gagal ?? [])];
  const tulisSummary = () => tulisJson(path.join(folder, 'summary.json'), {
    dibuat: summaryLama?.dibuat ?? new Date().toISOString(), diperbarui: new Date().toISOString(),
    versi_prompt: versiPrompt, vendor, model_diminta: model, kondisi, skenario,
    objek_uji: { commit: objek.commit, branch: objek.branch, tree_src: objek.tree_src },
    analisis_sonar: konteks.analisisSonar, revisi_analisis_sonar: konteks.revisiSonar,
    tree_src_analisis_sonar: sonar ? sonar.tree_src_analisis : null,
    sumber_sonar: sumberSonar, sonar_beku: infoBeku,
    ...(sast !== 'sonar' ? { sast, codeql_beku: infoBekuCodeql } : {}),
    sonar: sonar ? { project: sonar.laporan.project, branch: sonar.laporan.branch, jumlah_issue: sonar.laporan.issues.length, jumlah_hotspot: sonar.laporan.hotspots.length, jumlah_alert: alert.length } : null,
    hash_laporan_sonar: hashLaporanSonar,
    hash_kode_sumber: render.sha256(kode.teks), jumlah_file: kode.file.length,
    commit_kode: kodeAlat,
    pengaturan,
    tarif: VENDOR[vendor].tarif, sdk, total_run_diminta: target, galat,
    // Hanya ditulis kalau ada, supaya summary run yang tidak pernah gagal tetap identik dengan sebelumnya.
    ...(runsGagal.length ? { runs_gagal: runsGagal } : {}),
    sidik_run: sidik,
    biaya_total_usd: Number(ringkasan.reduce((s, r) => s + r.biaya_usd, 0).toFixed(6)),
    runs: ringkasan,
  });
  const hasilLoop = await jalankanDaftarRun(konteks, nomor, { ringkasan, runsGagal, tulisSummary });
  if (hasilLoop.galat) galat = hasilLoop.galat;
  tulisSummary();
  const lokasiHasil = `${path.relative(ROOT, folder).split(path.sep).join('/')}/`;
  // "Selesai" hanya untuk run yang benar-benar selesai; run yang berhenti tidak boleh berakhir dengan kalimat itu.
  console.log(hasilLoop.gagalDeteksi ? `Dihentikan, hasil sebagian di ${lokasiHasil}` : `Selesai. Hasil di ${lokasiHasil}`);
  if (galat || hasilLoop.gagalDeteksi) process.exitCode = 1;
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { RunGagal, jalankanSatuRun, jalankanDaftarRun, berkasGagalBerikutnya, main, periksaObjek, periksaBranchKondisi, ambilSonar, siapkanSonar, runKering, perluSonar, treeSrc, percobaanGagal, biayaPercobaanGagal, tandaDeteksi };
