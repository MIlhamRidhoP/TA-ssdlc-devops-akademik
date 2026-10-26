# Panduan menjalankan batch dua perkakas SAST

Batch lengan dua: SonarCloud + CodeQL, skenario A dan B, kondisi `utama`. Disusun 26 Okt 2026.

**Batch ini belum dijalankan.** Dokumen ini adalah panduan beserta angka hasil dry-run, bukan
laporan hasil. Satu-satunya tahap yang mengeluarkan uang adalah bagian 5.

---

## 1. Yang sudah ada, dan yang belum

| Butir | Keadaan |
|---|---|
| Prompt netral perkakas | `prompts/v3/`, terkunci hash, 8 berkas |
| Sumbu `sast` di alat | `scripts/llm-scan.js --sast=sonar\|codeql\|keduanya` |
| Laporan CodeQL beku | `scripts/sast/codeql-beku.js`, 18 alert, `sha256_isi` deterministik |
| Penggabung himpunan alert | `scripts/sast/sumbu-sast.js`, Sonar lebih dulu lalu CodeQL |
| Penilai skenario A dua perkakas | `scripts/sast/skor-dua-sast.js`, dengan pemetaan K6 |
| Pemilih versi prompt | `scripts/llm-scan.js --prompt=v2|v3`, bawaan `v2`. Dua perkakas dengan `v2` **ditolak** |
| Mode verifikasi-saja | **tidak dibangun**; lengan kontrol dijalankan penuh |
| Skema hasil | `docs/design/results-v3.schema.json` |
| Penjaga kombinasi di CI | `devsecops.yml` job `rencana` |
| **Penilai skenario B dua perkakas** | **belum**, menunggu batch dijalankan |
| **Dasbor** | **ditunda**; belum bisa membaca skema 3 |
| **Fixture demo v3** | **belum**, lihat bagian 7 |

---

## 2. Prasyarat

1. Worktree objek uji **bersih**. Seluruh penilai menolak jalan kalau tidak, dan itu disengaja.
2. `prompts/v2` 8/8 OK dan `prompts/v3` 8/8 OK menurut `sha256sum -c HASHES.txt`.
3. Berkas beku ada dan `tree_src`-nya sama dengan objek uji:
   - `hasil-eksperimen/20261019/sonar-beku.json`
   - `hasil-eksperimen/20261026-dua-sast/codeql-beku.json`
4. Kunci API vendor sudah diganti setelah kebocoran 19 Okt. **Periksa ini sebelum bagian 5.**

---

## 3. Skenario A: nol biaya, bisa dijalankan sekarang

```bash
node scripts/sast/skor-dua-sast.js \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --codeql-beku=../objek-seeded/hasil-eksperimen/20261026-dua-sast/codeql-beku.json \
  --out=<folder batch>/skor-dua-sast-a.json
```

Hasil yang terukur 26 Okt 2026, varian ketat:

| sast | Alert | `b_filter_v2` P/R/F1 | `a_hanya_vulnerability` P/R/F1 | Tanpa pemetaan K6 |
|---|---|---|---|---|
| **sonar** | 5 | 0,333 / 0,111 / 0,167 | 0,333 / 0,111 / 0,167 | **identik** |
| **codeql** | 18 | 0,143 / 0,222 / 0,174 | 0,143 / 0,222 / 0,174 | **P tak terdefinisi, R 0,000, F1 0,000** |
| **keduanya** | 23 | 0,133 / 0,222 / 0,167 | 0,133 / 0,222 / 0,167 | **0,333 / 0,111 / 0,167** |

Kolom terakhir adalah alasan keputusan **K6** ada. `scripts/llm/score.js:235` menyaring
`tipe === 'VULNERABILITY'`, dan nilai itu milik SonarCloud. Tanpa pemetaan, seluruh alert CodeQL
lenyap dari varian pertama tanpa suara, dan lengan dua perkakas **runtuh menjadi angka Sonar-saja**
— angka yang tampak masuk akal dan sepenuhnya salah. Pemetaannya ada di
`scripts/sast/skor-dua-sast.js`, bukan dengan menyentuh `score.js`, dan ikut tertulis di keluaran
sebagai blok `pemetaan_k6`.

