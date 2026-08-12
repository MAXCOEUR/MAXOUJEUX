# Zone d'administration et chat global éphémère

## Objectif

Ajouter à MaxouJeux une administration simple réservée à des comptes explicitement
marqués comme administrateurs, ainsi qu'un chat global disponible sur tous les écrans.
Le chat ne conserve aucun historique en base ni en mémoire serveur : chaque navigateur
ne garde que les 1 000 derniers messages reçus pendant la session d'application.

## Périmètre

La zone d'administration permet de consulter tous les comptes, de créer des joueurs,
de réinitialiser leur mot de passe, de fixer leur solde MaxouCoin et de supprimer leur
compte. Les comptes administrateurs sont visibles mais entièrement protégés contre ces
actions. La création d'un administrateur passe uniquement par la configuration de
l'exploitant au démarrage de l'API.

Le chat est une conversation unique commune à tous les comptes connectés. Il ne propose
ni salons, ni messages privés, ni historique, ni modération persistante.

## Identité et création de l'administrateur

La table `users` reçoit une colonne booléenne `is_admin`, non nulle et à `false` par
défaut. L'utilisateur authentifié exposé par la session et le contrat `CurrentUser`
incluent ce rôle. Le front peut ainsi montrer l'entrée d'administration, mais l'API
reste l'autorité : un garde `requireAdmin` vérifie le rôle sur chaque route concernée.

Trois variables d'environnement configurent le compte initial :

- `ADMIN_EMAIL` ;
- `ADMIN_PSEUDO` ;
- `ADMIN_PASSWORD`.

Elles sont facultatives en bloc, mais une configuration partielle empêche le démarrage.
Elles sont documentées dans `.env.example` et `docker-compose.example.yml`. Après
l'application des migrations, l'API exécute un amorçage idempotent : si l'email est
absent, elle crée le compte administrateur, son portefeuille et l'écriture de bonus
initial dans une transaction ; si l'email existe, elle marque ce compte administrateur.
Un redémarrage ne remplace jamais le mot de passe d'un compte existant.

## API d'administration

Les routes sont regroupées sous `/api/admin` et protégées par l'authentification puis le
rôle administrateur :

- `GET /accounts` renvoie les comptes avec identifiant, email, pseudo, rôle, solde,
  date de création et dernière activité ;
- `POST /accounts` crée uniquement un joueur avec email, pseudo et mot de passe ;
- `PATCH /accounts/:id/password` définit un nouveau mot de passe ;
- `PATCH /accounts/:id/balance` fixe le nouveau solde exact ;
- `DELETE /accounts/:id` supprime définitivement un joueur.

Les entrées utilisent des schémas Zod partagés entre le front et l'API. Les comptes
administrateurs sont en lecture seule, y compris le compte de l'appelant. Le serveur
rejoue cette protection en relisant la cible en base au moment de chaque action.

La création réutilise une primitive de création de compte commune afin que compte,
portefeuille et bonus initial restent atomiques. Une collision d'email ou de pseudo est
signalée sur le champ concerné.

La réinitialisation hache le mot de passe avec Argon2id, révoque toutes les sessions du
joueur et déconnecte ses sockets une fois l'écriture validée. La suppression est refusée
si `activityOf(userId)` indique une table ou une tentative Motus active. Sinon, la
suppression en base est validée avant de déconnecter les sockets restantes ; les
cascades existantes retirent les données rattachées au compte.

## Ajustement administratif des MaxouCoin

Le formulaire reçoit un solde cible entier supérieur ou égal à zéro. Le service de
portefeuille reste le seul module autorisé à écrire dans `wallets`. Une nouvelle
primitive transactionnelle verrouille la ligne du portefeuille, lit le solde courant,
calcule `delta = cible - courant`, fixe la cible et ajoute une écriture
`admin_adjustment` dont `balance_after` provient de la valeur renvoyée par la base.

Un solde identique ne produit pas de mouvement vide. Après validation, le nouveau solde
est diffusé à toutes les sockets du joueur par le mécanisme de notification existant.
Cette séquence préserve l'invariant auditable : la somme des mouvements reste égale au
solde courant, y compris en présence d'une opération concurrente.

## Interface d'administration

Le routeur maison reçoit la route `/admin`. Un lien visible uniquement pour un
administrateur est ajouté au shell de l'application. Taper cette adresse avec un compte
joueur ramène au lobby, tandis que l'API renverrait de toute façon un refus si le front
était contourné.

