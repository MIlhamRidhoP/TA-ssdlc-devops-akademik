# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML, CSS, dan JavaScript vanilla tanpa build step, tanpa framework frontend, tanpa backend atau database sendiri. Dashboard memanggil GitHub REST API langsung dari browser. Hosting: dibuka lokal atau lewat GitHub Pages.

## Users

- **Utama:** developer yang baru push kode ke repo yang memakai framework ini dan ingin tahu apa yang harus diperbaiki: file, baris, alasan, dan cara memperbaikinya.
- **Sekunder:** penguji Tugas Akhir yang melihat demo framework.

## Product Purpose

Framework SSDLC berbasis DevOps dengan analisis keamanan berbantuan LLM. Pipeline GitHub Actions menjalankan build dan uji, SAST (SonarCloud), lalu analisis Gemini. Security Dashboard adalah antarmuka developer untuk memicu pipeline, memantau statusnya, dan membaca hasil analisis.

Tugas utama: dari "ada push" sampai "tahu file, baris, dan cara memperbaiki" tanpa pindah halaman.

Aplikasi SIA (sistem informasi akademik) di repo ini hanya objek uji. Luaran TA adalah framework yang bisa dipakai untuk aplikasi lain. Rujukan rancangan: `docs/superpowers/PRD.md`, `docs/superpowers/ARCHITECTURE.md`.

## Positioning

Hasil SAST dan LLM digabung dalam satu daftar temuan per run. Setiap temuan menyebut sumbernya (Sonar, Gemini, atau keduanya), dan temuan Sonar diberi status verifikasi. Semua berjalan di atas GitHub Actions dan GitHub API saja, tanpa server tambahan.

## Operating Context

- Developer membuka dashboard setelah push, memilih project dan branch, memicu analisis atau membuka run terakhir.
- Mode analisis: `sast` (SonarCloud saja) dan `sast-llm` (SonarCloud + Gemini). DAST belum ada.
- Hasil run disimpan sebagai `results.json` (skema berversi di `docs/design/results.schema.json`) di branch `security-results`, dengan `index.json` berisi daftar run terbaru.
- Branch `eksperimen/seeded` berisi kerentanan tertanam dan ground truth (`SEEDED.md`). Hanya branch dengan ground truth yang menampilkan metrik precision dan recall.
- Demo ke penguji: perangkat tampil belum ditentukan (laptop atau proyektor). Keputusan terbuka.

## Capabilities and Constraints

- Gemini Flash adalah satu-satunya model yang berjalan otomatis. Pro hanya diuji manual di AI Studio karena kuota API free tier bernilai 0.
- Output Gemini saat ini berisi file, baris, kategori OWASP, CWE, jenis, keyakinan, dan penjelasan. Prompt eksperimen tidak boleh diubah, jadi field yang tidak dimintanya tampil "tidak tersedia" atau diberi label "diturunkan" dari pencocokan.
- Rekomendasi perbaikan dibangun dua lapis. Lapis 1 adalah panduan umum per CWE dari pemetaan statis `dashboard/rekomendasi-cwe.json`, bersumber dari cwe.mitre.org dan OWASP Cheat Sheet Series; selalu tampil, tidak melibatkan model, dan berlabel sebagai panduan umum berdasarkan CWE. Lapis 2 adalah saran spesifik dari model yang berpijak pada panduan lapis 1; sifatnya opt-in dan mati secara bawaan.
- Token GitHub milik pengguna (fine-grained) hanya dipakai di browser dan hanya dikirim ke api.github.com.
- Keputusan developer atas temuan (konfirmasi rentan atau false positive) disimpan di localStorage per run. Belum tersinkron antar perangkat.
- Repo publik: branch `security-results` bisa dibaca siapa pun.
- Data eksperimen 10 Oktober 2026 (prompt, aturan penilaian, ground truth, hasil run) tidak boleh berubah.
- Batasan TA: aplikasi objek uji backend-only.

## Brand Commitments

- Belum ada nama produk. Judul deskriptif: "Security Dashboard — SSDLC DevOps".
- Nada: tenang, presisi, teknis.
- Bahasa antarmuka: Indonesia.

## Evidence on Hand

- Hasil eksperimen nyata di branch `eksperimen/seeded`, folder `hasil-eksperimen/20261010/`: 3 run Flash, 3 run Pro manual, data SonarCloud, skor, dan uji McNemar. Dipakai sebagai fixture mode demo.
- Tidak ada pengguna, testimoni, atau angka adopsi. Jangan dikarang.

## Product Principles

1. **AI memberi saran, developer memutuskan.** Setiap temuan AI berlabel jelas, punya alasan, dan bisa dikonfirmasi atau ditandai false positive. Kode tidak pernah diubah otomatis.
2. **Sumber selalu terlihat.** Setiap temuan menyebut asalnya, dan data yang diturunkan tidak disamarkan sebagai putusan model.
3. **Satu halaman, satu alur.** Dari memicu run sampai membaca perbaikan tanpa pindah halaman.
4. **Isi laporan LLM tidak tepercaya.** Data dari API ditampilkan sebagai teks, tidak pernah sebagai markup.
5. **Metrik riset hanya bila ada ground truth.** Tidak ada angka precision atau recall tanpa dasar.

## Accessibility & Inclusion

Target WCAG 2.2 AA: kontras teks minimal 4.5:1 di mode terang dan gelap, fokus keyboard terlihat, target sentuh memadai, status tidak hanya disampaikan lewat warna.
