# Prompt v2

Status: draf final, siap dibekukan setelah run uji teknis lolos.
Disusun: 19 Oktober 2026.
Berlaku untuk: eksperimen deteksi dan verifikasi LLM pada branch `eksperimen/seeded` dan `eksperimen/framing`.

File di folder ini adalah sumber kebenaran. Jangan ubah isinya. Perubahan apa pun membuat versi baru (`v2.1`), dan run dengan versi berbeda tidak boleh digabung.

## 1. Daftar file

| File | Fungsi |
|---|---|
| `system.txt` | Pesan system, sama untuk semua panggilan |
| `source-header.txt` | Pembungkus kode sumber, variabel `{{SOURCE_CODE}}` |
| `sonar-reference.txt` | Laporan Sonar sebagai referensi, hanya untuk kondisi `sonar_di_deteksi`, variabel `{{SONAR_REPORT}}` |
| `task-detection.txt` | Instruksi tugas deteksi |
| `task-verification.txt` | Instruksi tugas verifikasi, variabel `{{ALERT}}` |
| `alert-format.txt` | Format satu alert Sonar |
| `detection.schema.json` | Skema output deteksi |
| `verification.schema.json` | Skema output verifikasi |

Hash SHA-256 setiap file ada di bagian 10.

## 2. Panggilan per run (per model)

| Kondisi | Panggilan |
|---|---|
| `utama` | 1 panggilan deteksi + 1 panggilan verifikasi per alert Sonar |
| `sonar_di_deteksi` | 1 panggilan deteksi dengan laporan Sonar (tanpa verifikasi) |
| `komentar_menyesatkan` | 1 panggilan deteksi pada kode branch `eksperimen/framing` (tanpa Sonar, tanpa verifikasi) |

## 3. Cara merakit prompt

Pesan system: isi `system.txt` setelah spasi dan baris baru di akhir dibuang (trimEnd).

Pesan user dirakit dari blok berikut, masing-masing di-trimEnd, lalu digabung dengan pemisah tepat dua karakter baris baru (`"\n\n"`):

| Urutan | Blok | utama: deteksi | utama: verifikasi | sonar_di_deteksi | komentar_menyesatkan |
|---|---|---|---|---|---|
| 1 | `source-header.txt` dengan `{{SOURCE_CODE}}` diisi | ya | ya | ya | ya (kode branch framing) |
| 2 | `sonar-reference.txt` dengan `{{SONAR_REPORT}}` diisi | | | ya | |
| 3 | `task-detection.txt` | ya | | ya | ya |
| 3 | `task-verification.txt` dengan `{{ALERT}}` diisi | | ya | | |

Variabel diganti secara literal (bukan regex) dan hanya sekali per variabel. Setelah perakitan, tidak boleh ada sisa `{{` di prompt. Kalau ada, hentikan run.

Teks kanonik pesan user (yang di-hash) selalu hasil penggabungan di atas. Untuk Claude, blok 1 dikirim sebagai content block pertama dengan `cache_control`, dan sisanya (blok 2 dan 3, sudah digabung `"\n\n"`) sebagai content block kedua. Vendor lain menerima teks kanonik sebagai satu string.

**Revisi 19 Oktober 2026 (cara pengiriman, bukan isi prompt).**

1. OpenAI kini juga menerima dua content part, sama seperti Claude: blok 1 dengan titik cache eksplisit (`prompt_cache_breakpoint: { mode: "explicit" }`), lalu content part kedua. Gemini tetap menerima teks kanonik sebagai satu string.
   Alasan: titik cache implisit OpenAI diletakkan di akhir pesan terakhir. Teks di akhir pesan user berbeda di setiap alert, sehingga pada run uji teknis cache OpenAI ditulis di setiap panggilan verifikasi tetapi tidak pernah terbaca.
2. Pemisah `"\n\n"` antara blok 1 dan blok berikutnya kini ditaruh di awal content part kedua, untuk Claude maupun OpenAI. Akibatnya, gabungan content part pertama dan kedua tanpa tambahan apa pun identik byte per byte dengan teks user kanonik. Sebelum revisi ini, pemisah tersebut tidak ikut terkirim ke Claude saat kedua blok dikirim terpisah.

Teks kanonik, semua file di `HASHES.txt`, dan semua hash di metadata (termasuk `prompt_user_kanonik`) tidak berubah.

## 4. Pembentukan `{{SOURCE_CODE}}`

