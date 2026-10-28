# Verifikasi penuh temuan di luar ground truth (Tahap 2)

Dijalankan: 2026-10-28, 08:06-08:08 UTC. Lingkungan sama dengan
`hasil-eksperimen/20261028-poc-ulang/README.md` (commit `afb52bfee81f57fb79a6bc80b189888123623e49`,
Node host v25.2.1, Node image v20.20.2, PostgreSQL 16.15, `citra/andi/eka` dari
`scripts/seed-dummy.js`). Stack, image, dan volume dibuat ulang untuk sesi ini dan dibersihkan
sesudahnya (`docker compose down`, `docker volume rm objek-seeded_db_data`,
`docker image rm objek-seeded-app`). Tidak ada baris di `src/` yang diubah.

## 2a. Daftar tunggal temuan unik, semua laporan deteksi tak cocok, semua model, eksperimen 1 dan 2

Sumber: hitung ulang `scripts/llm/score.js` (`skorRunDeteksi`) atas seluruh `run-N.json` mentah
eksperimen 1 (`20261022-gabungan/utama/`) dan eksperimen 2 (`20261026-dua-sast/llm-output/`,
lengan uji dan kontrol), status `di luar ground truth`, `false positive dikenal`, dan
`hardening di luar ground truth` (kategori terakhir dikeluarkan dari FP ketat oleh skrip, tapi
diikutkan di sini karena tiga dari delapan temuan unik di bawah hanya pernah muncul dengan sifat
`hardening`). Total 43 laporan (32 FP ketat + 11 hardening-di-luar), mengelompok jadi **8 temuan
unik** berdasar (file, fungsi):

| Temuan | File:fungsi | Model (laporan) | CWE yang dipakai | Eksperimen | Status sebelum Tahap 2 |
|---|---|---|---|---|---|
| E1 | `krsController.js` submit | Gemini, GPT (n=8) | 367, 362 | 1, 2 | Terbukti PoC (`toctou-krs.sh`, 1/30) |
| E2 | `krsModel.js`/`krsController.js` addItem | GPT (n=9) | 367 | 1, 2 | Teoretis |
| E3 | `krsModel.js`/`krsController.js` removeItem | GPT (n=9) | 367 | 1, 2 | Teoretis |
| E4 | `profilModel.js` createEmail | GPT (n=2) | 362 | 1, 2 | Teoretis |
| E5/E6 | `cutiController.js` listAdmin | Claude (n=5) | 89, 1287, 20 | 2 | Belum diuji |
| E7 | `requireConsent.js` (module.exports) | Claude (n=2) | 755 | 1, 2 | Belum diuji |
| E8 | `konsenController.js` create | Claude (n=1) | 840 | 2 | Belum diuji |
| E9 | `authController.js` login | Gemini, Claude (n=7, semua `sifat: hardening`) | 307 | 1, 2 | Duplikat B3 (sudah terbukti statis) |

Rincian 43 baris mentah: `C:\codeql-work\hasil-batch\tahap2a-mentah.json` (di luar repo, dibuat
untuk analisis ini; sesuai aturan baca-saja, tidak disalin ke sini).

Sejak Tahap 1, E1/E2/E3 sudah **terbukti PoC** (lihat `20261028-poc-ulang/README.md`): E1 600/600,
E2 600/600, E3 599/600.

## 2b. Putusan dapat-diuji

| Temuan | Dapat diuji? | Alasan |
|---|---|---|
| E1, E2, E3 | Sudah diuji (Tahap 1) | — |
| E4 | Ya | Klaim konkret dan dapat diamati dari luar: jumlah email akhir vs `MAKS_EMAIL`. |
| E5/E6 | **Tidak** | Klaim tentang gaya penanganan default `sort`/`order` yang tidak konsisten antar CWE yang dipilih model sendiri (89/1287/20 untuk lokasi yang sama); bukan klaim tereksploitasi yang bisa diberi kriteria menang/kalah, dan lokasinya (`cutiController.js`, bukan `cutiModel.js`) membuatnya konseptual duplikat dari jebakan S2 tanpa jadi match literal. |
| E7 | Ya | Klaim konkret (proses macet/crash) dan dapat diamati dari luar lewat `/health` dan kode status. |
| E8 | Ya | Klaim konkret (`is_minor` berubah, gerbang `requireConsent` terlewati) dan dapat diamati langsung dari respons API. |
| E9 | Ya | Klaim ketidakhadiran (tidak ada rate limiting); diamati lewat kode status berulang. Duplikat dari B3 yang sudah terbukti analisis statis (tidak ada middleware rate-limit di `app.js` atau `authRoutes.js`); dijalankan untuk melengkapi data dinamis, bukan karena diragukan. |

## 2c dan 2d. PoC baru, hasil, dan kesimpulan

Semua skrip baru di `objek-seeded/scripts/poc/` (tidak menimpa yang lama); definisi "menang"
ditulis di kepala tiap berkas SEBELUM kode dijalankan, dikutip di bawah apa adanya.

### E4 — race batas jumlah email (`scripts/poc/email-race-v2.js`)

> "MENANG jika jumlah email akhir > MAKS_EMAIL (5)" — baseline 4 email, 5 permintaan `POST
> /api/mahasiswa/me/email` paralel, metode sama dengan `toctou-krs-v2.js`.

