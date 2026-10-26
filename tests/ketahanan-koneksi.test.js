// Ketahanan terhadap koneksi yang putus-putus: U1 (sebab galat dicatat), U2 (batas membuat sambungan),
// U3 (deteksi gagal habis menghentikan run).
//
// Latarnya pilot nyata 26 Oktober 2026: tiga percobaan deteksi di satu run gagal dengan tiga tanda tangan
// berbeda (koneksi gagal dalam 0,1 detik, stream terputus di tengah, dan "Request timed out." tepat 10,6
// detik), tetapi yang tercatat hanya kata "terminated" atau "Connection error." tanpa sebab. Alat lalu
// meneruskan ke 23 verifikasi berbayar dan menghasilkan run separuh sah. Tes di sini memakai server palsu
// di localhost: tidak ada API sungguhan yang dipanggil dan tidak ada kunci asli yang dibaca.
//
// Bentuk galat yang dipakai tes DIAMBIL dari undici sungguhan (server palsu yang mematikan soket di tengah
// stream menghasilkan TypeError "terminated" dengan cause SocketError UND_ERR_SOCKET), bukan dikarang.
// Fixture karangan pernah meloloskan cacat di perakit skema 3, jadi di sini yang bisa dihasilkan jaringan
// sungguhan dihasilkan jaringan sungguhan.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodeHttp = require('node:http');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
const undici = require('undici');

const ROOT = path.resolve(__dirname, '..');
const httpLlm = require('../scripts/llm/http');
const openai = require('../scripts/llm/adapters/openai');
const anthropic = require('../scripts/llm/adapters/anthropic');
const google = require('../scripts/llm/adapters/google');
const OpenAISdk = require('openai');
const AnthropicSdk = require('@anthropic-ai/sdk');

// ---------- Server palsu: satu server, perilakunya diganti per tes ----------
// Klien SDK di-cache oleh adapter pada pemakaian pertama dan membaca *_BASE_URL saat itu, jadi basis URL
// harus tetap untuk seluruh berkas ini. Yang berganti hanya `penangan`.
let server;
let penangan = (req, res) => { res.statusCode = 500; res.end(); };
let jumlahPermintaan = 0;
let dasar;

