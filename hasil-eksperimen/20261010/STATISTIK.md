# Uji Statistik — McNemar Eksak untuk Perbandingan Skenario

> **CATATAN BASIS (pembaruan 2026-10-10):** dokumen ini semula memakai 10 item positif
> (S1, S3, S4, S6–S12). Setelah verifikasi PoC penuh, ground truth direklasifikasi menjadi
> **9 item positif** (S6 dipindah ke "laten" karena tidak dapat dieksploitasi; lihat
> `SKENARIO_SERANGAN.md` dan kolom Status `SEEDED.md`). S6 tidak terdeteksi model mana pun,
> jadi memindahkannya tidak mengubah sel b maupun c pada tabel McNemar — **kesimpulan tetap
> sama**. Tabel McNemar final (otomatis dan koreksi manual, basis 9) ada di README bagian
> "Metrik final". Tabel di bawah (basis 10) dipertahankan sebagai penjelasan metode; angka
> b/c/p untuk perbandingan utama identik dengan versi basis 9.

Dasar data historis bagian ini: 10 item positif (S1, S3, S4, S6–S12).
Status per item per model diambil dari tabel pencocokan final (setelah putusan manual) di
`LAPORAN_UJICOBA_final.md` bagian 8.3.

**n sangat kecil (10 item, 3 run). Semua p-value di dokumen ini harus dibaca sebagai indikasi
deskriptif, bukan bukti statistik yang kuat untuk klaim generalisasi.** Dengan n=10, uji
McNemar hanya punya kekuatan (power) yang memadai untuk mendeteksi perbedaan yang sangat
besar; perbedaan sedang kemungkinan tidak akan terdeteksi signifikan meski ada secara nyata.

## Definisi uji

McNemar eksak dipakai untuk data berpasangan biner (dua metode dinilai pada OBJEK YANG SAMA).
Tabel kontingensi 2×2:

|  | Model B: terdeteksi | Model B: tidak |
|---|---|---|
| **Model A: terdeteksi** | kedua ya | b (hanya A) |
| **Model A: tidak** | c (hanya B) | kedua tidak |

Statistik uji eksak (binomial, bukan chi-square, karena n kecil) memakai hanya sel b dan c
(item yang berbeda hasil antar model) — sel "kedua ya" dan "kedua tidak" tidak memengaruhi
p-value:

```
p = min(1, 2 * sum_{i=0}^{min(b,c)} C(b+c, i) / 2^(b+c))
```

Kalau b+c = 0 (tidak ada perbedaan sama sekali), p didefinisikan 1 (tidak ada bukti beda).

## Dua cara agregasi 3 run menjadi satu status per item

Gemini dijalankan 3 kali per model (Flash otomatis, Pro manual). Sebelum dibandingkan
dengan Sonar (yang cuma 1x, deterministik), 3 run itu perlu diringkas jadi satu angka per
item. Dua pendekatan dipakai dan dilaporkan paralel:

1. **Per run** — setiap (item, run) diperlakukan sebagai satu pasangan observasi. Untuk 10
   item × 3 run = **30 pasangan** per perbandingan. Kelebihan: memakai semua data mentah,
   tidak membuang variasi antar run. Kekurangan: 3 observasi dari item yang sama TIDAK
   independen satu sama lain (melanggar asumsi independensi McNemar), sehingga p-value di
   metode ini bersifat optimistis (terlalu kecil / terlalu signifikan) dan harus dibaca
   hati-hati.
2. **Mayoritas 3 run** — status item = 1 kalau terdeteksi di ≥2 dari 3 run, else 0. Untuk 10
   item = **10 pasangan**. Ini menghormati independensi (satu observasi per item), tapi
   kehilangan informasi tentang konsistensi antar run.

Dokumen ini melaporkan **mayoritas 3 run sebagai acuan utama** (karena lebih valid secara
statistik), dan **per run sebagai pembanding** (karena memakai semua data).

## Status per item (ketat: hanya "cocok" dihitung 1)

| Item | Sonar | Flash R1 R2 R3 | Flash mayoritas | Pro R1 R2 R3 | Pro mayoritas |
|---|---|---|---|---|---|
| S1 | 0 | 1 1 1 | 1 | 1 1 1 | 1 |
| S3 | 1 | 1 1 1 | 1 | 1 1 1 | 1 |
| S4 | 0 | 1 1 1 | 1 | 1 1 1 | 1 |
| S6 | 0 | 0 0 0 | 0 | 0 0 0 | 0 |
| S7 | 0 | 1 1 1 | 1 | 0 0 0 | 0 |
| S8 | 0 | 0 0 0 | 0 | 0 0 0 | 0 |
| S9 | 0 | 0 1 1 | 1 | 0 1 0 | 0 |
| S10 | 0 | 1 1 0 | 1 | 0 1 0 | 0 |
| S11 | 0 | 1 1 1 | 1 | 0 0 0 | 0 |
| S12 | 0 | 0 0 0 | 0 | 0 0 0 | 0 |

Mayoritas Flash ketat terdeteksi: S1, S3, S4, S7, S9, S10, S11 (7 dari 10).
Mayoritas Pro ketat terdeteksi: S1, S3, S4 (3 dari 10).
Sonar terdeteksi: S3 (1 dari 10).

