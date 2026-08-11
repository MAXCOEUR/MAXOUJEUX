# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MaxouJeux — plateforme web de mini-jeux multijoueur (Poker Hold'em, Blackjack, Motus,
Puissance 4, Morpion), auto-hébergée en Docker sur un NAS UGREEN DH4300 Plus.
Le cahier des charges complet est dans `CAHIER-DES-CHARGES.md`.

## Commandes

```bash
pnpm install
pnpm dev                 # API :3000 + front :5173 en parallèle
pnpm typecheck           # tsc --noEmit sur les 3 paquets — à lancer avant tout commit
pnpm build               # tsup (API) + tsc && vite build (front)
pnpm test                # vitest : 32 tests d'économie + 18 tests de porte-monnaie
pnpm db:generate         # OBLIGATOIRE après toute modification de src/db/schema.ts
```

Un seul test : `pnpm --filter @maxoujeux/api test -- chemin/du/fichier.test.ts -t "nom du cas"`

`pnpm dev` ne nécessite **aucune** installation de base de données (voir « Deux pilotes »
ci-dessous). Mais **PGlite ne prouve rien sur la concurrence** : c'est une base à
connexion unique, qui sérialise les requêtes. Les tests de concurrence du porte-monnaie
passent donc toujours sur PGlite, y compris si la condition de solde disparaissait de
l'UPDATE. Avant toute mise en production, les rejouer sur un vrai PostgreSQL :

```bash
docker compose -f docker-compose.dev.yml up -d       # PostgreSQL sur :5433
export DATABASE_URL=postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux
pnpm --filter @maxoujeux/api test                    # puis pnpm dev
```

## Déploiement

Le NAS **ne compile rien**. `.github/workflows/images.yml` construit les deux images sur
un runner ARM64 natif (gratuit car le dépôt est public — pas de QEMU) et les publie sur
`ghcr.io/<propriétaire>/maxoujeux-api` et `-web`. Le NAS ne fait que tirer :

```bash
docker compose pull && docker compose up -d      # mise à jour
TAG=sha-abc1234 docker compose up -d             # retour arrière
```

`docker-compose.yml` ne contient donc **que des `image:`**, jamais de `build:` — les
sections de construction vivent dans `docker-compose.build.yml`, réservé aux essais
locaux. Procédure complète et publication par Nginx Proxy Manager : `DEPLOIEMENT.md`.

Le job `verification` (typecheck + tests) barre la route au job `images` : une image ne
part sur GHCR que si la suite passe. Ne pas contourner ce garde-fou — `latest` est tiré
directement en production.

Les migrations sont appliquées au démarrage de l'API, il n'y a pas d'étape séparée. En
revanche **un retour arrière ne défait pas une migration** : prudence sur toute
modification de `apps/api/src/db/schema.ts` tant qu'aucune sauvegarde `pg_dump` n'est en
place.

## Contraintes à connaître avant d'écrire du code

### Ce dépôt ne gère pas le reverse proxy public

**Ni TLS, ni domaine, ni certificat, ni ACME.** Nginx Proxy Manager tourne déjà sur le
NAS et occupe 80/443 ; il termine le HTTPS et route `maxoujeux.maxencecoeur.fr` vers la
pile. Celle-ci ne publie qu'un port HTTP (`WEB_PORT`, 8080 par défaut).

Ne jamais réintroduire Caddy, certbot ou une gestion de certificats ici : la double
terminaison TLS produit des redirections en boucle et des `X-Forwarded-*` incohérents.

Le nginx de `apps/web/nginx.conf` a un rôle **différent et limité** : servir le front
statique et regrouper `/api` et `/socket.io` sous une **origine unique**.

### L'origine unique n'est pas cosmétique

Front, API et WebSockets doivent sortir de la même origine, sinon le cookie de session
n'accompagne pas le handshake Socket.IO et l'authentification temps réel tombe. C'est
assuré par `nginx.conf` en production et par le `proxy` de `vite.config.ts` en
développement. Toute modification de l'un doit être répercutée sur l'autre.

Conséquence : **pas de CORS** en production, et `apiFetch` n'utilise que des chemins
relatifs (`/api/...`).

### Cible ARM64

