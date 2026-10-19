// Scoring prompt v2. Aturan pencocokan deteksi memakai fungsi v1 di scripts/gemini-scan.js (file, fungsi atau
// lokasi, keluarga CWE). OBJEK_UJI_DIR harus sudah diset sebelum modul ini dipakai, karena pencocokan membaca
// SEEDED.md dan src dari worktree objek uji.
//
// Skenario (per model, per run):
//   A = SonarCloud saja: (a) hanya tipe VULNERABILITY, (b) filter alert v2. Perbandingan utama memakai (b).
//   B = (alert Sonar yang tidak diputus false_positive) ∪ (temuan deteksi LLM). Alert tanpa putusan sah
//       (refusal, truncated, parse gagal, enum tidak valid) tetap dipertahankan dan jumlahnya dilaporkan.
//   C = temuan deteksi LLM kondisi utama
// Verifikasi: empat kategori (Identified FP, Missed FP, Mis-identified FP, Correct Retention), FP sebagai kelas
// positif. Label alert dari ground truth: item terbukti dan item B = nyata, jebakan FP dan N1 = fp. Item laten (S6)
// dikeluarkan dan dilaporkan terpisah.
const gs = () => require('../gemini-scan');

const KATEGORI_TRIASE = ['tp_di_luar_seeded', 'fp', 'teoretis', 'informasional', 'duplikat'];
const STATUS_TRIASE = ['di luar ground truth', 'perlu cek manual'];
const LABEL_ALERT = ['nyata', 'fp', 'laten'];
const STATUS_HARDENING_LUAR = 'hardening di luar ground truth';

const lokasi = (file, baris) => `${file ?? ''}:${baris ?? 0}`;

// Temuan v2 ke bentuk yang dipahami nilaiTemuan v1. Field fungsi ditambahkan ke teks jenis sebagai sinyal lokasi.
const temuanKeV1 = (t) => ({
  file: t.file,
  baris: t.baris,
  cwe: (t.tanda ?? []).includes('cwe_tidak_valid') ? '' : t.cwe,
  jenis: [t.jenis, t.fungsi].filter(Boolean).join(' '),
  penjelasan: t.penjelasan ?? '',
});

// Alert Sonar ke bentuk v1, sama seperti sonarKeFormatTemuan.
const alertKeV1 = (a) => ({
  file: a.file, baris: a.baris, cwe: a.cwe.join(', '), jenis: `${a.sumber} ${a.rule}`, penjelasan: a.pesan ?? '',
});

// Aturan spesifikasi (IMPLEMENTASI-PROMPT-V2.md langkah 7): temuan sifat hardening tidak dihitung FP ketat,
// termasuk yang cocok jebakan atau N1. TP tetap dihitung tanpa memandang sifat (keputusan B2).
const ATURAN_HARDENING = 'spesifikasi';
// Status yang, untuk temuan hardening, dinetralkan supaya tidak masuk fpDiLuar maupun fpN1.
const HARDENING_NETRAL = ['di luar ground truth', 'false positive dikenal'];

// entri: [{ asal: 'llm' | 'sonar', v1, sifat, rujukan }]
const nilaiHimpunan = (entri, gt) => {
  const { nilaiTemuan, hitungMetrik, URUTAN_STATUS, TERDETEKSI_LONGGAR } = gs();
  const penilaian = entri.map((e, i) => {
    const p = nilaiTemuan(e.v1, gt);
    const status = e.sifat === 'hardening' && HARDENING_NETRAL.includes(p.status) ? STATUS_HARDENING_LUAR : p.status;
    return { indeks: i, asal: e.asal, sifat: e.sifat ?? null, rujukan: e.rujukan ?? null, ...p, status };
  });
  const jebakanId = new Set(gt.filter((g) => g.status === 'jebakan fp').map((g) => g.id));
  // statusGt: deteksi oleh semua temuan, untuk pelaporan dan tabel per item.
  // statusGtMetrik: untuk metrik, jebakan dihitung dari temuan non-hardening saja, sehingga jebakan yang hanya
  // terdeteksi sebagai hardening tidak menjadi FP ketat. Item lain (termasuk terbukti untuk TP) tetap dari semua temuan.
  const statusGt = {};
  const statusGtMetrik = {};
  const statusDari = (daftar) => URUTAN_STATUS.find((s) => daftar
    .map((p) => (p.status === 'false positive dikenal' ? 'cocok' : p.status)).includes(s)) ?? 'tidak';
  for (const g of gt) {
    const terkait = penilaian.filter((p) => p.id.includes(g.id));
    statusGt[g.id] = statusDari(terkait);
    statusGtMetrik[g.id] = jebakanId.has(g.id) ? statusDari(terkait.filter((p) => p.sifat !== 'hardening')) : statusGt[g.id];
  }
  const hardeningCocokSeeded = penilaian.filter((p) => p.asal === 'llm' && p.sifat === 'hardening'
    && TERDETEKSI_LONGGAR.includes(p.status) && p.id.some((id) => /^S\d+$/.test(id))).length;
  return {
    penilaian,
    status_gt: statusGt,
    aturan_hardening: ATURAN_HARDENING,
    metrik: hitungMetrik(gt, statusGtMetrik, penilaian),
    hardening_di_luar_ground_truth: penilaian.filter((p) => p.status === STATUS_HARDENING_LUAR).length,
    hardening_cocok_seeded: hardeningCocokSeeded,
  };
};

