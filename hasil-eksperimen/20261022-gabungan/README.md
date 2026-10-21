# Batch gabungan resmi, prompt v2

Berkas ini ditulis dan di-commit sebelum run pertama batch ini dijalankan, sehingga aturan kegagalan dan keputusan penilaian di bawah ditetapkan sebelum hasilnya terlihat.

Tujuan batch ini: menilai **mode gabungan suara terbanyak** secara resmi. Angka gabungan yang ada di
`hasil-eksperimen/20261019/skor-utama.json` bukan suara terbanyak melainkan union antar model, dan
di sana memang ditandai `eksploratif_gabungan_model` dengan catatan "Eksploratif, terpisah dari
hasil utama". Mode gabungan yang benar-benar berjalan di pipeline memakai `SUARA_MINIMUM = 2` dengan
`tidak_sepakat` yang dipertahankan, dan itu belum pernah diukur.

Batch ini **tidak mengganti** angka eksperimen utama 19 Oktober 2026. Ia dilaporkan sebagai batch
kedua yang berdiri sendiri.

---

## 1. Konfigurasi

### Objek uji

| Butir | Nilai |
|---|---|
| Branch | `eksperimen/seeded` |
| Worktree yang dipakai | `../objek-seeded` |
| Commit worktree | `27613a896b9dbbda5c2cce812118ac153040f384` |
| Hash tree `src/` | `ef5ff340dcb93e8153e52262bb79b64ea031e3cd` |
| Blob `SEEDED.md` | `8c8061a41fe1a5f78b08435d6ee286c7e4cdc9a3` |

Commit worktree **berbeda** dengan commit eksperimen utama (`97cfb00349e7d3ff40b04834e97a95339902cf65`),
dan itu tidak jadi soal: gerbang objek uji membandingkan hash tree `src/`, bukan commit. Keduanya
`ef5ff340…`. Blob `SEEDED.md` juga identik, sehingga laporan skor akan mencatat
`ground_truth_seeded.revisi: false` dan `--ground-truth-revisi` tidak diperlukan.

### Laporan Sonar beku

Tidak disalin ke folder batch ini. Dirujuk langsung dari batch 19 Oktober supaya tidak ada dua
salinan yang bisa menyimpang.

| Butir | Nilai |
|---|---|
| Berkas | `hasil-eksperimen/20261019/sonar-beku.json` |
| SHA-256 berkas | `14946edae5803799e02ec3c939afe6777ec58b50f432ada9eac6297fe62bdfb6` |
| `sha256_isi` | `9154f2a23d57427c500f8bf8976a5c792bb7a720d826358a71e12c321545ef1b` |
| Revisi analisis | `467775e44fae16317a8c7c0098245153625978b8` |
| Tanggal analisis | `2026-10-10T10:58:15+0000` |
| Hash tree `src/` saat analisis | `ef5ff340dcb93e8153e52262bb79b64ea031e3cd` |
| Proyek Sonar | `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`, branch `main` |
| Isi | 26 issue, 0 hotspot, 5 alert keamanan (`SONAR-01` sampai `SONAR-05`) |
| Sumber di semua panggilan | `sumber_sonar: "beku"` |

### Hash yang harus cocok dengan batch 19 Oktober

Diverifikasi di Tahap 1 lewat run kering, sebelum satu sen pun dibelanjakan.

| Butir | Nilai |
|---|---|
| `prompt_system_kanonik` | `bb687afc7f13696bf922240f0923c7266aa3f28fd645971bf9d392733e19c7fa` |
| `prompt_user_kanonik` deteksi | `568d6cbaa989f393a995306376ca6d507884265226f414338fb0093e9990906c` |
| `hash_kode_sumber` | `76af7969bb095b8cddc350136eb90c63ee1f801b3336907d26423f0139b62c2b`, 43 berkas |
| `hash_laporan_sonar` | `52be3d215c2c0d5850d08c7f7f238d4079ea0594610586003e877cf850e3a48e` |
| Berkas prompt | `prompts/v2/`, 8 berkas, cocok dengan `HASHES.txt` |

