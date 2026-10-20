// Gabungkan temuan SonarCloud dan Gemini dari output gemini-scan.js menjadi results.json (skema v1,
// docs/design/results.schema.json), tulis Job Summary, dan terbitkan ke folder branch security-results.
// Skrip ini tidak memanggil API apa pun dan tidak memakai aturan penilaian eksperimen.
//
// Pemakaian:
//   node scripts/merge-results.js merge --input=gemini-output --out=results.json [--summary=<file>]
//   node scripts/merge-results.js publish --results=results.json --dir=<worktree security-results>
//     (skema diambil dari isi results.json; --v2 hanya penanda eksplisit di workflow)
//
// Jalur v2 (prompt v2, docs/design/results-v2.schema.json), tanpa panggilan API:
//   node scripts/merge-results.js merge --v2 --folder=<folder llm-scan> --run=N --out=<file>
//     [--skor=<skor-utama.json> --skor-triase=<...> --skor-triase-konservatif=<...>] [--repo=owner/repo]
//     [--objek=<worktree objek uji>]  (untuk potongan kode di sekitar baris temuan)
//     [--biaya=<folder induk vendor>] (untuk biaya per run dan per vendor di blok eksperimen)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = 1;
const BATAS_INDEX = 50;

const URUTAN_SEVERITY = ['kritis', 'tinggi', 'sedang', 'rendah'];
const SEVERITY_SONAR = {
  BLOCKER: 'kritis', CRITICAL: 'tinggi', MAJOR: 'sedang', MINOR: 'rendah', INFO: 'rendah',
  HIGH: 'tinggi', MEDIUM: 'sedang', LOW: 'rendah',
};
// Gemini tidak memberi severity. Nilai diturunkan dari CWE, default sedang.
const SEVERITY_CWE = {
  kritis: [77, 78, 89, 94, 502, 943],
  tinggi: [22, 79, 284, 285, 287, 306, 352, 434, 639, 798, 862, 863, 915],
};

const ambilArg = (nama) => {
  const arg = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return arg ? arg.slice(nama.length + 3) : null;
};

const bacaJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const tulisJson = (file, isi) => fs.writeFileSync(file, `${JSON.stringify(isi, null, 2)}\n`);
const teks = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const angka = (v) => (Number.isInteger(v) ? v : Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : null);

const parseCwe = (nilai) => {
  const daftar = Array.isArray(nilai) ? nilai.join(',') : String(nilai ?? '');
  return [...new Set((daftar.match(/CWE-?\s*(\d+)/gi) || []).map((c) => `CWE-${c.match(/\d+/)[0]}`))];
};

const severityDariCwe = (cwe) => {
  const nomor = cwe.map((c) => Number(c.slice(4)));
  if (nomor.some((n) => SEVERITY_CWE.kritis.includes(n))) return 'kritis';
  if (nomor.some((n) => SEVERITY_CWE.tinggi.includes(n))) return 'tinggi';
  return 'sedang';
};

const lebihParah = (a, b) => (URUTAN_SEVERITY.indexOf(a) <= URUTAN_SEVERITY.indexOf(b) ? a : b);

// Path dari laporan LLM tidak tepercaya: hanya file di dalam repo yang boleh dibaca.
const potonganKode = (root, file, baris) => {
  if (!file || !baris) return null;
  const lengkap = path.resolve(root, file);
  if (!lengkap.startsWith(root + path.sep) || !fs.existsSync(lengkap) || !fs.statSync(lengkap).isFile()) return null;
  const semua = fs.readFileSync(lengkap, 'utf8').split(/\r?\n/);
  if (baris > semua.length) return null;
  const mulai = Math.max(1, baris - 3);
  return { mulai, baris: semua.slice(mulai - 1, Math.min(semua.length, baris + 3)) };
};

const normalSonar = (t) => {
  const cwe = parseCwe(t.cwe);
  const rule = teks(t.jenis)?.replace(/^(issue|hotspot)\s+/, '') ?? null;
  return {
    asal: 'sonar', file: teks(t.file), baris: angka(t.baris), cwe, kategori_owasp: teks(t.kategori_owasp),
    judul: teks(t.penjelasan) ?? rule ?? 'Temuan SonarCloud', alasan: teks(t.penjelasan), sonar_rule: rule,
    severity: SEVERITY_SONAR[String(t.keyakinan).toUpperCase()] ?? 'sedang', severity_asal: 'sonar',
  };
};

