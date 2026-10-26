# Penilaian batch dua perkakas SAST (skenario B dan C), prompt v3, 3 run per sel

Ground truth 19 item, 9 positif terbukti (recall ketat, penyebut 9). Penilai: scripts/sast/skor-b-dua-sast.js, varian triase utama. Rata-rata dihitung per run lalu dirata-ratakan; tanda kurung berisi rentang min–maks antar 3 run.

## Skenario B

| Vendor | Lengan | TP | FP | FN | Presisi | Recall | F1 | FP: di luar GT / jebakan / N1 |
|---|---|---|---|---|---|---|---|---|
| anthropic | uji (Sonar+CodeQL) | 8.0 | 10.3 | 1.0 | 0.437 (0.421–0.444) | 0.889 (0.889–0.889) | 0.586 (0.571–0.593) | 9.3 / 1.0 / 0.0 |
| anthropic | kontrol (Sonar) | 7.0 | 2.3 | 2.0 | 0.752 (0.700–0.778) | 0.778 (0.778–0.778) | 0.764 (0.737–0.778) | 1.0 / 1.3 / 0.0 |
| google | uji (Sonar+CodeQL) | 5.0 | 6.7 | 4.0 | 0.437 (0.357–0.500) | 0.556 (0.556–0.556) | 0.487 (0.435–0.526) | 6.0 / 0.7 / 0.0 |
| google | kontrol (Sonar) | 4.3 | 1.0 | 4.7 | 0.850 (0.750–1.000) | 0.481 (0.333–0.667) | 0.592 (0.500–0.706) | 0.0 / 1.0 / 0.0 |
| openai | uji (Sonar+CodeQL) | 7.3 | 11.7 | 1.7 | 0.386 (0.368–0.400) | 0.815 (0.778–0.889) | 0.523 (0.500–0.552) | 11.7 / 0.0 / 0.0 |
| openai | kontrol (Sonar) | 8.0 | 2.3 | 1.0 | 0.776 (0.727–0.800) | 0.889 (0.889–0.889) | 0.828 (0.800–0.842) | 2.3 / 0.0 / 0.0 |

## Skenario C

| Vendor | Lengan | TP | FP | FN | Presisi | Recall | F1 | FP: di luar GT / jebakan / N1 |
|---|---|---|---|---|---|---|---|---|
| anthropic | uji (Sonar+CodeQL) | 8.0 | 0.3 | 1.0 | 0.963 (0.889–1.000) | 0.889 (0.889–0.889) | 0.924 (0.889–0.941) | 0.3 / 0.0 / 0.0 |
| anthropic | kontrol (Sonar) | 7.0 | 1.3 | 2.0 | 0.843 (0.778–0.875) | 0.778 (0.778–0.778) | 0.808 (0.778–0.824) | 1.0 / 0.3 / 0.0 |
| google | uji (Sonar+CodeQL) | 5.0 | 1.3 | 4.0 | 0.794 (0.714–0.833) | 0.556 (0.556–0.556) | 0.653 (0.625–0.667) | 0.7 / 0.7 / 0.0 |
| google | kontrol (Sonar) | 4.3 | 0.3 | 4.7 | 0.952 (0.857–1.000) | 0.481 (0.333–0.667) | 0.622 (0.500–0.750) | 0.0 / 0.3 / 0.0 |
| openai | uji (Sonar+CodeQL) | 7.3 | 2.7 | 1.7 | 0.735 (0.700–0.778) | 0.815 (0.778–0.889) | 0.772 (0.737–0.800) | 2.7 / 0.0 / 0.0 |
| openai | kontrol (Sonar) | 8.0 | 2.3 | 1.0 | 0.776 (0.727–0.800) | 0.889 (0.889–0.889) | 0.828 (0.800–0.842) | 2.3 / 0.0 / 0.0 |

## Selisih lengan uji dikurangi kontrol

| Vendor | ΔF1 skor B | ΔPresisi B | ΔRecall B | ΔF1 skor C (bukan perlakuan) |
|---|---|---|---|---|
| anthropic | -0.179 | -0.315 | 0.111 | 0.115 |
| google | -0.105 | -0.413 | 0.074 | 0.031 |
| openai | -0.305 | -0.390 | -0.074 | -0.057 |

