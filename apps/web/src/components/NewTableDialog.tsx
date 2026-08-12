import {
  formatCoins,
  isValidStake,
  stakeSuggestions,
  winPayout,
  type GameDefinition,
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
  onCreate: (stake: number) => void;
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

  // Le montant saisi peut être n'importe quoi : on ne calcule le gain que
  // lorsqu'il est valide, sinon `winPayout` lèverait sur une demi-pièce.
  const valide = isValidStake(game.code, stake);
  const payout = valide ? winPayout(game.code, stake) : 0;
  const affordable = valide && stake <= balance;
  /**
   * Jeux de casino : on s'assoit gratuitement, on mise ensuite sur le tapis,
   * manche après manche. Réclamer une mise pour ouvrir la table serait une
   * invention — dans une vraie salle, personne ne paie pour approcher.
   */
  const sansMise = game.code === "blackjack" || game.code === "roulette";

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
            onClick={() => onCreate(stake)}
            loading={loading}
            disabled={!sansMise && !affordable}
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

      <div className="mt-5 space-y-1.5 rounded-xl border border-line bg-felt-deep/50 px-4 py-3 text-sm">
        {sansMise ? <>
          {game.code === "blackjack" ? <>
            <p className="text-cream">La table accueille jusqu’à cinq joueurs face au croupier.</p>
            <p className="text-cream-dim">
              Chacun choisit sa mise au début de chaque manche, à partir de{" "}
              {formatCoins(game.wager.min)} et sans plafond.
            </p>
          </> : <>
            <p className="text-cream">La table accueille jusqu’à huit joueurs autour du cylindre.</p>
            <p className="text-cream-dim">
              Tu poses les jetons que tu veux sur le tapis, tour après tour, à partir de{" "}
              {formatCoins(game.wager.min)} par case et sans plafond.
            </p>
          </>}
          <p className="text-xs text-cream-faint">Ouvrir ou rejoindre la table ne débite aucun jeton.</p>
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

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
