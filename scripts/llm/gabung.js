// Penggabung mode B gabungan: tiga hasil vendor dari run yang sama disatukan menjadi satu hasil.
//
// Masukannya adalah berkas results.json skema 2 yang sudah disusun tiap job vendor. Penggabungan
// sengaja bekerja di tingkat itu, bukan di tingkat keluaran mentah model, supaya tiap vendor tetap
// melewati validasi dan pemetaan yang sama persis dengan mode satu vendor.
//
// Aturan pencocokan temuan antar-vendor memakai bentuk aturan yang sama dengan skrip penilaian:
// file sama, lokasi sama (fungsi, atau baris berdekatan bila fungsi tidak dilaporkan), dan CWE
// sekeluarga. KELUARGA_CWE diimpor dari sumber aslinya; skrip penilaian tidak disentuh.
const { KELUARGA_CWE } = require('../gemini-scan');

const SCHEMA_VERSION = 2;
// Dua vendor yang sepakat sudah cukup: dengan tiga vendor, itu mayoritas sebenarnya.
const SUARA_MINIMUM = 2;
// Dipakai hanya bila kedua temuan tidak melaporkan fungsi. Satu jendela kecil, bukan toleransi
// longgar: temuan yang berjauhan di file yang sama adalah temuan yang berbeda.
const JENDELA_BARIS = 5;
const PUTUSAN_SAH = ['true_positive', 'false_positive', 'uncertain'];

const angkaCwe = (daftar) => (Array.isArray(daftar) ? daftar : [daftar])
  .flatMap((x) => [...String(x ?? '').matchAll(/CWE[-\s:]*(\d+)/gi)].map((m) => Number(m[1])));

const keluargaDari = (nomor) => Object.entries(KELUARGA_CWE)
  .filter(([, daftar]) => daftar.includes(nomor)).map(([nama]) => nama);

const cweSekeluarga = (a, b) => a.some((x) => b.some((y) => x === y
  || keluargaDari(x).some((k) => keluargaDari(y).includes(k))));

const normalFile = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

// Teks temuan yang dipakai untuk mencari sebutan nama fungsi, bentuk yang sama dengan
// sebutFungsi di skrip penilaian.
const teksTemuan = (t) => `${t.jenis ?? ''} ${t.penjelasan ?? ''}`;
const sebutFungsi = (teks, nama) => new RegExp(`\\b${nama}\\b`).test(teks);

const dekat = (a, b) => {
  const ba = Number(a.baris);
  const bb = Number(b.baris);
  return Number.isFinite(ba) && Number.isFinite(bb) && Math.abs(ba - bb) <= JENDELA_BARIS;
};

// Dua temuan dianggap temuan yang sama bila berada di file yang sama, di lokasi yang sama, dan
// kelas kerentanannya sekeluarga. CWE yang berbeda kelas di baris berdekatan tetap dua temuan:
// menggabungkannya akan menyembunyikan salah satunya.
//
// Aturan lokasinya mengikuti bentuk yang dipakai skrip penilaian. Di sana, ketika nama fungsi
// tidak bisa ditentukan, pencocokan TIDAK langsung gugur melainkan jatuh ke apakah teks temuan
// menyebut nama fungsi itu. Perlakuan yang sama dipakai di sini untuk kasus yang nyata terjadi:
// satu vendor melaporkan fungsi, vendor lain mengosongkannya.
const temuanCocok = (a, b) => {
  if (normalFile(a.file) !== normalFile(b.file)) return false;
  if (!cweSekeluarga(angkaCwe(a.cwe), angkaCwe(b.cwe))) return false;
  if (a.fungsi && b.fungsi) return a.fungsi === b.fungsi;
  // Tepat satu yang melaporkan fungsi: cocok bila yang lain menyebut nama itu di teksnya,
  // atau, kalau tidak, bila barisnya berdekatan.
  if (a.fungsi || b.fungsi) {
    const nama = a.fungsi || b.fungsi;
    const lain = a.fungsi ? b : a;
    return sebutFungsi(teksTemuan(lain), nama) || dekat(a, b);
  }
  // Keduanya tanpa fungsi: hanya kedekatan baris yang tersisa sebagai sinyal lokasi.
  return dekat(a, b);
};

