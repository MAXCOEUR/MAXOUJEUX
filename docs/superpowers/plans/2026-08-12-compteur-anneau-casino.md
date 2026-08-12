# Compteur des anneaux casino — Plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher les secondes réellement restantes au centre des anneaux de phase de la roulette et du blackjack.

**Architecture:** Le composant commun `ProgressRing` calcule déjà le délai restant depuis l’échéance serveur. Une option `showSeconds` lui fait rendre ce même délai, arrondi au supérieur, au centre de l’anneau ; les deux montres de phase activent l’option, tandis que les anneaux autour des avatars restent inchangés.

**Tech Stack:** React 18, TypeScript, rendu statique React, `node:test`, CSS SVG existant.

## Global Constraints

- Le nombre visible est le nombre seul (`15`, `14`, …, `0`).
- Le nombre et le trait utilisent la même échéance `deadlineAt` corrigée par l’horloge serveur.
- Le compteur central est activé sur la roulette et la montre de table du blackjack, pas autour des avatars.
- Le mode d’animations réduites reste lisible.
- Les fichiers et libellés ajoutés sont en français.
- La modification se fait directement sur `main` et ne doit pas inclure la modification utilisateur de `CLAUDE.md`.

---

### Task 1: Compteur optionnel du composant commun

**Files:**
- Create: `apps/web/src/components/ProgressRing.test.tsx`
- Modify: `apps/web/src/components/ProgressRing.tsx`

**Interfaces:**
- Consumes: `deadlineAt: string`, `turnMs: number`, `useCountdown(deadlineAt): number`.
- Produces: propriété optionnelle `showSeconds?: boolean` sur `ProgressRing`.

- [ ] **Step 1: Écrire le test en échec**

Créer un test de rendu statique qui synchronise l’horloge, rend une échéance à 15 secondes avec `showSeconds`, puis vérifie le texte `15` et `aria-label="15 secondes restantes"`. Ajouter un second cas sans l’option qui vérifie l’absence de ce libellé.

```tsx
syncServerClock("2026-08-12T12:00:00.000Z");
const html = renderToStaticMarkup(
  <ProgressRing
    deadlineAt="2026-08-12T12:00:15.000Z"
    turnMs={30_000}
    showSeconds
  />,
);
assert.match(html, /aria-label="15 secondes restantes"/);
assert.match(html, />15<\/span>/);
```

- [ ] **Step 2: Vérifier l’échec attendu**

Run: `pnpm --filter @maxoujeux/web test -- src/components/ProgressRing.test.tsx`

Expected: FAIL, car `showSeconds` n’existe pas encore sur les propriétés de `ProgressRing`.

- [ ] **Step 3: Implémenter le minimum**

Ajouter `showSeconds?: boolean`, calculer `Math.ceil(remaining / 1000)`, et rendre lorsque l’option est active un texte central positionné au-dessus du contenu :

```tsx
const seconds = Math.ceil(remaining / 1_000);

{showSeconds && (
  <span
    aria-label={`${seconds} ${seconds === 1 ? "seconde restante" : "secondes restantes"}`}
    className="tabular pointer-events-none absolute inset-0 z-10 grid place-items-center text-[0.68rem] font-bold leading-none"
  >
    {seconds}
  </span>
)}
```

Dans le rendu `reduced`, afficher ce compteur central lorsque l’option est active ; conserver le compteur compact existant sous l’anneau pour les usages sans l’option.

- [ ] **Step 4: Vérifier le passage au vert**

Run: `pnpm --filter @maxoujeux/web test -- src/components/ProgressRing.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ProgressRing.tsx apps/web/src/components/ProgressRing.test.tsx
git commit -m "feat: afficher les secondes dans les anneaux"
```

### Task 2: Activer le compteur sur les deux montres de phase

**Files:**
- Modify: `apps/web/src/components/games/RouletteTable.tsx`
- Modify: `apps/web/src/components/games/RouletteTable.test.tsx`
- Modify: `apps/web/src/components/games/BlackjackTable.tsx`
- Modify: `apps/web/src/components/games/BlackjackTable.test.tsx`

**Interfaces:**
- Consumes: `ProgressRing` avec `showSeconds?: boolean` produit par la Task 1.
- Produces: une montre de phase chiffrée dans les deux jeux, sans modifier l’anneau des sièges.

- [ ] **Step 1: Écrire les tests d’intégration en échec**

Dans le test blackjack de la phase de mise, utiliser une échéance à 15 secondes de l’heure courante et vérifier le libellé accessible. Ajouter le même test à la roulette :

```tsx
const deadlineAt = new Date(Date.now() + 15_000).toISOString();
const html = renderToStaticMarkup(<RouletteTable view={vue({ deadlineAt })} />);
assert.match(html, /aria-label="15 secondes restantes"/);
```

Conserver le test blackjack qui vérifie qu’un seul anneau tourne autour du joueur au trait et lui ajouter une assertion garantissant qu’il ne contient aucun compteur central.

- [ ] **Step 2: Vérifier l’échec attendu**

Run: `pnpm --filter @maxoujeux/web test -- src/components/games/RouletteTable.test.tsx src/components/games/BlackjackTable.test.tsx`

Expected: FAIL sur l’absence du libellé des secondes dans les montres de phase.

- [ ] **Step 3: Activer l’option uniquement aux bons endroits**

Ajouter `showSeconds` au `ProgressRing` de `RouletteTable.PhaseClock` et au `ProgressRing` de `BlackjackTable.PitClock`. Ne pas modifier `BlackjackSeat`.

```tsx
<ProgressRing deadlineAt={deadlineAt} turnMs={durationMs} size={34} showSeconds>
```

- [ ] **Step 4: Vérifier les tests ciblés**

Run: `pnpm --filter @maxoujeux/web test -- src/components/games/RouletteTable.test.tsx src/components/games/BlackjackTable.test.tsx`

Expected: PASS.

- [ ] **Step 5: Vérifier le paquet web**

Run: `pnpm --filter @maxoujeux/web typecheck && pnpm --filter @maxoujeux/web test && pnpm --filter @maxoujeux/web build`

Expected: typecheck, tests et build terminés avec le code de sortie 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/games/RouletteTable.tsx apps/web/src/components/games/RouletteTable.test.tsx apps/web/src/components/games/BlackjackTable.tsx apps/web/src/components/games/BlackjackTable.test.tsx
git commit -m "feat: chronométrer les phases du casino"
```

### Task 3: Vérification finale

**Files:**
- Verify only.

**Interfaces:**
- Consumes: les deux commits d’implémentation.
- Produces: preuve que le changement est intégrable sur `main`.

- [ ] **Step 1: Vérifier le dépôt complet**

Run: `pnpm typecheck && pnpm test && pnpm build`

Expected: toutes les commandes se terminent avec le code de sortie 0.

- [ ] **Step 2: Contrôler le périmètre Git**

Run: `git status --short && git log -4 --oneline`

Expected: seule la modification utilisateur de `CLAUDE.md` reste hors commit ; les commits du compteur apparaissent dans l’historique.
