#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "用法：pnpm prod:rollback -- <镜像标签>" >&2; exit 1; fi
target="$1"
node scripts/production-env-check.mjs
docker image inspect "microly-api:$target" >/dev/null
docker image inspect "microly-gateway:$target" >/dev/null
api_origin="$(node --env-file=.env.production -p 'process.env.API_PUBLIC_ORIGIN')"
admin_origin="$(node --env-file=.env.production -p 'process.env.ADMIN_PUBLIC_ORIGIN')"
operations_tag="$(node --env-file=.env.production -p 'process.env.MICROLY_OPERATIONS_IMAGE_TAG')"
export MICROLY_IMAGE_TAG="$target" MICROLY_OPERATIONS_IMAGE_TAG="$operations_tag" DEPLOY_REASON="manual application rollback"
compose=(docker compose --env-file .env.production -f compose.production.yml)
"${compose[@]}" up -d --no-deps api gateway backup
curl --retry 20 --retry-delay 2 --retry-all-errors --fail "$api_origin/health/ready"
curl --retry 10 --retry-delay 2 --retry-all-errors --fail "$admin_origin/" >/dev/null
"${compose[@]}" run --rm migrate node apps/api/dist/scripts/record-deployment.js rolled_back
mkdir -p deploy_versions
printf '%s' "$target" > deploy_versions/current
echo "应用已回滚到镜像 $target；数据库未被覆盖。"
