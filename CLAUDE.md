# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

MaxouJeux — plateforme web de mini-jeux multijoueur (Poker Hold'em, Blackjack, Motus,
Puissance 4, Morpion), auto-hébergée en Docker sur un NAS UGREEN DH4300 Plus.
Le cahier des charges complet est dans `CAHIER-DES-CHARGES.md`.

## Commandes

```bash
pnpm install
pnpm dev                 # API :3000 + front :5173 en parallèle
pnpm typecheck           # tsc --noEmit sur les 4 paquets — à lancer avant tout commit
pnpm build               # tsup (API) + tsc && vite build (front)
pnpm test                # 190 tests (58 partagés, 46 moteurs, 72 API, 14 web)
pnpm db:generate         # OBLIGATOIRE après toute modification de src/db/schema.ts
```

Un seul test : `pnpm --filter @maxoujeux/api test -- chemin/du/fichier.test.ts -t "nom du cas"`

`SESSION_SECRET` est **obligatoire** au démarrage de l'API. Le script `dev` charge
`.env` à la racine s'il existe (`tsx --env-file-if-exists`) ; en production, la variable
vient de l'environnement du conteneur. Sans elle, `env.ts` refuse de démarrer — c'est
voulu, une clé de signature par défaut serait une faille silencieuse.

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

Deux primitives supplémentaires, `creditInTx` / `debitInTx`, acceptent une **transaction
fournie par l'appelant**. Elles existent pour le règlement d'une partie : verser le gain,
écrire `match_players.result` et incrémenter `stats` doivent réussir ou échouer ensemble,
ce que `credit` / `debit` ne permettent pas puisqu'ils ouvrent chacun leur transaction.

Le SQL touchant `wallets` reste donc **entièrement** dans ce module ; l'appelant
n'orchestre que l'ordre des écritures. Deux obligations pour lui : la transaction est la
sienne, et c'est à lui d'appeler `notifyWallet` **après** le commit — notifier avant
diffuserait un solde qui pourrait ne jamais être écrit.

### Les barèmes vivent dans le paquet partagé

`packages/shared/src/economy.ts` est la source unique des montants (bonus quotidien et sa
série, barème Motus, paliers de mise) **et** des calculs de date en heure de Paris.
`packages/shared/src/tables.ts` porte de même les durées de jeu (`TURN_MS`, `GRACE_MS`,
`WAITING_TTL_MS`) et le calcul des mises (`stakeOptions`, `isValidStake`, `winPayout`).

Ces constantes sont partagées et non dupliquées : le serveur en arme ses minuteries, le
front en dimensionne son anneau de temps. Deux valeurs séparées finiraient par diverger
d'une seconde, et l'anneau se viderait avant le forfait — ou l'inverse.

Le pas de mise (10 MC), le multiplicateur de gain (1,5) et le plafond de tables par jeu
vivent dans `games.ts`, à côté du reste du catalogue. `isValidStake` est appelée par le
front pour griser un bouton **et** rejouée par le serveur : un contrôle client seul ne
protège de rien.

Le fuseau passe par `Intl`, jamais par un décalage codé en dur : Paris est en UTC+1 six
mois par an et UTC+2 les six autres. `parisDay()` et `currentMotusSlot()` sont couverts
par des tests sur les deux week-ends de changement d'heure.

**L'horloge du client ne décide de rien.** Les comptes à rebours du front sont décoratifs ;
c'est le serveur qui calcule le jour civil, l'éligibilité au bonus et l'expiration d'un
tour. Le front corrige tout de même l'écart d'affichage via `apps/web/src/lib/clock.ts`,
recalé par le champ `now` de chaque état reçu : un téléphone réglé trente secondes en
avance annoncerait sinon un tour déjà expiré alors que le serveur attend encore.

## Architecture

```
packages/shared    Contrat front/back : types + schémas Zod + catalogue des jeux
packages/engines   Règles des jeux, fonctions pures (Puissance 4, Morpion)
apps/api           Fastify 5 + Socket.IO + Drizzle + PostgreSQL
apps/web           React 18 + Vite + Tailwind v4, servi par nginx
```

### Le serveur est autoritaire

Le client émet des **intentions** (`match:play`, `tables:join`), jamais des résultats. Le
serveur valide contre l'état et le tour courant, applique, puis diffuse un état **filtré
par destinataire**. Les cartes fermées d'un adversaire ne transitent jamais sur le réseau.

C'est la seule protection anti-triche viable. Ne jamais placer une règle de jeu dans un
gestionnaire de socket ou dans un composant React.

