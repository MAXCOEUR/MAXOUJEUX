# Saisie directe et clavier Motus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le champ de saisie Motus par une saisie dans la ligne active et un clavier AZERTY coloré, utilisable au toucher comme au clavier physique.

**Architecture:** Un module pur côté web dérive les couleurs des lettres et traduit les frappes physiques en commandes testables. Un composant `MotusKeyboard` affiche le clavier sans connaître le réseau ; `MotusPage` conserve le brouillon, applique les commandes et reste la seule couche qui émet `motus:guess`. `MotusBoard` reçoit toujours le brouillon et ajoute uniquement le repère visuel de la case active.

**Tech Stack:** TypeScript strict, tests natifs Node via `tsx --test`, React 18, Tailwind CSS v4, Lucide React, Socket.IO et Zustand existants.

## Global Constraints

- La grille conserve les couleurs actuelles : `correct` vert, `present` jaune et `absent` gris.
- Les couleurs du clavier proviennent uniquement des essais confirmés par le serveur, avec la priorité `correct > present > absent`.
- Le champ texte et le bouton de validation actuels disparaissent.
- Le clavier AZERTY comporte des touches lettres, Effacer et Valider et fonctionne au toucher comme à la souris.
- Les lettres, Retour arrière et Entrée du clavier physique produisent les mêmes commandes ; Ctrl, Alt et Meta ne sont pas capturés.
- La saisie est bornée à `view.length`, reste affichée après un refus serveur et est verrouillée pendant une requête.
- La prochaine case à remplir reçoit un contour renforcé ; une ligne complète conserve ce contour sur sa dernière case.
- Le client n'évalue jamais le brouillon et ne modifie ni le protocole Socket.IO ni les règles du moteur.
- Le code, les commentaires, les libellés et la documentation restent en français.

---

### Task 1: Logique pure du clavier Motus

**Files:**
- Create: `apps/web/src/lib/motus-input.test.ts`
- Create: `apps/web/src/lib/motus-input.ts`

**Interfaces:**
- Consumes: `MotusGuessView`, `MotusMark` depuis `@maxoujeux/shared` et `normalizeMotusDraft` depuis `@maxoujeux/engines`.
- Produces: `MotusInputCommand`, `motusCommandForKey(key, modified)`, `appendMotusLetter(draft, letter, maxLength)`, `eraseMotusLetter(draft)` et `motusLetterStates(guesses)`.

- [ ] **Step 1: Écrire les tests en échec**

Créer `apps/web/src/lib/motus-input.test.ts` :

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMotusLetter,
  eraseMotusLetter,
  motusCommandForKey,
  motusLetterStates,
} from "./motus-input.js";

test("conserve pour chaque lettre son résultat le plus informatif", () => {
  const states = motusLetterStates([
    { guess: "SALLE", marks: ["absent", "present", "absent", "absent", "absent"] },
    { guess: "LAMPE", marks: ["correct", "absent", "absent", "absent", "absent"] },
  ]);

  assert.equal(states.S, "absent");
  assert.equal(states.A, "present");
  assert.equal(states.L, "correct");
  assert.equal(states.Z, undefined);
});

test("ajoute une lettre normalisée sans dépasser la longueur du mot", () => {
  assert.equal(appendMotusLetter("ECO", "é", 5), "ECOE");
  assert.equal(appendMotusLetter("ECOLE", "S", 5), "ECOLE");
  assert.equal(appendMotusLetter("ECO", "7", 5), "ECO");
});

test("efface uniquement la dernière lettre", () => {
  assert.equal(eraseMotusLetter("MOTUS"), "MOTU");
  assert.equal(eraseMotusLetter(""), "");
});

test("traduit les frappes physiques sans capturer les raccourcis", () => {
  assert.deepEqual(motusCommandForKey("é", false), { type: "letter", letter: "E" });
  assert.deepEqual(motusCommandForKey("Backspace", false), { type: "erase" });
  assert.deepEqual(motusCommandForKey("Enter", false), { type: "submit" });
  assert.equal(motusCommandForKey("a", true), null);
  assert.equal(motusCommandForKey("ArrowLeft", false), null);
});
```

- [ ] **Step 2: Vérifier que les tests échouent pour la bonne raison**

Run: `pnpm --filter @maxoujeux/web exec tsx --test src/lib/motus-input.test.ts`

Expected: FAIL avec `Cannot find module './motus-input.js'` parce que le module n'existe pas encore.

- [ ] **Step 3: Implémenter le module minimal**

Créer `apps/web/src/lib/motus-input.ts` :

```ts
import { normalizeMotusDraft } from "@maxoujeux/engines";
import type { MotusGuessView, MotusMark } from "@maxoujeux/shared";

