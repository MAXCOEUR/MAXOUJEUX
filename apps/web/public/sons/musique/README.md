# Musiques de fond

Un **dossier par zone**, autant de morceaux qu'on veut dans chacun. Le site les
enchaîne dans un ordre mélangé, et rebat les cartes quand la zone a été
entièrement écoutée — sur une zone à un seul morceau, cela revient à le boucler.

```text
apps/web/public/sons/musique/
  pistes.json          <- la liste des fichiers, à tenir à jour
  lobby/               <- lobby, classements, succès, profils, mon compte
  poker/               connect4/        motus/
  blackjack/           tictactoe/       plinko/
  roulette/            wheel/           slots/
```

## `pistes.json`

Un navigateur **ne sait pas lister un dossier** : il faut donc lui dire ce qu'il
y a dedans. Une entrée par zone garnie, les zones vides s'omettent.

```json
{
  "lobby": ["nuit-bleue.mp3", "feutre-vert.mp3"],
  "poker": ["tapis-vert.mp3", "bluff.mp3"],
  "motus": ["horloge.mp3"]
}
```

Zones acceptées : `lobby`, `poker`, `blackjack`, `roulette`, `motus`,
`connect4`, `tictactoe`, `wheel`, `plinko`, `slots`. Une zone inconnue est
ignorée, un nom de fichier vide aussi — une faute de frappe ne prive pas le site
de musique.

**Une zone sans piste retombe sur celle du lobby.** On peut donc démarrer avec
deux ou trois morceaux dans `lobby/` et garnir les jeux plus tard, sans que rien
ne reste silencieux entre-temps.

Sans `pistes.json`, il n'y a simplement pas de musique : l'écran de réglages le
signale, au lieu de laisser croire à une panne. Le reste du son — jetons, cartes,
roue, gains, notifications — est **synthétisé en code** et ne dépend d'aucun
fichier.

## Ce qu'il faut viser

- **Format** : MP3, mono suffit, 96 à 128 kbit/s. Ces morceaux tournent en fond
  sonore, pas au casque en écoute attentive, et chaque méga-octet part dans
  l'image Docker puis sur la ligne du NAS.
- **Durée** : deux à quatre minutes. En dessous, la répétition s'entend ; au-delà,
  le fichier pèse pour rien.
- **Enchaînement propre** : pas de silence ni de claquement en début et en fin de
  fichier. Le passage d'un morceau au suivant se fait sans fondu — c'est le
  changement de zone qui en a un.
- **Licence** : uniquement des morceaux libres de droits ou dont tu détiens les
  droits. Rien n'est fourni avec le dépôt, précisément pour cette raison.

Le volume est réglé par le joueur dans « Mon compte » : mixe à un niveau normal,
n'atténue pas le fichier à la source.
