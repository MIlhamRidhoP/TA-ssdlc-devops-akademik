#!/usr/bin/env bash
# Login admin dan dua mahasiswa (andi = korban/penyerang bergantian, budi = korban).
# Hanya untuk stack lokal data sintetis. Tidak menyimpan kredensial, hanya membaca .env.
# PENTING: skrip ini di-source oleh skrip lain, jadi TIDAK BOLEH mengubah $PWD pemanggil
# secara permanen (pakai subshell path, bukan `cd`).
set -euo pipefail
POC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$POC_DIR/../.." && pwd)"
set -a; source "$REPO_ROOT/.env"; set +a
export REPO_ROOT
B="${BASE_URL:-http://localhost:3000}"

login() {
  curl -s -m 10 -X POST "$B/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).data.token)}catch(e){process.stderr.write('login gagal: '+d);process.exit(1)}})"
}

export ADMIN_TOKEN; ADMIN_TOKEN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
export ANDI_TOKEN; ANDI_TOKEN=$(login "andi@mahasiswa.test" "$SEED_USER_PASSWORD")
export BUDI_TOKEN; BUDI_TOKEN=$(login "budi@mahasiswa.test" "$SEED_USER_PASSWORD")
export BASE_URL="$B"

echo "Login berhasil: admin, andi, budi. Token tersedia di ADMIN_TOKEN/ANDI_TOKEN/BUDI_TOKEN." >&2