export type MotusInputCommand =
  | { type: "letter"; letter: string }
  | { type: "erase" }
  | { type: "submit" };

const MARK_PRIORITY: Record<MotusMark, number> = {
  absent: 0,
  present: 1,
  correct: 2,
};

export function motusLetterStates(
  guesses: MotusGuessView[],
): Partial<Record<string, MotusMark>> {
  const states: Partial<Record<string, MotusMark>> = {};

  for (const guess of guesses) {
    guess.guess.split("").forEach((letter, index) => {
      const mark = guess.marks[index];
      const previous = states[letter];
      if (mark && (!previous || MARK_PRIORITY[mark] > MARK_PRIORITY[previous])) {
        states[letter] = mark;
      }
    });
  }

  return states;
}

export function appendMotusLetter(draft: string, letter: string, maxLength: number): string {
  const normalized = normalizeMotusDraft(letter, 1);
  if (!normalized) return draft;
  return normalizeMotusDraft(`${draft}${normalized}`, maxLength);
}

export function eraseMotusLetter(draft: string): string {
  return draft.slice(0, -1);
}

export function motusCommandForKey(key: string, modified: boolean): MotusInputCommand | null {
  if (modified) return null;
  if (key === "Backspace") return { type: "erase" };
  if (key === "Enter") return { type: "submit" };

  const letter = normalizeMotusDraft(key, 1);
  return letter && key.length === 1 ? { type: "letter", letter } : null;
}
```

- [ ] **Step 4: Vérifier le passage des tests ciblés**

Run: `pnpm --filter @maxoujeux/web exec tsx --test src/lib/motus-input.test.ts`

Expected: PASS pour les quatre comportements ; remplacer mentalement la priorité de `correct` par `0` ferait échouer le premier test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/motus-input.ts apps/web/src/lib/motus-input.test.ts
git commit -m "feat: calculer les états du clavier Motus"
```

### Task 2: Composant de clavier AZERTY

**Files:**
- Create: `apps/web/src/components/games/MotusKeyboard.tsx`
- Create: `apps/web/src/components/games/MotusKeyboard.test.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `MotusGuessView[]`, `disabled`, `canSubmit`, `onLetter(letter)`, `onErase()` et `onSubmit()`.
- Produces: `MotusKeyboard`, un clavier de présentation sans état local et sans accès Socket.IO.

- [ ] **Step 1: Écrire le test de rendu en échec**

Créer `apps/web/src/components/games/MotusKeyboard.test.tsx` :

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MotusKeyboard } from "./MotusKeyboard.js";

test("rend toutes les commandes et annonce les couleurs en français", () => {
  const markup = renderToStaticMarkup(
    <MotusKeyboard
      guesses={[
        { guess: "SALLE", marks: ["absent", "present", "correct", "absent", "absent"] },
      ]}
      disabled={false}
      canSubmit
      onLetter={() => undefined}
      onErase={() => undefined}
      onSubmit={() => undefined}
    />,
  );

  assert.equal(markup.match(/<button/g)?.length, 28);
  assert.match(markup, /aria-label="Lettre L, bien placée"/);
  assert.match(markup, /aria-label="Lettre A, présente ailleurs"/);
  assert.match(markup, /aria-label="Lettre S, absente"/);
  assert.match(markup, /aria-label="Effacer la dernière lettre"/);
  assert.match(markup, /aria-label="Valider le mot"/);
});
```

- [ ] **Step 2: Vérifier que le test échoue pour la bonne raison**

Run: `pnpm --filter @maxoujeux/web exec tsx --test src/components/games/MotusKeyboard.test.tsx`

Expected: FAIL avec `Cannot find module './MotusKeyboard.js'` parce que le composant n'existe pas encore.

- [ ] **Step 3: Créer le composant de présentation**

Créer `apps/web/src/components/games/MotusKeyboard.tsx` :

