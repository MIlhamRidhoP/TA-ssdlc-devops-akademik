// Tes prompt v2 tanpa panggilan API: renderer, validator, pemetaan status, dan pengulangan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const render = require('../scripts/llm/render');
const { validasiDeteksi, validasiVerifikasi } = require('../scripts/llm/validate');
const google = require('../scripts/llm/adapters/google');
const anthropic = require('../scripts/llm/adapters/anthropic');
const openai = require('../scripts/llm/adapters/openai');
const { panggilDenganUlang } = require('../scripts/llm/panggil');
const { periksaObjek, periksaBranchKondisi, ambilSonar, treeSrc, percobaanGagal, biayaPercobaanGagal } = require('../scripts/llm-scan');
const { VENDOR, hitungBiaya } = require('../scripts/llm/vendor');
const httpLlm = require('../scripts/llm/http');
const undici = require('undici');
const nodeHttp = require('http');
const AnthropicSdk = require('@anthropic-ai/sdk');
const OpenAISdk = require('openai');

const buatObjek = (file) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objek-v2-'));
  for (const [rel, isi] of Object.entries(file)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), isi);
  }
  return dir;
};

test('kode sumber: urutan code unit, LF, baris terakhir, format nomor baris', () => {
  const dir = buatObjek({
    'src/b.js': 'x\r\n\r\ny\n',
    'src/a/z.js': 'satu\rdua',
    'src/A.js': '',
    'src/catatan.txt': 'bukan js',
  });
  const k = render.bentukKodeSumber(dir);
  assert.deepEqual(k.file.map((f) => f.path), ['src/A.js', 'src/a/z.js', 'src/b.js']);
  assert.equal(k.teks, [
    '===== FILE: src/A.js =====\n1 | ',
    '===== FILE: src/a/z.js =====\n1 | satu\n2 | dua',
    '===== FILE: src/b.js =====\n1 | x\n2 | \n3 | y',
  ].join('\n\n'));
  assert.deepEqual(k.file.map((f) => f.jumlah_baris), [1, 2, 3]);
  assert.equal(render.bentukKodeSumber(dir).teks, k.teks);
});

test('isiTemplate: literal, satu lintasan, isi variabel tidak ikut diganti', () => {
  assert.equal(render.isiTemplate('A {{X}} B {{Y}}', { Y: '{{X}}', X: '$&' }), 'A $& B {{X}}');
  assert.throws(() => render.isiTemplate('A {{X}} {{Z}}', { X: '1' }), /sisa "\{\{"/);
  assert.throws(() => render.isiTemplate('A', { X: '1' }), /tidak ada di template/);
});

test('file prompt v2 cocok dengan HASHES.txt dan dipakai sebagai hash template', () => {
  assert.equal(render.cekHashPrompt(), 8);
  const template = render.bacaTemplate();
  const hashes = Object.fromEntries(fs.readFileSync(path.join(render.PROMPT_DIR, 'HASHES.txt'), 'utf8')
    .trim().split(/\r?\n/).map((b) => b.trim().split(/\s+/).reverse()));
  const p = render.rakitPrompt({ template, kondisi: 'utama', tugas: 'deteksi', kodeSumber: 'KODE' });
  assert.equal(p.hash.system, hashes['system.txt']);
  assert.equal(p.hash.template_tugas, hashes['task-detection.txt']);
  assert.equal(p.hash.skema, hashes['detection.schema.json']);
  assert.equal(p.hash.kode_sumber, render.sha256('KODE'));
  assert.equal(p.hash.laporan_sonar, null);
  assert.equal(p.hash.alert, null);
});

test('rakitPrompt: blok digabung "\\n\\n", blok 1 terpisah untuk Claude, sisa {{ di kode diperbolehkan', () => {
  const template = render.bacaTemplate();
  const kode = '===== FILE: src/x.js =====\n1 | const t = `{{ID}}`;';
  const ver = render.rakitPrompt({ template, kondisi: 'utama', tugas: 'verifikasi', kodeSumber: kode, alertTeks: 'Alert ID: SONAR-01' });
  assert.equal(ver.blok_user.join(''), ver.user);
  assert.ok(ver.blok_user[0].startsWith('SOURCE CODE\n\n'));
  assert.ok(ver.blok_user[0].endsWith(kode));
  assert.ok(ver.blok_user[1].startsWith('\n\nTASK: VERIFY ONE STATIC ANALYSIS ALERT'));
  assert.ok(ver.blok_user[1].endsWith('ALERT\n\nAlert ID: SONAR-01'));
  assert.equal(ver.system, template.system.teks.trimEnd());
  assert.equal(ver.hash.alert, render.sha256('Alert ID: SONAR-01'));

  const sonar = render.rakitPrompt({ template, kondisi: 'sonar_di_deteksi', tugas: 'deteksi', kodeSumber: kode, sonarTeks: '(no alerts)' });
  assert.ok(sonar.blok_user[1].startsWith('\n\nSONARCLOUD REPORT'));
  assert.ok(sonar.blok_user[1].includes('(no alerts)\n\nTASK: SECURITY REVIEW'));
  assert.throws(() => render.rakitPrompt({ template, kondisi: 'sonar_di_deteksi', tugas: 'verifikasi', kodeSumber: kode, alertTeks: 'x' }));
});

