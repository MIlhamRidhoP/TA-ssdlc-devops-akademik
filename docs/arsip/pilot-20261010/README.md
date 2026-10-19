# Arsip pilot 10 Oktober 2026 (results.json skema 1)

Data demo jalur v1 (`gemini-scan.js` + `merge-results.js`), dipakai Security Dashboard
sampai renderer v1 dipensiunkan. Disimpan apa adanya sebagai arsip; dashboard tidak lagi
menampilkannya.

| Berkas | Isi |
|---|---|
| `index.json` | Daftar tiga run demo pada branch `eksperimen/seeded` |
| `eksperimen/seeded/3.json` | Run sast-llm, 11 temuan, dengan blok `metrics` |
| `eksperimen/seeded/2.json` | Run sast (Sonar saja) |
| `eksperimen/seeded/1.json` | Run dengan analisis LLM gagal, **sintetis** |
| `jobs.json` | Durasi job demo, **sintetis** |

Skemanya ada di [`docs/design/results.schema.json`](../../design/results.schema.json), yang
sengaja tidak dihapus supaya berkas di sini tetap bisa divalidasi.

Mengapa dipensiunkan: skema 1 menurunkan status alert dari pencocokan file, baris, dan CWE,
bukan dari putusan model. Jalur v2 mengirim tiap alert ke model dalam panggilan verifikasi
tersendiri, sehingga statusnya adalah jawaban model. Kedua skema tidak kompatibel, dan
menampilkan keduanya berdampingan membuat arti kolom yang sama berbeda tergantung run.

Data eksperimen utama 19 Oktober 2026 ada di branch `eksperimen/seeded`, folder
`hasil-eksperimen/20261019/`.
