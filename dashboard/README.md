# Security Dashboard

Halaman statis untuk menjalankan dan membaca analisis keamanan framework SSDLC DevOps: memilih project,
memicu `devsecops.yml`, memantau tiap job, lalu menampilkan `results.json` skema 2
([`docs/design/results-v2.schema.json`](../docs/design/results-v2.schema.json)) dari branch
`security-results`. Skema 1 ([`results.schema.json`](../docs/design/results.schema.json)) masih sah
sebagai format arsip, tetapi tidak lagi ditampilkan.
Tidak ada server sendiri; browser memanggil GitHub REST API langsung dengan token milik pengguna.

## Menjalankan secara lokal

Dashboard harus dibuka lewat HTTP, bukan langsung dari file (CSP dan `fetch` ke `projects.json` tidak
berjalan di `file://`).

```
cd dashboard
python -m http.server 8765
```

Buka `http://127.0.0.1:8765/`. Alternatif tanpa Python: `npx http-server dashboard -p 8765`.

## Mode demo

Buka `http://127.0.0.1:8765/#demo` atau tekan **Buka mode demo**. Tidak perlu token dan tidak ada
panggilan ke GitHub. Data di `fixtures/v2/`:

| Berkas | Isi | Asal |
|---|---|---|
| `fixtures/v2/index.json` | Daftar tiga run demo | diturunkan dari ketiga berkas di bawah |
| `fixtures/v2/eksperimen/seeded/1.json` | Run Gemini, 7 temuan, 5 alert | hasil nyata `hasil-eksperimen/20261019/utama/google/run-1.json` di branch `eksperimen/seeded` |
| `fixtures/v2/eksperimen/seeded/2.json` | Run Claude, 14 temuan, 5 alert | hasil nyata `utama/anthropic/run-1.json` |
| `fixtures/v2/eksperimen/seeded/3.json` | Run GPT, 14 temuan, 5 alert | hasil nyata `utama/openai/run-1.json` |

Ketiganya memuat blok `eksperimen` yang sama, disalin apa adanya dari berkas skor
`skor-utama.json`, `skor-setelah-triase.json`, `skor-setelah-triase-konservatif.json`, dan
`skor-sensitivitas-sonar03.json`. Seluruh data demo nyata; tidak ada yang sintetis.

Berkas dibuat ulang dengan:

```
node scripts/merge-results.js merge --v2   --folder=<objek>/hasil-eksperimen/20261019/utama/<vendor> --run=1 --nomor=<n>   --objek=<objek> --biaya=<objek>/hasil-eksperimen/20261019/utama   --skor=... --skor-triase=... --skor-triase-konservatif=... --skor-sensitivitas=...   --out=dashboard/fixtures/v2/eksperimen/seeded/<n>.json
```

Run v2 dijalankan dari CLI, bukan lewat GitHub Actions, sehingga tidak punya status job pipeline.
Tombol **Jalankan analisis** di mode demo hanya menyimulasikan job.

Arsip demo lama (skema 1, pilot 10 Oktober) ada di
[`docs/arsip/pilot-20261010/`](../docs/arsip/pilot-20261010/README.md) dan tidak lagi ditampilkan.

## Pemeriksaan

### Di dalam repo (`npm test`)

Berjalan tanpa browser dan tanpa jaringan, ikut dijalankan CI:

| Tes | Isi |
|---|---|
| `tests/results-v2.test.js` | fixture v2 sah terhadap skema 2, arsip v1 sah terhadap skema 1, uji negatif validator, pemetaan putusan, sidik jari temuan, dan **angka blok eksperimen identik dengan acuan skor** |
| `tests/merge-results.test.js` | produsen skema 1 |

Angka skor sumber hidup di branch `eksperimen/seeded`, yang tidak diambil runner CI
(checkout satu branch). Karena itu angkanya disalin ke
`tests/fixtures/acuan-skor-20261019.json` beserta provenance: branch, commit, path, dan
SHA-256 tiap berkas sumber. Bila branch itu kebetulan tersedia, satu tes tambahan
melintas-periksa acuan terhadap berkas aslinya; bila tidak, tes itu dilewati, bukan gagal.

