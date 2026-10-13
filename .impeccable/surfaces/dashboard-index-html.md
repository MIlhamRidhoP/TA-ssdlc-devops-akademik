---
version: 1
slug: "dashboard-index-html"
primary_target: "dashboard/index.html"
related_targets: []
---

# Surface: Security Dashboard (`dashboard/index.html`)

## Scope and mode

- Mode: **Operate**. Satu halaman aplikasi statis (HTML, CSS, JS vanilla) di `dashboard/`.
- Fidelity: layar produksi lengkap dengan state loading, kosong, error, token tidak valid, rate limit, jaringan putus, dan mode demo.
- Breakpoint wajib: 375, 768, 1280 px. Mode terang dan gelap.
- Acuan struktur dan isi: `docs/design/mockup-dashboard.html` (hanya contoh; tampilannya tidak disalin).

## Audience, job, task

- Developer setelah push: pilih project dan branch, jalankan analisis atau buka run terakhir, baca temuan sampai file, baris, alasan, dan rekomendasi, lalu konfirmasi atau tandai false positive.
- Penguji TA saat demo: mode demo (fixture dari hasil eksperimen 20261010), tanpa token.

## Content and ranges

- Project: 1 sampai sekitar 10 repo dari `dashboard/projects.json`. Repo tanpa workflow ditandai dan tidak bisa dipicu.
- Branch per project dengan flag `dispatch`. `eksperimen/seeded` adalah arsip hanya-baca.
- Temuan per run: 0 sampai sekitar 40. Path bisa panjang, judul bisa dua baris.
- Job: build-test, sonarcloud, analisis (Gemini opsional), hasil.
- Riwayat: sampai 50 run dari `index.json` di branch `security-results`.
- `rekomendasi` bisa null ("Belum tersedia pada versi prompt ini"); `potongan_kode` dan `metrics` opsional.
- `status_ai`, verifikasi Sonar, dan severity Gemini diturunkan; selalu berlabel.
- Model: hanya Gemini. Flash aktif, Pro nonaktif (manual di AI Studio). DAST nonaktif.

## Selected direction

Mockup + perbaikan, ditetapkan user (13 Okt 2026) setelah melihat build Gambar Teknik. Acuan visual: `docs/design/mockup-dashboard.html` (palet Cobalt, panel graphite, kartu bergaris tipis, chip lembut, langkah pipeline vertikal), ditambah perbaikan yang disepakati: font bukan Inter/Space Grotesk, tanpa label di atas judul, monospace hanya untuk data, teks minimal 13px, data asli eksperimen, konten utama di tengah. Arah ini adalah keputusan user dan mengalahkan undian; Gambar Teknik dan Lembar Hasil Laboratorium tidak dipakai.

## Direction contract

THESIS: Alat kerja developer yang tenang dan presisi: setiap temuan bisa ditelusuri ke file, baris, CWE, dan sumbernya; satu panel graphite untuk aksi utama. Menolak tampilan pamer metrik dan dekorasi.

OWN-WORLD: Kertas biru-pucat dingin, kartu putih radius 10 px bergaris tipis, satu aksen Cobalt, panel graphite untuk Jalankan analisis, chip severity berwarna lembut (kritis merah, tinggi amber, sedang netral), titik warna per sumber (Sonar ungu, Gemini Cobalt, keduanya teal). Hanken Grotesk untuk teks, Schibsted Grotesk untuk judul, JetBrains Mono hanya untuk data.

STORY: Developer membuka run terbaru, membaca identitas run, melihat jumlah yang perlu tindakan dan yang baru, membuka satu temuan, membaca alasan dan rekomendasi berlabel AI, lalu memberi keputusan. Penguji melihat pipeline berjalan langkah demi langkah dan bahwa AI hanya menyarankan.

FIRST VIEWPORT: Kiri: rail project, akses GitHub, preferensi. Tengah (berpusat, maks 80rem): breadcrumb, judul run, baris meta (Commit, Model, Prompt, SAST, Durasi), lalu panel graphite dengan form Jalankan analisis di kiri dan langkah pipeline vertikal di kanan, strip ringkasan, lalu kartu Temuan dan kolom samping (verifikasi Sonar, riwayat run, metrik riset bila ada). Aksi utama: tombol Jalankan analisis di panel graphite.

FORM: Mockup user (standar kategori yang dikerjakan rapi), dipilih user di luar undian; seed key 456fb8f5 tercatat untuk riwayat putaran. Signature move: langkah pipeline yang berubah status secara langsung saat run dipantau, dan tanda segitiga merah "baru" pada temuan yang tidak ada di run sebelumnya.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Anti-goals

- Tidak ada hero-metric, eyebrow di atas judul, kartu berbayang bersarang, emoji atau glyph unicode sebagai ikon.
- Data dari API dan laporan LLM tidak pernah dirender sebagai markup.

## Open decisions

- Perangkat demo (laptop atau proyektor) belum ditentukan; sakelar kepadatan Nyaman/Padat disediakan.
- Nama produk belum ada; judul deskriptif.
