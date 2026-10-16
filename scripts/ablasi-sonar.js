// Ablasi konteks Sonar: prompt eksperimen 10 Okt 2026 dikirim dengan (A) dan tanpa (B) laporan SonarCloud.
// Rancangan dan aturan analisis dikunci di hasil-eksperimen/ablasi-sonar-20261016/PRAREGISTRASI.md.
//
// Pemakaian (dari root repo):
//   node scripts/ablasi-sonar.js --siapkan                 susun prompt-A.txt dan prompt-B.txt, tanpa memanggil API
//   node scripts/ablasi-sonar.js --jalankan --env=<path>   jalankan A1 B1 A2 B2 A3 B3 lalu nilai tiap run
//   node scripts/ablasi-sonar.js --hanya=B2 --env=<path>   ulang satu run (aturan run gagal di praregistrasi)
//
// Request ke Gemini dibuat sama dengan gemini-scan.js: body, generationConfig, retry, dan jeda antar run.
// Penilaian memakai gemini-scan.js --score-file tanpa perubahan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FOLDER = path.join(ROOT, 'hasil-eksperimen', 'ablasi-sonar-20261016');
const FOLDER_RAW = path.join(ROOT, 'gemini-output', 'ablasi-sonar-20261016');
const PROMPT_ARSIP = path.join(ROOT, 'hasil-eksperimen', '20261010', 'prompt-lengkap.txt');
// Hash arsip versi LF. Isinya sama dengan prompt eksperimen (de8f35e0…), yang berbeda hanya CRLF di bagian kode.
const SHA_ARSIP = '355989292f5e81ac494a8d51f28ce9afa44dfadf3eda60f0fc3d1c7d61ad38b8';
const PENANDA_SONAR = '===== LAPORAN SONARCLOUD =====\n';
const PENANDA_KODE = '\n\n===== KODE SUMBER =====\n';
// Teks yang sama dengan yang dipakai gemini-scan.js saat laporan Sonar kosong
const PENGGANTI_SONAR = '(laporan SonarCloud kosong atau tidak tersedia)';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TEMPERATURE = 0.2;
const RETRIES = 5;
const JEDA_ANTAR_RUN_DETIK = 60;
const STATUS_ULANG = [429, 500, 502, 503, 504];
const URUTAN = ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'];
const TARIF = { model: 'gemini-3.8-flash', usd_per_1m_token_input: 0.75, usd_per_1m_token_output: 3.75 };

const ambilArg = (nama) => {
  const arg = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return arg ? arg.slice(nama.length + 3) : null;
};
const MODEL = ambilArg('model') || 'gemini-3.8-flash';
const sha256 = (teks) => crypto.createHash('sha256').update(teks, 'utf8').digest('hex');
const tulisJson = (file, isi) => fs.writeFileSync(file, JSON.stringify(isi, null, 2));
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
const relatif = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ---------- Prompt ----------

const susunPromptAblasi = () => {
  const arsip = fs.readFileSync(PROMPT_ARSIP, 'utf8');
  if (sha256(arsip) !== SHA_ARSIP) throw new Error(`Hash ${relatif(PROMPT_ARSIP)} tidak sama dengan arsip, berhenti`);
  const awal = arsip.indexOf(PENANDA_SONAR);
  const akhir = arsip.indexOf(PENANDA_KODE);
  if (awal < 0 || akhir < awal) throw new Error('Blok laporan SonarCloud tidak ditemukan di prompt arsip');
  const mulaiBlok = awal + PENANDA_SONAR.length;
  const blokSonar = arsip.slice(mulaiBlok, akhir);
  const promptB = arsip.slice(0, mulaiBlok) + PENGGANTI_SONAR + arsip.slice(akhir);
  return { A: arsip, B: promptB, jumlahBarisSonar: blokSonar.split('\n').length, karakterSonar: blokSonar.length };
};

const siapkan = () => {
  fs.mkdirSync(FOLDER, { recursive: true });
  const p = susunPromptAblasi();
  const info = {};
  for (const k of ['A', 'B']) {
    const file = path.join(FOLDER, `prompt-${k}.txt`);
    fs.writeFileSync(file, p[k], 'utf8');
    fs.writeFileSync(path.join(FOLDER, `prompt-${k}.sha256`), `${sha256(p[k])}  prompt-${k}.txt\n`);
    info[k] = { file: relatif(file), sha256: sha256(p[k]), karakter: p[k].length };
  }
  console.log(`Blok Sonar di A: ${p.jumlahBarisSonar} baris, ${p.karakterSonar} karakter; di B diganti "${PENGGANTI_SONAR}"`);
  for (const k of ['A', 'B']) console.log(`prompt-${k}: ${info[k].karakter} karakter, SHA-256 ${info[k].sha256}`);
  return info;
};

