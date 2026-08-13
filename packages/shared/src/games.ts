/**
 * Catalogue des jeux. Source de vérité unique : le lobby du front l'affiche,
 * l'API valide les codes de jeu contre cette liste.
 *
 * `status` pilote l'affichage : seuls les jeux "live" sont jouables,
 * les autres apparaissent grisés dans le lobby avec leur lot de livraison.
 */

export const GAME_CODES = [
  "connect4",
  "tictactoe",
  "motus",
  "blackjack",
  "roulette",
  "wheel",
  "plinko",
  "slots",
  "poker",
] as const;

export type GameCode = (typeof GAME_CODES)[number];

export type GameStatus = "live" | "soon";

export interface GameWager {
  /** Libellé affiché dans le lobby : une cave pour le poker, une mise ailleurs. */
  label: "Cave" | "Mise";
  /** Mise minimale, en MaxouCoin. */
  min: number;
  /**
   * Mise maximale, en MaxouCoin.
   *
   * Absente sur les jeux dont le gain reste proche de la mise : le seul plafond
   * y est ce que le joueur possède. Elle devient en revanche indispensable dès
   * qu'un barème comporte un gros multiplicateur — un ×20 sur une mise libre
   * suffirait à dérégler l'économie en un lancer.
   */
  max?: number;
  /**
   * Pas entre deux mises autorisées, en MaxouCoin.
   *
   * Ce n'est pas un plafond : il garantit que les barèmes en 1,5 × ou en 3:2
   * tombent toujours sur un nombre entier de MaxouCoin.
   */
  step?: number;
  /**
   * Multiplicateur appliqué à la mise du vainqueur, mise comprise.
   *
   * Doublonne volontairement `payout`, qui est une phrase destinée à l'œil :
   * ici c'est la valeur avec laquelle le serveur calcule réellement le
   * versement. Absent pour les jeux dont le gain découle des règles (poker,
   * blackjack) ou d'un barème (Motus).
   */
  winMultiplier?: number;
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
  /** Mise obligatoire, bornée par le bas seulement. */
  wager: GameWager;
  /**
   * Nombre de parties simultanées autorisées sur le serveur.
   *
   * Plafond volontaire : le NAS n'a pas à encaisser un afflux de joueurs, et
   * une partie en cours ne doit jamais être dégradée par une nouvelle. Le
   * chiffre vit ici et non dans le serveur pour que le front puisse afficher
   * « 3 / 10 » sans dupliquer la valeur.
   */
  maxTables: number;
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
   *
   * **Plus personne ne le porte** depuis que le catalogue compte neuf jeux : la
   * vedette n'existait que pour combler la grille à trois colonnes, qui tombe
   * désormais juste. La remettre laisserait deux cellules vides en fin de
   * grille. Un seul jeu à la fois peut la porter.
   */
  featured?: boolean;
}

export const GAMES: readonly GameDefinition[] = [
  {
    code: "wheel",
    name: "Roue de la fortune",
    tagline: "Un lancer par jour, neuf cases, et l'envie de revenir demain.",
    minPlayers: 1,
    maxPlayers: 1,
    usesChips: true,
    // Plafond volontaire : le ×20 est rare, mais sur une mise libre il suffirait
    // d'un lancer heureux pour multiplier la masse de MaxouCoin en circulation.
    wager: { label: "Mise", min: 10, max: 1_000, step: 10, payout: "×0 à ×20" },
    maxTables: 10,
    status: "live",
    milestone: 4,
    accent: "var(--color-game-wheel)",
  },
  {
    code: "blackjack",
    name: "Blackjack",
    tagline: "Approcher 21 sans le dépasser. Le croupier ne pardonne pas.",
    minPlayers: 1,
    maxPlayers: 5,
    usesChips: true,
    wager: { label: "Mise", min: 10, step: 10, payout: "Blackjack 3:2" },
    maxTables: 1,
    status: "live",
    milestone: 3,
    accent: "var(--color-game-blackjack)",
  },
  {
    code: "roulette",
    name: "Roulette",
    tagline: "Trente-sept cases, une bille. Faites vos jeux.",
    minPlayers: 1,
    maxPlayers: 8,
    usesChips: true,
    wager: { label: "Mise", min: 10, step: 10, payout: "Plein 35:1" },
    maxTables: 1,
    status: "live",
    milestone: 3,
    accent: "var(--color-game-roulette)",
  },
  {
    code: "motus",
    name: "Motus",
    tagline: "Seul face au mot : six essais, et chaque ligne compte.",
    minPlayers: 1,
    maxPlayers: 1,
    usesChips: true,
    wager: { label: "Mise", min: 10, step: 10, payout: "1 × à 6 × la mise" },
    maxTables: 10,
    status: "live",
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
    wager: { label: "Mise", min: 10, step: 10, winMultiplier: 1.5, payout: "1,5 × la mise" },
    maxTables: 10,
    status: "live",
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
    wager: { label: "Mise", min: 10, step: 10, winMultiplier: 1.5, payout: "1,5 × la mise" },
    maxTables: 10,
    status: "live",
    milestone: 1,
    accent: "var(--color-game-tictactoe)",
  },
  {
    code: "plinko",
    name: "Plinko",
    tagline: "Une bille, douze rangées de picots, et treize façons d'atterrir.",
    minPlayers: 1,
    maxPlayers: 1,
    usesChips: true,
    wager: { label: "Mise", min: 10, max: 500, step: 10, payout: "×0,2 à ×25 selon le risque" },
    maxTables: 10,
    status: "live",
    milestone: 5,
    accent: "var(--color-game-plinko)",
  },
  {
    code: "slots",
    name: "Machine à sous",
    tagline: "Trois rouleaux, six symboles. Le MAXOU triple ne se voit qu'une fois.",
    minPlayers: 1,
    maxPlayers: 1,
    usesChips: true,
    wager: { label: "Mise", min: 10, max: 100, step: 10, payout: "jusqu'à ×150" },
    maxTables: 10,
    status: "soon",
    milestone: 6,
    accent: "var(--color-game-slots)",
  },
  {
    code: "poker",
    name: "Texas Hold'em",
    tagline: "Deux cartes en main, cinq sur la table. Le reste est du bluff.",
    minPlayers: 2,
    maxPlayers: 9,
    usesChips: true,
    wager: { label: "Cave", min: 500 },
    maxTables: 1,
    status: "soon",
    milestone: 7,
    accent: "var(--color-game-poker)",
  },
] as const;

const GAMES_BY_CODE = new Map(GAMES.map((g) => [g.code, g]));

export function getGame(code: string): GameDefinition | undefined {
  return GAMES_BY_CODE.get(code as GameCode);
}

export function isGameCode(value: string): value is GameCode {
  return GAMES_BY_CODE.has(value as GameCode);
}
