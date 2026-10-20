# AGENTS.md

Aturan kerja untuk agen AI di repo ini. Berlaku untuk Antigravity, Claude Code, Cursor, dan
sejenisnya. Baca seluruhnya sebelum menyentuh apa pun.

## Apa ini

Tugas Akhir S1 Teknologi Informasi, Telkom University. **Luarannya adalah framework SSDLC berbasis
DevOps dengan analisis keamanan berbantuan LLM**, bukan aplikasinya. Pipeline GitHub Actions
menjalankan build dan uji, SAST SonarCloud, lalu analisis LLM, dan menerbitkan hasilnya ke branch
`security-results`. Security Dashboard adalah antarmuka developer untuk memicu pipeline,
memantaunya, dan membaca temuan sampai ke file dan baris.

Aplikasi SIA (sistem informasi akademik) di `src/` **hanya objek uji**, bukan produk yang
dikembangkan. Rancangan lengkap: `PRODUCT.md`, `docs/superpowers/PRD.md`,
`docs/superpowers/ARCHITECTURE.md`, dan `dashboard/README.md` (paling rinci untuk dashboard).

## Batas keras

Langgar satu pun dan data eksperimen TA ini rusak atau uangnya terbakar.

1. **Jangan `git push`.** Tidak pernah, kecuali diminta eksplisit di pesan itu juga.
2. **Jangan memicu workflow** (`workflow_dispatch`, `gh workflow run`, push yang memicu CI).
3. **Jangan memanggil API LLM berbayar.** Gemini, Anthropic, dan OpenAI dipanggil hanya oleh
   pipeline, tidak pernah oleh agen.
4. **Jangan menulis ulang riwayat git.** Tanpa `rebase`, `--force`, `reset --hard`, atau `--amend`,
   kecuali diminta eksplisit.
5. **Jangan menyentuh berkas ini:**
   - `prompts/v2/**` — hash-nya dikunci `prompts/v2/HASHES.txt` dan harus tetap 8/8 OK
   - `src/**` dan `SEEDED.md` — objek uji beserta ground truth kerentanan tertanam
   - `hasil-eksperimen/**` — data eksperimen yang sudah diambil
6. **Jangan membaca, membuat, atau mengubah GitHub Secrets**, dan jangan menaikkan izin token
   dashboard.
7. **Jangan mencetak isi token atau API key** ke log, terminal, maupun berkas. `.env` berisi
   kredensial asli.
8. **Jangan menambah dependensi produksi.** Perkakas uji tetap di luar repo atau devDependency
   yang sudah ada.
9. **Jangan menulis trailer atribusi** (`Co-Authored-By`, "Generated with …") di pesan commit.
10. **Jangan menaruh path lokal atau info mesin** di berkas yang di-commit.

## Keadaan sekarang (20 Oktober 2026)

Branch kerja **`feat/prompt-v2`**, **15 commit belum di-push**. Isinya dua hal:

1. **Penerapan desain Stitch ke dashboard** (11 commit, `c99c520`..`08c833e`): token warna dan font
   baru, kepala run, graf alur pipeline, drawer detail temuan, tab Eksperimen bernomor bagian.
   Hanya bahasa visual yang berubah; logika, data, dan aturan keamanan tetap.
2. **Sidebar, rekaman run CI, dan tautan GitHub** (4 commit, `213b675`..`60e670c`): sidebar
   bergaya Stitch dengan lencana dari data asli, rekaman run CI #54 sebagai data demo supaya graf
   pipeline bisa tergambar, dan tautan tervalidasi ke run, job, commit, dan berkas di GitHub.

Yang belum dikerjakan dan sudah diputuskan ditunda: mode SAST saja menerbitkan skema 2, tercatat di
`dashboard/README.md` bagian "Rencana lanjutan".

## Aturan yang mengikat isi dashboard

Ini bukan selera, ini sudah jadi keputusan dan ada tesnya:

- **Tidak pernah mengarang angka.** Kalau datanya belum ada, katakan belum ada. Lencana berisi 0
  palsu, persentase keyakinan yang dikarang, dan nama file yang tidak ada adalah cacat, bukan
  pengisi ruang.
- **Tidak ada `innerHTML` untuk data.** Semua lewat `createElement`/`textContent`, SVG lewat
  `createElementNS`. CSP di `dashboard/index.html` tidak boleh berubah:
  `connect-src 'self' https://api.github.com` dan tidak ada host lain.
- **Font dipasang sendiri** di `dashboard/fonts/` beserta lisensi SIL OFL. Tanpa Google Fonts,
  tanpa CDN, tanpa gambar eksternal. Ikon adalah SVG inline buatan sendiri.
