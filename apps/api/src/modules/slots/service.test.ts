import { SLOT_SYMBOLS, slotsOutcome } from "@maxoujeux/shared";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { slotSpins } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import { activityOf } from "../games/activity.js";
import {
  leaveSlotsTable,
  openSlotsTable,
  resetSlotsForTests,
  setSlotsRandomForTests,
  setSlotsSpinMsForTests,
  slotsCounts,
  slotsSalonSnapshot,
  slotsTableOf,
  spinReels,
  viewSlots,
  watchSlotsTable,
} from "./service.js";

const created = trackCreated();
const NOW = Date.now();
/** Rotation raccourcie : inutile d'attendre 2,4 s à chaque test. */
const SPIN_MS = 5;

function sym(code: string): number {
  const index = SLOT_SYMBOLS.findIndex((symbol) => symbol.code === code);
  if (index < 0) throw new Error(`Symbole inconnu : ${code}`);
  return index;
}

/** Billet menant à un symbole donné, calculé depuis les poids du barème. */
function ticketFor(index: number): number {
  let total = 0;
  for (let i = 0; i < index; i += 1) total += SLOT_SYMBOLS[i]?.weight ?? 0;
  return total;
}

/** Impose la ligne exacte que les rouleaux doivent afficher. */
function imposeLigne(codes: string[]): void {
  let appel = 0;
  setSlotsRandomForTests(() => ticketFor(sym(codes[appel++ % codes.length] ?? "cerise")));
}

async function player(balance = 5_000, suffix = "") {
  const userId = await created.user(balance);
  return { userId, pseudo: `joueur${suffix}`, avatarSeed: "abcdef" };
}

async function appError(work: () => Promise<unknown>): Promise<AppError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("aucune erreur levée");
}

/** Laisse les rouleaux finir de tourner. */
const laisseTourner = () => new Promise((resolve) => setTimeout(resolve, SPIN_MS + 20));

beforeAll(async () => {
  await runMigrations();
}, 60_000);

beforeEach(() => {
  setSlotsSpinMsForTests(SPIN_MS);
});

afterEach(() => {
  resetSlotsForTests();
});

afterAll(async () => {
  await created.cleanup();
});

describe("machines", () => {
  it("ouvre une machine et la rend visible au salon", async () => {
    const joueur = await player();
    const tableId = await openSlotsTable(joueur);

    expect(slotsTableOf(joueur.userId)).toBe(tableId);
    expect(slotsSalonSnapshot()).toHaveLength(1);
    expect(slotsCounts()).toMatchObject({ playing: 1, max: 10 });
    expect(activityOf(joueur.userId)).toEqual({ kind: "table", id: tableId });
  });

  it("refuse la onzième machine", async () => {
    for (let i = 0; i < 10; i += 1) {
      await openSlotsTable(await player(100, `${i}`));
    }
    const erreur = await appError(async () => openSlotsTable(await player(100, "x")));
    expect(erreur.code).toBe("CAPACITY_REACHED");
    expect(slotsSalonSnapshot()).toHaveLength(10);
  });

  it("libère la place quand le propriétaire s'en va", async () => {
    const joueur = await player();
    const tableId = await openSlotsTable(joueur);
    leaveSlotsTable(joueur.userId, tableId);

    expect(slotsSalonSnapshot()).toHaveLength(0);
    expect(activityOf(joueur.userId)).toBeNull();
  });
});

describe("spectateurs", () => {
  it("laisse regarder une machine sans y jouer", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openSlotsTable(hote);
    await watchSlotsTable(curieux, tableId);

    const view = viewSlots(tableId, curieux.userId);
    expect(view?.watchers).toHaveLength(1);
    expect(view?.owner.userId).toBe(hote.userId);

    const erreur = await appError(() => spinReels(curieux.userId, tableId, 10));
    expect(erreur.code).toBe("SLOTS_NOT_OWNER");
  });

  it("ne consomme aucun verrou d'activité : regarder est libre", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openSlotsTable(hote);
    await watchSlotsTable(curieux, tableId);

    // Un spectateur reste libre de jouer ailleurs : il n'a rien engagé.
    expect(activityOf(curieux.userId)).toBeNull();
  });

  it("laisse un spectateur ouvrir la sienne, en quittant celle qu'il regardait", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openSlotsTable(hote);
    await watchSlotsTable(curieux, tableId);

    const sienne = await openSlotsTable(curieux);
    expect(sienne).not.toBe(tableId);
    expect(activityOf(curieux.userId)).toEqual({ kind: "table", id: sienne });
  });

  it("voit la même ligne que le joueur pendant la rotation", async () => {
    const hote = await player(1_000, "h");
    const curieux = await player(1_000, "c");
    const tableId = await openSlotsTable(hote);
    await watchSlotsTable(curieux, tableId);
    imposeLigne(["diamant"]);

    await spinReels(hote.userId, tableId, 10, NOW);

    const vue = viewSlots(tableId, curieux.userId, NOW);
    expect(vue?.spinning?.reels).toEqual([sym("diamant"), sym("diamant"), sym("diamant")]);
    expect(vue?.spinning?.kind).toBe("triple");
  });

  it("ferme la machine et libère les spectateurs quand l'hôte part", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openSlotsTable(hote);
    await watchSlotsTable(curieux, tableId);

    leaveSlotsTable(hote.userId, tableId);
    expect(viewSlots(tableId, curieux.userId)).toBeNull();
    expect(activityOf(curieux.userId)).toBeNull();
  });
});

