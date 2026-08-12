# Roulette Table Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de revenir au salon sans abandonner une table de roulette, puis de reprendre cette table depuis le bandeau global.

**Architecture:** Le store roulette reçoit les états serveur sans effet de bord de navigation. Une fonction pure résume la table active pour `ResumeBanner`, tandis que `RouletteTablePage` distingue explicitement navigation temporaire et véritable départ.

**Tech Stack:** React 18, Zustand 5, TypeScript 5.7, Node test runner via `tsx --test`, Socket.IO.

## Global Constraints

- Le serveur reste autoritaire sur les mises et le départ effectif.
- Garder sa place ne doit ni envoyer `match:leave`, ni vider le store roulette.
- Recevoir `roulette:state` ne doit jamais déclencher une navigation.
- Les textes et commentaires ajoutés sont en français.
- La modification existante de `CLAUDE.md` appartient à l'utilisateur et ne doit pas être incluse dans les commits de cette tâche.

---

### Task 1: État roulette sans navigation forcée

**Files:**
- Create: `apps/web/src/lib/roulette-navigation.test.ts`
- Modify: `apps/web/src/lib/roulette.ts:1-62`

**Interfaces:**
- Consumes: `GameSocket`, `useRoulette` et `RouletteView` existants.
- Produces: `bindRouletteEvents(socket: GameSocket): void`, limité à la mise à jour du store.

- [ ] **Step 1: Write the failing test**

Créer un test calqué sur `blackjack-navigation.test.ts` qui initialise la route à
`/jeu/roulette`, branche un socket factice, émet `roulette:state`, puis vérifie :

```ts
assert.equal(useRoulette.getState().view?.id, "table-1");
assert.deepEqual(useRouteStore.getState().route, { name: "salon", game: "roulette" });
assert.deepEqual(historique, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @maxoujeux/web test -- src/lib/roulette-navigation.test.ts`

Expected: FAIL, car `bindRouletteEvents` empile encore `/table/table-1`.

- [ ] **Step 3: Write minimal implementation**

Remplacer le gestionnaire par :

```ts
export function bindRouletteEvents(socket: GameSocket): void {
  socket.on("roulette:state", (view) => useRoulette.getState().apply(view));
}
```

Retirer les imports `navigate` et `useRouteStore` devenus inutiles.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @maxoujeux/web test -- src/lib/roulette-navigation.test.ts`

Expected: PASS sans avertissement.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/roulette.ts apps/web/src/lib/roulette-navigation.test.ts
git commit -m "fix: ne plus forcer le retour à la roulette"
```

### Task 2: Résumé pur et bandeau de reprise

**Files:**
- Modify: `apps/web/src/lib/roulette-ui.ts`
- Modify: `apps/web/src/lib/roulette-ui.test.ts`
- Modify: `apps/web/src/components/ResumeBanner.tsx`

**Interfaces:**
- Consumes: `RouletteView` et l'identifiant de la table actuellement affichée.
- Produces: `rouletteResume(view: RouletteView | null, currentTableId: string | null): RouletteResume | null`.

- [ ] **Step 1: Write the failing tests**

Ajouter des cas couvrant l'absence de table, la table déjà affichée, une table
sans mise et une table avec 250 MC engagés :

```ts
assert.equal(rouletteResume(null, null), null);
assert.equal(rouletteResume(vue(), "table-1"), null);
assert.deepEqual(rouletteResume(vue(), null), {
  tableId: "table-1",
  wager: 0,
  phase: "betting",
  deadlineAt: "2026-08-12T00:00:30.000Z",
});
assert.equal(rouletteResume(vueAvecMise, null)?.wager, 250);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @maxoujeux/web test -- src/lib/roulette-ui.test.ts`

Expected: FAIL à l'import, car `rouletteResume` n'existe pas encore.

- [ ] **Step 3: Write minimal pure implementation**

Ajouter :

```ts
export interface RouletteResume {
  tableId: string;
  wager: number;
  phase: RouletteView["phase"];
  deadlineAt: string | null;
}

export function rouletteResume(
  view: RouletteView | null,
  currentTableId: string | null,
): RouletteResume | null {
  if (!view || view.id === currentTableId) return null;
  const mine = view.players.find((player) => player.userId === view.you);
  return {
    tableId: view.id,
    wager: mine?.totalWager ?? 0,
    phase: view.phase,
    deadlineAt: view.deadlineAt,
  };
}
```

- [ ] **Step 4: Run pure tests to verify they pass**

