// Koneksi HTTP bersama untuk ketiga adapter prompt v2.
// fetch bawaan Node memakai undici dengan headersTimeout dan bodyTimeout bawaan 300 detik, terpisah dari timeout SDK.
// Panggilan yang berpikir lama bisa terputus di batas itu, dan percobaan yang terputus tetap ditagih tanpa usage.
// Karena itu dipakai undici.Agent dengan kedua batas disamakan dengan timeout SDK (20 menit), dipasangkan dengan
// fetch dari paket undici yang sama.
// Sumber (dicek 2026-10-19):
// - headersTimeout dan bodyTimeout (bawaan 300e3 ms; bodyTimeout berlaku antar potongan body):
//   https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md
// - Agent mewarisi semua PoolOptions dan ClientOptions: https://github.com/nodejs/undici/blob/main/docs/docs/api/Agent.md
// - SDK openai: opsi `fetch` + `fetchOptions: { dispatcher }`, "Undici-specific options like `dispatcher` must be
//   paired with the matching `fetch` implementation": https://github.com/openai/openai-node/blob/master/README.md
//   Docstring opsi timeout di openai 7.39.0 (client.d.ts) memberi contoh persis Agent({ headersTimeout, bodyTimeout }).
// - SDK Anthropic: opsi `fetch` dan `fetchOptions: { dispatcher }` (undici):
//   https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript (Customizing the fetch client, Configuring proxies)
const fs = require('fs');
const path = require('path');
const undici = require('undici');

const TIMEOUT_MS = 20 * 60 * 1000;
const OPSI_AGENT = { headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS };
const buatDispatcher = (opsi = OPSI_AGENT) => new undici.Agent(opsi);
const dispatcher = buatDispatcher();

const versiUndici = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'undici', 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

// Dicatat di metadata setiap panggilan.
const pengaturanKoneksi = () => ({
  timeout_sdk_ms: TIMEOUT_MS,
  headers_timeout_ms: OPSI_AGENT.headersTimeout,
  body_timeout_ms: OPSI_AGENT.bodyTimeout,
  fetch: `undici ${versiUndici()}`,
});

// Opsi klien SDK (OpenAI dan Anthropic). maxRetries 0: pengulangan diatur sendiri (README bagian 8).
const opsiKlienSdk = () => ({ maxRetries: 0, timeout: TIMEOUT_MS, fetch: undici.fetch, fetchOptions: { dispatcher } });

// Dipakai adapter Gemini. Properti modul ini (fetch) dipanggil saat runtime supaya bisa diganti di tes.
const http = {
  TIMEOUT_MS, OPSI_AGENT, dispatcher, buatDispatcher, pengaturanKoneksi, opsiKlienSdk, versiUndici,
  fetch: (url, init = {}) => undici.fetch(url, { ...init, dispatcher }),
};

module.exports = http;
