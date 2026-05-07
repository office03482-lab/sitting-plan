#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: ./restore_postgres.sh <backup-file>" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
DATABASE="${PGDATABASE:-seating_planner}"
USER_NAME="${PGUSER:-postgres}"
DROP_EXISTING="${DROP_EXISTING:-false}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "Set PGPASSWORD before running the restore script." >&2
  exit 1
fi

if [[ "$BACKUP_FILE" == *.sql ]]; then
  psql \
    --host="$HOST" \
    --port="$PORT" \
    --username="$USER_NAME" \
    --dbname="$DATABASE" \
    --single-transaction \
    --set=ON_ERROR_STOP=1 \
    --file="$BACKUP_FILE"
else
  RESTORE_ARGS=(
    --host="$HOST"
    --port="$PORT"
    --username="$USER_NAME"
    --dbname="$DATABASE"
    --no-owner
    --no-privileges
    --verbose
  )

  if [[ "$DROP_EXISTING" == "true" ]]; then
    RESTORE_ARGS+=(--clean --if-exists)
  fi

  pg_restore "${RESTORE_ARGS[@]}" "$BACKUP_FILE"
fi

echo "Restore completed from: $BACKUP_FILE"
