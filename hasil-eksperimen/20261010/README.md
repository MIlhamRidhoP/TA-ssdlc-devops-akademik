# Arsip Eksperimen SSDLC + Gemini — 2026-10-10

Arsip reprodusibilitas untuk satu putaran eksperimen Skenario A dan B, ditambah verifikasi dinamis S2 dan S5. Semua file di folder ini bebas dari API key, token, dan isi `.env` (sudah di-grep).

## Parameter tetap

| Item | Nilai |
|---|---|
| Commit | `5cbf05c928cd375fa51f773a03ca4779dde42e70` (`eksperimen/seeded`) |
| Prompt SHA-256 | `de8f35e00b5682581d03fd605306c650f42e1813112d871657ba71589a78c49c` |
| Model otomatis | `gemini-3.8-flash` (temperature 0.2, maxOutputTokens 65536, JSON mode, thinking bawaan) |
| Model manual | Gemini 3.1 Pro di AI Studio (3 run, kondisi run belum tercatat) |
| SAST | SonarCloud project `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`, analisis revisi `5cbf05c` |

## Isi folder

| Path | Isi |
|---|---|
| `prompt-lengkap.txt`, `prompt-lengkap.sha256` | prompt final yang dikirim ke semua model |
| `sonar/sonar-issues.json`, `sonar-hotspots.json` | data mentah SonarCloud (26 issue, 0 hotspot) |
| `sonar/sonar-temuan.score.json` | penilaian Skenario A |
| `flash/run-N.json`, `run-N.score.json`, `summary.json` | 3 run Flash dan penilaiannya |
| `manual-pro/pro-run-N.json`, `run-N.score.json` | 3 run Pro dan penilaiannya |
| `manual-pro/README.md`, `catatan-pro.md` | instruksi dan template catatan uji Pro |
| `LAPORAN_UJICOBA_final.md` | laporan eksperimen terperinci (Flash + Pro) |
| `LAPORAN_UJICOBA_konteks-sonarcloud.md` | konteks kendala SonarCloud dan solusi project `_seeded` |

`run-N.raw.json` sengaja tidak disalin.

## Verifikasi dinamis S2 dan S5 (2026-10-10)

Stack dijalankan dengan Docker Compose di branch `eksperimen/seeded` commit `5cbf05c`. Login admin dan mahasiswa berhasil. Uji lewat HTTP nyata.

### S2 — SQL injection ORDER BY di list cuti admin

Endpoint: `GET /api/cuti` (admin).

| Payload `sort` atau `order` | HTTP | Hasil |
|---|---|---|
| `sort=nonexistent_col` | 400 | VALIDATION_ERROR |
| `sort=(SELECT 1)` | 400 | VALIDATION_ERROR |
| `sort=CASE WHEN (1=1) THEN c.id ELSE c.semester END` | 400 | VALIDATION_ERROR |
| `sort=c.id); DROP TABLE pengajuan_cuti;--` | 400 | VALIDATION_ERROR |
| `order=asc, (SELECT 1)` | 400 | VALIDATION_ERROR |
| `order=ASC--` | 400 | VALIDATION_ERROR |
| `sort=nim` + `order=; SELECT pg_sleep(3)` | 400 | VALIDATION_ERROR |
| `sort=m.nim` (ekspresi SQL dari whitelist, bukan key) | 400 | VALIDATION_ERROR |

**Kesimpulan: tidak bisa dieksploitasi.** Controller memang memakai `req.query.sort` dan `req.query.order` mentah di `ORDER BY`, tetapi `listQuery` dipanggil lebih dulu dan menolak `sort` di luar daftar key (created_at, semester, status, kategori, nim, nama) dan `order` selain asc/desc. Semua payload berhenti di 400 sebelum menyentuh query.

### S5 — reflected XSS parameter semester di KHS

Endpoint: `GET /api/nilai/me/khs` (mahasiswa).

| Payload `semester` | HTTP | Hasil |
|---|---|---|
| `<script>alert(1)</script>` | 200 | dipantulkan ter-escape: `&lt;script&gt;alert(1)&lt;/script&gt;` di dalam `<title>` |
| (kosong) | 400 | body `<p>Semester "" tidak dikenali</p>`, yang dipantulkan hanya string kosong |
| `"><img src=x onerror=alert(1)>` | 200 | dipantulkan ter-escape |
| `2026-ganjil` (valid) | 200 | halaman KHS normal |