Kalau berkas skor berubah, buat ulang acuannya:

```
node scripts/buat-acuan-skor.js
```

### Di luar repo (tampilan dan aksesibilitas)

Playwright dan axe-core sengaja **tidak** dijadikan dependensi repo supaya jejak dependensi
tetap kecil. Siapkan di folder mana pun di luar repo:

```
mkdir pemeriksa && cd pemeriksa
npm init -y
npm install playwright @axe-core/playwright
npx playwright install chromium
```

Jalankan dashboard lebih dulu (`python -m http.server 8765` di folder `dashboard/`), lalu
arahkan skrip Playwright ke `http://127.0.0.1:8765/#demo`. Yang perlu diperiksa:

Setiap pemeriksaan dijalankan atas **seluruh kombinasi keadaan x lebar x tema**, bukan satu
halaman saja. Keadaan yang wajib diperiksa: tampilan operasional, drawer terbuka, tab Eksperimen,
panel detail temuan dan alert terbuka, branch tanpa run, dan rail terbuka di layar sempit.

| Pemeriksaan | Cara |
|---|---|
| Error konsol dan respons gagal | kumpulkan event `console` bertipe `error`, `pageerror`, dan `response` berstatus >= 400 (kecualikan `/favicon.ico`, diminta otomatis browser) |
| Overflow horizontal | `document.documentElement.scrollWidth > clientWidth` di 375, 768, dan 1280 px |
| Aksesibilitas | `new AxeBuilder({ page }).analyze()`, tidak boleh ada pelanggaran `serious` atau `critical` |
| Kontras | rasio dihitung dari piksel sungguhan, ambang 4,5:1 (3:1 untuk teks besar) |
| Tumpang tindih | uji titik dengan `document.elementFromPoint` pada tiap elemen berteks |
| Teks terpotong | `scrollWidth > clientWidth` pada elemen yang `overflow` tersembunyi dan tidak bisa digulir |
| Font | tidak boleh ada permintaan ke host selain `127.0.0.1` saat halaman dimuat |
| Isi dispatch | cegat `**api.github.com/**` dengan `page.route`, jawab tiruan, lalu periksa body `POST .../dispatches` untuk tiap kombinasi mode x branch x vendor |

Enam jebakan yang pernah menipu pemeriksaan di sini. Semuanya pernah meloloskan cacat nyata atau
melaporkan cacat yang tidak ada:

- **Drawer harus dibuka.** Isi `#drawer` tersembunyi saat halaman dimuat, jadi axe maupun
  pemindaian kontras tidak melihatnya. Pernah ada teks putih di atas putih di situ.
- **Tumpang tindih tidak terdeteksi oleh pemeriksaan overflow.** Elemen bisa saling tindih
  tanpa membuat halaman melebar.
- **`opacity` menyembunyikan kontras dari pengukuran.** `getComputedStyle().color` tidak
  memperhitungkan opacity leluhur, jadi tombol dan opsi yang dimatikan lolos padahal 2,5:1.
  Hitung opacity efektif dan campurkan warna teks ke latarnya sebelum menghitung rasio.
- **Nilai di dalam `select` dan `input` bukan simpul teks.** Pemindaian yang hanya menelusuri
  `textContent` melewatkannya; select berlatar gelap dengan teks gelap pernah lolos begitu.
- **Screenshot `fullPage` menggeser elemen `position: fixed`.** Tautan lewati-ke-konten tampak
  melayang di tengah halaman padahal posisinya benar. Ukur `getBoundingClientRect`, jangan
  menyimpulkan dari gambar.
- **`goto` ke URL yang sama hanya berpindah hash.** Halaman tidak dimuat ulang, dan fokus serta
  state dari pemeriksaan sebelumnya terbawa. Pakai `reload()`.

Pemeriksaan ini tidak ikut di repo, jadi menyalinnya ke mesin lain berarti menulisnya ulang dari
tabel di atas. Yang **ada** di repo adalah tes `node --test` di bagian sebelumnya, termasuk dua
pemeriksaan teks `.github/workflows/devsecops.yml` yang mengunci `--nomor`, `--id`, dan gerbang
jalur v2 supaya tidak hilang diam-diam saat workflow disunting.