## Hasil: mayoritas 3 run (n=10, acuan utama)

| Perbandingan | kedua ya | kedua tidak | b (hanya A) | c (hanya B) | p (eksak) | Signifikan? (α=0,05) |
|---|---|---|---|---|---|---|
| Flash vs Sonar | 1 | 3 | 6 (Flash saja) | 0 (Sonar saja) | **0,0313** | Ya |
| Pro vs Sonar | 1 | 7 | 2 (Pro saja) | 0 (Sonar saja) | 0,5000 | Tidak |
| Flash vs Pro | 3 | 3 | 4 (Flash saja) | 0 (Pro saja) | 0,1250 | Tidak |

Interpretasi: pada n=10, hanya perbedaan **Flash vs Sonar** yang signifikan secara statistik
(p=0,0313 < 0,05) — Flash mendeteksi 6 item yang Sonar lewatkan (S1, S4, S7, S9, S10, S11),
dan Sonar tidak mendeteksi apa pun yang Flash lewatkan. Pro vs Sonar dan Flash vs Pro **tidak
signifikan** pada ambang 0,05, meski secara deskriptif Flash tampak mendeteksi lebih banyak
item unik dibanding Pro (4 banding 0) — ini kemungkinan karena power uji terlalu rendah untuk
n=10, bukan berarti tidak ada beda sama sekali.

## Hasil: per run (n=30, pembanding, HATI-HATI independensi)

| Perbandingan | kedua ya | kedua tidak | b | c | p (eksak) |
|---|---|---|---|---|---|
| Flash vs Sonar | 3 | 11 | 16 | 0 | 0,0000 (<0,0001) |
| Pro vs Sonar | 3 | 19 | 8 | 0 | 0,0078 |
| Flash vs Pro | 11 | 11 | 8 | 0 | 0,0078 |

Pada metode per run, SEMUA tiga perbandingan jadi signifikan, termasuk Pro vs Sonar dan Flash
vs Pro yang TIDAK signifikan di metode mayoritas. Ini pola klasik pseudoreplication: n
pasangan yang lebih besar (30 vs 10) membuat uji lebih "mudah" signifikan meski datanya
sebagian besar adalah pengulangan dari item yang sama. **Angka dari metode ini tidak boleh
dipakai sendirian sebagai klaim "signifikan secara statistik" di paper** — hanya sebagai
pembanding deskriptif bahwa pola yang sama (Flash lebih baik dari Sonar) konsisten di kedua
cara hitung.

## Versi longgar (cocok lokasi dihitung sebagai terdeteksi), mayoritas 3 run

| Perbandingan | kedua ya | kedua tidak | b | c | p (eksak) |
|---|---|---|---|---|---|
| Flash vs Sonar | 1 | 3 | 6 | 0 | 0,0313 |
| Pro vs Sonar | 1 | 6 | 3 | 0 | 0,2500 |
| Flash vs Pro | 4 | 3 | 3 | 0 | 0,2500 |

Kesimpulan tidak berubah secara kualitatif dari versi ketat: hanya Flash vs Sonar yang
signifikan.

## Keterbatasan uji ini

1. **n=10 sangat kecil.** Power uji McNemar eksak pada n=10 rendah untuk perbedaan sedang.
   Hasil "tidak signifikan" (Pro vs Sonar, Flash vs Pro di metode mayoritas) TIDAK BOLEH
   dibaca sebagai "terbukti tidak ada beda" — hanya "belum cukup bukti untuk menyimpulkan
   ada beda dengan sampel sekecil ini".
2. **Metode per run melanggar independensi** (dicatat eksplisit di atas), sehingga p-valuenya
   secara teori terlalu kecil (over-optimis). Dilaporkan sebagai pembanding, bukan klaim utama.
   Alternatif yang lebih benar secara statistik untuk data berulang semacam ini adalah model
   efek campuran (mixed-effects logistic regression) dengan item dan run sebagai faktor
   acak — di luar cakupan audit ini, dicatat sebagai saran penelitian lanjutan.
3. **Hanya 1 observasi untuk Sonar** (deterministik, tidak diulang), sehingga variasi Sonar
   antar waktu tidak bisa diukur — asimetri ini membuat perbandingan dengan Flash/Pro (yang
   py 3 observasi) tidak sepenuhnya setara.
4. **S2, S5, dan kemungkinan S6 dikeluarkan** dari ground truth berdasarkan verifikasi
   dinamis terpisah (lihat `SKENARIO_SERANGAN.md`). Jika basis ground truth berubah lagi
   (misal S6 ikut dikeluarkan, menyisakan 9 item), tabel di atas perlu dihitung ulang — tidak
   dilakukan di sini karena keputusan ground truth final belum ditetapkan penulis TA.
5. Tidak ada koreksi multiple comparison (misal Holm) diterapkan di sini karena hanya 3
   perbandingan berpasangan dilaporkan deskriptif, bukan sebagai rangkaian uji hipotesis
   formal yang perlu dikontrol Type I error gabungan. Jika paper ingin mengklaim ketiganya
   sebagai temuan formal, koreksi Holm sebaiknya diterapkan (lihat implementasi referensi di
   `C:\repo\TRISULA_PROJECT\trisula\` dari rancangan TRISULA yang sudah tidak dipakai, bisa
   diadaptasi).
