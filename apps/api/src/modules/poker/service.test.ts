import { POKER_DEFAULT_CONFIG, type PokerTableConfig } from "@maxoujeux/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../db/index.js";
import { AppError } from "../../lib/errors.js";
import { balanceOf, trackCreated } from "../../test/fixtures.js";
import { activityOf } from "../games/activity.js";
import {
  actPoker,
  createPokerTable,
  followPoker,
  leavePoker,
  pokerCounts,
  pokerTableOf,
  rebuyPoker,
  resetPokerForTests,
  revealPoker,
  setPokerBlinds,
  setPokerDurationsForTests,
  sitOutPoker,
  sitPoker,
  standPoker,
  viewPoker,
  watchPokerTable,
} from "./service.js";

const created = trackCreated();

const CONFIG: PokerTableConfig = {
  ...POKER_DEFAULT_CONFIG,
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 400,
  maxBuyIn: 2_000,
  seats: 4,
};

async function joueur(balance = 10_000, suffixe = "") {
  const userId = await created.user(balance);
  return { userId, pseudo: `joueur${suffixe}`, avatarSeed: "abcdef" };
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

/** Laisse passer une phase raccourcie. */
const attendre = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function attendreJusqua(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (!condition() && Date.now() < limite) await attendre(10);
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

beforeEach(() => {
  // Phases raccourcies : inutile d'attendre trente secondes par décision.
  setPokerDurationsForTests({ action: 10_000, startDelay: 0, streetPause: 5, handBreak: 10 });
});

afterEach(() => {
  resetPokerForTests();
});

afterAll(async () => {
  await created.cleanup();
});

describe("ouverture de la table", () => {
  it("assoit le créateur, débite sa cave et publie la table", async () => {
    const hote = await joueur(10_000);
    const tableId = await createPokerTable(hote, CONFIG);

    const vue = viewPoker(tableId, hote.userId);
    expect(vue?.seats).toHaveLength(1);
    expect(vue?.seats[0]).toMatchObject({ seat: 0, stack: CONFIG.minBuyIn, userId: hote.userId });
    expect(vue?.isHost).toBe(true);
    expect(vue?.phase).toBe("waiting");
    expect(await balanceOf(hote.userId)).toBe(10_000 - CONFIG.minBuyIn);
    expect(activityOf(hote.userId)).toEqual({ kind: "table", id: tableId });
    expect(pokerCounts()).toMatchObject({ max: 1 });
  });

  it("n'autorise qu'une seule table sur le site", async () => {
    await createPokerTable(await joueur(), CONFIG);
    const erreur = await appError(async () => createPokerTable(await joueur(), CONFIG));
    expect(erreur.code).toBe("CAPACITY_REACHED");
  });

  it("rend la place et le verrou si la cave ne passe pas", async () => {
    // Solde insuffisant : la réservation mémoire ne doit pas survivre.
    const pauvre = await joueur(100);
    await expect(createPokerTable(pauvre, CONFIG)).rejects.toThrow();
    expect(pokerTableOf(pauvre.userId)).toBeNull();
    expect(activityOf(pauvre.userId)).toBeNull();
    expect(await balanceOf(pauvre.userId)).toBe(100);
  });
});

describe("sièges et spectateurs", () => {
  it("laisse entrer en spectateur sans prendre de verrou", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const curieux = await joueur();
    await watchPokerTable(curieux, tableId);

    const vue = viewPoker(tableId, curieux.userId);
    expect(vue?.you).toBeNull();
    expect(vue?.watchers).toHaveLength(1);
    // Regarder n'engage rien : on peut jouer ailleurs.
    expect(activityOf(curieux.userId)).toBeNull();
  });

  it("assoit un spectateur qui se cave, et prend alors le verrou", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000);
    await watchPokerTable(invite, tableId);
    await sitPoker(invite, tableId, 2, 600);

    const vue = viewPoker(tableId, invite.userId);
    expect(vue?.you).toBe(2);
    expect(vue?.watchers).toHaveLength(0);
    expect(await balanceOf(invite.userId)).toBe(10_000 - 600);
    expect(activityOf(invite.userId)).toEqual({ kind: "table", id: tableId });
  });

  it("annonce le départ de la main avant de distribuer", async () => {
    setPokerDurationsForTests({ startDelay: 30 });
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();

    await sitPoker(invite, tableId, 1, CONFIG.minBuyIn);

    const attente = viewPoker(tableId, hote.userId);
    expect(attente?.phase).toBe("waiting");
    expect(attente?.timerKind).toBe("start");
    expect(attente?.deadlineAt).not.toBeNull();

    await attendre(45);
    expect(viewPoker(tableId, hote.userId)?.phase).toBe("preflop");
  });

  it("refuse une place déjà prise", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    const erreur = await appError(() => sitPoker(invite, tableId, 0, 600));
    expect(erreur.code).toBe("POKER_SEAT_TAKEN");
  });

  it("refuse une cave hors des bornes de la table", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000);

    for (const cave of [100, 5_000]) {
      const erreur = await appError(() => sitPoker(invite, tableId, 1, cave));
      expect(erreur.code).toBe("POKER_BUYIN_INVALID");
    }
    expect(await balanceOf(invite.userId)).toBe(10_000);
  });

  it("rend les jetons au porte-monnaie quand on se lève", async () => {
    const hote = await joueur(10_000);
    const tableId = await createPokerTable(hote, CONFIG);
    await standPoker(hote.userId, tableId);

    // La cave revient intégralement : aucune main n'a été jouée.
    expect(await balanceOf(hote.userId)).toBe(10_000);
    expect(activityOf(hote.userId)).toBeNull();
  });
});

