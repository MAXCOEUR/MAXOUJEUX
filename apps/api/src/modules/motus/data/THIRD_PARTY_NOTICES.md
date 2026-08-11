# Données tierces du dictionnaire Motus

Le contenu de `apps/api/drizzle/0001_natural_cerebro.sql` compris entre les
marqueurs `MOTUS_DICTIONARY_BEGIN` et `MOTUS_DICTIONARY_END` est une base de
données dérivée des ressources suivantes.

## Lexique 4.00

- Auteurs : Boris New, Christophe Pallier, Manuel Gimenes, Jessica Bourgin,
  Gauvain Schalchli et contributeurs.
- Source : <https://www.lexique.org/>
- Archive utilisée : `Lexique400.zip`
- SHA-256 : `8ed5a64373ae798f0485a2a35848c09286b6694c6859abeaab6806594c046993`
- Licence : [Creative Commons Attribution — Partage dans les mêmes conditions
  4.0 International](https://creativecommons.org/licenses/by-sa/4.0/deed.fr)

La base dérivée conserve uniquement les formes alphabétiques normalisées de 5
à 8 lettres et leurs indicateurs d'admissibilité comme solution.

## french-badwords-list 1.0.7

- Auteur : Maurice Butler.
- Source : <https://www.npmjs.com/package/french-badwords-list/v/1.0.7>
- Licence : MIT.

Cette liste sert uniquement à retirer des solutions les termes sensibles. Elle
ne retire pas ces formes du dictionnaire des propositions acceptées.

## Régénération

```bash
pnpm --filter @maxoujeux/api db:motus-dictionary -- \
  --lexique /chemin/Lexique400.zip \
  --badwords /chemin/french-badwords-list-1.0.7.tgz \
  --migration drizzle/0001_natural_cerebro.sql
```

Le script vérifie l'empreinte de l'archive Lexique avant toute écriture. La
sortie attendue contient 60 024 propositions acceptées et 3 868 solutions.
