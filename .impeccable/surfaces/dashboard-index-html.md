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

Gambar Teknik, dipilih user di putaran 2 (pilihan Impeccable). Putaran 1 (Lembar Hasil Laboratorium) ditolak user.

## Direction contract

THESIS: Setiap run adalah satu lembar gambar kerja: identitas run di kotak judul, pipeline digambar sebagai jalur bernode dengan garis ukur durasi, temuan yang baru sejak run sebelumnya diberi segitiga revisi. Menolak dashboard kategori standar berupa kartu berbayang, chip pastel, dan radius besar.

OWN-WORLD: Kertas gambar biru-pucat; tinta biru kobalt untuk garis, label kotak judul, dan aksen; panel biru Prusia pekat untuk Jalankan analisis dengan garis kerja biru muda; merah revisi hanya untuk kritis dan tanda revisi; amber untuk tinggi. Garis 1 sampai 1,5 px, tanpa radius, tanpa bayangan dekoratif. Barlow untuk teks, Barlow Semi Condensed untuk judul, JetBrains Mono hanya untuk data (hash, path:baris, CWE, durasi, nomor run).

STORY: Developer membuka lembar run terbaru, membaca kotak judul (commit, model, prompt, SAST, durasi), melihat berapa yang kritis dan mana yang baru, membuka satu temuan, membaca alasan dan rekomendasi berlabel AI, lalu memberi keputusan. Penguji melihat pipeline berjalan sebagai gambar dan bahwa AI hanya menyarankan.

FIRST VIEWPORT: Kiri: rail project dan bagian token. Atas konten: breadcrumb repo/branch, judul run, kotak judul lima sel di kanan. Lalu panel biru Prusia selebar konten: form Jalankan analisis di kiri, jalur pipeline empat node dengan garis ukur durasi di kanan. Di bawahnya strip ringkasan bergaris (kritis dengan jumlah revisi baru, tinggi, sedang, ditolak AI, diverifikasi developer), lalu daftar temuan dengan filter sumber di kiri dan kolom samping (verifikasi Sonar, riwayat run, metrik riset bila ada) di kanan. Aksi utama: tombol Jalankan analisis di panel biru.

FORM: Gambar Teknik, posisi 1 dari daftar grounded putaran 2 (pilihan Impeccable), seed key 456fb8f5 (re-roll 1). Signature move: jalur pipeline yang tergambar node demi node saat job selesai, dengan garis ukur durasi di bawah setiap segmen; dan segitiga revisi pada temuan yang sidik jarinya tidak ada di run sebelumnya.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Anti-goals

- Tidak ada hero-metric, eyebrow di atas judul, kartu berbayang bersarang, emoji atau glyph unicode sebagai ikon.
- Grid gambar tidak dipakai sebagai hiasan latar.
- Data dari API dan laporan LLM tidak pernah dirender sebagai markup.

## Open decisions

- Perangkat demo (laptop atau proyektor) belum ditentukan; sakelar kepadatan Nyaman/Padat disediakan.
- Nama produk belum ada; judul deskriptif.