before(async () => {
  server = nodeHttp.createServer((req, res) => { jumlahPermintaan += 1; penangan(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  dasar = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENAI_BASE_URL = `${dasar}/v1`;
  process.env.OPENAI_API_KEY = 'kunci-palsu-untuk-tes';
  process.env.ANTHROPIC_BASE_URL = dasar;
  process.env.ANTHROPIC_API_KEY = 'kunci-palsu-untuk-tes';
});
after(() => {
  if (server.listening) server.close();
  server.closeAllConnections?.();
});

const sse = (tipe, data) => `event: ${tipe}\ndata: ${JSON.stringify({ type: tipe, ...data })}\n\n`;
const RESP = { id: 'resp_uji', object: 'response', status: 'in_progress', output: [], model: 'm' };
const opsiOpenai = { model: 'm', system: 's', blokUser: ['a', 'b'], skema: { type: 'object' }, namaSkema: 'x', batasOutput: 10, tingkatThinking: 'high' };
const opsiAnthropic = { model: 'm', system: 's', blokUser: ['a', 'b'], skema: { type: 'object' }, batasOutput: 10, tingkatThinking: 'high' };

// Galat sebagaimana undici membuatnya: TypeError "terminated" membawa SocketError sebagai cause.
const galatSoket = () => Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
const terminated = () => Object.assign(new TypeError('terminated'), { cause: galatSoket() });

// ---------- U1: kode sebab dari rantai cause ----------

test('U1 kodeGalat membuka rantai cause, termasuk AggregateError, tanpa duplikat', () => {
  assert.deepEqual(httpLlm.kodeGalat(terminated()), ['UND_ERR_SOCKET']);
  const fetchGagal = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', errno: -4077 }),
  });
  // errno numerik bukan kode yang bisa dibaca; hanya `code` yang dicatat.
  assert.deepEqual(httpLlm.kodeGalat(fetchGagal), ['ECONNRESET']);
  // Beberapa alamat dicoba bergantian (IPv6 lalu IPv4) dan masing-masing punya kodenya.
  const agregat = Object.assign(new AggregateError([
    Object.assign(new Error('a'), { code: 'ETIMEDOUT' }),
    Object.assign(new Error('b'), { code: 'ENETUNREACH' }),
    Object.assign(new Error('c'), { code: 'ETIMEDOUT' }),
  ], 'semua gagal'), { code: 'ETIMEDOUT' });
  assert.deepEqual(httpLlm.kodeGalat(agregat), ['ETIMEDOUT', 'ENETUNREACH']);
});

test('U1 kodeGalat tahan terhadap masukan aneh dan rantai melingkar', () => {
  for (const x of [null, undefined, 'teks', 42, {}, new Error('tanpa kode')]) {
    assert.deepEqual(httpLlm.kodeGalat(x), [], `masukan ${String(x)} harus menghasilkan daftar kosong`);
  }
  // Rantai melingkar tidak boleh membuat pencatatan galat itu sendiri menggantung.
  const a = Object.assign(new Error('a'), { code: 'EA' });
  const b = Object.assign(new Error('b'), { code: 'EB' });
  a.cause = b;
  b.cause = a;
  assert.deepEqual(httpLlm.kodeGalat(a).sort(), ['EA', 'EB']);
});

test('U1 rincianGalat: sebab dan seberapa jauh stream berjalan, kosong bila tak ada keduanya', () => {
  assert.equal(httpLlm.rincianGalat(terminated(), { jumlah: 453, terakhir: 'response.output_text.delta' }),
    ' (sebab UND_ERR_SOCKET; 453 event, terakhir response.output_text.delta)');
  // Nol event dicatat sebagai nol, bukan dihilangkan: itulah yang membedakan "tidak pernah tersambung".
  assert.equal(httpLlm.rincianGalat(new Error('x'), { jumlah: 0 }), ' (0 event)');
  assert.equal(httpLlm.rincianGalat(terminated()), ' (sebab UND_ERR_SOCKET)');
  assert.equal(httpLlm.rincianGalat(new Error('x')), '', 'tanpa sebab dan tanpa hitungan, tidak ada akhiran');
  assert.equal(httpLlm.rincianGalat(terminated(), { jumlah: 3, satuan: 'potongan' }), ' (sebab UND_ERR_SOCKET; 3 potongan)');
});

for (const [nama, adapter, sdk] of [['openai', openai, OpenAISdk], ['anthropic', anthropic, AnthropicSdk]]) {
  test(`U1 ${nama}: stream terputus mencatat sebab dan jumlah event, semantik ulang tidak berubah`, () => {
    const hasil = adapter.tafsirGalatStream(terminated(), { teks: '{"tem', jumlah_event: 453, event_terakhir: 'delta' });
    // Awalan lama tetap utuh: tes dan pembaca data yang mencari "stream terputus" tidak boleh patah.
    assert.match(hasil.detail_status, /^stream terputus: terminated /);
    assert.match(hasil.detail_status, /sebab UND_ERR_SOCKET/);
    assert.match(hasil.detail_status, /453 event, terakhir delta/);
    assert.deepEqual([hasil.ulang, hasil.fatal, hasil.http_status, hasil.status], [true, false, null, 'error']);
    assert.equal(hasil.mentah.parsial.teks, '{"tem', 'output parsial tetap tersimpan');
    // Parsial tidak ada sama sekali (galat sebelum stream dibuat): nol event, bukan TypeError.
    assert.match(adapter.tafsirGalatStream(terminated(), undefined).detail_status, /0 event/);
    // Galat HTTP berstatus tidak disentuh: pesannya tetap pesan galat apa adanya.
    const err503 = sdk.APIError.generate(503, {}, 'overloaded', new Headers());
    const h503 = adapter.tafsirGalatStream(err503, {});
    assert.equal(h503.detail_status, adapter.tafsirGalat(err503).detail_status);
    assert.doesNotMatch(h503.detail_status, /sebab/);
    assert.deepEqual([h503.ulang, h503.http_status], [true, 503]);
  });
}

test('U1 google: galat jaringan dan stream putus mencatat sebab; jumlah potongan dihitung', async () => {
  const asli = httpLlm.fetch;
  const opsi = { model: 'm', system: 's', user: 'u', skema: {}, batasOutput: 1, tingkatThinking: 'high' };
  try {
    httpLlm.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code: 'ENETUNREACH' }) }); };
    const jaringan = await google.panggil(opsi);
    assert.match(jaringan.detail_status, /^galat jaringan atau timeout: fetch failed \(sebab ENETUNREACH\)$/);
    assert.equal(jaringan.ulang, true);

    // Stream putus di tengah: satu potongan SSE sudah diterima, lalu soket mati.
    const potongan = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"tem' }] } }] })}\n\n`;
    httpLlm.fetch = async () => ({
      ok: true, status: 200,
      body: (async function* putus() { yield new TextEncoder().encode(potongan); throw terminated(); }()),
    });
    const putus = await google.panggil(opsi);
    assert.match(putus.detail_status, /^stream terputus: terminated \(sebab UND_ERR_SOCKET; 1 potongan\)$/);
    assert.equal(putus.mentah.potongan.length, 1);

    // Stream berakhir tanpa finishReason bukan galat jaringan: tanpa galat asli tidak ada sebab untuk dicatat.
    httpLlm.fetch = async () => ({ ok: true, status: 200, body: (async function* kosong() { yield new TextEncoder().encode(potongan); }()) });
    const tanpaAkhir = await google.panggil(opsi);
    assert.equal(tanpaAkhir.detail_status, 'stream terputus: stream berakhir tanpa finishReason');
  } finally {
    httpLlm.fetch = asli;
  }
});