describe("déroulé d'une main", () => {
  it("démarre dès qu'un deuxième joueur s'assoit", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    const vue = viewPoker(tableId, hote.userId);
    expect(vue?.phase).toBe("preflop");
    expect(vue?.board).toHaveLength(0);
    // Les deux blindes sont au pot.
    expect(vue?.potTotal).toBe(CONFIG.smallBlind + CONFIG.bigBlind);
    expect(vue?.turn).not.toBeNull();
  });

  it("donne deux cartes à chacun et ouvre les actions au joueur au trait", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    const vue = viewPoker(tableId, hote.userId);
    const moi = vue?.seats.find((seat) => seat.userId === hote.userId);
    expect(moi?.cards).toHaveLength(2);
    if (vue?.turn === moi?.seat) {
      expect(vue?.allowed?.actions.length).toBeGreaterThan(0);
    }
  });

  it("donne la parole aux deux joueurs, rue après rue", async () => {
    /**
     * Non-régression : deux joueurs sur une table de quatre places.
     *
     * La recherche du joueur suivant comptait ses pas en nombre de joueurs et
     * non en nombre de chaises : elle s'arrêtait dans les places vides sans
     * jamais revenir au siège 0. Le siège 1 parlait seul, la main se déroulait
     * toute seule jusqu'à l'abattage, et le joueur assis en 0 n'avait jamais la
     * main. C'est le cas de **toutes** les vraies tables, jamais pleines.
     */
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    const paroles = new Map([
      [hote.userId, 0],
      [invite.userId, 0],
    ]);
    const rues = new Set<string>();

    for (let coup = 0; coup < 8; coup += 1) {
      const vueHote = viewPoker(tableId, hote.userId);
      const vueInvite = viewPoker(tableId, invite.userId);
      const actif = vueHote?.allowed ? hote : vueInvite?.allowed ? invite : null;
      if (!actif) {
        await attendre();
        continue;
      }
      const vue = actif === hote ? vueHote : vueInvite;
      if (!vue?.allowed) continue;
      rues.add(vue.phase);
      paroles.set(actif.userId, (paroles.get(actif.userId) ?? 0) + 1);
      await actPoker(actif.userId, tableId, vue.version, {
        kind: vue.allowed.actions.includes("check") ? "check" : "call",
      });
      await attendre();
    }

    expect(paroles.get(hote.userId)).toBeGreaterThan(0);
    expect(paroles.get(invite.userId)).toBeGreaterThan(0);
    // Personne ne relance : la main traverse donc bien les quatre rues.
    expect([...rues].sort()).toEqual(["flop", "preflop", "river", "turn"]);
  });

  it("publie la respiration entre deux rues et ferme les actions pendant ce délai", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    for (let coup = 0; coup < 4 && viewPoker(tableId, null)?.phase === "preflop"; coup += 1) {
      const vueTable = viewPoker(tableId, null);
      const auTrait = vueTable?.seats.find((seat) => seat.seat === vueTable.turn);
      expect(auTrait).toBeDefined();
      const vueJoueur = viewPoker(tableId, auTrait?.userId ?? "");
      const actions = vueJoueur?.allowed?.actions ?? [];
      await actPoker(auTrait?.userId ?? "", tableId, vueJoueur?.version ?? 0, {
        kind: actions.includes("check") ? "check" : "call",
      });
    }

    const pause = viewPoker(tableId, hote.userId);
    expect(pause?.phase).toBe("flop");
    expect(pause?.timerKind).toBe("street");
    expect(pause?.timerMs).toBe(5);
    expect(pause?.deadlineAt).not.toBeNull();
    expect(pause?.allowed).toBeNull();
  });

  it("mène une main jusqu'au bout et conserve les jetons", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    const depart = (viewPoker(tableId, null)?.seats ?? []).reduce(
      (total, seat) => total + seat.stack + seat.committed,
      0,
    );

    // On couche celui qui parle : la main s'arrête et le pot part au survivant.
    let vue = viewPoker(tableId, null);
    let garde = 0;
    while (vue && vue.phase !== "payout" && vue.phase !== "waiting" && garde < 20) {
      const tour = vue.turn;
      if (tour === null) break;
      const auTrait = vue.seats.find((seat) => seat.seat === tour);
      if (!auTrait) break;
      const vueJoueur = viewPoker(tableId, auTrait.userId);
      const actions = vueJoueur?.allowed?.actions ?? [];
      if (actions.length === 0) {
        await attendre();
        vue = viewPoker(tableId, null);
        continue;
      }
      await actPoker(
        auTrait.userId,
        tableId,
        vueJoueur?.version ?? 0,
        { kind: actions.includes("check") ? "check" : actions.includes("call") ? "call" : "fold" },
      );
      vue = viewPoker(tableId, null);
      garde += 1;
    }

    const arrivee = (viewPoker(tableId, null)?.seats ?? []).reduce(
      (total, seat) => total + seat.stack + seat.committed,
      0,
    );
    expect(arrivee).toBe(depart);
    expect(viewPoker(tableId, null)?.timerKind).toBe("hand-break");
  });

  it("refuse une action hors tour et une action sur état périmé", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    const vue = viewPoker(tableId, null);
    const tour = vue?.turn ?? 0;
    const horsTour = vue?.seats.find((seat) => seat.seat !== tour);
    if (horsTour) {
      const erreur = await appError(() =>
        actPoker(horsTour.userId, tableId, vue?.version ?? 0, { kind: "fold" }),
      );
      expect(erreur.code).toBe("POKER_NOT_YOUR_TURN");
    }

    const auTrait = vue?.seats.find((seat) => seat.seat === tour);
    if (auTrait) {
      const perime = await appError(() =>
        actPoker(auTrait.userId, tableId, (vue?.version ?? 0) - 1, { kind: "fold" }),
      );
      expect(perime.code).toBe("STALE_STATE");
    }
  });
});

