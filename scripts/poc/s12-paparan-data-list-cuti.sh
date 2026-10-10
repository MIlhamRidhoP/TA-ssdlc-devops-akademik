#!/usr/bin/env bash
# S12 - Paparan data sensitif tanpa audit trail pada list cuti admin (GET /api/cuti)
# Sink: src/models/cutiModel.js listAdmin() -> ikut pgp_sym_decrypt(alamat_cuti, nomor_telepon)
# Catatan nuansa: admin memang berhak membaca data ini satu per satu lewat GET /api/cuti/:id
# (yang MENCATAT audit_trail). Bukti di sini adalah: list memaparkan data terdekripsi yang
# SAMA secara massal, DALAM SATU REQUEST, TANPA baris audit_trail baru sama sekali — melanggar
# PRD §5.1 ("setiap akses data sensitif wajib tercatat di audit_trail").
# Prasyarat: akses langsung ke database untuk membandingkan jumlah baris audit_trail
# sebelum/sesudah (dijalankan lewat docker compose exec, bukan lewat API).
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; AH="Authorization: Bearer $ADMIN_TOKEN"
cd "$REPO_ROOT"
DBU=$(grep ^DB_USER .env | cut -d= -f2); DBN=$(grep ^DB_NAME .env | cut -d= -f2)

BEFORE=$(docker compose exec -T db psql -U "$DBU" -d "$DBN" -t -c "SELECT count(*) FROM audit_trail WHERE entitas='pengajuan_cuti';" | tr -d ' \r')
echo "baris audit_trail (entitas pengajuan_cuti) SEBELUM: $BEFORE"

echo "== S12: admin panggil list cuti, ambil banyak record sekaligus =="
RESP=$(curl -s -m 10 -G "$B/api/cuti" --data-urlencode "limit=100" -H "$AH")
N=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(''+JSON.parse(d).data.length))")
echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(JSON.stringify(j.data.slice(0,3).map(r=>({nama:r.nama,alamat_cuti:r.alamat_cuti,nomor_telepon:r.nomor_telepon})),null,1))})"
echo "jumlah record terdekripsi dalam SATU request: $N"

AFTER=$(docker compose exec -T db psql -U "$DBU" -d "$DBN" -t -c "SELECT count(*) FROM audit_trail WHERE entitas='pengajuan_cuti';" | tr -d ' \r')
echo "baris audit_trail SESUDAH: $AFTER (seharusnya SAMA dengan SEBELUM)"

echo
if [ "$N" -ge 1 ] && [ "$BEFORE" = "$AFTER" ]; then
  echo "KESIMPULAN: TERBUKTI (dengan catatan: admin memang berwenang atas data ini). Pelanggarannya adalah paparan massal $N record data sensitif terdekripsi dalam satu request TANPA audit trail sama sekali, berbeda dengan endpoint detail (GET /api/cuti/:id) yang mencatat audit."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini."
fi
