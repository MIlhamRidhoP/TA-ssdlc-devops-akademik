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

// ---------- Sumbu sast: input baru dan penjaga K8 di job rencana ----------
// Kasus DITAMBAHKAN, tidak menggantikan kasus lama. Yang diuji di bawah adalah PERILAKU penjaganya,
// bukan keberadaan teksnya: blok shell step `mode` diekstrak dari YAML lalu dijalankan dengan bash
// pada kombinasi env yang berbeda-beda, dan yang diperiksa adalah kode keluarnya.

test('input sast ada di workflow dengan opsi dan bawaan yang benar', () => {
  assert.ok(INPUT.sast, 'input sast tidak terbaca dari workflow');
  assert.deepEqual(INPUT.sast.opsi, ['sonar', 'codeql', 'keduanya'], 'opsi input sast');
  assert.equal(INPUT.sast.bawaan, 'sonar', 'bawaan input sast harus sonar');
});

test('dispatch yang tidak menyebut sast tidak pernah mengirimnya', () => {
  // Drawer sekarang punya pemilih sast, tetapi sifat yang dijaga di sini tidak berubah: pemanggil
  // yang tidak menyebut sumbu ini memakai bawaan, dan tidak ada satu pun kombinasi yang bisa
  // diam-diam menjadi dua perkakas.
  for (const k of KOMBINASI) {
    assert.ok(!('sast' in lengkap(k.arg)), `${k.nama}: mengirim input sast`);
    assert.ok(!('sast' in lengkap({ ...k.arg, sast: 'sonar' })), `${k.nama}: sonar eksplisit pun tidak dikirim`);
  }
});

test('sast dikirim hanya kalau bukan sonar, dan hanya di jalur v2', () => {
  const v2 = { mode: 'sast-llm', jalur: 'v2', skenario: 'B', model: modelV2[0].id, vendor: modelV2[0].vendor };
  for (const sast of ['codeql', 'keduanya']) {
    assert.equal(lengkap({ ...v2, sast }).sast, sast, `jalur v2 harus membawa sast=${sast}`);
  }
  // Jalur v1 keluar lebih dulu dan hanya membawa model: --sast adalah argumen scripts/llm-scan.js,
  // dan jalur v1 memakai scripts/gemini-scan.js yang tidak mengenalnya.
  const v1 = lengkap({ mode: 'sast', jalur: 'v1', skenario: 'A', model: modelV1Bawaan, sast: 'keduanya' });
  assert.ok(!('sast' in v1), 'jalur v1 tidak boleh membawa sast');
});

test('perubahan pilihan sast memicu render ulang drawer', () => {
  // Ditemukan saat review diri: tanpa listener, keterangan biaya dan keadaan form tidak pernah
  // berubah saat pengguna memilih CodeQL — pilihannya tetap terkirim, tetapi penjelasannya diam.
  const baris = app.split('\n').find((b) => b.includes('input[name="skenario"]') && b.includes('addEventListener'));
  assert.ok(baris, 'listener radio drawer tidak ditemukan');
  assert.match(baris, /input\[name="sast"\]/, 'radio sast harus ikut memicu renderDrawer');
});

test('nomor bagian drawer dihitung dari bagian yang terlihat, bukan dari angka di HTML', () => {
  // Ditemukan lewat tangkapan layar pengguna: di skenario A bagian Perkakas SAST disembunyikan dan
  // drawer menampilkan 1 lalu 3. Tes statis di bawah hanya membaca HTML mentah, jadi ia lolos
  // sementara yang terlihat salah; yang diuji di sini adalah fungsinya, dengan DOM tiruan.
  const i = app.indexOf('  const nomori = () => {');
  const j = app.indexOf('\n  };', i);
  assert.ok(i > 0 && j > i, 'nomori tidak ditemukan di dashboard/app.js');
  const jalankan = (terlihat) => {
    const simpul = terlihat.map(() => ({ textContent: 'x' }));
    let selektor = null;
    const document = { querySelectorAll: (s) => { selektor = s; return simpul; } };
    // eslint-disable-next-line no-new-func
    new Function('document', `${app.slice(i, j + 5)}\n  nomori();`)(document);
    return { teks: simpul.map((n) => n.textContent), selektor };
  };
  // Tiga bagian terlihat (skenario A: Skenario, Branch, dan satu lagi) bernomor 1, 2, 3.
  const a = jalankan([1, 2, 3]);
  assert.deepEqual(a.teks, ['1', '2', '3']);
  // Yang disaring selektornya: hanya bagian yang tidak tersembunyi yang dinomori.
  assert.match(a.selektor, /\.bagian:not\(\[hidden\]\) \.bagian-no/, 'harus hanya menomori bagian yang terlihat');
  assert.deepEqual(jalankan([]).teks, [], 'tanpa bagian terlihat tidak boleh melempar');
  // renderDrawer harus benar-benar memanggilnya, kalau tidak fungsinya ada tetapi tidak pernah jalan.
  const render = app.slice(app.indexOf('  const renderDrawer = () => {'), app.indexOf('  const konfirmasiV2'));
  assert.match(render, /\bnomori\(\);/, 'renderDrawer harus memanggil nomori()');
});

