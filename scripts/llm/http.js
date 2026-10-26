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
// Batas MEMBUAT sambungan (TCP + TLS), terpisah dari kedua batas di atas yang berlaku SETELAH tersambung.
// Bawaan undici 10 detik (lib/core/connect.js:75), dan itu tidak pernah kita atur. Pada pilot 26 Okt 2026
// satu percobaan deteksi gagal tepat 10,6 detik dengan "Request timed out." walaupun timeout kita 20 menit:
// handshake tidak selesai dalam 10 detik di jaringan yang sedang tidak stabil. Dilonggarkan ke 30 detik.
// Ini tidak mengubah apa pun yang dikirim ke model, tetapi masuk pengaturan.koneksi dan karena itu masuk sidik.
const CONNECT_TIMEOUT_MS = 30 * 1000;
const OPSI_AGENT = { headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS, connectTimeout: CONNECT_TIMEOUT_MS };
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
  connect_timeout_ms: OPSI_AGENT.connectTimeout,
  fetch: `undici ${versiUndici()}`,
});

// Kode galat dari rantai `cause`. undici membungkus galat soket aslinya: TypeError "terminated" membawa
// SocketError ("other side closed", UND_ERR_SOCKET), dan "fetch failed" membawa ECONNRESET, ENETUNREACH,
// ETIMEDOUT, EAI_AGAIN, atau UND_ERR_CONNECT_TIMEOUT. Tanpa ini pesan yang tercatat hanya "terminated",
// dan dari data saja tidak terbedakan "server menutup koneksi" dari "jaringan lokal putus".
// AggregateError (beberapa alamat dicoba bergantian) dibuka juga. Kedalaman dibatasi supaya rantai yang
// melingkar tidak membuat pencatatan galat itu sendiri menggantung.
const kodeGalat = (err) => {
  const kode = [];
  const lihat = (e, kedalaman) => {
    if (!e || kedalaman > 5) return;
    const k = e.code ?? (typeof e.errno === 'string' ? e.errno : null);
    if (k !== null && k !== undefined && !kode.includes(String(k))) kode.push(String(k));
    if (Array.isArray(e.errors)) for (const x of e.errors) lihat(x, kedalaman + 1);
    lihat(e.cause, kedalaman + 1);
  };
  lihat(err, 0);
  return kode;
};

// Akhiran untuk detail_status percobaan yang gagal: kode sebab dan seberapa jauh stream sudah berjalan.
// Jumlah event membedakan putus sebelum sempat tersambung (0), saat model berpikir, dan saat menulis jawaban.
// Hanya menambah teks di belakang pesan yang sudah ada; awalannya tidak berubah.
const rincianGalat = (err, { jumlah = null, satuan = 'event', terakhir = null } = {}) => {
  const bagian = [];
  const kode = kodeGalat(err);
  if (kode.length) bagian.push(`sebab ${kode.join(', ')}`);
  if (jumlah !== null && jumlah !== undefined) bagian.push(`${jumlah} ${satuan}${terakhir ? `, terakhir ${terakhir}` : ''}`);
  return bagian.length ? ` (${bagian.join('; ')})` : '';
};

// Opsi klien SDK (OpenAI dan Anthropic). maxRetries 0: pengulangan diatur sendiri (README bagian 8).
const opsiKlienSdk = () => ({ maxRetries: 0, timeout: TIMEOUT_MS, fetch: undici.fetch, fetchOptions: { dispatcher } });

// Dipakai adapter Gemini. Properti modul ini (fetch) dipanggil saat runtime supaya bisa diganti di tes.
const http = {
  TIMEOUT_MS, CONNECT_TIMEOUT_MS, OPSI_AGENT, dispatcher, buatDispatcher, pengaturanKoneksi, opsiKlienSdk, versiUndici,
  kodeGalat, rincianGalat,
  fetch: (url, init = {}) => undici.fetch(url, { ...init, dispatcher }),
};

module.exports = http;
