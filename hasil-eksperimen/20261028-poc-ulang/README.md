# PoC ulang: race condition kuota SKS pada pengajuan KRS (TOCTOU, CWE-367)

Dijalankan: 2026-10-28, mulai 07:39:45 UTC, selesai 07:41:21 UTC (lihat `mulai`/`selesai` di
`*/ringkasan.json` untuk tiap batch).

Membuktikan ulang dan memperkuat temuan U1/U2/U3 dari laporan FP batch 22 Okt dan 26 Okt (lihat
analisis sebelumnya di sesi ini): celah TOCTOU di `src/controllers/krsController.js` (`submit`)
dan `src/models/krsModel.js`/`src/controllers/krsController.js` (`addItem`, `removeItem`). Tidak
ada baris kode aplikasi yang diubah untuk PoC ini. Skrip PoC lama (`scripts/poc/toctou-krs.sh`)
tidak disentuh; PoC baru ada di `scripts/poc/toctou-krs-v2.js` dan
`scripts/poc/toctou-krs-remove-v2.js`.

## Lingkungan

| Butir | Nilai |
|---|---|
| Commit kode (worktree `objek-seeded`, branch `eksperimen/seeded`) | `afb52bfee81f57fb79a6bc80b189888123623e49` (2026-10-26) |
| Pohon kerja | Bersih sebelum dan sesudah PoC (hanya menambah berkas baru di `scripts/poc/` dan `hasil-eksperimen/20261028-poc-ulang/`, keduanya tidak dicommit) |
| Node.js (host, menjalankan skrip PoC) | v25.2.1 |
| Node.js (image `app`, `node:20-alpine`) | v20.20.2 |
| PostgreSQL | 16.15 (image `postgres:16-alpine`) |
| Docker | 28.3.2, Docker Compose v2.39.1-desktop.1 |
| Stack | `docker compose up -d --build --wait app db` dari root `objek-seeded`, lalu `seed:admin` dan `seed:dummy` di dalam container `app` |
| Target | `http://localhost:3000` saja. Tidak ada jaringan luar |
| Aktor | `citra@mahasiswa.test` (IPS < 2,00 -> kuota 15 SKS, dikonfirmasi API: `GET /api/krs/me` mengembalikan `"kuota":15`) |

Catatan container: nama container `ta_ssdlc_db` sempat dipakai container lama milik proyek
`ta-ssdlc-devops-akademik` (exited, 37 jam sebelumnya). Container lama itu dihapus (`docker rm`,
tanpa `-v`) untuk membebaskan nama; volume datanya (`ta-ssdlc-devops-akademik_db_data`) tidak
disentuh dan tetap terpisah dari volume baru (`objek-seeded_db_data`).

## (a) Cara kerja PoC lama dan sebab laju rendahnya

`scripts/poc/toctou-krs.sh` (tidak diubah) mengirim **satu** `POST /api/krs/me/items` (menambah
mata kuliah `IF1004`, 3 SKS) dan **satu** `POST /api/krs/me/submit` secara paralel, lalu memeriksa
status akhir. Baseline KRS: 13 SKS (di bawah kuota 15), sehingga kalau `addItem` menang race,
total jadi 16 (> kuota).

Alur server, dibaca dari kode (tidak diubah di sini):
- `addItem` (`krsController.js:60-74`): baca header (`getOrCreateHeader`, 2 round-trip DB: INSERT
  ON CONFLICT DO NOTHING lalu SELECT), cek `status === 'draft'`, lalu `INSERT` item (round-trip
  ke-3). **Tidak ada pengecekan ulang status saat INSERT dieksekusi.**
- `submit` (`krsController.js:91-115`): baca header (round-trip 1), baca semua item
  (`listItems`, round-trip 2) -> jumlah SKS dihitung dari sinilah, lalu `hitungKuota` (1-2
  round-trip tambahan, menghitung IPS dari nilai semester lalu), baru kemudian cek kuota, dan
  `transition` (`UPDATE ... WHERE status='draft'`, round-trip terakhir).

