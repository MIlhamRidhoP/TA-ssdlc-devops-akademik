# Artefak penelitian

Peta artefak untuk makalah ICICyTA 2026 dan cara memeriksa ulang angkanya. Repositori:
`MIlhamRidhoP/TA-ssdlc-devops-akademik`. Satu nama tag hanya bisa menunjuk satu commit, dan prompt
(di branch alat) tidak pernah berada di satu tree yang sama dengan data (di branch objek uji), jadi
tag acuan selalu berpasangan dua:

- **`icicyta2026-artefak-v2`**: ujung `eksperimen/seeded` — answer key, laporan beku SonarCloud dan
  CodeQL, JSON mentah kedua batch, skor dan tinjauan label (termasuk varian v2/v3 dan hasil
  normalisasi klaster), PoC lanjutan, dan berkas ini.
- **`icicyta2026-artefak-alat-v2`**: ujung `feat/sast-codeql` — prompt v2 **dan** v3, serta seluruh
  kode alat dan penilai (termasuk `skor-verifikasi-mayoritas.js` dan
  `skor-gabungan-normalisasi.js`).

**Tag draf sebelumnya, tetap sah sebagai acuan versi lama, TIDAK dipindahkan:**
`icicyta2026-artefak` (ujung `eksperimen/seeded` versi sebelum tinjauan label v2/v3 dan PoC
lanjutan; tidak memuat `prompts/`) dan `icicyta2026-artefak-alat` (ujung `feat/prompt-v2`; memuat
`prompts/v2/` saja, tidak ada `prompts/v3/`).

## Peringatan keamanan

Branch `eksperimen/seeded` berisi kerentanan yang **sengaja ditanam** sebagai ground truth
penelitian (SQL injection, XSS, IDOR, mass assignment, otorisasi yang hilang, dan sebagainya).
**Jangan menjalankannya di server publik atau di jaringan yang bisa diakses pihak lain.** Skrip di
`scripts/poc/` hanya untuk stack Docker Compose lokal berisi data sintetis milik proyek ini dan bukan
alat serangan umum. Semua langkah reproduksi di bawah hanya membaca kode dan berkas hasil; tidak ada
yang menjalankan aplikasi.

## Peta artefak

Ada dua repositori kerja yang diambil dari repo yang sama: **alat** (kode analisis dan penilai) dan
**objek uji** (kode bertanam, answer key, dan hasil). Keduanya diletakkan bersebelahan.