// Prompt yang dikirim dibaca dari file di folder ablasi dan dicek ulang terhadap .sha256 yang dikunci
const bacaPromptTerkunci = (k) => {
  const teks = fs.readFileSync(path.join(FOLDER, `prompt-${k}.txt`), 'utf8');
  const terkunci = fs.readFileSync(path.join(FOLDER, `prompt-${k}.sha256`), 'utf8').split(/\s+/)[0];
  if (sha256(teks) !== terkunci) throw new Error(`prompt-${k}.txt berubah dari hash yang dikunci, berhenti`);
  const ulang = susunPromptAblasi()[k];
  if (ulang !== teks) throw new Error(`prompt-${k}.txt tidak sama dengan hasil susun ulang dari arsip, berhenti`);
  return { teks, sha: terkunci };
};

// ---------- Gemini (meniru gemini-scan.js) ----------

const headerGemini = () => ({ 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY });

const infoModel = async () => {
  const res = await fetch(`${GEMINI_BASE}/models/${MODEL}`, { headers: headerGemini() });
  if (!res.ok) {
    // Pesan galat Google tidak memuat key, tetapi tetap dipotong supaya log ringkas
    throw new Error(`Cek awal gagal (${res.status}): ${(await res.text()).slice(0, 200)}. Tidak ada run yang dijalankan.`);
  }
  return res.json();
};

