import { WHEEL_SEGMENTS } from "@maxoujeux/shared";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { wheelSpins } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, primes, trackCreated } from "../../test/fixtures.js";
import {
  enterWheelRoom,
  leaveWheelRoom,
  resetWheelForTests,
  setWheelRandomForTests,
  setWheelSpinMsForTests,
  spin,
  wheelState,
} from "./service.js";

const created = trackCreated();
const NOW = new Date("2026-08-13T12:00:00.000Z");

/** Billet imposé : le test choisit le secteur, sans toucher au hasard global. */
const ticket = (value: number) => () => value;

/** Billet menant à un secteur donné, calculé depuis les poids du barème. */
function ticketFor(index: number): () => number {
  let total = 0;
  for (let i = 0; i < index; i += 1) total += WHEEL_SEGMENTS[i]?.weight ?? 0;
  return ticket(total);
}

function indexOfMultiplier(tenths: number): number {
  const index = WHEEL_SEGMENTS.findIndex((segment) => segment.multiplierTenths === tenths);
  if (index < 0) throw new Error(`Aucun secteur à ×${tenths / 10}`);
  return index;
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

beforeAll(async () => {
  await runMigrations();
}, 60_000);

/** L'animation dure six secondes en production : inutile de les attendre ici. */
beforeEach(() => {
  setWheelSpinMsForTests(5);
});

afterEach(() => {
  resetWheelForTests();
});

/** Laisse la roue finir de tourner. */
const laisseTourner = () => new Promise((resolve) => setTimeout(resolve, 20));

afterAll(async () => {
  await created.cleanup();
});

describe("la salle", () => {
  it("réunit tous ceux qui sont entrés", async () => {
    const a = await player(1_000, "a");
    const b = await player(1_000, "b");
    enterWheelRoom(a, "socket-a");
    enterWheelRoom(b, "socket-b");

    const view = await wheelState(a.userId, NOW);
    expect(view.audience.map((p) => p.userId).sort()).toEqual([a.userId, b.userId].sort());
  });

  it("ne compte un joueur qu'une fois, même avec deux onglets", async () => {
    const a = await player();
    enterWheelRoom(a, "onglet-1");
    enterWheelRoom(a, "onglet-2");
    expect((await wheelState(a.userId, NOW)).audience).toHaveLength(1);

    // Fermer un onglet ne fait pas sortir de la salle.
    leaveWheelRoom(a.userId, "onglet-1");
    expect((await wheelState(a.userId, NOW)).audience).toHaveLength(1);

    leaveWheelRoom(a.userId, "onglet-2");
    expect((await wheelState(a.userId, NOW)).audience).toHaveLength(0);
  });

  it("refuse de lancer à qui n'est pas dans la salle", async () => {
    const a = await player();
    const erreur = await appError(() => spin(a.userId, 10, NOW));
    expect(erreur.code).toBe("WHEEL_NOT_HERE");
    expect(await balanceOf(a.userId)).toBe(5_000);
  });
});

describe("lancer", () => {
  it("débite la mise et verse le multiplicateur du secteur atteint", async () => {
    const a = await player(1_000);
    enterWheelRoom(a, "s");
    setWheelRandomForTests(ticketFor(indexOfMultiplier(30))); // ×3

    await spin(a.userId, 100, NOW);

    const view = await wheelState(a.userId, NOW);
    expect(view.lastSpin?.payout).toBe(300);
    const bonus = primes("premier_gain");
    expect(await balanceOf(a.userId)).toBe(1_200 + bonus);
    // Le journal ne porte que les mouvements : le solde initial de la fixture
    // est posé directement, sans écriture.
    expect(await ledgerSum(a.userId)).toBe(200 + bonus);
  });

  it("fait tourner la roue pour toute la salle", async () => {
    const joueur = await player(1_000, "j");
    const curieux = await player(1_000, "c");
    enterWheelRoom(joueur, "s1");
    enterWheelRoom(curieux, "s2");
    setWheelRandomForTests(ticketFor(indexOfMultiplier(200))); // ×20

    await spin(joueur.userId, 10, NOW);

    // Le spectateur voit la même roue, le même secteur, la même échéance.
    const vue = await wheelState(curieux.userId, NOW);
    expect(vue.spinning?.by.userId).toBe(joueur.userId);
    expect(vue.spinning?.result.index).toBe(indexOfMultiplier(200));
    expect(vue.spinning?.endsAt).toBe(new Date(NOW.getTime() + 5).toISOString());
    // Et il ne peut pas lancer pendant qu'elle tourne, même s'il en a le droit.
    expect(vue.canSpin).toBe(false);
  });

  it("refuse un second lancer pendant que la roue tourne", async () => {
    const a = await player(1_000, "a");
    const b = await player(1_000, "b");
    enterWheelRoom(a, "s1");
    enterWheelRoom(b, "s2");
    setWheelRandomForTests(ticket(0));

    await spin(a.userId, 10, NOW);
    const erreur = await appError(() => spin(b.userId, 10, NOW));
    expect(erreur.code).toBe("WHEEL_BUSY");
    expect(await balanceOf(b.userId)).toBe(1_000);
  });

  it("garde une trace du lancer dans l'historique de la salle", async () => {
    const a = await player(1_000);
    enterWheelRoom(a, "s");
    setWheelRandomForTests(ticketFor(indexOfMultiplier(50))); // ×5

    await spin(a.userId, 20, NOW);

    const view = await wheelState(a.userId, NOW);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]?.by.pseudo).toBe(a.pseudo);
    expect(view.history[0]?.payout).toBe(100);
  });

  it("ferme la roue jusqu'à minuit et annonce l'heure de réouverture", async () => {
    const a = await player(1_000);
    enterWheelRoom(a, "s");
    setWheelRandomForTests(ticket(0));

    await spin(a.userId, 10, NOW);
    const view = await wheelState(a.userId, NOW);
    expect(view.canSpin).toBe(false);
    // NOW vaut 14 h à Paris le 13 août : la roue rouvre à 00 h le 14, soit
    // 22 h UTC le 13. Ce n'est pas « 24 h plus tard », c'est le jour d'après.
    expect(view.nextSpinAt).toBe("2026-08-13T22:00:00.000Z");

    const solde = await balanceOf(a.userId);
    await laisseTourner();
    const erreur = await appError(() => spin(a.userId, 10, NOW));
    expect(erreur.code).toBe("WHEEL_COOLDOWN");
    expect(await balanceOf(a.userId)).toBe(solde);
  });

  it("libère la roue quand un lancer est refusé", async () => {
    const a = await player(1_000, "a");
    const b = await player(1_000, "b");
    enterWheelRoom(a, "s1");
    enterWheelRoom(b, "s2");
    setWheelRandomForTests(ticket(0));

    // Solde insuffisant : la roue ne doit pas rester bloquée pour la salle.
    const pauvre = await player(5, "p");
    enterWheelRoom(pauvre, "s3");
    await expect(spin(pauvre.userId, 100, NOW)).rejects.toThrow();

    // Pas d'attente ici : une roue libérée par un refus l'est immédiatement.
    expect((await wheelState(b.userId, NOW)).spinning).toBeNull();
    await expect(spin(b.userId, 10, NOW)).resolves.toBeUndefined();
  });

  it("rouvre la roue au passage de minuit, pas 24 h après le lancer", async () => {
    const a = await player(1_000);
    enterWheelRoom(a, "s");
    setWheelRandomForTests(ticket(0));

    await spin(a.userId, 10, NOW);
    await laisseTourner();

    // 00 h 05 à Paris le 14 août : dix heures seulement après le lancer, mais
    // le jour civil a changé.
    const lendemain = new Date("2026-08-13T22:05:00.000Z");
    expect((await wheelState(a.userId, lendemain)).canSpin).toBe(true);
    await expect(spin(a.userId, 10, lendemain)).resolves.toBeUndefined();
  });

  it("refuse une mise hors barème sans rien débiter", async () => {
    const a = await player(1_000);
    enterWheelRoom(a, "s");

    for (const mise of [37, 5, 2_000, -10]) {
      const erreur = await appError(() => spin(a.userId, mise, NOW));
      expect(erreur.code).toBe("WHEEL_STAKE_INVALID");
    }
    expect(await balanceOf(a.userId)).toBe(1_000);
    expect((await wheelState(a.userId, NOW)).canSpin).toBe(true);
  });

  it("refuse un lancer que le solde ne couvre pas sans consommer la journée", async () => {
    const a = await player(50);
    enterWheelRoom(a, "s");

    await expect(spin(a.userId, 100, NOW)).rejects.toThrow();
    expect(await balanceOf(a.userId)).toBe(50);
    expect((await wheelState(a.userId, NOW)).canSpin).toBe(true);
  });

  it("enregistre le secteur atteint et non le seul multiplicateur", async () => {
    // Le secteur commande l'angle d'arrêt : une roue qui s'immobilise ailleurs
    // que sur la case annoncée ruine la confiance.
    const a = await player(1_000);
    enterWheelRoom(a, "s");
    const index = indexOfMultiplier(50);
    setWheelRandomForTests(ticketFor(index));

    await spin(a.userId, 10, NOW);

    const [ligne] = await db.select().from(wheelSpins).where(eq(wheelSpins.userId, a.userId));
    expect(ligne?.segment).toBe(index);
    expect(WHEEL_SEGMENTS[ligne?.segment ?? -1]?.multiplierTenths).toBe(50);
  });

  it("ne laisse pas un double clic consommer deux lancers", async () => {
    const a = await player(1_000);
    enterWheelRoom(a, "s");
    setWheelRandomForTests(ticket(0));

    const resultats = await Promise.allSettled([
      spin(a.userId, 100, NOW),
      spin(a.userId, 100, NOW),
    ]);

    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lignes = await db.select().from(wheelSpins).where(eq(wheelSpins.userId, a.userId));
    expect(lignes).toHaveLength(1);
  });
});