| Artefak | Branch | Path |
|---|---|---|
| Prompt v2 beserta hash | `feat/prompt-v2` | `prompts/v2/` (`HASHES.txt` dan tujuh berkas lain) |
| Prompt v3 (netral perkakas SAST) beserta hash | `feat/sast-codeql` | `prompts/v3/` |
| Kode alat batch 22 Okt 2026 | `feat/prompt-v2` | commit `515dcbf` (`scripts/llm-scan.js`, `scripts/llm/`, `scripts/llm-score.js`, `scripts/llm-gabung.js`) |
| Kode alat batch 26 Okt 2026 | `feat/sast-codeql` | commit `dbd81ac` (menambah `scripts/sast/`, termasuk penilai `skor-b-dua-sast.js`) |
| Answer key (S1 sampai S12, B1 sampai B6, N1) | `eksperimen/seeded` | `SEEDED.md` |
| Laporan SonarCloud beku | `eksperimen/seeded` | `hasil-eksperimen/20261019/sonar-beku.json` |
| Laporan CodeQL beku (18 alert) | `eksperimen/seeded` | `hasil-eksperimen/20261026-dua-sast/codeql-beku.json` |
| JSON mentah batch 22 Okt (9 run, 54 panggilan) | `eksperimen/seeded` | `hasil-eksperimen/20261022-gabungan/utama/{google,anthropic,openai}/` |
| Skor batch 22 Okt | `eksperimen/seeded` | `hasil-eksperimen/20261022-gabungan/skor-tunggal.json` dan berkas `skor-*` di sebelahnya |
| SARIF CodeQL | `eksperimen/seeded` | `hasil-eksperimen/20261026-dua-sast/sarif/` |
| JSON mentah batch 26 Okt (enam folder, 270 panggilan sah) | `eksperimen/seeded` | `hasil-eksperimen/20261026-dua-sast/llm-output/` |
| Skor dan ringkasan batch 26 Okt | `eksperimen/seeded` | `hasil-eksperimen/20261026-dua-sast/hasil-batch/` (`RINGKASAN.md`, `skor-<vendor>-p1.json`, `skor-<vendor>-ekst-p1.json`, `label-ekstensi.json`) |
| Penilai F1 verifikasi mayoritas (Tabel III) | `feat/sast-codeql` | `scripts/skor-verifikasi-mayoritas.js` |
| Penilai klaster gabungan ternormalisasi | `feat/sast-codeql` | `scripts/skor-gabungan-normalisasi.js` |
| Keluaran kedua penilai di atas | `eksperimen/seeded` | `hasil-eksperimen/20261022-gabungan/verifikasi-mayoritas.json` dan `hasil-eksperimen/20261022-gabungan/normalisasi/` |
| PoC lanjutan (E1-E4, E7-E9) | `eksperimen/seeded` | `hasil-eksperimen/20261028-poc-ulang/`, `hasil-eksperimen/20261028-verifikasi-penuh/`, `scripts/poc/*-v2.js` |

Keterangan batch 26 Okt:

- Enam folder `llm-output/20261026-*`: tiga vendor, masing-masing lengan uji (SonarCloud + CodeQL,
  23 alert) dan lengan kontrol (SonarCloud saja, 5 alert), prompt v3, tiga run per folder.
- `run-1.gagal-1.json` di folder `182454-openai-utama` adalah bukti satu run yang gagal habis karena
  koneksi putus. Run itu tidak dihitung, dan biaya percobaannya tidak tercatat.
- Tiga folder uji coba OpenAI sebelum batch tidak disertakan.
- `skor-<vendor>-ekst-p1.json` memakai label triase ekstensi (CQL-02 dan CQL-03 bukan; CQL-14, 15,
  16 nyata). Penilai tunggal; ground truth 19 item tidak diubah.
- File `*.raw.json` OpenAI memuat blob `encrypted_content` (penalaran terenkripsi, base64). Itu
  bukan kunci atau token.
- Kunci API tidak pernah disimpan di repo. `.env` tidak dilacak; `.env.example` memuat nama
  variabel dan nilai contoh.

## Menyiapkan

Dua checkout bersebelahan, masing-masing pada TAG-nya sendiri (bukan branch) — keduanya memang
dirancang untuk dipakai berpasangan, satu sebagai objek uji (`--objek=`), satu sebagai kode alat
yang dijalankan.

```bash
git clone https://github.com/MIlhamRidhoP/TA-ssdlc-devops-akademik.git objek-seeded
git -C objek-seeded checkout icicyta2026-artefak-v2

git clone https://github.com/MIlhamRidhoP/TA-ssdlc-devops-akademik.git TA-ssdlc-devops-akademik
git -C TA-ssdlc-devops-akademik checkout icicyta2026-artefak-alat-v2
cd TA-ssdlc-devops-akademik
npm ci
```

Semua perintah di bawah dijalankan dari `TA-ssdlc-devops-akademik/`, dengan `../objek-seeded`
sebagai objek uji. Pohon kerja kedua repo harus bersih; penilai menolak pohon yang kotor. Dibutuhkan
Node.js 22 atau lebih baru (diuji dengan v25.2.1).

## Pemeriksaan tanpa biaya (disarankan)

Penilaian ulang hanya membaca berkas hasil yang sudah ada. Tidak ada panggilan API.

