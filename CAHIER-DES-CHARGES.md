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
│  └─ engines/                 # logique pure des jeux (Puissance 4, Morpion ; puis 2 à 4)
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
| **Puissance 4** | 2 | oui | 1 — *livré* |
| **Morpion** | 2 | oui | 1 — *livré* |
| **Motus** — mot du créneau en solo | 1 | oui | 2 |
| **Blackjack** — croupier automatique | 1 à 5 | oui | 3 |
| **Texas Hold'em** | 2 à 9 | oui | 4 |

### 7.1 Capacité initiale des jeux

Le nombre de parties simultanées est volontairement plafonné afin qu'un afflux de
joueurs ne puisse pas saturer le petit serveur. Au lancement, les limites sont :

| Jeu | Capacité simultanée maximale |
|---|---:|
| **Puissance 4** | 10 parties de 2 joueurs |
| **Morpion** | 10 parties de 2 joueurs |
| **Motus** | 10 sessions solo |
| **Blackjack** | 1 table de 5 joueurs |
| **Texas Hold'em** | 1 table de 9 joueurs |

Il n'existe donc qu'une seule table de poker et une seule table de blackjack au
lancement. La création de tables supplémentaires constitue une évolution possible,
à activer uniquement après avoir observé la consommation réelle du serveur et réalisé
des tests de charge.

Ces plafonds sont appliqués par le serveur, depuis une configuration centralisée. Un
client ne peut ni les contourner ni créer directement une room. Un joueur ne peut
participer qu'à **une seule partie active à la fois**, quel que soit le nombre d'onglets
ou d'appareils connectés à son compte.

Lorsque la capacité d'un jeu est atteinte, aucune nouvelle partie n'est créée et le
serveur renvoie une erreur métier explicite ; les parties déjà commencées continuent
normalement. Une partie terminée ou définitivement abandonnée est retirée sans délai du
gestionnaire de rooms afin de libérer sa place. La vérification et la réservation de
capacité doivent être atomiques pour que deux demandes simultanées ne puissent jamais
dépasser le plafond.

### 7.2 Mises et gains

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

- Palette « feutre, laiton, crème » nommée d'après la matière : fond `#0b1410`, surfaces
  vertes assombries, chaque jeu portant sa propre couleur d'accent.
- Le **doré est réservé aux jetons et aux gains** — jamais décoratif, pour qu'il
  reste un signal lisible. Le tour actif est en vert, les erreurs en rouge.
- Polices **Bricolage Grotesque** (titres), **Figtree** (texte) et **JetBrains Mono**
  (chiffres et comptes à rebours) en versions variables, auto-hébergées via npm
  (`@fontsource-variable`) : aucun appel à un CDN, le site fonctionne sur un réseau local
  coupé d'Internet. Le monospace n'est pas décoratif — des chiffres de largeur fixe
  empêchent la ligne de trembler à chaque seconde.
- Avatars **procéduraux** dérivés d'une graine par compte : pas d'hébergement
  d'images, donc pas d'upload, de stockage ni de modération à prévoir.
- Responsive obligatoire — les tables se jouent beaucoup au téléphone. L'orientation
  paysage est traitée explicitement : sans cela, un téléphone couché n'affiche qu'un tiers
  du plateau.
- Accessibilité : navigation clavier, `aria-live` sur les erreurs de formulaire et sur le
  tour de jeu, respect de `prefers-reduced-motion`. **Jamais de région annoncée sur un
  compte à rebours** — un lecteur d'écran énoncerait chaque seconde et couvrirait tout le
  reste. Les plateaux ne reposent jamais sur la seule couleur : le Morpion distingue par la
  forme, et chaque siège rappelle son jeton à côté du pseudo.

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

### Lot 1 — Temps réel, tables, Puissance 4 & Morpion : **livré**

- **`packages/engines`** : nouveau paquet de règles pures. Contrat
  `reduce(state, move) -> { state, events }` et `view(state, seat)`. Grille en tableau
  plat, détection d'alignement commune aux deux jeux, coups illégaux typés
  (`IllegalMove`). **31 tests** : les quatre directions d'alignement, le segment de cinq
  disques, l'égalité sur grille pleine vérifiée case par case, l'immuabilité de l'état.
- **Gestionnaire de tables** en mémoire : cycle de vie `waiting → playing → finished`,
  plafond de 10 tables par jeu, index « une seule partie active par joueur » tous appareils
  confondus, réservation **synchrone** avant écriture en base pour que deux demandes
  simultanées ne puissent jamais dépasser une capacité ni occuper le même siège.
- **Minuteries** : 30 s par coup puis forfait, 45 s de sursis après la perte de la dernière
  socket puis abandon, 10 min pour une table sans adversaire puis annulation et
  remboursement. Garde de version sur chaque rappel, purge à l'arrêt du serveur.
- **Reconnexion** : un rechargement de page ou une coupure réseau ne coûte pas la mise.
  L'état de la partie est repoussé au rattachement de la socket.
- **Mises et règlement** : débit à l'entrée sur la table, versement de 1,5 × la mise au
  vainqueur, remboursement sur égalité, écriture de `matches`, `match_players` et `stats`
  dans une **seule transaction** avec les mouvements de MaxouCoin.
