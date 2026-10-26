# Prompt v3 — netral terhadap perkakas SAST

Versi ini ada karena satu alasan: jalur v2 menyebut **SonarCloud** di dalam prompt, sedangkan
kerangka ini akan menerima alert dari lebih dari satu perkakas analisis statis. Mengirim alert
CodeQL dengan prompt yang berkata "reported by SonarCloud" berarti memberi informasi palsu ke
model, dan itu mencemari eksperimen.

`prompts/v2/**` **tidak disentuh** dan tetap terkunci. v3 adalah salinan terpisah, bukan suntingan,
supaya hash prompt yang sudah tercetak di hasil eksperimen 19 dan 22 Oktober 2026 tetap dapat
direproduksi.

## Asal dan perbedaannya

Disalin dari `prompts/v2` pada 26 Oktober 2026. **Enam dari delapan berkas byte-identik** dengan v2,
dibuktikan oleh hash yang sama di `HASHES.txt` kedua folder:

| Berkas | Terhadap v2 |
|---|---|
| `alert-format.txt` | identik |
| `detection.schema.json` | identik |
| `source-header.txt` | identik |
| `system.txt` | identik |
| `task-detection.txt` | identik |
| `verification.schema.json` | identik |
| `sonar-reference.txt` | **dua baris berubah** |
| `task-verification.txt` | **satu baris berubah** |

Ketiga baris itu, lengkap:

| Berkas | Baris | v2 | v3 |
|---|---|---|---|
| `sonar-reference.txt` | 1 | `SONARCLOUD REPORT` | `STATIC ANALYSIS REPORT` |
| `sonar-reference.txt` | 3 | "The following alerts were reported by **SonarCloud** for this code." | "The following alerts were reported by **static analysis tools** for this code." |
| `task-verification.txt` | 3 | "Below is one alert reported by **SonarCloud** for the source code above." | "Below is one alert reported by **a static analysis tool** for the source code above." |

Tidak ada perbedaan lain. Baris 1 `task-verification.txt` sudah berbunyi
`TASK: VERIFY ONE STATIC ANALYSIS ALERT` sejak v2, jadi ia memang sudah netral.

## Dua hal yang sengaja TIDAK diubah

**Nama berkas `sonar-reference.txt` dipertahankan.** Peta template di `scripts/llm/render.js:121`
memetakan kunci `sonarReference` ke nama berkas itu. Mengganti namanya menuntut perubahan di modul
perakit, dan itu di luar lingkup penambahan versi prompt. Nama berkas tidak pernah terlihat model.

**Placeholder `{{SONAR_REPORT}}` dipertahankan.** Ia diisi di `scripts/llm/render.js:136`. Sama
seperti nama berkas, ini nama internal yang tidak pernah sampai ke model.

Keduanya adalah nama yang kelak layak diganti, tetapi pada versi prompt yang sama sekali tidak
mengubah teks yang dibaca model.

## Akibat untuk kesebandingan angka

Penting, dan sudah diukur oleh `tests/prompt-v3.test.js`:

| Rakitan prompt | v2 lawan v3 |
|---|---|
| Deteksi, kondisi `utama` | **identik byte per byte** |
| Deteksi, kondisi `komentar_menyesatkan` | **identik byte per byte** |
| Verifikasi, kondisi `utama` | berbeda **tepat satu baris** |
| Deteksi, kondisi `sonar_di_deteksi` | berbeda **tepat dua baris** |

Sebabnya `sonar-reference.txt` hanya disisipkan untuk kondisi `sonar_di_deteksi`
(`scripts/llm/render.js:134-137`), sehingga kondisi `utama` tidak pernah memuatnya.

Konsekuensi praktisnya: **angka skenario C tetap sebanding antara v2 dan v3**, karena C hanya
memanggil deteksi pada kondisi utama. **Skenario B tidak sebanding**, karena setiap panggilan
verifikasinya memakai teks yang berbeda satu baris, sehingga batch dua perkakas wajib menyertakan
lengan kontrol Sonar-saja di bawah v3.

## Penjagaan

Sama dengan v2, dua arah:

- `HASHES.txt` memuat delapan berkas prompt. `scripts/llm/render.js:21` membandingkan isi berkas
  dengan daftar itu dan menolak menjalankan run bila ada yang berbeda.
- `tests/kunci-prompt.test.js` menutup arah sebaliknya: tidak boleh ada berkas prompt di folder ini
  yang tidak tercantum di `HASHES.txt`, dan tidak boleh ada subfolder. Pengecualiannya hanya
  `HASHES.txt` sendiri dan `README.md` ini.

Format `HASHES.txt` mengikuti v2 apa adanya: hash, dua spasi, nama berkas, LF. Jangan dihasilkan
dengan `sha256sum` apa adanya di Git Bash, karena ia menulis `*nama` dalam mode biner dan pembaca
daftar di `tests/kunci-prompt.test.js:25` akan membaca tanda bintang itu sebagai bagian nama berkas.