// ---------- U1 melalui jaringan sungguhan (server palsu di localhost) ----------

test('U1 jaringan nyata, OpenAI: soket mati di tengah stream menghasilkan UND_ERR_SOCKET dan hitungan event', async () => {
  penangan = (req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sse('response.created', { sequence_number: 0, response: RESP }));
    res.write(sse('response.in_progress', { sequence_number: 1, response: RESP }));
    setTimeout(() => res.socket.destroy(), 80);
  };
  const hasil = await openai.panggil(opsiOpenai);
  assert.equal(hasil.status, 'error');
  assert.equal(hasil.http_status, null);
  assert.equal(hasil.ulang, true);
  assert.equal(hasil.detail_status, 'stream terputus: terminated (sebab UND_ERR_SOCKET; 2 event, terakhir response.in_progress)');
});

test('U1 jaringan nyata, OpenAI: HTTP 503 tidak berubah dan tetap bisa diulang', async () => {
  penangan = (req, res) => {
    req.resume();
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0.01' });
    res.end(JSON.stringify({ error: { message: 'overloaded' } }));
  };
  const hasil = await openai.panggil(opsiOpenai);
  assert.deepEqual([hasil.status, hasil.http_status, hasil.ulang, hasil.fatal], ['error', 503, true, false]);
  assert.doesNotMatch(hasil.detail_status, /sebab/, 'galat HTTP berstatus tidak punya sebab jaringan');
  assert.equal(hasil.retry_after, '0.01');
});

test('U1 jaringan nyata, Anthropic: event stream dihitung lewat streamEvent dan sebab dicatat', async () => {
  penangan = (req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sse('message_start', {
      message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'm', stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } },
    }));
    setTimeout(() => res.socket.destroy(), 80);
  };
  const hasil = await anthropic.panggil(opsiAnthropic);
  assert.equal(hasil.status, 'error');
  assert.match(hasil.detail_status, /^stream terputus: .*\(sebab UND_ERR_SOCKET; 1 event, terakhir message_start\)$/);
  assert.equal(hasil.mentah.parsial.jumlah_event, 1);
});

// Dijalankan TERAKHIR di antara tes jaringan: server ditutup, jadi port yang sama menolak koneksi.
test('U1 jaringan nyata, OpenAI: koneksi ditolak menghasilkan ECONNREFUSED dan nol event', async () => {
  await new Promise((r) => { server.close(r); server.closeAllConnections?.(); });
  const hasil = await openai.panggil(opsiOpenai);
  assert.equal(hasil.status, 'error');
  assert.equal(hasil.ulang, true);
  assert.equal(hasil.detail_status, 'stream terputus: Connection error. (sebab ECONNREFUSED; 0 event)');
});

// ---------- U2: batas membuat sambungan ----------

test('U2 connectTimeout 30 detik masuk OPSI_AGENT dan pengaturan.koneksi', () => {
  assert.equal(httpLlm.CONNECT_TIMEOUT_MS, 30000);
  assert.equal(httpLlm.OPSI_AGENT.connectTimeout, 30000);
  assert.equal(httpLlm.pengaturanKoneksi().connect_timeout_ms, 30000);
  // Dispatcher bawaan dibangun dari OPSI_AGENT, bukan dari salinan yang bisa menyimpang darinya.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'llm', 'http.js'), 'utf8');
  assert.match(src, /const buatDispatcher = \(opsi = OPSI_AGENT\) => new undici\.Agent\(opsi\);/);
  assert.match(src, /const dispatcher = buatDispatcher\(\);/);
});

test('U2 opsi connectTimeout benar-benar dipakai undici: soket yang tak pernah menjawab TLS putus tepat waktu', async () => {
  // Server TCP yang menerima sambungan tetapi tidak pernah menjawab handshake TLS. Dengan nama opsi yang
  // salah undici memakai bawaan 10 detik dan tes ini melewati batas waktunya; dengan nama yang benar
  // gagal dalam sekejap dengan kode yang sama dengan kode "Request timed out." pada pilot.
  const bisu = net.createServer((soket) => { soket.on('error', () => {}); });
  await new Promise((r) => bisu.listen(0, '127.0.0.1', r));
  const dispatcher = httpLlm.buatDispatcher({ ...httpLlm.OPSI_AGENT, connectTimeout: 150 });
  const mulai = Date.now();
  let galat;
  try {
    await undici.fetch(`https://127.0.0.1:${bisu.address().port}/`, { dispatcher });
  } catch (err) {
    galat = err;
  } finally {
    await dispatcher.close();
    bisu.close();
  }
  assert.ok(galat, 'seharusnya gagal');
  assert.ok(Date.now() - mulai < 5000, `gagal dalam ${Date.now() - mulai} ms; batas 150 ms tidak dipakai`);
  // U1 dan U2 bertemu: galat jenis ini sekarang punya sebab yang terbaca.
  assert.deepEqual(httpLlm.kodeGalat(galat), ['UND_ERR_CONNECT_TIMEOUT']);
});

