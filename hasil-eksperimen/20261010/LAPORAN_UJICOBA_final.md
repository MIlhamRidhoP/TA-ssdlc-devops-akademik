# Laporan Uji Coba Skenario A dan B — 2026-10-10

## Konteks untuk pembaca baru

- **Penelitian:** Tugas Akhir tentang SSDLC berbasis DevOps dengan bantuan LLM untuk analisis keamanan (SAST), dengan target paper ISRITI 2026 (deadline 12 Oktober 2026).
- **Objek uji:** backend Sistem Informasi Akademik (Node.js, Express, PostgreSQL). Versi aman ada di branch `main`. Versi dengan 12 kerentanan tertanam (S1–S12) ada di branch `eksperimen/seeded`.
- **Ground truth:** `SEEDED.md` berisi S1–S12 ditambah temuan bawaan B1–B6 dan N1 (regex aman yang ditandai Sonar).
- **Skenario A:** SonarCloud saja.
- **Skenario B:** SonarCloud + Gemini. Gemini menerima seluruh kode `src/` dan daftar issue SonarCloud dalam satu prompt 6 komponen (Context, Task, Instruction, Clarify, Refine, Warning), lalu menjawab dalam JSON `{"temuan":[{file, baris, kategori_owasp, cwe, jenis, keyakinan, penjelasan}]}`.
- **Pembanding manual:** Gemini 3.1 Pro lewat AI Studio memakai prompt yang identik. Hasilnya ada di kolom Pro dan di bagian 11.

**Status: SELESAI** untuk Skenario A, 3 run Flash otomatis, dan 3 run Pro manual. Analisis Pro ada di bagian 11.

## 1. Model, commit, hash prompt

| Item | Nilai |
|---|---|
| Model otomatis | `gemini-3.8-flash`. `modelVersion` dari respons di ketiga run: `gemini-3.8-flash` |
| Metadata model | Gemini 3.8 Flash, version "3.0", outputTokenLimit 65536, thinking true |
| generationConfig | temperature 0.2, maxOutputTokens 65536, responseMimeType `application/json`, thinking bawaan (tidak diatur) |
| Commit yang diuji | `5cbf05c928cd375fa51f773a03ca4779dde42e70` (`eksperimen/seeded`). `src/` bersih, tidak ada perubahan lokal. |
| Analisis SonarCloud | project `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`, revisi `5cbf05c…` (2026-10-10 08:23:47 UTC). Revisi ini sama dengan HEAD. |
| **SHA-256 prompt final** | **`de8f35e00b5682581d03fd605306c650f42e1813112d871657ba71589a78c49c`** |
| Prompt untuk uji Pro | `gemini-output/20261010-152454/prompt-lengkap.txt` |
| Bukti prompt identik | `summary.json` run Flash mencatat hash yang sama. `prompt-lengkap.txt` di folder ekspor (`20261010-152454`) dan folder run (`20261010-152522`) identik, diverifikasi dengan `cmp`. |

## 2. Perubahan skrip dan workflow

| Commit | Branch | Isi |
|---|---|---|
| `79563ca` | `eksperimen/seeded` | Skrip Gemini: model dari env, Sonar per branch dengan paginasi dan CWE, header API key, maxOutputTokens maksimum dan JSON mode, output bertimestamp, metrik per run, raw response, jeda dan retry 429/5xx, `--export-prompt`, `--score-file` |
| `326986a` | `main` | Merapikan penanda konflik di `.gitignore` |
| `6096301` / `fe97d23` | eksperimen / main | Workflow SonarCloud mengirim `-Dsonar.branch.name` |
| `5cbf05c` | `eksperimen/seeded` | Workflow SonarCloud memakai `-Dsonar.projectKey=…_seeded` tanpa nama branch. Skrip membaca `SONAR_PROJECT` dari env dan tidak mengirim parameter branch jika `SONAR_BRANCH` kosong atau `main`. `.env.example` mendapat `SONAR_PROJECT`. |

Alasan memakai project `_seeded`: organisasi SonarCloud ini menolak akses data branch non-main dengan pesan `Organization is not allowed to access data from non main branches.` (HTTP 403). Project `_seeded` dibuat lewat API `api/projects/create` dengan visibilitas public. Kode tertanam dianalisis di branch utamanya, yang bernama `master`.

