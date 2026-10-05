# Ground Truth Kerentanan Tertanam

Branch: eksperimen/seeded
Objek uji: backend SIA. Versi aman ada di branch main.
Catatan: file ini hanya ada di branch eksperimen, tidak di-merge ke main.
Kerentanan di bawah ditanam sengaja untuk kebutuhan pengujian deteksi SAST dan LLM.

## Kerentanan yang ditanam

| ID | File | Fungsi | Kelas | CWE | OWASP | Tingkat |
|----|------|--------|-------|-----|-------|---------|
| S1 | src/models/mahasiswaModel.js | listFrom, list | SQL Injection | CWE-89 | A03 | Mudah |
| S2 | src/models/cutiModel.js | listAdmin | SQL Injection (ORDER BY) | CWE-89 | A03 | Sedang |
| S3 | src/controllers/nilaiController.js, src/models/nilaiModel.js | khs, publishedBySemester | SQL Injection | CWE-89 | A03 | Sulit |
| S4 | src/controllers/nilaiController.js | halamanKhs | Stored XSS | CWE-79 | A03 | Sedang |
| S5 | src/controllers/nilaiController.js | khs | Reflected XSS | CWE-79 | A03 | Mudah |
| S6 | src/controllers/dokumenController.js | kirimFile | Path Traversal | CWE-22 | A01 | Sedang |
| S7 | src/models/cutiModel.js | findOwned | IDOR | CWE-639 | A01 | Sedang |
| S8 | src/models/profilModel.js | removeEmail | IDOR | CWE-639 | A01 | Sulit |
| S9 | src/controllers/mahasiswaController.js, src/models/mahasiswaModel.js | updateMe, updateByUserId | Mass Assignment | CWE-915 | A01 | Sedang |
| S10 | src/controllers/cutiController.js, src/models/cutiModel.js | create | Mass Assignment | CWE-915 | A01 | Mudah |
| S11 | src/routes/cutiRoutes.js | route PUT /:id/status | Missing Authorization | CWE-862 | A01 | Mudah |
| S12 | src/models/cutiModel.js | listAdmin | Sensitive Data Exposure | CWE-359 | A01 | Sulit |

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