**Kesimpulan: tidak bisa dieksploitasi.** Dua jalur sama-sama aman. Jalur `if (!semester)` di baris 160 hanya aktif saat semester kosong, sehingga `${semester}` selalu string kosong. Jalur halaman KHS di baris 170 melewatkan `semester` ke `escapeHtml`.

### Bonus — list cuti admin tanpa sort

`GET /api/cuti` tanpa parameter sort mengembalikan **HTTP 200**, bukan 500. Dugaan "created_at ambigu" pada laporan sinkron terdahulu keliru. `ORDER BY created_at` merujuk ke alias kolom hasil SELECT (`c.created_at`), bukan kolom tabel yang ambigu, sehingga tidak error.

## [DIGANTIKAN] Metrik dengan S2 dan S5 sebagai kasus negatif

> **Bagian ini (basis 10 item) DIGANTIKAN oleh bagian "Metrik final" di bawah.**
> Setelah verifikasi PoC penuh (lihat `SKENARIO_SERANGAN.md`), ground truth direklasifikasi:
> hanya 9 item terbukti yang dihitung positif, S2 dan S5 menjadi jebakan FP, S6 menjadi laten
> (tidak dihitung). Angka di bawah dipertahankan untuk jejak, tetapi JANGAN dipakai lagi.

Ground truth positif = 10 item (S1, S3, S4, S6–S12). Deteksi atas S2 atau S5 dihitung FP. Output Skenario B = JSON Gemini saja, bukan gabungan dengan Sonar. Versi ketat: hanya "cocok" dihitung TP. Versi longgar: "cocok lokasi" ikut TP.

### Metrik utama

| Skenario | TP | FP | FN | Precision | Recall | F1 | F1 longgar |
|---|---|---|---|---|---|---|---|
| SonarCloud (A) | 1 | 2 | 9 | 0.333 | 0.100 | 0.154 | 0.154 |
| Flash run 1 | 6 | 1 | 4 | 0.857 | 0.600 | 0.706 | 0.778 |
| Flash run 2 | 7 | 0 | 3 | 1.000 | 0.700 | 0.824 | 0.824 |
| Flash run 3 | 6 | 0 | 4 | 1.000 | 0.600 | 0.750 | 0.824 |
| **Flash rata-rata** | **6.33** | **0.33** | **3.67** | **0.952** | **0.633** | **0.760** | **0.808** |
| Pro run 1 | 3 | 2 | 7 | 0.600 | 0.300 | 0.400 | 0.500 |
| Pro run 2 | 5 | 2 | 5 | 0.714 | 0.500 | 0.588 | 0.588 |
| Pro run 3 | 3 | 0 | 7 | 1.000 | 0.300 | 0.462 | 0.571 |
| **Pro rata-rata** | **3.67** | **1.33** | **6.33** | **0.771** | **0.367** | **0.483** | **0.553** |

### Penolakan benar atas FP Sonar (S2, S5)

Sonar melaporkan S2 dan S5 sebagai kerentanan. Keduanya kasus negatif, jadi model yang benar seharusnya tidak melaporkannya.

| Skenario | S2, S5 ditolak |
|---|---|
| Sonar | 0 dari 2 (keduanya dilaporkan) |
| Flash run 1 | 1 dari 2 (S2 masih dilaporkan) |
| Flash run 2 | 2 dari 2 |
| Flash run 3 | 2 dari 2 |
| Pro run 1 | 0 dari 2 |
| Pro run 2 | 0 dari 2 |
| Pro run 3 | 2 dari 2 |

Flash menolak 5 dari 6 (3 run × 2 item). Pro hanya 2 dari 6. Pro cenderung mengikuti Sonar.

### Temuan Sonar benar yang tidak dikonfirmasi model

| Temuan Sonar benar | Tidak dikonfirmasi oleh |
|---|---|
| S3 (SQLi `publishedBySemester`) | (semua model mengonfirmasi) |
| B1 (CORS semua origin) | Flash run 1, 2, 3 |

Flash tidak pernah mengonfirmasi B1, padahal B1 ada di daftar issue Sonar dalam prompt. Pro mengonfirmasi B1 di 3 dari 3 run.