Aucune dépendance native sans prébuild `linux-arm64`. C'est pourquoi le projet utilise
Drizzle (100 % TS) et non Prisma, et pourquoi l'image de l'API est `node:22-bookworm-slim`
et non Alpine : `@node-rs/argon2` est mieux couvert en glibc qu'en musl.

### MaxouCoin : jetons virtuels uniquement

`wallets` / `wallet_tx` ne doivent jamais recevoir de passerelle de paiement ni de
conversion en argent réel — cela ferait tomber le site sous la réglementation ANJ.

**Aucun transfert entre comptes non plus.** L'inscription est sans vérification email :
une fonction de don permettrait de récolter les bonus quotidiens sur des comptes
secondaires pour les siphonner vers le compte principal.

### Tout mouvement de MaxouCoin passe par le service de porte-monnaie

`apps/api/src/modules/wallet/service.ts` est le **seul** endroit autorisé à écrire dans
`wallets`. Aucun moteur de jeu ne doit toucher la table directement.

Le débit y est atomique — la condition de solde est **dans** l'UPDATE :

```sql
UPDATE wallets SET balance = balance - $montant
WHERE user_id = $joueur AND balance >= $montant RETURNING balance
```

Zéro ligne renvoyée signifie fonds insuffisants. Lire le solde puis l'écrire ensuite
autoriserait un double débit : un joueur assis à deux tables, ou avec deux onglets,
dépenserait deux fois le même MaxouCoin. La contrainte `CHECK (balance >= 0)` double ce
garde-fou ; une violation de cette contrainte est un **bug**, pas un cas métier.

`wallet_tx.balance_after` reçoit toujours la valeur renvoyée par `RETURNING`, jamais un
solde recalculé côté applicatif : c'est ce qui rend le journal auditable
(`SUM(delta)` doit toujours égaler `wallets.balance`).

Idempotence du bonus quotidien : la clé primaire `(user_id, day)` de `daily_claims` suffit.
Sur deux requêtes simultanées, la seconde viole la contrainte et devient un 409 — aucun
verrou applicatif n'est nécessaire.

### Les barèmes vivent dans le paquet partagé

`packages/shared/src/economy.ts` est la source unique des montants (bonus quotidien et sa
série, barème Motus, paliers de mise) **et** des calculs de date en heure de Paris.

Le fuseau passe par `Intl`, jamais par un décalage codé en dur : Paris est en UTC+1 six
mois par an et UTC+2 les six autres. `parisDay()` et `currentMotusSlot()` sont couverts
par des tests sur les deux week-ends de changement d'heure.

**L'horloge du client ne décide de rien.** Les comptes à rebours du front sont décoratifs ;
c'est le serveur qui calcule le jour civil et l'éligibilité au bonus.

## Architecture

```
packages/shared    Contrat front/back : types + schémas Zod + catalogue des jeux
apps/api           Fastify 5 + Socket.IO + Drizzle + PostgreSQL
apps/web           React 18 + Vite + Tailwind v4, servi par nginx
packages/engines   (lot 1) règles des jeux, fonctions pures
```

### Le serveur est autoritaire

Le client émet des **intentions** (`action:bet`, `motus:guess`), jamais des résultats. Le
serveur valide contre l'état et le tour courant, applique, puis diffuse un état **filtré
par destinataire**. Les cartes fermées d'un adversaire ne transitent jamais sur le réseau.

C'est la seule protection anti-triche viable. Ne jamais placer une règle de jeu dans un
gestionnaire de socket ou dans un composant React.

### Moteurs de jeu = fonctions pures

À partir du lot 1, chaque jeu vit dans `packages/engines` sans I/O, sans socket, sans base :

```
reduce(state, action) -> { state, events[] }
view(state, playerId) -> état public, information cachée masquée
```

Les règles du poker se testent alors en millisecondes sans lancer de serveur. La couche
Socket.IO n'est qu'un transport autour.

### Authentification : session en base, pas de JWT

`apps/api/src/modules/auth/session.ts` est le point d'entrée unique de l'identité, utilisé
à la fois par le hook REST `requireAuth` et par le middleware de handshake Socket.IO.

- Cookie `httpOnly` + `SameSite=Lax`, signé par `@fastify/cookie`, contenant un jeton
  opaque de 32 octets. La base ne stocke que son **SHA-256**.
