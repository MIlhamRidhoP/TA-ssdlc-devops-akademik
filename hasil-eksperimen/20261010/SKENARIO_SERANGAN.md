# Skenario Serangan dan Bukti Eksploitasi — Ground Truth S1–S12

Tanggal pengujian: 2026-10-10. Target: branch `eksperimen/seeded`, commit `5cbf05c928cd375fa51f773a03ca4779dde42e70`.
Lingkungan: Docker Compose lokal (`app` + `db`), data sintetis dari `scripts/seed-dummy.js` dan `scripts/seed-admin.js`.
Metode: HTTP request nyata lewat `curl` ke API berjalan, bukan review kode saja (kecuali S6, ditandai jelas).
Aktor: `admin` (akun admin), `andi@mahasiswa.test` (mahasiswa, berperan sebagai penyerang di sebagian besar skenario), `budi@mahasiswa.test` (mahasiswa, berperan sebagai korban).

Skrip PoC dapat dijalankan ulang dari `scripts/poc/` (lihat `scripts/poc/README.md`). Log hasil run terakhir (volume database bersih) tersimpan sebagai bukti di bagian masing-masing di bawah.

**Ringkasan hasil: 9 dari 12 item ground truth TERBUKTI secara dinamis. S2 dan S5 TERBUKTI TIDAK BISA DIEKSPLOITASI (diverifikasi di sesi sebelumnya). S6 TIDAK BISA DIVERIFIKASI SECARA DINAMIS karena tidak ada jalur API yang mencapai sink — dianalisis statis dan disimpulkan TIDAK TERBUKTI pada kode saat ini.**

Perubahan terhadap `SEEDED.md`: **TIDAK ADA**. Dokumen ini murni laporan hasil verifikasi, ground truth tidak diubah sepihak sesuai instruksi.

---

## Ringkasan

| ID | Kelas | CWE | Status | Dampak dibuktikan |
|---|---|---|---|---|
| S1 | SQL Injection | CWE-89 | **TERBUKTI** | Bypass filter pencarian, dump seluruh data mahasiswa dalam 1 request |
| S2 | SQLi (ORDER BY) | CWE-89 | **TIDAK TERBUKTI** (diverifikasi sesi lalu) | listQuery menolak semua payload sebelum sampai ke SQL |
| S3 | SQL Injection | CWE-89 | **TERBUKTI** | Bypass filter semester, nilai lintas-semester bocor dalam 1 request |
| S4 | Stored XSS | CWE-79 | **TERBUKTI** | Tag script tersimpan dan dipantulkan mentah ke korban |
| S5 | Reflected XSS | CWE-79 | **TIDAK TERBUKTI** (diverifikasi sesi lalu) | Payload selalu ter-escape atau hanya memantulkan string kosong |
| S6 | Path Traversal | CWE-22 | **TIDAK TERBUKTI** (analisis statis) | Tidak ada jalur API untuk mengontrol path_file |
| S7 | IDOR | CWE-639 | **TERBUKTI** | Baca penuh data cuti (termasuk alasan medis) milik mahasiswa lain |
| S8 | IDOR | CWE-639 | **TERBUKTI** | Hapus permanen data milik mahasiswa lain, dikonfirmasi korban |
| S9 | Mass Assignment | CWE-915 | **TERBUKTI** | Ubah NIM dan nama sendiri lewat endpoint update profil |
| S10 | Mass Assignment | CWE-915 | **TERBUKTI** | Pengajuan cuti langsung berstatus disetujui tanpa admin |
| S11 | Missing Authorization | CWE-862 | **TERBUKTI** | Mahasiswa memutuskan (menyetujui) cuti mahasiswa lain |
| S12 | Sensitive Data Exposure | CWE-359 | **TERBUKTI (dengan nuansa)** | Paparan massal data terdekripsi tanpa audit trail sama sekali |

