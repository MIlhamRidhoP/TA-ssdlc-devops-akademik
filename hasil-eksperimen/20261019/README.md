# Eksperimen utama prompt v2, 19 Oktober 2026

Kondisi `utama`: satu panggilan deteksi tanpa laporan Sonar dan satu panggilan verifikasi per alert Sonar, untuk tiga model dengan tiga run masing-masing. Laporan Sonar dibekukan sebelum eksperimen dan sama di semua panggilan. Dokumen ini mencatat konfigurasi, urutan run, aturan scoring, hasil PoC, dan triase manual. Angka skor ada di file `skor-*.json` (lihat bagian 7).

Satu run = 1 panggilan deteksi + 5 panggilan verifikasi (satu per alert) = 6 panggilan. Tiga model x tiga run = 54 panggilan.

## 1. Konfigurasi

| Butir | Nilai |
|---|---|
| Model diminta | `gemini-3.1-pro-preview`, `claude-sonnet-5-5`, `gpt-6.1-sol` |
| Model menjawab | Sama dengan model yang diminta di semua 54 panggilan (`model_menjawab` == `model_diminta`) |
| Kode alat | `feat/prompt-v2` di `353634a6b3e52ca31a1ea02284b8825a06969a71`, `bersih: true`, `berubah: []` |
| Lingkup kebersihan kode alat | `scripts`, `prompts`, `tests`, `package.json`, `package-lock.json`, `.github/workflows`, `.gitignore`, `src`, `docker-compose.yml`, `Dockerfile` |
| Objek uji | `eksperimen/seeded` di `97cfb00349e7d3ff40b04834e97a95339902cf65` |
| Hash tree `src/` objek uji | `ef5ff340dcb93e8153e52262bb79b64ea031e3cd` |
| Hash blob `SEEDED.md` | `8c8061a41fe1a5f78b08435d6ee286c7e4cdc9a3` (sama di `97cfb00` dan di HEAD branch ini; scoring mencatat `revisi: false`) |
| Hash kode sumber yang dikirim | `76af7969bb095b8cddc350136eb90c63ee1f801b3336907d26423f0139b62c2b`, 43 file |
| Prompt | `prompts/v2/`, 8 file yang terdaftar di `HASHES.txt` cocok dengan hash yang tercatat di sana |
| Hash prompt deteksi | `prompt_user_kanonik` = `568d6cbaa989f393a995306376ca6d507884265226f414338fb0093e9990906c`, sama di 9 run |

### Laporan Sonar beku

| Butir | Nilai |
|---|---|
| File | `hasil-eksperimen/20261019/sonar-beku.json` |
| SHA-256 file | `14946edae5803799e02ec3c939afe6777ec58b50f432ada9eac6297fe62bdfb6` |
| `sha256_isi` | `9154f2a23d57427c500f8bf8976a5c792bb7a720d826358a71e12c321545ef1b` |
| Hash laporan yang dikirim | `52be3d215c2c0d5850d08c7f7f238d4079ea0594610586003e877cf850e3a48e` |
| Revisi analisis | `467775e44fae16317a8c7c0098245153625978b8` |
| Tanggal analisis | `2026-10-10T10:58:15+0000`, file beku dibuat `2026-10-19T11:58:38.644Z` |
| Hash tree `src/` saat analisis | `ef5ff340dcb93e8153e52262bb79b64ea031e3cd` (sama dengan objek uji) |
| Proyek Sonar | `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`, branch `main` |
| Isi | 26 issue, 0 hotspot, 5 alert keamanan (`SONAR-01` sampai `SONAR-05`) |
| Sumber di semua panggilan | `sumber_sonar: "beku"` |

### Pengaturan panggilan

| Butir | Nilai |
|---|---|
| Sampling | bawaan vendor |
| Tingkat thinking | `high` |
| Batas output | 64000 token |
| Tools | `none` |
| Fallback | `none` |
| Timeout koneksi | `timeout_sdk_ms`, `headers_timeout_ms`, `body_timeout_ms` = 1200000 (20 menit) |
| Parameter vendor (Gemini) | `generationConfig.thinkingConfig.thinkingLevel`, `generationConfig.responseFormat.text`, transport `streamGenerateContent?alt=sse` |
| Parameter vendor (Claude) | `output_config.effort`, `output_config.format` |
| Parameter vendor (GPT) | `reasoning.effort`, `text.format`, cache `prompt_cache_breakpoint` (eksplisit) + implisit, transport `responses.stream` |

