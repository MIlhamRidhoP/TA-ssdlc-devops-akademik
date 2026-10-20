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
   - `prompts/v2/**` dan `prompts/remediasi-v1/**` — dikunci HASHES.txt masing-masing. Aturannya
     dua arah: `sha256sum -c` harus OK, **dan** folder itu hanya boleh berisi berkas yang tercantum
     di HASHES.txt. `sha256sum -c` tidak pernah mengeluh soal berkas yang TIDAK tercantum, jadi
     menambah satu varian prompt baru di situ lolos 8/8 OK. `tests/kunci-prompt.test.js` menutup
     arah kedua itu; pengecualiannya hanya HASHES.txt sendiri dan README.md.
   - `src/**` dan `SEEDED.md` — objek uji beserta ground truth kerentanan tertanam
   - `hasil-eksperimen/**` — data eksperimen yang sudah diambil
   - Skrip penilaian: `scripts/llm/score.js`, `scripts/llm-score.js`, dan
     `scripts/buat-acuan-skor.js` — mengubahnya menggeser angka eksperimen
6. **Jangan membaca, membuat, atau mengubah GitHub Secrets**, dan jangan menaikkan izin token
   dashboard.
7. **Jangan mencetak isi token atau API key** ke log, terminal, maupun berkas. `.env` berisi
   kredensial asli.
8. **Jangan menambah dependensi produksi.** Perkakas uji tetap di luar repo atau devDependency
   yang sudah ada.
9. **Jangan menulis trailer atribusi** (`Co-Authored-By`, "Generated with …") di pesan commit.
10. **Jangan menaruh path lokal atau info mesin** di berkas yang di-commit.

## Yang sudah ada

Branch kerja **`feat/prompt-v2`**.

- **Jalur v2** di pipeline: satu panggilan deteksi atas seluruh `src/`, lalu satu panggilan
  verifikasi per alert SonarCloud. Hasilnya `results.json` skema 2, terbit ke branch
  `security-results`.
- **Skenario analisis** di `scripts/llm-scan.js`: B (deteksi + verifikasi alert) dan C (deteksi
  saja, tanpa SonarCloud). Skenario adalah sumbu terpisah dari `kondisi` eksperimen.
- **Rekomendasi perbaikan dua lapis.** Lapis 1 panduan umum per CWE dari pemetaan statis
  `dashboard/rekomendasi-cwe.json`, bersumber dari cwe.mitre.org dan OWASP Cheat Sheet Series.
  Lapis 2 saran spesifik dari model, opt-in dan mati secara bawaan, berpijak pada panduan lapis 1.
- **Dashboard per halaman**: lima tampilan beralamat hash (`#ringkasan`, `#temuan`, `#verifikasi`,
  `#riwayat`, `#eksperimen`), mode demo lewat `?demo=1`.

Rencana lanjutan dan hal yang sengaja ditunda dicatat di `dashboard/README.md`.

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
cd prompts/v2 && sha256sum -c HASHES.txt            # harus 8/8 OK
cd prompts/remediasi-v1 && sha256sum -c HASHES.txt  # harus 3/3 OK
node scripts/validasi-skema.js             # fixture v2 terhadap skema
```

`sha256sum -c` hanya separuh aturannya; separuh lainnya, yaitu tidak ada berkas di luar daftar,
diperiksa `tests/kunci-prompt.test.js` dan ikut berjalan di `npm test`. Lihat batas keras nomor 5.

Catatan jujur tentang `npm test`: sebagian berkas tes memanggil server API lewat HTTP dan **gagal
dengan `ECONNREFUSED` kalau server tidak jalan**. Itu keadaan lingkungan, bukan cacat kode. Untuk
menjalankan semuanya:

```bash
docker compose up -d db                    # Postgres untuk tes API
npm run seed:admin && npm run seed:dummy
npm start &                                # server API
npm test
```

Tes yang tidak memanggil jaringan bisa dipilih tanpa menghafal daftarnya:

```bash
npm run test:tanpa-server
```

Skrip itu memilih berkasnya sendiri dan berjalan di PowerShell maupun bash. Perintah di bawah
melakukan hal yang sama, tetapi `git ls-files | grep` tidak ada di PowerShell:

```bash
node --test $(git ls-files 'tests/*.test.js' | grep -vE 'api|cuti|khs|profil|list-query')
```

Di luar repo: gerbang tampilan, kontras, aksesibilitas, sidebar, drawer, dan dispatch dijalankan
dengan Playwright dan axe-core yang **sengaja tidak dijadikan dependensi repo**. Cara menyusunnya
beserta delapan jebakan yang pernah meloloskan cacat nyata ada di `dashboard/README.md` bagian
"Pemeriksaan". Menyalin repo ke mesin lain berarti menulis ulang perkakas itu dari tabel di sana.

Dashboard dibuka lewat server lokal, bukan `file://`:

```bash
cd dashboard && python -m http.server 8765
# lalu http://127.0.0.1:8765/?demo=1
```

**Matikan lagi apa pun yang dinyalakan untuk pengujian.** Server dashboard, server API, dan
container Postgres tidak boleh ditinggalkan hidup; `db` memakai `restart: unless-stopped`, jadi ia
akan menyala lagi setelah reboot sampai dihentikan:

```bash
docker compose down
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
- **Bug yang ditemukan di tengah tugas: cari akar masalahnya, jangan tambal gejalanya.** Perbaiki
  tanpa melemahkan tes atau pemeriksaan, jadikan commit terpisah berawalan `perbaiki:`, lalu catat
  di laporan. Kalau bugnya ada di area terkunci, atau perbaikannya akan menggeser angka
  eksperimen, **jangan diperbaiki** — cukup dilaporkan beserta usulannya.
- **Saat menyunting JSON atau berkas data, ubah hanya baris yang perlu.** Jangan memformat ulang
  seluruh berkas: diff yang membengkak menyembunyikan perubahan yang sebenarnya.
- **Nama rute hash dashboard tidak boleh dipakai sebagai id elemen.** Kalau ada elemen ber-id sama,
  peramban memperlakukan hash sebagai fragmen: ia menggulir ke elemen itu dan memindahkan titik
  awal navigasi fokus ke sana, sehingga Tab pertama melewati tautan lewati-navigasi dan sidebar.
- **Skenario (A, B, C) adalah sumbu terpisah dari kondisi eksperimen.** Jangan mencampurnya:
  `kondisi` menentukan apa yang diberikan ke model dan angkanya sudah dipakai di eksperimen,
  sedangkan skenario menentukan bentuk analisisnya.
- Perkakas sementara, skrip tambalan, dan screenshot **tidak masuk repo**. Taruh di folder
  sementara di luar repo.

## Peta berkas

| Jalur | Isi |
|---|---|
| `dashboard/` | Security Dashboard: HTML, CSS, JS vanilla tanpa build step. `README.md` di dalamnya paling rinci |
| `dashboard/fixtures/` | Data mode demo: data nyata dari run eksperimen 19 Okt dan rekaman run CI #54, kecuali fixture yang ditandai contoh mock (misalnya rekomendasi AI), yang di dashboard selalu tampil dengan label contoh |
| `.github/workflows/devsecops.yml` | Pipeline: rencana (turunkan skenario, tolak kombinasi tidak sah), build-test, sonarcloud, analisis (v1), analisis-v2 (matriks vendor, tidak menerbitkan), terbit-v2 (gabung tiga vendor lalu terbit; satu-satunya penerbit jalur v2), hasil (penerbit jalur v1) |
| `scripts/llm/` | Mesin analisis v2: deteksi, verifikasi, penyusun `results.json` skema 2, penggabung tiga vendor (`gabung.js`), penilaian |
| `prompts/v2/` | Prompt jalur v2: deteksi dan verifikasi. **Terkunci hash** |
| `prompts/remediasi-v1/` | Prompt rekomendasi lapis 2. **Terkunci hash** |
| `src/` | Aplikasi SIA, objek uji. **Jangan diubah** |
| `tests/` | `node --test`. Yang berhubungan dengan dashboard tidak butuh server; `npm run test:tanpa-server` menjalankan yang tanpa server saja |
| `docs/design/` | Skema `results.json`, mockup, catatan rancangan |
| `hasil-eksperimen/` | Data eksperimen TA. **Jangan diubah** |

## Kalau ragu

Tanya dulu. Keputusan yang menyangkut data eksperimen, biaya panggilan LLM, atau isi branch
`security-results` tidak boleh diambil sendiri oleh agen.
