// Lapis 2 fitur rekomendasi perbaikan: satu panggilan model per run yang menghasilkan saran
// spesifik untuk item yang sudah dikonfirmasi, berpijak pada panduan umum lapis 1.
//
// Dipisah dari llm-scan.js dengan sengaja. Deteksi dan verifikasi sudah selesai sebelum modul ini
// dipanggil, dan apa pun yang terjadi di sini tidak boleh mengubah hasil keduanya: kegagalan
// menghasilkan field null beserta alasannya, bukan run yang gagal.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR_PROMPT = path.join(ROOT, 'prompts', 'remediasi-v1');
const BERKAS_PANDUAN = path.join(ROOT, 'dashboard', 'rekomendasi-cwe.json');
const VERSI_PROMPT = 'remediasi-v1';
const BATAS_BARIS_USULAN = 15;

const sha256 = (teks) => crypto.createHash('sha256').update(teks, 'utf8').digest('hex');

const bacaPrompt = (dir = DIR_PROMPT) => {
  const system = fs.readFileSync(path.join(dir, 'system.txt'), 'utf8');
  const task = fs.readFileSync(path.join(dir, 'task.txt'), 'utf8');
  const skemaTeks = fs.readFileSync(path.join(dir, 'schema.json'), 'utf8');
  return {
    system,
    task,
    skema: JSON.parse(skemaTeks),
    hash: { system: sha256(system), task: sha256(task), schema: sha256(skemaTeks) },
  };
};

const bacaPanduan = (berkas = BERKAS_PANDUAN) => {
  try {
    const d = JSON.parse(fs.readFileSync(berkas, 'utf8'));
    return d && typeof d.cwe === 'object' ? d.cwe : {};
  } catch {
    return {};
  }
};

// Item yang layak mendapat saran: hanya yang sudah dinyatakan nyata. Temuan hardening, alert yang
// ditolak model, dan alert yang masih ragu-ragu tidak ikut, karena menyarankan perbaikan untuk
// sesuatu yang belum tentu masalah justru menambah pekerjaan yang tidak perlu.
const itemLayak = (hasil) => {
  const keluar = [];
  for (const t of hasil.findings ?? []) {
    if (t.sifat !== 'vulnerability') continue;
    keluar.push({
      id: t.id,
      jenis_sumber: 'temuan',
      sumber: 'temuan LLM',
      file: t.file ?? '',
      baris: t.baris ?? 0,
      kelemahan: t.jenis ?? '',
      cwe: Array.isArray(t.cwe) ? t.cwe : [],
      penjelasan: t.penjelasan ?? '',
      potongan_kode: t.potongan_kode ?? null,
      fingerprint: t.fingerprint ?? null,
    });
  }
  for (const a of hasil.alerts ?? []) {
    if (a.putusan !== 'true_positive') continue;
    keluar.push({
      id: a.id,
      jenis_sumber: 'alert',
      sumber: 'alert SonarCloud',
      file: a.file ?? '',
      baris: a.baris ?? 0,
      kelemahan: a.rule ?? a.pesan ?? '',
      cwe: Array.isArray(a.cwe) ? a.cwe : [],
      penjelasan: a.alasan ?? a.pesan ?? '',
      potongan_kode: null,
      fingerprint: null,
    });
  }
  return keluar;
};

const blokPotongan = (pk) => {
  if (!pk || !Array.isArray(pk.baris) || !pk.baris.length) return null;
  const mulai = Number.isFinite(pk.mulai) ? pk.mulai : 1;
  return pk.baris.map((b, i) => `${mulai + i} | ${b}`).join('\n');
};

