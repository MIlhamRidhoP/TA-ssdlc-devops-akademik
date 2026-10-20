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
| `fixtures/v2/index.json` | Daftar run demo | diturunkan dari berkas-berkas di bawah |
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

Ketiga run eksperimen itu dijalankan dari CLI, bukan lewat GitHub Actions, sehingga tidak punya
status job pipeline. Tombol **Jalankan analisis** di mode demo hanya menyimulasikan job.

### Rekaman run CI #54

Supaya graf pipeline di mode demo menggambarkan pipeline yang benar-benar berjalan, mode demo juga
memuat satu run dari GitHub Actions:

| Berkas | Isi |
|---|---|
| `fixtures/v2/feat/prompt-v2/54.json` | Hasil run #54 apa adanya, disalin dari branch `security-results` |
| `fixtures/v2/rekaman/run-54.json` | Status, durasi, dan langkah tiap job run #54, diambil sekali lewat GitHub REST API |

Run #54 adalah run Gemini jalur v2 di branch `feat/prompt-v2` yang selesai dengan status success
pada 20 Oktober 2026. Pilih branch itu di rail untuk melihatnya. Graf pipelinenya diberi lencana
**"Rekaman run CI #54, bukan run langsung"**: statusnya diambil satu kali lalu dibekukan, bukan
dipantau seperti di mode live.

Rekaman hanya memuat field yang dipakai dashboard: id, nama, status, kesimpulan, waktu mulai dan
selesai tiap job beserta langkahnya. Token, URL bertanda tangan, dan identitas runner tidak ikut;
`tests/pipeline.test.js` menolak nilai apa pun yang berbentuk kredensial atau URL, dan memastikan
daftar job di rekaman sama persis dengan node di graf.

**Data eksperimen tidak tersentuh.** Angka di tab Eksperimen tetap berasal dari run 19 Oktober di
`eksperimen/seeded`; run #54 tidak punya blok `eksperimen` dan tidak masuk hitungan mana pun.

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
| Sidebar tidak terpotong | untuk tiap elemen sidebar: `scrollIntoView({ block: 'nearest' })` lebih dulu, lalu `getBoundingClientRect` harus berada di dalam viewport **dan** di dalam kotak penggulung terdekatnya, pada lebar 375/768/1280 x tinggi 700/900/1100 x kedua tema, dengan daftar repo dan formulir token dalam keadaan terbuka |
| Lencana dan status koneksi | bandingkan isi lencana navigasi dengan berkas fixture yang sedang dibaca, dan baris status dengan keadaan demo / live bertoken / live tanpa token |
| Drawer detail | screenshot **viewport**, bukan `fullPage`; ukur bahwa panel menempel di kanan setinggi layar dan tautan lewati-ke-konten tersembunyi selama drawer terbuka |

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
- **Bergulir bukan terpotong.** Bagian tengah sidebar memang bergulir, jadi memeriksa posisi apa
  adanya akan melaporkan cacat yang tidak ada. Gulir elemennya ke dalam pandangan lebih dulu; yang
  dilarang adalah elemen yang tetap keluar viewport atau keluar kotak penggulungnya setelah itu.
  Pemeriksaan inilah yang menemukan formulir token terdorong seluruhnya ke luar layar.
- **Chrome merender anak `<details>` yang punya `display` eksplisit walaupun panelnya tertutup.**
  Isi yang disangka tersembunyi tetap menempati ruang. Panel yang tertutup perlu
  `display: none` yang ditulis sendiri.
- **Panel modal menutupi halaman dengan sengaja.** Pemeriksaan tumpang tindih harus dipersempit ke
  panel yang terbuka, baik drawer maupun sidebar di layar sempit, kalau tidak seluruh halaman di
  belakangnya terlaporkan tertutup.

Pemeriksaan ini tidak ikut di repo, jadi menyalinnya ke mesin lain berarti menulisnya ulang dari
tabel di atas. Yang **ada** di repo adalah tes `node --test` di bagian sebelumnya, termasuk dua
pemeriksaan teks `.github/workflows/devsecops.yml` yang mengunci `--nomor`, `--id`, dan gerbang
jalur v2 supaya tidak hilang diam-diam saat workflow disunting.

## Sidebar

Tata letaknya tetap di tempat: kepala dan bagian bawah selalu terlihat, hanya bagian tengah yang
bergulir kalau isinya lebih panjang dari layar. Bagian bawah memuat yang paling perlu terbaca saat
daftar branch memanjang: status koneksi dan akses GitHub.

Status koneksi menyebut keadaan yang sebenarnya, tanpa nomor versi:

| Tampil | Artinya |
|---|---|
| **Mode demo** (abu-abu) | data dari fixture di berkas, tidak ada panggilan ke GitHub |
| **Live · token tersambung** (hijau) | hasil dan status run dibaca lewat `api.github.com` |
| **Live · tanpa token** (amber) | mode live, tetapi belum ada token, jadi belum ada yang bisa dibaca |

Lencana di navigasi hanya memuat angka dari run yang sedang dibaca dan dari index branch itu:
jumlah temuan LLM (merah bila ada yang bersifat `vulnerability`), jumlah alert Sonar, dan jumlah run
di branch itu. Yang datanya belum ada **tidak diberi lencana sama sekali**, bukan diisi 0: lencana
berisi 0 terbaca sebagai "sudah diperiksa, tidak ada apa-apa", padahal yang benar adalah "belum
diketahui".