Hash prompt verifikasi per alert pada batch 19 Oktober, untuk dicocokkan kalau diperlukan:
`SONAR-01` `41651564…`, `SONAR-02` `313b3f9c…`, `SONAR-03` `80cc89b4…`, `SONAR-04` `2c3a98c0…`,
`SONAR-05` `1e544466…`.

### Pengaturan panggilan

Identik dengan batch 19 Oktober, dan bukan karena disalin melainkan karena nilainya konstanta modul
yang tidak bisa diubah lewat argumen.

| Butir | Nilai |
|---|---|
| Sampling | bawaan vendor |
| Tingkat thinking | `high` |
| Batas output | 64000 token |
| Tools | `none` |
| Fallback | `none` |
| Timeout koneksi | 1200000 ms (20 menit) |

### Versi SDK

Diperiksa pada 22 Oktober 2026 dan **identik** dengan batch 19 Oktober.

| Butir | Versi |
|---|---|
| Node | `v25.2.1` |
| `@anthropic-ai/sdk` | `0.135.0` |
| `openai` | `7.39.0` |
| `undici` | `7.30.1` |
| Gemini | REST `v1beta streamGenerateContent` (SSE) lewat fetch undici, tanpa SDK |

### Kode alat

| Butir | Batch 19 Okt | Batch ini |
|---|---|---|
| Commit | `353634a6b3e52ca31a1ea02284b8825a06969a71` | `515dcbf54cb295afbb2141f81a60a888f9346b7a` |
| Branch | `feat/prompt-v2` | `feat/prompt-v2` |
| Bersih dalam lingkup | ya | wajib ya, kalau tidak run ditolak |

Perbedaan commit kode alat adalah satu-satunya pembeda yang dapat dikendalikan, dan ia **tidak
menyentuh jalur panggilan**. Commit di antara keduanya hanya menambah metadata (`tanda`,
`deteksi_kosong`, `thinking_token`), penilai gabungan yang terpisah, dashboard, dan workflow.
Fungsi perakit prompt (`scripts/llm/render.js`), pemanggil (`scripts/llm/panggil.js`), adapter, dan
`scripts/llm/vendor.js` tidak berubah. Buktinya adalah ketiga hash di atas, yang harus cocok di
Tahap 1.

### Model

| Vendor | Model diminta |
|---|---|
| google | `gemini-3.1-pro-preview` |
| anthropic | `claude-sonnet-5-5` |
| openai | `gpt-6.1-sol` |

`model_menjawab` dicatat di tiap panggilan. Kalau vendor mengganti bobot di balik nama model yang
sama, batch ini tidak bisa mendeteksinya, dan itu dicatat sebagai keterbatasan.

---

## 2. Rancangan dan urutan run

3 vendor x 3 run, kondisi `utama`, skenario B. Satu run = 1 panggilan deteksi + 5 panggilan
verifikasi = 6 panggilan. Total 54 panggilan, sama dengan batch 19 Oktober.

Putaran berselang-seling antar vendor, mengikuti batch 19 Oktober, supaya efek waktu tidak hanya
mengenai satu vendor.

| Putaran | Urutan |
|---|---|
| 1 | anthropic, openai, google |
| 2 | anthropic, openai, google |
| 3 | anthropic, openai, google |

Tabel waktu mulai sebenarnya diisi setelah run, satu baris per run, sejajar dengan bagian 2 README
batch 19 Oktober.

| Waktu mulai (UTC) | Model | Run | Jumlah temuan deteksi | Token thinking deteksi | `deteksi_kosong` |
|---|---|---|---|---|---|
| (diisi) | | | | | |

Kolom token thinking dan `deteksi_kosong` baru ada di batch ini. Keduanya dicatat karena di repo
demo Gemini pernah menjawab `{"temuan": []}` dengan `finishReason: STOP` dan `parse_ok: true`
setelah berpikir hanya 258 token, dan tidak ada satu pun field yang membedakannya dari analisis
sungguhan yang kebetulan bersih.

