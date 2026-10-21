// Hasil skema 2 untuk skenario A: SAST saja, tanpa satu pun panggilan LLM.
//
// Tanpa berkas ini, run skenario A berjalan dan sukses tetapi tidak pernah muncul di dashboard:
// jalur v1 menerbitkan skema 1 ke index-v1.json, sedangkan dashboard hanya membaca skema 2 dari
// index.json. Itu yang terjadi pada run #3 repo demo.
//
// Perakitnya sama dengan skenario B dan C (susunHasilV2), jadi yang diuji di sini adalah bahwa
// skenario A memang menghasilkan bentuk yang sah DAN jujur: tanpa temuan, tanpa putusan, tanpa
// biaya, dan dengan alert yang dipilih persis seperti jalur B memilihnya.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { susunHasilV2, petakanAlert } = require('../scripts/llm/results-v2');
const { parseCwe } = require('../scripts/merge-results');
const { validasiSkema } = require('../scripts/validasi-skema');
const render = require('../scripts/llm/render');
const skemaV2 = require('../docs/design/results-v2.schema.json');

const ALERT = [
  { id: 'SONAR-01', rule: 'javascript:S5122', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/app.js', baris: 10, cwe: ['CWE-346'], pesan: 'CORS', severity: 'MAJOR', keamanan: true },
  { id: 'SONAR-02', rule: 'javascript:S2068', tipe: 'VULNERABILITY', sumber: 'issue', file: 'src/a.js', baris: 2, cwe: ['CWE-798'], pesan: 'password', severity: 'BLOCKER', keamanan: true },
];

const hasilA = ({ alert = ALERT } = {}) => susunHasilV2({
  summary: {
    versi_prompt: render.VERSI_PROMPT, vendor: null, model_diminta: null, kondisi: 'utama', skenario: 'A',
    objek_uji: { commit: 'a'.repeat(40), branch: 'main', tree_src: 'b'.repeat(40) },
    analisis_sonar: '2026-10-20T08:00:00+0000', revisi_analisis_sonar: 'c'.repeat(40),
    tree_src_analisis_sonar: 'b'.repeat(40), sumber_sonar: 'api', sonar_beku: null,
    sonar: { project: 'p', branch: 'main', jumlah_issue: alert.length, jumlah_hotspot: 0, jumlah_alert: alert.length },
    hash_kode_sumber: null, tarif: null,
  },
  run: {
    nomor: 3, skenario: 'A', mode_model: 'tunggal', model_menjawab: null,
    mulai: '2026-10-20T10:00:00.000Z', selesai: '2026-10-20T10:00:05.000Z', durasi_detik: 5,
    biaya_usd: 0, status_panggilan: { total: 0, ok: 0, refusal: 0, truncated: 0, error: 0, parse_gagal: 0 },
    hash_prompt: { system: null, user_deteksi: null }, temuan: [], verifikasi: [],
  },
  nomor: 3, id: 123, alert, parseCwe, repo: 'o/r',
});

test('hasil skenario A sah terhadap skema results v2', () => {
  const galat = validasiSkema(skemaV2, hasilA());
  assert.deepEqual(galat, [], `hasil skenario A tidak sah:\n  ${galat.join('\n  ')}`);
});

test('skenario A: hanya alert Sonar, tanpa temuan, tanpa biaya', () => {
  const h = hasilA();
  assert.equal(h.run.skenario, 'A');
  assert.equal(h.findings.length, 0, 'tidak ada panggilan deteksi, jadi tidak boleh ada temuan');
  assert.equal(h.alerts.length, ALERT.length, 'seluruh alert Sonar ikut');
  assert.equal(h.run.biaya_usd, 0);
  assert.deepEqual(h.run.status_panggilan, {
    total: 0, ok: 0, refusal: 0, truncated: 0, error: 0, parse_gagal: 0, deteksi_kosong: 0,
  });
  // Nol panggilan bukan nol token thinking: skenario A tidak memanggil model sama sekali, dan 0 di
  // sini terbaca seolah model dipanggil lalu tidak berpikir.
  assert.deepEqual(h.run.thinking_token, { deteksi: null, total: null });
});

test('skenario A tidak mengaku punya vendor atau model', () => {
  // Mengisi vendor dengan nama mana pun berarti mengarang: tidak ada model yang dipanggil.
  const h = hasilA();
  assert.equal(h.run.vendor, null);
  assert.equal(h.run.model_diminta, null);
  assert.equal(h.run.model_menjawab, null);
  assert.equal(h.run.hash_prompt.system, null, 'tidak ada prompt yang dirakit');
  assert.equal(h.run.hash_prompt.user_deteksi, null);
});

test('alert skenario A membawa severity Sonar apa adanya, tanpa putusan model', () => {
  const h = hasilA();
  assert.deepEqual(h.alerts.map((a) => a.severity_sonar), ['MAJOR', 'BLOCKER']);
  for (const a of h.alerts) {
    assert.equal(a.severity_asal, 'sonar');
    assert.equal(a.putusan, null, 'tidak ada verifikasi, jadi tidak ada putusan');
    assert.equal(a.keyakinan, null);
    assert.equal(a.alasan, null);
    // Inti bedanya: "belum diverifikasi" bukan "diverifikasi tetapi jawabannya tidak sah".
    assert.equal(a.putusan_asal, 'tanpa-verifikasi');
  }
});

test('putusan_asal membedakan A dari verifikasi yang jawabannya tidak sah', () => {
  // Skenario B tanpa verifikasi yang sah: putusan_asal null, bukan tanpa-verifikasi.
  const b = petakanAlert(ALERT, [], 'B');
  assert.deepEqual(b.map((a) => a.putusan_asal), [null, null]);
  // Skenario B dengan verifikasi sah.
  const sah = petakanAlert(ALERT, [{ id_alert: 'SONAR-01', putusan: 'true_positive', keyakinan: 'high', alasan: 'ya', metadata: { status: 'ok', parse_ok: true } }], 'B');
  assert.equal(sah[0].putusan_asal, 'verifikasi-model');
  assert.equal(sah[1].putusan_asal, null);
  // Run lama tanpa skenario berperilaku seperti B.
  assert.deepEqual(petakanAlert(ALERT, []).map((a) => a.putusan_asal), [null, null]);
});

test('alert skenario A dipilih dengan fungsi yang sama dengan jalur B', () => {
  // Kalau A dan B memilih alert dengan cara berbeda, angka keduanya tidak bisa dibandingkan dan
  // skenario A kehilangan gunanya sebagai pembanding. Skripnya karena itu wajib memakai
  // render.pilihAlert, bukan penyaringan sendiri.
  const skrip = fs.readFileSync(path.join(ROOT, 'scripts', 'hasil-skenario-a.js'), 'utf8');
  assert.match(skrip, /render\.pilihAlert\(/, 'skenario A harus memakai pemilih alert jalur v2');
  assert.match(skrip, /siapkanSonar/, 'laporan Sonar diambil lewat jalur yang sama dengan llm-scan');
  // Dan tidak boleh ada jalan ke API LLM mana pun dari skrip ini.
  assert.ok(!/GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(skrip), 'skenario A tidak boleh menyentuh kunci API LLM');
  assert.ok(!/llm-remediasi|panggilModel|jalankanSatuRun/.test(skrip), 'skenario A tidak boleh memanggil model');
});

test('workflow menyusun dan menerbitkan hasil skenario A tanpa penerbitan kedua', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  // Langkah penyusun ada, dijaga skenario A, dan tidak membawa kunci API LLM.
  const i = wf.indexOf('- name: Susun hasil skema 2 (skenario A)');
  assert.ok(i > 0, 'langkah penyusun skenario A tidak ada');
  // Dibatasi sampai langkah berikutnya: jendela tetap akan menyeberang ke langkah Gemini di
  // bawahnya, yang memang membawa kunci API, dan membuat tes ini menuduh langkah yang salah.
  const blok = wf.slice(i, wf.indexOf('      - name:', i + 10));
  assert.match(blok, /if: needs\.rencana\.outputs\.skenario == 'A'/);
  assert.match(blok, /hasil-skenario-a\.js/);
  assert.ok(!/GEMINI_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(blok), 'langkah skenario A tidak boleh membawa kunci LLM');

  // Penerbitan skema 2 skenario A terjadi di DALAM job yang sama dengan skema 1, pada worktree yang
  // sama, sehingga ikut satu commit dan satu push. Dua job yang sama-sama menerbitkan pernah
  // membuat hasil run #46 hilang; bentuk itu tidak boleh kembali.
  const jobHasil = wf.slice(wf.indexOf('\n  hasil:'));
  const terbitSkema1 = jobHasil.indexOf('publish --results=results.json');
  const terbitSkemaA = jobHasil.indexOf('publish --results=gemini-output/results-v2-a.json');
  const commit = jobHasil.indexOf('git -C ../pub commit');
  assert.ok(terbitSkema1 > 0 && terbitSkemaA > terbitSkema1, 'penerbitan skenario A harus sesudah skema 1');
  assert.ok(terbitSkemaA < commit, 'kedua penerbitan harus mendahului satu commit yang sama');
  // Hanya ada satu perintah push di job ini.
  assert.equal([...jobHasil.matchAll(/git -C \.\.\/pub push/g)].length, 1, 'job hasil harus push tepat sekali');
  // Dan job terbit-v2 tidak ikut berjalan untuk skenario A, karena A bukan mode sast-llm.
  const blokTerbitV2 = wf.slice(wf.indexOf('\n  terbit-v2:'), wf.indexOf('\n  hasil:'));
  assert.match(blokTerbitV2, /needs\.rencana\.outputs\.mode == 'sast-llm'/);
});