const normalGemini = (t) => {
  const cwe = parseCwe(t.cwe);
  return {
    asal: 'gemini', file: teks(t.file), baris: angka(t.baris), cwe, kategori_owasp: teks(t.kategori_owasp),
    judul: teks(t.jenis) ?? 'Temuan Gemini', alasan: teks(t.penjelasan), keyakinan: teks(t.keyakinan),
    severity: severityDariCwe(cwe), severity_asal: 'turunan-cwe',
  };
};

// Cocok bila file sama, baris berdekatan (maks 3), dan CWE beririsan.
// Tanpa CWE di salah satu sisi, baris harus sama persis.
const cocok = (s, g) => {
  if (!s.file || s.file !== g.file || s.baris === null || g.baris === null) return false;
  const jarak = Math.abs(s.baris - g.baris);
  if (s.cwe.length === 0 || g.cwe.length === 0) return jarak === 0;
  return jarak <= 3 && s.cwe.some((c) => g.cwe.includes(c));
};

const sidikJari = (f) => crypto.createHash('sha256')
  .update(`${f.file ?? ''}:${f.baris ?? ''}|${[...f.cwe].sort().join(',')}|${f.judul.toLowerCase()}`).digest('hex').slice(0, 16);

const gabungTemuan = ({ sonar, gemini, geminiBerjalan, root }) => {
  const s = sonar.map(normalSonar);
  const g = gemini.map(normalGemini);
  const terpakai = new Set();
  const hasil = [];

  for (const item of s) {
    const idx = geminiBerjalan ? g.findIndex((x, i) => !terpakai.has(i) && cocok(item, x)) : -1;
    if (idx >= 0) {
      terpakai.add(idx);
      const pasangan = g[idx];
      hasil.push({
        ...item, sumber: 'both', status_ai: 'confirmed',
        severity: lebihParah(item.severity, pasangan.severity),
        cwe: [...new Set([...item.cwe, ...pasangan.cwe])],
        kategori_owasp: item.kategori_owasp ?? pasangan.kategori_owasp,
        alasan: pasangan.alasan ?? item.alasan, keyakinan: pasangan.keyakinan,
      });
    } else {
      hasil.push({ ...item, sumber: 'sonar', status_ai: geminiBerjalan ? 'rejected' : null });
    }
  }
  g.forEach((item, i) => {
    if (!terpakai.has(i)) hasil.push({ ...item, sumber: 'gemini', status_ai: 'new' });
  });

  hasil.sort((a, b) => URUTAN_SEVERITY.indexOf(a.severity) - URUTAN_SEVERITY.indexOf(b.severity)
    || (a.file ?? '').localeCompare(b.file ?? '') || (a.baris ?? 0) - (b.baris ?? 0));

  const lebar = Math.max(2, String(hasil.length).length);
  return hasil.map((f, i) => ({
    id: `T-${String(i + 1).padStart(lebar, '0')}`,
    fingerprint: sidikJari(f),
    judul: f.judul,
    severity: f.severity,
    severity_asal: f.severity_asal,
    kategori_owasp: f.kategori_owasp,
    cwe: f.cwe,
    file: f.file,
    baris: f.baris,
    sumber: f.sumber,
    status_ai: f.status_ai,
    status_ai_asal: f.status_ai ? 'turunan-pencocokan' : null,
    alasan: f.alasan,
    rekomendasi: null,
    keyakinan_gemini: f.keyakinan ?? null,
    sonar_rule: f.sonar_rule ?? null,
    potongan_kode: potonganKode(root, f.file, f.baris),
  }));
};

const verifikasiSonar = (findings, geminiBerjalan) => {
  const dariSonar = findings.filter((f) => f.sumber !== 'gemini');
  return {
    dikonfirmasi: dariSonar.filter((f) => f.status_ai === 'confirmed').length,
    ditolak: dariSonar.filter((f) => f.status_ai === 'rejected').length,
    perlu_review: geminiBerjalan ? 0 : dariSonar.length,
    asal: 'turunan-pencocokan',
  };
};