## Token GitHub

Buat **fine-grained personal access token**:

- Repository access: *Only select repositories*, pilih repo yang ada di `projects.json`.
- Permissions: **Actions: Read and write**, **Contents: Read-only**, **Metadata: Read-only** (wajib).
- Expiration: pendek, misalnya 30 sampai 90 hari.

Token disimpan di `sessionStorage` (hilang saat tab ditutup). Centang **Ingat di browser ini** untuk
memakai `localStorage`. **Hapus token** menghapus keduanya. Token hanya dikirim ke `https://api.github.com`
lewat header `Authorization`, tidak pernah ditulis ke log, URL, atau berkas.

Izin Actions write juga memungkinkan token membatalkan, menjalankan ulang, atau menghapus run dan
artifact. Itu konsekuensi izin dispatch; perlakukan token seperti kata sandi.

## Konfigurasi project

`projects.json`:

```json
{ "projects": [ { "owner": "...", "repo": "...", "workflow": "devsecops.yml",
  "branches": [ { "name": "main", "dispatch": true },
                { "name": "eksperimen/seeded", "dispatch": false, "catatan": "alasan dikunci" } ] } ] }
```

- `dispatch: false` membuat branch hanya-baca. `eksperimen/seeded` dikunci karena workflow-nya tidak
  boleh diubah demi data eksperimen.
- Dispatch selalu memakai workflow **di branch yang dipicu**. Selama perubahan `devsecops.yml` belum
  di-merge ke `main`, dispatch ke `main` ditolak (422); uji dulu di `feat/security-dashboard`.
- Repo tanpa `devsecops.yml` ditandai di rail dan tidak bisa dipicu.

## Cara kerja dispatch

Drawer hanya punya satu keputusan: **Mode**. Mode menentukan jalur, jadi tidak ada pilihan jalur
terpisah yang bisa bertentangan dengannya.

| Mode | Jalur | Yang dikirim | Biaya |
|---|---|---|---|
| SAST saja | v1 | `mode`, `model` (bawaan v1), `jalur=v1`, `label` | tidak ada panggilan LLM |
| SAST + LLM | v2 | di atas, ditambah `vendor_v2`, `konfirmasi_v2`, `sonar_branch_v2` | satu panggilan deteksi + satu verifikasi per alert |

1. `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` dengan input di atas dan
   `label` unik. `konfirmasi_v2` hanya terisi kalau centang persetujuan biaya di drawer dicentang:
   dashboard tidak pernah menyetujui biaya atas nama pengguna, dan persetujuan itu berlaku untuk
   satu run saja (dikosongkan setiap drawer dibuka). `sonar_branch_v2` diisi `main` untuk branch
   selain main, karena paket Free SonarCloud hanya menganalisis main; kecocokan datanya diperiksa
   workflow lewat hash tree `src/` sebelum ada panggilan berbayar.
   Branch tujuan run hanya memuat branch yang workflow-nya mendukung jalur terpilih; kemampuan itu
   dicatat per branch di `projects.json` (`"v2": true`) dan dirawat bersama workflow-nya. Memilih
   branch yang **dilihat** adalah kontrol terpisah di rail, supaya memilih mode tidak pernah
   menarik pembaca keluar dari hasil yang sedang dibukanya.
   Hasil mode SAST saja terbit sebagai skema 1 ke `index-v1.json` dan tidak ditampilkan dashboard
   ini; mode itu berguna untuk memeriksa pipeline tanpa biaya.
2. Mencari run hasil dispatch lewat `run-name` yang memuat `[label]`.
3. Memantau `GET .../actions/runs/{id}/jobs` tiap 5 detik sampai run selesai.
4. Menunggu entri run muncul di `index.json` branch `security-results`, lalu memuat hasilnya.

