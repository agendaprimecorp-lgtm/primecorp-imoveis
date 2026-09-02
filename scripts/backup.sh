#!/usr/bin/env bash
# Backup base + WAL archiving (PITR). Roda no host, via cron.
set -euo pipefail
DEST="${1:-./backups}"
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$DEST/base" "$DEST/wal"
docker compose exec -T db pg_basebackup -U primecorp -D - -Ft -z -Xf > "$DEST/base/base_$STAMP.tar.gz"
find "$DEST/base" -name 'base_*.tar.gz' -mtime +14 -delete 2>/dev/null || true
echo "Backup base: $DEST/base/base_$STAMP.tar.gz"
echo "$STAMP" > "$DEST/ULTIMO_BACKUP"