Angka Sonar-saja **tidak bergeser** dari yang sudah terbit, dengan maupun tanpa pemetaan.

---

## 4. Dry-run: jumlah panggilan dan biaya

Jalankan lebih dulu, selalu. `--kering` keluar sebelum satu pun panggilan API
(`scripts/llm-scan.js:338` dan `:370`).

```bash
node scripts/llm-scan.js --vendor=google --kondisi=utama --skenario=B --sast=keduanya --prompt=v3 \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --codeql-beku=../objek-seeded/hasil-eksperimen/20261026-dua-sast/codeql-beku.json \
  --kering
```

Hasil dry-run 26 Okt 2026:

| Lengan | Alert | Panggilan per run |
|---|---|---|
| `--sast=sonar` (bawaan) | 5 | **6** (1 deteksi + 5 verifikasi) |
| `--sast=keduanya` | 23 | **24** (1 deteksi + 23 verifikasi) |

Urutan verifikasi: `SONAR-01..05` lalu `CQL-01..18`. Hash prompt deteksi **`568d6cbaa989f393…`**
untuk kedua lengan, sama dengan yang tercatat di batch 22 Oktober.
`--prompt=v3` **wajib** untuk dua perkakas; tanpa itu alat menolak dengan menyebut sebabnya. Prompt
v2 berbunyi "reported by SonarCloud", jadi 18 alert CodeQL akan dikirim dengan keterangan asal yang
salah. Terukur: dengan v2, **18 dari 18** prompt verifikasi CQL menyebut SonarCloud; dengan v3,
**nol**. Bawaannya tetap `v2`, supaya pemanggil yang belum tahu sumbu ini tidak bisa diam-diam
melakukannya.

### Biaya, 3 vendor × 3 run

| Pos | Biaya |
|---|---|
| Lengan uji, 23 alert, `--sast=keduanya --prompt=v3` | US$10,0346 |
| Lengan kontrol, **run penuh** 5 alert, `--sast=sonar --prompt=v3` | US$4,0092 |
| **Total** | **US$14,04** |

Angka ini **direvisi naik** dari US$11,71. Secara teori lengan kontrol cukup mengulang verifikasinya
saja, karena prompt deteksi v2 dan v3 identik byte per byte untuk kondisi `utama`
(`tests/prompt-v3.test.js`). Tetapi **mode verifikasi-saja tidak dibangun**: `llm-scan.js` selalu
memanggil deteksi lebih dulu. Lengan kontrol karena itu dijalankan penuh, dan selisih US$2,34 adalah
harga dari keputusan untuk tidak membangun flag itu.

Angka google dihitung dengan rumus dasbor (`dashboard/app.js:1012`, dua titik ukur). Angka anthropic
dan openai adalah **ekstrapolasi dengan asumsi** porsi deteksi sama dengan google; repo sendiri
menolak menskalakan vendor bertitik ukur tunggal (`dashboard/app.js:1026`).

---

## 5. Menjalankan batch: BERBIAYA

Jangan lewati bagian 4. Jalankan pilot satu vendor satu run lebih dulu, vendor termurah
(GPT 6.1 Sol, US$0,2031 pada 5 alert), lalu bandingkan biaya nyatanya dengan perkiraan di atas
sebelum melanjutkan ke matriks penuh.

Yang **tidak** boleh dilakukan:

- Jangan menjalankan lewat CI. Job `rencana` menolak `sast` selain `sonar`
  (`devsecops.yml:211-230`), dan itu disengaja: dua perkakas hanya lewat CLI untuk sekarang.
- Jangan memakai kondisi `sonar_di_deteksi` dengan dua perkakas. Ditolak
  `scripts/sast/sumbu-sast.js`; bentuk laporan gabungan dua perkakas belum dirancang.