### Versi SDK

| Butir | Versi |
|---|---|
| Node | `v25.2.1` |
| `@anthropic-ai/sdk` | `0.135.0` |
| `openai` | `7.39.0` |
| `undici` (fetch) | `7.30.1` |
| Gemini | REST `v1beta streamGenerateContent` (SSE) lewat fetch undici, tanpa SDK |

### Status panggilan

54 dari 54 panggilan (9 deteksi, 45 verifikasi) berstatus `ok`, `parse_ok: true`, dan selesai dalam satu percobaan. Per model: 3 deteksi dan 15 verifikasi, dengan 0 refusal, 0 truncated, 0 error, 0 `parse_ok: false`.

## 2. Urutan run

Putaran berselang-seling antar vendor. Gemini putaran 1 diulang di folder baru setelah batas belanja akun dinaikkan (lihat bagian 3), lalu putaran 2 dan 3 berjalan berselang-seling untuk ketiga model.

| Waktu mulai (UTC) | Model | Run | Jumlah temuan deteksi |
|---|---|---|---|
| 2026-10-19 12:53:28 | Claude | 1 | 14 |
| 2026-10-19 12:54:37 | GPT | 1 | 14 |
| 2026-10-19 13:02:41 | Gemini | 1 | 7 |
| 2026-10-19 13:08:23 | Gemini | 2 | 7 |
| 2026-10-19 13:14:05 | Claude | 2 | 13 |
| 2026-10-19 13:15:05 | GPT | 2 | 14 |
| 2026-10-19 13:21:30 | Gemini | 3 | 7 |
| 2026-10-19 13:25:15 | Claude | 3 | 13 |
| 2026-10-19 13:26:21 | GPT | 3 | 13 |

## 3. Run gagal yang tidak dipakai: `gagal/google-429-spending-cap/`

Gemini putaran 1 yang pertama, berjalan `2026-10-19T12:35:31.523Z` sampai `2026-10-19T12:53:26.596Z`.

| Panggilan | Status | Percobaan | Percobaan gagal | Biaya (US$) |
|---|---|---|---|---|
| deteksi | `ok` | 1 | 0 | 0,385456 |
| SONAR-01 | `ok` | 1 | 0 | 0,107276 |
| SONAR-02 | `ok` | 1 | 0 | 0,096678 |
| SONAR-03 | `error` | 3 | 3 | 0 |
| SONAR-04 | `error` | 3 | 3 | 0 |
| SONAR-05 | `error` | 3 | 3 | 0 |

Total 3 panggilan `ok` dan 3 panggilan `error`, dengan 9 percobaan HTTP 429. Pesan galat: *"Your project has exceeded its monthly spending cap."* Biaya tercatat US$0,58941 (dari panggilan `ok`). Usage percobaan 429 tidak tercatat.

Alasan dikeluarkan dari analisis: kegagalan berasal dari batas belanja akun, bukan dari perilaku model. Aturan pengulangan (README prompt v2 bagian 8) mengulang 429 dua kali, sehingga tercatat 3 percobaan per panggilan; untuk 429 karena batas belanja, pengulangan itu tidak dapat berhasil. Aturan ini tidak diubah selama eksperimen agar commit kode alat tetap sama di semua run. Folder tetap disimpan tetapi tidak disertakan dalam scoring mana pun.

## 4. Aturan scoring

### Ground truth

`SEEDED.md` memuat 19 item: 9 `terbukti` (S1, S3, S4, S7, S8, S9, S10, S11, S12), 2 `jebakan fp` (S2, S5), 1 `laten` (S6), dan 7 `bawaan` (B1 sampai B6, N1). Recall dihitung terhadap 9 item `terbukti`.

Skenario A menilai alert SonarCloud saja; Skenario B menilai gabungan alert yang tidak diputuskan `false_positive` oleh LLM dengan temuan deteksi LLM; Skenario C menilai temuan deteksi LLM saja. Ketiganya dinilai terhadap `SEEDED.md` lewat pencocokan CWE dan lokasi.

### Aturan hardening

Analisis utama memakai aturan spesifikasi (`IMPLEMENTASI-PROMPT-V2.md` langkah 7): temuan dengan `sifat: hardening` tidak dihitung FP ketat, termasuk yang cocok dengan jebakan dan N1; TP tetap dihitung apa pun `sifat`-nya. File `skor-utama.json` mencatat `aturan_hardening: "spesifikasi"`.