Teks prompt dan aturan pencocokan tidak berubah sejak `79563ca`, diverifikasi dengan `cmp`. `src/`, `migrations/`, `tests/`, dan `SEEDED.md` tidak pernah diubah.

## 3. Data SonarCloud (Skenario A)

| Item | Nilai |
|---|---|
| Analisis | ada, revisi = HEAD `5cbf05c`, data terbaca (HTTP 200) |
| Issue terbuka | 26 |
| Hotspot | 0 |
| Issue relevan keamanan (masuk penilaian) | 5 |
| Ringkasan dashboard | 5 vulnerabilities, 0 bugs, 21 code smells |

Issue yang dinilai sebagai temuan keamanan. Kriterianya: tipe VULNERABILITY, dampak SECURITY, atau rule yang punya CWE.

| Rule | File:baris | Severity | CWE | Hasil cocok |
|---|---|---|---|---|
| `jssecurity:S3649` SQL Injection | `src/models/cutiModel.js:93` (`listAdmin`) | BLOCKER | 20, 89 | S2 |
| `jssecurity:S3649` SQL Injection | `src/models/nilaiModel.js:124` (`publishedBySemester`) | BLOCKER | 20, 89 | S3 |
| `jssecurity:S5131` Reflected XSS | `src/controllers/nilaiController.js:160` (`khs`) | BLOCKER | 79 | S5 |
| `jssecurity:S5131` Reflected XSS | `src/controllers/nilaiController.js:170` (`khs`) | BLOCKER | 79 | S5 |
| `javascript:S5122` CORS | `src/app.js:10` | MAJOR | 346, 942 | B1 |

Issue lain yang tidak masuk penilaian karena rule tanpa CWE dan bukan tipe keamanan:

| Rule | Lokasi | Severity | Catatan |
|---|---|---|---|
| `javascript:S8786` regex super-linear | `src/controllers/authController.js:8` | MAJOR | Ini B2 (ReDoS). Sonar melaporkannya sebagai maintainability, tanpa CWE. |
| `javascript:S8786` regex super-linear | `src/utils/validators.js:4` | MAJOR | Ini N1 (false positive yang diketahui). |

Sisanya 19 code smell: `S7772` ×8, `S7726` ×4, `S7780` ×3, `S7776` ×2, `S6582` ×1, `S4624` ×1. Data mentah ada di `sonar-issues.json` dan `sonar-hotspots.json`.

## 4. Run Flash

| Run | Durasi (wall clock) | Prompt tokens | Output tokens | Thoughts tokens | finishReason | Parse OK | Jumlah temuan |
|---|---|---|---|---|---|---|---|
| 1 | 237.207 ms | 31.102 | 883 | 8.790 | STOP | ya | 8 |
| 2 | 226.084 ms | 31.102 | 1.121 | 10.443 | STOP | ya | 8 |
| 3 | 122.688 ms | 31.102 | 920 | 15.289 | STOP | ya | 8 |

Catatan durasi:
- Durasi mencakup waktu tunggu retry.
- Run 2 kena HTTP 503 dua kali, ditambah backoff 10 dan 20 detik, sebelum berhasil di percobaan ke-3.
- Run 3 kena HTTP 503 sekali, ditambah backoff 10 detik.
- Run 3 memakai cache implisit untuk 29.055 token prompt.
- Total token per run: 40.775, 42.666, dan 47.311.

## 5. Tabel pencocokan

Isi tabel berasal dari `--score-file` (`run-N.score.json`, `sonar-temuan.score.json`, `manual-pro/pro-run-N.score.json`). Tanda † berarti putusan manual atas kasus "perlu cek manual" atau salah petakan. Rinciannya ada di bagian 11.

