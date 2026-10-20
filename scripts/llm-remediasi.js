#!/usr/bin/env node
// Lapis 2 rekomendasi perbaikan: membaca results.json skema 2, meminta saran spesifik ke model
// dalam satu panggilan, lalu menulis hasilnya kembali ke berkas yang sama.
//
// Dijalankan sesudah results.json tersusun dan sebelum diterbitkan. Dipisah dari llm-scan.js
// supaya kegagalan di sini tidak pernah bisa menggagalkan deteksi maupun verifikasi: skrip ini
// selesai dengan exit 0 bahkan ketika panggilannya gagal, dan yang tercatat adalah alasannya.
//
// Pemakaian:
//   node scripts/llm-remediasi.js --vendor=google --results=results.json
const fs = require('fs');
const path = require('path');
const { panggilDenganUlang } = require('./llm/panggil');
const { VENDOR, BATAS_OUTPUT, TINGKAT_THINKING, hitungBiaya } = require('./llm/vendor');
const remediasi = require('./llm/remediasi');

const ambilArg = (nama) => {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.slice(nama.length + 3) : null;
};

const main = async () => {
  const vendor = ambilArg('vendor');
  const berkas = path.resolve(ambilArg('results') ?? 'results.json');

  if (!vendor || !VENDOR[vendor]) {
    console.error(`Vendor tidak dikenal: ${vendor}. Pilihan: ${Object.keys(VENDOR).join(', ')}`);
    process.exit(1);
  }
  if (!fs.existsSync(berkas)) {
    console.error(`Berkas hasil tidak ditemukan: ${berkas}`);
    process.exit(1);
  }

  const hasil = JSON.parse(fs.readFileSync(berkas, 'utf8'));
  if (hasil.schema_version !== 2) {
    console.error(`Remediasi hanya berlaku untuk skema 2, berkas ini skema ${hasil.schema_version}.`);
    process.exit(1);
  }

  const model = VENDOR[vendor].model;
  console.log(`Remediasi: ${vendor} ${model}`);

  const ringkas = await remediasi.jalankanRemediasi(
    hasil,
    { vendor, model, batasOutput: BATAS_OUTPUT, tingkatThinking: TINGKAT_THINKING },
    { panggil: panggilDenganUlang, hitungBiaya, tarif: VENDOR[vendor].tarif },
  );

  fs.writeFileSync(berkas, `${JSON.stringify(hasil, null, 2)}\n`);

  console.log(`  status      : ${ringkas.status}`);
  console.log(`  item dikirim: ${ringkas.item_dikirim}`);
  console.log(`  item terisi : ${ringkas.item_terisi}`);
  if (ringkas.tidak_konsisten) console.log(`  CWE tidak konsisten: ${ringkas.tidak_konsisten}`);
  if (ringkas.biaya_usd !== null) console.log(`  biaya       : US$${ringkas.biaya_usd}`);
  if (ringkas.alasan) console.log(`  alasan      : ${ringkas.alasan}`);

  // Kegagalan lapis 2 bukan kegagalan run. Alasannya sudah tercatat di berkas hasil dan tampil
  // di dashboard; menggagalkan job di sini justru membuang hasil deteksi dan verifikasi yang sah.
  if (ringkas.status === 'gagal') console.log('::warning::Rekomendasi AI gagal; hasil deteksi dan verifikasi tidak terpengaruh.');
};

if (require.main === module) {
  main().catch((e) => {
    // Bahkan galat tak terduga tidak boleh menjatuhkan run: dicatat, lalu keluar dengan 0.
    console.log(`::warning::Remediasi berhenti karena galat tak terduga: ${e.message}`);
    process.exit(0);
  });
}

module.exports = { main };
