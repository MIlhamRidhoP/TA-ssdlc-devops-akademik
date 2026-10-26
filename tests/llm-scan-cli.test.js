// Tes jalur CLI scripts/llm-scan.js sebagai PROSES, bukan sebagai modul.
//
// Alasan berkas ini ada: seluruh tes lain memanggil fungsi yang diekspor llm-scan.js (runKering,
// periksaObjek, perluSonar) dan tidak pernah menjalankan main(). Penjaga argumen hidup di dalam
// main(), jadi satu penjaga yang memaku 'v2' bisa menolak --prompt=v3 di CLI nyata sementara
// seluruh tes modul tetap hijau. Itu betul-betul terjadi: `--prompt=v3 --kering` gagal dengan
// "Versi prompt tidak dikenal: v3" padahal render.dirPrompt('v3') sudah lama menerima v3.
//
// Karena itu tes di sini menjalankan skripnya lewat child_process dan memeriksa kode keluar beserta
// keluarannya, dengan objek uji sintetis di folder sementara supaya tidak ada jalur absolut milik
// mesin tertentu yang masuk repo (AGENTS.md batas keras nomor 10).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKRIP = path.join(ROOT, 'scripts', 'llm-scan.js');
const bekuSonar = require('../scripts/llm/sonar-beku');
const bekuCodeql = require('../scripts/sast/codeql-beku');

// Jumlah alert sintetis dipilih menyamai batch dua perkakas yang nyata (5 Sonar + 18 CodeQL),
// supaya angka yang dijaga tes ini sama dengan angka yang dilaporkan di docs/panduan-batch-dua-sast.md.
const JUMLAH_SONAR = 5;
const JUMLAH_CODEQL = 18;

const jalan = (...argv) => spawnSync(process.execPath, [SKRIP, ...argv], { encoding: 'utf8', cwd: ROOT });

// Objek uji sintetis: satu repo git kecil berisi src/, karena periksaObjek menolak worktree yang
// tidak bersih dan membutuhkan hash tree src/.
const objekUji = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objek-cli-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const q = 1;\nquery(`x ${q}`);\n');
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t',
    '-c', 'core.autocrlf=false', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  g('add', '.');
  g('commit', '-q', '-m', 'awal');
  return { dir, treeSrc: g('rev-parse', 'HEAD:src'), revisi: g('rev-parse', 'HEAD') };
};

const berkasBeku = (objek) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beku-cli-'));

  // Lima issue Sonar, semuanya rule dengan pemetaan CWE supaya kelimanya lolos pilihAlert.
  const fileSonar = path.join(tmp, 'sonar-beku.json');
  bekuSonar.tulisBeku(fileSonar, bekuSonar.buatIsiBeku({
    laporan: {
      project: 'p',
      branch: 'main',
      analisis: { tanggal: '2026-10-19T00:00:00+0000', revisi: objek.revisi },
      galat: [],
      issues: Array.from({ length: JUMLAH_SONAR }, (_, i) => ({
        rule: 'jssecurity:S3649', severity: 'BLOCKER', type: 'VULNERABILITY',
        component: 'p:src/a.js', line: i + 1, message: `SQLi ${i + 1}`, impacts: [],
      })),
      hotspots: [],
      cwe_rule: { 'jssecurity:S3649': ['CWE-89'] },
    },
    treeSrcAnalisis: objek.treeSrc,
    dibuat: '2026-10-19T00:00:00.000Z',
  }));

  // Delapan belas alert CodeQL ber-id CQL-xx, bentuk medannya sama dengan keluaran Tahap 1.
  const fileCodeql = path.join(tmp, 'codeql-beku.json');
  bekuCodeql.tulisBeku(fileCodeql, bekuCodeql.buatIsiBeku({
    alert: Array.from({ length: JUMLAH_CODEQL }, (_, i) => ({
      id: `CQL-${String(i + 1).padStart(2, '0')}`,
      rule: 'js/sql-injection',
      tipe: 'SECURITY',
      sumber: 'codeql',
      file: 'src/a.js',
      baris: i + 1,
      cwe: ['CWE-89'],
      pesan: `This query depends on a user-provided value (${i + 1}).`,
      severity_codeql: '9.8',
      severity_asal: 'codeql',
    })),
    sarif: [{ nama: 'hasil-extended.sarif', suite: 'extended', sha256: 'a'.repeat(64), jumlah_result: JUMLAH_CODEQL }],
    lingkungan: { codeql: 'uji' },
    treeSrc: objek.treeSrc,
    saringan: null,
    gerbangSanity: null,
    dibuat: '2026-10-26T00:00:00.000Z',
  }));

  return { fileSonar, fileCodeql };
};