| ID | Kelas | Tingkat | Sonar (A) | Flash 1 | Flash 2 | Flash 3 | Pro 1 | Pro 2 | Pro 3 |
|---|---|---|---|---|---|---|---|---|---|
| S1 | SQL Injection | Mudah | tidak | cocok | cocok | cocok | cocok† | cocok† | cocok† |
| S2 | SQL Injection (ORDER BY) | Sedang | cocok | cocok | tidak | tidak | cocok | cocok | tidak |
| S3 | SQL Injection | Sulit | cocok | cocok | cocok | cocok | cocok | cocok | cocok |
| S4 | Stored XSS | Sedang | tidak | cocok | cocok | cocok | cocok† | cocok | cocok |
| S5 | Reflected XSS | Mudah | cocok | tidak | tidak | tidak | cocok | cocok | tidak |
| S6 | Path Traversal | Sedang | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| S7 | IDOR | Sedang | tidak | cocok | cocok | cocok | tidak | tidak | tidak |
| S8 | IDOR | Sulit | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| S9 | Mass Assignment | Sedang | tidak | cocok lokasi | cocok | cocok | cocok lokasi† | cocok | cocok lokasi |
| S10 | Mass Assignment | Mudah | tidak | cocok | cocok | cocok lokasi | tidak | cocok | tidak |
| S11 | Missing Authorization | Mudah | tidak | cocok | cocok | cocok | tidak | tidak | tidak |
| S12 | Sensitive Data Exposure | Sulit | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| B1 | CORS semua origin | – | cocok | tidak | tidak | tidak | cocok | cocok | cocok |
| B2 | ReDoS regex email | – | tidak* | tidak | tidak | tidak | tidak | tidak | tidak |
| B3 | Tanpa rate limiting | – | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| B4 | Enumerasi email 409 | – | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| B5 | Token berlaku setelah hapus akun | – | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| B6 | requireConsent loloskan nonaktif | – | tidak | tidak | tidak | tidak | tidak | tidak | tidak |
| N1 | False positive regex aman | – | tidak* | tidak | tidak | tidak | tidak | tidak | tidak |

\* Sonar melaporkan B2 dan N1 sebagai `S8786` (maintainability, tanpa CWE), sehingga keduanya tidak masuk himpunan temuan keamanan. Jika aturan diperluas ke rule tanpa CWE, B2 menjadi cocok dan N1 menjadi false positive dikenal.

Keterangan kasus khusus:
- **S9 Flash 1 dan S10 Flash 3 = "cocok lokasi".** Lokasinya benar, tetapi CWE berbeda. S9 dilaporkan sebagai CWE-89 (injeksi lewat nama kolom), S10 sebagai CWE-269 (privilege management). Kedua penjelasan menggambarkan kerentanan yang sama dengan ground truth.
- **Satu temuan run 2 berstatus "perlu cek manual"** (`mahasiswaModel.js:114`, CWE-89, injeksi nama kolom dari `Object.keys`). Pola itu hanya ada di `updateByUserId` (baris 142), lokasi S9. Putusan manual: cocok lokasi S9. Status S9 di run 2 tetap "cocok" karena ada temuan CWE-915 di `updateMe`. Temuan ini tidak dihitung FP.
- **Nomor baris Gemini sering meleset** 6–26 baris dari fungsi yang dimaksud. Pencocokan lokasi umumnya berhasil karena penjelasan menyebut nama fungsi.

## 6. Temuan di luar ground truth

Tidak ada di ketiga run Flash maupun di Sonar. Setiap temuan Flash berstatus cocok, cocok lokasi, atau perlu cek manual. Semua temuan berkeyakinan high, kecuali S4 di run 1 dan run 3 yang medium.

## 7. Konsistensi Flash (S1–S12)

| Terdeteksi | Ketat ("cocok") | Longgar ("cocok lokasi" dihitung) |
|---|---|---|
| 3 dari 3 run | S1, S3, S4, S7, S11 | S1, S3, S4, S7, S9, S10, S11 |
| 2 dari 3 run | S9, S10 | – |
| 1 dari 3 run | S2 (run 1) | S2 |
| 0 dari 3 run | S5, S6, S8, S12 | S5, S6, S8, S12 |

B1–B6 tidak terdeteksi Flash di run mana pun. Ini termasuk B1, padahal issue CORS ada di daftar SonarCloud dalam prompt.

## 8. Hitungan sementara

Definisi:
- **TP:** item S yang berstatus "cocok".
- **FP:** temuan "di luar ground truth" ditambah "false positive dikenal".
- **FN:** item S yang tidak cocok.
- **Versi longgar:** "cocok lokasi" dihitung sebagai TP.

### S1–S12 (12 item)

