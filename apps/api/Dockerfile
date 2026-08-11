# syntax=docker/dockerfile:1
#
# Contexte de build attendu : la racine du dépôt (pas apps/api).
#
# Base Debian slim plutôt qu'Alpine : @node-rs/argon2 est un module natif, et
# les binaires précompilés glibc/arm64 sont mieux couverts que les variantes musl.
# Sur un NAS 8 Go, les ~50 Mo supplémentaires ne pèsent rien face au risque
# d'une compilation Rust sur place.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- Dépendances -------------------------------------------------------------
# Seuls les manifestes sont copiés : tant qu'ils ne changent pas, cette couche
# reste en cache et l'installation n'est pas rejouée à chaque modification de code.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `sharing=locked` : les étapes `deps` et `runtime` descendent toutes deux de
# `base`, BuildKit les exécute donc en parallèle. Sans verrou, elles écrivent
# dans le même magasin pnpm en même temps et se corrompent mutuellement.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --filter @maxoujeux/api...

# --- Compilation -------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/engines packages/engines
COPY apps/api apps/api
RUN pnpm --filter @maxoujeux/api build

# --- Exécution ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# Dépendances de production uniquement. tsup a inliné @maxoujeux/shared dans le
# bundle, il n'y a donc plus de lien d'atelier à résoudre ici.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
#
# Pas de `pnpm store prune` ici : le magasin est un cache de construction, il
# n'entre jamais dans l'image finale — le purger ne gagnait aucun octet, mais
# supprimait les fichiers sous les pieds de l'étape `deps` qui tourne en
# parallèle, d'où des ENOENT aléatoires à la copie.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --filter @maxoujeux/api...

COPY --from=build /app/apps/api/dist ./apps/api/dist
# Les migrations SQL sont rejouées au démarrage : elles doivent voyager avec l'image.
COPY apps/api/drizzle ./apps/api/drizzle

# Le processus doit s'exécuter depuis le dossier du paquet : pnpm y place les
# node_modules de l'API, et `runMigrations` résout `drizzle/` depuis le cwd.
WORKDIR /app/apps/api

# Le nœud d'exécution ne doit jamais tourner en root.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Pas de `npm start` : le shell intermédiaire n'a rien à faire ici et
# intercepterait le SIGTERM envoyé par Docker à l'arrêt.
CMD ["node", "dist/index.js"]
