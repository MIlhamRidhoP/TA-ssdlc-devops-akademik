// Analisis ablasi konteks Sonar dari file *.score.json, sesuai PRAREGISTRASI.md. Tidak memanggil API.
//   node scripts/ablasi-analisis.js
// Keluaran: hasil-eksperimen/ablasi-sonar-20261016/analisis.json dan HASIL_OTOMATIS.md
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FOLDER = path.join(ROOT, 'hasil-eksperimen', 'ablasi-sonar-20261016');
const FOLDER_10OKT = path.join(ROOT, 'hasil-eksperimen', '20261010', 'flash');
const POSITIF = ['S1', 'S3', 'S4', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'];
const JEBAKAN = ['S2', 'S5'];
const LAIN = ['S6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'N1'];

const baca = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const r3 = (x) => (x === null || Number.isNaN(x) ? null : Number(x.toFixed(3)));
const rata = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// p = min(1, 2 * sum_{i=0}^{min(b,c)} C(b+c, i) / 2^(b+c)), sama dengan STATISTIK.md
const mcnemarEksak = (b, c) => {
  const n = b + c;
  if (n === 0) return 1;
  let kombinasi = 1;
  let jumlah = 0;
  for (let i = 0; i <= Math.min(b, c); i++) {
    if (i > 0) kombinasi = (kombinasi * (n - i + 1)) / i;
    jumlah += kombinasi;
  }
  return Math.min(1, (2 * jumlah) / 2 ** n);
};

// Status per item dari satu file skor: ketat = "cocok", longgar = "cocok" atau "cocok lokasi"
const statusItem = (skor) => {
  const ketat = {};
  const longgar = {};
  for (const g of skor.ground_truth) {
    ketat[g.id] = g.status_deteksi === 'cocok' ? 1 : 0;
    longgar[g.id] = g.status_deteksi === 'cocok' || g.status_deteksi === 'cocok lokasi' ? 1 : 0;
  }
  for (const l of skor.laten_terdeteksi ?? []) {
    ketat[l.id] = l.terdeteksi === 'cocok' ? 1 : 0;
    longgar[l.id] = l.terdeteksi === 'cocok' || l.terdeteksi === 'cocok lokasi' ? 1 : 0;
  }
  return { ketat, longgar };
};

// Run yang dipakai per kondisi: run ulang menggantikan run aslinya kalau run asli gagal
const muatKondisi = (k) => {
  const runs = [];
  for (const n of [1, 2, 3]) {
    const kandidat = [`${k}${n}`, `${k}${n}-ulang`];
    const dipakai = kandidat.find((nama) => fs.existsSync(path.join(FOLDER, `${nama}.score.json`)));
    if (!dipakai) continue;
    const run = baca(path.join(FOLDER, `${dipakai}.json`));
    const skor = baca(path.join(FOLDER, `${dipakai}.score.json`));
    runs.push({ nama: dipakai, run, skor, status: statusItem(skor) });
  }
  return runs;
};

const muat10Okt = () => [1, 2, 3].map((n) => {
  const skor = baca(path.join(FOLDER_10OKT, `run-${n}.score.json`));
  return { nama: `10okt-${n}`, skor, status: statusItem(skor) };
});

const mayoritas = (runs, mode) => Object.fromEntries(
  [...POSITIF, ...JEBAKAN, ...LAIN].map((id) => [id, runs.filter((r) => r.status[mode][id]).length >= 2 ? 1 : 0]),
);

const bandingkan = (x, y, items) => {
  let b = 0, c = 0, keduanya = 0, tidak = 0;
  const hanyaX = [], hanyaY = [];
  for (const id of items) {
    if (x[id] && y[id]) keduanya++;
    else if (x[id]) { b++; hanyaX.push(id); }
    else if (y[id]) { c++; hanyaY.push(id); }
    else tidak++;
  }
  return { keduanya, tidak, b, c, hanya_pertama: hanyaX, hanya_kedua: hanyaY, p: r3(mcnemarEksak(b, c)) };
};

// Pasangan per run: run ke-i kondisi pertama dengan run ke-i kondisi kedua (n = 9 x 3)
const bandingkanPerRun = (xs, ys, mode) => {
  let b = 0, c = 0, keduanya = 0, tidak = 0;
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    for (const id of POSITIF) {
      const x = xs[i].status[mode][id], y = ys[i].status[mode][id];
      if (x && y) keduanya++; else if (x) b++; else if (y) c++; else tidak++;
    }
  }
  return { n: keduanya + tidak + b + c, keduanya, tidak, b, c, p: r3(mcnemarEksak(b, c)) };
};

const metrikRun = (r) => ({
  run: r.nama,
  ketat: r.skor.metrik.ketat,
  longgar: r.skor.metrik.longgar_cocok_lokasi,
  jebakan_dilaporkan: JEBAKAN.filter((id) => r.status.ketat[id]),
  jumlah_temuan: r.run ? r.run.jumlah_temuan : r.skor.temuan.length,
  model_version: r.run?.model_version ?? null,
  biaya_usd: r.run?.biaya_usd?.usd_total ?? null,
  token_output_termasuk_thinking: r.run?.biaya_usd?.output_token_termasuk_thinking ?? null,
});

const ringkasKondisi = (runs) => {
  const m = runs.map(metrikRun);
  return {
    jumlah_run: runs.length,
    runs: m,
    rata: {
      tp: r3(rata(m.map((x) => x.ketat.tp))), fp: r3(rata(m.map((x) => x.ketat.fp))),
      precision: r3(rata(m.map((x) => x.ketat.precision))), recall: r3(rata(m.map((x) => x.ketat.recall))),
      f1: r3(rata(m.map((x) => x.ketat.f1))), f1_longgar: r3(rata(m.map((x) => x.longgar.f1))),
      jumlah_temuan: r3(rata(m.map((x) => x.jumlah_temuan))),
    },
    jebakan_dilaporkan_dari_6: m.reduce((s, x) => s + x.jebakan_dilaporkan.length, 0),
    biaya_total_usd: r3(m.reduce((s, x) => s + (x.biaya_usd ?? 0), 0)),
    per_item_ketat: Object.fromEntries([...POSITIF, ...JEBAKAN, ...LAIN].map((id) => [id, runs.map((r) => r.status.ketat[id])])),
  };
};

const tabelItem = (kondisi) => {
  const baris = ['| Item | Kelompok | A R1 R2 R3 | A mayoritas | B R1 R2 R3 | B mayoritas | 10 Okt R1 R2 R3 |', '|---|---|---|---|---|---|---|'];
  for (const id of [...POSITIF, ...JEBAKAN, ...LAIN]) {
    const kel = POSITIF.includes(id) ? 'positif' : JEBAKAN.includes(id) ? 'jebakan' : id === 'S6' ? 'laten' : 'bawaan';
    baris.push(`| ${id} | ${kel} | ${kondisi.A.per_item_ketat[id].join(' ')} | ${kondisi.mayA[id]} | ${kondisi.B.per_item_ketat[id].join(' ')} | ${kondisi.mayB[id]} | ${kondisi.okt.per_item_ketat[id].join(' ')} |`);
  }
  return baris.join('\n');
};

const baris = (b) => `${b.keduanya} | ${b.tidak} | ${b.b} | ${b.c} | ${b.p}`;

const main = () => {
  const A = muatKondisi('A');
  const B = muatKondisi('B');
  if (A.length < 3 || B.length < 3) {
    console.log(`Run belum lengkap (A ${A.length}/3, B ${B.length}/3). Analisis utama butuh 3 run per kondisi.`);
  }
  const okt = muat10Okt();
  const rA = ringkasKondisi(A), rB = ringkasKondisi(B), rOkt = ringkasKondisi(okt);
  const may = { A: mayoritas(A, 'ketat'), B: mayoritas(B, 'ketat'), okt: mayoritas(okt, 'ketat') };
  const mayL = { A: mayoritas(A, 'longgar'), B: mayoritas(B, 'longgar'), okt: mayoritas(okt, 'longgar') };

  const hasil = {
    dibuat: new Date().toISOString(),
    catatan: 'Dihitung otomatis dari *.score.json sesuai PRAREGISTRASI.md. Ketat = hanya "cocok". Mayoritas = terdeteksi di >= 2 dari 3 run.',
    kondisi: { A: rA, B: rB, flash_10okt: rOkt },
    utama_mcnemar_A_vs_B_mayoritas_ketat: bandingkan(may.A, may.B, POSITIF),
    sekunder: {
      mcnemar_A_vs_B_mayoritas_longgar: bandingkan(mayL.A, mayL.B, POSITIF),
      mcnemar_A_vs_B_per_run_ketat: bandingkanPerRun(A, B, 'ketat'),
      jebakan_dilaporkan_dari_6: { A: rA.jebakan_dilaporkan_dari_6, B: rB.jebakan_dilaporkan_dari_6 },
      bawaan_mayoritas_ketat: Object.fromEntries(LAIN.map((id) => [id, { A: may.A[id], B: may.B[id] }])),
    },
    replikasi_A_vs_10okt: {
      mcnemar_mayoritas_ketat: bandingkan(may.A, may.okt, POSITIF),
      jebakan_dari_6: { A: rA.jebakan_dilaporkan_dari_6, okt: rOkt.jebakan_dilaporkan_dari_6 },
      f1_rata: { A: rA.rata.f1, okt: rOkt.rata.f1 },
    },
  };
  fs.writeFileSync(path.join(FOLDER, 'analisis.json'), JSON.stringify(hasil, null, 2));

  const u = hasil.utama_mcnemar_A_vs_B_mayoritas_ketat;
  const md = `# Hasil Otomatis Ablasi Konteks Sonar

Dibuat otomatis oleh \`scripts/ablasi-analisis.js\` pada ${hasil.dibuat}. Aturan sesuai \`PRAREGISTRASI.md\`.
A = prompt eksperimen dengan laporan Sonar, B = tanpa laporan Sonar. Ketat = hanya status "cocok".

## Metrik per run (ketat, 9 positif)

| Run | TP | FP | Precision | Recall | F1 | F1 longgar | Jebakan dilaporkan | Temuan | Biaya USD | model_version |
|---|---|---|---|---|---|---|---|---|---|---|
${[...rA.runs, ...rB.runs, ...rOkt.runs].map((m) => `| ${m.run} | ${m.ketat.tp} | ${m.ketat.fp} | ${r3(m.ketat.precision)} | ${r3(m.ketat.recall)} | ${r3(m.ketat.f1)} | ${r3(m.longgar.f1)} | ${m.jebakan_dilaporkan.join(', ') || '-'} | ${m.jumlah_temuan} | ${m.biaya_usd ?? '-'} | ${m.model_version ?? '-'} |`).join('\n')}

| Kondisi | TP rata | FP rata | Precision | Recall | F1 | F1 longgar | Jebakan dari 6 | Biaya total |
|---|---|---|---|---|---|---|---|---|
| A (dengan Sonar) | ${rA.rata.tp} | ${rA.rata.fp} | ${rA.rata.precision} | ${rA.rata.recall} | ${rA.rata.f1} | ${rA.rata.f1_longgar} | ${rA.jebakan_dilaporkan_dari_6} | ${rA.biaya_total_usd} |
| B (tanpa Sonar) | ${rB.rata.tp} | ${rB.rata.fp} | ${rB.rata.precision} | ${rB.rata.recall} | ${rB.rata.f1} | ${rB.rata.f1_longgar} | ${rB.jebakan_dilaporkan_dari_6} | ${rB.biaya_total_usd} |
| Flash 10 Okt (arsip) | ${rOkt.rata.tp} | ${rOkt.rata.fp} | ${rOkt.rata.precision} | ${rOkt.rata.recall} | ${rOkt.rata.f1} | ${rOkt.rata.f1_longgar} | ${rOkt.jebakan_dilaporkan_dari_6} | - |

## Status per item (ketat)

${tabelItem({ A: rA, B: rB, okt: rOkt, mayA: may.A, mayB: may.B })}

## Uji McNemar eksak

| Perbandingan | Basis | kedua ya | kedua tidak | b | c | p |
|---|---|---|---|---|---|---|
| **A vs B (utama)** | mayoritas, ketat, n=9 | ${baris(u)} |
| A vs B | mayoritas, longgar, n=9 | ${baris(hasil.sekunder.mcnemar_A_vs_B_mayoritas_longgar)} |
| A vs B | per run, ketat, n=${hasil.sekunder.mcnemar_A_vs_B_per_run_ketat.n} (tidak independen) | ${baris(hasil.sekunder.mcnemar_A_vs_B_per_run_ketat)} |
| A vs Flash 10 Okt (replikasi) | mayoritas, ketat, n=9 | ${baris(hasil.replikasi_A_vs_10okt.mcnemar_mayoritas_ketat)} |

b = hanya kondisi pertama yang mendeteksi, c = hanya kondisi kedua. Item hanya-A: ${u.hanya_pertama.join(', ') || '-'}; hanya-B: ${u.hanya_kedua.join(', ') || '-'}.
`;
  fs.writeFileSync(path.join(FOLDER, 'HASIL_OTOMATIS.md'), md);
  console.log(md);
};

main();