```tsx
import type { MotusGuessView, MotusMark } from "@maxoujeux/shared";
import { CornerDownLeft, Delete } from "lucide-react";
import { cn } from "@/lib/cn";
import { motusLetterStates } from "@/lib/motus-input";

const KEY_ROWS = ["AZERTYUIOP", "QSDFGHJKLM"] as const;
const LAST_ROW = "WXCVBN";

const MARK_STYLE: Record<MotusMark, string> = {
  correct: "border-win bg-win text-felt-deep",
  present: "border-game-motus bg-game-motus text-felt-deep",
  absent: "border-line-strong bg-felt-high text-cream-faint",
};

const MARK_LABEL: Record<MotusMark, string> = {
  correct: "bien placée",
  present: "présente ailleurs",
  absent: "absente",
};

interface MotusKeyboardProps {
  guesses: MotusGuessView[];
  disabled: boolean;
  canSubmit: boolean;
  onLetter: (letter: string) => void;
  onErase: () => void;
  onSubmit: () => void;
}

export function MotusKeyboard({
  guesses,
  disabled,
  canSubmit,
  onLetter,
  onErase,
  onSubmit,
}: MotusKeyboardProps) {
  const states = motusLetterStates(guesses);

  function letterKey(letter: string) {
    const mark = states[letter];
    return (
      <button
        key={letter}
        type="button"
        disabled={disabled}
        onClick={() => onLetter(letter)}
        aria-label={`Lettre ${letter}${mark ? `, ${MARK_LABEL[mark]}` : ""}`}
        className={cn(
          "min-w-0 rounded-md border py-2.5 font-display text-sm font-black",
          "transition-[transform,background-color] active:scale-95 disabled:cursor-not-allowed",
          mark ? MARK_STYLE[mark] : "border-line-strong bg-felt-raised text-cream",
          disabled && "opacity-65",
        )}
      >
        {letter}
      </button>
    );
  }

  return (
    <div className="mx-auto grid max-w-xl gap-1.5" role="group" aria-label="Clavier Motus">
      {KEY_ROWS.map((row) => (
        <div key={row} className="grid grid-cols-10 gap-1 sm:gap-1.5">
          {row.split("").map(letterKey)}
        </div>
      ))}
      <div className="grid grid-cols-[1.35fr_repeat(6,minmax(0,1fr))_1.35fr] gap-1 sm:gap-1.5">
        <button type="button" disabled={disabled} onClick={onErase} aria-label="Effacer la dernière lettre" className="grid place-items-center rounded-md border border-line-strong bg-felt-raised text-cream disabled:opacity-65">
          <Delete className="size-4" aria-hidden />
        </button>
        {LAST_ROW.split("").map(letterKey)}
        <button type="button" disabled={disabled || !canSubmit} onClick={onSubmit} aria-label="Valider le mot" className="grid place-items-center rounded-md border border-brass bg-brass text-felt-deep disabled:border-line-strong disabled:bg-felt-raised disabled:text-cream-faint">
          <CornerDownLeft className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Vérifier le rendu et le typage du composant**

Étendre aussi le script `test` du paquet web à `tsx --test "src/**/*.test.ts" "src/**/*.test.tsx"` : les guillemets laissent le runner résoudre récursivement les deux motifs, au lieu de laisser le shell exclure les tests imbriqués.

Run: `pnpm --filter @maxoujeux/web test && pnpm --filter @maxoujeux/web typecheck`

Expected: PASS avec 28 touches, des libellés français et aucun import serveur.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/components/games/MotusKeyboard.tsx apps/web/src/components/games/MotusKeyboard.test.tsx
git commit -m "feat: ajouter le clavier AZERTY Motus"
```

### Task 3: Saisie dans la grille et case active

**Files:**
- Modify: `apps/web/src/pages/MotusPage.tsx:1-23,46-97,150-193`
- Modify: `apps/web/src/components/games/MotusBoard.tsx:23-80`
- Create: `apps/web/src/components/games/MotusBoard.test.tsx`

**Interfaces:**
- Consumes: `MotusKeyboard`, les fonctions de `motus-input.ts`, la `MotusView` autoritaire et l'émission `motus:guess` existante.
- Produces: saisie tactile et physique dans la ligne active, validation/effacement cohérents et contour de la prochaine case.

- [ ] **Step 1: Remplacer le formulaire par le clavier**

Dans `MotusPage.tsx`, retirer `normalizeMotusDraft`, `Send` et `FormEvent`, importer `MotusKeyboard` ainsi que les quatre helpers de `motus-input.ts`. Transformer `proposer` en fonction sans événement :

