# CLAUDE.md

MaxouJeux est une plateforme web de mini-jeux multijoueur auto-hébergée en Docker sur un NAS UGREEN DH4300 Plus.

Le cahier des charges détaillé est dans `CAHIER-DES-CHARGES.md`.

## Commandes principales

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
pnpm test
pnpm db:generate
```

Un seul test :

```bash
pnpm --filter @maxoujeux/api test -- chemin/du/fichier.test.ts -t "nom du cas"
```

`pnpm db:generate` est obligatoire après toute modification de `apps/api/src/db/schema.ts`.

`SESSION_SECRET` est obligatoire au démarrage de l'API.

En développement :
- sans `DATABASE_URL` : PGlite ;
- avec `DATABASE_URL` : PostgreSQL.

Pour tester avec PostgreSQL :

```bash
docker compose -f docker-compose.dev.yml up -d
export DATABASE_URL=postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux
pnpm --filter @maxoujeux/api test
```

PGlite ne valide pas correctement les problèmes de concurrence : les tests liés au porte-monnaie et aux accès concurrents doivent être vérifiés sur PostgreSQL avant production.

## Déploiement

Le NAS ne compile rien.

GitHub Actions construit les images et les publie sur GHCR. Le NAS ne fait que tirer les images :

```bash
docker compose pull && docker compose up -d
TAG=sha-abc1234 docker compose up -d
```

`docker-compose.yml` contient uniquement des `image:`. Ne pas y ajouter de `build:`.

Le job de vérification doit réussir avant la construction des images.

Les migrations sont appliquées au démarrage de l'API.

Attention : un rollback applicatif ne rollback pas automatiquement une migration SQL.

## Reverse proxy et réseau

Le dépôt ne gère pas :
- TLS ;
- certificats ;
- ACME ;
- domaine public.

Nginx Proxy Manager tourne déjà sur le NAS et termine le HTTPS.

Ne pas ajouter Caddy, Certbot ou une deuxième terminaison TLS.

`apps/web/nginx.conf` sert uniquement :
- le front statique ;
- `/api` ;
- `/socket.io`.

Front, API et WebSocket doivent rester sur une origine unique pour que le cookie de session fonctionne avec Socket.IO.

En production :
- pas de CORS ;
- `apiFetch` utilise des chemins relatifs `/api/...`.

Toute modification du proxy Vite doit rester cohérente avec `apps/web/nginx.conf`.

## Architecture

```text
packages/shared    Types, schémas Zod, catalogue et constantes partagés
packages/engines   Moteurs de jeu purs
apps/api           Fastify 5 + Socket.IO + Drizzle + PostgreSQL
apps/web           React 18 + Vite + Tailwind v4 + nginx
```

### Serveur autoritaire

Le client envoie uniquement des intentions.

Le serveur :
1. valide l'action ;
2. applique la règle ;
3. diffuse l'état filtré.

Ne jamais laisser le client décider d'un résultat de partie.

Ne jamais envoyer au client des informations secrètes comme les cartes cachées d'un adversaire.

Le client ne doit pas appliquer localement un coup avant validation serveur.

Chaque action sensible au tour peut porter une version d'état ; le serveur refuse les états périmés avec `STALE_STATE`.

## Moteurs de jeu

Les moteurs vivent dans `packages/engines`.

Ils doivent rester :
- purs ;
- sans I/O ;
- sans accès DB ;
- sans Socket.IO.

Modèle attendu :

```text
reduce(state, action) -> { state, events[] }
view(state, playerId) -> état visible par ce joueur
```

Un coup invalide lève `IllegalMove`.

La couche HTTP/Socket traduit cette erreur en réponse métier.

Les règles pures doivent être réutilisées par le front quand c'est pertinent au lieu d'être dupliquées.

## Porte-monnaie MaxouCoin

MaxouCoin est strictement virtuel.

Ne jamais ajouter :
- paiement réel ;
- conversion en argent réel ;
- transfert entre comptes.

Toutes les écritures dans `wallets` passent par :

```text
apps/api/src/modules/wallet/service.ts
```

Aucun moteur de jeu ni autre module ne doit écrire directement dans `wallets`.

Le débit doit rester atomique :

```sql
UPDATE wallets
SET balance = balance - $montant
WHERE user_id = $joueur
  AND balance >= $montant
