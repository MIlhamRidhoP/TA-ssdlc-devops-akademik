# Eksperimen utama prompt v2, 19 Oktober 2026

Kondisi `utama`: satu panggilan deteksi tanpa laporan Sonar dan satu panggilan verifikasi per alert Sonar, untuk tiga model dengan tiga run masing-masing. Dokumen ini hanya mencatat konfigurasi, urutan, dan status run. Angka skor ada di `skor-utama.json`.

## Konfigurasi

| Butir | Nilai |
|---|---|
| Kode alat | `feat/prompt-v2` di `353634a6b3e52ca31a1ea02284b8825a06969a71`, file dalam lingkup bersih di semua panggilan |
| Objek uji | `eksperimen/seeded` di `97cfb00`, hash tree `src/` `ef5ff340dcb93e8153e52262bb79b64ea031e3cd` |
| Laporan Sonar | file beku `hasil-eksperimen/20261019/sonar-beku.json`, revisi analisis `467775e`, SHA-256 file `14946edae5803799e02ec3c939afe6777ec58b50f432ada9eac6297fe62bdfb6`, `sha256_isi` `9154f2a23d57427c500f8bf8976a5c792bb7a720d826358a71e12c321545ef1b`. Semua panggilan mencatat `sumber_sonar: "beku"` |
| Prompt | `prompts/v2/` (8 file cocok dengan `HASHES.txt`). Hash `prompt_user_kanonik` deteksi `568d6cba…` |
| Model | `gemini-3.1-pro-preview`, `claude-sonnet-5-5`, `gpt-6.1-sol`. Model yang menjawab sama dengan yang diminta di semua 54 panggilan |
| Pengaturan | sampling bawaan vendor, thinking `high`, batas output 64000, tanpa tools, tanpa fallback, timeout koneksi 20 menit (undici 7.30.1) |
| SDK | `@anthropic-ai/sdk` 0.135.0, `openai` 7.39.0, Gemini lewat REST `streamGenerateContent` |

## Folder

| Folder | Isi |
|---|---|
| `utama/google/` | 3 run Gemini (folder asal `llm-output/v2/20261019-200241-google-utama`) |
| `utama/anthropic/` | 3 run Claude (asal `20261019-195328-anthropic-utama`) |
| `utama/openai/` | 3 run GPT (asal `20261019-195437-openai-utama`) |
| `gagal/google-429-spending-cap/` | run Gemini yang tidak dipakai dalam analisis, lihat bagian di bawah |
| `skor-utama.json` | keluaran `scripts/llm-score.js` untuk ketiga folder `utama/` |

## Urutan run

Putaran berselang-seling Gemini, Claude, GPT. Gemini putaran 1 diulang di folder baru setelah batas belanja akun dinaikkan, lalu putaran 2 dan 3 berjalan berselang-seling untuk ketiga model.

| Waktu mulai (UTC) | Model | Run |
|---|---|---|
| 12:53:28 | Claude | 1 |
| 12:54:37 | GPT | 1 |
| 13:02:41 | Gemini | 1 |
| 13:08:23 | Gemini | 2 |
| 13:14:05 | Claude | 2 |
| 13:15:05 | GPT | 2 |
| 13:21:30 | Gemini | 3 |
| 13:25:15 | Claude | 3 |
| 13:26:21 | GPT | 3 |

## Status panggilan

54 dari 54 panggilan (9 deteksi, 45 verifikasi) berstatus `ok`, lolos skema, dalam satu percobaan. Tidak ada refusal, truncated, error, atau `parse_ok: false`.

## Run gagal yang tidak dipakai: `gagal/google-429-spending-cap/`

Gemini putaran 1 pertama (12:35:30 sampai 12:53:26 UTC). Deteksi, SONAR-01, dan SONAR-02 berstatus `ok`. SONAR-03, SONAR-04, dan SONAR-05 berstatus `error` karena HTTP 429 *"Your project has exceeded its monthly spending cap"*. Total 3 panggilan ok dan 3 gagal, dengan 9 percobaan 429. Biaya tercatat US$0,58941 (panggilan ok). Usage percobaan 429 tidak tercatat.

Kegagalan ini berasal dari batas belanja akun, bukan perilaku model, sehingga run ini tidak disertakan dalam scoring. Aturan pengulangan (README prompt v2 bagian 8) mengulang 429 dua kali. Untuk 429 karena batas belanja, pengulangan itu tidak bisa berhasil. Permintaan ditolak sebelum diproses, jadi kemungkinan besar tidak ditagih. Aturan ini tidak diubah selama eksperimen supaya commit kode tetap sama.

## Biaya (dari metadata)

| Model | 3 run utama | Percobaan gagal | Run gagal |
|---|---|---|---|
| Gemini | US$2,289344 | 0 | US$0,58941 + 9 percobaan 429 tidak tercatat |
| Claude | US$1,110496 | 0 | - |
| GPT | US$0,609284 | 0 | - |

Pengecekan batas belanja sebelum Gemini diulang memakai satu panggilan minimal (14 token, sekitar US$0,0002), di luar folder run.

## Reproduksi scoring

`scripts/llm-score.js` mencocokkan commit objek uji di setiap folder (`97cfb00`) dengan HEAD worktree objek uji. Karena itu reproduksi memakai worktree objek uji di `97cfb00`, yang sudah memuat file Sonar beku. Folder hasil dibaca dari salinan ini di commit mana pun. Dari root repo alat di commit `353634a`:

```
git worktree add --detach <objek-97cfb00> 97cfb00
node scripts/llm-score.js --objek=<objek-97cfb00> \
  --sonar-beku=<objek-97cfb00>/hasil-eksperimen/20261019/sonar-beku.json \
  <salinan>/hasil-eksperimen/20261019/utama/google \
  <salinan>/hasil-eksperimen/20261019/utama/anthropic \
  <salinan>/hasil-eksperimen/20261019/utama/openai
```

Triase manual (`triase-manual.json`) belum dibuat, jadi FP setelah triase sama dengan FP konservatif (temuan di luar ground truth dihitung FP).