test('U2 batas sambungan masuk sidik: mengubahnya membuat --lanjut menolak folder lama', () => {
  const { bentukSidik, bedaSidik } = require('../scripts/llm/lanjut');
  const sidik = (koneksi) => bentukSidik({
    versiPrompt: 'v3', vendor: 'openai', model: 'm', kondisi: 'utama', objek: { commit: 'c', tree_src: 't' },
    sumberSonar: 'beku', infoBeku: { sha256_isi: 'i' }, hashKodeSumber: 'h', hashLaporanSonar: 'l', hashPrompt: {},
    hashKering: [{ tugas: 'deteksi', id_alert: null, prompt_system_kanonik: 's', prompt_user_kanonik: 'u' }],
    pengaturan: { koneksi }, sdk: {}, kodeAlat: { head: 'x' },
  });
  const sekarang = httpLlm.pengaturanKoneksi();
  assert.deepEqual(bedaSidik(sidik(sekarang), sidik(sekarang)), []);
  assert.deepEqual(bedaSidik(sidik(sekarang), sidik({ ...sekarang, connect_timeout_ms: 10000 })), ['pengaturan.koneksi.connect_timeout_ms']);
  // Folder yang dibuat sebelum kunci ini ada tidak punya kuncinya, jadi juga ditolak, bukan dicampur diam-diam.
  const { connect_timeout_ms: _, ...lama } = sekarang;
  assert.deepEqual(bedaSidik(sidik(lama), sidik(sekarang)), ['pengaturan.koneksi.connect_timeout_ms']);
});

// ---------- U3: deteksi gagal habis menghentikan run ----------

const render = require('../scripts/llm/render');
const llmScan = require('../scripts/llm-scan');
const { rencanaNomorRun, nomorRunAda } = require('../scripts/llm/lanjut');

const sekarang = () => new Date().toISOString();
const percobaanGagal = (detail) => [1, 2, 3].map((ke) => ({
  ke, waktu_mulai: sekarang(), waktu_selesai: sekarang(), http_status: null, status: 'error',
  detail_status: detail, usage: 'tidak_tercatat', mentah: { galat: 'terminated', parsial: { jumlah_event: 14 } },
}));
const DETAIL_GAGAL = 'stream terputus: terminated (sebab UND_ERR_SOCKET; 14 event, terakhir response.output_item.done)';
const hasilGagalHabis = (fatal = false) => ({
  status: 'error', detail_status: `${DETAIL_GAGAL} (gagal setelah 3 percobaan)`, fatal, teks: undefined,
  waktu_mulai: sekarang(), waktu_selesai: sekarang(), percobaan: percobaanGagal(DETAIL_GAGAL),
});
const hasilBerjawab = (teks, status = 'ok', detail = 'completed') => ({
  status, detail_status: detail, fatal: false, teks, model_menjawab: 'm',
  usage: { input: 10, input_dari_cache: 0, input_tulis_cache: 0, output: 5, thinking: 0 },
  waktu_mulai: sekarang(), waktu_selesai: sekarang(),
  percobaan: [{ ke: 1, waktu_mulai: sekarang(), waktu_selesai: sekarang(), http_status: 200, status, detail_status: detail, usage: 'tidak_tercatat', mentah: {} }],
});
const DETEKSI_OK = JSON.stringify({ temuan: [] });
const verifikasiOk = (id) => JSON.stringify({ id_alert: id, alasan: 'x', putusan: 'true_positive', keyakinan: 'high' });

