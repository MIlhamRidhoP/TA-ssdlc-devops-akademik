// Security Dashboard: memicu pipeline devsecops.yml, memantau job, dan membaca results.json
// dari branch security-results lewat GitHub REST API. Semua data dari API dan laporan LLM
// dianggap tidak tepercaya: hanya ditampilkan lewat textContent / createElement.
'use strict';

(() => {
  const API = 'https://api.github.com';
  const BRANCH_HASIL = 'security-results';
  const JEDA_CARI_RUN = 3000;
  const JEDA_JOB = 5000;
  const JEDA_HASIL = 5000;
  const BATAS_CARI_RUN = 30;
  const BATAS_TUNGGU_HASIL = 24;
  // Kegagalan yang memang diharapkan, bukan tanda pipeline rusak. Satu-satunya tempat daftar ini hidup.
  // Dicocokkan per branch dan per job; ditampilkan amber dengan sebabnya, berbeda dari kegagalan sungguhan.
  const GAGAL_DIHARAPKAN = [
    {
      branch: 'eksperimen/seeded', job: 'build',
      sebab: 'gagal sesuai ekspektasi: objek uji berisi kerentanan tertanam',
    },
  ];
  const ekspektasiGagal = (keyNode) => {
    const branch = state.hasil?.run?.objek_uji?.branch ?? state.branch?.name ?? null;
    return GAGAL_DIHARAPKAN.find((x) => x.branch === branch && x.job === keyNode) ?? null;
  };

  // Mode menentukan jalur, jadi drawer tidak punya pilihan jalur sendiri: satu keputusan, satu
  // kontrol. SAST + LLM selalu jalur v2 (deteksi + verifikasi per alert, hasilnya skema 2 yang
  // dibaca dashboard ini). SAST saja memakai jalur v1 yang tidak memanggil LLM sama sekali.
  const jalurUntukMode = (mode) => (mode === 'sast-llm' ? 'v2' : 'v1');
  const jalurTerpilih = () => jalurUntukMode(modeTerpilih());
  // Skenario adalah satu-satunya pilihan yang dibuat pengguna; mode diturunkan darinya. Workflow
  // menolak kombinasi mode x skenario yang tidak sah, jadi dashboard tidak boleh mengirim pasangan
  // yang bisa ditolak: A selalu sast, B dan C selalu sast-llm.
  const MODE_SKENARIO = { A: 'sast', B: 'sast-llm', C: 'sast-llm' };
  // Saat run sudah dimuat, jalurnya ditentukan isi hasil; saat menyiapkan run baru, oleh form.
  // Jalur graf ditentukan SKENARIO runnya, bukan versi skemanya. Sejak skenario A ikut menerbitkan
  // skema 2, versi skema berhenti menjadi penanda jalur mana yang berjalan: run A berskema 2,
  // tetapi job yang berjalan adalah rantai v1 (analisis lalu hasil). Menyimpulkannya dari skema
  // membuat graf run A menandai job yang BENAR-BENAR berjalan sebagai "digantikan jalur v2",
  // sekaligus menampilkan job v2 yang tidak pernah ada sebagai "dilewati".
  const JALUR_SKENARIO = { A: 'v1', B: 'v2', C: 'v2' };
  const skenarioAktif = (live) => live?.skenario ?? state.hasil?.run?.skenario ?? null;
  const jalurAktif = (live) => live?.jalur
    ?? JALUR_SKENARIO[skenarioAktif(live)]
    // Run lama tanpa field skenario: versi skema masih penanda yang benar, karena waktu itu hanya
    // jalur v2 yang menghasilkan skema 2. Skema 3 juga jalur v2: sumbu sast mengubah asal alert,
    // bukan bentuk pipelinenya.
    ?? (state.hasil ? (state.hasil.schema_version >= 2 ? 'v2' : 'v1') : jalurTerpilih());
  // Id run yang dipakai graf untuk membangun tautan log. Saat ada run yang dipantau, idnya HARUS
  // datang dari run itu dan tidak boleh jatuh ke run lama: rantai cadangan `live?.id ??
  // state.rekaman?.id ?? state.hasil?.run?.id` pernah menghasilkan runs/<id lama>/job/<id baru>,
  // yaitu tautan 404 selama run baru dipantau. Kalau id run yang dipantau belum diketahui,
  // hasilnya null dan pemanggilnya tidak membuat tautan sama sekali.
  const idRunGraf = (live) => (live ? (live.id ?? null) : (state.rekaman?.id ?? state.hasil?.run?.id ?? null));
  const KUNCI = { token: 'sd.token', tema: 'sd.tema', padat: 'sd.kepadatan', terakhir: 'sd.terakhir', keputusan: 'sd.keputusan.', keputusanV2: 'sd.keputusan.v2.' };

  const $ = (id) => document.getElementById(id);
  const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = encodeURIComponent;
  const angka = new Intl.NumberFormat('id-ID');
  const fmtWaktu = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtJam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });

  // ---------- Penyimpanan browser (selalu dibungkus try/catch) ----------
  const store = {
    get: (jenis, k) => { try { return window[jenis].getItem(k); } catch { return null; } },
    set: (jenis, k, v) => { try { window[jenis].setItem(k, v); return true; } catch { return false; } },
    del: (jenis, k) => { try { window[jenis].removeItem(k); } catch { /* abaikan */ } },
  };
  const bacaJsonLokal = (k, cadangan) => {
    try { return JSON.parse(store.get('localStorage', k)) ?? cadangan; } catch { return cadangan; }
  };

  // ---------- Pembuat elemen tanpa innerHTML ----------
  const el = (tag, props = {}, ...anak) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const a of anak.flat(Infinity)) {
      if (a === null || a === undefined || a === false) continue;
      n.append(a instanceof Node ? a : document.createTextNode(String(a)));
    }
    return n;
  };
  const isi = (n, ...anak) => n.replaceChildren(...anak.flat(Infinity).filter((a) => a !== null && a !== undefined && a !== false));
  const NS = 'http://www.w3.org/2000/svg';
  const ikon = (jalur) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('class', 'icon');
    s.setAttribute('aria-hidden', 'true');
    for (const d of [].concat(jalur)) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  };
  const IKON = {
    cek: 'M3 8.5l3 3 7-7', silang: ['M4 4l8 8', 'M12 4l-8 8'], luar: ['M9 3h4v4', 'M13 3L7 9', 'M11 9.5V13H3V5h3.5'],
    sistem: ['M2 3h12v8H2z', 'M6 14h4', 'M8 11v3'],
    terang: ['M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M8 1v1.5', 'M8 13.5V15', 'M1 8h1.5', 'M13.5 8H15',
      'M3 3l1 1', 'M12 12l1 1', 'M3 13l1-1', 'M12 4l1-1'],
    gelap: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z',
    seru: ['M8 3.5v5.5', 'M8 12h.01'],
    panah: 'M6 3.5l5 4.5-5 4.5',
    jam: ['M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z', 'M8 5v3.2l2 1.3'],
    commit: ['M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z', 'M8 2v3.5', 'M8 10.5V14'],
    biaya: ['M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z', 'M9.8 6.2A2 2 0 0 0 6.4 7.4c0 1.9 3.2 1 3.2 2.9A2 2 0 0 1 6.2 9.8', 'M8 4.6v6.8'],
    panggilan: ['M14 8A6 6 0 1 1 8 2', 'M5.6 7.9l1.9 1.9L14 3.3'],
    asal: ['M2.5 3.5h11v9h-11z', 'M2.5 6.2h11'],
    bolt: 'M8.8 2.2L4.4 8.7h3l-.4 5.1 4.4-6.5h-3z',
    minus: 'M4.5 8h7',
    titik: 'M8 5.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8z',
    perisai: 'M8 1.8l5 1.9v4.1c0 3-2.1 5.3-5 6.4c-2.9-1.1-5-3.4-5-6.4V3.7z',
    cabang: ['M4.5 3.2a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z', 'M11.5 3.2a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z', 'M4.5 9.6a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z', 'M4.5 6.4v3.2', 'M11.5 6.4c0 2-2.3 2.2-4.5 3.2'],
    labu: ['M6.5 2h3', 'M7 2v4L3.6 12a1.4 1.4 0 0 0 1.2 2.1h6.4A1.4 1.4 0 0 0 12.4 12L9 6V2'],
    // Kepadatan dibedakan lewat bentuk, bukan jumlah garis: pada 18 px selisih jumlah garis tidak terbaca.
    padat: ['M3 4h10', 'M3 6.7h10', 'M3 9.4h10', 'M3 12.1h10'],
    nyaman: ['M3.5 3.5h9v4h-9z', 'M3.5 8.5h9v4h-9z'],
    // Navigasi rail. Bentuknya dibedakan sejelas mungkin pada 20 px, karena ikon di sini hanya
    // penanda posisi: label teksnya selalu ada di sebelahnya.
    kisi: ['M2.5 2.5h5v5h-5z', 'M8.5 2.5h5v5h-5z', 'M2.5 8.5h5v5h-5z', 'M8.5 8.5h5v5h-5z'],
    terverifikasi: ['M8 1.8l5 1.9v4.1c0 3-2.1 5.3-5 6.4c-2.9-1.1-5-3.4-5-6.4V3.7z', 'M5.6 7.9l1.7 1.7 3.1-3.4'],
    riwayat: ['M8 2.5a5.5 5.5 0 1 1-5.4 6.6', 'M2.2 5.2l.4 3.9 3.6-1.6', 'M8 5.3v3l2.1 1.3'],
    repo: ['M3.5 2h7.2l2 2v10H3.5z', 'M3.5 11.2h9.2', 'M6 4.6h3'],
    lipat: ['M8 2.4l2.6 2.8H5.4z', 'M8 13.6l2.6-2.8H5.4z'],
    kunci: ['M4.2 7.3h7.6v6.2H4.2z', 'M6 7.3V5.4a2 2 0 0 1 4 0v1.9'],
  };
  // Tautan keluar selalu membawa rel yang sama dan ikon yang sama, dan selalu menjelaskan
  // tujuannya. Tanpa url, isinya dikembalikan apa adanya sebagai teks biasa.
  const tautanGh = (url, isi, label, kelas = null) => (url
    ? el('a', { class: kelas, href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label ?? null },
      isi, ikon(IKON.luar))
    : isi);

  // Tombol ikon: label dibacakan pembaca layar dan muncul sebagai tooltip
  const pasangIkon = (tombol, jalur, label) => {
    tombol.replaceChildren(ikon(jalur));
    tombol.setAttribute('aria-label', label);
    tombol.title = label;
  };

  // ---------- Format ----------
  const durasi = (detik) => {
    if (!Number.isFinite(detik) || detik < 0) return '—';
    const d = Math.round(detik);
    const j = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = String(d % 60).padStart(2, '0');
    return j ? `${j}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };
  const waktu = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? fmtWaktu.format(t) : '—'; };
  const pendek = (sha, n = 7) => (typeof sha === 'string' ? sha.slice(0, n) : '—');
  // Path file hanya boleh patah di garis miring. Dengan overflow-wrap bebas, "nilaiController.js"
  // terbaca "nilaiC / ontroller.js" dan pembaca salah menyimpulkan lokasi temuan.
  const teksPath = (file) => String(file).split('/').flatMap((bagian, i, semua) => (i < semua.length - 1 ? [`${bagian}/`, el('wbr')] : [bagian]));
  const teksLokasi = (file, baris) => (file ? [...teksPath(file), `:${baris ?? '?'}`] : ['—']);
  const urlGithub = (owner, repo, ...seg) => `https://github.com/${enc(owner)}/${enc(repo)}${seg.length ? `/${seg.map(enc).join('/')}` : ''}`;

  // ---- awal blok tautan GitHub (diuji di tests/tautan-github.test.js) ----
  // Tautan hanya dibangun dari nilai yang sudah divalidasi: owner dan repo dari konfigurasi
  // project, id run dan id job harus bilangan bulat positif, SHA harus 40 heksadesimal. Nilai yang
  // tidak lolos tidak menghasilkan tautan sama sekali. Tautan yang mendarat di halaman yang salah
  // lebih berbahaya daripada teks biasa, karena pembacanya mengira sudah melihat buktinya.
  // Seluruh URL di sini hanya dipakai sebagai href; tidak satu pun pernah diambil lewat jaringan,
  // dan connect-src tetap hanya 'self' dan api.github.com.
  const NAMA_GH = /^[A-Za-z0-9._-]+$/;
  const idGh = (v) => {
    const t = typeof v === 'number' ? (Number.isSafeInteger(v) ? String(v) : null) : v;
    return typeof t === 'string' && /^[1-9][0-9]*$/.test(t) ? t : null;
  };
  const shaGh = (v) => (typeof v === 'string' && /^[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
  // Project demo yang sengaja dibuat-buat tidak boleh ditautkan ke repo mana pun.
  const repoGh = (p) => (p && !p.demo_tanpa_workflow && NAMA_GH.test(String(p.owner ?? '')) && NAMA_GH.test(String(p.repo ?? ''))
    ? p : null);
  const urlRepoGh = (p) => (repoGh(p) ? urlGithub(p.owner, p.repo) : null);
  const urlRunGh = (p, runId) => {
    const r = repoGh(p);
    const id = idGh(runId);
    return r && id ? urlGithub(r.owner, r.repo, 'actions', 'runs', id) : null;
  };
  const urlJobGh = (p, runId, jobId) => {
    const dasar = urlRunGh(p, runId);
    const j = idGh(jobId);
    return dasar && j ? `${dasar}/job/${j}` : null;
  };
  const urlCommitGh = (p, sha) => {
    const r = repoGh(p);
    const h = shaGh(sha);
    return r && h ? urlGithub(r.owner, r.repo, 'commit', h) : null;
  };
  const urlBerkasGh = (p, sha, file, baris) => {
    const r = repoGh(p);
    const h = shaGh(sha);
    if (!r || !h || typeof file !== 'string' || !file || file.startsWith('/') || file.split('/').includes('..')) return null;
    const n = Number(baris);
    return `${urlGithub(r.owner, r.repo, 'blob', h, ...file.split('/'))}${Number.isInteger(n) && n > 0 ? `#L${n}` : ''}`;
  };
  // ---- akhir blok tautan GitHub ----

  // ---------- State ----------
  const state = {
    demo: false,
    models: [],
    tampilan: null,
    diminta: null,
    eksLabel: 'utama',
    token: null,
    tokenDiingat: false,
    projects: [],
    statusProject: new Map(),
    proyek: null,
    // Dua peran yang dulu dipegang satu nilai: `branch` adalah branch yang hasilnya sedang dibaca
    // (termasuk arsip), `branchJalan` adalah branch tujuan run berikutnya (hanya yang bisa dipicu).
    // Digabung, memilih mode SAST + LLM akan mengunci arsip dan menyeret pembaca keluar darinya.
    branch: null,
    branchJalan: null,
    index: null,
    entri: null,
    hasil: null,
    sebelumnya: null,
    jobs: null,
    filter: 'semua',
    terbuka: null,
    simpulTerbuka: null,
    keputusan: {},
    sibuk: false,
    pantau: null,
    rateSisa: null,
    banner: null,
  };

  // ---------- GitHub API ----------
  class GhError extends Error {
    constructor(jenis, pesan, info = {}) {
      super(pesan);
      this.jenis = jenis;
      Object.assign(this, info);
    }
  }

  const pesanGalat = (err) => {
    switch (err?.jenis) {
      case 'auth': return 'Token ditolak GitHub (401). Token salah, kedaluwarsa, atau sudah dicabut. Buat token baru lalu simpan lagi.';
      case 'ratelimit': return `Batas permintaan GitHub habis. Coba lagi ${err.reset ? `setelah pukul ${fmtJam.format(err.reset)}` : 'beberapa menit lagi'}.`;
      case 'forbidden': return 'GitHub menolak akses (403). Pastikan token punya izin Actions: Read and write dan Contents: Read-only untuk repo ini.';
      case 'notfound': return 'Tidak ditemukan (404). Repo tidak ada, atau token tidak diberi akses ke repo ini.';
      case 'unprocessable': return ['Workflow menolak permintaan (422).',
        err.rinci ? `GitHub menyebut: ${err.rinci}.` : null,
        'Biasanya devsecops.yml di branch tujuan belum memuat input yang dikirim, atau ada nilai di luar daftar opsinya; perubahan workflow perlu di-push atau di-merge ke branch itu.',
      ].filter(Boolean).join(' ');
      case 'network': return 'Tidak bisa terhubung ke GitHub. Periksa koneksi internet, lalu coba lagi.';
      case 'lokal': case 'format': case 'invalid': case 'hasil': return err.message;
      default: return `GitHub mengembalikan galat ${err?.status ?? 'tak dikenal'}. Coba lagi beberapa saat lagi.`;
    }
  };

  const gh = async (path, { method = 'GET', body, raw = false } = {}) => {
    const url = new URL(path, API);
    if (url.origin !== API) throw new GhError('invalid', 'Permintaan diblokir: dashboard hanya boleh menghubungi api.github.com.');
    const headers = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    } catch {
      throw new GhError('network', 'jaringan');
    }
    const sisa = res.headers.get('x-ratelimit-remaining');
    if (sisa !== null) state.rateSisa = Number(sisa);
    if (res.ok) {
      if (res.status === 204) return null;
      const teks = await res.text();
      try { return JSON.parse(teks); } catch { throw new GhError('format', 'Respons GitHub bukan JSON yang valid.'); }
    }
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || null;
    if (res.status === 401) throw new GhError('auth', '401', { status: 401 });
    if ((res.status === 403 || res.status === 429) && (sisa === '0' || res.headers.get('retry-after'))) throw new GhError('ratelimit', 'rate', { status: res.status, reset });
    if (res.status === 403) throw new GhError('forbidden', '403', { status: 403 });
    if (res.status === 404) throw new GhError('notfound', '404', { status: 404 });
    // 422 pada dispatch hampir selalu soal input: nama yang tidak dikenal, atau nilai di luar
    // daftar opsi. GitHub menyebutkan yang mana di body-nya, dan tanpa membacanya pengguna hanya
    // diberi tebakan. Body dibaca dengan hati-hati: ia tidak selalu JSON, dan kegagalan membacanya
    // tidak boleh menutupi galat aslinya.
    if (res.status === 422) {
      let rinci = null;
      try {
        const d = JSON.parse(await res.text());
        const daftar = Array.isArray(d?.errors)
          ? d.errors.map((e) => (typeof e === 'string' ? e : e?.message ?? e?.field)).filter(Boolean).join('; ')
          : '';
        rinci = [d?.message, daftar].filter(Boolean).join(' — ') || null;
      } catch { rinci = null; }
      throw new GhError('unprocessable', '422', { status: 422, rinci });
    }
    throw new GhError('server', String(res.status), { status: res.status });
  };

  const jsonLokal = async (path) => {
    let res;
    try { res = await fetch(path, { cache: 'no-store', credentials: 'omit' }); } catch {
      throw new GhError('lokal', `Berkas ${path} tidak bisa dibaca. Buka dashboard lewat server lokal (lihat README), bukan langsung dari file.`);
    }
    if (!res.ok) throw new GhError('lokal', `Berkas ${path} tidak ditemukan (${res.status}).`);
    try { return await res.json(); } catch { throw new GhError('format', `Berkas ${path} bukan JSON yang valid.`); }
  };

  // Path hasil berasal dari index.json; tolak apa pun di luar pola <branch>/<nomor>.json.
  const pathAman = (p) => typeof p === 'string' && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.json$/.test(p) && !p.split('/').includes('..');

  // Satu berkas index per skema, mengikuti aturan di scripts/merge-results.js: index.json milik
  // skema 2 dan index-v3.json milik skema 3. Riwayat harus membaca keduanya; kalau hanya index.json
  // yang dibaca, run dua perkakas tidak pernah muncul di dashboard walaupun berkas hasilnya sudah
  // terbit, dan kekosongannya tidak memberi petunjuk apa pun tentang sebabnya.
  const BERKAS_INDEX = ['index.json', 'index-v3.json'];

  // Daftar run dari beberapa berkas index disambung menjadi satu, TANPA diurutkan di sini.
  // Pengurutan sengaja tidak disalin ke tempat ini: urutEntri adalah satu-satunya pengurutan run di
  // berkas ini (dijaga tests/urutan-run.test.js), dan ketiga pemakai yang peduli urutan sudah
  // memanggilnya sendiri — entriBranch, branchRunTerbaru, dan alertTerakhir. Pemakai lainnya hanya
  // memakai .some, yang tidak bergantung urutan.
  const gabungIndex = (daftar) => ({
    runs: (daftar ?? []).flatMap((x) => (Array.isArray(x?.runs) ? x.runs : [])),
  });

  const repoPath = (p) => `/repos/${enc(p.owner)}/${enc(p.repo)}`;
  const contentsPath = (p, file) => `${repoPath(p)}/contents/${file.split('/').map(enc).join('/')}?ref=${enc(BRANCH_HASIL)}`;

  // Dashboard membaca tiga skema: 1 (jalur Gemini lama), 2 (jalur prompt v2, alert diverifikasi
  // model), dan 3 (skema 2 ditambah sumbu sast, alert bisa berasal dari lebih dari satu perkakas).
  // schema_version yang dikenali tidak lagi dilempar sebagai galat format; yang tidak dikenali tetap ditolak.
  const SKEMA_DIDUKUNG = [1, 2, 3];
  // Skema 2 dan 3 adalah jalur yang sama dari sisi tampilan: bentuk blok run, findings, dan alerts
  // identik, dan skema 3 hanya menambah medan. Dipisah sebagai konstanta supaya tidak ada lagi
  // perbandingan `=== 2` yang tersebar dan diam-diam memperlakukan skema 3 seperti skema 1.
  const SKEMA_LLM = [2, 3];
  const skemaLlm = (r) => SKEMA_LLM.includes(r?.schema_version);
  const validasiHasil = (r) => {
    const v = r?.schema_version;
    const salah = (sebab) => {
      throw new GhError('format', `Format results.json tidak dikenali (${sebab}). Dashboard ini membaca skema versi ${SKEMA_DIDUKUNG.join(', ')}.`);
    };
    if (!r || !SKEMA_DIDUKUNG.includes(v) || !r.run) salah(`schema_version ${v ?? 'tidak ada'}`);
    if (v === 1 && (!Array.isArray(r.findings) || !r.sonar_verification)) salah('skema 1 tanpa findings atau sonar_verification');
    if (SKEMA_LLM.includes(v) && (!Array.isArray(r.findings) || !Array.isArray(r.alerts))) salah(`skema ${v} tanpa findings atau alerts`);
    return r;
  };

  // Severity alert: skema 2 menamainya severity_sonar karena sumbernya selalu SonarCloud, skema 3
  // menamainya severity karena tidak lagi selalu begitu. Dibaca lewat satu fungsi supaya data lama
  // dan data baru tidak perlu dua cabang di setiap tempat pemakaian.
  const severityAlert = (a) => a?.severity ?? a?.severity_sonar ?? null;
  // Perkakas pemasok alert. Alert skema 2 tidak punya medannya dan memang selalu dari Sonar.
  const perkakasAlert = (a) => a?.sumber_sast ?? 'sonar';
  const NAMA_SAST = { sonar: 'SonarCloud', codeql: 'CodeQL' };
  // Nama perkakas yang belum dikenal ditampilkan apa adanya, bukan diganti nama tebakan: lencana
  // yang mengarang nama perkakas sama buruknya dengan lencana yang mengarang angka.
  const namaSast = (k) => NAMA_SAST[k] ?? String(k);
  // Daftar perkakas yang benar-benar ada di satu himpunan alert. Urutannya mengikuti NAMA_SAST,
  // yaitu Sonar lebih dulu, sama dengan urutan verifikasi di scripts/sast/sumbu-sast.js; perkakas
  // yang belum dikenal menyusul di belakang menurut urutan kemunculannya.
  const perkakasDipakai = (alerts) => {
    const ada = [...new Set((alerts ?? []).map(perkakasAlert))];
    return [
      ...Object.keys(NAMA_SAST).filter((k) => ada.includes(k)),
      ...ada.filter((k) => !(k in NAMA_SAST)),
    ];
  };

  const bacaStatus = (status, conclusion) => {
    if (status === 'in_progress') return 'run';
    if (status !== 'completed') return 'wait';
    return { success: 'done', skipped: 'skip' }[conclusion] ?? 'fail';
  };
  const lamaDetik = (mulai, selesai) => {
    const a = Date.parse(mulai);
    if (!Number.isFinite(a)) return null;
    const b = Date.parse(selesai);
    return ((Number.isFinite(b) ? b : Date.now()) - a) / 1000;
  };
  // `selesai` menandai bahwa daftar job ini sudah final, bukan potret run yang masih berjalan.
  // Bedanya penting: job yang tidak ada di daftar run yang MASIH BERJALAN memang belum berjalan,
  // tetapi job yang tidak ada di daftar run yang SUDAH SELESAI tidak akan pernah berjalan — ia
  // tidak ada di pipeline saat run itu dijalankan. Menampilkan keduanya sebagai "menunggu"
  // membuat run lama seolah masih punya pekerjaan tersisa; run #54 berjalan sebelum job terbit-v2
  // ada, dan grafnya menyatakan "Satukan dan terbitkan: menunggu" selamanya.
  // GitHub menamai job matriks "<nama job> (<nilai matriks>)". Sejak analisis-v2 bermatriks vendor,
  // satu node graf bisa dipetakan ke BEBERAPA job sekaligus, dan pencocokan nama yang persis
  // membuat node itu tidak menemukan job apa pun. Akibatnya run yang jelas-jelas berhasil tampil
  // "tidak ada di run ini".
  //
  // Awalan dicocokkan dengan " (" di belakang nama node, bukan sekadar startsWith, supaya
  // "Gabung dan terbitkan hasil" tidak ikut menangkap "Gabung dan terbitkan hasil v2".
  const cocokJobNode = (namaJob, namaNode) => {
    const nama = String(namaJob ?? '');
    if (nama === namaNode) return { cocok: true, varian: null };
    if (nama.startsWith(`${namaNode} (`) && nama.endsWith(')')) {
      return { cocok: true, varian: nama.slice(namaNode.length + 2, -1) };
    }
    return { cocok: false, varian: null };
  };

  const statusSatuJob = (job) => {
    const s = bacaStatus(job.status, job.conclusion);
    return {
      s,
      // Id job dipakai untuk menautkan node graf ke halaman lognya di GitHub.
      id: job.id ?? null,
      durasi: s === 'skip' ? null : lamaDetik(job.started_at, job.completed_at),
      // Langkah job dipakai saat node graf diklik. Hanya ada lewat API, jadi null untuk run yang
      // dibaca dari berkas hasil.
      langkah: Array.isArray(job.steps) ? job.steps.map((l) => ({
        nama: String(l.name ?? ''),
        s: bacaStatus(l.status, l.conclusion),
        durasi: lamaDetik(l.started_at, l.completed_at),
      })) : null,
    };
  };

  // Status satu node dari semua job yang cocok dengannya. Aturannya dipilih supaya tidak pernah
  // lebih optimistis dari kenyataan: satu vendor gagal membuat nodenya gagal, bukan "selesai
  // sebagian". Rinciannya tetap utuh di `per`, jadi yang hilang hanya ringkasannya, bukan datanya.
  //
  // `selesai` menandai bahwa daftar job ini sudah final. Job yang tidak ada di daftar run yang
  // MASIH BERJALAN memang belum berjalan, tetapi job yang tidak ada di daftar run yang SUDAH
  // SELESAI tidak akan pernah berjalan: ia belum ada di pipeline saat run itu dijalankan.
  const statusNodeDariJob = (jobs, selesai = false) => {
    if (!jobs.length) return { s: selesai ? 'absen' : 'wait', durasi: null, langkah: null, id: null, per: [] };
    const per = jobs.map(({ job, varian }) => ({ varian, ...statusSatuJob(job), job }));
    const ada = (x) => per.some((j) => j.s === x);
    let s;
    if (ada('fail')) s = 'fail';
    else if (ada('run')) s = 'run';
    else if (ada('wait')) s = per.every((j) => j.s === 'wait') ? 'wait' : 'run';
    else if (per.every((j) => j.s === 'skip')) s = 'skip';
    else s = 'done';

    // Job matriks berjalan paralel, jadi lamanya adalah rentang dinding jam dari yang paling awal
    // mulai sampai yang paling akhir selesai. Menjumlahkannya akan melaporkan run tiga vendor
    // sebagai tiga kali lebih lama daripada yang benar-benar dialami.
    const mulai = jobs.map(({ job }) => Date.parse(job.started_at)).filter(Number.isFinite);
    const akhir = jobs.map(({ job }) => Date.parse(job.completed_at)).filter(Number.isFinite);
    const durasiNode = per.length === 1
      ? per[0].durasi
      : (mulai.length && akhir.length ? (Math.max(...akhir) - Math.min(...mulai)) / 1000 : null);

    // Satu job: tautan lognya seperti sebelumnya. Beberapa job: tidak ada satu log yang mewakili,
    // jadi kartunya tidak menautkan apa pun dan tautan per vendor muncul di panel langkah.
    const id = per.length === 1 ? per[0].id : null;

    // Langkah seluruh vendor digabung berurutan, masing-masing membawa nama variannya supaya
    // "Jalankan llm-scan" milik google tidak tertukar dengan milik openai.
    const langkah = per.some((j) => Array.isArray(j.langkah))
      ? per.flatMap((j) => (j.langkah ?? []).map((l) => (per.length > 1 ? { ...l, varian: j.varian } : l)))
      : null;

    return { s, durasi: s === 'skip' ? null : durasiNode, id, langkah, per: per.map(({ job, ...sisa }) => sisa) };
  };

  const jobsDariApi = (daftar, node = nodeJalur(jalurAktif()), selesai = false) => Object.fromEntries(
    node.map((n) => {
      const cocok = (daftar ?? []).map((job) => ({ job, ...cocokJobNode(job.name, n.job) })).filter((x) => x.cocok);
      return [n.key, statusNodeDariJob(cocok, selesai)];
    }));

  const sumberLive = {
    projects: () => jsonLokal('projects.json'),
    cekProject: async (p) => {
      let repo;
      try {
        repo = await gh(repoPath(p));
      } catch (err) {
        return { akses: false, err };
      }
      // Branch bawaan repositori hanya diketahui dari GitHub. Tanpa nilai ini tidak ada penanda
      // "(default)" sama sekali, karena menebaknya dari nama branch adalah mengarang.
      const bawaan = typeof repo?.default_branch === 'string' ? repo.default_branch : null;
      try {
        await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}`);
        return { akses: true, workflow: true, branch_bawaan: bawaan };
      } catch (err) {
        if (err.jenis === 'notfound') return { akses: true, workflow: false, branch_bawaan: bawaan };
        return { akses: true, workflow: null, branch_bawaan: bawaan, err };
      }
    },
    index: async (p) => gabungIndex(await Promise.all(BERKAS_INDEX.map(async (f) => {
      try {
        return await gh(contentsPath(p, f), { raw: true });
      } catch (err) {
        // index-v3.json belum ada di hampir semua proyek, dan itu keadaan normal, bukan galat.
        if (err.jenis === 'notfound') return { runs: [] };
        throw err;
      }
    }))),
    hasil: async (p, entri) => {
      if (!pathAman(entri.path)) throw new GhError('format', 'Path hasil di index.json tidak valid.');
      return validasiHasil(await gh(contentsPath(p, entri.path), { raw: true }));
    },
    jobs: async (p, runId) => {
      try {
        const data = await gh(`${repoPath(p)}/actions/runs/${enc(runId)}/jobs?per_page=50`);
        // Run yang dibuka dari riwayat sudah selesai: job yang tidak ada di daftarnya memang
        // tidak pernah ada di pipeline run itu.
        return { jobs: jobsDariApi(data.jobs || [], undefined, true), rekaman: null };
      } catch {
        return null;
      }
    },
  };

  // Sejak renderer v1 dipensiunkan, mode demo hanya punya satu kumpulan fixture: data v2
  // eksperimen 19 Okt. Hash #demo-v2 tetap diterima sebagai alias lama dari #demo.
  const basisDemo = () => 'fixtures/v2';

  const sumberDemo = {
    projects: () => jsonLokal('fixtures/projects.json'),
    cekProject: async (p) => ({
      akses: true,
      workflow: !p.demo_tanpa_workflow,
      branch_bawaan: typeof p.default_branch === 'string' ? p.default_branch : null,
    }),
    // Fixture skema 3 opsional: kalau berkasnya belum ada, mode demo tetap menampilkan run skema 2
    // seperti sebelumnya. Hanya kegagalan membaca berkas kedua yang ditelan, bukan yang pertama.
    index: async (p) => (p.demo_tanpa_workflow ? { runs: [] } : gabungIndex([
      await jsonLokal(`${basisDemo()}/index.json`),
      await jsonLokal(`${basisDemo()}/index-v3.json`).catch(() => ({ runs: [] })),
    ])),
    hasil: async (p, entri) => {
      if (!pathAman(entri.path)) throw new GhError('format', 'Path hasil di index.json tidak valid.');
      return validasiHasil(await jsonLokal(`${basisDemo()}/${entri.path}`));
    },
    // Run eksperimen dijalankan dari CLI, jadi tidak punya status job. Satu run di fixture demo
    // justru berasal dari GitHub Actions: status jobnya diambil sekali dari API dan disimpan apa
    // adanya sebagai rekaman, supaya graf pipeline di mode demo menggambarkan run yang benar-benar
    // terjadi, bukan keadaan karangan.
    jobs: async (p, runId) => {
      const r = await rekamanDemo();
      if (!r || r.run.id !== runId) return null;
      return { jobs: jobsDariApi(r.jobs, undefined, true), rekaman: r.run };
    },
  };

  let rekamanDemoCache;
  const rekamanDemo = async () => {
    if (rekamanDemoCache === undefined) {
      try { rekamanDemoCache = await jsonLokal(`${basisDemo()}/rekaman/run-54.json`); } catch { rekamanDemoCache = null; }
    }
    return rekamanDemoCache;
  };

  const sumber = () => (state.demo ? sumberDemo : sumberLive);

  // ---------- Tema dan kepadatan ----------
  // Desain hanya menggambar dua tombol, matahari dan bulan. Segmen "ikuti sistem" ditambahkan
  // karena itulah keadaan bawaan dashboard ini: tanpa segmennya, pengguna yang sudah pernah
  // menekan salah satu tema tidak punya jalan kembali ke pilihan sistem operasinya.
  const SEGMEN_TEMA = [
    { nilai: null, id: 'tema-sistem', ikon: 'sistem', label: 'Ikuti tema sistem' },
    { nilai: 'terang', id: 'tema-terang', ikon: 'terang', label: 'Tema terang' },
    { nilai: 'gelap', id: 'tema-gelap', ikon: 'gelap', label: 'Tema gelap' },
  ];
  const pilihTema = (nilai) => {
    if (nilai) store.set('localStorage', KUNCI.tema, nilai); else store.del('localStorage', KUNCI.tema);
    terapkanTema();
  };
  const terapkanTema = () => {
    const t = store.get('localStorage', KUNCI.tema);
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    isi($('tema-grup'), SEGMEN_TEMA.map((x) => el('button', {
      class: 'btn btn-sm btn-icon', type: 'button', id: x.id,
      'aria-pressed': String((t ?? null) === x.nilai), 'aria-label': x.label, title: x.label,
      onclick: () => pilihTema(x.nilai),
    }, ikon(IKON[x.ikon]))));
  };
  // Di layar sempit, rail setinggi satu layar penuh mendorong isi utama keluar pandangan. Isinya
  // menjadi panel yang dibuka lewat tombol Menu di bilah atas, dengan fokus terkurung dan Escape
  // untuk menutup, mekanik yang sama dengan kedua drawer. Di layar lebar tombolnya tidak ada dan
  // rail selalu terbuka, jadi tidak ada yang dikurung.
  const railSempit = () => !window.matchMedia('(min-width: 64rem)').matches;
  const terapkanRail = (buka) => {
    document.documentElement.dataset.rail = buka ? 'buka' : 'tutup';
    $('rail-toggle').setAttribute('aria-expanded', String(buka));
    if (buka && railSempit()) {
      bukaPanel($('rail-isi'), {
        pemicu: $('rail-toggle'),
        tutupId: 'rail-toggle',
        kelola: false,
        saatTutup: () => { document.documentElement.dataset.rail = 'tutup'; },
      });
    } else if (!buka) {
      lepasPanel($('rail-isi'));
    }
  };

  const terapkanKepadatan = () => {
    const d = store.get('localStorage', KUNCI.padat) === 'padat' ? 'padat' : 'nyaman';
    document.documentElement.dataset.density = d;
    pasangIkon($('density-toggle'), IKON[d], `Kepadatan: ${d}`);
  };

  // ---------- Banner ----------
  // `tambahan` adalah node siap pakai, bukan teks: banner galat run yang gagal perlu membawa
  // tautan ke log, dan github.com hanya boleh muncul sebagai href.
  const tampilBanner = (jenis, teks, aksi, tambahan = null) => {
    const b = $('banner');
    state.banner = jenis;
    b.dataset.kind = jenis;
    b.setAttribute('role', jenis === 'error' ? 'alert' : 'status');
    isi(b, el('p', { text: teks }), tambahan, aksi ? el('button', { class: 'btn btn-sm', type: 'button', text: aksi.label, onclick: aksi.fn }) : null);
    b.hidden = false;
  };
  const tutupBanner = (jenis) => {
    if (jenis && state.banner !== jenis) return;
    $('banner').hidden = true;
    state.banner = null;
    if (state.demo) bannerDemo();
  };
  const bannerDemo = () => tampilBanner('demo',
    'Mode demo. Data eksperimen dari fixture lokal, keduanya di branch eksperimen/seeded dan dijalankan dari CLI: '
    + 'batch 19 Okt 2026 (commit 97cfb00, satu run per vendor) dan batch 22 Okt 2026 (commit 6f7e729, tiga run per vendor). '
    + 'Branch feat/prompt-v2 memuat rekaman run CI #54 yang benar-benar berjalan di GitHub Actions, lengkap dengan status tiap job.',
    { label: 'Keluar dari mode demo', fn: () => keluarDemo() });

  // Mode demo ditulis ke query, bukan hash, karena hash sudah dipakai tampilan. Tampilan yang
  // sedang dibuka ikut dipertahankan supaya masuk dan keluar demo tidak memindahkan halaman.
  const setelDemoDiUrl = (aktif) => {
    const u = new URL(location.href);
    if (aktif) u.searchParams.set('demo', '1'); else u.searchParams.delete('demo');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  };

  // ---------- Token ----------
  const muatToken = () => {
    const sesi = store.get('sessionStorage', KUNCI.token);
    const lokal = store.get('localStorage', KUNCI.token);
    state.token = sesi || lokal || null;
    state.tokenDiingat = !sesi && Boolean(lokal);
  };

  const renderAkses = (status, teks) => {
    const s = $('access-state');
    s.dataset.s = status;
    isi(s, el('i', { 'aria-hidden': 'true' }), el('span', { text: teks }));
    $('token-clear').hidden = !state.token;
    $('token-save').textContent = state.token ? 'Ganti token' : 'Simpan dan periksa';
    renderRailBawah();
  };

  // Dasar rail selalu menyebut tiga hal yang bergantung pada keadaan yang sama: koneksi, tindakan
  // token, dan tombol demo. Disusun di satu tempat supaya ketiganya tidak pernah saling berbeda.
  const renderRailBawah = () => {
    $('token-aksi').textContent = state.token ? 'Ganti token' : 'Sambungkan';
    $('demo-toggle').textContent = state.demo ? 'Keluar dari mode demo' : 'Buka mode demo';
    renderKoneksi();
  };

  // Baris status koneksi di dasar rail, menggantikan "Pipeline Online v2.4.1" di desain. Menyebut
  // keadaan yang sebenarnya dan tanpa nomor versi: dashboard ini tidak punya versi yang dirilis,
  // sedangkan dari mana datanya datang justru yang perlu diketahui.
  const renderKoneksi = () => {
    const n = $('koneksi');
    const keadaan = state.demo
      ? { s: 'demo', teks: 'Mode demo', ket: 'Data fixture di berkas, tanpa panggilan ke GitHub.' }
      : (state.token
        ? { s: 'ok', teks: 'Live \u00b7 token tersambung', ket: 'Hasil dan status run dibaca lewat api.github.com.' }
        : { s: 'warn', teks: 'Live \u00b7 tanpa token', ket: 'Tanpa token, hasil dan status run tidak bisa dibaca.' });
    n.dataset.s = keadaan.s;
    n.title = keadaan.ket;
    isi(n, el('i', { 'aria-hidden': 'true' }), el('span', { text: keadaan.teks }));
  };

  const teksTokenAktif = () => {
    const tempat = state.tokenDiingat ? 'diingat di browser ini' : 'hanya untuk sesi ini';
    const sisa = state.rateSisa !== null ? `, sisa ${angka.format(state.rateSisa)} permintaan` : '';
    return `Token aktif, ${tempat}${sisa}`;
  };

  const simpanToken = async (e) => {
    e.preventDefault();
    const input = $('token-input');
    const galat = $('token-error');
    const nilai = input.value.trim();
    galat.hidden = true;
    if (!nilai || /\s/.test(nilai)) {
      galat.textContent = 'Tempel token tanpa spasi. Token fine-grained biasanya diawali github_pat_.';
      galat.hidden = false;
      input.focus();
      return;
    }
    const lama = state.token;
    state.token = nilai;
    $('token-save').disabled = true;
    renderAkses('none', 'Memeriksa token…');
    try {
      await gh('/rate_limit');
    } catch (err) {
      state.token = lama;
      galat.textContent = pesanGalat(err);
      galat.hidden = false;
      renderAkses(lama ? 'ok' : 'bad', lama ? teksTokenAktif() : 'Token belum aktif');
      $('token-save').disabled = false;
      input.focus();
      return;
    }
    const ingat = $('token-remember').checked;
    store.del('sessionStorage', KUNCI.token);
    store.del('localStorage', KUNCI.token);
    const tersimpan = store.set(ingat ? 'localStorage' : 'sessionStorage', KUNCI.token, nilai);
    state.tokenDiingat = ingat && tersimpan;
    input.value = '';
    $('token-save').disabled = false;
    renderAkses('ok', teksTokenAktif());
    if (!tersimpan) tampilBanner('info', 'Browser menolak penyimpanan. Token hanya aktif sampai halaman dimuat ulang.');
    if (state.demo) { state.demo = false; setelDemoDiUrl(false); }
    masukLive();
  };

  const hapusToken = () => {
    store.del('sessionStorage', KUNCI.token);
    store.del('localStorage', KUNCI.token);
    state.token = null;
    hentikanPantau();
    renderAkses('none', 'Belum ada token');
    if (!state.demo) tampilStart();
  };

  // ---------- Layar awal ----------
  const tampilStart = () => {
    $('start').hidden = false;
    $('workspace').hidden = true;
    isi($('project-list'));
    bukaDaftarRepo(false);
    $('repo-pilih').hidden = true;
    $('access').open = true;
    renderRailBawah();
  };

  // ---------- Masuk mode ----------
  const masukLive = async () => {
    state.demo = false;
    renderRailBawah();
    tutupBanner('demo');
    if (!state.token) return tampilStart();
    try {
      await gh('/rate_limit');
      renderAkses('ok', teksTokenAktif());
    } catch (err) {
      renderAkses('bad', 'Token tidak bisa dipakai');
      tampilBanner('error', pesanGalat(err));
      if (err.jenis === 'auth') { $('access').open = true; return tampilStart(); }
    }
    await muatProjects();
  };

  const masukDemo = async () => {
    hentikanPantau();
    state.demo = true;
    setelDemoDiUrl(true);
    renderRailBawah();
    bannerDemo();
    await muatProjects();
  };

  const keluarDemo = () => {
    hentikanPantau();
    state.demo = false;
    setelDemoDiUrl(false);
    renderRailBawah();
    $('banner').hidden = true;
    state.banner = null;
    if (state.token) masukLive(); else tampilStart();
  };

  // ---------- Project ----------
  // Branch yang paling berguna dibuka pertama kali adalah yang punya hasil terbaru, bukan branch
  // pertama di daftar. Index dibaca sekali di sini supaya pilihan itu bisa diambil sebelum render.
  const branchRunTerbaru = async (p) => {
    try {
      const index = await sumber().index(p);
      state.index = index;
      const urut = (index.runs ?? []).slice().sort(urutEntri);
      const nama = urut.find((e) => p.branches.some((b) => b.name === e.branch))?.branch ?? null;
      return nama;
    } catch {
      return null;
    }
  };

  const muatProjects = async () => {
    $('start').hidden = true;
    $('workspace').hidden = false;
    try {
      const data = await sumber().projects();
      state.projects = (data.projects || []).filter((p) => p.owner && p.repo && p.workflow && Array.isArray(p.branches) && p.branches.length);
    } catch (err) {
      tampilBanner('error', pesanGalat(err));
      state.projects = [];
    }
    if (!state.projects.length) {
      isi($('project-list'), el('li', { class: 'note', text: 'Belum ada project di projects.json.' }));
      return;
    }
    state.statusProject = new Map(await Promise.all(state.projects.map(async (p) => [p, await sumber().cekProject(p)])));
    const terakhir = state.demo ? { repo: `${state.projects[0].owner}/${state.projects[0].repo}`, branch: 'eksperimen/seeded' } : bacaJsonLokal(KUNCI.terakhir, {});
    const awal = state.projects.find((p) => `${p.owner}/${p.repo}` === terakhir.repo) ?? state.projects[0];
    const disukai = terakhir.branch ?? await branchRunTerbaru(awal);
    pilihProyek(awal, disukai);
  };

  const keteranganProject = (p) => {
    const st = state.statusProject.get(p) ?? {};
    if (st.akses === false) return { teks: 'tidak bisa diakses dengan token ini', off: true };
    if (st.workflow === false) return { teks: 'workflow belum dipasang', off: true };
    if (st.workflow === null) return { teks: 'status workflow tidak diketahui', off: false };
    return { teks: `${p.branches.length} branch · workflow aktif`, off: false };
  };

  // Titik status: hijau kalau workflow benar-benar terpasang di repo itu, abu-abu kalau belum
  // terpasang atau belum diketahui. Warna bukan satu-satunya penanda; keterangannya ikut tertulis.
  const titikProject = (p) => {
    const st = state.statusProject.get(p) ?? {};
    const s = st.akses === false || st.workflow === false ? 'off' : (st.workflow === true ? 'on' : 'tanya');
    return el('span', { class: `titik t-${s}`, 'aria-hidden': 'true' });
  };

  const renderProjects = () => {
    const aktif = state.proyek;
    // Satu project tidak perlu pemilih: kotaknya tetap ada sebagai identitas, tanpa chevron dan
    // tanpa daftar yang bisa dibuka, karena tidak ada yang bisa dipilih.
    const banyak = state.projects.length > 1;
    const tombol = $('repo-pilih');
    tombol.disabled = !banyak;
    tombol.hidden = !aktif;
    if (aktif) {
      const k = keteranganProject(aktif);
      isi(tombol,
        el('span', { class: 'kotak-ikon' }, ikon(IKON.repo)),
        el('span', { class: 'kotak-nama data', text: aktif.repo }),
        titikProject(aktif),
        banyak ? el('span', { class: 'kotak-lipat' }, ikon(IKON.lipat)) : null);
      tombol.title = `${aktif.owner}/${aktif.repo} \u00b7 ${k.teks}`;
      tombol.setAttribute('aria-label', `Repositori aktif ${aktif.owner}/${aktif.repo}, ${k.teks}${banyak ? '. Buka daftar repositori' : ''}`);
    }
    isi($('project-list'), state.projects.map((p) => {
      const k = keteranganProject(p);
      return el('li', {},
        el('button', {
          class: `project${k.off ? ' is-off' : ''}`, type: 'button', 'aria-current': p === state.proyek ? 'true' : 'false',
          onclick: () => { bukaDaftarRepo(false); pilihProyek(p); },
        }, el('span', { class: 'project-nama' }, titikProject(p), el('b', { class: 'data', text: p.repo })),
        el('span', { text: `${p.owner} \u00b7 ${k.teks}` })));
    }));
    if (!banyak) bukaDaftarRepo(false);
  };

  const bukaDaftarRepo = (buka) => {
    const bisa = state.projects.length > 1;
    $('repo-pilih').setAttribute('aria-expanded', String(buka && bisa));
    $('project-list').hidden = !(buka && bisa);
  };

  const pilihProyek = (p, branchDisukai) => {
    hentikanPantau();
    state.proyek = p;
    // Urutan pilihan: branch yang diminta, lalu branch bawaan project, lalu branch pertama yang
    // sesuai mode sekarang, baru yang pertama apa adanya.
    state.branch = p.branches.find((b) => b.name === branchDisukai) ?? p.branches[0];
    state.branchJalan = p.branches.find((b) => b.bawaan && branchSesuai(b))
      ?? p.branches.find(branchSesuai) ?? null;
    state.filter = 'semua';
    state.terbuka = null;
    renderProjects();
    renderRailBranch();
    renderDrawer();
    muatIndex();
  };

  const ingatPilihan = () => !state.demo && store.set('localStorage', KUNCI.terakhir, JSON.stringify({ repo: `${state.proyek.owner}/${state.proyek.repo}`, branch: state.branch.name }));

  // ---------- Daftar model ----------
  // dashboard/models.json adalah satu-satunya sumber daftar model, dipakai bersama workflow.
  // Drawer hanya menawarkan model jalur v2, karena hanya skema 2 yang ditampilkan dashboard ini.
  // Jalur v1 tetap ada di workflow untuk dispatch manual dan untuk mode SAST saja.
  const muatModels = async () => {
    try {
      const d = await jsonLokal('models.json');
      state.models = Array.isArray(d?.models) ? d.models : [];
      // Asal angka biaya disebut sekali di satu tempat. Di mode gabungan tiga vendor berbagi sumber
      // yang sama, dan mengulangnya tiga kali membuat baris sumbernya tidak lagi terbaca.
      state.modelsSumber = typeof d?.sumber_biaya === 'string' ? d.sumber_biaya : null;
    } catch {
      state.models = [];
      state.modelsSumber = null;
    }
  };

  // ---------- Panduan perbaikan lapis 1 ----------
  // Pemetaan CWE statis, dibaca sekali dari origin sendiri. Isinya panduan umum yang diturunkan
  // dari cwe.mitre.org dan OWASP Cheat Sheet Series, bukan analisis atas kode mana pun. Kalau
  // berkasnya gagal dibaca, bagian rekomendasi hanya hilang; tidak ada yang lain yang ikut rusak.
  const muatPanduan = async () => {
    try {
      const d = await jsonLokal('rekomendasi-cwe.json');
      state.panduan = d && typeof d.cwe === 'object' ? d : null;
    } catch {
      state.panduan = null;
    }
  };

  const panduanUntuk = (kode) => state.panduan?.cwe?.[kode] ?? null;

  // Satu blok panduan untuk satu CWE. Judul, langkah bernomor, lalu tautan sumbernya, supaya
  // pembaca bisa memeriksa sendiri dari mana langkah itu berasal.
  const blokPanduanSatu = (kode) => {
    const g = panduanUntuk(kode);
    if (!g) {
      return el('div', { class: 'panduan panduan-kosong' },
        el('p', { class: 'panduan-judul', text: `Panduan umum (${kode})` }),
        el('p', { class: 'panduan-teks', text: 'Belum ada panduan untuk CWE ini.' }));
    }
    return el('div', { class: 'panduan' },
      el('p', { class: 'panduan-judul', text: `Panduan umum (${g.id})` }),
      el('p', { class: 'panduan-sub', text: g.judul }),
      el('ol', { class: 'panduan-langkah' }, g.langkah.map((l) => el('li', { text: l }))),
      g.perlu_dicek
        ? el('p', { class: 'panduan-cek' }, ikon(IKON.seru), el('span', { text: g.alasan_perlu_dicek }))
        : null,
      el('p', { class: 'panduan-sumber' },
        el('span', { text: 'Sumber: ' }),
        g.sumber.map((u) => el('a', {
          href: u, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': `Buka sumber panduan ${g.id} di ${new URL(u).hostname}, tab baru`,
        }, new URL(u).hostname, ikon(IKON.luar)))),
      // Entri yang sudah diverifikasi manusia mendapat catatan netral, bukan peringatan: warna
      // amber dipakai khusus untuk yang memang masih perlu ditinjau, dan kalau dipakai untuk
      // keduanya ia berhenti berarti apa-apa.
      g.catatan_verifikasi ? el('p', { class: 'panduan-catatan', text: g.catatan_verifikasi }) : null);
  };

  // Saran lapis 2. Hanya digambar kalau field-nya memang ada di berkas hasil: run yang tidak
  // menjalankan remediasi tidak menampilkan bagian AI sama sekali, bukan menampilkannya kosong.
  const blokSaranAi = (obj, run) => {
    if (!('rekomendasi_ai' in obj)) return null;
    const r = obj.rekomendasi_ai;
    const kepala = el('p', { class: 'saran-kepala' },
      el('b', { text: 'Saran spesifik dari AI' }),
      el('span', { class: 'lencana l-high', text: 'Dihasilkan AI, belum diverifikasi, tidak diterapkan otomatis' }));

    // Field null berarti item ini tidak mendapat saran. Alasannya satu untuk seluruh run, karena
    // lapis 2 memakai satu panggilan; diambil dari ringkasan run supaya tidak dikarang per item.
    if (!r) {
      const sebab = run?.remediasi?.alasan ?? 'Model tidak memberi saran untuk item ini.';
      return el('section', { class: 'saran saran-kosong', 'aria-label': 'Saran spesifik dari AI' },
        kepala, el('p', { class: 'panduan-teks', text: sebab }));
    }

    // labelVendor memetakan vendor ke label modelnya, jadi menampilkan keduanya menghasilkan nama
    // yang sama dua kali. Yang dibaca manusia adalah label model; id mentahnya menjadi tooltip.
    const idModel = r.model_menjawab ?? r.model_diminta;
    const model = labelModelId(idModel);
    return el('section', { class: 'saran', 'aria-label': 'Saran spesifik dari AI' },
      kepala,
      el('p', { class: 'saran-model data', title: `${r.vendor} / ${idModel}`, text: model }),
      r.tidak_konsisten
        ? el('p', { class: 'panduan-cek' }, ikon(IKON.seru),
          el('span', { text: `Saran ini merujuk ${r.cwe_dirujuk}, yang tidak termasuk CWE item ini. Periksa ulang sebelum dipakai.` }))
        : null,
      el('ol', { class: 'panduan-langkah' }, r.langkah.map((l) => el('li', { text: l }))),
      r.potongan_kode_usulan
        ? el('div', {},
          el('p', { class: 'block-h', text: 'Usulan kode' }),
          el('pre', { class: 'code' }, el('code', { text: r.potongan_kode_usulan })))
        : null,
      el('p', { class: 'saran-risiko' },
        el('b', { text: 'Catatan risiko: ' }), el('span', { text: r.catatan_risiko })));
  };

  // Bagian "Rekomendasi perbaikan" yang dipakai bersama oleh drawer temuan dan detail alert.
  // Item dengan beberapa CWE mendapat satu blok untuk masing-masing: kode yang berbeda punya
  // pola perbaikan yang berbeda, dan menggabungkannya akan menyesatkan.
  const blokRekomendasi = (daftarCwe) => {
    const kode = (Array.isArray(daftarCwe) ? daftarCwe : []).filter((x) => typeof x === 'string' && x);
    return el('section', { class: 'rekom', 'aria-label': 'Rekomendasi perbaikan' },
      el('p', { class: 'rekom-kepala' },
        el('b', { text: 'Rekomendasi perbaikan' }),
        el('span', { class: 'lencana l-netral', text: 'Panduan umum berdasarkan CWE, bukan analisis AI' })),
      kode.length
        ? kode.map(blokPanduanSatu)
        : el('p', { class: 'panduan-teks', text: 'Item ini tidak membawa kode CWE, jadi tidak ada panduan umum yang bisa ditautkan.' }));
  };
  const modelJalur = () => state.models.filter((m) => m.jalur === 'v2');
  const modelTerpilih = () => modelJalur().find((x) => x.id === $('f-model').value) ?? null;
  // Mode SAST saja tetap melewati job jalur v1, yang memvalidasi input model terhadap daftar v1.
  const modelV1Bawaan = () => (state.models.find((m) => m.jalur === 'v1' && m.bawaan)
    ?? state.models.find((m) => m.jalur === 'v1'))?.id ?? '';

  const vendorRekomendasiTerpilih = () => modelJalur().find((x) => x.vendor === $('f-vendor-rekomendasi')?.value) ?? null;

  const renderModels = () => {
    const daftar = modelJalur();
    const sel = $('f-model');
    const sebelum = sel.value;
    isi(sel, daftar.map((m) => el('option', { value: m.id, selected: m.bawaan ? true : null }, `${m.label} (${m.vendor})`)));
    if (daftar.some((m) => m.id === sebelum)) sel.value = sebelum;

    // Penyusun rekomendasi dipilih per VENDOR, bukan per id model: itulah yang diterima input
    // vendor_rekomendasi di workflow, dan satu vendor hanya punya satu model di jalur v2.
    const rek = $('f-vendor-rekomendasi');
    const rekSebelum = rek.value;
    isi(rek, daftar.map((m) => el('option', { value: m.vendor, selected: m.bawaan ? true : null }, `${m.label} (${m.vendor})`)));
    if (daftar.some((m) => m.vendor === rekSebelum)) rek.value = rekSebelum;

    renderBiaya();
  };

  // Jumlah alert Sonar yang terakhir diketahui untuk branch ini, dari entri index run terbaru.
  // Urutan riwayat: terbaru di atas menurut waktu selesai. Waktu selesai yang sama atau tidak ada
  // sama sekali bukan hal teoretis — dua run bisa berbagi stempel waktu, dan run yang gagal bisa
  // tidak punya waktu selesai. Tanpa pemutus seri, urutannya jatuh ke urutan berkas yang sembarang,
  // dan "run terbaru" bisa menunjuk run yang salah. Nomor run GitHub naik monoton per repo, jadi
  // ia pemutus seri yang benar; ia TIDAK dipakai sebagai kunci utama karena run CLI memakai nomor
  // sebagai indeks biasa yang urutannya memang tidak selalu searah dengan waktu.
  const urutEntri = (a, b) => {
    const wa = String(a.selesai ?? '');
    const wb = String(b.selesai ?? '');
    if (wa !== wb) return wb.localeCompare(wa);
    return (Number(b.nomor) || 0) - (Number(a.nomor) || 0);
  };

  const alertTerakhir = () => {
    const b = branchJalan();
    const n = (state.index?.runs ?? [])
      .filter((e) => e.branch === b?.name)
      .sort(urutEntri)[0]?.jumlah?.alert;
    return Number.isFinite(n) ? n : null;
  };
  // Biaya satu run = satu panggilan deteksi + satu panggilan verifikasi per alert, jadi naik
  // seiring jumlah alert. Angkanya ditarik lurus lewat titik ukur nyata di models.json, bukan
  // ditebak: dengan dua titik ukur biayanya bisa dihitung untuk jumlah alert mana pun; dengan satu
  // titik, yang jujur hanyalah menyebut titik itu apa adanya.
  // Hasilnya selalu berbentuk selang {min, maks}, walau keduanya sering sama. Bentuk tunggal itu
  // yang membuat mode gabungan bisa dijumlahkan tanpa aturan kedua: tiga vendor punya tingkat
  // kepastian yang berbeda-beda, dan menjumlahkan angka tunggal akan menyembunyikan perbedaan itu.
  const perkiraanBiaya = (m, jumlahAlert, skenario = 'B') => {
    const titik = (m?.biaya_terukur ?? [])
      .filter((x) => Number.isFinite(x.alert) && Number.isFinite(x.usd))
      .sort((a, b) => a.alert - b.alert);
    if (!titik.length) return null;
    const a = titik[0];
    const b = titik[titik.length - 1];
    const duaTitik = titik.length >= 2 && b.alert !== a.alert;
    const pada = (n) => a.usd + ((b.usd - a.usd) / (b.alert - a.alert)) * (n - a.alert);

    // Skenario C hanya memanggil deteksi, tanpa satu pun verifikasi alert, jadi biayanya adalah
    // biaya pada 0 alert. Dengan dua titik ukur itu bisa dihitung; dengan satu titik, deteksi dan
    // verifikasi tidak bisa dipisahkan, dan yang masih jujur hanyalah batas atas: C memanggil model
    // lebih sedikit daripada B pada titik ukur itu, jadi biayanya tidak mungkin lebih besar.
    if (skenario === 'C') {
      if (duaTitik) {
        const v = Math.max(pada(0), 0);
        return { jenis: 'hitung', min: v, maks: v, alert: 0, titik };
      }
      return { jenis: 'batas-atas', min: 0, maks: a.usd, titik };
    }

    if (!duaTitik) return { jenis: 'satu-titik', min: a.usd, maks: a.usd, titik };
    if (jumlahAlert === null) return { jenis: 'rentang', min: a.usd, maks: b.usd, titik };
    const v = Math.max(pada(jumlahAlert), 0);
    return { jenis: 'hitung', min: v, maks: v, alert: jumlahAlert, titik };
  };

  // Model yang ikut dihitung: ketiga vendor v2 di mode gabungan, satu yang dipilih di mode tunggal.
  const modelDipakai = () => (modeModelTerpilih() === 'gabungan' ? modelJalur() : [modelTerpilih()].filter(Boolean));

  // Menjumlahkan selang beberapa model. Satu model tanpa titik ukur membuat seluruh totalnya tidak
  // bisa dipertanggungjawabkan, jadi yang dilaporkan adalah itu, bukan jumlah dari sisanya.
  const perkiraanTotal = (daftar, jumlahAlert, skenario) => {
    const per = daftar.map((m) => ({ m, p: perkiraanBiaya(m, jumlahAlert, skenario) }));
    const kosong = per.filter((x) => !x.p).map((x) => x.m.vendor);
    if (kosong.length) return { kosong, per };
    return {
      kosong: [],
      per,
      min: per.reduce((s, x) => s + x.p.min, 0),
      maks: per.reduce((s, x) => s + x.p.maks, 0),
      // Jenis total mengikuti anggota yang paling lemah: satu model yang baru punya satu titik ukur
      // membuat jumlahnya ikut belum bergantung jumlah alert. Batas atas tidak boleh larut menjadi
      // rentang biasa: "US$0,0000 sampai US$0,3702" membaca seolah nol mungkin, padahal yang
      // diketahui hanyalah batas atasnya.
      jenis: per.every((x) => x.p.jenis === 'batas-atas') ? 'batas-atas'
        : (per.some((x) => x.p.jenis !== 'hitung') ? 'campuran' : 'hitung'),
    };
  };

  // Angka ditulis tunggal kalau selangnya memang satu titik, dan sebagai rentang kalau tidak.
  const tulisSelang = (min, maks) => (Math.abs(maks - min) < 0.00005 ? usd(min) : `${usd(min)} \u2013 ${usd(maks)}`);

  const renderBiaya = () => {
    const teks = $('biaya-perkiraan');
    const sumber = $('biaya-sumber');
    const angka = $('biaya-angka');
    const skenario = skenarioTerpilih();
    const gabungan = modeModelTerpilih() === 'gabungan';
    const daftar = modelDipakai();
    // Skenario A tidak memanggil model sama sekali. Kotak biayanya disembunyikan, tetapi angka lama
    // dibersihkan juga: teks yang tertinggal di dalam elemen tersembunyi akan muncul kembali begitu
    // skenario diganti, sekejap sebelum angka barunya dihitung.
    if (modeTerpilih() !== 'sast-llm' || !daftar.length) {
      teks.textContent = ''; sumber.textContent = ''; angka.textContent = '';
      $('rekomendasi-biaya').textContent = '';
      return;
    }

    const jumlahAlert = alertTerakhir();
    const t = perkiraanTotal(daftar, jumlahAlert, skenario);
    if (t.kosong.length) {
      angka.textContent = '\u2014';
      teks.textContent = gabungan
        ? `Biaya belum pernah diukur untuk ${t.kosong.join(', ')}, jadi totalnya tidak bisa dipertanggungjawabkan.`
        : 'Biaya model ini belum pernah diukur.';
      sumber.textContent = 'Angka akan muncul setelah ada run yang biayanya tercatat.';
      $('rekomendasi-biaya').textContent = '';
      return;
    }

    // Penjelasan disusun dari apa yang sebenarnya diketahui, bukan dari satu kalimat tetap: tiga
    // vendor bisa punya tingkat kepastian berbeda di run yang sama.
    const bagian = [];
    if (skenario === 'C') {
      bagian.push('Skenario C hanya memanggil deteksi, tanpa verifikasi alert.');
      const batas = t.per.filter((x) => x.p.jenis === 'batas-atas').map((x) => x.m.vendor);
      if (batas.length) {
        bagian.push(`Untuk ${batas.join(', ')} biaya deteksi belum bisa dipisahkan dari verifikasi karena baru ada satu titik ukur, jadi angkanya batas atas: run C tidak mungkin lebih mahal dari itu.`);
      }
    } else if (t.jenis === 'hitung') {
      bagian.push(`Untuk ${jumlahAlert} alert Sonar di branch tujuan run.`);
    } else {
      const satu = t.per.filter((x) => x.p.jenis === 'satu-titik');
      if (satu.length) {
        bagian.push(`${satu.map((x) => `${x.m.vendor} diukur pada ${x.p.titik[0].alert} alert`).join(', ')}; baru satu titik ukur, jadi angkanya belum ikut jumlah alert.`);
      }
      const rentang = t.per.find((x) => x.p.jenis === 'rentang');
      if (rentang) {
        const ti = rentang.p.titik;
        bagian.push(`Jumlah alert branch tujuan belum diketahui: rentangnya ${ti[0].alert} sampai ${ti[ti.length - 1].alert} alert.`);
      }
    }
    if (gabungan) bagian.unshift('Jumlah tiga vendor yang berjalan paralel; ketiganya ditagih terpisah.');

    angka.textContent = t.jenis === 'batas-atas' ? `≤ ${usd(t.maks)}` : tulisSelang(t.min, t.maks);
    teks.textContent = bagian.join(' ');
    sumber.textContent = `Titik ukur: ${t.per.map((x) => `${x.m.vendor} ${x.p.titik.map((y) => `${usd(y.usd)} pada ${y.alert} alert`).join(' dan ')}`).join('; ')}. Sumber: ${state.modelsSumber ?? 'models.json'}. Perkiraan, bukan tarif.`;
    renderBiayaRekomendasi(t);
  };

  // Perkiraan tambahan untuk lapis 2. Ditampilkan terpisah dari angka utama, dan hanya ikut
  // dijumlahkan saat pilihannya benar-benar dicentang: angka yang berubah tanpa sebab yang terlihat
  // membuat pengguna tidak lagi mempercayainya.
  //
  // Lapis 2 memanggil SATU vendor, berapa pun jumlah model yang menganalisis. Di mode gabungan
  // vendor itu dipilih terpisah, jadi biayanya pun biaya vendor itu, bukan jumlah tiga vendor.
  const renderBiayaRekomendasi = (total) => {
    const n = $('rekomendasi-biaya');
    const m = modeModelTerpilih() === 'gabungan' ? vendorRekomendasiTerpilih() : modelTerpilih();
    const b = m?.biaya_rekomendasi_usd ?? null;
    if (!b) {
      n.textContent = 'Biaya rekomendasi AI untuk model ini belum pernah diperkirakan.';
      return;
    }
    const pilih = $('f-rekomendasi').checked;
    const siapa = modeModelTerpilih() === 'gabungan' ? ` oleh ${m.vendor}` : '';
    n.textContent = pilih
      ? `Termasuk dalam angka di atas: tambahan ${usd(b.min)} sampai ${usd(b.maks)} untuk satu panggilan rekomendasi${siapa}.`
      : `Kalau dicentang, biaya bertambah ${usd(b.min)} sampai ${usd(b.maks)} untuk satu panggilan rekomendasi${siapa}.`;
    if (pilih && total && !total.kosong.length) {
      $('biaya-angka').textContent = total.jenis === 'batas-atas'
        ? `≤ ${usd(total.maks + b.maks)}`
        : tulisSelang(total.min + b.min, total.maks + b.maks);
    }
  };

  // ---------- Form jalankan ----------
  const skenarioTerpilih = () => document.querySelector('input[name="skenario"]:checked')?.value ?? 'B';
  const modeTerpilih = () => MODE_SKENARIO[skenarioTerpilih()] ?? 'sast-llm';
  // Mode gabungan hanya sah untuk skenario B. Dibaca lewat fungsi ini, bukan langsung dari radio,
  // supaya pilihan yang tertinggal dari kunjungan sebelumnya tidak pernah ikut terkirim.
  const modeModelTerpilih = () => (skenarioTerpilih() === 'B'
    && document.querySelector('input[name="mode_model"]:checked')?.value === 'gabungan'
    ? 'gabungan' : 'tunggal');

  // Branch hanya bisa dipicu kalau workflow di branch itu memuat jalur yang dipilih. Kemampuan v2
  // tidak bisa ditanyakan ke API tanpa izin membaca isi berkas workflow, jadi dicatat per branch
  // di projects.json dan dirawat bersama workflow-nya.
  // Project tanpa branch yang bisa dipicu sama sekali membuat b bernilai null di sini.
  const branchSesuai = (b) => Boolean(b?.dispatch) && (jalurTerpilih() !== 'v2' || b.v2 === true);
  const sebabBranch = (b) => {
    if (!b.dispatch) return 'arsip';
    if (jalurTerpilih() === 'v2' && b.v2 !== true) return b.catatan_v2 ?? 'belum memuat jalur v2';
    return null;
  };
  const branchJalan = () => state.branchJalan ?? state.branch;

  // Select di rail: seluruh branch, termasuk arsip, karena ini soal apa yang dibaca. Penanda
  // "(default)" hanya untuk branch bawaan repositori yang dilaporkan GitHub, bukan untuk branch
  // bawaan tujuan run, yang artinya berbeda dan punya penandanya sendiri di drawer.
  const branchBawaanRepo = () => state.statusProject.get(state.proyek)?.branch_bawaan ?? null;
  const renderRailBranch = () => {
    const sel = $('f-branch-lihat');
    const bawaan = branchBawaanRepo();
    isi(sel, state.proyek.branches.map((b) => {
      const tanda = [b.name === bawaan ? '(default)' : null, b.dispatch ? null : 'arsip'].filter(Boolean);
      return el('option', {
        value: b.name, text: tanda.length ? `${b.name} \u00b7 ${tanda.join(' \u00b7 ')}` : b.name, selected: b === state.branch,
      });
    }));
    // Rail hanya selebar 16rem: nama branch panjang terpotong, jadi judul penuhnya disediakan.
    sel.title = state.branch?.name ?? '';
  };

  // Select di drawer: hanya branch yang bisa dipicu, dan yang tidak mendukung mode terpilih
  // ditampilkan tetapi dimatikan beserta sebabnya.
  const renderFormBranch = () => {
    if (!branchSesuai(state.branchJalan)) {
      state.branchJalan = state.proyek.branches.find((b) => b.bawaan && branchSesuai(b))
        ?? state.proyek.branches.find(branchSesuai)
        ?? state.branchJalan;
    }
    isi($('f-branch'), state.proyek.branches.filter((b) => b.dispatch).map((b) => {
      const sebab = sebabBranch(b);
      return el('option', {
        value: b.name, text: sebab ? `${b.name} · ${sebab}` : b.name,
        disabled: branchSesuai(b) ? null : true, selected: b === state.branchJalan,
      });
    }));
    perbaruiTombolJalankan();
  };

  // Satu tempat yang menyusun seluruh isi drawer sesuai mode: apa yang ditampilkan, apa yang
  // dijelaskan, dan apakah tombol boleh ditekan. Branch TUJUAN RUN yang tidak mendukung mode
  // terpilih akan digeser ke branch bawaan oleh renderFormBranch, sedangkan branch yang sedang
  // DIBACA tidak pernah ikut berpindah: itu kontrol terpisah di rail.
  const PENJELASAN_SKENARIO = {
    A: 'Hanya SonarCloud. Tanpa panggilan LLM, tanpa biaya. Hasilnya terbit dalam format lama (skema 1) yang tidak ditampilkan dashboard ini.',
    B: 'Satu panggilan deteksi untuk seluruh kode, lalu satu panggilan verifikasi per alert SonarCloud.',
    C: 'Satu panggilan deteksi untuk seluruh kode, tanpa verifikasi. SonarCloud tetap berjalan tetapi alertnya tidak dikirim ke model dan tidak ikut di hasil.',
  };

  const renderDrawer = () => {
    const skenario = skenarioTerpilih();
    const llm = modeTerpilih() === 'sast-llm';
    const gabungan = modeModelTerpilih() === 'gabungan';
    $('skenario-hint').textContent = PENJELASAN_SKENARIO[skenario] ?? '';
    $('model-field').hidden = !llm;
    $('biaya-field').hidden = !llm;
    $('rekomendasi-field').hidden = !llm;
    $('konfirmasi-v2-field').hidden = !llm;
    if (!llm && $('f-rekomendasi').checked) $('f-rekomendasi').checked = false;
    if (!llm && $('f-konfirmasi-v2').checked) $('f-konfirmasi-v2').checked = false;

    // Gabungan hanya sah untuk B. Pilihannya disembunyikan di C, dan radionya dikembalikan ke
    // tunggal supaya keadaan form tidak pernah berbeda dari apa yang terlihat.
    $('mode-model-seg').hidden = skenario !== 'B';
    if (skenario !== 'B') {
      const t = document.querySelector('input[name="mode_model"][value="tunggal"]');
      if (t) t.checked = true;
    }
    // Di mode gabungan tidak ada satu vendor yang dipilih, jadi pemilih vendornya tidak berlaku.
    $('f-model').hidden = gabungan;
    $('f-model-label').hidden = gabungan;
    // Hanya berarti kalau rekomendasi memang diminta: pilihan yang tidak mengubah apa pun membuat
    // pengguna menduga ia berpengaruh.
    $('vendor-rekomendasi-field').hidden = !(gabungan && $('f-rekomendasi').checked);
    $('model-hint').textContent = gabungan
      ? 'Ketiga vendor berjalan paralel dan hasilnya disatukan sekali: temuan yang sama dari beberapa model digabung, putusan alert diambil dari suara terbanyak. Mode ini belum dievaluasi di eksperimen TA.'
      : '';

    renderFormBranch();
    renderModels();
    // Keterangan sumber analisis Sonar hanya relevan untuk branch yang memang bisa dijalankan.
    const bisa = state.proyek.branches.filter(branchSesuai).length;
    const semua = state.proyek.branches.filter((b) => b.dispatch).length;
    $('branch-meta').textContent = `${bisa} dari ${semua} bisa dipicu`;
    // Hanya skenario B yang memakai alert Sonar, jadi hanya di situ kecocokan analisisnya berarti.
    $('branch-hint').textContent = skenario === 'B' && branchSesuai(branchJalan()) && branchJalan()?.name !== 'main'
      ? 'Analisis Sonar diambil dari main; kecocokan kode diperiksa lewat hash tree src/ sebelum ada panggilan berbayar.'
      : '';
    perbaruiTombolJalankan();
  };

  // Jalur v2 memanggil API berbayar per alert. Workflow menolak run tanpa input konfirmasi_v2,
  // dan dashboard tidak boleh mengisinya diam-diam: centang di drawer inilah persetujuan itu.
  const konfirmasiV2 = () => jalurTerpilih() !== 'v2' || Boolean($('f-konfirmasi-v2')?.checked);

  const alasanTidakBisa = () => {
    const st = state.statusProject.get(state.proyek) ?? {};
    if (!state.demo && !state.token) return 'Masukkan token GitHub dulu.';
    if (st.akses === false) return 'Token tidak punya akses ke repo ini.';
    if (st.workflow === false) return `Repo ini belum punya ${state.proyek.workflow}. Pasang workflow framework dulu.`;
    const b = branchJalan();
    if (!b || !b.dispatch) return b?.catatan || 'Branch ini tidak bisa dipicu dari dashboard.';
    if (!branchSesuai(b)) return `Workflow di branch ${b.name} ${b.catatan_v2 ?? 'belum memuat jalur v2'}. Pilih branch lain atau jalankan mode SAST saja.`;
    return null;
  };

  // Dipisahkan dari alasanTidakBisa(): ini keadaan form untuk satu run, bukan halangan tingkat
  // branch atau token. Tanpa pemisahan, panel kosong ikut menjelaskan "belum ada run" dengan
  // centang yang bahkan tidak terlihat saat drawer tertutup.
  const alasanFormBelumSiap = () => (konfirmasiV2() ? null : 'Centang persetujuan biaya dulu: jalur v2 memanggil API berbayar.');

  const perbaruiTombolJalankan = (pesan, jenis) => {
    const alasan = alasanTidakBisa() ?? alasanFormBelumSiap();
    const btn = $('run-btn');
    btn.disabled = state.sibuk || Boolean(alasan);
    if (state.sibuk) btn.dataset.busy = ''; else btn.removeAttribute('data-busy');
    $('run-btn-label').textContent = state.sibuk ? 'Sedang berjalan…' : 'Jalankan analisis';
    $('f-branch').disabled = state.sibuk;
    const hint = $('run-hint');
    hint.dataset.kind = jenis || '';
    if (pesan instanceof Node) isi(hint, pesan);
    else hint.textContent = pesan ?? alasan ?? (state.demo ? 'Mode demo: run disimulasikan, GitHub tidak dipanggil.' : `Memicu ${state.proyek.workflow} lewat GitHub API. API key model dan Sonar tetap di GitHub Secrets.`);
  };

  // ---------- Index dan run ----------
  const entriBranch = () => (state.branch ? (state.index?.runs ?? []) : [])
    .filter((e) => e.branch === state.branch.name)
    .sort(urutEntri);

  const muatIndex = async (pilihId) => {
    ingatPilihan();
    state.hasil = null;
    state.sebelumnya = null;
    state.entri = null;
    state.jobs = null;
    state.rekaman = null;
    renderMemuat();
    try {
      state.index = await sumber().index(state.proyek);
    } catch (err) {
      state.index = { runs: [] };
      renderBiaya();
      renderKosong(pesanGalat(err), true);
      return;
    }
    // Perkiraan biaya ikut jumlah alert run terakhir branch ini, jadi dihitung ulang tiap index baru.
    renderBiaya();
    const daftar = entriBranch();
    if (!daftar.length) { renderKosong(); return; }
    await muatRun(daftar.find((e) => e.id === pilihId) ?? daftar[0]);
  };

  const muatRun = async (entri) => {
    if (drawerAktif && drawerAktif.panel === $('drawer-temuan')) tutupDrawerAktif();
    state.entri = entri;
    state.terbuka = null;
    state.simpulTerbuka = null;
    renderMemuat();
    try {
      state.hasil = await sumber().hasil(state.proyek, entri);
    } catch (err) {
      state.hasil = null;
      renderKosong(pesanGalat(err), true);
      return;
    }
    const daftar = entriBranch();
    const lebihLama = daftar[daftar.indexOf(entri) + 1];
    state.sebelumnya = null;
    if (lebihLama) {
      try { state.sebelumnya = await sumber().hasil(state.proyek, lebihLama); } catch { state.sebelumnya = null; }
    }
    const hasilJob = await sumber().jobs(state.proyek, entri.id);
    state.jobs = hasilJob?.jobs ?? null;
    state.rekaman = hasilJob?.rekaman ?? null;
    state.keputusan = bacaJsonLokal(kunciKeputusanV2(), {});
    renderSemua();
  };

  // ---------- Render ----------
  // Membersihkan seluruh blok yang terikat satu run. Tanpa ini, pindah branch atau gagal memuat
  // menyisakan header, tabel alert, dan tab Eksperimen milik run sebelumnya.
  const bersihkanBlokRun = () => {
    $('summary').hidden = true;
    $('alerts-box').hidden = true;
    $('catatan-alat').hidden = true;
    $('railnav-box').hidden = true;
    isi($('panel-eksperimen'));
    isi($('alerts-ringkas'));
    isi($('alerts-body'));
    isi($('ringkas-temuan'));
    isi($('ringkas-alert'));
    isi($('filters'));
    isi($('title-block'));
    isi($('run-status'));
    $('run-status').hidden = true;
    $('run-lama').hidden = true;
    $('label-gabungan').hidden = true;
    $('label-contoh').hidden = true;
  };

  // Branch contoh mode demo berisi run yang DISUSUN, bukan run yang pernah berjalan. Penandanya
  // datang dari projects.json dan bukan dari berkas hasil: berkas hasil mengikuti skema 2 yang
  // tidak punya tempat untuk catatan semacam ini, dan menambahkannya ke sana akan membuat berkas
  // contoh berbeda bentuk dari berkas sungguhan.
  const renderLabelContoh = () => {
    const n = $('label-contoh');
    const teks = state.branch?.contoh;
    n.hidden = !teks;
    if (teks) n.textContent = teks;
    else isi(n);
  };

  // Mode gabungan tidak pernah dijalankan di eksperimen TA, jadi angka apa pun yang keluar darinya
  // tidak punya pembanding dan tidak boleh dibaca setara dengan angka tiga kondisi yang diukur.
  // Penandanya permanen dan tidak bisa ditutup: ia batas bukti, bukan pemberitahuan sekali lihat.
  const renderLabelGabungan = () => {
    const n = $('label-gabungan');
    const gabungan = gabunganRun(state.hasil?.run);
    n.hidden = !gabungan;
    if (gabungan) n.textContent = 'Mode gabungan belum dievaluasi di eksperimen TA.';
    else isi(n);
  };

  const renderMemuat = () => {
    bersihkanBlokRun();
    $('pipeline-box').hidden = false;
    isi($('findings-body'), el('div', { class: 'skeleton', 'aria-label': 'Memuat hasil' }, el('i'), el('i'), el('i'), el('i')));
    renderPipeline();
  };

  // Kartu "apa yang dapat dilakukan selanjutnya". Hanya tindakan yang memang bisa dilakukan dari
  // keadaan sekarang; kartu yang tidak berlaku tidak dibuat, bukan dibuat lalu dimatikan.
  const kartuLangkah = (nomor, tag, judul, teks, aksi) => el('button', {
    class: 'langkah-kartu', type: 'button', onclick: aksi.onclick,
  },
  el('span', { class: 'langkah-nomor data', text: nomor }),
  el('span', { class: 'chip chip-cwe', text: tag }),
  el('b', { class: 'langkah-judul', text: judul }),
  el('span', { class: 'langkah-teks', text: teks }),
  el('span', { class: 'langkah-aksi' }, el('span', { text: aksi.label }), ikon(IKON.panah)));

  const langkahSelanjutnya = () => {
    const kartu = [];
    const lain = (state.proyek?.branches ?? []).filter((b) => b !== state.branch
      && (state.index?.runs ?? []).some((e) => e.branch === b.name));
    if (lain.length) {
      kartu.push(kartuLangkah('01', 'Riwayat', 'Pilih branch yang punya run',
        `${lain.length} branch lain sudah punya hasil terbit: ${lain.map((b) => b.name).join(', ')}.`,
        { label: 'Buka pilihan branch', onclick: () => { bukaRailBilaTerlipat(); $('f-branch-lihat').focus(); } }));
    }
    if (!alasanTidakBisa()) {
      kartu.push(kartuLangkah(String(kartu.length + 1).padStart(2, '0'), 'Pipeline', 'Jalankan analisis',
        'Memicu devsecops.yml di branch tujuan lewat GitHub API, lalu memantau tiap job sampai hasilnya terbit.',
        { label: 'Buka panel jalankan', onclick: () => bukaDrawer() }));
    }
    if (!state.demo) {
      kartu.push(kartuLangkah(String(kartu.length + 1).padStart(2, '0'), 'Demo', 'Buka mode demo',
        'Data nyata eksperimen 19 Okt 2026 dari branch eksperimen/seeded, tanpa token dan tanpa memanggil GitHub.',
        { label: 'Masuk mode demo', onclick: () => masukDemo() }));
    }
    if (!kartu.length) return null;
    return el('section', { class: 'langkah-blok' },
      el('div', { class: 'kartu-kepala' }, el('h3', { text: 'Apa yang dapat dilakukan selanjutnya' })),
      el('div', { class: 'langkah-baris' }, kartu));
  };

  // Rail terlipat di layar sempit; memfokuskan kontrol di dalamnya harus membukanya dulu.
  const bukaRailBilaTerlipat = () => {
    if (getComputedStyle($('rail-isi')).display === 'none') terapkanRail(true);
  };

  const renderKosong = (pesanGalatTeks, galat) => {
    bersihkanBlokRun();
    $('pipeline-box').hidden = false;
    $('run-title').textContent = '';
    isi($('crumb'));
    isi($('history'), el('p', { class: 'note', text: 'Belum ada run di branch ini.' }));
    renderPipeline();
    $('summary').hidden = true;
    isi($('filters'));
    let judul;
    let teks;
    let aksi = null;
    if (galat) {
      judul = 'Hasil tidak bisa dimuat';
      teks = pesanGalatTeks;
      aksi = el('button', { class: 'btn btn-sm', type: 'button', text: 'Coba lagi', onclick: () => muatIndex() });
    } else if (!state.branch.dispatch) {
      judul = 'Belum ada hasil untuk arsip ini di dashboard';
      teks = state.demo
        ? 'Arsip ini belum punya run.'
        : 'Hasil eksperimen branch ini tersimpan di folder hasil-eksperimen/ pada branch itu, bukan di security-results. Buka mode demo untuk melihatnya di dashboard.';
      if (!state.demo) aksi = el('button', { class: 'btn btn-sm btn-line', type: 'button', text: 'Buka mode demo', onclick: () => masukDemo() });
    } else {
      // Judul harus sesuai sebabnya. "Belum ada run untuk branch ini" dengan badan "repo ini belum
      // punya devsecops.yml" saling bertentangan: yang pertama soal riwayat, yang kedua soal izin
      // menjalankan. Dan kalau memang tidak bisa dijalankan, panel pipeline yang semua nodenya
      // "menunggu" hanya menjanjikan sesuatu yang tidak akan terjadi.
      const terhalang = alasanTidakBisa();
      if (terhalang) {
        judul = 'Belum bisa menjalankan analisis di sini';
        teks = terhalang;
        $('pipeline-box').hidden = true;
      } else {
        judul = 'Belum ada run untuk branch ini';
        const jobTerakhir = nodeJalur(jalurTerpilih()).slice(-1)[0].nama;
        teks = `Tekan Jalankan analisis untuk membuat run pertama. Hasilnya muncul di sini setelah job ${jobTerakhir} selesai.`;
      }
    }
    // Hero: ikon, label kecil, judul, penjelasan, lalu aksi. Tanpa grafik dekoratif yang tidak
    // mewakili data apa pun.
    const jenis = galat ? 'galat' : 'kosong';
    isi($('findings-body'), el('div', { class: 'state' },
      el('div', { class: `state-hero state-${jenis}` },
        el('span', { class: 'state-ikon', 'aria-hidden': 'true' }, ikon(galat ? IKON.seru : IKON.perisai)),
        el('p', { class: 'state-eyebrow', text: galat ? 'Gagal membaca hasil' : 'Konteks alur kerja DevSecOps' }),
        el('h3', { text: judul }),
        el('p', { class: 'state-teks', text: teks }),
        aksi ? el('div', { class: 'state-aksi' }, aksi) : null),
      langkahSelanjutnya()));
  };

  // Skema 2 menaruh status job di run.pipeline; null berarti run dijalankan dari CLI, bukan lewat pipeline.
  // Pemetaan status job dari rekaman `run.pipeline` di berkas hasil. Dipisahkan sebagai fungsi
  // murni supaya bisa diuji langsung tanpa browser; tests/pipeline.test.js mengambilnya apa adanya
  // dari berkas ini.
  //
  // Tidak ada nilai bawaan "selesai" di sini, dan itu disengaja. Dua keadaan sama-sama berarti
  // TIDAK ADA DATA: node yang tidak punya kunci hasil sama sekali (rencana, terbit-v2), dan node
  // yang kuncinya tidak tercatat di rekaman. Sebelumnya yang pertama dipetakan ke "selesai", jadi
  // job yang belum tentu pernah berjalan tampil bercentang hijau — klaim yang tidak punya dasar
  // apa pun di data. Keduanya kini "tidak diketahui".
  //
  // Bentuk `run.pipeline` sengaja TIDAK ditebak lebih jauh dari ini: belum ada satu pun penulis
  // yang mengisinya di jalur v2, jadi menambahkan aturan untuk kunci yang belum pernah ada berarti
  // mengarang.
  const STATUS_PIPELINE = { success: 'done', skipped: 'skip', failure: 'fail', cancelled: 'fail' };
  const statusDariPipeline = (pipeline, node) => Object.fromEntries(node.map((n) => {
    const nilai = n.hasil ? (pipeline ?? {})[n.hasil] : undefined;
    return [n.key, { s: STATUS_PIPELINE[nilai] ?? 'tak-tahu', durasi: null }];
  }));

  const statusNodeDariHasil = () => {
    const pipeline = state.hasil?.run?.pipeline;
    if (!pipeline) return null;
    return statusDariPipeline(pipeline, nodeJalur(jalurAktif()));
  };

  // ---------- Graf pipeline ----------
  // Satu-satunya tempat bentuk pipeline hidup di dashboard: node, job GitHub yang mewakilinya,
  // kunci status di run.pipeline, dan ketergantungannya. `id` adalah id job di devsecops.yml, dan
  // tests/pipeline.test.js membandingkan `perlu` di bawah dengan `needs` di berkas itu, supaya graf
  // ini tidak pernah diam-diam berbeda dari pipeline yang sebenarnya berjalan.
  const PIPELINE = [
    { key: 'rencana', id: 'rencana', job: 'Tentukan mode analisis', nama: 'Mode analisis', hasil: null, perlu: [], jalur: 'kedua' },
    { key: 'build', id: 'build-test', job: 'Build dan uji API', nama: 'Build dan uji', hasil: 'build_test', perlu: [], jalur: 'kedua' },
    { key: 'sonar', id: 'sonarcloud', job: 'Analisis SonarCloud', nama: 'SonarCloud SAST', hasil: 'sonarcloud', perlu: ['rencana'], jalur: 'kedua' },
    { key: 'analisis', id: 'analisis', job: 'Analisis temuan (Sonar dan Gemini)', nama: 'Analisis LLM v1', hasil: 'analisis', perlu: ['rencana', 'sonar'], jalur: 'v1' },
    { key: 'analisis-v2', id: 'analisis-v2', job: 'Analisis LLM v2 (deteksi dan verifikasi)', nama: 'Deteksi dan verifikasi', hasil: 'analisis', perlu: ['rencana', 'sonar'], jalur: 'v2' },
    // Namanya dibedakan dari node v1 di bawah: graf menggambar SELURUH pipeline dan meredupkan
    // jalur yang tidak dipakai, jadi dua node bernama sama akan tampak bersamaan dan tidak bisa
    // dibedakan mana yang berjalan.
    { key: 'terbit-v2', id: 'terbit-v2', job: 'Gabung dan terbitkan hasil v2', nama: 'Satukan dan terbitkan', hasil: null, perlu: ['rencana', 'sonar', 'analisis-v2'], jalur: 'v2' },
    { key: 'hasil', id: 'hasil', job: 'Gabung dan terbitkan hasil', nama: 'Gabung dan terbitkan', hasil: null, perlu: ['rencana', 'build', 'sonar', 'analisis'], jalur: 'v1' },
  ];

  // Node yang berjalan untuk jalur tertentu; sisanya tetap digambar tetapi diredupkan dan dicoret,
  // karena jalur yang tidak dipakai adalah bagian dari cerita pipeline, bukan sesuatu yang hilang.
  const nodeJalur = (jalur) => PIPELINE.filter((n) => n.jalur === 'kedua' || n.jalur === jalur);
  const simpulAktif = (n, jalur) => n.jalur === 'kedua' || n.jalur === jalur;

  // Kolom = kedalaman topologis. Dihitung dari `perlu`, bukan ditulis tangan, supaya menambah
  // ketergantungan di PIPELINE langsung memindahkan nodenya.
  // Kedalaman simpul: jalur terpanjang dari simpul tanpa ketergantungan. Dipakai bersama oleh tata
  // letak kolom dan penggambar garis, supaya keduanya tidak bisa berbeda pendapat soal simpul mana
  // ada di kolom mana.
  const DALAM = (() => {
    const d = new Map();
    const hitung = (n) => {
      if (d.has(n.key)) return d.get(n.key);
      const v = n.perlu.length ? 1 + Math.max(...n.perlu.map((k) => hitung(PIPELINE.find((x) => x.key === k)))) : 0;
      d.set(n.key, v);
      return v;
    };
    PIPELINE.forEach(hitung);
    return d;
  })();
  const dalamSimpul = (key) => DALAM.get(key) ?? 0;

  const kolomPipeline = () => {
    const maks = Math.max(...DALAM.values());
    return Array.from({ length: maks + 1 }, (_, i) => PIPELINE.filter((n) => dalamSimpul(n.key) === i));
  };

  const TEKS_SIMPUL = { wait: 'menunggu', run: 'berjalan', done: 'selesai', fail: 'gagal', skip: 'dilewati', 'fail-diharapkan': 'gagal sesuai ekspektasi', absen: 'tidak ada di run ini', 'tak-tahu': 'status tidak diketahui', 'luar-jalur': 'tidak dipakai' };

  // Ketergantungan yang perlu DIGAMBAR, bukan yang tercatat. `perlu` menyalin `needs` di workflow
  // apa adanya, dan `needs` memuat banyak ketergantungan yang sudah tersirat: `terbit-v2` menunggu
  // rencana, sonar, dan analisis-v2, padahal analisis-v2 sendiri sudah menunggu rencana dan sonar.
  // Menggambar ketiganya berarti menarik dua garis sepanjang tiga kolom yang menembus kartu di
  // antaranya, tanpa menambah satu pun keterangan baru.
  //
  // Yang dihapus hanyalah garisnya. Data `perlu` tidak disentuh, jadi tests/pipeline.test.js tetap
  // membandingkannya utuh dengan `needs` di workflow.
  const tepiLangsung = (n) => {
    const simpul = new Map(PIPELINE.map((x) => [x.key, x]));
    // Apakah `dari` sudah bisa dicapai dari `lewat` tanpa melalui garis langsung ini?
    const terjangkau = (awal, sasaran) => {
      const antre = [...(simpul.get(awal)?.perlu ?? [])];
      const sudah = new Set();
      while (antre.length) {
        const k = antre.shift();
        if (k === sasaran) return true;
        if (sudah.has(k)) continue;
        sudah.add(k);
        antre.push(...(simpul.get(k)?.perlu ?? []));
      }
      return false;
    };
    return n.perlu.filter((k) => !n.perlu.some((lain) => lain !== k && terjangkau(lain, k)));
  };

  // Garis antar node digambar sebagai SVG di belakang kartunya, setelah tata letak selesai, supaya
  // posisinya mengikuti pembungkusan dan lebar layar apa pun.
  const gambarGarisPipeline = () => {
    const kotak = $('alur');
    const svg = kotak?.querySelector('.alur-garis');
    if (!svg) return;
    const induk = kotak.getBoundingClientRect();
    const titik = new Map([...kotak.querySelectorAll('.simpul')].map((n) => {
      const r = n.getBoundingClientRect();
      return [n.dataset.key, { kiri: r.left - induk.left, kanan: r.right - induk.left, atas: r.top - induk.top, bawah: r.bottom - induk.top, tengahY: r.top - induk.top + r.height / 2, tengahX: r.left - induk.left + r.width / 2 }];
    }));
    svg.setAttribute('viewBox', `0 0 ${Math.max(induk.width, 1)} ${Math.max(induk.height, 1)}`);
    svg.setAttribute('width', String(Math.max(induk.width, 1)));
    svg.setAttribute('height', String(Math.max(induk.height, 1)));
    const tegak = kotak.dataset.arah === 'tegak';
    // Tepi bawah kartu terendah. Jalur garis lompat berada tepat di bawahnya, di dalam padding
    // yang disediakan .alur, jadi ia tidak pernah terpotong wadahnya.
    const bawahTerjauh = Math.max(0, ...[...titik.values()].map((t) => t.bawah));
    const anak = [];
    for (const n of PIPELINE) {
      const ke = titik.get(n.key);
      if (!ke) continue;
      for (const kKey of tepiLangsung(n)) {
        const dari = titik.get(kKey);
        if (!dari) continue;
        const p = document.createElementNS(NS, 'path');
        // Garis yang melompati kolom tidak bisa ditarik lurus: di antaranya ada kartu, dan garis
        // yang menembus kartu membuat graf terbaca sebagai kusut, bukan sebagai urutan. Garis
        // seperti itu diturunkan ke jalur di bawah kartu, menyusur, lalu naik ke sasarannya.
        const melompat = !tegak && (dalamSimpul(n.key) - dalamSimpul(kKey)) > 1;
        const jalur = bawahTerjauh + 9;
        const d = tegak
          ? `M ${dari.tengahX} ${dari.bawah} C ${dari.tengahX} ${dari.bawah + 14}, ${ke.tengahX} ${ke.atas - 14}, ${ke.tengahX} ${ke.atas}`
          : (melompat
            ? `M ${dari.kanan} ${dari.tengahY} C ${dari.kanan + 14} ${dari.tengahY}, ${dari.kanan + 14} ${jalur}, ${dari.kanan + 28} ${jalur}`
              + ` L ${ke.kiri - 28} ${jalur}`
              + ` C ${ke.kiri - 14} ${jalur}, ${ke.kiri - 14} ${ke.tengahY}, ${ke.kiri} ${ke.tengahY}`
            : `M ${dari.kanan} ${dari.tengahY} C ${dari.kanan + 18} ${dari.tengahY}, ${ke.kiri - 18} ${ke.tengahY}, ${ke.kiri} ${ke.tengahY}`);
        p.setAttribute('d', d);
        p.setAttribute('class', `alur-tepi${simpulAktif(n, jalurAktif()) && simpulAktif(PIPELINE.find((x) => x.key === kKey), jalurAktif()) ? '' : ' mati'}`);
        anak.push(p);
      }
    }
    svg.replaceChildren(...anak);
  };

  // ---------- Run yang sedang dipantau ----------
  // Satu-satunya tempat yang membentuk objek `live`. Sebelumnya setiap pemanggil menyusunnya
  // sendiri, dan field yang terlewat diam-diam jatuh ke data run LAMA lewat rantai cadangan di
  // renderPipeline. Akibatnya dua hal yang sama-sama sulit dilihat: graf memakai skenario run lama,
  // sehingga node berbunyi "tidak dipakai di skenario A" untuk run yang bukan A; dan tautan
  // "Lihat log" memakai id run lama digabung id job run baru, menghasilkan 404.
  //
  // Dengan satu pembentuk, field tidak bisa terlewat lagi: yang tidak diisi pemanggil menjadi null
  // secara eksplisit, bukan mewarisi nilai run lain.
  const buatLive = ({
    mode, jalur, skenario, jobs,
    id = null, nomor = null, url = null, model = null,
    status = 'menunggu', demo = false,
  }) => ({ id, nomor, url, mode, jalur, skenario, model, jobs, status, demo });

  // Teks pita status. Dipisahkan sebagai fungsi murni supaya bisa diuji tanpa browser.
  const teksPita = (live, detikBerjalan) => {
    if (!live) return '';
    const nama = Number.isFinite(live.nomor) ? `Run #${live.nomor}` : 'Run baru';
    if (live.status === 'selesai') {
      return live.demo
        ? `${nama} selesai. Mode demo tidak membuat hasil baru.`
        : `${nama} selesai, hasil sudah dimuat`;
    }
    const keadaan = {
      menunggu: 'menunggu GitHub membuat run',
      berjalan: 'berjalan',
      'menunggu-hasil': 'selesai, menunggu hasil terbit',
    }[live.status] ?? live.status;
    // Skenario A tidak memanggil LLM sama sekali. Objek live tetap membawa model karena jalur v1
    // mengirimkannya sebagai input workflow untuk validasi di job rencana, tetapi menyebut nama
    // model di pita terbaca seolah model itu benar-benar dipanggil. Kosakatanya disamakan dengan
    // kepala run hasil skenario A, yang sudah menulis "tanpa LLM".
    return [
      nama,
      live.skenario ? `skenario ${live.skenario}` : null,
      live.skenario === 'A' ? 'tanpa LLM' : live.model,
      keadaan,
      durasi(detikBerjalan),
    ].filter(Boolean).join(' · ');
  };

  let pantauMulai = null;
  let pantauTik = null;

  // Pita status dan awalan "Hasil terakhir". Keduanya bergantung pada satu hal yang sama, yaitu ada
  // atau tidaknya run yang sedang dipantau, jadi digambar satu fungsi.
  const renderPantau = () => {
    const pita = $('pita-run');
    const live = state.live;
    // Awalan "Hasil terakhir" hidup lebih lama daripada pitanya. Saat run gagal, pemantauan
    // berhenti tetapi yang tampil di bawah tetap hasil run SEBELUMNYA, jadi awalannya harus tinggal.
    $('hasil-terakhir').hidden = !(live || state.awalanHasilTerakhir);
    if (!live) {
      pita.hidden = true;
      isi(pita);
      if (pantauTik) { clearInterval(pantauTik); pantauTik = null; }
      return;
    }
    const detik = pantauMulai ? (Date.now() - pantauMulai) / 1000 : 0;
    pita.hidden = false;
    isi(pita,
      el('span', { text: teksPita(live, detik) }),
      live.url ? el('span', { text: ' ' }) : null,
      live.url ? linkRun(live.url, 'Buka di GitHub') : null);
    // Durasi berjalan harus benar-benar berjalan. Tanpa denyut sendiri ia hanya berubah tiap kali
    // graf digambar ulang, yaitu sekali per polling, dan angkanya tampak macet.
    if (!pantauTik && live.status !== 'selesai') pantauTik = setInterval(renderPantau, 1000);
    if (live.status === 'selesai' && pantauTik) { clearInterval(pantauTik); pantauTik = null; }
  };

  // Dipanggil di tiap tahap pemantauan: objek live disimpan, graf digambar, pita diperbarui.
  const pantauLive = (live) => {
    state.live = live;
    renderPipeline(live);
    renderPantau();
  };

  // awalan: true berarti yang tampil di bawah masih hasil run lama, jadi penandanya dipertahankan.
  const selesaiPantau = ({ awalan = true } = {}) => {
    state.live = null;
    state.awalanHasilTerakhir = awalan;
    if (pantauTik) { clearInterval(pantauTik); pantauTik = null; }
    pantauMulai = null;
    renderPantau();
  };

  let pantauUkuranAlur = null;

  const renderPipeline = (live) => {
    const jalur = jalurAktif(live);
    const skenarioGraf = skenarioAktif(live);
    const mode = live?.mode ?? state.hasil?.run?.mode ?? modeTerpilih();
    const status = live?.jobs ?? state.jobs ?? statusNodeDariHasil() ?? {};
    // Rekaman bukan pemantauan: statusnya diambil sekali lalu dibekukan, dan itu harus terbaca.
    const rekaman = !live && state.rekaman ? state.rekaman : null;
    const lencanaRekaman = $('pipeline-rekaman');
    lencanaRekaman.hidden = !rekaman;
    if (rekaman) lencanaRekaman.textContent = `Rekaman run CI #${rekaman.nomor}, bukan run langsung`;
    // Skema 2 tidak punya run.gemini; kegagalan LLM terbaca dari status panggilan.
    const llmGagal = !live && (state.hasil?.run?.status_panggilan?.error ?? 0) > 0;
    // Selama dipantau, judulnya menyebut run yang BERJALAN, bukan run yang sedang dibaca di bawah.
    $('pipeline-title').textContent = live
      ? `${Number.isFinite(live.nomor) ? `Run #${live.nomor}` : 'Run baru'}${live.status === 'selesai' ? '' : ' · berjalan'}`
      : (state.hasil ? `Alur eksekusi run #${state.hasil.run.nomor}` : 'Alur eksekusi pipeline');
    const total = Object.values(status).reduce((s, j) => s + (Number.isFinite(j?.durasi) ? j.durasi : 0), 0);
    $('pipeline-total').textContent = total ? `total ${durasi(total)}` : '';

    // Saat run baru dipantau, panel alur harus terlihat meski run yang sedang dibaca berasal dari
    // CLI dan panelnya tadi disembunyikan.
    if (live) $('pipeline-box').hidden = false;
    const kotak = $('alur');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'alur-garis');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');

    // Node yang tidak dipakai run ini. Sebabnya disebut apa adanya, bukan satu kalimat untuk semua:
    // di skenario A job v2 memang tidak berlaku, sedangkan di jalur v2 job v1-lah yang digantikan.
    // Sebelumnya semuanya berbunyi "digantikan jalur v2", sehingga job v2 yang tidak dipakai pun
    // dikatakan digantikan oleh dirinya sendiri.
    const teksLuarJalur = (n) => {
      if (skenarioGraf === 'A') return 'tidak dipakai di skenario A';
      if (n.jalur === 'v1') return 'digantikan jalur v2';
      return 'tidak dipakai di jalur v1';
    };

    const kartu = (n) => {
      const aktif = simpulAktif(n, jalur);
      let st = status[n.key] ?? { s: 'wait', durasi: null };
      // Jobnya benar-benar ada di jawaban GitHub untuk run ini.
      const adaJob = (st.per ?? []).length > 0;
      // Node di luar jalur hanya ditandai begitu kalau memang TIDAK ada job yang cocok dengannya.
      // Kalau jobnya jelas-jelas berjalan, statusnya ditampilkan apa adanya: graf tidak boleh
      // menyangkal job yang berjalan dan sukses di GitHub, berapa pun yakinnya aturan jalur.
      // Penjagaan ini yang membuat cacat jalur serupa muncul sebagai node tak terduga, bukan
      // sebagai klaim "dilewati" yang terdengar meyakinkan.
      if (!aktif && !adaJob) st = { s: 'luar-jalur', durasi: null };
      const dipakai = aktif || adaJob;
      let teks = TEKS_SIMPUL[st.s];
      if (aktif && n.key === 'analisis' && llmGagal && st.s === 'done') { st = { ...st, s: 'fail' }; teks = 'Analisis LLM gagal'; }
      const diharapkan = st.s === 'fail' ? ekspektasiGagal(n.key) : null;
      if (diharapkan) { st = { ...st, s: 'fail-diharapkan' }; teks = diharapkan.sebab; }
      // Label job analisis mengikuti SKENARIO runnya. Sebelumnya ia mengikuti `mode`, yang tidak ada
      // di skema 2 sehingga jatuh ke pilihan yang sedang aktif di drawer: label node run tersimpan
      // berubah-ubah mengikuti apa yang kebetulan dipilih pengguna.
      const nama = dipakai && n.key === 'analisis' && (skenarioGraf === 'A' || mode === 'sast')
        ? 'Ambil temuan Sonar' : n.nama;
      const langkah = status[n.key]?.langkah ?? null;
      const bisaDibuka = dipakai && Array.isArray(langkah) && langkah.length > 0;
      // Node yang belum berjalan hanya lingkaran kosong. Tanda centang di sana terbaca sebagai
      // "sudah selesai" padahal statusnya menunggu.
      const TANDA = { fail: IKON.silang, 'fail-diharapkan': IKON.seru, skip: IKON.minus, done: IKON.cek, run: IKON.titik, absen: IKON.minus, 'luar-jalur': IKON.minus };
      const tanda = TANDA[st.s] ?? null;
      const isiSimpul = [
        el('span', { class: 'simpul-mark', 'aria-hidden': 'true' }, tanda ? ikon(tanda) : null),
        el('span', { class: 'simpul-nama', text: nama }),
        el('span', { class: 'simpul-durasi data', text: durasi(st.durasi) }),
        el('span', { class: 'simpul-status', text: dipakai ? teks : teksLuarJalur(n) }),
      ];
      // Dua tindakan berbeda di satu kartu: membuka daftar langkah di halaman ini, dan membuka log
      // job itu di GitHub. Keduanya berdampingan di dalam kartu, bukan kartu yang seluruhnya bisa
      // diklik, karena tautan di dalam tombol bukan markah yang sah dan dua sasaran klik yang
      // bertumpuk membuat orang membuka tab baru padahal hanya ingin melihat langkahnya.
      const nomorRun = live?.nomor ?? state.hasil?.run?.nomor ?? null;
      const idRun = idRunGraf(live);
      const urlLog = dipakai ? urlJobGh(state.proyek, idRun, status[n.key]?.id) : null;
      const aksi = [
        bisaDibuka ? el('button', {
          class: 'simpul-tombol', type: 'button',
          'aria-expanded': state.simpulTerbuka === n.key ? 'true' : 'false',
          'aria-controls': 'alur-langkah',
          onclick: () => { state.simpulTerbuka = state.simpulTerbuka === n.key ? null : n.key; renderPipeline(live); },
        }, el('small', { text: state.simpulTerbuka === n.key ? 'Tutup langkah' : 'Lihat langkah' }), ikon(IKON.panah)) : null,
        urlLog ? el('a', {
          class: 'simpul-tautan', href: urlLog, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': `Lihat log job ${nama}${nomorRun ? ` run #${nomorRun}` : ''} di GitHub, tab baru`,
        }, el('small', { text: 'Lihat log' }), ikon(IKON.luar)) : null,
      ].filter(Boolean);
      const sifat = { class: `simpul${dipakai ? '' : ' mati'}${bisaDibuka ? ' bisa-dibuka' : ''}`, dataset: { s: st.s, key: n.key } };
      return el('div', sifat, isiSimpul, aksi.length ? el('span', { class: 'simpul-aksi' }, aksi) : null);
    };

    isi(kotak, svg, ...kolomPipeline().map((kol) => el('div', { class: 'alur-kolom' }, kol.map(kartu))));

    // Versi teks: graf adalah gambar, dan pembaca layar membaca daftar ini sebagai gantinya.
    isi($('alur-teks'), el('ol', {}, nodeJalur(jalur).map((n) => {
      const st = status[n.key] ?? { s: 'wait', durasi: null };
      const perlu = n.perlu.filter((k) => simpulAktif(PIPELINE.find((x) => x.key === k), jalur)).map((k) => PIPELINE.find((x) => x.key === k).nama);
      return el('li', { text: `${n.nama}: ${TEKS_SIMPUL[st.s]}${Number.isFinite(st.durasi) ? `, ${durasi(st.durasi)}` : ''}${perlu.length ? `, menunggu ${perlu.join(' dan ')}` : ''}` });
    })));

    const terbuka = state.simpulTerbuka && (status[state.simpulTerbuka]?.langkah ?? null);
    const panel = $('alur-langkah');
    if (!terbuka) { isi(panel); panel.hidden = true; } else {
      panel.hidden = false;
      const n = PIPELINE.find((x) => x.key === state.simpulTerbuka);
      // Node bermatriks mewakili beberapa job sekaligus. Ringkasan per vendor ditaruh di atas
      // daftar langkah, karena yang pertama ingin diketahui saat satu node gagal adalah vendor
      // mana yang gagal — bukan langkah ke berapa.
      const per = status[state.simpulTerbuka]?.per ?? [];
      const idRunPanel = idRunGraf(live);
      const ringkasPerVendor = per.length > 1
        ? el('ul', { class: 'per-vendor' }, per.map((v) => {
          const url = urlJobGh(state.proyek, idRunPanel, v.id);
          return el('li', { dataset: { s: v.s } },
            el('span', { class: 'langkah-mark', 'aria-hidden': 'true' }, ikon(v.s === 'fail' ? IKON.silang : (v.s === 'skip' ? IKON.minus : IKON.cek))),
            el('span', { class: 'pv-nama data', text: v.varian ?? '—' }),
            el('span', { class: 'langkah-status', text: TEKS_SIMPUL[v.s] ?? v.s }),
            el('span', { class: 'langkah-durasi data', text: durasi(v.durasi) }),
            url ? el('a', {
              class: 'simpul-tautan', href: url, target: '_blank', rel: 'noopener noreferrer',
              'aria-label': `Lihat log job ${n?.nama ?? ''} ${v.varian ?? ''} di GitHub, tab baru`,
            }, el('small', { text: 'Lihat log' }), ikon(IKON.luar)) : null);
        }))
        : null;
      isi(panel,
        el('p', { class: 'block-h', text: `Langkah job ${n?.nama ?? ''}` }),
        ringkasPerVendor,
        el('ol', { class: 'langkah' }, terbuka.map((l) => el('li', { dataset: { s: l.s } },
          el('span', { class: 'langkah-mark', 'aria-hidden': 'true' }, ikon(l.s === 'fail' ? IKON.silang : (l.s === 'skip' ? IKON.minus : IKON.cek))),
          el('span', { class: 'langkah-nama' },
            l.varian ? el('b', { class: 'langkah-varian data', text: l.varian }) : null,
            el('span', { text: l.nama })),
          el('span', { class: 'langkah-status', text: TEKS_SIMPUL[l.s] ?? l.s }),
          el('span', { class: 'langkah-durasi data', text: durasi(l.durasi) })))));
    }

    kotak.dataset.arah = kotak.clientWidth < 720 ? 'tegak' : 'datar';
    requestAnimationFrame(gambarGarisPipeline);
    if (!pantauUkuranAlur && typeof ResizeObserver === 'function') {
      pantauUkuranAlur = new ResizeObserver(() => {
        const k = $('alur');
        if (!k) return;
        k.dataset.arah = k.clientWidth < 720 ? 'tegak' : 'datar';
        gambarGarisPipeline();
      });
      pantauUkuranAlur.observe(kotak);
    }
  };


  // ---------- Renderer v2 ----------
  // Renderer terpisah, bukan tambalan di atas renderer v1: kosakata v2 berbeda mendasar (alert punya
  // putusan model, temuan tidak punya severity). "uncertain" adalah putusan sah tersendiri, bukan kegagalan,
  // dan tidak dihitung sebagai perlu tindakan.
  const PUTUSAN_V2 = {
    true_positive: { label: 'Dikonfirmasi model', kelas: 'tp' },
    false_positive: { label: 'False positive', kelas: 'fp' },
    uncertain: { label: 'Ragu-ragu', kelas: 'unc' },
    // Hanya muncul di mode gabungan: tiga model memberi putusan sah tetapi tidak ada yang
    // mengumpulkan dua suara. Alertnya DIPERTAHANKAN, bukan dianggap false positive.
    tidak_sepakat: { label: 'Tidak sepakat', kelas: 'unc' },
  };
  const infoPutusan = (p) => PUTUSAN_V2[p] ?? { label: 'Tanpa putusan', kelas: 'none' };

  // Dua alert yang sama-sama tanpa putusan bisa berarti hal yang berlawanan. "Tanpa putusan"
  // berarti verifikasi dijalankan tetapi jawabannya tidak sah — sesuatu yang gagal. Skenario A
  // tidak pernah menjalankan verifikasi sama sekali, jadi alertnya belum dinilai siapa pun, dan itu
  // bukan kegagalan. Berkas hasil menyimpan bedanya di putusan_asal.
  const infoPutusanAlert = (a) => (a?.putusan_asal === 'tanpa-verifikasi'
    ? { label: 'Belum diverifikasi (skenario A)', kelas: 'belum' }
    : infoPutusan(a?.putusan_gabungan ?? a?.putusan));

  // ---------- Bentuk run ----------
  // Run yang diterbitkan sebelum sumbu skenario ada tidak punya run.skenario maupun run.mode_model.
  // Saat keduanya belum ada, satu-satunya bentuk yang pernah dihasilkan pipeline adalah skenario B
  // dengan satu vendor, jadi itulah yang diasumsikan. Asumsinya ditulis di satu tempat ini supaya
  // tidak tersebar menjadi belasan `?? 'B'` yang bisa berbeda-beda.
  const skenarioRun = (r) => r?.skenario ?? 'B';
  const modeModelRun = (r) => r?.mode_model ?? 'tunggal';
  const gabunganRun = (r) => modeModelRun(r) === 'gabungan';
  const vendorDipakai = (r) => (Array.isArray(r?.vendor_dipakai) ? r.vendor_dipakai : []);
  const vendorGagal = (r) => (Array.isArray(r?.vendor_gagal) ? r.vendor_gagal : []);
  const LABEL_SKENARIO = {
    A: { nama: 'SAST saja', ket: 'SonarCloud saja, tanpa panggilan LLM' },
    B: { nama: 'SAST + LLM', ket: 'Tiap alert SonarCloud diverifikasi model' },
    C: { nama: 'LLM saja', ket: 'Deteksi model tanpa SonarCloud' },
  };

  // Nama yang dibaca manusia selalu dari models.json. Id mentah seperti "gemini-3.1-pro-preview"
  // hanya muncul sebagai metadata kecil atau tooltip, tidak pernah sebagai judul.
  const labelVendor = (vendor) => state.models.find((m) => m.jalur === 'v2' && m.vendor === vendor)?.label ?? vendor ?? '—';
  // Id yang sama bisa terdaftar di kedua jalur dengan label berbeda; yang dipakai dashboard
  // selalu entri jalur v2, karena hanya skema 2 yang ditampilkan di sini.
  const labelModelId = (id) => (state.models.find((m) => m.jalur === 'v2' && m.id === id)
    ?? state.models.find((m) => m.id === id))?.label ?? id ?? '—';

  // Asal run hanya boleh dinyatakan kalau memang diketahui. Run lewat GitHub Actions yang status
  // jobnya belum tercatat di berkas hasil pernah dilabeli "dijalankan dari CLI": itu klaim yang
  // salah, dan pembaca kehilangan jejak run mana di Actions yang menghasilkannya.
  const asalRun = (r) => {
    if (r.asal === 'cli') {
      return el('div', { class: 'meta-chip', title: 'Run ini tidak dipicu lewat GitHub Actions, jadi tidak ada status job.' },
        ikon(IKON.asal), el('dt', { text: 'Asal' }), el('dd', {}, 'dijalankan dari CLI'));
    }
    if (r.asal !== 'workflow') return null;
    const p = state.proyek;
    const tautan = tautanGh(urlRunGh(p, r.id), `run #${r.nomor}`, `Buka run #${r.nomor} di GitHub Actions, tab baru`);
    return el('div', { class: 'meta-chip', title: 'Status tiap job hanya bisa dibaca lewat GitHub API, jadi butuh token.' },
      ikon(IKON.asal), el('dt', { text: 'Asal' }), el('dd', {}, 'GitHub Actions ', tautan));
  };

  // Pemisah remah jejak dibuat sebagai elemen sendiri supaya tidak ikut terbaca pembaca layar
  // sebagai bagian nama branch.
  const pemisahCrumb = () => el('span', { class: 'crumb-pisah', 'aria-hidden': 'true' }, '\u203a');

  // Status run yang jujur: satu-satunya yang kita tahu dari berkas hasil adalah apakah ada
  // panggilan yang gagal. Status job pipeline tidak ada di sini, jadi tidak diklaim.
  const renderStatusRun = (r) => {
    const sp = r.status_panggilan ?? null;
    const gagal = (sp?.error ?? 0) > 0 || (sp?.parse_gagal ?? 0) > 0 || (sp?.refusal ?? 0) > 0;
    const n = $('run-status');
    if (!sp) { isi(n); n.hidden = true; return; }
    // Deteksi yang lolos skema tetapi nol temuan. Tanpa lencana ini, "0 temuan" di judul terbaca
    // sebagai hasil analisis, padahal bisa berarti model menjawab kosong. Field ini opsional di
    // skema: hasil lama yang belum memuatnya tidak menampilkan apa pun, bukan menampilkan 0.
    const kosong = sp.deteksi_kosong ?? 0;
    const think = r.thinking_token?.deteksi;
    n.hidden = false;
    isi(n, el('span', { class: `lencana ${gagal ? 'l-crit' : 'l-ok'}` },
      el('i', { 'aria-hidden': 'true' }),
      gagal ? 'Selesai dengan panggilan gagal' : 'Selesai'),
    kosong > 0 ? el('span', {
      class: 'lencana l-high',
      title: Number.isFinite(think)
        ? `Jawaban deteksi lolos skema tetapi tanpa temuan, setelah ${think} token thinking.`
        : 'Jawaban deteksi lolos skema tetapi tanpa temuan.',
    }, el('i', { 'aria-hidden': 'true' }), kosong > 1 ? `Deteksi kosong (${kosong})` : 'Deteksi kosong') : null);
  };

  const renderKepalaV2 = () => {
    const p = state.proyek;
    const r = state.hasil.run;
    const urlRepo = urlRepoGh(p);
    const repoLink = urlRepo
      ? el('a', { href: urlRepo, target: '_blank', rel: 'noopener noreferrer', text: `${p.owner} / ${p.repo}` })
      : el('span', { text: `${p.owner} / ${p.repo}` });
    isi($('crumb'), repoLink, pemisahCrumb(), r.objek_uji.branch ?? state.branch.name, pemisahCrumb(), `Run #${r.nomor}`);
    const sk = skenarioRun(r);
    const gabungan = gabunganRun(r);
    const dipakai = vendorDipakai(r);
    // Skenario C tidak punya alert sama sekali, jadi menyebut "0 alert" di judul membaca seolah
    // Sonar dijalankan dan tidak menemukan apa-apa. Yang benar: alert memang tidak ikut.
    const bagianAlert = sk === 'C' ? 'tanpa alert Sonar' : `${state.hasil.alerts.length} alert`;
    // Skenario A tidak memanggil model, jadi vendornya null dan labelVendor memberi tanda hubung.
    // Tanda hubung di judul terbaca seperti data yang hilang; yang benar adalah memang tidak ada.
    const bagianModel = sk === 'A'
      ? 'tanpa LLM'
      : (gabungan
        ? `${dipakai.length} model${dipakai.length ? ` (${dipakai.join(', ')})` : ''}`
        : labelVendor(r.vendor));
    $('run-title').textContent = `Run #${r.nomor} · ${bagianModel} · ${bagianAlert} · ${state.hasil.findings.length} temuan`;
    renderStatusRun(r);

    const sel = (label, nilai, opsi = {}) => el('div', { class: `meta-chip${opsi.warn ? ' warn' : ''}`, title: opsi.title },
      opsi.ikon ? ikon(opsi.ikon) : null,
      el('dt', { text: label }),
      el('dd', { class: opsi.data ? 'data' : null }, nilai));
    const bedaModel = r.model_menjawab && r.model_menjawab !== r.model_diminta;
    // status_panggilan dan biaya_usd opsional di skema; berkas sah tanpa keduanya tidak boleh merusak render.
    const sp = r.status_panggilan ?? null;
    // SHA pendek yang terbaca, SHA penuh di title chipnya, dan tautan ke halaman commit itu.
    const commit = tautanGh(urlCommitGh(p, r.objek_uji.commit), pendek(r.objek_uji.commit),
      `Buka commit ${pendek(r.objek_uji.commit)} di GitHub, tab baru`);
    // Mode gabungan tidak punya satu model yang menjawab, jadi chipnya menyebut siapa saja yang
    // ikut. Vendor yang gagal tidak disembunyikan: justru itu yang mengubah arti angka kesepakatan.
    const gagal = vendorGagal(r);
    const chipModel = gabungan
      ? sel('Model', `Gabungan ${dipakai.length} model`, {
        ikon: IKON.bolt,
        warn: gagal.length > 0,
        title: `Ikut: ${dipakai.join(', ') || 'tidak ada'}${gagal.length ? `. Gagal: ${gagal.map((g) => `${g.vendor ?? 'tidak dikenal'} (${g.alasan ?? 'tanpa alasan'})`).join('; ')}` : ''}`,
      })
      : sel('Model', sk === 'A' ? 'tanpa LLM' : (r.model_menjawab ? labelModelId(r.model_menjawab) : '—'), {
        ikon: IKON.bolt,
        warn: bedaModel,
        title: sk === 'A'
          ? 'Skenario A hanya menjalankan SonarCloud; tidak ada model yang dipanggil.'
          : (bedaModel ? `${r.model_menjawab}, padahal yang diminta ${r.model_diminta}` : (r.model_menjawab ?? r.model_diminta)),
      });
    const infoSk = LABEL_SKENARIO[sk] ?? { nama: sk, ket: '' };
    isi($('title-block'),
      sel('Skenario', `${sk} · ${infoSk.nama}`, { ikon: IKON.labu, title: infoSk.ket }),
      chipModel,
      sel('Commit', commit, { data: true, ikon: IKON.commit, title: `Objek uji ${r.objek_uji.commit}` }),
      sel('Durasi', durasi(r.durasi_detik), { data: true, ikon: IKON.jam }),
      sel('Biaya', typeof r.biaya_usd === 'number' ? `US$${r.biaya_usd.toFixed(4).replace('.', ',')}` : '—', { data: true, ikon: IKON.biaya }),
      sel('Panggilan', sp ? `${sp.ok}/${sp.total} ok` : '—', { data: true, ikon: IKON.panggilan, warn: Boolean(sp) && sp.ok !== sp.total }),
      // Chip asal selalu ada: untuk run workflow ia membawa tautan ke run itu di GitHub Actions,
      // untuk run CLI ia menerangkan kenapa tidak ada status job sama sekali.
      asalRun(r));
  };

  // Kartu dikelompokkan tiga baris berlabel supaya keparahan, proses, dan sumber tidak tercampur.
  const renderRingkasanV2 = () => {
    const h = state.hasil;
    $('summary').hidden = false; // renderMemuat dan renderKosong menyembunyikannya
    // Sama seperti di halaman Verifikasi: putusan akhir mode gabungan ada di putusan_gabungan,
    // dan "tidak sepakat" tidak boleh ikut terhitung sebagai "tanpa putusan".
    const n = (p) => h.alerts.filter((a) => (a.putusan_gabungan ?? a.putusan) === p).length;
    // Warna severity hanya untuk angka di atas nol: nol merah membuat mata berhenti di tempat
    // yang justru tidak perlu ditindaklanjuti.
    const kartu = (label, nilai, catatan, kelas) => el('div', { class: `cell${kelas && nilai > 0 ? ` ${kelas}` : ''}${nilai === 0 ? ' nol' : ''}` },
      el('p', { class: 'cell-label', text: label }), el('p', { class: 'cell-num', text: String(nilai) }),
      catatan ? el('p', { class: 'cell-note', text: catatan }) : null);
    const grup = (judul, catatanKanan, ...kartuAnak) => el('section', { class: 'kartu-grup' },
      el('div', { class: 'kartu-kepala' }, el('h3', { text: judul }),
        catatanKanan ? el('span', { class: 'kartu-total', text: catatanKanan }) : null),
      el('div', { class: 'kartu-baris' }, kartuAnak.flat()));

    const SEV_DIKENAL = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
    const sev = (daftar) => h.alerts.filter((a) => daftar.includes(String(severityAlert(a)).toUpperCase())).length;
    // Sonar MQR memakai nama severity lain, dan CodeQL memberi angka (misalnya "9.8") alih-alih
    // nama; tanpa kartu ini alert seperti itu hilang dari hitungan.
    const sevLain = h.alerts.filter((a) => !SEV_DIKENAL.includes(String(severityAlert(a)).toUpperCase())).length;
    const ditinjau = (v) => h.findings.filter((t) => state.keputusan[t.fingerprint]?.v === v).length;

    // Kelompok kartu "Perkakas SAST". Hanya muncul kalau run ini memuat lebih dari satu perkakas,
    // jadi data lama tampil persis seperti sebelumnya: satu perkakas tidak perlu dirinci.
    //
    // Kartu tumpang tindih hanya ditampilkan kalau medan kembar_dengan memang ada di datanya. Medan
    // itu diisi penilai, bukan pemindai, sehingga hasil yang belum dinilai tidak memilikinya; kartu
    // berisi 0 di keadaan itu akan terbaca sebagai "tidak ada yang tumpang tindih", padahal yang
    // benar adalah "belum dihitung".
    const grupPerkakas = () => {
      const dipakai = perkakasDipakai(h.alerts);
      if (dipakai.length < 2) return null;
      const adaKembar = h.alerts.some((a) => Array.isArray(a.kembar_dengan));
      const kembar = h.alerts.filter((a) => (a.kembar_dengan ?? []).length > 0).length;
      return grup('Perkakas SAST', `${dipakai.length} perkakas`,
        ...dipakai.map((k) => kartu(namaSast(k), h.alerts.filter((a) => perkakasAlert(a) === k).length,
          'alert dari perkakas ini')),
        adaKembar ? kartu('Tumpang tindih', kembar, 'alert yang berpasangan dengan perkakas lain') : null);
    };

    // Skenario A menjalankan SonarCloud tetapi tidak satu pun model, jadi kelompok "putusan model"
    // akan berisi nol semua dan terbaca seolah model menilai dan tidak menemukan apa-apa.
    if (skenarioRun(h.run) === 'A') {
      isi($('summary'),
        grup('Keparahan alert Sonar', `${h.alerts.length} alert`,
          kartu('Blocker', sev(['BLOCKER']), 'severity apa adanya dari Sonar', 'crit'),
          kartu('Critical', sev(['CRITICAL']), 'severity apa adanya dari Sonar', 'high'),
          kartu('Major', sev(['MAJOR']), 'severity apa adanya dari Sonar'),
          kartu('Minor dan info', sev(['MINOR', 'INFO']), 'severity apa adanya dari Sonar'),
          sevLain ? kartu('Severity lain', sevLain, 'nama severity di luar lima baku Sonar') : null),
        grupPerkakas(),
        el('section', { class: 'kartu-grup' },
          el('div', { class: 'kartu-kepala' }, el('h3', { text: 'Putusan model atas alert' }),
            el('span', { class: 'kartu-total', text: 'tidak ada' })),
          el('p', { class: 'note', text: 'Skenario A tidak memakai LLM. Seluruh alert di atas belum diverifikasi model mana pun, dan tidak ada temuan deteksi mandiri. Biaya run ini nol.' })),
        grup('Sumber dan tindak lanjut', 'satu himpunan',
          kartu('Alert Sonar', h.alerts.length, 'belum diverifikasi model'),
          kartu('Ditinjau developer', ditinjau('ok') + ditinjau('fp'), 'catatan lokal di browser ini')));
      return;
    }

    // Skenario C tidak memakai SonarCloud, jadi dua kelompok pertama akan berisi nol semua.
    // Deretan nol membaca sebagai "diperiksa dan bersih"; yang benar adalah "tidak ikut diperiksa".
    if (skenarioRun(h.run) === 'C') {
      isi($('summary'),
        el('section', { class: 'kartu-grup' },
          el('div', { class: 'kartu-kepala' }, el('h3', { text: 'Alert SonarCloud' }),
            el('span', { class: 'kartu-total', text: 'tidak dipakai' })),
          el('p', { class: 'note', text: 'Skenario C tidak memakai SonarCloud. Run ini hanya memanggil deteksi mandiri LLM, jadi tidak ada alert yang diverifikasi dan tidak ada alert di hasilnya.' })),
        grup('Sumber dan tindak lanjut', 'satu himpunan',
          kartu('Temuan LLM', h.findings.length, 'dari panggilan deteksi'),
          kartu('Ditinjau developer', ditinjau('ok') + ditinjau('fp'), 'catatan lokal di browser ini')));
      return;
    }

    isi($('summary'),
      grup('Keparahan alert Sonar', `${h.alerts.length} alert`,
        kartu('Blocker', sev(['BLOCKER']), 'severity apa adanya dari Sonar', 'crit'),
        kartu('Critical', sev(['CRITICAL']), 'severity apa adanya dari Sonar', 'high'),
        kartu('Major', sev(['MAJOR']), 'severity apa adanya dari Sonar'),
        kartu('Minor dan info', sev(['MINOR', 'INFO']), 'severity apa adanya dari Sonar'),
        sevLain ? kartu('Severity lain', sevLain, 'nama severity di luar lima baku Sonar') : null),
      grupPerkakas(),
      grup('Putusan model atas alert', `${h.alerts.filter((a) => (a.putusan_gabungan ?? a.putusan)).length} dari ${h.alerts.length} berputusan`,
        kartu('Dikonfirmasi model', n('true_positive'), 'alert dinyatakan nyata', 'crit'),
        kartu('False positive', n('false_positive'), 'alert ditolak model', 'ok'),
        kartu('Ragu-ragu', n('uncertain'), 'dipertahankan, bukan kegagalan', 'high'),
        gabunganRun(h.run) ? kartu('Tidak sepakat', n('tidak_sepakat'), 'tanpa dua suara; dipertahankan', 'high') : null,
        kartu('Tanpa putusan', n(null), 'panggilan atau parse gagal')),
      grup('Sumber dan tindak lanjut', 'dua himpunan terpisah',
        kartu('Alert Sonar', h.alerts.length, 'diverifikasi model satu per satu'),
        kartu('Temuan LLM', h.findings.length, 'dari panggilan deteksi'),
        kartu('Ditinjau developer', ditinjau('ok') + ditinjau('fp'), 'catatan lokal di browser ini')));
  };

  // Ringkasan singkat di halaman Ringkasan: cukup untuk memutuskan apakah perlu membuka halaman
  // lain. Sengaja dibatasi tiga temuan dan satu baris status alert; kalau isinya lengkap, halaman
  // Temuan dan Verifikasi kehilangan alasan untuk ada.
  const RINGKAS_MAKS = 3;
  const renderRingkasSingkat = () => {
    const h = state.hasil;
    // Vulnerability lebih dulu, lalu keyakinan tertinggi: itu urutan yang paling mungkin
    // ditindaklanjuti, bukan urutan berkas.
    const bobotSifat = (t) => (t.sifat === 'vulnerability' ? 0 : 1);
    const bobotKeyakinan = (t) => ({ high: 0, medium: 1, low: 2 }[t.keyakinan] ?? 3);
    const teratas = h.findings.slice()
      .sort((a, b) => bobotSifat(a) - bobotSifat(b) || bobotKeyakinan(a) - bobotKeyakinan(b))
      .slice(0, RINGKAS_MAKS);

    isi($('ringkas-temuan'), teratas.length
      ? el('ul', { class: 'ringkas-list' }, teratas.map((t) => el('li', {},
        el('button', {
          class: 'ringkas-temuan-item', type: 'button',
          onclick: () => { pergiKe('temuan'); bukaTemuan(t.fingerprint); },
        },
        el('span', { class: 'ringkas-atas' },
          el('span', { class: `chip ${t.sifat === 'hardening' ? 'chip-hardening' : 'chip-vuln'}`, text: t.sifat }),
          el('b', { class: 'ringkas-judul', text: t.jenis ?? '—' })),
        el('span', { class: 'ringkas-lokasi data' }, teksLokasi(t.file, t.baris))))))
      : el('p', { class: 'note', text: 'Tidak ada temuan LLM pada run ini.' }));

    // Sama seperti di halaman Verifikasi: putusan akhir mode gabungan ada di putusan_gabungan,
    // dan "tidak sepakat" tidak boleh ikut terhitung sebagai "tanpa putusan".
    const n = (p) => h.alerts.filter((a) => (a.putusan_gabungan ?? a.putusan) === p).length;
    // Skenario A tidak menjalankan verifikasi sama sekali, jadi seluruh alertnya jatuh ke kolom
    // tanpa putusan. Label "Tanpa putusan" di situ terbaca seperti verifikasi yang gagal, padahal
    // tidak pernah ada verifikasi yang dicoba. Hanya labelnya yang berubah; angkanya tetap sama.
    const labelTanpaPutusan = skenarioRun(h.run) === 'A' ? 'Belum diverifikasi (skenario A)' : 'Tanpa putusan';
    isi($('ringkas-alert'), h.alerts.length
      ? el('div', { class: 'ringkas-putusan' },
        [['true_positive', 'Dikonfirmasi model'], ['false_positive', 'False positive'],
          ['uncertain', 'Ragu-ragu'],
          ...(gabunganRun(h.run) ? [['tidak_sepakat', 'Tidak sepakat']] : []),
          [null, labelTanpaPutusan]].map(([k, label]) => el('div', { class: 'ringkas-angka' },
          // Warna hanya untuk angka di atas nol, aturan yang sama dengan kartu statistik: nol
          // berwarna membuat mata berhenti di tempat yang justru tidak perlu ditindaklanjuti.
          el('b', { class: n(k) > 0 ? `putusan p-${infoPutusan(k).kelas}` : 'ringkas-nol', text: String(n(k)) }),
          el('span', { text: label }))))
      : el('p', { class: 'note', text: skenarioRun(h.run) === 'C'
        ? 'Skenario C tidak memakai SonarCloud, jadi run ini tidak punya alert untuk diverifikasi.'
        : 'Tidak ada alert Sonar pada run ini.' }));
  };

  // Penanda run lama: kalau yang dibuka bukan run terbaru di branch ini, katakan dan sediakan
  // jalan ke yang terbaru. Tanpa ini, angka lama mudah disangka keadaan sekarang.
  const renderPenandaRunLama = () => {
    const n = $('run-lama');
    const daftar = entriBranch();
    const terbaru = daftar[0];
    const kini = state.entri;
    if (!terbaru || !kini || terbaru.id === kini.id) { n.hidden = true; isi(n); return; }
    n.hidden = false;
    isi(n,
      el('span', { class: 'lencana l-high', text: 'Bukan run terbaru' }),
      el('button', {
        class: 'btn-text', type: 'button',
        onclick: () => { muatRun(terbaru); pergiKe('ringkasan'); },
      }, `Buka run #${terbaru.nomor}`));
  };

  // ---------- Navigasi dan router ----------
  // Satu menu, satu tampilan, satu hash. Hash dipilih sebagai alamat tampilan karena dashboard ini
  // berkas statis tanpa server yang bisa menangani rute; hash membuat Back, Forward, muat ulang,
  // dan berbagi tautan bekerja tanpa konfigurasi hosting apa pun.
  const NAV = [
    { key: 'ringkasan', label: 'Ringkasan', judul: 'Ringkasan run', ikon: 'kisi', fokus: 'run-title' },
    { key: 'temuan', label: 'Temuan', judul: 'Temuan', ikon: 'perisai', fokus: 'temuan-h' },
    { key: 'verifikasi', label: 'Verifikasi', judul: 'Verifikasi alert Sonar', ikon: 'terverifikasi', fokus: 'alerts-h' },
    { key: 'riwayat', label: 'Riwayat', judul: 'Riwayat run', ikon: 'riwayat', fokus: 'hist-h' },
    { key: 'eksperimen', label: 'Eksperimen', judul: 'Eksperimen', ikon: 'labu', fokus: 'eks-h' },
  ];
  const KUNCI_TAMPILAN = NAV.map((x) => x.key);
  const TAMPILAN_BAWAAN = 'ringkasan';

  // Mode demo pindah ke query string. Sebelumnya ia memakai hash, dan hash kini dipakai tampilan;
  // keduanya tidak bisa menempati tempat yang sama. #demo dan #demo-v2 tetap diterima sebagai alias
  // lama lalu ditulis ulang, supaya tautan dan pintasan yang sudah beredar tidak putus.
  const demoDiUrl = () => new URLSearchParams(location.search).has('demo');

  const bacaTampilan = () => {
    const h = location.hash.replace(/^#/, '');
    return KUNCI_TAMPILAN.includes(h) ? h : null;
  };

  // Menyusun URL sendiri, bukan menyentuh location.hash langsung, supaya query (mode demo) tidak
  // ikut hilang saat tampilan berganti.
  const urlTampilan = (key) => {
    const u = new URL(location.href);
    u.hash = `#${key}`;
    return u.pathname + u.search + u.hash;
  };

  const pergiKe = (key, { ganti = false, pindahFokus = true } = {}) => {
    const tujuan = KUNCI_TAMPILAN.includes(key) ? key : TAMPILAN_BAWAAN;
    const url = urlTampilan(tujuan);
    if (ganti) history.replaceState(null, '', url);
    else if (location.hash !== `#${tujuan}`) history.pushState(null, '', url);
    terapkanTampilan(tujuan, { pindahFokus });
  };

  // Tampilan yang tidak tersedia untuk run ini tidak boleh menjadi halaman kosong tanpa sebab.
  const tampilanTersedia = (key) => {
    if (key === 'eksperimen') return Boolean(state.hasil?.eksperimen);
    return true;
  };

  // pindahFokus dimatikan untuk perpindahan yang bukan tindakan pengguna, yaitu pemuatan awal dan
  // render ulang saat run berganti. Memindahkan fokus di situ mencuri perhatian dan menggambar
  // cincin fokus yang terbaca sebagai galat, padahal pengguna belum menyentuh apa pun.
  function terapkanTampilan(key, { pindahFokus = true } = {}) {
    // Yang diminta alamat dan yang bisa ditampilkan adalah dua hal berbeda. Saat halaman baru
    // dimuat, data run belum ada, sehingga Eksperimen belum bisa dinilai tersedia; permintaannya
    // disimpan supaya tidak hilang, lalu dicoba lagi begitu run termuat. Tanpa ini, muat ulang di
    // #eksperimen selalu mendarat di Ringkasan.
    state.diminta = KUNCI_TAMPILAN.includes(key) ? key : TAMPILAN_BAWAAN;
    const tujuan = tampilanTersedia(state.diminta) ? state.diminta : TAMPILAN_BAWAAN;
    // Alamat harus selalu sepakat dengan yang terlihat. Kalau permintaannya memang tidak berlaku
    // untuk run ini, alamatnya dibetulkan, bukan dibiarkan menunjuk halaman yang tidak terbuka.
    if (tujuan !== state.diminta && state.hasil) {
      state.diminta = tujuan;
      history.replaceState(null, '', urlTampilan(tujuan));
    }
    if (location.hash !== `#${tujuan}` && state.diminta === tujuan) {
      history.replaceState(null, '', urlTampilan(tujuan));
    }
    state.tampilan = tujuan;
    // Berpindah tampilan sambil meninggalkan panel terbuka akan membuat fokus terkurung di panel
    // yang isinya sudah tidak ada hubungannya dengan halaman di belakangnya.
    if (drawerAktif) tutupDrawerAktif();
    for (const x of NAV) {
      const n = $(`v-${x.key}`);
      if (n) n.hidden = x.key !== tujuan;
    }
    if (tujuan === 'eksperimen') renderEksperimen();
    renderNav();
    const info = NAV.find((x) => x.key === tujuan);
    document.title = state.hasil?.run?.nomor
      ? `${info.judul} · Run #${state.hasil.run.nomor} · Security Dashboard`
      : `${info.judul} · Security Dashboard`;
    // Di layar sempit menu adalah panel; membiarkannya terbuka menutupi halaman yang baru dipilih.
    if (railSempit() && document.documentElement.dataset.rail === 'buka') terapkanRail(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (!pindahFokus) return;
    const judul = $(info.fokus);
    if (judul && judul.offsetParent !== null) judul.focus({ preventScroll: true });
  }

  // Lencana navigasi hanya memuat angka dari run yang sedang dibaca dan dari index branch itu.
  // Yang datanya belum ada tidak dapat lencana sama sekali: lencana berisi 0 terbaca sebagai
  // "sudah diperiksa, tidak ada apa-apa", padahal yang benar adalah "belum diketahui".
  const lencanaNav = (key) => {
    const h = state.hasil;
    if (key === 'ringkasan') return Number.isFinite(h?.run?.nomor) ? { teks: `#${h.run.nomor}`, kelas: 'l-netral' } : null;
    if (key === 'temuan') {
      if (!h) return null;
      const rentan = h.findings.some((t) => t.sifat === 'vulnerability');
      return { teks: String(h.findings.length), kelas: rentan ? 'l-crit' : 'l-netral',
        label: `${h.findings.length} temuan LLM${rentan ? ', ada yang bersifat vulnerability' : ''}` };
    }
    if (key === 'verifikasi') {
      if (!h) return null;
      // Skenario C tidak punya alert sama sekali. Lencana "0" membaca sebagai hasil pemindaian
      // yang bersih; yang benar adalah halaman itu tidak berlaku untuk run ini. Tanda hubung
      // dipakai agar bentuknya pun berbeda, tidak hanya angkanya.
      if (skenarioRun(h.run) === 'C') {
        return { teks: '–', kelas: 'l-netral', label: 'Tidak berlaku: skenario C tidak memakai SonarCloud' };
      }
      return { teks: String(h.alerts.length), kelas: 'l-netral', label: `${h.alerts.length} alert Sonar` };
    }
    if (key === 'riwayat') {
      if (!state.index) return null;
      const n = entriBranch().length;
      return { teks: String(n), kelas: 'l-netral', label: `${n} run di branch ini` };
    }
    return null;
  };

  const renderNav = () => {
    const llm = skemaLlm(state.hasil);
    $('railnav-box').hidden = !llm;
    if (!llm) return;
    const adaEks = tampilanTersedia('eksperimen');
    isi($('railnav'), NAV.filter((x) => x.key !== 'eksperimen' || adaEks).map((x) => {
      const l = lencanaNav(x.key);
      // Tautan sungguhan, bukan tombol: alamatnya nyata, bisa dibuka di tab baru, dan
      // disalin. Klik biasa ditangani router supaya tidak ada muat ulang halaman.
      return el('li', {}, el('a', {
        href: urlTampilan(x.key), 'aria-current': state.tampilan === x.key ? 'page' : null,
        onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          pergiKe(x.key);
        },
      }, ikon(IKON[x.ikon]), el('span', { class: 'railnav-label', text: x.label }),
      l ? el('span', { class: `lencana ${l.kelas}`, 'aria-label': l.label ?? null, text: l.teks }) : null));
    }));
  };

  // Satu baris per alert: severity Sonar (dengan sumbernya), putusan model, keyakinan, dan alasan
  // yang bisa dibuka. Alert tanpa putusan sah ditampilkan apa adanya sebagai "Tanpa putusan".
  // Satu baris per vendor: putusannya, atau sebabnya tidak ada putusan. Dua keadaan yang mudah
  // tertukar dibedakan tegas, karena artinya berlawanan:
  //   vendor GAGAL        — tidak pernah sempat menilai alert ini; ia tidak menolak apa pun.
  //   putusan TIDAK SAH   — vendor ikut dan menjawab, tetapi jawabannya tidak bisa dipakai.
  // Menyamakan keduanya membuat "2 dari 3" terbaca sebagai satu model yang berbeda pendapat.
  const blokPutusanVendor = (a) => {
    const r = state.hasil.run;
    if (!gabunganRun(r)) return null;
    const peta = a.putusan_vendor && typeof a.putusan_vendor === 'object' ? a.putusan_vendor : {};
    const keyakinan = a.keyakinan_vendor ?? {};
    const alasan = a.alasan_vendor ?? {};
    const gagal = vendorGagal(r);
    const baris = [];
    for (const vendor of vendorDipakai(r)) {
      const p = peta[vendor] ?? null;
      const inf = infoPutusan(p);
      baris.push(el('div', { class: 'pv-baris' },
        el('span', { class: 'pv-vendor data', text: vendor }),
        el('span', { class: `putusan p-${inf.kelas}`, text: p === null ? 'Putusan tidak sah' : inf.label }),
        el('span', { class: 'pv-key', text: keyakinan[vendor] ? `keyakinan ${keyakinan[vendor]}` : '—' }),
        el('p', { class: 'pv-alasan', text: alasan[vendor] || (p === null ? 'Model ini menjawab, tetapi jawabannya tidak bisa dipakai.' : 'Model ini tidak memberi alasan.') })));
    }
    for (const g of gagal) {
      baris.push(el('div', { class: 'pv-baris pv-gagal' },
        el('span', { class: 'pv-vendor data', text: g.vendor ?? 'tidak dikenal' }),
        el('span', { class: 'putusan p-none', text: 'Tidak ikut' }),
        el('span', { class: 'pv-key', text: '—' }),
        el('p', { class: 'pv-alasan', text: `Model ini gagal sebelum sempat menilai alert mana pun: ${g.alasan ?? 'tanpa alasan tercatat'}. Ia tidak menolak temuan ini.` })));
    }
    const inf = infoPutusan(a.putusan_gabungan ?? a.putusan);
    return el('section', { class: 'pv-kotak', 'aria-label': 'Putusan tiap model' },
      el('p', { class: 'alasan-kepala' }, ikon(IKON.bolt), el('b', { text: 'Putusan tiap model' }),
        el('span', { class: 'alasan-model', text: `putusan akhir: ${inf.label}` })),
      el('p', { class: 'note', text: a.putusan_gabungan === 'tidak_sepakat'
        ? 'Tidak ada putusan yang mengumpulkan dua suara, jadi alert ini dipertahankan. Tidak sepakat bukan false positive.'
        : `Diambil dari suara terbanyak, minimal dua suara dari ${vendorDipakai(r).length} model yang ikut.` }),
      el('div', { class: 'pv-daftar' }, baris));
  };

  const renderAlertV2 = () => {
    const alerts = state.hasil.alerts;
    const sk = skenarioRun(state.hasil.run);
    // Lencana perkakas hanya muncul kalau run ini memang memuat lebih dari satu perkakas. Data lama
    // karena itu tampil persis seperti sebelumnya: satu perkakas tidak perlu diberi label.
    const perkakas = perkakasDipakai(alerts);
    const banyakPerkakas = perkakas.length > 1;
    $('alerts-box').hidden = false;

    // Skenario C tidak memakai SonarCloud sama sekali, jadi halaman ini tidak punya isi dan
    // kekosongannya harus DIJELASKAN. Tanpa ini, "tidak ada alert" terbaca sebagai hasil
    // pemindaian yang bersih, padahal pemindaiannya memang tidak ikut dibaca model.
    if (sk === 'C') {
      isi($('alerts-ringkas'));
      isi($('alerts-body'), el('div', { class: 'state' },
        el('p', { text: 'Skenario C tidak memakai SonarCloud.' }),
        el('p', { class: 'note', text: 'Run ini hanya memanggil deteksi mandiri LLM. Tidak ada alert yang diverifikasi, dan tidak ada alert di hasilnya. Temuannya ada di halaman Temuan.' })));
      return;
    }

    // Putusan akhir mode gabungan hidup di putusan_gabungan, karena putusan dikosongkan saat tidak
    // ada suara terbanyak. Tanpa membacanya, "tidak sepakat" akan tampil sebagai "tanpa putusan",
    // yaitu dua keadaan yang berbeda sebabnya.
    const putusanTampil = (a) => a.putusan_gabungan ?? a.putusan;
    const gabungan = gabunganRun(state.hasil.run);
    // Skenario A tidak punya putusan apa pun, jadi deretan "0 dikonfirmasi, 0 false positive"
    // hanya akan membuat halaman ini terbaca seolah model menilai dan tidak menemukan apa-apa.
    // Yang ditampilkan satu angka: berapa alert yang menunggu diverifikasi.
    if (sk === 'A') {
      isi($('alerts-ringkas'), el('span', { class: 'ringkas-item' },
        el('b', { class: 'putusan p-belum', text: String(alerts.length) }),
        el('span', { text: 'Belum diverifikasi (skenario A)' })));
    } else {
      const urut = gabungan
        ? ['true_positive', 'false_positive', 'uncertain', 'tidak_sepakat', null]
        : ['true_positive', 'false_positive', 'uncertain', null];
      isi($('alerts-ringkas'), urut.map((p) => {
        const inf = infoPutusan(p);
        const n = alerts.filter((a) => putusanTampil(a) === p).length;
        return el('span', { class: 'ringkas-item' },
          el('b', { class: `putusan p-${inf.kelas}`, text: String(n) }), el('span', { text: inf.label }));
      }));
    }

    isi($('alerts-body'), alerts.length
      ? el('ul', { class: 'alist' }, alerts.map((a) => {
        const inf = infoPutusanAlert(a);
        const idDetail = `ad-${a.id}`;
        const r = state.hasil.run;
        const hash = r.hash_prompt?.user_deteksi ?? null;
        const detail = el('div', { class: 'adetail', id: idDetail, hidden: true },
          blokPutusanVendor(a) ?? el('div', { class: 'alasan-kotak' },
            el('p', { class: 'alasan-kepala' },
              ikon(IKON.bolt),
              el('b', { text: 'Alasan dan analisis model' }),
              el('span', { class: 'alasan-model', text: labelModelId(r.model_menjawab ?? r.model_diminta) })),
            el('p', { class: 'alasan', text: a.alasan ?? (sk === 'A'
              ? `Skenario A tidak memakai LLM, jadi alert ini belum dinilai model mana pun. Severity di atas datang apa adanya dari ${namaSast(a.severity_asal ?? perkakasAlert(a))}.`
              : 'Model tidak memberi alasan untuk alert ini.') })),
          el('div', { class: 'afakta' },
            a.rule ? el('span', { class: 'chip chip-rule', text: a.rule }) : null,
            ...a.cwe.map(tautanCwe),
            a.pesan ? el('span', { class: 'apesan', text: a.pesan }) : null),
          blokRekomendasi(a.cwe),
          blokSaranAi(a, r),
          hash ? el('p', { class: 'note data', title: 'Sidik jari prompt yang dikirim ke model, dari berkas hasil', text: `prompt ${hash.slice(0, 12)}` }) : null);
        const labelBuka = el('small', { text: 'Lihat alasan' });
        const tombol = el('button', {
          class: 'arow', type: 'button', 'aria-expanded': 'false', 'aria-controls': idDetail,
          onclick: (e) => {
            const buka = detail.hidden;
            detail.hidden = !buka;
            e.currentTarget.setAttribute('aria-expanded', String(buka));
            labelBuka.textContent = buka ? 'Tutup alasan' : 'Lihat alasan';
          },
        },
        el('span', { class: 'fid', text: a.id }),
        el('span', { class: 'aisi' },
          el('span', { class: 'ameta' },
            el('span', { class: `putusan p-${inf.kelas}`, text: inf.label }),
            el('span', { class: 'chip chip-sev', title: `Severity apa adanya dari ${namaSast(a.severity_asal ?? perkakasAlert(a))}, tidak diterjemahkan` },
              el('span', { text: severityAlert(a) ?? '—' }),
              el('small', { text: `dari ${namaSast(a.severity_asal ?? perkakasAlert(a))}` })),
            banyakPerkakas
              ? el('span', { class: 'chip chip-rule', title: 'Perkakas analisis statis yang melaporkan alert ini', text: namaSast(perkakasAlert(a)) })
              : null,
            el('span', { class: 'akey', text: a.keyakinan ? `keyakinan ${a.keyakinan}` : '—' })),
          el('span', { class: 'ftitle' }, a.file ? teksLokasi(a.file, a.baris) : (a.rule ?? '—'))),
        el('span', { class: 'buka' }, labelBuka, ikon(IKON.panah)));
        return el('li', {}, tombol, detail);
      }))
      // Kalimat kosongnya mengikuti sumbu sast yang dicatat run, bukan menyebut Sonar pada run yang
      // perkakasnya bukan Sonar. Himpunan alert yang kosong tidak bisa memberi tahu perkakasnya,
      // jadi keterangannya diambil dari run, satu-satunya tempat yang tahu.
      : el('div', { class: 'state' }, el('p', {
        text: (state.hasil.run?.sast ?? 'sonar') === 'sonar'
          ? 'Tidak ada alert Sonar pada run ini.'
          : 'Tidak ada alert SAST pada run ini.',
      })));
  };

  // Keputusan developer v2 disimpan per project dan dikunci sidik jari temuan, bukan per run id.
  // Dengan begitu keputusan terbawa ke run berikutnya selama temuannya sama (file, baris, cwe, jenis).
  // Tetap hanya di browser ini: tidak tersinkron antar perangkat maupun antar developer.
  const kunciKeputusanV2 = () => `${KUNCI.keputusanV2}${state.proyek.owner}/${state.proyek.repo}`;
  const putuskanV2 = (t, v) => {
    const kini = state.keputusan[t.fingerprint]?.v === v ? null : v;
    if (kini) state.keputusan[t.fingerprint] = { v: kini, t: new Date().toISOString() };
    else delete state.keputusan[t.fingerprint];
    if (!store.set('localStorage', kunciKeputusanV2(), JSON.stringify(state.keputusan))) {
      tampilBanner('info', 'Browser menolak penyimpanan. Catatan hanya bertahan sampai halaman dimuat ulang.');
    }
    renderRingkasanV2();
    // Tidak memindahkan fokus: pengguna keyboard sedang berada di dalam panel detail.
    renderTemuanV2();
    if (state.terbuka === t.fingerprint) renderDetailTemuan();
    const lagi = document.getElementById(`${t.fingerprint}-${v}`);
    if (lagi) lagi.focus();
  };

  const FILTER_V2 = [
    { key: 'semua', label: 'Semua', cocok: () => true },
    { key: 'vulnerability', label: 'Vulnerability', cocok: (t) => t.sifat === 'vulnerability' },
    { key: 'hardening', label: 'Hardening', cocok: (t) => t.sifat === 'hardening' },
    { key: 'high', label: 'Keyakinan high', cocok: (t) => t.keyakinan === 'high' },
    { key: 'medium', label: 'Keyakinan medium', cocok: (t) => t.keyakinan === 'medium' },
    { key: 'low', label: 'Keyakinan low', cocok: (t) => t.keyakinan === 'low' },
    // Hanya berarti di mode gabungan: run satu model membuat setiap temuan bernilai 1 dari 1, dan
    // saringan ini akan selalu kosong. Karena itu ia disembunyikan di luar mode gabungan,
    // bukan ditampilkan sebagai saringan yang tidak pernah menghasilkan apa pun.
    {
      key: 'sepakat2', label: 'Minimal 2 model', hanyaGabungan: true,
      cocok: (t) => Number(t.kesepakatan) >= 2,
    },
  ];
  const filterTersedia = () => FILTER_V2.filter((x) => !x.hanyaGabungan || gabunganRun(state.hasil?.run));
  const filterV2Aktif = () => filterTersedia().find((x) => x.key === state.filter) ?? FILTER_V2[0];

  const renderFilterV2 = () => {
    const f = state.hasil.findings;
    isi($('filters'), filterTersedia().map((x) => el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-pressed': state.filter === x.key ? 'true' : 'false',
      onclick: () => { state.filter = x.key; state.terbuka = null; renderFilterV2(); renderTemuanV2(); },
    }, x.label, ' ', el('span', { class: 'count', text: String(f.filter(x.cocok).length) }))));
  };

  // Lencana kesepakatan: berapa dari model yang BENAR-BENAR IKUT melaporkan temuan ini. Penyebutnya
  // jumlah vendor yang ikut, bukan tiga tetap: kalau satu vendor gagal, "2 dari 3" akan membaca
  // seolah satu model menolak temuan itu, padahal ia tidak pernah sempat melihatnya.
  const lencanaKesepakatan = (t) => {
    const r = state.hasil?.run;
    if (!gabunganRun(r)) return null;
    const n = Number(t.kesepakatan);
    if (!Number.isFinite(n)) return null;
    const dari = vendorDipakai(r).length || n;
    const penemu = Array.isArray(t.vendor_penemu) ? t.vendor_penemu : [];
    const kelas = n >= dari ? 'sepakat-penuh' : (n >= 2 ? 'sepakat-sebagian' : 'sepakat-tunggal');
    return el('span', {
      class: `chip chip-sepakat ${kelas}`,
      title: penemu.length ? `Dilaporkan oleh ${penemu.join(', ')} dari ${dari} model yang ikut` : null,
    }, `${n}/${dari} model`);
  };

  // CWE ditautkan ke definisi resmi MITRE. Ini tautan biasa, bukan permintaan jaringan: CSP
  // connect-src tetap hanya 'self' dan api.github.com.
  const tautanCwe = (kode) => {
    const n = String(kode).match(/^CWE-(\d+)$/);
    if (!n) return el('span', { class: 'chip chip-cwe', text: String(kode) });
    return el('a', {
      class: 'chip chip-cwe', href: `https://cwe.mitre.org/data/definitions/${n[1]}.html`,
      target: '_blank', rel: 'noopener noreferrer', title: `Buka definisi ${kode} di cwe.mitre.org`,
    }, String(kode));
  };

  const tautanGithub = (t) => {
    const p = state.proyek;
    const r = state.hasil.run;
    const url = urlBerkasGh(p, r.objek_uji.commit, t.file, t.baris);
    if (!url) return null;
    return el('a', { class: 'btn-text', href: url, target: '_blank', rel: 'noopener noreferrer' },
      'Buka ', ...teksLokasi(t.file, t.baris), ' di GitHub');
  };

  // Drawer detail temuan. Dibuka dari kartu temuan; isinya seluruhnya dari data run, termasuk
  // potongan kode objek uji bila berkas hasil memuatnya.
  const bukaTemuan = (fp) => {
    state.terbuka = fp;
    renderDetailTemuan();
    renderTemuanV2();
    bukaPanel($('drawer-temuan'), { tutupId: 'temuan-tutup' });
  };

  const renderDetailTemuan = () => {
    const t = state.hasil?.findings.find((x) => x.fingerprint === state.terbuka);
    if (!t) { isi($('temuan-isi')); return; }
    const putusan = state.keputusan[t.fingerprint]?.v ?? null;
    isi($('temuan-eyebrow'),
      el('span', { text: `Temuan deteksi mandiri LLM \u00b7 ${t.id}` }),
      el('span', { class: `lencana ${putusan === 'ok' ? 'l-crit' : (putusan === 'fp' ? 'l-ok' : 'l-netral')}` },
        el('i', { 'aria-hidden': 'true' }),
        putusan === 'ok' ? 'Dikonfirmasi developer' : (putusan === 'fp' ? 'Ditandai false positive' : 'Belum ditinjau')));
    $('temuan-drawer-h').textContent = t.jenis;
    isi($('temuan-isi'), detailTemuanV2(t));
  };

  // Di mode gabungan penjelasan setiap model ditampilkan UTUH dan terpisah, tidak diringkas menjadi
  // satu. Justru perbedaan alasan antarmodel yang berguna dibaca: dua model bisa menunjuk baris yang
  // sama karena sebab yang berbeda, dan meleburnya menghapus satu-satunya hal yang membedakan mode
  // gabungan dari satu model.
  const blokPenjelasanTemuan = (t) => {
    const perVendor = t.penjelasan_vendor && typeof t.penjelasan_vendor === 'object'
      ? Object.entries(t.penjelasan_vendor) : [];
    if (!perVendor.length) {
      return el('div', { class: 'alasan-kotak' },
        el('p', { class: 'alasan-kepala' }, ikon(IKON.bolt), el('b', { text: 'Penjelasan dan analisis model' })),
        el('p', { class: 'alasan', text: t.penjelasan ?? 'Model tidak memberi penjelasan untuk temuan ini.' }));
    }
    return el('div', { class: 'alasan-kotak' },
      el('p', { class: 'alasan-kepala' }, ikon(IKON.bolt),
        el('b', { text: 'Penjelasan tiap model' }),
        el('span', { class: 'alasan-model', text: `${perVendor.length} dari ${vendorDipakai(state.hasil.run).length} model` })),
      el('dl', { class: 'alasan-vendor' }, perVendor.map(([vendor, teks]) => [
        el('dt', { class: 'data', text: vendor }),
        el('dd', { class: 'alasan', text: teks || 'Model ini melaporkan temuan tanpa penjelasan.' }),
      ])));
  };

  const detailTemuanV2 = (t) => {
    const pk = t.potongan_kode;
    const kode = pk && pk.baris?.length
      ? el('pre', { class: 'code', tabindex: '0', role: 'region', 'aria-label': `Kode di sekitar baris ${t.baris ?? '?'} pada ${t.file ?? 'berkas'}` }, pk.baris.map((b, i) => el('span', {
        class: pk.mulai + i === t.baris ? 'hit' : null, 'data-ln': String(pk.mulai + i), text: `${b}\n`,
      })))
      : el('div', { class: 'kode-kosong' },
        el('p', { class: 'block-h', text: 'Potongan kode tidak tersedia' }),
        el('p', { class: 'note', text: 'Berkas hasil run ini dibuat tanpa akses ke worktree objek uji, jadi tidak ada baris kode yang bisa ditampilkan. Tautan di atas membuka berkasnya di GitHub pada commit objek uji.' }));
    const fakta = [
      t.cwe.length ? ['CWE', t.cwe.join(', ')] : null,
      t.kategori_owasp ? ['OWASP', t.kategori_owasp] : null,
      ['Sifat', t.sifat], ['Keyakinan', t.keyakinan],
      t.fungsi ? ['Fungsi', t.fungsi] : null,
      t.tanda?.length ? ['Tanda', t.tanda.join(', ')] : null,
    ].filter(Boolean);
    const putusan = state.keputusan[t.fingerprint]?.v ?? null;
    const tombol = (v, label) => el('button', {
      class: 'btn btn-sm', type: 'button', id: `${t.fingerprint}-${v}`,
      'aria-pressed': putusan === v ? 'true' : 'false', onclick: () => putuskanV2(t, v),
    }, label);
    const chip = (teks, kelas) => el('span', { class: `chip ${kelas}`, text: teks });
    return el('div', { class: 'fdetail', id: `d-${t.fingerprint}` },
      el('div', { class: 'fmeta' },
        chip(t.sifat, t.sifat === 'hardening' ? 'chip-hardening' : 'chip-vuln'),
        ...t.cwe.map(tautanCwe),
        t.kategori_owasp ? chip(t.kategori_owasp === 'Other' ? 'OWASP lainnya' : `${t.kategori_owasp}:2025`, 'chip-owasp') : null,
        chip(`keyakinan ${t.keyakinan}`, 'chip-keyakinan'),
        lencanaKesepakatan(t)),
      gabunganRun(state.hasil.run)
        ? el('p', { class: 'note data', text: `${(t.vendor_penemu ?? []).join(', ') || 'tidak ada'} dari ${vendorDipakai(state.hasil.run).join(', ')}` })
        : el('p', { class: 'note data', text: labelModelId(state.hasil.run.model_menjawab ?? state.hasil.run.model_diminta) }),
      el('div', { class: 'lokasi-kotak' },
        el('div', {}, el('p', { class: 'block-h', text: 'Lokasi sumber kode' }),
          el('p', { class: 'floc' }, teksLokasi(t.file, t.baris))),
        tautanGithub(t)),
      blokPenjelasanTemuan(t),
      el('p', { class: 'block-h', text: 'Kode di sekitar baris' }), kode,
      blokRekomendasi(t.cwe),
      blokSaranAi(t, state.hasil.run),
      el('p', { class: 'block-h', text: 'Fakta' }),
      el('dl', { class: 'facts' }, fakta.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
      el('p', { class: 'block-h', text: 'Catatan lokal' }),
      el('div', { class: 'decide' }, tombol('ok', 'Konfirmasi rentan'), tombol('fp', 'Tandai false positive')));
  };

  const renderTemuanV2 = (fokusFp) => {
    const semua = state.hasil.findings;
    const f = semua.filter(filterV2Aktif().cocok);
    const chip = (teks, kelas) => el('span', { class: `chip ${kelas}`, text: teks });
    isi($('findings-body'), f.length
      ? el('ul', { class: 'flist' }, f.map((t) => {
        const terbuka = state.terbuka === t.fingerprint;
        const putusan = state.keputusan[t.fingerprint]?.v ?? null;
        const baris = el('button', {
          class: `frow frow-v2${terbuka ? ' terpilih' : ''}`, type: 'button', 'aria-haspopup': 'dialog',
          onclick: () => bukaTemuan(t.fingerprint),
          dataset: { fp: t.fingerprint },
        },
        el('span', { class: 'fid', text: t.id }),
        el('span', { class: 'fmeta' },
          chip(t.sifat, t.sifat === 'hardening' ? 'chip-hardening' : 'chip-vuln'),
          ...t.cwe.map((c) => chip(c, 'chip-cwe')),
          // Taksonomi yang diminta prompt v2 adalah OWASP Top 10:2025; tahunnya ditulis supaya
          // tidak tertukar dengan daftar 2021 yang kodenya berbeda arti.
          t.kategori_owasp ? chip(t.kategori_owasp === 'Other' ? 'OWASP lainnya' : `${t.kategori_owasp}:2025`, 'chip-owasp') : null,
          chip(`keyakinan ${t.keyakinan}`, 'chip-keyakinan'),
          lencanaKesepakatan(t)),
        el('span', { class: 'ftitle', text: t.jenis }),
        el('span', { class: 'floc' }, teksLokasi(t.file, t.baris)),
        putusan
          ? el('span', { class: 'fdec', dataset: { v: putusan }, text: putusan === 'ok' ? 'Dikonfirmasi developer' : 'Ditandai false positive' })
          : el('span', { class: 'fdec-empty', text: 'Belum ditinjau' }),
        el('span', { class: 'buka' }, el('small', { text: terbuka ? 'Tutup detail' : 'Detail' }), ikon(IKON.panah)));
        return el('li', {}, baris);
      }))
      : el('div', { class: 'state' }, skenarioRun(state.hasil.run) === 'A'
        // Kekosongan skenario A harus DIJELASKAN. Tanpa ini, 'tidak ada temuan' terbaca sebagai
        // hasil pemeriksaan yang bersih, padahal deteksi LLM memang tidak pernah dijalankan.
        ? [el('p', { text: 'Skenario A tidak memakai LLM.' }),
          el('p', { class: 'note', text: 'Run ini hanya menjalankan SonarCloud, jadi tidak ada panggilan deteksi dan tidak ada temuan LLM. Alert SonarCloud-nya ada di halaman Verifikasi.' })]
        : el('p', { text: semua.length ? 'Tidak ada temuan yang cocok dengan saringan ini.' : 'Panggilan deteksi tidak melaporkan temuan.' })));
    // Sidik jari berasal dari berkas hasil; hanya pola yang sah boleh masuk selector.
    if (fokusFp && /^[0-9a-f]{16}$/.test(fokusFp)) {
      const n = document.querySelector(`.frow-v2[data-fp="${fokusFp}"]`);
      if (n) n.focus();
    }
  };

  // Batang riwayat memakai putusan model. Warna selalu disertai tooltip teks, dan run gagal
  // ditandai bentuk (tanda seru), bukan hanya warna.
  const SEG_RIWAYAT = [
    ['true_positive', 'Dikonfirmasi model', 'var(--crit)'],
    ['false_positive', 'False positive', 'var(--ok)'],
    ['uncertain', 'Ragu-ragu', 'var(--high)'],
    // Run satu model tidak pernah punya segmen ini: nilainya 0 dan segmennya tidak digambar.
    ['tidak_sepakat', 'Tidak sepakat', 'var(--high)'],
    ['tanpa_putusan', 'Tanpa putusan', 'var(--rule-2)'],
  ];
  const renderSampingV2 = () => {
    const daftar = entriBranch();
    // Nomor run tidak berurutan karena beberapa branch berbagi penomoran GitHub. Urutannya
    // waktu selesai, terbaru di atas, dan itu dikatakan supaya tidak terbaca sebagai acak.
    isi($('history'), daftar.length
      ? [
        el('p', { class: 'note', text: 'Terbaru di atas, menurut waktu selesai.' }),
        ...daftar.slice(0, 12).map((e) => {
          const j = e.jumlah ?? {};
          const tot = SEG_RIWAYAT.reduce((s, [k]) => s + (j[k] ?? 0), 0);
          const rincian = SEG_RIWAYAT.map(([k, label]) => `${label} ${j[k] ?? 0}`).join(', ');
          const bar = el('span', { class: 'hbar', 'aria-hidden': 'true', title: rincian },
            SEG_RIWAYAT.map(([k, , warna]) => {
              const i = el('i', { title: `${k}: ${j[k] ?? 0}` });
              i.style.setProperty('width', `${tot ? ((j[k] ?? 0) / tot) * 100 : 0}%`);
              i.style.setProperty('background', warna);
              return i;
            }));
          const gagal = e.status === 'gagal';
          const aktif = state.entri?.id === e.id;
          const urlRun = urlRunGh(state.proyek, e.id);
          const tombol = el('button', {
            class: 'hrow', type: 'button', 'aria-current': aktif ? 'true' : 'false',
            'aria-label': `Run ${e.nomor}, ${labelVendor(e.vendor)}, ${j.temuan ?? 0} temuan, ${j.alert ?? 0} alert, ${rincian}${gagal ? ', run gagal' : ''}`,
            onclick: () => { muatRun(e); pergiKe('ringkasan'); },
          },
          el('span', { class: 'hkepala' },
            el('b', { class: 'hnum data', text: `#${e.nomor}` }),
            el('span', { class: 'hmodel', text: labelVendor(e.vendor) }),
            gagal ? el('span', { class: 'hgagal', title: 'Run gagal', text: '!' }) : null,
            aktif ? el('span', { class: 'lencana l-accent', text: 'Aktif' }) : null,
            el('span', { class: 'hbiaya data', text: typeof e.biaya_usd === 'number' ? `US$${e.biaya_usd.toFixed(4).replace('.', ',')}` : '' })),
          bar,
          el('span', { class: 'hmeta', text: `${waktu(e.selesai)} \u00b7 ${j.temuan ?? 0} temuan, ${j.alert ?? 0} alert` }));
          // Memilih run dan membuka GitHub adalah dua maksud berbeda, jadi dua sasaran klik
          // berbeda: tautannya di luar tombol, bukan di dalamnya.
          return el('div', { class: 'hbaris' }, tombol, urlRun
            ? el('a', {
              class: 'hlink', href: urlRun, target: '_blank', rel: 'noopener noreferrer',
              'aria-label': `Buka run #${e.nomor} di GitHub Actions, tab baru`, title: `Buka run #${e.nomor} di GitHub Actions`,
            }, ikon(IKON.luar))
            : null);
        }),
        el('div', { class: 'hist-legenda' }, [
          ...SEG_RIWAYAT.map(([, label, warna]) => {
            const i = el('i', { 'aria-hidden': 'true' });
            i.style.setProperty('background', warna);
            return el('span', {}, i, label);
          }),
          el('span', {}, el('b', { class: 'hgagal', text: '!' }), 'run gagal'),
        ]),
      ]
      : el('p', { class: 'note', text: 'Belum ada run di branch ini.' }));
  };

  // ---------- Drawer "Jalankan analisis" ----------
  // Memisahkan menjalankan dari melihat: header hanya menjelaskan run yang sedang dibuka.
  // Fokus dikurung di dalam panel, Escape menutup, dan fokus kembali ke tombol pembuka.
  // Dua panel memakai mekanik yang sama: fokus dikurung di dalamnya, Escape menutup, dan fokus
  // kembali ke elemen yang membukanya. Ditulis sekali supaya keduanya tidak pernah berbeda
  // perilaku, karena perbedaan seperti itu baru terasa oleh pengguna keyboard.
  let drawerAktif = null;
  const elemenFokus = (n) => [...n.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((x) => x.offsetParent !== null);
  const kurungFokus = (e) => {
    if (!drawerAktif) return;
    if (e.key === 'Escape') { e.preventDefault(); tutupDrawerAktif(); return; }
    if (e.key !== 'Tab') return;
    const f = elemenFokus(drawerAktif.panel);
    if (!f.length) return;
    const awal = f[0];
    const akhir = f[f.length - 1];
    if (e.shiftKey && document.activeElement === awal) { e.preventDefault(); akhir.focus(); }
    else if (!e.shiftKey && document.activeElement === akhir) { e.preventDefault(); awal.focus(); }
  };
  // `kelola: false` untuk panel yang kemunculannya diatur CSS, bukan atribut hidden: rail di layar
  // sempit tampil lewat data-rail, jadi yang dipinjam di sini hanya kurungan fokus dan Escape.
  function bukaPanel(panel, { pemicu = null, tutupId, kelola = true, saatTutup = null }) {
    if (drawerAktif) tutupDrawerAktif();
    drawerAktif = { panel, fokusSebelum: document.activeElement, pemicu, tutupId, kelola, saatTutup };
    if (kelola) panel.hidden = false;
    if (pemicu) pemicu.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', kurungFokus, true);
    const f = elemenFokus(panel);
    (f[0] ?? $(tutupId)).focus();
  }
  function tutupDrawerAktif() {
    if (!drawerAktif) return;
    const { panel, fokusSebelum, pemicu, tutupId, kelola, saatTutup } = drawerAktif;
    drawerAktif = null;
    if (kelola) panel.hidden = true;
    if (saatTutup) saatTutup();
    if (pemicu) pemicu.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', kurungFokus, true);
    if (fokusSebelum && document.contains(fokusSebelum) && fokusSebelum.offsetParent !== null) fokusSebelum.focus();
    else $(tutupId).focus();
  }
  // Melepas kurungan tanpa menutup apa pun dan tanpa memindahkan fokus. Dipakai saat rail berhenti
  // menjadi panel, misalnya karena jendela dilebarkan.
  function lepasPanel(panel) {
    if (!drawerAktif || drawerAktif.panel !== panel) return;
    const { pemicu } = drawerAktif;
    drawerAktif = null;
    if (pemicu) pemicu.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', kurungFokus, true);
  }
  function bukaDrawer() {
    // Persetujuan biaya berlaku untuk satu run, jadi tidak boleh terbawa ke pembukaan berikutnya.
    // Begitu pula pilihan rekomendasi AI, yang menambah biaya.
    $('f-konfirmasi-v2').checked = false;
    $('f-rekomendasi').checked = false;
    // Mode gabungan menagih tiga vendor sekaligus, jadi ia pun tidak boleh terbawa diam-diam ke
    // pembukaan drawer berikutnya.
    const tunggal = document.querySelector('input[name="mode_model"][value="tunggal"]');
    if (tunggal) tunggal.checked = true;
    renderDrawer();
    bukaPanel($('drawer'), { pemicu: $('buka-drawer'), tutupId: 'drawer-tutup' });
  }
  function tutupDrawer() { tutupDrawerAktif(); }

  // ---------- Tab Eksperimen ----------
  // Angka ditampilkan apa adanya beserta variannya. Tidak ada peringkat, tidak ada penilaian
  // model mana yang lebih baik: itu kesimpulan yang harus ditarik di luar dashboard.
  const n3 = (v) => (typeof v === 'number' ? v.toFixed(3).replace('.', ',') : '—');
  const usd = (v) => (typeof v === 'number' ? `US$${v.toFixed(4).replace('.', ',')}` : '—');

  const tabel = (kepala, baris, label) => el('div', { class: 'tabel-kotak' },
    el('p', { class: 'tabel-geser note', hidden: true, text: 'Geser tabel ke samping untuk melihat kolom lainnya. Kolom pertama tetap di tempat.' }),
    el('div', {
      class: 'tabel-bungkus', tabindex: '0', role: 'region', 'aria-label': label ?? 'Tabel eksperimen',
    },
    el('table', { class: 'eks' },
      el('thead', {}, el('tr', {}, kepala.map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, baris.map((r) => el('tr', {}, r.map((c, i) => el('td', {
        class: i > 0 && typeof c !== 'object' ? 'num' : null,
      }, c))))))));

  // Wadah guliran hanya diberi penanda kalau isinya memang lebih lebar dari kotaknya. Penanda
  // yang selalu tampil mengajari pembaca mengabaikannya.
  const tandaiGulir = () => {
    for (const n of document.querySelectorAll('.tabel-bungkus')) {
      const perlu = n.scrollWidth > n.clientWidth + 1;
      n.dataset.gulir = perlu ? 'ya' : 'tidak';
      const tanda = n.parentElement.querySelector('.tabel-geser');
      if (tanda) tanda.hidden = !perlu;
    }
  };

  // Kartu penjelasan: judul berwarna menurut artinya, lalu satu kalimat definisi. Dipakai untuk
  // menerangkan skenario dan empat kategori verifikasi sebelum angkanya dibaca.
  const kartuPenjelasan = (kelas, judul, teks) => el('div', { class: `eks-kartu eks-${kelas}` },
    el('p', { class: 'eks-kartu-judul' }, el('i', { 'aria-hidden': 'true' }), judul),
    el('p', { class: 'eks-kartu-teks', text: teks }));

  const blokEks = (nomor, judul, metaKanan, keterangan, isiBlok, sumberTeks) => el('section', { class: 'eks-blok' },
    el('div', { class: 'eks-kepala' },
      el('div', {},
        el('p', { class: 'eks-eyebrow', text: `Bagian ${nomor}` }),
        el('h3', { text: judul })),
      metaKanan ? el('p', { class: 'eks-meta', text: metaKanan }) : null),
    keterangan ? el('p', { class: 'eks-ket', text: keterangan }) : null,
    isiBlok,
    el('p', { class: 'eks-sumber', text: sumberTeks }));

  const eksSkenario = (eks) => {
    const kepala = ['Model', 'Skenario', 'Ketat P/R/F1', 'Triase konservatif P/R/F1', 'Triase utama P/R/F1'];
    const baris = [];
    // Skenario A hanya memakai alert Sonar, jadi angkanya sama untuk setiap model. Mengulangnya
    // satu baris per model membuatnya terbaca seolah tiga hasil berbeda yang kebetulan sama.
    const a = eks.per_model[0]?.skenario_a;
    if (a) baris.push(['Tidak bergantung pada model', 'A — alert Sonar saja', `${n3(a.precision)} / ${n3(a.recall)} / ${n3(a.f1)}`, '—', '—']);
    for (const m of eks.per_model) {
      for (const [kunci, nama] of [['skenario_b', 'B — alert dipertahankan + temuan LLM'], ['skenario_c', 'C — temuan LLM saja']]) {
        const r = m.rata_rata[kunci];
        const f = (v) => (v ? `${n3(v.precision)} / ${n3(v.recall)} / ${n3(v.f1)}` : '—');
        baris.push([labelVendor(m.vendor), nama, f(r.ketat), f(r.triase_konservatif), f(r.triase_utama)]);
      }
    }
    const penjelasan = el('div', { class: 'eks-kartu-baris' },
      kartuPenjelasan('netral', 'Skenario A \u2014 alert Sonar saja', 'Hanya alert SonarCloud, tanpa verifikasi maupun temuan model. Acuan dasar yang sama untuk setiap model.'),
      kartuPenjelasan('accent', 'Skenario B \u2014 alert dipertahankan + temuan LLM', 'Alert yang tidak ditolak model, digabung dengan temuan deteksi mandiri model.'),
      kartuPenjelasan('accent', 'Skenario C \u2014 temuan LLM saja', 'Hanya temuan deteksi mandiri model, tanpa alert SonarCloud.'));
    return blokEks('01', 'Skenario A, B, dan C per model', 'Format metrik: presisi / recall / F1',
      'Rata-rata lintas run. Ketat: temuan di luar ground truth dihitung FP. Triase konservatif: kategori teoretis ikut dihitung FP. '
      + 'Triase utama: teoretis tidak dihitung FP. Tidak ada varian yang menambah TP, jadi recall sama di ketiganya.',
      el('div', { class: 'eks-isi' }, penjelasan, tabel(kepala, baris, 'Tabel Skenario A, B, dan C per model')),
      `Sumber: ${eks.sumber.skor_utama}, ${eks.sumber.skor_triase_konservatif ?? '—'}, ${eks.sumber.skor_triase_utama ?? '—'} · kode scoring ${pendek(eks.sumber.commit_kode_scoring ?? '')}`);
  };

  const eksVerifikasi = (eks) => {
    const pakaiSens = state.eksLabel === 'sensitivitas';
    const kepala = ['Model', 'Run', 'Identified FP', 'Missed FP', 'Mis-identified FP', 'Correct retention', 'P/R/F1'];
    const baris = [];
    for (const m of eks.per_model) {
      for (const r of m.runs) {
        const v = pakaiSens ? (r.verifikasi?.sensitivitas ?? null) : (r.verifikasi ?? null);
        const j = v?.jumlah ?? {};
        const mp = v?.metrik_fp_positif ?? {};
        baris.push([labelVendor(m.vendor), String(r.run), String(j.identified_fp ?? '—'), String(j.missed_fp ?? '—'),
          String(j.misidentified_fp ?? '—'), String(j.correct_retention ?? '—'),
          `${n3(mp.precision)} / ${n3(mp.recall)} / ${n3(mp.f1)}`]);
      }
    }
    // Alert mana yang labelnya divariasikan analisis sensitivitas DITURUNKAN dari data: id yang
    // labelnya berbeda antara varian utama dan varian sensitivitas. Sebelumnya id "SONAR-03" dipaku
    // di sini. Itu kebetulan benar untuk batch 19 dan 22 Oktober, dan salah untuk batch mana pun
    // yang memvariasikan alert lain — termasuk lengan dua perkakas, yang id alertnya CQL-xx.
    //
    // Tanpa varian sensitivitas, keterangannya kosong, bukan "SONAR-03 = —": tanda hubung di situ
    // terbaca seolah alert itu ada dan labelnya tidak diketahui.
    const idLabelBeda = () => {
      const u = eks.label_alert ?? {};
      const s = eks.label_alert_sensitivitas;
      if (!s) return [];
      return Object.keys(s).filter((id) => (s[id]?.label ?? null) !== (u[id]?.label ?? null)).sort();
    };
    const ketLabel = (peta) => {
      const ids = idLabelBeda();
      return ids.length ? ` (${ids.map((id) => `${id} = ${peta?.[id]?.label ?? '—'}`).join(', ')})` : '';
    };
    const pilih = el('div', { class: 'eks-pilih' },
      el('span', { class: 'note', text: 'Label alert:' }),
      ...[['utama', `Utama${ketLabel(eks.label_alert)}`],
        ['sensitivitas', `Sensitivitas${ketLabel(eks.label_alert_sensitivitas)}`]]
        .map(([k, label]) => el('button', {
          class: 'btn btn-sm', type: 'button', 'aria-pressed': (state.eksLabel ?? 'utama') === k ? 'true' : 'false',
          disabled: k === 'sensitivitas' && !eks.label_alert_sensitivitas,
          onclick: () => { state.eksLabel = k; renderEksperimen(); },
        }, label)));
    // Definisi diambil apa adanya dari scripts/llm/score.js: label alert menentukan benar atau
    // salahnya putusan, dan putusan "dipertahankan" mencakup uncertain.
    const penjelasan = el('div', { class: 'eks-kartu-baris' },
      kartuPenjelasan('ok', 'Identified FP', 'Alert berlabel false positive yang memang ditolak model.'),
      kartuPenjelasan('crit', 'Missed FP', 'Alert berlabel false positive yang justru dipertahankan model.'),
      kartuPenjelasan('high', 'Mis-identified FP', 'Alert nyata yang keliru ditolak model.'),
      kartuPenjelasan('ok', 'Correct retention', 'Alert nyata yang tepat dipertahankan model.'));
    return blokEks('02', 'Verifikasi empat kategori', 'FP sebagai kelas positif',
      'FP diperlakukan sebagai kelas positif. Putusan uncertain dihitung sebagai alert yang dipertahankan, bukan kegagalan. '
      + 'Label alert menentukan benar atau salahnya putusan, dan hanya memengaruhi tabel ini, bukan Skenario A, B, atau C.',
      el('div', { class: 'eks-isi' }, penjelasan, pilih, tabel(kepala, baris, 'Tabel verifikasi empat kategori')),
      `Sumber: ${pakaiSens ? (eks.sumber.skor_sensitivitas ?? '—') : eks.sumber.skor_utama}`);
  };

  const eksTabelItem = (eks) => {
    const vendor = eks.per_model.map((m) => m.vendor);
    const kepala = ['Item', 'Kelas', 'Klasifikasi', 'Sonar A', 'Sonar B', ...vendor.flatMap((v) => [`${labelVendor(v)} B`, `${labelVendor(v)} C`])];
    const sel = (x) => (x ? `${x.ketat ?? 0}/${x.dari ?? 0}` : '—');
    const baris = (eks.tabel_per_item ?? []).map((t) => [
      t.id, t.kelas ?? '—', t.klasifikasi ?? '—', t.sonar_a ?? '—', t.sonar_b ?? '—',
      ...vendor.flatMap((v) => [sel(t.per_model?.[v]?.skenario_b), sel(t.per_model?.[v]?.skenario_c)]),
    ]);
    return blokEks('03', 'Tabel per item seeded', `${(eks.tabel_per_item ?? []).length} item ground truth`,
      'Satu baris per item ground truth di SEEDED.md. Angka model berbentuk "run cocok ketat / jumlah run".',
      tabel(kepala, baris, 'Tabel per item seeded'),
      `Sumber: ${eks.sumber.skor_utama} · objek uji ${pendek(eks.sumber.objek_uji_commit ?? '')}`);
  };

  const eksBiaya = (eks) => {
    const kepala = ['Model', 'Run', 'Biaya run', 'Total vendor'];
    const baris = [];
    for (const m of eks.per_model) {
      const total = m.runs.reduce((s, r) => s + (r.biaya_usd ?? 0), 0);
      m.runs.forEach((r, i) => baris.push([i === 0 ? labelVendor(m.vendor) : '', String(r.run), usd(r.biaya_usd),
        i === 0 ? usd(m.biaya_total_usd ?? total) : '']));
    }
    const adaBiaya = baris.some((r) => r[2] !== '—');
    return blokEks('04', 'Biaya per run dan per vendor', 'Dari metadata usage tiap panggilan',
      'Dari metadata usage tiap panggilan. Percobaan yang ditolak sebelum diproses tidak mengembalikan usage, jadi biayanya tidak tercatat.',
      adaBiaya ? tabel(kepala, baris, 'Tabel biaya per run dan per vendor')
        : el('p', { class: 'note', text: 'Biaya per run tidak tersedia di berkas skor; lihat kartu Biaya pada tiap run di tab Operasional.' }),
      `Sumber: ${eks.sumber.skor_utama}`);
  };

  const renderEksperimen = () => {
    const eks = state.hasil?.eksperimen;
    const panel = $('panel-eksperimen');
    if (!eks) {
      isi(panel, el('div', { class: 'state' }, el('p', { text: 'Run ini tidak memuat blok eksperimen.' })));
      return;
    }
    isi(panel, eksSkenario(eks), eksVerifikasi(eks), eksTabelItem(eks), eksBiaya(eks));
    tandaiGulir();
  };



  // Ekspor dan impor catatan lokal. Satu-satunya jalan memindahkan catatan antar browser atau perangkat,
  // karena catatan sengaja tidak dikirim ke mana pun.
  const eksporCatatan = () => {
    const isiFile = JSON.stringify({
      versi: 1, project: `${state.proyek.owner}/${state.proyek.repo}`,
      diekspor: new Date().toISOString(), keputusan: state.keputusan,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([isiFile], { type: 'application/json' }));
    const a = el('a', { href: url, download: `catatan-${state.proyek.repo}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const imporCatatan = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const masuk = data?.keputusan;
      if (!masuk || typeof masuk !== 'object' || Array.isArray(masuk)) throw new Error('bentuk tidak dikenali');
      let n = 0;
      for (const [fp, nilai] of Object.entries(masuk)) {
        // Hanya terima bentuk yang kita tulis sendiri; isi berkas dari luar tidak dipercaya.
        if (!/^[0-9a-f]{16}$/.test(fp) || !['ok', 'fp'].includes(nilai?.v)) continue;
        state.keputusan[fp] = { v: nilai.v, t: typeof nilai.t === 'string' ? nilai.t : new Date().toISOString() };
        n += 1;
      }
      store.set('localStorage', kunciKeputusanV2(), JSON.stringify(state.keputusan));
      $('catatan-info').textContent = `${n} catatan diimpor. Hanya di browser ini, tidak tersinkron.`;
      renderRingkasanV2();
      renderTemuanV2();
      if (state.terbuka) renderDetailTemuan();
    } catch (err) {
      $('catatan-info').textContent = `Berkas catatan tidak bisa dibaca (${err.message}).`;
    }
  };

  const renderSemuaV2 = () => {
    $('catatan-alat').hidden = false;
    // Run v2 bisa berasal dari CLI (tanpa pipeline) atau dari workflow (punya status job).
    // Tanpa data pipeline, panel gelapnya hanya ruang kosong berisi satu kalimat; keterangannya
    // pindah ke metadata kepala run, tempat fakta run lain berada.
    const adaPipeline = Boolean(state.jobs || state.hasil.run.pipeline);
    renderKepalaV2();
    $('pipeline-box').hidden = !adaPipeline;
    if (adaPipeline) renderPipeline();
    renderRingkasanV2();
    if (!FILTER_V2.some((x) => x.key === state.filter)) state.filter = 'semua';
    renderFilterV2();
    renderTemuanV2();
    renderAlertV2();
    renderSampingV2();
    renderRingkasSingkat();
    renderPenandaRunLama();
    renderLabelGabungan();
    renderLabelContoh();
    // Tampilan yang sedang dibuka dipertahankan saat run berganti; kalau tidak berlaku untuk run
    // ini (misalnya Eksperimen pada run tanpa blok eksperimen), router menggesernya ke Ringkasan.
    terapkanTampilan(state.diminta ?? bacaTampilan() ?? TAMPILAN_BAWAAN, { pindahFokus: false });
    perbaruiTombolJalankan();
  };

  // Skema 1 tidak lagi dirender. Berkasnya tetap sah, hanya tidak punya tempat di dashboard ini:
  // status alert di skema 1 berasal dari pencocokan, bukan putusan model, sehingga kolom yang sama
  // akan berarti lain tergantung run.
  const renderArsipV1 = () => {
    $('pipeline-box').hidden = false;
    $('summary').hidden = true;
    $('alerts-box').hidden = true;
    $('catatan-alat').hidden = true;
    $('railnav-box').hidden = true;
    isi($('filters'));
    isi($('alur'));
    isi($('alur-teks'));
    $('alur-langkah').hidden = true;
    $('pipeline-title').textContent = 'Alur eksekusi pipeline';
    $('pipeline-total').textContent = '';
    $('run-title').textContent = 'Format v1 (arsip pilot 10 Oktober), tidak lagi ditampilkan';
    isi($('crumb'));
    isi($('title-block'));
    isi($('findings-body'), el('div', { class: 'state' },
      el('p', { text: 'Run ini memakai results.json skema 1. Dashboard sekarang membaca skema 2, tempat status tiap alert berasal dari putusan verifikasi model, bukan dari pencocokan file, baris, dan CWE.' }),
      el('p', { class: 'note', text: 'Datanya tetap disimpan apa adanya sebagai arsip, beserta penjelasan mengapa dipensiunkan.' }),
      el('a', { class: 'btn-text', href: 'https://github.com/MIlhamRidhoP/TA-ssdlc-devops-akademik/tree/main/docs/arsip/pilot-20261010', target: '_blank', rel: 'noopener noreferrer', text: 'Buka arsip pilot 10 Oktober 2026' })));
    isi($('history'), el('p', { class: 'note', text: 'Riwayat tidak ditampilkan untuk arsip skema 1.' }));
    perbaruiTombolJalankan();
  };

  const renderSemua = () => {
    if (skemaLlm(state.hasil)) return renderSemuaV2();
    renderArsipV1();
  };

  // ---------- Menjalankan analisis ----------
  const hentikanPantau = () => {
    if (state.pantau) state.pantau.batal = true;
    state.pantau = null;
    // Pita dan awalan ikut hilang: pindah proyek, pindah mode, atau token dihapus berarti yang
    // tampil di bawah bukan lagi "hasil terakhir" dari run yang dipantau tadi.
    selesaiPantau({ awalan: false });
    if (state.sibuk) { state.sibuk = false; if (state.proyek) perbaruiTombolJalankan(); }
  };


  const linkRun = (url, teks) => (typeof url === 'string' && url.startsWith('https://github.com/')
    ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, teks, ' ', ikon(IKON.luar))
    : teks);

  const jalankan = async (e) => {
    e.preventDefault();
    if (state.sibuk || alasanTidakBisa() || alasanFormBelumSiap()) return;
    const mode = modeTerpilih();
    const jalur = jalurTerpilih();
    // Mode SAST saja melewati job jalur v1, yang memvalidasi input model terhadap daftar v1.
    // Mengirim id model v2 di sana membuat job gagal pada langkah validasi.
    const model = jalur === 'v2' ? $('f-model').value : modelV1Bawaan();
    const p = state.proyek;
    const branch = branchJalan().name;
    const pantau = { batal: false };
    state.pantau = pantau;
    state.sibuk = true;
    const node = nodeJalur(jalur);
    const awal = Object.fromEntries(node.map((n) => [n.key, { s: 'wait', durasi: null }]));
    const skenario = skenarioTerpilih();
    // Model yang ditampilkan di pita. Mode gabungan tidak punya satu model, jadi yang disebut
    // modenya sendiri.
    const modelPita = jalur === 'v2'
      ? (modeModelTerpilih() === 'gabungan' ? 'gabungan' : labelModelId(model))
      : labelModelId(model);
    // Begitu analisis berjalan, fokus pindah ke melihat: drawer ditutup supaya pipeline terlihat.
    if (!$('drawer').hidden) tutupDrawer();
    pantauMulai = Date.now();
    pantauLive(buatLive({ mode, jalur, skenario, jobs: awal, model: modelPita, demo: state.demo }));
    perbaruiTombolJalankan(state.demo ? 'Simulasi dimulai.' : 'Mengirim permintaan ke GitHub…');
    try {
      if (state.demo) await simulasi({ mode, jalur, skenario, model: modelPita, pantau });
      else await dispatchLive(p, branch, mode, model, pantau, jalur, { modelPita });
    } catch (err) {
      if (pantau.batal) return;
      state.sibuk = false;
      // Pemantauan berhenti, tetapi awalan "Hasil terakhir" tetap ada: yang tampil di bawah memang
      // hasil run sebelumnya, bukan hasil run yang barusan gagal.
      selesaiPantau();
      const pesan = pesanGalat(err);
      perbaruiTombolJalankan(pesan, 'error');
      // #run-hint hidup DI DALAM drawer, dan drawer sudah ditutup beberapa baris di atas supaya
      // graf pipeline terlihat. Jadi menulis galat ke sana saja berarti menulisnya ke tempat yang
      // tidak dilihat siapa pun: dispatch yang ditolak 422 tampak seolah tidak terjadi apa-apa.
      // Banner adalah satu-satunya tempat yang pasti terlihat di semua tampilan.
      // Judul hanya boleh menyebut 'tidak jadi dijalankan' kalau runnya memang tidak pernah ada.
      // Galat yang terjadi SESUDAH run dibuat membawa judulnya sendiri yang menyebut keadaan
      // sebenarnya; run yang berhasil pernah dilaporkan 'tidak jadi dijalankan' karena judul ini
      // ditulis tetap.
      const judul = err?.judul ?? 'Run tidak jadi dijalankan.';
      // Tautan log hanya ada kalau job yang gagal benar-benar diketahui dari data jobs yang sudah
      // diambil. Tanpa itu tidak ada tautan sama sekali: menebak idnya menghasilkan 404.
      const tautanLog = err?.logUrl
        ? el('p', {}, linkRun(err.logUrl, err.logNama ? `Lihat log: ${err.logNama}` : 'Lihat log'))
        : null;
      tampilBanner('error', `${judul} ${pesan}`, {
        label: 'Buka drawer lagi',
        fn: () => { tutupBanner('error'); bukaDrawer(); },
      }, tautanLog);
      return;
    }
  };

  const simulasi = async ({ mode, jalur, skenario, model, pantau }) => {
    const node = nodeJalur(jalur);
    const jobs = Object.fromEntries(node.map((n) => [n.key, { s: 'wait', durasi: null }]));
    const lama = { rencana: 3, build: 104, sonar: 51, analisis: 241, 'analisis-v2': 219, hasil: 22 };
    if (mode === 'sast') { lama.analisis = 9; lama['analisis-v2'] = 9; }
    // Mode demo memakai pembentuk live yang sama dengan mode live, jadi perilaku pita, judul graf,
    // dan label node identik. Bedanya hanya `demo: true` dan tidak adanya id serta nomor run.
    const live = (status) => buatLive({ mode, jalur, skenario, jobs, model, status, demo: true });
    for (const n of node) {
      if (pantau.batal) return;
      jobs[n.key] = { s: 'run', durasi: null };
      pantauLive(live('berjalan'));
      perbaruiTombolJalankan(`Simulasi: ${n.key === 'analisis' && mode === 'sast' ? 'Ambil temuan Sonar' : n.nama} berjalan.`);
      await tunggu(1100);
      jobs[n.key] = { s: 'done', durasi: lama[n.key] };
      pantauLive(live('berjalan'));
    }
    if (pantau.batal) return;
    state.sibuk = false;
    state.pantau = null;
    pantauLive(live('selesai'));
    // Simulasi tidak menghasilkan run baru, jadi yang tampil di bawah memang tetap hasil lama.
    setTimeout(() => { if (!state.live || state.live.status === 'selesai') selesaiPantau(); }, 6000);
    const arsip = state.proyek.branches.find((b) => !b.dispatch);
    perbaruiTombolJalankan(el('span', {}, 'Simulasi selesai. Mode demo tidak membuat hasil baru. ',
      arsip ? el('button', { class: 'btn-text', type: 'button', text: `Lihat contoh hasil di ${arsip.name}`, onclick: () => { state.branch = arsip; renderRailBranch(); muatIndex(); } }) : null));
  };

  // Satu-satunya tempat yang menyusun isi dispatch. Dipisahkan sebagai fungsi murni supaya bisa
  // diuji langsung terhadap daftar input dan daftar opsi di .github/workflows/devsecops.yml, tanpa
  // browser dan tanpa menyentuh GitHub.
  //
  // Aturan yang paling mudah dilanggar ada di sini: input `model` adalah choice berisi daftar model
  // JALUR V1 saja. Jalur v2 memilih vendornya lewat vendor_v2 dan tidak mengirim `model` sama
  // sekali. Mengirim id model v2 ke input itu membuat GitHub menolak SELURUH dispatch dengan 422
  // sebelum satu pun job berjalan; pernah terjadi untuk anthropic dan openai, yang id modelnya
  // memang tidak ada di daftar v1.
  const susunInputDispatch = ({
    mode, jalur, skenario, label, model, vendor, gabungan,
    rekomendasiAi, vendorRekomendasi, sonarBranch,
  }) => {
    const inputs = { mode, label, jalur, skenario };
    if (jalur !== 'v2') {
      inputs.model = model;
      return inputs;
    }
    // rekomendasi_ai hanya berarti di jalur v2: langkah remediasi hidup di job terbit-v2.
    // Mengirimnya di jalur v1 cuma menambah input yang tidak pernah dibaca siapa pun.
    Object.assign(inputs, {
      vendor_v2: gabungan ? 'gabungan' : vendor,
      konfirmasi_v2: 'JALANKAN',
      sonar_branch_v2: sonarBranch,
      rekomendasi_ai: Boolean(rekomendasiAi),
    });
    // Workflow mengabaikan input ini di mode tunggal maupun saat rekomendasi tidak diminta.
    // Mengirimnya hanya saat berarti membuat body dispatch bisa dibaca sebagai catatan apa yang
    // sebenarnya diminta, bukan sebagai daftar input yang sebagian tidak berpengaruh.
    if (gabungan && inputs.rekomendasi_ai) inputs.vendor_rekomendasi = vendorRekomendasi;
    return inputs;
  };

  // Paket Free SonarCloud hanya menganalisis main, jadi run di branch lain memakai analisis main.
  // Kecocokannya dijamin pemeriksaan hash tree src/ di workflow, bukan oleh nama branch.
  const sonarBranchV2 = (branch) => (branch === 'main' ? 'ikut-branch-run' : 'main');

  const dispatchLive = async (p, branch, mode, model, pantau, jalur, { modelPita } = {}) => {
    const label = `sd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dikirim = Date.now();
    // Dispatch memakai workflow di branch tujuan; branch yang belum di-push menghasilkan 422 yang membingungkan.
    try {
      await gh(`${repoPath(p)}/branches/${branch.split("/").map(enc).join("/")}`);
    } catch (err) {
      if (err.jenis === 'notfound') throw new GhError('invalid', `Branch ${branch} belum ada di GitHub. Push branch itu dulu, lalu jalankan lagi.`);
      throw err;
    }
    // Tampilan pindah ke branch tujuan run: yang dipantau dan yang dibaca harus sama, kalau tidak
    // pengguna menunggu hasil di halaman branch lain.
    const tujuan = p.branches.find((b) => b.name === branch);
    if (tujuan && state.branch !== tujuan) {
      state.branch = tujuan;
      renderRailBranch();
      await muatIndex();
      state.sibuk = true;
    }
    // Dibaca dari form di sini, sama seperti rekomendasi_ai di bawah: drawer yang sudah ditutup
    // hanya tersembunyi, nilainya masih utuh, dan baru di-reset saat drawer dibuka lagi.
    const skenario = skenarioTerpilih();
    const gabungan = modeModelTerpilih() === 'gabungan';
    // Mode gabungan tidak memilih satu model, jadi id modelnya tidak perlu dikenali. Mode tunggal
    // harus: id yang tidak ada di daftar berarti daftar modelnya rusak, dan itu lebih baik
    // ketahuan di sini daripada jadi dispatch yang ditolak GitHub.
    const m = (jalur === 'v2' && !gabungan) ? modelJalur().find((x) => x.id === model) : null;
    if (jalur === 'v2' && !gabungan && !m) throw new GhError('invalid', 'Model jalur v2 tidak dikenali. Muat ulang dashboard lalu coba lagi.');
    if (jalur !== 'v2' && !model) throw new GhError('invalid', 'Daftar model tidak terbaca dari models.json. Muat ulang dashboard lalu coba lagi.');

    const inputs = susunInputDispatch({
      mode, jalur, skenario, label, model,
      vendor: m?.vendor ?? null,
      gabungan,
      rekomendasiAi: $('f-rekomendasi').checked,
      vendorRekomendasi: vendorRekomendasiTerpilih()?.vendor ?? 'google',
      sonarBranch: sonarBranchV2(branch),
    });
    await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}/dispatches`, { method: 'POST', body: { ref: branch, inputs } });
    perbaruiTombolJalankan('Permintaan diterima. Menunggu GitHub membuat run…');
    pantauLive(buatLive({ mode, jalur, skenario, model: modelPita, jobs: state.live?.jobs ?? {}, status: 'menunggu' }));

    let run = null;
    for (let i = 0; i < BATAS_CARI_RUN && !run; i++) {
      if (pantau.batal) return;
      await tunggu(JEDA_CARI_RUN);
      const data = await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}/runs?event=workflow_dispatch&branch=${enc(branch)}&per_page=20`);
      run = (data.workflow_runs || []).find((r) => typeof r.display_title === 'string' && r.display_title.includes(`[${label}]`) && Date.parse(r.created_at) >= dikirim - 60000) ?? null;
    }
    // Dispatch sudah diterima GitHub (204), jadi runnya mungkin ada tetapi belum terlihat, bukan
    // pasti tidak pernah dibuat. Judulnya menyebut persis sebanyak yang diketahui.
    if (!run) {
      throw new GhError('hasil', 'Permintaan sudah diterima GitHub, tetapi runnya belum muncul setelah 90 detik. Periksa tab Actions di repo itu; antrean runner mungkin penuh.',
        { judul: 'Run belum terlihat di GitHub.' });
    }

    let jobTerakhir = [];
    while (!pantau.batal) {
      const [dataJobs, info] = await Promise.all([gh(`${repoPath(p)}/actions/runs/${run.id}/jobs?per_page=50`), gh(`${repoPath(p)}/actions/runs/${run.id}`)]);
      if (pantau.batal) return;
      jobTerakhir = dataJobs.jobs || [];
      pantauLive(buatLive({
        mode, jalur, skenario, model: modelPita,
        id: run.id, nomor: info.run_number, url: info.html_url,
        jobs: jobsDariApi(jobTerakhir, nodeJalur(jalur)),
        status: info.status === 'completed' ? 'menunggu-hasil' : 'berjalan',
      }));
      perbaruiTombolJalankan(el('span', {}, linkRun(info.html_url, `Run #${info.run_number}`), info.status === 'completed' ? ' selesai.' : ' berjalan.'));
      if (info.status === 'completed') { run = info; break; }
      await tunggu(JEDA_JOB);
    }
    if (pantau.batal) return;

    pantauLive(buatLive({
      mode, jalur, skenario, model: modelPita,
      id: run.id, nomor: run.run_number, url: run.html_url,
      jobs: state.live?.jobs ?? {}, status: 'menunggu-hasil',
    }));
    perbaruiTombolJalankan(el('span', {}, linkRun(run.html_url, `Run #${run.run_number}`), ' selesai. Menunggu hasil diterbitkan…'));
    for (let i = 0; i < BATAS_TUNGGU_HASIL; i++) {
      if (pantau.batal) return;
      const index = await sumberLive.index(p);
      if ((index.runs || []).some((x) => x.id === run.id)) {
        state.sibuk = false;
        state.pantau = null;
        await muatIndex(run.id);
        // Hasil run ini sudah tampil di bawah, jadi awalan "Hasil terakhir" tidak berlaku lagi.
        state.awalanHasilTerakhir = false;
        pantauLive(buatLive({
          mode, jalur, skenario, model: modelPita,
          id: run.id, nomor: run.run_number, url: run.html_url,
          jobs: state.live?.jobs ?? {}, status: 'selesai',
        }));
        setTimeout(() => { if (state.live?.status === 'selesai') selesaiPantau({ awalan: false }); }, 6000);
        const llmGagal = (state.hasil?.run?.status_panggilan?.error ?? 0) > 0 || state.hasil?.run?.gemini?.status === 'gagal';
        perbaruiTombolJalankan(el('span', {}, linkRun(run.html_url, `Run #${run.run_number}`), ` selesai (${run.conclusion === 'success' ? 'berhasil' : run.conclusion}). Hasil sudah dimuat.${llmGagal ? ' Panggilan LLM gagal, lihat catatan di daftar temuan.' : ''}`));
        return;
      }
      await tunggu(JEDA_HASIL);
    }
    throw await galatHasilTakAda(p, run, jalur, jobTerakhir);
  };

  // Hasil tidak muncul di index.json bisa berarti tiga hal yang sangat berbeda, dan menyebut
  // semuanya dengan kalimat yang sama pernah membuat run yang BERHASIL dilaporkan sebagai "tidak
  // jadi dijalankan". Keadaannya ditanyakan ulang ke GitHub di sini, bukan ditebak dari apa yang
  // terakhir diketahui, karena run bisa berubah keadaan selama dashboard menunggu hasilnya terbit.
  const galatHasilTakAda = async (p, run, jalur, jobs = []) => {
    let info = run;
    try { info = await gh(`${repoPath(p)}/actions/runs/${run.id}`); } catch { info = run; }
    const nomor = info.run_number ?? run.run_number;
    const url = info.html_url ?? run.html_url;

    // 1. Run gagal atau dibatalkan: wajar hasilnya tidak ada, dan yang perlu dibuka adalah lognya.
    if (info.status === 'completed' && info.conclusion !== 'success') {
      const kata = { failure: 'gagal', cancelled: 'dibatalkan', timed_out: 'kehabisan waktu', action_required: 'menunggu persetujuan' }[info.conclusion] ?? info.conclusion;
      // Job pertama yang benar-benar gagal, dari daftar job yang SUDAH diambil selama pemantauan.
      // Idnya dipasangkan dengan run.id milik run itu juga; memakai id run lain menghasilkan 404.
      // Penyebabnya tidak ditebak di sini, hanya ditunjukkan di mana lognya.
      const gagal = (jobs ?? []).find((j) => j.conclusion && !['success', 'skipped'].includes(j.conclusion));
      return new GhError('hasil', `Run #${nomor} ${kata}, jadi tidak ada hasil yang diterbitkan. Buka lognya di GitHub untuk melihat job mana yang berhenti.`,
        { judul: `Run #${nomor} ${kata}.`, logUrl: urlJobGh(p, run.id, gagal?.id), logNama: gagal?.name ?? null });
    }

    // 2. Run belum selesai: bukan kegagalan, hanya belum waktunya.
    if (info.status !== 'completed') {
      return new GhError('hasil', `Run #${nomor} masih berjalan. Hasilnya akan muncul sendiri setelah job penerbitnya selesai; halaman ini bisa dimuat ulang nanti.`,
        { judul: `Run #${nomor} masih berjalan.` });
    }

    // 3. Run berhasil tetapi hasilnya tidak ada di index.json. Sebab yang paling sering: hasilnya
    //    terbit sebagai skema 1, yang punya index sendiri dan memang tidak dibaca dashboard ini.
    const jobTerbit = jalur === 'v2' ? 'Gabung dan terbitkan hasil v2' : 'Gabung dan terbitkan hasil';
    const sebabV1 = jalur === 'v2' ? '' : ' Jalur v1 menerbitkan skema 1 ke index-v1.json, dan dashboard ini hanya membaca skema 2 dari index.json.';
    return new GhError('hasil',
      `Run #${nomor} berhasil, tetapi hasilnya tidak ada di index.json pada branch security-results.${sebabV1} Periksa log job "${jobTerbit}" di GitHub: mungkin job itu dilewati, atau penerbitannya berhenti.`,
      { judul: `Run #${nomor} berhasil, tetapi hasilnya tidak muncul di dashboard.` });
  };

  // ---------- Mulai ----------
  const ikat = () => {
    $('token-form').addEventListener('submit', simpanToken);
    $('token-clear').addEventListener('click', hapusToken);
    $('density-toggle').addEventListener('click', () => {
      store.set('localStorage', KUNCI.padat, document.documentElement.dataset.density === 'padat' ? 'nyaman' : 'padat');
      terapkanKepadatan();
    });
    $('demo-toggle').addEventListener('click', () => (state.demo ? keluarDemo() : masukDemo()));
    $('rail-toggle').addEventListener('click', () => terapkanRail(document.documentElement.dataset.rail !== 'buka'));
    $('rail-tirai').addEventListener('click', () => terapkanRail(false));
    $('rail-tutup').addEventListener('click', () => terapkanRail(false));
    $('repo-pilih').addEventListener('click', () => bukaDaftarRepo($('repo-pilih').getAttribute('aria-expanded') !== 'true'));
    $('token-aksi').addEventListener('click', () => { $('access').open = true; $('token-input').focus(); });
    // Rail berhenti menjadi panel begitu jendela melebihi ambang kolom tetap; kurungan fokus yang
    // ikut tertinggal akan memerangkap Tab di dalam rail yang justru sudah tidak modal lagi.
    window.matchMedia('(min-width: 64rem)').addEventListener('change', (e) => {
      if (e.matches) lepasPanel($('rail-isi'));
    });
    // Tanpa pembungkus, objek Event ikut terkirim sebagai argumen `pesan` dan tercetak di hint.
    $('f-konfirmasi-v2').addEventListener('change', () => perbaruiTombolJalankan());
    $('f-model').addEventListener('change', renderBiaya);
    // renderDrawer, bukan renderBiaya: mencentang rekomendasi di mode gabungan juga memunculkan
    // pilihan vendor penyusunnya.
    $('f-rekomendasi').addEventListener('change', renderDrawer);
    $('buka-drawer').addEventListener('click', bukaDrawer);
    $('drawer-tutup').addEventListener('click', tutupDrawerAktif);
    $('drawer-tirai').addEventListener('click', tutupDrawerAktif);
    $('temuan-tutup').addEventListener('click', tutupDrawerAktif);
    $('run-batal').addEventListener('click', tutupDrawerAktif);
    $('drawer-temuan-tirai').addEventListener('click', tutupDrawerAktif);
    // Tautan "Lihat semua" di Ringkasan.
    for (const b of document.querySelectorAll('[data-ke]')) {
      b.addEventListener('click', () => pergiKe(b.dataset.ke));
    }
    // Back dan Forward: hash berubah tanpa klik, tampilan harus ikut.
    window.addEventListener('hashchange', () => terapkanTampilan(bacaTampilan() ?? TAMPILAN_BAWAAN));
    window.addEventListener('popstate', () => terapkanTampilan(bacaTampilan() ?? TAMPILAN_BAWAAN));
    // Lewati navigasi: memindahkan fokus ke tampilan yang sedang terbuka, tanpa mengubah alamat.
    $('skip').addEventListener('click', (e) => {
      e.preventDefault();
      const info = NAV.find((x) => x.key === state.tampilan) ?? NAV[0];
      const n = $(info.fokus);
      if (n && !n.hidden) n.focus();
    });
    $('catatan-ekspor').addEventListener('click', eksporCatatan);
    $('catatan-impor-btn').addEventListener('click', () => $('catatan-impor').click());
    $('catatan-impor').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) imporCatatan(f);
      e.target.value = '';
    });
    $('start-demo').addEventListener('click', () => masukDemo());
    $('start-token').addEventListener('click', () => { $('access').open = true; $('token-input').focus(); });
    $('f-branch-lihat').addEventListener('change', (e) => {
      const b = state.proyek.branches.find((x) => x.name === e.target.value);
      if (!b) return;
      state.branch = b;
      state.filter = 'semua';
      muatIndex();
    });
    $('f-branch').addEventListener('change', (e) => {
      const b = state.proyek.branches.find((x) => x.name === e.target.value);
      if (!b) return;
      state.branchJalan = b;
      renderDrawer();
    });
    document.querySelectorAll('input[name="skenario"], input[name="mode_model"]').forEach((r) => r.addEventListener('change', () => {
      renderDrawer();
      if (!state.sibuk && !state.hasil) renderPipeline();
    }));
    $('f-vendor-rekomendasi').addEventListener('change', renderBiaya);
    $('run-form').addEventListener('submit', jalankan);
    window.addEventListener('offline', () => tampilBanner('error', 'Koneksi internet terputus. Pemantauan run berhenti sampai koneksi kembali.'));
    window.addEventListener('online', () => tutupBanner('error'));
  };

  // Perisai digambar sendiri sebagai SVG inline: bukan logo merek mana pun, dan tidak menambah
  // satu pun permintaan jaringan.
  const pasangIkonTetap = () => {
    $('brand-lambang').replaceChildren(ikon(IKON.perisai));
    $('branch-ikon').replaceChildren(ikon(IKON.cabang));
    $('akses-ikon').replaceChildren(ikon(IKON.kunci));
  };

  const mulai = async () => {
    pasangIkonTetap();
    terapkanTema();
    terapkanKepadatan();
    terapkanRail(false);
    muatToken();
    ikat();
    await muatModels();
    await muatPanduan();
    renderModels();
    renderAkses(state.token ? 'ok' : 'none', state.token ? teksTokenAktif() : 'Belum ada token');
    $('token-remember').checked = state.tokenDiingat;
    if (location.protocol === 'file:') {
      tampilBanner('error', 'Dashboard dibuka langsung dari file. Jalankan lewat server lokal (lihat README) supaya projects.json dan mode demo bisa dibaca.');
    }
    // #demo dan #demo-v2 pernah menjadi pintu masuk mode demo, sebelum hash dipakai sebagai
    // alamat tampilan. Keduanya tetap diterima lalu ditulis ulang ke bentuk baru, supaya tautan
    // dan pintasan yang sudah beredar tidak putus.
    const aliasDemo = ['#demo', '#demo-v2'].includes(location.hash);
    if (aliasDemo) history.replaceState(null, '', `${location.pathname}?demo#${TAMPILAN_BAWAAN}`);
    // Alamat dinormalkan sejak awal: hash kosong atau tidak dikenal menjadi #ringkasan, sehingga
    // muat ulang selalu mendarat di tampilan yang sama dengan yang terlihat.
    pergiKe(bacaTampilan() ?? TAMPILAN_BAWAAN, { ganti: true, pindahFokus: false });
    if (aliasDemo || demoDiUrl()) masukDemo();
    else if (state.token) masukLive();
    else tampilStart();
  };

  mulai();
})();
