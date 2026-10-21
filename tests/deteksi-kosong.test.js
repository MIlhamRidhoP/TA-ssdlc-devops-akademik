// Penanda jawaban deteksi yang kosong.
//
// Cacat yang dijaga di sini pernah lolos tanpa jejak apa pun. Di repo demo, Gemini dua kali
// menjawab `{"temuan": []}` dengan `finishReason: STOP`, `status: ok`, dan `parse_ok: true`.
// Jawaban itu lolos skema, jadi tidak ada satu pun field yang membedakannya dari analisis sungguhan
// yang kebetulan bersih. Yang membedakannya hanya terlihat di token thinking: 258 dan 2.372 token,
// dibanding 23.305 token pada run yang menemukan tujuh temuan pada kode yang sama persis.
//
// Dua janji yang dijaga berkas ini:
//   1. Jawaban kosong selalu bertanda, dan tandanya terbawa sampai ke results.json skema 2.
//   2. Arti `status` tidak berubah. Panggilannya memang berhasil; yang kurang penandanya, bukan
//      statusnya. Mengubah `status` akan menggeser status_panggilan di seluruh data eksperimen.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tandaDeteksi } = require('../scripts/llm-scan');
const { susunRun } = require('../scripts/llm/results-v2');
const G = require('../scripts/llm/gabung');
const { validasiSkema } = require('../scripts/validasi-skema');
const skemaV2 = require('../docs/design/results-v2.schema.json');

const SHA = 'a'.repeat(40);
const ringkas = {
  vendor: 'google', model_diminta: 'gemini-3.1-pro-preview', kondisi: 'utama', skenario: 'B',
  objek_uji: { commit: SHA, branch: 'main', tree_src: 'b'.repeat(40) },
  sumber_sonar: 'api',
};
const panggilan = (opsi = {}) => ({
  status: 'ok', parse_ok: true, biaya_usd: 0.1,
  waktu_mulai: '2026-10-21T15:51:51.000Z', waktu_selesai: '2026-10-21T15:52:12.000Z',
  usage: { input: 38384, output: 9, thinking: 258 },
  ...opsi,
});

// ---------- 1. Penanda di llm-scan ----------

test('jawaban yang lolos skema tetapi nol temuan diberi tanda deteksi_kosong', () => {
  assert.deepEqual(tandaDeteksi({ parse_ok: true, temuan: [] }), ['deteksi_kosong']);
});

test('jawaban berisi temuan tidak diberi tanda', () => {
  assert.deepEqual(tandaDeteksi({ parse_ok: true, temuan: [{ file: 'src/a.js' }] }), []);
});

test('jawaban yang gagal diparse bukan deteksi kosong', () => {
  // Keduanya berakhir nol temuan, tetapi artinya berlawanan: yang satu model menjawab kosong,
  // yang lain jawabannya tidak bisa dibaca sama sekali. parse_gagal sudah menangkap yang kedua.
  assert.deepEqual(tandaDeteksi({ parse_ok: false, temuan: [] }), []);
});

// ---------- 2. Thinking dan penghitung di results-v2 ----------

test('deteksi kosong terhitung di status_panggilan tanpa mengubah status', () => {
  const r = susunRun({
    summary: ringkas,
    run: {
      deteksi: panggilan({ tanda: ['deteksi_kosong'] }),
      verifikasi: [{ metadata: panggilan({ usage: { input: 38384, output: 144, thinking: 1928 } }) }],
    },
    nomor: 11,
  });
  assert.equal(r.status_panggilan.deteksi_kosong, 1);
  assert.equal(r.status_panggilan.ok, 2, 'panggilannya tetap berhasil');
  assert.equal(r.status_panggilan.error, 0);
  assert.equal(r.status_panggilan.parse_gagal, 0, 'jawaban kosong bukan jawaban yang gagal diparse');
});