- Jangan menjalankan skenario C dengan dua perkakas. C tidak memakai alert sama sekali.
- Jangan menggabungkan pasangan kembar. Keputusan K1: S2 dan S3 masing-masing tetap mendapat
  panggilan verifikasi sendiri, dan `kembar_dengan` murni metadata.
- Jangan menyalakan lapis 2 (saran perbaikan AI). Ia masih memaku "alert SonarCloud" di
  `scripts/llm/remediasi.js:66` dan belum punya panduan untuk CWE-22; lihat bagian 7.

### Pilot: 1 vendor, 1 run, kira-kira US$0,33

```bash
node scripts/llm-scan.js \
  --vendor=openai --kondisi=utama --skenario=B --sast=keduanya --prompt=v3 \
  --objek=../objek-seeded \
  --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
  --codeql-beku=../objek-seeded/hasil-eksperimen/20261026-dua-sast/codeql-beku.json \
  --runs=1
```

### Batch penuh, dua lengan, KEDUANYA dengan `--prompt=v3`

```bash
# Lengan uji: dua perkakas, 23 alert, 24 panggilan per run
for V in google anthropic openai; do
  node scripts/llm-scan.js \
    --vendor="$V" --kondisi=utama --skenario=B --sast=keduanya --prompt=v3 \
    --objek=../objek-seeded \
    --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
    --codeql-beku=../objek-seeded/hasil-eksperimen/20261026-dua-sast/codeql-beku.json \
    --runs=3
done

# Lengan kontrol: Sonar saja, 5 alert, 6 panggilan per run, prompt v3 yang SAMA
for V in google anthropic openai; do
  node scripts/llm-scan.js \
    --vendor="$V" --kondisi=utama --skenario=B --sast=sonar --prompt=v3 \
    --objek=../objek-seeded \
    --sonar-beku=../objek-seeded/hasil-eksperimen/20261019/sonar-beku.json \
    --runs=3
done
```

Kedua lengan memakai `--prompt=v3` supaya satu-satunya perbedaan di antaranya adalah himpunan
alertnya. Lengan kontrol dengan `v2` membuat selisihnya bercampur dengan selisih teks prompt.

Kunci API dimuat di dalam proses Node oleh `scripts/llm-scan.js:40` (`require('dotenv').config`),
jadi tidak ada `source .env`. Variabel yang dibutuhkan: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`. `SONAR_TOKEN` tidak diperlukan karena kedua laporan dibaca dari berkas beku.

---

## 6. Setelah batch jalan

1. Nilai lengan kontrol dan lengan uji, keduanya dengan prompt v3.
2. Jalankan ulang penilaian batch 22 Oktober dan pastikan hasilnya **identik** dengan berkas skor
   yang sudah di-commit. Itu penjaga bahwa angka lama tidak bergeser.
3. Hash SHA-256 seluruh berkas di tiga folder batch lama harus tidak berubah.
4. Triase FP khas CodeQL masuk **berkas ekstensi terpisah** (keputusan K2); `SEEDED.md` tidak
   diubah, dan skor dilaporkan **dengan dan tanpa** ekstensi.

---

## 7. Dua hal yang masih menghalangi

**Fixture demo v3 belum dibuat.** `tests/rekomendasi-cwe.test.js:124` mewajibkan setiap CWE yang
muncul di `dashboard/fixtures/**` punya panduan di `dashboard/rekomendasi-cwe.json`. Delapan CWE
yang dibawa alert CodeQL belum punya: **CWE-22, 23, 36, 73, 90, 99, 730, 943**. Menambahkannya
memerlukan kutipan dari `cwe.mitre.org` atau `cheatsheetseries.owasp.org`, dan panduan tidak boleh
disusun tanpa sumber. Memilih sebagian alert agar lolos gerbang bukan pilihan: itu mengakali
pemeriksaan.

**Dasbor belum bisa membaca skema 3.** `SKEMA_DIDUKUNG` di `dashboard/app.js:324` masih `[1, 2]`.
Sampai itu berubah, hasil batch dua perkakas hanya bisa dibaca dari berkas, bukan dari dasbor.
