# Partage du résultat Motus

## Objectif

Permettre au joueur de partager chaque partie Motus terminée sous une forme proche de
Wordle : score et grille de couleurs, sans lettre ni mot secret. Le partage est proposé
après une victoire, un échec au sixième essai ou un abandon.

## Format

Le texte partagé suit cette structure :

```text
MaxouJeux Motus — 3/6

🟩⬛🟨⬛🟩
🟩🟨⬛🟨🟩
🟩🟩🟩🟩🟩

https://maxoujeux.maxencecoeur.fr/jeu/motus
```

- victoire : `<nombre d'essais>/6` ;
- échec après six essais : `X/6` ;
- abandon : `Abandon — <nombre d'essais>/6` ;
- seules les lignes réellement jouées sont incluses ; un abandon avant le premier essai
  partage le titre, le statut et le lien sans ligne de couleurs ;
- `correct` devient 🟩, `present` devient 🟨 et `absent` devient ⬛ ;
- le lien est construit avec `window.location.origin` et le chemin `/jeu/motus`, afin de
  fonctionner sur le domaine de production comme en développement ;
- le pseudo, les MaxouCoin, les lettres proposées et le mot secret sont exclus.

## Architecture et flux

Une fonction pure du paquet `@maxoujeux/shared` transforme une `MotusView` terminale et
une URL d'application en texte. Elle refuse une vue encore disponible ou en cours. Cette
frontière rend le format testable sans navigateur et garantit que la page ne reconstruit
pas les règles de couleurs.

Le composant de résultat affiche un bouton secondaire « Partager le résultat ». Au clic :

1. le client génère le texte avec la fonction partagée ;
2. si `navigator.share` existe, il appelle le menu natif avec un titre et le texte complet ;
3. sinon, il écrit le même texte dans `navigator.clipboard` ;
4. après une copie réussie, une notification confirme « Résultat copié ».

Aucune route API, donnée en base ou modification du contrat Socket.IO n'est nécessaire :
la vue filtrée contient déjà toutes les marques autorisées au partage.

## Erreurs et accessibilité

- Une annulation du menu natif (`AbortError`) est silencieuse : ce n'est pas une erreur.
- Un échec réel du partage ou du presse-papiers affiche une notification d'erreur et rend
  immédiatement le bouton réutilisable.
- Le bouton reste focusable au clavier pendant l'ouverture du menu natif et porte une
  icône accompagnée d'un libellé texte.
- Il utilise le style secondaire pour ne pas concurrencer l'action principale en laiton.

## Tests et acceptation

- Tests unitaires du format pour victoire, échec et abandon avec zéro ou plusieurs essais.
- Vérification exacte de la conversion des trois marques en émojis.
- Vérification que l'URL est présente et qu'aucune proposition ni propriété secrète ne
  figure dans le texte.
- Test navigateur avec simulation de `navigator.share`, puis sans Web Share API pour
  vérifier la copie de secours et sa notification.
- `pnpm typecheck`, `pnpm test` et `pnpm build` restent verts.