```ts
async function proposer() {
  if (draft.length !== view.length || pending) return;
  markPending("guess");
  setError(undefined);
  const reply = await request<null>((socket, ack) =>
    socket.emit("motus:guess", { guess: draft, version: view.version }, ack),
  );
  if (!reply.ok) {
    clearPending();
    setError(reply.message);
  }
}

function saisirLettre(letter: string) {
  setDraft((current) => appendMotusLetter(current, letter, view.length));
  setError(undefined);
}

function effacerLettre() {
  setDraft((current) => eraseMotusLetter(current));
  setError(undefined);
}
```

Remplacer le `<form>` par :

```tsx
<div className="mx-auto mt-5 max-w-xl">
  <MotusKeyboard
    guesses={view.guesses}
    disabled={pending !== null}
    canSubmit={draft.length === view.length}
    onLetter={saisirLettre}
    onErase={effacerLettre}
    onSubmit={() => void proposer()}
  />
  {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
</div>
```

- [ ] **Step 2: Brancher le clavier physique**

Ajouter dans `MotusContent`, après les fonctions de saisie :

```ts
useEffect(() => {
  if (!playing || pending || confirmAbandon) return;

  function onKeyDown(event: KeyboardEvent) {
    const command = motusCommandForKey(
      event.key,
      event.ctrlKey || event.altKey || event.metaKey,
    );
    if (!command) return;
    event.preventDefault();

    if (command.type === "letter") saisirLettre(command.letter);
    else if (command.type === "erase") effacerLettre();
    else void proposer();
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [confirmAbandon, draft, pending, playing, view.length, view.version]);
```

Placer les constantes `playing`, `finished` et `canAfford` avant cet effet. Les dépendances listées reconstruisent le gestionnaire avec le dernier brouillon et la dernière version ; l'effet retire toujours l'ancien gestionnaire.

- [ ] **Step 3: Ajouter le contour de la case active**

Dans `MotusBoard`, calculer :

```ts
const activeColumn = view.length > 0 ? Math.min(draft.length, view.length - 1) : -1;
```

Pour chaque case non confirmée, ajouter un booléen `isCursor = row === activeRow && column === activeColumn`, puis compléter les classes :

```tsx
isCursor && "relative z-10 ring-2 ring-cream ring-offset-2 ring-offset-felt-deep"
```

Le calcul doit rester fondé uniquement sur le brouillon et la longueur : aucun résultat n'est déduit dans la grille.

- [ ] **Step 4: Vérifier les tests et le typage après intégration**

Run: `pnpm --filter @maxoujeux/web test && pnpm --filter @maxoujeux/web typecheck`

Expected: tous les tests web passent et TypeScript ne signale ni fermeture obsolète ni propriété manquante.

- [ ] **Step 5: Vérifier le parcours dans le navigateur**

Lancer l'application avec un `SESSION_SECRET` de développement, ouvrir une partie Motus et contrôler aux largeurs 390 px et 1280 px :

1. les clics sur AZERTY remplissent directement la ligne active ;
2. le contour part de la première case, avance, puis reste sur la dernière case pleine ;
3. Effacer et Retour arrière retirent une lettre ;
4. Valider et Entrée restent inactifs tant que le mot est incomplet ;
5. après un essai confirmé, les lettres prennent le vert, le jaune ou le gris avec la bonne priorité ;
6. pendant l'envoi, aucune touche ne modifie le brouillon ;
7. un mot inconnu conserve le brouillon et affiche l'erreur sous le clavier.

Expected: aucun débordement horizontal, aucune erreur console et toutes les commandes restent accessibles au clavier.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/MotusPage.tsx apps/web/src/components/games/MotusBoard.tsx
git commit -m "feat: saisir les propositions dans la grille Motus"
```

### Task 4: Vérifications finales

**Files:**
- Verify only.

**Interfaces:**
- Consumes: les livrables des tâches 1 à 3.
- Produces: preuves de formatage, tests, typage et build verts.

- [ ] **Step 1: Vérifier les différences et le typage complet**

Run: `git diff --check && pnpm typecheck`

Expected: exit 0 sur les quatre paquets.

- [ ] **Step 2: Exécuter toute la suite de tests**

Run: `pnpm test`

Expected: tous les tests existants et les nouveaux tests de saisie Motus passent.

- [ ] **Step 3: Construire les bundles de production**

Run: `pnpm build`

Expected: tsup, TypeScript et Vite terminent sans erreur.