// Panduan lapis 1 ikut dikirim: saran model harus menerapkan pola yang sumbernya bisa ditelusuri,
// bukan lahir dari ingatan model sendiri.
const blokPanduan = (kode, panduan) => {
  const g = panduan[kode];
  if (!g) return `GENERAL GUIDE (${kode})\nNo general guide is available for this CWE. Rely on the code excerpt and state the limitation in catatan_risiko.`;
  const langkah = g.langkah.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `GENERAL GUIDE (${g.id}: ${g.judul})\n${langkah}\nSource: ${g.sumber.join(' ')}`;
};

const rakitItems = (items, panduan) => items.map((it) => {
  const bagian = [
    `ITEM ${it.id}`,
    `Source: ${it.sumber}`,
    `Location: ${it.file}:${it.baris}`,
    `Weakness: ${it.kelemahan}`,
    `CWE: ${it.cwe.length ? it.cwe.join(', ') : '(none)'}`,
    `Explanation: ${it.penjelasan}`,
    '',
    blokPanduan(it.cwe[0] ?? '(none)', panduan),
  ];
  const kode = blokPotongan(it.potongan_kode);
  if (kode) bagian.push('', 'CODE EXCERPT', kode);
  return bagian.join('\n');
}).join('\n\n---\n\n');

const rakitPrompt = (items, { prompt = bacaPrompt(), panduan = bacaPanduan() } = {}) => {
  if (!prompt.task.includes('{{ITEMS}}')) throw new Error('task.txt remediasi tidak memuat penanda {{ITEMS}}');
  return {
    system: prompt.system,
    user: prompt.task.replace('{{ITEMS}}', rakitItems(items, panduan)),
    skema: prompt.skema,
    hash: prompt.hash,
  };
};

// Validasi keluaran model terhadap bentuk yang dijanjikan schema.json. Dilakukan sendiri, bukan
// dipercayakan ke vendor: structured output tidak dijamin ada di semua vendor dan semua jalur.
const validasiKeluaran = (teks) => {
  let data;
  try {
    data = JSON.parse(teks);
  } catch (e) {
    return { ok: false, alasan: `Keluaran bukan JSON yang sah: ${e.message}`, rekomendasi: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, alasan: 'Keluaran bukan objek JSON.', rekomendasi: [] };
  }
  if (!Array.isArray(data.rekomendasi)) {
    return { ok: false, alasan: 'Keluaran tidak memuat array "rekomendasi".', rekomendasi: [] };
  }
  const DIIZINKAN = new Set(['id', 'cwe_dirujuk', 'langkah', 'potongan_kode_usulan', 'catatan_risiko']);
  const bersih = [];
  for (const [i, r] of data.rekomendasi.entries()) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, alasan: `rekomendasi[${i}] bukan objek.`, rekomendasi: [] };
    for (const k of Object.keys(r)) {
      if (!DIIZINKAN.has(k)) return { ok: false, alasan: `rekomendasi[${i}] memuat field tak dikenal "${k}".`, rekomendasi: [] };
    }
    if (typeof r.id !== 'string' || !r.id) return { ok: false, alasan: `rekomendasi[${i}].id kosong atau bukan string.`, rekomendasi: [] };
    if (typeof r.cwe_dirujuk !== 'string' || !/^CWE-\d+$/.test(r.cwe_dirujuk)) {
      return { ok: false, alasan: `rekomendasi[${i}].cwe_dirujuk tidak berbentuk CWE-<angka>.`, rekomendasi: [] };
    }
    if (!Array.isArray(r.langkah) || r.langkah.length < 2 || r.langkah.length > 4
      || r.langkah.some((l) => typeof l !== 'string' || !l.trim())) {
      return { ok: false, alasan: `rekomendasi[${i}].langkah harus 2 sampai 4 kalimat tidak kosong.`, rekomendasi: [] };
    }
    if (typeof r.catatan_risiko !== 'string' || !r.catatan_risiko.trim()) {
      return { ok: false, alasan: `rekomendasi[${i}].catatan_risiko kosong.`, rekomendasi: [] };
    }
    if ('potongan_kode_usulan' in r) {
      if (typeof r.potongan_kode_usulan !== 'string') return { ok: false, alasan: `rekomendasi[${i}].potongan_kode_usulan bukan string.`, rekomendasi: [] };
      const n = r.potongan_kode_usulan.split('\n').length;
      if (n > BATAS_BARIS_USULAN) {
        return { ok: false, alasan: `rekomendasi[${i}].potongan_kode_usulan ${n} baris, melebihi batas ${BATAS_BARIS_USULAN}.`, rekomendasi: [] };
      }
    }
    bersih.push(r);
  }
  return { ok: true, alasan: null, rekomendasi: bersih };
};