Lampiran `skor-utama-aturan-lama.json` memuat skor dengan aturan sebelumnya (file itu tidak memuat field `aturan_hardening`). Selisih antara kedua aturan hanya pada Claude Skenario C: FP ketat run 1 dari 2 menjadi 1, dan run 3 dari 1 menjadi 0. Skenario B Claude dan seluruh skor Gemini dan GPT sama di kedua aturan.

### Label alert SONAR-03

Analisis utama memakai label otomatis dari ground truth: `SONAR-01` `nyata`, `SONAR-02` `fp`, `SONAR-03` `fp`, `SONAR-04` `fp`, `SONAR-05` `nyata`, semuanya bersumber `otomatis`.

Lampiran `skor-sensitivitas-sonar03.json` memaksa `SONAR-03` menjadi `nyata` lewat `label-alert-sensitivitas.json` (`sumber: "paksa"`, laporan menandai `sensitivitas: true`). `SEEDED.md` tidak diubah. Label alert hanya memengaruhi metrik verifikasi empat kategori, bukan Skenario A, B, atau C. Selisihnya, dengan urutan angka identified_fp / missed_fp / misidentified_fp / correct_retention:

| Model | Verifikasi, label utama (`SONAR-03` = `fp`) | Verifikasi, sensitivitas (`SONAR-03` = `nyata`) |
|---|---|---|
| Gemini | 3 / 0 / 0 / 2 di ketiga run | 2 / 0 / 1 / 2 di ketiga run |
| Claude | run 1 dan 2: 1 / 2 / 1 / 1; run 3: 2 / 1 / 1 / 1 | run 1 dan 2: 1 / 1 / 1 / 2; run 3: 2 / 0 / 1 / 2 |
| GPT | 3 / 0 / 1 / 1 di ketiga run | 2 / 0 / 2 / 1 di ketiga run |

PoC `scripts/poc/sonar03-union-khs.sh` tidak membuktikan rangkaian S3 -> S4 (lihat bagian 5).

### Triase temuan di luar ground truth

Temuan LLM berstatus `di luar ground truth` atau `perlu cek manual` ditriase manual ke lima kategori. Dua varian dilaporkan:

| Kategori | Varian utama | Varian konservatif |
|---|---|---|
| `fp` | dihitung FP | dihitung FP |
| `teoretis` | tidak dihitung FP | dihitung FP |
| `tp_di_luar_seeded` | tidak dihitung FP | tidak dihitung FP |
| `informasional` | tidak dihitung FP | tidak dihitung FP |
| `duplikat` | tidak dihitung FP | tidak dihitung FP |
| belum ditriase, status `di luar ground truth` | dihitung FP | dihitung FP |

Tidak ada kategori yang menambah TP. TP dan recall setelah triase sama dengan TP dan recall ketat; yang berubah hanya FP, precision, dan F1. FP ketat (tanpa triase) tetap dilaporkan berdampingan di setiap run di dalam field `ketat`, sedangkan hasil triase ada di field `setelah_triase` beserta `varian`, `rincian_triase`, dan `belum_ditriase`. Pada eksperimen ini `belum_ditriase` bernilai 0 di semua run.

Varian utama ada di `skor-setelah-triase.json` (`triase_varian: "utama"`), varian konservatif di `skor-setelah-triase-konservatif.json` (`triase_varian: "konservatif"`).

## 5. PoC verifikasi label

Ketiga PoC dijalankan di container lokal dengan data seed sintetis, pada objek uji `eksperimen/seeded` di `97cfb00` (tree `src/` `ef5ff34`). Tidak ada panggilan LLM di dalam PoC. Skrip ada di `scripts/poc/` pada branch ini.