describe("tirages", () => {
  it("verse le triple du symbole aligné", async () => {
    imposeLigne(["couronne"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 100, NOW);

    const spin = viewSlots(tableId, joueur.userId, NOW)?.spinning;
    expect(spin?.kind).toBe("triple");
    // ×13 sur 100 MC.
    expect(spin?.payout).toBe(1_300);
    expect(await balanceOf(joueur.userId)).toBe(1_000 - 100 + 1_300);
    expect(await ledgerSum(joueur.userId)).toBe(1_200);
  });

  it("verse la paire quand deux symboles seulement se répondent", async () => {
    imposeLigne(["sac", "sac", "cerise"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 100, NOW);

    const spin = viewSlots(tableId, joueur.userId, NOW)?.spinning;
    expect(spin?.kind).toBe("pair");
    expect(spin?.symbol).toBe(sym("sac"));
    // ×1,5 sur 100 MC.
    expect(spin?.payout).toBe(150);
  });

  it("ne verse rien sur trois symboles différents", async () => {
    imposeLigne(["cerise", "cloche", "sac"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 50, NOW);

    const spin = viewSlots(tableId, joueur.userId, NOW)?.spinning;
    expect(spin?.kind).toBe("none");
    expect(spin?.payout).toBe(0);
    expect(await balanceOf(joueur.userId)).toBe(950);
  });

  it("verse le jackpot de 15 000 sur un MAXOU triple à la mise maximale", async () => {
    imposeLigne(["maxou"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 100, NOW);

    expect(viewSlots(tableId, joueur.userId, NOW)?.spinning?.payout).toBe(15_000);
    expect(await balanceOf(joueur.userId)).toBe(1_000 - 100 + 15_000);
  });

  it("occupe la machine pendant la rotation, puis la libère", async () => {
    imposeLigne(["cerise"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 10, NOW);
    const erreur = await appError(() => spinReels(joueur.userId, tableId, 10, NOW));
    expect(erreur.code).toBe("SLOTS_BUSY");

    await laisseTourner();
    // Rouleaux arrêtés : le tirage rejoint la frise et la machine est libre.
    const vue = viewSlots(tableId, joueur.userId);
    expect(vue?.spinning).toBeNull();
    expect(vue?.history).toHaveLength(1);
    await expect(spinReels(joueur.userId, tableId, 10)).resolves.toBeUndefined();
  });

  it("refuse une mise hors barème sans rien débiter", async () => {
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    for (const stake of [37, 5, 200, -10]) {
      const erreur = await appError(() => spinReels(joueur.userId, tableId, stake, NOW));
      expect(erreur.code).toBe("SLOTS_STAKE_INVALID");
    }
    expect(await balanceOf(joueur.userId)).toBe(1_000);
  });

  it("refuse un tirage que le solde ne couvre pas et n'écrit rien", async () => {
    const joueur = await player(50);
    const tableId = await openSlotsTable(joueur);

    await expect(spinReels(joueur.userId, tableId, 100, NOW)).rejects.toThrow();
    expect(await balanceOf(joueur.userId)).toBe(50);
    const lignes = await db.select().from(slotSpins).where(eq(slotSpins.userId, joueur.userId));
    expect(lignes).toHaveLength(0);
  });

  it("libère la machine quand un tirage est refusé", async () => {
    imposeLigne(["cerise"]);
    const joueur = await player(100);
    const tableId = await openSlotsTable(joueur);

    await expect(spinReels(joueur.userId, tableId, 200, NOW)).rejects.toThrow();
    // Même instant : la machine ne doit pas être restée bloquée.
    expect(viewSlots(tableId, joueur.userId, NOW)?.spinning).toBeNull();
    await expect(spinReels(joueur.userId, tableId, 10, NOW)).resolves.toBeUndefined();
  });

  it("conserve chaque tirage en base, ligne comprise", async () => {
    imposeLigne(["cloche", "cloche", "diamant"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 10, NOW);

    const [ligne] = await db.select().from(slotSpins).where(eq(slotSpins.userId, joueur.userId));
    expect(ligne?.reels).toEqual([sym("cloche"), sym("cloche"), sym("diamant")]);
    expect(ligne?.kind).toBe("pair");
    // Paire de cloches : ×1,1 sur 10 MC.
    expect(ligne?.payout).toBe(11);
  });

  it("tient le compte de ce qui est misé et rendu", async () => {
    imposeLigne(["couronne"]);
    const joueur = await player(5_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 10, NOW);
    await laisseTourner();
    await spinReels(joueur.userId, tableId, 10);

    const vue = viewSlots(tableId, joueur.userId);
    expect(vue?.wagered).toBe(20);
    // ×13 deux fois.
    expect(vue?.returned).toBe(260);
  });

  it("règle le tirage d'après le barème partagé, sans le recalculer", async () => {
    // Le service ne doit pas réinventer la table de gains : ce test compare son
    // versement à ce que `slotsOutcome` annonce pour la même ligne.
    imposeLigne(["diamant", "diamant", "sac"]);
    const joueur = await player(1_000);
    const tableId = await openSlotsTable(joueur);

    await spinReels(joueur.userId, tableId, 20, NOW);

    const spin = viewSlots(tableId, joueur.userId, NOW)?.spinning;
    const attendu = slotsOutcome(spin?.reels ?? []);
    expect(spin?.multiplierTenths).toBe(attendu.multiplierTenths);
    expect(spin?.payout).toBe((20 * attendu.multiplierTenths) / 10);
  });
});
