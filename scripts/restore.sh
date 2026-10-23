#!/bin/sh
set -eu
if [ $# -ne 1 ]; then
  echo "Usage: scripts/restore.sh backups/iti-TIMESTAMP.dump" >&2
  exit 1
fi
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dump=$1
docker compose --project-directory "$root" exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-iti}" -d "${POSTGRES_DB:-indonesia_trade}" --clean --if-exists < "$dump"
echo "Restore finished from $dump"