- La session est résolue **à chaque requête** : un bannissement ou une déconnexion prend
  effet immédiatement, ce qu'un JWT auto-porteur ne permet pas.
- Le client n'envoie jamais son `userId` — impossible d'en usurper un.
- `burnTimingBudget()` égalise le temps de réponse sur un email inconnu, pour empêcher
  l'énumération des comptes.

### Deux pilotes de base de données, une seule API

`apps/api/src/db/index.ts` choisit au démarrage :

- `DATABASE_URL` présent → PostgreSQL via postgres-js ;
- absent → **PGlite** (PostgreSQL en WebAssembly, persisté dans `apps/api/.data/`).

Les mêmes migrations SQL sont rejouées dans les deux cas. `env.ts` refuse de démarrer en
production sans `DATABASE_URL`, avec un second garde-fou dans `db/index.ts`. PGlite est en
`devDependencies` : son absence de l'image de production est délibérée.

Les migrations sont appliquées **au démarrage de l'API**, pas par une étape séparée.
`migrationsFolder` est résolu depuis `process.cwd()` — d'où le `WORKDIR /app/apps/api`
dans le Dockerfile.

### Gestion des erreurs

`AppError(statusCode, code, message, fields?)` est la seule erreur destinée au client.
Tout le reste est un bug : `registerErrorHandler` le journalise et renvoie un 500 opaque.
Les erreurs Zod sont aplaties en `{ champ: message }` pour un affichage sous l'input,
même format que `ApiClientError.fields` côté front.

### Validation partagée

Les schémas Zod de `packages/shared/src/auth.ts` sont utilisés par le front (retour
immédiat) **et** rejoués par l'API. Ne jamais supposer qu'un contrôle client suffit.

## Conventions

- `packages/shared` exporte du **TypeScript source** (`"exports": "./src/index.ts"`), sans
  étape de build. Vite et tsup le consomment directement ; `tsup.config.ts` l'inline via
  `noExternal` pour que l'image runtime n'ait aucun lien d'atelier à résoudre.
- **Tailwind v4, configuration en CSS** : tous les jetons sont dans le bloc `@theme` de
  `apps/web/src/index.css`. Il n'y a pas de `tailwind.config.js`.
  Le jeton de fond s'appelle `night` et non `base` : `--color-base` produirait l'utilitaire
  `text-base`, en collision avec la taille de police du même nom.
- **Ajouter un jeu** commence par `packages/shared/src/games.ts` : ce catalogue est la
  source de vérité du lobby et de la validation des codes de jeu côté API.
- Événements Socket.IO nommés `namespace:verbe`, typés dans
  `packages/shared/src/realtime.ts` (`ServerToClientEvents` / `ClientToServerEvents`).
- Chaque socket rejoint une room `user:<id>` à la connexion : c'est ainsi qu'on adresse un
  joueur sur tous ses appareils. Le service de porte-monnaie n'importe pas Socket.IO, il
  passe par `apps/api/src/realtime/notify.ts` — sans quoi il deviendrait intestable sans
  serveur.
- La socket vit dans un store Zustand **hors React** (`apps/web/src/lib/socket.ts`) :
  naviguer du lobby vers une table ne doit jamais couper la connexion d'une partie.
- Code, commentaires et documentation en **français**. Les commentaires expliquent le
  *pourquoi*, en particulier les pièges déjà rencontrés.

## À faire

Lot 1 : couche temps réel générique (RoomManager, timers, reconnexion), matchmaking,
Puissance 4 + Morpion de bout en bout, écriture des statistiques. Voir la section
« État d'avancement » de `CAHIER-DES-CHARGES.md`.

Branchements de l'économie déjà en place, à consommer sans les réécrire :

- **Motus** (lot 2) : remplir `motus_slots` avec le mot du créneau calculé par
  `currentMotusSlot()`, puis `credit(userId, motusReward(essais, trouvé), "motus_reward")`.
  Le mot ne doit **jamais** être envoyé au client — seules les couleurs le sont, sinon il
  suffit d'ouvrir l'onglet Réseau pour tricher.
- **Blackjack** (lot 3) et **poker** (lot 4) : `debit` / `credit` avec les codes
  `blackjack_bet`, `blackjack_payout`, `poker_buyin`, `poker_cashout`, et les caves de
  `STAKE_TIERS`.