Penanda `(default)` di pemilih branch hanya muncul untuk branch bawaan repositori yang dilaporkan
GitHub (`default_branch`), bukan untuk branch bawaan tujuan run, yang artinya berbeda dan punya
penandanya sendiri di drawer. Di mode demo nilainya dibaca dari `default_branch` di
`fixtures/projects.json`. Tanpa nilai itu, tidak ada penanda sama sekali.

Di bawah 64rem sidebar menjadi panel yang dibuka lewat tombol **Menu** di bilah atas, dengan fokus
terkurung dan Escape untuk menutup, mekanik yang sama persis dengan kedua drawer.

## Tautan ke GitHub

Setiap run yang berasal dari workflow bisa ditelusuri langsung ke GitHub: chip **Asal** di kepala
run, chip **Commit**, tautan **Lihat log** di tiap node graf, tautan kecil di tiap baris riwayat,
pemberitahuan setelah dispatch, dan tautan berkas di drawer detail temuan.

Aturannya, semuanya dikunci `tests/tautan-github.test.js`:

- URL dibangun hanya dari nilai yang sudah divalidasi. Owner dan repo dari konfigurasi project,
  `run.id` dan `job.id` harus bilangan bulat positif, SHA harus 40 heksadesimal. Nilai yang tidak
  lolos **tidak menghasilkan tautan sama sekali**, bukan tautan ke halaman Actions umum: tautan yang
  mendarat di halaman yang salah lebih berbahaya daripada teks biasa, karena pembacanya mengira
  sudah melihat buktinya.
- Run dari CLI (`asal: "cli"`) dan run tanpa `run.id` tidak diberi tautan. Yang tampil teks biasa
  "dijalankan dari CLI".
- Project demo yang sengaja dibuat-buat (`demo_tanpa_workflow`) tidak pernah ditautkan. Rekaman run
  #54 boleh ditautkan karena run itu benar-benar ada.
- Semua tautan memakai `target="_blank"` dan `rel="noopener noreferrer"`, dengan teks atau
  `aria-label` yang menyebut tujuannya.
- Tautan tetap hanya `href`. `github.com` tidak pernah menjadi sasaran `fetch`, dan `connect-src`
  tetap hanya `'self'` dan `api.github.com`.

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

## Rencana lanjutan

### Mode SAST saja menerbitkan skema 2

**Masalahnya.** Mode SAST saja berjalan lewat jalur v1, hasilnya terbit sebagai skema 1 ke
`index-v1.json`, dan dashboard ini hanya membaca `index.json` (skema 2). Developer yang
menjalankannya karena itu tidak melihat apa pun, padahal runnya berhasil dan gratis.

**Usulannya.** Terbitkan hasil mode SAST sebagai skema 2 berisi alert Sonar tanpa putusan model dan
tanpa temuan LLM, sehingga inventaris alert langsung terbaca di dashboard.

- **Produsen.** `scripts/llm-scan.js` sudah menulis `sonar-alert.json` sebelum panggilan LLM
  pertama. Tambahkan `--sast` yang berhenti tepat di titik itu dengan nol panggilan;
  `merge-results.js merge --v2` tidak perlu diubah (`alerts` terisi `putusan: null`, `findings`
  kosong). Gerbang hash tree `src/` tetap berlaku, jadi alert yang ditampilkan dijamin berasal dari
  kode yang sama.
- **Skema.** `run.vendor`, `run.model_diminta`, dan `run.model_menjawab` wajib dan tidak punya nilai
  jujur untuk run tanpa model. Perlu `run.jenis` (`sast` atau `sast-llm`) dan ketiganya dibuat
  nullable. `scripts/validasi-skema.js` tidak mendukung `if/then` maupun `oneOf`, jadi aturan
  "vendor wajib bila jenis = sast-llm" harus jadi tes tersendiri atau validatornya diperluas.
- **Workflow.** Job baru `analisis-sast`, bukan melonggarkan `if` job `analisis-v2`: kondisi job itu
  adalah pengaman biaya, dan menaruh jalur gratis di balik gerbang yang sama menghapus artinya.
  Harus diputuskan lebih dulu: jalur v1 juga menerbitkan `<branch>/<nomor>.json` untuk mode sast,
  jadi salah satu harus berhenti agar tidak menulis nomor yang sama.
- **Dashboard.** Judul run, kelompok kartu putusan, blok verifikasi, panel Temuan, dan baris riwayat
  semuanya perlu bentuk kedua. Menampilkan run sast dengan kosakata run LLM akan terbaca salah:
  "Tanpa putusan: 5" tampak seperti lima panggilan gagal, padahal tidak ada panggilan.

**Yang tidak didapat dari usulan ini.** Skenario A di tab Eksperimen adalah P/R/F1 alert Sonar
terhadap ground truth `SEEDED.md`, dan ground truth itu hanya ada untuk objek uji seeded. Untuk
branch biasa yang bisa ditampilkan hanyalah inventaris alert beserta sebaran severity-nya, bukan
angka Skenario A.

**Alasan ditunda.** Biaya jalankannya nol, tetapi biaya rawatnya tidak: skema 2 jadi punya dua
bentuk dan setiap pembacanya (`entriIndexV2`, dashboard, skrip skor) harus menanganinya. Selama
jalur v2 baru dipakai beberapa run, menstabilkan satu bentuk lebih berharga daripada menambah
cabang kedua. Ditunda sampai jalur v2 terbukti stabil, dan dikerjakan dua tahap: skema, produsen,
dan tes lebih dulu; workflow dan dashboard menyusul.