Dari 12 item: **9 terbukti**, **3 tidak terbukti** (S2, S5, S6). Ini mengubah ukuran dasar untuk metrik precision/recall dari 10 "positif" (per `hasil-eksperimen/20261010/README.md`, yang sudah mengecualikan S2 dan S5) menjadi **9 item yang benar-benar terbukti dinamis**, dengan S6 kini juga perlu dipertimbangkan untuk dikeluarkan. Keputusan akhir ground truth diserahkan ke penulis TA.

---

## S1 — SQL Injection pada pencarian list mahasiswa

**CWE-89 | A03 | Mudah | src/models/mahasiswaModel.js fungsi listFrom, list**

- **Prasyarat**: peran admin.
- **Sink**: `WHERE ('${pola}' IS NULL OR m.nim ILIKE '${pola}' OR m.nama ILIKE '${pola}' OR u.email ILIKE '${pola}')` — `pola` disisipkan sebagai string SQL mentah, tanda kutip tunggal dari input pengguna tidak di-escape (hanya persen, garis bawah, dan backslash yang di-escape di listQuery.js).
- **Langkah serangan**:
  1. Login sebagai admin.
  2. `GET /api/mahasiswa?q=zzz_tidak_ada` → baseline, 0 hasil.
  3. `GET /api/mahasiswa?q=x' IS NOT NULL OR 'x'='x` → payload boolean-based yang valid secara sintaksis meski `pola` disisipkan 4 kali di posisi berbeda.
- **Request persis**: `GET /api/mahasiswa?q=x%27%20IS%20NOT%20NULL%20OR%20%27x%27%3D%27x` dengan header Authorization Bearer token admin.
- **Respons**: HTTP 200, 5 baris (seluruh mahasiswa), termasuk "Citra Lestari", "Dewi Anggraini", "Eka Putri" yang namanya tidak mengandung huruf "x" — membuktikan filter pencarian benar-benar dilewati, bukan kebetulan cocok.
- **Dampak**: penyerang (dengan akses admin) dapat membaca seluruh tabel mahasiswa terlepas dari kata kunci pencarian; secara prinsip payload serupa (terbukti lewat error 500 pada payload lain) juga bisa dipakai untuk injeksi lanjutan lewat teknik boolean-blind per karakter ke tabel lain (users, dsb), meski ekstraksi penuh di luar cakupan PoC ini.
- **Bukti tambahan**: payload lain seperti `x' OR '1'='1` dan `x' OR 1=1` memicu HTTP 500 dengan pesan server `invalid input syntax for type boolean: "%x"` (dikonfirmasi lewat log container), membuktikan input mentah benar-benar mencapai parser SQL — ini adalah bukti error-based SQL injection yang independen dari payload boolean-true.
- **Skrip**: `scripts/poc/s1-sqli-list-mahasiswa.sh`
- **Kesimpulan**: **TERBUKTI**.

### Temuan sampingan (di luar S1, dicatat untuk transparansi)

Saat menjalankan baseline tanpa parameter `q` sama sekali, `GET /api/mahasiswa` (tanpa query string apa pun) selalu mengembalikan 0 hasil, bukan daftar lengkap seperti yang diharapkan untuk endpoint list admin. Penyebab: `pola` bernilai `null` (JavaScript), dan template `'${pola}'` menghasilkan string literal SQL `'null'`, bukan SQL NULL. Klausa `('null' IS NULL OR ...)` selalu false. Ini adalah bug fungsional (bukan kerentanan keamanan) yang membuat fitur "lihat semua mahasiswa tanpa filter" rusak secara diam-diam. Tidak ada di SEEDED.md, dilaporkan sebagai informasi tambahan, bukan ditambahkan sebagai item ground truth baru.

---

## S2 — SQL Injection pada ORDER BY list cuti admin (rujukan sesi sebelumnya)

**CWE-89 | A03 | Sedang | src/models/cutiModel.js fungsi listAdmin**