// Suara terbanyak dari putusan yang sah, minimal dua suara sama. Kalau tidak tercapai, alert
// TIDAK dianggap false positive: ia dipertahankan dan ditandai tidak_sepakat, karena ketidak-
// sepakatan model bukan bukti bahwa alertnya tidak nyata.
const suaraTerbanyak = (putusanVendor) => {
  const sah = Object.values(putusanVendor).filter((p) => PUTUSAN_SAH.includes(p));
  const hitung = new Map();
  for (const p of sah) hitung.set(p, (hitung.get(p) ?? 0) + 1);
  let menang = null;
  let maks = 0;
  let seri = false;
  for (const [p, n] of hitung) {
    if (n > maks) { menang = p; maks = n; seri = false; } else if (n === maks) { seri = true; }
  }
  if (maks < SUARA_MINIMUM || seri) return { putusan: 'tidak_sepakat', suara: maks, sah: sah.length };
  return { putusan: menang, suara: maks, sah: sah.length };
};

const vendorDari = (h) => h?.run?.vendor ?? null;

// Hasil vendor yang tidak bisa dipakai: berkasnya tidak ada, bukan skema 2, atau seluruh
// panggilannya gagal sehingga tidak ada yang bisa digabungkan.
const alasanTidakTerpakai = (h) => {
  if (!h || typeof h !== 'object') return 'hasil tidak ada';
  if (h.schema_version !== SCHEMA_VERSION) return `skema ${h.schema_version ?? 'tidak dikenal'}, bukan 2`;
  if (!h.run || !h.run.vendor) return 'hasil tanpa identitas vendor';
  const sp = h.run.status_panggilan ?? null;
  if (sp && sp.total > 0 && sp.ok === 0) return 'seluruh panggilan vendor ini gagal';
  return null;
};

const gabungAlert = (terpakai) => {
  // Daftar alert berasal dari laporan Sonar yang sama, jadi urutannya diambil dari vendor pertama
  // dan sisanya dicocokkan lewat id.
  const dasar = terpakai[0].hasil.alerts ?? [];
  return dasar.map((a) => {
    // Hanya vendor yang ikut yang muncul di sini. Vendor yang gagal tidak punya putusan sama
    // sekali dan tercatat di run.vendor_gagal; null di dalam peta ini berarti hal lain, yaitu
    // vendor ikut tetapi putusannya tidak sah.
    const putusanVendor = {};
    const keyakinanVendor = {};
    const alasanVendor = {};
    for (const { vendor, hasil } of terpakai) {
      const lain = (hasil.alerts ?? []).find((x) => x.id === a.id);
      putusanVendor[vendor] = lain?.putusan ?? null;
      if (lain?.keyakinan) keyakinanVendor[vendor] = lain.keyakinan;
      if (lain?.alasan) alasanVendor[vendor] = lain.alasan;
    }
    const { putusan, suara } = suaraTerbanyak(putusanVendor);
    return {
      ...a,
      putusan: putusan === 'tidak_sepakat' ? null : putusan,
      putusan_gabungan: putusan,
      putusan_asal: 'suara-terbanyak',
      suara: suara,
      putusan_vendor: putusanVendor,
      keyakinan: null,
      keyakinan_vendor: keyakinanVendor,
      alasan: null,
      alasan_vendor: alasanVendor,
    };
  });
};

const gabungTemuan = (terpakai) => {
  const klaster = [];
  for (const { vendor, hasil } of terpakai) {
    for (const t of hasil.findings ?? []) {
      const k = klaster.find((c) => temuanCocok(c.wakil, t));
      if (k) { k.anggota.push({ vendor, t }); continue; }
      klaster.push({ wakil: t, anggota: [{ vendor, t }] });
    }
  }
  return klaster.map((k) => {
    // Wakil klaster adalah temuan vendor pertama yang menemukannya; penjelasan setiap vendor
    // disimpan utuh, karena justru perbedaan alasannya yang berguna dibaca.
    const w = k.wakil;
    const penjelasanVendor = {};
    for (const { vendor, t } of k.anggota) penjelasanVendor[vendor] = t.penjelasan ?? '';
    const vendorPenemu = [...new Set(k.anggota.map((x) => x.vendor))];
    return {
      ...w,
      penjelasan: null,
      penjelasan_vendor: penjelasanVendor,
      vendor_penemu: vendorPenemu,
      kesepakatan: vendorPenemu.length,
    };
  });
};