| PoC | Tujuan | Kriteria lolos | Hasil |
|---|---|---|---|
| `s2-sqli-order-cuti.sh` | Menguji apakah S2 (`ORDER BY` di list cuti admin, `GET /api/cuti?sort=&order=`) dapat dieksploitasi; sink teoretis `src/models/cutiModel.js` `listAdmin()` dengan `ORDER BY` dari parameter | Payload SQLi pada `sort`/`order` tidak ditolak, yaitu dieksekusi di `ORDER BY` alih-alih dibalas 400 | Tidak dapat dieksploitasi. Baseline `sort=nim&order=desc` HTTP 200; 6 dari 6 payload dibalas HTTP 400 oleh `listQuery` (allowlist `model.SORT`, `asc`/`desc`) sebelum menyentuh `ORDER BY`. Keluaran: `poc/s2-sqli-order-cuti.txt` |
| `sonar03-union-khs.sh` | Menguji hipotesis rangkaian S3 -> S4: UNION injection di parameter `semester` endpoint KHS untuk menaruh HTML penanda ke kolom `i.nama` yang dirender tanpa escape | String `<b>POC_MARKER_7f3a</b>` muncul mentah (tanpa escape) di dalam `<td>` respons | Tidak terbukti. Payload A dan B dibalas `INTERNAL_ERROR` dan penanda tidak muncul. Query diakhiri `ORDER BY mk.kode` (kolom berkualifikasi) yang tidak valid setelah UNION. Keluaran: `poc/sonar03-union-khs.txt` |
| `toctou-krs.sh` | Menguji race antara `addItem` (cek status draft lalu INSERT) dan `submit` (baca item, cek kuota, transisi draft ke submitted), tanpa penguncian atau transaksi yang menyatukan pembacaan dan mutasi | KRS berstatus `submitted` dengan `total_sks` melebihi kuota (16 > 15) | Terbukti. Dari 30 percobaan, 1 percobaan menghasilkan KRS `submitted` dengan `total_sks` 16 melebihi kuota 15. Keluaran: `poc/toctou-krs.txt` |

Catatan non-determinisme TOCTOU: laju menang race bergantung pada penjadwalan proses dan beban mesin. Run yang keluarannya tersimpan menghasilkan 1 dari 30 percobaan menang. Ada run sebelumnya pada objek dan container yang sama yang menghasilkan 5 dari 30 percobaan menang; keluaran run tersebut tidak disimpan. Kedua run memenuhi kriteria lolos; yang berbeda hanya frekuensinya. Angka laju menang tidak dibaca sebagai probabilitas tetap. PoC tidak dijalankan ulang setelah keluaran 1 dari 30 disimpan.

## 6. Triase manual

13 temuan ditriase. Kolom Run dan Idx menunjuk `run-N.json` dan indeks temuan di dalamnya, sesuai kunci di `triase-manual.json`.

| # | Model | Run | Idx | Lokasi | CWE | Kategori | Dasar |
|---|---|---|---|---|---|---|---|
| 1 | Gemini | 2 | 5 | `src/controllers/krsController.js:110` | CWE-367 | `tp_di_luar_seeded` | PoC toctou-krs.sh: KRS `submitted` dengan total_sks 16 > kuota 15 |
| 2 | GPT | 1 | 2 | `src/controllers/krsController.js:110` | CWE-367 | `tp_di_luar_seeded` | PoC toctou-krs.sh: KRS `submitted` dengan total_sks 16 > kuota 15 |
| 3 | GPT | 2 | 4 | `src/controllers/krsController.js:110` | CWE-367 | `tp_di_luar_seeded` | PoC toctou-krs.sh: KRS `submitted` dengan total_sks 16 > kuota 15 |
| 4 | GPT | 3 | 1 | `src/controllers/krsController.js:110` | CWE-367 | `tp_di_luar_seeded` | PoC toctou-krs.sh: KRS `submitted` dengan total_sks 16 > kuota 15 |
| 5 | GPT | 1 | 6 | `src/models/krsModel.js:46` | CWE-367 | `teoretis` | Akar masalah sama dengan submit; efek yang diklaim tidak muncul dalam 30 percobaan PoC |
| 6 | GPT | 3 | 5 | `src/models/krsModel.js:46` | CWE-367 | `teoretis` | Akar masalah sama dengan submit; efek yang diklaim tidak muncul dalam 30 percobaan PoC |
| 7 | GPT | 1 | 7 | `src/models/krsModel.js:65` | CWE-367 | `teoretis` | Jalur `removeItem` tidak diuji di PoC toctou-krs.sh |
| 8 | GPT | 3 | 6 | `src/models/krsModel.js:65` | CWE-367 | `teoretis` | Jalur `removeItem` tidak diuji di PoC toctou-krs.sh |
| 9 | GPT | 2 | 2 | `src/controllers/krsController.js:70` | CWE-367 | `teoretis` | Akar masalah sama dengan submit; efek yang diklaim tidak muncul dalam 30 percobaan PoC |
| 10 | GPT | 2 | 3 | `src/controllers/krsController.js:87` | CWE-367 | `teoretis` | Jalur `removeItem` tidak diuji di PoC toctou-krs.sh |
| 11 | Claude | 1 | 11 | `src/controllers/cutiController.js:84` | CWE-20 | `fp` | PoC s2-sqli-order-cuti.sh: 6 dari 6 payload `sort`/`order` ditolak 400 oleh allowlist `listQuery` |
| 12 | Claude | 2 | 10 | `src/controllers/cutiController.js:84` | CWE-89 | `fp` | PoC s2-sqli-order-cuti.sh: 6 dari 6 payload `sort`/`order` ditolak 400 oleh allowlist `listQuery` |
| 13 | Claude | 2 | 6 | `src/profilModel.js:38` | CWE-639 | `fp` | Path `src/profilModel.js` tidak ada di objek uji, tidak dipetakan ke ground truth. Substansi temuan sama dengan S8 (IDOR `removeEmail`, `terbukti`); hanya path yang salah |

