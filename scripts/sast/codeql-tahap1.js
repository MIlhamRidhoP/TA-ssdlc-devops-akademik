#!/usr/bin/env node
// Tahap 1 penambahan CodeQL sebagai SAST kedua: urai SARIF, saring, nilai terhadap ground truth.
//
// Terpisah dari scripts/llm/ dengan sengaja, dan TIDAK mengubah scripts/llm/score.js,
// scripts/llm-score.js, maupun scripts/buat-acuan-skor.js. Aturan pencocokan dipanggil dari
// fungsi yang sudah diekspor di scripts/gemini-scan.js, supaya angka CodeQL dan angka skenario A
// yang sudah terbit memakai pencocok yang sama persis dan tidak bisa menyimpang diam-diam.
//
// Tidak memanggil API apa pun. Tidak menulis ke dalam repo: seluruh keluaran ke --out.
//
// Pemakaian:
//   node scripts/sast/codeql-tahap1.js \
//     --sarif-extended=<file> --sarif-code-scanning=<file> \
//     --konfig=<KONFIG-TERKUNCI.txt> --objek=<worktree objek uji> \
//     --sonar-alert=<sonar-alert.json> --out=<folder keluaran di luar repo>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const tulisJson = (f, isi) => fs.writeFileSync(f, `${JSON.stringify(isi, null, 2)}\n`);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------- Saringan tiga tingkat, DIKUNCI sebelum melihat hasil ----------
// Keputusan tingkat hanya dari tag rule, tidak pernah dari kecocokan dengan ground truth.
const RULE_TINGKAT_2 = [
  'js/diagnostics/successfully-extracted-files',
  'js/diagnostics/extraction-errors',
  'js/summary/lines-of-code',
  'js/summary/lines-of-user-code',
];
const POLA_TINGKAT_2 = /^js\/(diagnostics|summary)\//;
const tingkatRule = (rule) => {
  const id = rule?.id ?? '';
  if (RULE_TINGKAT_2.includes(id) || POLA_TINGKAT_2.test(id)) return 2;
  if ((rule?.properties?.tags ?? []).includes('security')) return 1;
  return 3;
};

const cweDariTag = (tags = []) => [...new Set(tags
  .map((t) => /^external\/cwe\/cwe-0*(\d+)$/.exec(t))
  .filter(Boolean)
  .map((m) => `CWE-${m[1]}`))];

// ---------- Baca satu SARIF ----------
const bacaSarif = (file, namaSuite) => {
  const isi = fs.readFileSync(file);
  const j = JSON.parse(isi.toString('utf8'));
  if (j.runs.length !== 1) throw new Error(`${file}: ${j.runs.length} runs, hanya 1 yang didukung`);
  const run = j.runs[0];
  const driver = run.tool?.driver ?? {};
  const rules = [...(driver.rules ?? []), ...(run.tool?.extensions ?? []).flatMap((e) => e.rules ?? [])];
  const petaRule = new Map(rules.map((r) => [r.id, r]));
  return {
    suite: namaSuite,
    file,
    sha256: sha256(isi),
    versi_cli: driver.semanticVersion ?? driver.version ?? null,
    pack: (run.tool?.extensions ?? []).map((e) => `${e.name}@${(e.semanticVersion ?? e.version ?? '').split('+')[0]}`),
    jumlah_rule: rules.length,
    rules,
    petaRule,
    results: run.results ?? [],
    artifacts: run.artifacts ?? [],
    invocations: run.invocations ?? [],
    metricResults: run.properties?.metricResults ?? [],
  };
};