```bash
# Hash prompt (harus semua OK)
(cd prompts/v2 && sha256sum -c HASHES.txt)
(cd prompts/v3 && sha256sum -c HASHES.txt)

# Batch 22 Okt 2026 (prompt v2): skor per model, SonarCloud + LLM
node scripts/llm-score.js --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --out=skor-tunggal-ulang.json \
  ../objek-seeded/hasil-eksperimen/20261022-gabungan/utama/google \
  ../objek-seeded/hasil-eksperimen/20261022-gabungan/utama/anthropic \
  ../objek-seeded/hasil-eksperimen/20261022-gabungan/utama/openai

# Batch 26 Okt 2026 (prompt v3): satu vendor, lengan uji dan kontrol
D=../objek-seeded/hasil-eksperimen/20261026-dua-sast
node scripts/sast/skor-b-dua-sast.js \
  $D/llm-output/20261026-165957-anthropic-utama $D/llm-output/20261026-170630-anthropic-utama \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --codeql-beku=$D/codeql-beku.json \
  --out=skor-anthropic-ulang.json
```

Untuk vendor lain gunakan pasangan folder `172451-google` dan `180327-google`, atau `182454-openai`
dan `191824-openai` (urutan uji lalu kontrol). Keluaran ditulis ke `--out`; jangan arahkan ke dalam
repo. Hasil yang diharapkan: bagian `rata_rata` pada `skor-tunggal-ulang.json` sama dengan
`skor-tunggal.json` batch 22 Okt, dan `per_model` pada `skor-anthropic-ulang.json` sama dengan
`per_model` di `hasil-batch/skor-anthropic-p1.json`. Hanya stempel waktu `dinilai_pada` dan jalur
folder yang berbeda. Kedua kesamaan ini sudah diperiksa pada kode alat `dbd81ac`.

### Baris "Combined, union" dan "Combined, 2 of 3" di Tabel III (eksperimen 1)

Dari kedua checkout di atas (`icicyta2026-artefak-v2` dan `icicyta2026-artefak-alat-v2`), dijalankan
dari `TA-ssdlc-devops-akademik/`:

```bash
# Baris per-vendor dan union/2-dari-3 "ketat", triase v3
node scripts/skor-verifikasi-mayoritas.js --objek=../objek-seeded
# Keluaran yang diharapkan (rata-rata 3 run): utama 0,794 | SONAR-03 real 0,711 | SONAR-01 FP 0,952

node scripts/skor-gabungan-normalisasi.js --objek=../objek-seeded
# Keluaran yang diharapkan (ketat, jumlah 3 run): union TP 24 FP 11 FN 3 (P 0,687 R 0,889 F1 0,775);
# 2-dari-3 TP 21 FP 1 FN 6 (P 0,952 R 0,778 F1 0,855)
```

`skor-verifikasi-mayoritas.js` menghitung F1 verifikasi (false positive sebagai kelas positif)
untuk putusan **mayoritas tiga vendor**, tiga pelabelan (utama, dan dua varian sensitivitas satu
label diubah) — baris yang sebelumnya kosong ("n/a") di sel "Majority of three" x "SONAR-03 real"
pada draf awal, karena `skor-gabungan.js` tidak pernah memanggil `kategoriVerifikasi` untuk mode
gabungan. `skor-gabungan-normalisasi.js` menghitung ulang klaster lintas vendor dengan awalan
`exports.`/`module.exports.` dibuang dari nama fungsi sebelum dibandingkan (`temuanCocok` di
`llm/gabung.js` membandingkan string persis, dan memecah klaster yang semestinya satu, mis.
`findOwned` vs `exports.findOwned`). Keduanya hanya memanggil fungsi yang sudah diekspor dari
`skor-gabungan.js`/`llm/score.js`/`llm/gabung.js`, tidak mengubahnya.

## Mengulang run model (berbayar)

