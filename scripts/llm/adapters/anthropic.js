// Adapter Claude lewat SDK resmi @anthropic-ai/sdk (versi dikunci di package.json).
// Sumber: referensi Claude API (skill claude-api, typescript/claude-api/README.md dan shared/tool-use-concepts.md):
// - output_config.effort "high"; field thinking tidak dikirim (Sonnet 5.5: adaptive bawaan)
// - output_config.format { type: "json_schema", schema }
// - cache_control { type: "ephemeral" } pada content block pertama
// - stop_reason: end_turn | max_tokens | refusal (stop_details.category)
// Tanpa parameter sampling, tanpa tools, tanpa fallbacks dan header beta fallback.
// Streaming dipakai karena max_tokens besar (finalMessage() mengumpulkan respons lengkap).
const { Anthropic, APIError } = require('@anthropic-ai/sdk');
const http = require('../http'); // undici fetch + Agent dengan headersTimeout/bodyTimeout 20 menit

const bodyRequest = ({ model, system, blokUser, skema, batasOutput, tingkatThinking }) => ({
  model,
  max_tokens: batasOutput,
  system,
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: blokUser[0], cache_control: { type: 'ephemeral' } },
      { type: 'text', text: blokUser[1] },
    ],
  }],
  output_config: { effort: tingkatThinking, format: { type: 'json_schema', schema: skema } },
});

const usageDari = (u) => (u ? {
  input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
  input_dari_cache: u.cache_read_input_tokens ?? 0,
  input_tulis_cache: u.cache_creation_input_tokens ?? 0,
  output: u.output_tokens ?? 0, // termasuk token thinking
  thinking: null, // tidak dilaporkan terpisah
} : null);

const tafsirRespons = (msg) => {
  const teks = (msg.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const alasan = msg.stop_reason;
  let status = 'error';
  let detail = `stop_reason ${alasan}`;
  if (alasan === 'end_turn') status = 'ok';
  else if (alasan === 'max_tokens') status = 'truncated';
  else if (alasan === 'refusal') {
    status = 'refusal';
    detail = `stop_reason refusal, kategori ${msg.stop_details?.category ?? 'null'}`;
  }
  return { status, detail_status: detail, teks, model_menjawab: msg.model ?? null, usage: usageDari(msg.usage) };
};

let klien = null;
const ambilKlien = () => {
  // maxRetries 0: pengulangan diatur sendiri (README bagian 8) supaya setiap percobaan tercatat.
  if (!klien) klien = new Anthropic(http.opsiKlienSdk());
  return klien;
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
// sebelum message_stop) diperlakukan sebagai timeout dan diulang. Output parsial disimpan di mentah.
const tafsirGalatStream = (err, parsial) => {
  const dasar = err instanceof APIError && err.status ? tafsirGalat(err) : {
    http_status: null, status: 'error', detail_status: `stream terputus: ${err.message}`, ulang: true, fatal: false, retry_after: null,
  };
  return { ...dasar, mentah: { galat: err.message, status: dasar.http_status, error: err.error ?? null, parsial } };
};

const panggil = async (opsi) => {
  const body = bodyRequest(opsi);
  const parsial = { teks: '' };
  try {
    const stream = ambilKlien().messages.stream(body);
    stream.on('text', (t) => { parsial.teks += t; });
    const msg = await stream.finalMessage();
    return { http_status: 200, ...tafsirRespons(msg), ulang: false, mentah: msg };
  } catch (err) {
    return tafsirGalatStream(err, parsial);
  }
};

module.exports = { panggil, bodyRequest, tafsirRespons, tafsirGalat, tafsirGalatStream, ambilKlien, parameter: { thinking: 'output_config.effort', format: 'output_config.format' } };