---

## 3. Aturan kegagalan, ditetapkan sebelum run

### Aturan A, kegagalan panggilan

| Keadaan | Perlakuan |
|---|---|
| Timeout, 5xx, atau 429 yang pulih setelah diulang | Dicatat apa adanya di `percobaan_gagal`. Run tetap dipakai. |
| 429 karena batas belanja akun | Run dibuang, foldernya disimpan di `gagal/`, run diulang di folder baru. Preseden dan alasannya sama dengan bagian 3 README batch 19 Oktober: kegagalan berasal dari batas akun, bukan dari perilaku model. |
| `refusal`, `truncated`, atau `parse_ok: false` | Dicatat apa adanya, **tidak diulang**. Ini perilaku model dan merupakan data. Jumlahnya dilaporkan per vendor. |
| 400 atau 4xx lain | Run dibuang, sebabnya diperbaiki, lalu **seluruh tiga run vendor itu** diulang dari awal, karena perbaikan kode mengubah `commit_kode` dan karenanya `sidik_run`. |

### Aturan B, `deteksi_kosong`

> Deteksi yang menjawab `{"temuan": []}` dengan `status: ok` dan `parse_ok: true` **dicatat apa
> adanya dan TIDAK diulang.**

Nol temuan adalah jawaban yang sah menurut prompt deteksi ("It is acceptable to report none"), dan
mengulang hanya run yang hasilnya tidak disukai adalah memilih hasil. Sebagai gantinya:

- `thinking_token.deteksi` dan `status_panggilan.deteksi_kosong` dilaporkan di tabel batch.
- Kalau muncul, dicatat di bagian tersendiri beserta angka thinking-nya.
- Run itu tetap masuk penggabungan dan penilaian. Vendor yang menjawab kosong hanya kehilangan suara
  di klaster temuan, dan itu memang artinya.

### Aturan C, satu vendor gagal total pada satu indeks run

> Gabungan run itu **memakai vendor yang tersisa**, dan jumlah vendornya dicatat di tabel hasil
> (`vendor_dipakai`).

Konsekuensi yang disebut eksplisit: dengan dua vendor, ambang dua suara berarti kesepakatan penuh
diperlukan, dan dua vendor yang berbeda pendapat menghasilkan seri lalu `tidak_sepakat` lalu alert
dipertahankan. Gabungan dua vendor karena itu **lebih konservatif** daripada tiga vendor, dan
angkanya tidak dirata-ratakan begitu saja dengan run bervendor tiga.

### Aturan D, batas pengulangan

> Maksimal **satu** pengulangan per vendor untuk seluruh batch, dan hanya untuk sebab di Aturan A
> baris 2 dan baris 4. Kalau batasnya terlampaui, batch dihentikan dan dilaporkan apa adanya.

---

## 4. Keputusan penilaian, ditetapkan sebelum run

Ketiganya memengaruhi angka, jadi ditetapkan sekarang, bukan setelah melihat hasil. Ketiganya juga
dicatat ulang di dalam `skor-gabungan.json` pada blok `keputusan_penilaian`.

### D1. Rekonstruksi penjelasan temuan gabungan

> Penjelasan diambil dari `penjelasan_vendor` milik **vendor wakil klaster**, yaitu
> `vendor_penemu[0]`, vendor yang lokasinya dipakai. **Bukan** gabungan teks semua vendor. Kalau
> penjelasan vendor wakil kosong, dibiarkan kosong, tidak diambil dari vendor lain.

Sebabnya: penggabung menyetel `penjelasan` menjadi `null` dan memindahkan teks tiap vendor ke
`penjelasan_vendor`, sedangkan pencocokan ke ground truth memakai teks `jenis + penjelasan` untuk
mencari sebutan nama fungsi. Tanpa rekonstruksi, setiap temuan gabungan kehilangan sinyal lokasi
berbasis teks dan angkanya turun karena alasan teknis, bukan karena mutunya. Dengan gabungan teks
tiga vendor, sebaliknya, mode gabungan mendapat lebih banyak kesempatan cocok daripada mode tunggal,
dan perbandingannya menjadi tidak adil. Memakai vendor wakil saja membuat satu temuan gabungan
setara dengan satu temuan mode tunggal.