Sudah diverifikasi dinamis pada sesi sebelumnya (lihat `hasil-eksperimen/20261010/README.md`). Delapan payload (subquery, CASE WHEN, DROP TABLE, pg_sleep, nama kolom palsu, dan kombinasi sort/order) semuanya ditolak HTTP 400 VALIDATION_ERROR oleh listQuery.js, yang memvalidasi `sort` terhadap whitelist dan `order` terhadap asc/desc SEBELUM nilai mentah dipakai di ORDER BY. Sink di kode (cutiModel.js menggabungkan sort/order mentah) secara statis rentan, tetapi tidak pernah tercapai lewat endpoint publik karena gatekeeper di lapisan controller.

**Kesimpulan: TIDAK TERBUKTI** (tidak ada rantai yang mencapai sink lewat API yang ada).

---

## S3 — SQL Injection pada parameter semester di KHS

**CWE-89 | A03 | Sulit | src/controllers/nilaiController.js fungsi khs; src/models/nilaiModel.js fungsi publishedBySemester**

- **Prasyarat**: peran mahasiswa, mengakses data miliknya sendiri (bukan IDOR).
- **Sink**: `AND ks.semester = '${semester}'` — satu titik substitusi, lebih sederhana dieksploitasi dibanding S1.
- **Langkah serangan**:
  1. Login sebagai andi (mahasiswa).
  2. Baseline: `GET /api/nilai/me/khs?semester=2026-ganjil` → 3 baris tr (header + 2 mata kuliah semester tsb).
  3. Payload: `GET /api/nilai/me/khs?semester=x' OR 'x'='x` → 13 baris tr.
- **Request persis**: `GET /api/nilai/me/khs?semester=x%27%20OR%20%27x%27%3D%27x` dengan header Authorization Bearer token andi.
- **Respons**: halaman KHS menampilkan SEMUA mata kuliah dari SEMUA semester (2025-genap DAN 2026-ganjil) dalam satu halaman, termasuk kode mata kuliah dari semester yang tidak diminta (IF1001, IF1003, IF1006 dari 2025-genap, muncul bersama IF1002, IF1004 dari 2026-ganjil).
- **Dampak**: filter semester dilewati sepenuhnya; mahasiswa dapat melihat data nilai lintas semester dalam satu request, melanggar kontrak endpoint ("KHS per semester"). Secara prinsip, titik injeksi tunggal ini (dibanding S1 yang 4 titik identik) juga lebih mudah dikembangkan menjadi UNION-based untuk membaca tabel lain, meski tidak didemonstrasikan di sini (di luar cakupan PoC minimal).
- **Skrip**: `scripts/poc/s3-sqli-semester-khs.sh`
- **Kesimpulan**: **TERBUKTI**.

---

## S4 — Stored XSS pada nama mata kuliah, dipantulkan ke KHS

**CWE-79 | A03 | Sedang | src/controllers/nilaiController.js fungsi halamanKhs**

- **Prasyarat**: aktor PEMBUAT payload adalah admin (satu-satunya peran yang boleh mengubah data mata kuliah lewat PUT /api/mata-kuliah/:id). Aktor KORBAN adalah mahasiswa mana pun yang mengambil mata kuliah tersebut, saat membuka halaman KHS di browser.
- **Sink**: `<td>${i.nama}</td>` — nama mata kuliah disisipkan langsung ke HTML tanpa escapeHtml, berbeda dari field lain di tabel yang sama (kode, SKS, nilai huruf) yang semuanya memakai escapeHtml.
- **Langkah serangan**:
  1. Login sebagai admin.
  2. PUT /api/mata-kuliah/id-IF1002 dengan `nama` berisi tag script dengan isi `window.__xss_poc_s4=document.cookie||1`.
  3. Login sebagai andi (mahasiswa yang mengambil IF1002 di 2026-ganjil).
  4. GET /api/nilai/me/khs?semester=2026-ganjil.
