#!/usr/bin/env node
// Penilaian lengan dua perkakas SAST, skenario B dan C.
//
// MENGAPA SKRIP TERSENDIRI, bukan menambah jalur di scripts/llm-score.js:
// llm-score.js:148 menolak setiap folder yang `versi_prompt`-nya bukan 'v2', dan berkas itu terbeku
// (AGENTS.md batas keras nomor 5). Batch dua perkakas memakai prompt v3, jadi penilaiannya memang
// tidak bisa melewati skrip itu. Preseden yang diikuti sama dengan scripts/sast/skor-dua-sast.js dan
// scripts/skor-gabungan.js: seluruh ATURAN penilaian dipanggil dari scripts/llm/score.js dan
// scripts/gemini-scan.js apa adanya, keduanya tidak diubah, sehingga angka dua perkakas tidak bisa
// menyimpang diam-diam dari angka satu perkakas.
//
// PEMETAAN K6 TIDAK BERLAKU DI SINI, dan itu bukan kelalaian. Medan `tipe` hanya dipakai
// scripts/llm/score.js:232 dan :235, keduanya di dalam skenarioA. skorRunUtama tidak pernah
// menyaring `tipe`, jadi skenario B dan C tidak terpengaruh sama sekali oleh ketiadaan medan itu pada
// alert CodeQL. Angka skenario A di keluaran ini tetap memakai pemetaannya, dipanggil dari
// skor-dua-sast.js supaya definisinya cuma ada di satu tempat.
//
// Tidak memanggil API apa pun dan tidak menulis apa pun di luar --out.
//
// Pemakaian:
//   node scripts/sast/skor-b-dua-sast.js <folder run...> --objek=<worktree objek uji> \
//     --sonar-beku=<file> --codeql-beku=<file> --out=<file> \
//     [--label-alert=<file>] [--triase-konservatif]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ambilArg = (nama) => {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.slice(nama.length + 3) : null;
};
const wajib = (nama) => {
  const v = ambilArg(nama);
  if (!v) throw new Error(`--${nama} wajib`);
  return v;
};
const bacaJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Satu folder keluaran llm-scan. Bentuknya sama dengan yang dibaca llm-score.js:125-137; disalin
// bentuknya, bukan fungsinya, karena fungsi itu tidak diekspor dan berkasnya terbeku.
const bacaFolder = (folder) => {
  const summary = bacaJson(path.join(folder, 'summary.json'));
  const runs = fs.readdirSync(folder).filter((f) => /^run-\d+\.json$/.test(f))
    .map((f) => bacaJson(path.join(folder, f))).sort((a, b) => a.run - b.run);
  const fileAlert = path.join(folder, 'sonar-alert.json');
  const fileTriase = path.join(folder, 'triase-manual.json');
  return {
    folder,
    summary,
    runs,
    alert: fs.existsSync(fileAlert) ? bacaJson(fileAlert) : null,
    triase: fs.existsSync(fileTriase) ? bacaJson(fileTriase) : null,
  };
};