- **Tautan github.com hanya boleh jadi `href`**, tidak pernah sasaran `fetch` atau `gh()`.
  URL dibangun hanya dari nilai tervalidasi; yang tidak lolos tidak menghasilkan tautan sama
  sekali. Dikunci `tests/tautan-github.test.js`.
- **Graf pipeline punya satu sumber kebenaran**, konstanta `PIPELINE` di `dashboard/app.js`, yang
  dibandingkan dengan `.github/workflows/devsecops.yml` oleh `tests/pipeline.test.js`.
- **Dua tema setara.** Desain Stitch hanya merancang tema gelap; tema terang dirancang terpisah
  dengan hierarki permukaan yang sama, bukan hasil pembalikan warna.

## Cara memverifikasi

Di dalam repo:

```bash
npm test                                   # node --test
node --check dashboard/app.js
cd prompts/v2 && sha256sum -c HASHES.txt   # harus 8/8 OK
node scripts/validasi-skema.js             # fixture v2 terhadap skema
```

Catatan jujur tentang `npm test`: berkas `tests/api.test.js`, `cuti.test.js`, `khs.test.js`,
`profil.test.js`, dan `list-query.test.js` memanggil server API lewat HTTP dan **gagal dengan
`ECONNREFUSED` kalau server tidak jalan**. Jalankan `npm start` dulu kalau ingin semuanya hijau.
Tes yang berhubungan dengan dashboard tidak butuh server:

```bash
node --test tests/pipeline.test.js tests/publikasi.test.js tests/results-v2.test.js \
  tests/merge-results.test.js tests/llm-render.test.js tests/llm-score.test.js \
  tests/llm-lanjut.test.js tests/llm-sonar-beku.test.js tests/tautan-github.test.js
```

Di luar repo: gerbang tampilan, kontras, aksesibilitas, sidebar, drawer, dan dispatch dijalankan
dengan Playwright dan axe-core yang **sengaja tidak dijadikan dependensi repo**. Cara menyusunnya
beserta enam jebakan yang pernah meloloskan cacat nyata ada di `dashboard/README.md` bagian
"Pemeriksaan". Menyalin repo ke mesin lain berarti menulis ulang perkakas itu dari tabel di sana.

Dashboard dibuka lewat server lokal, bukan `file://`:

```bash
cd dashboard && python -m http.server 8765
# lalu http://127.0.0.1:8765/#demo
```

## Cara bekerja di sini

- **Bahasa Indonesia** untuk komentar kode, pesan commit, dan dokumentasi. Istilah teknis yang
  sudah baku (commit, branch, dispatch, false positive) dibiarkan apa adanya.
- **Komentar menjelaskan alasan, bukan isi baris.** Kalau sebuah aturan CSS atau cabang logika ada
  karena pernah ada cacat, sebut cacatnya.
- **Pesan commit** memakai awalan `feat`/`fix`/`docs`/`test`/`style` dengan ruang lingkup, lalu
  badan yang menjelaskan sebab, bukan sekadar daftar perubahan.
- **Laporkan apa adanya.** Kalau tes gagal, katakan gagal beserta keluarannya. Kalau sebuah
  langkah dilewati, katakan dilewati. Jangan menyatakan sesuatu terverifikasi kalau belum
  dijalankan.
- Perkakas sementara, skrip tambalan, dan screenshot **tidak masuk repo**. Taruh di folder
  sementara di luar repo.

## Peta berkas

| Jalur | Isi |
|---|---|
| `dashboard/` | Security Dashboard: HTML, CSS, JS vanilla tanpa build step. `README.md` di dalamnya paling rinci |
| `dashboard/fixtures/` | Data mode demo, seluruhnya nyata: run eksperimen 19 Okt dan rekaman run CI #54 |
| `.github/workflows/devsecops.yml` | Pipeline: rencana, build-test, sonarcloud, analisis (v1), analisis-v2, hasil |
| `scripts/llm/` | Mesin analisis v2: deteksi, verifikasi, penyusun `results.json` skema 2, penilaian |
| `prompts/v2/` | Prompt jalur v2. **Terkunci hash** |
| `src/` | Aplikasi SIA, objek uji. **Jangan diubah** |
| `tests/` | `node --test`. Yang berhubungan dengan dashboard tidak butuh server |
| `docs/design/` | Skema `results.json`, mockup, catatan rancangan |
| `hasil-eksperimen/` | Data eksperimen TA. **Jangan diubah** |

## Kalau ragu

Tanya dulu. Keputusan yang menyangkut data eksperimen, biaya panggilan LLM, atau isi branch
`security-results` tidak boleh diambil sendiri oleh agen.
