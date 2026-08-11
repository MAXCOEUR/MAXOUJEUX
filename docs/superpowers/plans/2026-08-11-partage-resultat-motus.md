# Partage du résultat Motus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter après chaque fin de partie Motus un partage Wordle-like via le menu natif, avec copie presse-papiers de secours et lien vers l'application.

**Architecture:** Une fonction pure dans `@maxoujeux/shared` transforme la vue Motus terminale en texte sans secret. Le front délègue l'accès aux API navigateur à un petit adaptateur, puis le composant de résultat affiche l'action et ses retours via le toaster existant.

**Tech Stack:** TypeScript strict, Vitest, React 18, Web Share API, Clipboard API, Zustand/toaster existant.

## Global Constraints

- Le partage est disponible après une victoire, un échec au sixième essai et un abandon.
- Aucune lettre, proposition, pseudo, valeur MaxouCoin ou mot secret ne figure dans le texte partagé.
- `correct` devient 🟩, `present` devient 🟨 et `absent` devient ⬛.
- Le lien final est `${window.location.origin}/jeu/motus`, sans domaine codé en dur.
- Une annulation native `AbortError` reste silencieuse.
- Le bouton est secondaire afin de conserver une seule action principale en laiton.

---

### Task 1: Formateur pur du résultat

**Files:**
- Modify: `packages/shared/src/motus.ts`
- Modify: `packages/shared/src/motus.test.ts`

**Interfaces:**
- Consumes: `MotusView`, `MotusMark`, `MOTUS_MAX_ATTEMPTS`.
- Produces: `formatMotusShare(view: MotusView, appOrigin: string): string`.

- [ ] **Step 1: Écrire les tests en échec**

Ajouter un constructeur de vue terminale, puis vérifier les trois fins :

```ts
function terminalView(overrides: Partial<MotusView> = {}): MotusView {
  return {
    slotStart: "2026-08-11T12:00:00.000Z",
    slotEnd: "2026-08-11T18:00:00.000Z",
    nextSlotAt: "2026-08-11T18:00:00.000Z",
    isCurrentSlot: true,
    canStartCurrent: false,
    length: 5,
    guesses: [{ guess: "SABLE", marks: ["correct", "absent", "present", "absent", "correct"] }],
    attemptsLeft: 5,
    status: "won",
    endReason: "solved",
    stake: 100,
    payout: 600,
    net: 500,
    version: 1,
    now: "2026-08-11T12:05:00.000Z",
    ...overrides,
  };
}

it("partage une victoire sans les lettres", () => {
  const text = formatMotusShare(terminalView(), "https://maxoujeux.example/");
  expect(text).toBe(
    "MaxouJeux Motus — 1/6\n\n🟩⬛🟨⬛🟩\n\nhttps://maxoujeux.example/jeu/motus",
  );
  expect(text).not.toContain("SABLE");
});

it("partage un échec et un abandon sans essai", () => {
  expect(formatMotusShare(terminalView({ status: "lost", endReason: "attempts" }), "https://jeu.test"))
    .toContain("MaxouJeux Motus — X/6");
  expect(formatMotusShare(terminalView({ status: "lost", endReason: "abandoned", guesses: [] }), "https://jeu.test"))
    .toBe("MaxouJeux Motus — Abandon — 0/6\n\nhttps://jeu.test/jeu/motus");
});

it("refuse une partie non terminée", () => {
  expect(() => formatMotusShare(terminalView({ status: "playing", endReason: null }), "https://jeu.test"))
    .toThrow(/terminée/i);
});
```

- [ ] **Step 2: Vérifier l'échec des tests**

Run: `pnpm --filter @maxoujeux/shared test -- motus.test.ts`

Expected: FAIL car `formatMotusShare` n'existe pas.

- [ ] **Step 3: Implémenter le formateur minimal**

Ajouter dans `packages/shared/src/motus.ts` :

```ts
const MOTUS_SHARE_MARKS: Record<MotusMark, string> = {
  correct: "🟩",
  present: "🟨",
  absent: "⬛",
};

export function formatMotusShare(view: MotusView, appOrigin: string): string {
  if (view.status !== "won" && view.status !== "lost") {
    throw new Error("Le résultat Motus doit provenir d'une partie terminée");
  }

  const score = view.status === "won"
    ? `${view.guesses.length}/${MOTUS_MAX_ATTEMPTS}`
    : view.endReason === "abandoned"
      ? `Abandon — ${view.guesses.length}/${MOTUS_MAX_ATTEMPTS}`
      : `X/${MOTUS_MAX_ATTEMPTS}`;
  const grid = view.guesses
    .map((guess) => guess.marks.map((mark) => MOTUS_SHARE_MARKS[mark]).join(""))
    .join("\n");
  const url = `${appOrigin.replace(/\/+$/, "")}/jeu/motus`;

  return [`MaxouJeux Motus — ${score}`, grid, url].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Vérifier le passage des tests**

Run: `pnpm --filter @maxoujeux/shared test -- motus.test.ts`

Expected: PASS, avec les cas de victoire, échec, abandon et partie non terminée.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/motus.ts packages/shared/src/motus.test.ts
git commit -m "feat: formater le partage Motus"
```