// FP setelah triase: di luar ground truth atau perlu cek manual yang ditriase "fp" dihitung FP; di luar ground truth
// yang belum ditriase tetap dihitung FP (konservatif); kategori lain tidak dihitung FP.
// opsi.konservatif: temuan kategori "teoretis" ikut dihitung FP (varian konservatif). Varian utama (default) hanya menghitung
// kategori "fp" dan temuan "di luar ground truth" yang belum ditriase. tp_di_luar_seeded, informasional, duplikat selalu keluar.
const metrikSetelahTriase = (hasil, triase, opsi = {}) => {
  const konservatif = opsi.konservatif === true;
  const m = hasil.metrik;
  const kandidat = hasil.penilaian.filter((p) => p.asal === 'llm' && STATUS_TRIASE.includes(p.status));
  const rincian = Object.fromEntries(KATEGORI_TRIASE.map((k) => [k, 0]));
  let belum = 0;
  let fpLuar = 0;
  for (const p of kandidat) {
    const k = triase?.[p.rujukan]?.kategori;
    if (k) rincian[k] += 1;
    else if (p.status === 'di luar ground truth') belum += 1;
    if (k === 'fp' || (konservatif && k === 'teoretis') || (!k && p.status === 'di luar ground truth')) fpLuar += 1;
  }
  const fpSonarLuar = hasil.penilaian.filter((p) => p.asal === 'sonar' && p.status === 'di luar ground truth').length;
  const fp = m.rincian_fp.n1 + m.rincian_fp.jebakan_terdeteksi + fpLuar + fpSonarLuar;
  const tp = m.ketat.tp;
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = m.ketat.recall;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { varian: konservatif ? 'konservatif' : 'utama', fp, precision, recall, f1, rincian_triase: rincian, belum_ditriase: belum };
};

// ---------- Label ground truth untuk alert ----------

// manual: { "SONAR-01": { label, lokasi } } untuk alert yang tidak bisa dipetakan otomatis (menolak kalau bertentangan
// dengan label otomatis). paksa: { "SONAR-03": { label, lokasi, alasan } } untuk analisis sensitivitas: menimpa label
// otomatis dengan sengaja, dicatat sumber 'paksa' dan alasan. SEEDED.md tidak diubah.
const labelAlert = (alert, gt, manual = {}, paksa = {}) => {
  const { nilaiTemuan } = gs();
  const hasil = {};
  for (const a of alert) {
    const p = nilaiTemuan(alertKeV1(a), gt);
    let otomatis = null;
    if (p.status === 'false positive dikenal') otomatis = 'fp';
    else if (p.status === 'cocok') {
      const label = new Set(p.id.map((id) => {
        const g = gt.find((x) => x.id === id);
        if (g.status === 'terbukti' || g.status === 'bawaan') return 'nyata';
        if (g.status === 'jebakan fp') return 'fp';
        if (g.status === 'laten') return 'laten';
        return null;
      }));
      if (label.size === 1 && !label.has(null)) [otomatis] = label;
    }
    const m = manual[a.id];
    if (m) {
      if (!LABEL_ALERT.includes(m.label)) throw new Error(`Label manual ${a.id} tidak dikenal: ${m.label}`);
      if (m.lokasi !== lokasi(a.file, a.baris)) throw new Error(`Lokasi label manual ${a.id} (${m.lokasi}) tidak sama dengan alert (${lokasi(a.file, a.baris)})`);
      if (otomatis && otomatis !== m.label) throw new Error(`Label manual ${a.id} (${m.label}) bertentangan dengan label otomatis (${otomatis})`);
    }
    const f = paksa[a.id];
    if (f) {
      if (!LABEL_ALERT.includes(f.label)) throw new Error(`Label paksa ${a.id} tidak dikenal: ${f.label}`);
      if (f.lokasi !== lokasi(a.file, a.baris)) throw new Error(`Lokasi label paksa ${a.id} (${f.lokasi}) tidak sama dengan alert (${lokasi(a.file, a.baris)})`);
    }
    hasil[a.id] = {
      label: f?.label ?? otomatis ?? m?.label ?? null,
      sumber: f ? 'paksa' : otomatis ? 'otomatis' : m ? 'manual' : null,
      label_awal: otomatis ?? m?.label ?? null,
      alasan_paksa: f?.alasan ?? null,
      id_gt: p.id,
      status_cocok: p.status,
    };
  }
  return hasil;
};