test('pembagian blok: blok 1 + blok 2 identik byte per byte dengan teks user kanonik, untuk semua kondisi dan tugas', () => {
  const template = render.bacaTemplate();
  const kode = '===== FILE: src/x.js =====\n1 | a\n2 | ';
  const kasus = [
    { kondisi: 'utama', tugas: 'deteksi' },
    { kondisi: 'utama', tugas: 'verifikasi', alertTeks: 'Alert ID: SONAR-01\nRule: r' },
    { kondisi: 'sonar_di_deteksi', tugas: 'deteksi', sonarTeks: 'Alert ID: SONAR-01\n\nAlert ID: SONAR-02' },
    { kondisi: 'komentar_menyesatkan', tugas: 'deteksi' },
  ];
  for (const k of kasus) {
    const p = render.rakitPrompt({ template, kodeSumber: kode, ...k });
    assert.equal(Buffer.compare(Buffer.from(p.blok_user.join(''), 'utf8'), Buffer.from(p.user, 'utf8')), 0);
    assert.equal(render.sha256(p.blok_user.join('')), p.hash.prompt_user_kanonik);
    // Teks kanonik tetap gabungan blok dengan pemisah "\n\n" (README bagian 3).
    assert.equal(p.user, `${p.blok_user[0]}\n\n${p.blok_user[1].slice(2)}`);
  }
  // Adapter Claude dan OpenAI memakai pembagian blok yang sama.
  const p = render.rakitPrompt({ template, kodeSumber: kode, kondisi: 'utama', tugas: 'deteksi' });
  const claude = anthropic.bodyRequest({ model: 'm', system: p.system, blokUser: p.blok_user, skema: {}, batasOutput: 1, tingkatThinking: 'high' });
  const gpt = openai.bodyRequest({ model: 'm', system: p.system, blokUser: p.blok_user, skema: {}, namaSkema: 'deteksi', batasOutput: 1, tingkatThinking: 'high' });
  assert.equal(claude.messages[0].content.map((c) => c.text).join(''), p.user);
  assert.equal(gpt.input[1].content.map((c) => c.text).join(''), p.user);
});

test('alert Sonar: filter, urutan file/baris/rule, ID dua digit, format', () => {
  const r = [
    { sumber: 'issue', rule: 'javascript:S7772', tipe: 'CODE_SMELL', file: 'src/a.js', baris: 1, pesan: 'node:fs', cwe: [], keamanan: false },
    { sumber: 'issue', rule: 'r:B', tipe: 'VULNERABILITY', file: 'src/b.js', baris: 9, pesan: 'satu\ndua', cwe: ['CWE-89'], keamanan: true },
    { sumber: 'hotspot', rule: 'r:A', tipe: 'SECURITY_HOTSPOT', file: 'src/b.js', baris: null, pesan: 'h', cwe: [], keamanan: true },
    { sumber: 'issue', rule: 'r:A', tipe: 'CODE_SMELL', file: 'src/b.js', baris: 9, pesan: 'smell ber-CWE', cwe: ['CWE-1333', 'CWE-400'], keamanan: false },
  ];
  const alert = render.pilihAlert(r);
  assert.deepEqual(alert.map((a) => [a.id, a.rule, a.baris]), [['SONAR-01', 'r:A', null], ['SONAR-02', 'r:A', 9], ['SONAR-03', 'r:B', 9]]);
  const t = render.bacaTemplate().alert.teks;
  assert.equal(render.formatAlert(alert[0], t), 'Alert ID: SONAR-01\nRule: r:A\nType: SECURITY_HOTSPOT\nLocation: src/b.js:0\nMessage: h\nMapped CWE: none');
  assert.ok(render.formatAlert(alert[2], t).includes('Message: satu dua\nMapped CWE: CWE-89'));
  assert.ok(render.formatAlert(alert[1], t).endsWith('Mapped CWE: CWE-1333, CWE-400'));
  assert.equal(render.laporanSonar([]), '(no alerts)');
});

