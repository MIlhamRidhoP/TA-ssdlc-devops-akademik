# PoC Skenario Serangan

Skrip di folder ini adalah bukti konsep (Proof of Concept) untuk kerentanan tertanam
di branch `eksperimen/seeded`, dipakai untuk riset TA (SSDLC + analisis keamanan berbasis
LLM). Dijalankan HANYA terhadap stack Docker Compose lokal berisi data sintetis milik
proyek ini sendiri. Bukan alat serangan umum dan tidak ditujukan ke sistem pihak lain.

Ringkasan hasil ada di `hasil-eksperimen/20261010/SKENARIO_SERANGAN.md`.

## Prasyarat

```
docker compose up -d --build --wait app db
docker compose exec -T app npm run seed:admin
docker compose exec -T app npm run seed:dummy
```

`.env` di root repo harus berisi `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SEED_USER_PASSWORD`,
`SEMESTER_AKTIF`. Skrip membaca variabel ini lewat `source ../../.env`, TIDAK menyimpan
nilainya sendiri.

## Cara pakai

```
cd scripts/poc
./00-login.sh            # cetak token admin, andi (korban/penyerang bergantian), budi
source ./00-login.sh     # atau di-source langsung supaya token tersedia di shell saat ini
./s1-sqli-list-mahasiswa.sh
./s3-sqli-semester-khs.sh
./s4-stored-xss-mata-kuliah.sh
./s7-idor-baca-cuti.sh
./s8-idor-hapus-email.sh
./s9-mass-assignment-profil.sh
./s10-mass-assignment-status-cuti.sh
./s11-missing-authz-putuskan-cuti.sh
./s12-paparan-data-list-cuti.sh
```

Setiap skrip:
1. Menjalankan baseline (perilaku sah / kontrol negatif).
2. Menjalankan payload serangan.
3. Mencetak kesimpulan `TERBUKTI`, `TERBUKTI DENGAN RANTAI`, atau `TIDAK TERBUKTI`.
4. Memulihkan data yang diubah, jika ada (S4, S9). S8, S10, S11, S12 mengubah data
   secara permanen di volume Docker sebagai bagian dari pembuktian (hapus email,
   buat pengajuan, atau ubah status cuti) — ini wajar untuk kerentanan yang memang
   integritas datanya diserang.

## Kerentanan yang TIDAK punya skrip di sini

- **S2, S5**: sudah diverifikasi di sesi sebelumnya (lihat
  `hasil-eksperimen/20261010/README.md`), ringkasannya digabung di
  `SKENARIO_SERANGAN.md`.
- **S6**: tidak ada jalur API untuk membuat `path_file` terkontrol penyerang (hanya
  diisi sekali saat upload lewat `crypto.randomUUID()` dari multer, tidak ada endpoint
  UPDATE untuk kolom itu). Dianalisis statis, tidak ada skrip dinamis.
