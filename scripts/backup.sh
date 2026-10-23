#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out=${1:-"$root/backups/iti-$stamp.dump"}
mkdir -p "$(dirname "$out")"
docker compose --project-directory "$root" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-iti}" -d "${POSTGRES_DB:-indonesia_trade}" -Fc > "$out"
echo "Backup written to $out"
