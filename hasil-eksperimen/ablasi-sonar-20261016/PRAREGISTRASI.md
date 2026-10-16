# Praregistrasi Ablasi Konteks SonarCloud

Ditulis 16 Okt 2026, **sebelum run pertama**. SHA-256 file ini dicatat otomatis di `log-run.json` setiap kali runner dijalankan. Kalau file ini diubah setelah run, perubahan itu wajib dicatat di bagian "Penyimpangan" di bawah, bukan menimpa teks lama.

## 1. Pertanyaan

Apakah laporan SonarCloud di dalam prompt mengubah hasil deteksi Gemini pada Skenario B?

Dasar: IRIS (Li dkk., ICLR 2025). Efek konteks SAST bergantung pada kemampuan model, dan konteks berlebih bisa menurunkan akurasi. Belum ada paper yang menguji langsung efek daftar temuan SAST di prompt LLM.

## 2. Kondisi

| | A: dengan Sonar | B: tanpa Sonar |
|---|---|---|
| Prompt | `prompt-A.txt`, identik dengan arsip `20261010/prompt-lengkap.txt` | `prompt-B.txt`: prompt A dengan blok Sonar (26 baris, 3.165 karakter) diganti `(laporan SonarCloud kosong atau tidak tersedia)` |
| SHA-256 | `355989292f5e81ac494a8d51f28ce9afa44dfadf3eda60f0fc3d1c7d61ad38b8` | `2b55903b88373b12ca4f4952a77ac9eb40d3dd094a196ab5b6c0fa8f8cfcf6f9` |
| Karakter | 92.611 | 89.493 |

- Teks pengganti di B sama dengan yang dipakai `gemini-scan.js` saat laporan Sonar kosong.
- Bagian lain prompt identik byte demi byte (diverifikasi dengan `diff`: hanya baris 30–55 yang berbeda).
- Hash A berbeda dari hash yang tercatat saat eksperimen (`de8f35e0…`) hanya karena akhir baris. Prompt eksperimen dikirim dari Windows dengan CRLF di bagian kode; arsip dinormalisasi ke LF oleh `.gitattributes`. Isi teksnya identik.

## 3. Parameter tetap

| Item | Nilai |
|---|---|
| Model | `gemini-3.8-flash`, API langsung `generativelanguage.googleapis.com/v1beta`, tier berbayar |
| generationConfig | temperature 0.2, maxOutputTokens = `outputTokenLimit` model, responseMimeType `application/json`, thinking bawaan (tidak diatur) |
| Retry | 5 percobaan untuk 429/5xx/galat jaringan, backoff 10, 20, 40, 80 detik |
| Jumlah run | 3 per kondisi, total 6 |
| Urutan | diselang-seling dan tetap: A1, B1, A2, B2, A3, B3, dengan jeda 60 detik antar run |
| Kode yang dianalisis | `src/` versi eksperimen (sudah tertanam di prompt; tidak diambil ulang) |
| Penilaian | `node scripts/gemini-scan.js --score-file=<run>.json`, scorer eksperimen tanpa perubahan |
| Ground truth | `SEEDED.md`: 9 positif (S1, S3, S4, S7–S12), jebakan FP S2 dan S5, laten S6 |
| Runner | `scripts/ablasi-sonar.js`; analisis `scripts/ablasi-analisis.js` |

## 4. Hipotesis

- **H1 (utama, dua arah).** Status deteksi mayoritas pada 9 item positif berbeda antara A dan B.
  H0: tidak berbeda.
- **H2 (sekunder, satu arah, deskriptif).** Kondisi A melaporkan jebakan S2/S5 lebih sering daripada B, karena di A kedua lokasi itu ditunjuk Sonar.
  Catatan: di eksperimen 10 Okt Flash sudah menolak 5 dari 6 jebakan dengan laporan Sonar, jadi ruang bedanya kecil (efek lantai).
- **H3 (eksploratif).** Deteksi S3 menurun di B. S3 berlabel "Sulit", dan di A lokasinya ditunjuk Sonar.

## 5. Metrik dan uji

