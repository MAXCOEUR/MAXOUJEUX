import {
  PLINKO_FALL_MS,
  PLINKO_MAX_BALLS,
  PLINKO_MIN_INTERVAL_MS,
  PLINKO_ROWS,
  PLINKO_SLOTS,
  plinkoMultiplier,
} from "@maxoujeux/shared";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, runMigrations } from "../../db/index.js";
import { plinkoDrops } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, ledgerSum, trackCreated } from "../../test/fixtures.js";
import { activityOf } from "../games/activity.js";
import {
  dropBall,
  leavePlinkoTable,
  openPlinkoTable,
  plinkoCounts,
  plinkoSalonSnapshot,
  plinkoTableOf,
  resetPlinkoForTests,
  setPlinkoRandomForTests,
  setPlinkoRisk,
  viewPlinko,
  watchPlinkoTable,
} from "./service.js";

const created = trackCreated();
const NOW = Date.now();

/** Tous les rebonds du même côté : la bille tombe dans une fente connue. */
const toutADroite = () => 1;
const toutAGauche = () => 0;

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

afterEach(() => {
  resetPlinkoForTests();
});

afterAll(async () => {
  await created.cleanup();
});

describe("tables", () => {
  it("ouvre une table et la rend visible au salon", async () => {
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);

    expect(plinkoTableOf(joueur.userId)).toBe(tableId);
    expect(plinkoSalonSnapshot()).toHaveLength(1);
    expect(plinkoCounts()).toMatchObject({ playing: 1, max: 10 });
    // La table consomme le verrou d'activité : on ne joue pas ailleurs en
    // même temps.
    expect(activityOf(joueur.userId)).toEqual({ kind: "table", id: tableId });
  });

  it("rend la table déjà ouverte plutôt que d'en ouvrir une seconde", async () => {
    const joueur = await player();
    const premier = await openPlinkoTable(joueur);
    expect(await openPlinkoTable(joueur)).toBe(premier);
    expect(plinkoSalonSnapshot()).toHaveLength(1);
  });

  it("refuse la onzième table", async () => {
    for (let i = 0; i < 10; i += 1) {
      await openPlinkoTable(await player(100, `${i}`));
    }
    const erreur = await appError(async () => openPlinkoTable(await player(100, "x")));
    expect(erreur.code).toBe("CAPACITY_REACHED");
    expect(plinkoSalonSnapshot()).toHaveLength(10);
  });

  it("libère la place quand le propriétaire s'en va", async () => {
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);
    leavePlinkoTable(joueur.userId, tableId);

    expect(plinkoSalonSnapshot()).toHaveLength(0);
    expect(plinkoTableOf(joueur.userId)).toBeNull();
    expect(activityOf(joueur.userId)).toBeNull();
  });
});

describe("spectateurs", () => {
  it("laisse regarder une table sans y jouer", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openPlinkoTable(hote);
    await watchPlinkoTable(curieux, tableId);

    const view = viewPlinko(tableId, curieux.userId);
    expect(view?.watchers).toHaveLength(1);
    expect(view?.owner.userId).toBe(hote.userId);

    // Un spectateur ne lâche pas de bille : la table n'est pas la sienne.
    const erreur = await appError(() => dropBall(curieux.userId, tableId, 10));
    expect(erreur.code).toBe("PLINKO_NOT_OWNER");
  });

  it("ne consomme aucun verrou d'activité : regarder est libre", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openPlinkoTable(hote);
    await watchPlinkoTable(curieux, tableId);

    // Un spectateur reste libre de jouer ailleurs : il n'a rien engagé.
    expect(activityOf(curieux.userId)).toBeNull();
  });

  it("laisse un spectateur ouvrir la sienne, en quittant celle qu'il regardait", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openPlinkoTable(hote);
    await watchPlinkoTable(curieux, tableId);

    const sienne = await openPlinkoTable(curieux);
    expect(sienne).not.toBe(tableId);
    expect(activityOf(curieux.userId)).toEqual({ kind: "table", id: sienne });
  });

  it("ferme la table et libère les spectateurs quand l'hôte part", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openPlinkoTable(hote);
    await watchPlinkoTable(curieux, tableId);

    leavePlinkoTable(hote.userId, tableId);
    expect(viewPlinko(tableId, curieux.userId)).toBeNull();
    expect(activityOf(curieux.userId)).toBeNull();
    expect(plinkoTableOf(curieux.userId)).toBeNull();
  });

  it("laisse un spectateur sortir sans fermer la table", async () => {
    const hote = await player();
    const curieux = await player();
    const tableId = await openPlinkoTable(hote);
    await watchPlinkoTable(curieux, tableId);

    leavePlinkoTable(curieux.userId, tableId);
    expect(viewPlinko(tableId, hote.userId)?.watchers).toHaveLength(0);
    expect(plinkoSalonSnapshot()).toHaveLength(1);
  });
});

