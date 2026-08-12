# Compteur en secondes dans l’anneau des jeux de casino

## Problème

Pendant la phase de mise, l’anneau circulaire se vide sur un tour complet. Lorsque son extrémité atteint le bas, seule la moitié du délai est écoulée, mais cette position est facilement interprétée comme la fin du compte à rebours. Il semble alors que la roulette ou la donne de blackjack tarde à démarrer.

## Comportement attendu

- L’anneau reste dimensionné sur l’échéance fournie par le serveur.
- Le nombre de secondes restantes apparaît au centre de l’anneau pendant les phases chronométrées de la table.
- Le nombre utilise un arrondi supérieur : il affiche `1` tant que l’échéance n’est pas atteinte, puis `0` à l’expiration réelle.
- La roulette et la montre de table du blackjack utilisent le même composant et la même logique.
- L’anneau placé autour de l’avatar pendant le tour individuel d’un joueur conserve l’avatar au centre afin de ne pas masquer l’identité du joueur actif.
- Le mode d’animations réduites continue d’afficher un compteur lisible sans animation trompeuse.

## Conception

`ProgressRing` reçoit une option d’affichage du compteur. Son `useCountdown(deadlineAt)` existant devient la source unique du nombre et de l’état urgent. Le composant convertit ce délai en secondes avec `Math.ceil(remaining / 1000)` et affiche le nombre seul (`15`, `14`, …, `0`), adapté à la petite taille de l’anneau.

La montre de phase de la roulette et la montre de table du blackjack activent cette option. Leurs éléments décoratifs centraux restent l’arrière-plan du nombre. Les anneaux des sièges de blackjack ne l’activent pas.

Cette approche est préférée à un compteur créé séparément dans chaque jeu : elle évite deux minuteries React pour la même échéance et garantit une présentation identique.

## Accessibilité

Le compteur est du texte réel, contrasté et à chiffres tabulaires. Son libellé accessible annonce les secondes restantes. L’anneau SVG reste décoratif, car le nombre porte l’information utile.

## Tests

- Le rendu de `ProgressRing` avec l’option contient la valeur arrondie et son libellé accessible.
- Sans l’option, aucun compteur central n’est ajouté.
- Les rendus statiques roulette et blackjack activent le compteur sur leur montre de phase.
- Les tests existants garantissent qu’un seul anneau est visible au bon endroit.
- Le typecheck, les tests web et la construction du front valident l’intégration.