test('kartu skenario tidak lagi menyebut SonarCloud untuk B dan C, tetapi A tetap', () => {
  // A memakai jalur v1 yang memang hanya SonarCloud. B dan C ikut sumbu sast, jadi tidak boleh
  // memaku satu perkakas di teksnya.
  const html = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');
  const kartu = (v) => html.match(new RegExp(`name="skenario" value="${v}"[^]*?<small>([^<]*)</small>`))[1];
  assert.match(kartu('A'), /SonarCloud saja/);
  assert.equal(/SonarCloud/.test(kartu('B')), false, `kartu B: "${kartu('B')}"`);
  assert.equal(/SonarCloud/.test(kartu('C')), false, `kartu C: "${kartu('C')}"`);
});

test('drawer punya pemilih sast, dan nomor bagiannya berurut', () => {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');
  assert.match(html, /id="sast-field"/, 'fieldset pemilih sast tidak ada di drawer');
  for (const v of ['sonar', 'codeql', 'keduanya']) {
    assert.match(html, new RegExp(`name="sast" value="${v}"`), `pilihan ${v} tidak ada`);
  }
  // Hanya sonar yang tercentang di markup: keadaan awal drawer tidak boleh berbiaya lebih.
  assert.match(html, /name="sast" value="sonar" checked/);
  assert.equal(/name="sast" value="(codeql|keduanya)" checked/.test(html), false, 'bawaan drawer harus sonar');
  // Penomoran bagian drawer gampang bergeser saat bagian baru disisipkan, dan nomor yang lompat
  // terbaca sebagai ada bagian yang hilang.
  const nomor = [...html.matchAll(/class="bagian-no">(\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(nomor, nomor.map((_, i) => i + 1), `nomor bagian harus 1..n berurut, dapat ${nomor.join(', ')}`);
});

const skripRencana = (() => {
  const awal = wf.indexOf('        id: mode\n');
  const run = wf.indexOf('        run: |\n', awal);
  const akhir = wf.indexOf('\n  sonarcloud:', run);
  assert.ok(awal > 0 && run > awal && akhir > run, 'blok shell job rencana tidak ditemukan');
  return wf.slice(run + '        run: |\n'.length, akhir)
    .split('\n')
    .map((b) => b.replace(/^ {10}/, ''))
    .join('\n');
})();

const jalankanRencana = (env) => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const keluaran = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rencana-')), 'out.txt');
  const h = spawnSync('bash', ['-c', skripRencana], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: keluaran,
      MODE_INPUT: '', USE_GEMINI: 'false', SKENARIO_INPUT: '', VENDOR_V2: 'google', JALUR: 'v2', SAST_INPUT: 'sonar',
      ...env,
    },
  });
  const out = fs.existsSync(keluaran) ? fs.readFileSync(keluaran, 'utf8') : '';
  fs.rmSync(path.dirname(keluaran), { recursive: true, force: true });
  return { kode: h.status, galat: h.stderr ?? '', out };
};

test('penjaga rencana: kombinasi bawaan tetap lolos', () => {
  // Jaring untuk tes di bawahnya: kalau ini gagal, penolakan apa pun di bawah tidak membuktikan apa-apa.
  const b = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B' });
  assert.equal(b.kode, 0, `bawaan harus lolos, galat: ${b.galat}`);
  assert.match(b.out, /skenario=B/);
  assert.match(b.out, /mode=sast-llm/);

  // Tanpa input sast sama sekali, seperti dispatch lama yang tidak mengenal input ini.
  const lama = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B', SAST_INPUT: '' });
  assert.equal(lama.kode, 0, `dispatch tanpa input sast harus lolos, galat: ${lama.galat}`);

  // Skenario C dengan sonar: perilaku yang sudah ada, tidak boleh ikut tertolak.
  const c = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'C' });
  assert.equal(c.kode, 0, `C dengan sonar harus lolos, galat: ${c.galat}`);
});

test('penjaga rencana K8: skenario C dengan codeql atau keduanya ditolak dengan sebabnya', () => {
  for (const sast of ['codeql', 'keduanya']) {
    const h = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'C', SAST_INPUT: sast });
    assert.notEqual(h.kode, 0, `C + ${sast} harus ditolak`);
    assert.match(h.galat, /Skenario C tidak memakai alert SAST sama sekali/, `C + ${sast}: sebab penolakan`);
    assert.match(h.galat, new RegExp(`sast=${sast}`), `C + ${sast}: pesan menyebut nilainya`);
  }
});

