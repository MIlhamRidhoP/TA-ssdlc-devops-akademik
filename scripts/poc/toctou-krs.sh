#!/usr/bin/env bash
# TOCTOU KRS - race antara addItem (cek status draft di controller, lalu INSERT) dan submit
# (baca items -> cek kuota -> transition draft->submitted). Tidak ada penguncian/transaksi yang
# menyatukan pembacaan dan mutasi; transition hanya UPDATE ... WHERE status='draft'.
# Skema: UNIQUE(krs_semester_id, mata_kuliah_id) mencegah item SAMA ganda, item BERBEDA bisa.
# Aktor: Citra (citra@mahasiswa.test) - KRS 2026-ganjil draft, kuota 15, awal IF1002(4)+IF1007(2)=6 SKS.
# Baseline 13 SKS (IF1002,IF1007,IF1001,IF1003); item balapan IF1004(3) -> 16 > kuota 15.
# Kriteria lolos: KRS berstatus 'submitted' dengan total_sks > kuota (16 > 15).
# Pemakaian: bash toctou-krs.sh [N]   (default N=30)
set -uo pipefail
cd "$(dirname "$0")"
source ./00-login.sh
set +e  # 00-login.sh menyalakan set -e; race ini perlu lanjut walau sebagian curl non-zero
B="$BASE_URL"; N="${1:-30}"
BASELINE="IF1001 IF1003"   # ditambahkan ke IF1002+IF1007 bawaan -> total 13
RACE="IF1004"              # +3 -> 16

# Token Citra (00-login.sh tidak memuatnya)
TOK=$(curl -s -m 10 -X POST "$B/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"citra@mahasiswa.test\",\"password\":\"$SEED_USER_PASSWORD\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).data.token))")
AH="Authorization: Bearer $TOK"
jq_node() { node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const x=JSON.parse(d).data||{};$1})"; }

# Peta kode -> id mata kuliah
declare -A MKID
while IFS='|' read -r kode id; do MKID[$kode]="$id"; done < <(curl -s -m 10 -G "$B/api/mata-kuliah" --data-urlencode "limit=100" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{JSON.parse(d).data.forEach(m=>console.log(m.kode+'|'+m.id))})")

krs_json() { curl -s -m 10 "$B/api/krs/me" -H "$AH"; }
status_of()  { krs_json | jq_node "console.log(x.status)"; }
total_of()   { krs_json | jq_node "console.log(x.total_sks)"; }
item_id()    { krs_json | jq_node "const i=(x.items||[]).find(i=>i.kode==='$1');console.log(i?i.id:'')"; }
has_item()   { [ -n "$(item_id "$1")" ]; }
add_item()   { curl -s -m 10 -o /dev/null -X POST "$B/api/krs/me/items" -H "$AH" -H 'Content-Type: application/json' -d "{\"mata_kuliah_id\":\"${MKID[$1]}\"}"; }
del_item()   { local id; id=$(item_id "$1"); [ -n "$id" ] && curl -s -m 10 -o /dev/null -X DELETE "$B/api/krs/me/items/$id" -H "$AH"; }

reset_draft() {
  [ "$(status_of)" = submitted ] && curl -s -m 10 -o /dev/null -X POST "$B/api/krs/me/unsubmit" -H "$AH"
  del_item "$RACE"
  for k in $BASELINE; do has_item "$k" || add_item "$k"; done
}

berhasil=0
echo "N=$N percobaan race (addItem $RACE || submit). Kuota=15, baseline=13, menang jika submitted & total>15."
for i in $(seq 1 "$N"); do
  reset_draft
  base_total=$(total_of)
  # tembak addItem dan submit SECARA PARALEL
  curl -s -m 10 -o /dev/null -X POST "$B/api/krs/me/items"  -H "$AH" -H 'Content-Type: application/json' -d "{\"mata_kuliah_id\":\"${MKID[$RACE]}\"}" & p1=$!
  curl -s -m 10 -o /dev/null -X POST "$B/api/krs/me/submit" -H "$AH" & p2=$!
  wait $p1 $p2
  st=$(status_of); tot=$(total_of)
  if [ "$st" = submitted ] && [ "${tot:-0}" -gt 15 ]; then
    berhasil=$((berhasil+1)); echo "  #$i MENANG: submitted dengan total_sks=$tot (> kuota 15)"
  else
    echo "  #$i (baseline $base_total) -> status=$st total=$tot"
  fi
done
# pulihkan ke draft
[ "$(status_of)" = submitted ] && curl -s -m 10 -o /dev/null -X POST "$B/api/krs/me/unsubmit" -H "$AH"
echo
echo "KESIMPULAN: $berhasil dari $N percobaan menghasilkan KRS submitted dengan total SKS melebihi kuota (TOCTOU)."
