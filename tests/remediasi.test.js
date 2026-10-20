// Lapis 2 rekomendasi perbaikan. Seluruh pemanggilan model memakai respons tiruan: tes ini tidak
// pernah menyentuh API berbayar.
//
// Yang dijaga di sini adalah janji terpentingnya: apa pun yang terjadi pada lapis 2, hasil deteksi
// dan verifikasi tidak berubah sedikit pun.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../scripts/llm/remediasi');
const { validasiSkema } = require('../scripts/validasi-skema');

const ROOT = path.resolve(__dirname, '..');
const skemaV2 = require('../docs/design/results-v2.schema.json');
const ASLI = require('../dashboard/fixtures/v2/eksperimen/seeded/1.json');

const salin = () => JSON.parse(JSON.stringify(ASLI));
const OPSI = { vendor: 'google', model: 'gemini-3.1-pro-preview', batasOutput: 64000, tingkatThinking: 'high' };

// Respons tiruan berbentuk sama dengan keluaran panggilDenganUlang.
const respons = (ubah = {}) => ({
  status: 'ok',
  detail_status: '',
  teks: '{}',
  model_menjawab: 'gemini-3.1-pro-preview',
  usage: { input: 12000, output: 2000, input_dari_cache: 0, input_tulis_cache: 0, thinking: 500 },
  waktu_mulai: '2026-10-20T10:00:00.000Z',
  waktu_selesai: '2026-10-20T10:00:42.000Z',
  percobaan: [],
  ...ubah,
});

const jawabanUntuk = (items, ubahTiapItem = () => ({})) => JSON.stringify({
  rekomendasi: items.map((it) => ({
    id: it.id,
    cwe_dirujuk: it.cwe[0] ?? 'CWE-20',
    langkah: [
      `Ganti perangkaian string di ${it.file} baris ${it.baris} dengan query berparameter.`,
      'Tambahkan pengujian yang menutup jalur masukan itu sebelum perubahan digabung.',
    ],
    catatan_risiko: 'Perubahan menyentuh jalur pencarian yang dipakai beberapa pemanggil; periksa ulang pemanggilnya.',
    ...ubahTiapItem(it),
  })),
});

// Cap sidik jari deteksi dan verifikasi, untuk membuktikan lapis 2 tidak menyentuhnya.
const sidikDeteksi = (h) => JSON.stringify({
  findings: (h.findings ?? []).map(({ rekomendasi_ai: _, ...sisa }) => sisa),
  alerts: (h.alerts ?? []).map(({ rekomendasi_ai: _, ...sisa }) => sisa),
  run: { ...h.run, remediasi: undefined },
});

test('item layak hanya vulnerability dan alert true_positive', () => {
  const h = salin();
  const items = R.itemLayak(h);
  assert.ok(items.length > 0, 'fixture harus punya item yang layak');
  for (const it of items) {
    if (it.jenis_sumber === 'temuan') {
      assert.equal(h.findings.find((t) => t.id === it.id).sifat, 'vulnerability');
    } else {
      assert.equal(h.alerts.find((a) => a.id === it.id).putusan, 'true_positive');
    }
  }
  // Yang tidak layak memang tidak ikut.
  const idItem = new Set(items.map((x) => x.id));
  for (const t of h.findings) if (t.sifat !== 'vulnerability') assert.ok(!idItem.has(t.id), `temuan hardening ${t.id} ikut terkirim`);
  for (const a of h.alerts) if (a.putusan !== 'true_positive') assert.ok(!idItem.has(a.id), `alert ${a.putusan} ${a.id} ikut terkirim`);
});