- **Respons**: body HTML mengandung baris td berisi tag script tersebut secara MENTAH — 1 kemunculan tag script utuh, 0 kemunculan versi ter-escape.
- **Dampak**: skrip arbitrer akan dieksekusi di browser mahasiswa mana pun yang membuka KHS semester tersebut (stored XSS klasik). Vektor realistis di aplikasi ini: akun admin yang disusupi, atau admin lain yang berniat jahat, bisa menjadikan KHS sebagai titik distribusi skrip ke semua mahasiswa yang mengambil mata kuliah itu — berbeda dari reflected XSS yang butuh korban mengklik tautan.
- **Catatan reprodusibilitas**: payload awal yang memakai tanda kutip ganda merusak JSON request saat disisipkan mentah oleh skrip PoC — bug ini sudah diperbaiki di `scripts/poc/s4-stored-xss-mata-kuliah.sh` dengan payload bebas tanda kutip.
- **Skrip**: `scripts/poc/s4-stored-xss-mata-kuliah.sh` (otomatis memulihkan nama mata kuliah ke semula di akhir run).
- **Kesimpulan**: **TERBUKTI**.

---

## S5 — Reflected XSS pada parameter semester di KHS (rujukan sesi sebelumnya)

**CWE-79 | A03 | Mudah | src/controllers/nilaiController.js fungsi khs**

Sudah diverifikasi dinamis pada sesi sebelumnya. Payload tag script dengan alert dan payload img onerror pada parameter semester SELALU dipantulkan dalam bentuk ter-escape. Saat semester kosong, satu-satunya jalur reflected yang tersisa hanya memantulkan string kosong, tidak pernah nilai yang dikirim penyerang.

**Kesimpulan: TIDAK TERBUKTI.**

---

## S6 — Path Traversal pada unduh dokumen (analisis statis, bukan verifikasi dinamis)

**CWE-22 | A01 | Sedang | src/controllers/dokumenController.js fungsi kirimFile**

- **Sink (secara statis rentan)**: `path.join(UPLOAD_DIR, dokumen.path_file)` dilempar ke res.sendFile() tanpa opsi root. Jika path_file berisi `../../etc/passwd`, secara teori path.join akan menghasilkan path di luar UPLOAD_DIR.
- **Penelusuran rantai (hasil: TIDAK ADA jalur)**: satu-satunya tempat kolom path_file ditulis ke database adalah INSERT INTO dokumen_mahasiswa di src/models/dokumenModel.js baris 8, dengan nilai `req.file.filename` (baris 56 dokumenController.js). Nilai itu dibuat oleh konfigurasi multer di src/middleware/upload.js:

  ```js
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + TIPE_FILE[file.mimetype].simpanSebagai)
  ```

  Nama file asli dari klien (file.originalname) sama sekali tidak dipakai untuk membangun path_file — hanya dipakai untuk nama_file_asli (kolom terpisah, ditampilkan apa adanya tapi tidak dipakai di path.join). Pencarian menunjukkan satu-satunya UPDATE pada tabel dokumen_mahasiswa hanya menyentuh kolom status_verifikasi (verifikasi admin), tidak pernah path_file.
- **Kesimpulan**: sink secara kode memang tidak aman (hilang opsi root dan dotfiles deny dibanding versi main), tetapi tidak ada endpoint API mana pun yang membuat path_file terkontrol penyerang. Tidak ada rantai serangan yang bisa dibuktikan secara dinamis dengan permukaan API yang ada saat ini.
- **Status**: **TIDAK TERBUKTI** pada kode saat ini (bukan "membutuhkan rantai", tetapi benar-benar tidak ada rantai yang tersedia lewat API).

---

## S7 — IDOR baca detail cuti milik mahasiswa lain

**CWE-639 | A01 | Sedang | src/models/cutiModel.js fungsi findOwned**

- **Prasyarat**: andi (penyerang) mengetahui atau menebak UUID pengajuan cuti milik budi (korban). Budi punya pengajuan cuti aktif.
- **Sink**: `WHERE c.id = $2` — parameter mahasiswaId yang diterima fungsi findOwned TIDAK PERNAH dipakai di query.
- **Langkah serangan**:
  1. Login sebagai andi dan budi.
  2. (Cari ID cuti budi lewat akunnya sendiri untuk simulasi — di dunia nyata, UUID v4 sulit ditebak brute-force, tapi bisa bocor lewat log, Referer header, atau rekayasa sosial.)
  3. Kontrol negatif: GET /api/cuti/me/00000000-0000-0000-0000-000000000000 dengan token andi → HTTP 404.
  4. Serangan: GET /api/cuti/me/id-cuti-budi dengan token andi.
