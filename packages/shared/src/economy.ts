/**
 * Économie MaxouCoin — barèmes et calculs de dates.
 *
 * Source unique des montants : le front y lit ce qu'il affiche, l'API ce qu'elle
 * applique. Aucun montant ne doit être recopié ailleurs, sinon les deux côtés
 * finissent par diverger discrètement.
 *
 * Tout ce fichier est constitué de **fonctions pures** : aucune I/O, aucun accès
 * à la base. C'est ce qui permet de tester les règles d'équilibrage — série du
 * bonus, créneaux de 6 h, passage à l'heure d'été — sans lancer de serveur.
 */

export const COIN_NAME = "MaxouCoin";
export const COIN_SYMBOL = "MC";

/**
 * MaxouCoin offerts à la création du compte.
 *
 * Valeur par défaut de `STARTING_BALANCE` côté API : un exploitant peut la
 * surcharger par variable d'environnement, auquel cas le montant annoncé sur
 * l'écran d'inscription ne correspondra plus. À laisser tel quel sauf besoin.
 */
export const SIGNUP_BONUS = 5000;

// ---------------------------------------------------------------------------
// Bonus quotidien
// ---------------------------------------------------------------------------

export const DAILY_BONUS = {
  /** Montant du premier jour, et de tout retour après une série interrompue. */
  base: 1000,
  /** Ajouté par jour consécutif supplémentaire. */
  perStreakDay: 100,
  /** Plafond, atteint au 11e jour consécutif. */
  cap: 2000,
} as const;

/** Nombre de jours consécutifs à partir duquel le plafond est atteint. */
export const DAILY_BONUS_CAP_STREAK =
  1 + (DAILY_BONUS.cap - DAILY_BONUS.base) / DAILY_BONUS.perStreakDay;

/**
 * Montant versé pour une série donnée. `streak` vaut 1 le premier jour.
 * Le plafond n'est jamais dépassé, quelle que soit la longueur de la série.
 */
export function dailyBonusAmount(streak: number): number {
  const effective = Math.max(1, Math.floor(streak));
  return Math.min(DAILY_BONUS.base + (effective - 1) * DAILY_BONUS.perStreakDay, DAILY_BONUS.cap);
}

/**
 * Série qui résultera d'un encaissement aujourd'hui.
 *
 * Suppose que le bonus du jour n'a pas encore été pris — c'est le service qui
 * vérifie ce point, via la clé primaire de `daily_claims`.
 *
 * @param lastClaimDay dernier jour encaissé au format `AAAA-MM-JJ`, ou `null`
 * @param lastStreak série atteinte lors de cet encaissement
 * @param today jour civil courant à Paris, au même format
 */
export function nextStreak(
  lastClaimDay: string | null,
  lastStreak: number,
  today: string,
): number {
  if (!lastClaimDay) return 1;
  // Cas défensif : si le jour courant est déjà encaissé, la série ne bouge pas.
  if (lastClaimDay === today) return Math.max(1, lastStreak);
  return lastClaimDay === addDays(today, -1) ? Math.max(1, lastStreak) + 1 : 1;
}

// ---------------------------------------------------------------------------
// Motus
// ---------------------------------------------------------------------------

/** Un mot toutes les 6 h : créneaux de 00 h, 06 h, 12 h et 18 h, heure de Paris. */
export const MOTUS_SLOT_HOURS = 6;

export const MOTUS_MAX_ATTEMPTS = 6;

/**
 * Récompense par nombre d'essais utilisés, du 1er au 6e.
 * Barème dégressif volontaire : trouver en deux coups ne peut pas rapporter
 * autant qu'en six, sinon autant tenter au hasard. La moyenne d'un joueur
 * correct tourne autour de 250 MC.
 */
export const MOTUS_REWARDS = [600, 450, 350, 250, 175, 100] as const;

/** Récompense d'une tentative. Un mot non trouvé ne rapporte rien. */
export function motusReward(attempts: number, solved: boolean): number {
  if (!solved) return 0;
  const index = Math.floor(attempts) - 1;
  if (index < 0 || index >= MOTUS_REWARDS.length) return 0;
  return MOTUS_REWARDS[index] ?? 0;
}

// ---------------------------------------------------------------------------
// Paliers de mise
//
// Calibrés sur le revenu garanti par les bonus (2 000 MC/jour) : la table
// Découverte représente environ quatre caves par jour, la table Haute n'est
// atteignable qu'en ayant gagné. C'est ce rapport qui donne du poids aux mises.
// ---------------------------------------------------------------------------

export const STAKE_TIERS = [
  {
    id: "discovery",
    name: "Découverte",
    smallBlind: 5,
    bigBlind: 10,
    buyIn: 500,
    blackjackMin: 10,
    blackjackMax: 100,
  },
  {
    id: "classic",
    name: "Classique",
    smallBlind: 25,
    bigBlind: 50,
    buyIn: 2500,
    blackjackMin: 50,
    blackjackMax: 500,
  },
  {
    id: "high",
    name: "Haute",
    smallBlind: 100,
    bigBlind: 200,
    buyIn: 10_000,
    blackjackMin: 250,
    blackjackMax: 2500,
  },
] as const;

export type StakeTier = (typeof STAKE_TIERS)[number];
export type StakeTierId = StakeTier["id"];

export function getStakeTier(id: string): StakeTier | undefined {
  return STAKE_TIERS.find((tier) => tier.id === id);
}

