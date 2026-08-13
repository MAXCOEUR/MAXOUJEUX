import assert from "node:assert/strict";
import test from "node:test";
import { ROULETTE_OUTSIDE, type RouletteSpotBet, type RouletteView } from "@maxoujeux/shared";
import {
  MAT_COLUMNS,
  MAT_DOZENS,
  MAT_EVEN_MONEY,
  MAT_ROWS,
  ballRotation,
  betOn,
  draftTotal,
  isNewerRouletteView,
  pocketAngle,
  rouletteResume,
  spotAria,
  spotLabel,
  wheelRotation,
} from "./roulette-ui.js";

const vue = (version: number, id = "table-1"): RouletteView => ({
  id,
  game: "roulette",
  phase: "idle",
  players: [],
  maxPlayers: 8,
  watchers: [],
  you: null,
  roundId: null,
  bets: [],
  result: null,
  history: [],
  deadlineAt: null,
  spinMs: 7_000,
  version,
  now: "2026-08-12T00:00:00.000Z",
});

test("rejette un état de roulette plus ancien que celui affiché", () => {
  assert.equal(isNewerRouletteView(vue(4), vue(3)), false);
  assert.equal(isNewerRouletteView(vue(4), vue(5)), true);
  assert.equal(isNewerRouletteView(vue(8), vue(1, "table-2")), true);
});

test("ne propose rien sans table ou lorsque la roulette est déjà affichée", () => {
  assert.equal(rouletteResume(null, null), null);
  assert.equal(rouletteResume(vue(3), "table-1"), null);
});

test("résume la roulette gardée derrière le joueur", () => {
  const courant: RouletteView = {
    ...vue(4),
    phase: "betting",
    players: [{
      userId: "u1",
      pseudo: "Maxou",
      avatarSeed: "maxou",
      connected: true,
      totalWager: 0,
      roundNet: null,
    }],
    you: "u1",
    deadlineAt: "2026-08-12T00:00:30.000Z",
  };

  assert.deepEqual(rouletteResume(courant, null), {
    tableId: "table-1",
    wager: 0,
    phase: "betting",
    deadlineAt: "2026-08-12T00:00:30.000Z",
  });
});

test("le résumé expose uniquement la mise du joueur destinataire", () => {
  const courant: RouletteView = {
    ...vue(5),
    players: [
      {
        userId: "u1",
        pseudo: "Maxou",
        avatarSeed: "maxou",
        connected: true,
        totalWager: 250,
        roundNet: null,
      },
      {
        userId: "u2",
        pseudo: "Léa",
        avatarSeed: "lea",
        connected: true,
        totalWager: 1_000,
        roundNet: null,
      },
    ],
    you: "u1",
  };

  assert.equal(rouletteResume(courant, null)?.wager, 250);
});

test("le tapis porte les trente-six numéros, une fois chacun", () => {
  const tous = MAT_ROWS.flat();
  assert.equal(tous.length, 36);
  assert.equal(new Set(tous).size, 36);
  assert.deepEqual([...tous].sort((a, b) => a - b), Array.from({ length: 36 }, (_, i) => i + 1));
});

test("les lignes du tapis sont les colonnes du jeu, la troisième en haut", () => {
  // Disposition universelle : inverser rendrait les mises sur colonne
  // incompréhensibles pour quiconque a déjà joué.
  assert.deepEqual(MAT_ROWS[0]?.slice(0, 3), [3, 6, 9]);
  assert.deepEqual(MAT_ROWS[1]?.slice(0, 3), [2, 5, 8]);
  assert.deepEqual(MAT_ROWS[2]?.slice(0, 3), [1, 4, 7]);
  assert.deepEqual([...MAT_COLUMNS], ["column3", "column2", "column1"]);
});