Ini memanggil API vendor dan membutuhkan kunci milik Anda sendiri di berkas `.env` (`GEMINI_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`; contoh nama variabelnya di `.env.example`). Biaya batch 22 Okt
sekitar US$4. Biaya tercatat batch 26 Okt US$11,77, belum termasuk percobaan ulang yang tidak
tercatat. Jawaban model tidak deterministik, jadi hasilnya tidak akan identik dengan berkas di atas.
Jalankan `--kering` lebih dulu: itu berhenti sebelum panggilan pertama dan mencetak hash prompt, yang
harus sama dengan yang tercatat di `summary.json`.

```bash
# Batch 22 Okt (prompt v2). Kode alat yang dipakai saat itu: commit 515dcbf di feat/prompt-v2.
git checkout 515dcbf   # atau tetap di feat/sast-codeql
for V in google anthropic openai; do
  node scripts/llm-scan.js --vendor=$V --kondisi=utama --skenario=B --runs=3 \
    --objek=../objek-seeded \
    --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json
done

# Batch 26 Okt (prompt v3), kode alat dbd81ac di feat/sast-codeql
git checkout feat/sast-codeql
D=../objek-seeded/hasil-eksperimen/20261026-dua-sast
for V in google anthropic openai; do
  # lengan uji: SonarCloud + CodeQL, 23 alert, 24 panggilan per run
  node scripts/llm-scan.js --vendor=$V --kondisi=utama --skenario=B --sast=keduanya --prompt=v3 \
    --objek=../objek-seeded \
    --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
    --codeql-beku=$D/codeql-beku.json --runs=3
  # lengan kontrol: SonarCloud saja, 5 alert, 6 panggilan per run
  node scripts/llm-scan.js --vendor=$V --kondisi=utama --skenario=B --sast=sonar --prompt=v3 \
    --objek=../objek-seeded \
    --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json --runs=3
done
```

Hasil ditulis ke `llm-output/v2/<tanggal-jam>-<vendor>-utama/` di repo alat (folder itu diabaikan
git); nilai dengan perintah penilaian di atas. Panduan lengkap batch 26 Okt, termasuk gerbang kode
alat yang menolak pohon kerja kotor dan cara melanjutkan run yang terputus (`--lanjut`), ada di
`docs/panduan-batch-dua-sast.md` pada branch `feat/sast-codeql`. Catatan metode batch 22 Okt ada di
`hasil-eksperimen/20261022-gabungan/README.md`; berkas itu ditulis sebelum batch dijalankan dan
memakai jalur Windows milik penulis pada beberapa contoh perintahnya.

### PoC lanjutan (E1-E4, E7-E9): kuota/addItem/removeItem/email race, requireConsent, is_minor, rate limit

Enam skrip baru di `scripts/poc/` (tidak menimpa `scripts/poc/toctou-krs.sh` yang lama), menembak
stack Docker Compose lokal, bukan API vendor. Perintah lengkap, definisi "menang" tiap skrip, dan
keluaran mentahnya ada di `hasil-eksperimen/20261028-poc-ulang/README.md` dan
`hasil-eksperimen/20261028-verifikasi-penuh/README.md`. Ringkasan: E1-E3 (race kuota/addItem/
removeItem KRS) dan E4 (race batas email) terbukti (599-600 dari 600 percobaan); E9 (tanpa rate
limit login) terbukti tapi duplikat B3; E7 (requireConsent) dan E8 (mass-assignment `is_minor`)
direfutasi.

## Batas klaim

- Satu objek uji sintetis, sembilan kerentanan terbukti, tiga run per model. Satu item answer key
  setara 0,111 recall. Angka tidak diuji secara statistik.
- Pada lengan dua perkakas, hampir seluruh alert di luar answer key adalah `js/missing-rate-limiting`;
  menurunnya presisi skenario B mencerminkan perlakuan answer key atas aturan itu, bukan mutu CodeQL.
- Label triase ekstensi dibuat satu penilai (penulis), sebelum hasil batch dilihat.
