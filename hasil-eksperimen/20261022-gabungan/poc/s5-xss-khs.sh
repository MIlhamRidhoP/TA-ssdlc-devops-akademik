#!/usr/bin/env bash
# PoC S5: Reflected XSS lewat parameter `semester` pada halaman KHS.
#
# Status S5 di SEEDED.md: "jebakan FP". PoC ini membuktikan ulang status itu secara dinamis, yaitu
# bahwa nilai `semester` yang dikirim penyerang SELALU dipantulkan dalam bentuk ter-escape, sehingga
# tidak ada jalur eksekusi skrip di peramban.
#
# Penanda yang dipakai TIDAK berbahaya: hanya tag <b> dan <i>, tanpa <script>, tanpa atribut event,
# dan tanpa URL. Yang diuji adalah apakah karakter < > " dipantulkan apa adanya atau ter-escape;
# untuk itu penanda sesederhana ini sudah cukup, dan payload sungguhan tidak diperlukan.
#
# Kriteria lolos:
#   A. Respons memuat bentuk TER-ESCAPE penanda (&lt;b&gt;s5-penanda&lt;/b&gt;), DAN
#   B. Respons TIDAK memuat bentuk mentahnya (<b>s5-penanda</b>), DAN
#   C. Cabang semester kosong tidak memantulkan satu pun nilai dari penyerang, DAN
#   D. Kontrol: semester yang sah menghasilkan halaman KHS normal (200, ada tabel nilai).
#
# Prasyarat (lihat AGENTS.md dan README repo):
#   docker compose up -d db && npm run seed:admin && npm run seed:dummy && npm start
#
# Kredensial: akun mahasiswa dummy hasil `npm run seed:dummy`. Email akun tercantum di
# scripts/seed-dummy.js; passwordnya TIDAK ada di berkas ini dan diambil dari lingkungan.
#   SEED_USER_PASSWORD   wajib, sama dengan yang dipakai saat seed
#   BASIS                opsional, bawaan http://127.0.0.1:3000
#   EMAIL_MHS            opsional, bawaan andi@mahasiswa.test
#   SEMESTER_SAH         opsional, bawaan 2025-genap (semester dengan nilai published milik Andi)
set -uo pipefail

BASIS="${BASIS:-http://127.0.0.1:3000}"
EMAIL_MHS="${EMAIL_MHS:-andi@mahasiswa.test}"
SEMESTER_SAH="${SEMESTER_SAH:-2025-genap}"

if [ -z "${SEED_USER_PASSWORD:-}" ]; then
  echo "SEED_USER_PASSWORD belum diisi. Pakai password yang sama dengan saat npm run seed:dummy." >&2
  exit 2
fi

PENANDA_A='<b>s5-penanda</b>'
PENANDA_B='"><i>s5-penanda</i>'
ESCAPE_A='&lt;b&gt;s5-penanda&lt;/b&gt;'
ESCAPE_B='&quot;&gt;&lt;i&gt;s5-penanda&lt;/i&gt;'

lulus=0
gagal=0
nilai() { # nama, kondisi (0 = lulus)
  if [ "$2" -eq 0 ]; then echo "  LULUS  $1"; lulus=$((lulus + 1));
  else echo "  GAGAL  $1"; gagal=$((gagal + 1)); fi
}

echo "PoC S5 Reflected XSS pada parameter semester halaman KHS"
echo "Basis   : $BASIS"
echo "Akun    : $EMAIL_MHS (mahasiswa dummy hasil seed)"
echo "Waktu   : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# ---------- Login ----------
# Token JWT sengaja tidak pernah dicetak; hanya panjangnya yang dilaporkan sebagai bukti ada.
LOGIN_BODY=$(printf '{"email":"%s","password":"%s"}' "$EMAIL_MHS" "$SEED_USER_PASSWORD")
LOGIN_OUT=$(curl -s -w '\n%{http_code}' -X POST "$BASIS/api/auth/login" \
  -H 'Content-Type: application/json' -d "$LOGIN_BODY")
LOGIN_KODE=$(printf '%s' "$LOGIN_OUT" | tail -n1)
TOKEN=$(printf '%s' "$LOGIN_OUT" | sed '$d' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).data.token||"")}catch{process.stdout.write("")}})')

echo "1. Login POST /api/auth/login -> HTTP $LOGIN_KODE"
if [ "$LOGIN_KODE" != "200" ] || [ -z "$TOKEN" ]; then
  echo "   Login gagal, PoC dihentikan. Pastikan seed sudah dijalankan dan SEED_USER_PASSWORD benar." >&2
  exit 1
