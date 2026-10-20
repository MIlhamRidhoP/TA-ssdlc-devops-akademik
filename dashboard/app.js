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

  // Pipeline kedua jalur berbeda bentuk: di jalur v2 job "Gabung dan terbitkan hasil" sengaja
  // dilewati (analisis-v2 menerbitkan sendiri), jadi menampilkannya akan selamanya "menunggu".
  const NODE_V1 = [
    { key: 'build', nama: 'Build dan uji', job: 'Build dan uji API', hasil: 'build_test' },
    { key: 'sonar', nama: 'SonarCloud', job: 'Analisis SonarCloud', hasil: 'sonarcloud' },
    { key: 'analisis', nama: 'Analisis LLM', job: 'Analisis temuan (Sonar dan Gemini)', hasil: 'analisis' },
    { key: 'hasil', nama: 'Gabung hasil', job: 'Gabung dan terbitkan hasil', hasil: null },
  ];
  const NODE_V2 = [
    { key: 'build', nama: 'Build dan uji', job: 'Build dan uji API', hasil: 'build_test' },
    { key: 'sonar', nama: 'SonarCloud', job: 'Analisis SonarCloud', hasil: 'sonarcloud' },
    { key: 'analisis', nama: 'Deteksi dan verifikasi', job: 'Analisis LLM v2 (deteksi dan verifikasi)', hasil: 'analisis' },
  ];
  const jalurTerpilih = () => $('f-jalur')?.value ?? 'v2';
  // Saat run sudah dimuat, jalurnya ditentukan isi hasil; saat menyiapkan run baru, oleh form.
  const jalurAktif = (live) => live?.jalur
    ?? (state.hasil ? (state.hasil.schema_version === 2 ? 'v2' : 'v1') : jalurTerpilih());
  const nodeJalur = (jalur) => (jalur === 'v2' ? NODE_V2 : NODE_V1);
  const TEKS_STATUS = { wait: 'menunggu', run: 'berjalan', done: 'selesai', fail: 'gagal', skip: 'dilewati' };
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
    // Kepadatan dibedakan lewat bentuk, bukan jumlah garis: pada 18 px selisih jumlah garis tidak terbaca.
    padat: ['M3 4h10', 'M3 6.7h10', 'M3 9.4h10', 'M3 12.1h10'],
    nyaman: ['M3.5 3.5h9v4h-9z', 'M3.5 8.5h9v4h-9z'],
  };
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
  const urlGithub = (owner, repo, ...seg) => `https://github.com/${enc(owner)}/${enc(repo)}${seg.length ? `/${seg.map(enc).join('/')}` : ''}`;

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
    branch: null,
    index: null,
    entri: null,
    hasil: null,
    sebelumnya: null,
    jobs: null,
    filter: 'semua',
    terbuka: null,
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

  const statusJobApi = (job) => {
    if (!job) return { s: 'wait', durasi: null };
    const mulai = Date.parse(job.started_at);
    const selesai = Date.parse(job.completed_at);
    let s = 'wait';
    if (job.status === 'in_progress') s = 'run';
    else if (job.status === 'completed') s = { success: 'done', skipped: 'skip' }[job.conclusion] ?? 'fail';
    const lama = Number.isFinite(mulai) ? ((Number.isFinite(selesai) ? selesai : Date.now()) - mulai) / 1000 : null;
    return { s, durasi: s === 'skip' ? null : lama };
  };

  const jobsDariApi = (daftar, node = nodeJalur(jalurAktif())) => Object.fromEntries(node.map((n) => [n.key, statusJobApi(daftar.find((j) => j.name === n.job))]));

  const sumberLive = {
    projects: () => jsonLokal('projects.json'),
    cekProject: async (p) => {
      try {
        await gh(repoPath(p));
      } catch (err) {
        return { akses: false, err };
      }
      try {
        await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}`);
        return { akses: true, workflow: true };
      } catch (err) {
        if (err.jenis === 'notfound') return { akses: true, workflow: false };
        return { akses: true, workflow: null, err };
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
        return jobsDariApi(data.jobs || []);
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
    cekProject: async (p) => (p.demo_tanpa_workflow ? { akses: true, workflow: false } : { akses: true, workflow: true }),
    index: async (p) => (p.demo_tanpa_workflow ? { runs: [] } : jsonLokal(`${basisDemo()}/index.json`)),
    hasil: async (p, entri) => {
      if (!pathAman(entri.path)) throw new GhError('format', 'Path hasil di index.json tidak valid.');
      return validasiHasil(await jsonLokal(`${basisDemo()}/${entri.path}`));
    },
    // Run v2 dijalankan dari CLI, tidak lewat GitHub Actions, jadi tidak ada status job di mode demo.
    jobs: async () => null,
  };

  const sumber = () => (state.demo ? sumberDemo : sumberLive);

  // ---------- Tema dan kepadatan ----------
  const TEMA = [null, 'terang', 'gelap'];
  const terapkanTema = () => {
    const t = store.get('localStorage', KUNCI.tema);
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    pasangIkon($('theme-toggle'), IKON[t ?? 'sistem'], `Tema: ${t ?? 'ikuti sistem'}`);
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
    'Mode demo. Data nyata dari eksperimen 19 Okt 2026 (eksperimen/seeded, commit 97cfb00): tiga vendor, satu run masing-masing. Alert Sonar diverifikasi model satu per satu. Run dijalankan dari CLI, bukan lewat pipeline.',
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
    $('access').open = true;
    $('demo-toggle').textContent = 'Buka mode demo';
  };

  // ---------- Masuk mode ----------
  const masukLive = async () => {
    state.demo = false;
    $('demo-toggle').textContent = 'Buka mode demo';
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
    $('demo-toggle').textContent = 'Keluar dari mode demo';
    bannerDemo();
    await muatProjects();
  };

  const keluarDemo = () => {
    hentikanPantau();
    state.demo = false;
    history.replaceState(null, '', location.pathname + location.search);
    $('banner').hidden = true;
    state.banner = null;
    if (state.token) masukLive(); else tampilStart();
  };

  // ---------- Project ----------
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
    pilihProyek(awal, terakhir.branch);
  };

  const keteranganProject = (p) => {
    const st = state.statusProject.get(p) ?? {};
    if (st.akses === false) return { teks: 'tidak bisa diakses dengan token ini', off: true };
    if (st.workflow === false) return { teks: 'workflow belum dipasang', off: true };
    if (st.workflow === null) return { teks: 'status workflow tidak diketahui', off: false };
    return { teks: `${p.branches.length} branch · workflow aktif`, off: false };
  };

  const renderProjects = () => {
    isi($('project-list'), state.projects.map((p) => {
      const k = keteranganProject(p);
      return el('li', {},
        el('button', {
          class: `project${k.off ? ' is-off' : ''}`, type: 'button', 'aria-current': p === state.proyek ? 'true' : 'false',
          onclick: () => pilihProyek(p),
        }, el('b', { text: p.repo }), el('span', { text: `${p.owner} · ${k.teks}` })));
    }));
  };

  const pilihProyek = (p, branchDisukai) => {
    hentikanPantau();
    state.proyek = p;
    state.branch = p.branches.find((b) => b.name === branchDisukai) ?? p.branches[0];
    state.filter = 'semua';
    state.terbuka = null;
    renderProjects();
    renderFormBranch();
    muatIndex();
  };

  const ingatPilihan = () => !state.demo && store.set('localStorage', KUNCI.terakhir, JSON.stringify({ repo: `${state.proyek.owner}/${state.proyek.repo}`, branch: state.branch.name }));

  // ---------- Daftar model ----------
  // dashboard/models.json adalah satu-satunya sumber daftar model, dipakai bersama workflow.
  // Jalur v2 terbuka sejak uji coba run #46 berhasil; v1 tetap bisa dipilih untuk pembanding.
  const muatModels = async () => {
    try {
      const d = await jsonLokal('models.json');
      state.models = Array.isArray(d?.models) ? d.models : [];
    } catch {
      state.models = [];
    }
  };
  const modelJalur = () => state.models.filter((m) => m.jalur === jalurTerpilih());
  const renderModels = () => {
    const daftar = modelJalur();
    $('konfirmasi-v2-field').hidden = jalurTerpilih() !== 'v2';
    const sel = $('f-model');
    const sebelum = sel.value;
    isi(sel, daftar.map((m) => el('option', { value: m.id, selected: m.bawaan ? true : null }, m.label)));
    if (daftar.some((m) => m.id === sebelum)) sel.value = sebelum;
    renderBiaya();
  };
  const renderBiaya = () => {
    const m = modelJalur().find((x) => x.id === $('f-model').value);
    const n = $('biaya-perkiraan');
    if (!m) { n.textContent = ''; return; }
    n.textContent = typeof m.biaya_perkiraan_usd === 'number'
      ? `Perkiraan biaya satu run: US$${m.biaya_perkiraan_usd.toFixed(4).replace('.', ',')}. Rata-rata dari eksperimen 19 Okt 2026, bukan tarif pasti.`
      : 'Perkiraan biaya belum diukur untuk model ini.';
  };

  // ---------- Form jalankan ----------
  const renderFormBranch = () => {
    const sel = $('f-branch');
    isi(sel, state.proyek.branches.map((b) => el('option', { value: b.name, text: b.dispatch ? b.name : `${b.name} · arsip`, selected: b === state.branch })));
    perbaruiTombolJalankan();
  };

  const modeTerpilih = () => document.querySelector('input[name="mode"]:checked')?.value ?? 'sast-llm';

  // Jalur v2 memanggil API berbayar per alert. Workflow menolak run tanpa input konfirmasi_v2,
  // dan dashboard tidak boleh mengisinya diam-diam: centang di bawah inilah persetujuan itu.
  const konfirmasiV2 = () => jalurTerpilih() !== 'v2' || Boolean($('f-konfirmasi-v2')?.checked);

  const alasanTidakBisa = () => {
    const st = state.statusProject.get(state.proyek) ?? {};
    if (!state.demo && !state.token) return 'Masukkan token GitHub dulu.';
    if (st.akses === false) return 'Token tidak punya akses ke repo ini.';
    if (st.workflow === false) return `Repo ini belum punya ${state.proyek.workflow}. Pasang workflow framework dulu.`;
    if (!state.branch.dispatch) return state.branch.catatan || 'Branch ini tidak bisa dipicu dari dashboard.';
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
  const entriBranch = () => (state.index?.runs ?? [])
    .filter((e) => e.branch === state.branch.name)
    .sort((a, b) => String(b.selesai ?? '').localeCompare(String(a.selesai ?? '')));

  const muatIndex = async (pilihId) => {
    ingatPilihan();
    state.hasil = null;
    state.sebelumnya = null;
    state.entri = null;
    state.jobs = null;
    renderMemuat();
    try {
      state.index = await sumber().index(state.proyek);
    } catch (err) {
      state.index = { runs: [] };
      renderKosong(pesanGalat(err), true);
      return;
    }
    const daftar = entriBranch();
    if (!daftar.length) { renderKosong(); return; }
    await muatRun(daftar.find((e) => e.id === pilihId) ?? daftar[0]);
  };

  const muatRun = async (entri) => {
    state.entri = entri;
    state.terbuka = null;
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
    state.jobs = await sumber().jobs(state.proyek, entri.id);
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
    state.tab = 'operasional';
  };

  const renderMemuat = () => {
    bersihkanBlokRun();
    isi($('findings-body'), el('div', { class: 'skeleton', 'aria-label': 'Memuat hasil' }, el('i'), el('i'), el('i'), el('i')));
    renderPipeline();
  };

  const renderKosong = (pesanGalatTeks, galat) => {
    bersihkanBlokRun();
    $('run-title').textContent = '';
    isi($('crumb'));
    isi($('history'));
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
      judul = 'Belum ada run untuk branch ini';
      const jobTerakhir = nodeJalur(jalurTerpilih()).slice(-1)[0].nama;
      teks = alasanTidakBisa() ?? `Tekan Jalankan analisis untuk membuat run pertama. Hasilnya muncul di sini setelah job ${jobTerakhir} selesai.`;
    }
    isi($('findings-body'), el('div', { class: 'state' }, el('h3', { text: judul }), el('p', { text: teks }), aksi));
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

  const renderPipeline = (live) => {
    const node = nodeJalur(jalurAktif(live));
    const mode = live?.mode ?? state.hasil?.run?.mode ?? modeTerpilih();
    const status = live?.jobs ?? state.jobs ?? statusNodeDariHasil() ?? {};
    // Skema 2 tidak punya run.gemini; kegagalan LLM terbaca dari status panggilan.
    const llmGagal = !live && (state.hasil?.run?.status_panggilan?.error ?? 0) > 0;
    $('pipeline-title').textContent = live ? `Run ${live.nomor ? `#${live.nomor}` : 'baru'}` : (state.hasil ? `Pipeline run #${state.hasil.run.nomor}` : 'Status pipeline');
    const total = Object.values(status).reduce((s, j) => s + (Number.isFinite(j?.durasi) ? j.durasi : 0), 0);
    $('pipeline-total').textContent = total ? `total ${durasi(total)}` : '';
    isi($('nodes'), node.map((n) => {
      let st = status[n.key] ?? { s: 'wait', durasi: null };
      let teks = TEKS_STATUS[st.s];
      if (n.key === 'analisis' && llmGagal && st.s === 'done') { st = { ...st, s: 'fail' }; teks = 'Analisis LLM gagal'; }
      const diharapkan = st.s === 'fail' ? ekspektasiGagal(n.key) : null;
      if (diharapkan) { st = { ...st, s: 'fail-diharapkan' }; teks = diharapkan.sebab; }
      const nama = n.key === 'analisis' && mode === 'sast' ? 'Ambil temuan Sonar' : n.nama;
      return el('li', { class: 'node', dataset: { s: st.s } },
        el('span', { class: 'seg-line', 'aria-hidden': 'true' }),
        el('span', { class: 'node-mark', 'aria-hidden': 'true' }, ikon(st.s === 'fail' ? IKON.silang : (st.s === 'fail-diharapkan' ? IKON.seru : IKON.cek))),
        el('span', { class: 'node-name', text: nama }),
        el('span', { class: 'node-state', text: teks }),
        el('span', { class: 'node-dim', 'aria-label': `durasi ${durasi(st.durasi)}`, text: durasi(st.durasi) }));
    }));
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

  const renderKepalaV2 = () => {
    const p = state.proyek;
    const r = state.hasil.run;
    const repoLink = p.demo_tanpa_workflow || !r.repo
      ? el('span', { text: `${p.owner} / ${p.repo}` })
      : el('a', { href: urlGithub(p.owner, p.repo), target: '_blank', rel: 'noopener noreferrer', text: `${p.owner} / ${p.repo}` });
    isi($('crumb'), repoLink, ` / ${r.objek_uji.branch ?? state.branch.name}`, ` · selesai ${waktu(r.selesai)}`);
    $('run-title').textContent = `Run #${r.nomor} · ${r.vendor} · ${state.hasil.alerts.length} alert · ${state.hasil.findings.length} temuan`;

    const sel = (label, nilai, opsi = {}) => el('div', {}, el('dt', { text: label }),
      el('dd', { class: [opsi.data ? 'data' : '', opsi.warn ? 'warn' : ''].join(' ').trim() || null, title: opsi.title }, nilai));
    const bedaModel = r.model_menjawab && r.model_menjawab !== r.model_diminta;
    // status_panggilan dan biaya_usd opsional di skema; berkas sah tanpa keduanya tidak boleh merusak render.
    const sp = r.status_panggilan ?? null;
    const commit = el('span', { text: pendek(r.objek_uji.commit) });
    isi($('title-block'),
      sel('Model menjawab', r.model_menjawab ?? '—', { warn: bedaModel, title: bedaModel ? `Diminta ${r.model_diminta}` : r.model_diminta }),
      sel('Objek uji', commit, { data: true, title: r.objek_uji.commit }),
      sel('Durasi', durasi(r.durasi_detik), { data: true }),
      sel('Biaya', typeof r.biaya_usd === 'number' ? `US$${r.biaya_usd.toFixed(4).replace('.', ',')}` : '—', { data: true }),
      sel('Panggilan', sp ? `${sp.ok}/${sp.total} ok` : '—', { data: true, warn: Boolean(sp) && sp.ok !== sp.total }));
  };

  // Kartu dikelompokkan tiga baris berlabel supaya keparahan, proses, dan sumber tidak tercampur.
  const renderRingkasanV2 = () => {
    const h = state.hasil;
    $('summary').hidden = false; // renderMemuat dan renderKosong menyembunyikannya
    const n = (p) => h.alerts.filter((a) => a.putusan === p).length;
    const kartu = (label, nilai, catatan, kelas) => el('div', { class: `cell${kelas ? ` ${kelas}` : ''}` },
      el('p', { class: 'cell-label', text: label }), el('p', { class: 'cell-num', text: String(nilai) }),
      catatan ? el('p', { class: 'cell-note', text: catatan }) : null);
    const grup = (judul, ...kartuAnak) => el('div', { class: 'kartu-grup' },
      el('h3', { text: judul }), el('div', { class: 'kartu-baris' }, kartuAnak));

    const SEV_DIKENAL = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
    const sev = (daftar) => h.alerts.filter((a) => daftar.includes(String(a.severity_sonar).toUpperCase())).length;
    // Sonar MQR memakai nama severity lain; tanpa kartu ini alert seperti itu hilang dari hitungan.
    const sevLain = h.alerts.filter((a) => !SEV_DIKENAL.includes(String(a.severity_sonar).toUpperCase())).length;
    const ditinjau = (v) => h.findings.filter((t) => state.keputusan[t.fingerprint]?.v === v).length;

    isi($('summary'),
      grup('Keparahan alert Sonar',
        kartu('Blocker', sev(['BLOCKER']), 'severity apa adanya dari Sonar', 'crit'),
        kartu('Critical', sev(['CRITICAL']), 'severity apa adanya dari Sonar', 'high'),
        kartu('Major', sev(['MAJOR']), 'severity apa adanya dari Sonar'),
        kartu('Minor dan info', sev(['MINOR', 'INFO']), 'severity apa adanya dari Sonar'),
        sevLain ? kartu('Severity lain', sevLain, 'nama severity di luar lima baku Sonar') : null),
      grup('Proses',
        kartu('Ditolak model', n('false_positive'), 'putusan false_positive'),
        kartu('Ragu-ragu', n('uncertain'), 'dipertahankan, bukan kegagalan'),
        kartu('Tanpa putusan', n(null), 'panggilan atau parse gagal'),
        kartu('Ditinjau developer', ditinjau('ok') + ditinjau('fp'), 'catatan lokal, hanya di browser ini, tidak tersinkron')),
      grup('Sumber',
        kartu('Alert Sonar', h.alerts.length, 'diverifikasi model satu per satu'),
        kartu('Temuan LLM', h.findings.length, 'dari panggilan deteksi'),
        kartu('Dikonfirmasi model', n('true_positive'), 'putusan true_positive')));
  };

  // ---------- Navigasi rail ----------
  const NAV = [
    { key: 'ringkasan', label: 'Ringkasan', tab: 'operasional', sel: '#summary' },
    { key: 'temuan', label: 'Temuan', tab: 'operasional', sel: '#temuan' },
    { key: 'verifikasi', label: 'Verifikasi', tab: 'operasional', sel: '#alerts-box' },
    { key: 'riwayat', label: 'Riwayat', tab: 'operasional', sel: '#history' },
    { key: 'eksperimen', label: 'Eksperimen', tab: 'eksperimen', sel: '#panel-eksperimen' },
  ];
  const renderNav = () => {
    const v2 = state.hasil?.schema_version === 2;
    $('railnav-box').hidden = !v2;
    if (!v2) return;
    const adaEks = Boolean(state.hasil.eksperimen);
    isi($('railnav'), NAV.filter((x) => x.key !== 'eksperimen' || adaEks).map((x) => el('li', {}, el('button', {
      type: 'button', 'aria-current': state.nav === x.key ? 'true' : 'false',
      onclick: () => {
        state.nav = x.key;
        if (state.tab !== x.tab) pilihTab(x.tab);
        renderNav();
        const n = document.querySelector(x.sel);
        if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, x.label))));
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
        const detail = el('div', { class: 'adetail', id: idDetail, hidden: true },
          el('p', { class: 'alasan', text: a.alasan ?? 'Model tidak memberi alasan untuk alert ini.' }),
          el('p', { class: 'note', text: [a.rule, a.cwe.join(', ') || null, a.pesan].filter(Boolean).join(' · ') }));
        const tombol = el('button', {
          class: 'arow', type: 'button', 'aria-expanded': 'false', 'aria-controls': idDetail,
          onclick: (e) => {
            const buka = detail.hidden;
            detail.hidden = !buka;
            e.currentTarget.setAttribute('aria-expanded', String(buka));
          },
        },
        el('span', { class: 'fid', text: a.id }),
        el('span', { class: 'ftitle', text: a.file ? `${a.file}:${a.baris ?? '?'}` : (a.rule ?? '—') }),
        el('span', { class: 'chip chip-sev', title: 'Severity apa adanya dari SonarCloud, tidak diterjemahkan' },
          el('span', { text: a.severity_sonar ?? '—' }), el('small', { text: 'dari Sonar' })),
        el('span', { class: `putusan p-${inf.kelas}`, text: inf.label }),
        el('span', { class: 'akey', text: a.keyakinan ? `keyakinan ${a.keyakinan}` : '—' }));
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

  const tautanGithub = (t) => {
    const p = state.proyek;
    const r = state.hasil.run;
    if (!t.file || p.demo_tanpa_workflow || !r.repo) return null;
    const url = `${urlGithub(p.owner, p.repo, 'blob', r.objek_uji.commit, ...t.file.split('/'))}${t.baris ? `#L${t.baris}` : ''}`;
    return el('a', {
      class: 'btn-text', href: url, target: '_blank', rel: 'noopener noreferrer',
      text: `Buka ${t.file}${t.baris ? `:${t.baris}` : ''} di GitHub`,
    });
  };

  const detailTemuanV2 = (t) => {
    const pk = t.potongan_kode;
    const kode = pk && pk.baris?.length
      ? el('pre', { class: 'code' }, pk.baris.map((b, i) => el('span', {
        class: pk.mulai + i === t.baris ? 'hit' : null, 'data-ln': String(pk.mulai + i), text: `${b}\n`,
      })))
      : el('p', { class: 'note', text: 'Potongan kode tidak tersedia untuk temuan ini. Hasil ini dibuat tanpa akses ke worktree objek uji.' });
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
    return el('div', { class: 'fdetail', id: `d-${t.fingerprint}` },
      el('div', { class: 'fdetail-grid' },
        el('div', {},
          el('p', { class: 'block-h', text: 'Penjelasan model' }),
          el('p', { class: 'alasan', text: t.penjelasan ?? 'Model tidak memberi penjelasan.' }),
          el('p', { class: 'block-h', text: 'Kode di sekitar baris' }), kode,
          tautanGithub(t)),
        el('div', {},
          el('p', { class: 'block-h', text: 'Fakta' }),
          el('dl', { class: 'facts' }, fakta.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
          el('p', { class: 'block-h', text: 'Catatan lokal' }),
          el('div', { class: 'decide' }, tombol('ok', 'Konfirmasi rentan'), tombol('fp', 'Tandai false positive')),
          el('p', { class: 'note', text: 'Catatan lokal, hanya di browser ini, tidak tersinkron.' }))));
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
          class: 'frow frow-v2', type: 'button', 'aria-expanded': terbuka ? 'true' : 'false',
          'aria-controls': `d-${t.fingerprint}`,
          onclick: () => { state.terbuka = terbuka ? null : t.fingerprint; renderTemuanV2(t.fingerprint); },
        },
        el('span', { class: 'fid', text: t.id }),
        el('span', { class: 'ftitle' }, t.jenis,
          t.cwe.length ? chip(t.cwe[0], 'chip-cwe') : null,
          t.kategori_owasp ? chip(t.kategori_owasp, 'chip-owasp') : null,
          chip(t.sifat, t.sifat === 'hardening' ? 'chip-hardening' : 'chip-vuln'),
          chip(t.keyakinan, 'chip-keyakinan')),
        el('span', { class: 'floc', text: t.file ? `${t.file}:${t.baris ?? '?'}` : '—' }),
        putusan
          ? el('span', { class: 'fdec', dataset: { v: putusan }, text: putusan === 'ok' ? 'Dikonfirmasi developer' : 'Ditandai FP' })
          : el('span', { class: 'fdec-empty', text: 'Belum ditinjau' }));
        return el('li', {}, baris, terbuka ? detailTemuanV2(t) : null);
      }))
      : el('div', { class: 'state' }, el('p', { text: semua.length ? 'Tidak ada temuan yang cocok dengan saringan ini.' : 'Panggilan deteksi tidak melaporkan temuan.' })));
    // Sidik jari berasal dari berkas hasil; hanya pola yang sah boleh masuk selector.
    if (fokusFp && /^[0-9a-f]{16}$/.test(fokusFp)) {
      const n = document.querySelector(`[aria-controls="d-${fokusFp}"]`);
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
    isi($('history'), daftar.length
      ? [
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
          return el('button', {
            class: 'hrow', type: 'button', 'aria-current': state.entri?.id === e.id ? 'true' : 'false',
            'aria-label': `Run ${e.nomor}, ${e.vendor}, ${j.temuan ?? 0} temuan, ${rincian}${gagal ? ', run gagal' : ''}`,
            onclick: () => muatRun(e),
          },
          el('span', { class: 'hnum' }, `#${e.nomor}`, gagal ? el('span', { class: 'hgagal', title: 'Run gagal', text: '!' }) : null),
          el('span', { class: 'hmeta', text: `${e.vendor ?? '—'} · ${waktu(e.selesai)}` }),
          bar,
          el('span', { class: 'htotal', text: String(j.temuan ?? 0) }));
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
  let fokusSebelumDrawer = null;
  const elemenFokus = () => [...$('drawer').querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.offsetParent !== null);
  const kurungFokus = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); tutupDrawer(); return; }
    if (e.key !== 'Tab') return;
    const f = elemenFokus();
    if (!f.length) return;
    const awal = f[0];
    const akhir = f[f.length - 1];
    if (e.shiftKey && document.activeElement === awal) { e.preventDefault(); akhir.focus(); }
    else if (!e.shiftKey && document.activeElement === akhir) { e.preventDefault(); awal.focus(); }
  };
  function bukaDrawer() {
    // Persetujuan biaya berlaku untuk satu run, jadi tidak boleh terbawa ke pembukaan berikutnya.
    if ($('f-konfirmasi-v2').checked) { $('f-konfirmasi-v2').checked = false; perbaruiTombolJalankan(); }
    fokusSebelumDrawer = document.activeElement;
    $('drawer').hidden = false;
    $('buka-drawer').setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', kurungFokus, true);
    const f = elemenFokus();
    (f[0] ?? $('drawer-tutup')).focus();
  }
  function tutupDrawer() {
    $('drawer').hidden = true;
    $('buka-drawer').setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', kurungFokus, true);
    if (fokusSebelumDrawer && document.contains(fokusSebelumDrawer)) fokusSebelumDrawer.focus();
    else $('buka-drawer').focus();
  }

  // ---------- Tab Eksperimen ----------
  // Angka ditampilkan apa adanya beserta variannya. Tidak ada peringkat, tidak ada penilaian
  // model mana yang lebih baik: itu kesimpulan yang harus ditarik di luar dashboard.
  const n3 = (v) => (typeof v === 'number' ? v.toFixed(3).replace('.', ',') : '—');
  const usd = (v) => (typeof v === 'number' ? `US$${v.toFixed(4).replace('.', ',')}` : '—');

  const tabel = (kepala, baris) => el('div', { class: 'tabel-bungkus' },
    el('table', { class: 'eks' },
      el('thead', {}, el('tr', {}, kepala.map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, baris.map((r) => el('tr', {}, r.map((c, i) => el('td', {
        class: i > 0 && typeof c !== 'object' ? 'num' : null,
      }, c)))))));

  const blokEks = (judul, keterangan, isiBlok, sumberTeks) => el('section', { class: 'eks-blok' },
    el('h3', { text: judul }),
    keterangan ? el('p', { class: 'eks-ket', text: keterangan }) : null,
    isiBlok,
    el('p', { class: 'eks-sumber', text: sumberTeks }));

  const eksSkenario = (eks) => {
    const kepala = ['Model', 'Skenario', 'Ketat P/R/F1', 'Triase konservatif P/R/F1', 'Triase utama P/R/F1'];
    const baris = [];
    for (const m of eks.per_model) {
      const a = m.skenario_a;
      baris.push([`${m.vendor} (${m.model})`, 'A — alert Sonar saja',
        `${n3(a?.precision)} / ${n3(a?.recall)} / ${n3(a?.f1)}`, '—', '—']);
      for (const [kunci, nama] of [['skenario_b', 'B — alert dipertahankan + temuan LLM'], ['skenario_c', 'C — temuan LLM saja']]) {
        const r = m.rata_rata[kunci];
        const f = (v) => (v ? `${n3(v.precision)} / ${n3(v.recall)} / ${n3(v.f1)}` : '—');
        baris.push([`${m.vendor}`, nama, f(r.ketat), f(r.triase_konservatif), f(r.triase_utama)]);
      }
    }
    return blokEks('1. Skenario A, B, dan C per model',
      'Rata-rata lintas run. Ketat: temuan di luar ground truth dihitung FP. Triase konservatif: kategori teoretis ikut dihitung FP. '
      + 'Triase utama: teoretis tidak dihitung FP. Tidak ada varian yang menambah TP, jadi recall sama di ketiganya.',
      tabel(kepala, baris),
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
        baris.push([m.vendor, String(r.run), String(j.identified_fp ?? '—'), String(j.missed_fp ?? '—'),
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
    return blokEks('2. Verifikasi empat kategori',
      'FP diperlakukan sebagai kelas positif. Putusan uncertain dihitung sebagai alert yang dipertahankan, bukan kegagalan. '
      + 'Label alert menentukan benar atau salahnya putusan, dan hanya memengaruhi tabel ini, bukan Skenario A, B, atau C.',
      el('div', {}, pilih, tabel(kepala, baris)),
      `Sumber: ${pakaiSens ? (eks.sumber.skor_sensitivitas ?? '—') : eks.sumber.skor_utama}`);
  };

  const eksTabelItem = (eks) => {
    const vendor = eks.per_model.map((m) => m.vendor);
    const kepala = ['Item', 'Kelas', 'Klasifikasi', 'Sonar A', 'Sonar B', ...vendor.flatMap((v) => [`${v} B`, `${v} C`])];
    const sel = (x) => (x ? `${x.ketat ?? 0}/${x.dari ?? 0}` : '—');
    const baris = (eks.tabel_per_item ?? []).map((t) => [
      t.id, t.kelas ?? '—', t.klasifikasi ?? '—', t.sonar_a ?? '—', t.sonar_b ?? '—',
      ...vendor.flatMap((v) => [sel(t.per_model?.[v]?.skenario_b), sel(t.per_model?.[v]?.skenario_c)]),
    ]);
    return blokEks('3. Tabel per item seeded',
      'Satu baris per item ground truth di SEEDED.md. Angka model berbentuk "run cocok ketat / jumlah run".',
      tabel(kepala, baris),
      `Sumber: ${eks.sumber.skor_utama} · objek uji ${pendek(eks.sumber.objek_uji_commit ?? '')}`);
  };

  const eksBiaya = (eks) => {
    const kepala = ['Model', 'Run', 'Biaya run', 'Total vendor'];
    const baris = [];
    for (const m of eks.per_model) {
      const total = m.runs.reduce((s, r) => s + (r.biaya_usd ?? 0), 0);
      m.runs.forEach((r, i) => baris.push([i === 0 ? m.vendor : '', String(r.run), usd(r.biaya_usd),
        i === 0 ? usd(m.biaya_total_usd ?? total) : '']));
    }
    const adaBiaya = baris.some((r) => r[2] !== '—');
    return blokEks('4. Biaya per run dan per vendor',
      'Dari metadata usage tiap panggilan. Percobaan yang ditolak sebelum diproses tidak mengembalikan usage, jadi biayanya tidak tercatat.',
      adaBiaya ? tabel(kepala, baris)
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
    } catch (err) {
      $('catatan-info').textContent = `Berkas catatan tidak bisa dibaca (${err.message}).`;
    }
  };

  const renderSemuaV2 = () => {
    $('catatan-alat').hidden = false;
    $('tabs').hidden = !state.hasil.eksperimen;
    if (!state.hasil.eksperimen && state.tab === 'eksperimen') state.tab = 'operasional';
    renderKepalaV2();
    // Run v2 bisa berasal dari CLI (tanpa pipeline) atau dari workflow (punya status job).
    if (state.jobs || state.hasil.run.pipeline) {
      renderPipeline();
    } else {
      $('pipeline-title').textContent = 'Dijalankan dari CLI, tidak lewat pipeline';
      $('pipeline-total').textContent = '—';
      isi($('nodes'));
    }
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
    $('summary').hidden = true;
    $('alerts-box').hidden = true;
    $('catatan-alat').hidden = true;
    $('tabs').hidden = true;
    $('railnav-box').hidden = true;
    $('panel-operasional').hidden = false;
    $('panel-eksperimen').hidden = true;
    isi($('filters'));
    isi($('nodes'));
    $('pipeline-title').textContent = 'Status pipeline';
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
    const model = $('f-model').value;
    const p = state.proyek;
    const branch = state.branch.name;
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
    const lama = { build: 104, sonar: 51, analisis: mode === 'sast' ? 9 : (jalur === 'v2' ? 219 : 241), hasil: 22 };
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
      arsip ? el('button', { class: 'btn-text', type: 'button', text: `Lihat contoh hasil di ${arsip.name}`, onclick: () => { state.branch = arsip; renderFormBranch(); muatIndex(); } }) : null));
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
    const inputs = { mode, model, label, jalur };
    if (jalur === 'v2') {
      const m = modelJalur().find((x) => x.id === model);
      if (!m) throw new GhError('invalid', 'Model jalur v2 tidak dikenali. Muat ulang dashboard lalu coba lagi.');
      Object.assign(inputs, { vendor_v2: m.vendor, konfirmasi_v2: 'JALANKAN', sonar_branch_v2: sonarBranchV2(branch) });
    }
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
        perbaruiTombolJalankan(el('span', {}, linkRun(run.html_url, `Run #${run.run_number}`), ` selesai (${run.conclusion === 'success' ? 'berhasil' : run.conclusion}). Hasil sudah dimuat.${state.hasil?.run?.gemini?.status === 'gagal' ? ' Analisis LLM gagal, lihat catatan di daftar temuan.' : ''}`));
        return;
      }
      await tunggu(JEDA_HASIL);
    }
    throw new GhError('invalid', `Run #${run.run_number} selesai tetapi hasilnya belum ada di branch security-results. Lihat log job "Gabung dan terbitkan hasil" di GitHub.`);
  };

  // ---------- Mulai ----------
  const ikat = () => {
    $('token-form').addEventListener('submit', simpanToken);
    $('token-clear').addEventListener('click', hapusToken);
    $('theme-toggle').addEventListener('click', () => {
      const kini = store.get('localStorage', KUNCI.tema);
      const berikut = TEMA[(TEMA.indexOf(kini) + 1) % TEMA.length];
      if (berikut) store.set('localStorage', KUNCI.tema, berikut); else store.del('localStorage', KUNCI.tema);
      terapkanTema();
    });
    $('density-toggle').addEventListener('click', () => {
      store.set('localStorage', KUNCI.padat, document.documentElement.dataset.density === 'padat' ? 'nyaman' : 'padat');
      terapkanKepadatan();
    });
    $('demo-toggle').addEventListener('click', () => (state.demo ? keluarDemo() : masukDemo()));
    $('f-jalur').addEventListener('change', () => { renderModels(); perbaruiTombolJalankan(); });
    // Tanpa pembungkus, objek Event ikut terkirim sebagai argumen `pesan` dan tercetak di hint.
    $('f-konfirmasi-v2').addEventListener('change', () => perbaruiTombolJalankan());
    $('f-model').addEventListener('change', renderBiaya);
    $('buka-drawer').addEventListener('click', bukaDrawer);
    $('drawer-tutup').addEventListener('click', tutupDrawer);
    $('drawer-tirai').addEventListener('click', tutupDrawer);
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
    $('f-branch').addEventListener('change', (e) => {
      const b = state.proyek.branches.find((x) => x.name === e.target.value);
      if (!b) return;
      state.branch = b;
      state.filter = 'semua';
      perbaruiTombolJalankan();
      muatIndex();
    });
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { if (!state.sibuk && !state.hasil) renderPipeline(); }));
    $('run-form').addEventListener('submit', jalankan);
    window.addEventListener('offline', () => tampilBanner('error', 'Koneksi internet terputus. Pemantauan run berhenti sampai koneksi kembali.'));
    window.addEventListener('online', () => tutupBanner('error'));
  };

  const mulai = async () => {
    terapkanTema();
    terapkanKepadatan();
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
