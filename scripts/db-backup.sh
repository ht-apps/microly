#!/usr/bin/env bash
set -euo pipefail

backup_dir="${MICROLY_BACKUP_DIR:-backups}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/microly-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres pg_dump -U microly -d microly -Fc > "$backup_file"
if [[ ! -s "$backup_file" ]]; then
  echo "备份文件为空。" >&2
  exit 1
fi
echo "数据库备份已生成：$backup_file"
