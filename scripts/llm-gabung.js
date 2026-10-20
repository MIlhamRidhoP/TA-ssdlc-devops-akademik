#!/usr/bin/env node
// Menggabungkan hasil tiga vendor dari run yang sama menjadi satu results.json.
//
// Dipakai job penggabung di jalur v2 mode gabungan: tiap job vendor hanya mengunggah hasilnya
// sebagai artifact, dan HANYA skrip ini yang menerbitkan. Job vendor tidak menerbitkan sendiri,
// supaya tidak ada tiga berkas berebut nomor run yang sama di branch security-results.
//
// Pemakaian:
//   node scripts/llm-gabung.js --masuk=dir-artifact --out=results.json \
//        [--nomor=N] [--id=RUN_ID] [--repo=owner/repo]
//
// --masuk menunjuk direktori berisi results.json tiap vendor, dicari rekursif. Vendor yang
// berkasnya tidak ada atau tidak terpakai dicatat, dan penggabungan tetap jalan dengan sisanya.
const fs = require('fs');
const path = require('path');
const { gabungkan, alasanTidakTerpakai } = require('./llm/gabung');

const VENDOR = ['google', 'anthropic', 'openai'];

const ambilArg = (nama) => {
  const a = process.argv.find((x) => x.startsWith(`--${nama}=`));
  return a ? a.slice(nama.length + 3) : null;
};

// Mencari berkas results.json di bawah satu direktori, berapa pun dalamnya: artifact GitHub
// Actions diunduh ke subfolder bernama artifactnya.
const cariResults = (dir) => {
  const keluar = [];
  const telusur = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) telusur(f);
      else if (e.name === 'results.json') keluar.push(f);
    }
  };
  if (fs.existsSync(dir)) telusur(dir);
  return keluar;
};

const main = () => {
  const masuk = ambilArg('masuk');
  const out = ambilArg('out') ?? 'results.json';
  if (!masuk) {
    console.error('--masuk wajib: direktori berisi results.json tiap vendor.');
    process.exit(1);
  }

  const berkas = cariResults(path.resolve(masuk));
  console.log(`Ditemukan ${berkas.length} berkas results.json di ${masuk}`);

  const perVendor = new Map();
  for (const f of berkas) {
    let hasil = null;
    let alasan = null;
    try {
      hasil = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      alasan = `berkas tidak bisa dibaca: ${e.message}`;
    }
    const vendor = hasil?.run?.vendor ?? null;
    alasan = alasan ?? alasanTidakTerpakai(hasil);
    if (!vendor) {
      console.log(`  ${path.basename(path.dirname(f))}: dilewati (${alasan ?? 'tanpa identitas vendor'})`);
      continue;
    }
    // Satu vendor satu hasil. Kalau ada dua, yang pertama dipakai dan yang kedua dicatat.
    if (perVendor.has(vendor)) {
      console.log(`  ${vendor}: berkas kedua diabaikan (${f})`);
      continue;
    }
    perVendor.set(vendor, alasan ? { vendor, alasan } : { vendor, hasil });
    console.log(`  ${vendor}: ${alasan ? `TIDAK TERPAKAI (${alasan})` : 'terpakai'}`);
  }

  // Vendor yang tidak menghasilkan berkas sama sekali juga harus tercatat, bukan hilang diam-diam.
  const masukan = VENDOR.map((v) => perVendor.get(v)
    ?? { vendor: v, alasan: 'hasil vendor ini tidak ditemukan di artifact' });

  let hasil;
  try {
    hasil = gabungkan(masukan, {
      nomor: Number(ambilArg('nomor')) || undefined,
      id: Number(ambilArg('id')) || undefined,
      repo: ambilArg('repo') ?? undefined,
    });
  } catch (e) {
    // Seluruh vendor gagal berarti run ini memang tidak punya hasil. Itu kegagalan sungguhan dan
    // harus menghentikan job, bukan menerbitkan berkas kosong yang terlihat seperti hasil sah.
    console.error(e.message);
    process.exit(1);
  }

  fs.writeFileSync(out, `${JSON.stringify(hasil, null, 2)}\n`);
  const r = hasil.run;
  console.log(`Gabungan ditulis ke ${out}`);
  console.log(`  vendor dipakai : ${r.vendor_dipakai.join(', ')}`);
  if (r.vendor_gagal.length) console.log(`  vendor gagal   : ${r.vendor_gagal.map((g) => `${g.vendor} (${g.alasan})`).join('; ')}`);
  console.log(`  alert          : ${hasil.alerts.length}, tidak sepakat ${hasil.alerts.filter((a) => a.putusan_gabungan === 'tidak_sepakat').length}`);
  console.log(`  temuan         : ${hasil.findings.length} (3 model ${hasil.findings.filter((t) => t.kesepakatan === 3).length}, 2 model ${hasil.findings.filter((t) => t.kesepakatan === 2).length}, 1 model ${hasil.findings.filter((t) => t.kesepakatan === 1).length})`);
  console.log(`  biaya total    : US$${r.biaya_usd}`);
};

if (require.main === module) main();

module.exports = { main, cariResults };