const PUTUSAN_DIPERTAHANKAN = ['true_positive', 'uncertain'];

const kategoriVerifikasi = (verifikasi, label) => {
  const kategori = { identified_fp: [], missed_fp: [], misidentified_fp: [], correct_retention: [] };
  const laten = [];
  const tanpaHasil = [];
  const belumDilabel = [];
  const uncertain = [];
  for (const v of verifikasi) {
    const l = label[v.id_alert];
    const sah = putusanSah(v);
    if (l?.label === 'laten') {
      laten.push({ id_alert: v.id_alert, putusan: v.putusan, keyakinan: v.keyakinan, status: v.metadata?.status ?? null });
      continue;
    }
    if (!l?.label) { belumDilabel.push(v.id_alert); continue; }
    if (!sah) { tanpaHasil.push({ id_alert: v.id_alert, status: v.metadata?.status ?? null }); continue; }
    if (v.putusan === 'uncertain') uncertain.push(v.id_alert);
    const dipertahankan = PUTUSAN_DIPERTAHANKAN.includes(v.putusan);
    if (l.label === 'fp') kategori[dipertahankan ? 'missed_fp' : 'identified_fp'].push(v.id_alert);
    else kategori[dipertahankan ? 'correct_retention' : 'misidentified_fp'].push(v.id_alert);
  }
  const n = (k) => kategori[k].length;
  const precision = n('identified_fp') + n('misidentified_fp') === 0 ? null : n('identified_fp') / (n('identified_fp') + n('misidentified_fp'));
  const recall = n('identified_fp') + n('missed_fp') === 0 ? null : n('identified_fp') / (n('identified_fp') + n('missed_fp'));
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    kategori, jumlah: Object.fromEntries(Object.keys(kategori).map((k) => [k, n(k)])),
    uncertain_dipertahankan: uncertain, laten, tanpa_hasil: tanpaHasil, belum_dilabel: belumDilabel,
    metrik_fp_positif: { precision, recall, f1 },
  };
};

// ---------- Skenario per run ----------

const entriLlm = (run) => run.temuan.map((t, i) => ({ asal: 'llm', v1: temuanKeV1(t), sifat: t.sifat, rujukan: String(i) }));
const entriSonar = (alert) => alert.map((a) => ({ asal: 'sonar', v1: alertKeV1(a), sifat: null, rujukan: a.id }));

// Putusan sah = panggilan ok, JSON lolos, enum putusan valid. Selain itu dianggap tanpa putusan.
const putusanSah = (v) => Boolean(v && v.putusan && !(v.tanda ?? []).includes('nilai_tidak_valid')
  && v.metadata?.status === 'ok' && v.metadata?.parse_ok !== false);

// Skenario B mempertahankan setiap alert yang tidak diputus false_positive secara sah, termasuk alert tanpa putusan
// (LLM yang gagal tidak boleh menyembunyikan temuan SAST).
const alertDipertahankan = (run, alert) => {
  const dibuang = new Set(run.verifikasi.filter((v) => putusanSah(v) && v.putusan === 'false_positive').map((v) => v.id_alert));
  return alert.filter((a) => !dibuang.has(a.id));
};

