# Label Kunci 26 Issue SonarCloud — DRAF

Status: **DRAF, belum diperiksa user, belum dibekukan.** Dibuat 16 Okt 2026.

Label ini disiapkan untuk prompt v2. Di v2, Gemini akan diminta memberi putusan untuk setiap temuan Sonar, dan label ini menjadi kunci penilaian putusan tersebut. Label harus dibekukan (commit dan catat SHA-256) **sebelum** prompt v2 dijalankan, supaya kunci tidak disesuaikan setelah melihat jawaban model.

Data mesin: `label-sonar-26.json`. Urutan dan ID (L01–L26) sama dengan urutan issue di blok Sonar prompt eksperimen (`hasil-eksperimen/20261010/prompt-lengkap.txt` baris 30–55).

## Ringkasan

| Kelompok | Jumlah | Putusan benar | Issue |
|---|---|---|---|
| Target terbukti | 1 | kerentanan | L02 (S3) |
| Jebakan FP | 3 | bukan kerentanan | L01 (S2), L03 dan L04 (S5) |
| Bawaan, kelemahan nyata | 2 | kerentanan | L26 (B1, CORS), L24 (B2, ReDoS) |
| Bawaan, false positive | 1 | bukan kerentanan | L20 (N1) |
| Non-keamanan (code smell) | 19 | bukan kerentanan | L05–L19 kecuali yang di atas, L21–L23, L25 |

Jadi 3 issue berlabel "kerentanan" dan 23 berlabel "bukan kerentanan".

## Issue yang relevan keamanan

| ID | Lokasi | Rule Sonar | Label | Dasar |
|---|---|---|---|---|
| L01 | src/models/cutiModel.js:93 | S3649 SQLi, BLOCKER | bukan kerentanan (S2) | PoC 10 Okt: `listQuery` menolak `sort`/`order` di luar whitelist sebelum query (HTTP 400) |
| L02 | src/models/nilaiModel.js:124 | S3649 SQLi, BLOCKER | **kerentanan (S3)** | PoC terbukti, `SKENARIO_SERANGAN.md` |
| L03 | src/controllers/nilaiController.js:160 | S5131 XSS, BLOCKER | bukan kerentanan (S5) | Jalur `if (!semester)` hanya aktif saat semester kosong |
| L04 | src/controllers/nilaiController.js:170 | S5131 XSS, BLOCKER | bukan kerentanan (S5) | Jalur taint Sonar: `semester` melewati `escapeHtml` (src/utils/html.js:4), dan PoC menunjukkan payload ter-escape |
| L20 | src/utils/validators.js:4 | S8786 regex, MAJOR (Reliability) | bukan kerentanan (N1) | SEEDED.md: regex aman |
| L24 | src/controllers/authController.js:8 | S8786 regex, MAJOR (Reliability) | **kerentanan (B2)** | SEEDED.md: regex dijalankan sebelum cek panjang (CWE-1333) |
| L26 | src/app.js:10 | S5122 CORS, MAJOR | **kerentanan (B1)** | `cors()` tanpa opsi mengizinkan semua origin (CWE-942) |

## Yang perlu kamu putuskan sebelum dibekukan

1. **L04 dan S4.** S4 (stored XSS dari nama mata kuliah di database) ada di fungsi yang sama dengan L04, tetapi jalur yang dilaporkan Sonar adalah parameter `semester`, bukan data database. Draf ini memberi label "bukan kerentanan" karena yang dinilai adalah klaim Sonar. Kalau Gemini menjawab "kerentanan" dengan alasan S4, jawaban itu salah untuk klaim Sonar, meskipun lokasinya memang rentan. Konsekuensi ini perlu disebut di Bab 3.
2. **L24 (B2) belum punya PoC.** Labelnya diambil dari SEEDED.md, dan Sonar sendiri mengkategorikannya Reliability, bukan Security. Pilihannya: tetap "kerentanan", atau dikeluarkan dari penilaian putusan (menjadi 25 issue).
3. **19 code smell.** Pilihannya: dinilai semua (model harus menjawab "bukan kerentanan" untuk tiap code smell), atau v2 hanya meminta putusan untuk 7 issue keamanan. Saranku dinilai semua, karena ini sekaligus menguji apakah model menganggap code smell sebagai kerentanan, dan prompt v1 juga mengirim ke-26 issue.
