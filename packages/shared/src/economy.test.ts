import { describe, expect, it } from "vitest";
import {
  addDays,
  currentMotusSlot,
  DAILY_BONUS,
  DAILY_BONUS_CAP_STREAK,
  dailyBonusAmount,
  formatCoinsDelta,
  WALLET_REASON_LABELS,
  motusReward,
  nextMotusSlot,
  nextParisMidnight,
  nextStreak,
  parisDay,
} from "./economy.js";

describe("bonus quotidien", () => {
  it("verse le montant de base au premier jour", () => {
    expect(dailyBonusAmount(1)).toBe(1000);
  });

  it("ajoute 100 MC par jour consécutif", () => {
    expect(dailyBonusAmount(2)).toBe(1100);
    expect(dailyBonusAmount(5)).toBe(1400);
  });

  it("atteint le plafond au 11e jour et ne le dépasse jamais", () => {
    expect(DAILY_BONUS_CAP_STREAK).toBe(11);
    expect(dailyBonusAmount(11)).toBe(DAILY_BONUS.cap);
    expect(dailyBonusAmount(12)).toBe(DAILY_BONUS.cap);
    expect(dailyBonusAmount(9999)).toBe(DAILY_BONUS.cap);
  });

  it("traite une série absurde comme un premier jour", () => {
    expect(dailyBonusAmount(0)).toBe(1000);
    expect(dailyBonusAmount(-4)).toBe(1000);
  });
});

describe("série du bonus", () => {
  it("démarre à 1 pour un compte qui n'a jamais encaissé", () => {
    expect(nextStreak(null, 0, "2026-08-11")).toBe(1);
  });

  it("incrémente la série si la veille a été encaissée", () => {
    expect(nextStreak("2026-08-10", 3, "2026-08-11")).toBe(4);
  });

  it("repart à 1 dès qu'un jour a été manqué", () => {
    expect(nextStreak("2026-08-09", 7, "2026-08-11")).toBe(1);
    expect(nextStreak("2026-07-01", 30, "2026-08-11")).toBe(1);
  });

  it("laisse la série inchangée si le jour courant est déjà encaissé", () => {
    // Cas défensif : le service refuse déjà le double encaissement,
    // cette fonction ne doit pas pour autant gonfler la série.
    expect(nextStreak("2026-08-11", 4, "2026-08-11")).toBe(4);
  });

  it("enchaîne correctement par-dessus un changement de mois", () => {
    expect(nextStreak("2026-07-31", 2, "2026-08-01")).toBe(3);
  });

  it("enchaîne correctement par-dessus un changement d'année", () => {
    expect(nextStreak("2026-12-31", 9, "2027-01-01")).toBe(10);
  });

  it("enchaîne correctement sur une année bissextile", () => {
    expect(nextStreak("2028-02-29", 1, "2028-03-01")).toBe(2);
    expect(nextStreak("2028-02-28", 1, "2028-02-29")).toBe(2);
  });
});

