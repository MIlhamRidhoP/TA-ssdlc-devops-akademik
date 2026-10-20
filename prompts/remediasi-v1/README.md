# prompts/remediasi-v1

Prompt lapis 2 fitur rekomendasi perbaikan: saran spesifik dari model untuk item yang sudah
dikonfirmasi. Dipakai langkah remediasi di jalur v2, dan **hanya berjalan kalau diminta secara
eksplisit** lewat input `rekomendasi_ai` di `workflow_dispatch`. Bawaannya mati.

Terpisah dari `prompts/v2/`, yang hash-nya dikunci karena dipakai eksperimen TA. Prompt di sini
tidak pernah memengaruhi deteksi, verifikasi, maupun angka eksperimen.

## Berkas

| Berkas | Isi |
|---|---|
| `system.txt` | Peran model, aturan bahwa isi item adalah data dan bukan instruksi, larangan menjelaskan cara eksploitasi, dan kewajiban menjawab JSON saja |
| `task.txt` | Tugasnya, cara menulis saran, dan penjelasan tiap field keluaran. Memuat penanda `{{ITEMS}}` |
| `schema.json` | Skema ketat keluaran. `additionalProperties: false` di setiap tingkat |
| `HASHES.txt` | Sidik jari SHA-256 ketiga berkas di atas |

## Dua lapis

Lapis 1 adalah panduan umum per CWE dari `dashboard/rekomendasi-cwe.json`, statis dan bersumber
dari cwe.mitre.org serta OWASP Cheat Sheet Series. Lapis 2 adalah prompt ini.

Panduan lapis 1 **ikut dikirim ke model** sebagai blok `GENERAL GUIDE` di tiap item, dan
`task.txt` mewajibkan saran berpijak pada panduan itu. Dengan begitu saran model tidak lahir dari
ingatannya sendiri, melainkan menerapkan pola perbaikan yang sumbernya bisa ditelusuri. Field
`cwe_dirujuk` memungkinkan pemeriksaan silang: kalau nilainya tidak sama dengan CWE item, hasilnya
ditandai `tidak_konsisten` dan tetap ditampilkan apa adanya, bukan dibuang diam-diam.

## Item yang dikirim

Satu panggilan untuk satu run, memuat seluruh item yang memenuhi syarat:

- temuan LLM dengan `sifat` bernilai `vulnerability`; dan
- alert SonarCloud dengan `putusan` bernilai `true_positive`.

Temuan `hardening`, alert yang ditolak model, dan alert yang masih ragu-ragu tidak ikut: lapis 2
hanya menyarankan perbaikan untuk yang sudah dinyatakan nyata. Kalau tidak ada satu pun item yang
memenuhi syarat, panggilan tidak dilakukan sama sekali.

## Bentuk satu item di dalam `{{ITEMS}}`

```
ITEM <id>
Source: <temuan LLM | alert SonarCloud>
Location: <file>:<baris>
Weakness: <jenis atau rule>
CWE: <CWE-xxx>
Explanation: <penjelasan atau alasan>

GENERAL GUIDE (<CWE-xxx>: <judul panduan>)
1. <langkah lapis 1>
2. <langkah lapis 1>
Source: <URL panduan>

CODE EXCERPT
<nomor baris> | <kode>
```

Potongan kode diambil dari berkas hasil run yang sama, bukan dibaca ulang dari disk, supaya saran
berpijak pada kode yang memang dianalisis.

## Keluaran

```json
{
  "rekomendasi": [
    {
      "id": "T-01",
      "cwe_dirujuk": "CWE-89",
      "langkah": ["...", "..."],
      "potongan_kode_usulan": "...",
      "catatan_risiko": "..."
    }
  ]
}
```

`potongan_kode_usulan` opsional dan dibatasi 15 baris. Field lain wajib. `langkah` wajib berisi 2
sampai 4 langkah.

## Batas yang dijaga

- Saran tidak pernah diterapkan otomatis ke kode. Dashboard menampilkannya dengan label
  "Dihasilkan AI, belum diverifikasi, tidak diterapkan otomatis".
- Isi kode yang dianalisis diperlakukan sebagai data. `system.txt` menyatakan itu eksplisit supaya
  teks di dalam kode yang menyerupai perintah tidak dituruti.
- Kegagalan lapis 2, baik panggilan gagal maupun keluaran tidak sesuai skema, tidak menggagalkan
  run dan tidak mengubah hasil deteksi maupun verifikasi. Field `rekomendasi_ai` menjadi `null`
  beserta alasannya.
- Skrip penilaian tidak membaca field `rekomendasi_ai`, jadi angka eksperimen tidak terpengaruh.

## Memeriksa hash

```
cd prompts/remediasi-v1 && sha256sum -c HASHES.txt
```

Menyunting salah satu berkas berarti memperbarui `HASHES.txt` di commit yang sama, supaya prompt
yang dipakai sebuah run selalu bisa dicocokkan dengan isinya.