Karena `addItem` butuh lebih sedikit round-trip (3) daripada seluruh rangkaian `submit` sampai
`UPDATE`-nya (5-6), kemenangan `addItem` TUNGGAL biasanya selesai lebih dulu dan **sudah
ter-commit sebelum `submit` membaca daftar item** (round-trip ke-2 `submit`). Akibatnya hampir
selalu `submit` membaca total yang SUDAH termasuk item balapan (16 > 15) dan gagal di pengecekan
kuota (status tetap `draft`, tapi item sudah tertambah — makanya `toctou-krs.txt` lama mencatat
`total=16` di SEMUA 30 percobaan, menang atau tidak). **Menang** hanya terjadi pada kasus sempit:
`submit` membaca daftar item (round-trip 2) TEPAT sebelum INSERT `addItem` ter-commit (jendela
antara dua round-trip tunggal yang durasinya mirip), sehingga `submit` lolos kuota dengan baseline
13 SKS, DAN `addItem` tetap berhasil INSERT karena pengecekan statusnya sudah lolos sebelum
`UPDATE` `submit` ter-commit. Dengan hanya satu percobaan addItem per trial, jendela ini kecil:
hasil lama 1/30 menang (laporan README batch 19 Okt juga menyebut variasi run lain 5/30).

## (b) PoC baru: membuka jendela dengan banyak percobaan paralel

### U1 dan U2 — diukur dari race yang sama

`toctou-krs-v2.js`: setiap trial mengatur ulang KRS Citra ke baseline 13 SKS (`IF1001`+`IF1003`
ditambah dua mata kuliah bawaannya), lalu mengirim **1x `POST /submit`** bersamaan dengan **5x
`POST /items`** paralel untuk 5 mata kuliah berbeda (`IF1004`, `IF1005`, `IF1006`, `IF1008`,
`IF1009` — seluruh mata kuliah seed yang tersisa). Tidak ada delay buatan; satu-satunya perubahan
dari PoC lama adalah jumlah percobaan `addItem` paralel (5, bukan 1), sesuai arahan tugas.

U1 dan U2 dihitung dari **state akhir yang sama** (bukan dua eksperimen terpisah), karena
kriteria "menang" keduanya adalah pembacaan berbeda atas satu mekanisme balapan yang sama:
- **U1 (kuota SKS dilanggar)**: `status === 'submitted'` DAN `total_sks > 15`.
- **U2 (item masuk ke KRS yang sudah disetujui)**: `status === 'submitted'` DAN setidaknya satu
  dari 5 mata kuliah balapan ada di daftar item akhir (terlepas dari kuota).

| Batch | n | U1 menang | laju U1 | Wilson 95% U1 | U2 menang | laju U2 | Wilson 95% U2 |
|---|---|---|---|---|---|---|---|
| 1 | 200 | 200 | 1,000 | [0,981 ; 1,000] | 200 | 1,000 | [0,981 ; 1,000] |
| 2 | 200 | 200 | 1,000 | [0,981 ; 1,000] | 200 | 1,000 | [0,981 ; 1,000] |
| 3 | 200 | 200 | 1,000 | [0,981 ; 1,000] | 200 | 1,000 | [0,981 ; 1,000] |
| **Gabungan** | **600** | **600** | **1,000** | **[0,994 ; 1,000]** | **600** | **1,000** | **[0,994 ; 1,000]** |

Tidak ada anomali reset di 600 trial manapun. Pada sebagian besar trial, SELURUH 5 mata kuliah
balapan berhasil ditambahkan (total akhir 28 SKS, hampir dua kali kuota); contoh sebaran di
`batch-1.jsonl` baris pertama sampai ketiga: 16, 28, 21 SKS, status `submitted` di semuanya.

**Penjelasan dari data ini** (bukan dugaan): karena `submit` butuh lebih banyak round-trip DB
sebelum `UPDATE`-nya (termasuk `hitungKuota`), sedangkan `addItem` hanya butuh 3, pembacaan kuota
`submit` (round-trip ke-2) hampir selalu terjadi SEBELUM satu pun dari 5 INSERT `addItem` selesai
— sehingga kuota selalu lolos dengan baseline 13. Sementara itu, SELURUH 5 pengecekan status
`addItem` (masing-masing operasi cepat) hampir selalu selesai sebelum `UPDATE` `submit` yang lebih
lambat, sehingga seluruhnya lolos pengecekan status draft dan berhasil INSERT. Dengan 5 percobaan
paralel, kombinasi ini terjadi hampir pasti; dengan 1 percobaan (PoC lama) kombinasi yang sama
hanya kadang terjadi.

### U3 — race `removeItem` vs `submit`

