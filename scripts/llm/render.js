// Perakit prompt v2 sesuai prompts/v2/README.md bagian 3, 4, 5, dan hash bagian 9.
// Modul ini murni: tidak memanggil API dan tidak menulis file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const PROMPT_DIR = path.join(ROOT, 'prompts', 'v2');
const VERSI_PROMPT = 'v2';

const sha256 = (teks) => crypto.createHash('sha256').update(teks, 'utf8').digest('hex');
const sha256Buffer = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// File prompt dibaca apa adanya. Hash dihitung dari byte file, sama dengan HASHES.txt.
const bacaFilePrompt = (nama, dir = PROMPT_DIR) => {
  const buf = fs.readFileSync(path.join(dir, nama));
  return { teks: buf.toString('utf8'), hash: sha256Buffer(buf) };
};

// Bandingkan isi folder prompt dengan HASHES.txt. Run tidak boleh jalan kalau ada yang berbeda.
const cekHashPrompt = (dir = PROMPT_DIR) => {
  const baris = fs.readFileSync(path.join(dir, 'HASHES.txt'), 'utf8').split(/\r?\n/).filter((b) => b.trim());
  const beda = [];
  for (const b of baris) {
    const [hash, nama] = b.trim().split(/\s+\*?/);
    const aktual = sha256Buffer(fs.readFileSync(path.join(dir, nama)));
    if (aktual !== hash) beda.push(nama);
  }
  if (beda.length) throw new Error(`File prompt tidak cocok dengan HASHES.txt: ${beda.join(', ')}`);
  return baris.length;
};

// Ganti setiap {{NAMA}} secara literal, satu kali per variabel, dalam satu lintasan atas template asli,
// supaya isi variabel (kode, pesan Sonar) tidak ikut diganti. Template tidak boleh menyisakan "{{" (README bagian 3).
const isiTemplate = (template, nilai) => {
  const posisi = Object.entries(nilai).map(([nama, isi]) => {
    const penanda = `{{${nama}}}`;
    const idx = template.indexOf(penanda);
    if (idx < 0) throw new Error(`Variabel ${penanda} tidak ada di template`);
    return { idx, panjang: penanda.length, isi: String(isi) };
  }).sort((a, b) => a.idx - b.idx);
  let sisaTemplate = '';
  let hasil = '';
  let kursor = 0;
  for (const p of posisi) {
    sisaTemplate += template.slice(kursor, p.idx);
    hasil += template.slice(kursor, p.idx) + p.isi;
    kursor = p.idx + p.panjang;
  }
  sisaTemplate += template.slice(kursor);
  hasil += template.slice(kursor);
  if (sisaTemplate.includes('{{')) throw new Error('Masih ada sisa "{{" di template setelah perakitan');
  return hasil;
};

// ---------- {{SOURCE_CODE}} (README bagian 4) ----------

const daftarFileJs = (dirSrc, awalan = 'src') => {
  const hasil = [];
  for (const entri of fs.readdirSync(dirSrc, { withFileTypes: true })) {
    const rel = `${awalan}/${entri.name}`;
    const penuh = path.join(dirSrc, entri.name);
    if (entri.isDirectory()) hasil.push(...daftarFileJs(penuh, rel));
    else if (entri.isFile() && entri.name.endsWith('.js')) hasil.push(rel);
  }
  return hasil;
};

// Perbandingan string biasa (urutan code unit), bukan localeCompare.
const bandingString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const barisKode = (isi) => {
  let teks = isi.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (teks.endsWith('\n')) teks = teks.slice(0, -1);
  return teks.split('\n');
};

// Mengembalikan teks {{SOURCE_CODE}} dan daftar file beserta jumlah barisnya (dipakai validator).
const bentukKodeSumber = (dirObjek) => {
  const daftar = daftarFileJs(path.join(dirObjek, 'src')).sort(bandingString);
  const file = daftar.map((rel) => {
    const baris = barisKode(fs.readFileSync(path.join(dirObjek, rel), 'utf8'));
    const blok = [`===== FILE: ${rel} =====`, ...baris.map((isi, i) => `${i + 1} | ${isi}`)].join('\n');
    return { path: rel, jumlah_baris: baris.length, blok };
  });
  return {
    teks: file.map((f) => f.blok).join('\n\n'),
    file: file.map(({ path: p, jumlah_baris: n }) => ({ path: p, jumlah_baris: n })),
  };
};

// ---------- Alert Sonar (README bagian 5) ----------

// Masukan: hasil ringkasSonar() di gemini-scan.js. Filter sama dengan sonarKeFormatTemuan.
const pilihAlert = (ringkasan) => ringkasan
  .filter((t) => t.keamanan || t.cwe.length > 0)
  .map((t) => ({ ...t }))
  .sort((a, b) => bandingString(a.file ?? '', b.file ?? '')
    || (a.baris ?? 0) - (b.baris ?? 0)
    || bandingString(a.rule ?? '', b.rule ?? ''))
  .map((t, i) => ({ id: `SONAR-${String(i + 1).padStart(2, '0')}`, ...t }));

