import {
  COIN_NAME,
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
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={COIN_NAME}
        className={cn(
          "relative flex h-full w-full max-w-md flex-col overflow-y-auto",
          "animate-rise border-l border-line bg-felt shadow-2xl",
        )}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-felt/95 px-5 py-4 backdrop-blur">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-cream">
            <Coins className="size-5 text-brass" aria-hidden />
            {COIN_NAME}
          </h2>
          <Button ref={closeRef} variant="ghost" onClick={onClose} aria-label="Fermer" className="px-2.5">
            <X className="size-4" aria-hidden />
          </Button>
        </header>

        <div className="space-y-5 px-5 py-5">
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
      </aside>
    </div>
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
  const best = Math.max(...MOTUS_REWARDS);
  const worst = Math.min(...MOTUS_REWARDS);

  return (
    <section className="panel p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-cream">
        <Puzzle className="size-4 text-game-motus" aria-hidden />
        Prochain mot Motus
      </h3>
      <p className="tabular mt-2 text-2xl font-bold text-cream">
        {formatDuration(remaining)}
      </p>
      <p className="mt-1 text-xs text-cream-dim">
        Un mot toutes les 6 h. De {worst} à {best} MC selon le nombre d'essais — bien jouer
        rapporte davantage.
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
