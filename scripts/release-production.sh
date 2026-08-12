#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env.production ]]; then echo "缺少 .env.production。" >&2; exit 1; fi
if [[ -n "$(git status --porcelain)" ]]; then echo "发布前工作区必须干净。" >&2; exit 1; fi
node scripts/production-env-check.mjs
app_version="$(node --env-file=.env.production -p 'process.env.APP_VERSION')"
api_origin="$(node --env-file=.env.production -p 'process.env.API_PUBLIC_ORIGIN')"
admin_origin="$(node --env-file=.env.production -p 'process.env.ADMIN_PUBLIC_ORIGIN')"
admin_token="$(node --env-file=.env.production -p 'process.env.ADMIN_API_TOKEN')"
git_commit="$(git rev-parse HEAD)"
mkdir -p deploy_versions
previous_tag=""
[[ -f deploy_versions/current ]] && previous_tag="$(<deploy_versions/current)"
if [[ "$previous_tag" == "$app_version" ]]; then echo "封测版本 $app_version 已经发布，无需重复执行。"; exit 0; fi
export MICROLY_IMAGE_TAG="$app_version" MICROLY_OPERATIONS_IMAGE_TAG="$app_version" DEPLOY_GIT_COMMIT="$git_commit"
compose=(docker compose --env-file .env.production -f compose.production.yml)
rollback_on_error() {
  "${compose[@]}" run --rm migrate node apps/api/dist/scripts/record-deployment.js failed >/dev/null 2>&1 || true
  if [[ -n "$previous_tag" ]]; then
    echo "发布失败，恢复应用镜像 $previous_tag。" >&2
    MICROLY_IMAGE_TAG="$previous_tag" "${compose[@]}" up -d --no-deps api gateway backup || true
  fi
}
trap rollback_on_error ERR
pnpm preflight
"${compose[@]}" build api gateway
"${compose[@]}" up -d postgres
"${compose[@]}" run --rm --no-deps -e BACKUP_ONCE=true -e BACKUP_KIND=pre_release backup
"${compose[@]}" run --rm migrate
"${compose[@]}" run --rm --no-deps seed
"${compose[@]}" run --rm migrate node apps/api/dist/scripts/migration-status.js
"${compose[@]}" run --rm migrate node apps/api/dist/scripts/record-deployment.js deploying
"${compose[@]}" up -d --no-deps api gateway backup
for _ in {1..30}; do if curl --silent --fail "$api_origin/health/ready" >/dev/null; then break; fi; sleep 2; done
curl --fail "$api_origin/health/ready"
curl --fail "$api_origin/v1/content/current" >/dev/null
curl --fail "$admin_origin/" >/dev/null
curl --fail --header "Authorization: Bearer $admin_token" "$api_origin/v1/admin/session" >/dev/null
"${compose[@]}" run --rm migrate node apps/api/dist/scripts/record-deployment.js healthy
printf '%s' "$app_version" > deploy_versions/current
trap - ERR
echo "封测版本 $app_version 已发布。"