### Recall per kategori OWASP (positif saja, ketat)

| Kategori | Item | Sonar | Flash 1/2/3 | Pro 1/2/3 |
|---|---|---|---|---|
| A03 Injection | S1, S3, S4 (3) | 0.33 | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| A01 Broken Access Control | S6–S12 (7) | 0.00 | 0.43 / 0.57 / 0.43 | 0.00 / 0.29 / 0.00 |

### Recall per tingkat kesulitan (positif saja, ketat)

| Tingkat | Item | Sonar | Flash 1/2/3 | Pro 1/2/3 |
|---|---|---|---|---|
| Mudah | S1, S10, S11 (3) | 0.00 | 1.00 / 1.00 / 0.67 | 0.33 / 0.67 / 0.33 |
| Sedang | S4, S6, S7, S9 (4) | 0.00 | 0.50 / 0.75 / 0.75 | 0.25 / 0.50 / 0.25 |
| Sulit | S3, S8, S12 (3) | 0.33 | 0.33 / 0.33 / 0.33 | 0.33 / 0.33 / 0.33 |

## Metrik final (reklasifikasi PoC, basis 9 positif) — BERLAKU

Dasar ground truth (dari kolom Status `SEEDED.md`, bukti di `SKENARIO_SERANGAN.md`):
- **Positif (9, terbukti PoC)**: S1, S3, S4, S7, S8, S9, S10, S11, S12.
- **Jebakan FP**: S2, S5. Deteksi atasnya dihitung false positive.
- **Laten (tidak dihitung)**: S6. Tidak terdeteksi model mana pun di eksperimen ini.
- Output Skenario B = JSON Gemini saja. Ketat = hanya "cocok" TP; longgar = "cocok lokasi" ikut TP.

Dua kolom angka dilaporkan:
- **Otomatis**: keluaran langsung `node scripts/gemini-scan.js --score-file=...` (reprodusibel, objektif).
- **Koreksi manual**: setelah memperbaiki salah-petakan akibat nomor baris LLM meleset (didokumentasikan di `LAPORAN_UJICOBA_final.md` §8.4). Koreksi yang dipakai di sini: temuan Pro "pola … kutip tunggal" di `mahasiswaModel` dihitung S1 (bukan "perlu cek manual"); temuan Pro run 1 "nama mata kuliah … stored XSS" di `nilaiController.js:170` dihitung S4 (otomatis salah petakan ke S5).

### Metrik utama — OTOMATIS (9 positif)

| Skenario | TP | FP | FN | Precision | Recall | F1 | Rincian FP |
|---|---|---|---|---|---|---|---|
| SonarCloud (A) | 1 | 2 | 8 | 0.333 | 0.111 | 0.167 | S2, S5 (jebakan) |
| Flash run 1 | 6 | 1 | 3 | 0.857 | 0.667 | 0.750 | S2 |
| Flash run 2 | 7 | 0 | 2 | 1.000 | 0.778 | 0.875 | — |
| Flash run 3 | 6 | 0 | 3 | 1.000 | 0.667 | 0.800 | — |
| **Flash rata-rata** | **6.33** | **0.33** | **2.67** | **0.952** | **0.704** | **0.808** | — |
| Pro run 1 | 1 | 2 | 8 | 0.333 | 0.111 | 0.167 | S2, S5 |
| Pro run 2 | 4 | 2 | 5 | 0.667 | 0.444 | 0.533 | S2, S5 |
| Pro run 3 | 2 | 0 | 7 | 1.000 | 0.222 | 0.364 | — |
| **Pro rata-rata** | **2.33** | **1.33** | **6.67** | **0.667** | **0.259** | **0.355** | — |
| CI (1 run, bukti integrasi) | 6 | 1 | 3 | 0.857 | 0.667 | 0.750 | S2 |

Longgar (otomatis): Flash rata-rata recall 0.778, F1 0.858; Pro rata-rata recall 0.296, F1 0.400.

Angka Pro otomatis rendah karena nomor baris Pro sering meleset, sehingga sebagian deteksi benar
jatuh di "perlu cek manual" (S1 tiga run) atau salah petakan ke item lain (S4 run 1 → S5). Lihat
kolom koreksi manual di bawah.

### Metrik utama — KOREKSI MANUAL (9 positif)

