// Pemetaan keluaran jalur v2 (llm-scan.js dan llm-score.js) ke results.json skema 2
// (docs/design/results-v2.schema.json), untuk dibaca Security Dashboard.
//
// Dua prinsip yang dipegang di sini:
//  1. Status alert berasal dari putusan verifikasi model, bukan dari pencocokan lokasi dan CWE seperti v1.
//     Putusan yang tidak sah (panggilan gagal, JSON gagal diparse, enum tidak valid) menjadi null, bukan ditebak.
//  2. Angka blok eksperimen disalin apa adanya dari berkas skor. Satu-satunya angka yang dihitung di sini
//     adalah rata_rata varian triase, memakai aturan rata-rata yang sama dengan scripts/llm/score.js
//     (abaikan nilai non-numerik, null bila tidak ada nilai sama sekali).
const crypto = require('crypto');

const SCHEMA_VERSION = 2;
const PUTUSAN = ['true_positive', 'false_positive', 'uncertain'];

const nomorDua = (n) => String(n).padStart(2, '0');

// Sidik jari temuan: file:baris|cwe terurut|jenis. Sejajar dengan sidikJari v1, dengan jenis menggantikan judul.
const sidikJariTemuan = (t, cwe) => crypto.createHash('sha256')
  .update(`${t.file ?? ''}:${t.baris ?? ''}|${[...cwe].sort().join(',')}|${String(t.jenis ?? '').toLowerCase()}`)
  .digest('hex').slice(0, 16);

// Putusan sah mengikuti definisi scripts/llm/score.js: panggilan ok, JSON lolos, enum putusan valid.
const putusanSah = (v) => Boolean(v && v.putusan && PUTUSAN.includes(v.putusan)
  && !(v.tanda ?? []).includes('nilai_tidak_valid')
  && v.metadata?.status === 'ok' && v.metadata?.parse_ok !== false);

const petakanTemuan = (temuan, parseCwe, potongan = null) => temuan.map((t, i) => {
  const cwe = parseCwe(t.cwe);
  return {
    id: `T-${nomorDua(i + 1)}`,
    file: t.file ?? null,
    baris: typeof t.baris === 'number' ? t.baris : null,
    fungsi: t.fungsi ?? null,
    jenis: String(t.jenis ?? ''),
    cwe,
    kategori_owasp: t.kategori_owasp ?? null,
    penjelasan: t.penjelasan ?? null,
    sifat: t.sifat === 'hardening' ? 'hardening' : 'vulnerability',
    keyakinan: ['high', 'medium', 'low'].includes(t.keyakinan) ? t.keyakinan : 'low',
    fingerprint: sidikJariTemuan(t, cwe),
    tanda: [...(t.tanda ?? [])],
    ...(potongan ? { potongan_kode: potongan(t.file, t.baris) } : {}),
  };
});

// skenario dibutuhkan untuk membedakan dua ketiadaan putusan yang artinya berlawanan: di skenario A
// verifikasi memang tidak pernah dijalankan, sedangkan putusan_asal null berarti verifikasi berjalan
// tetapi jawabannya tidak sah. Dashboard menampilkan keduanya dengan kalimat yang berbeda.
const petakanAlert = (alert, verifikasi, skenario = null) => {
  const perId = new Map((verifikasi ?? []).map((v) => [v.id_alert, v]));
  return (alert ?? []).map((a) => {
    const v = perId.get(a.id);
    const sah = putusanSah(v);
    return {
      id: a.id,
      rule: a.rule ?? null,
      tipe: a.tipe ?? null,
      sumber: a.sumber,
      file: a.file ?? null,
      baris: typeof a.baris === 'number' ? a.baris : null,
      cwe: [...(a.cwe ?? [])],
      pesan: a.pesan ?? null,
      severity_sonar: a.severity ?? null,
      severity_asal: 'sonar',
      putusan: sah ? v.putusan : null,
      putusan_asal: skenario === 'A' ? 'tanpa-verifikasi' : (sah ? 'verifikasi-model' : null),
      keyakinan: sah && ['high', 'medium', 'low'].includes(v.keyakinan) ? v.keyakinan : null,
      alasan: sah ? (v.alasan ?? null) : null,
      tanda: [...(v?.tanda ?? [])],
    };
  });
};