### D2. Perlakuan `tidak_sepakat` di empat kategori verifikasi

> `tidak_sepakat` dipetakan ke `uncertain`, karena keduanya berarti hal yang sama di sisi keputusan:
> alert tidak dibuang. Jumlah `tidak_sepakat` dilaporkan sebagai kolom tersendiri, begitu pula alert
> yang tidak punya satu pun putusan vendor yang sah (`alert_tanpa_putusan_vendor`).

Pemetaan ini dipilih supaya definisi keempat kategori tetap satu dan diambil dari
`scripts/llm/score.js`, bukan ditulis ulang. Tanpa pemetaan, alert `tidak_sepakat` jatuh ke
`tanpa_hasil` dan keempat kategori mengecil secara menyesatkan.

### D3. Temuan yang belum ditriase

> Temuan berstatus "di luar ground truth" yang belum ditriase **tetap dihitung FP**, dan
> `belum_ditriase` dilaporkan apa adanya.

Ini perilaku bawaan `metrikSetelahTriase` dan sama dengan batch 19 Oktober, yang mencatat
`belum_ditriase: 0` di semua run.

### Catatan triase

`triase-manual.json` batch 19 Oktober **tidak** bisa dipakai apa adanya. Berkas itu berkunci
`vendor -> run-N.json -> indeks temuan`, dan validasinya memeriksa bahwa lokasi tiap entri sama
persis dengan temuan pada indeks itu. Run baru menghasilkan indeks yang berbeda, dan temuan
gabungan diindeks ulang lagi setelah klasterisasi.

Yang dilakukan: buat `triase-gabungan.json` baru berkunci indeks temuan di berkas gabungan tiap run.
**Dasar triasenya boleh disalin** dari batch 19 Oktober, karena dasarnya adalah hasil PoC yang
menguji kode, bukan menguji run. Ketiga PoC itu dijalankan pada objek uji yang sama (`97cfb00`,
tree `src/` `ef5ff34`) dan hasilnya tetap berlaku.

---

## 5. Hubungan dengan batch 19 Oktober

Run per vendor di batch ini sekaligus menjadi **replikasi kedua mode tunggal**. Keduanya dilaporkan
**terpisah**, dan angka batch 19 Oktober tidak diganti maupun dirata-ratakan bersama batch ini.

Alasannya:

1. Angka 19 Oktober sudah terkunci tes lewat `tests/fixtures/acuan-skor-20261019.json` beserta
   provenance, dan dilintas-periksa terhadap sumbernya.
2. Dashboard menampilkan angka itu lewat fixture `dashboard/fixtures/v2/eksperimen/seeded/*.json`.
3. Kondisi runnya tidak identik: commit kode alat berbeda, tanggal berbeda, keadaan cache vendor
   berbeda. Merata-ratakan 3 run lama dengan 3 run baru menjadikan "6 run" yang sebenarnya dua
   populasi, dan variasi antar-batch tersamar sebagai variasi antar-run.

Batch ini justru bernilai sebagai **uji stabilitas antar-waktu**, dan itu pertanyaan yang sah,
apalagi setelah kejadian `deteksi_kosong` di repo demo.

---

## 6. Perkiraan biaya

Dihitung dari `biaya_usd` per run di `hasil-eksperimen/20261019/utama/*/summary.json`.

| Vendor | Run 1 | Run 2 | Run 3 | Total | Rata-rata per run |
|---|---|---|---|---|---|
| google | 0,716812 | 0,834110 | 0,738422 | 2,289344 | 0,763 |
| anthropic | 0,373722 | 0,367662 | 0,369112 | 1,110496 | 0,370 |
| openai | 0,286326 | 0,174044 | 0,148914 | 0,609284 | 0,203 |
| **Total** | 1,376860 | 1,375816 | 1,256448 | **4,009124** | 1,336 |

