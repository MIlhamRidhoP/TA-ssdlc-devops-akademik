# Instruksi implementasi prompt v2 untuk Claude Code

Tugasmu mengimplementasikan prompt v2 di repo TA-ssdlc-devops-akademik. Spesifikasi lengkap ada di `prompts/v2/README.md`. Kalau ada yang bertentangan antara instruksi ini dan README, ikuti README, lalu laporkan pertentangannya.

## Aturan kerja

1. Intervensi minimal. Ubah hanya yang diminta di sini. Jangan merapikan, mengganti nama, atau memformat ulang kode lain.
2. Jangan ubah isi file di `prompts/v2/` satu karakter pun. Setelah disalin, cek dengan `sha256sum -c prompts/v2/HASHES.txt` dan pastikan semuanya OK.
3. Jalur v1 tetap bisa dijalankan (misalnya lewat opsi `--prompt v1`), supaya run 10 Oktober tetap bisa direproduksi sebagai data pilot.
4. Jangan menebak nama parameter API. Untuk setiap parameter yang di README ditandai "pastikan", cek ke dokumentasi resmi vendor, lalu tulis sumbernya di komentar kode atau di laporan.
5. Jangan menjalankan eksperimen. Run yang diizinkan hanya run uji teknis di langkah 9, dan skornya tidak boleh dipakai untuk mengubah prompt.
6. Kalau ragu, berhenti dan tanya. Jangan mengambil keputusan desain sendiri.

## Langkah

### 1. Salin file prompt
Salin seluruh isi `prompts/v2/` (termasuk `README.md` dan `HASHES.txt`) ke repo, lalu verifikasi hash.

### 2. Renderer
Buat modul perakit prompt sesuai README bagian 3, 4, dan 5:
- Urutan file alfabetis dengan perbandingan string biasa, normalisasi LF, aturan baris terakhir, format `<nomor> | <isi>`, header `===== FILE: <path> =====`.
- Pemilihan, pengurutan, dan pemberian ID alert Sonar.
- Penggantian variabel literal dan pengecekan tidak ada sisa `{{`.
- Hasilnya: teks system kanonik, teks user kanonik, dan pembagian dua content block untuk Claude.
- Hitung semua hash di README bagian 9.

### 3. Adapter per vendor
Satu adapter per vendor (Google, Anthropic, OpenAI) dengan antarmuka yang sama: menerima teks system, blok user, skema, dan pengaturan; mengembalikan teks output mentah, status, usage, dan model yang menjawab. Ikuti tabel README bagian 6.
- Jangan kirim parameter sampling.
- Jangan pasang fallback, tools, web search, atau grounding.
- Secret API dibaca dari environment: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

### 4. Alur panggilan
Tambahkan opsi `--kondisi` dengan nilai `utama`, `sonar_di_deteksi`, `komentar_menyesatkan`, serta opsi model atau vendor. Ikuti README bagian 2. Untuk kondisi `utama`, panggilan verifikasi dijalankan berurutan, satu per alert, setelah panggilan deteksi.

### 5. Validasi, status, dan pengulangan
Ikuti README bagian 7 dan 8. Simpan output mentah setiap panggilan, termasuk yang gagal.

### 6. Penyimpanan hasil
Pertahankan pola yang sudah ada (`run-N.json` dan `run-N.raw.json`) supaya `--score-file` tetap bisa dipakai. Tambahkan bagian `verifikasi` (satu entri per alert) dan metadata README bagian 9.

### 7. Scoring
- Deteksi: tetap memakai aturan pencocokan yang sudah ada (file, fungsi atau lokasi, keluarga CWE). Field baru `fungsi` boleh dipakai sebagai sinyal lokasi tambahan. Temuan dengan `sifat: hardening` dilaporkan terpisah dan tidak dihitung FP ketat.
- Verifikasi: setiap alert masuk satu dari empat kategori (Identified FP, Missed FP, Mis-identified FP, Correct Retention) berdasarkan ground truth. `uncertain` dihitung dipertahankan dan dilaporkan terpisah. Status `rejected` hasil pencocokan tidak dipakai lagi untuk v2.
- Skenario A: hitung dengan dua definisi temuan Sonar, yaitu (a) hanya tipe `VULNERABILITY` dan (b) filter yang sekarang.
- Tabel per item: untuk setiap seeded vuln, terdeteksi di A saja, B saja, keduanya, atau tidak sama sekali.
- Dukung file `triase-manual.json` opsional untuk temuan berstatus `di luar ground truth` dan `perlu cek manual`, dengan kategori: tp_di_luar_seeded, fp, teoretis, informasional, duplikat. Laporkan FP ketat dan FP setelah triase.
- Laporkan jumlah panggilan berstatus refusal, truncated, dan parse_ok false per model dan kondisi.

### 8. Ground truth
Di branch `eksperimen/seeded`, ubah hanya kolom OWASP di `SEEDED.md` ke edisi 2025: S1 sampai S5 menjadi A05, S9 dan S10 menjadi A08, sisanya tetap A01. Jangan ubah kolom lain. Pastikan scoring tetap jalan karena scoring memakai CWE.

### 9. Run uji teknis
Satu run per vendor, kondisi `utama`. Laporkan checklist berikut, tanpa melaporkan atau menafsirkan skor:
- request diterima tanpa error 400;
- output lolos skema dan validasi;
- tidak ada output terpotong;
- penolakan, kalau ada, tercatat dengan benar;
- `penjelasan` dan `alasan` berbahasa Indonesia;
- token cache terbaca pada panggilan verifikasi kedua dan seterusnya;
- hash `kode_sumber` sama untuk ketiga vendor;
- nomor baris di output cocok dengan file asli;
- nama parameter yang ditandai "pastikan" sudah dicek ke dokumentasi resmi, beserta tautannya.

### 10. Tes
Tambahkan tes unit tanpa panggilan API sungguhan untuk renderer (output dan hash deterministik), validator, pemetaan status, dan scoring verifikasi empat kategori.

## Di luar lingkup tugas ini

- Pembuatan branch `eksperimen/framing` dan penempatan komentar menyesatkan. Ini dikerjakan terpisah setelah lokasinya ditentukan.
- Perubahan dashboard, `merge-results.js`, dan workflow menjadi model-agnostic. Ini tahap berikutnya setelah judul dikonfirmasi dospem. Untuk saat ini, cukup pastikan perubahan di atas tidak merusak dashboard yang ada.

## Laporan yang diminta

Setelah selesai: daftar file yang diubah, hasil `sha256sum -c`, hasil tes, checklist run uji teknis, dan daftar hal yang tidak bisa dipastikan atau perlu keputusan.
