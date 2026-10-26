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
node scripts/llm-scan.js --vendor=google --kondisi=utama --skenario=B --sast=keduanya \
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

### Biaya, 3 vendor × 3 run

| Pos | Biaya |
|---|---|
| Lengan uji, 23 alert | US$10,0346 |
| Lengan kontrol, **verifikasi saja** 5 alert | US$1,6737 |
| **Total** | **US$11,71** |

Lengan kontrol tidak perlu mengulang deteksi: prompt deteksi v2 dan v3 **identik byte per byte**
untuk kondisi `utama`, dibuktikan `tests/prompt-v3.test.js`. Karena itu hasil deteksi 22 Oktober sah
dipakai ulang sebagai sampel v3, dan hanya verifikasinya yang perlu diulang.

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
