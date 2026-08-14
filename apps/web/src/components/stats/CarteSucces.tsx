import {
  ACHIEVEMENT_REWARDS,
  ACHIEVEMENT_TIER_LABELS,
  formatCoins,
  getGame,
  type Achievement,
  type AchievementState,
} from "@maxoujeux/shared";
import { Check, Lock } from "lucide-react";
import { Plaque } from "@/components/Plaque";
import { cn } from "@/lib/cn";

interface CarteSuccesProps {
  achievement: Achievement;
  state: AchievementState | undefined;
}

/**
 * Un succès, débloqué ou non.
 *
 * Les succès verrouillés sont **montrés**, pas cachés : c'est la barre à moitié
 * remplie qui donne envie de jouer une manche de plus, pas la liste de ce qu'on
 * a déjà fait. Un succès à palier unique n'a pas de barre — il n'y a rien à
 * remplir, il tombe ou il ne tombe pas.
 */
export function CarteSucces({ achievement, state }: CarteSuccesProps) {
  const progress = state?.progress ?? 0;
  const debloque = state?.unlockedAt != null;
  const aPaliers = achievement.goal > 1;
  const ratio = Math.min(1, progress / achievement.goal);
  const jeu = achievement.game ? getGame(achievement.game) : undefined;

  return (
    <li
      className={cn(
        "panel-plat flex flex-col gap-2 p-4 transition-colors",
        debloque ? "border-brass/40" : "opacity-75",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full border",
            debloque
              ? "border-brass/60 bg-brass/15 text-brass-bright"
              : "border-line-strong bg-felt-high/50 text-cream-faint",
          )}
        >
          {debloque ? <Check className="size-4" /> : <Lock className="size-3.5" />}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold text-cream">{achievement.name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-cream-dim">
            {achievement.description}
          </p>
        </div>
      </div>

      {aPaliers && !debloque && (
        <div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-felt-high"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={achievement.goal}
            aria-label={`Progression : ${achievement.name}`}
          >
            <div
              className="h-full rounded-full bg-brass/70 transition-[width] duration-500"
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
          <p className="tabular mt-1 text-right text-[11px] text-cream-faint">
            {formatAvancement(progress, achievement)}
          </p>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <Plaque tone={debloque ? "gain" : "neutre"}>
          {ACHIEVEMENT_TIER_LABELS[achievement.tier]}
        </Plaque>
        <Plaque tone={debloque ? "gain" : "neutre"}>
          {formatCoins(ACHIEVEMENT_REWARDS[achievement.tier])}
        </Plaque>
        {jeu && <Plaque>{jeu.name}</Plaque>}
        {debloque && state?.unlockedAt && (
          <span className="tabular ml-auto text-[11px] text-cream-faint">
            {dateCourte(state.unlockedAt)}
          </span>
        )}
      </div>
    </li>
  );
}

/** `47 000 / 100 000 MC` pour un objectif en argent, `47 / 100` sinon. */
function formatAvancement(progress: number, achievement: Achievement): string {
  if (achievement.coins) {
    return `${formatCoins(progress)} / ${formatCoins(achievement.goal)}`;
  }
  return `${progress} / ${achievement.goal}`;
}

/** Date au format JJ/MM/AAAA, la convention du site. */
function dateCourte(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR");
}