test('token thinking deteksi dan total terbawa apa adanya', () => {
  const r = susunRun({
    summary: ringkas,
    run: {
      deteksi: panggilan({ tanda: ['deteksi_kosong'] }),
      verifikasi: [
        { metadata: panggilan({ usage: { input: 1, output: 1, thinking: 1928 } }) },
        { metadata: panggilan({ usage: { input: 1, output: 1, thinking: 1882 } }) },
      ],
    },
    nomor: 11,
  });
  assert.equal(r.thinking_token.deteksi, 258);
  assert.equal(r.thinking_token.total, 258 + 1928 + 1882);
});

test('tanpa panggilan sama sekali, thinking null dan bukan nol', () => {
  // Skenario A tidak memanggil model. Angka 0 di situ terbaca seolah model dipanggil lalu tidak
  // berpikir, dan itu mengarang keadaan yang tidak pernah terjadi.
  const r = susunRun({
    summary: { ...ringkas, skenario: 'A', vendor: null, model_diminta: null },
    run: { mulai: '2026-10-21T10:00:00.000Z', selesai: '2026-10-21T10:00:06.000Z', verifikasi: [] },
    nomor: 5,
  });
  assert.equal(r.thinking_token.deteksi, null);
  assert.equal(r.thinking_token.total, null);
  assert.equal(r.status_panggilan.deteksi_kosong, 0);
});

test('panggilan tanpa field tanda tidak membuat penghitungnya rusak', () => {
  // Hasil run lama tidak punya `tanda` sama sekali.
  const r = susunRun({
    summary: ringkas,
    run: { deteksi: panggilan(), verifikasi: [] },
    nomor: 9,
  });
  assert.equal(r.status_panggilan.deteksi_kosong, 0);
  assert.equal(r.thinking_token.deteksi, 258);
});

// ---------- 3. Mode gabungan ----------

const hasilVendor = (vendor, { kosong = 0, thinkingDeteksi = 5000, thinkingTotal = 20000, findings = [] } = {}) => ({
  schema_version: 2,
  run: {
    id: 14, nomor: 14, repo: 'o/r', asal: 'workflow', vendor,
    model_diminta: `${vendor}-model`, model_menjawab: `${vendor}-model`, kondisi: 'utama',
    skenario: 'B', mode_model: 'tunggal',
    mulai: '2026-10-21T16:11:22.000Z', selesai: '2026-10-21T16:14:43.000Z', durasi_detik: 200,
    objek_uji: { commit: SHA, branch: 'main', tree_src: 'b'.repeat(40) },
    commit_kode: { head: SHA, bersih: true },
    hash_prompt: { system: null, user_deteksi: null },
    sumber_sonar: 'api',
    analisis_sonar: { tanggal: null, revisi: null, tree_src: null },
    sonar_beku: null,
    biaya_usd: 0.3,
    thinking_token: { deteksi: thinkingDeteksi, total: thinkingTotal },
    status_panggilan: { total: 6, ok: 6, refusal: 0, truncated: 0, error: 0, parse_gagal: 0, deteksi_kosong: kosong },
    pipeline: null,
  },
  alerts: [],
  findings,
});

test('penggabung membawa deteksi_kosong per vendor dan menjumlahkannya', () => {
  const g = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { kosong: 1, thinkingDeteksi: 258, thinkingTotal: 15685 }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic') },
    { vendor: 'openai', hasil: hasilVendor('openai') },
  ], { id: 14, nomor: 14, repo: 'o/r' });

  assert.equal(g.run.status_panggilan.deteksi_kosong, 1, 'dijumlahkan dari ketiga vendor');
  assert.equal(g.run.per_vendor.google.status_panggilan.deteksi_kosong, 1);
  assert.equal(g.run.per_vendor.anthropic.status_panggilan.deteksi_kosong, 0);
  // Vendor mana yang menjawab kosong, dan berapa ia berpikir, justru itu yang berguna dibaca.
  assert.deepEqual(g.run.per_vendor.google.thinking_token, { deteksi: 258, total: 15685 });
  assert.deepEqual(g.run.per_vendor.openai.thinking_token, { deteksi: 5000, total: 20000 });
});

