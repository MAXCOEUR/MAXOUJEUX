import { DAILY_BONUS, DAILY_BONUS_CAP_STREAK, dailyBonusAmount, formatCoins } from "@maxoujeux/shared";
import { cn } from "@/lib/cn";

/**
 * Progression de la série du bonus quotidien.
 *
 * Les jours sont numérotés et le montant est écrit : la version précédente
 * n'affichait que onze pastilles grises, qu'on lisait comme un squelette de
 * chargement plutôt que comme une progression.
 */
export function StreakStrip({
  streak,
  currentAmount = dailyBonusAmount(streak),
  compact = false,
}: {
  streak: number;
  currentAmount?: number;
  compact?: boolean;
}) {
  const total = DAILY_BONUS_CAP_STREAK;
  const done = Math.min(Math.max(streak, 0), total);
  const atCap = done >= total;

  return (
    <div>
      <div
        className="flex items-center gap-1"
        role="img"
        aria-label={`Série de ${streak} jour${streak > 1 ? "s" : ""} sur ${total}`}
      >
        {Array.from({ length: total }, (_, index) => {
          const day = index + 1;
          const reached = day <= done;
          const isNext = day === done + 1;
          return (
            <span
              key={day}
              className={cn(
                "grid flex-1 place-items-center rounded-md border text-[10px] font-semibold tabular-nums transition-colors",
                compact ? "h-4" : "h-6",
                reached && "border-brass bg-brass text-felt-deep",
                // Le jour suivant est cerclé, pas rempli : il indique où l'on va.
                isNext && "border-brass/70 bg-brass/10 text-brass",
                !reached && !isNext && "border-line bg-felt-deep/50 text-cream-faint",
              )}
            >
              {compact ? "" : day}
            </span>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-cream-dim">
        {streak === 0 ? (
          <>Aucune série. Le premier jour verse {formatCoins(DAILY_BONUS.base)}.</>
        ) : atCap ? (
          <>
            Série de {streak} jours — plafond atteint, {formatCoins(DAILY_BONUS.cap)} par jour.
          </>
        ) : (
          <>
            Série de {streak} jour{streak > 1 ? "s" : ""} — {formatCoins(DAILY_BONUS.cap)} par jour
            à partir du {total}
            <sup>e</sup>, contre {formatCoins(currentAmount)} aujourd'hui.
          </>
        )}
      </p>
    </div>
  );
}
