# Security Dashboard

Halaman statis untuk menjalankan dan membaca analisis keamanan framework SSDLC DevOps: memilih project,
memicu `devsecops.yml`, memantau tiap job, lalu menampilkan `results.json` (skema
[`docs/design/results.schema.json`](../docs/design/results.schema.json)) dari branch `security-results`.
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
panggilan ke GitHub. Data di `fixtures/`:

| Berkas | Isi | Asal |
|---|---|---|
| `fixtures/eksperimen/seeded/3.json` | run sast-llm, 11 temuan, metrik riset | hasil nyata: `hasil-eksperimen/20261010/flash/run-1.json`, `ci-run/sonar-temuan.json`, `flash/run-1.score.json` di branch `eksperimen/seeded`, digabung dengan `scripts/merge-results.js` |
| `fixtures/eksperimen/seeded/2.json` | run sast (Sonar saja) | data Sonar nyata yang sama |
| `fixtures/eksperimen/seeded/1.json` | run dengan Gemini gagal | **sintetis**, untuk menunjukkan state gagal |
| `fixtures/jobs.json` | durasi per job | **sintetis** |
| `fixtures/projects.json` | daftar project demo, termasuk `contoh/aplikasi-lain` tanpa workflow | **sintetis**, untuk state repo tanpa workflow |

Potongan kode di fixture diambil dari `src/` branch `eksperimen/seeded`, jadi nomor barisnya cocok
dengan kode yang dianalisis. Tombol **Jalankan analisis** di mode demo hanya menyimulasikan job.

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

- **Keputusan developer** (konfirmasi rentan atau false positive) disimpan di `localStorage` per run.
  Tidak tersinkron antar browser atau antar developer, dan hilang bila data situs dihapus.
- **Branch `security-results` di repo publik bisa dibaca siapa pun**, termasuk daftar temuan dan potongan
  kode.
- **Rekomendasi perbaikan** belum tersedia: prompt eksperimen tidak memintanya, jadi field `rekomendasi`
  selalu kosong sampai tahap rekomendasi ditambahkan ke pipeline.
- **Status AI, verifikasi Sonar, dan severity temuan Gemini diturunkan** dari pencocokan file, baris,
  dan CWE di `merge-results.js`, bukan putusan eksplisit model. Dashboard memberi label pada semuanya.
- **Metrik riset** hanya muncul bila `results.json` memuat `metrics`, yaitu untuk run dengan ground truth.
  Branch `eksperimen/seeded` tidak dipicu dari dashboard, jadi metrik saat ini hanya terlihat di mode demo.
- **Model**: Gemini 3.8 Flash (default) dan Gemini 3.1 Pro Preview. Pro butuh billing aktif di project Google
  milik `GEMINI_API_KEY`; tanpa billing, kuota API Pro bernilai 0 dan run gagal.
- Pemantauan memakai polling. Satu run memakan sekitar 2 permintaan tiap 5 detik dari batas 5.000 per jam.