- **Respons**: HTTP 200, mengembalikan detail lengkap: alasan "Perawatan pasca operasi", alamat_cuti "Jl. Contoh Rawat No. 2, Bandung" (terdekripsi dari pgcrypto), nomor_telepon "081300000002" (terdekripsi).
- **Dampak**: pengungkapan data kesehatan dan kontak pribadi mahasiswa lain tanpa otorisasi — data kategori sensitif menurut PRD §5.1 (Pasal 3 UU PDP).
- **Skrip**: `scripts/poc/s7-idor-baca-cuti.sh`
- **Kesimpulan**: **TERBUKTI**.

---

## S8 — IDOR hapus email tambahan milik mahasiswa lain

**CWE-639 | A01 | Sulit | src/models/profilModel.js fungsi removeEmail**

- **Prasyarat**: andi mengetahui UUID baris email_mahasiswa milik budi.
- **Sink**: `DELETE FROM email_mahasiswa WHERE id = $1` — parameter mahasiswaId diterima fungsi tapi tidak dipakai di query.
- **Langkah serangan**:
  1. Kontrol negatif: DELETE /api/mahasiswa/me/email/00000000-0000-0000-0000-000000000000 dengan token andi → HTTP 404.
  2. Serangan: DELETE /api/mahasiswa/me/email/id-email-budi dengan token andi.
- **Respons**: HTTP 200, `{"success":true,"data":{"id":"...","deleted":true}}`.
- **Verifikasi independen**: budi login dengan akunnya sendiri dan memanggil GET /api/mahasiswa/me/ekspor — array email_tambahan sekarang kosong, mengonfirmasi penghapusan benar-benar terjadi dari sisi korban, bukan artefak respons API penyerang.
- **Dampak**: ini kerentanan paling destruktif yang terbukti — bukan sekadar baca data, tapi mahasiswa mana pun bisa menghapus data milik mahasiswa lain secara permanen tanpa deteksi (tidak ada audit yang mencatat perbedaan pelaku dari pemilik secara jelas).
- **Skrip**: `scripts/poc/s8-idor-hapus-email.sh`
- **Kesimpulan**: **TERBUKTI**.

---

## S9 — Mass Assignment pada update profil mahasiswa

**CWE-915 | A01 | Sedang | src/controllers/mahasiswaController.js fungsi updateMe; src/models/mahasiswaModel.js fungsi updateByUserId**

- **Prasyarat**: peran mahasiswa, menargetkan baris profilnya SENDIRI (bukan IDOR) — tapi lewat kolom yang seharusnya tidak boleh diubah mahasiswa sendiri.
- **Sink**: `const data = { ...req.body }` (controller) tanpa whitelist, diteruskan ke Object.keys(d) untuk membangun klausa SET secara dinamis (model).
- **Langkah serangan**: PUT /api/mahasiswa/me dengan body berisi nim "999999999999", nama "DIUBAH PAKSA MAHASISWA", dan created_at "2000-01-01T00:00:00Z".
- **Respons**: HTTP 200, field nim, nama, dan created_at semuanya berubah sesuai payload, dikonfirmasi lewat GET /api/mahasiswa/me setelahnya.
- **Dampak**: Nomor Induk Mahasiswa (NIM) — identitas akademik yang seharusnya hanya diubah admin — bisa diubah bebas oleh mahasiswa sendiri, termasuk ke nilai yang mungkin bentrok dengan mahasiswa lain (constraint UNIQUE di nim akan menolak nilai yang sudah dipakai, tapi nilai baru yang belum dipakai tetap tersimpan). Nama resmi dan tanggal pembuatan record juga bisa diubah sembarangan.
- **Skrip**: `scripts/poc/s9-mass-assignment-profil.sh` (otomatis memulihkan NIM dan nama andi di akhir run).
- **Kesimpulan**: **TERBUKTI**.