### Task 2: Adaptateur des API de partage du navigateur

**Files:**
- Create: `apps/web/src/lib/share.ts`

**Interfaces:**
- Consumes: un titre et le texte complet produits par `formatMotusShare`.
- Produces: `shareText(title: string, text: string): Promise<"shared" | "copied" | "cancelled">`.

- [ ] **Step 1: Implémenter l'adaptateur minimal**

Créer `apps/web/src/lib/share.ts` :

```ts
export type ShareOutcome = "shared" | "copied" | "cancelled";

export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  await navigator.clipboard.writeText(text);
  return "copied";
}
```

- [ ] **Step 2: Vérifier le typage isolé**

Run: `pnpm --filter @maxoujeux/web typecheck`

Expected: PASS ; les types DOM de `navigator.share` et `navigator.clipboard` sont disponibles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/share.ts
git commit -m "feat: ajouter le partage natif avec copie de secours"
```

### Task 3: Bouton de partage dans le résultat Motus

**Files:**
- Modify: `apps/web/src/pages/MotusPage.tsx:298-319`

**Interfaces:**
- Consumes: `formatMotusShare`, `shareText`, `pushToast`, la `MotusView` terminale.
- Produces: le bouton « Partager le résultat » et les retours de succès/erreur.

- [ ] **Step 1: Ajouter l'action au composant de résultat**

Importer `Share2`, `formatMotusShare`, `shareText` et `pushToast`. Dans `Result`, ajouter
un état `sharing`, puis :

```ts
async function partager() {
  setSharing(true);
  try {
    const text = formatMotusShare(view, window.location.origin);
    const outcome = await shareText("MaxouJeux Motus", text);
    if (outcome === "copied") pushToast("info", "Résultat copié");
  } catch {
    pushToast("erreur", "Impossible de partager le résultat. Réessaie.");
  } finally {
    setSharing(false);
  }
}
```

Sous le bilan net, regrouper les actions :

```tsx
<div className="mt-5 flex flex-wrap justify-center gap-2">
  {view.canStartCurrent && (
    <Button onClick={onStart} loading={pending}>Jouer le mot actuel</Button>
  )}
  <Button variant="outline" onClick={partager} loading={sharing}>
    <Share2 className="size-4" aria-hidden />
    Partager le résultat
  </Button>
</div>
```

Conserver le compte à rebours hors de ce groupe lorsque le créneau courant n'est pas
jouable. Une annulation retourne `cancelled` et n'affiche aucune notification.

- [ ] **Step 2: Vérifier le typage du front**

Run: `pnpm --filter @maxoujeux/web typecheck`

Expected: PASS.

- [ ] **Step 3: Vérifier au navigateur les deux chemins**

Avec Playwright sur une partie Motus terminée :

1. injecter `navigator.share = async (data) => window.__shared = data`, cliquer sur le
   bouton et vérifier que `data.text` contient les émojis et `/jeu/motus` mais aucune lettre ;
2. supprimer `navigator.share`, remplacer `navigator.clipboard.writeText` par une capture,
   cliquer et vérifier le texte ainsi que la notification « Résultat copié » ;
3. injecter un rejet `new DOMException("annulé", "AbortError")` et vérifier qu'aucune
   notification d'erreur n'apparaît.

Expected: les trois scénarios passent sur écran mobile et le bouton reste accessible au clavier.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/MotusPage.tsx
git commit -m "feat: partager le résultat Motus"
```

### Task 4: Vérifications finales

**Files:**
- Verify only.

**Interfaces:**
- Consumes: les livrables des tâches 1 à 3.
- Produces: preuve de typage, tests et build verts.

- [ ] **Step 1: Vérifier les espaces et le typage**

Run: `git diff --check && pnpm typecheck`

Expected: exit 0.

- [ ] **Step 2: Exécuter toute la suite de tests**

Run: `pnpm test`

Expected: tous les tests passent, y compris les nouveaux tests du format de partage.

- [ ] **Step 3: Construire la production**

Run: `pnpm build`

Expected: les bundles API et web sont générés sans erreur.
