import {
  formatCoins,
  stakeOptions,
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
  const options = stakeOptions(game.code);
  const [stake, setStake] = useState(options[0] ?? game.wager.min);

  const payout = winPayout(game.code, stake);
  const affordable = stake <= balance;

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
            disabled={!affordable}
            className="flex-1"
          >
            Ouvrir la table
          </Button>
        </div>
      }
    >
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-cream-faint">
        Ta mise
      </p>

      <StakePicker
        options={options}
        value={stake}
        onChange={setStake}
        balance={balance}
        disabled={loading}
        className="mt-3"
      />

      <div className="mt-5 space-y-1.5 rounded-xl border border-line bg-felt-deep/50 px-4 py-3 text-sm">
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
      </div>

      {!affordable && (
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
