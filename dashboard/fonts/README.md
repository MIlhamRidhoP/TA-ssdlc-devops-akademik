# Font yang dipasang sendiri

Dashboard tidak memuat font dari host pihak ketiga. Berkas `.woff2` di folder ini disalin apa
adanya dari Google Fonts, dan dipasang lewat `@font-face` di `../fonts.css`.

Dua alasan: Content-Security-Policy dashboard bisa dikunci sepenuhnya ke origin sendiri
(`style-src 'self'; font-src 'self'`), dan halaman tetap tampil utuh ketika jaringan tidak bisa
diandalkan, misalnya saat dipresentasikan.

## Font, sumber, dan lisensi

| Keluarga | Dipakai untuk | Sumber | Lisensi | Pemegang hak cipta |
|---|---|---|---|---|
| Geist | seluruh teks antarmuka: judul, isi, label (`--font-body`, `--font-head`) | https://fonts.google.com/specimen/Geist · https://github.com/vercel/geist-font | [OFL-geist.txt](OFL-geist.txt) | Copyright 2024 The Geist Project Authors |
| JetBrains Mono | data dan telemetri: hash commit, CWE, path berkas, angka metrik (`--font-data`) | https://fonts.google.com/specimen/JetBrains+Mono · https://github.com/JetBrains/JetBrainsMono | [OFL-jetbrains-mono.txt](OFL-jetbrains-mono.txt) | Copyright 2020 The JetBrains Mono Project Authors |

Keduanya berlisensi **SIL Open Font License, Version 1.1**. Teks lisensi lengkapnya ada di folder
ini, satu berkas per keluarga, disalin apa adanya dari repositori `google/fonts`.

Ringkasan kewajiban yang relevan di sini: font boleh dipakai, disalin, dan didistribusikan ulang
selama teks lisensi ikut disertakan dan font tidak dijual terpisah. Itulah sebabnya berkas OFL di
atas ada di repo ini, bukan sekadar ditautkan.

Hanken Grotesk dan Schibsted Grotesk dipakai sampai Oktober 2026, lalu dibuang ketika bahasa
visual beralih ke pasangan Geist dan JetBrains Mono. Berkasnya tidak perlu disimpan: riwayat git
masih memuatnya, dan menahan font yang tidak dirujuk `fonts.css` hanya menambah berat repo.

## Subset

Hanya subset **latin** dan **latin-ext** yang diambil; teks dashboard berbahasa Indonesia dan nama
berkas kode tidak memerlukan subset lain. `unicode-range` di `../fonts.css` membuat browser hanya
mengunduh subset yang benar-benar terpakai.

## Memperbarui

Berkas ini tidak dihasilkan build apa pun. Untuk mengganti versi font, unduh ulang `.woff2` dan
`OFL.txt` dari sumber di tabel atas, lalu perbarui `../fonts.css` beserta `unicode-range`-nya.