---

## S10 — Mass Assignment status pada pembuatan pengajuan cuti

**CWE-915 | A01 | Mudah | src/controllers/cutiController.js, src/models/cutiModel.js fungsi create**

- **Prasyarat**: peran mahasiswa, tidak sedang punya pengajuan aktif di semester berjalan.
- **Sink**: `if (req.body?.status) data.status = req.body.status;` — satu baris yang secara eksplisit menerima status dari body request.
- **Langkah serangan**: POST /api/cuti/me dengan body termasuk status "disetujui".
- **Respons**: HTTP 200/201, status tersimpan sebagai "disetujui" sejak pembuatan — dikonfirmasi lewat GET /api/cuti/me/:id setelahnya.
- **Dampak**: mahasiswa bisa membuat pengajuan cuti yang langsung "disetujui" tanpa pernah melewati keputusan admin, membatalkan seluruh alur persetujuan yang dirancang sistem.
- **Skrip**: `scripts/poc/s10-mass-assignment-status-cuti.sh`
- **Kesimpulan**: **TERBUKTI**.

---

## S11 — Missing Authorization pada keputusan status cuti

**CWE-862 | A01 | Mudah | src/routes/cutiRoutes.js rute PUT /:id/status**

- **Prasyarat**: andi (BUKAN admin) mengetahui UUID pengajuan cuti milik budi yang masih berstatus diajukan.
- **Sink**: `router.put('/:id/status', c.updateStatus);` — baris ini kehilangan middleware authorize('admin') yang ada di rute GET / dan GET /:id tepat di atasnya.
- **Langkah serangan**:
  1. Kontrol pembanding: GET /api/cuti dengan token andi → HTTP 403 FORBIDDEN (membuktikan middleware auth secara umum berfungsi, hanya rute ini yang bocor).
  2. Serangan: PUT /api/cuti/id-cuti-budi/status dengan token andi, body status "disetujui" dan catatan_admin "PoC S11 - disetujui oleh mahasiswa lain".
- **Respons**: HTTP 200, status cuti budi berubah menjadi "disetujui" dengan catatan_admin yang ditulis andi sendiri.
- **Dampak**: mahasiswa mana pun (bukan hanya pemilik pengajuan — siapa saja yang terautentikasi) bisa menyetujui atau menolak pengajuan cuti mahasiswa lain, menyandera seluruh proses administratif cuti di institusi. Ini kerentanan dengan dampak institusional terluas dari semua yang diuji, karena tidak butuh pengetahuan rahasia apa pun selain UUID pengajuan.
- **Skrip**: `scripts/poc/s11-missing-authz-putuskan-cuti.sh`
- **Kesimpulan**: **TERBUKTI**.

---

## S12 — Paparan data sensitif tanpa audit trail pada list cuti admin

**CWE-359 | A01 | Sulit | src/models/cutiModel.js fungsi listAdmin**

- **Catatan penting soal klasifikasi**: admin SECARA SAH berhak membaca alamat_cuti dan nomor_telepon setiap mahasiswa lewat endpoint detail (GET /api/cuti/:id). Ini BUKAN kasus "unauthorized actor" seperti definisi klasik CWE-359. Yang terbukti bukan AKSES tidak sah, melainkan cara akses itu terjadi melanggar kontrol kepatuhan yang diwajibkan PRD §5.1: "Setiap akses data sensitif WAJIB tercatat di audit_trail".
- **Sink**: listAdmin() menambahkan dekripsi pgp_sym_decrypt untuk alamat_cuti dan nomor_telepon ke SELECT list-nya (berbeda dari versi main yang hanya menampilkan kolom ringkas tanpa dekripsi di list).
- **Pembanding kode**: getById() (baris 95-100 cutiController.js) memanggil audit(req, 'READ_CUTI', ...) setelah mengirim respons. listAdmin() (baris 85-93) tidak memanggil audit() sama sekali.
- **Langkah serangan**:
  1. Hitung baris audit_trail dengan entitas='pengajuan_cuti' SEBELUM: 3.
  2. GET /api/cuti?limit=100 dengan token admin.
  3. Hitung baris audit_trail SESUDAH: 3 (tidak berubah).