1. Ambil semua file berakhiran `.js` di `src/` secara rekursif, pada commit yang dianalisis.
2. Path ditulis relatif terhadap root repo dengan pemisah `/`, misalnya `src/models/cutiModel.js`.
3. Urutkan path secara alfabetis dengan perbandingan string biasa (urutan code unit, bukan locale).
4. Baca sebagai UTF-8. Ganti `\r\n` dan `\r` menjadi `\n`.
5. Kalau isi file diakhiri `\n`, buang satu `\n` terakhir, supaya tidak muncul baris kosong palsu.
6. Pecah per `\n`. Setiap baris ditulis `<nomor> | <isi baris>`, nomor mulai dari 1 tanpa padding. Baris kosong tetap ditulis, misalnya `3 | ` (dengan spasi di akhir).
7. Setiap file diawali header `===== FILE: <path> =====` di barisnya sendiri, lalu baris-baris kodenya.
8. Antar file dipisah satu baris kosong (`"\n\n"`).
9. Komentar dan isi kode tidak diubah sama sekali.

Hasil uji pada `eksperimen/seeded`: 43 file, sekitar 103 ribu karakter untuk pesan user deteksi (sekitar 26 ribu token, perkiraan kasar).

## 5. Pembentukan alert Sonar

1. Ambil issue dan hotspot Sonar untuk branch dan analisis yang sama dengan commit yang dianalisis.
2. Filter: issue bertipe `VULNERABILITY`, issue dengan dampak `SECURITY`, semua security hotspot, atau issue dengan rule yang memetakan ke CWE. Filter ini sama dengan `sonarKeFormatTemuan` di scoring. Code smell lain tidak dikirim.
3. Urutkan berdasarkan path file, lalu nomor baris (tanpa baris dianggap 0), lalu rule key.
4. Beri ID berurutan `SONAR-01`, `SONAR-02`, dan seterusnya, dua digit dengan nol di depan.
5. Isi `alert-format.txt`:
   - `{{TYPE}}`: tipe issue Sonar (`VULNERABILITY`, `BUG`, `CODE_SMELL`), atau `SECURITY_HOTSPOT` untuk hotspot.
   - `{{FILE}}`: path relatif seperti di bagian 4.
   - `{{LINE}}`: nomor baris, atau `0` kalau tidak ada.
   - `{{MESSAGE}}`: pesan Sonar apa adanya, dengan baris baru diganti spasi.
   - `{{CWE_LIST}}`: daftar CWE dipisah `, ` (koma dan spasi), misalnya `CWE-89`, atau `none`.
6. Severity sengaja tidak dikirim.
7. `{{ALERT}}`: satu alert hasil format, di-trimEnd.
8. `{{SONAR_REPORT}}`: semua alert hasil format, masing-masing di-trimEnd, diurutkan menurut ID, digabung dengan `"\n\n"`. Kalau tidak ada alert, isi dengan teks `(no alerts)`.

## 6. Konfigurasi per vendor

| Pengaturan | Gemini 3.1 Pro | Claude Sonnet 5.5 | GPT-6.1-sol |
|---|---|---|---|
| Model ID | `gemini-3.1-pro-preview` | `claude-sonnet-5-5` | `gpt-6.1-sol` (pastikan ID persis di dokumentasi) |
| Sampling | Jangan kirim `temperature`, `top_p`, `top_k` | Jangan kirim | Jangan kirim |
| Tingkat thinking | Tingkat nominal tertinggi standar: high (pastikan nama parameter thinking untuk Gemini 3) | `output_config.effort: "high"`, jangan kirim field `thinking` | Reasoning effort `high` (pastikan nama parameter) |
| Structured output | Mode JSON dengan skema, di field yang didukung versi API yang dipakai | `output_config.format: { type: "json_schema", schema }` | JSON schema dengan strict mode |
| Batas output | 64000 token | `max_tokens: 64000` | 64000 token |
| Fallback | Tidak ada | Jangan kirim `fallbacks`, jangan kirim header beta fallback | Tidak ada |
| Caching | Implisit, catat token cache dari usage | `cache_control: { type: "ephemeral" }` pada content block 1 | Otomatis, catat token cache dari usage |
| Web, tools, grounding | Mati | Mati (tanpa `tools`) | Mati |

Kalau salah satu vendor tidak menerima batas 64000, turunkan batas ketiga vendor ke angka yang sama, lalu catat.

## 7. Validasi setelah output diterima

| Cek | Aturan | Kalau gagal |
|---|---|---|
| Status | Lihat bagian 8 | Catat status |
| Parse | `JSON.parse` berhasil dan lolos skema | `parse_ok: false` |
| Enum | Bandingkan tanpa membedakan huruf besar/kecil. Simpan `kategori_owasp` huruf besar (`A01`, `Other`), enum lain huruf kecil | Kalau tetap tidak cocok: tandai `nilai_tidak_valid` |
| `cwe` | Setelah trim dan huruf besar, cocok dengan `^CWE-\d+$` | Simpan nilai asli, tandai `cwe_tidak_valid`, scoring memperlakukannya seperti temuan tanpa CWE |
| `baris` | Bilangan bulat, 0 atau antara 1 dan jumlah baris file | Tandai `baris_tidak_valid` |
| `file` | Ada di daftar file yang dikirim | Tandai `file_tidak_dikenal` |
| `id_alert` | Sama persis dengan ID yang dikirim | Tandai `id_tidak_cocok` |