const infoFile = [{ path: 'src/a.js', jumlah_baris: 10 }];
const temuan = (ubah = {}) => ({
  file: 'src/a.js', baris: 3, fungsi: 'list', jenis: 'SQL Injection', cwe: 'CWE-89', kategori_owasp: 'A05',
  penjelasan: 'x', sifat: 'vulnerability', keyakinan: 'high', ...ubah,
});

test('validasi deteksi: enum tanpa beda huruf, CWE, baris, file', () => {
  const v = validasiDeteksi(JSON.stringify({ temuan: [
    temuan({ kategori_owasp: 'a05', sifat: 'Hardening', keyakinan: 'HIGH', cwe: ' cwe-89 ' }),
    temuan({ kategori_owasp: 'OTHER' }),
    temuan({ kategori_owasp: 'A11', cwe: 'CWE 89', baris: 11 }),
    temuan({ file: 'src/tidak.js', baris: 0 }),
  ] }), infoFile);
  assert.equal(v.parse_ok, true);
  assert.deepEqual([v.temuan[0].kategori_owasp, v.temuan[0].sifat, v.temuan[0].keyakinan, v.temuan[0].cwe], ['A05', 'hardening', 'high', 'CWE-89']);
  assert.deepEqual(v.temuan[0].tanda, []);
  assert.equal(v.temuan[1].kategori_owasp, 'Other');
  assert.deepEqual(v.temuan[2].tanda, ['nilai_tidak_valid', 'cwe_tidak_valid', 'baris_tidak_valid']);
  assert.equal(v.temuan[2].cwe, 'CWE 89');
  assert.deepEqual(v.temuan[3].tanda, ['file_tidak_dikenal']);
});

test('validasi deteksi: struktur salah membuat parse_ok false', () => {
  assert.equal(validasiDeteksi('bukan json', infoFile).parse_ok, false);
  assert.equal(validasiDeteksi(JSON.stringify({ temuan: [temuan({ tambahan: 1 })] }), infoFile).parse_ok, false);
  assert.equal(validasiDeteksi(JSON.stringify({ temuan: [temuan({ baris: '3' })] }), infoFile).parse_ok, false);
  assert.equal(validasiDeteksi(JSON.stringify({ temuan: [], lain: 1 }), infoFile).parse_ok, false);
  assert.deepEqual(validasiDeteksi('{"temuan":[]}', infoFile), { parse_ok: true, temuan: [] });
});

test('validasi verifikasi: enum dan id_alert', () => {
  const ok = validasiVerifikasi(JSON.stringify({ id_alert: 'SONAR-02', alasan: 'a', putusan: 'FALSE_POSITIVE', keyakinan: 'low' }), 'SONAR-01');
  assert.equal(ok.parse_ok, true);
  assert.equal(ok.hasil.putusan, 'false_positive');
  assert.deepEqual(ok.hasil.tanda, ['id_tidak_cocok']);
  const salah = validasiVerifikasi(JSON.stringify({ id_alert: 'SONAR-01', alasan: 'a', putusan: 'maybe', keyakinan: 'low' }), 'SONAR-01');
  assert.deepEqual(salah.hasil.tanda, ['nilai_tidak_valid']);
  assert.equal(validasiVerifikasi('{}', 'SONAR-01').parse_ok, false);
});

test('status Gemini: STOP, MAX_TOKENS, SAFETY, blockReason, thought dibuang', () => {
  const k = (finishReason, parts = [{ text: '{}' }]) => ({ candidates: [{ finishReason, content: { parts } }], modelVersion: 'm', usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 5 } });
  const ok = google.tafsirRespons(k('STOP', [{ text: 'pikir', thought: true }, { text: '{"a":1}' }]));
  assert.equal(ok.status, 'ok');
  assert.equal(ok.teks, '{"a":1}');
  assert.deepEqual(ok.usage, { input: 10, input_dari_cache: 4, input_tulis_cache: 0, output: 2, thinking: 5 });
  assert.equal(google.tafsirRespons(k('MAX_TOKENS')).status, 'truncated');
  assert.equal(google.tafsirRespons(k('SAFETY')).status, 'refusal');
  assert.equal(google.tafsirRespons(k('OTHER')).status, 'error');
  assert.equal(google.tafsirRespons({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }).status, 'refusal');
  const body = google.bodyRequest({ system: 's', user: 'u', skema: {}, batasOutput: 64000, tingkatThinking: 'high' });
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  assert.ok(!('temperature' in body.generationConfig) && !('tools' in body));
});

