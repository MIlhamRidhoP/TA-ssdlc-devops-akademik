# Rancangan Metode Integrasi Large Language Model pada Proses Static Application Security Testing dalam SSDLC Berbasis DevSecOps

Tugas Akhir S1 Teknologi Informasi, Telkom University.
(judul dalam proses revisi)

## Ringkasan

Penelitian ini memasang Large Language Model sebagai pendamping SonarCloud di dalam pipeline
GitHub Actions, bukan sebagai penggantinya. LLM diberi dua tugas: memverifikasi setiap alert SAST
yang dihasilkan SonarCloud, dan melakukan deteksi celah secara mandiri atas kode sumber. Metode ini
diuji pada tiga skenario analisis, yaitu A (SAST saja), B (SAST dan LLM), serta C (LLM saja), dengan
tiga model, yaitu Gemini 3.1 Pro Preview, Claude Sonnet 5.5, dan GPT 6.1 Sol. Objek ujinya adalah
backend sistem informasi akademik milik proyek ini sendiri, yang diberi kerentanan tertanam sebagai
ground truth.

## Peta branch

| Branch | Isi |
|---|---|
| `main` | Backend sistem informasi akademik sebagai dasar. Workflow di branch ini hanya menjalankan build dan uji API. **Belum memuat jalur v2.** |
| `feat/prompt-v2` | **Kode alat terbaru.** Pipeline jalur v2, `prompts/v2/`, Security Dashboard, dan dokumentasi rancangan. |
| `eksperimen/seeded` | **Objek uji dan data eksperimen.** Kerentanan tertanam, `SEEDED.md` sebagai ground truth, dan `hasil-eksperimen/`. |
| `security-results` | Hasil analisis yang diterbitkan pipeline. Berisi `index.json` untuk hasil skema 2 dan `index-v1.json` untuk arsip skema 1. |
| `uji/seeded-dashboard` | Kode `eksperimen/seeded` dengan pipeline dashboard. Run di sini adalah run tambahan, bukan pengganti data eksperimen 10 Oktober 2026. |
| `feat/security-dashboard` | Branch pengembangan dashboard. Workflow-nya sudah memuat input `mode`, `model`, dan `label`. |

Repo demo: `MIlhamRidhoP/ta-ssdlc-demo`. Repo itu menjalankan framework ini pada objek uji berisi
kerentanan tertanam, dengan `src/` byte-identik dengan branch `eksperimen/seeded`. Run di repo demo
adalah peragaan, bukan data eksperimen.

## Struktur folder

Isi repo berbeda antarbranch. Kolom terakhir menyebut di branch mana folder itu ada.

| Folder | Isi | Branch |
|---|---|---|
| `src/` | Backend sistem informasi akademik, objek uji penelitian | semua branch |
| `migrations/` | Skema basis data, dijalankan Postgres saat container pertama kali dibuat | semua branch |
| `tests/` | Uji API dan uji alat, dijalankan `node --test` | semua branch |
| `scripts/` | Seed basis data dan alat analisis LLM | semua branch |
| `.github/workflows/` | Definisi pipeline GitHub Actions | semua branch |
| `prompts/` | Prompt deteksi dan verifikasi beserta hash penguncinya | `feat/prompt-v2` |
| `dashboard/` | Security Dashboard, halaman statis tanpa build step | `feat/prompt-v2` |
| `docs/` | Skema `results.json`, mockup, dan catatan rancangan | `feat/prompt-v2` |
| `hasil-eksperimen/` | Data dan laporan eksperimen | `eksperimen/seeded` |

## Menjalankan backend secara lokal

Prasyarat: Node.js 22 atau lebih baru (lihat `engines` di `package.json`) dan Docker beserta Docker
Compose.

Langkah berikut sama dengan yang dijalankan job `Build dan uji API` di
`.github/workflows/devsecops.yml`.

```
cp .env.example .env
npm ci
docker compose up -d --build --wait app db
npm run seed:admin
npm run seed:dummy
npm test
```

Setelah selesai, hentikan dan bersihkan:

```
docker compose down -v
```

Isi `.env` perlu disesuaikan lebih dulu. Nama variabel yang dibaca aplikasi ada di `.env.example`,
antara lain `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PGCRYPTO_KEY`, `SEMESTER_AKTIF`, dan `SEED_USER_PASSWORD`.

## Pipeline DevSecOps