| Skenario | TP | FP | FN | Precision | Recall | F1 | Recall longgar |
|---|---|---|---|---|---|---|---|
| Sonar (A) | 3 | 0 | 9 | 1.000 | 0.250 | 0.400 | 0.250 |
| Flash run 1 | 7 | 0 | 5 | 1.000 | 0.583 | 0.737 | 0.667 |
| Flash run 2 | 7 | 0 | 5 | 1.000 | 0.583 | 0.737 | 0.583 |
| Flash run 3 | 6 | 0 | 6 | 1.000 | 0.500 | 0.667 | 0.583 |
| Flash rata-rata | 6.67 | 0 | 5.33 | 1.000 | 0.556 | 0.714 | 0.611 |

### Tanpa S2 dan S5 (10 item)

S2 dan S5 dikecualikan karena kemungkinan tidak bisa dieksploitasi:
- **S2:** `listQuery` menolak `sort` di luar whitelist dan `order` selain asc/desc sebelum nilai mentah dipakai di `ORDER BY`.
- **S5:** `semester` hanya dipantulkan saat string kosong (`nilaiController.js:160`). Di halaman KHS (baris 170), `semester` di-escape.

| Skenario | TP | FP | FN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|
| Sonar (A) | 1 | 0 | 9 | 1.000 | 0.100 | 0.182 |
| Flash run 1 | 6 | 0 | 4 | 1.000 | 0.600 | 0.750 |
| Flash run 2 | 7 | 0 | 3 | 1.000 | 0.700 | 0.824 |
| Flash run 3 | 6 | 0 | 4 | 1.000 | 0.600 | 0.750 |
| Flash rata-rata | 6.33 | 0 | 3.67 | 1.000 | 0.633 | 0.775 |

### Gabungan Sonar ∪ Flash per run

Keluaran pipeline Skenario B memuat temuan Sonar dan Gemini sekaligus. Angka di bawah dihitung dari file score, bukan oleh `--score-file`.

| Run | S1–S12 TP | Recall | Tanpa S2/S5 TP | Recall |
|---|---|---|---|---|
| 1 | 8 | 0.667 | 6 | 0.600 |
| 2 | 9 | 0.750 | 7 | 0.700 |
| 3 | 8 | 0.667 | 6 | 0.600 |

Pengamatan (disimpulkan dari data, bukan diuji statistik):
- **Sonar dan Flash saling melengkapi.** Sonar menangkap pola taint-flow (SQLi, reflected XSS) tetapi tidak menangkap kerentanan logika akses (IDOR, mass assignment, missing authorization). Flash menangkap sebagian besar kerentanan logika itu.
- **Dua deteksi unik Sonar adalah S2 dan S5,** yaitu item yang secara manual dinilai kemungkinan tidak bisa dieksploitasi. Flash tidak melaporkan S5 di run mana pun, padahal Sonar menandainya di prompt. Flash melaporkan S2 hanya sekali, dengan alasan "tanpa validasi" yang keliru, karena `listQuery` sebenarnya memvalidasi.
- **Recall Sonar sangat bergantung pada status S2 dan S5:** 0.25 jika dihitung, 0.10 jika dikecualikan. Status kedua item ini harus diputuskan sebelum angka dipakai di paper.
- **Tidak satu pun skenario mendeteksi S6, S8, S12, atau B3–B6.**
- **Precision 1.0 di semua skenario.** Dengan n kecil, angka ini belum bermakna statistik.

## 9. Info uji manual Pro

| Item | Nilai |
|---|---|
| Prompt | `gemini-output/20261010-152454/prompt-lengkap.txt` |
| SHA-256 | `de8f35e00b5682581d03fd605306c650f42e1813112d871657ba71589a78c49c` |
| Ukuran | 92.656 karakter |
| Token | sekitar 23.200 (karakter dibagi 4). Hitungan nyata Gemini: 31.102 prompt token. |
| Instruksi dan template | `gemini-output/20261010-152454/manual-pro/README.md` dan `catatan-pro.md` |

Perintah penilaian:

```
node scripts/gemini-scan.js --score-file=gemini-output/20261010-152454/manual-pro/pro-run-1.json
node scripts/gemini-scan.js --score-file=gemini-output/20261010-152454/manual-pro/pro-run-2.json
node scripts/gemini-scan.js --score-file=gemini-output/20261010-152454/manual-pro/pro-run-3.json
```