Branch `security-results` memakai satu berkas index per skema. `index.json` berisi skema 2 dan
hanya itu yang dibaca dashboard; jalur v1 menulis daftarnya ke `index-v1.json`. Pemisahan ini
dibuat setelah run #46: sebelumnya kedua jalur memakai `index.json` yang sama dan penerbitan jalur
mana pun menghapus entri jalur lain, sehingga hasil v2 yang sudah berbiaya hilang dari daftar.
Berkas hasil per run (`<branch>/<nomor>.json`) tidak pernah ikut terhapus, dan nomornya adalah
nomor run GitHub sehingga dua run tidak saling menimpa.

## GitHub Pages

GitHub Pages dari branch hanya bisa melayani root atau folder `/docs`, bukan `/dashboard`. Pilihan:

- Workflow Pages (`actions/upload-pages-artifact` dengan `path: dashboard`, lalu `actions/deploy-pages`).
  Belum ditambahkan ke repo ini.
- Atau salin isi `dashboard/` ke branch atau folder yang dilayani Pages.

Di Pages, mode demo dan mode live sama-sama berjalan karena semuanya statis.

## Keamanan

- Isi laporan berasal dari LLM dan dianggap tidak tepercaya: semua data dirender dengan `textContent`
  atau `createElement`, tidak pernah `innerHTML`.
- Content-Security-Policy lewat meta tag: `default-src 'none'`, `script-src 'self'`,
  `style-src 'self'`, `font-src 'self'`, `connect-src 'self' https://api.github.com`. Satu-satunya
  host luar adalah `api.github.com`; selebihnya dibaca dari folder dashboard sendiri.
- Tidak ada script maupun font pihak ketiga. Ketiga keluarga font (Hanken Grotesk, Schibsted
  Grotesk, JetBrains Mono) dipasang sendiri di `fonts/` dengan `@font-face` di `fonts.css`, subset
  latin dan latin-ext. Selain menutup host luar, ini membuat halaman tetap tampil utuh saat
  jaringan tidak bisa diandalkan. Sumber, pemegang hak cipta, dan teks lengkap SIL Open Font
  License 1.1 tiap keluarga ada di [`fonts/README.md`](fonts/README.md) dan berkas `fonts/OFL-*.txt`.
- Semua request API melewati satu fungsi yang menolak host selain `api.github.com`.
- Path hasil dari `index.json` divalidasi sebelum dipakai.

## Keterbatasan

- **Catatan developer** (konfirmasi rentan atau false positive) disimpan di `localStorage` per project
  dan dikunci sidik jari temuan, sehingga terbawa antar run selama temuannya sama. Tetap hanya di
  browser ini: tidak tersinkron antar perangkat maupun antar developer, dan hilang bila data situs
  dihapus. Tombol **Ekspor** dan **Impor** menyediakan satu-satunya jalan memindahkannya.
- **Branch `security-results` di repo publik bisa dibaca siapa pun**, termasuk daftar temuan dan potongan
  kode.
- **Rekomendasi perbaikan** belum tersedia: prompt eksperimen tidak memintanya, jadi field `rekomendasi`
  selalu kosong sampai tahap rekomendasi ditambahkan ke pipeline.
- **Status alert berasal dari putusan verifikasi model** (`true_positive`, `false_positive`,
  `uncertain`), bukan dari pencocokan file, baris, dan CWE seperti skema 1. Putusan yang tidak sah
  (panggilan gagal, parse gagal, enum tidak valid) ditampilkan sebagai "Tanpa putusan", tidak ditebak.
- **Temuan LLM tidak punya severity.** Skema 2 memakai `sifat` (vulnerability atau hardening) dan
  `keyakinan`. Severity hanya ada pada alert Sonar dan ditampilkan apa adanya dengan label sumbernya.
- **Tab Eksperimen** hanya muncul bila `results.json` memuat blok `eksperimen`, yaitu untuk run dengan
  ground truth. Branch `eksperimen/seeded` tidak dipicu dari dashboard, jadi tab itu saat ini hanya
  terlihat di mode demo.
- **Model**: Gemini 3.8 Flash (bawaan) dan Gemini 3.1 Pro Preview. Pro butuh billing aktif di project
  Google milik `GEMINI_API_KEY`; tanpa billing, kuota API Pro bernilai 0 dan run gagal.
- Pemantauan memakai polling. Satu run memakan sekitar 2 permintaan tiap 5 detik dari batas 5.000 per jam.