Flash tidak berubah dari otomatis (nomor barisnya cukup dekat sehingga pencocokan otomatis sudah
benar). Yang berubah hanya Pro:

| Skenario | TP | FP | FN | Precision | Recall | F1 | Longgar R / F1 |
|---|---|---|---|---|---|---|---|
| Pro run 1 | 3 | 2 | 6 | 0.600 | 0.333 | 0.429 | 0.444 / 0.533 |
| Pro run 2 | 5 | 2 | 4 | 0.714 | 0.556 | 0.625 | 0.556 / 0.625 |
| Pro run 3 | 3 | 0 | 6 | 1.000 | 0.333 | 0.500 | 0.444 / 0.615 |
| **Pro rata-rata** | **3.67** | **1.33** | **5.33** | **0.771** | **0.407** | **0.521** | **0.481 / —** |

Bahkan setelah koreksi manual yang menguntungkan Pro, Flash tetap unggul jelas (recall rata-rata
0.704 vs 0.407 ketat).

### Penolakan benar atas jebakan Sonar (S2, S5)

Sonar melaporkan S2 dan S5 (keduanya jebakan FP). Model yang baik seharusnya TIDAK melaporkannya.

| Skenario | S2, S5 ditolak |
|---|---|
| Sonar | 0 dari 2 (keduanya dilaporkan) |
| Flash run 1 / 2 / 3 | 1 / 2 / 2 (total 5 dari 6) |
| Pro run 1 / 2 / 3 | 0 / 0 / 2 (total 2 dari 6) |

Flash menolak 5 dari 6 jebakan, Pro hanya 2 dari 6. Pro cenderung ikut membenarkan Sonar.

### Temuan Sonar benar yang tidak dikonfirmasi model

| Temuan Sonar | Tidak dikonfirmasi oleh |
|---|---|
| S3 (SQLi publishedBySemester) | (semua model mengonfirmasi) |
| B1 (CORS, bawaan, bukan target) | Flash run 1, 2, 3 (Pro mengonfirmasi 3/3) |

### Recall per kategori OWASP (otomatis, ketat, 9 positif)

| Kategori | Item | Sonar | Flash 1/2/3 | Pro 1/2/3 |
|---|---|---|---|---|
| A03 Injection | S1, S3, S4 (3) | 0.33 | 1.00 / 1.00 / 1.00 | 0.33 / 0.67 / 0.67 |
| A01 Broken Access Control | S7, S8, S9, S10, S11, S12 (6) | 0.00 | 0.50 / 0.67 / 0.50 | 0.00 / 0.33 / 0.00 |

### Recall per tingkat kesulitan (otomatis, ketat, 9 positif)

| Tingkat | Item | Sonar | Flash 1/2/3 | Pro 1/2/3 |
|---|---|---|---|---|
| Mudah | S1, S10, S11 (3) | 0.00 | 1.00 / 1.00 / 0.67 | 0.00 / 0.33 / 0.00 |
| Sedang | S4, S7, S9 (3) | 0.00 | 0.67 / 1.00 / 1.00 | 0.00 / 0.67 / 0.33 |
| Sulit | S3, S8, S12 (3) | 0.33 | 0.33 / 0.33 / 0.33 | 0.33 / 0.33 / 0.33 |

### McNemar eksak, basis mayoritas 3 run (n=9)

Status item = terdeteksi di ≥2 dari 3 run (ketat). b = hanya model pertama, c = hanya model kedua.
Rincian metode dan keterbatasan di `STATISTIK.md`.

| Perbandingan | Otomatis (b, c, p) | Koreksi manual (b, c, p) |
|---|---|---|
| Flash vs Sonar | 6, 0, **0.0313** | 6, 0, **0.0313** |
| Pro vs Sonar | 1, 0, 1.0000 | 2, 0, 0.5000 |
| Flash vs Pro | 5, 0, 0.0625 | 4, 0, 0.1250 |

Hanya Flash vs Sonar signifikan pada α=0,05, konsisten di kedua cara hitung. Perbedaan Pro vs
Sonar dan Flash vs Pro tidak signifikan pada n=9 (lihat keterbatasan di `STATISTIK.md`).

## Pengamatan (deskriptif, n kecil, tanpa uji statistik)