// Gerbang kesepadanan folder. Dipisah supaya bisa diuji sendiri tanpa menyiapkan berkas beku.
//
// Yang diperiksa dan sebabnya:
//   versi prompt      daftar versinya milik render, bukan ditulis ulang di sini. Penjaga yang memaku
//                     satu versi sudah dua kali menolak v3 di tempat lain.
//   kombinasi sast    periksaKombinasi adalah penjaga yang sama dengan yang dipakai llm-scan, jadi
//                     folder yang tidak mungkin sah tidak bisa dinilai seolah sah.
//   hash kode sumber  folder yang menilai kode berbeda tidak boleh dirata-ratakan bersama.
//   vendor+kondisi    satu kombinasi hanya boleh sekali, supaya tidak ada folder yang masuk dua kali.
const periksaFolder = (data, { periksaKombinasi, SAST_DIDUKUNG, VERSI_PROMPT_DIDUKUNG }) => {
  for (const d of data) {
    const versi = d.summary.versi_prompt;
    if (!VERSI_PROMPT_DIDUKUNG.includes(versi)) {
      throw new Error(`${d.folder}: versi_prompt "${versi}" tidak dikenal; yang ada: ${VERSI_PROMPT_DIDUKUNG.join(', ')}`);
    }
    const sast = d.summary.sast ?? 'sonar';
    if (!SAST_DIDUKUNG.includes(sast)) {
      throw new Error(`${d.folder}: sast "${sast}" tidak dikenal; yang ada: ${SAST_DIDUKUNG.join(', ')}`);
    }
    // Penjaga yang sama dengan jalur pemindaian: kombinasi yang ditolak di sana tidak boleh lolos di sini.
    periksaKombinasi({ sast, skenario: d.summary.skenario ?? 'B', kondisi: d.summary.kondisi, versiPrompt: versi });
    if (!d.runs.length) throw new Error(`${d.folder}: tidak ada run-N.json`);
    if (!d.alert) throw new Error(`${d.folder}: sonar-alert.json tidak ada, alert tidak bisa dinilai`);
  }
  if (new Set(data.map((d) => d.summary.hash_kode_sumber)).size > 1) {
    throw new Error('Hash kode sumber berbeda antar folder; folder yang menilai kode berbeda tidak boleh digabung');
  }
  const kunci = data.map((d) => `${d.summary.vendor}/${d.summary.kondisi}/${d.summary.sast ?? 'sonar'}`);
  const ganda = kunci.filter((k, i) => kunci.indexOf(k) !== i);
  if (ganda.length) throw new Error(`Lebih dari satu folder untuk ${[...new Set(ganda)].join(', ')}`);
};

// Daftar alert di folder harus sama dengan yang dibangun ulang dari berkas beku: id, lokasi, dan
// perkakas asalnya. Kalau berbeda, berkas beku bukan yang dipakai saat memindai, dan penilaiannya
// akan mengukur himpunan alert yang berbeda dari yang benar-benar dikirim ke model.
const sidikAlert = (alert) => alert
  .map((a) => `${a.id}|${a.sumber_sast ?? 'sonar'}|${a.file ?? ''}:${a.baris ?? 0}`)
  .join('\n');

const periksaAlertFolder = (data, alertAcuan) => {
  const acuan = sidikAlert(alertAcuan);
  for (const d of data) {
    if (sidikAlert(d.alert) !== acuan) {
      throw new Error(`${d.folder}: sonar-alert.json tidak sama dengan alert yang dibangun ulang dari berkas beku. `
        + 'Berkas beku yang diberikan bukan yang dipakai saat memindai; penilaian ditolak.');
    }
  }
};

// Himpunan alert yang SEHARUSNYA dikirim llm-scan untuk satu nilai sumbu sast, dibangun dengan cara
// yang sama persis dengan llm-scan.js: sast=sonar memakai daftar Sonar apa adanya tanpa melewati
// penggabung (jadi alertnya tidak membawa sumber_sast), sisanya lewat gabungAlert.
//
// Dipisah per folder karena SATU penilaian memuat lengan uji (dua perkakas, 23 alert) dan lengan
// kontrol (Sonar saja, 5 alert) bersamaan. Membandingkan semua folder dengan himpunan 23 alert
// menolak lengan kontrol, dan kalau lolos pun 18 alert CodeQL akan dihitung "dipertahankan" pada
// lengan yang tidak pernah menerimanya.
const alertUntuk = (sast, { alertSonar, alertCodeql, gabungAlert, perkakasUntuk }) => {
  const pakai = perkakasUntuk(sast);
  const dariSonar = pakai.includes('sonar') ? alertSonar : [];
  const dariCodeql = pakai.includes('codeql') ? alertCodeql : [];
  return sast === 'sonar' ? dariSonar : gabungAlert({ sonar: dariSonar, codeql: dariCodeql });
};

// Run yang panggilan DETEKSInya gagal habis (status error: koneksi putus atau timeout setelah semua
// percobaan ulang). Itu kegagalan menjangkau vendor, bukan jawaban model: deteksinya kosong karena tidak
// pernah ada jawaban, bukan karena model tidak menemukan apa-apa. Menghitungnya ke rata-rata menurunkan
// recall dan F1 sebuah model karena jaringan, dan angka itu tampak sah. refusal, truncated, dan parse_ok
// false BUKAN penanda ini: itu jawaban model, dan tetap dihitung sebagai panggilan tanpa hasil sesuai
// README prompt bagian 7-8.
const deteksiGagal = (run) => run.deteksi?.status === 'error';