const gabungRun = (terpakai, gagal, opsi) => {
  const perVendor = {};
  let biaya = 0;
  // deteksi_kosong ikut dijumlahkan karena ada di daftar kunci ini. Hasil vendor lama yang belum
  // memuatnya menyumbang 0, bukan membuat seluruh penjumlahan hilang.
  const total = { total: 0, ok: 0, refusal: 0, truncated: 0, error: 0, parse_gagal: 0, deteksi_kosong: 0 };
  let thinkingTotal = 0;
  let adaThinking = false;
  for (const { vendor, hasil } of terpakai) {
    const sp = hasil.run.status_panggilan ?? {};
    const tt = hasil.run.thinking_token ?? null;
    if (typeof tt?.total === 'number') { thinkingTotal += tt.total; adaThinking = true; }
    perVendor[vendor] = {
      model_diminta: hasil.run.model_diminta ?? null,
      model_menjawab: hasil.run.model_menjawab ?? null,
      biaya_usd: typeof hasil.run.biaya_usd === 'number' ? hasil.run.biaya_usd : null,
      durasi_detik: hasil.run.durasi_detik ?? null,
      status_panggilan: { ...sp },
      // Dibawa per vendor, bukan hanya dijumlahkan: yang berguna dibaca justru vendor MANA yang
      // menjawab kosong dan berapa token yang ia pakai untuk berpikir.
      thinking_token: tt ? { ...tt } : null,
      jumlah_temuan: (hasil.findings ?? []).length,
    };
    biaya += typeof hasil.run.biaya_usd === 'number' ? hasil.run.biaya_usd : 0;
    for (const k of Object.keys(total)) total[k] += Number(sp[k]) || 0;
  }
  for (const g of gagal) {
    perVendor[g.vendor ?? `tidak-dikenal-${Object.keys(perVendor).length}`] = {
      gagal: true, alasan: g.alasan,
    };
  }

  const dasar = terpakai[0].hasil.run;
  const waktu = terpakai.map((x) => x.hasil.run).filter((r) => r.mulai && r.selesai);
  const mulai = waktu.length ? waktu.map((r) => r.mulai).sort()[0] : dasar.mulai;
  const selesai = waktu.length ? waktu.map((r) => r.selesai).sort().at(-1) : dasar.selesai;

  return {
    ...dasar,
    id: opsi.id ?? dasar.id,
    nomor: opsi.nomor ?? dasar.nomor,
    repo: opsi.repo ?? dasar.repo ?? null,
    asal: opsi.id ? 'workflow' : 'cli',
    skenario: 'B',
    mode_model: 'gabungan',
    // Mode gabungan tidak punya satu vendor; yang berarti adalah daftar vendornya.
    vendor: 'gabungan',
    model_diminta: null,
    model_menjawab: null,
    vendor_dipakai: terpakai.map((x) => x.vendor),
    vendor_gagal: gagal.map((g) => ({ vendor: g.vendor, alasan: g.alasan })),
    per_vendor: perVendor,
    mulai,
    selesai,
    durasi_detik: mulai && selesai ? Math.round((new Date(selesai) - new Date(mulai)) / 1000) : null,
    biaya_usd: Number(biaya.toFixed(6)),
    // Run gabungan tidak punya satu panggilan deteksi, jadi `deteksi` di tingkat ini null; angkanya
    // ada per vendor. `...dasar` di atas membawa thinking_token vendor pertama, dan itu harus
    // ditimpa supaya tidak terbaca sebagai angka seluruh run.
    thinking_token: { deteksi: null, total: adaThinking ? thinkingTotal : null },
    status_panggilan: total,
    // Hash prompt sama untuk ketiganya karena prompt v2 terkunci; diambil dari vendor pertama.
    hash_prompt: dasar.hash_prompt,
  };
};

// `masukan` adalah daftar { vendor, hasil } dengan hasil berupa isi results.json skema 2, atau
// { vendor, alasan } untuk vendor yang gagal. Vendor yang gagal tidak menghentikan penggabungan.
const gabungkan = (masukan, opsi = {}) => {
  const terpakai = [];
  const gagal = [];
  for (const m of masukan) {
    const alasan = m.alasan ?? alasanTidakTerpakai(m.hasil);
    if (alasan) { gagal.push({ vendor: m.vendor ?? vendorDari(m.hasil), alasan }); continue; }
    terpakai.push({ vendor: m.vendor ?? vendorDari(m.hasil), hasil: m.hasil });
  }
  if (!terpakai.length) {
    const rincian = gagal.map((g) => `${g.vendor ?? 'tidak dikenal'}: ${g.alasan}`).join('; ');
    throw new Error(`Penggabungan gagal: tidak ada hasil vendor yang bisa dipakai. ${rincian}`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    run: gabungRun(terpakai, gagal, opsi),
    alerts: gabungAlert(terpakai),
    findings: gabungTemuan(terpakai),
  };
};

module.exports = {
  SUARA_MINIMUM, JENDELA_BARIS, PUTUSAN_SAH,
  angkaCwe, keluargaDari, cweSekeluarga, temuanCocok, suaraTerbanyak,
  alasanTidakTerpakai, gabungAlert, gabungTemuan, gabungRun, gabungkan,
};
