# Bukti Integrasi Pipeline — Run Gemini di GitHub Actions

Tanggal: 2026-10-10. Run: GitHub Actions workflow SonarCloud, event `workflow_dispatch`,
branch `eksperimen/seeded`, commit `467775e`. Run id Actions: `38046736285`. Job `gemini-scan`
(Skenario B) selesai dengan status **success**.

**Status: ini BUKTI INTEGRASI, bukan data eksperimen utama.** Data utama tetap 3 run terkontrol
di `hasil-eksperimen/20261010/flash/`. Run CI ini hanya 1 run, dijalankan otomatis oleh pipeline,
untuk membuktikan bahwa Skenario B BISA berjalan end-to-end di GitHub Actions (menjawab butir 1
AUDIT_KEKURANGAN.md).

## Isi folder

| File | Keterangan |
|---|---|
| `prompt-lengkap.sha256` | hash prompt versi CI (LF) |
| `run-1.json`, `run-1.score.json` | hasil dan penilaian 1 run CI |
| `summary.json` | ringkasan run (durasi, biaya, tarif) |
| `sonar-issues.json`, `sonar-hotspots.json`, `sonar-temuan.json` | data SonarCloud yang dikirim ke prompt |

`run-1.raw.json` sengaja tidak disalin (kebijakan sama dengan arsip utama). Field `author` di
`sonar-issues.json` sudah diredaksi menjadi `[redacted]`.

## Perbandingan hash prompt

| Sumber | SHA-256 | Line ending |
|---|---|---|
| Lokal (arsip utama) | `de8f35e00b5682581d03fd605306c650f42e1813112d871657ba71589a78c49c` | 45 baris CRLF, sisanya LF |
| CI (folder ini) | `355989292f5e81ac494a8d51f28ce9afa44dfadf3eda60f0fc3d1c7d61ad38b8` | semua LF |
| **Setelah normalisasi LF** (kedua sumber) | `355989292f5e81ac494a8d51f28ce9afa44dfadf3eda60f0fc3d1c7d61ad38b8` | — |

**Hash berbeda, tetapi konten identik.** Penyebab: 45 file/baris sumber di `src/` ter-checkout
dengan CRLF di mesin Windows lokal, dan dengan LF di runner Ubuntu CI (perilaku git eol/autocrlf
antar platform). Setelah menghapus semua byte `\r`, kedua prompt byte-identik (hash
`355989292f5e...`). Bagian LAPORAN SONARCLOUD di prompt juga diverifikasi identik (26 issue sama
persis). Jadi prompt CI dan prompt lokal secara semantik sama; perbedaan hash murni artefak
line-ending platform, bukan perbedaan isi.

Implikasi reprodusibilitas: untuk membuktikan dua run memakai prompt yang sama lintas platform,
bandingkan hash **setelah normalisasi line-ending**, bukan hash mentah. Alternatif: tambahkan
`* text=auto eol=lf` yang lebih ketat di `.gitattributes`, atau normalisasi `\r` di dalam
`gabungKodeSumber` sebelum hashing — keduanya tidak dilakukan di sini agar tidak menyentuh
`susunPrompt` dan data yang sudah diambil.

## Hasil run CI vs 3 run lokal (basis lama S1-S12, ketat)

| Run | TP | FP | Recall | F1 | Temuan | Durasi bersih | Biaya (estimasi paid) |
|---|---|---|---|---|---|---|---|
| CI (1 run) | 7 | 0 | 0,583 | 0,737 | 9 | 131,0 s | $0,0619 |
| Lokal run 1 | 7 | 0 | 0,583 | 0,737 | 8 | 237,2 s | $0,0596 |
| Lokal run 2 | 7 | 0 | 0,583 | 0,737 | 8 | 196,1 s | $0,0667 |
| Lokal run 3 | 6 | 0 | 0,500 | 0,667 | 8 | 112,7 s | $0,0841 |

Run CI jatuh persis di dalam rentang 3 run lokal (TP 6-7, recall 0,5-0,583). model_version yang
dilaporkan API sama: `gemini-3.8-flash`. finish_reason STOP, parse JSON valid. Field baru hasil
perbaikan Langkah 2 (durasi_bersih_ms, durasi_total_ms, biaya_usd, tarif) semuanya terisi di
output CI, membuktikan versi skrip terbaru yang jalan.

Kesimpulan: integrasi pipeline Skenario B berhasil dan menghasilkan output dalam distribusi yang
sama dengan eksperimen lokal terkontrol. Angka run CI tidak digabung ke metrik utama (hanya 1 run,
bukan 3), tetapi mengkonfirmasi klaim bahwa framework benar-benar berjalan sebagai pipeline DevOps,
bukan hanya skrip lokal.

Catatan: run CI ini memakai basis ground truth LAMA (S1-S12 penuh, S2/S5 dikecualikan) karena
dijalankan sebelum reklasifikasi ground truth. Penilaian ulang dengan status ground truth baru
(9 positif + jebakan FP + laten) ada di `run-1.score.json` jika di-score ulang setelah SEEDED.md
diperbarui; angka di tabel ini tetap memakai basis lama untuk perbandingan apples-to-apples dengan
3 run lokal yang juga dicatat di basis lama.