// Memisahkan run yang boleh masuk rata-rata dari yang bertanda, beserta sebabnya.
const pisahkanRunGagal = (runs) => {
  const gagal = runs.filter(deteksiGagal).map((r) => ({ run: r.run, sebab: r.deteksi.detail_status ?? null }));
  const nomorGagal = new Set(gagal.map((g) => g.run));
  return { gagal, nomorGagal };
};

// Rincian per perkakas: dari satu himpunan id, berapa milik Sonar dan berapa milik CodeQL.
// Pertanyaan pokok lengan dua perkakas justru ini, dan ia hilang kalau hanya angka gabungan dilaporkan.
const perPerkakas = (idDaftar, asal) => {
  const out = {};
  for (const id of idDaftar) {
    const k = asal.get(id) ?? 'tidak_dikenal';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

// Kategori verifikasi dipecah per perkakas. Nilainya untuk pembahasan: apakah model lebih sering
// salah membuang alert CodeQL daripada alert Sonar.
const kategoriPerPerkakas = (verifikasi, asal) => Object.fromEntries(
  ['identified_fp', 'missed_fp', 'misidentified_fp', 'correct_retention']
    .map((k) => [k, perPerkakas(verifikasi.kategori?.[k] ?? [], asal)]),
);

const main = () => {
  const folder = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
  if (!folder.length) throw new Error('Sebutkan minimal satu folder hasil llm-scan');

  const objekDir = path.resolve(wajib('objek'));
  const git = (...a) => execFileSync('git', ['-C', objekDir, ...a], { encoding: 'utf8' }).trim();
  const kotor = git('status', '--porcelain');
  if (kotor) throw new Error(`Worktree objek uji tidak bersih:\n${kotor}`);
  const objek = { dir: objekDir, commit: git('rev-parse', 'HEAD'), tree_src: git('rev-parse', 'HEAD:src') };

  process.env.OBJEK_UJI_DIR = objekDir;
  const score = require('../llm/score');
  const gs = require('../gemini-scan');
  const render = require('../llm/render');
  const sumbu = require('./sumbu-sast');
  const bekuSonar = require('../llm/sonar-beku');
  const bekuCodeql = require('./codeql-beku');
  const { petakanK6, PEMETAAN_K6 } = require('./skor-dua-sast');

  const data = folder.map(bacaFolder);
  periksaFolder(data, {
    periksaKombinasi: sumbu.periksaKombinasi,
    SAST_DIDUKUNG: sumbu.SAST_DIDUKUNG,
    VERSI_PROMPT_DIDUKUNG: render.VERSI_PROMPT_DIDUKUNG,
  });
  for (const d of data) {
    const t = d.summary.objek_uji?.tree_src;
    if (t && t !== objek.tree_src) {
      throw new Error(`${d.folder}: tree src/ saat memindai (${t}) berbeda dengan objek uji sekarang (${objek.tree_src}). Penilaian ditolak`);
    }
  }

  // Himpunan alert dibangun ULANG dari berkas beku, bukan dipercaya dari folder run. Berkas beku
  // punya gerbang tree_src sendiri, jadi inilah satu-satunya sumber yang sudah terjamin.
  const s = bekuSonar.bacaBeku(path.resolve(wajib('sonar-beku')), objek);
  const c = bekuCodeql.bacaBeku(path.resolve(wajib('codeql-beku')), objek);
  const templateAlert = render.bacaTemplate().alert.teks;
  const alertSonar = render.pilihAlert(s.ringkasan).map((a) => ({ ...a, teks: render.formatAlert(a, templateAlert) }));
  // Himpunan penuh dua perkakas, hanya untuk rujukan di bagian atas laporan.
  const alert = sumbu.gabungAlert({ sonar: alertSonar, codeql: c.alert });
  const sumberAlert = { alertSonar, alertCodeql: c.alert, gabungAlert: sumbu.gabungAlert, perkakasUntuk: sumbu.perkakasUntuk };
  const alertFolder = new Map(data.map((d) => [d, alertUntuk(d.summary.sast ?? 'sonar', sumberAlert)]));
  for (const d of data) periksaAlertFolder([d], alertFolder.get(d));

  const gt = gs.bacaGroundTruth();
  const fileLabel = ambilArg('label-alert');
  const labelManual = fileLabel ? bacaJson(path.resolve(fileLabel)) : {};
  const label = score.labelAlert(alert, gt, labelManual, {});
  const opsiTriase = { konservatif: process.argv.includes('--triase-konservatif') };

  // Skenario A dihitung dari himpunan penuh untuk rujukan, dan dari himpunan tiap folder untuk
  // penilaian per lengan: lengan kontrol harus mendapat angka Sonar saja, bukan angka dua perkakas.
  const skorA = score.skenarioA(petakanK6(alert), gt);

  const peringatan = [];
  const perModel = data.map((d) => {
    const alertD = alertFolder.get(d);
    const asal = new Map(alertD.map((a) => [a.id, a.sumber_sast ?? 'sonar']));
    const labelD = score.labelAlert(alertD, gt, labelManual, {});
    const skorAD = score.skenarioA(petakanK6(alertD), gt);
    const skorRun = d.runs.map((run) => score.skorRunUtama({ run, alert: alertD, gt, label: labelD, triase: d.triase, opsiTriase }));
    const { gagal, nomorGagal } = pisahkanRunGagal(d.runs);
    const skorSah = skorRun.filter((x) => !nomorGagal.has(x.run));
    if (gagal.length) {
      peringatan.push(`PERINGATAN ${d.summary.vendor} sast ${d.summary.sast ?? 'sonar'}: run ${gagal.map((g) => g.run).join(', ')} `
        + `berstatus deteksi error (${gagal.map((g) => g.sebab ?? 'tanpa keterangan').join(' | ')}). `
        + `Run itu DIKECUALIKAN dari rata-rata B dan C (${skorSah.length} dari ${skorRun.length} run dipakai); `
        + 'angkanya tetap tertulis di runs dengan deteksi_gagal true, dan bukan hasil.');
    }
    score.validasiTriase(d.triase, d.runs, Object.fromEntries(skorRun.map((x) => [x.run, x.penilaian_c])));
    const dipertahankan = skorRun.map((x) => x.sonar_setelah_verifikasi.alert);
    return {
      vendor: d.summary.vendor,
      model: d.summary.model_diminta,
      sast: d.summary.sast ?? 'sonar',
      versi_prompt: d.summary.versi_prompt,
      status_panggilan: score.hitungStatusPanggilan(d.runs),
      rata_rata: {
        skenario_a: score.rataMetrik([skorAD.b_filter_v2]),
        skenario_b: score.rataMetrik(skorSah.map((x) => x.skenario_b)),
        skenario_c: score.rataMetrik(skorSah.map((x) => x.skenario_c)),
      },
      // Hanya ada kalau ada run bertanda: rata-rata kalau run itu ikut dihitung, supaya selisihnya
      // terlihat dan keputusan mengecualikannya bukan keputusan diam-diam.
      ...(gagal.length ? {
        rata_rata_termasuk_run_gagal: {
          skenario_b: score.rataMetrik(skorRun.map((x) => x.skenario_b)),
          skenario_c: score.rataMetrik(skorRun.map((x) => x.skenario_c)),
        },
      } : {}),
      jumlah_run_total: skorRun.length,
      run_dikecualikan: gagal,
      // Yang hanya ada di lengan dua perkakas: asal alert yang dipertahankan dan kategori verifikasi,
      // dipecah per perkakas. Tanpa ini, lengan dua perkakas hanya menghasilkan satu angka gabungan
      // dan pertanyaan "perkakas mana yang alertnya lebih sering salah dibuang" tidak terjawab.
      per_perkakas: {
        jumlah_alert: perPerkakas(alertD.map((a) => a.id), asal),
        dipertahankan_per_run: dipertahankan.map((ids, i) => ({ run: skorRun[i].run, ...perPerkakas(ids, asal) })),
        kategori_verifikasi_per_run: skorRun.map((x) => ({ run: x.run, ...kategoriPerPerkakas(x.verifikasi, asal) })),
      },
      runs: skorRun.map(({ penilaian_c: _, ...x }) => ({ ...x, deteksi_gagal: nomorGagal.has(x.run) })),
      jumlah_alert: alertD.length,
      label_alert: labelD,
      tabel_per_item: score.tabelPerItem({ gt, skorA: skorAD, skorRun: skorSah }),
    };
  });

  const laporan = {
    dinilai_pada: new Date().toISOString(),
    catatan: 'Skenario B dan C lengan dua perkakas SAST. Aturan penilaian dipanggil dari scripts/llm/score.js '
      + 'dan scripts/gemini-scan.js apa adanya; keduanya tidak diubah.',
    aturan_hardening: score.ATURAN_HARDENING,
    // Dicatat supaya pembaca keluaran tidak mengira K6 lupa diterapkan pada B dan C.
    pemetaan_k6: { ...PEMETAAN_K6, berlaku_di_berkas_ini: 'skenario A saja; skorRunUtama tidak pernah menyaring medan tipe' },
    objek_uji: { commit: objek.commit, tree_src: objek.tree_src },
    sonar_beku: { sha256_isi: s.info.sha256_isi, revisi: s.info.revisi },
    codeql_beku: { nama: c.info.nama, sha256_isi: c.info.sha256_isi, jumlah_alert: c.info.jumlah_alert },
    ground_truth: { jumlah_positif: gt.filter((g) => g.status === 'terbukti').length, jumlah_item: gt.length },
    // Himpunan penuh dua perkakas, untuk rujukan. Tiap lengan dinilai terhadap himpunannya sendiri;
    // lihat jumlah_alert dan label_alert di dalam per_model.
    jumlah_alert: alert.length,
    jumlah_alert_per_perkakas: perPerkakas(alert.map((a) => a.id), new Map(alert.map((a) => [a.id, a.sumber_sast]))),
    label_alert: label,
    triase_varian: opsiTriase.konservatif ? 'konservatif' : 'utama',
    peringatan,
    folder: data.map((d) => ({
      folder: path.relative(process.cwd(), d.folder).split(path.sep).join('/'),
      vendor: d.summary.vendor, kondisi: d.summary.kondisi, sast: d.summary.sast ?? 'sonar',
      versi_prompt: d.summary.versi_prompt, jumlah_run: d.runs.length,
    })),
    skenario_a: skorA,
    per_model: perModel,
  };

  const keluar = path.resolve(wajib('out'));
  fs.writeFileSync(keluar, `${JSON.stringify(laporan, null, 2)}\n`);
  const n3 = (x) => (typeof x === 'number' ? x.toFixed(3) : '-');
  // Ke stderr dan sebelum angka: peringatan yang tercetak sesudah angka mudah terlewat.
  for (const p of peringatan) console.warn(p);
  for (const m of perModel) {
    const r = m.rata_rata;
    const tanda = m.run_dikecualikan.length
      ? ` [${m.run_dikecualikan.length} dari ${m.jumlah_run_total} run dikecualikan: deteksi error${r.skenario_b.jumlah_run === 0 ? '; TIDAK ADA run sah' : ''}]`
      : '';
    console.log(`${m.vendor} (${m.model}) sast ${m.sast}${tanda}: `
      + `A P ${n3(r.skenario_a.precision)} R ${n3(r.skenario_a.recall)} F1 ${n3(r.skenario_a.f1)} | `
      + `B P ${n3(r.skenario_b.precision)} R ${n3(r.skenario_b.recall)} F1 ${n3(r.skenario_b.f1)} | `
      + `C P ${n3(r.skenario_c.precision)} R ${n3(r.skenario_c.recall)} F1 ${n3(r.skenario_c.f1)}`);
  }
  console.log(`Laporan: ${path.basename(keluar)}`);
};

module.exports = {
  bacaFolder, periksaFolder, sidikAlert, periksaAlertFolder, alertUntuk, perPerkakas, kategoriPerPerkakas, deteksiGagal, pisahkanRunGagal,
};

if (require.main === module) main();