Bagian ini menjelaskan pipeline pada branch `feat/prompt-v2`. Workflow di `main` lebih sederhana dan
hanya memuat job build dan uji.

### Pemicu

- **Push ke branch mana pun** hanya menjalankan build dan uji API. Tidak ada analisis LLM dan tidak
  ada biaya.
- **`workflow_dispatch`** dipakai untuk menjalankan analisis, baik dari halaman Actions maupun dari
  Security Dashboard.

### Input dispatch utama

| Input | Pilihan | Bawaan | Keterangan |
|---|---|---|---|
| `mode` | `auto`, `sast`, `sast-llm` | `auto` | Mode analisis |
| `jalur` | `v1`, `v2` | `v2` | `v1` satu panggilan, `v2` deteksi ditambah verifikasi per alert |
| `skenario` | kosong, `A`, `B`, `C` | kosong | Kosong berarti diturunkan dari `mode` |
| `vendor_v2` | `google`, `anthropic`, `openai`, `gabungan` | `google` | `gabungan` menjalankan ketiga vendor lalu menyatukan hasilnya, dan hanya sah untuk skenario B |
| `konfirmasi_v2` | teks bebas | kosong | Harus diisi `JALANKAN` untuk menyetujui biaya jalur v2 |
| `sonar_branch_v2` | `ikut-branch-run`, `main` | `ikut-branch-run` | Branch SonarCloud yang dipakai jalur v2 |
| `rekomendasi_ai` | boolean | `false` | Saran perbaikan dari model, satu panggilan berbayar tambahan |
| `vendor_rekomendasi` | `google`, `anthropic`, `openai` | `google` | Vendor penyusun saran pada mode gabungan |
| `model` | `gemini-3.8-flash`, `gemini-3.1-pro-preview` | `gemini-3.8-flash` | Model untuk jalur v1 |
| `label` | teks bebas | kosong | Label dari dashboard untuk menemukan run hasil dispatch |

### Urutan job

| Job | Nama | Peran |
|---|---|---|
| `build-test` | Build dan uji API | Build dan uji, berjalan juga pada push |
| `rencana` | Tentukan mode analisis | Menurunkan mode dan skenario, menolak kombinasi yang tidak sah sebelum ada panggilan berbayar |
| `sonarcloud` | Analisis SonarCloud | SAST dan pemeriksaan kesiapan analisis |
| `analisis` | Analisis temuan (Sonar dan Gemini) | Jalur v1 |
| `analisis-v2` | Analisis LLM v2 (deteksi dan verifikasi) | Jalur v2, bermatriks vendor, tidak menerbitkan |
| `terbit-v2` | Gabung dan terbitkan hasil v2 | Satu-satunya penerbit jalur v2 |
| `hasil` | Gabung dan terbitkan hasil | Penerbit jalur v1 |

### Gerbang biaya

Dua gerbang menahan panggilan berbayar:

1. **Konfirmasi eksplisit.** Input `konfirmasi_v2` harus berisi `JALANKAN`. Tanpa itu jalur v2
   berhenti sebelum memanggil model.
2. **Kecocokan hash tree `src/`.** Analisis SonarCloud yang dipakai harus berasal dari isi `src/`
   yang sama dengan commit yang sedang dijalankan. Kecocokan ini diperiksa lewat hash tree, bukan
   lewat nama branch.

Selain itu, kombinasi skenario dan mode yang tidak sah ditolak di job `rencana`, yaitu job paling
awal dan satu-satunya yang berjalan sebelum ada panggilan model.

### Secret yang dibutuhkan

| Secret | Dipakai untuk |
|---|---|
| `SONAR_TOKEN` | Analisis dan pembacaan hasil SonarCloud |
| `GEMINI_API_KEY` | Model vendor google |
| `ANTHROPIC_API_KEY` | Model vendor anthropic |
| `OPENAI_API_KEY` | Model vendor openai |

## Security Dashboard

Dashboard adalah halaman statis tanpa server sendiri. Browser memanggil GitHub REST API langsung
dengan token milik pengguna. Berkasnya ada di branch `feat/prompt-v2`.

```
cd dashboard
python -m http.server 8765
```

Dashboard harus dibuka lewat HTTP, bukan langsung dari berkas, karena CSP dan `fetch` tidak berjalan
di `file://`.

