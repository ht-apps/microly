FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/content-schema/package.json packages/content-schema/package.json
RUN pnpm install --frozen-lockfile
COPY apps/admin apps/admin
COPY packages/api-contract packages/api-contract
COPY packages/content-schema packages/content-schema
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @microly/content-schema build && pnpm --filter @microly/api-contract build && pnpm --filter @microly/admin build

FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/admin/dist /srv