// Menempelkan hasil ke item yang bersangkutan. Item yang tidak dijawab model tetap bernilai null:
// mengisi apa pun di situ berarti mengarang.
const terapkan = (hasil, items, rekomendasi, konteks) => {
  const perId = new Map(rekomendasi.map((r) => [r.id, r]));
  let terisi = 0;
  let takKonsisten = 0;
  const pasang = (daftar, jenis) => {
    for (const o of daftar) {
      const it = items.find((x) => x.id === o.id && x.jenis_sumber === jenis);
      if (!it) continue;
      const r = perId.get(o.id);
      if (!r) { o.rekomendasi_ai = null; continue; }
      // Saran yang merujuk CWE lain tetap ditampilkan, tetapi ditandai: membuangnya diam-diam
      // menyembunyikan ketidakcocokan yang justru perlu dilihat pembaca.
      const konsisten = it.cwe.length === 0 || it.cwe.includes(r.cwe_dirujuk);
      if (!konsisten) takKonsisten += 1;
      o.rekomendasi_ai = {
        asal: 'model',
        vendor: konteks.vendor,
        model_diminta: konteks.model_diminta,
        model_menjawab: konteks.model_menjawab ?? null,
        versi_prompt: VERSI_PROMPT,
        hash_prompt: konteks.hash_prompt,
        cwe_dirujuk: r.cwe_dirujuk,
        langkah: r.langkah,
        potongan_kode_usulan: typeof r.potongan_kode_usulan === 'string' ? r.potongan_kode_usulan : null,
        catatan_risiko: r.catatan_risiko,
        tidak_konsisten: !konsisten,
      };
      terisi += 1;
    }
  };
  pasang(hasil.findings ?? [], 'temuan');
  pasang(hasil.alerts ?? [], 'alert');
  return { terisi, tidak_konsisten: takKonsisten };
};

const kosongkan = (hasil) => {
  for (const o of [...(hasil.findings ?? []), ...(hasil.alerts ?? [])]) {
    if ('rekomendasi_ai' in o) delete o.rekomendasi_ai;
  }
};

