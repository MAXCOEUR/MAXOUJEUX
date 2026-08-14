import {
  COIN_NAME,
  formatCoins,
  formatCoinsDelta,
  MOTUS_MULTIPLIERS,
  WALLET_REASON_LABELS,
  type WalletEntry,
  type WalletSummary,
} from "@maxoujeux/shared";
import { Coins, Gift, Loader2, Puzzle } from "lucide-react";
import { useState } from "react";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDuration, useCountdown } from "@/lib/countdown";
import { useClaimDailyBonus, useWallet, useWalletHistory } from "@/lib/wallet";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { StreakStrip } from "./StreakStrip";

interface WalletPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Panneau latéral du porte-monnaie.
 *
 * Un panneau plutôt qu'une page : il faudra pouvoir consulter son solde et
 * encaisser son bonus **sans quitter une table de poker en cours**.
 */
export function WalletPanel({ open, onClose }: WalletPanelProps) {
  const wallet = useWallet(open);
  const history = useWalletHistory(open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="lateral"
      label={COIN_NAME}
      title={
        <span className="flex items-center gap-2">
          <Coins className="size-5 text-brass" aria-hidden />
          {COIN_NAME}
        </span>
      }
    >
      <div className="space-y-5">
        {wallet.isPending && (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-cream-faint" aria-label="Chargement" />
          </div>
        )}

        {wallet.isError && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            Impossible de charger ton porte-monnaie.
          </p>
        )}

        {wallet.data && (
          <>
            <BalanceCard balance={wallet.data.balance} />
            <DailyBonusCard summary={wallet.data} />
            <MotusCard nextSlotAt={wallet.data.nextMotusSlotAt} />
          </>
        )}

        <HistorySection entries={history.data?.entries} loading={history.isPending} />

        <p className="pt-2 text-xs leading-relaxed text-cream-faint">
          Les {COIN_NAME} n'ont aucune valeur monétaire. Ils ne peuvent être ni achetés, ni
          convertis, ni transférés entre comptes.
        </p>
      </div>
    </Modal>
  );
}

function BalanceCard({ balance }: { balance: number }) {
  return (
    <div className="panel px-5 py-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-cream-faint">Solde</p>
      <p className="tabular mt-1 text-4xl font-bold text-brass-bright">
        {formatCoins(balance)}
      </p>
    </div>
  );
}

function DailyBonusCard({ summary }: { summary: WalletSummary }) {
  const claim = useClaimDailyBonus();
  const remaining = useCountdown(summary.nextClaimAt);
  const [flash, setFlash] = useState<number | null>(null);

  async function handleClaim() {
    try {
      const result = await claim.mutateAsync();
      setFlash(result.amount);
      window.setTimeout(() => setFlash(null), 1800);
    } catch {
      // L'erreur est déjà portée par `claim.error`, affichée plus bas.
    }
  }

  const error = claim.error instanceof ApiClientError ? claim.error.message : null;

  return (
    <section className="panel relative overflow-hidden p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-cream">
        <Gift className="size-4 text-brass" aria-hidden />
        Bonus quotidien
      </h3>

      {/* Le montant encaissé s'élève brièvement au-dessus du bouton. */}
      {flash !== null && (
        <span
          aria-hidden
          className="animate-rise pointer-events-none absolute right-5 top-4 font-display text-lg font-bold text-win"
        >
          {formatCoinsDelta(flash)}
        </span>
      )}

      <div className="mt-4">
        <StreakStrip streak={summary.streak} currentAmount={summary.claimableAmount} />
      </div>

      {summary.canClaim ? (
        <>
          <Button onClick={handleClaim} loading={claim.isPending} className="mt-4 w-full">
            Encaisser {formatCoins(summary.claimableAmount)}
          </Button>
          <p className="mt-2 text-xs text-cream-faint">
            Demain, si tu reviens : {formatCoins(summary.nextDayAmount)}
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-line bg-felt-deep/50 px-3 py-2.5 text-center">
          <p className="text-sm text-cream">Déjà encaissé aujourd'hui</p>
          <p className="mt-0.5 text-xs text-cream-dim">
            Prochain bonus dans {formatDuration(remaining)} ·{" "}
            {formatCoins(summary.nextDayAmount)}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function MotusCard({ nextSlotAt }: { nextSlotAt: string }) {
  const remaining = useCountdown(nextSlotAt);
  const best = Math.max(...MOTUS_MULTIPLIERS);

  return (
    <section className="panel p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-cream">
        <Puzzle className="size-4 text-game-motus" aria-hidden />
        Prochain mot Motus
      </h3>
      {/* Une taille en dessous depuis que les secondes s'affichent : la chaîne
          gagne cinq caractères et débordait du panneau sur petit écran. */}
      <p className="tabular mt-2 text-xl font-bold text-cream sm:text-2xl">
        {formatDuration(remaining)}
      </p>
      <p className="mt-1 text-xs text-cream-dim">
        Deux mots par jour, à minuit et à midi. Tu choisis ta mise et récupères de 1 × à {best} ×
        selon le nombre d'essais — bien jouer rapporte davantage.
      </p>
      <p className="mt-2 text-xs text-cream-faint">Disponible au lot 2.</p>
    </section>
  );
}

function HistorySection({
  entries,
  loading,
}: {
  entries: WalletEntry[] | undefined;
  loading: boolean;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-cream">Derniers mouvements</h3>

      {loading && <p className="text-xs text-cream-faint">Chargement…</p>}

      {entries && entries.length === 0 && (
        <p className="text-xs text-cream-faint">Aucun mouvement pour l'instant.</p>
      )}

      {entries && entries.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-cream">
                  {WALLET_REASON_LABELS[entry.reason] ?? entry.reason}
                </p>
                <p className="text-xs text-cream-faint">
                  {new Date(entry.createdAt).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <span
                className={cn(
                  "tabular shrink-0 text-sm font-semibold",
                  entry.delta < 0 ? "text-danger" : "text-win",
                )}
              >
                {formatCoinsDelta(entry.delta)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