Temuan bertanda tidak dibuang. Output mentah selalu disimpan.

## 8. Status respons dan pengulangan

| Kejadian | Ulang? | Status yang dicatat |
|---|---|---|
| Timeout, error 5xx, rate limit 429 | Ya, maksimal 2 kali, dengan jeda bertambah | Setiap percobaan disimpan |
| Penolakan model (Claude `stop_reason: "refusal"`, blokir keamanan Gemini, penolakan OpenAI) | Tidak | `refusal`, beserta kategori kalau ada |
| Output terpotong (Claude `stop_reason: "max_tokens"`, Gemini `MAX_TOKENS`, OpenAI respons tidak lengkap) | Tidak | `truncated` |
| JSON tidak valid atau tidak lolos skema | Tidak | `ok` dengan `parse_ok: false` |
| Error 400 | Tidak. Perbaiki kode, lalu ulang seluruh run | Dicatat di log pengembangan, run dibuang |

Untuk metrik, panggilan berstatus `refusal`, `truncated`, atau `parse_ok: false` dihitung sebagai panggilan tanpa hasil, dan jumlahnya dilaporkan per model dan kondisi.

## 9. Metadata per panggilan

```json
{
  "versi_prompt": "v2",
  "kondisi": "utama | sonar_di_deteksi | komentar_menyesatkan",
  "tugas": "deteksi | verifikasi",
  "run": 1,
  "id_alert": "SONAR-03 atau null",
  "vendor": "google | anthropic | openai",
  "model_diminta": "",
  "model_menjawab": "",
  "cara_akses": "api",
  "waktu_mulai": "",
  "waktu_selesai": "",
  "pengaturan": { "sampling": "bawaan", "tingkat_thinking": "high", "batas_output": 64000, "tools": "none", "fallback": "none" },
  "hash": {
    "system": "",
    "template_tugas": "",
    "skema": "",
    "kode_sumber": "",
    "laporan_sonar": null,
    "alert": null,
    "prompt_system_kanonik": "",
    "prompt_user_kanonik": ""
  },
  "commit_objek_uji": "",
  "analisis_sonar": "",
  "status": "ok | refusal | truncated | error",
  "detail_status": "",
  "parse_ok": true,
  "percobaan": 1,
  "usage": { "input": 0, "input_dari_cache": 0, "input_tulis_cache": 0, "output": 0, "thinking": 0 },
  "biaya_usd": 0
}
```

Semua hash memakai SHA-256 atas byte UTF-8.

## 10. Hash file

Lihat `HASHES.txt` (dibuat dengan `sha256sum` atas file di folder ini, tanpa README dan HASHES itu sendiri).

## 11. Ringkasan keputusan desain

| Butir | Keputusan |
|---|---|
| 3a | Dua panggilan: deteksi tanpa Sonar, verifikasi per alert |
| 3b | Sampling tidak diatur (bawaan vendor). Tingkat thinking disetel nominal sama (high). Minimal 3 run |
| 3c | Instruksi bahasa Inggris. `penjelasan` dan `alasan` bahasa Indonesia. Enum bahasa Inggris |
| 3d | Skema ketat, hanya kata kunci `type`, `properties`, `items`, `required`, `additionalProperties`, `enum`, `description` |
| 3e | OWASP Top 10:2025, enum A01 sampai A10 ditambah `Other` |
| 3f | Definisi keyakinan, vulnerability vs hardening, dan verifikasi per alert ada di prompt |
| 3g | LF, nomor baris di setiap baris kode |
| 3h | Ablasi komentar di branch terpisah, komentar di ujung baris yang sudah ada, tanpa Sonar |
| 3i | Run uji hanya untuk cek teknis |
| 3j | Verifikasi: seluruh `src/`, satu panggilan per alert, filter alert sama dengan scoring, blok identik di depan untuk caching |
| 3k | Tanpa fallback. Ulang hanya untuk timeout, 5xx, 429. Penolakan, terpotong, dan JSON tidak valid dicatat, tidak diulang |
| 3l | Kondisi: utama (netral), sonar_di_deteksi, komentar_menyesatkan |
| Konteks | Kalimat "including personal data" dipertahankan |
| Alert | Severity Sonar tidak dikirim |
| Batas output | 64000 token, sama di semua vendor |