const detik = (mulai, selesai) => {
  if (!mulai || !selesai) return null;
  const d = (new Date(selesai) - new Date(mulai)) / 1000;
  return Number.isFinite(d) ? Math.round(d) : null;
};

// id dipisahkan dari nomor: di CI keduanya berbeda (id = run id GitHub, nomor = run number), dan
// dashboard memakai id untuk mengambil status job. Dari CLI id tidak ada, jadi ikut nomor.
const susunRun = ({ summary, run, nomor, id = null, repo = null, pipeline = null }) => {
  const d = run.deteksi ?? {};
  // Entri deteksi hanya dihitung kalau memang ADA. Skenario A tidak memanggil model sama sekali,
  // dan objek kosong yang ikut terhitung membuatnya melaporkan "1 panggilan, 0 ok" — terbaca
  // sebagai panggilan yang gagal, padahal tidak pernah ada panggilan.
  const panggilan = [...(run.deteksi ? [d] : []), ...(run.verifikasi ?? []).map((v) => v.metadata ?? {})];
  const hitung = (f) => panggilan.filter(f).length;
  const biaya = panggilan.reduce((s, p) => s + (typeof p.biaya_usd === 'number' ? p.biaya_usd : 0), 0);
  return {
    id: id ?? nomor,
    nomor,
    repo,
    // Hanya workflow yang meneruskan --id (run id GitHub), jadi keberadaannya adalah penanda asal
    // yang paling jujur. Tanpa ini dashboard tidak punya cara membedakan run CI dari run CLI,
    // dan run CI yang pipeline-nya belum tercatat akan dikira dijalankan dari CLI.
    asal: id ? 'workflow' : 'cli',
    vendor: summary.vendor,
    model_diminta: run.model_diminta ?? summary.model_diminta,
    model_menjawab: d.model_menjawab ?? null,
    kondisi: run.kondisi ?? summary.kondisi,
    // Skenario analisis, sumbu terpisah dari kondisi eksperimen. Run lama tidak memuatnya; yang
    // tidak menyebutkan apa pun adalah skenario B satu vendor, karena itulah satu-satunya bentuk
    // yang pernah dijalankan sebelum sumbu ini ada.
    skenario: run.skenario ?? summary.skenario ?? 'B',
    mode_model: run.mode_model ?? summary.mode_model ?? 'tunggal',
    // Waktu run diturunkan dari panggilannya, karena itulah yang benar-benar memakan waktu.
    // Skenario A tidak punya satu pun panggilan tetapi tetap punya awal dan akhir: ia mengambil
    // laporan Sonar. Tanpa cadangan ke run.mulai, runnya tercatat tanpa waktu sama sekali, dan di
    // riwayat ia jatuh ke bawah seolah urutannya tidak diketahui.
    mulai: d.waktu_mulai ?? run.mulai ?? null,
    selesai: (panggilan.length ? (panggilan[panggilan.length - 1].waktu_selesai ?? null) : null) ?? run.selesai ?? null,
    durasi_detik: detik(d.waktu_mulai ?? run.mulai, (panggilan.length ? panggilan[panggilan.length - 1].waktu_selesai : null) ?? run.selesai),
    objek_uji: {
      commit: run.commit_objek_uji ?? summary.objek_uji.commit,
      branch: run.branch_objek_uji ?? summary.objek_uji.branch ?? null,
      tree_src: run.tree_src_objek_uji ?? summary.objek_uji.tree_src,
    },
    commit_kode: { head: run.commit_kode?.head ?? null, bersih: run.commit_kode?.bersih ?? null },
    hash_prompt: { system: d.hash?.prompt_system_kanonik ?? null, user_deteksi: d.hash?.prompt_user_kanonik ?? null },
    sumber_sonar: run.sumber_sonar ?? summary.sumber_sonar,
    analisis_sonar: {
      tanggal: run.analisis_sonar ?? summary.analisis_sonar ?? null,
      revisi: run.revisi_analisis_sonar ?? summary.revisi_analisis_sonar ?? null,
      tree_src: summary.tree_src_analisis_sonar ?? null,
    },
    sonar_beku: run.sonar_beku ? { sha256_isi: run.sonar_beku.sha256_isi ?? null, revisi: run.sonar_beku.revisi ?? null } : null,
    biaya_usd: Number(biaya.toFixed(6)),
    // Token thinking diambil apa adanya dari metadata panggilan; tidak ada panggilan tambahan dan
    // tidak ada parameter yang berubah. Angka inilah yang membedakan jawaban kosong karena model
    // nyaris tidak berpikir dari analisis sungguhan yang kebetulan bersih: di repo demo, deteksi
    // yang menjawab nol temuan memakai 258 dan 2.372 token thinking, sedangkan yang menemukan tujuh
    // temuan pada kode yang sama memakai 23.305.
    //
    // null, bukan 0, ketika tidak ada panggilan sama sekali: skenario A tidak memanggil model, dan
    // 0 di situ terbaca seolah model dipanggil lalu tidak berpikir.
    thinking_token: {
      deteksi: run.deteksi ? (d.usage?.thinking ?? null) : null,
      total: panggilan.length ? panggilan.reduce((s, p) => s + (p.usage?.thinking ?? 0), 0) : null,
    },
    status_panggilan: {
      total: panggilan.length,
      ok: hitung((p) => p.status === 'ok'),
      refusal: hitung((p) => p.status === 'refusal'),
      truncated: hitung((p) => p.status === 'truncated'),
      error: hitung((p) => p.status === 'error'),
      parse_gagal: hitung((p) => p.parse_ok === false),
      // Panggilan deteksi yang lolos skema tetapi nol temuan. Dihitung terpisah supaya "0 temuan"
      // hasil analisis tidak tertukar dengan "0 temuan" karena model menjawab kosong.
      deteksi_kosong: hitung((p) => (p.tanda ?? []).includes('deteksi_kosong')),
    },
    pipeline,
  };
};