const argvKering = (objek, beku, ...tambahan) => [
  '--vendor=google', '--kondisi=utama', '--skenario=B',
  `--objek=${objek.dir}`, `--sonar-beku=${beku.fileSonar}`, `--codeql-beku=${beku.fileCodeql}`,
  '--kering', ...tambahan,
];

const hitungHashPrompt = (keluaran) => (keluaran.match(/prompt_user_kanonik [0-9a-f]{64}/g) ?? []).length;
const jumlahAlert = (keluaran) => {
  const m = keluaran.match(/hash laporan Sonar [0-9a-f]{64}, (\d+) alert/);
  return m ? Number(m[1]) : null;
};

// ---------- 1. Jalur yang bugnya tutup: --prompt=v3 di CLI nyata ----------

test('CLI --prompt=v3 --sast=keduanya --kering: keluar 0, 24 hash prompt, 23 alert', () => {
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const r = jalan(...argvKering(objek, beku, '--sast=keduanya', '--prompt=v3'));
  assert.equal(r.status, 0, `kode keluar harus 0; stderr:\n${r.stderr}`);
  assert.equal(jumlahAlert(r.stdout), JUMLAH_SONAR + JUMLAH_CODEQL, 'jumlah alert gabungan');
  // Satu deteksi + satu verifikasi per alert.
  assert.equal(hitungHashPrompt(r.stdout), 1 + JUMLAH_SONAR + JUMLAH_CODEQL, 'jumlah hash prompt');
  assert.match(r.stdout, /Tidak ada panggilan API LLM dan tidak ada file yang ditulis\./);
  // Urutan verifikasi: seluruh alert Sonar lebih dulu, baru CodeQL.
  const id = [...r.stdout.matchAll(/^ {2}(\S+) +prompt_user_kanonik/gm)].map((m) => m[1]);
  assert.equal(id[0], 'deteksi');
  assert.deepEqual(id.slice(1, 1 + JUMLAH_SONAR), ['SONAR-01', 'SONAR-02', 'SONAR-03', 'SONAR-04', 'SONAR-05']);
  assert.equal(id[1 + JUMLAH_SONAR], 'CQL-01');
  assert.equal(id[id.length - 1], `CQL-${JUMLAH_CODEQL}`);
});

test('CLI --prompt=v3 deterministik: dua jalan menghasilkan keluaran identik', () => {
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const a = jalan(...argvKering(objek, beku, '--sast=keduanya', '--prompt=v3'));
  const b = jalan(...argvKering(objek, beku, '--sast=keduanya', '--prompt=v3'));
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.stdout, a.stdout, 'keluaran dry-run tidak boleh bergantung waktu atau urutan');
});

test('CLI --prompt=V3 huruf besar diterima, sama dengan v3', () => {
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const besar = jalan(...argvKering(objek, beku, '--sast=keduanya', '--prompt=V3'));
  const kecil = jalan(...argvKering(objek, beku, '--sast=keduanya', '--prompt=v3'));
  assert.equal(besar.status, 0, `kode keluar harus 0; stderr:\n${besar.stderr}`);
  assert.equal(besar.stdout, kecil.stdout);
});

// ---------- 2. Versi yang harus tetap ditolak ----------

test('CLI --prompt=v9 ditolak dengan daftar versi yang ada', () => {
  const r = jalan(...['--vendor=google', '--kondisi=utama', '--prompt=v9', '--kering']);
  assert.notEqual(r.status, 0, 'versi yang tidak ada harus menolak');
  assert.match(r.stderr, /Versi prompt tidak dikenal: v9/);
  assert.match(r.stderr, /Yang ada: v2, v3/, 'pesan harus menyebut versi yang tersedia');
});

test('CLI menolak bentuk --prompt yang mudah lolos kalau folder disusun dari string', () => {
  // Daftar yang sama dengan tests/prompt-v3.test.js, tetapi lewat CLI: nilai kosong tidak boleh
  // jatuh ke bawaan v2 secara diam-diam (?? hanya menangkap null, bukan string kosong), dan
  // percobaan naik folder tidak boleh menjadi path prompt.
  for (const v of ['', '../v2', 'prompts/v2', 'v']) {
    const r = jalan(...['--vendor=google', '--kondisi=utama', `--prompt=${v}`, '--kering']);
    assert.notEqual(r.status, 0, `--prompt=${JSON.stringify(v)} harus ditolak`);
    assert.match(r.stderr, /Versi prompt tidak dikenal/, `--prompt=${JSON.stringify(v)}`);
  }
});

