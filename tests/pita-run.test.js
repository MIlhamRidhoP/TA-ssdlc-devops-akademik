// Tampilan saat ada run yang sedang dipantau: skenario graf, id run untuk tautan log, dan teks
// pita status.
//
// Tiga cacat yang dijaga di sini, semuanya satu akar: objek live yang dikirim ke renderPipeline()
// tidak lengkap, sehingga dashboard mencampur data run lama (state.hasil) dengan data run baru.
//
// 1. Node graf berbunyi "tidak dipakai di skenario A" padahal run yang berjalan bukan skenario A,
//    karena live tidak membawa skenario dan skenarioAktif() jatuh ke state.hasil.run.skenario.
// 2. "Lihat log" membuka 404 selama run baru dipantau, karena id run tidak ikut dikirim dan
//    rantai cadangan memakai id run LAMA, lalu menggabungkannya dengan id job run BARU.
// 3. Pita status tidak pernah ada, jadi kepala halaman tetap menampilkan run lama tanpa keterangan
//    sementara pesan progres hanya ditulis ke #run-hint di dalam drawer yang sudah ditutup.
//
// Penangkalnya satu fungsi pembentuk, buatLive(), yang selalu mengisi id, nomor, skenario, mode,
// jalur, dan status gabungan. Karena itu tes di bawah memakai buatLive(), bukan objek literal:
// kalau satu field hilang lagi dari pembentuknya, tes ini ikut gagal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'dashboard', 'app.js'), 'utf8');

const potong = (awal, akhir) => {
  const i = app.indexOf(awal);
  assert.ok(i > 0, `${awal.trim()} tidak ditemukan di dashboard/app.js`);
  const j = app.indexOf(akhir, i);
  assert.ok(j > i, `akhir blok untuk ${awal.trim()} tidak ditemukan`);
  return app.slice(i, j + akhir.length);
};

// `state` dibuat di luar supaya tes bisa mengisinya dengan run lama, persis seperti dashboard yang
// sudah memuat satu run sebelum run baru dijalankan.
const state = {};
const { buatLive, teksPita, skenarioAktif, idRunGraf, urlJobGh, teksLuarJalur } = (() => {
  const sumber = [
    potong('  const enc = encodeURIComponent;', '\n'),
    potong('  const urlGithub = (owner, repo, ...seg) =>', '\n'),
    potong('  const NAMA_GH = ', '\n'),
    potong('  const idGh = (v) => {', '\n  };'),
    potong('  const repoGh = (p) =>', '? p : null);'),
    potong('  const urlRunGh = (p, runId) => {', '\n  };'),
    potong('  const urlJobGh = (p, runId, jobId) => {', '\n  };'),
    app.slice(app.indexOf('  const JALUR_SKENARIO = {'), app.indexOf('  const jalurAktif = (live)')),
    potong('  const idRunGraf = (live) =>', '\n'),
    potong('  const durasi = (detik) => {', '\n  };'),
    potong('  const buatLive = ({', 'status, demo });'),
    potong('  const teksPita = (live, detikBerjalan) => {', '\n  };'),
  ].join('\n');
  // teksLuarJalur hidup di dalam renderPipeline dan membaca skenarioGraf dari lingkupnya. Di sini
  // lingkup itu dibuatkan sebagai parameter pabrik, jadi yang diuji tetap kode yang sama.
  const luarJalur = potong('    const teksLuarJalur = (n) => {', '\n    };');
  // eslint-disable-next-line no-new-func
  return new Function('state', `
    ${sumber}
    const pabrikLuarJalur = (skenarioGraf) => {
      ${luarJalur}
      return teksLuarJalur;
    };
    return {
      buatLive, teksPita, skenarioAktif, idRunGraf, urlJobGh,
      teksLuarJalur: (live, n) => pabrikLuarJalur(skenarioAktif(live))(n),
    };
  `)(state);
})();

const PROYEK = { owner: 'MIlhamRidhoP', repo: 'ta-ssdlc-demo' };

// Run lama yang sudah dimuat di dashboard: skenario A, id 100. Semua tes di bawah berjalan dengan
// run lama ini terpasang, karena justru itu yang dulu mencemari tampilan run baru.
const pasangRunLama = () => {
  state.hasil = { schema_version: 2, run: { id: 100, nomor: 5, skenario: 'A' } };
  state.rekaman = null;
  state.proyek = PROYEK;
};

test('pembentuk live selalu mengisi seluruh field, termasuk yang tidak diberikan', () => {
  // Inti perbaikannya. Kalau satu field hilang dari pembentuknya, ia akan jatuh ke data run lama
  // di pemakainya, dan cacat 1 sampai 3 kembali.
  const live = buatLive({ mode: 'sast-llm', jalur: 'v2', skenario: 'B', jobs: {} });
  assert.deepEqual(Object.keys(live).sort(),
    ['demo', 'id', 'jalur', 'jobs', 'mode', 'model', 'nomor', 'skenario', 'status', 'url'].sort());
  assert.equal(live.id, null);
  assert.equal(live.nomor, null);
  assert.equal(live.status, 'menunggu');
  assert.equal(live.demo, false);
});

test('skenario graf mengikuti run yang dipantau, bukan run yang sedang tampil', () => {
  pasangRunLama();
  for (const s of ['B', 'C']) {
    const live = buatLive({ mode: 'sast-llm', jalur: 'v2', skenario: s, jobs: {} });
    assert.equal(skenarioAktif(live), s);
    // Label node tidak boleh menyebut skenario A untuk run yang bukan A.
    for (const n of [{ jalur: 'v1' }, { jalur: 'v2' }]) {
      const teks = teksLuarJalur(live, n);
      assert.ok(!teks.includes('skenario A'),
        `node berbunyi "${teks}" padahal run yang dipantau skenario ${s}`);
    }
  }
});