// ---------- Gerbang sanity ----------
// Entri hasil js/diagnostics/* TIDAK ADA di suite security-extended maupun code-scanning: keduanya
// milik suite Diagnostics yang tidak dijalankan. Yang diperiksa di sini adalah bukti EKUIVALEN dari
// medan lain SARIF, dan penggantian itu dicatat apa adanya di metadata supaya terlihat di laporan.
const gerbangSanity = (s) => {
  const uri = s.artifacts.map((a) => a.location?.uri ?? '');
  const srcJs = uri.filter((u) => /^src\/.*\.js$/.test(u));
  const luarSrc = uri.filter((u) => u && !u.startsWith('src/'));

  const notif = s.invocations.flatMap((i) => [...(i.toolExecutionNotifications ?? []), ...(i.toolConfigurationNotifications ?? [])]);
  const perLevel = {};
  for (const n of notif) perLevel[n.level ?? 'tanpa-level'] = (perLevel[n.level ?? 'tanpa-level'] ?? 0) + 1;
  const galat = notif.filter((n) => n.level === 'error' || n.level === 'warning').length;

  const metrik = Object.fromEntries(s.metricResults.map((m) => [m.ruleId, m.value]));
  const diminta = Object.fromEntries(RULE_TINGKAT_2.map((id) => [id, {
    rule_terdaftar: s.petaRule.has(id),
    entri_hasil: s.results.filter((r) => (r.ruleId ?? r.rule?.id) === id).length,
    nilai_metricResults: metrik[id] ?? null,
  }]));

  return {
    rule_diagnostik_yang_diminta: diminta,
    bukti_pengganti: {
      catatan: 'js/diagnostics/successfully-extracted-files dan js/diagnostics/extraction-errors tidak terdaftar sebagai rule di kedua suite, dan js/summary/* terdaftar tetapi nilainya ada di run.properties.metricResults, bukan di run.results. Gerbang karena itu dinilai dari artifacts[] dan invocations[].',
      artifacts_total: uri.length,
      src_js: srcJs.length,
      luar_src: luarSrc.length,
      executionSuccessful: s.invocations.map((i) => i.executionSuccessful),
      notifikasi_per_level: perLevel,
      notifikasi_error_atau_warning: galat,
      lines_of_code: metrik['js/summary/lines-of-code'] ?? null,
      lines_of_user_code: metrik['js/summary/lines-of-user-code'] ?? null,
    },
    lulus: {
      src_js_43: srcJs.length === 43,
      tanpa_galat_ekstraksi: galat === 0 && s.invocations.every((i) => i.executionSuccessful === true),
    },
  };
};

// ---------- Klasifikasi dan pengumpulan alert ----------
const lokasiResult = (r) => {
  const p = r.locations?.[0]?.physicalLocation ?? {};
  return { file: p.artifactLocation?.uri ?? null, baris: p.region?.startLine ?? null, kolom: p.region?.startColumn ?? null };
};

const kumpulkan = (daftarSarif) => {
  // kunci gabung: ruleId + file + baris. Lihat catatan aturan penggabungan di laporan.
  const alert = new Map();
  const tingkat2 = {};
  const tingkat3 = {};
  const mentahPerSuite = {};
  let entriMentah = 0;

  for (const s of daftarSarif) {
    mentahPerSuite[s.suite] = s.results.length;
    for (const r of s.results) {
      entriMentah += 1;
      const id = r.ruleId ?? r.rule?.id ?? '(tanpa ruleId)';
      const rule = s.petaRule.get(id) ?? { id };
      const tk = tingkatRule(rule);
      const lok = lokasiResult(r);
      const pesan = r.message?.text ?? null;

      if (tk === 2) {
        (tingkat2[id] ??= { rule: id, jumlah: 0, suite: new Set() });
        tingkat2[id].jumlah += 1;
        tingkat2[id].suite.add(s.suite);
        continue;
      }
      if (tk === 3) {
        (tingkat3[id] ??= { rule: id, tags: rule.properties?.tags ?? [], jumlah: 0, suite: new Set(), entri: [] });
        tingkat3[id].jumlah += 1;
        tingkat3[id].suite.add(s.suite);
        tingkat3[id].entri.push({ file: lok.file, baris: lok.baris, pesan });
        continue;
      }

      const kunci = `${id}|${lok.file}|${lok.baris}`;
      if (!alert.has(kunci)) {
        alert.set(kunci, {
          rule: id,
          tipe: rule.properties?.['security-severity'] ? 'SECURITY' : null,
          file: lok.file,
          baris: lok.baris,
          pesan,
          cwe: cweDariTag(rule.properties?.tags),
          tags: rule.properties?.tags ?? [],
          security_severity: rule.properties?.['security-severity'] ?? null,
          precision: rule.properties?.precision ?? null,
          suite: new Set([s.suite]),
          entri_digabung: 1,
          kolom: [lok.kolom],
        });
      } else {
        const a = alert.get(kunci);
        a.suite.add(s.suite);
        a.entri_digabung += 1;
        a.kolom.push(lok.kolom);
      }
    }
  }
  return { alert, tingkat2, tingkat3, mentahPerSuite, entriMentah };
};