test('CLI --prompt=v1 memberi arahan khusus ke gemini-scan.js, bukan "tidak dikenal"', () => {
  const r = jalan(...['--vendor=google', '--kondisi=utama', '--prompt=v1', '--kering']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Prompt v1 dijalankan dengan: node scripts\/gemini-scan\.js --runs=N/);
  assert.doesNotMatch(r.stderr, /tidak dikenal/, 'v1 ada, hanya dijalankan skrip lain');
});

test('CLI dua perkakas dengan --prompt=v2 ditolak dengan sebabnya', () => {
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const r = jalan(...argvKering(objek, beku, '--sast=keduanya', '--prompt=v2'));
  assert.notEqual(r.status, 0, 'v2 menyebut SonarCloud, jadi dua perkakas harus ditolak');
  assert.match(r.stderr, /--sast=keduanya tidak boleh dipakai dengan --prompt=v2/);
  assert.match(r.stderr, /Pakai --prompt=v3/);
});

test('CLI dua perkakas tanpa --prompt ditolak juga, karena bawaannya v2', () => {
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const r = jalan(...argvKering(objek, beku, '--sast=codeql'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tidak boleh dipakai dengan --prompt=v2/);
});

// ---------- 3. Regresi: jalur sonar-saja tidak berubah ----------

test('CLI tanpa --sast dan tanpa --prompt tetap 5 alert dan 6 hash prompt', () => {
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const r = jalan('--vendor=google', '--kondisi=utama', '--skenario=B',
    `--objek=${objek.dir}`, `--sonar-beku=${beku.fileSonar}`, '--kering');
  assert.equal(r.status, 0, `kode keluar harus 0; stderr:\n${r.stderr}`);
  assert.equal(jumlahAlert(r.stdout), JUMLAH_SONAR);
  assert.equal(hitungHashPrompt(r.stdout), 1 + JUMLAH_SONAR);
});

test('CLI sonar-saja: hash prompt --prompt=v3 sama dengan bawaan untuk deteksi kondisi utama', () => {
  // Dasar klaim di docs/panduan-batch-dua-sast.md: deteksi kondisi utama identik byte per byte
  // antara v2 dan v3, jadi hash deteksinya harus sama meski versi promptnya berbeda.
  const objek = objekUji();
  const beku = berkasBeku(objek);
  const dasar = ['--vendor=google', '--kondisi=utama', '--skenario=B',
    `--objek=${objek.dir}`, `--sonar-beku=${beku.fileSonar}`, '--kering'];
  const v2 = jalan(...dasar);
  const v3 = jalan(...dasar, '--prompt=v3');
  assert.equal(v2.status, 0, v2.stderr);
  assert.equal(v3.status, 0, v3.stderr);
  const deteksi = (s) => s.match(/deteksi +prompt_user_kanonik ([0-9a-f]{64})/)[1];
  assert.equal(deteksi(v3.stdout), deteksi(v2.stdout), 'hash deteksi kondisi utama harus identik');
});

// ---------- 4. Satu sumber kebenaran daftar versi ----------

test('llm-scan.js tidak lagi memaku daftar versi prompt sendiri', () => {
  const src = fs.readFileSync(SKRIP, 'utf8');
  // Penjaga lama berbentuk perbandingan langsung ke 'v2'; yang benar bertanya ke render.
  // Diperiksa sebagai boolean, bukan dengan assert.doesNotMatch: kalau gagal, doesNotMatch mencetak
  // seluruh isi llm-scan.js ke laporan tes dan pesan yang penting jadi tidak terbaca.
  assert.equal(/prompt\s*!==\s*'v2'/.test(src), false, 'daftar versi harus datang dari render, bukan literal');
  assert.equal(/render\.VERSI_PROMPT_DIDUKUNG/.test(src), true, 'penjaga harus memakai satu sumber kebenaran');
  // Versi prompt diturunkan sekali saja, supaya tidak ada dua penjaga yang bisa berbeda pendapat.
  assert.equal((src.match(/ambilArg\('prompt'\)/g) ?? []).length, 1, 'ambilArg(prompt) hanya sekali');
});