- **Front** : routeur d'URL (`/`, `/jeu/:code`, `/table/:id`), salon des tables par jeu
  avec état vide soigné et sélecteur de mise, plateaux Puissance 4 et Morpion animés,
  anneau de temps par tour, bandeau de reprise de partie, notifications d'erreur.
  Responsive PC / téléphone, orientation paysage traitée, secondes affichées sur tous les
  comptes à rebours.

Vérifications passées : typage strict sur les quatre paquets, **122 tests** (47 partagés,
31 moteurs, 44 API), build de production (API 66 Ko, front 108 Ko gzip), et une partie
complète jouée de bout en bout contre l'API réelle — deux comptes, deux sockets
authentifiées par cookie, diffusion du salon, refus d'un coup hors tour et d'un coup sur
état périmé, victoire détectée, soldes conformes (5 000 → 4 980 → 5 010 pour le vainqueur,
4 980 pour le perdant, 10 MC retirés de l'économie).

Décisions arrêtées à cette occasion :

| Question | Choix retenu |
|---|---|
| Temps écoulé sur un coup | Forfait au bout de 30 s ; l'adversaire encaisse |
| Déconnexion en pleine partie | 45 s de sursis, puis abandon |
| Accès aux tables | Une page « salon » par jeu, depuis la carte du lobby |
| Statistiques | Écrites en base, avec un récapitulatif discret ; Elo au lot 5 |

### Lot 2 — Motus : **livré**

- **Moteur pur** : normalisation des accents et de la cédille, comparaison en deux
  passes pour les lettres doublées, six essais, et vue ne contenant jamais le secret.
- **Dictionnaire embarqué** : 60 024 formes françaises acceptées de 5 à 8 lettres,
  dont 3 868 solutions courantes et familiales. Il est dérivé de Lexique 4, figé par le
  SHA-256 `8ed5a64373ae798f0485a2a35848c09286b6694c6859abeaab6806594c046993`, avec
  filtrage des solutions par `french-badwords-list@1.0.7`. Le script reproductible et
  les notices CC BY-SA 4.0 / MIT sont conservés dans `apps/api/scripts/` et
  `apps/api/src/modules/motus/data/` ; aucune API externe n'est appelée en production.
- **Quatre créneaux par jour** : tous les joueurs reçoivent le même mot du créneau.
  La sélection concurrente est protégée par `INSERT … ON CONFLICT`, et une partie
  commencée reste reprenable après le changement de créneau.
- **Économie transactionnelle** : mise fixe de 100 MC, débit unique même sur double
  clic, puis récompense brute de 600 / 450 / 350 / 250 / 175 / 100 MC selon l'essai.
  Tentative, version, clôture et mouvements de portefeuille sont atomiques.
- **Cycle de vie** : dix comptes attachés au maximum, multi-onglets compté une seule
  fois, exclusion mutuelle avec les tables. Quitter ou perdre le réseau suspend la
  tentative ; seul l'abandon explicite la clôt sans remboursement.
- **Front** : accès direct par `/jeu/motus`, grille responsive de 5 à 8 lettres,
  saisie native, couleurs accompagnées de libellés accessibles, synchronisation entre
  onglets et reconnexion automatique. Après une défaite, le mot reste caché.

Vérifications passées : typage strict sur les quatre paquets, **156 tests** (51 partagés,
39 moteurs, 66 API), dont les courses réelles sur PostgreSQL 16 ; build de production
(API 82,84 Ko, front 111,52 Ko gzip). La migration de 1,8 Mo contenant le dictionnaire
s'applique en environ 3,9 s sur une base PGlite vierge. Les images locales mesurées font
303,5 Mo pour l'API et 48,9 Mo pour le front. Le parcours navigateur couvre les grilles
5 et 8 lettres, téléphone 360 px sans débordement, deux onglets, coupure réseau,
abandon et réduction des mouvements.

### Lots suivants

| Lot | Contenu | Charge |
|---|---|---|
| **3** | Blackjack : moteur, sabot, croupier, transactions de jetons | 4 j |
| **4** | Poker Hold'em : moteur + ~60 tests, UI de table, timers, sit-out | 8–10 j |
| **5** | Profils, classements Elo, chat, modération, sauvegardes | 3 j |

Chaque lot se termine sur une version déployée et jouable sur le NAS.

---

## 11. Commandes

### Développement

```bash
pnpm install
cp .env.example .env   # renseigner au moins SESSION_SECRET (32 caractères minimum)
pnpm dev               # API sur :3000 (PGlite), front sur :5173
```

Le script `dev` de l'API charge `.env` s'il existe. `SESSION_SECRET` n'a **pas** de valeur
par défaut : une clé de signature implicite serait une faille silencieuse, l'API refuse
donc de démarrer sans elle.

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
docker compose pull
docker compose up -d
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
- **Sauvegarde** : `pg_dump` quotidien vers un dossier du NAS déjà sauvegardé. Une
  sauvegarde vérifiée est obligatoire avant le premier déploiement de la migration Motus.
- **Construction des images** : le NAS ne compile rien. Le workflow GitHub Actions
  vérifie typage et tests, construit en ARM64, puis publie sur GHCR ; le NAS ne fait que
  `docker compose pull`.
- **Limite mémoire** : le conteneur `api` est plafonné à 512 Mo, pour qu'une fuite
  dans une partie n'emporte pas le NAS entier.