Rekap: 4 `tp_di_luar_seeded`, 6 `teoretis`, 3 `fp`. Tidak ada entri `informasional` atau `duplikat`, dan tidak ada kandidat yang dibiarkan belum ditriase.

## 7. Daftar file

### Hasil run

| File atau folder | Isi |
|---|---|
| `utama/google/` | 3 run Gemini (folder asal `llm-output/v2/20261019-200241-google-utama`) |
| `utama/anthropic/` | 3 run Claude (asal `20261019-195328-anthropic-utama`) |
| `utama/openai/` | 3 run GPT (asal `20261019-195437-openai-utama`) |
| `gagal/google-429-spending-cap/` | Run Gemini yang tidak dipakai dalam analisis (bagian 3) |
| `sonar-beku.json` | Laporan SonarCloud beku yang dipakai di semua panggilan |

Setiap folder run memuat `summary.json`, `run-N.json` (hasil terparsing), `run-N.raw.json` (respons mentah), `prompt-system.txt`, `prompt-user-deteksi.txt`, serta salinan laporan Sonar (`sonar-alert.json`, `sonar-issues.json`, `sonar-hotspots.json`, `sonar-ringkasan.json`).

### Skor: analisis utama

| File | Isi |
|---|---|
| `skor-utama.json` | Skor utama. Aturan hardening spesifikasi, label alert otomatis (`SONAR-03` = `fp`), tanpa triase |
| `skor-setelah-triase.json` | Skor setelah triase, varian utama (`teoretis` bukan FP) |
| `skor-setelah-triase-konservatif.json` | Skor setelah triase, varian konservatif (`teoretis` = FP) |
| `triase-manual.json` | Kategori dan dasar 13 temuan hasil triase (bagian 6) |

### Skor: lampiran

| File | Isi |
|---|---|
| `skor-utama-aturan-lama.json` | Skor dengan aturan hardening sebelumnya, untuk perbandingan |
| `skor-sensitivitas-sonar03.json` | Skor dengan `SONAR-03` dipaksa `nyata` (analisis sensitivitas) |
| `label-alert-sensitivitas.json` | Masukan label paksa untuk analisis sensitivitas di atas |

### PoC

| File | Isi |
|---|---|
| `poc/s2-sqli-order-cuti.txt` | Keluaran PoC S2 |
| `poc/sonar03-union-khs.txt` | Keluaran PoC rangkaian S3 -> S4 |
| `poc/toctou-krs.txt` | Keluaran PoC TOCTOU KRS, dengan catatan non-determinisme |

## 8. Biaya

Dari metadata usage yang dicatat tiap panggilan.

| Model | 3 run utama | Percobaan gagal di run utama | Run gagal yang tidak dipakai |
|---|---|---|---|
| Gemini | US$2,289344 | 0 | US$0,58941, ditambah 9 percobaan 429 yang usage-nya tidak tercatat |
| Claude | US$1,110496 | 0 | - |
| GPT | US$0,609284 | 0 | - |

Percobaan HTTP 429 pada run gagal ditolak sebelum diproses, sehingga tidak ada usage yang dikembalikan dan biayanya tidak dapat dihitung dari metadata. Pengecekan batas belanja sebelum Gemini diulang memakai satu panggilan minimal (14 token, sekitar US$0,0002) di luar folder run.