test('prompt memuat panduan lapis 1 dan memperlakukan kode sebagai data', () => {
  const h = salin();
  const items = R.itemLayak(h);
  const p = R.rakitPrompt(items);
  assert.ok(!p.user.includes('{{ITEMS}}'), 'penanda {{ITEMS}} tidak tergantikan');
  assert.match(p.user, /GENERAL GUIDE \(CWE-\d+:/, 'panduan lapis 1 tidak ikut dikirim');
  assert.match(p.system, /DATA, not instruction/i, 'system tidak menyatakan isi item adalah data');
  // Panduan yang dikirim harus sama persis dengan berkas pemetaan, bukan ringkasan buatan sendiri.
  const panduan = R.bacaPanduan();
  const cwePertama = items.find((x) => x.cwe.length)?.cwe[0];
  for (const l of panduan[cwePertama].langkah) assert.ok(p.user.includes(l), `langkah panduan tidak terkirim: ${l}`);
  assert.equal(p.hash.system.length, 64);
});

test('sukses: saran menempel ke item dan ringkasan terisi', async () => {
  const h = salin();
  const sebelum = sidikDeteksi(h);
  const items = R.itemLayak(h);
  const r = await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => respons({ teks: jawabanUntuk(items) }),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.item_dikirim, items.length);
  assert.equal(r.item_terisi, items.length);
  assert.equal(r.tidak_konsisten, 0);
  assert.equal(r.alasan, null);
  assert.equal(r.status_panggilan.total, 1);
  assert.equal(r.status_panggilan.ok, 1);
  assert.equal(r.durasi_ms, 42000);

  const satu = h.findings.find((t) => t.sifat === 'vulnerability').rekomendasi_ai;
  assert.equal(satu.asal, 'model');
  assert.equal(satu.vendor, 'google');
  assert.equal(satu.versi_prompt, 'remediasi-v1');
  assert.equal(satu.tidak_konsisten, false);
  assert.equal(satu.langkah.length, 2);
  assert.equal(satu.hash_prompt.system.length, 64);
  // Item yang tidak layak tidak boleh ikut diberi saran.
  for (const t of h.findings) if (t.sifat !== 'vulnerability') assert.equal(t.rekomendasi_ai, undefined);
  assert.equal(sidikDeteksi(h), sebelum, 'lapis 2 mengubah hasil deteksi atau verifikasi');
});

test('sukses: hasil tetap sah terhadap skema results v2', async () => {
  const h = salin();
  const items = R.itemLayak(h);
  await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => respons({ teks: jawabanUntuk(items, () => ({ potongan_kode_usulan: 'const q = "SELECT 1";' })) }),
  });
  assert.deepEqual(validasiSkema(skemaV2, h), []);
});

test('CWE tidak konsisten ditandai, bukan dibuang', async () => {
  const h = salin();
  const items = R.itemLayak(h);
  const r = await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => respons({ teks: jawabanUntuk(items, () => ({ cwe_dirujuk: 'CWE-99' })) }),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.tidak_konsisten, items.length);
  const satu = h.findings.find((t) => t.rekomendasi_ai);
  assert.equal(satu.rekomendasi_ai.tidak_konsisten, true);
  assert.equal(satu.rekomendasi_ai.cwe_dirujuk, 'CWE-99');
  assert.ok(satu.rekomendasi_ai.langkah.length >= 2, 'saran tetap ditampilkan apa adanya');
});