RETURNING balance
```

Zéro ligne retournée = fonds insuffisants.

Ne jamais faire :
1. lecture du solde ;
2. calcul côté application ;
3. écriture.

`wallet_tx.balance_after` doit utiliser la valeur retournée par la requête.

Pour les règlements multi-écritures, utiliser `creditInTx` / `debitInTx` dans une transaction fournie par l'appelant.

Les notifications de solde doivent être envoyées après le commit.

## Tables et concurrence

`apps/api/src/modules/tables/manager.ts` garde les tables actives en mémoire.

Règle importante : contrôler et réserver synchroniquement avant le premier `await`.

Exemples concernés :
- plafond de tables ;
- siège libre ;
- unicité d'une partie active par joueur.

En cas d'échec DB après réservation, relâcher la réservation.

`tableByUser` garantit une seule activité de jeu par joueur.

Les timers doivent :
- être annulés lors des transitions ;
- utiliser une garde de version ;
- être supprimés dans `shutdown()`.

Une table terminée peut rester visible temporairement, mais doit libérer immédiatement les contraintes d'activité et de capacité.

## Socket.IO

Les événements suivent :

```text
namespace:verbe
```

Les types sont dans :

```text
packages/shared/src/realtime.ts
```

Chaque socket rejoint :

```text
user:<id>
```

Ne pas créer de dépendance directe Socket.IO dans les services métier : utiliser les notifieurs injectés.

À chaque reconnexion, la socket change d'identifiant et perd ses rooms.

Le gestionnaire de connexion doit donc resynchroniser :
- présence ;
- partie ;
- abonnements nécessaires.

Les handlers Socket.IO susceptibles d'échouer doivent passer par `withAck`.

Hiérarchie principale :
- `AppError` -> erreur métier ;
- `IllegalMove` -> règle de jeu ;
- `ZodError` -> `VALIDATION_ERROR` ;
- autre -> log + `INTERNAL_ERROR`.

## Authentification

Authentification par session en base, pas par JWT.

Le cookie :
- est `httpOnly` ;
- utilise `SameSite=Lax` ;
- contient un jeton opaque ;
- la DB stocke uniquement son SHA-256.

La session est résolue à chaque requête.

Le client ne fournit jamais son propre `userId`.

`apps/api/src/modules/auth/session.ts` est le point d'entrée de l'identité pour REST et Socket.IO.

## Base de données

Deux pilotes avec la même API :

- `DATABASE_URL` présent -> PostgreSQL via postgres-js ;
- absent -> PGlite.

En production, `DATABASE_URL` est obligatoire.

Les migrations SQL sont communes aux deux pilotes et appliquées au démarrage.

## Validation et erreurs

`AppError(statusCode, code, message, fields?)` est la seule erreur destinée au client.

Les erreurs inattendues :
- sont journalisées ;
- produisent un 500 opaque.

Les validations Zod sont partagées entre front et API.

Ne jamais considérer une validation front comme suffisante.

## Shared : source de vérité

Les constantes communes doivent rester dans `packages/shared`.

Principaux fichiers :

```text
packages/shared/src/economy.ts
packages/shared/src/tables.ts
packages/shared/src/games.ts
packages/shared/src/realtime.ts
```

Ne pas dupliquer les montants, durées ou règles entre front et back.

Les calculs de dates Paris utilisent `Intl`, jamais un décalage UTC codé en dur.

L'horloge serveur est la source de vérité.

## Front

Tailwind v4 est configuré en CSS dans :

```text
apps/web/src/index.css
```

Ne pas créer de `tailwind.config.js`.

Palette :
- feutre ;
- laiton ;
- crème.

Le laiton est réservé :
- aux jetons ;
- aux gains ;
- à l'action principale.

Un seul bouton principal en laiton par écran.

Navigation maison :

```text
apps/web/src/lib/route.ts
```

Ne pas ajouter `react-router`.

La socket Zustand vit hors React dans :

```text
apps/web/src/lib/socket.ts
```

Les `socket.on` sont enregistrés une seule fois dans `connect()`.

Ne jamais naviguer automatiquement simplement parce qu'un état de table est reçu.

## Jeux casino

### Blackjack

Le blackjack sert de référence pour :
- mode spectateur ;
- sièges ;
- reprise après reconnexion ;
- rendu de table casino.

Regarder une table consomme également le verrou d'activité.

Se lever pendant une mise engagée doit attendre la fin de la manche.

### Roulette

La roulette sert de référence pour :
- plusieurs joueurs simultanés ;
- mises agrégées ;
- phases temporisées.

`roulette:bet` envoie l'ensemble de la mise dans une seule transaction.

Le zéro ne doit pas gagner sur les catégories auxquelles il n'appartient pas.

### Poker

Le poker est le prochain gros lot.

Réutiliser autant que possible :
- infrastructure Blackjack pour table et spectateurs ;
- transactions wallet existantes ;
- composants casino communs ;
- reprise des tours interrompus ;
- principes de concurrence de Roulette.

Ne pas réécrire des primitives déjà disponibles.

## Récupération après interruption

Les jeux à mises doivent utiliser :

```text
modules/tables/recovery.ts
```

et `recoverOpenRounds`.

Ne pas recopier cette logique dans chaque jeu.

## Conventions

- Code, commentaires et documentation en français.
- Les commentaires expliquent surtout le pourquoi.
- Ajouter un jeu commence dans `packages/shared/src/games.ts`.
- Cible de production : ARM64.
- Éviter les dépendances natives sans prébuild `linux-arm64`.
- API basée sur `node:22-bookworm-slim`.
- Drizzle est utilisé à la place de Prisma.
- `packages/shared` et `packages/engines` exportent directement leur TypeScript source.

## Tests : règle de proportionnalité

Ne pas exécuter mécaniquement toute la suite pour chaque modification.

### Petite modification

Exécuter uniquement :
- test ciblé ;
- typecheck du paquet concerné si nécessaire.

### Logique métier ou moteur

Exécuter les tests du module ou du paquet concerné.

### Modification transversale ou avant livraison

Exécuter si nécessaire :

```bash
pnpm typecheck
pnpm test
pnpm build
```

### Concurrence / wallet

Vérifier sur PostgreSQL réel lorsque la concurrence est concernée.

## Mode de travail attendu des assistants

Privilégier l'action.

Pour une tâche simple :
- lire les fichiers nécessaires ;
- modifier ;
- tester ce qui est pertinent ;
- terminer.

Ne pas imposer :
- brainstorming ;
- plan détaillé ;
- sous-agents ;
- worktree ;
- review complète ;
- TDD formel ;

sauf si la complexité réelle de la tâche le justifie ou si cela est explicitement demandé.

Éviter les longues explications avant de commencer une modification.

### Skill UI/UX obligatoire

Pour toute tâche concernant le frontend (`apps/web`), utiliser systématiquement le skill `ui-ux-pro-max` avant de concevoir ou modifier l'interface.

Cela concerne notamment :
- création ou modification de pages ;
- composants React ;
- mise en page ;
- responsive ;
- couleurs et typographie ;
- navigation et ergonomie ;
- formulaires ;
- animations et interactions ;
- amélioration visuelle d'une interface existante.

Le skill doit servir à guider les choix UI/UX tout en respectant les contraintes et la direction artistique définies dans ce fichier.

Pour une modification purement technique sans impact visuel ou UX (correction de type, appel API, logique Zustand, Socket.IO, etc.), il n'est pas nécessaire de l'utiliser.