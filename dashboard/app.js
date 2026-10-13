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
  const SEVERITY = ['kritis', 'tinggi', 'sedang', 'rendah'];
  const NAMA_SUMBER = { sonar: 'Sonar', gemini: 'Gemini', both: 'Sonar + Gemini' };
  const NODE = [
    { key: 'build', nama: 'Build dan uji', job: 'Build dan uji API', hasil: 'build_test' },
    { key: 'sonar', nama: 'SonarCloud', job: 'Analisis SonarCloud', hasil: 'sonarcloud' },
    { key: 'analisis', nama: 'Analisis Gemini', job: 'Analisis temuan (Sonar dan Gemini)', hasil: 'analisis' },
    { key: 'hasil', nama: 'Gabung hasil', job: 'Gabung dan terbitkan hasil', hasil: null },
  ];
  const TEKS_STATUS = { wait: 'menunggu', run: 'berjalan', done: 'selesai', fail: 'gagal', skip: 'dilewati' };
  const KUNCI = { token: 'sd.token', tema: 'sd.tema', padat: 'sd.kepadatan', terakhir: 'sd.terakhir', keputusan: 'sd.keputusan.' };

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
  const IKON = { cek: 'M3 8.5l3 3 7-7', silang: ['M4 4l8 8', 'M12 4l-8 8'], luar: ['M9 3h4v4', 'M13 3L7 9', 'M11 9.5V13H3V5h3.5'] };
  const segitigaRevisi = () => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 14 12');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M7 0l7 12H0z');
    s.append(p);
    return s;
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
      case 'unprocessable': return 'Workflow menolak permintaan (422). Pastikan devsecops.yml di branch ini sudah memuat input mode, model, dan label.';
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

  const validasiHasil = (r) => {
    if (!r || r.schema_version !== 1 || !r.run || !Array.isArray(r.findings) || !r.sonar_verification) {
      throw new GhError('format', `Format results.json tidak dikenali (schema_version ${r?.schema_version ?? 'tidak ada'}). Dashboard ini membaca skema versi 1.`);
    }
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

  const jobsDariApi = (daftar) => Object.fromEntries(NODE.map((n) => [n.key, statusJobApi(daftar.find((j) => j.name === n.job))]));

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

  const sumberDemo = {
    projects: () => jsonLokal('fixtures/projects.json'),
    cekProject: async (p) => (p.demo_tanpa_workflow ? { akses: true, workflow: false } : { akses: true, workflow: true }),
    index: async (p) => (p.demo_tanpa_workflow ? { runs: [] } : jsonLokal('fixtures/index.json')),
    hasil: async (p, entri) => {
      if (!pathAman(entri.path)) throw new GhError('format', 'Path hasil di index.json tidak valid.');
      return validasiHasil(await jsonLokal(`fixtures/${entri.path}`));
    },
    jobs: async (p, runId) => {
      try {
        const data = await jsonLokal('fixtures/jobs.json');
        const run = data.runs?.[String(runId)];
        if (!run) return null;
        return Object.fromEntries(NODE.map((n) => {
          const [, lama] = run[n.key] ?? [];
          return [n.key, lama ? { s: 'done', durasi: lama } : { s: 'skip', durasi: null }];
        }));
      } catch {
        return null;
      }
    },
  };

  const sumber = () => (state.demo ? sumberDemo : sumberLive);

  // ---------- Tema dan kepadatan ----------
  const TEMA = [null, 'terang', 'gelap'];
  const terapkanTema = () => {
    const t = store.get('localStorage', KUNCI.tema);
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    $('theme-toggle').textContent = `Tema: ${t ?? 'ikuti sistem'}`;
  };
  const terapkanKepadatan = () => {
    const d = store.get('localStorage', KUNCI.padat) === 'padat' ? 'padat' : 'nyaman';
    document.documentElement.dataset.density = d;
    $('density-toggle').textContent = `Kepadatan: ${d}`;
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
    'Mode demo. Data diambil dari arsip eksperimen 10 Okt 2026 (eksperimen/seeded, commit 5cbf05c). Run #1 adalah contoh sintetis untuk state Gemini gagal, dan durasi job juga contoh.',
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

  // ---------- Form jalankan ----------
  const renderFormBranch = () => {
    const sel = $('f-branch');
    isi(sel, state.proyek.branches.map((b) => el('option', { value: b.name, text: b.dispatch ? b.name : `${b.name} · arsip`, selected: b === state.branch })));
    perbaruiTombolJalankan();
  };

  const modeTerpilih = () => document.querySelector('input[name="mode"]:checked')?.value ?? 'sast-llm';

  const alasanTidakBisa = () => {
    const st = state.statusProject.get(state.proyek) ?? {};
    if (!state.demo && !state.token) return 'Masukkan token GitHub dulu.';
    if (st.akses === false) return 'Token tidak punya akses ke repo ini.';
    if (st.workflow === false) return `Repo ini belum punya ${state.proyek.workflow}. Pasang workflow framework dulu.`;
    if (!state.branch.dispatch) return state.branch.catatan || 'Branch ini tidak bisa dipicu dari dashboard.';
    return null;
  };

  const perbaruiTombolJalankan = (pesan, jenis) => {
    const alasan = alasanTidakBisa();
    const btn = $('run-btn');
    btn.disabled = state.sibuk || Boolean(alasan);
    if (state.sibuk) btn.dataset.busy = ''; else btn.removeAttribute('data-busy');
    $('run-btn-label').textContent = state.sibuk ? 'Sedang berjalan…' : 'Jalankan analisis';
    $('f-branch').disabled = state.sibuk;
    const hint = $('run-hint');
    hint.dataset.kind = jenis || '';
    if (pesan instanceof Node) isi(hint, pesan);
    else hint.textContent = pesan ?? alasan ?? (state.demo ? 'Mode demo: run disimulasikan, GitHub tidak dipanggil.' : `Memicu ${state.proyek.workflow} lewat GitHub API. API key Gemini dan Sonar tetap di GitHub Secrets.`);
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
    state.keputusan = bacaJsonLokal(kunciKeputusan(), {});
    renderSemua();
  };

  // ---------- Keputusan developer ----------
  const kunciKeputusan = () => `${KUNCI.keputusan}${state.proyek.owner}/${state.proyek.repo}.${state.hasil?.run?.id ?? state.entri?.id}`;
  const putuskan = (f, v) => {
    const kini = state.keputusan[f.id]?.v === v ? null : v;
    if (kini) state.keputusan[f.id] = { v: kini, t: new Date().toISOString(), fp: f.fingerprint };
    else delete state.keputusan[f.id];
    if (!store.set('localStorage', kunciKeputusan(), JSON.stringify(state.keputusan))) {
      tampilBanner('info', 'Browser menolak penyimpanan. Keputusan hanya bertahan sampai halaman dimuat ulang.');
    }
    renderRingkasan();
    renderTemuan(`${f.id}-${v}`);
  };

  // ---------- Turunan data ----------
  const sidikSebelumnya = () => (state.sebelumnya ? new Set(state.sebelumnya.findings.map((f) => f.fingerprint)) : null);
  const temuanBaru = (f, sidik) => Boolean(sidik && !sidik.has(f.fingerprint));
  const perluTindakan = (f) => {
    const k = state.keputusan[f.id]?.v;
    if (k === 'fp') return false;
    if (k === 'ok') return true;
    return f.status_ai !== 'rejected';
  };

  // ---------- Render ----------
  const renderMemuat = () => {
    $('summary').hidden = true;
    isi($('findings-body'), el('div', { class: 'skeleton', 'aria-label': 'Memuat hasil' }, el('i'), el('i'), el('i'), el('i')));
    isi($('filters'));
    renderKepala();
    renderPipeline();
  };

  const renderKosong = (pesanGalatTeks, galat) => {
    renderKepala();
    renderPipeline();
    renderSamping();
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
      teks = alasanTidakBisa() ?? 'Tekan Jalankan analisis untuk membuat run pertama. Hasilnya muncul di sini setelah job Gabung hasil selesai.';
    }
    isi($('findings-body'), el('div', { class: 'state' }, el('h3', { text: judul }), el('p', { text: teks }), aksi));
  };

  const renderKepala = () => {
    const p = state.proyek;
    const r = state.hasil?.run;
    const crumb = $('crumb');
    const repoLink = p.demo_tanpa_workflow ? el('span', { text: `${p.owner} / ${p.repo}` }) : el('a', { href: urlGithub(p.owner, p.repo), target: '_blank', rel: 'noopener noreferrer', text: `${p.owner} / ${p.repo}` });
    isi(crumb, repoLink, ` / ${state.branch.name}`, r ? ` · selesai ${waktu(r.selesai)}` : '');
    const jumlah = state.hasil?.findings.length ?? 0;
    const kritis = state.hasil?.findings.filter((f) => f.severity === 'kritis').length ?? 0;
    $('run-title').textContent = r
      ? `Run #${r.nomor} · ${jumlah} temuan${kritis ? `, ${kritis} kritis` : ''}`
      : (state.entri ? `Memuat run #${state.entri.nomor}…` : `Belum ada run di ${state.branch.name}`);

    const sel = (label, nilai, opsi = {}) => el('div', {}, el('dt', { text: label }), el('dd', { class: [opsi.data ? 'data' : '', opsi.warn ? 'warn' : ''].join(' ').trim() || null, title: opsi.title }, nilai));
    if (!r) {
      isi($('title-block'), ['Commit', 'Model', 'Prompt', 'SAST', 'Durasi'].map((l) => sel(l, '—')));
      return;
    }
    const commit = /^[0-9a-f]{7,40}$/.test(r.commit) && !p.demo_tanpa_workflow
      ? el('a', { href: urlGithub(p.owner, p.repo, 'commit', r.commit), target: '_blank', rel: 'noopener noreferrer', text: pendek(r.commit) })
      : pendek(r.commit);
    const sast = r.sast?.sesuai_commit === false ? 'SonarCloud, commit lain' : 'SonarCloud';
    isi($('title-block'),
      sel('Commit', commit, { data: true, title: r.commit }),
      sel('Model', r.model ?? 'tidak dipakai (SAST saja)'),
      sel('Prompt', r.prompt_sha256 ? pendek(r.prompt_sha256, 8) : '—', { data: true, title: r.prompt_sha256 ?? undefined }),
      sel('SAST', sast, { warn: r.sast?.sesuai_commit === false, title: r.sast?.sesuai_commit === false ? `Data Sonar dari analisis ${r.sast.revisi_analisis}` : undefined }),
      sel('Durasi', durasi(r.durasi_detik), { data: true }));
  };

  const statusNodeDariHasil = () => {
    const r = state.hasil?.run;
    if (!r) return null;
    return Object.fromEntries(NODE.map((n) => {
      if (!n.hasil) return [n.key, { s: 'done', durasi: null }];
      const v = r.jobs?.[n.hasil];
      return [n.key, { s: { success: 'done', skipped: 'skip', failure: 'fail', cancelled: 'fail' }[v] ?? 'wait', durasi: null }];
    }));
  };

  const renderPipeline = (live) => {
    const mode = live?.mode ?? state.hasil?.run?.mode ?? modeTerpilih();
    const status = live?.jobs ?? state.jobs ?? statusNodeDariHasil() ?? {};
    const geminiGagal = !live && state.hasil?.run?.gemini?.status === 'gagal';
    $('pipeline-title').textContent = live ? `Run ${live.nomor ? `#${live.nomor}` : 'baru'}` : (state.hasil ? `Pipeline run #${state.hasil.run.nomor}` : 'Status pipeline');
    const total = Object.values(status).reduce((s, j) => s + (Number.isFinite(j?.durasi) ? j.durasi : 0), 0);
    $('pipeline-total').textContent = total ? `total ${durasi(total)}` : '';
    isi($('nodes'), NODE.map((n) => {
      let st = status[n.key] ?? { s: 'wait', durasi: null };
      let teks = TEKS_STATUS[st.s];
      if (n.key === 'analisis' && geminiGagal && st.s === 'done') { st = { ...st, s: 'fail' }; teks = 'Gemini gagal'; }
      const nama = n.key === 'analisis' && mode === 'sast' ? 'Ambil temuan Sonar' : n.nama;
      return el('li', { class: 'node', dataset: { s: st.s } },
        el('span', { class: 'seg-line', 'aria-hidden': 'true' }),
        el('span', { class: 'node-mark', 'aria-hidden': 'true' }, ikon(st.s === 'fail' ? IKON.silang : IKON.cek)),
        el('span', { class: 'node-name', text: nama }),
        el('span', { class: 'node-state', text: teks }),
        el('span', { class: 'node-dim', 'aria-label': `durasi ${durasi(st.durasi)}`, text: durasi(st.durasi) }));
    }));
  };

  const renderRingkasan = () => {
    const h = state.hasil;
    const box = $('summary');
    if (!h) { box.hidden = true; return; }
    box.hidden = false;
    const f = h.findings;
    const sidik = sidikSebelumnya();
    const tindakan = (sev) => f.filter((x) => (Array.isArray(sev) ? sev.includes(x.severity) : x.severity === sev) && perluTindakan(x)).length;
    const baruKritis = f.filter((x) => x.severity === 'kritis' && temuanBaru(x, sidik)).length;
    const sonarTotal = f.filter((x) => x.sumber !== 'gemini').length;
    const diputuskan = Object.keys(state.keputusan).filter((id) => f.some((x) => x.id === id)).length;
    const per = { both: 0, gemini: 0, sonar: 0 };
    for (const x of f) per[x.sumber] += 1;

    const cell = (cls, label, num, note) => el('div', { class: `cell ${cls}` }, el('span', { class: 'cell-label', text: label }), el('span', { class: 'cell-num' }, num), note);
    const bar = el('div', { class: 'srcbar', role: 'img', 'aria-label': `${per.both} dari keduanya, ${per.gemini} hanya Gemini, ${per.sonar} hanya Sonar` },
      ['both', 'gemini', 'sonar'].map((k) => { const i = el('i', { class: `sw-${k}` }); i.style.setProperty('width', `${f.length ? (per[k] / f.length) * 100 : 0}%`); return i; }));
    isi(box,
      cell('crit', 'Kritis, perlu tindakan', String(tindakan('kritis')),
        sidik ? el('span', { class: `cell-note${baruKritis ? ' rev' : ''}` }, baruKritis ? [segitigaRevisiKecil(), `${baruKritis} baru sejak run #${state.sebelumnya.run.nomor}`] : `tidak ada yang baru sejak run #${state.sebelumnya.run.nomor}`) : el('span', { class: 'cell-note', text: 'run pertama di branch ini' })),
      cell('high', 'Tinggi, perlu tindakan', String(tindakan('tinggi')), null),
      cell('', 'Sedang dan rendah', String(tindakan(['sedang', 'rendah'])), null),
      cell('', 'Ditolak AI', String(f.filter((x) => x.status_ai === 'rejected').length), el('span', { class: 'cell-note', text: h.run.gemini?.status === 'ok' ? `dari ${sonarTotal} temuan Sonar` : 'Gemini tidak menilai run ini' })),
      cell('', 'Diverifikasi developer', [String(diputuskan), el('small', { text: ` / ${f.length}` })], el('span', { class: 'cell-note', text: 'tersimpan di browser ini' })),
      el('div', { class: 'cell' }, el('span', { class: 'cell-label', text: 'Per sumber' }), bar,
        el('div', { class: 'legend' }, ['both', 'gemini', 'sonar'].map((k) => el('span', {}, el('i', { class: `sw sw-${k}`, 'aria-hidden': 'true' }), `${NAMA_SUMBER[k]} ${per[k]}`)))));
  };

  const segitigaRevisiKecil = () => { const s = segitigaRevisi(); s.setAttribute('class', 'icon'); s.style.setProperty('fill', 'currentColor'); s.style.setProperty('stroke', 'none'); return s; };

  const FILTER = [
    { key: 'semua', label: 'Semua', cocok: () => true },
    { key: 'both', label: 'Sonar + Gemini', cocok: (f) => f.sumber === 'both' },
    { key: 'gemini', label: 'Gemini', cocok: (f) => f.sumber === 'gemini' },
    { key: 'sonar', label: 'Sonar', cocok: (f) => f.sumber === 'sonar' },
    { key: 'baru', label: 'Baru', cocok: (f, sidik) => temuanBaru(f, sidik), butuhSebelumnya: true },
  ];

  const renderFilter = () => {
    const h = state.hasil;
    if (!h) { isi($('filters')); return; }
    const sidik = sidikSebelumnya();
    if (state.filter === 'baru' && !sidik) state.filter = 'semua';
    isi($('filters'), FILTER.filter((x) => !x.butuhSebelumnya || sidik).map((x) => el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-pressed': state.filter === x.key ? 'true' : 'false',
      onclick: () => { state.filter = x.key; state.terbuka = null; renderFilter(); renderTemuan(); },
    }, x.label, ' ', el('span', { class: 'count', text: String(h.findings.filter((f) => x.cocok(f, sidik)).length) }))));
  };

  const teksStatusAi = (f, run) => {
    if (f.status_ai === 'confirmed') return 'Gemini juga melaporkan temuan ini.';
    if (f.status_ai === 'rejected') return 'Gemini tidak melaporkan ulang temuan Sonar ini.';
    if (f.status_ai === 'new') return 'Hanya ditemukan Gemini, tidak ada di laporan Sonar.';
    return run.mode === 'sast' ? 'Gemini tidak berjalan pada mode SAST saja.' : 'Gemini gagal pada run ini, jadi temuan Sonar belum diperiksa ulang.';
  };

  const renderDetail = (f) => {
    const run = state.hasil.run;
    const dariAi = f.sumber !== 'sonar';
    const kode = f.potongan_kode?.baris?.length
      ? el('pre', { class: 'code', 'aria-label': `Potongan kode ${f.file} sekitar baris ${f.baris}` },
        f.potongan_kode.baris.map((teks, i) => {
          const ln = f.potongan_kode.mulai + i;
          return el('span', { class: ln === f.baris ? 'hit' : null, dataset: { ln: String(ln) }, text: teks });
        }))
      : null;
    const k = state.keputusan[f.id];
    const fakta = [
      f.cwe?.length ? ['CWE', f.cwe.join(', ')] : null,
      f.kategori_owasp ? ['OWASP', f.kategori_owasp] : null,
      f.keyakinan_gemini ? ['Keyakinan Gemini', f.keyakinan_gemini] : null,
      f.sonar_rule ? ['Aturan Sonar', f.sonar_rule] : null,
    ].filter(Boolean);
    return el('div', { class: 'fdetail', id: `d-${f.id}`, role: 'region', 'aria-label': `Detail ${f.id}` },
      el('div', { class: 'fdetail-grid' },
        el('div', {},
          el('h3', { class: 'block-h' }, 'Alasan', el('span', { class: 'tag-ai', text: dariAi ? 'Temuan AI' : 'Temuan Sonar' })),
          f.alasan ? el('p', { text: f.alasan }) : el('p', { class: 'empty-note', text: 'Tidak ada penjelasan dari sumber.' })),
        el('div', {},
          el('h3', { class: 'block-h' }, 'Rekomendasi', el('span', { class: 'tag-ai', text: 'Rekomendasi AI' })),
          f.rekomendasi ? el('p', { text: f.rekomendasi }) : el('p', { class: 'empty-note', text: 'Belum tersedia pada versi prompt ini.' }))),
      kode,
      el('p', { class: 'facts' }, fakta.map(([l, v]) => el('span', {}, `${l} `, el('b', { class: 'data', text: v })))),
      el('p', { class: 'derived' }, teksStatusAi(f, run),
        f.status_ai_asal ? ' Status diturunkan dari pencocokan file, baris, dan CWE.' : '',
        f.severity_asal === 'turunan-cwe' ? ' Severity diturunkan dari CWE karena Gemini tidak memberi severity.' : ''),
      el('div', { class: 'decide' },
        el('button', { class: 'btn btn-sm', type: 'button', id: `${f.id}-ok`, 'aria-pressed': k?.v === 'ok' ? 'true' : 'false', onclick: () => putuskan(f, 'ok') }, 'Konfirmasi rentan'),
        el('button', { class: 'btn btn-sm', type: 'button', id: `${f.id}-fp`, 'aria-pressed': k?.v === 'fp' ? 'true' : 'false', onclick: () => putuskan(f, 'fp') }, 'Tandai false positive'),
        el('span', { class: 'stamp', text: k ? `${k.v === 'ok' ? 'Dikonfirmasi rentan' : 'Ditandai false positive'} · ${waktu(k.t)}` : 'Belum ada keputusan developer.' })));
  };

  const renderTemuan = (fokusId) => {
    const h = state.hasil;
    const body = $('findings-body');
    if (!h) return;
    const sidik = sidikSebelumnya();
    const aturan = FILTER.find((x) => x.key === state.filter) ?? FILTER[0];
    const daftar = h.findings.filter((f) => aturan.cocok(f, sidik));
    if (!h.findings.length) {
      isi(body, el('div', { class: 'state' }, el('h3', { text: 'Tidak ada temuan pada run ini' }),
        el('p', { text: h.run.gemini?.status === 'gagal' ? 'SonarCloud tidak melaporkan apa pun dan analisis Gemini gagal. Jalankan ulang untuk memastikan.' : 'SonarCloud dan Gemini tidak melaporkan kerentanan.' })));
      return;
    }
    if (!daftar.length) {
      isi(body, el('div', { class: 'state' }, el('h3', { text: 'Tidak ada temuan untuk saringan ini' }),
        el('button', { class: 'btn btn-sm', type: 'button', text: 'Tampilkan semua', onclick: () => { state.filter = 'semua'; renderFilter(); renderTemuan(); } })));
      return;
    }
    isi(body, el('ul', { class: 'flist' }, daftar.map((f) => {
      const terbuka = state.terbuka === f.id;
      const k = state.keputusan[f.id];
      const lokasi = f.file ? `${f.file}${f.baris ? `:${f.baris}` : ''}` : 'lokasi tidak disebut';
      return el('li', {},
        el('button', {
          class: 'frow', type: 'button', 'aria-expanded': terbuka ? 'true' : 'false', 'aria-controls': `d-${f.id}`,
          onclick: () => { state.terbuka = terbuka ? null : f.id; renderTemuan(f.id); },
        },
        el('span', { class: 'fid', text: f.id }),
        el('span', { class: `sev sev-${f.severity}`, text: f.severity }),
        el('span', { class: 'ftitle' }, el('span', { text: f.judul }), temuanBaru(f, sidik) ? el('span', { class: 'rev-mark', title: 'Baru sejak run sebelumnya' }, segitigaRevisi(), 'baru') : null),
        el('span', { class: 'floc', title: lokasi }, el('bdi', { text: lokasi })),
        el('span', { class: 'fsrc' }, el('i', { class: `sw sw-${f.sumber}`, 'aria-hidden': 'true' }), NAMA_SUMBER[f.sumber]),
        k ? el('span', { class: 'fdec', dataset: { v: k.v } }, ikon(k.v === 'ok' ? IKON.cek : IKON.silang), k.v === 'ok' ? 'rentan' : 'false positive')
          : el('span', { class: 'fdec-empty' }, el('span', { class: 'visually-hidden', text: 'belum diputuskan' }), '—')),
        terbuka ? renderDetail(f) : null);
    })));
    if (fokusId) document.getElementById(fokusId)?.focus({ preventScroll: true });
  };

  const renderSamping = () => {
    const h = state.hasil;
    const v = h?.sonar_verification;
    isi($('verif'), v
      ? [
        el('div', { class: 'kv' }, el('span', { text: 'Dikonfirmasi Gemini' }), el('b', { text: String(v.dikonfirmasi) })),
        el('div', { class: 'kv' }, el('span', { text: 'Tidak dilaporkan ulang' }), el('b', { text: String(v.ditolak) })),
        el('div', { class: 'kv' }, el('span', { text: 'Perlu review manual' }), el('b', { text: String(v.perlu_review) })),
        el('p', { class: 'note', text: h.run.gemini?.status === 'ok' ? 'Diturunkan dari pencocokan file, baris, dan CWE; bukan putusan eksplisit Gemini.' : 'Gemini tidak menilai run ini, jadi semua temuan Sonar perlu review manual.' }),
      ]
      : el('p', { class: 'note', text: 'Belum ada run.' }));

    const daftar = entriBranch();
    isi($('history'), daftar.length
      ? daftar.slice(0, 12).map((e) => {
        const tot = e.jumlah?.total ?? 0;
        const bar = el('span', { class: 'hbar', 'aria-hidden': 'true' }, [['kritis', 'var(--crit)'], ['tinggi', 'var(--high)'], ['sedang', 'var(--rule-2)']].map(([k, warna]) => {
          const i = el('i');
          i.style.setProperty('width', `${tot ? ((e.jumlah?.[k] ?? 0) / tot) * 100 : 0}%`);
          i.style.setProperty('background', warna);
          return i;
        }));
        const gagal = e.gemini === 'gagal' ? ' · Gemini gagal' : '';
        return el('button', {
          class: 'hrow', type: 'button', 'aria-current': state.entri?.id === e.id ? 'true' : 'false',
          'aria-label': `Run ${e.nomor}, ${e.mode}, ${tot} temuan${gagal}`, onclick: () => muatRun(e),
        }, el('span', { class: 'hnum', text: `#${e.nomor}` }), el('span', { class: 'hmeta', text: `${e.mode} · ${waktu(e.selesai)}${gagal}` }), bar, el('span', { class: 'htotal', text: String(tot) }));
      })
      : el('p', { class: 'note', text: 'Belum ada run di branch ini.' }));

    const m = h?.metrics;
    $('metrics-box').hidden = !m;
    if (!m) return;
    const baris = (label, nilai) => {
      const i = el('i');
      i.style.setProperty('width', `${Math.max(0, Math.min(1, Number(nilai) || 0)) * 100}%`);
      return el('div', { class: 'mbar' }, el('span', { text: label }), el('span', { class: 'mtrack', 'aria-hidden': 'true' }, i), el('span', { class: 'v', text: Number.isFinite(Number(nilai)) ? Number(nilai).toFixed(3).replace('.', ',') : '—' }));
    };
    const blok = (judul, skor) => (skor ? el('div', { class: 'metric' }, el('p', { class: 'metric-h', text: judul }), baris('Precision', skor.precision), baris('Recall', skor.recall), baris('F1', skor.f1),
      el('p', { class: 'note', text: `TP ${skor.tp} · FP ${skor.fp} · FN ${skor.fn}` })) : null);
    isi($('metrics'),
      el('p', { class: 'note', text: `${m.jumlah_positif ?? '—'} kerentanan berstatus terbukti di SEEDED.md. Angka untuk run ini saja.` }),
      blok('Ketat: file, lokasi, dan CWE cocok', m.ketat),
      blok('Longgar: lokasi cocok', m.longgar_cocok_lokasi));
  };

  const renderSemua = () => {
    renderKepala();
    renderPipeline();
    renderRingkasan();
    renderFilter();
    renderTemuan();
    renderSamping();
    perbaruiTombolJalankan();
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
    if (state.sibuk || alasanTidakBisa()) return;
    const mode = modeTerpilih();
    const model = $('f-model').value;
    const p = state.proyek;
    const branch = state.branch.name;
    const pantau = { batal: false };
    state.pantau = pantau;
    state.sibuk = true;
    const awal = Object.fromEntries(NODE.map((n) => [n.key, { s: 'wait', durasi: null }]));
    renderPipeline({ mode, jobs: awal });
    perbaruiTombolJalankan(state.demo ? 'Simulasi dimulai.' : 'Mengirim permintaan ke GitHub…');
    try {
      if (state.demo) await simulasi(mode, pantau);
      else await dispatchLive(p, branch, mode, model, pantau);
    } catch (err) {
      if (pantau.batal) return;
      state.sibuk = false;
      perbaruiTombolJalankan(pesanGalat(err), 'error');
      return;
    }
  };

  const simulasi = async (mode, pantau) => {
    const jobs = Object.fromEntries(NODE.map((n) => [n.key, { s: 'wait', durasi: null }]));
    const lama = { build: 104, sonar: 51, analisis: mode === 'sast' ? 9 : 241, hasil: 22 };
    for (const n of NODE) {
      if (pantau.batal) return;
      jobs[n.key] = { s: 'run', durasi: null };
      renderPipeline({ mode, jobs, nomor: null });
      perbaruiTombolJalankan(`Simulasi: ${n.key === 'analisis' && mode === 'sast' ? 'Ambil temuan Sonar' : n.nama} berjalan.`);
      await tunggu(1100);
      jobs[n.key] = { s: 'done', durasi: lama[n.key] };
      renderPipeline({ mode, jobs, nomor: null });
    }
    if (pantau.batal) return;
    state.sibuk = false;
    state.pantau = null;
    const arsip = state.proyek.branches.find((b) => !b.dispatch);
    perbaruiTombolJalankan(el('span', {}, 'Simulasi selesai. Mode demo tidak membuat hasil baru. ',
      arsip ? el('button', { class: 'btn-text', type: 'button', text: `Lihat contoh hasil di ${arsip.name}`, onclick: () => { state.branch = arsip; renderFormBranch(); muatIndex(); } }) : null));
  };

  const dispatchLive = async (p, branch, mode, model, pantau) => {
    const label = `sd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dikirim = Date.now();
    await gh(`${repoPath(p)}/actions/workflows/${enc(p.workflow)}/dispatches`, { method: 'POST', body: { ref: branch, inputs: { mode, model, label } } });
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
      renderPipeline({ mode, jobs: jobsDariApi(dataJobs.jobs || []), nomor: info.run_number });
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
        perbaruiTombolJalankan(el('span', {}, linkRun(run.html_url, `Run #${run.run_number}`), ` selesai (${run.conclusion === 'success' ? 'berhasil' : run.conclusion}). Hasil sudah dimuat.`));
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

  const mulai = () => {
    terapkanTema();
    terapkanKepadatan();
    muatToken();
    ikat();
    renderAkses(state.token ? 'ok' : 'none', state.token ? teksTokenAktif() : 'Belum ada token');
    $('token-remember').checked = state.tokenDiingat;
    if (location.protocol === 'file:') {
      tampilBanner('error', 'Dashboard dibuka langsung dari file. Jalankan lewat server lokal (lihat README) supaya projects.json dan mode demo bisa dibaca.');
    }
    if (location.hash === '#demo') masukDemo();
    else if (state.token) masukLive();
    else tampilStart();
  };

  mulai();
})();