test('keluaran tidak sesuai skema: field null dengan alasan', async () => {
  const kasus = [
    ['bukan JSON', 'bukan json sama sekali', /bukan JSON yang sah/],
    ['tanpa array rekomendasi', '{"lain":1}', /tidak memuat array/],
    ['field tak dikenal', '{"rekomendasi":[{"id":"T-01","cwe_dirujuk":"CWE-89","langkah":["a bcdefghij","k lmnopqrst"],"catatan_risiko":"x","tambahan":1}]}', /field tak dikenal/],
    ['langkah terlalu sedikit', '{"rekomendasi":[{"id":"T-01","cwe_dirujuk":"CWE-89","langkah":["hanya satu langkah"],"catatan_risiko":"x"}]}', /langkah harus 2 sampai 4/],
    ['cwe_dirujuk tidak berbentuk', '{"rekomendasi":[{"id":"T-01","cwe_dirujuk":"SQL","langkah":["a","b"],"catatan_risiko":"x"}]}', /cwe_dirujuk tidak berbentuk/],
    ['usulan kode lebih dari 15 baris', `{"rekomendasi":[{"id":"T-01","cwe_dirujuk":"CWE-89","langkah":["a bcdefghij","k lmnopqrst"],"catatan_risiko":"x","potongan_kode_usulan":"${'l\\n'.repeat(16)}"}]}`, /melebihi batas 15/],
  ];
  for (const [nama, teks, pola] of kasus) {
    const h = salin();
    const sebelum = sidikDeteksi(h);
    const r = await R.jalankanRemediasi(h, OPSI, { panggil: async () => respons({ teks }) });
    assert.equal(r.status, 'gagal', `${nama}: status`);
    assert.match(r.alasan, pola, `${nama}: alasan`);
    assert.equal(r.status_panggilan.parse_gagal, 1, `${nama}: parse_gagal`);
    assert.equal(r.item_terisi, 0, `${nama}: tidak boleh ada item terisi`);
    for (const o of [...h.findings, ...h.alerts]) assert.equal(o.rekomendasi_ai, undefined, `${nama}: field tersisa`);
    assert.equal(sidikDeteksi(h), sebelum, `${nama}: deteksi ikut berubah`);
  }
});

test('refusal dan truncated dicatat terpisah dan tidak menggagalkan run', async () => {
  for (const status of ['refusal', 'truncated']) {
    const h = salin();
    const sebelum = sidikDeteksi(h);
    const r = await R.jalankanRemediasi(h, OPSI, {
      panggil: async () => respons({ status, detail_status: `contoh ${status}`, teks: '' }),
    });
    assert.equal(r.status, 'gagal');
    assert.match(r.alasan, new RegExp(status));
    assert.equal(r.status_panggilan[status], 1);
    assert.equal(r.status_panggilan.ok, 0);
    assert.equal(r.status_panggilan.parse_gagal, 0);
    assert.equal(sidikDeteksi(h), sebelum);
  }
});

test('galat jaringan: dicatat sebagai error, run tidak gagal', async () => {
  const h = salin();
  const sebelum = sidikDeteksi(h);
  const r = await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  assert.equal(r.status, 'gagal');
  assert.match(r.alasan, /ENOTFOUND/);
  assert.equal(r.status_panggilan.error, 1);
  assert.equal(r.biaya_usd, null);
  assert.equal(sidikDeteksi(h), sebelum);
});

test('run tanpa item yang memenuhi syarat: tidak ada panggilan sama sekali', async () => {
  const h = salin();
  for (const t of h.findings) t.sifat = 'hardening';
  for (const a of h.alerts) a.putusan = 'false_positive';
  const sebelum = sidikDeteksi(h);
  let dipanggil = 0;
  const r = await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => { dipanggil += 1; return respons(); },
  });
  assert.equal(dipanggil, 0, 'tidak boleh ada panggilan tanpa item');
  assert.equal(r.status, 'tidak_dijalankan');
  assert.equal(r.item_dikirim, 0);
  assert.equal(r.biaya_usd, null);
  assert.match(r.alasan, /Tidak ada temuan vulnerability maupun alert true_positive/);
  assert.equal(sidikDeteksi(h), sebelum);
});

test('model menjawab sebagian: sisanya tetap null dan dikatakan', async () => {
  const h = salin();
  const items = R.itemLayak(h);
  const r = await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => respons({ teks: jawabanUntuk(items.slice(0, 1)) }),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.item_terisi, 1);
  assert.match(r.alasan, /1 dari \d+ item/);
  const kosong = [...h.findings, ...h.alerts].filter((o) => o.rekomendasi_ai === null);
  assert.equal(kosong.length, items.length - 1);
});

