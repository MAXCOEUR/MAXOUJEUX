import {
  POKER_BLIND_MIN,
  POKER_DEFAULT_CONFIG,
  POKER_MAX_SEATS,
  POKER_MIN_SEATS,
  formatCoins,
  isValidStake,
  pokerTableConfigSchema,
  stakeSuggestions,
  winPayout,
  type GameDefinition,
  type PokerTableConfig,
} from "@maxoujeux/shared";
import { useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { StakePicker } from "./StakePicker";

interface NewTableDialogProps {
  open: boolean;
  onClose: () => void;
  game: GameDefinition;
  balance: number;
  onCreate: (stake: number, pokerConfig?: PokerTableConfig) => void;
  loading: boolean;
  error?: string | undefined;
}

export function NewTableDialog({
  open,
  onClose,
  game,
  balance,
  onCreate,
  loading,
  error,
}: NewTableDialogProps) {
  const options = stakeSuggestions(game.code);
  const [stake, setStake] = useState(game.wager.min);
  const [smallBlind, setSmallBlind] = useState(POKER_DEFAULT_CONFIG.smallBlind);
  const [minBuyIn, setMinBuyIn] = useState(POKER_DEFAULT_CONFIG.minBuyIn);
  const [maxBuyIn, setMaxBuyIn] = useState(String(POKER_DEFAULT_CONFIG.maxBuyIn));
  const [seats, setSeats] = useState(POKER_DEFAULT_CONFIG.seats);

  const pokerConfigResult = pokerTableConfigSchema.safeParse({
    smallBlind,
    bigBlind: smallBlind * 2,
    minBuyIn,
    maxBuyIn: maxBuyIn.trim() === "" ? null : Number(maxBuyIn),
    seats,
  });
  const pokerConfig = pokerConfigResult.success ? pokerConfigResult.data : null;
  const pokerAffordable = pokerConfig !== null && pokerConfig.minBuyIn <= balance;

  // Le montant saisi peut être n'importe quoi : on ne calcule le gain que
  // lorsqu'il est valide, sinon `winPayout` lèverait sur une demi-pièce.
  const valide = isValidStake(game.code, stake);
  const payout = valide ? winPayout(game.code, stake) : 0;
  const affordable = valide && stake <= balance;
  /**
   * Jeux de casino : on s'assoit gratuitement, on mise ensuite sur le tapis,
   * manche après manche. Réclamer une mise pour ouvrir la table serait une
   * invention — dans une vraie salle, personne ne paie pour approcher.
   *
   * Le Plinko suit la même règle : la mise se choisit bille par bille, une fois
   * à la table. Demander un montant à l'ouverture laisserait croire qu'il vaut
   * pour toute la session.
   */
  const sansMise =
    game.code === "blackjack" ||
    game.code === "roulette" ||
    game.code === "plinko" ||
    game.code === "slots" ||
    game.code === "poker";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Nouvelle table — ${game.name}`}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button
            onClick={() => onCreate(stake, pokerConfig ?? undefined)}
            loading={loading}
            disabled={game.code === "poker" ? !pokerAffordable : !sansMise && !affordable}
            className="flex-1"
          >
            Ouvrir la table
          </Button>
        </div>
      }
    >
      {!sansMise && <>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-cream-faint">Ta mise</p>
        <StakePicker
          options={options}
          value={stake}
          onChange={setStake}
          min={game.wager.min}
          step={game.wager.step ?? game.wager.min}
          balance={balance}
          disabled={loading}
          className="mt-3"
        />
      </>}

      {game.code === "poker" && (
        <div className="grid grid-cols-2 gap-3" aria-label="Réglages de la table de poker">
          <PokerNumberField
            id="poker-create-small-blind"
            label="Petite blinde"
            value={smallBlind}
            min={POKER_BLIND_MIN}
            step={POKER_BLIND_MIN}
            onChange={setSmallBlind}
          />
          <div className="min-w-0">
            <span className="text-xs text-cream-faint">Grosse blinde</span>
            <div className="tabular mt-1 grid h-11 place-items-center rounded-xl border border-line bg-felt-deep px-3 text-sm text-brass">
              {formatCoins(smallBlind * 2)}
            </div>
          </div>
          <PokerNumberField
            id="poker-create-min-buyin"
            label="Cave minimale"
            value={minBuyIn}
            min={smallBlind * 20}
            step={POKER_BLIND_MIN}
            onChange={setMinBuyIn}
          />
          <div className="min-w-0">
            <label htmlFor="poker-create-max-buyin" className="text-xs text-cream-faint">
              Cave maximale
            </label>
            <input
              id="poker-create-max-buyin"
              type="number"
              inputMode="numeric"
              min={minBuyIn}
              step={POKER_BLIND_MIN}
              value={maxBuyIn}
              placeholder="Illimitée"
              onChange={(event) => setMaxBuyIn(event.target.value)}
              className="tabular mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-felt-deep px-3 text-sm text-cream outline-none placeholder:text-cream-faint focus:border-brass/70"
            />
          </div>
          <PokerNumberField
            id="poker-create-seats"
            label="Nombre de places"
            value={seats}
            min={POKER_MIN_SEATS}
            max={POKER_MAX_SEATS}
            step={1}
            onChange={setSeats}
          />
          <p className="self-end pb-2 text-xs text-cream-faint">
            Laisse la cave maximale vide pour ne fixer aucun plafond.
          </p>
        </div>
      )}

      <div className="mt-5 space-y-1.5 rounded-xl border border-line bg-felt-deep/50 px-4 py-3 text-sm">
        {sansMise ? <>
          {game.code === "blackjack" ? <>
            <p className="text-cream">La table accueille jusqu’à cinq joueurs face au croupier.</p>
            <p className="text-cream-dim">
              Chacun choisit sa mise au début de chaque manche, à partir de{" "}
              {formatCoins(game.wager.min)} et sans plafond.
            </p>
          </> : game.code === "roulette" ? <>
            <p className="text-cream">La table accueille jusqu’à huit joueurs autour du cylindre.</p>
            <p className="text-cream-dim">
              Tu poses les jetons que tu veux sur le tapis, tour après tour, à partir de{" "}
              {formatCoins(game.wager.min)} par case et sans plafond.
            </p>
          </> : game.code === "plinko" ? <>
            <p className="text-cream">La table est à toi, et n’importe qui peut venir la regarder.</p>
            <p className="text-cream-dim">
              Tu choisis ta mise à chaque bille, de {formatCoins(game.wager.min)} à{" "}
              {formatCoins(game.wager.max ?? 500)}, et tu peux les enchaîner.
            </p>
          </> : game.code === "slots" ? <>
            <p className="text-cream">La machine est à toi, et n’importe qui peut venir la regarder.</p>
            <p className="text-cream-dim">
              Tu choisis ta mise à chaque tour, de {formatCoins(game.wager.min)} à{" "}
              {formatCoins(game.wager.max ?? 100)}.
            </p>
          </> : <>
            <p className="text-cream">
              Table de {pokerConfig?.seats ?? seats} places, blindes{" "}
              {formatCoins(smallBlind)} / {formatCoins(smallBlind * 2)}.
            </p>
            <p className="text-cream-dim">
              Tu t’assois en ouvrant, avec une cave de {formatCoins(minBuyIn)}.
              Les autres arrivent en spectateurs et prennent place quand ils veulent.
            </p>
            <p className="text-xs text-cream-faint">
              La cave est débitée à l’ouverture. Tes jetons restants repartent sur ton solde en quittant.
            </p>
          </>}
          {game.code !== "poker" && (
            <p className="text-xs text-cream-faint">Ouvrir ou rejoindre la table ne débite aucun jeton.</p>
          )}
        </> : <>
        <p className="text-cream-dim">
          Les deux joueurs misent{" "}
          <span className="tabular text-brass">{formatCoins(stake)}</span>.
        </p>
        <p className="text-cream">
          Tu remportes <span className="tabular font-semibold text-brass-bright">{formatCoins(payout)}</span>{" "}
          si tu gagnes.
        </p>
        <p className="text-xs text-cream-faint">
          Égalité : chacun récupère sa mise. Abandon ou temps écoulé : la mise est perdue.
        </p>
        </>}
      </div>

      {!sansMise && !affordable && (
        <p role="alert" className="mt-3 text-xs text-danger">
          Il te manque {formatCoins(stake - balance)}.
        </p>
      )}

      {game.code === "poker" && !pokerConfigResult.success && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {pokerConfigResult.error.issues[0]?.message}
        </p>
      )}
      {game.code === "poker" && pokerConfig !== null && !pokerAffordable && (
        <p role="alert" className="mt-3 text-xs text-danger">
          Il te manque {formatCoins(pokerConfig.minBuyIn - balance)} pour la cave.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}

function PokerNumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max?: number | undefined;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-xs text-cream-faint">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="tabular mt-1 h-11 w-full min-w-0 rounded-xl border border-line bg-felt-deep px-3 text-sm text-cream outline-none focus:border-brass/70"
      />
    </div>
  );
}