test('tanpa run yang dipantau, skenario graf tetap diambil dari run yang tampil', () => {
  // Arah sebaliknya: perbaikannya tidak boleh membuat graf run tersimpan kehilangan skenarionya.
  pasangRunLama();
  assert.equal(skenarioAktif(null), 'A');
  assert.equal(teksLuarJalur(null, { jalur: 'v2' }), 'tidak dipakai di skenario A');
});

test('tautan log memakai id run yang dipantau, bukan id run lama', () => {
  pasangRunLama();
  const live = buatLive({ mode: 'sast-llm', jalur: 'v2', skenario: 'B', jobs: {}, id: 200, nomor: 6 });
  assert.equal(idRunGraf(live), 200);
  // Id job 777 milik run 200. Digabung dengan id run lama 100, URL-nya 404.
  assert.equal(urlJobGh(state.proyek, idRunGraf(live), 777),
    'https://github.com/MIlhamRidhoP/ta-ssdlc-demo/actions/runs/200/job/777');
});

test('selama id run yang dipantau belum diketahui, tidak ada tautan log sama sekali', () => {
  pasangRunLama();
  const live = buatLive({ mode: 'sast-llm', jalur: 'v2', skenario: 'B', jobs: {} });
  assert.equal(idRunGraf(live), null);
  assert.equal(urlJobGh(state.proyek, idRunGraf(live), 777), null,
    'id run lama tidak boleh dipakai untuk job run baru');
});

test('tanpa run yang dipantau, tautan log tetap memakai run yang tampil atau rekaman', () => {
  pasangRunLama();
  assert.equal(idRunGraf(null), 100);
  state.rekaman = { id: 54 };
  assert.equal(idRunGraf(null), 54, 'rekaman lebih dekat daripada hasil yang dimuat');
});

test('teks pita menyebut nomor run, skenario, model, keadaan, dan durasi', () => {
  const live = buatLive({
    mode: 'sast-llm', jalur: 'v2', skenario: 'B', jobs: {},
    id: 200, nomor: 6, model: 'gabungan', status: 'berjalan',
  });
  assert.equal(teksPita(live, 95), 'Run #6 · skenario B · gabungan · berjalan · 1:35');
});

test('sebelum nomor runnya diketahui, pita berbunyi "Run baru"', () => {
  const live = buatLive({ mode: 'sast-llm', jalur: 'v2', skenario: 'C', jobs: {}, model: 'GPT-5' });
  assert.equal(teksPita(live, 4), 'Run baru · skenario C · GPT-5 · menunggu GitHub membuat run · 0:04');
});

test('skenario A berbunyi "tanpa LLM", berapa pun nilai model di objek live', () => {
  // Jalur v1 tetap mengirim input model ke workflow untuk validasi di job rencana, jadi objek live
  // memang membawa nilainya. Menyebut nama model di pita terbaca seolah model itu dipanggil,
  // padahal skenario A tidak memanggil LLM sama sekali.
  const live = buatLive({
    mode: 'sast', jalur: 'v1', skenario: 'A', jobs: {},
    nomor: 10, model: 'Gemini 3.8 Flash', status: 'berjalan',
  });
  assert.equal(teksPita(live, 0), 'Run #10 · skenario A · tanpa LLM · berjalan · 0:00');
  assert.ok(!/Gemini/.test(teksPita(live, 0)), 'nama model tidak boleh muncul di skenario A');
});

test('skenario B dan C tetap menyebut modelnya, termasuk mode gabungan', () => {
  const pita = (skenario, model) => teksPita(buatLive({
    mode: 'sast-llm', jalur: 'v2', skenario, jobs: {}, nomor: 11, model, status: 'berjalan',
  }), 0);
  assert.equal(pita('B', 'gabungan'), 'Run #11 · skenario B · gabungan · berjalan · 0:00');
  assert.equal(pita('B', 'GPT-5'), 'Run #11 · skenario B · GPT-5 · berjalan · 0:00');
  assert.equal(pita('C', 'Gemini 3.8 Flash'), 'Run #11 · skenario C · Gemini 3.8 Flash · berjalan · 0:00');
});

test('tiap tahap pemantauan punya kata keadaannya sendiri, tanpa menebak sebab', () => {
  const pita = (status) => teksPita(buatLive({
    mode: 'sast-llm', jalur: 'v2', skenario: 'B', jobs: {}, id: 200, nomor: 6, status,
  }), 0);
  assert.match(pita('menunggu'), /menunggu GitHub membuat run/);
  assert.match(pita('berjalan'), /berjalan/);
  assert.match(pita('menunggu-hasil'), /selesai, menunggu hasil terbit/);
  assert.equal(pita('selesai'), 'Run #6 selesai, hasil sudah dimuat');
});

test('mode demo mengakui bahwa tidak ada hasil baru yang dibuat', () => {
  // Pita tidak boleh menjanjikan hasil yang tidak ada: simulasi tidak menerbitkan apa pun.
  const live = buatLive({
    mode: 'sast-llm', jalur: 'v2', skenario: 'B', jobs: {}, status: 'selesai', demo: true,
  });
  assert.equal(teksPita(live, 0), 'Run baru selesai. Mode demo tidak membuat hasil baru.');
});

test('tanpa run yang dipantau, pitanya kosong', () => {
  assert.equal(teksPita(null, 10), '');
});