const alertTanpaPutusan = (run, alert) => {
  const sah = new Set(run.verifikasi.filter(putusanSah).map((v) => v.id_alert));
  return alert.filter((a) => !sah.has(a.id)).map((a) => a.id);
};

const ringkasMetrik = (h) => ({ ...h.metrik, hardening_di_luar_ground_truth: h.hardening_di_luar_ground_truth, hardening_cocok_seeded: h.hardening_cocok_seeded });

const skorRunUtama = ({ run, alert, gt, label, triase, opsiTriase = {} }) => {
  const setelah = alertDipertahankan(run, alert);
  const c = nilaiHimpunan(entriLlm(run), gt);
  const sv = nilaiHimpunan(entriSonar(setelah), gt);
  const b = nilaiHimpunan([...entriSonar(setelah), ...entriLlm(run)], gt);
  const triaseRun = triase?.[`run-${run.run}.json`];
  return {
    run: run.run,
    deteksi_parse_ok: run.parse_ok,
    skenario_c: { ...ringkasMetrik(c), setelah_triase: metrikSetelahTriase(c, triaseRun, opsiTriase), status_gt: c.status_gt },
    skenario_b: {
      ...ringkasMetrik(b), setelah_triase: metrikSetelahTriase(b, triaseRun, opsiTriase), status_gt: b.status_gt,
      alert_tanpa_putusan: alertTanpaPutusan(run, alert),
    },
    sonar_setelah_verifikasi: { alert: setelah.map((a) => a.id), ...ringkasMetrik(sv), status_gt: sv.status_gt },
    verifikasi: kategoriVerifikasi(run.verifikasi, label),
    penilaian_c: c.penilaian,
  };
};

const skorRunDeteksi = ({ run, gt, triase, opsiTriase = {} }) => {
  const c = nilaiHimpunan(entriLlm(run), gt);
  return {
    run: run.run, deteksi_parse_ok: run.parse_ok,
    deteksi: { ...ringkasMetrik(c), setelah_triase: metrikSetelahTriase(c, triase?.[`run-${run.run}.json`], opsiTriase), status_gt: c.status_gt },
    penilaian: c.penilaian,
  };
};

const skenarioA = (alert, gt) => {
  const a = nilaiHimpunan(entriSonar(alert.filter((x) => x.tipe === 'VULNERABILITY')), gt);
  const b = nilaiHimpunan(entriSonar(alert), gt);
  return {
    a_hanya_vulnerability: { alert: alert.filter((x) => x.tipe === 'VULNERABILITY').map((x) => x.id), ...ringkasMetrik(a), status_gt: a.status_gt },
    b_filter_v2: { alert: alert.map((x) => x.id), ...ringkasMetrik(b), status_gt: b.status_gt },
  };
};

// ---------- Agregasi ----------

const rataRata = (nilai) => {
  const ada = nilai.filter((x) => typeof x === 'number');
  return ada.length ? ada.reduce((s, x) => s + x, 0) / ada.length : null;
};
const rataMetrik = (daftar) => ({
  precision: rataRata(daftar.map((m) => m.ketat.precision)),
  recall: rataRata(daftar.map((m) => m.ketat.recall)),
  f1: rataRata(daftar.map((m) => m.ketat.f1)),
  jumlah_run: daftar.length,
});

const hitungRun = (daftarStatus, id) => {
  const { TERDETEKSI_KETAT, TERDETEKSI_LONGGAR } = gs();
  return {
    ketat: daftarStatus.filter((s) => TERDETEKSI_KETAT.includes(s[id])).length,
    longgar: daftarStatus.filter((s) => TERDETEKSI_LONGGAR.includes(s[id])).length,
    dari: daftarStatus.length,
  };
};

// Kolom per model: Sonar (a), Sonar (b), Sonar setelah verifikasi, Skenario C, Skenario B.
const tabelPerItem = ({ gt, skorA, skorRun }) => gt.map((g) => ({
  id: g.id, kelas: g.kelas, klasifikasi: g.status,
  sonar_a: skorA.a_hanya_vulnerability.status_gt[g.id],
  sonar_b: skorA.b_filter_v2.status_gt[g.id],
  sonar_setelah_verifikasi: hitungRun(skorRun.map((r) => r.sonar_setelah_verifikasi.status_gt), g.id),
  skenario_c: hitungRun(skorRun.map((r) => r.skenario_c.status_gt), g.id),
  skenario_b: hitungRun(skorRun.map((r) => r.skenario_b.status_gt), g.id),
}));