test('status Claude: end_turn, max_tokens, refusal; body tanpa sampling, tools, fallback', () => {
  const m = (stop_reason, ekstra = {}) => ({ stop_reason, model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 7 }, ...ekstra });
  const ok = anthropic.tafsirRespons(m('end_turn'));
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.usage, { input: 105, input_dari_cache: 100, input_tulis_cache: 0, output: 7, thinking: null });
  assert.equal(anthropic.tafsirRespons(m('max_tokens')).status, 'truncated');
  const tolak = anthropic.tafsirRespons(m('refusal', { stop_details: { category: 'cyber' } }));
  assert.equal(tolak.status, 'refusal');
  assert.match(tolak.detail_status, /cyber/);
  const body = anthropic.bodyRequest({ model: 'claude-sonnet-5-5', system: 's', blokUser: ['b1', 'b2'], skema: {}, batasOutput: 64000, tingkatThinking: 'high' });
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.equal(body.messages[0].content[1].cache_control, undefined);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'output_config', 'system']);
});

test('status OpenAI: completed, refusal, incomplete; usage cache tulis masuk biaya', () => {
  const r = (status, content, ekstra = {}) => ({ status, model: 'gpt-6.1-sol', output: [{ type: 'reasoning' }, { type: 'message', content }], usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 30 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 20 } }, ...ekstra });
  const ok = openai.tafsirRespons(r('completed', [{ type: 'output_text', text: '{}' }]));
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.usage, { input: 50, input_dari_cache: 10, input_tulis_cache: 30, output: 10, thinking: 20 });
  // 10 input biasa x $2 + 10 cache baca x $0,10 + 30 cache tulis x $2,50 + 30 output (termasuk reasoning) x $10, per 1 juta
  assert.equal(hitungBiaya(ok.usage, VENDOR.openai.tarif), Number(((10 * 2 + 10 * 0.1 + 30 * 2.5 + 30 * 10) / 1e6).toFixed(6)));
  // Run uji 2026-10-19, verifikasi SONAR-02: cache_write_tokens dari respons asli
  const asli = openai.tafsirRespons(r('completed', [{ type: 'output_text', text: '{}' }], { usage: { input_tokens: 30916, input_tokens_details: { cache_write_tokens: 30913, cached_tokens: 0 }, output_tokens: 340, output_tokens_details: { reasoning_tokens: 211 } } }));
  assert.ok(Math.abs(hitungBiaya(asli.usage, VENDOR.openai.tarif) - (3 * 2 + 30913 * 2.5 + 340 * 10) / 1e6) < 1e-6);
  assert.equal(openai.tafsirRespons(r('completed', [{ type: 'refusal', refusal: 'tidak' }])).status, 'refusal');
  assert.equal(openai.tafsirRespons(r('incomplete', [], { incomplete_details: { reason: 'max_output_tokens' } })).status, 'truncated');
  assert.equal(openai.tafsirRespons(r('incomplete', [], { incomplete_details: { reason: 'content_filter' } })).status, 'refusal');
  const body = openai.bodyRequest({ model: 'gpt-6.1-sol', system: 's', blokUser: ['b1', '\n\nb2'], skema: {}, namaSkema: 'deteksi', batasOutput: 64000, tingkatThinking: 'high' });
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.equal(body.text.format.strict, true);
  assert.equal(body.store, false);
  assert.ok(!('temperature' in body) && !('tools' in body) && !('prompt_cache_options' in body));
  assert.deepEqual(body.input[1].content, [
    { type: 'input_text', text: 'b1', prompt_cache_breakpoint: { mode: 'explicit' } },
    { type: 'input_text', text: '\n\nb2' },
  ]);
});

const adapterPalsu = (urutan) => {
  let i = 0;
  return { panggil: async () => urutan[Math.min(i++, urutan.length - 1)] };
};
const r503 = { http_status: 503, status: 'error', detail_status: 'overloaded', ulang: true, mentah: {} };
const rOk = { http_status: 200, status: 'ok', detail_status: 'STOP', teks: '{}', ulang: false, mentah: {} };