fi
echo "   token diterima (${#TOKEN} karakter, isinya tidak dicetak)"
echo

khs() { # $1 = nilai semester mentah
  curl -s -w '\n%{http_code}' -G "$BASIS/api/nilai/me/khs" \
    --data-urlencode "semester=$1" -H "Authorization: Bearer $TOKEN"
}

# ---------- D. Kontrol: semester sah ----------
OUT=$(khs "$SEMESTER_SAH"); KODE=$(printf '%s' "$OUT" | tail -n1); HTML=$(printf '%s' "$OUT" | sed '$d')
echo "2. Kontrol, semester sah \"$SEMESTER_SAH\" -> HTTP $KODE"
printf '%s' "$HTML" | grep -o '<title>[^<]*</title>' | head -n1 | sed 's/^/   /'
printf '%s' "$HTML" | grep -o 'Semester: [^<]*' | head -n1 | sed 's/^/   /'
[ "$KODE" = "200" ]; nilai "halaman KHS tampil (HTTP 200)" $?
printf '%s' "$HTML" | grep -q '<th>Kode</th>'; nilai "tabel nilai ada" $?
echo

# ---------- A dan B. Penanda 1 ----------
OUT=$(khs "$PENANDA_A"); KODE=$(printf '%s' "$OUT" | tail -n1); HTML=$(printf '%s' "$OUT" | sed '$d')
echo "3. Penanda 1 semester=$PENANDA_A -> HTTP $KODE"
printf '%s' "$HTML" | grep -o 'Semester: [^<]*' | head -n1 | sed 's/^/   pantulan: /'
printf '%s' "$HTML" | grep -qF "$ESCAPE_A"; nilai "bentuk ter-escape ada di respons" $?
printf '%s' "$HTML" | grep -qF "$PENANDA_A"; [ $? -ne 0 ]; nilai "bentuk mentah TIDAK ada di respons" $?
echo

# ---------- A dan B. Penanda 2, pemutus atribut ----------
OUT=$(khs "$PENANDA_B"); KODE=$(printf '%s' "$OUT" | tail -n1); HTML=$(printf '%s' "$OUT" | sed '$d')
echo "4. Penanda 2 semester=$PENANDA_B -> HTTP $KODE"
printf '%s' "$HTML" | grep -o 'Semester: [^<]*' | head -n1 | sed 's/^/   pantulan: /'
printf '%s' "$HTML" | grep -qF "$ESCAPE_B"; nilai "bentuk ter-escape ada di respons" $?
printf '%s' "$HTML" | grep -qF "$PENANDA_B"; [ $? -ne 0 ]; nilai "bentuk mentah TIDAK ada di respons" $?
echo

# ---------- C. Cabang semester kosong ----------
OUT=$(khs ""); KODE=$(printf '%s' "$OUT" | tail -n1); HTML=$(printf '%s' "$OUT" | sed '$d')
echo "5. Cabang semester kosong -> HTTP $KODE"
printf '%s' "$HTML" | head -c 200 | sed 's/^/   /'
echo
printf '%s' "$HTML" | grep -qF 's5-penanda'; [ $? -ne 0 ]; nilai "tidak memantulkan nilai penyerang" $?
echo

# Parameter semester yang tidak dikirim sama sekali, jalur yang sama.
OUT=$(curl -s -w '\n%{http_code}' "$BASIS/api/nilai/me/khs" -H "Authorization: Bearer $TOKEN")
KODE=$(printf '%s' "$OUT" | tail -n1); HTML=$(printf '%s' "$OUT" | sed '$d')
echo "6. Tanpa parameter semester -> HTTP $KODE"
printf '%s' "$HTML" | head -c 200 | sed 's/^/   /'
echo
printf '%s' "$HTML" | grep -qF 's5-penanda'; [ $? -ne 0 ]; nilai "tidak memantulkan nilai penyerang" $?
echo

echo "Ringkasan: $lulus lulus, $gagal gagal"
if [ "$gagal" -eq 0 ]; then
  echo "KESIMPULAN: S5 TERBUKTI sebagai jebakan FP. Nilai semester selalu dipantulkan ter-escape,"
  echo "dan cabang semester kosong tidak memantulkan masukan penyerang sama sekali."
  exit 0
fi
echo "KESIMPULAN: ada pemeriksaan yang gagal, status S5 perlu ditinjau ulang."
exit 1
