/**
 * Catalogue des jeux. Source de vérité unique : le lobby du front l'affiche,
 * l'API valide les codes de jeu contre cette liste.
 *
 * `status` pilote l'affichage : seuls les jeux "live" sont jouables,
 * les autres apparaissent grisés dans le lobby avec leur lot de livraison.
 */

export const GAME_CODES = ["connect4", "tictactoe", "motus", "blackjack", "poker"] as const;

export type GameCode = (typeof GAME_CODES)[number];

export type GameStatus = "live" | "soon";

export interface GameWager {
  /** Libellé affiché dans le lobby : une cave pour le poker, une mise ailleurs. */
  label: "Cave" | "Mise";
  /** Bornes obligatoires, en MaxouCoin. Deux valeurs égales indiquent une mise fixe. */
  min: number;
  max: number;
  /** Résumé du versement au gagnant lorsqu'il ne découle pas directement des règles. */
  payout?: string;
}

export interface GameDefinition {
  code: GameCode;
  name: string;
  tagline: string;
  /** Nombre de joueurs supporté par une table. */
  minPlayers: number;
  maxPlayers: number;
  /** Le jeu consomme-t-il des jetons virtuels ? */
  usesChips: boolean;
  /** Mise obligatoire et toujours plafonnée. */
  wager: GameWager;
  status: GameStatus;
  /** Lot du plan de développement qui livre ce jeu. */
  milestone: number;
  /**
   * Couleur d'accent, prise dans le jeu lui-même — le rouge des cœurs, le jaune
   * de la grille Motus, le rouge des disques — et non dans une palette
   * décorative. Utilitaire Tailwind défini dans le bloc `@theme`.
   */
  accent: string;
  /**
   * Jeu mis en vedette dans le lobby : occupe une vignette large.
   * Un seul jeu doit porter ce drapeau, sinon la grille perd son point d'entrée.
   */
  featured?: boolean;
}

export const GAMES: readonly GameDefinition[] = [
  {
    code: "poker",
    name: "Texas Hold'em",
    tagline: "Deux cartes en main, cinq sur la table. Le reste est du bluff.",
    minPlayers: 2,
    maxPlayers: 9,
    usesChips: true,
    wager: { label: "Cave", min: 500, max: 10_000 },
    status: "soon",
    milestone: 4,
    accent: "var(--color-game-poker)",
    featured: true,
  },
  {
    code: "blackjack",
    name: "Blackjack",
    tagline: "Approcher 21 sans le dépasser. Le croupier ne pardonne pas.",
    minPlayers: 1,
    maxPlayers: 5,
    usesChips: true,
    wager: { label: "Mise", min: 10, max: 2500 },
    status: "soon",
    milestone: 3,
    accent: "var(--color-game-blackjack)",
  },
  {
    code: "motus",
    name: "Motus",
    tagline: "Seul face au mot : six essais, et chaque ligne compte.",
    minPlayers: 1,
    maxPlayers: 1,
    usesChips: true,
    wager: { label: "Mise", min: 100, max: 100, payout: "100 à 600 MC" },
    status: "soon",
    milestone: 2,
    accent: "var(--color-game-motus)",
  },
  {
    code: "connect4",
    name: "Puissance 4",
    tagline: "Quatre disques alignés. Simple à comprendre, dur à gagner.",
    minPlayers: 2,
    maxPlayers: 2,
    usesChips: true,
    wager: { label: "Mise", min: 10, max: 100, payout: "1,5 × la mise" },
    status: "soon",
    milestone: 1,
    accent: "var(--color-game-connect4)",
  },
  {
    code: "tictactoe",
    name: "Morpion",
    tagline: "Trois cases alignées et la partie est pliée.",
    minPlayers: 2,
    maxPlayers: 2,
    usesChips: true,
    wager: { label: "Mise", min: 10, max: 100, payout: "1,5 × la mise" },
    status: "soon",
    milestone: 1,
    accent: "var(--color-game-tictactoe)",
  },
] as const;

const GAMES_BY_CODE = new Map(GAMES.map((g) => [g.code, g]));

export function getGame(code: string): GameDefinition | undefined {
  return GAMES_BY_CODE.get(code as GameCode);
}

export function isGameCode(value: string): value is GameCode {
  return GAMES_BY_CODE.has(value as GameCode);
}