Hasil cek akses Pro lewat API (satu request "ping", 2026-10-10 08:00 UTC): HTTP 429 RESOURCE_EXHAUSTED. Kuota free tier `gemini-3.1-pro` bernilai `limit: 0` untuk request per menit, request per hari, input token per menit, dan input token per hari. Tidak ada retry. Uji Pro hanya bisa dilakukan manual.

## 10. Kendala dan catatan

1. **HTTP 503 "high demand"** muncul 3 kali, dan semuanya pulih lewat retry. Tidak ada run yang gagal.
2. **Akses data branch non-main ditolak SonarCloud.** Ini diselesaikan dengan project `_seeded`. Branch `eksperimen/seeded` di project lama berisi analisis yang tidak bisa dibaca, dan boleh dihapus.
3. **DevSecOps Pipeline (build dan uji API) selalu gagal di branch eksperimen.** Ini wajar karena kode berisi kerentanan, dan sudah diabaikan.
4. **Argumen `-Dsonar.branch.name` di workflow `main`** akan membuat event `pull_request` tercatat sebagai branch "N/merge". Saat ini tidak berdampak karena tidak ada PR.
5. **Peringatan di run GitHub Actions:** `sonarqube-scan-action@v5` dinyatakan tidak didukung lagi dan punya kerentanan, dengan saran pindah ke `@v6`. Ada juga peringatan Node 20 deprecated. Workflow belum diubah karena di luar cakupan.
6. **Keterbatasan pencocokan.** Keluarga CWE ditetapkan di skrip (`KELUARGA_CWE`) dan disimpan di setiap `.score.json`. CWE-269 tidak masuk keluarga mass assignment, sehingga S10 run 3 hanya "cocok lokasi".
7. **Lokasi file:**

   | Isi | Folder |
   |---|---|
   | Run Flash | `gemini-output/20261010-152522/` (`run-N.json`, `run-N.raw.json`, `run-N.score.json`, `summary.json`, `sonar-*.json`, `sonar-temuan.score.json`) |
   | Ekspor prompt dan uji Pro | `gemini-output/20261010-152454/` |

   Folder `gemini-output/` tidak ter-track di git.
8. **Tidak ada commit baru selama eksperimen.** HEAD tetap `5cbf05c`.

## 11. Analisis uji manual Gemini 3.1 Pro

### Sumber dan kondisi

- **File:** `gemini-output/20261010-152454/manual-pro/pro-run-1.json` sampai `pro-run-3.json`.
- **Format:** ketiga file berbentuk `{"response": "<JSON sebagai string>"}`. `--score-file` diperbaiki agar membuka field `response`, dan agar menolak file tanpa daftar `temuan`. Sebelum perbaikan, file ini diam-diam dinilai sebagai 0 temuan. Perbaikan ini belum di-commit. Teks prompt dan aturan pencocokan tidak berubah.
- **Kondisi run belum tercatat.** `catatan-pro.md` masih kosong, sehingga nama model persis di UI, thinking, JSON mode atau schema, dan waktu belum diketahui.
- **Kesamaan prompt** dengan hash `de8f35e0…` hanya bisa diasumsikan, karena teks yang ditempel di AI Studio tidak bisa di-hash.

### Temuan per run

| Run | Jumlah temuan | Temuan |
|---|---|---|
| 1 | 7 | S2, S3, S1†, S9 lokasi†, S5 (baris 160), S4† (baris 170, dipetakan otomatis ke S5), B1 |
| 2 | 9 | S2, S3, S5, S4, S9 (CWE-89 di model dan CWE-915 di controller), S1†, S10, B1 |
| 3 | 5 | S3, S1†, S9 lokasi, S4, B1 |

### Putusan manual (†)

| Kasus | Alasan | Putusan |
|---|---|---|
| S1 di ketiga run | Baris 37/44/45 jatuh di fungsi lain, tetapi penjelasannya ("pola … kutip tunggal tidak di-escape") adalah S1 di `listFrom` (baris 51) | cocok |
| Run 1, `mahasiswaModel.js:135` | Kunci `req.body` dipakai sebagai nama kolom, yaitu `updateByUserId`, dengan CWE-89 | cocok lokasi S9 |
| Run 1, `nilaiController.js:170` | Penilai memetakannya ke S5 karena baris itu ada di `khs`, tetapi penjelasannya "nama mata kuliah dari database tanpa escape" adalah S4 | S4 cocok. S5 tetap cocok lewat baris 160. |