`toctou-krs-remove-v2.js`: setiap trial mengatur ulang KRS Citra ke 5 item (`IF1002`, `IF1007`
bawaan, ditambah `IF1003`, `IF1006`, `IF1009`; total 14 SKS, di bawah kuota 15), lalu mengirim
**1x `POST /submit`** bersamaan dengan **5x `DELETE /items/:id`** paralel untuk kelima item itu.

- **U3 (item hilang dari KRS yang sudah disetujui)**: `status === 'submitted'` DAN setidaknya
  satu dari 5 item target hilang dari daftar item akhir.

| Batch | n | U3 menang | laju | Wilson 95% |
|---|---|---|---|---|
| 1 | 200 | 200 | 1,000 | [0,981 ; 1,000] |
| 2 | 200 | 199 | 0,995 | [0,972 ; 0,999] |
| 3 | 200 | 200 | 1,000 | [0,981 ; 1,000] |
| **Gabungan** | **600** | **599** | **0,998** | **[0,991 ; 1,000]** |

Tidak ada anomali reset. Pada sebagian besar trial, SELURUH 5 item hilang (total akhir 0 SKS,
`status submitted`). Satu trial di batch 2 kalah: salah satu `DELETE` kembali `409 CONFLICT`
(status sudah `submitted` saat pengecekannya jalan), sehingga satu item (`IF1009`) tetap ada —
trial itu masih menang (item lain tetap hilang). `removeItem` hanya butuh 2 round-trip
(`findItemOwned` lalu `DELETE`), lebih sedikit dari `addItem`, sehingga laju menangnya bahkan
lebih tinggi daripada U1/U2.

## (c) Path semua berkas keluaran

```
hasil-eksperimen/20261028-poc-ulang/
  README.md                                  (berkas ini)
  u1-u2-addItem-vs-submit/
    batch-1.jsonl   batch-2.jsonl   batch-3.jsonl   (mentah, 1 baris JSON per trial, tidak dipilih-pilih)
    ringkasan.json                              (Wilson 95% per batch dan gabungan)
  u3-removeItem-vs-submit/
    batch-1.jsonl   batch-2.jsonl   batch-3.jsonl
    ringkasan.json
scripts/poc/
  toctou-krs-v2.js        (U1 dan U2, baru; tidak menimpa toctou-krs.sh)
  toctou-krs-remove-v2.js (U3, baru)
```

Setiap baris JSONL memuat: nomor trial, nomor batch, timestamp mulai/selesai race, hasil mentah
setiap panggilan paralel (status HTTP, body JSON, timestamp per panggilan), state akhir KRS
(`status`, `total_sks`, daftar kode item), dan hasil evaluasi kriteria menang.

**Parameter pemanggilan**: 5 permintaan `addItem`/`removeItem` paralel + 1 `submit` per trial;
200 trial per batch; 3 batch per skenario; reset penuh (unsubmit + hapus + tambah ulang item,
dikonfirmasi lewat `GET /api/krs/me`) sebelum setiap trial, dijalankan berurutan (bukan paralel
antar trial). Tidak ada `sleep` atau delay buatan di titik mana pun dalam race itu sendiri.

## (d) Hal yang tidak dapat dipastikan

- **Urutan round-trip DB yang tepat** (misalnya apakah `hitungKuota` benar-benar 1 atau 2
  round-trip) disimpulkan dari membaca kode, bukan dari instrumentasi database langsung (tidak
  ada query log Postgres yang diaktifkan). Penjelasan laju menang 100% bersifat masuk akal dari
  kode dan konsisten dengan data, tetapi bukan bukti bertingkat-waktu per query.
- **Laju menang ini bukan properti universal** dari aplikasi: bergantung pada jumlah round-trip
  relatif `addItem`/`removeItem` terhadap `submit`, yang bisa berbeda di mesin lain (latensi DB,
  beban CPU). Angka 100% dan 99,8% di atas adalah hasil pada satu mesin, satu waktu, bukan laju
  tetap untuk semua lingkungan — sama seperti catatan non-determinisme di PoC lama.
  Tidak ada percobaan dijalankan kedua kali di hari/mesin yang berbeda.
- **Dampak di produksi nyata** (bukan stack lokal data sintetis) tidak diuji dan tidak diklaim.
- Trial yang gagal pada tahap reset (`anomali_reset`) akan dilaporkan terpisah dan tidak masuk
  hitungan menang/kalah; pada ketiga skenario di atas jumlahnya 0 untuk U1/U2 dan 0 untuk U3.
