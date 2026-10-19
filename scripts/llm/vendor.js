// Konfigurasi model per vendor untuk prompt v2 (prompts/v2/README.md bagian 6).
// Model sengaja tetap per vendor, tidak bisa diganti lewat argumen, supaya run tidak tercampur.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BATAS_OUTPUT = 64000;
const TINGKAT_THINKING = 'high';

// Tarif USD per 1 juta token. null = tidak diketahui (token cache dihargai tarif input biasa, batas atas).
const VENDOR = {
  google: {
    model: 'gemini-3.1-pro-preview',
    // Model ID: https://ai.google.dev/gemini-api/docs/models (dicek 2026-10-19)
    // Tarif: https://ai.google.dev/gemini-api/docs/pricing (dicek 2026-10-19), Standard tier, prompt <= 200K token:
    // input $2, output $12 (termasuk thinking), context caching $0,20.
    tarif: {
      input: 2, input_cache_baca: 0.2, input_cache_tulis: null, output: 12,
      sumber: 'https://ai.google.dev/gemini-api/docs/pricing (dicek 2026-10-19), prompt <= 200K token',
      catatan: 'Token cache memakai tarif context caching. Biaya penyimpanan cache tidak berlaku untuk caching implisit '
        + '(tidak ada token tulis cache). Halaman harga tidak menyebut eksplisit tarif caching implisit untuk model ini',
    },
  },
  anthropic: {
    model: 'claude-sonnet-5-5',
    tarif: {
      input: 2, input_cache_baca: 0.2, input_cache_tulis: 2.5, output: 10,
      sumber: 'Referensi Claude API (skill claude-api, cache 2026-10-06): $2/$10, cache read $0,20, cache write 1,25x',
    },
  },
  openai: {
    model: 'gpt-6.1-sol',
    // Model ID dan tarif: https://developers.openai.com/api/docs/models/gpt-6.1-sol (dicek 2026-10-19)
    tarif: {
      input: 2, input_cache_baca: 0.1, input_cache_tulis: 2.5, output: 10,
      sumber: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol (dicek 2026-10-19)',
      catatan: 'Nama field usage untuk token tulis cache belum dipastikan; dicatat 0 kalau tidak ada',
    },
  },
};

const versiPaket = (nama) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', nama, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};

const versiSdk = () => ({
  node: process.version,
  '@anthropic-ai/sdk': versiPaket('@anthropic-ai/sdk'),
  openai: versiPaket('openai'),
  undici: versiPaket('undici'),
  google: 'REST v1beta streamGenerateContent (SSE) lewat fetch undici (tanpa SDK)',
});

// usage: { input (total termasuk cache), input_dari_cache, input_tulis_cache, output, thinking }
const hitungBiaya = (usage, tarif) => {
  if (!usage) return null;
  const cacheBaca = usage.input_dari_cache ?? 0;
  const cacheTulis = usage.input_tulis_cache ?? 0;
  const biasa = Math.max(0, (usage.input ?? 0) - cacheBaca - cacheTulis);
  const out = (usage.output ?? 0) + (usage.thinking ?? 0);
  const usd = (biasa * tarif.input
    + cacheBaca * (tarif.input_cache_baca ?? tarif.input)
    + cacheTulis * (tarif.input_cache_tulis ?? tarif.input)
    + out * tarif.output) / 1_000_000;
  return Number(usd.toFixed(6));
};

module.exports = { VENDOR, BATAS_OUTPUT, TINGKAT_THINKING, versiSdk, hitungBiaya };
