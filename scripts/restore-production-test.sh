#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then echo "用法：pnpm prod:restore:test -- backups-production/microly-时间.dump" >&2; exit 1; fi
case "$(basename "$1")" in microly-[0-9]*T[0-9]*Z.dump) ;; *) echo "备份文件名不合法。" >&2; exit 1 ;; esac
compose=(docker compose --env-file .env.production -f compose.production.yml --profile restore)
"${compose[@]}" up -d postgres-restore
for _ in {1..20}; do if "${compose[@]}" exec -T postgres-restore pg_isready -U microly -d microly_restore >/dev/null; then break; fi; sleep 1; done
"${compose[@]}" exec -T postgres-restore pg_restore --clean --if-exists --no-owner -U microly -d microly_restore < "$1"
"${compose[@]}" exec -T postgres-restore psql -U microly -d microly_restore -c 'SELECT count(*) FROM content_releases' >/dev/null
"${compose[@]}" run --rm migrate node apps/api/dist/scripts/record-backup-restore.js "$(basename "$1")"
echo "备份已恢复到隔离数据库 microly_restore，正式数据库未被修改。"