Tidak ada temuan Pro yang berstatus "di luar ground truth".

### Metrik Pro setelah putusan manual

| Run | TP S1–S12 | Recall | F1 | Recall longgar | TP tanpa S2/S5 | Recall | F1 |
|---|---|---|---|---|---|---|---|
| 1 | 5 | 0.417 | 0.588 | 0.500 | 3 | 0.300 | 0.462 |
| 2 | 7 | 0.583 | 0.737 | 0.583 | 5 | 0.500 | 0.667 |
| 3 | 3 | 0.250 | 0.400 | 0.333 | 3 | 0.300 | 0.462 |
| Rata-rata | 5.00 | 0.417 | 0.575 | 0.472 | 3.67 | 0.367 | 0.530 |

Precision 1.000 di semua run (FP 0). Angka mentah dari `--score-file` sebelum putusan manual: TP 3/6/2 untuk S1–S12, dan 1/4/2 tanpa S2/S5.

### Perbandingan tiga skenario (rata-rata)

| Metrik | Sonar (A) | Flash otomatis (B) | Pro manual |
|---|---|---|---|
| Recall S1–S12 | 0.250 | 0.556 | 0.417 |
| F1 S1–S12 | 0.400 | 0.714 | 0.575 |
| Recall tanpa S2/S5 | 0.100 | 0.633 | 0.367 |
| F1 tanpa S2/S5 | 0.182 | 0.775 | 0.530 |
| Rentang jumlah temuan per run | 5 (tetap) | 8–8 | 5–9 |
| B1 (CORS dari daftar Sonar) | ya | 0/3 | 3/3 |

### Konsistensi Pro (ketat)

| Terdeteksi | Item |
|---|---|
| 3/3 | S1, S3, S4, B1 |
| 2/3 | S2, S5 |
| 1/3 | S9 (3/3 jika longgar), S10 |
| 0/3 | S6, S7, S8, S11, S12 |

### Interpretasi alternatif: S2 dan S5 sebagai false positive

Jika S2 dan S5 memang tidak bisa dieksploitasi, deteksinya dihitung FP (satu per item):

| Skenario | TP (dari 10) | FP | Precision |
|---|---|---|---|
| Sonar (A) | 1 | 2 | 0.333 |
| Flash run 1 / 2 / 3 | 6 / 7 / 6 | 1 / 0 / 0 | 0.857 / 1.000 / 1.000 |
| Pro run 1 / 2 / 3 | 3 / 5 / 3 | 2 / 2 / 0 | 0.600 / 0.714 / 1.000 |

### Pengamatan (disimpulkan, n kecil, tanpa uji statistik)

1. **Pro cenderung mengikuti SonarCloud.** Keempat temuan keamanan Sonar (S2, S3, S5, B1) dikonfirmasi Pro di sebagian besar run, termasuk S2 dan S5 yang kemungkinan tidak bisa dieksploitasi. Flash menolak S5 di ketiga run dan S2 di 2 dari 3 run, tetapi juga tidak pernah melaporkan B1.
2. **Pro lemah pada kerentanan logika akses.** S7 (IDOR) dan S11 (missing authorization) terdeteksi 0/3 oleh Pro, tetapi 3/3 oleh Flash. S10 hanya 1/3 oleh Pro.
3. **Pro kurang stabil.** Jumlah temuan berkisar 5 sampai 9, dan recall berkisar 0.25 sampai 0.58. Flash lebih stabil: 8 temuan per run, recall 0.50 sampai 0.58.
4. **Penjelasan Pro lebih singkat**, terutama di run 1, dan nomor baris sering meleset.
5. **Tidak ada skenario yang mendeteksi S6, S8, S12, atau B2–B6.**
6. **Keterbatasan:** kondisi run Pro belum tercatat, prompt Pro ditempel manual, n = 12 item dengan 3 run per model, dan pencocokan memakai beberapa putusan manual.
