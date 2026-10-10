# Uji Manual Gemini 3.1 Pro (AI Studio Playground)

Prompt: `gemini-output/20261010-152454/prompt-lengkap.txt`
SHA-256 prompt: `de8f35e00b5682581d03fd605306c650f42e1813112d871657ba71589a78c49c`
Commit yang dianalisis: `5cbf05c928cd375fa51f773a03ca4779dde42e70` (SonarCloud project `MIlhamRidhoP_TA-ssdlc-devops-akademik_seeded`)

Prompt ini identik dengan yang dikirim ke `gemini-3.8-flash` pada run otomatis. Jangan mengedit isinya.

## Langkah

1. Buka https://aistudio.google.com, masuk dengan akun Google AI Pro, lalu klik **Create new prompt** untuk chat baru.
2. Di panel kanan (Run settings):
   - Model: **Gemini 3.1 Pro** (versi preview yang tersedia). Catat nama model persis seperti di UI.
   - Temperature: **0.2**
   - Thinking: biarkan bawaan dan catat nilainya, misalnya level atau budget yang tampil.
   - Structured output / JSON mode: aktifkan jika tersedia. Jika UI meminta schema, pakai schema di bagian bawah file ini dan catat di `catatan-pro.md`.
   - Output length: biarkan maksimum bawaan.
3. Buka `prompt-lengkap.txt` di editor, pilih semua (Ctrl+A), salin, lalu tempel ke kotak prompt. Jangan unggah sebagai file lampiran, karena cara itu mengubah bentuk input.
4. Catat waktu mulai, klik **Run**, lalu catat waktu selesai saat jawaban selesai.
5. Salin seluruh jawaban (tombol copy pada respons) dan simpan sebagai `pro-run-1.json` di folder ini. Simpan apa adanya, termasuk jika dibungkus blok ```json.
6. Ulangi langkah 1–5 di **chat baru** untuk run 2 dan run 3, lalu simpan sebagai `pro-run-2.json` dan `pro-run-3.json`.
7. Isi tabel di `catatan-pro.md`.

## Penilaian

Jalankan dari root repo:

```
node scripts/gemini-scan.js --score-file=gemini-output/20261010-152454/manual-pro/pro-run-1.json
node scripts/gemini-scan.js --score-file=gemini-output/20261010-152454/manual-pro/pro-run-2.json
node scripts/gemini-scan.js --score-file=gemini-output/20261010-152454/manual-pro/pro-run-3.json
```

Hasil tiap file disimpan sebagai `pro-run-N.score.json` di folder ini, dengan aturan pencocokan yang sama seperti run Flash dan SonarCloud.

## Schema (hanya jika UI mewajibkan schema untuk JSON mode)

```json
{
  "type": "object",
  "properties": {
    "temuan": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": { "type": "string" },
          "baris": { "type": "integer" },
          "kategori_owasp": { "type": "string" },
          "cwe": { "type": "string" },
          "jenis": { "type": "string" },
          "keyakinan": { "type": "string" },
          "penjelasan": { "type": "string" }
        },
        "required": ["file", "baris", "kategori_owasp", "cwe", "jenis", "keyakinan", "penjelasan"]
      }
    }
  },
  "required": ["temuan"]
}
```

Catatan: run Flash otomatis memakai `responseMimeType: application/json` tanpa schema. Jika Pro memakai schema, sebutkan perbedaan ini di metodologi.