Corollaire côté front : **aucun coup n'est appliqué localement.** Le plateau se verrouille
le temps de l'aller-retour (`useGame.pending`) et attend l'état du serveur. Un « appliquer
puis réconcilier » ferait clignoter un plateau désynchronisé.

Chaque intention porte la `version` de l'état sur lequel le joueur a cliqué ; le serveur
refuse un coup calculé sur un plateau périmé (`STALE_STATE`) plutôt que de l'appliquer à
l'aveugle sur une case qui n'est plus celle visée.

### Moteurs de jeu = fonctions pures

Chaque jeu vit dans `packages/engines` sans I/O, sans socket, sans base :

```
reduce(state, action) -> { state, events[] }
view(state, playerId) -> état public, information cachée masquée
```

Les règles du poker se testent alors en millisecondes sans lancer de serveur. La couche
Socket.IO n'est qu'un transport autour.

La grille est un **tableau plat** (`index = ligne × cols + colonne`), pas un tableau de
tableaux : `noUncheckedIndexedAccess` étant actif, `grid[r][c]` imposerait deux gardes par
lecture. Un tableau plat en demande une, et sérialise directement pour le réseau.

Un coup refusé lève `IllegalMove`, propre au paquet — un moteur n'a pas à connaître
`AppError`, qui est une erreur HTTP. C'est la couche transport qui traduit.

Le front **importe** ces moteurs (`dropRow` pour l'aperçu au survol, `legalMoves` pour
griser une colonne pleine) au lieu de réécrire la règle dans un composant.

### Gestionnaire de tables : réserver en mémoire, écrire ensuite

`apps/api/src/modules/tables/manager.ts` tient l'état des tables en mémoire — une table en
attente n'a aucun intérêt à survivre à un redémarrage. Il ne connaît pas Socket.IO : il
reçoit un notifieur, comme le service de porte-monnaie (`setTableNotifier`).

**La règle à ne pas enfreindre en le modifiant :** Node est mono-thread, donc tout bloc
synchrone est atomique — mais le premier `await` rend la main. On contrôle et on réserve
**synchroniquement** (plafond de tables, siège libre, index « une seule partie par
joueur »), puis on écrit en base ; en cas d'échec, on relâche la réservation.

Contrôler le plafond puis attendre un débit laisserait deux créations simultanées passer
le même contrôle, et deux `tables:join` verraient tous les deux un siège libre.

L'index `tableByUser` **est** la garantie « une seule partie active à la fois, quel que
soit le nombre d'onglets ou d'appareils » : rien en base ne l'assure.

Minuteries : tour (30 s → forfait), sursis de déconnexion (45 s → abandon), table en
attente (10 min → annulation et remboursement). Toute transition d'état les annule, et
chaque rappel vérifie une **garde de version** — un `setTimeout` déjà en file d'attente
s'exécute même après `clearTimeout`. Un rappel orphelin garde en vie la partie qu'il
référence : sur un conteneur plafonné à 512 Mo, c'est une fuite qui finit par tuer l'API.
`shutdown()` les purge et est branché sur l'arrêt propre.

Une table terminée reste consultable deux minutes pour l'affichage du résultat, mais sa
place au plafond et la contrainte « une seule partie » sont libérées immédiatement.

### Gestion des erreurs côté socket

Socket.IO n'a **aucun** équivalent de `registerErrorHandler` : une `AppError` levée dans un
gestionnaire remonterait dans la bibliothèque et se perdrait, laissant le joueur devant un
bouton sans réponse. `apps/api/src/realtime/guard.ts` (`withAck`) est le pendant temps
réel, avec la même hiérarchie : `AppError` → code métier, `IllegalMove` → message de règle,
`ZodError` → `VALIDATION_ERROR`, le reste → journalisé et renvoyé en `INTERNAL_ERROR`.

Les intentions refusables passent par un **accusé de réception** et non par `error:app` :
le front doit savoir *quelle* action a échoué pour afficher le message sous le bouton
cliqué. `error:app` ne sert qu'aux erreurs arrivant hors de tout geste du joueur.

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

- `packages/shared` et `packages/engines` exportent du **TypeScript source**
  (`"exports": "./src/index.ts"`), sans étape de build. Vite et tsup les consomment
  directement ; `tsup.config.ts` les inline via `noExternal` pour que l'image runtime
  n'ait aucun lien d'atelier à résoudre.
- **Tailwind v4, configuration en CSS** : tous les jetons sont dans le bloc `@theme` de
  `apps/web/src/index.css`. Il n'y a pas de `tailwind.config.js`. Le fond s'appelle
  `felt-deep` : la palette est nommée d'après la matière (feutre, laiton, crème), jamais
  par un rôle abstrait comme `base` — `--color-base` produirait d'ailleurs l'utilitaire
  `text-base`, en collision avec la taille de police du même nom.