// Data Sonar hanya dianggap tersedia bila analisis branch ditemukan dan semua panggilan API berhasil.
// Tanpa ini, daftar kosong karena galat API terbaca sebagai "0 temuan".
const statusSast = (ringkasan, sonarTemuan) => {
  if (!sonarTemuan) return { status: 'tidak-tersedia', galat: 'Output temuan Sonar tidak ditemukan' };
  const sonar = ringkasan?.sonar;
  if (!sonar) return { status: null, galat: null };
  const galat = (sonar.galat ?? []).map(String).filter(Boolean);
  if (galat.length) return { status: 'tidak-tersedia', galat: galat.join('; ').slice(0, 400) };
  if (!sonar.analisis) return { status: 'tidak-tersedia', galat: `SonarCloud tidak punya analisis untuk branch ${sonar.branch ?? '-'}` };
  return { status: 'ok', galat: null };
};

// Susun results.json dari bahan yang sudah dibaca. Fungsi murni kecuali membaca potongan kode dari root.
const susunHasil = ({ meta, sonarTemuan, geminiRun, ringkasan, skor, root = ROOT }) => {
  const geminiBerjalan = Boolean(geminiRun && geminiRun.parse_ok);
  const findings = gabungTemuan({
    sonar: sonarTemuan?.temuan ?? [], gemini: geminiBerjalan ? geminiRun.temuan : [], geminiBerjalan, root,
  });
  const revisi = ringkasan?.sonar?.analisis?.revisi ?? null;
  const sast = statusSast(ringkasan, sonarTemuan);
  const selesai = meta.selesai ?? new Date().toISOString();
  const durasi = meta.mulai ? Math.max(0, Math.round((Date.parse(selesai) - Date.parse(meta.mulai)) / 1000)) : null;

  let statusGemini = 'dilewati';
  if (meta.mode === 'sast-llm') statusGemini = geminiBerjalan ? 'ok' : 'gagal';

  const hasil = {
    schema_version: SCHEMA_VERSION,
    run: {
      id: angka(meta.id), nomor: angka(meta.nomor), repo: meta.repo, commit: meta.commit, branch: meta.branch,
      label: teks(meta.label), mulai: meta.mulai ?? null, selesai, durasi_detik: durasi,
      mode: meta.mode, model: meta.mode === 'sast-llm' ? (geminiRun?.model_diminta ?? meta.model ?? null) : null,
      prompt_sha256: meta.mode === 'sast-llm' ? (geminiRun?.prompt_sha256 ?? ringkasan?.prompt?.sha256 ?? null) : null,
      sast: { alat: 'SonarCloud', status: sast.status, galat: sast.galat, revisi_analisis: revisi, sesuai_commit: revisi ? revisi === meta.commit : null },
      gemini: {
        status: statusGemini,
        parse_ok: meta.mode === 'sast-llm' ? Boolean(geminiRun?.parse_ok) : null,
        jumlah_temuan: geminiBerjalan ? geminiRun.temuan.length : null,
        galat: meta.mode === 'sast-llm' && !geminiBerjalan ? (teks(geminiRun?.galat) ?? 'Output Gemini tidak tersedia') : null,
      },
      jobs: meta.jobs ?? {},
    },
    findings,
    sonar_verification: verifikasiSonar(findings, geminiBerjalan),
  };
  if (skor?.metrik) hasil.metrics = { sumber: skor.sumber ?? null, ...skor.metrik };
  return hasil;
};

// Folder output gemini-scan.js bernama waktu (YYYYMMDD-HHMMSS); ambil yang terbaru.
const folderTerbaru = (input) => {
  if (!fs.existsSync(input)) return null;
  const sub = fs.readdirSync(input, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{6}$/.test(d.name)).map((d) => d.name).sort();
  return sub.length ? path.join(input, sub[sub.length - 1]) : null;
};

const bacaBahan = (input) => {
  const folder = folderTerbaru(input);
  const coba = (nama) => (folder && fs.existsSync(path.join(folder, nama)) ? bacaJson(path.join(folder, nama)) : null);
  const ringkasan = coba('summary.json') ?? coba('prompt-info.json');
  return { folder, sonarTemuan: coba('sonar-temuan.json'), geminiRun: coba('run-1.json'), ringkasan, skor: coba('run-1.score.json') };
};

