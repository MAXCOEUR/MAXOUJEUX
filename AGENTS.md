# AGENTS.md

## Mode de travail

Privilégier l'exécution directe et proportionner le processus à la taille de la tâche.

### Tâche simple ou localisée

Pour une modification simple :
1. Inspecter uniquement les fichiers concernés.
2. Effectuer directement la modification.
3. Lancer uniquement les tests, typechecks ou builds pertinents.
4. Résumer brièvement ce qui a été fait.

Ne pas créer de plan formel, brainstorming, sous-agent, code review, worktree ou analyse longue pour une tâche simple.

### Tâche complexe

Un plan détaillé est utile uniquement pour :
- une fonctionnalité importante touchant plusieurs modules ;
- une modification d'architecture ;
- une migration de base de données ;
- une modification sensible de sécurité, concurrence ou transactions ;
- une tâche explicitement demandée comme complexe.

Même dans ce cas :
- rester concis ;
- ne pas multiplier les phases de validation ;
- commencer l'implémentation dès que les informations nécessaires sont disponibles.

### Questions et confirmations

Ne pas demander confirmation entre les étapes sauf si :
- une information indispensable manque ;
- plusieurs choix incompatibles auraient des conséquences importantes ;
- l'action est destructive ou difficilement réversible.

Sinon, faire le meilleur choix raisonnable et avancer.

### Tests

Adapter les tests à la modification.

- Petite modification front : tests ciblés ou typecheck si pertinent.
- Logique métier : tests ciblés.
- Modification transversale/importante : `pnpm typecheck` et tests pertinents.
- Avant un commit demandé explicitement : `pnpm typecheck`.

Ne pas lancer toute la suite de tests pour une modification triviale si des tests ciblés suffisent.

### Communication

- Réponses courtes pendant l'exécution.
- Ne pas répéter le plan à chaque étape.
- Ne pas expliquer des évidences.
- À la fin : fichiers modifiés, résultat, tests exécutés et éventuels points restant à vérifier.

## Contexte projet

Lire `CLAUDE.md` pour les règles techniques et d'architecture du projet.
