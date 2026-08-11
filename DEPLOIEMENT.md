# Déploiement sur le NAS

Le NAS ne compile rien. GitHub Actions construit les deux images en ARM64 et les publie
sur GHCR ; le NAS ne fait que les tirer.

```
push sur main
      │
      ▼
GitHub Actions ── typecheck + tests ──► si vert, build ARM64 ──► GHCR
                                                                  │
                          docker compose pull  ◄────────────────── ┘
                          docker compose up -d
```

Deux images sont publiées :

- `ghcr.io/maxcoeur/maxoujeux-api`
- `ghcr.io/maxcoeur/maxoujeux-web`

Le dépôt s'appelle `MAXCOEUR/MAXOUJEUX` mais les noms d'images sont en **minuscules** :
GHCR refuse les majuscules. Le workflow s'en charge automatiquement.

Étiquettes disponibles : `latest` (suit `main`), `sha-abc1234` (un commit précis), et
`1.2` / `1.2.3` si tu poses un tag `v1.2.3`.

---

## Première installation

À faire une seule fois sur le NAS.

### 1. Rendre les images publiques

Après le tout premier passage du workflow, GHCR crée les packages en **privé** même sur un
dépôt public. Pour chacun des deux :

GitHub → ton profil → **Packages** → `maxoujeux-api` → **Package settings** →
*Change visibility* → **Public**. Idem pour `maxoujeux-web`.

Sans cela il faudrait un `docker login ghcr.io` sur le NAS à chaque tirage.

### 2. Poser les fichiers sur le NAS

Un dossier suffit, par exemple `/volume1/docker/maxoujeux`. Il n'a besoin que de trois
fichiers — **pas** du code source :

```
docker-compose.yml
.env
```

Les récupérer depuis le dépôt :

```bash
mkdir -p /volume1/docker/maxoujeux && cd /volume1/docker/maxoujeux
curl -O https://raw.githubusercontent.com/MAXCOEUR/MAXOUJEUX/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/MAXCOEUR/MAXOUJEUX/main/.env.example
```

### 3. Renseigner les secrets

```bash
# Deux valeurs à générer, à coller dans .env
openssl rand -base64 24    # → POSTGRES_PASSWORD
openssl rand -base64 48    # → SESSION_SECRET
```

Vérifier aussi dans `.env` :

| Variable | Valeur attendue |
|---|---|
| `GHCR_OWNER` | `maxcoeur` (en minuscules) |
| `PUBLIC_ORIGIN` | `https://maxoujeux.maxencecoeur.fr` |
| `WEB_PORT` | `8080` — cible de Nginx Proxy Manager |

`SESSION_SECRET` déconnecte tout le monde si elle change : la générer une fois et ne plus
y toucher.

### 4. Démarrer

```bash
docker compose up -d
docker compose ps          # les trois services doivent être "healthy"
```

Les migrations SQL sont appliquées **au démarrage de l'API** : il n'y a aucune étape
séparée à lancer.

### 5. Publier par Nginx Proxy Manager

Dans NPM, créer un *Proxy Host* :

- Domaine : `maxoujeux.maxencecoeur.fr`
- Forward vers : IP du NAS, port `8080`
- **Websockets Support : activé** — sans cela le lobby et les parties ne se connectent pas
- SSL : demander un certificat Let's Encrypt, *Force SSL*

Cette pile ne gère ni TLS ni domaine : c'est NPM qui termine le HTTPS.

---

## Mise à jour

Deux commandes, depuis le dossier `/volume1/docker/maxoujeux` :

```bash
docker compose pull
docker compose up -d
```

`pull` télécharge les nouvelles images, `up -d` ne recrée que les conteneurs dont l'image
a changé. La base de données n'est pas touchée : elle vit dans le volume `pgdata`.

Compter une trentaine de secondes de coupure. Les joueurs en partie sont déconnectés — le
client se reconnecte seul, mais l'état des parties en mémoire est perdu tant que la
persistance des tables n'existe pas.

Pour vérifier que c'est parti :

```bash
docker compose logs -f api      # Ctrl-C pour sortir
curl -s http://localhost:8080/api/health
```

Si `docker-compose.yml` a changé dans le dépôt (nouveau service, nouvelle variable), le
récupérer avant de tirer :

```bash
curl -O https://raw.githubusercontent.com/MAXCOEUR/MAXOUJEUX/main/docker-compose.yml
```

---

## Revenir en arrière

Une mise à jour casse quelque chose ? Le récapitulatif du workflow **Images Docker**
donne l'étiquette `sha-…` de chaque build. Dans `.env` :

```bash
TAG=sha-abc1234
```

puis :

```bash
docker compose up -d
```

Les images précédentes restent sur GHCR : aucun rebuild n'est nécessaire.

⚠️ Une seule limite : un retour arrière ne défait pas une migration SQL. Si la version
fautive a modifié le schéma, l'ancienne image peut ne plus savoir lire la base. Tant qu'il
n'y a pas de sauvegarde en place, se méfier des mises à jour qui touchent
`apps/api/src/db/schema.ts`.

---

## Nettoyage

Les anciennes images s'accumulent sur le NAS :

```bash
docker image prune -a --filter "until=336h"    # supprime les images inutilisées de plus de 14 j
```

---

## À prévoir avant d'ouvrir le site

- **Sauvegarde `pg_dump`** — les comptes et les MaxouCoin des joueurs ne se recréent pas.
  Volontairement remis à plus tard, mais c'est le premier manque de cette installation.
- **Tests de concurrence sur un vrai PostgreSQL** — voir `CLAUDE.md`. PGlite sérialise les
  requêtes et ne prouve rien sur les débits simultanés.