test('pengulangan: 5xx/429 diulang maksimal 2 kali, 400 dan penolakan tidak diulang', async () => {
  const opsi = { vendor: 'google' };
  const pulih = await panggilDenganUlang(opsi, { adapter: adapterPalsu([r503, r503, rOk]), jedaDasar: 1 });
  assert.equal(pulih.status, 'ok');
  assert.equal(pulih.percobaan.length, 3);
  const habis = await panggilDenganUlang(opsi, { adapter: adapterPalsu([r503]), jedaDasar: 1 });
  assert.equal(habis.status, 'error');
  assert.equal(habis.percobaan.length, 3);
  assert.equal(habis.fatal, false);
  const r400 = await panggilDenganUlang(opsi, { adapter: adapterPalsu([{ http_status: 400, status: 'error', ulang: false, fatal: true, mentah: {} }]), jedaDasar: 1 });
  assert.equal(r400.percobaan.length, 1);
  assert.equal(r400.fatal, true);
  const tolak = await panggilDenganUlang(opsi, { adapter: adapterPalsu([{ http_status: 200, status: 'refusal', ulang: false, mentah: {} }]), jedaDasar: 1 });
  assert.equal(tolak.status, 'refusal');
  assert.equal(tolak.percobaan.length, 1);
});

const repoUji = (file) => {
  const dir = buatObjek(file);
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  const commit = (pesan) => {
    g('add', '.');
    g('commit', '-q', '-m', pesan);
    return g('rev-parse', 'HEAD');
  };
  return { dir, g, commit };
};

test('objek uji: worktree dengan perubahan belum di-commit ditolak', () => {
  const { dir, g, commit } = repoUji({ 'src/a.js': 'x\n' });
  commit('awal');
  const o = periksaObjek(dir);
  assert.equal(o.commit, g('rev-parse', 'HEAD'));
  assert.equal(o.tree_src, g('rev-parse', 'HEAD:src'));
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'y\n');
  assert.throws(() => periksaObjek(dir), /belum di-commit/);
});

test('analisis Sonar: dicocokkan lewat hash tree src/, bukan commit', async () => {
  const { dir, commit } = repoUji({ 'src/a.js': 'x\n', 'SEEDED.md': 'A03\n' });
  const c1 = commit('awal');
  fs.writeFileSync(path.join(dir, 'SEEDED.md'), 'A05\n');
  const c2 = commit('Pemetaan OWASP ke Top 10:2025');
  assert.equal(treeSrc(dir, c1), treeSrc(dir, c2));
  assert.equal(treeSrc(dir, 'deadbeef'), null);
  const laporan = (revisi) => async () => ({ project: 'p', branch: 'main', analisis: { revisi, tanggal: 't' }, issues: [], hotspots: [], cwe_rule: {}, galat: [] });
  const hasil = await ambilSonar(periksaObjek(dir), { ambil: laporan(c1) });
  assert.equal(hasil.tree_src_analisis, treeSrc(dir, c2));
  await assert.rejects(ambilSonar(periksaObjek(dir), { ambil: laporan('0'.repeat(40)) }), /tidak ditemukan/);
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'y\n');
  commit('ubah src');
  await assert.rejects(ambilSonar(periksaObjek(dir), { ambil: laporan(c1) }), /berbeda dengan objek uji/);
  await assert.rejects(ambilSonar(periksaObjek(dir), { ambil: async () => ({ analisis: null, galat: ['issues: 500'] }) }), /tidak lengkap/);
});

test('kondisi komentar_menyesatkan di luar branch eksperimen/framing menghentikan run', () => {
  assert.throws(() => periksaBranchKondisi('komentar_menyesatkan', 'eksperimen/seeded'), /Run ditolak/);
  assert.doesNotThrow(() => periksaBranchKondisi('komentar_menyesatkan', 'eksperimen/framing'));
  assert.doesNotThrow(() => periksaBranchKondisi('utama', 'eksperimen/seeded'));
});

test('429 diulang (tidak fatal), 400 fatal: adapter SDK', () => {
  for (const [adapter, sdk] of [[anthropic, AnthropicSdk], [openai, OpenAISdk]]) {
    const rl = adapter.tafsirGalat(sdk.APIError.generate(429, {}, 'rate limited', new Headers({ 'retry-after': '3' })));
    assert.deepEqual([rl.ulang, rl.fatal, rl.http_status, rl.retry_after], [true, false, 429, '3']);
    const r5 = adapter.tafsirGalat(sdk.APIError.generate(503, {}, 'overloaded', new Headers()));
    assert.deepEqual([r5.ulang, r5.fatal], [true, false]);
    const r400 = adapter.tafsirGalat(sdk.APIError.generate(400, {}, 'bad request', new Headers()));
    assert.deepEqual([r400.ulang, r400.fatal], [false, true]);
    const koneksi = adapter.tafsirGalat(new sdk.APIConnectionError({ message: 'putus' }));
    assert.deepEqual([koneksi.ulang, koneksi.fatal], [true, false]);
    const bug = adapter.tafsirGalat(new TypeError('bug kode'));
    assert.deepEqual([bug.ulang, bug.fatal], [false, true]);
  }
});