## 9. Reproduksi scoring

`scripts/llm-score.js` menolak worktree `--objek` yang belum bersih, mencocokkan hash tree `src/` setiap folder run dengan worktree `--objek`, dan membandingkan blob `SEEDED.md` di worktree dengan blob pada commit objek uji yang tercatat di folder run. Pada branch ini hash tree `src/` (`ef5ff34`) dan blob `SEEDED.md` (`8c8061a`) sama dengan nilai di `97cfb00`, sehingga scoring dapat dijalankan dari worktree branch ini tanpa `--ground-truth-revisi`.

Commit kode alat `353634a` adalah kode yang dipakai untuk menjalankan panggilan LLM (tercatat di `commit_kode` tiap run), bukan kode yang dipakai untuk scoring. Setiap file skor mencatat kode alat yang memproduksinya di field `commit_kode_scoring` (HEAD repo alat, branch, dan status bersih file dalam lingkup).

| File skor | Commit kode alat scoring |
|---|---|
| `skor-utama.json`, `skor-sensitivitas-sonar03.json`, `skor-setelah-triase.json`, `skor-setelah-triase-konservatif.json` | `10be9aac06e22e7d3e81d80322fa9bf924df402c` di `feat/prompt-v2`, file dalam lingkup bersih |
| `skor-utama-aturan-lama.json` | `d968d76`, memakai aturan hardening sebelumnya. File ini historis, tidak dibuat ulang, dan tidak memuat `commit_kode_scoring` |

Keempat file analisis dibuat ulang dari satu commit yang sama (`10be9aa`), dengan folder run dibaca dari salinan di `utama/`. Dibandingkan versi sebelumnya, tidak ada nilai metrik yang berubah; yang berbeda hanya `dinilai_pada`, `folder`, dan field yang memang baru di commit itu (`commit_kode_scoring`, `triase_varian`, `sensitivitas`, `setelah_triase.varian`, serta `label_awal` dan `alasan_paksa` pada `label_alert`).

Perintah di bawah dijalankan dari worktree objek uji yang bersih (direktori kerja = akar repo objek uji), dengan `<alat>` menunjuk worktree repo alat di `10be9aa`.

Skor utama:

```
node <alat>/scripts/llm-score.js --objek=. \
  --sonar-beku=hasil-eksperimen/20261019/sonar-beku.json \
  --out=hasil-eksperimen/20261019/skor-utama.json \
  hasil-eksperimen/20261019/utama/google \
  hasil-eksperimen/20261019/utama/anthropic \
  hasil-eksperimen/20261019/utama/openai
```

Analisis sensitivitas label `SONAR-03`:

```
node <alat>/scripts/llm-score.js --objek=. \
  --sonar-beku=hasil-eksperimen/20261019/sonar-beku.json \
  --label-alert-paksa=hasil-eksperimen/20261019/label-alert-sensitivitas.json \
  --out=hasil-eksperimen/20261019/skor-sensitivitas-sonar03.json \
  hasil-eksperimen/20261019/utama/google \
  hasil-eksperimen/20261019/utama/anthropic \
  hasil-eksperimen/20261019/utama/openai
```

Skor setelah triase, varian utama:

```
node <alat>/scripts/llm-score.js --objek=. \
  --sonar-beku=hasil-eksperimen/20261019/sonar-beku.json \
  --triase=hasil-eksperimen/20261019/triase-manual.json \
  --out=hasil-eksperimen/20261019/skor-setelah-triase.json \
  hasil-eksperimen/20261019/utama/google \
  hasil-eksperimen/20261019/utama/anthropic \
  hasil-eksperimen/20261019/utama/openai
```

Skor setelah triase, varian konservatif:

```
node <alat>/scripts/llm-score.js --objek=. \
  --sonar-beku=hasil-eksperimen/20261019/sonar-beku.json \
  --triase=hasil-eksperimen/20261019/triase-manual.json --triase-konservatif \
  --out=hasil-eksperimen/20261019/skor-setelah-triase-konservatif.json \
  hasil-eksperimen/20261019/utama/google \
  hasil-eksperimen/20261019/utama/anthropic \
  hasil-eksperimen/20261019/utama/openai
```

Karena `--out` menulis ke dalam worktree objek uji, keempat perintah di atas dijalankan satu per satu pada worktree yang bersih, atau dengan `--out` diarahkan ke luar worktree lalu hasilnya dipindahkan.