const panggilGemini = async (prompt, maxOutputTokens) => {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: TEMPERATURE, maxOutputTokens, responseMimeType: 'application/json' },
  });
  const percobaan = [];
  for (let i = 1; i <= RETRIES; i++) {
    let status = null;
    let isi = null;
    const mulaiPercobaan = new Date();
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${MODEL}:generateContent`, { method: 'POST', headers: headerGemini(), body });
      status = res.status;
      const teks = await res.text();
      try { isi = JSON.parse(teks); } catch { isi = { teks_mentah: teks }; }
      if (res.ok) {
        percobaan.push({ ke: i, status });
        return { ok: true, status, isi, percobaan, mulaiTerakhir: mulaiPercobaan };
      }
    } catch (err) {
      isi = { galat_jaringan: err.message };
    }
    percobaan.push({ ke: i, status, pesan: isi?.error?.message ?? isi?.galat_jaringan ?? null });
    const bolehUlang = status === null || STATUS_ULANG.includes(status);
    if (!bolehUlang || i === RETRIES) return { ok: false, status, isi, percobaan, mulaiTerakhir: mulaiPercobaan };
    const detail = isi?.error?.details?.find((d) => d.retryDelay);
    const jeda = detail ? (parseFloat(detail.retryDelay) + 1) * 1000 : 10000 * 2 ** (i - 1);
    console.warn(`  Gemini ${status ?? 'galat jaringan'}, coba lagi dalam ${Math.round(jeda / 1000)} detik (${i}/${RETRIES - 1})`);
    await tunggu(jeda);
  }
  return { ok: false, status: null, isi: null, percobaan, mulaiTerakhir: null };
};

const teksJawaban = (isi) =>
  (isi?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');

const parseTemuan = (teks) => {
  const bersih = teks.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(bersih);
    return { ok: Array.isArray(obj.temuan), temuan: Array.isArray(obj.temuan) ? obj.temuan : [] };
  } catch {
    return { ok: false, temuan: [] };
  }
};

const hitungBiaya = (u) => {
  if (!u) return null;
  const input = u.promptTokenCount ?? 0;
  const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const usd = (input / 1e6) * TARIF.usd_per_1m_token_input + (output / 1e6) * TARIF.usd_per_1m_token_output;
  return { input_token: input, output_token_termasuk_thinking: output, usd_total: Number(usd.toFixed(6)), tarif: TARIF };
};

// ---------- Run ----------

const jalankanSatu = async (kode, maxOutputTokens, percobaanUlang) => {
  const kondisi = kode[0];
  const { teks, sha } = bacaPromptTerkunci(kondisi);
  const nama = percobaanUlang ? `${kode}-ulang` : kode;
  console.log(`Run ${nama} (kondisi ${kondisi === 'A' ? 'dengan' : 'tanpa'} laporan Sonar)...`);
  const mulai = new Date();
  const respons = await panggilGemini(teks, maxOutputTokens);
  const selesai = new Date();
  fs.writeFileSync(path.join(FOLDER_RAW, `${nama}.raw.json`), JSON.stringify(respons.isi, null, 2));

  const parse = respons.ok ? parseTemuan(teksJawaban(respons.isi)) : { ok: false, temuan: [] };
  const kandidat = respons.isi?.candidates?.[0];
  const usage = respons.isi?.usageMetadata ?? null;
  const catatan = {
    run: nama,
    kondisi,
    model_diminta: MODEL,
    model_version: respons.isi?.modelVersion ?? null,
    response_id: respons.isi?.responseId ?? null,
    mulai: mulai.toISOString(),
    selesai: selesai.toISOString(),
    durasi_total_ms: selesai - mulai,
    durasi_bersih_ms: respons.mulaiTerakhir ? selesai - respons.mulaiTerakhir : null,
    jumlah_percobaan: respons.percobaan.length,
    http_status: respons.status,
    percobaan: respons.percobaan,
    finish_reason: kandidat?.finishReason ?? null,
    usage_metadata: usage,
    biaya_usd: hitungBiaya(usage),
    parse_ok: parse.ok,
    jumlah_temuan: parse.temuan.length,
    prompt_file: `prompt-${kondisi}.txt`,
    prompt_sha256: sha,
    galat: respons.ok ? null : (respons.isi?.error?.message ?? respons.isi?.galat_jaringan ?? 'gagal'),
    temuan: parse.temuan,
  };
  const fileRun = path.join(FOLDER, `${nama}.json`);
  tulisJson(fileRun, catatan);

  if (!parse.ok) {
    console.error(`  Run ${nama} gagal (${catatan.galat ?? `respons bukan JSON valid, finishReason ${catatan.finish_reason}`})`);
    return { kode, ok: false };
  }
  // Penilaian dengan scorer eksperimen yang tidak diubah
  execFileSync(process.execPath, [path.join('scripts', 'gemini-scan.js'), `--score-file=${relatif(fileRun)}`], { cwd: ROOT, stdio: 'ignore' });
  console.log(`  ${parse.temuan.length} temuan, ${Math.round(catatan.durasi_total_ms / 1000)} detik, ~$${catatan.biaya_usd?.usd_total ?? '?'}`);
  return { kode, ok: true };
};

const muatEnv = () => {
  const fileEnv = ambilArg('env') || path.join(ROOT, '.env');
  require('dotenv').config({ path: fileEnv, quiet: true, override: true });
  if (!process.env.GEMINI_API_KEY) throw new Error(`GEMINI_API_KEY tidak ada di ${fileEnv}`);
};

const jalankan = async (daftar, percobaanUlang) => {
  const filePrareg = path.join(FOLDER, 'PRAREGISTRASI.md');
  if (!fs.existsSync(filePrareg)) throw new Error('PRAREGISTRASI.md belum ada, run tidak dijalankan');
  const shaPrareg = sha256(fs.readFileSync(filePrareg, 'utf8'));
  muatEnv();
  fs.mkdirSync(FOLDER_RAW, { recursive: true });
  for (const k of ['A', 'B']) bacaPromptTerkunci(k);
  const model = await infoModel();
  const maxOutputTokens = model.outputTokenLimit || 65536;
  console.log(`Model ${MODEL} (versi ${model.version ?? '?'}), maxOutputTokens ${maxOutputTokens}`);

  const hasil = [];
  for (let i = 0; i < daftar.length; i++) {
    if (i > 0) {
      console.log(`Jeda ${JEDA_ANTAR_RUN_DETIK} detik`);
      await tunggu(JEDA_ANTAR_RUN_DETIK * 1000);
    }
    hasil.push(await jalankanSatu(daftar[i], maxOutputTokens, percobaanUlang));
  }
  const log = path.join(FOLDER, 'log-run.json');
  const lama = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
  lama.push({ dijalankan: new Date().toISOString(), praregistrasi_sha256: shaPrareg, model: MODEL, info_model: { version: model.version ?? null, output_token_limit: model.outputTokenLimit ?? null }, generation_config: { temperature: TEMPERATURE, maxOutputTokens, responseMimeType: 'application/json', thinking: 'default model, tidak diatur' }, jeda_antar_run_detik: JEDA_ANTAR_RUN_DETIK, hasil });
  tulisJson(log, lama);
  const gagal = hasil.filter((h) => !h.ok).map((h) => h.kode);
  console.log(gagal.length ? `Selesai dengan run gagal: ${gagal.join(', ')}` : 'Selesai, semua run berhasil.');
};

const main = async () => {
  if (process.argv.includes('--siapkan')) return siapkan();
  const hanya = ambilArg('hanya');
  if (hanya) {
    if (!URUTAN.includes(hanya)) throw new Error(`--hanya harus salah satu dari ${URUTAN.join(', ')}`);
    // Aturan praregistrasi §7: hanya run yang gagal, dan hanya satu kali ulangan
    if (fs.existsSync(path.join(FOLDER, `${hanya}.score.json`))) throw new Error(`${hanya} sudah berhasil, tidak boleh diulang`);
    if (fs.existsSync(path.join(FOLDER, `${hanya}-ulang.json`))) throw new Error(`${hanya} sudah pernah diulang, tidak ada ulangan kedua`);
    return jalankan([hanya], true);
  }
  if (process.argv.includes('--jalankan')) return jalankan(URUTAN, false);
  console.log('Pakai --siapkan, --jalankan, atau --hanya=<kode>. Lihat komentar di atas file.');
};

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