describe("anti-triche : les cartes ne sortent pas du serveur", () => {
  /**
   * Le test de non-régression le plus important du jeu.
   *
   * Il inspecte la **sérialisation JSON** et non le type : une carte fuite par
   * un champ oublié, pas par une signature. Tant qu'une main est en cours,
   * aucune vue ne doit contenir la moindre carte d'un autre siège — ni pour un
   * adversaire, ni pour un spectateur.
   */
  it("ne révèle aucune carte adverse tant que la main n'est pas finie", async () => {
    const hote = await joueur(10_000, "a");
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000, "b");
    await sitPoker(invite, tableId, 1, 600);
    const curieux = await joueur(10_000, "c");
    await watchPokerTable(curieux, tableId);

    for (const spectateur of [hote.userId, invite.userId, curieux.userId, null]) {
      const vue = viewPoker(tableId, spectateur);
      expect(vue?.phase).toBe("preflop");

      for (const siege of vue?.seats ?? []) {
        if (siege.userId === spectateur) {
          // Chacun voit sa propre main, et elle est complète.
          expect(siege.cards.filter(Boolean)).toHaveLength(2);
          continue;
        }
        // Tous les autres : deux emplacements, aucune carte.
        expect(siege.cards).toHaveLength(2);
        expect(siege.cards.every((carte) => carte === null)).toBe(true);
        expect(siege.handLabel).toBeNull();
        expect(siege.bestCards).toBeNull();
      }

      // Ceinture et bretelles : le JSON complet ne doit pas contenir de rang de
      // carte rattaché à un siège qui n'est pas le destinataire.
      const serialise = JSON.stringify(vue?.seats.filter((seat) => seat.userId !== spectateur));
      expect(serialise).not.toMatch(/"rank"/);
    }
  });

  it("ne révèle le jeu suivi au spectateur qu'une fois le coup terminé", async () => {
    const hote = await joueur(10_000, "a");
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000, "b");
    await sitPoker(invite, tableId, 1, 600);
    const curieux = await joueur(10_000, "c");
    await watchPokerTable(curieux, tableId);

    const avant = viewPoker(tableId, curieux.userId);
    const auTrait = avant?.seats.find((siege) => siege.seat === avant.turn);
    expect(auTrait).toBeDefined();
    followPoker(curieux.userId, tableId, auTrait?.userId ?? null);

    const pendant = viewPoker(tableId, curieux.userId);
    expect(pendant?.followedUserId).toBe(auTrait?.userId);
    expect(pendant?.seats.every((siege) => siege.cards.every((carte) => carte === null))).toBe(true);

    // En heads-up, un couchage termine immédiatement le coup. Le spectateur
    // peut alors lire uniquement la main suivie, jamais toutes les mains
    // couchées du récapitulatif.
    await actPoker(auTrait?.userId ?? "", tableId, pendant?.version ?? 0, { kind: "fold" });

    const recapitulatif = viewPoker(tableId, curieux.userId);
    expect(recapitulatif?.phase).toBe("payout");
    expect(
      recapitulatif?.seats.find((siege) => siege.userId === auTrait?.userId)?.cards.filter(Boolean),
    ).toHaveLength(2);
    expect(
      recapitulatif?.seats
        .filter((siege) => siege.userId !== auTrait?.userId)
        .every((siege) => siege.cards.every((carte) => carte === null)),
    ).toBe(true);
  });

  it("montre le jeu d'un joueur couché qui le demande, à toute la table", async () => {
    const hote = await joueur(10_000, "a");
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000, "b");
    await sitPoker(invite, tableId, 1, 600);

    // Celui qui parle se couche, puis choisit de montrer.
    const vue = viewPoker(tableId, null);
    const auTrait = vue?.seats.find((siege) => siege.seat === vue.turn);
    const coucheur = auTrait?.userId === hote.userId ? hote : invite;
    await actPoker(coucheur.userId, tableId, vue?.version ?? 0, { kind: "fold" });

    expect(viewPoker(tableId, coucheur.userId)?.canReveal).toBe(true);
    revealPoker(coucheur.userId, tableId);

    const vues = viewPoker(tableId, null)?.seats.find((siege) => siege.userId === coucheur.userId);
    expect(vues?.revealed).toBe(true);
    expect(vues?.cards.filter(Boolean)).toHaveLength(2);
  });

  it("refuse de montrer un jeu qu'on défend encore", async () => {
    const hote = await joueur(10_000, "a");
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000, "b");
    await sitPoker(invite, tableId, 1, 600);

    // Personne n'est couché : montrer donnerait sa lecture à l'adversaire au
    // milieu des enchères.
    expect(viewPoker(tableId, hote.userId)?.canReveal).toBe(false);
    const erreur = await appError(async () => revealPoker(hote.userId, tableId));
    expect(erreur.code).toBe("POKER_REVEAL_CLOSED");
  });

  it("ne donne aucun coup légal à un spectateur", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);
    const curieux = await joueur();
    await watchPokerTable(curieux, tableId);

    expect(viewPoker(tableId, curieux.userId)?.allowed).toBeNull();
    expect(viewPoker(tableId, null)?.allowed).toBeNull();
  });
});

