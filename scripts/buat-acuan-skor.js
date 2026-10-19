// Membuat berkas acuan angka skor untuk tes, dari berkas skor di branch eksperimen/seeded.
//
// Mengapa ada: tes membandingkan blok eksperimen di fixture dashboard dengan berkas skor sumber.
// Berkas skor itu hidup di branch lain, dan runner CI hanya mengambil satu branch, jadi `git show`
// tidak selalu bisa. Acuan ini menyalin angkanya ke dalam repo alat beserta provenance (commit,
// path, dan sha256 tiap berkas sumber) supaya tes tetap mandiri tanpa kehilangan jejak asal angka.
//
// Pemakaian (butuh branch eksperimen/seeded tersedia secara lokal):
//   node scripts/buat-acuan-skor.js [--out=tests/fixtures/acuan-skor-20261019.json]
//
// Acuan ini sengaja berupa proyeksi MENTAH dari berkas skor, bukan keluaran susunEksperimen,
// supaya perbandingannya tidak melingkar: ia menguji produsen, bukan mengulang produsen.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BRANCH = 'eksperimen/seeded';
const DIR = 'hasil-eksperimen/20261019';
const BERKAS = {
  utama: 'skor-utama.json',
  triase: 'skor-setelah-triase.json',
  konservatif: 'skor-setelah-triase-konservatif.json',
  sensitivitas: 'skor-sensitivitas-sonar03.json',
};

const ambil = (nama) => execFileSync('git', ['-C', ROOT, 'show', `${BRANCH}:${DIR}/${nama}`], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

const metrik = (m) => (m ? { tp: m.tp, fp: m.fp, fn: m.fn, precision: m.precision, recall: m.recall, f1: m.f1 } : null);
const triase = (t) => (t ? {
  varian: t.varian, fp: t.fp, precision: t.precision, recall: t.recall, f1: t.f1,
  rincian_triase: { ...t.rincian_triase }, belum_ditriase: t.belum_ditriase,
} : null);

const main = () => {
  const mentah = {};
  const sumber = {};
  for (const [kunci, nama] of Object.entries(BERKAS)) {
    const teks = ambil(nama);
    mentah[kunci] = JSON.parse(teks);
    sumber[nama] = crypto.createHash('sha256').update(teks).digest('hex');
  }
  const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', BRANCH], { encoding: 'utf8' }).trim();

  const cari = (lap, vendor, run) => lap.utama.per_model.find((x) => x.vendor === vendor).runs.find((r) => r.run === run);

  const per_model = mentah.utama.utama.per_model.map((m) => ({
    vendor: m.vendor,
    model: m.model,
    jumlah_run: m.runs.length,
    skenario_a: metrik(mentah.utama.utama.skenario_a.b_filter_v2.ketat),
    rata_rata: Object.fromEntries(['skenario_b', 'skenario_c'].map((sk) => [sk, {
      precision: m.rata_rata[sk].precision, recall: m.rata_rata[sk].recall, f1: m.rata_rata[sk].f1,
    }])),
    runs: m.runs.map((r) => {
      const rt = cari(mentah.triase, m.vendor, r.run);
      const rk = cari(mentah.konservatif, m.vendor, r.run);
      const rs = cari(mentah.sensitivitas, m.vendor, r.run);
      const perSkenario = Object.fromEntries(['skenario_b', 'skenario_c'].map((sk) => [sk, {
        ketat: metrik(r[sk].ketat),
        triase_utama: triase(rt[sk].setelah_triase),
        triase_konservatif: triase(rk[sk].setelah_triase),
      }]));
      return {
        run: r.run,
        ...perSkenario,
        verifikasi: {
          jumlah: { ...r.verifikasi.jumlah },
          metrik_fp_positif: { ...r.verifikasi.metrik_fp_positif },
          sensitivitas: { jumlah: { ...rs.verifikasi.jumlah }, metrik_fp_positif: { ...rs.verifikasi.metrik_fp_positif } },
        },
      };
    }),
  }));

  const label = (lap) => Object.fromEntries(Object.entries(lap.utama.label_alert)
    .map(([id, l]) => [id, { label: l.label ?? null, sumber: l.sumber ?? null }]));

  const acuan = {
    catatan: 'Acuan angka skor untuk tes. Disalin apa adanya dari berkas skor di branch eksperimen/seeded; '
      + 'tidak dihitung ulang. Dibuat dengan scripts/buat-acuan-skor.js. Jangan disunting tangan: '
      + 'kalau berkas skor berubah, jalankan ulang skrip itu.',
    sumber: {
      branch: BRANCH,
      commit,
      dir: DIR,
      sha256: sumber,
    },
    aturan_hardening: mentah.utama.aturan_hardening,
    commit_kode_scoring: mentah.utama.commit_kode_scoring?.head ?? null,
    objek_uji_commit: mentah.utama.objek_uji?.commit ?? null,
    label_alert: label(mentah.utama),
    label_alert_sensitivitas: label(mentah.sensitivitas),
    per_model,
  };

  const out = path.resolve(ROOT, (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6) || 'tests/fixtures/acuan-skor-20261019.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(acuan, null, 2)}\n`);
  console.log(`Acuan ditulis: ${path.relative(ROOT, out)} (commit ${commit.slice(0, 7)}, ${per_model.length} vendor)`);
};

if (require.main === module) main();
module.exports = { BRANCH, DIR, BERKAS };