- **Mode demo:** `http://127.0.0.1:8765/?demo=1`. Tidak perlu token dan tidak memanggil GitHub.
- **Mode live:** `http://127.0.0.1:8765/`. Perlu fine-grained personal access token dengan
  Repository access *Only select repositories*, serta permission **Actions: Read and write**,
  **Contents: Read-only**, dan **Metadata: Read-only**.

Izin Actions write juga memungkinkan token membatalkan, menjalankan ulang, atau menghapus run dan
artifact. Perlakukan token seperti kata sandi.

Rincian navigasi, konfigurasi project, dan cara pemeriksaan ada di `dashboard/README.md` pada branch
`feat/prompt-v2`.

## Hasil eksperimen 19 Oktober 2026

Kondisi `utama`: satu panggilan deteksi tanpa laporan Sonar, ditambah satu panggilan verifikasi per
alert Sonar. Tiga model, tiga run per model. Angka di bawah adalah rata-rata tiga run, diambil dari
`hasil-eksperimen/20261019/skor-utama.json`, dengan penilaian ketat.

| Model | Skenario | Precision | Recall | F1 |
|---|---|---|---|---|
| (tanpa model) | A, SAST saja | 0,333 | 0,111 | 0,167 |
| Gemini 3.1 Pro Preview | B, SAST dan LLM | 0,800 | 0,444 | 0,571 |
| Gemini 3.1 Pro Preview | C, LLM saja | 0,800 | 0,444 | 0,571 |
| Claude Sonnet 5.5 | B, SAST dan LLM | 0,796 | 0,852 | 0,823 |
| Claude Sonnet 5.5 | C, LLM saja | 0,863 | 0,852 | 0,856 |
| GPT 6.1 Sol | B, SAST dan LLM | 0,727 | 0,889 | 0,800 |
| GPT 6.1 Sol | C, LLM saja | 0,727 | 0,889 | 0,800 |

Skenario A tidak memakai model sama sekali, sehingga angkanya sama untuk ketiga model dan ditulis
satu kali. Himpunan positif untuk metrik adalah 9 item berstatus terbukti di `SEEDED.md`.

Angka di atas disajikan apa adanya tanpa peringkat. Penelitian ini tidak menyimpulkan model mana
yang lebih baik.

Konfigurasi lengkap, aturan scoring, dan cara reproduksinya ada di
`hasil-eksperimen/20261019/README.md` pada branch `eksperimen/seeded`.

## Keterbatasan

- **Objek uji buatan sendiri.** Backend dan seluruh datanya sintetis, dibuat untuk penelitian ini,
  bukan sistem produksi dengan data nyata.
- **Skala kecil dan tanpa uji statistik.** Ground truth berisi 9 celah berstatus terbukti, dengan
  tiga run per model. Angkanya dilaporkan apa adanya, tanpa uji signifikansi.
- **SonarCloud paket Free hanya menganalisis branch `main`.** Analisis untuk branch lain memakai
  hasil analisis `main`, dan kecocokannya dijamin pemeriksaan hash tree `src/`.
- **DAST di luar batasan penelitian ini** dan direncanakan untuk penelitian lanjutan. Yang diuji
  hanya analisis statis dan analisis berbantuan LLM.
- **Penanaman S1 ikut mengubah perilaku fungsional:** endpoint daftar mahasiswa mengembalikan hasil
  kosong bila dipanggil tanpa parameter pencarian. Akibatnya sebagian besar tes API gagal di branch
  `eksperimen/seeded` (pengamatan 21 Oktober 2026: 44 dari 51 tes gagal, 42 di antaranya berakar
  dari S1), sedangkan di `main` 51 dari 51 tes lolos. Hasil ini dapat diperiksa ulang dengan
  menjalankan langkah pada bagian Menjalankan backend secara lokal di masing-masing branch. Deteksi
  SAST dan LLM tidak terpengaruh karena keduanya hanya membaca kode.

## Catatan keamanan

Branch `eksperimen/seeded` berisi kerentanan yang **sengaja ditanam** sebagai ground truth
penelitian. Jangan menjalankan branch itu di server publik atau di jaringan yang bisa diakses pihak
lain.

Bukti konsep eksploitasinya ada di `scripts/poc/` pada branch yang sama. Skrip tersebut ditujukan
hanya untuk stack Docker Compose lokal berisi data sintetis milik proyek ini. Bukan alat serangan
umum dan tidak ditujukan ke sistem pihak lain.