test('thinking run gabungan dijumlahkan, dan deteksinya null karena tidak tunggal', () => {
  const g = G.gabungkan([
    { vendor: 'google', hasil: hasilVendor('google', { thinkingTotal: 15685 }) },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { thinkingTotal: 9000 }) },
  ], { id: 14, nomor: 14, repo: 'o/r' });
  assert.equal(g.run.thinking_token.total, 15685 + 9000);
  assert.equal(g.run.thinking_token.deteksi, null,
    'run gabungan tidak punya satu panggilan deteksi; angkanya ada per vendor');
});

test('hasil vendor lama tanpa field baru tidak membuat penggabungan gagal', () => {
  const lama = hasilVendor('google');
  delete lama.run.thinking_token;
  delete lama.run.status_panggilan.deteksi_kosong;
  const g = G.gabungkan([
    { vendor: 'google', hasil: lama },
    { vendor: 'anthropic', hasil: hasilVendor('anthropic', { kosong: 1 }) },
  ], { id: 14, nomor: 14, repo: 'o/r' });
  assert.equal(g.run.status_panggilan.deteksi_kosong, 1, 'vendor lama menyumbang 0, bukan menghapus jumlahnya');
  assert.equal(g.run.per_vendor.google.thinking_token, null);
  assert.equal(g.run.thinking_token.total, 20000, 'hanya vendor yang punya angka yang dijumlahkan');
});

// ---------- 4. Skema ----------

const hasilLengkap = (run) => ({
  schema_version: 2,
  run: {
    id: 11, nomor: 11, repo: 'o/r', asal: 'workflow', vendor: 'google',
    model_diminta: 'gemini-3.1-pro-preview', model_menjawab: 'gemini-3.1-pro-preview', kondisi: 'utama',
    skenario: 'B', mode_model: 'tunggal',
    mulai: '2026-10-21T15:51:51.000Z', selesai: '2026-10-21T15:54:49.000Z', durasi_detik: 178,
    objek_uji: { commit: SHA, branch: 'main', tree_src: 'b'.repeat(40) },
    commit_kode: { head: SHA, bersih: true },
    hash_prompt: { system: null, user_deteksi: null },
    sumber_sonar: 'api',
    analisis_sonar: { tanggal: null, revisi: null, tree_src: null },
    sonar_beku: null,
    biaya_usd: 0.458128,
    status_panggilan: { total: 6, ok: 6, refusal: 0, truncated: 0, error: 0, parse_gagal: 0 },
    pipeline: null,
    ...run,
  },
  alerts: [],
  findings: [],
});

test('field baru sah menurut skema v2', () => {
  const h = hasilLengkap({
    thinking_token: { deteksi: 258, total: 15685 },
    status_panggilan: { total: 6, ok: 6, refusal: 0, truncated: 0, error: 0, parse_gagal: 0, deteksi_kosong: 1 },
  });
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('hasil lama tanpa field baru tetap sah', () => {
  // Inti aturannya: keduanya opsional. results.json yang sudah terbit di security-results tidak
  // boleh berubah arti maupun berubah keabsahannya karena field ini ditambahkan.
  const h = hasilLengkap({});
  assert.equal('thinking_token' in h.run, false);
  assert.equal('deteksi_kosong' in h.run.status_panggilan, false);
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('thinking null sah, dan nilai negatif ditolak', () => {
  assert.deepEqual(validasiSkema(skemaV2, hasilLengkap({ thinking_token: { deteksi: null, total: null } })), []);
  assert.notDeepEqual(validasiSkema(skemaV2, hasilLengkap({ thinking_token: { deteksi: -1, total: 0 } })), []);
  assert.notDeepEqual(
    validasiSkema(skemaV2, hasilLengkap({
      status_panggilan: { total: 6, ok: 6, refusal: 0, truncated: 0, error: 0, parse_gagal: 0, deteksi_kosong: -1 },
    })),
    [],
  );
});
