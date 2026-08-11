# MaxouJeux — Cahier des charges

Document de référence du projet : ce qui est demandé, ce qui est décidé, ce qui est livré.
Dernière mise à jour : 11/08/2026.

---

## 1. La demande

Créer de zéro un site web de mini-jeux appelé **MaxouJeux**, avec un back-end et un
front-end, **exclusivement web** (pas d'application mobile native).

Parcours attendu :

1. Le visiteur crée un compte avec **email, mot de passe et pseudo**.
2. Il arrive sur une **interface de lobby** présentant plusieurs mini-jeux.
3. Il joue à des **jeux multijoueur contre de vraies personnes** (Puissance 4,
   Morpion, poker) ou à des jeux solo (Motus, blackjack).

Exigences techniques formulées :

- Technologies **légères**, capables de tourner sur un **petit serveur** — en
  l'occurrence un NAS personnel.
- Du **temps réel** (sockets ou équivalent) pour le multijoueur.
- Une **base de données**.
- Un **front soigné**.
- **Tout doit être conteneurisé en Docker** pour le déploiement sur le NAS.

---

## 2. Contraintes d'hébergement

| Élément | Valeur |
|---|---|
| Machine | NAS **UGREEN DH4300 Plus** |
| Architecture | **ARM64** (aarch64) |
| Mémoire | 8 Go |
| Docker | Fourni par UGOS Pro |
| Nom de domaine | **maxoujeux.maxencecoeur.fr** |
| Reverse proxy / TLS | **Nginx Proxy Manager, déjà installé sur le NAS** |

### Le reverse proxy public n'est pas du ressort de ce programme

**Cette pile ne gère ni le nom de domaine, ni les certificats, ni le HTTPS.**

Nginx Proxy Manager tourne déjà sur le NAS et occupe les ports 80 et 443. C'est lui
qui termine le TLS, obtient et renouvelle les certificats Let's Encrypt, et route
`maxoujeux.maxencecoeur.fr` vers l'application.

En conséquence :

- Aucune configuration ACME, aucun challenge Let's Encrypt, aucun volume de
  certificats dans ce dépôt.
- La pile publie **un seul port HTTP** (`8080` par défaut, réglable via
  `WEB_PORT`), qui est la cible unique de NPM.
- Superposer un second reverse proxy avec sa propre gestion TLS aurait produit
  une double terminaison, des redirections en boucle et des en-têtes
  `X-Forwarded-*` incohérents.

Il subsiste un **nginx interne** au conteneur `web`, mais son rôle est différent et
limité : servir les fichiers statiques du front et regrouper `/api` et `/socket.io`
sous une **origine unique**. Cette unicité d'origine est nécessaire — sans elle, le
cookie de session n'accompagnerait pas le handshake WebSocket et l'authentification
temps réel tomberait. Ce nginx ne fait ni TLS, ni domaine, ni certificat.

---

## 3. Contrainte réglementaire

Le poker et le blackjack se jouent **exclusivement en jetons virtuels**, sans achat
possible et sans conversion en argent réel.

Dès qu'il y a mise en argent réel, le site relève de la réglementation **ANJ** et
exige un agrément. Le schéma de base de données prévoit donc un porte-monnaie
virtuel (`wallets`, `wallet_tx`) sans aucune passerelle de paiement. Les jetons sont
un score, pas une monnaie.

---

## 4. Choix techniques retenus

| Couche | Techno | Justification |
|---|---|---|
| Front | React 18 + TypeScript + **Vite** | Build statique, aucun runtime serveur à héberger |
| UI | **Tailwind CSS v4** | Configuration par CSS, pas de fichier JS, sortie minimale |
| État front | **Zustand** + TanStack Query | Zustand pour l'état temps réel, Query pour le REST |
| Back | Node 22 + **Fastify 5** | Plus léger et rapide qu'Express |
| Temps réel | **Socket.IO 4** | Rooms, reconnexion automatique, repli en polling |
| BDD | **PostgreSQL 16-alpine** | Image arm64 officielle, transactions fiables pour les jetons |
| ORM | **Drizzle** | 100 % TypeScript, aucun binaire natif (contrairement à Prisma sur ARM) |
| Mots de passe | **Argon2id** (`@node-rs/argon2`) | Recommandation OWASP, prébuilds arm64 |
| Front statique | **nginx 1.27-alpine** | Sert le front et unifie l'origine, rien de plus |
| Monorepo | **pnpm workspaces** | Types et règles de jeu partagés front/back |
| Tests | **Vitest** | Moteurs de jeu testables sans lancer de serveur |

Écartés volontairement : Redis (inutile avec un seul processus Node), Next.js (SSR
superflu pour une application de jeu authentifiée), Prisma (moteur natif lourd sur
ARM), Caddy (ferait doublon avec Nginx Proxy Manager).

---

## 5. Architecture

### 5.1 Serveur autoritaire

Le client **ne calcule jamais** l'issue d'un coup. Il émet une *intention*
(`action:bet`, `action:fold`, `motus:guess`) ; le serveur valide contre l'état et le
tour courant, applique, puis diffuse un état **filtré par destinataire**. Les cartes
fermées d'un adversaire ne quittent jamais le serveur.

C'est la seule protection anti-triche qui tienne : tout ce qui est calculé côté
client est modifiable côté client.

### 5.2 Moteurs de jeu = fonctions pures

Chaque jeu est un automate sans entrée/sortie, sans socket, sans base :

```
reduce(state, action) -> { state, events[] }
view(state, playerId)  -> état public, information cachée masquée
```

Les règles du poker se testent donc en millisecondes avec Vitest, sans serveur. La
couche Socket.IO n'est qu'un transport autour. Sans cette séparation, déboguer les
pots secondaires imposerait d'ouvrir trois navigateurs à chaque essai.

### 5.3 Flux réseau

```
Navigateur
   │ HTTPS  maxoujeux.maxencecoeur.fr
   ▼
Nginx Proxy Manager (NAS)          ← TLS, certificat, domaine
   │ HTTP  nas:8080
   ▼
conteneur web (nginx)              ← front statique + origine unique
   ├─ /              → /srv (fichiers Vite)
   ├─ /api/*         → api:3000
   └─ /socket.io/*   → api:3000  (WebSocket)
                          │
                          ▼
                   conteneur api (Fastify + Socket.IO)
                          │
                          ▼
                   conteneur db (PostgreSQL 16)
```

### 5.4 Arborescence

```
MaxouJeux/
├─ docker-compose.yml          # pile de production
├─ docker-compose.dev.yml      # PostgreSQL seul, pour le développement
├─ .env.example
├─ packages/
│  ├─ shared/                  # types + schémas Zod, contrat front/back
│  └─ engines/                 # logique pure des jeux (lots 1 à 4)
└─ apps/
   ├─ api/                     # Fastify, Socket.IO, Drizzle
   └─ web/                     # React, Vite, Tailwind, nginx.conf
```

---

## 6. Authentification

Email + mot de passe + pseudo, **sans vérification par email** (aucun SMTP à
administrer en V1).

- Mot de passe haché en **Argon2id**, 10 caractères minimum.
- **Session en base**, pas de JWT : cookie `httpOnly` + `Secure` + `SameSite=Lax`
  contenant un jeton opaque de 32 octets ; seul son SHA-256 est stocké. Une fuite de
  la base ne permet donc pas de rejouer les sessions.
  Avantage décisif sur le JWT : la **révocation est immédiate** — bannir un joueur ou
  se déconnecter partout prend effet à la requête suivante, sans attendre une
  expiration.
- Le handshake Socket.IO lit **le même cookie**. L'identité est établie côté serveur
  avant l'entrée dans la moindre room : le client n'envoie jamais son `userId` et ne
  peut donc pas en usurper un.
- Unicité de l'email et du pseudo **insensible à la casse**.
- Limitation de débit : 10 tentatives / 15 min / IP sur `/api/auth/*`.
- Temps de réponse constant sur un email inconnu, pour empêcher l'énumération des
  comptes inscrits.
- Champ `email_verified` déjà présent en base : activable le jour où un SMTP est
  branché, sans migration.

---

## 7. Jeux prévus

| Jeu | Joueurs | Jetons | Lot |
|---|---|---|---|
| **Puissance 4** | 2 | oui | 1 |
| **Morpion** | 2 | oui | 1 |
| **Motus** — mot du créneau en solo | 1 | oui | 2 |
| **Blackjack** — croupier automatique | 1 à 5 | oui | 3 |
| **Texas Hold'em** | 2 à 9 | oui | 4 |

### 7.1 Mises et gains

Une **mise est obligatoire dans tous les jeux**. Chaque jeu impose une mise maximale,
affichée avant l'entrée à la table et validée par le serveur : le client ne peut jamais
engager davantage en modifiant la requête.

| Jeu | Mise minimale | Mise maximale | Versement au gagnant |
|---|---:|---:|---|
| **Puissance 4** | 10 MC | 100 MC | 1,5 × la mise du joueur |
| **Morpion** | 10 MC | 100 MC | 1,5 × la mise du joueur |
| **Motus** | 100 MC | 100 MC | de 600 à 100 MC selon l'essai |
| **Blackjack** | 10 MC | 2 500 MC | selon la main et les options jouées |
| **Texas Hold'em** | cave de 500 MC | cave de 10 000 MC | part remportée du pot |

Pour le Puissance 4 et le Morpion, les deux joueurs engagent la même mise. Avec
10 MC chacun, le gagnant reçoit 15 MC, le perdant 0 et les 5 MC restants sont retirés
de l'économie. Une égalité rembourse les deux mises. Les mises progressent par pas de
10 MC et ne dépassent jamais 100 MC par joueur.

Motus est **exclusivement solo** et coûte 100 MC par mot. Le versement brut dépend de
la ligne à laquelle le mot est trouvé : 600, 450, 350, 250, 175 puis 100 MC de la
première à la sixième ligne. Un échec verse 0 MC ; une réussite à la sixième ligne
rend donc seulement la mise, sans gain net. Un nouveau mot est proposé toutes les six
heures.

Puissance 4 et Morpion sont livrés en premier délibérément : leurs règles sont
triviales, ils servent donc à valider toute la chaîne temps réel (matchmaking,
rooms, reconnexion, écriture des statistiques) avant d'y ajouter des règles
complexes.

Points connus qui font échouer les implémentations naïves, à traiter explicitement :

- **Poker** : pots secondaires en cas de tapis multiples, relance minimale et
  relance incomplète, timer par joueur avec couche automatique, sit-out et
  reconnexion. Évaluation des mains par `pokersolver` (pur JS, aucune dépendance
  native).
- **Motus** : lettres doublées dans le calcul jaune/vert, qui exige un algorithme en
  deux passes.
- **Blackjack** : séparation, doublement, assurance, pénétration du sabot.

---

## 8. Identité visuelle

Thème sombre « arcade feutrée », cohérent sur tous les écrans.

- Fond `#0f1115`, surfaces bleutées, accents néon réservés aux éléments actifs.
- Le **doré est réservé aux jetons et aux gains** — jamais décoratif, pour qu'il
  reste un signal lisible.
- Polices **Inter** et **Outfit** variables, auto-hébergées via npm : aucun appel à
  un CDN, le site fonctionne sur un réseau local coupé d'Internet.
- Avatars **procéduraux** dérivés d'une graine par compte : pas d'hébergement
  d'images, donc pas d'upload, de stockage ni de modération à prévoir.
- Responsive obligatoire — les tables se jouent beaucoup au téléphone.
- Accessibilité : navigation clavier, `aria-live` sur les erreurs de formulaire,
  respect de `prefers-reduced-motion`.

---

## 9. Exposition — configuration Nginx Proxy Manager

Une fois la pile démarrée sur le NAS, créer **un** hôte mandataire dans NPM :

| Champ | Valeur |
|---|---|
| Domain Names | `maxoujeux.maxencecoeur.fr` |
| Scheme | `http` |
| Forward Hostname / IP | IP locale du NAS (ou nom du conteneur si NPM partage le réseau) |
| Forward Port | `8080` (valeur de `WEB_PORT`) |
| **Websockets Support** | **activé — obligatoire** |
| Block Common Exploits | activé |
| SSL | certificat Let's Encrypt, *Force SSL* activé |

**Le point à ne pas manquer : « Websockets Support ».** Sans cette case, le front se
charge normalement mais aucune partie multijoueur ne fonctionne — le handshake
Socket.IO échoue silencieusement et se dégrade en polling, voire échoue tout court.

Côté DNS : un enregistrement **A** sur la zone de `maxencecoeur.fr` pointant vers
l'IP publique de la box, et un client DNS dynamique si cette IP n'est pas fixe.

---

## 10. État d'avancement

### Lot 0 — Socle : **livré et vérifié**

- Monorepo pnpm : `packages/shared`, `apps/api`, `apps/web`.
- Schéma PostgreSQL complet (11 tables, migration initiale générée), y compris les
  tables des lots ultérieurs — une seule migration initiale valant mieux que six
  migrations successives sur une base en production.
- Authentification complète : inscription, connexion, déconnexion, `/api/auth/me`.
- Socket.IO authentifié par cookie, avec présence des joueurs en temps réel.
- Front : écran connexion/inscription, lobby avec les 5 jeux et la liste des joueurs
  connectés, indicateur d'état de la liaison temps réel.
- Docker : `docker-compose.yml`, Dockerfiles multi-étapes non-root, `nginx.conf`,
  healthchecks, arrêt propre sur SIGTERM.
- **Développement sans infrastructure** : sans `DATABASE_URL`, l'API bascule sur
  **PGlite** (PostgreSQL compilé en WebAssembly, persisté dans `.data/`). Le projet
  se lance donc sans installer ni Docker ni PostgreSQL, tout en rejouant exactement
  les mêmes migrations SQL qu'en production.

Vérifications passées : typage strict sur les trois paquets, build de production
(API 28 Ko, front 91 Ko gzip), 9 scénarios d'authentification en HTTP réel, et
3 scénarios de handshake WebSocket — socket sans cookie refusée, socket avec cookie
valide acceptée, socket avec signature falsifiée refusée.

### Lots suivants

| Lot | Contenu | Charge |
|---|---|---|
| **1** | Couche temps réel générique (RoomManager, timers, reconnexion), matchmaking, Puissance 4 + Morpion, statistiques | 3 j |
| **2** | Motus : dictionnaire, mot du créneau, solo et barème par essai | 3 j |
| **3** | Blackjack : moteur, sabot, croupier, transactions de jetons | 4 j |
| **4** | Poker Hold'em : moteur + ~60 tests, UI de table, timers, sit-out | 8–10 j |
| **5** | Profils, classements Elo, chat, modération, sauvegardes | 3 j |

Chaque lot se termine sur une version déployée et jouable sur le NAS.

---

## 11. Commandes

### Développement

```bash
pnpm install
pnpm dev            # API sur :3000 (PGlite), front sur :5173
```

Pour développer sur un vrai PostgreSQL :

```bash
docker compose -f docker-compose.dev.yml up -d
# puis renseigner DATABASE_URL=postgres://maxoujeux:maxoujeux@localhost:5433/maxoujeux
```

### Vérifications

```bash
pnpm typecheck
pnpm test
pnpm build
```

### Déploiement sur le NAS

```bash
cp .env.example .env        # renseigner POSTGRES_PASSWORD et SESSION_SECRET
docker compose up -d --build
docker compose ps           # les trois services doivent être "healthy"
```

Puis créer l'hôte mandataire dans NPM (section 9).

### Après modification du schéma de base

```bash
pnpm db:generate            # génère la migration SQL
```

Les migrations sont rejouées automatiquement au démarrage de l'API.

---

## 12. Points de vigilance sur le NAS

- **Ports 80/443 occupés par NPM** : la pile publie `8080`, à ajuster via `WEB_PORT`
  en cas de conflit avec un autre conteneur.
- **Volume PostgreSQL** sur le pool SSD/NVMe si disponible, **jamais** sur un partage
  réseau.
- **Sauvegarde** : `pg_dump` quotidien vers un dossier du NAS déjà sauvegardé. À
  mettre en place au lot 5, avant que la base ne contienne des comptes réels.
- **Construction des images** : le CPU ARM compile lentement. Soit `docker compose
  build` directement sur le NAS (5 à 10 min pour le front), soit un build croisé
  `docker buildx --platform linux/arm64` depuis un PC équipé de Docker, poussé sur
  GHCR puis récupéré par `docker compose pull`.
- **Limite mémoire** : le conteneur `api` est plafonné à 512 Mo, pour qu'une fuite
  dans une partie n'emporte pas le NAS entier.
