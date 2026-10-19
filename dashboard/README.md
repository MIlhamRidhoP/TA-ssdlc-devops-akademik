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

1. `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` dengan input `mode`, `model`,
   dan `label` unik.
2. Mencari run hasil dispatch lewat `run-name` yang memuat `[label]`.
3. Memantau `GET .../actions/runs/{id}/jobs` tiap 5 detik sampai run selesai.
4. Menunggu entri run muncul di `index.json` branch `security-results`, lalu memuat hasilnya.

## GitHub Pages

GitHub Pages dari branch hanya bisa melayani root atau folder `/docs`, bukan `/dashboard`. Pilihan:

- Workflow Pages (`actions/upload-pages-artifact` dengan `path: dashboard`, lalu `actions/deploy-pages`).
  Belum ditambahkan ke repo ini.
- Atau salin isi `dashboard/` ke branch atau folder yang dilayani Pages.

Di Pages, mode demo dan mode live sama-sama berjalan karena semuanya statis.

## Keamanan

- Isi laporan berasal dari LLM dan dianggap tidak tepercaya: semua data dirender dengan `textContent`
  atau `createElement`, tidak pernah `innerHTML`.
- Content-Security-Policy lewat meta tag: `script-src 'self'`, `style-src 'self'` + Google Fonts,
  `font-src` Google Fonts, `connect-src 'self' https://api.github.com`. `'self'` dibutuhkan untuk
  membaca `projects.json` dan `fixtures/` dari folder dashboard sendiri; tidak ada host pihak ketiga.
- Tidak ada script pihak ketiga. Semua request API melewati satu fungsi yang menolak host selain
  `api.github.com`.
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