// ---------- Blok eksperimen ----------

const rataRata = (nilai) => {
  const ada = nilai.filter((x) => typeof x === 'number');
  return ada.length ? ada.reduce((s, x) => s + x, 0) / ada.length : null;
};
const pr = (daftar, ambil) => ({
  precision: rataRata(daftar.map((x) => ambil(x)?.precision)),
  recall: rataRata(daftar.map((x) => ambil(x)?.recall)),
  f1: rataRata(daftar.map((x) => ambil(x)?.f1)),
});
const salinMetrik = (m) => (m ? { tp: m.tp, fp: m.fp, fn: m.fn, precision: m.precision, recall: m.recall, f1: m.f1 } : undefined);
const salinTriase = (t) => (t ? {
  varian: t.varian, fp: t.fp, precision: t.precision, recall: t.recall, f1: t.f1,
  rincian_triase: { ...t.rincian_triase }, belum_ditriase: t.belum_ditriase,
} : undefined);

// Mencari run berindeks sama di laporan skor varian triase.
const runVarian = (laporan, vendor, nomorRun) => {
  const m = laporan?.utama?.per_model?.find((x) => x.vendor === vendor);
  return m?.runs?.find((r) => r.run === nomorRun);
};

// biayaVendor: { "<vendor>": { total_usd, per_run: { "<n>": usd } } } dari summary.json tiap folder vendor.
// Berkas skor tidak memuat biaya, jadi angka ini harus datang dari keluaran llm-scan.
const susunEksperimen = ({ utama, triaseUtama, triaseKonservatif, sensitivitas, sumber, biayaVendor = {} }) => {
  if (!utama?.utama?.per_model) return null;
  const perModel = utama.utama.per_model.map((m) => {
    const runs = m.runs.map((r) => {
      const ru = runVarian(triaseUtama, m.vendor, r.run);
      const rk = runVarian(triaseKonservatif, m.vendor, r.run);
      const varian = (kunci) => {
        const v = { ketat: salinMetrik(r[kunci]?.ketat) };
        const tu = salinTriase(ru?.[kunci]?.setelah_triase);
        const tk = salinTriase(rk?.[kunci]?.setelah_triase);
        if (tu) v.triase_utama = tu;
        if (tk) v.triase_konservatif = tk;
        return v;
      };
      const entri = { run: r.run, skenario_b: varian('skenario_b'), skenario_c: varian('skenario_c') };
      const biaya = biayaVendor[m.vendor]?.per_run?.[String(r.run)];
      if (typeof biaya === 'number') entri.biaya_usd = biaya;
      if (r.verifikasi) {
        entri.verifikasi = {
          jumlah: { ...r.verifikasi.jumlah },
          metrik_fp_positif: { ...r.verifikasi.metrik_fp_positif },
          uncertain_dipertahankan: [...(r.verifikasi.uncertain_dipertahankan ?? [])],
          tanpa_hasil: (r.verifikasi.tanpa_hasil ?? []).map((t) => t.id_alert ?? String(t)),
        };
        const rv = runVarian(sensitivitas, m.vendor, r.run);
        if (rv?.verifikasi) {
          entri.verifikasi.sensitivitas = {
            jumlah: { ...rv.verifikasi.jumlah },
            metrik_fp_positif: { ...rv.verifikasi.metrik_fp_positif },
          };
        }
      }
      return entri;
    });
    const rataVarian = (kunci) => {
      const out = { ketat: { precision: m.rata_rata[kunci].precision, recall: m.rata_rata[kunci].recall, f1: m.rata_rata[kunci].f1 } };
      if (runs.some((r) => r[kunci].triase_utama)) out.triase_utama = pr(runs, (r) => r[kunci].triase_utama);
      if (runs.some((r) => r[kunci].triase_konservatif)) out.triase_konservatif = pr(runs, (r) => r[kunci].triase_konservatif);
      return out;
    };
    return {
      vendor: m.vendor,
      model: m.model,
      jumlah_run: m.runs.length,
      ...(typeof biayaVendor[m.vendor]?.total_usd === 'number' ? { biaya_total_usd: biayaVendor[m.vendor].total_usd } : {}),
      skenario_a: salinMetrik(utama.utama.skenario_a?.b_filter_v2?.ketat),
      status_panggilan: m.status_panggilan,
      runs,
      rata_rata: { skenario_b: rataVarian('skenario_b'), skenario_c: rataVarian('skenario_c') },
    };
  });

  // Tabel per item: digabung antar model supaya satu baris per item ground truth.
  const idItem = [];
  for (const m of utama.utama.per_model) for (const t of m.tabel_per_item ?? []) if (!idItem.includes(t.id)) idItem.push(t.id);
  const tabel = idItem.map((id) => {
    const contoh = utama.utama.per_model[0].tabel_per_item.find((t) => t.id === id) ?? {};
    const baris = { id, kelas: contoh.kelas ?? null, klasifikasi: contoh.klasifikasi ?? null, sonar_a: contoh.sonar_a ?? null, sonar_b: contoh.sonar_b ?? null, per_model: {} };
    for (const m of utama.utama.per_model) {
      const t = (m.tabel_per_item ?? []).find((x) => x.id === id);
      if (t) baris.per_model[m.vendor] = { skenario_b: t.skenario_b ?? null, skenario_c: t.skenario_c ?? null };
    }
    return baris;
  });

  const ambilLabel = (lap) => {
    if (!lap?.utama?.label_alert) return null;
    const out = {};
    for (const [id, l] of Object.entries(lap.utama.label_alert)) out[id] = { label: l.label ?? null, sumber: l.sumber ?? null };
    return out;
  };
  const label = ambilLabel(utama) ?? {};

  return {
    sumber: {
      skor_utama: sumber.skor_utama,
      skor_triase_utama: sumber.skor_triase_utama ?? null,
      skor_triase_konservatif: sumber.skor_triase_konservatif ?? null,
      skor_sensitivitas: sumber.skor_sensitivitas ?? null,
      commit_kode_scoring: utama.commit_kode_scoring?.head ?? null,
      aturan_hardening: utama.aturan_hardening ?? null,
      objek_uji_commit: utama.objek_uji?.commit ?? null,
    },
    sensitivitas: Boolean(utama.sensitivitas),
    label_alert: label,
    label_alert_sensitivitas: ambilLabel(sensitivitas),
    per_model: perModel,
    tabel_per_item: tabel,
  };
};

