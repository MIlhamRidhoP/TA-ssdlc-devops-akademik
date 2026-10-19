// Adapter Gemini (REST v1beta lewat fetch, tanpa SDK), dengan streaming streamGenerateContent?alt=sse.
// Sumber parameter: discovery document https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
// (revisi 20261019, dicek 2026-10-19):
// - systemInstruction: GenerateContentRequest.systemInstruction
// - thinkingConfig.thinkingLevel: enum MINIMAL | LOW | MEDIUM | HIGH ("Recommended for Gemini 3 or later models")
//   Lihat juga https://ai.google.dev/gemini-api/docs/thinking (nilai low/medium/high untuk gemini-3.1-pro-preview)
// - responseFormat.text { mimeType: APPLICATION_JSON, schema }: GenerationConfig.responseFormat (TextResponseFormat);
//   responseSchema ditandai "Deprecated. Use response_format instead."
// - streamGenerateContent memakai body GenerateContentRequest yang sama; setiap event SSE berisi satu
//   GenerateContentResponse parsial. finishReason dan usageMetadata ada di potongan terakhir.
// - finishReason dan blockReason: https://ai.google.dev/api/generate-content
// Streaming dipakai supaya header respons datang di awal; tanpa streaming, fetch Node memutus request yang
// berpikir lebih dari 300 detik sebelum header terkirim.
// Parameter sampling (temperature, topP, topK) sengaja tidak dikirim. Tanpa tools dan grounding.
// Koneksi lewat scripts/llm/http.js: fetch undici dengan headersTimeout/bodyTimeout 20 menit (bukan 300 detik bawaan).
const http = require('../http');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const { TIMEOUT_MS } = http;

const ALASAN_TOLAK = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'LANGUAGE'];
const ALASAN_POTONG = ['MAX_TOKENS', 'CONTINUATION'];

const bodyRequest = ({ system, user, skema, batasOutput, tingkatThinking }) => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }] }],
  generationConfig: {
    maxOutputTokens: batasOutput,
    thinkingConfig: { thinkingLevel: tingkatThinking.toUpperCase() },
    responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: skema } },
  },
});

const usageDari = (u) => (u ? {
  input: u.promptTokenCount ?? 0,
  input_dari_cache: u.cachedContentTokenCount ?? 0,
  input_tulis_cache: 0,
  output: u.candidatesTokenCount ?? 0,
  thinking: u.thoughtsTokenCount ?? 0,
} : null);

// Ambil objek JSON dari teks SSE ("data: {...}" dipisah baris kosong). Sisa yang belum lengkap dikembalikan.
const pecahSse = (buffer) => {
  const event = buffer.split(/\r?\n\r?\n/);
  const sisa = event.pop();
  const potongan = [];
  for (const e of event) {
    const data = e.split(/\r?\n/).filter((b) => b.startsWith('data:')).map((b) => b.slice(5).trimStart()).join('\n');
    if (data) potongan.push(JSON.parse(data));
  }
  return { potongan, sisa };
};

// Gabungkan potongan stream menjadi satu GenerateContentResponse: parts disambung berurutan, finishReason,
// usageMetadata, dan modelVersion diambil dari potongan terakhir yang memuatnya.
const gabungPotongan = (potongan) => {
  const parts = [];
  let finishReason;
  let usageMetadata;
  let modelVersion;
  let promptFeedback;
  for (const p of potongan) {
    const k = p.candidates?.[0];
    if (k?.content?.parts) parts.push(...k.content.parts);
    if (k?.finishReason) finishReason = k.finishReason;
    if (p.usageMetadata) usageMetadata = p.usageMetadata;
    if (p.modelVersion) modelVersion = p.modelVersion;
    if (p.promptFeedback) promptFeedback = p.promptFeedback;
  }
  const hasil = { modelVersion, usageMetadata };
  if (promptFeedback) hasil.promptFeedback = promptFeedback;
  if (parts.length || finishReason) hasil.candidates = [{ content: { role: 'model', parts }, finishReason }];
  return hasil;
};

// Terjemahkan respons (hasil gabungan stream) ke status README bagian 8.
const tafsirRespons = (isi) => {
  const usage = usageDari(isi.usageMetadata);
  const model = isi.modelVersion ?? null;
  const blok = isi.promptFeedback?.blockReason;
  const kandidat = isi.candidates?.[0];
  if (!kandidat) {
    return { status: blok ? 'refusal' : 'error', detail_status: blok ? `blockReason ${blok}` : 'tanpa kandidat', teks: '', model_menjawab: model, usage };
  }
  const alasan = kandidat.finishReason ?? null;
  const teks = (kandidat.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  let status = 'error';
  if (alasan === 'STOP') status = 'ok';
  else if (ALASAN_POTONG.includes(alasan)) status = 'truncated';
  else if (ALASAN_TOLAK.includes(alasan)) status = 'refusal';
  return { status, detail_status: `finishReason ${alasan}`, teks, model_menjawab: model, usage };
};

const streamTerputus = (alasan, potongan) => ({
  http_status: 200, status: 'error', detail_status: `stream terputus: ${alasan}`, ulang: true, fatal: false,
  mentah: { potongan, galat: alasan },
});

const panggil = async ({ model, system, user, skema, batasOutput, tingkatThinking }) => {
  const body = bodyRequest({ system, user, skema, batasOutput, tingkatThinking });
  let res;
  try {
    res = await http.fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { http_status: null, status: 'error', detail_status: `galat jaringan atau timeout: ${err.message}`, ulang: true, mentah: { galat_jaringan: err.message } };
  }
  if (!res.ok) {
    const teksBody = await res.text().catch(() => '');
    let isi;
    try { isi = JSON.parse(teksBody); } catch { isi = { teks_mentah: teksBody }; }
    const ulang = res.status === 429 || res.status >= 500;
    return {
      http_status: res.status, status: 'error', detail_status: isi?.error?.message ?? `HTTP ${res.status}`,
      ulang, fatal: !ulang, retry_after: res.headers.get('retry-after'), mentah: isi,
    };
  }

  const potongan = [];
  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bagian of res.body) {
      buffer += decoder.decode(bagian, { stream: true });
      const hasil = pecahSse(buffer);
      potongan.push(...hasil.potongan);
      buffer = hasil.sisa;
    }
    buffer += decoder.decode();
    if (buffer.trim()) potongan.push(...pecahSse(`${buffer}\n\n`).potongan);
  } catch (err) {
    return streamTerputus(err.message, potongan);
  }
  const gabung = gabungPotongan(potongan);
  // Stream yang selesai tanpa finishReason dan tanpa blockReason dianggap terputus.
  if (!gabung.candidates?.[0]?.finishReason && !gabung.promptFeedback?.blockReason) {
    return streamTerputus('stream berakhir tanpa finishReason', potongan);
  }
  return { http_status: res.status, ...tafsirRespons(gabung), ulang: false, mentah: { potongan } };
};

module.exports = {
  panggil, bodyRequest, tafsirRespons, gabungPotongan, pecahSse,
  parameter: { thinking: 'generationConfig.thinkingConfig.thinkingLevel', format: 'generationConfig.responseFormat.text', transport: 'streamGenerateContent?alt=sse' },
};
