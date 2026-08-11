import {
  COIN_NAME,
  DAILY_BONUS_CAP_STREAK,
  formatCoins,
  formatCoinsDelta,
  MOTUS_REWARDS,
  WALLET_REASON_LABELS,
  type WalletEntry,
  type WalletSummary,
} from "@maxoujeux/shared";
import { Coins, Gift, Loader2, Puzzle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDuration, useCountdown } from "@/lib/countdown";
import { useClaimDailyBonus, useWallet, useWalletHistory } from "@/lib/wallet";
import { Button } from "./Button";

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
  const closeRef = useRef<HTMLButtonElement>(null);

  // Échappement et focus initial : le panneau doit se fermer au clavier, et le
  // focus ne doit pas rester derrière lui sur la page.
  useEffect(() => {
    if (!open) return;

    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Fond cliquable pour fermer. `aria-hidden` : le bouton de fermeture
          dédié suffit aux technologies d'assistance. */}
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-night/70 backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={COIN_NAME}
        className={cn(
          "relative flex h-full w-full max-w-md flex-col overflow-y-auto",
          "border-l border-line bg-surface shadow-2xl animate-rise",
        )}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Coins className="size-5 text-gold" aria-hidden />
            {COIN_NAME}
          </h2>
          <Button ref={closeRef} variant="ghost" onClick={onClose} aria-label="Fermer" className="px-2.5">
            <X className="size-4" aria-hidden />
          </Button>
        </header>

        <div className="space-y-5 px-5 py-5">
          {wallet.isPending && (
            <div className="grid place-items-center py-10">
              <Loader2 className="size-5 animate-spin text-ink-faint" aria-label="Chargement" />
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

          <p className="pt-2 text-xs text-ink-faint">
            Les {COIN_NAME} n'ont aucune valeur monétaire. Ils ne peuvent être ni achetés, ni
            convertis, ni transférés entre comptes.
          </p>
        </div>
      </aside>
    </div>
  );
}

function BalanceCard({ balance }: { balance: number }) {
  return (
    <div className="card-surface px-5 py-6 text-center">
      <p className="text-xs uppercase tracking-wide text-ink-faint">Solde</p>
      <p className="mt-1 font-display text-4xl font-bold text-gold tabular-nums">
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
    <section className="card-surface relative overflow-hidden p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Gift className="size-4 text-accent-violet" aria-hidden />
        Bonus quotidien
      </h3>

      {/* Le montant encaissé s'élève brièvement au-dessus du bouton. */}
      {flash !== null && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-5 top-4 font-display text-lg font-bold text-success animate-rise"
        >
          {formatCoinsDelta(flash)}
        </span>
      )}

      <StreakPips streak={summary.streak} />

      {summary.canClaim ? (
        <>
          <Button onClick={handleClaim} loading={claim.isPending} className="mt-4 w-full">
            Encaisser {formatCoins(summary.claimableAmount)}
          </Button>
          <p className="mt-2 text-xs text-ink-faint">
            Demain, si tu reviens : {formatCoins(summary.nextDayAmount)}
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-center">
          <p className="text-sm text-ink">Déjà encaissé aujourd'hui</p>
          <p className="mt-0.5 text-xs text-ink-muted">
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

/**
 * Progression de la série jusqu'au plafond. Onze pastilles : c'est au 11e jour
 * consécutif que le bonus atteint son maximum.
 */
function StreakPips({ streak }: { streak: number }) {
  const total = DAILY_BONUS_CAP_STREAK;
  const filled = Math.min(streak, total);

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5" role="img" aria-label={`Série de ${streak} jours`}>
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < filled ? "bg-accent-violet" : "bg-surface-3",
            )}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {streak === 0
          ? "Aucune série en cours"
          : `Série de ${streak} jour${streak > 1 ? "s" : ""}${filled >= total ? " · plafond atteint" : ""}`}
      </p>
    </div>
  );
}

function MotusCard({ nextSlotAt }: { nextSlotAt: string }) {
  const remaining = useCountdown(nextSlotAt);
  const best = Math.max(...MOTUS_REWARDS);
  const worst = Math.min(...MOTUS_REWARDS);

  return (
    <section className="card-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Puzzle className="size-4 text-accent-amber" aria-hidden />
        Prochain mot Motus
      </h3>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-ink">
        {formatDuration(remaining)}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Un mot toutes les 6 h. De {worst} à {best} MC selon le nombre d'essais — bien jouer
        rapporte davantage.
      </p>
      <p className="mt-2 text-xs text-ink-faint">Disponible au lot 2.</p>
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
      <h3 className="mb-2 text-sm font-semibold text-ink">Derniers mouvements</h3>

      {loading && <p className="text-xs text-ink-faint">Chargement…</p>}

      {entries && entries.length === 0 && (
        <p className="text-xs text-ink-faint">Aucun mouvement pour l'instant.</p>
      )}

      {entries && entries.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {WALLET_REASON_LABELS[entry.reason] ?? entry.reason}
                </p>
                <p className="text-xs text-ink-faint">
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
                  "shrink-0 font-display text-sm font-semibold tabular-nums",
                  entry.delta < 0 ? "text-danger" : "text-success",
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