**Utama:** McNemar eksak dua arah, A vs B. Datanya status mayoritas (terdeteksi di ≥2 dari 3 run) pada 9 item positif, versi ketat (hanya status "cocok"). α = 0,05. Rumus sama dengan `20261010/STATISTIK.md`.

**Sekunder** (dilaporkan apa pun hasilnya):
1. McNemar mayoritas versi longgar ("cocok lokasi" ikut dihitung).
2. McNemar per run (pasangan Ai–Bi, n=27), dengan catatan pelanggaran independensi.
3. Jumlah jebakan S2/S5 yang dilaporkan, dari 6 observasi per kondisi.
4. Precision, recall, F1 (ketat dan longgar) per run dan rata-rata.
5. Jumlah temuan per run, token output (termasuk thinking), biaya, dan `modelVersion`.
6. Deteksi item bawaan B1–B6 dan N1 per kondisi (deskriptif).

**Replikasi** (uji tambahan, tidak mengubah kesimpulan utama). Kondisi A dibandingkan dengan 3 run Flash 10 Okt di `20261010/flash/`. Replikasi dinyatakan **konsisten** kalau status mayoritas ketat sama pada **≥ 8 dari 9** item positif. Dilaporkan juga McNemar A vs 10 Okt dan selisih F1 rata-rata.

## 6. Aturan interpretasi

- p < 0,05 pada uji utama: ada bukti bahwa laporan Sonar mengubah deteksi. Arahnya dibaca dari sel b dan c.
- p ≥ 0,05: **"tidak cukup bukti adanya perbedaan"**, bukan "terbukti tidak berbeda".
- Daya uji rendah. Dengan n=9, p < 0,05 baru tercapai bila minimal 6 item berbeda dan semuanya searah. Kemungkinan besar hasilnya dibaca secara deskriptif.
- Tidak ada uji tambahan yang dipilih setelah melihat hasil. Analisis di luar daftar di atas wajib diberi label "pasca-hoc".

## 7. Aturan run gagal dan batas biaya

- Run dianggap gagal bila: HTTP tetap gagal setelah 5 percobaan, respons bukan JSON valid, atau tidak berisi daftar `temuan` (misalnya `finishReason` MAX_TOKENS).
- Run gagal diulang **satu kali** setelah urutan utama selesai (`--hanya=<kode>`). Hasilnya disimpan sebagai `<kode>-ulang` dan menggantikan run asli dalam analisis. Run asli tetap disimpan.
- Kalau ulangan juga gagal, kondisi itu dianalisis dengan run yang tersedia, dan hal itu dilaporkan. Tidak ada ulangan kedua.
- Batas: maksimal 8 panggilan generateContent yang berhasil (6 + 2 ulangan). Perkiraan biaya sekitar $0,4–0,5, batas atas $1.
- Cek awal (`GET models/gemini-3.8-flash`) tidak menghasilkan token. Kalau cek awal gagal, tidak ada run yang dijalankan.

## 8. Ancaman validitas yang sudah diketahui

1. **Instruksi Sonar tetap ada di B.** Kalimat Context ("ringkasan laporan SonarCloud sebagai referensi") dan Instruction ("Verifikasi juga setiap temuan SonarCloud di bawah") tidak diubah, demi syarat "bagian lain identik". Jadi B mengukur "tanpa daftar temuan", bukan "tanpa menyebut Sonar sama sekali".
2. **Versi model dan tier bisa berbeda** dari 10 Okt. Eksperimen 10 Okt memakai free tier; ablasi memakai tier berbayar. `modelVersion` dicatat per run.
3. **Akhir baris berbeda.** A dikirim dengan LF, sedangkan eksperimen dengan CRLF di bagian kode. Isinya identik.
4. **Satu set ground truth.** Item dan kode yang sama dipakai di semua kondisi, jadi hasil tidak bisa digeneralisasi ke kode lain.
5. **Urutan run tetap, tidak diacak.** Selang-seling dipakai untuk meratakan beban server antar kondisi.

## 9. Penyimpangan

(Kosong saat praregistrasi ditulis. Isi di sini kalau ada perubahan setelah run pertama, lengkap dengan tanggal dan alasan.)