const konteksUji = (folder, kirim) => {
  const template = render.bacaTemplate(render.dirPrompt('v3'));
  const alert = ['SONAR-01', 'SONAR-02'].map((id, i) => {
    const a = { id, rule: 'jssecurity:S3649', tipe: 'VULNERABILITY', file: 'src/a.js', baris: i + 1, cwe: ['CWE-89'], pesan: 'SQLi' };
    return { ...a, teks: render.formatAlert(a, template.alert.teks) };
  });
  return {
    template, alert, folder, kirim, kondisi: 'utama', skenario: 'B', versiPrompt: 'v3', vendor: 'openai', model: 'gpt-uji',
    kode: { teks: '===== FILE: src/a.js =====\n1 | const q = 1;', file: [{ path: 'src/a.js', jumlah_baris: 1 }] },
    objek: { commit: 'c'.repeat(40), branch: 'eksperimen/seeded', tree_src: 't'.repeat(40) },
    analisisSonar: null, revisiSonar: null, sumberSonar: 'beku', infoBeku: null, sast: 'sonar', infoBekuCodeql: null,
    kodeAlat: { head: 'k'.repeat(40), bersih: true }, sdk: {}, sonarTeks: null,
  };
};
const folderSementara = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-gagal-'));
// Panggilan palsu: jawaban diambil dari antrean per tugas, dan setiap panggilan dicatat.
const kirimPalsu = (jawaban) => {
  const log = [];
  const f = async (konteks, prompt, tugas) => {
    log.push(tugas);
    const j = jawaban[tugas];
    return typeof j === 'function' ? j(log.filter((x) => x === tugas).length) : j;
  };
  f.log = log;
  return f;
};

test('U3 deteksi gagal habis: run berhenti, verifikasi TIDAK dijalankan, bukti tersimpan tanpa memakai nomor run', async () => {
  const folder = folderSementara();
  const kirim = kirimPalsu({ deteksi: hasilGagalHabis(), verifikasi: () => assert.fail('verifikasi tidak boleh dijalankan') });
  await assert.rejects(llmScan.jalankanSatuRun(konteksUji(folder, kirim), 1), (err) => {
    assert.ok(err instanceof llmScan.RunGagal, 'harus RunGagal, bukan galat lain');
    assert.match(err.message, /Run 1 dihentikan: deteksi gagal setelah 3 percobaan/);
    assert.match(err.message, /sebab UND_ERR_SOCKET/, 'pesan memuat sebab yang dicatat U1');
    assert.match(err.message, /ulangi dengan --lanjut/);
    assert.deepEqual(Object.keys(err.catatan).sort(),
      ['berkas', 'commit_kode', 'detail_status', 'percobaan', 'run', 'sebab', 'waktu_mulai', 'waktu_selesai']);
    assert.equal(err.catatan.run, 1);
    assert.equal(err.catatan.percobaan, 3);
    assert.equal(err.catatan.berkas, 'run-1.gagal-1.json');
    return true;
  });
  assert.deepEqual(kirim.log, ['deteksi'], 'hanya satu panggilan deteksi, tanpa satu pun verifikasi');
  const ada = fs.readdirSync(folder).sort();
  assert.deepEqual(ada, ['run-1.gagal-1.json'], 'tidak ada run-1.json maupun run-1.raw.json');
  const bukti = JSON.parse(fs.readFileSync(path.join(folder, 'run-1.gagal-1.json'), 'utf8'));
  assert.equal(bukti.sebab, 'deteksi_gagal_setelah_percobaan_ulang');
  assert.equal(bukti.deteksi.status, 'error');
  assert.equal(bukti.deteksi.percobaan_gagal.length, 3, 'ketiga percobaan tercatat');
  assert.equal(bukti.mentah.length, 3, 'data mentah tiap percobaan ikut tersimpan');
  assert.match(bukti.deteksi.percobaan_gagal[0].detail_status, /UND_ERR_SOCKET.*14 event/);
});

test('U3 bukti kegagalan tidak pernah menimpa: kegagalan kedua pada nomor yang sama menjadi gagal-2', async () => {
  const folder = folderSementara();
  const kirim = kirimPalsu({ deteksi: hasilGagalHabis() });
  for (const berkas of ['run-1.gagal-1.json', 'run-1.gagal-2.json']) {
    await assert.rejects(llmScan.jalankanSatuRun(konteksUji(folder, kirim), 1), llmScan.RunGagal);
    assert.ok(fs.existsSync(path.join(folder, berkas)), `${berkas} harus ada`);
  }
  const pertama = fs.readFileSync(path.join(folder, 'run-1.gagal-1.json'), 'utf8');
  await assert.rejects(llmScan.jalankanSatuRun(konteksUji(folder, kirim), 1), llmScan.RunGagal);
  assert.equal(fs.readFileSync(path.join(folder, 'run-1.gagal-1.json'), 'utf8'), pertama, 'bukti pertama tidak berubah');
  assert.deepEqual(fs.readdirSync(folder).sort(), ['run-1.gagal-1.json', 'run-1.gagal-2.json', 'run-1.gagal-3.json']);
  // Nomor run lain punya hitungannya sendiri.
  assert.equal(llmScan.berkasGagalBerikutnya(folder, 2), 'run-2.gagal-1.json');
});

