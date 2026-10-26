// Penyusun results.json skema 3 (docs/design/results-v3.schema.json), untuk run dengan sumbu `sast`.
//
// MEMAKAI ULANG scripts/llm/results-v2.js, bukan menyalinnya. Seluruh pemetaan temuan, putusan
// verifikasi, dan blok eksperimen dipanggil dari sana, sehingga satu run dua perkakas tidak bisa
// diam-diam memetakan hal yang sama dengan cara yang berbeda dari run satu perkakas. Yang ditambah
// di sini hanya perbedaan skema 3 terhadap skema 2:
//
//   run.sast          perkakas pemasok alert, hanya ditulis kalau bukan 'sonar'
//   run.codeql_beku   info berkas CodeQL beku, nama berkas saja
//   alerts[].severity         menggantikan severity_sonar, karena sumbernya tidak lagi selalu Sonar
//   alerts[].severity_asal    enum dua perkakas, bukan lagi const 'sonar'
//   alerts[].sumber_sast      perkakas pemasok alert itu
//   alerts[].kembar_dengan    metadata pasangan kembar antar-perkakas
//
// Skema 2 tidak disentuh: run satu perkakas tetap disusun oleh results-v2.js apa adanya.
const v2 = require('./results-v2');

const SCHEMA_VERSION = 3;
const SAST_BAWAAN = 'sonar';

// Alert v2 -> alert v3. `asal` memetakan id alert ke perkakas pemasoknya, diturunkan dari daftar
// alert masukan (medan sumber_sast yang dipasang scripts/sast/sumbu-sast.js).
const naikkanAlert = (alerts, alertMasukan) => {
  const perkakas = new Map((alertMasukan ?? []).map((a) => [a.id, a.sumber_sast ?? SAST_BAWAAN]));
  const kembar = new Map((alertMasukan ?? []).map((a) => [a.id, a.kembar_dengan]));
  // Severity CodeQL hidup di medan severity_codeql pada alert masukan, bukan di `severity` yang
  // dibaca perakit skema 2 dari alert Sonar. Tanpa pembacaan ini setiap alert CodeQL berseverity
  // null, dan angka security-severity-nya hilang diam-diam dari berkas hasil.
  const severityCodeql = new Map((alertMasukan ?? []).map((a) => [a.id, a.severity_codeql ?? null]));
  return alerts.map((a) => {
    const { severity_sonar: severitySonar, severity_asal: severitySebelum, ...sisa } = a;
    void severitySebelum;
    const sumberSast = perkakas.get(a.id) ?? SAST_BAWAAN;
    const k = kembar.get(a.id);
    return {
      ...sisa,
      severity: severitySonar ?? (sumberSast === 'codeql' ? severityCodeql.get(a.id) ?? null : null),
      severity_asal: sumberSast,
      sumber_sast: sumberSast,
      ...(Array.isArray(k) ? { kembar_dengan: k } : {}),
    };
  });
};

// Info berkas beku yang dicatat llm-scan memuat lebih banyak daripada yang dikenal skema (sha256_file
// dan dibuat, di samping tiga medan skema). Medannya DIPILIH di sini, bukan diteruskan apa adanya,
// sama seperti perakit skema 2 memperlakukan sonar_beku; yang tidak dikenal skema tetap tersimpan di
// summary.json. Meneruskan seluruh objek menghasilkan berkas yang tidak sah terhadap skema 3.
const pilihCodeqlBeku = (b) => (b
  ? { nama: b.nama ?? null, sha256_isi: b.sha256_isi ?? null, jumlah_alert: b.jumlah_alert ?? null }
  : null);

// Medan `sast` dan `codeql_beku` ditulis hanya kalau bukan nilai bawaan, mengikuti cara `skenario`
// dan `mode_model` diperkenalkan di skema 2: berkas yang tidak menyebutkannya berarti satu perkakas.
const naikkanRun = (run, { sast, codeqlBeku }) => (sast && sast !== SAST_BAWAAN
  ? { ...run, sast, codeql_beku: pilihCodeqlBeku(codeqlBeku) }
  : { ...run });

// Argumen sama dengan susunHasilV2, ditambah:
//   sast        'sonar' | 'codeql' | 'keduanya'
//   codeqlBeku  { nama, sha256_isi, jumlah_alert } atau null
//   alert       daftar alert masukan; medan sumber_sast dan kembar_dengan dibaca dari sini
const susunHasilV3 = ({ sast = SAST_BAWAAN, codeqlBeku = null, ...argV2 }) => {
  const dasar = v2.susunHasilV2(argV2);
  return {
    ...dasar,
    schema_version: SCHEMA_VERSION,
    run: naikkanRun(dasar.run, { sast, codeqlBeku }),
    alerts: naikkanAlert(dasar.alerts, argV2.alert),
  };
};

// Entri index.json untuk skema 3. Dihitung dari entri v2 lalu ditambah hitungan per perkakas, supaya
// riwayat dapat menyaring per perkakas tanpa membuka tiap berkas hasil.
const entriIndexV3 = (hasil, relPath) => {
  const dasar = v2.entriIndexV2(hasil, relPath);
  const per = {};
  for (const a of hasil.alerts) {
    const k = a.sumber_sast ?? SAST_BAWAAN;
    per[k] = (per[k] ?? 0) + 1;
  }
  return {
    ...dasar,
    ...(hasil.run.sast && hasil.run.sast !== SAST_BAWAAN
      ? { sast: hasil.run.sast, jumlah_alert_per_sast: per }
      : {}),
  };
};

module.exports = { SCHEMA_VERSION, SAST_BAWAAN, naikkanAlert, naikkanRun, susunHasilV3, entriIndexV3 };