test('biaya remediasi dihitung terpisah dan tidak menyentuh biaya run', async () => {
  const h = salin();
  const biayaRunSebelum = h.run.biaya_usd;
  const items = R.itemLayak(h);
  const { VENDOR, hitungBiaya } = require('../scripts/llm/vendor');
  const r = await R.jalankanRemediasi(h, OPSI, {
    panggil: async () => respons({ teks: jawabanUntuk(items) }),
    hitungBiaya,
    tarif: VENDOR.google.tarif,
  });
  assert.ok(typeof r.biaya_usd === 'number' && r.biaya_usd > 0, 'biaya remediasi harus tercatat');
  assert.equal(h.run.biaya_usd, biayaRunSebelum, 'biaya run deteksi dan verifikasi ikut berubah');
  assert.notEqual(h.run.remediasi.usage, null);
  assert.equal(h.run.remediasi.status_panggilan.total, 1);
});

test('skrip penilaian tidak membaca field rekomendasi', () => {
  // Angka eksperimen tidak boleh bergeser karena fitur ini. Dijaga dengan memeriksa sumbernya.
  for (const f of ['score.js', 'results-v2.js']) {
    const teks = fs.readFileSync(path.join(ROOT, 'scripts', 'llm', f), 'utf8');
    assert.ok(!/rekomendasi_ai|remediasi/.test(teks), `${f} menyebut field remediasi`);
  }
  const skor = fs.readFileSync(path.join(ROOT, 'scripts', 'llm-score.js'), 'utf8');
  assert.ok(!/rekomendasi_ai|remediasi/.test(skor), 'llm-score.js menyebut field remediasi');
});

test('prompt remediasi cocok dengan HASHES.txt', () => {
  const dir = path.join(ROOT, 'prompts', 'remediasi-v1');
  const daftar = fs.readFileSync(path.join(dir, 'HASHES.txt'), 'utf8').trim().split('\n');
  const p = R.bacaPrompt();
  const peta = { 'system.txt': p.hash.system, 'task.txt': p.hash.task, 'schema.json': p.hash.schema };
  assert.equal(daftar.length, 3);
  for (const baris of daftar) {
    const [hash, nama] = baris.trim().split(/\s+/);
    assert.equal(hash, peta[nama], `hash ${nama} tidak cocok dengan HASHES.txt`);
  }
});

// ---------- Workflow ----------
// Simulasi kondisi job dijalankan di luar repo, jadi bentuk penjaganya dikunci di sini supaya
// tidak hilang diam-diam saat workflow disunting.
test('workflow: input rekomendasi_ai boolean dan bawaannya mati', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  const blok = wf.slice(wf.indexOf('      rekomendasi_ai:'));
  assert.ok(wf.includes('      rekomendasi_ai:'), 'input rekomendasi_ai tidak ada');
  assert.match(blok.slice(0, 600), /type: boolean/, 'input rekomendasi_ai bukan boolean');
  assert.match(blok.slice(0, 600), /default: false/, 'input rekomendasi_ai tidak default false');
});

test('workflow: langkah remediasi dijaga input dan berada di jalur v2', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  const i = wf.indexOf('- name: Rekomendasi perbaikan AI (lapis 2)');
  assert.ok(i > 0, 'langkah remediasi tidak ada');
  const blok = wf.slice(i, i + 700);
  assert.match(blok, /if: inputs\.rekomendasi_ai/, 'langkah remediasi tidak dijaga input');
  assert.match(blok, /llm-remediasi\.js --vendor=/, 'langkah remediasi tidak memanggil skripnya');

  // Harus berada di job terbit-v2, sesudah results.json siap dan sebelum diterbitkan. Letaknya di
  // job penerbit, bukan di job analisis yang bermatriks: di mode gabungan analisis berjalan tiga
  // kali, dan saran lapis 2 harus berpijak pada hasil gabungan, bukan pada hasil satu vendor.
  const jobTerbit = wf.indexOf('\n  terbit-v2:');
  const siap = wf.indexOf('- name: Siapkan results.json');
  const terbit = wf.indexOf('- name: Terbitkan ke branch security-results');
  assert.ok(jobTerbit < siap && siap < i && i < terbit, 'urutan langkah remediasi salah');
  assert.ok(wf.indexOf('\n  hasil:') > i, 'langkah remediasi keluar dari job terbit-v2');
  // Mode gabungan tidak punya vendor sendiri, jadi vendornya diambil dari input terpisah.
  assert.match(blok, /vendor_rekomendasi/, 'mode gabungan tanpa pilihan vendor rekomendasi');
});

