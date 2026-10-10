# Ground Truth Kerentanan Tertanam

Branch: eksperimen/seeded
Objek uji: backend SIA. Versi aman ada di branch main.
Catatan: file ini hanya ada di branch eksperimen, tidak di-merge ke main.
Kerentanan di bawah ditanam sengaja untuk kebutuhan pengujian deteksi SAST dan LLM.

## Kerentanan yang ditanam

Kolom Status diisi setelah verifikasi eksploitasi dinamis (PoC lewat HTTP nyata, 2026-10-10).
Bukti lengkap tiap item ada di `hasil-eksperimen/20261010/SKENARIO_SERANGAN.md`. Arti status:
- **terbukti** = eksploitasi berhasil didemonstrasikan lewat PoC. Dihitung sebagai positif untuk metrik.
- **jebakan FP** = ditandai SonarCloud sebagai kerentanan, tetapi tidak dapat dieksploitasi. Deteksi atasnya dihitung sebagai false positive.
- **laten** = kelemahan kode nyata, tetapi tidak ada jalur API yang membuatnya dapat dieksploitasi. Tidak dihitung positif maupun jebakan; deteksi dicatat terpisah tanpa dihitung FP.

| ID | File | Fungsi | Kelas | CWE | OWASP | Tingkat | Status |
|----|------|--------|-------|-----|-------|---------|--------|
| S1 | src/models/mahasiswaModel.js | listFrom, list | SQL Injection | CWE-89 | A03 | Mudah | terbukti |
| S2 | src/models/cutiModel.js | listAdmin | SQL Injection (ORDER BY) | CWE-89 | A03 | Sedang | jebakan FP |
| S3 | src/controllers/nilaiController.js, src/models/nilaiModel.js | khs, publishedBySemester | SQL Injection | CWE-89 | A03 | Sulit | terbukti |
| S4 | src/controllers/nilaiController.js | halamanKhs | Stored XSS | CWE-79 | A03 | Sedang | terbukti |
| S5 | src/controllers/nilaiController.js | khs | Reflected XSS | CWE-79 | A03 | Mudah | jebakan FP |
| S6 | src/controllers/dokumenController.js | kirimFile | Path Traversal | CWE-22 | A01 | Sedang | laten |
| S7 | src/models/cutiModel.js | findOwned | IDOR | CWE-639 | A01 | Sedang | terbukti |
| S8 | src/models/profilModel.js | removeEmail | IDOR | CWE-639 | A01 | Sulit | terbukti |
| S9 | src/controllers/mahasiswaController.js, src/models/mahasiswaModel.js | updateMe, updateByUserId | Mass Assignment | CWE-915 | A01 | Sedang | terbukti |
| S10 | src/controllers/cutiController.js, src/models/cutiModel.js | create | Mass Assignment | CWE-915 | A01 | Mudah | terbukti |
| S11 | src/routes/cutiRoutes.js | route PUT /:id/status | Missing Authorization | CWE-862 | A01 | Mudah | terbukti |
| S12 | src/models/cutiModel.js | listAdmin | Sensitive Data Exposure | CWE-359 | A01 | Sulit | terbukti |

Himpunan positif untuk metrik: 9 item terbukti (S1, S3, S4, S7, S8, S9, S10, S11, S12).
Jebakan FP: S2, S5. Laten (tidak dihitung): S6.

## Temuan bawaan (sudah ada di main sebelum penanaman, bukan bagian 12 di atas)

| ID | Deskripsi | Lokasi | CWE | Terdeteksi Sonar |
|----|-----------|--------|-----|------------------|
| B1 | CORS mengizinkan semua origin | src/app.js | CWE-942 | Ya |
| B2 | ReDoS regex email (regex sebelum cek panjang) | src/controllers/authController.js | CWE-1333 | Ya, sebagai Reliability |
| B3 | Tidak ada rate limiting login dan register | src/routes/authRoutes.js | CWE-307 | Tidak |
| B4 | Respons 409 register membocorkan email terdaftar | src/controllers/authController.js | CWE-204 | Tidak |
| B5 | Token tetap berlaku setelah akun dihapus | src/middleware/auth.js | CWE-613 | Tidak |
| B6 | requireConsent meloloskan user nonaktif | src/middleware/requireConsent.js | CWE-863 | Tidak |
| N1 | Regex email aman tapi ditandai Sonar (false positive) | src/utils/validators.js | - | Ya |