describe("billes", () => {
  it("verse le barème de la fente atteinte", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player(1_000);
    const tableId = await openPlinkoTable(joueur);
    setPlinkoRisk(joueur.userId, tableId, "high");

    await dropBall(joueur.userId, tableId, 100, NOW);

    const view = viewPlinko(tableId, joueur.userId, NOW);
    const bille = view?.balls[0];
    expect(bille?.slot).toBe(0);
    expect(bille?.multiplierTenths).toBe(plinkoMultiplier("high", 0));
    expect(bille?.payout).toBe(2_500);
    expect(await balanceOf(joueur.userId)).toBe(1_000 - 100 + 2_500);
    expect(await ledgerSum(joueur.userId)).toBe(2_400);
  });

  it("renvoie un trajet complet, cohérent avec la fente", async () => {
    setPlinkoRandomForTests(toutADroite);
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);

    await dropBall(joueur.userId, tableId, 10, NOW);
    const bille = viewPlinko(tableId, joueur.userId, NOW)?.balls[0];

    expect(bille?.path).toHaveLength(PLINKO_ROWS);
    expect(bille?.slot).toBe(PLINKO_SLOTS - 1);
  });

  it("laisse plusieurs billes en vol en même temps", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);

    // Trois billes lâchées à 300 ms d'écart : toutes encore en l'air.
    await dropBall(joueur.userId, tableId, 10, NOW);
    await dropBall(joueur.userId, tableId, 10, NOW + 300);
    await dropBall(joueur.userId, tableId, 10, NOW + 600);

    expect(viewPlinko(tableId, joueur.userId, NOW + 700)?.balls).toHaveLength(3);
  });

  it("retire les billes retombées de l'état", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);
    await dropBall(joueur.userId, tableId, 10, NOW);

    // Bien après la fin de la chute : la table doit être vide.
    expect(viewPlinko(tableId, joueur.userId, NOW + 10_000)?.balls).toHaveLength(0);
  });

  it("impose une cadence minimale entre deux billes", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);

    await dropBall(joueur.userId, tableId, 10, NOW);
    const erreur = await appError(() =>
      dropBall(joueur.userId, tableId, 10, NOW + PLINKO_MIN_INTERVAL_MS - 1),
    );
    expect(erreur.code).toBe("PLINKO_TOO_FAST");

    // Passé le délai, la bille suivante repart normalement.
    await expect(
      dropBall(joueur.userId, tableId, 10, NOW + PLINKO_MIN_INTERVAL_MS),
    ).resolves.toBeUndefined();
  });

  it("refuse de saturer la table", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player(50_000);
    const tableId = await openPlinkoTable(joueur);

    // Toutes lâchées dans la même fenêtre de chute, en respectant la cadence.
    for (let i = 0; i < PLINKO_MAX_BALLS; i += 1) {
      await dropBall(joueur.userId, tableId, 10, NOW + i * PLINKO_MIN_INTERVAL_MS);
    }
    const erreur = await appError(() =>
      dropBall(joueur.userId, tableId, 10, NOW + PLINKO_MAX_BALLS * PLINKO_MIN_INTERVAL_MS),
    );
    expect(erreur.code).toBe("PLINKO_TOO_MANY_BALLS");
  });

  it("refuse une mise hors barème sans rien débiter", async () => {
    const joueur = await player(1_000);
    const tableId = await openPlinkoTable(joueur);

    for (const stake of [37, 5, 900, -10]) {
      const erreur = await appError(() => dropBall(joueur.userId, tableId, stake, NOW));
      expect(erreur.code).toBe("PLINKO_STAKE_INVALID");
    }
    expect(await balanceOf(joueur.userId)).toBe(1_000);
  });

  it("refuse une bille que le solde ne couvre pas et n'écrit rien", async () => {
    const joueur = await player(50);
    const tableId = await openPlinkoTable(joueur);

    await expect(dropBall(joueur.userId, tableId, 100, NOW)).rejects.toThrow();
    expect(await balanceOf(joueur.userId)).toBe(50);
    const lignes = await db
      .select()
      .from(plinkoDrops)
      .where(eq(plinkoDrops.userId, joueur.userId));
    expect(lignes).toHaveLength(0);
  });

  it("ne laisse pas une bille refusée bloquer la suivante", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player(100);
    const tableId = await openPlinkoTable(joueur);

    await expect(dropBall(joueur.userId, tableId, 500, NOW)).rejects.toThrow();
    // Même instant : la cadence ne doit pas avoir été consommée par l'échec.
    await expect(dropBall(joueur.userId, tableId, 10, NOW)).resolves.toBeUndefined();
  });

  it("applique le risque courant de la table", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player(5_000);
    const tableId = await openPlinkoTable(joueur);

    setPlinkoRisk(joueur.userId, tableId, "low");
    await dropBall(joueur.userId, tableId, 100, NOW);
    expect(viewPlinko(tableId, joueur.userId, NOW)?.balls[0]?.payout).toBe(300);

    setPlinkoRisk(joueur.userId, tableId, "high");
    await dropBall(joueur.userId, tableId, 100, NOW + 1_000);
    const billes = viewPlinko(tableId, joueur.userId, NOW + 1_000)?.balls ?? [];
    expect(billes[billes.length - 1]?.payout).toBe(2_500);
  });

  it("ne compte une bille qu'une fois qu'elle a touché le fond", async () => {
    // Le bilan est lu à l'écran pendant la chute : le faire bouger au lâcher
    // révélerait le gain avant que la bille n'arrive, ce qui gâche tout.
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player(5_000);
    const tableId = await openPlinkoTable(joueur);
    setPlinkoRisk(joueur.userId, tableId, "low");

    await dropBall(joueur.userId, tableId, 100, NOW);
    await dropBall(joueur.userId, tableId, 100, NOW + 300);

    // Billes encore en l'air : rien n'est encore comptabilisé.
    const enVol = viewPlinko(tableId, joueur.userId, NOW + 400);
    expect(enVol?.balls).toHaveLength(2);
    expect(enVol?.wagered).toBe(0);
    expect(enVol?.returned).toBe(0);

    // Les deux ont atterri : le compte est à jour.
    const apres = viewPlinko(tableId, joueur.userId, NOW + PLINKO_FALL_MS + 400);
    expect(apres?.balls).toHaveLength(0);
    expect(apres?.wagered).toBe(200);
    expect(apres?.returned).toBe(600);
  });

  it("conserve chaque chute en base pour pouvoir la rejouer", async () => {
    setPlinkoRandomForTests(toutAGauche);
    const joueur = await player();
    const tableId = await openPlinkoTable(joueur);
    setPlinkoRisk(joueur.userId, tableId, "low");
    await dropBall(joueur.userId, tableId, 10, NOW);

    const [ligne] = await db
      .select()
      .from(plinkoDrops)
      .where(eq(plinkoDrops.userId, joueur.userId));
    expect(ligne?.risk).toBe("low");
    expect(ligne?.slot).toBe(0);
    expect(ligne?.path).toHaveLength(PLINKO_ROWS);
  });
});