// ---------- Main ----------
const main = () => {
  const out = path.resolve(wajib('out'));
  fs.mkdirSync(out, { recursive: true });

  const fileExt = path.resolve(wajib('sarif-extended'));
  const fileCs = path.resolve(wajib('sarif-code-scanning'));
  const fileKonfig = path.resolve(wajib('konfig'));
  const objek = path.resolve(wajib('objek'));
  const fileSonar = path.resolve(wajib('sonar-alert'));

  process.env.OBJEK_UJI_DIR = objek;
  const gs = require(path.join(__dirname, '..', 'gemini-scan'));
  const gt = gs.bacaGroundTruth();

  const sExt = bacaSarif(fileExt, 'extended');
  const sCs = bacaSarif(fileCs, 'code-scanning');

  // ---- Tugas 0: gerbang sanity ----
  const gerbang = { extended: gerbangSanity(sExt), 'code-scanning': gerbangSanity(sCs) };
  const metadata = {
    dibuat_pada: new Date().toISOString(),
    tahap: 'Tahap 1 CodeQL, tanpa LLM dan tanpa integrasi pipeline',
    lingkungan: { cli: sExt.versi_cli, pack: sExt.pack, konfig_sha256: sha256(fs.readFileSync(fileKonfig)) },
    objek_uji: { dir: objek, commit: null, tree_src: null },
    sarif: [sExt, sCs].map((s) => ({ suite: s.suite, file: s.file, sha256: s.sha256, jumlah_rule: s.jumlah_rule, jumlah_result: s.results.length })),
    gerbang_sanity: gerbang,
  };
  try {
    const { execFileSync } = require('child_process');
    metadata.objek_uji.commit = execFileSync('git', ['-C', objek, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    metadata.objek_uji.tree_src = execFileSync('git', ['-C', objek, 'rev-parse', 'HEAD:src'], { encoding: 'utf8' }).trim();
  } catch { /* biarkan null; dicatat apa adanya */ }
  tulisJson(path.join(out, 'metadata.json'), metadata);

  const gagalGerbang = Object.entries(gerbang)
    .filter(([, g]) => !g.lulus.src_js_43 || !g.lulus.tanpa_galat_ekstraksi)
    .map(([k]) => k);
  if (gagalGerbang.length) {
    console.error(`BERHENTI: gerbang sanity gagal untuk suite ${gagalGerbang.join(', ')}. Lihat metadata.json.`);
    process.exit(2);
  }

  // ---- Tugas 1 dan 2: saringan tingkat, lalu saringan cakupan ----
  const { alert, tingkat2, tingkat3, mentahPerSuite, entriMentah } = kumpulkan([sExt, sCs]);
  const rapikan = (m) => Object.values(m).map((x) => ({ ...x, suite: [...x.suite].sort() }))
    .sort((a, b) => b.jumlah - a.jumlah || a.rule.localeCompare(b.rule));
  tulisJson(path.join(out, 'tingkat2-diagnostik.json'), rapikan(tingkat2));
  tulisJson(path.join(out, 'tingkat3-tidak-jelas.json'), rapikan(tingkat3));

  const semua = [...alert.values()].map((a) => ({ ...a, suite: [...a.suite].sort() }));
  const dalamSrc = semua.filter((a) => a.file && a.file.startsWith('src/'));
  const luarSrc = semua.filter((a) => !a.file || !a.file.startsWith('src/'));
  const perBerkas = {};
  const perRuleLuar = {};
  for (const a of luarSrc) {
    perBerkas[a.file ?? '(tanpa lokasi)'] = (perBerkas[a.file ?? '(tanpa lokasi)'] ?? 0) + 1;
    perRuleLuar[a.rule] = (perRuleLuar[a.rule] ?? 0) + 1;
  }
  // Bentuk entri dibuat sama dengan alert-codeql.json, kecuali tanpa id: alert di luar src/ tidak
  // pernah diberi id CQL-xx. `hanya_extended` tetap dicatat di sini, karena justru di sinilah alert
  // yang hanya muncul di suite extended berada.
  const luarSrcKeluar = luarSrc.map((a) => ({
    rule: a.rule, tipe: a.tipe, sumber: 'codeql', file: a.file, baris: a.baris, cwe: a.cwe, pesan: a.pesan,
    severity_codeql: a.security_severity, severity_asal: 'codeql', precision_codeql: a.precision,
    suite: a.suite, hanya_extended: a.suite.length === 1 && a.suite[0] === 'extended',
    entri_sarif_digabung: a.entri_digabung, kolom: a.kolom, tags: a.tags,
  }));
  tulisJson(path.join(out, 'luar-src.json'), {
    jumlah: luarSrcKeluar.length,
    hanya_extended: luarSrcKeluar.filter((a) => a.hanya_extended).length,
    per_berkas: perBerkas,
    per_rule: perRuleLuar,
    alert: luarSrcKeluar,
  });

  // ---- Tugas 3: enam field, urut stabil, id CQL-xx ----
  // Urutan: berkas lalu baris lalu rule, supaya penomoran tidak bergantung urutan baca SARIF.
  dalamSrc.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || (a.baris ?? 0) - (b.baris ?? 0) || a.rule.localeCompare(b.rule));
  dalamSrc.forEach((a, i) => { a.id = `CQL-${String(i + 1).padStart(2, '0')}`; });
  const alertKeluar = dalamSrc.map((a) => ({
    id: a.id,
    rule: a.rule,
    tipe: a.tipe,
    sumber: 'codeql',
    file: a.file,
    baris: a.baris,
    cwe: a.cwe,
    pesan: a.pesan,
    severity_codeql: a.security_severity,
    severity_asal: 'codeql',
    precision_codeql: a.precision,
    suite: a.suite,
    hanya_extended: a.suite.length === 1 && a.suite[0] === 'extended',
    entri_sarif_digabung: a.entri_digabung,
    kolom: a.kolom,
    tags: a.tags,
  }));
  tulisJson(path.join(out, 'alert-codeql.json'), alertKeluar);

  const tanpaCwe = alertKeluar.filter((a) => a.cwe.length === 0);
  tulisJson(path.join(out, 'security-tanpa-cwe.json'), tanpaCwe);

  // ---- Tugas 4: skor terhadap 19 item ground truth ----
  // Bentuk v1 yang sama dengan alertKeV1 di scripts/llm/score.js:32-34, hanya `sumber` berbeda.
  const keV1 = (a) => ({ file: a.file, baris: a.baris, cwe: a.cwe.join(', '), jenis: `${a.sumber} ${a.rule}`, penjelasan: a.pesan ?? '' });
  // Medan hasil nilaiTemuan dipetakan satu per satu, tidak di-spread: nilaiTemuan mengembalikan
  // `id` berisi ARRAY id ground truth, yang kalau di-spread akan menimpa id CQL-xx alertnya dan
  // membuat keluaran kehilangan keterlacakan ke alertnya sendiri.
  const nilai = alertKeluar.map((a) => {
    const p = gs.nilaiTemuan(keV1(a), gt);
    return {
      id: a.id, rule: a.rule, lokasi: `${a.file}:${a.baris}`,
      status: p.status, id_gt: p.id, alasan: p.alasan ?? null,
      fungsi_terdeteksi: p.fungsi_terdeteksi ?? null, cwe_terbaca: p.cwe,
    };
  });

  // Status terbaik per item ground truth, aturan sama dengan nilaiHimpunan di scripts/llm/score.js:
  // "false positive dikenal" dibaca sebagai "cocok", lalu status terbaik dipilih lewat URUTAN_STATUS.
  const statusPerGt = {};
  for (const g of gt) {
    const status = nilai
      .filter((p) => p.id_gt.includes(g.id))
      .map((p) => (p.status === 'false positive dikenal' ? 'cocok' : p.status));
    statusPerGt[g.id] = gs.URUTAN_STATUS.find((s) => status.includes(s)) ?? 'tidak';
  }
  const metrik = gs.hitungMetrik(gt, statusPerGt, nilai.map((p) => ({ status: p.status, sifat: null, asal: 'codeql', id: p.id_gt })));
  tulisJson(path.join(out, 'skor-codeql.json'), {
    catatan: 'Deteksi mentah CodeQL tanpa triase dan tanpa verifikasi LLM. Bukan angka skenario A, B, atau C.',
    aturan_pencocokan: 'scripts/gemini-scan.js nilaiTemuan dan hitungMetrik, dipanggil apa adanya',
    jumlah_alert_dinilai: alertKeluar.length,
    status_per_item: statusPerGt,
    metrik,
    penilaian: nilai,
  });

  // ---- Tugas 5: tumpang tindih dengan SONAR-01..05 ----
  const sonar = bacaJson(fileSonar);
  const nilaiSonar = sonar.map((a) => {
    const p = gs.nilaiTemuan({ file: a.file, baris: a.baris, cwe: (a.cwe ?? []).join(', '), jenis: `${a.sumber} ${a.rule}`, penjelasan: a.pesan ?? '' }, gt);
    return { id: a.id, rule: a.rule, lokasi: `${a.file}:${a.baris}`, status: p.status, id_gt: p.id };
  });
  const gtCodeql = new Set(nilai.flatMap((p) => p.id_gt));
  const gtSonar = new Set(nilaiSonar.flatMap((p) => p.id_gt));
  const tumpang = {
    per_item: Object.fromEntries(gt.map((g) => [g.id, {
      codeql: gtCodeql.has(g.id), sonar: gtSonar.has(g.id),
      hanya_codeql: gtCodeql.has(g.id) && !gtSonar.has(g.id),
      hanya_sonar: gtSonar.has(g.id) && !gtCodeql.has(g.id),
      keduanya: gtCodeql.has(g.id) && gtSonar.has(g.id),
    }])),
    lokasi_sama: [],
  };
  for (const a of alertKeluar) {
    for (const s of sonar) {
      if (a.file === s.file && a.baris === s.baris) tumpang.lokasi_sama.push({ codeql: a.id, sonar: s.id, lokasi: `${a.file}:${a.baris}`, rule_codeql: a.rule, rule_sonar: s.rule });
    }
  }
  tulisJson(path.join(out, 'tumpang-tindih-sonar.json'), { alert_sonar: nilaiSonar, ...tumpang });

  // ---- Tugas 6: alert tingkat 1 di dalam src/ yang TIDAK cocok ground truth ----
  const TERDETEKSI = ['cocok', 'cocok lokasi'];
  const takCocok = nilai.filter((p) => !TERDETEKSI.includes(p.status));
  const baris = ['# Alert CodeQL tanpa kecocokan ground truth', '',
    'Tingkat 1 (bertag security), di dalam `src/**`, status pencocokan bukan `cocok` maupun `cocok lokasi`.',
    'Daftar ini TIDAK diberi label benar atau salah. Triase manual dilakukan penulis TA.', '',
    '| ID | Rule | Lokasi | Status pencocokan | Pesan |', '|---|---|---|---|---|'];
  for (const p of takCocok) {
    const a = alertKeluar.find((x) => x.id === p.id);
    const pesan = String(a?.pesan ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    baris.push(`| ${p.id} | \`${p.rule}\` | \`${p.lokasi}\` | ${p.status} | ${pesan} |`);
  }
  baris.push('', `Jumlah: ${takCocok.length} dari ${alertKeluar.length} alert tingkat 1 di dalam src/.`, '');
  fs.writeFileSync(path.join(out, 'alert-tak-cocok.md'), baris.join('\n'));

  // ---- Ringkasan ke stdout ----
  console.log(`Gerbang sanity: src .js = ${gerbang.extended.bukti_pengganti.src_js} dan ${gerbang['code-scanning'].bukti_pengganti.src_js}; galat ekstraksi = ${gerbang.extended.bukti_pengganti.notifikasi_error_atau_warning} dan ${gerbang['code-scanning'].bukti_pengganti.notifikasi_error_atau_warning}`);
  console.log(`Entri SARIF mentah: ${entriMentah} (${JSON.stringify(mentahPerSuite)})`);
  console.log(`Tingkat 2: ${Object.values(tingkat2).reduce((s, x) => s + x.jumlah, 0)} entri, ${Object.keys(tingkat2).length} rule`);
  console.log(`Tingkat 3: ${Object.values(tingkat3).reduce((s, x) => s + x.jumlah, 0)} entri, ${Object.keys(tingkat3).length} rule`);
  console.log(`Tingkat 1: ${semua.length} alert setelah gabung; di dalam src/ ${dalamSrc.length}, di luar src/ ${luarSrc.length}`);
  console.log(`Hanya di extended: ${alertKeluar.filter((a) => a.hanya_extended).length} di dalam src/, ${luarSrcKeluar.filter((a) => a.hanya_extended).length} di luar src/`);
  console.log(`Security tanpa CWE: ${tanpaCwe.length}`);
  console.log(`Metrik ketat: tp ${metrik.ketat.tp} fp ${metrik.ketat.fp} fn ${metrik.ketat.fn} P ${metrik.ketat.precision} R ${metrik.ketat.recall} F1 ${metrik.ketat.f1}`);
  console.log(`Keluaran di ${out}`);
};

if (require.main === module) main();
