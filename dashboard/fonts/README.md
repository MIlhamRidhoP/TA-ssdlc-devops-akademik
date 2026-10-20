# Font yang dipasang sendiri

Dashboard tidak memuat font dari host pihak ketiga. Berkas `.woff2` di folder ini disalin apa
adanya dari Google Fonts, dan dipasang lewat `@font-face` di `../fonts.css`.

Dua alasan: Content-Security-Policy dashboard bisa dikunci sepenuhnya ke origin sendiri
(`style-src 'self'; font-src 'self'`), dan halaman tetap tampil utuh ketika jaringan tidak bisa
diandalkan, misalnya saat dipresentasikan.

## Font, sumber, dan lisensi

| Keluarga | Dipakai untuk | Sumber | Lisensi | Pemegang hak cipta |
|---|---|---|---|---|
| Hanken Grotesk | teks isi (`--font-body`) | https://fonts.google.com/specimen/Hanken+Grotesk · https://github.com/marcologous/hanken-grotesk | [OFL-hanken-grotesk.txt](OFL-hanken-grotesk.txt) | Copyright 2021 The Hanken Grotesk Project Authors |
| Schibsted Grotesk | judul (`--font-head`) | https://fonts.google.com/specimen/Schibsted+Grotesk · https://github.com/schibsted/schibsted-grotesk | [OFL-schibsted-grotesk.txt](OFL-schibsted-grotesk.txt) | Copyright 2023 The Schibsted-Grotesk Project Authors |
| JetBrains Mono | angka dan data (`--font-data`) | https://fonts.google.com/specimen/JetBrains+Mono · https://github.com/JetBrains/JetBrainsMono | [OFL-jetbrains-mono.txt](OFL-jetbrains-mono.txt) | Copyright 2020 The JetBrains Mono Project Authors |

Ketiganya berlisensi **SIL Open Font License, Version 1.1**. Teks lisensi lengkapnya ada di folder
ini, satu berkas per keluarga, disalin apa adanya dari repositori `google/fonts`.

Ringkasan kewajiban yang relevan di sini: font boleh dipakai, disalin, dan didistribusikan ulang
selama teks lisensi ikut disertakan dan font tidak dijual terpisah. Itulah sebabnya berkas OFL di
atas ada di repo ini, bukan sekadar ditautkan.

## Subset

Hanya subset **latin** dan **latin-ext** yang diambil; teks dashboard berbahasa Indonesia dan
nama berkas kode tidak memerlukan subset lain. `unicode-range` di `../fonts.css` membuat browser
hanya mengunduh subset yang benar-benar terpakai.

## Memperbarui

Berkas ini tidak dihasilkan build apa pun. Untuk mengganti versi font, unduh ulang `.woff2` dan
`OFL.txt` dari sumber di tabel atas, lalu perbarui `../fonts.css` beserta `unicode-range`-nya.
