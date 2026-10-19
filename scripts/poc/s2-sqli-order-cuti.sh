#!/usr/bin/env bash
# S2 (jebakan FP) - ORDER BY di list cuti admin (GET /api/cuti?sort=&order=).
# Hipotesis jebakan: listQuery() memvalidasi sort/order terhadap allowlist (model.SORT, asc/desc)
# SEBELUM mencapai model.listAdmin, sehingga payload SQLi ditolak 400, bukan dieksekusi di ORDER BY.
# Sink teoretis: src/models/cutiModel.js listAdmin() -> ORDER BY ${sort} ${order}.
# Prasyarat: peran admin.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; AH="Authorization: Bearer $ADMIN_TOKEN"

echo "== Baseline: sort valid (sort=nim, order=desc) =="
curl -s -m 10 -o /dev/null -w "  HTTP %{http_code}\n" -G "$B/api/cuti" --data-urlencode "sort=nim" --data-urlencode "order=desc" -H "$AH"

lolos=0; total=0
cek() { # deskripsi  param  nilai
  total=$((total+1))
  local code; code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -G "$B/api/cuti" --data-urlencode "$2=$3" -H "$AH")
  echo "  [$2=$3] -> HTTP $code"
  [ "$code" = 400 ] && lolos=$((lolos+1))
}
echo "== Payload SQLi pada sort/order (harapan: semua 400) =="
cek "sort subquery"       sort  "(SELECT 1)"
cek "sort stacked drop"   sort  "c.created_at; DROP TABLE pengajuan_cuti--"
cek "sort comment"        sort  "nama--"
cek "sort kolom liar"     sort  "c.alamat_cuti"
cek "order sleep"         order "asc; SELECT pg_sleep(5)"
cek "order liar"          order "asc--"

echo
if [ "$lolos" = "$total" ]; then
  echo "KESIMPULAN: S2 JEBAKAN FP TERKONFIRMASI. $lolos/$total payload sort/order ditolak 400 oleh listQuery (allowlist) sebelum menyentuh ORDER BY. Tidak dapat dieksploitasi."
else
  echo "KESIMPULAN: PERLU DITINJAU. Hanya $lolos/$total payload yang ditolak 400."
fi
