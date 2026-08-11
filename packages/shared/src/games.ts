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

export interface GameDefinition {
  code: GameCode;
  name: string;
  tagline: string;
  /** Nombre de joueurs supporté par une table. */
  minPlayers: number;
  maxPlayers: number;
  /** Le jeu consomme-t-il des jetons virtuels ? */
  usesChips: boolean;
  status: GameStatus;
  /** Lot du plan de développement qui livre ce jeu. */
  milestone: number;
  /** Couleur d'accent de la vignette dans le lobby (variable CSS du thème). */
  accent: string;
}

export const GAMES: readonly GameDefinition[] = [
  {
    code: "connect4",
    name: "Puissance 4",
    tagline: "Aligne quatre jetons avant ton adversaire.",
    minPlayers: 2,
    maxPlayers: 2,
    usesChips: false,
    status: "soon",
    milestone: 1,
    accent: "var(--accent-cyan)",
  },
  {
    code: "tictactoe",
    name: "Morpion",
    tagline: "Trois cases alignées, la partie est pliée.",
    minPlayers: 2,
    maxPlayers: 2,
    usesChips: false,
    status: "soon",
    milestone: 1,
    accent: "var(--accent-violet)",
  },
  {
    code: "motus",
    name: "Motus",
    tagline: "Le mot du jour en six essais, seul ou en duel.",
    minPlayers: 1,
    maxPlayers: 4,
    usesChips: false,
    status: "soon",
    milestone: 2,
    accent: "var(--accent-amber)",
  },
  {
    code: "blackjack",
    name: "Blackjack",
    tagline: "Approche 21 sans le dépasser. Le croupier ne pardonne pas.",
    minPlayers: 1,
    maxPlayers: 5,
    usesChips: true,
    status: "soon",
    milestone: 3,
    accent: "var(--accent-emerald)",
  },
  {
    code: "poker",
    name: "Texas Hold'em",
    tagline: "Deux cartes, cinq communes, tout le reste est du bluff.",
    minPlayers: 2,
    maxPlayers: 9,
    usesChips: true,
    status: "soon",
    milestone: 4,
    accent: "var(--accent-rose)",
  },
] as const;

const GAMES_BY_CODE = new Map(GAMES.map((g) => [g.code, g]));

export function getGame(code: string): GameDefinition | undefined {
  return GAMES_BY_CODE.get(code as GameCode);
}

export function isGameCode(value: string): value is GameCode {
  return GAMES_BY_CODE.has(value as GameCode);
}
