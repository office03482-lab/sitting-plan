#!/usr/bin/env bash
set -euo pipefail

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
DATABASE="${PGDATABASE:-seating_planner}"
USER_NAME="${PGUSER:-postgres}"
OUTPUT_DIR="${1:-./backups}"
FORMAT="${BACKUP_FORMAT:-custom}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "Set PGPASSWORD before running the backup script." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
EXT="dump"
if [[ "$FORMAT" == "plain" ]]; then
  EXT="sql"
fi
BACKUP_FILE="${OUTPUT_DIR}/${DATABASE}_${STAMP}.${EXT}"

pg_dump \
  --host="$HOST" \
  --port="$PORT" \
  --username="$USER_NAME" \
  --dbname="$DATABASE" \
  --no-owner \
  --no-privileges \
  --verbose \
  --format="$FORMAT" \
  --file="$BACKUP_FILE"

echo "Backup created: $BACKUP_FILE"