1. **S2 dan S5 kini jebakan FP** (terbukti tidak dapat dieksploitasi lewat PoC). Sonar melaporkan keduanya, sehingga precision Sonar hanya 0.333. Flash menolak 5 dari 6, Pro hanya 2 dari 6.
2. **Kekuatan utama LLM ada di A03 Injection**, dengan recall Flash sempurna di semua run. Keunggulan ini sebagian overlap dengan Sonar, yang juga menangkap S3.
3. **Kerentanan A01 (logika akses) adalah pembeda.** Sonar 0, Pro hampir 0, Flash paling baik tetapi tetap di bawah 0.6.
4. **Flash lebih kritis dan lebih stabil** dari Pro: menolak hampir semua false positive Sonar dan recall yang lebih rapat antar run.
5. **Tidak ada model yang menyentuh kerentanan Sulit selain S3.** S8 dan S12 lolos dari semua.

## Durasi bersih dan perkiraan biaya 3 run Flash (dihitung ulang 2026-10-10, offline)

Dihitung dari `flash/run-N.json` yang sudah tersimpan, **tanpa memanggil API lagi**. Skrip `scripts/gemini-scan.js`
sejak commit setelah audit ini mencatat `durasi_bersih_ms` dan `biaya_usd` otomatis untuk run baru; angka di
bawah ini dihitung manual untuk 3 run lama yang belum punya field tersebut.

- **durasi_total_ms**: dari `mulai` sampai `selesai`, termasuk semua jeda backoff retry (field lama `durasi_ms`).
- **durasi_bersih_ms**: `durasi_total_ms` dikurangi waktu backoff. Backoff dihitung dari formula di kode
  (`10000 * 2^(percobaanKe-1)` ms untuk retry non-429) dan dikonfirmasi oleh pesan log asli saat run berjalan
  ("coba lagi dalam 10 detik", "coba lagi dalam 20 detik").
- **Tarif**: `gemini-3.8-flash` paid tier, USD 0.75 / 1 juta token input, USD 3.75 / 1 juta token output
  (termasuk `thoughtsTokenCount`), berlaku sampai 2026-12-31. Sumber: https://ai.google.dev/gemini-api/docs/pricing
  (dicek 2026-10-10). Free tier yang sebenarnya dipakai untuk run ini **tidak dikenai biaya nyata**; angka ini
  murni perkiraan "kalau dijalankan di paid tier".

| Run | Percobaan | Backoff | durasi_total | durasi_bersih | Token output+thinking | Biaya (USD, estimasi paid tier) |
|---|---|---|---|---|---|---|
| 1 | 1 (langsung sukses) | 0 ms | 237.207 ms | 237.207 ms | 9.673 | $0,0596 |
| 2 | 3 (2× HTTP 503, lalu sukses) | 30.000 ms (10s + 20s) | 226.084 ms | 196.084 ms | 11.564 | $0,0667 |
| 3 | 2 (1× HTTP 503, lalu sukses) | 10.000 ms (10s) | 122.688 ms | 112.688 ms | 16.209 | $0,0841 |
| **Total 3 run** | – | 40.000 ms | **585.979 ms (9m 46s)** | **545.979 ms (9m 6s)** | 37.446 | **$0,2104** |

Pengamatan: durasi bersih tetap didominasi oleh waktu thinking Gemini (ribuan token thinking per run), bukan oleh
retry. Backoff hanya menyumbang 6,8% dari total waktu 3 run. Biaya per run naik seiring jumlah token thinking
(run 3 memakai thinking terbanyak dan termahal, meski outputnya paling sedikit temuan baru dibanding run lain
secara substansi — lihat tabel pencocokan di `LAPORAN_UJICOBA_final.md`).

## Cara reproduksi

Dari root repo, dengan `.env` berisi `GEMINI_API_KEY`, `SONAR_TOKEN`, `GEMINI_MODEL=gemini-3.8-flash`, `SONAR_PROJECT=MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`, `SONAR_BRANCH=main`:

```
git checkout 5cbf05c
node scripts/gemini-scan.js --export-prompt
node scripts/gemini-scan.js --runs=3
node scripts/gemini-scan.js --score-file=<file-hasil>.json
```

Analisis SonarCloud dipicu lewat workflow `sonarcloud.yml` pada branch `eksperimen/seeded`. Prompt hanya identik jika commit dan hasil SonarCloud sama persis.