| Batch | n | Menang | Laju | Wilson 95% |
|---|---|---|---|---|
| 1 | 200 | 200 | 1,000 | [0,981 ; 1,000] |
| 2 | 200 | 200 | 1,000 | [0,981 ; 1,000] |
| 3 | 200 | 199 | 0,995 | [0,972 ; 0,999] |
| **Gabungan** | **600** | **599** | **0,998** | **[0,991 ; 1,000]** |

Tidak ada anomali reset. **Kesimpulan: TERBUKTI.** Jumlah email akhir tipikal 8-9 dari baseline 9
(4 lama + 5 balapan), jauh melebihi batas 5.

### E7 — middleware async tanpa `next(err)` (`scripts/poc/requireconsent-crash-v2.js`)

> "MENANG (klaim terbukti) jika timeout/connection-reset ATAU `/health` berhenti merespons.
> TIDAK MENANG jika seluruh percobaan dibalas JSON 403 CONSENT_REQUIRED rapi dan `/health` tetap
> sehat."

60 percobaan sekuensial (20 per rute: `/api/krs/me`, `/api/cuti/me`, `/api/nilai/me`), aktor Eka
(minor, tanpa konsen).

| Hasil | Jumlah |
|---|---|
| Respons 403 CONSENT_REQUIRED rapi + `/health` sehat | 60/60 |
| Timeout, connection-reset, atau `/health` mati | 0/60 |

**Kesimpulan: TIDAK TERBUKTI.** Aplikasi memakai Express 5.2.1 (`package.json`), yang membungkus
middleware async dan meneruskan promise yang *reject* ke error handler secara otomatis — bukan
Express 4 seperti diasumsikan klaim Claude. Tidak ada indikasi proses menggantung atau crash pada
60 percobaan.

### E8 — manipulasi `is_minor` lewat `updateMe` (`scripts/poc/is-minor-bypass-v2.js`)

> "E8a MENANG jika PUT diterima (200/201) DAN gerbang konsen terlewati pada panggilan
> berikutnya. E8b MENANG jika field `is_minor` pada GET berikutnya benar berubah."

10 trial sekuensial (Eka untuk E8a, Andi untuk E8b), dipulihkan lewat jalur admin tiap trial.

| Sub-uji | Menang | Hasil yang konsisten di 10/10 trial |
|---|---|---|
| E8a (Eka set `is_minor:false`) | 0/10 | `PUT /api/mahasiswa/me` selalu `500 INTERNAL_ERROR` |
| E8b (Andi set `is_minor:true`) | 0/10 | `PUT /api/mahasiswa/me` selalu `500 INTERNAL_ERROR` |

**Kesimpulan: TIDAK TERBUKTI.** Kolom `is_minor` ada di tabel `users`, bukan di tabel `mahasiswa`.
`updateByUserId` (dipakai `updateMe`) membangun `UPDATE mahasiswa SET ${kolom}` langsung dari
`Object.keys(req.body)` tanpa mengecualikan `is_minor`, sehingga SQL yang dihasilkan mengacu ke
kolom yang tidak ada di tabel itu dan PostgreSQL menolaknya (`42703`), ditangkap `errorHandler.js`
sebagai `500 INTERNAL_ERROR`. Mass assignment nyata lewat `updateMe` (S9, sudah ground-truthed,
PoC `s9-mass-assignment-profil.sh` pada field `nim`/`nama`) tetap berlaku untuk kolom yang memang
ada di tabel `mahasiswa`; klaim spesifik soal `is_minor` tidak berlaku lewat mekanisme ini.

### E9 — tidak ada rate limiting login (`scripts/poc/login-ratelimit-v2.js`)

> "MENANG (klaim 'tidak ada rate limiting' terbukti) jika seluruh 50 percobaan dibalas 401,
> tidak satu pun diblokir."

50 percobaan login gagal berurutan, 3,27 detik.

| Hasil | Jumlah |
|---|---|
| 401 (diproses normal) | 50/50 |
| 429 atau kode blokir lain | 0/50 |

**Kesimpulan: TERBUKTI** (duplikat dari B3, yang sudah terbukti lewat pembacaan kode statis:
tidak ada `express-rate-limit` atau middleware sejenis di `package.json`, `app.js`, maupun
`authRoutes.js`). Data dinamis ini melengkapi, bukan mengganti, bukti statis B3.

## Path berkas

```
hasil-eksperimen/20261028-verifikasi-penuh/
  README.md
  e4-email-race/batch-1.jsonl   batch-2.jsonl   batch-3.jsonl
  e7-requireconsent/trial.jsonl
  e8-is-minor/trial.jsonl
  e9-login-ratelimit/trial.jsonl
scripts/poc/
  email-race-v2.js
  requireconsent-crash-v2.js
  is-minor-bypass-v2.js
  login-ratelimit-v2.js
```

## Hal yang tidak dapat dipastikan

- E5/E6 sengaja tidak diberi PoC (lihat 2b); kebenarannya tetap "belum diuji", bukan "diuji aman".
- Laju menang E4 (599/600) adalah hasil satu mesin satu waktu, bukan laju tetap untuk lingkungan
  lain, sama seperti catatan di `20261028-poc-ulang/README.md`.
- E7 dan E8 hanya diuji lewat jalur yang dirancang skrip ini (tiga rute tertentu untuk E7, dua
  arah untuk E8); jalur lain yang memakai middleware/kolom yang sama tidak diuji satu per satu.
- E9 tidak menguji apakah ada rate limiting di LAPISAN LAIN (reverse proxy, WAF) karena stack ini
  hanya aplikasi dan database, tanpa proxy di depannya.
