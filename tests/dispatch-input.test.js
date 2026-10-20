// Isi dispatch yang disusun dashboard harus bisa diterima workflow APA ADANYA.
//
// Ini bukan uji gaya. GitHub memvalidasi body workflow_dispatch sebelum menjalankan apa pun: satu
// nama input yang tidak dikenal, atau satu nilai di luar daftar opsi sebuah input bertipe choice,
// membuat SELURUH dispatch ditolak dengan 422 dan tidak ada job yang berjalan. Kegagalan itu tidak
// terlihat di mana pun sampai seseorang mencobanya di repo sungguhan.
//
// Yang pernah terjadi: jalur v2 ikut mengirim input `model`, padahal `model` adalah choice berisi
// daftar model jalur V1 saja. Untuk vendor google kebetulan lolos karena id modelnya ada di kedua
// daftar; untuk anthropic dan openai dispatch-nya ditolak 422.
//
// Daftar input dan opsinya dibaca langsung dari devsecops.yml, bukan disalin ke sini, supaya tes
// ini ikut berubah saat workflownya berubah.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'devsecops.yml'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');
const models = require('../dashboard/models.json').models;

// ---------- Daftar input workflow_dispatch beserta tipe dan opsinya ----------
// Pembaca seadanya, cukup untuk bentuk yang dipakai berkas ini: input di indentasi 6 spasi,
// propertinya di 8 spasi. Nilai `options` ditulis sebagai larik satu baris.
const bacaInput = () => {
  const mulai = wf.indexOf('  workflow_dispatch:');
  assert.ok(mulai > 0, 'blok workflow_dispatch tidak ditemukan');
  const selesai = wf.indexOf('\njobs:');
  const baris = wf.slice(mulai, selesai > mulai ? selesai : undefined).split('\n');
  const input = {};
  let kini = null;
  for (const b of baris) {
    const kepala = b.match(/^ {6}([a-z_][a-z0-9_]*):\s*$/);
    if (kepala) { kini = kepala[1]; input[kini] = { tipe: null, opsi: null, bawaan: undefined }; continue; }
    if (!kini) continue;
    const tipe = b.match(/^ {8}type:\s*(\S+)\s*$/);
    if (tipe) { input[kini].tipe = tipe[1]; continue; }
    const opsi = b.match(/^ {8}options:\s*\[(.*)\]\s*$/);
    if (opsi) {
      input[kini].opsi = opsi[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter((x) => x !== '');
      continue;
    }
    const bawaan = b.match(/^ {8}default:\s*(.+?)\s*$/);
    if (bawaan) input[kini].bawaan = bawaan[1].replace(/^'|'$/g, '');
  }
  return input;
};

const INPUT = bacaInput();

test('daftar input workflow terbaca', () => {
  // Kalau pembacanya rusak, seluruh tes di bawah akan lolos tanpa menguji apa pun.
  for (const nama of ['mode', 'model', 'jalur', 'skenario', 'vendor_v2', 'vendor_rekomendasi', 'konfirmasi_v2', 'sonar_branch_v2', 'rekomendasi_ai', 'label']) {
    assert.ok(INPUT[nama], `input ${nama} tidak terbaca dari workflow`);
  }
  assert.deepEqual(INPUT.model.opsi, ['gemini-3.8-flash', 'gemini-3.1-pro-preview'], 'opsi input model');
  assert.deepEqual(INPUT.vendor_v2.opsi, ['google', 'anthropic', 'openai', 'gabungan'], 'opsi input vendor_v2');
  assert.equal(INPUT.rekomendasi_ai.tipe, 'boolean');
});

// ---------- Penyusun payload, diambil apa adanya dari dashboard/app.js ----------
const susunInputDispatch = (() => {
  const i = app.indexOf('  const susunInputDispatch = ({');
  const j = app.indexOf('\n  };', i);
  assert.ok(i > 0 && j > i, 'susunInputDispatch tidak ditemukan di dashboard/app.js');
  // eslint-disable-next-line no-new-func
  return new Function(`${app.slice(i, j + 5)}\n  return susunInputDispatch;`)();
})();

const modelV2 = models.filter((m) => m.jalur === 'v2');
const modelV1Bawaan = (models.find((m) => m.jalur === 'v1' && m.bawaan) ?? models.find((m) => m.jalur === 'v1')).id;

// Kombinasi yang BOLEH dikirim dashboard. Kombinasi tidak sah ditolak lebih dulu di drawer dan di
// job rencana, jadi yang diuji di sini hanya yang memang sampai ke GitHub.
const KOMBINASI = [
  { nama: 'A (jalur v1)', arg: { mode: 'sast', jalur: 'v1', skenario: 'A', model: modelV1Bawaan } },
  { nama: 'B satu model, jalur v1', arg: { mode: 'sast-llm', jalur: 'v1', skenario: 'B', model: modelV1Bawaan } },
  ...modelV2.map((m) => ({
    nama: `B ${m.vendor}`,
    arg: { mode: 'sast-llm', jalur: 'v2', skenario: 'B', model: m.id, vendor: m.vendor },
  })),
  ...modelV2.map((m) => ({
    nama: `C ${m.vendor}`,
    arg: { mode: 'sast-llm', jalur: 'v2', skenario: 'C', model: m.id, vendor: m.vendor },
  })),
  {
    nama: 'B gabungan',
    arg: { mode: 'sast-llm', jalur: 'v2', skenario: 'B', model: modelV2[0].id, gabungan: true },
  },
  ...modelV2.map((m) => ({
    nama: `B gabungan + rekomendasi ${m.vendor}`,
    arg: {
      mode: 'sast-llm', jalur: 'v2', skenario: 'B', model: modelV2[0].id,
      gabungan: true, rekomendasiAi: true, vendorRekomendasi: m.vendor,
    },
  })),
  ...modelV2.map((m) => ({
    nama: `B ${m.vendor} + rekomendasi`,
    arg: { mode: 'sast-llm', jalur: 'v2', skenario: 'B', model: m.id, vendor: m.vendor, rekomendasiAi: true },
  })),
];

const lengkap = (arg) => susunInputDispatch({
  label: 'sd-uji', sonarBranch: 'main', vendorRekomendasi: 'google', ...arg,
});

test('setiap kombinasi hanya mengirim input yang ada di workflow', () => {
  for (const k of KOMBINASI) {
    for (const nama of Object.keys(lengkap(k.arg))) {
      assert.ok(INPUT[nama], `${k.nama}: mengirim input "${nama}" yang tidak ada di devsecops.yml`);
    }
  }
});

test('setiap nilai choice yang dikirim ada di daftar opsinya', () => {
  for (const k of KOMBINASI) {
    for (const [nama, nilai] of Object.entries(lengkap(k.arg))) {
      const def = INPUT[nama];
      if (def.tipe === 'boolean') {
        assert.equal(typeof nilai, 'boolean', `${k.nama}: input ${nama} harus boolean`);
        continue;
      }
      if (!Array.isArray(def.opsi)) continue; // input bertipe string bebas, misalnya label
      assert.ok(def.opsi.includes(String(nilai)),
        `${k.nama}: nilai "${nilai}" untuk input ${nama} di luar opsi [${def.opsi.join(', ')}]`);
    }
  }
});

test('jalur v2 tidak pernah mengirim input model', () => {
  // Inti bugnya. Input `model` hanya memuat daftar model jalur v1; id model v2 di sana membuat
  // GitHub menolak seluruh dispatch dengan 422 sebelum satu pun job berjalan.
  for (const k of KOMBINASI.filter((x) => x.arg.jalur === 'v2')) {
    assert.ok(!('model' in lengkap(k.arg)), `${k.nama}: masih mengirim input model`);
  }
  // Dan sebaliknya: jalur v1 memang harus mengirimnya, dengan nilai dari daftar v1.
  for (const k of KOMBINASI.filter((x) => x.arg.jalur !== 'v2')) {
    const inputs = lengkap(k.arg);
    assert.ok('model' in inputs, `${k.nama}: jalur v1 tanpa input model`);
    assert.ok(INPUT.model.opsi.includes(inputs.model), `${k.nama}: model "${inputs.model}" di luar opsi v1`);
  }
});

test('jalur v2 selalu membawa konfirmasi dan vendor, jalur v1 tidak membawa keduanya', () => {
  for (const k of KOMBINASI) {
    const inputs = lengkap(k.arg);
    if (k.arg.jalur === 'v2') {
      assert.equal(inputs.konfirmasi_v2, 'JALANKAN', `${k.nama}: tanpa konfirmasi berbayar`);
      assert.ok(inputs.vendor_v2, `${k.nama}: tanpa vendor_v2`);
      assert.equal(inputs.vendor_v2 === 'gabungan', Boolean(k.arg.gabungan), `${k.nama}: vendor_v2 tidak sesuai mode model`);
    } else {
      for (const n of ['konfirmasi_v2', 'vendor_v2', 'sonar_branch_v2', 'rekomendasi_ai', 'vendor_rekomendasi']) {
        assert.ok(!(n in inputs), `${k.nama}: jalur v1 tidak boleh mengirim ${n}`);
      }
    }
  }
});

test('vendor_rekomendasi hanya dikirim saat gabungan dan rekomendasi diminta', () => {
  // Input yang dikirim tetapi tidak berpengaruh membuat body dispatch berhenti bisa dibaca sebagai
  // catatan apa yang sebenarnya diminta.
  for (const k of KOMBINASI) {
    const inputs = lengkap(k.arg);
    const harusAda = Boolean(k.arg.gabungan && k.arg.rekomendasiAi);
    assert.equal('vendor_rekomendasi' in inputs, harusAda, `${k.nama}: kehadiran vendor_rekomendasi`);
  }
});

test('skenario yang dikirim cocok dengan mode yang dikirim', () => {
  // Pasangan yang tidak cocok ditolak job rencana setelah runner menyala. Dashboard tidak boleh
  // membuat dispatch yang sudah pasti ditolak di sana.
  const MODE_SAH = { A: 'sast', B: 'sast-llm', C: 'sast-llm' };
  for (const k of KOMBINASI) {
    const inputs = lengkap(k.arg);
    assert.equal(inputs.mode, MODE_SAH[inputs.skenario], `${k.nama}: mode ${inputs.mode} untuk skenario ${inputs.skenario}`);
  }
  // Skenario C hanya tersedia di jalur v2, dan gabungan hanya untuk B.
  for (const k of KOMBINASI) {
    const inputs = lengkap(k.arg);
    if (inputs.skenario === 'C') assert.equal(inputs.jalur, 'v2', `${k.nama}: skenario C di luar jalur v2`);
    if (inputs.vendor_v2 === 'gabungan') assert.equal(inputs.skenario, 'B', `${k.nama}: gabungan di luar skenario B`);
  }
});