// Teks dari LLM masuk ke Markdown Job Summary: netralkan markup dan pemisah tabel.
const sel = (v) => String(v ?? '-').replace(/[\r\n]+/g, ' ').replace(/[<>&|`\\[\]]/g, (c) => `&#${c.charCodeAt(0)};`).slice(0, 200);

const ringkasanMarkdown = (r) => {
  const hitung = (pred) => r.findings.filter(pred).length;
  const baris = [
    `## Hasil analisis keamanan · run #${r.run.nomor}`,
    '',
    `Commit \`${r.run.commit.slice(0, 7)}\` · branch ${sel(r.run.branch)} · mode ${r.run.mode}`
      + `${r.run.model ? ` · model ${sel(r.run.model)}` : ''}${r.run.durasi_detik !== null ? ` · ${r.run.durasi_detik} detik` : ''}`,
    '',
    '| Kritis | Tinggi | Sedang | Rendah | Sonar | Gemini | Keduanya | Ditolak AI |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${URUTAN_SEVERITY.map((s) => hitung((f) => f.severity === s)).join(' | ')} | ${hitung((f) => f.sumber === 'sonar')} | `
      + `${hitung((f) => f.sumber === 'gemini')} | ${hitung((f) => f.sumber === 'both')} | ${hitung((f) => f.status_ai === 'rejected')} |`,
    '',
  ];
  if (r.run.gemini.status === 'gagal') baris.push(`> Analisis Gemini gagal: ${sel(r.run.gemini.galat)}`, '');
  if (r.run.sast.status === 'tidak-tersedia') baris.push(`> Data SonarCloud tidak tersedia: ${sel(r.run.sast.galat)}. Jumlah temuan di bawah tidak mencakup Sonar.`, '');
  if (r.run.sast.sesuai_commit === false) baris.push(`> Data Sonar berasal dari analisis commit ${sel(r.run.sast.revisi_analisis)}, bukan commit run ini.`, '');
  if (r.findings.length === 0) {
    baris.push('Tidak ada temuan.');
  } else {
    baris.push('| No | Severity | Temuan | Lokasi | Sumber | Status AI |', '|---|---|---|---|---|---|');
    for (const f of r.findings) {
      baris.push(`| ${f.id} | ${f.severity} | ${sel(f.judul)} | ${sel(f.file)}:${f.baris ?? '-'} | ${f.sumber} | ${f.status_ai ?? '-'} |`);
    }
  }
  baris.push('', 'Status AI dan severity Gemini diturunkan dari pencocokan dan tabel CWE, bukan putusan eksplisit model. Rekomendasi AI belum tersedia.');
  return `${baris.join('\n')}\n`;
};

// Nama branch dipakai sebagai path: buang segmen yang bisa keluar dari folder.
const pathBranch = (branch) => String(branch).split('/').filter((s) => s && s !== '.' && s !== '..')
  .map((s) => s.replace(/[^A-Za-z0-9._-]/g, '_')).join('/');

const entriIndex = (r, relPath) => ({
  id: r.run.id, nomor: r.run.nomor, branch: r.run.branch, commit: r.run.commit, label: r.run.label,
  mode: r.run.mode, model: r.run.model, mulai: r.run.mulai, selesai: r.run.selesai, durasi_detik: r.run.durasi_detik,
  path: relPath, gemini: r.run.gemini.status,
  jumlah: Object.fromEntries([['total', r.findings.length], ...URUTAN_SEVERITY.map((s) => [s, r.findings.filter((f) => f.severity === s).length])]),
});

const perbaruiIndex = (index, entri) => {
  const runs = (index?.runs ?? []).filter((x) => x.id !== entri.id);
  runs.unshift(entri);
  runs.sort((a, b) => (b.selesai ?? '').localeCompare(a.selesai ?? ''));
  return { schema_version: SCHEMA_VERSION, diperbarui: entri.selesai, runs: runs.slice(0, BATAS_INDEX) };
};

// Satu berkas index per skema. Skema 1 dan 2 punya bentuk entri yang berbeda sehingga tidak bisa
// bercampur dalam satu daftar; sebelumnya keduanya memakai index.json yang sama dan penerbitan
// jalur mana pun MENGHAPUS entri jalur lain (itu yang menghilangkan hasil v2 run #46). Sekarang
// index.json milik skema 2 — satu-satunya yang dibaca dashboard — dan jalur v1 menulis ke
// index-v1.json, jadi tidak ada jalur penerbitan yang bisa membuang entri skema lain.
const FILE_INDEX = { 1: 'index-v1.json', 2: 'index.json' };

// Menerbitkan results.json ke worktree branch security-results dan memperbarui index skemanya.
const terbitkan = (fileHasil, dir) => {
  const r = bacaJson(fileHasil);
  const v2 = r.schema_version === 2;
  const namaIndex = FILE_INDEX[r.schema_version];
  if (!namaIndex) throw new Error(`schema_version ${r.schema_version} tidak punya berkas index`);
  const branch = v2 ? (r.run.objek_uji?.branch ?? 'main') : r.run.branch;
  const relPath = `${pathBranch(branch)}/${r.run.nomor}.json`;
  fs.mkdirSync(path.join(dir, path.dirname(relPath)), { recursive: true });
  tulisJson(path.join(dir, relPath), r);
  const fileIndex = path.join(dir, namaIndex);
  const lama = fs.existsSync(fileIndex) ? bacaJson(fileIndex) : null;
  // Berkas index hanya boleh berisi skemanya sendiri. Kalau isinya skema lain, itu sisa dari aturan
  // lama: berhenti dan minta dirapikan, jangan diam-diam menimpanya seperti dulu.
  if (lama && (lama.schema_version ?? 1) !== r.schema_version) {
    throw new Error(`${namaIndex} berisi skema ${lama.schema_version ?? 1}, bukan ${r.schema_version}. `
      + 'Penerbitan dihentikan supaya tidak ada entri yang terbuang; rapikan berkas index itu dulu.');
  }
  const entri = v2 ? require('./llm/results-v2').entriIndexV2(r, relPath) : entriIndex(r, relPath);
  const baru = perbaruiIndex(lama, entri);
  baru.schema_version = r.schema_version;
  tulisJson(fileIndex, baru);
  console.log(`Diterbitkan (skema ${r.schema_version}): ${relPath} -> ${namaIndex}`);
};

const metaDariEnv = (env) => ({
  id: env.GITHUB_RUN_ID, nomor: env.GITHUB_RUN_NUMBER, repo: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA,
  branch: env.GITHUB_REF_NAME, label: env.RUN_LABEL, mulai: teks(env.RUN_STARTED_AT), mode: env.MODE, model: teks(env.MODEL),
  jobs: { build_test: teks(env.JOB_BUILD_TEST), sonarcloud: teks(env.JOB_SONARCLOUD), analisis: teks(env.JOB_ANALISIS) },
});

// Mode v2: baca satu folder keluaran llm-scan.js (summary.json, run-N.json, sonar-alert.json) dan,
// bila diberikan, laporan skor llm-score.js untuk blok eksperimen. Tidak memanggil API apa pun.
const mergeV2 = () => {
  const { susunHasilV2, susunEksperimen } = require('./llm/results-v2');
  const folder = path.resolve(ambilArg('folder') || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('--folder wajib: folder hasil llm-scan (berisi summary.json)');
  const bacaJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const summary = bacaJson(path.join(folder, 'summary.json'));
  const indeksRun = Number(ambilArg('run') || 1);
  // --nomor memisahkan nomor run di dashboard dari indeks berkas run-N.json, supaya beberapa vendor
  // bisa tampil sebagai beberapa run berurutan dalam satu daftar.
  const nomor = Number(ambilArg('nomor') || indeksRun);
  const fileRun = path.join(folder, `run-${indeksRun}.json`);
  if (!fs.existsSync(fileRun)) throw new Error(`run-${indeksRun}.json tidak ada di ${folder}`);
  const run = bacaJson(fileRun);
  const fileAlert = path.join(folder, 'sonar-alert.json');
  const alert = fs.existsSync(fileAlert) ? bacaJson(fileAlert) : [];

  // --biaya menunjuk folder induk yang memuat subfolder tiap vendor (mis. .../utama/),
  // dipakai mengisi biaya per run dan per vendor di blok eksperimen.
  const biayaVendor = {};
  const dirBiaya = ambilArg('biaya') ? path.resolve(ambilArg('biaya')) : null;
  if (dirBiaya) {
    for (const nama of fs.readdirSync(dirBiaya)) {
      const f = path.join(dirBiaya, nama, 'summary.json');
      if (!fs.existsSync(f)) continue;
      const sm = bacaJson(f);
      const perRun = {};
      for (const r of sm.runs ?? []) if (typeof r.biaya_usd === 'number') perRun[String(r.run)] = r.biaya_usd;
      biayaVendor[sm.vendor] = { total_usd: sm.biaya_total_usd ?? null, per_run: perRun };
    }
  }

  const skorUtama = ambilArg('skor');
  let eksperimen = null;
  if (skorUtama) {
    eksperimen = susunEksperimen({
      utama: bacaJson(path.resolve(skorUtama)),
      triaseUtama: ambilArg('skor-triase') ? bacaJson(path.resolve(ambilArg('skor-triase'))) : null,
      triaseKonservatif: ambilArg('skor-triase-konservatif') ? bacaJson(path.resolve(ambilArg('skor-triase-konservatif'))) : null,
      sensitivitas: ambilArg('skor-sensitivitas') ? bacaJson(path.resolve(ambilArg('skor-sensitivitas'))) : null,
      biayaVendor,
      sumber: {
        skor_utama: path.basename(skorUtama),
        skor_triase_utama: ambilArg('skor-triase') ? path.basename(ambilArg('skor-triase')) : null,
        skor_triase_konservatif: ambilArg('skor-triase-konservatif') ? path.basename(ambilArg('skor-triase-konservatif')) : null,
        skor_sensitivitas: ambilArg('skor-sensitivitas') ? path.basename(ambilArg('skor-sensitivitas')) : null,
      },
    });
  }

  // --objek menunjuk worktree objek uji; dipakai hanya untuk mengambil potongan kode di sekitar baris temuan.
  const objek = ambilArg('objek') ? path.resolve(ambilArg('objek')) : null;
  if (objek && !fs.existsSync(objek)) throw new Error(`--objek ${objek} tidak ada`);
  const potongan = objek ? ((file, baris) => potonganKode(objek, file, baris)) : null;
  // --id adalah run id GitHub (bukan run number); dipakai dashboard untuk menarik status job.
  const idRun = ambilArg('id') ? Number(ambilArg('id')) : null;
  const hasil = susunHasilV2({ summary, run, nomor, id: idRun, alert, parseCwe, repo: ambilArg('repo') || null, eksperimen, potongan });
  tulisJson(ambilArg('out') || 'results-v2.json', hasil);
  console.log(`results v2: ${hasil.findings.length} temuan, ${hasil.alerts.length} alert, vendor ${hasil.run.vendor}, eksperimen ${eksperimen ? 'ada' : 'tidak'}`);
};

const main = () => {
  const perintah = process.argv[2];
  if (perintah === 'merge' && process.argv.includes('--v2')) return mergeV2();
  if (perintah === 'merge') {
    const bahan = bacaBahan(ambilArg('input') || path.join(ROOT, 'gemini-output'));
    if (!bahan.folder) console.warn('Peringatan: folder output gemini-scan tidak ditemukan, hasil berisi nol temuan');
    const meta = metaDariEnv(process.env);
    if (!['sast', 'sast-llm'].includes(meta.mode)) throw new Error(`MODE harus sast atau sast-llm, bukan "${meta.mode}"`);
    const hasil = susunHasil({ meta, ...bahan });
    tulisJson(ambilArg('out') || 'results.json', hasil);
    const summary = ambilArg('summary');
    if (summary) fs.appendFileSync(summary, ringkasanMarkdown(hasil));
    console.log(`results.json: ${hasil.findings.length} temuan, Gemini ${hasil.run.gemini.status}`);
    return;
  }
  if (perintah === 'publish') return terbitkan(ambilArg('results') || 'results.json', ambilArg('dir'));
  throw new Error('Perintah: merge atau publish');
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  susunHasil, gabungTemuan, ringkasanMarkdown, perbaruiIndex, entriIndex, pathBranch, parseCwe, potonganKode,
  terbitkan, FILE_INDEX,
};