test('U3 --lanjut tetap benar: nomor yang gagal tidak terpakai, jadi dijalankan lagi tanpa lubang', async () => {
  const folder = folderSementara();
  // Run 1 selesai dengan sukses, run 2 gagal di deteksi.
  const sukses = kirimPalsu({ deteksi: hasilBerjawab(DETEKSI_OK), verifikasi: (k) => hasilBerjawab(verifikasiOk(`SONAR-0${k}`)) });
  await llmScan.jalankanSatuRun(konteksUji(folder, sukses), 1);
  await assert.rejects(llmScan.jalankanSatuRun(konteksUji(folder, kirimPalsu({ deteksi: hasilGagalHabis() })), 2), llmScan.RunGagal);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['run-1.json', 'run-1.raw.json', 'run-2.gagal-1.json']);
  // Berkas bukti bukan run: tidak terbaca sebagai nomor run, jadi urutan tetap 1.
  assert.deepEqual(nomorRunAda(folder), [1]);
  // --lanjut merencanakan nomor 2 lagi, bukan 3, dan tidak menolak karena "sudah ada".
  assert.deepEqual(rencanaNomorRun({ folder, target: 3, jalankan: 1 }), [2]);
  // Setelah nomor 2 akhirnya berhasil, urutan 1..3 utuh dan bukti kegagalan tetap tersimpan.
  await llmScan.jalankanSatuRun(konteksUji(folder, sukses), 2);
  assert.deepEqual(nomorRunAda(folder), [1, 2]);
  assert.deepEqual(rencanaNomorRun({ folder, target: 3, jalankan: 1 }), [3]);
  assert.ok(fs.existsSync(path.join(folder, 'run-2.gagal-1.json')), 'jejak kegagalan tidak hilang setelah berhasil');
});

test('U3 jalankanDaftarRun berhenti di kegagalan pertama dan mencatatnya, bukan sebagai galat permanen', async () => {
  const folder = folderSementara();
  const kirim = kirimPalsu({ deteksi: hasilGagalHabis() });
  const ringkasan = [];
  const runsGagal = [];
  let ditulis = 0;
  const hasil = await llmScan.jalankanDaftarRun(konteksUji(folder, kirim), [1, 2, 3], { ringkasan, runsGagal, tulisSummary: () => { ditulis += 1; } });
  assert.deepEqual(kirim.log, ['deteksi'], 'run 2 dan 3 tidak dicoba setelah run 1 gagal');
  assert.equal(hasil.gagalDeteksi, true);
  assert.equal(hasil.galat, null, 'galat permanen akan terbawa ke setiap --lanjut dan membuat run yang berhasil tetap berkode non-nol');
  assert.equal(runsGagal.length, 1);
  assert.deepEqual([runsGagal[0].run, runsGagal[0].berkas, runsGagal[0].percobaan], [1, 'run-1.gagal-1.json', 3]);
  assert.match(runsGagal[0].detail_status, /UND_ERR_SOCKET/);
  assert.deepEqual(ringkasan, [], 'run yang gagal tidak masuk daftar run');
  assert.equal(ditulis, 0, 'tidak ada ringkasan yang ditulis untuk run yang tidak selesai');
});

test('U3 jalur sukses tidak berubah: tidak ada bukti kegagalan dan gagalDeteksi false', async () => {
  const folder = folderSementara();
  const kirim = kirimPalsu({ deteksi: hasilBerjawab(DETEKSI_OK), verifikasi: (k) => hasilBerjawab(verifikasiOk(`SONAR-0${k}`)) });
  const ringkasan = [];
  const runsGagal = [];
  const hasil = await llmScan.jalankanDaftarRun(konteksUji(folder, kirim), [1], { ringkasan, runsGagal, tulisSummary: () => {} });
  assert.deepEqual(hasil, { galat: null, gagalDeteksi: false });
  assert.deepEqual(kirim.log, ['deteksi', 'verifikasi', 'verifikasi']);
  assert.deepEqual(fs.readdirSync(folder).sort(), ['run-1.json', 'run-1.raw.json']);
  assert.equal(ringkasan.length, 1);
  assert.deepEqual(runsGagal, []);
});