describe("addDays", () => {
  it("recule et avance d'un jour", () => {
    expect(addDays("2026-08-11", -1)).toBe("2026-08-10");
    expect(addDays("2026-08-11", 1)).toBe("2026-08-12");
  });

  it("franchit les bornes de mois et d'année", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
});

describe("récompense Motus", () => {
  it("distingue la mise du versement dans le journal", () => {
    expect(WALLET_REASON_LABELS.motus_stake).toBe("Mise Motus");
    expect(WALLET_REASON_LABELS.motus_reward).toBe("Gain Motus");
  });

  it("suit le barème dégressif, en multiple de la mise", () => {
    expect(motusReward(1, true, 100)).toBe(600);
    expect(motusReward(4, true, 100)).toBe(250);
    // Trouver au dernier essai rend exactement la mise : ni gain, ni perte.
    expect(motusReward(6, true, 100)).toBe(100);
  });

  it("suit la mise, quelle qu'elle soit", () => {
    expect(motusReward(1, true, 10)).toBe(60);
    expect(motusReward(1, true, 5_000)).toBe(30_000);
  });

  it("verse un montant entier pour toute mise au pas de 10", () => {
    // Le 5e essai verse 1,8 × la mise : c'est le multiplicateur qui tomberait
    // à côté si le pas de mise venait à descendre sous 10.
    for (let stake = 10; stake <= 1_000; stake += 10) {
      for (let attempts = 1; attempts <= 6; attempts += 1) {
        expect(Number.isInteger(motusReward(attempts, true, stake))).toBe(true);
      }
    }
  });

  it("ne verse rien si le mot n'est pas trouvé", () => {
    expect(motusReward(6, false, 100)).toBe(0);
    expect(motusReward(3, false, 100)).toBe(0);
  });

  it("ne verse rien pour un nombre d'essais hors barème", () => {
    // Un 7e essai ne devrait jamais exister ; s'il arrive, il ne rapporte rien
    // plutôt que de renvoyer `undefined` et de corrompre un solde.
    expect(motusReward(7, true, 100)).toBe(0);
    expect(motusReward(0, true, 100)).toBe(0);
  });
});

describe("jour civil parisien", () => {
  it("rattache une heure de nuit UTC au bon jour parisien", () => {
    // 22 h 30 UTC le 10 août = 00 h 30 le 11 août à Paris (UTC+2 en été).
    expect(parisDay(new Date("2026-08-10T22:30:00Z"))).toBe("2026-08-11");
  });

  it("rattache une heure de nuit UTC au bon jour en hiver", () => {
    // 23 h 30 UTC le 10 janvier = 00 h 30 le 11 janvier à Paris (UTC+1).
    expect(parisDay(new Date("2026-01-10T23:30:00Z"))).toBe("2026-01-11");
    // 23 h 30 UTC en hiver, une heure plus tôt : encore la veille à Paris.
    expect(parisDay(new Date("2026-01-10T22:30:00Z"))).toBe("2026-01-10");
  });
});

describe("minuit parisien", () => {
  it("tombe à 22 h UTC en été", () => {
    const midnight = nextParisMidnight(new Date("2026-08-11T10:00:00Z"));
    expect(midnight.toISOString()).toBe("2026-08-11T22:00:00.000Z");
  });

  it("tombe à 23 h UTC en hiver", () => {
    const midnight = nextParisMidnight(new Date("2026-01-11T10:00:00Z"));
    expect(midnight.toISOString()).toBe("2026-01-11T23:00:00.000Z");
  });

  it("reste dans le futur juste avant minuit", () => {
    // 21 h 59 UTC un soir d'été = 23 h 59 à Paris : minuit est dans une minute.
    const now = new Date("2026-08-11T21:59:00Z");
    const midnight = nextParisMidnight(now);
    expect(midnight.getTime() - now.getTime()).toBe(60_000);
  });

  it("passe au lendemain juste après minuit", () => {
    // 22 h 01 UTC = 00 h 01 le 12 août à Paris : le prochain minuit est le 13.
    const midnight = nextParisMidnight(new Date("2026-08-11T22:01:00Z"));
    expect(midnight.toISOString()).toBe("2026-08-12T22:00:00.000Z");
  });

  it("franchit correctement le passage à l'heure d'été", () => {
    // Dans la nuit du 28 au 29 mars 2026, Paris passe de UTC+1 à UTC+2.
    // Le minuit du 29 est encore en UTC+1, donc à 23 h UTC le 28.
    const midnight = nextParisMidnight(new Date("2026-03-28T12:00:00Z"));
    expect(midnight.toISOString()).toBe("2026-03-28T23:00:00.000Z");

    // Le minuit du 30 est déjà en UTC+2, donc à 22 h UTC le 29.
    const after = nextParisMidnight(new Date("2026-03-29T12:00:00Z"));
    expect(after.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("franchit correctement le passage à l'heure d'hiver", () => {
    // Dans la nuit du 24 au 25 octobre 2026, Paris repasse de UTC+2 à UTC+1.
    const midnight = nextParisMidnight(new Date("2026-10-24T12:00:00Z"));
    expect(midnight.toISOString()).toBe("2026-10-24T22:00:00.000Z");

    const after = nextParisMidnight(new Date("2026-10-25T12:00:00Z"));
    expect(after.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("créneaux Motus", () => {
  it("coupe la journée d'été en deux, à minuit et à midi de Paris", () => {
    // 14 h à Paris (12 h UTC en été) tombe dans le créneau de midi.
    const slot = currentMotusSlot(new Date("2026-08-11T12:00:00Z"));
    expect(slot.start.toISOString()).toBe("2026-08-11T10:00:00.000Z"); // 12 h Paris
    expect(slot.end.toISOString()).toBe("2026-08-11T22:00:00.000Z"); // 00 h Paris le 12
  });

  it("place le créneau de minuit sur le bon jour", () => {
    // 00 h 30 le 11 août à Paris = 22 h 30 UTC le 10.
    const slot = currentMotusSlot(new Date("2026-08-10T22:30:00Z"));
    expect(slot.start.toISOString()).toBe("2026-08-10T22:00:00.000Z"); // 00 h Paris
    expect(slot.end.toISOString()).toBe("2026-08-11T10:00:00.000Z"); // 12 h Paris
  });

  /**
   * Le cœur de la règle : les bornes sont des **heures civiles parisiennes**.
   * En hiver, Paris est à UTC+1 — minuit tombe donc à 23 h UTC la veille et midi
   * à 11 h UTC, et non aux mêmes instants UTC qu'en été. Un décalage codé en dur
   * ferait tourner le mot à 01 h et 13 h la moitié de l'année.
   */
  it("tombe toujours sur minuit et midi, y compris en heure d'hiver", () => {
    // 14 h à Paris le 15 janvier = 13 h UTC (UTC+1).
    const apresMidi = currentMotusSlot(new Date("2027-01-15T13:00:00Z"));
    expect(apresMidi.start.toISOString()).toBe("2027-01-15T11:00:00.000Z"); // 12 h Paris
    expect(apresMidi.end.toISOString()).toBe("2027-01-15T23:00:00.000Z"); // 00 h Paris le 16

    // 08 h à Paris le 15 janvier = 07 h UTC : créneau de minuit.
    const matin = currentMotusSlot(new Date("2027-01-15T07:00:00Z"));
    expect(matin.start.toISOString()).toBe("2027-01-14T23:00:00.000Z"); // 00 h Paris
    expect(matin.end.toISOString()).toBe("2027-01-15T11:00:00.000Z"); // 12 h Paris
  });

  it("n'ouvre que deux créneaux par jour", () => {
    // Vingt-quatre heures parisiennes ne doivent produire que deux ouvertures.
    const ouvertures = new Set<string>();
    let cursor = new Date("2026-08-10T22:00:00Z"); // 00 h Paris le 11
    while (cursor.getTime() < new Date("2026-08-11T22:00:00Z").getTime()) {
      ouvertures.add(currentMotusSlot(cursor).start.toISOString());
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    }
    expect(ouvertures.size).toBe(2);
  });

  it("enchaîne les créneaux sans trou ni recouvrement", () => {
    let cursor = new Date("2026-08-11T00:00:00Z");
    for (let i = 0; i < 8; i += 1) {
      const slot = currentMotusSlot(cursor);
      // Le créneau suivant démarre exactement là où le précédent finit.
      const following = currentMotusSlot(slot.end);
      expect(following.start.getTime()).toBe(slot.end.getTime());
      cursor = slot.end;
    }
  });

  it("expose le début du créneau suivant", () => {
    const now = new Date("2026-08-11T12:00:00Z");
    expect(nextMotusSlot(now).toISOString()).toBe(currentMotusSlot(now).end.toISOString());
  });

  it("ne produit qu'un créneau de onze heures réelles au passage à l'heure d'été", () => {
    // Le changement d'heure a lieu à 02 h locales : le créneau parisien de
    // 00 h à 12 h ne dure que onze heures réelles ce jour-là. Les bornes civiles
    // restent 00 h et 12 h, ce qui est le comportement attendu.
    const slot = currentMotusSlot(new Date("2026-03-29T00:30:00Z"));
    const hours = (slot.end.getTime() - slot.start.getTime()) / 3_600_000;
    expect(hours).toBe(11);
  });

  it("produit un créneau de treize heures au retour à l'heure d'hiver", () => {
    // Le 25 octobre 2026, 03 h locales redeviennent 02 h : la matinée dure une
    // heure de plus. Les bornes civiles, elles, ne bougent pas.
    const slot = currentMotusSlot(new Date("2026-10-25T00:30:00Z"));
    const hours = (slot.end.getTime() - slot.start.getTime()) / 3_600_000;
    expect(hours).toBe(13);
  });
});

describe("affichage", () => {
  it("préfixe le signe et garde la valeur absolue", () => {
    expect(formatCoinsDelta(1000)).toContain("+1");
    expect(formatCoinsDelta(-500)).toContain("−500");
    expect(formatCoinsDelta(-500)).not.toContain("-−");
  });
});