Kolom terakhir membandingkan dua sampel deteksi dengan masukan model yang sama persis (hash prompt deteksi identik). Selisihnya murni derau pengambilan sampel antar-batch, jadi itu pembanding kasar untuk seberapa besar selisih B yang masih bisa berasal dari derau.

## Putusan verifikasi per alert per run

Urutan huruf = run 1,2,3. T = true_positive, F = false_positive, ? = uncertain. Label GT: otomatis dari ground truth; (x) = label triase ekstensi; kosong = tidak berlabel (ragu atau di luar GT).

| Alert | Lokasi, aturan | Label GT | Lengan | anthropic | google | openai | Konsisten (dari 3 vendor) |
|---|---|---|---|---|---|---|---|
| SONAR-01 | app.js:10 S5122 | nyata | uji | FFF | FFT | FFF | 2/3 |
| SONAR-01 | app.js:10 S5122 | nyata | kontrol | FFF | TTT | FFF | 3/3 |
| SONAR-02 | controllers/nilaiController.js:160 S5131 | fp | uji | FFF | FFF | FFF | 3/3 |
| SONAR-02 | controllers/nilaiController.js:160 S5131 | fp | kontrol | FFF | FFF | FFF | 3/3 |
| SONAR-03 | controllers/nilaiController.js:170 S5131 | fp | uji | TTT | FTF | FFF | 2/3 |
| SONAR-03 | controllers/nilaiController.js:170 S5131 | fp | kontrol | TTT | FTT | FFF | 2/3 |
| SONAR-04 | models/cutiModel.js:93 S3649 | fp | uji | FFF | FFF | FFF | 3/3 |
| SONAR-04 | models/cutiModel.js:93 S3649 | fp | kontrol | FFF | FFF | FFF | 3/3 |
| SONAR-05 | models/nilaiModel.js:124 S3649 | nyata | uji | TTT | TTT | TTT | 3/3 |
| SONAR-05 | models/nilaiModel.js:124 S3649 | nyata | kontrol | TTT | TTT | TTT | 3/3 |
| CQL-01 | controllers/authController.js:20 js/polynomial-redos | nyata | uji | TTT | TTT | TTT | 3/3 |
| CQL-02 | middleware/upload.js:34 js/path-injection | (fp) | uji | FFF | FFF | FFF | 3/3 |
| CQL-03 | middleware/upload.js:39 js/path-injection | (fp) | uji | FFF | FFF | FFF | 3/3 |
| CQL-04 | models/cutiModel.js:94 js/sql-injection | fp | uji | FFF | FFF | FFF | 3/3 |
| CQL-05 | models/mahasiswaModel.js:59 js/sql-injection | nyata | uji | TTT | TTT | TTT | 3/3 |
| CQL-06 | models/mahasiswaModel.js:61 js/sql-injection | nyata | uji | TTT | TTT | TTT | 3/3 |
| CQL-07 | models/nilaiModel.js:125 js/sql-injection | nyata | uji | TTT | TTT | TTT | 3/3 |
| CQL-08 | routes/authRoutes.js:4 js/missing-rate-limiting | nyata | uji | TTT | TTT | TTT | 3/3 |
| CQL-09 | routes/authRoutes.js:5 js/missing-rate-limiting | nyata | uji | TTT | TTT | TTT | 3/3 |
| CQL-10 | routes/cutiRoutes.js:8 js/missing-rate-limiting |  | uji | TTT | TTF | TTT | 2/3 |
| CQL-11 | routes/konsenRoutes.js:5 js/missing-rate-limiting |  | uji | TTT | FFF | TTT | 3/3 |
| CQL-12 | routes/krsRoutes.js:8 js/missing-rate-limiting |  | uji | TTT | TFT | TTT | 2/3 |
| CQL-13 | routes/mahasiswaRoutes.js:8 js/missing-rate-limiting |  | uji | TTT | TTT | TTT | 3/3 |
| CQL-14 | routes/mahasiswaRoutes.js:19 js/missing-rate-limiting | (nyata) | uji | TTT | TTT | TTT | 3/3 |
| CQL-15 | routes/mahasiswaRoutes.js:27 js/missing-rate-limiting | (nyata) | uji | TTT | FFF | TTT | 3/3 |
| CQL-16 | routes/mahasiswaRoutes.js:29 js/missing-rate-limiting | (nyata) | uji | TTT | TFF | TTT | 2/3 |
| CQL-17 | routes/mataKuliahRoutes.js:5 js/missing-rate-limiting |  | uji | TTT | TTT | TTT | 3/3 |
| CQL-18 | routes/nilaiRoutes.js:6 js/missing-rate-limiting |  | uji | TTT | TFT | TTT | 2/3 |