test('U3 hanya status error yang menghentikan: refusal, truncated, dan parse_ok false tetap ke verifikasi', async () => {
  // Itu jawaban model yang dicatat sebagai panggilan tanpa hasil (README prompt bagian 7-8), bukan
  // kegagalan menjangkau vendor. Menghentikan run di situ akan mengubah arti data yang sudah terbit.
  for (const [status, detail, teks] of [['refusal', 'refusal', undefined], ['truncated', 'incomplete max_output_tokens', '{"tem'], ['ok', 'completed', 'bukan json']]) {
    const folder = folderSementara();
    const kirim = kirimPalsu({
      deteksi: hasilBerjawab(teks, status, detail),
      verifikasi: (k) => hasilBerjawab(verifikasiOk(`SONAR-0${k}`)),
    });
    const hasil = await llmScan.jalankanDaftarRun(konteksUji(folder, kirim), [1], { ringkasan: [], runsGagal: [], tulisSummary: () => {} });
    assert.equal(hasil.gagalDeteksi, false, `${status}: tidak boleh dianggap deteksi gagal`);
    assert.equal(kirim.log.filter((x) => x === 'verifikasi').length, 2, `${status}: verifikasi tetap berjalan`);
    assert.ok(fs.existsSync(path.join(folder, 'run-1.json')), `${status}: run tetap tersimpan`);
  }
});

test('U3 galat fatal (mis. HTTP 400) tetap RunDibuang: dicatat sebagai galat permanen dan run-N.json tersimpan', async () => {
  const folder = folderSementara();
  const kirim = kirimPalsu({ deteksi: hasilGagalHabis(true) });
  const hasil = await llmScan.jalankanDaftarRun(konteksUji(folder, kirim), [1, 2], { ringkasan: [], runsGagal: [], tulisSummary: () => {} });
  assert.equal(hasil.gagalDeteksi, false, 'fatal bukan RunGagal');
  assert.match(hasil.galat, /Run dibuang: perbaiki kode, lalu ulang seluruh run/);
  assert.ok(fs.existsSync(path.join(folder, 'run-1.json')), 'perilaku lama: run fatal tetap tersimpan');
  assert.deepEqual(kirim.log, ['deteksi'], 'run 2 tidak dicoba');
});

// ---------- U3 sebagai proses: kode keluar, summary.json, dan --lanjut, tanpa API sungguhan ----------
// Gerbang "kode alat bersih" menolak setiap run non-kering selama pohon kerja berubah, jadi proses ini
// dijalankan dari SALINAN BERSIH alat di folder sementara (scripts dan prompts, di-commit di repo
// sementaranya). Dengan begitu tes ini lulus di pohon kerja kotor maupun bersih. cwd diset ke folder
// kosong supaya dotenv tidak pernah memuat .env milik repo sungguhan, dan server palsu menjawab 503.

const mkdtemp = (awalan) => fs.mkdtempSync(path.join(os.tmpdir(), awalan));
const gitDi = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();