test("chaque ligne du tapis correspond bien à sa colonne de jeu", () => {
  MAT_ROWS.forEach((ligne, index) => {
    const colonne = MAT_COLUMNS[index]!;
    const attendu = Number(colonne.replace("column", ""));
    for (const numero of ligne) {
      assert.equal(numero % 3 === 0 ? 3 : numero % 3, attendu, `${numero} dans ${colonne}`);
    }
  });
});

test("le tapis propose les douze mises extérieures, sans doublon ni oubli", () => {
  const exterieures = [...MAT_DOZENS, ...MAT_COLUMNS, ...MAT_EVEN_MONEY];
  assert.equal(new Set(exterieures).size, 12);
  assert.deepEqual([...exterieures].sort(), [...ROULETTE_OUTSIDE].sort());
});

test("le libellé d'une case nomme le rapport, pas seulement la case", () => {
  assert.equal(spotLabel({ kind: "straight", number: 17 }), "Plein 17");
  assert.equal(spotLabel({ kind: "dozen2" }), "2e douzaine");
  assert.match(spotAria({ kind: "red" }, 0, 0), /Rouge, 1:1/);
  assert.match(spotAria({ kind: "straight", number: 0 }, 0, 0), /Plein 0, 35:1/);
});

test("le libellé distingue ta mise de celle de la table", () => {
  assert.match(spotAria({ kind: "red" }, 50, 130), /50 MC misés par toi sur 130 MC/);
  assert.match(spotAria({ kind: "red" }, 0, 130), /130 MC misés par la table/);
});

test("retrouve le tas posé sur une case", () => {
  const bets: RouletteSpotBet[] = [
    { spot: { kind: "red" }, total: 100, mine: 40 },
    { spot: { kind: "straight", number: 17 }, total: 20, mine: 20 },
  ];
  assert.deepEqual(betOn(bets, { kind: "red" })?.mine, 40);
  assert.deepEqual(betOn(bets, { kind: "straight", number: 17 })?.total, 20);
  assert.equal(betOn(bets, { kind: "straight", number: 18 }), null);
  assert.equal(betOn(bets, { kind: "black" }), null);
});

test("additionne une composition en cours", () => {
  const draft = new Map([
    ["red", { spot: { kind: "red" } as const, amount: 50 }],
    ["straight:7", { spot: { kind: "straight", number: 7 } as const, amount: 20 }],
  ]);
  assert.equal(draftTotal(draft), 70);
  assert.equal(draftTotal(new Map()), 0);
});

test("le zéro est en haut du cylindre et chaque case a son angle", () => {
  assert.equal(pocketAngle(0), 0);
  // 37 cases : la case suivante est à un trente-septième de tour.
  assert.ok(Math.abs(pocketAngle(32) - 360 / 37) < 0.001);
  const angles = new Set(Array.from({ length: 37 }, (_, n) => pocketAngle(n).toFixed(4)));
  assert.equal(angles.size, 37);
});

test("le cylindre tourne plusieurs tours sans viser de case", () => {
  // Un multiple exact de 360 : chaque case retrouve son angle de dessin, ce qui
  // permet à la bille de s'arrêter dessus sans repère fixe à l'écran.
  const rotation = wheelRotation();
  assert.ok(rotation > 360, "le cylindre doit tourner plus d'un tour");
  assert.equal(rotation % 360, 0);
});

test("la bille s'arrête exactement sur le numéro sorti, en sens inverse", () => {
  for (const numero of [0, 17, 26, 32]) {
    const bille = ballRotation(numero);
    // Sens inverse du cylindre, et plusieurs tours pour que le lancer se lise.
    assert.ok(bille < -360, `${numero} doit orbiter plus d'un tour à l'envers`);

    // Position finale de la bille et de la case, une fois les tours retirés.
    const arrivee = ((bille % 360) + 360) % 360;
    const caseGagnante = ((pocketAngle(numero) + wheelRotation()) % 360 + 360) % 360;
    assert.ok(
      Math.abs(arrivee - caseGagnante) < 0.001,
      `la bille doit tomber sur la case ${numero}`,
    );
  }
});
