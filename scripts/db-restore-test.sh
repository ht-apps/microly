#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "用法：pnpm db:restore:test -- backups/microly-时间.dump" >&2
  exit 1
fi
docker compose --profile test up -d postgres-test
docker compose exec -T postgres-test pg_restore --clean --if-exists --no-owner -U microly -d microly_test < "$1"
echo "备份已恢复到隔离测试库 microly_test；开发库 microly 未被修改。"