- **Le laiton est réservé aux jetons, aux gains et à l'action principale** — jamais
  décoratif, sinon il perd sa fonction de repère. Un seul bouton en laiton par écran ; le
  tour actif est en `win`, une erreur en `danger`, un état neutre en `plaque`.
- **Ajouter un jeu** commence par `packages/shared/src/games.ts` : ce catalogue est la
  source de vérité du lobby, du plafond de tables et de la validation côté API.
- Événements Socket.IO nommés `namespace:verbe`, typés dans
  `packages/shared/src/realtime.ts` (`ServerToClientEvents` / `ClientToServerEvents`).
- Chaque socket rejoint une room `user:<id>` à la connexion : c'est ainsi qu'on adresse un
  joueur sur tous ses appareils, **y compris pour l'état des parties** — il n'existe
  volontairement aucune room par table, qu'il faudrait rejoindre et quitter à chaque
  reconnexion pour le même résultat. Le service de porte-monnaie et le gestionnaire de
  tables n'importent pas Socket.IO, ils passent par un notifieur injecté
  (`realtime/notify.ts`, `setTableNotifier`) — sans quoi ils deviendraient intestables
  sans serveur.
- La socket vit dans un store Zustand **hors React** (`apps/web/src/lib/socket.ts`) :
  naviguer du lobby vers une table ne doit jamais couper la connexion d'une partie. Tous
  les `socket.on` sont enregistrés **une seule fois** dans `connect()` ; un abonnement dans
  un composant perdrait les événements pendant que le joueur consulte le lobby, et
  s'abonnerait deux fois en `StrictMode`.
- **Une reconnexion fournit un nouvel identifiant de socket, donc plus aucune room.** Le
  gestionnaire `connect` doit réémettre `presence:sync`, `match:sync` et réabonner les
  salons observés. C'est le bug numéro un de cette architecture, et il ne se voit qu'en
  coupant le réseau.
- Navigation : routeur maison dans `apps/web/src/lib/route.ts`, adossé à l'API History.
  Pas de `react-router` — c'est le **serveur** qui décide quand une partie démarre, et le
  gestionnaire de socket doit pouvoir amener le joueur sur `/table/:id` hors de React. Le
  repli SPA est déjà assuré par `nginx.conf` et par Vite.
- Animations en CSS uniquement, déclarées dans le bloc `@theme`. Le réglage
  `prefers-reduced-motion` est neutralisé globalement dans `index.css`, mais cette règle
  porte un `!important` qui **bat les styles en ligne** : une animation dont la durée est
  fournie en ligne (l'anneau de temps) doit passer par `useReducedMotion()` et rendre autre
  chose, sinon elle mentirait.
- Code, commentaires et documentation en **français**. Les commentaires expliquent le
  *pourquoi*, en particulier les pièges déjà rencontrés.

## À faire

Lot 4 : Poker Hold'em — moteur, enchères, pots secondaires et table de 2 à 9 joueurs.
Voir la section « État d'avancement » de `CAHIER-DES-CHARGES.md`.

Ce qui est déjà en place et **à consommer sans le réécrire** :

- **Motus** est livré dans `modules/motus/` : son registre d'activité commun, son modèle
  de notifieur injecté et son transport `withAck` servent de patron aux prochains jeux
  solo. Le secret reste exclusivement dans `motus_slots` et ne rejoint jamais une vue.
- **Blackjack** est livré dans `modules/blackjack/` : table persistante de cinq sièges,
  sabot en mémoire, une ligne `matches` par manche et récupération transactionnelle au
  redémarrage. Le poker (lot 4) utilisera `poker_buyin` / `poker_cashout` et les caves de
  `STAKE_TIERS`. Pour tout règlement touchant plusieurs écritures, passer par
  `creditInTx` / `debitInTx` dans une transaction unique, comme
  `modules/tables/settle.ts`.
- **Elo** : la colonne `stats.elo` existe et reste à 1 000. Le classement est au lot 5 ;
  `settle.ts` ne doit pas y toucher avant.

Dette assumée, à traiter le jour où elle gêne :

- Le harnais front reste volontairement léger (`tsx --test`) : il couvre désormais les
  adaptateurs navigateur, la saisie Motus et le rendu statique de la table Blackjack.
  La logique pure reste dans `packages/shared` ou `packages/engines`.
- Le parcours à deux joueurs se vérifie à la main (deux navigateurs) ou avec un script
  pilotant deux clients `socket.io-client`. Il n'y a pas de test d'intégration WebSocket
  automatisé.
