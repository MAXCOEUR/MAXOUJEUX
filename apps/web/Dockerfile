# syntax=docker/dockerfile:1
#
# Contexte de build attendu : la racine du dépôt (pas apps/web).
#
# L'image finale n'est pas un serveur Node mais nginx : le front est un paquet
# de fichiers statiques. Ce nginx sert ces fichiers et regroupe /api et
# /socket.io sous la même origine, rien de plus.
#
# Le TLS, le nom de domaine et les certificats ne sont **pas** de son ressort :
# Nginx Proxy Manager, déjà installé sur le NAS, les gère en amont.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `sharing=locked` par cohérence avec l'image de l'API : garantit qu'aucune
# étape parallèle ne puisse écrire dans le magasin pnpm en même temps.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --filter @maxoujeux/web...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @maxoujeux/web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /srv

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