Run: `pnpm --filter @maxoujeux/web test -- src/lib/roulette-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Connect the global banner**

Dans `ResumeBanner`, lire `useRoulette`, calculer `rouletteResume`, puis insérer
la branche roulette après le blackjack et avant les duels. Le contenu est :

```tsx
<Banner icon={<Flag className="size-4 shrink-0 text-brass" aria-hidden />} tableId={roulette.tableId}>
  Table de Roulette
  {roulette.wager > 0
    ? <span className="text-cream-dim"> — {formatCoins(roulette.wager)} en jeu</span>
    : <span className="text-cream-dim"> — ta place est gardée</span>}
</Banner>
```

- [ ] **Step 6: Run web typecheck and focused tests**

Run: `pnpm --filter @maxoujeux/web typecheck`

Run: `pnpm --filter @maxoujeux/web test -- src/lib/roulette-ui.test.ts src/lib/blackjack.test.ts`

Expected: les deux commandes réussissent.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/roulette-ui.ts apps/web/src/lib/roulette-ui.test.ts apps/web/src/components/ResumeBanner.tsx
git commit -m "feat: afficher la reprise d'une table de roulette"
```

### Task 3: Dialogue de sortie de la table

**Files:**
- Modify: `apps/web/src/pages/RouletteTablePage.tsx`
- Create: `apps/web/src/pages/RouletteTablePage.test.tsx`

**Interfaces:**
- Consumes: `Modal`, `Button`, `match:leave`, `useRoulette.clear()` et `navigate()`.
- Produces: deux parcours distincts, `garderMaPlace()` et `quitter()`.

- [ ] **Step 1: Write the failing render test**

Rendre la page avec une vue possédant 100 MC engagés et vérifier que l'en-tête
porte un bouton de retour explicite plutôt qu'un lien direct :

```ts
const html = renderToStaticMarkup(<RouletteTablePage user={user} view={vueAvecMise} />);
assert.match(html, /<button[^>]*>.*Roulette.*<\/button>/s);
assert.doesNotMatch(html, /href="\/jeu\/roulette"[^>]*>.*Roulette/s);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @maxoujeux/web test -- src/pages/RouletteTablePage.test.tsx`

Expected: FAIL, car l'en-tête utilise encore `Lien` vers le salon.

- [ ] **Step 3: Implement the explicit return flow**

Ajouter les états `sortie` et `leaving`, remplacer `Lien` par un bouton ouvrant
le dialogue, puis ajouter :

```ts
function garderMaPlace() {
  setSortie(false);
  navigate({ name: "salon", game: "roulette" });
}
```

Faire conserver à `quitter()` le store tant que l'accusé serveur n'est pas un
succès ou `TABLE_GONE`, et afficher un `LeaveDialog` adapté :

```tsx
<Modal open={open} onClose={onClose} title="Quitter cette page ?">
  <p>Tu peux revenir au salon sans quitter cette table.</p>
  {wager > 0 && <p>{formatCoins(wager)} restent engagés sur ce tour.</p>}
</Modal>
```

Le pied du dialogue propose « Garder ma place » et « Quitter la table ».

- [ ] **Step 4: Run page test and web suite**

Run: `pnpm --filter @maxoujeux/web test -- src/pages/RouletteTablePage.test.tsx src/lib/roulette-navigation.test.ts src/lib/roulette-ui.test.ts`

Run: `pnpm --filter @maxoujeux/web typecheck`

Expected: toutes les commandes réussissent.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/RouletteTablePage.tsx apps/web/src/pages/RouletteTablePage.test.tsx
git commit -m "feat: garder sa place à la roulette depuis le salon"
```

### Task 4: Vérification globale et diagnostic des minuteries

**Files:**
- Inspect: `packages/shared/src/blackjack.ts`
- Inspect: `packages/shared/src/roulette.ts`
- Inspect: `apps/api/src/modules/blackjack/service.ts`
- Inspect: `apps/api/src/modules/roulette/service.ts`

**Interfaces:**
- Consumes: suites de tests et durées partagées existantes.
- Produces: résultat vérifié de la fonctionnalité et compte rendu factuel sur le temps mort, sans changement de durée non validé.

- [ ] **Step 1: Run complete verification**

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Expected: les trois commandes réussissent sans nouvelle erreur.

- [ ] **Step 2: Review the final diff**

Run: `git diff --check HEAD~3..HEAD`

Run: `git status --short`

Expected: aucun défaut d'espacement ; seule la modification utilisateur de
`CLAUDE.md` peut rester hors commit.

- [ ] **Step 3: Report timing evidence**

Rapporter les durées actuelles sans les modifier : blackjack 20 s de mise et
8 s de résultat ; roulette 30 s de mise, 7 s de lancer et 8 s de résultat.
Préciser qu'un changement de rythme fera l'objet d'une décision séparée.