// ---------------------------------------------------------------------------
// Journal des mouvements
// ---------------------------------------------------------------------------

export const WALLET_REASONS = [
  "signup_bonus",
  "daily_bonus",
  "motus_reward",
  "poker_buyin",
  "poker_cashout",
  "blackjack_bet",
  "blackjack_payout",
] as const;

export type WalletReason = (typeof WALLET_REASONS)[number];

/** Libellés affichés dans l'historique du panneau MaxouCoin. */
export const WALLET_REASON_LABELS: Record<WalletReason, string> = {
  signup_bonus: "Bienvenue",
  daily_bonus: "Bonus quotidien",
  motus_reward: "Motus",
  poker_buyin: "Cave de poker",
  poker_cashout: "Sortie de table",
  blackjack_bet: "Mise blackjack",
  blackjack_payout: "Gain blackjack",
};

// ---------------------------------------------------------------------------
// Contrat d'API du porte-monnaie
// ---------------------------------------------------------------------------

export interface WalletSummary {
  balance: number;
  /** Série en cours. 0 si le joueur n'a jamais encaissé de bonus. */
  streak: number;
  canClaim: boolean;
  /** Montant que rapporterait un encaissement immédiat. */
  claimableAmount: number;
  /** Montant du lendemain si la série est poursuivie — sert à donner envie de revenir. */
  nextDayAmount: number;
  /** Prochaine réinitialisation, en ISO. Purement indicatif pour le compte à rebours. */
  nextClaimAt: string;
  /** Ouverture du prochain créneau Motus, en ISO. */
  nextMotusSlotAt: string;
}

export interface WalletEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: WalletReason;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

const numberFormatter = new Intl.NumberFormat("fr-FR");

/** `1 250 MC`. Le séparateur de milliers suit la convention française. */
export function formatCoins(amount: number): string {
  return `${numberFormatter.format(amount)} ${COIN_SYMBOL}`;
}

/** `+1 000 MC` / `−500 MC`, pour l'historique. */
export function formatCoinsDelta(delta: number): string {
  const sign = delta < 0 ? "−" : "+";
  return `${sign}${numberFormatter.format(Math.abs(delta))} ${COIN_SYMBOL}`;
}

// ---------------------------------------------------------------------------
// Dates — heure de Paris
//
// Le fuseau est traité par l'API Intl et non par un décalage codé en dur :
// UTC+1 six mois par an et UTC+2 les six autres, un `+1` fixe décalerait la
// frontière de minuit la moitié de l'année.
// ---------------------------------------------------------------------------

const PARIS = "Europe/Paris";

const parisFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PARIS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  // `h23` garantit 0 à 23 : avec `hour12: false`, minuit peut sortir en « 24 ».
  hourCycle: "h23",
});

interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Décompose un instant en date et heure civiles parisiennes. */
function parisParts(at: Date): CivilParts {
  const parts = parisFormatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Décalage de Paris par rapport à UTC, en millisecondes, à cet instant précis. */
function parisOffsetMs(at: Date): number {
  const p = parisParts(at);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - (at.getTime() - at.getUTCMilliseconds());
}

/**
 * Instant correspondant à une date et heure **civiles** parisiennes.
 *
 * Les composants sont normalisés par `Date.UTC` : `day + 1` passe au mois
 * suivant, `hour: 24` au lendemain 00 h.
 */
function parisCivilToInstant(year: number, month: number, day: number, hour: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour);

  // Première approximation à partir du décalage supposé à cet instant.
  const guessedOffset = parisOffsetMs(new Date(naive));
  let instant = new Date(naive - guessedOffset);

  // L'approximation peut tomber du mauvais côté d'un changement d'heure ;
  // le décalage relu à l'instant corrigé donne alors le bon résultat.
  const correctedOffset = parisOffsetMs(instant);
  if (correctedOffset !== guessedOffset) {
    instant = new Date(naive - correctedOffset);
  }

  return instant;
}

/** Jour civil parisien au format `AAAA-MM-JJ`. C'est la clé du bonus quotidien. */
export function parisDay(at: Date): string {
  const p = parisParts(at);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/**
 * Décale un jour civil de `delta` jours. Arithmétique de chaîne, sans fuseau :
 * un jour civil n'a pas de durée, seul son numéro compte.
 */
export function addDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + delta));
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/** Prochain minuit parisien — instant de réinitialisation du bonus quotidien. */
export function nextParisMidnight(now: Date): Date {
  const p = parisParts(now);
  return parisCivilToInstant(p.year, p.month, p.day + 1, 0);
}

export interface MotusSlot {
  /** Ouverture du créneau. Sert de clé primaire à `motus_slots`. */
  start: Date;
  /** Ouverture du créneau suivant. */
  end: Date;
}

/** Créneau Motus contenant l'instant donné. */
export function currentMotusSlot(now: Date): MotusSlot {
  const p = parisParts(now);
  const slotHour = Math.floor(p.hour / MOTUS_SLOT_HOURS) * MOTUS_SLOT_HOURS;
  return {
    start: parisCivilToInstant(p.year, p.month, p.day, slotHour),
    end: parisCivilToInstant(p.year, p.month, p.day, slotHour + MOTUS_SLOT_HOURS),
  };
}

/** Ouverture du créneau Motus suivant. */
export function nextMotusSlot(now: Date): Date {
  return currentMotusSlot(now).end;
}