Konsistensi tiga-run-sama (alert × vendor): lengan uji 63/69, kontrol 14/15.

## Verifikasi alert, lengan uji: tanpa dan dengan label triase ekstensi (rata-rata per run)

idFP = false_positive yang benar dibuang; missedFP = FP yang dipertahankan; misidFP = alert nyata yang dibuang; benar = nyata dipertahankan. P/R/F1 mengukur kemampuan membuang FP.

| Vendor | Label | idFP | missedFP | misidFP | benar | belum dilabel | P / R / F1 buang-FP |
|---|---|---|---|---|---|---|---|
| anthropic | tanpa ekstensi | 3.0 | 1.0 | 1.0 | 7.0 | 11.0 | 0.750 / 0.750 / 0.750 |
| anthropic | dengan ekstensi | 5.0 | 1.0 | 1.0 | 10.0 | 6.0 | 0.833 / 0.833 / 0.833 |
| google | tanpa ekstensi | 3.7 | 0.3 | 0.7 | 7.3 | 11.0 | 0.850 / 0.917 / 0.880 |
| google | dengan ekstensi | 5.7 | 0.3 | 2.3 | 8.7 | 6.0 | 0.708 / 0.944 / 0.810 |
| openai | tanpa ekstensi | 4.0 | 0.0 | 1.0 | 7.0 | 11.0 | 0.800 / 1.000 / 0.889 |
| openai | dengan ekstensi | 6.0 | 0.0 | 1.0 | 10.0 | 6.0 | 0.857 / 1.000 / 0.923 |

## Skor B lengan uji, tanpa dan dengan ekstensi

Penilai tidak punya jalur skor B dengan ekstensi (label manual hanya memengaruhi kategori verifikasi), jadi dihitung di sini dari alert yang dipertahankan per run, tanpa mengubah GT. Dengan ekstensi: CQL-14,15,16 yang dipertahankan berpindah dari FP ke TP (recall tetap terhadap 9 item GT); CQL-02,03 tetap FP. Enam alert ragu ditampilkan dua cara: tetap FP, atau dikeluarkan dari hitungan.

| Vendor | F1 tanpa ekstensi | P / R / F1 (ragu tetap FP) | P / R / F1 (ragu dikeluarkan) | ekstensi nyata dipertahankan per run | ragu dipertahankan per run |
|---|---|---|---|---|---|
| anthropic | 0.586 | 0.600 / 0.889 / 0.717 | 0.893 / 0.889 / 0.891 | 3,3,3 | 6,6,6 |
| google | 0.487 | 0.548 / 0.556 / 0.551 | 0.831 / 0.556 / 0.665 | 2,1,1 | 5,3,4 |
| openai | 0.523 | 0.544 / 0.815 / 0.652 | 0.796 / 0.815 / 0.804 | 3,3,3 | 6,6,6 |

## Alert di luar GT yang dipertahankan pada skor B lengan uji (kejadian dari 9 = 3 vendor × 3 run)

| Alert | Aturan | Dipertahankan | Triase |
|---|---|---|---|
| CQL-10 | js/missing-rate-limiting | 8 | ragu |
| CQL-11 | js/missing-rate-limiting | 6 | ragu |
| CQL-12 | js/missing-rate-limiting | 8 | ragu |
| CQL-13 | js/missing-rate-limiting | 9 | ragu |
| CQL-14 | js/missing-rate-limiting | 9 | nyata |
| CQL-15 | js/missing-rate-limiting | 6 | nyata |
| CQL-16 | js/missing-rate-limiting | 7 | nyata |
| CQL-17 | js/missing-rate-limiting | 9 | ragu |
| CQL-18 | js/missing-rate-limiting | 8 | ragu |

Total kejadian: 70; 70 (100%) adalah js/missing-rate-limiting.