**Perkiraan batch ini: sekitar US$4,0, rentang wajar US$3,3 sampai US$4,8.** Dasar rentangnya bukan
tebakan: pada run CI repo demo dengan objek uji yang sama, satu run Gemini 6 panggilan tercatat
US$0,458 dan US$0,751, selisih sampai 40 persen, terutama karena jumlah token thinking dan cache
implisit.

Penggabungan dan penilaian tidak berbiaya; keduanya hanya membaca berkas. Kalau Aturan A memicu satu
pengulangan run Gemini, tambahkan sekitar US$0,76.

---

## 7. Langkah pelaksanaan

Semua perintah dijalankan dari `C:\repo\ssdlc-devops-akademik\TA-ssdlc-devops-akademik`.

### Tahap 0, persiapan, nol biaya

```bash
git status --short                      # harus bersih
git log --oneline -1                    # catat hash ini sebagai commit alat batch
npm run test:tanpa-server               # harus hijau
cd prompts/v2 && sha256sum -c HASHES.txt && cd ../..   # harus 8/8 OK
```

**Berhenti dan cek:** ketiganya hijau. Repo alat yang tidak bersih akan ditolak gerbang kode alat.

### Tahap 1, run kering, nol biaya

```bash
node scripts/llm-scan.js --vendor=google --kondisi=utama --skenario=B \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json --kering
```

Ulangi untuk `anthropic` dan `openai`.

**Berhenti dan cek empat hal terhadap bagian 1 di atas:** `prompt_user_kanonik` deteksi,
`hash kode_sumber`, `hash laporan Sonar`, dan commit kode alat yang bersih. Kalau satu pun hash tidak
cocok, **berhenti**: ada yang berubah di jalur panggilan dan perbandingan dengan batch 19 Oktober
tidak lagi sah.

### Tahap 2, kunci rencana

Pindahkan berkas ini ke `hasil-eksperimen/20261022-gabungan/README.md` di worktree
`../objek-seeded`, isi hash commit alat dari Tahap 0, lalu commit di branch `eksperimen/seeded`.
Jangan push dulu kalau belum perlu.

### Tahap 3, run, sekitar US$4

Putaran 1:

```bash
node scripts/llm-scan.js --vendor=anthropic --kondisi=utama --skenario=B --runs=3 --jalankan=1 \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json
node scripts/llm-scan.js --vendor=openai --kondisi=utama --skenario=B --runs=3 --jalankan=1 \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json
node scripts/llm-scan.js --vendor=google --kondisi=utama --skenario=B --runs=3 --jalankan=1 \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json
```

Putaran 2 dan 3, urutan vendor sama, ulangi blok ini dua kali:

```bash
node scripts/llm-scan.js --vendor=<v> --kondisi=utama --skenario=B \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --lanjut=llm-output/v2/<folder-vendor>
```

**Berhenti dan cek setelah tiap putaran:** `summary.json` tiap vendor, lihat `panggilan` dan apakah
ada `deteksi_kosong` pada blok `deteksi` tiap entri `runs`. Catat, jangan ulangi (Aturan B).

### Tahap 4, konversi dan gabungkan, nol biaya

Untuk `r` = 1, 2, 3:

```bash
for v in google anthropic openai; do
  mkdir -p ../arsip-gabungan/run-$r/$v
  node scripts/merge-results.js merge --v2 \
    --folder=llm-output/v2/<folder-$v> --run=$r --nomor=$r \
    --objek=../objek-seeded \
    --out=../arsip-gabungan/run-$r/$v/results.json
done

node scripts/llm-gabung.js --masuk=../arsip-gabungan/run-$r \
  --out=../arsip-gabungan/gabungan/run-$r.json
```