describe("réglages du créateur", () => {
  it("applique les blindes tout de suite quand aucune main ne tourne", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    setPokerBlinds(hote.userId, tableId, 20, 40);

    const vue = viewPoker(tableId, hote.userId);
    expect(vue?.config.smallBlind).toBe(20);
    expect(vue?.pendingConfig).toBeNull();
  });

  it("diffère le changement à la main suivante quand une main est en cours", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    setPokerBlinds(hote.userId, tableId, 20, 40);
    const vue = viewPoker(tableId, hote.userId);
    // La main en cours garde ses blindes : on ne change pas les règles au
    // milieu d'un coup.
    expect(vue?.config.smallBlind).toBe(10);
    expect(vue?.pendingConfig?.smallBlind).toBe(20);
  });

  it("réserve le réglage au créateur", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    const erreur = await appError(async () => setPokerBlinds(invite.userId, tableId, 25, 50));
    expect(erreur.code).toBe("POKER_NOT_HOST");
  });

  it("refuse des blindes incompatibles avec la cave minimale", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);

    const erreur = await appError(async () => setPokerBlinds(hote.userId, tableId, 25, 50));
    expect(erreur.code).toBe("POKER_ACTION_INVALID");
  });
});

describe("recave", () => {
  it("ajoute des jetons entre deux mains", async () => {
    const hote = await joueur(10_000);
    const tableId = await createPokerTable(hote, CONFIG);
    await rebuyPoker(hote.userId, tableId, 500);

    expect(viewPoker(tableId, hote.userId)?.seats[0]?.stack).toBe(CONFIG.minBuyIn + 500);
    expect(await balanceOf(hote.userId)).toBe(10_000 - CONFIG.minBuyIn - 500);
  });

  it("refuse de dépasser la cave maximale", async () => {
    const hote = await joueur(10_000);
    const tableId = await createPokerTable(hote, CONFIG);
    const erreur = await appError(() => rebuyPoker(hote.userId, tableId, 5_000));
    expect(erreur.code).toBe("POKER_BUYIN_INVALID");
  });

  it("ouvre la recave pendant le récapitulatif entre deux mains", async () => {
    const hote = await joueur(10_000, "a");
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur(10_000, "b");
    await sitPoker(invite, tableId, 1, 600);

    const vue = viewPoker(tableId, null);
    const auTrait = vue?.seats.find((siege) => siege.seat === vue.turn);
    expect(auTrait).toBeDefined();
    await actPoker(auTrait?.userId ?? "", tableId, vue?.version ?? 0, { kind: "fold" });

    const avant = viewPoker(tableId, hote.userId);
    expect(avant?.phase).toBe("payout");
    expect(avant?.buyInRange).not.toBeNull();
    await rebuyPoker(hote.userId, tableId, 100);
    expect(viewPoker(tableId, hote.userId)?.seats.find((siege) => siege.userId === hote.userId)?.stack)
      .toBe((avant?.seats.find((siege) => siege.userId === hote.userId)?.stack ?? 0) + 100);
  });

  it("sérialise une recave et la restitution simultanées", async () => {
    const hote = await joueur(10_000);
    const tableId = await createPokerTable(hote, CONFIG);

    await Promise.all([
      rebuyPoker(hote.userId, tableId, 100),
      standPoker(hote.userId, tableId),
    ]);

    expect(await balanceOf(hote.userId)).toBe(10_000);
    expect(viewPoker(tableId, hote.userId)?.you).toBeNull();
    expect(viewPoker(tableId, hote.userId)?.seats).toHaveLength(0);
  });
});

