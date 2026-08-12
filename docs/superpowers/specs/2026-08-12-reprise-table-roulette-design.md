# Reprise d'une table de roulette depuis le salon

## Objectif

Donner à la roulette le même parcours de sortie temporaire que le blackjack :
un joueur peut quitter l'écran de table sans abandonner sa place ni ses mises,
voir qu'une table reste active depuis le reste de l'application, puis y revenir
en un geste.

Le problème de durée entre les phases de jeu est volontairement traité dans un
diagnostic séparé. Cette modification ne change aucune minuterie serveur.

## Comportement attendu

- La flèche de retour de la roulette ouvre un dialogue au lieu de naviguer
  immédiatement.
- Le dialogue propose deux actions distinctes :
  - « Garder ma place » ferme le dialogue et retourne au salon de la roulette,
    sans envoyer `match:leave` et sans vider le store roulette ;
  - « Quitter la table » envoie `match:leave`, vide le store après confirmation
    du serveur, puis retourne au salon.
- Les mises déjà confirmées continuent leur manche lorsque le joueur garde sa
  place. Une composition locale non confirmée n'est pas une mise et peut être
  perdue au démontage de la page.
- Recevoir un événement `roulette:state` met à jour le store, mais ne provoque
  jamais de navigation.
- Hors de la table concernée, un bandeau indique qu'une table de roulette reste
  active et propose « Reprendre ».
- Le bandeau n'est pas affiché lorsque cette table est déjà à l'écran.

## Architecture

### État et navigation

`bindRouletteEvents` devient un simple adaptateur d'état, sur le modèle de
`bindBlackjackEvents`. La navigation reste déclenchée par un geste explicite :
entrée depuis le salon, bouton « Reprendre », ou choix dans le dialogue.

Une fonction pure `rouletteResume(view, currentTableId)` transforme la vue
serveur en résumé minimal destiné au bandeau. Elle renvoie `null` lorsqu'il n'y
a rien à reprendre ou lorsque la table est déjà affichée. Sinon elle fournit
l'identifiant de table, le montant engagé par le joueur, la phase et l'échéance
utile à l'affichage.

### Interface

`RouletteTablePage` reprend le dialogue de sortie du blackjack avec un texte
adapté à la roulette. Pendant une manche, le message précise que les jetons
confirmés restent en jeu même si le joueur revient au salon.

`ResumeBanner` lit également le store roulette. La priorité reste déterministe :
blackjack, puis roulette, puis partie de duel. Le verrou d'activité du serveur
garantit qu'un joueur ne peut normalement avoir qu'une seule de ces activités.
Le bandeau roulette affiche le montant engagé lorsqu'il est positif et l'état
de la table lorsqu'aucune mise n'est encore engagée.

## Gestion des erreurs

- Une erreur de `match:leave` conserve le joueur sur la page et affiche le
  message serveur ; le store n'est pas vidé.
- `TABLE_GONE` est traité comme un départ réussi, car la destination correcte
  reste le salon.
- « Garder ma place » ne dépend d'aucune réponse réseau : il ne change que la
  route affichée.

## Tests

- Test de non-régression : un événement `roulette:state` reçu depuis le salon
  met le store à jour sans naviguer vers la table.
- Tests purs de `rouletteResume` : absence de vue, table déjà affichée, joueur
  sans mise, joueur avec mise, et informations de phase.
- Tests de rendu du bandeau si le harnais existant permet de vérifier le texte
  sans introduire une infrastructure de test disproportionnée.
- Suite web, typecheck global et tests complets avant livraison.

## Hors périmètre

- Modification des durées de mise, de lancer ou d'affichage du résultat.
- Changement des règles de remboursement ou de règlement côté serveur.
- Généralisation complète de tous les dialogues de sortie dans une nouvelle
  abstraction partagée.