**Berhenti dan cek:** keluaran menyebut `vendor dipakai: google, anthropic, openai` dan jumlah
`tidak sepakat` untuk tiap run.

### Tahap 5, nilai, nol biaya

```bash
# Replikasi mode tunggal, memakai penilai yang sudah ada
node scripts/llm-score.js --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --out=<folder batch>/skor-tunggal.json \
  llm-output/v2/<folder-google> llm-output/v2/<folder-anthropic> llm-output/v2/<folder-openai>

# Mode gabungan, memakai penilai terpisah
node scripts/skor-gabungan.js --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --gabungan=../arsip-gabungan/gabungan \
  --out=<folder batch>/skor-gabungan.json \
  llm-output/v2/<folder-google> llm-output/v2/<folder-anthropic> llm-output/v2/<folder-openai>
```

**Berhenti dan cek:** kedua laporan memuat `ground_truth_seeded.revisi: false` dan
`aturan_hardening: "spesifikasi"`. Kalau `revisi: true`, `SEEDED.md` berubah dan angkanya tidak
sebanding.

### Tahap 6, triase, lalu nilai ulang

Buat `triase-gabungan.json`, salin `dasar` dari `20261019/triase-manual.json` untuk temuan yang sama,
dan triase temuan baru dengan Aturan D3. Lalu:

```bash
node scripts/skor-gabungan.js ... --triase=<folder batch>/triase-gabungan.json \
  --out=<folder batch>/skor-gabungan-triase.json
node scripts/skor-gabungan.js ... --triase=<folder batch>/triase-gabungan.json --triase-konservatif \
  --out=<folder batch>/skor-gabungan-triase-konservatif.json
```

---

## 8. Isi folder batch

```
hasil-eksperimen/20261022-gabungan/
  README.md                            berkas ini
  utama/
    google/                            salinan folder llm-output/v2/<...>-google-utama
    anthropic/
    openai/
  gagal/                               hanya bila ada run yang dibuang menurut Aturan A
  gabungan/
    run-1.json                         keluaran llm-gabung.js
    run-2.json
    run-3.json
    per-vendor/                        results.json skema 2 hasil konversi, per run per vendor
  skor-tunggal.json                    llm-score.js, replikasi mode tunggal
  skor-tunggal-triase.json             llm-score.js, triase varian utama
  skor-tunggal-triase-konservatif.json llm-score.js, triase varian konservatif
  skor-gabungan.json                   skor-gabungan.js, tanpa triase
  skor-gabungan-triase.json            varian utama
  skor-gabungan-triase-konservatif.json
  triase-gabungan.json
```

`sonar-beku.json` tidak disalin; dirujuk dari `20261019/` beserta `sha256_isi` yang tercatat di
bagian 1.

Folder `20261019/` tidak disentuh sama sekali.

---

## 9. Catatan metode gabungan

Suara terbanyak **hanya berlaku untuk putusan alert**, bukan untuk temuan deteksi. Dua bagian
hasil gabungan disusun dengan aturan yang berbeda, dan membaca keduanya seolah satu aturan akan
salah menafsirkan angkanya.

**Alert.** Putusan tiap alert Sonar ditentukan suara terbanyak dari putusan yang sah, dengan ambang
minimal dua suara sama. Bila ambang tidak tercapai atau terjadi seri, hasilnya `tidak_sepakat` dan
alert itu **dipertahankan**, bukan dibuang: ketidaksepakatan model bukan bukti alertnya tidak nyata.

**Temuan deteksi.** Temuan antar-vendor diklaster berdasarkan file, keluarga CWE, dan lokasi,
lalu **seluruh klaster masuk ke hasil tanpa ambang kesepakatan apa pun**. Temuan yang hanya
ditemukan satu vendor tetap masuk, sama seperti temuan yang ditemukan ketiganya; yang membedakan
hanya field `kesepakatan` dan `vendor_penemu` di tiap temuan.

