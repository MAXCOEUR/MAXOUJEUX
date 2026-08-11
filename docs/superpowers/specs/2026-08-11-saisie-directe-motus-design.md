# Saisie directe et clavier Motus

## Objectif

Remplacer le champ de proposition placé sous la grille Motus par une saisie directement
visible dans la ligne active, à la manière de Wordle. Ajouter un clavier AZERTY utilisable
à la souris et au toucher, tout en conservant la saisie au clavier physique.

## Interface

Le champ texte et son bouton de validation disparaissent. Le clavier est placé sous la
grille et reprend l'organisation AZERTY française sur trois rangées. La dernière rangée
contient également une touche d'effacement et une touche de validation clairement
identifiables.

La ligne active continue d'afficher le brouillon avant son envoi au serveur. La case où
sera écrite la prochaine lettre reçoit un contour renforcé. Ce contour avance pendant la
saisie ; lorsque le mot atteint sa longueur maximale, il reste sur la dernière case. Il
n'apparaît ni sur les lignes déjà validées ni lorsque la partie est terminée.

Le langage visuel existant est conservé : feutre pour les touches neutres, vert pour une
lettre bien placée, jaune pour une lettre présente ailleurs et gris pour une lettre
absente. Aucune nouvelle couleur métier n'est introduite.

## Interactions

Un clic ou un toucher sur une lettre l'ajoute au brouillon tant que la longueur du mot
n'est pas atteinte. La touche d'effacement retire la dernière lettre. La touche de
validation envoie la proposition uniquement lorsque toutes les cases sont remplies.

Le clavier physique offre le même comportement avec les touches alphabétiques,
Retour arrière et Entrée. Les accents sont normalisés comme aujourd'hui. Les raccourcis
ne capturent pas les frappes lorsqu'une touche modificatrice est active, et ils sont
désactivés pendant une requête ou hors d'une partie en cours.

Pendant l'envoi, la grille et le clavier sont verrouillés. Une erreur du serveur reste
affichée sous le clavier et conserve le brouillon pour permettre sa correction. Un état
autoritaire reçu après une proposition acceptée vide le brouillon et active la ligne
suivante.

## Couleurs de l'alphabet

Les couleurs du clavier sont dérivées uniquement des essais confirmés reçus du serveur.
Pour une lettre vue plusieurs fois, l'état le plus informatif l'emporte selon l'ordre :
`correct` (vert), puis `present` (jaune), puis `absent` (gris). Une lettre jamais jouée
reste neutre. Le client ne tente pas de deviner le mot ni d'évaluer le brouillon.

## Structure et tests

La dérivation des couleurs et les opérations élémentaires sur le brouillon sont isolées
dans un module pur côté web. Des tests unitaires vérifient notamment la priorité des
couleurs, la limite de longueur, l'effacement et la normalisation des lettres. Le
composant de clavier ne fait qu'afficher ces états et transmettre les intentions.

La vérification finale comprend les tests du paquet web, le typecheck du dépôt et un
contrôle manuel de l'écran Motus sur ordinateur et sur une largeur mobile.

## Hors périmètre

Le protocole Socket.IO, les règles du moteur, les couleurs des cases validées, le barème
et le contrat serveur ne changent pas.
