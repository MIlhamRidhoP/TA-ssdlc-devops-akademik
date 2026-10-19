// Adapter OpenAI lewat SDK resmi openai (versi dikunci di package.json), Responses API dengan streaming.
// Sumber (dicek 2026-10-19):
// - Model ID gpt-6.1-sol, reasoning effort low|medium|high|xhigh|max:
//   https://developers.openai.com/api/docs/models/gpt-6.1-sol
// - reasoning.effort, max_output_tokens (termasuk token reasoning), usage.output_tokens_details.reasoning_tokens,
//   usage.input_tokens_details.cached_tokens: https://developers.openai.com/api/docs/guides/reasoning
// - text.format { type: "json_schema", name, schema, strict: true }, refusal sebagai content "refusal",
//   status "incomplete" dengan incomplete_details.reason: https://developers.openai.com/api/docs/guides/structured-outputs
// - Titik cache eksplisit prompt_cache_breakpoint { mode: "explicit" } pada content part input_text, boleh dipakai
//   bersama titik cache implisit (mode bawaan), dan usage.input_tokens_details.cache_write_tokens:
//   https://developers.openai.com/api/docs/guides/prompt-caching
// - Streaming: client.responses.stream(...).finalResponse() (SDK openai 7.39.0, lib/responses/ResponseStream.js:
//   resolve juga untuk respons incomplete; galat jaringan dan stream tanpa respons menolak).
// Streaming dipakai supaya header respons datang di awal; tanpa streaming, fetch Node memutus request yang
// berpikir lebih dari 300 detik sebelum header terkirim.
// Tanpa parameter sampling dan tanpa tools. store: false, supaya respons tidak disimpan di sisi OpenAI.
const { OpenAI, APIError } = require('openai');
const http = require('../http'); // undici fetch + Agent dengan headersTimeout/bodyTimeout 20 menit

// Pesan user dikirim sebagai dua content part dari render.rakitPrompt (blokUser.join('') === teks kanonik).
// Titik cache eksplisit di akhir blok 1 (kode sumber), karena titik implisit ada di akhir pesan terakhir yang
// berbeda per alert (README bagian 3, revisi 2026-10-19).
const bodyRequest = ({ model, system, blokUser, skema, namaSkema, batasOutput, tingkatThinking }) => ({
  model,
  input: [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: blokUser[0], prompt_cache_breakpoint: { mode: 'explicit' } },
        { type: 'input_text', text: blokUser[1] },
      ],
    },
  ],
  reasoning: { effort: tingkatThinking },
  max_output_tokens: batasOutput,
  text: { format: { type: 'json_schema', name: namaSkema, schema: skema, strict: true } },
  store: false,
});

const usageDari = (u) => {
  if (!u) return null;
  const reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
  return {
    input: u.input_tokens ?? 0,
    input_dari_cache: u.input_tokens_details?.cached_tokens ?? 0,
    input_tulis_cache: u.input_tokens_details?.cache_write_tokens ?? 0,
    output: (u.output_tokens ?? 0) - reasoning,
    thinking: reasoning,
  };
};

const tafsirRespons = (resp) => {
  const konten = (resp.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  const tolak = konten.find((c) => c.type === 'refusal');
  const teks = konten.filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  const dasar = { teks, model_menjawab: resp.model ?? null, usage: usageDari(resp.usage) };
  if (resp.status === 'completed') {
    if (tolak) return { ...dasar, status: 'refusal', detail_status: `refusal: ${tolak.refusal}` };
    return { ...dasar, status: 'ok', detail_status: 'status completed' };
  }
  if (resp.status === 'incomplete') {
    const alasan = resp.incomplete_details?.reason ?? null;
    if (alasan === 'max_output_tokens') return { ...dasar, status: 'truncated', detail_status: 'incomplete max_output_tokens' };
    if (alasan === 'content_filter') return { ...dasar, status: 'refusal', detail_status: 'incomplete content_filter' };
    return { ...dasar, status: 'error', detail_status: `incomplete ${alasan}` };
  }
  return { ...dasar, status: 'error', detail_status: `status ${resp.status}: ${resp.error?.message ?? ''}`.trim() };
};

// APIConnectionError dan timeout adalah APIError tanpa status: diulang, begitu juga 429 dan 5xx.
// 4xx lain (misalnya 400) fatal. Galat di luar API (bug kode) tidak diulang.
const tafsirGalat = (err) => {
  const dariApi = err instanceof APIError;
  const status = dariApi ? err.status ?? null : null;
  const ulang = dariApi && (status === null || status === 429 || status >= 500);
  return {
    http_status: status, status: 'error', detail_status: err.message, ulang, fatal: !ulang,
    retry_after: err.headers?.get?.('retry-after') ?? null,
    mentah: { galat: err.message, status, error: err.error ?? null },
  };
};

// Galat saat stream berjalan: HTTP 4xx/429/5xx mengikuti tafsirGalat; selain itu (koneksi putus, stream berakhir
// tanpa respons) diperlakukan sebagai timeout dan diulang. Output parsial disimpan di mentah.
const tafsirGalatStream = (err, parsial) => {
  const dasar = err instanceof APIError && err.status ? tafsirGalat(err) : {
    http_status: null, status: 'error', detail_status: `stream terputus: ${err.message}`, ulang: true, fatal: false, retry_after: null,
  };
  return { ...dasar, mentah: { galat: err.message, status: dasar.http_status, error: err.error ?? null, parsial } };
};

let klien = null;
const ambilKlien = () => {
  if (!klien) klien = new OpenAI(http.opsiKlienSdk());
  return klien;
};

const panggil = async (opsi) => {
  const body = bodyRequest(opsi);
  const parsial = { jumlah_event: 0, event_terakhir: null, teks: '', refusal: '' };
  try {
    const stream = ambilKlien().responses.stream(body);
    stream.on('event', (e) => {
      parsial.jumlah_event += 1;
      parsial.event_terakhir = e.type;
      if (e.type === 'response.output_text.delta') parsial.teks += e.delta ?? '';
      if (e.type === 'response.refusal.delta') parsial.refusal += e.delta ?? '';
    });
    const resp = await stream.finalResponse();
    return { http_status: 200, ...tafsirRespons(resp), ulang: false, mentah: resp };
  } catch (err) {
    return tafsirGalatStream(err, parsial);
  }
};

module.exports = {
  panggil, bodyRequest, tafsirRespons, tafsirGalat, tafsirGalatStream, ambilKlien,
  parameter: { thinking: 'reasoning.effort', format: 'text.format', cache: 'prompt_cache_breakpoint (eksplisit) + implisit', transport: 'responses.stream' },
};