La page présente un tableau responsive séparant visuellement le rôle, avec email,
pseudo, solde, création et dernière activité. Un bouton principal crée un joueur. Les
actions d'un joueur ouvrent des fenêtres ciblées : nouveau mot de passe, nouveau solde
ou confirmation de suppression. Les lignes administrateur n'offrent aucune action.
Après une mutation, la liste est actualisée et les erreurs de validation restent près
du champ qui les a causées.

## Protocole du chat global

Le contrat Socket.IO partagé ajoute :

- `chat:send`, intention client contenant uniquement le corps du message et un accusé
  de réception typé ;
- `chat:message`, événement serveur contenant identifiant, identifiant joueur, pseudo,
  graine d'avatar, corps et date ISO.

Le serveur tire l'identité de `socket.data`, normalise le texte, refuse un corps vide et
le limite à 500 caractères. Il attribue l'identifiant et l'horodatage, puis diffuse le
message à toutes les sockets. Une limitation par socket autorise une petite rafale mais
refuse le martèlement ; son état temporaire est libéré à la déconnexion.

Le serveur ne tient aucune collection de messages et n'écrit jamais dans
`chat_messages`. La table historique déjà présente reste inutilisée afin d'éviter une
migration destructive sans bénéfice. Il n'existe aucun événement de récupération : un
nouveau client ou un client reconnecté ne reçoit que les messages futurs.

## État et interface du chat

Un store Zustand global, hors du cycle des pages React, reçoit `chat:message`. Il ajoute
le message puis tronque le début du tableau pour ne conserver que les 1 000 plus récents.
L'état n'est écrit ni dans `localStorage`, ni dans `sessionStorage`, ni dans un cache de
requêtes.

La navigation, la fermeture du panneau et une coupure réseau temporaire conservent les
messages déjà présents. Le rechargement ou la fermeture de l'onglet les perd par nature.
La déconnexion applicative vide explicitement le store pour éviter qu'un autre compte
sur le même appareil ne voie la conversation précédente. Les messages manqués pendant
une coupure ne sont pas rattrapés.

Le `AppShell` affiche partout un bouton de chat et un panneau responsive. Le bouton porte
un compteur de messages non lus lorsque le panneau est fermé. Le panneau montre les
avatars, pseudos, heures et messages, puis un champ limité à 500 caractères. Il conserve
le focus et le défilement de façon prévisible, fonctionne au clavier et n'utilise pas de
région `aria-live` globale qui annoncerait chaque message lorsque le panneau est fermé.

## Erreurs et sécurité

Les cas métier utilisent `AppError` et le format d'erreur existant : absence de session,
rôle insuffisant, cible introuvable, compte administrateur protégé, joueur en activité,
collision de compte, mot de passe ou solde invalide, message vide, message trop long et
limitation anti-spam. Les erreurs inattendues restent journalisées côté serveur et sont
opaques pour le client.

Le client n'envoie jamais d'identité pour le chat ni de rôle pour une création. Les
contrôles d'interface sont toujours rejoués par l'API. Les déconnexions forcées passent
par un notifieur injecté dans la couche compte afin de ne pas coupler les services métier
à Socket.IO.

## Vérification

Les tests partagés couvrent les nouveaux schémas et contrats. Les tests API vérifient
l'amorçage idempotent, le refus d'une configuration partielle, la garde administrateur,
la protection de tous les administrateurs, les collisions de création, la révocation de
session, le refus de suppression pendant une activité et l'invariant du portefeuille
après ajustement.

Les tests du chat vérifient la validation, l'identité issue de la socket et la limitation
de débit. Les tests web couvrent le tampon borné à 1 000 messages, le compteur non lu et
la purge lors de la déconnexion. La vérification finale exécute les tests ciblés, la
suite complète, le typecheck et le build, puis contrôle dans le navigateur les parcours
admin et chat aux largeurs mobile et ordinateur.

## Hors périmètre

La V1 n'ajoute ni création d'administrateur depuis l'interface, ni modification ou
suppression d'un administrateur, ni rôles multiples, ni audit distinct des gestes admin,
ni bannissement, ni messages privés, ni salons de chat, ni historique, ni recherche, ni
suppression ou modération de messages.