Konsekuensinya untuk pembacaan hasil, dan ini perlu disebut di Bab 4: pada sisi temuan, mode
gabungan berperilaku seperti **union** bertanda, bukan seperti penyaring. False positive dari satu
vendor ikut terbawa ke hasil gabungan tanpa disaring suara, sehingga presisi gabungan dapat lebih
rendah daripada presisi vendor terbaiknya. Angka batch ini menunjukkan persis itu.

Satu hal lagi yang berpengaruh pada klasterisasi: aturan lokasi menuntut nama fungsi yang sama
persis bila kedua temuan melaporkannya. Dua vendor yang menyebut fungsi yang sama dengan konvensi
berbeda, misalnya `submit` dan `exports.submit`, karena itu **tidak** terklaster dan tercatat
sebagai dua temuan. Kejadiannya ada di batch ini, lihat `triase-gabungan.json` bagian
`catatan_klaster`.

---

## 10. Ralat

Dicatat setelah run, tidak mengubah satu pun angka yang sudah dihitung.

### R1. `thinking_token` Anthropic tercatat 0, bacalah sebagai "tidak tersedia"

Adapter Anthropic tidak melaporkan token thinking terpisah; `output_tokens` sudah mencakupnya,
sehingga adapter mencatat `thinking: null`. Penjumlahannya di `scripts/llm-scan.js` dan
`scripts/llm/results-v2.js` memakai `?? 0`, sehingga `thinking_token` untuk anthropic tercatat
**0**, bukan `null`. Nol di situ terbaca sebagai "model tidak berpikir", padahal artinya "vendor
tidak melaporkan".

Tidak ada angka skor yang terpengaruh: `thinking_token` hanya metadata dan tidak masuk perhitungan
mana pun. Perbaikan kodenya dikerjakan **setelah** seluruh skor final batch ini selesai, supaya
commit kode alat tetap sama di seluruh batch.

### R2. Tahap 4 memerlukan `mkdir -p` lebih dulu

`scripts/llm-gabung.js` menulis keluaran dengan `fs.writeFileSync` tanpa membuat direktorinya, jadi
`--out=../arsip-gabungan/gabungan/run-$r.json` gagal bila foldernya belum ada. Jalankan sekali
sebelum perulangan Tahap 4:

```bash
mkdir -p ../arsip-gabungan/gabungan
```

### R3. Urutan vendor di penggabung berasal dari konstanta, bukan dari isi direktori

`scripts/llm-gabung.js` menelusuri direktori untuk menemukan `results.json`, dan urutan
penelusuran itu memang alfabetis (anthropic, google, openai). Tetapi daftarnya disusun ulang dari
konstanta `VENDOR = ['google', 'anthropic', 'openai']` sebelum digabungkan, sehingga:

- **vendor wakil klaster adalah `google`** bila google ikut menemukan temuan itu, karena klaster
  disemai dari vendor pertama;
- **dasar daftar alert juga `google`**, dan vendor lain dicocokkan lewat `id`.

Urutannya tidak bisa berubah karena penamaan folder, dan terbukti sama di ketiga run batch ini.
Ini penting karena keputusan D1 mengambil penjelasan dari vendor wakil klaster.

### R4. Kategori OWASP S5 di berkas 10 Oktober memakai penomoran lama

`hasil-eksperimen/20261010/SKENARIO_SERANGAN.md:109` menulis S5 sebagai **"CWE-79 | A03"**, yaitu
penomoran OWASP Top 10 **2021**. `SEEDED.md:22` menulis S5 sebagai **A05**, yaitu Injection pada
OWASP Top 10 **2025**, dan itulah yang berlaku untuk seluruh eksperimen prompt v2.

Berkas 10 Oktober **tidak diubah**: ia arsip sesi lama dan nilainya justru sebagai rekaman apa
adanya. Ralat ini hanya menegaskan bahwa yang dipakai sebagai ground truth adalah `SEEDED.md`.

Tidak ada angka yang terpengaruh: kategori OWASP tidak ikut dalam pencocokan temuan ke ground
truth, yang hanya memakai file, lokasi, dan keluarga CWE.