describe("pause", () => {
  it("rend la place après trois mains sans avoir payé de blinde", async () => {
    const hote = await joueur(10_000, "a");
    const tableId = await createPokerTable(hote, CONFIG);
    sitOutPoker(hote.userId, tableId, true);
    const invite = await joueur(10_000, "b");
    const troisieme = await joueur(10_000, "c");
    await sitPoker(invite, tableId, 1, 600);
    await sitPoker(troisieme, tableId, 2, 600);

    for (let main = 0; main < 3; main += 1) {
      const vue = viewPoker(tableId, null);
      const auTrait = vue?.seats.find((siege) => siege.seat === vue.turn);
      expect(auTrait).toBeDefined();
      await actPoker(auTrait?.userId ?? "", tableId, vue?.version ?? 0, { kind: "fold" });
      await attendre(25);
    }

    // PostgreSQL réel valide le remboursement avant de libérer le siège ; ce
    // commit peut dépasser les 25 ms fixes d'une base PGlite en mémoire.
    await attendreJusqua(
      () => !viewPoker(tableId, null)?.seats.some((siege) => siege.userId === hote.userId),
    );

    expect(viewPoker(tableId, null)?.seats.some((siege) => siege.userId === hote.userId)).toBe(
      false,
    );
    expect(activityOf(hote.userId)).toBeNull();
  });
});

describe("départ", () => {
  it("ferme la table quand tout le monde est parti", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    await leavePoker(hote.userId, tableId);
    await attendre();

    expect(viewPoker(tableId, hote.userId)).toBeNull();
    expect(pokerTableOf(hote.userId)).toBeNull();
  });

  it("attend la fin de la main avant de libérer un siège engagé", async () => {
    const hote = await joueur();
    const tableId = await createPokerTable(hote, CONFIG);
    const invite = await joueur();
    await sitPoker(invite, tableId, 1, 600);

    await leavePoker(invite.userId, tableId);
    const vue = viewPoker(tableId, hote.userId);
    // Toujours à table : on ne retire pas un joueur au milieu d'un coup.
    expect(vue?.seats.some((seat) => seat.userId === invite.userId)).toBe(true);
    expect(vue?.seats.find((seat) => seat.userId === invite.userId)?.leavingAfterHand).toBe(true);
  });
});