// Satu panggilan untuk satu run. `panggil` disuntik supaya tes memakai respons tiruan dan tidak
// pernah menyentuh API berbayar.
const jalankanRemediasi = async (hasil, opsi, { panggil, prompt = bacaPrompt(), panduan = bacaPanduan(), hitungBiaya = null, tarif = null } = {}) => {
  const items = itemLayak(hasil);
  const dasar = {
    versi_prompt: VERSI_PROMPT,
    hash_prompt: prompt.hash,
    vendor: opsi.vendor,
    model_diminta: opsi.model,
    model_menjawab: null,
    item_dikirim: items.length,
    item_terisi: 0,
    tidak_konsisten: 0,
    usage: null,
    biaya_usd: null,
    status_panggilan: { total: 0, ok: 0, refusal: 0, truncated: 0, error: 0, parse_gagal: 0 },
    waktu_mulai: null,
    waktu_selesai: null,
    durasi_ms: null,
  };

  // Tidak ada item yang memenuhi syarat berarti tidak ada yang perlu disarankan: tidak ada
  // panggilan sama sekali, dan karena itu tidak ada biaya.
  if (!items.length) {
    kosongkan(hasil);
    hasil.run.remediasi = { ...dasar, status: 'tidak_dijalankan', alasan: 'Tidak ada temuan vulnerability maupun alert true_positive pada run ini.' };
    return hasil.run.remediasi;
  }

  const p = rakitPrompt(items, { prompt, panduan });
  let hasilPanggil;
  try {
    hasilPanggil = await panggil({
      vendor: opsi.vendor, model: opsi.model, system: p.system, user: p.user,
      skema: p.skema, namaSkema: 'remediasi', batasOutput: opsi.batasOutput, tingkatThinking: opsi.tingkatThinking,
    });
  } catch (e) {
    kosongkan(hasil);
    hasil.run.remediasi = {
      ...dasar,
      status: 'gagal',
      alasan: `Panggilan remediasi gagal: ${e.message}`,
      status_panggilan: { ...dasar.status_panggilan, total: 1, error: 1 },
    };
    return hasil.run.remediasi;
  }

  const statusPanggilan = {
    total: 1,
    ok: hasilPanggil.status === 'ok' ? 1 : 0,
    refusal: hasilPanggil.status === 'refusal' ? 1 : 0,
    truncated: hasilPanggil.status === 'truncated' ? 1 : 0,
    error: hasilPanggil.status === 'error' ? 1 : 0,
    parse_gagal: 0,
  };
  const waktu = {
    waktu_mulai: hasilPanggil.waktu_mulai ?? null,
    waktu_selesai: hasilPanggil.waktu_selesai ?? null,
    durasi_ms: hasilPanggil.waktu_mulai && hasilPanggil.waktu_selesai
      ? new Date(hasilPanggil.waktu_selesai) - new Date(hasilPanggil.waktu_mulai) : null,
  };
  const biaya = hitungBiaya && tarif ? hitungBiaya(hasilPanggil.usage, tarif) : null;
  const umum = {
    ...dasar,
    model_menjawab: hasilPanggil.model_menjawab ?? null,
    usage: hasilPanggil.usage ?? null,
    biaya_usd: biaya,
    status_panggilan: statusPanggilan,
    ...waktu,
  };

  if (hasilPanggil.status !== 'ok') {
    kosongkan(hasil);
    hasil.run.remediasi = {
      ...umum,
      status: 'gagal',
      alasan: `Panggilan remediasi berakhir dengan status ${hasilPanggil.status}${hasilPanggil.detail_status ? `: ${hasilPanggil.detail_status}` : ''}.`,
    };
    return hasil.run.remediasi;
  }

  const v = validasiKeluaran(hasilPanggil.teks ?? '');
  if (!v.ok) {
    kosongkan(hasil);
    hasil.run.remediasi = {
      ...umum,
      status: 'gagal',
      alasan: `Keluaran remediasi tidak sesuai skema: ${v.alasan}`,
      status_panggilan: { ...statusPanggilan, parse_gagal: 1 },
    };
    return hasil.run.remediasi;
  }

  kosongkan(hasil);
  const konteks = {
    vendor: opsi.vendor, model_diminta: opsi.model,
    model_menjawab: hasilPanggil.model_menjawab ?? null, hash_prompt: prompt.hash,
  };
  const { terisi, tidak_konsisten: takKonsisten } = terapkan(hasil, items, v.rekomendasi, konteks);
  hasil.run.remediasi = {
    ...umum,
    status: 'ok',
    alasan: terisi < items.length
      ? `Model menjawab ${terisi} dari ${items.length} item; sisanya tidak diberi saran.`
      : null,
    item_terisi: terisi,
    tidak_konsisten: takKonsisten,
  };
  return hasil.run.remediasi;
};

module.exports = {
  VERSI_PROMPT, BATAS_BARIS_USULAN,
  bacaPrompt, bacaPanduan, itemLayak, rakitItems, rakitPrompt,
  validasiKeluaran, terapkan, kosongkan, jalankanRemediasi,
};
