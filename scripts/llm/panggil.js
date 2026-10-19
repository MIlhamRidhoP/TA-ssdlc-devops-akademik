// Pemanggilan satu prompt ke satu vendor dengan aturan pengulangan prompts/v2/README.md bagian 8:
// timeout, 5xx, dan 429 diulang maksimal 2 kali dengan jeda bertambah. Penolakan, output terpotong,
// dan JSON tidak valid tidak diulang. Error 4xx lain (misalnya 400) menghentikan run.
const ADAPTER = {
  google: require('./adapters/google'),
  anthropic: require('./adapters/anthropic'),
  openai: require('./adapters/openai'),
};

const MAKS_ULANG = 2;
const JEDA_DASAR_MS = 15000;
const BATAS_RETRY_AFTER_DETIK = 120;

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

const jedaUlang = (ke, retryAfter, jedaDasar) => {
  const detik = Number(retryAfter);
  if (Number.isFinite(detik) && detik > 0 && detik <= BATAS_RETRY_AFTER_DETIK) return detik * 1000;
  return jedaDasar * 2 ** (ke - 1);
};

// opsi: { vendor, model, system, user, blokUser, skema, namaSkema, batasOutput, tingkatThinking }
// adapter dan jedaDasar bisa disuntik untuk tes.
const panggilDenganUlang = async (opsi, { adapter = ADAPTER[opsi.vendor], jedaDasar = JEDA_DASAR_MS } = {}) => {
  if (!adapter) throw new Error(`Vendor tidak dikenal: ${opsi.vendor}`);
  const percobaan = [];
  for (let ke = 1; ke <= MAKS_ULANG + 1; ke++) {
    const mulai = new Date();
    const hasil = await adapter.panggil(opsi);
    const selesai = new Date();
    percobaan.push({
      ke, waktu_mulai: mulai.toISOString(), waktu_selesai: selesai.toISOString(),
      http_status: hasil.http_status, status: hasil.status, detail_status: hasil.detail_status,
      usage: hasil.usage ?? 'tidak_tercatat', // percobaan gagal tanpa usage tidak dianggap 0
      mentah: hasil.mentah,
    });
    if (hasil.ulang && ke <= MAKS_ULANG) {
      const jeda = jedaUlang(ke, hasil.retry_after, jedaDasar);
      console.warn(`  ${opsi.vendor} ${hasil.http_status ?? 'galat jaringan'}, coba lagi dalam ${Math.round(jeda / 1000)} detik (${ke}/${MAKS_ULANG})`);
      await tunggu(jeda);
      continue;
    }
    const habis = hasil.ulang; // masih bisa diulang tapi jatah habis
    return {
      ...hasil,
      status: hasil.status,
      detail_status: habis ? `${hasil.detail_status} (gagal setelah ${ke} percobaan)` : hasil.detail_status,
      fatal: Boolean(hasil.fatal),
      percobaan,
      waktu_mulai: percobaan[0].waktu_mulai,
      waktu_selesai: selesai.toISOString(),
    };
  }
  throw new Error('Tidak terjangkau');
};

module.exports = { panggilDenganUlang, ADAPTER, MAKS_ULANG };