const salinanAlatBersih = () => {
  const dir = mkdtemp('alat-bersih-');
  for (const d of ['scripts', 'prompts']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  gitDi(dir, 'init', '-q');
  gitDi(dir, 'add', '.');
  gitDi(dir, 'commit', '-q', '-m', 'salinan alat');
  return dir;
};

const objekDanBeku = () => {
  const objek = mkdtemp('objek-run-');
  fs.mkdirSync(path.join(objek, 'src'));
  fs.writeFileSync(path.join(objek, 'src', 'a.js'), 'const q = 1;\nquery(`x ${q}`);\n');
  gitDi(objek, 'init', '-q');
  gitDi(objek, 'add', '.');
  gitDi(objek, 'commit', '-q', '-m', 'awal');
  const revisi = gitDi(objek, 'rev-parse', 'HEAD');
  const treeSrc = gitDi(objek, 'rev-parse', 'HEAD:src');
  const bekuSonar = require('../scripts/llm/sonar-beku');
  const file = path.join(mkdtemp('beku-run-'), 'sonar-beku.json');
  bekuSonar.tulisBeku(file, bekuSonar.buatIsiBeku({
    laporan: {
      project: 'p', branch: 'main', analisis: { tanggal: '2026-10-19T00:00:00+0000', revisi }, galat: [],
      issues: [1, 2].map((n) => ({ rule: 'jssecurity:S3649', severity: 'BLOCKER', type: 'VULNERABILITY', component: 'p:src/a.js', line: n, message: `SQLi ${n}`, impacts: [] })),
      hotspots: [], cwe_rule: { 'jssecurity:S3649': ['CWE-89'] },
    },
    treeSrcAnalisis: treeSrc,
    dibuat: '2026-10-19T00:00:00.000Z',
  }));
  return { objek, beku: file };
};

const jalankanProses = (klon, args, cwd) => new Promise((resolve) => {
  // Kunci vendor lain dikosongkan; OPENAI diisi palsu. Tidak ada yang dibaca dari .env.
  const anak = spawn(process.execPath, [path.join(klon, 'scripts', 'llm-scan.js'), ...args], {
    cwd,
    env: {
      ...process.env, NODE_PATH: path.join(ROOT, 'node_modules'),
      OPENAI_BASE_URL: `${dasar}/v1`, OPENAI_API_KEY: 'kunci-palsu-untuk-tes', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '',
    },
  });
  let out = '';
  let err = '';
  anak.stdout.on('data', (d) => { out += d; });
  anak.stderr.on('data', (d) => { err += d; });
  anak.on('close', (kode) => resolve({ kode, out, err }));
});

test('U3 proses nyata: kode keluar 1, summary.json mencatat run gagal, verifikasi tidak jalan, --lanjut tidak menimpa', async () => {
  // Server ditutup oleh tes ECONNREFUSED di atas; untuk bagian ini dibuat server baru dengan basis URL
  // yang diberikan langsung ke proses anak lewat env, bukan ke klien yang di-cache di proses tes ini.
  const serverBaru = nodeHttp.createServer((req, res) => {
    jumlahPermintaan += 1;
    req.resume();
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0.01' });
    res.end(JSON.stringify({ error: { message: 'overloaded' } }));
  });
  await new Promise((r) => serverBaru.listen(0, '127.0.0.1', r));
  dasar = `http://127.0.0.1:${serverBaru.address().port}`;
  jumlahPermintaan = 0;
  try {
    const klon = salinanAlatBersih();
    const { objek, beku } = objekDanBeku();
    const cwdKosong = mkdtemp('cwd-kosong-');
    const args = ['--vendor=openai', '--kondisi=utama', '--skenario=B', `--objek=${objek}`, `--sonar-beku=${beku}`, '--runs=2'];

    const satu = await jalankanProses(klon, args, cwdKosong);
    assert.equal(satu.kode, 1, `kode keluar harus 1; stdout:\n${satu.out}\nstderr:\n${satu.err}`);
    assert.equal(jumlahPermintaan, 3, 'tiga percobaan deteksi, tanpa satu pun verifikasi dan tanpa run 2');
    assert.match(satu.err, /Run 1 dihentikan: deteksi gagal setelah 3 percobaan/);
    assert.match(satu.out, /Dihentikan, hasil sebagian di /);
    assert.doesNotMatch(satu.out, /^Selesai\./m, 'run yang berhenti tidak boleh berakhir dengan kalimat "Selesai"');
    assert.doesNotMatch(satu.out, /verifikasi SONAR/, 'verifikasi tidak boleh dimulai');

    const folderHasil = path.join(klon, 'llm-output', 'v2', fs.readdirSync(path.join(klon, 'llm-output', 'v2'))[0]);
    assert.ok(fs.existsSync(path.join(folderHasil, 'run-1.gagal-1.json')));
    assert.ok(!fs.existsSync(path.join(folderHasil, 'run-1.json')), 'nomor 1 tidak terpakai');
    const summary = JSON.parse(fs.readFileSync(path.join(folderHasil, 'summary.json'), 'utf8'));
    assert.deepEqual(summary.runs, []);
    assert.equal(summary.galat, null, 'kegagalan jaringan bukan galat permanen');
    assert.equal(summary.runs_gagal.length, 1);
    assert.deepEqual([summary.runs_gagal[0].run, summary.runs_gagal[0].berkas, summary.runs_gagal[0].percobaan], [1, 'run-1.gagal-1.json', 3]);
    assert.equal(summary.runs_gagal[0].commit_kode, gitDi(klon, 'rev-parse', 'HEAD'));
    assert.equal(summary.total_run_diminta, 2);
    // Batas sambungan baru tercatat di provenance run ini.
    assert.equal(summary.pengaturan.koneksi.connect_timeout_ms, 30000);

    // --lanjut: nomor 1 dijalankan lagi, bukti pertama tetap utuh, dan riwayat kegagalan bertambah.
    const bukti1 = fs.readFileSync(path.join(folderHasil, 'run-1.gagal-1.json'), 'utf8');
    const dua = await jalankanProses(klon, [...args, `--lanjut=${folderHasil}`], cwdKosong);
    assert.equal(dua.kode, 1, `stdout:\n${dua.out}\nstderr:\n${dua.err}`);
    assert.match(dua.out, /run 1 dari 2 \(lanjut\)/, '--lanjut merencanakan nomor 1 lagi, bukan 2');
    assert.equal(fs.readFileSync(path.join(folderHasil, 'run-1.gagal-1.json'), 'utf8'), bukti1);
    assert.ok(fs.existsSync(path.join(folderHasil, 'run-1.gagal-2.json')));
    const summary2 = JSON.parse(fs.readFileSync(path.join(folderHasil, 'summary.json'), 'utf8'));
    assert.deepEqual(summary2.runs_gagal.map((x) => x.berkas), ['run-1.gagal-1.json', 'run-1.gagal-2.json']);
    assert.equal(jumlahPermintaan, 6);
  } finally {
    serverBaru.close();
    serverBaru.closeAllConnections?.();
  }
});
