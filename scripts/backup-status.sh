#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f .env.production ]]; then echo "缺少 .env.production。" >&2; exit 1; fi
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  psql -U microly -d microly -c "SELECT filename,kind,status,size_bytes,checksum,completed_at,restore_verified_at FROM database_backups ORDER BY created_at DESC LIMIT 20"