test('429 diulang maksimal 2 kali lalu dicatat error tanpa membuang run: adapter Gemini', async () => {
  const fetchAsli = httpLlm.fetch;
  let dipanggil = 0;
  httpLlm.fetch = async () => {
    dipanggil += 1;
    return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
  };
  try {
    const r = await panggilDenganUlang({ vendor: 'google', model: 'm', system: 's', user: 'u', skema: {}, batasOutput: 1, tingkatThinking: 'high' }, { adapter: google, jedaDasar: 1 });
    assert.equal(dipanggil, 3);
    assert.deepEqual([r.status, r.fatal, r.percobaan.length], ['error', false, 3]);
    httpLlm.fetch = async () => new Response('{}', { status: 400 });
    const r400 = await panggilDenganUlang({ vendor: 'google', model: 'm', system: 's', user: 'u', skema: {}, batasOutput: 1, tingkatThinking: 'high' }, { adapter: google, jedaDasar: 1 });
    assert.deepEqual([r400.fatal, r400.percobaan.length], [true, 1]);
  } finally {
    httpLlm.fetch = fetchAsli;
  }
});

// ---------- Streaming (revisi 2026-10-19) ----------

const responsSse = (teks, { putusDi = null } = {}) => {
  const enc = new TextEncoder();
  // Potongan dikirim satu per satu lewat pull; kalau putusDi diisi, galat muncul setelah potongan pertama terbaca
  // (controller.error di start akan membuang potongan yang masih antre).
  const bagian = putusDi === null ? [teks] : [teks.slice(0, putusDi)];
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      if (i < bagian.length) c.enqueue(enc.encode(bagian[i++]));
      else if (putusDi === null) c.close();
      else c.error(new TypeError('terminated'));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
const sse = (...objek) => objek.map((o) => `data: ${JSON.stringify(o)}\r\n\r\n`).join('');
const opsiGoogle = { vendor: 'google', model: 'm', system: 's', user: 'u', skema: {}, batasOutput: 1, tingkatThinking: 'high' };

const denganFetch = async (palsu, fn) => {
  const asli = httpLlm.fetch;
  httpLlm.fetch = palsu;
  try { return await fn(); } finally { httpLlm.fetch = asli; }
};

test('Gemini SSE: potongan digabung, thought dibuang, finishReason dan usage dari potongan terakhir', async () => {
  const isi = sse(
    { candidates: [{ content: { parts: [{ text: 'pikir', thought: true }] } }], modelVersion: 'gemini-3.1-pro-preview' },
    { candidates: [{ content: { parts: [{ text: '{"temuan":' }] } }] },
    { candidates: [{ content: { parts: [{ text: '[]}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: 8, candidatesTokenCount: 3, thoughtsTokenCount: 7 } },
  );
  let url;
  const r = await denganFetch(async (u) => { url = u; return responsSse(isi); }, () => panggilDenganUlang(opsiGoogle, { adapter: google, jedaDasar: 1 }));
  assert.match(url, /:streamGenerateContent\?alt=sse$/);
  assert.equal(r.status, 'ok');
  assert.equal(r.teks, '{"temuan":[]}');
  assert.equal(r.model_menjawab, 'gemini-3.1-pro-preview');
  assert.deepEqual(r.usage, { input: 10, input_dari_cache: 8, input_tulis_cache: 0, output: 3, thinking: 7 });
  assert.equal(r.mentah.potongan.length, 3);
  assert.equal(r.percobaan.length, 1);
});

test('Gemini SSE: MAX_TOKENS, SAFETY, dan blockReason terbaca dari stream', async () => {
  const sekali = (isi) => denganFetch(async () => responsSse(isi), () => panggilDenganUlang(opsiGoogle, { adapter: google, jedaDasar: 1 }));
  assert.equal((await sekali(sse({ candidates: [{ content: { parts: [{ text: '{' }] }, finishReason: 'MAX_TOKENS' }] }))).status, 'truncated');
  assert.equal((await sekali(sse({ candidates: [{ finishReason: 'SAFETY' }] }))).status, 'refusal');
  const blok = await sekali(sse({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }));
  assert.deepEqual([blok.status, blok.detail_status], ['refusal', 'blockReason PROHIBITED_CONTENT']);
});

test('Gemini SSE: stream putus diperlakukan timeout, diulang, potongan parsial disimpan', async () => {
  const isi = sse({ candidates: [{ content: { parts: [{ text: '{"tem' }] } }] }, { candidates: [{ content: { parts: [{ text: 'uan":[]}' }] }, finishReason: 'STOP' }] });
  let ke = 0;
  const r = await denganFetch(async () => {
    ke += 1;
    return ke === 1 ? responsSse(isi, { putusDi: isi.indexOf('data:', 5) + 3 }) : responsSse(isi);
  }, () => panggilDenganUlang(opsiGoogle, { adapter: google, jedaDasar: 1 }));
  assert.equal(r.status, 'ok');
  assert.equal(r.percobaan.length, 2);
  assert.match(r.percobaan[0].detail_status, /stream terputus/);
  assert.equal(r.percobaan[0].mentah.potongan.length, 1);
  assert.equal(r.percobaan[0].usage, 'tidak_tercatat');
  const tanpaAkhir = await denganFetch(async () => responsSse(sse({ candidates: [{ content: { parts: [{ text: '{' }] } }] })), () => panggilDenganUlang(opsiGoogle, { adapter: google, jedaDasar: 1 }));
  assert.deepEqual([tanpaAkhir.status, tanpaAkhir.fatal, tanpaAkhir.percobaan.length], ['error', false, 3]);
  assert.match(tanpaAkhir.detail_status, /tanpa finishReason.*gagal setelah 3 percobaan/);
});

test('stream SDK putus diperlakukan timeout; HTTP 400 tetap fatal', () => {
  for (const [adapter, sdk] of [[anthropic, AnthropicSdk], [openai, OpenAISdk]]) {
    const putus = adapter.tafsirGalatStream(new TypeError('terminated'), { teks: '{"tem' });
    assert.deepEqual([putus.ulang, putus.fatal, putus.http_status], [true, false, null]);
    assert.match(putus.detail_status, /stream terputus/);
    assert.equal(putus.mentah.parsial.teks, '{"tem');
    const GalatDasar = sdk.OpenAIError ?? sdk.AnthropicError; // galat SDK bukan APIError, misalnya stream tanpa respons
    const tanpaRespons = adapter.tafsirGalatStream(new GalatDasar('stream ended without producing a Response'), {});
    assert.equal(tanpaRespons.ulang, true);
    const r400 = adapter.tafsirGalatStream(sdk.APIError.generate(400, {}, 'bad', new Headers()), {});
    assert.deepEqual([r400.ulang, r400.fatal, r400.http_status], [false, true, 400]);
    const r429 = adapter.tafsirGalatStream(sdk.APIError.generate(429, {}, 'rl', new Headers()), {});
    assert.deepEqual([r429.ulang, r429.fatal], [true, false]);
  }
});

test('metadata percobaan gagal: status tiap percobaan, usage tidak tercatat bukan 0', () => {
  const p = [
    { ke: 1, status: 'error', http_status: null, detail_status: 'stream terputus', usage: 'tidak_tercatat', mentah: {} },
    { ke: 2, status: 'error', http_status: 503, detail_status: 'overloaded', usage: { input: 100, output: 0 }, mentah: {} },
    { ke: 3, status: 'ok', http_status: 200, detail_status: 'STOP', usage: { input: 100, output: 5 }, mentah: {} },
  ];
  const gagal = percobaanGagal(p);
  assert.deepEqual(gagal.map((g) => [g.ke, g.status, g.usage]), [[1, 'error', 'tidak_tercatat'], [2, 'error', { input: 100, output: 0 }]]);
  assert.ok(!('mentah' in gagal[0]));
  assert.equal(biayaPercobaanGagal(gagal, VENDOR.openai.tarif), 'tidak_tercatat');
  assert.equal(biayaPercobaanGagal(gagal.slice(1), VENDOR.openai.tarif), 0.0002);
  assert.deepEqual(percobaanGagal([{ ke: 1, status: 'error', usage: 'tidak_tercatat' }]).map((g) => g.ke), [1]);
  assert.deepEqual(percobaanGagal([{ ke: 1, status: 'ok', usage: {} }]), []);
});

test('tarif cache Gemini dari halaman harga resmi', () => {
  assert.equal(VENDOR.google.tarif.input_cache_baca, 0.2);
  assert.match(VENDOR.google.tarif.sumber, /ai\.google\.dev\/gemini-api\/docs\/pricing/);
});

// ---------- Batas waktu koneksi (revisi 2026-10-19) ----------

test('koneksi: headersTimeout dan bodyTimeout sama dengan timeout SDK 20 menit, dipakai ketiga adapter', async () => {
  const duaPuluhMenit = 20 * 60 * 1000;
  assert.equal(httpLlm.TIMEOUT_MS, duaPuluhMenit);
  assert.deepEqual(httpLlm.OPSI_AGENT, { headersTimeout: duaPuluhMenit, bodyTimeout: duaPuluhMenit });
  assert.ok(httpLlm.dispatcher instanceof undici.Agent);
  assert.deepEqual(httpLlm.pengaturanKoneksi(), {
    timeout_sdk_ms: duaPuluhMenit, headers_timeout_ms: duaPuluhMenit, body_timeout_ms: duaPuluhMenit, fetch: 'undici 7.30.1',
  });
  // SDK OpenAI dan Anthropic: fetch undici dipasangkan dengan dispatcher yang sama, timeout SDK 20 menit, tanpa retry SDK.
  // Konstruktor SDK OpenAI menolak berjalan tanpa API key, jadi tes memakai key palsu sementara (CI tidak punya key).
  const kunciAsli = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  for (const k of Object.keys(kunciAsli)) process.env[k] = 'kunci-palsu-untuk-tes';
  try {
    for (const adapter of [openai, anthropic]) {
      const k = adapter.ambilKlien();
      assert.equal(k.fetch, undici.fetch);
      assert.equal(k.fetchOptions.dispatcher, httpLlm.dispatcher);
      assert.equal(k.timeout, duaPuluhMenit);
      assert.equal(k.maxRetries, 0);
    }
  } finally {
    for (const [k, v] of Object.entries(kunciAsli)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  // Gemini: http.fetch meneruskan dispatcher yang sama ke fetch undici.
  const fetchUndiciAsli = undici.fetch;
  let init;
  undici.fetch = async (_url, i) => { init = i; return new Response('{}', { status: 400 }); };
  try {
    await google.panggil({ model: 'm', system: 's', user: 'u', skema: {}, batasOutput: 1, tingkatThinking: 'high' });
  } finally {
    undici.fetch = fetchUndiciAsli;
  }
  assert.equal(init.dispatcher, httpLlm.dispatcher);
  assert.ok(init.signal);
});

// Server lokal yang menunda header atau menjeda body, untuk membuktikan opsi Agent benar-benar berlaku.
const serverLambat = (jedaHeader, jedaBody) => new Promise((resolve) => {
  const s = nodeHttp.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('a');
      setTimeout(() => res.end('b'), jedaBody);
    }, jedaHeader);
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const ambil = async (server, opsiAgent) => {
  const d = new undici.Agent(opsiAgent);
  try {
    const r = await undici.fetch(`http://127.0.0.1:${server.address().port}/`, { dispatcher: d });
    return await r.text();
  } finally {
    await d.close();
  }
};

test('koneksi: headersTimeout dan bodyTimeout di Agent menentukan kapan request diputus', async () => {
  // Pewaktu headersTimeout dan bodyTimeout undici beresolusi sekitar 0,5-1 detik, jadi jeda dibuat 2,5 detik.
  const s = await serverLambat(2500, 0);
  try {
    await assert.rejects(ambil(s, { headersTimeout: 300, bodyTimeout: 5000 }), (e) => e.cause?.code === 'UND_ERR_HEADERS_TIMEOUT');
    assert.equal(await ambil(s, { headersTimeout: 5000, bodyTimeout: 5000 }), 'ab');
  } finally {
    s.close();
  }
  const b = await serverLambat(0, 2500);
  try {
    await assert.rejects(ambil(b, { headersTimeout: 5000, bodyTimeout: 300 }), (e) => (e.cause?.code ?? e.code) === 'UND_ERR_BODY_TIMEOUT');
    assert.equal(await ambil(b, { headersTimeout: 5000, bodyTimeout: 5000 }), 'ab');
  } finally {
    b.close();
  }
});

test('metadata mencatat nilai timeout koneksi', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'llm-scan.js'), 'utf8');
  assert.equal((src.match(/koneksi: pengaturanKoneksi\(\)/g) ?? []).length, 2); // metadata panggilan + summary.json
});
