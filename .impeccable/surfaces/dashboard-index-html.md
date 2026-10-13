---
version: 1
slug: "dashboard-index-html"
primary_target: "dashboard/index.html"
related_targets: []
---

# Surface: Security Dashboard (`dashboard/index.html`)

## Scope and mode

- Mode: **Operate**. Satu halaman aplikasi statis (HTML, CSS, JS vanilla) di `dashboard/`.
- Fidelity: layar produksi lengkap dengan state loading, kosong, error, token tidak valid, rate limit, jaringan putus.
- Breakpoint wajib: 375, 768, 1280 px. Mode terang dan gelap.

## Audience, job, task

- Developer setelah push: pilih project dan branch, jalankan analisis atau buka run terakhir, baca temuan sampai file, baris, alasan, dan rekomendasi, lalu konfirmasi atau tandai false positive.
- Penguji TA saat demo: memakai mode demo (fixture dari hasil eksperimen 20261010), tanpa token.

## Content and ranges

- Project: 1 sampai sekitar 10 repo dari `dashboard/projects.json`. Repo tanpa workflow tampil ditandai dan tidak bisa dipicu.
- Temuan per run: 0 sampai sekitar 40. Path file bisa panjang (`src/controllers/mahasiswaController.js:214`), judul temuan bisa dua baris.
- Job per run: build-test, sonarcloud, gemini (opsional), results.
- Riwayat: sampai 50 run dari `index.json`.
- Field yang mungkin kosong: `rekomendasi` (prompt eksperimen tidak memintanya, jadi tampil "Tidak tersedia dari model"), `potongan kode`, `metrics`.
- `status_ai` dan `sonar_verification` diturunkan dari pencocokan dan berlabel "diturunkan", bukan putusan model.

## Selected direction

Lembar Hasil Laboratorium: mesin menganalisis, manusia memvalidasi. Dipilih user dari halaman keputusan (rekomendasi Impeccable).

Terjemahan dari brief awal: brief meminta "satu panel gelap untuk Jalankan analisis" dan "satu aksen biru". Di dunia lab, panel gelap menjadi panel teal pekat (warna pita kepala laporan), dan aksen biru diganti teal klinik sebagai satu-satunya warna aksen. Tema terang sebagai default karena adegan pemakaian adalah meja kerja siang hari dan kemungkinan proyektor saat demo; mode gelap tetap didukung.

## Direction contract

THESIS: Setiap run adalah satu lembar hasil laboratorium: analyzer (Sonar, Gemini) mengisi baris hasil, developer memberi validasi. Menolak dashboard kategori standar berupa kartu angka berbayang dan chip warna-warni.

OWN-WORLD: Kertas putih di atas dasar abu-hijau klinik; pita kepala teal pekat yang memuat identitas run; tabel hasil bergaris rambut dengan kolom Flag (KRITIS/TINGGI/SEDANG/RENDAH dalam monospace tebal berwarna), Temuan, Lokasi, Sumber, Validasi; nilai yang bisa diverifikasi (hash, baris, durasi) dalam readout monospace; temuan bernomor T-01 dan seterusnya, urutan stabil antar-run. Satu aksen teal, merah hanya untuk flag kritis, tanpa gradasi dan tanpa kartu berbayang selain lembar itu sendiri.

STORY: Developer melihat lembar run terbaru, langsung tahu berapa yang perlu tindakan, membuka satu baris, membaca alasan dan rekomendasi berlabel "Rekomendasi AI", lalu memberi validasi. Penguji melihat bahwa AI hanya menyarankan dan manusia yang memutuskan.

FIRST VIEWPORT: Kiri: rail project sempit di dasar klinik. Tengah: lembar dengan pita teal (nama repo, branch, RUN #, waktu), baris identitas (Commit, Model, Prompt, SAST, Durasi), baris ringkasan perlu-tindakan per flag, filter sumber, lalu tabel temuan dengan satu baris terbuka. Kanan: panel teal pekat "Jalankan analisis" (branch, mode, model; DAST dan model belum didukung nonaktif) dengan status per job di bawahnya, lalu Verifikasi Sonar, Riwayat run, Nilai rujukan (metrik) hanya bila ada ground truth. Aksi utama: tombol Jalankan analisis di panel kanan atas.

FORM: Lembar Hasil Laboratorium, posisi 1 dari daftar grounded (pilihan Impeccable), seed key 456fb8f5. Signature move: kolom Validasi; saat developer mengonfirmasi atau menandai false positive, sel berubah menjadi paraf bertanggal ("Dikonfirmasi · 13 Okt 14:20"), dan ringkasan "Diverifikasi developer" bertambah.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Anti-goals

- Bukan dokumen cetak: alur memicu run harus tetap di first viewport.
- Tidak ada hero-metric, eyebrow di atas judul, kartu berbayang bersarang, emoji sebagai ikon.
- Data dari API dan laporan LLM tidak pernah dirender sebagai markup.

## Open decisions

- Perangkat demo (laptop atau proyektor) belum ditentukan.
- Nama produk belum ada; judul deskriptif.
