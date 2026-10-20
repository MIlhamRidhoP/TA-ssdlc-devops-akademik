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
  // Saat run sudah dimuat, jalurnya ditentukan isi hasil; saat menyiapkan run baru, oleh form.
  const jalurAktif = (live) => live?.jalur
    ?? (state.hasil ? (state.hasil.schema_version === 2 ? 'v2' : 'v1') : jalurTerpilih());
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
    nav: 'ringkasan',
    tab: 'operasional',
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
      case 'unprocessable': return 'Workflow menolak permintaan (422). Biasanya devsecops.yml di branch ini belum memuat input mode, model, dan label; perubahan workflow perlu di-push atau di-merge ke branch tersebut.';
      case 'network': return 'Tidak bisa terhubung ke GitHub. Periksa koneksi internet, lalu coba lagi.';
      case 'lokal': case 'format': case 'invalid': return err.message;
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
    if (res.status === 422) throw new GhError('unprocessable', '422', { status: 422 });
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

  const repoPath = (p) => `/repos/${enc(p.owner)}/${enc(p.repo)}`;
  const contentsPath = (p, file) => `${repoPath(p)}/contents/${file.split('/').map(enc).join('/')}?ref=${enc(BRANCH_HASIL)}`;

  // Dashboard membaca dua skema: 1 (jalur Gemini lama) dan 2 (jalur prompt v2, alert diverifikasi model).
  // schema_version yang dikenali tidak lagi dilempar sebagai galat format; yang tidak dikenali tetap ditolak.
  const SKEMA_DIDUKUNG = [1, 2];
  const validasiHasil = (r) => {
    const v = r?.schema_version;
    const salah = (sebab) => {
      throw new GhError('format', `Format results.json tidak dikenali (${sebab}). Dashboard ini membaca skema versi ${SKEMA_DIDUKUNG.join(' dan ')}.`);
    };
    if (!r || !SKEMA_DIDUKUNG.includes(v) || !r.run) salah(`schema_version ${v ?? 'tidak ada'}`);
    if (v === 1 && (!Array.isArray(r.findings) || !r.sonar_verification)) salah('skema 1 tanpa findings atau sonar_verification');
    if (v === 2 && (!Array.isArray(r.findings) || !Array.isArray(r.alerts))) salah('skema 2 tanpa findings atau alerts');
    return r;
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
  const statusJobApi = (job) => {
    if (!job) return { s: 'wait', durasi: null, langkah: null, id: null };
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

  const jobsDariApi = (daftar, node = nodeJalur(jalurAktif())) => Object.fromEntries(node.map((n) => [n.key, statusJobApi(daftar.find((j) => j.name === n.job))]));

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
    index: async (p) => {
      try {
        return await gh(contentsPath(p, 'index.json'), { raw: true });
      } catch (err) {
        if (err.jenis === 'notfound') return { runs: [] };
        throw err;
      }
    },
    hasil: async (p, entri) => {
      if (!pathAman(entri.path)) throw new GhError('format', 'Path hasil di index.json tidak valid.');
      return validasiHasil(await gh(contentsPath(p, entri.path), { raw: true }));
    },
    jobs: async (p, runId) => {
      try {
        const data = await gh(`${repoPath(p)}/actions/runs/${enc(runId)}/jobs?per_page=50`);
        return { jobs: jobsDariApi(data.jobs || []), rekaman: null };
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
    index: async (p) => (p.demo_tanpa_workflow ? { runs: [] } : jsonLokal(`${basisDemo()}/index.json`)),
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
      return { jobs: jobsDariApi(r.jobs), rekaman: r.run };
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
  const tampilBanner = (jenis, teks, aksi) => {
    const b = $('banner');
    state.banner = jenis;
    b.dataset.kind = jenis;
    b.setAttribute('role', jenis === 'error' ? 'alert' : 'status');
    isi(b, el('p', { text: teks }), aksi ? el('button', { class: 'btn btn-sm', type: 'button', text: aksi.label, onclick: aksi.fn }) : null);
    b.hidden = false;
  };
  const tutupBanner = (jenis) => {
    if (jenis && state.banner !== jenis) return;
    $('banner').hidden = true;
    state.banner = null;
    if (state.demo) bannerDemo();
  };
  const bannerDemo = () => tampilBanner('demo',
    'Mode demo. Data eksperimen 19 Okt 2026 (eksperimen/seeded, commit 97cfb00): tiga vendor, satu run masing-masing, dijalankan dari CLI. '
    + 'Branch feat/prompt-v2 memuat rekaman run CI #54 yang benar-benar berjalan di GitHub Actions, lengkap dengan status tiap job.',
    { label: 'Keluar dari mode demo', fn: () => keluarDemo() });

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
    if (state.demo) { state.demo = false; history.replaceState(null, '', location.pathname + location.search); }
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
    if (location.hash !== '#demo') history.replaceState(null, '', '#demo');
    renderRailBawah();
    bannerDemo();
    await muatProjects();
  };

  const keluarDemo = () => {
    hentikanPantau();
    state.demo = false;
    history.replaceState(null, '', location.pathname + location.search);
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
      const urut = (index.runs ?? []).slice().sort((a, b) => String(b.selesai ?? '').localeCompare(String(a.selesai ?? '')));
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
    } catch {
      state.models = [];
    }
  };
  const modelJalur = () => state.models.filter((m) => m.jalur === 'v2');
  const modelTerpilih = () => modelJalur().find((x) => x.id === $('f-model').value) ?? null;
  // Mode SAST saja tetap melewati job jalur v1, yang memvalidasi input model terhadap daftar v1.
  const modelV1Bawaan = () => (state.models.find((m) => m.jalur === 'v1' && m.bawaan)
    ?? state.models.find((m) => m.jalur === 'v1'))?.id ?? '';

  const renderModels = () => {
    const daftar = modelJalur();
    const sel = $('f-model');
    const sebelum = sel.value;
    isi(sel, daftar.map((m) => el('option', { value: m.id, selected: m.bawaan ? true : null }, `${m.label} (${m.vendor})`)));
    if (daftar.some((m) => m.id === sebelum)) sel.value = sebelum;
    renderBiaya();
  };

  // Jumlah alert Sonar yang terakhir diketahui untuk branch ini, dari entri index run terbaru.
  const alertTerakhir = () => {
    const b = branchJalan();
    const n = (state.index?.runs ?? [])
      .filter((e) => e.branch === b?.name)
      .sort((a, c) => String(c.selesai ?? '').localeCompare(String(a.selesai ?? '')))[0]?.jumlah?.alert;
    return Number.isFinite(n) ? n : null;
  };
  // Biaya satu run = satu panggilan deteksi + satu panggilan verifikasi per alert, jadi naik
  // seiring jumlah alert. Angkanya ditarik lurus lewat titik ukur nyata di models.json, bukan
  // ditebak: dengan dua titik ukur biayanya bisa dihitung untuk jumlah alert mana pun; dengan satu
  // titik, yang jujur hanyalah menyebut titik itu apa adanya.
  const perkiraanBiaya = (m, jumlahAlert) => {
    const titik = (m?.biaya_terukur ?? [])
      .filter((x) => Number.isFinite(x.alert) && Number.isFinite(x.usd))
      .sort((a, b) => a.alert - b.alert);
    if (!titik.length) return null;
    const a = titik[0];
    const b = titik[titik.length - 1];
    if (titik.length < 2 || b.alert === a.alert) return { jenis: 'satu-titik', titik };
    if (jumlahAlert === null) return { jenis: 'rentang', titik };
    const usdHitung = a.usd + ((b.usd - a.usd) / (b.alert - a.alert)) * (jumlahAlert - a.alert);
    return { jenis: 'hitung', usd: Math.max(usdHitung, 0), alert: jumlahAlert, titik };
  };

  const renderBiaya = () => {
    const teks = $('biaya-perkiraan');
    const sumber = $('biaya-sumber');
    const m = modelTerpilih();
    if (!m) { teks.textContent = ''; sumber.textContent = ''; $('biaya-angka').textContent = ''; return; }
    const p = perkiraanBiaya(m, alertTerakhir());
    if (!p) {
      $('biaya-angka').textContent = '\u2014';
      teks.textContent = 'Biaya model ini belum pernah diukur.';
      sumber.textContent = 'Angka akan muncul setelah ada run yang biayanya tercatat.';
      return;
    }
    const a = p.titik[0];
    const b = p.titik[p.titik.length - 1];
    const angka = $('biaya-angka');
    if (p.jenis === 'hitung') {
      angka.textContent = usd(p.usd);
      teks.textContent = `Untuk ${p.alert} alert Sonar di branch tujuan run.`;
    } else if (p.jenis === 'satu-titik') {
      angka.textContent = usd(a.usd);
      teks.textContent = `Diukur pada ${a.alert} alert Sonar; belum ada titik ukur kedua, jadi angkanya belum ikut jumlah alert.`;
    } else {
      angka.textContent = `${usd(a.usd)} \u2013 ${usd(b.usd)}`;
      teks.textContent = `Jumlah alert branch tujuan belum diketahui: rentangnya ${a.alert} sampai ${b.alert} alert.`;
    }
    sumber.textContent = `Titik ukur: ${p.titik.map((x) => `${usd(x.usd)} pada ${x.alert} alert, ${x.sumber}`).join('; ')}. Perkiraan, bukan tarif.`;
  };

  // ---------- Form jalankan ----------
  const modeTerpilih = () => document.querySelector('input[name="mode"]:checked')?.value ?? 'sast-llm';

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
  const renderDrawer = () => {
    const llm = modeTerpilih() === 'sast-llm';
    $('mode-hint').textContent = llm
      ? 'Satu panggilan deteksi untuk seluruh kode, lalu satu panggilan verifikasi per alert SonarCloud.'
      : 'Tanpa panggilan LLM, tanpa biaya. Hasilnya terbit dalam format lama (skema 1) yang tidak ditampilkan dashboard ini.';
    $('model-field').hidden = !llm;
    $('biaya-field').hidden = !llm;
    $('konfirmasi-v2-field').hidden = !llm;
    if (!llm && $('f-konfirmasi-v2').checked) $('f-konfirmasi-v2').checked = false;
    renderFormBranch();
    renderModels();
    // Keterangan sumber analisis Sonar hanya relevan untuk branch yang memang bisa dijalankan.
    const bisa = state.proyek.branches.filter(branchSesuai).length;
    const semua = state.proyek.branches.filter((b) => b.dispatch).length;
    $('branch-meta').textContent = `${bisa} dari ${semua} bisa dipicu`;
    $('branch-hint').textContent = llm && branchSesuai(branchJalan()) && branchJalan()?.name !== 'main'
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
    .sort((a, b) => String(b.selesai ?? '').localeCompare(String(a.selesai ?? '')));

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
    $('tabs').hidden = true;
    $('railnav-box').hidden = true;
    $('panel-operasional').hidden = false;
    $('panel-eksperimen').hidden = true;
    isi($('panel-eksperimen'));
    isi($('alerts-ringkas'));
    isi($('alerts-body'));
    isi($('filters'));
    isi($('title-block'));
    isi($('run-status'));
    $('run-status').hidden = true;
    state.tab = 'operasional';
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
  const statusNodeDariHasil = () => {
    const pipeline = state.hasil?.run?.pipeline;
    if (!pipeline) return null;
    return Object.fromEntries(nodeJalur(jalurAktif()).map((n) => {
      if (!n.hasil) return [n.key, { s: 'done', durasi: null }];
      const v = pipeline[n.hasil];
      return [n.key, { s: { success: 'done', skipped: 'skip', failure: 'fail', cancelled: 'fail' }[v] ?? 'wait', durasi: null }];
    }));
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
    { key: 'hasil', id: 'hasil', job: 'Gabung dan terbitkan hasil', nama: 'Gabung dan terbitkan', hasil: null, perlu: ['rencana', 'build', 'sonar', 'analisis'], jalur: 'v1' },
  ];

  // Node yang berjalan untuk jalur tertentu; sisanya tetap digambar tetapi diredupkan dan dicoret,
  // karena jalur yang tidak dipakai adalah bagian dari cerita pipeline, bukan sesuatu yang hilang.
  const nodeJalur = (jalur) => PIPELINE.filter((n) => n.jalur === 'kedua' || n.jalur === jalur);
  const simpulAktif = (n, jalur) => n.jalur === 'kedua' || n.jalur === jalur;

  // Kolom = kedalaman topologis. Dihitung dari `perlu`, bukan ditulis tangan, supaya menambah
  // ketergantungan di PIPELINE langsung memindahkan nodenya.
  const kolomPipeline = () => {
    const dalam = new Map();
    const hitung = (n) => {
      if (dalam.has(n.key)) return dalam.get(n.key);
      const d = n.perlu.length ? 1 + Math.max(...n.perlu.map((k) => hitung(PIPELINE.find((x) => x.key === k)))) : 0;
      dalam.set(n.key, d);
      return d;
    };
    PIPELINE.forEach(hitung);
    const maks = Math.max(...dalam.values());
    return Array.from({ length: maks + 1 }, (_, i) => PIPELINE.filter((n) => dalam.get(n.key) === i));
  };

  const TEKS_SIMPUL = { wait: 'menunggu', run: 'berjalan', done: 'selesai', fail: 'gagal', skip: 'dilewati', 'fail-diharapkan': 'gagal sesuai ekspektasi' };

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
    const anak = [];
    for (const n of PIPELINE) {
      const ke = titik.get(n.key);
      if (!ke) continue;
      for (const kKey of n.perlu) {
        const dari = titik.get(kKey);
        if (!dari) continue;
        const p = document.createElementNS(NS, 'path');
        const d = tegak
          ? `M ${dari.tengahX} ${dari.bawah} C ${dari.tengahX} ${dari.bawah + 14}, ${ke.tengahX} ${ke.atas - 14}, ${ke.tengahX} ${ke.atas}`
          : `M ${dari.kanan} ${dari.tengahY} C ${dari.kanan + 18} ${dari.tengahY}, ${ke.kiri - 18} ${ke.tengahY}, ${ke.kiri} ${ke.tengahY}`;
        p.setAttribute('d', d);
        p.setAttribute('class', `alur-tepi${simpulAktif(n, jalurAktif()) && simpulAktif(PIPELINE.find((x) => x.key === kKey), jalurAktif()) ? '' : ' mati'}`);
        anak.push(p);
      }
    }
    svg.replaceChildren(...anak);
  };

  let pantauUkuranAlur = null;

  const renderPipeline = (live) => {
    const jalur = jalurAktif(live);
    const mode = live?.mode ?? state.hasil?.run?.mode ?? modeTerpilih();
    const status = live?.jobs ?? state.jobs ?? statusNodeDariHasil() ?? {};
    // Rekaman bukan pemantauan: statusnya diambil sekali lalu dibekukan, dan itu harus terbaca.
    const rekaman = !live && state.rekaman ? state.rekaman : null;
    const lencanaRekaman = $('pipeline-rekaman');
    lencanaRekaman.hidden = !rekaman;
    if (rekaman) lencanaRekaman.textContent = `Rekaman run CI #${rekaman.nomor}, bukan run langsung`;
    // Skema 2 tidak punya run.gemini; kegagalan LLM terbaca dari status panggilan.
    const llmGagal = !live && (state.hasil?.run?.status_panggilan?.error ?? 0) > 0;
    $('pipeline-title').textContent = live ? `Run ${live.nomor ? `#${live.nomor}` : 'baru'}` : (state.hasil ? `Alur eksekusi run #${state.hasil.run.nomor}` : 'Alur eksekusi pipeline');
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

    const kartu = (n) => {
      const aktif = simpulAktif(n, jalur);
      let st = status[n.key] ?? { s: 'wait', durasi: null };
      if (!aktif) st = { s: 'skip', durasi: null };
      let teks = TEKS_SIMPUL[st.s];
      if (aktif && n.key === 'analisis' && llmGagal && st.s === 'done') { st = { ...st, s: 'fail' }; teks = 'Analisis LLM gagal'; }
      const diharapkan = st.s === 'fail' ? ekspektasiGagal(n.key) : null;
      if (diharapkan) { st = { ...st, s: 'fail-diharapkan' }; teks = diharapkan.sebab; }
      const nama = aktif && n.key === 'analisis' && mode === 'sast' ? 'Ambil temuan Sonar' : n.nama;
      const langkah = status[n.key]?.langkah ?? null;
      const bisaDibuka = aktif && Array.isArray(langkah) && langkah.length > 0;
      // Node yang belum berjalan hanya lingkaran kosong. Tanda centang di sana terbaca sebagai
      // "sudah selesai" padahal statusnya menunggu.
      const TANDA = { fail: IKON.silang, 'fail-diharapkan': IKON.seru, skip: IKON.minus, done: IKON.cek, run: IKON.titik };
      const tanda = TANDA[st.s] ?? null;
      const isiSimpul = [
        el('span', { class: 'simpul-mark', 'aria-hidden': 'true' }, tanda ? ikon(tanda) : null),
        el('span', { class: 'simpul-nama', text: nama }),
        el('span', { class: 'simpul-durasi data', text: durasi(st.durasi) }),
        el('span', { class: 'simpul-status', text: aktif ? teks : 'digantikan jalur v2' }),
      ];
      // Dua tindakan berbeda di satu kartu: membuka daftar langkah di halaman ini, dan membuka log
      // job itu di GitHub. Keduanya berdampingan di dalam kartu, bukan kartu yang seluruhnya bisa
      // diklik, karena tautan di dalam tombol bukan markah yang sah dan dua sasaran klik yang
      // bertumpuk membuat orang membuka tab baru padahal hanya ingin melihat langkahnya.
      const nomorRun = live?.nomor ?? state.hasil?.run?.nomor ?? null;
      const idRun = live?.id ?? state.rekaman?.id ?? state.hasil?.run?.id ?? null;
      const urlLog = aktif ? urlJobGh(state.proyek, idRun, status[n.key]?.id) : null;
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
      const sifat = { class: `simpul${aktif ? '' : ' mati'}${bisaDibuka ? ' bisa-dibuka' : ''}`, dataset: { s: st.s, key: n.key } };
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
      isi(panel,
        el('p', { class: 'block-h', text: `Langkah job ${n?.nama ?? ''}` }),
        el('ol', { class: 'langkah' }, terbuka.map((l) => el('li', { dataset: { s: l.s } },
          el('span', { class: 'langkah-mark', 'aria-hidden': 'true' }, ikon(l.s === 'fail' ? IKON.silang : (l.s === 'skip' ? IKON.minus : IKON.cek))),
          el('span', { class: 'langkah-nama', text: l.nama }),
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
  };
  const infoPutusan = (p) => PUTUSAN_V2[p] ?? { label: 'Tanpa putusan', kelas: 'none' };

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
    n.hidden = false;
    isi(n, el('span', { class: `lencana ${gagal ? 'l-crit' : 'l-ok'}` },
      el('i', { 'aria-hidden': 'true' }),
      gagal ? 'Selesai dengan panggilan gagal' : 'Selesai'));
  };

  const renderKepalaV2 = () => {
    const p = state.proyek;
    const r = state.hasil.run;
    const urlRepo = urlRepoGh(p);
    const repoLink = urlRepo
      ? el('a', { href: urlRepo, target: '_blank', rel: 'noopener noreferrer', text: `${p.owner} / ${p.repo}` })
      : el('span', { text: `${p.owner} / ${p.repo}` });
    isi($('crumb'), repoLink, pemisahCrumb(), r.objek_uji.branch ?? state.branch.name, pemisahCrumb(), `Run #${r.nomor}`);
    $('run-title').textContent = `Run #${r.nomor} · ${labelVendor(r.vendor)} · ${state.hasil.alerts.length} alert · ${state.hasil.findings.length} temuan`;
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
    isi($('title-block'),
      sel('Model', r.model_menjawab ? labelModelId(r.model_menjawab) : '—', {
        ikon: IKON.bolt,
        warn: bedaModel,
        title: bedaModel ? `${r.model_menjawab}, padahal yang diminta ${r.model_diminta}` : (r.model_menjawab ?? r.model_diminta),
      }),
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
    const n = (p) => h.alerts.filter((a) => a.putusan === p).length;
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
    const sev = (daftar) => h.alerts.filter((a) => daftar.includes(String(a.severity_sonar).toUpperCase())).length;
    // Sonar MQR memakai nama severity lain; tanpa kartu ini alert seperti itu hilang dari hitungan.
    const sevLain = h.alerts.filter((a) => !SEV_DIKENAL.includes(String(a.severity_sonar).toUpperCase())).length;
    const ditinjau = (v) => h.findings.filter((t) => state.keputusan[t.fingerprint]?.v === v).length;

    isi($('summary'),
      grup('Keparahan alert Sonar', `${h.alerts.length} alert`,
        kartu('Blocker', sev(['BLOCKER']), 'severity apa adanya dari Sonar', 'crit'),
        kartu('Critical', sev(['CRITICAL']), 'severity apa adanya dari Sonar', 'high'),
        kartu('Major', sev(['MAJOR']), 'severity apa adanya dari Sonar'),
        kartu('Minor dan info', sev(['MINOR', 'INFO']), 'severity apa adanya dari Sonar'),
        sevLain ? kartu('Severity lain', sevLain, 'nama severity di luar lima baku Sonar') : null),
      grup('Putusan model atas alert', `${h.alerts.filter((a) => a.putusan).length} dari ${h.alerts.length} berputusan`,
        kartu('Dikonfirmasi model', n('true_positive'), 'alert dinyatakan nyata', 'crit'),
        kartu('False positive', n('false_positive'), 'alert ditolak model', 'ok'),
        kartu('Ragu-ragu', n('uncertain'), 'dipertahankan, bukan kegagalan', 'high'),
        kartu('Tanpa putusan', n(null), 'panggilan atau parse gagal')),
      grup('Sumber dan tindak lanjut', 'dua himpunan terpisah',
        kartu('Alert Sonar', h.alerts.length, 'diverifikasi model satu per satu'),
        kartu('Temuan LLM', h.findings.length, 'dari panggilan deteksi'),
        kartu('Ditinjau developer', ditinjau('ok') + ditinjau('fp'), 'catatan lokal di browser ini')));
  };

  // ---------- Navigasi rail ----------
  const NAV = [
    { key: 'ringkasan', label: 'Ringkasan', tab: 'operasional', sel: '#summary', ikon: 'kisi' },
    { key: 'temuan', label: 'Temuan', tab: 'operasional', sel: '#temuan', ikon: 'perisai' },
    { key: 'verifikasi', label: 'Verifikasi', tab: 'operasional', sel: '#alerts-box', ikon: 'terverifikasi' },
    { key: 'riwayat', label: 'Riwayat', tab: 'operasional', sel: '#history', ikon: 'riwayat' },
    { key: 'eksperimen', label: 'Eksperimen', tab: 'eksperimen', sel: '#panel-eksperimen', ikon: 'labu' },
  ];

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
    if (key === 'verifikasi') return h ? { teks: String(h.alerts.length), kelas: 'l-netral', label: `${h.alerts.length} alert Sonar` } : null;
    if (key === 'riwayat') {
      if (!state.index) return null;
      const n = entriBranch().length;
      return { teks: String(n), kelas: 'l-netral', label: `${n} run di branch ini` };
    }
    return null;
  };

  const renderNav = () => {
    const v2 = state.hasil?.schema_version === 2;
    $('railnav-box').hidden = !v2;
    if (!v2) return;
    const adaEks = Boolean(state.hasil.eksperimen);
    isi($('railnav'), NAV.filter((x) => x.key !== 'eksperimen' || adaEks).map((x) => {
      const l = lencanaNav(x.key);
      return el('li', {}, el('button', {
        type: 'button', 'aria-current': state.nav === x.key ? 'true' : 'false',
        onclick: () => {
          state.nav = x.key;
          if (state.tab !== x.tab) pilihTab(x.tab);
          renderNav();
          if (railSempit()) terapkanRail(false);
          const n = document.querySelector(x.sel);
          if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, ikon(IKON[x.ikon]), el('span', { class: 'railnav-label', text: x.label }),
      l ? el('span', { class: `lencana ${l.kelas}`, 'aria-label': l.label ?? null, text: l.teks }) : null));
    }));
  };

  // Satu baris per alert: severity Sonar (dengan sumbernya), putusan model, keyakinan, dan alasan
  // yang bisa dibuka. Alert tanpa putusan sah ditampilkan apa adanya sebagai "Tanpa putusan".
  const renderAlertV2 = () => {
    const alerts = state.hasil.alerts;
    $('alerts-box').hidden = false;

    const urut = ['true_positive', 'false_positive', 'uncertain', null];
    isi($('alerts-ringkas'), urut.map((p) => {
      const inf = infoPutusan(p);
      const n = alerts.filter((a) => a.putusan === p).length;
      return el('span', { class: 'ringkas-item' },
        el('b', { class: `putusan p-${inf.kelas}`, text: String(n) }), el('span', { text: inf.label }));
    }));

    isi($('alerts-body'), alerts.length
      ? el('ul', { class: 'alist' }, alerts.map((a) => {
        const inf = infoPutusan(a.putusan);
        const idDetail = `ad-${a.id}`;
        const r = state.hasil.run;
        const hash = r.hash_prompt?.user_deteksi ?? null;
        const detail = el('div', { class: 'adetail', id: idDetail, hidden: true },
          el('div', { class: 'alasan-kotak' },
            el('p', { class: 'alasan-kepala' },
              ikon(IKON.bolt),
              el('b', { text: 'Alasan dan analisis model' }),
              el('span', { class: 'alasan-model', text: labelModelId(r.model_menjawab ?? r.model_diminta) })),
            el('p', { class: 'alasan', text: a.alasan ?? 'Model tidak memberi alasan untuk alert ini.' })),
          el('div', { class: 'afakta' },
            a.rule ? el('span', { class: 'chip chip-rule', text: a.rule }) : null,
            ...a.cwe.map(tautanCwe),
            a.pesan ? el('span', { class: 'apesan', text: a.pesan }) : null),
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
            el('span', { class: 'chip chip-sev', title: 'Severity apa adanya dari SonarCloud, tidak diterjemahkan' },
              el('span', { text: a.severity_sonar ?? '—' }), el('small', { text: 'dari Sonar' })),
            el('span', { class: 'akey', text: a.keyakinan ? `keyakinan ${a.keyakinan}` : '—' })),
          el('span', { class: 'ftitle' }, a.file ? teksLokasi(a.file, a.baris) : (a.rule ?? '—'))),
        el('span', { class: 'buka' }, labelBuka, ikon(IKON.panah)));
        return el('li', {}, tombol, detail);
      }))
      : el('div', { class: 'state' }, el('p', { text: 'Tidak ada alert Sonar pada run ini.' })));
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
  ];
  const filterV2Aktif = () => FILTER_V2.find((x) => x.key === state.filter) ?? FILTER_V2[0];

  const renderFilterV2 = () => {
    const f = state.hasil.findings;
    isi($('filters'), FILTER_V2.map((x) => el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-pressed': state.filter === x.key ? 'true' : 'false',
      onclick: () => { state.filter = x.key; state.terbuka = null; renderFilterV2(); renderTemuanV2(); },
    }, x.label, ' ', el('span', { class: 'count', text: String(f.filter(x.cocok).length) }))));
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
        chip(`keyakinan ${t.keyakinan}`, 'chip-keyakinan')),
      el('p', { class: 'note data', text: labelModelId(state.hasil.run.model_menjawab ?? state.hasil.run.model_diminta) }),
      el('div', { class: 'lokasi-kotak' },
        el('div', {}, el('p', { class: 'block-h', text: 'Lokasi sumber kode' }),
          el('p', { class: 'floc' }, teksLokasi(t.file, t.baris))),
        tautanGithub(t)),
      el('div', { class: 'alasan-kotak' },
        el('p', { class: 'alasan-kepala' }, ikon(IKON.bolt), el('b', { text: 'Penjelasan dan analisis model' })),
        el('p', { class: 'alasan', text: t.penjelasan ?? 'Model tidak memberi penjelasan untuk temuan ini.' })),
      el('p', { class: 'block-h', text: 'Kode di sekitar baris' }), kode,
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
          chip(`keyakinan ${t.keyakinan}`, 'chip-keyakinan')),
        el('span', { class: 'ftitle', text: t.jenis }),
        el('span', { class: 'floc' }, teksLokasi(t.file, t.baris)),
        putusan
          ? el('span', { class: 'fdec', dataset: { v: putusan }, text: putusan === 'ok' ? 'Dikonfirmasi developer' : 'Ditandai false positive' })
          : el('span', { class: 'fdec-empty', text: 'Belum ditinjau' }),
        el('span', { class: 'buka' }, el('small', { text: terbuka ? 'Tutup detail' : 'Detail' }), ikon(IKON.panah)));
        return el('li', {}, baris);
      }))
      : el('div', { class: 'state' }, el('p', { text: semua.length ? 'Tidak ada temuan yang cocok dengan saringan ini.' : 'Panggilan deteksi tidak melaporkan temuan.' })));
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
            onclick: () => muatRun(e),
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
    $('f-konfirmasi-v2').checked = false;
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
    const pilih = el('div', { class: 'eks-pilih' },
      el('span', { class: 'note', text: 'Label alert:' }),
      ...[['utama', `Utama (SONAR-03 = ${eks.label_alert?.['SONAR-03']?.label ?? '—'})`],
        ['sensitivitas', `Sensitivitas (SONAR-03 = ${eks.label_alert_sensitivitas?.['SONAR-03']?.label ?? '—'})`]]
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

  const pilihTab = (tab) => {
    state.tab = tab;
    const eks = tab === 'eksperimen';
    $('tab-operasional').setAttribute('aria-selected', String(!eks));
    $('tab-eksperimen').setAttribute('aria-selected', String(eks));
    $('panel-operasional').hidden = eks;
    $('panel-eksperimen').hidden = !eks;
    $('summary').hidden = eks;
    if (eks) renderEksperimen();
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
    $('tabs').hidden = !state.hasil.eksperimen;
    if (!state.hasil.eksperimen && state.tab === 'eksperimen') state.tab = 'operasional';
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
    pilihTab(state.tab);
    renderNav();
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
    $('tabs').hidden = true;
    $('railnav-box').hidden = true;
    $('panel-operasional').hidden = false;
    $('panel-eksperimen').hidden = true;
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
    if (state.hasil?.schema_version === 2) return renderSemuaV2();
    renderArsipV1();
  };

  // ---------- Menjalankan analisis ----------
  const hentikanPantau = () => {
    if (state.pantau) state.pantau.batal = true;
    state.pantau = null;
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
    // Begitu analisis berjalan, fokus pindah ke melihat: drawer ditutup supaya pipeline terlihat.
    if (!$('drawer').hidden) tutupDrawer();
    renderPipeline({ mode, jalur, jobs: awal });
    perbaruiTombolJalankan(state.demo ? 'Simulasi dimulai.' : 'Mengirim permintaan ke GitHub…');
    try {
      if (state.demo) await simulasi(mode, jalur, pantau);
      else await dispatchLive(p, branch, mode, model, pantau, jalur);
    } catch (err) {
      if (pantau.batal) return;
      state.sibuk = false;
      perbaruiTombolJalankan(pesanGalat(err), 'error');
      return;
    }
  };

  const simulasi = async (mode, jalur, pantau) => {
    const node = nodeJalur(jalur);
    const jobs = Object.fromEntries(node.map((n) => [n.key, { s: 'wait', durasi: null }]));
    const lama = { rencana: 3, build: 104, sonar: 51, analisis: 241, 'analisis-v2': 219, hasil: 22 };
    if (mode === 'sast') { lama.analisis = 9; lama['analisis-v2'] = 9; }
    for (const n of node) {
      if (pantau.batal) return;
      jobs[n.key] = { s: 'run', durasi: null };
      renderPipeline({ mode, jalur, jobs, nomor: null });
      perbaruiTombolJalankan(`Simulasi: ${n.key === 'analisis' && mode === 'sast' ? 'Ambil temuan Sonar' : n.nama} berjalan.`);
      await tunggu(1100);
      jobs[n.key] = { s: 'done', durasi: lama[n.key] };
      renderPipeline({ mode, jalur, jobs, nomor: null });
    }
    if (pantau.batal) return;
    state.sibuk = false;
    state.pantau = null;
    const arsip = state.proyek.branches.find((b) => !b.dispatch);
    perbaruiTombolJalankan(el('span', {}, 'Simulasi selesai. Mode demo tidak membuat hasil baru. ',
      arsip ? el('button', { class: 'btn-text', type: 'button', text: `Lihat contoh hasil di ${arsip.name}`, onclick: () => { state.branch = arsip; renderRailBranch(); muatIndex(); } }) : null));
  };

  // Paket Free SonarCloud hanya menganalisis main, jadi run di branch lain memakai analisis main.
  // Kecocokannya dijamin pemeriksaan hash tree src/ di workflow, bukan oleh nama branch.
  const sonarBranchV2 = (branch) => (branch === 'main' ? 'ikut-branch-run' : 'main');

  const dispatchLive = async (p, branch, mode, model, pantau, jalur) => {
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
    const inputs = { mode, model, label, jalur };
    if (jalur === 'v2') {
      const m = modelJalur().find((x) => x.id === model);
      if (!m) throw new GhError('invalid', 'Model jalur v2 tidak dikenali. Muat ulang dashboard lalu coba lagi.');
      Object.assign(inputs, { vendor_v2: m.vendor, konfirmasi_v2: 'JALANKAN', sonar_branch_v2: sonarBranchV2(branch) });
    }
    if (!model) throw new GhError('invalid', 'Daftar model tidak terbaca dari models.json. Muat ulang dashboard lalu coba lagi.');
    await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}/dispatches`, { method: 'POST', body: { ref: branch, inputs } });
    perbaruiTombolJalankan('Permintaan diterima. Menunggu GitHub membuat run…');

    let run = null;
    for (let i = 0; i < BATAS_CARI_RUN && !run; i++) {
      if (pantau.batal) return;
      await tunggu(JEDA_CARI_RUN);
      const data = await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}/runs?event=workflow_dispatch&branch=${enc(branch)}&per_page=20`);
      run = (data.workflow_runs || []).find((r) => typeof r.display_title === 'string' && r.display_title.includes(`[${label}]`) && Date.parse(r.created_at) >= dikirim - 60000) ?? null;
    }
    if (!run) throw new GhError('invalid', 'Run belum muncul setelah 90 detik. Periksa tab Actions di GitHub; antrean runner mungkin penuh.');

    while (!pantau.batal) {
      const [dataJobs, info] = await Promise.all([gh(`${repoPath(p)}/actions/runs/${run.id}/jobs?per_page=50`), gh(`${repoPath(p)}/actions/runs/${run.id}`)]);
      if (pantau.batal) return;
      renderPipeline({ mode, jalur, jobs: jobsDariApi(dataJobs.jobs || [], nodeJalur(jalur)), nomor: info.run_number });
      perbaruiTombolJalankan(el('span', {}, linkRun(info.html_url, `Run #${info.run_number}`), info.status === 'completed' ? ' selesai.' : ' berjalan.'));
      if (info.status === 'completed') { run = info; break; }
      await tunggu(JEDA_JOB);
    }
    if (pantau.batal) return;

    perbaruiTombolJalankan(el('span', {}, linkRun(run.html_url, `Run #${run.run_number}`), ' selesai. Menunggu hasil diterbitkan…'));
    for (let i = 0; i < BATAS_TUNGGU_HASIL; i++) {
      if (pantau.batal) return;
      const index = await sumberLive.index(p);
      if ((index.runs || []).some((x) => x.id === run.id)) {
        state.sibuk = false;
        state.pantau = null;
        await muatIndex(run.id);
        const llmGagal = (state.hasil?.run?.status_panggilan?.error ?? 0) > 0 || state.hasil?.run?.gemini?.status === 'gagal';
        perbaruiTombolJalankan(el('span', {}, linkRun(run.html_url, `Run #${run.run_number}`), ` selesai (${run.conclusion === 'success' ? 'berhasil' : run.conclusion}). Hasil sudah dimuat.${llmGagal ? ' Panggilan LLM gagal, lihat catatan di daftar temuan.' : ''}`));
        return;
      }
      await tunggu(JEDA_HASIL);
    }
    const jobTerbit = jalur === 'v2' ? 'Analisis LLM v2 (deteksi dan verifikasi)' : 'Gabung dan terbitkan hasil';
    throw new GhError('invalid', `Run #${run.run_number} selesai tetapi hasilnya belum ada di branch security-results. Lihat log job "${jobTerbit}" di GitHub.`);
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
    $('buka-drawer').addEventListener('click', bukaDrawer);
    $('drawer-tutup').addEventListener('click', tutupDrawerAktif);
    $('drawer-tirai').addEventListener('click', tutupDrawerAktif);
    $('temuan-tutup').addEventListener('click', tutupDrawerAktif);
    $('run-batal').addEventListener('click', tutupDrawerAktif);
    $('drawer-temuan-tirai').addEventListener('click', tutupDrawerAktif);
    $('tab-operasional').addEventListener('click', () => pilihTab('operasional'));
    $('tab-eksperimen').addEventListener('click', () => pilihTab('eksperimen'));
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
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
      renderDrawer();
      if (!state.sibuk && !state.hasil) renderPipeline();
    }));
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
    renderModels();
    renderAkses(state.token ? 'ok' : 'none', state.token ? teksTokenAktif() : 'Belum ada token');
    $('token-remember').checked = state.tokenDiingat;
    if (location.protocol === 'file:') {
      tampilBanner('error', 'Dashboard dibuka langsung dari file. Jalankan lewat server lokal (lihat README) supaya projects.json dan mode demo bisa dibaca.');
    }
    if (location.hash === '#demo' || location.hash === '#demo-v2') masukDemo();
    else if (state.token) masukLive();
    else tampilStart();
  };

  mulai();
})();