const formatAlert = (alert, templateAlert) => isiTemplate(templateAlert, {
  ID: alert.id,
  RULE_KEY: alert.rule ?? '',
  TYPE: alert.tipe,
  FILE: alert.file ?? '',
  LINE: alert.baris ?? 0,
  MESSAGE: String(alert.pesan ?? '').replace(/\r\n|\r|\n/g, ' '),
  CWE_LIST: alert.cwe.length ? alert.cwe.join(', ') : 'none',
}).trimEnd();

const laporanSonar = (alertTerformat) => (alertTerformat.length ? alertTerformat.join('\n\n') : '(no alerts)');

// ---------- Perakitan pesan (README bagian 3) ----------

const KONDISI = ['utama', 'sonar_di_deteksi', 'komentar_menyesatkan'];

const bacaTemplate = (dir = PROMPT_DIR) => {
  const nama = {
    system: 'system.txt', sourceHeader: 'source-header.txt', sonarReference: 'sonar-reference.txt',
    taskDeteksi: 'task-detection.txt', taskVerifikasi: 'task-verification.txt', alert: 'alert-format.txt',
    skemaDeteksi: 'detection.schema.json', skemaVerifikasi: 'verification.schema.json',
  };
  return Object.fromEntries(Object.entries(nama).map(([k, f]) => [k, bacaFilePrompt(f, dir)]));
};

// tugas: 'deteksi' | 'verifikasi'. Untuk verifikasi, alertTeks wajib. Untuk sonar_di_deteksi, sonarTeks wajib.
const rakitPrompt = ({ template, kondisi, tugas, kodeSumber, sonarTeks = null, alertTeks = null }) => {
  if (!KONDISI.includes(kondisi)) throw new Error(`Kondisi tidak dikenal: ${kondisi}`);
  if (tugas === 'verifikasi' && kondisi !== 'utama') throw new Error('Verifikasi hanya untuk kondisi utama');
  const blok1 = isiTemplate(template.sourceHeader.teks, { SOURCE_CODE: kodeSumber }).trimEnd();
  const sisa = [];
  if (kondisi === 'sonar_di_deteksi') {
    if (sonarTeks === null) throw new Error('Laporan Sonar wajib untuk kondisi sonar_di_deteksi');
    sisa.push(isiTemplate(template.sonarReference.teks, { SONAR_REPORT: sonarTeks }).trimEnd());
  }
  if (tugas === 'deteksi') sisa.push(template.taskDeteksi.teks.trimEnd());
  else if (tugas === 'verifikasi') {
    if (alertTeks === null) throw new Error('Alert wajib untuk tugas verifikasi');
    sisa.push(isiTemplate(template.taskVerifikasi.teks, { ALERT: alertTeks }).trimEnd());
  } else throw new Error(`Tugas tidak dikenal: ${tugas}`);

  const system = template.system.teks.trimEnd();
  const user = [blok1, ...sisa].join('\n\n');
  // Dua content block untuk vendor dengan titik cache (Claude, OpenAI). Pemisah "\n\n" ikut di awal blok 2 supaya
  // blok 1 + blok 2 identik byte per byte dengan teks user kanonik (README bagian 3, revisi 2026-10-19).
  const blokUser = [blok1, `\n\n${sisa.join('\n\n')}`];
  if (blokUser.join('') !== user) throw new Error('Pembagian blok user tidak identik dengan teks kanonik');
  const fileTugas = tugas === 'deteksi' ? template.taskDeteksi : template.taskVerifikasi;
  const fileSkema = tugas === 'deteksi' ? template.skemaDeteksi : template.skemaVerifikasi;
  return {
    system,
    user,
    blok_user: blokUser, // blok 1 dengan titik cache, blok 2 tanpa; blokUser.join('') === user
    skema: JSON.parse(fileSkema.teks),
    hash: {
      system: template.system.hash,
      template_tugas: fileTugas.hash,
      skema: fileSkema.hash,
      kode_sumber: sha256(kodeSumber),
      laporan_sonar: kondisi === 'sonar_di_deteksi' ? sha256(sonarTeks) : null,
      alert: tugas === 'verifikasi' ? sha256(alertTeks) : null,
      prompt_system_kanonik: sha256(system),
      prompt_user_kanonik: sha256(user),
    },
  };
};

module.exports = {
  VERSI_PROMPT, PROMPT_DIR, KONDISI, sha256, cekHashPrompt, isiTemplate, bandingString, barisKode,
  bentukKodeSumber, pilihAlert, formatAlert, laporanSonar, bacaTemplate, rakitPrompt,
};