test('penjaga rencana: codeql dan keduanya di skenario B diterima', () => {
  // Sebelumnya penjaga di sini menolak keduanya dengan "belum didukung di CI". Penolakan itu
  // DICABUT ketika jalur dua perkakas dibuka ke CI; yang dijaga sekarang adalah bahwa kombinasinya
  // benar-benar lolos DAN membawa sumbu sast beserta versi promptnya ke job analisis.
  for (const sast of ['codeql', 'keduanya']) {
    const h = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B', SAST_INPUT: sast });
    assert.equal(h.kode, 0, `B + ${sast} harus lolos, galat: ${h.galat}`);
    assert.match(h.out, new RegExp(`sast=${sast}`), `B + ${sast}: sumbu sast harus jadi output`);
  }
});

test('penjaga rencana: skenario A dengan dua perkakas ditolak, karena A memakai jalur v1', () => {
  // Ditemukan saat review diri. Skenario A mengirim jalur v1 (JALUR_SKENARIO di dashboard/app.js),
  // dan jalur v1 memakai scripts/gemini-scan.js yang tidak mengenal --sast maupun --codeql-beku.
  // Menerimanya berarti input yang diam-diam tidak berpengaruh — persis yang ingin dihindari.
  for (const sast of ['codeql', 'keduanya']) {
    const h = jalankanRencana({ MODE_INPUT: 'sast', SKENARIO_INPUT: 'A', SAST_INPUT: sast, JALUR: 'v1' });
    assert.notEqual(h.kode, 0, `A + ${sast} harus ditolak`);
    assert.match(h.galat, /hanya tersedia di jalur v2/, `A + ${sast}: sebab penolakan`);
  }
});

test('penjaga rencana: versi prompt diturunkan dari sumbu sast, bukan diminta terpisah', () => {
  // Prompt v2 menyebut SonarCloud, jadi alert CodeQL yang dikirim dengannya membawa keterangan asal
  // yang salah. Menurunkannya di sini membuat kombinasi itu tidak pernah terbentuk lewat dispatch;
  // scripts/sast/sumbu-sast.js tetap menolaknya bagi pemanggil CLI.
  const sonar = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B', SAST_INPUT: 'sonar' });
  assert.equal(sonar.kode, 0, sonar.galat);
  assert.match(sonar.out, /versi_prompt=v2/, 'sonar harus tetap memakai prompt v2, seperti sebelumnya');

  for (const sast of ['codeql', 'keduanya']) {
    const h = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B', SAST_INPUT: sast });
    assert.equal(h.kode, 0, h.galat);
    assert.match(h.out, /versi_prompt=v3/, `${sast} harus memakai prompt v3`);
  }

  // Dispatch lama yang tidak mengenal input ini sama sekali tetap jatuh ke v2.
  const lama = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B', SAST_INPUT: '' });
  assert.equal(lama.kode, 0, lama.galat);
  assert.match(lama.out, /versi_prompt=v2/);
  assert.match(lama.out, /sast=sonar/);
});

test('penjaga rencana: dua perkakas di jalur v1 ditolak dengan sebabnya', () => {
  // --prompt dan --codeql-beku adalah argumen scripts/llm-scan.js; jalur v1 memakai gemini-scan.js
  // yang tidak mengenalnya, jadi input yang diterima di situ tidak akan berpengaruh sama sekali.
  for (const sast of ['codeql', 'keduanya']) {
    const h = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'B', SAST_INPUT: sast, JALUR: 'v1' });
    assert.notEqual(h.kode, 0, `${sast} di jalur v1 harus ditolak`);
    assert.match(h.galat, /hanya tersedia di jalur v2/, `${sast}: sebab penolakan`);
    assert.match(h.galat, new RegExp(`sast=${sast}`), `${sast}: pesan menyebut nilainya`);
  }
});

test('penjaga rencana: penjaga lama tetap berlaku apa adanya', () => {
  // Penambahan sumbu sast tidak boleh menggeser satu pun penolakan yang sudah ada.
  const gabungan = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'C', VENDOR_V2: 'gabungan' });
  assert.notEqual(gabungan.kode, 0);
  assert.match(gabungan.galat, /Mode gabungan hanya sah untuk skenario B/);

  const aDenganLlm = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'A' });
  assert.notEqual(aDenganLlm.kode, 0);
  assert.match(aDenganLlm.galat, /Skenario A tidak memakai LLM/);

  const cDiV1 = jalankanRencana({ MODE_INPUT: 'sast-llm', SKENARIO_INPUT: 'C', JALUR: 'v1' });
  assert.notEqual(cDiV1.kode, 0);
  assert.match(cDiV1.galat, /Skenario C hanya tersedia di jalur v2/);
});