const susunHasilV2 = ({ summary, run, nomor, id = null, alert, parseCwe, repo = null, pipeline = null, eksperimen = null, potongan = null }) => ({
  schema_version: SCHEMA_VERSION,
  run: susunRun({ summary, run, nomor, id, repo, pipeline }),
  // Skenario C tidak memakai SonarCloud sama sekali: alertnya tidak pernah dikirim ke model dan
  // tidak punya putusan, jadi menampilkannya tanpa putusan akan menyesatkan. Himpunannya kosong.
  alerts: (run.skenario ?? summary.skenario) === 'C'
    ? []
    : petakanAlert(alert, run.verifikasi, run.skenario ?? summary.skenario ?? null),
  findings: petakanTemuan(run.temuan ?? [], parseCwe, potongan),
  ...(eksperimen ? { eksperimen } : {}),
});

// Entri daftar run untuk index.json, sejajar entriIndex v1 tetapi dengan kosakata v2.
const entriIndexV2 = (hasil, relPath) => {
  const hitung = (p) => hasil.alerts.filter(p).length;
  return {
    id: hasil.run.id,
    nomor: hasil.run.nomor,
    branch: hasil.run.objek_uji.branch,
    commit: hasil.run.objek_uji.commit,
    vendor: hasil.run.vendor,
    model_diminta: hasil.run.model_diminta,
    model_menjawab: hasil.run.model_menjawab,
    kondisi: hasil.run.kondisi,
    mulai: hasil.run.mulai,
    selesai: hasil.run.selesai,
    durasi_detik: hasil.run.durasi_detik,
    biaya_usd: hasil.run.biaya_usd,
    path: relPath,
    status: hasil.run.status_panggilan.error > 0 ? 'gagal' : 'ok',
    jumlah: {
      alert: hasil.alerts.length,
      temuan: hasil.findings.length,
      true_positive: hitung((a) => a.putusan === 'true_positive'),
      false_positive: hitung((a) => a.putusan === 'false_positive'),
      uncertain: hitung((a) => a.putusan === 'uncertain'),
      // Mode gabungan mengosongkan putusan saat tidak ada suara terbanyak, dan menandainya di
      // putusan_gabungan. Menghitungnya sebagai "tanpa putusan" menyamakan dua sebab yang berbeda:
      // panggilan yang gagal, dan tiga model yang menjawab tetapi tidak sepakat. Yang kedua justru
      // hasil yang sah. Field ini 0 di run satu model, yang tidak pernah punya putusan_gabungan.
      tidak_sepakat: hitung((a) => a.putusan_gabungan === 'tidak_sepakat'),
      tanpa_putusan: hitung((a) => a.putusan === null && a.putusan_gabungan !== 'tidak_sepakat'),
    },
  };
};

module.exports = {
  SCHEMA_VERSION, sidikJariTemuan, putusanSah, petakanTemuan, petakanAlert, susunRun, susunEksperimen,
  susunHasilV2, rataRata, entriIndexV2,
};