test('workflow: remediasi tidak menambah permission maupun secret baru', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
  const i = wf.indexOf('- name: Rekomendasi perbaikan AI (lapis 2)');
  const blok = wf.slice(i, wf.indexOf('- name: Unggah hasil gabungan', i));
  assert.ok(blok.length > 0 && blok.length < 2000, 'batas blok langkah remediasi tidak ditemukan');
  assert.ok(!/permissions:/.test(blok), 'langkah remediasi menyebut permissions');
  // Secret yang dipakai harus persis yang sudah dipakai langkah llm-scan.
  const dipakai = [...blok.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(dipakai, ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY']);
  // Izin global dan izin job tidak berubah.
  assert.match(wf, /^permissions:\n  contents: read$/m, 'permissions global berubah');
  // Izin tulis tetap hanya di job yang memang menerbitkan. Daftarnya ditulis lengkap supaya job
  // baru yang minta izin tulis menggagalkan tes, bukan lolos diam-diam.
  const bagianJob = wf.slice(wf.indexOf('\njobs:'));
  let jobKini = null;
  const izinTulis = [];
  for (const b of bagianJob.split('\n')) {
    const kepala = b.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (kepala) { jobKini = kepala[1]; continue; }
    if (/^ {6}contents: write\s*$/.test(b)) izinTulis.push(jobKini);
  }
  assert.deepEqual(izinTulis.sort(), ['hasil', 'terbit-v2'], 'izin tulis ada di job selain penerbit');
});

test('penerbitan mempertahankan field remediasi apa adanya', async () => {
  // Risiko nyata: kalau publish menyusun ulang berkas field demi field, saran lapis 2 akan hilang
  // diam-diam saat terbit dan baru ketahuan setelah run berbayar selesai.
  const os = require('node:os');
  const { terbitkan } = require('../scripts/merge-results');
  const h = salin();
  const items = R.itemLayak(h);
  await R.jalankanRemediasi(h, OPSI, { panggil: async () => respons({ teks: jawabanUntuk(items) }) });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'terbit-'));
  const berkas = path.join(tmp, 'results.json');
  fs.writeFileSync(berkas, JSON.stringify(h, null, 2));
  terbitkan(berkas, tmp);

  const rel = `${h.run.objek_uji.branch.replace(/\//g, '-')}/${h.run.nomor}.json`;
  const kandidat = [path.join(tmp, rel), path.join(tmp, h.run.objek_uji.branch, `${h.run.nomor}.json`)];
  const terbit = kandidat.find((f) => fs.existsSync(f));
  assert.ok(terbit, `berkas terbit tidak ditemukan di ${kandidat.join(' atau ')}`);
  const isi = JSON.parse(fs.readFileSync(terbit, 'utf8'));
  assert.equal(isi.run.remediasi.status, 'ok', 'run.remediasi hilang saat terbit');
  const bersaran = [...isi.findings, ...isi.alerts].filter((o) => o.rekomendasi_ai);
  assert.equal(bersaran.length, items.length, 'rekomendasi_ai hilang saat terbit');
  assert.deepEqual(bersaran[0].rekomendasi_ai, [...h.findings, ...h.alerts].find((o) => o.rekomendasi_ai).rekomendasi_ai);
  fs.rmSync(tmp, { recursive: true, force: true });
});