- **Respons**: 4 record dikembalikan dalam satu request, masing-masing memuat alamat_cuti dan nomor_telepon dalam bentuk terdekripsi (plaintext), termasuk data mahasiswa yang tidak terkait langsung dengan permintaan admin.
- **Dampak**: pelanggaran kepatuhan yang bisa diperbesar — jika admin memakai limit maksimum yang diizinkan listQuery, seluruh data sensitif seluruh mahasiswa yang punya pengajuan cuti bisa dibaca dalam satu request tanpa jejak audit sama sekali, berbeda drastis dari niat PRD yang mewajibkan audit per akses.
- **Skrip**: `scripts/poc/s12-paparan-data-list-cuti.sh`
- **Kesimpulan**: **TERBUKTI, dengan catatan nuansa klasifikasi** (lebih tepat dibaca sebagai pelanggaran audit/kepatuhan daripada akses tak berwenang murni; CWE-778 "Insufficient Logging" mungkin klasifikasi yang lebih presisi untuk sisi audit-nya, meski CWE-359 tetap relevan untuk sisi paparan datanya).

---

## Ringkasan dampak untuk metrik (perubahan terhadap README eksperimen 20261010)

Dokumen `hasil-eksperimen/20261010/README.md` sebelumnya menghitung metrik atas 10 item positif (S1, S3, S4, S6-S12), mengecualikan S2 dan S5 berdasarkan verifikasi dinamis. Audit kali ini MENAMBAH bukti dinamis untuk 8 item lagi yang sebelumnya hanya berstatus asumsi dari ground truth (S1, S4, S7, S8, S9, S10, S11, S12 — semuanya terbukti), dan MENEMUKAN bahwa S6 ternyata juga tidak punya rantai eksploitasi yang bisa dibuktikan, sama seperti S2 dan S5.

Ini tidak secara otomatis mengubah ground truth — keputusan final (apakah S6 dikeluarkan, diberi catatan "memerlukan rantai hipotetis", atau dipertahankan sebagai item yang diuji tapi gagal dibuktikan) diserahkan sepenuhnya kepada penulis TA, sesuai instruksi audit ini.

| Basis ground truth | Jumlah item | Status |
|---|---|---|
| S1-S12 (asli) | 12 | ground truth asli di SEEDED.md |
| Tanpa S2, S5 | 10 | sudah dipakai di README 20261010 |
| Tanpa S2, S5, S6 | 9 | baru, hasil audit ini, menunggu keputusan |

---

## Keterbatasan verifikasi dinamis ini

1. UUID dipakai langsung untuk IDOR (S7, S8) dengan cara mengetahui ID lewat akun korban sendiri untuk keperluan simulasi laboratorium. Di dunia nyata, UUID v4 sulit ditebak brute-force; eksploitasi realistis memerlukan kebocoran ID lewat kanal lain (log, Referer, riwayat, berbagi tautan).
2. Semua pengujian dilakukan terhadap data sintetis di lingkungan Docker lokal, bukan sistem produksi.
3. Beberapa skenario (S8, S10, S11) bersifat destruktif dan mengubah data secara permanen di volume Docker yang dipakai; data dipulihkan hanya untuk S4 dan S9 karena keduanya mengubah data acuan (mata kuliah, profil identitas) yang dipakai ulang di pengujian lain. S8, S10, S11, S12 meninggalkan jejak perubahan yang disengaja sebagai bukti.
4. S1 dan S3 hanya didemonstrasikan dengan payload boolean-based (bypass filter). Ekstraksi data dari tabel lain lewat UNION-based atau blind SQLi lebih lanjut tidak dikerjakan (di luar cakupan pembuktian minimal untuk TA ini), meski error 500 pada S1 membuktikan jalur error-based juga terbuka.
5. S12 punya nuansa klasifikasi yang perlu didiskusikan dengan dosen pembimbing (lihat catatan di bagian S12).