// Analisis eksploratif: temuan dari model mana pun pada indeks run yang sama dihitung terdeteksi.
const gabunganAntarModel = ({ perModel, alert, gt }) => {
  const indeks = perModel.map((m) => new Set(m.runs.map((r) => r.run)));
  const bersama = [...indeks[0]].filter((n) => indeks.every((s) => s.has(n))).sort((a, b) => a - b);
  const hasil = bersama.map((n) => {
    const runs = perModel.map((m) => m.runs.find((r) => r.run === n));
    const llm = runs.flatMap((r) => entriLlm(r));
    const idDipertahankan = new Set(runs.flatMap((r) => alertDipertahankan(r, alert).map((a) => a.id)));
    const sonar = entriSonar(alert.filter((a) => idDipertahankan.has(a.id)));
    return {
      run: n,
      skenario_c: ringkasMetrik(nilaiHimpunan(llm, gt)),
      skenario_b: ringkasMetrik(nilaiHimpunan([...sonar, ...llm], gt)),
    };
  });
  return {
    catatan: 'Eksploratif, terpisah dari hasil utama. Gabungan per indeks run yang ada di semua model.',
    model: perModel.map((m) => m.vendor),
    runs: hasil,
    rata_rata: { skenario_c: rataMetrik(hasil.map((h) => h.skenario_c)), skenario_b: rataMetrik(hasil.map((h) => h.skenario_b)) },
  };
};

const hitungStatusPanggilan = (runs) => {
  const semua = runs.flatMap((r) => [r.deteksi, ...(r.verifikasi ?? []).map((v) => v.metadata)]);
  const per = (tugas) => {
    const m = semua.filter((x) => x.tugas === tugas);
    return {
      total: m.length,
      refusal: m.filter((x) => x.status === 'refusal').length,
      truncated: m.filter((x) => x.status === 'truncated').length,
      error: m.filter((x) => x.status === 'error').length,
      parse_ok_false: m.filter((x) => x.status === 'ok' && !x.parse_ok).length,
    };
  };
  return { deteksi: per('deteksi'), verifikasi: per('verifikasi') };
};

// Validasi triase-manual.json terhadap run-N.json: indeks ada, lokasi file:baris sama, kategori dikenal,
// dan temuan berstatus di luar ground truth atau perlu cek manual.
// penilaianPerRun: { <nomor run>: penilaian deteksi LLM (hasil nilaiHimpunan) }
const validasiTriase = (triase, runs, penilaianPerRun) => {
  for (const [namaFile, entri] of Object.entries(triase ?? {})) {
    const run = runs.find((r) => `run-${r.run}.json` === namaFile);
    if (!run) throw new Error(`triase-manual.json: ${namaFile} tidak ada di folder`);
    const penilaian = penilaianPerRun[run.run];
    for (const [idx, isi] of Object.entries(entri)) {
      const t = run.temuan[Number(idx)];
      if (!t) throw new Error(`triase-manual.json: ${namaFile} indeks ${idx} tidak ada`);
      if (isi.lokasi !== lokasi(t.file, t.baris)) throw new Error(`triase-manual.json: ${namaFile} indeks ${idx} lokasi ${isi.lokasi} tidak sama dengan ${lokasi(t.file, t.baris)}`);
      if (!KATEGORI_TRIASE.includes(isi.kategori)) throw new Error(`triase-manual.json: kategori tidak dikenal ${isi.kategori}`);
      const p = penilaian.find((x) => x.rujukan === idx && x.asal === 'llm');
      if (!STATUS_TRIASE.includes(p.status)) throw new Error(`triase-manual.json: ${namaFile} indeks ${idx} berstatus ${p.status}, bukan kandidat triase`);
    }
  }
};

module.exports = {
  ATURAN_HARDENING, KATEGORI_TRIASE, LABEL_ALERT, temuanKeV1, alertKeV1, nilaiHimpunan, metrikSetelahTriase, labelAlert,
  kategoriVerifikasi, skorRunUtama, skorRunDeteksi, skenarioA, tabelPerItem, gabunganAntarModel,
  hitungStatusPanggilan, validasiTriase, rataMetrik, lokasi,
};
