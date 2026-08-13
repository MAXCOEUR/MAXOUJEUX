import {
  SLOTS_REELS,
  SLOT_SYMBOLS,
  formatCoins,
  slotsReelStopAt,
  type SlotsSpinResult,
} from "@maxoujeux/shared";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { serverNow } from "@/lib/clock";
import { useReducedMotion } from "@/lib/motion";
import { SlotSymbolGlyph } from "./SlotSymbolGlyph";

/**
 * La machine à sous — la caisse entière, pas seulement ses rouleaux.
 *
 * Une machine à sous est un **objet**, pas trois cases alignées : elle a un
 * fronton qui s'allume, un cadre de laiton, une fenêtre vitrée, un bac de
 * paiement et un levier sur le flanc. C'est ce qui distingue un casino d'un
 * tableau de résultats, et c'est le seul endroit de l'écran où l'on s'autorise
 * de la matière.
 *
 * Les symboles sont **tirés par le serveur** et arrivent avec le tirage : la
 * machine ne fait que les révéler. Chaque rouleau s'arrête à son heure — 1 200,
 * 1 800 puis 2 400 ms — et ce décalage est tout le suspense du jeu : deux MAXOU
 * alignés et le troisième qui tourne encore.
 *
 * La position se calcule depuis `spunAt` et l'horloge serveur, jamais d'un
 * minuteur local : un spectateur qui ouvre la page en cours de rotation voit
 * donc l'animation au bon endroit.
 */

/** Cadence de défilement d'un rouleau en rotation. */
const FLICKER_MS = 70;

interface SlotMachineProps {
  /** Tirage en cours, ou `null` quand la machine est au repos. */
  spinning: SlotsSpinResult | null;
  /** Dernier tirage terminé : ce que la machine affiche entre deux coups. */
  resting: SlotsSpinResult | null;
  /** Mise engagée au prochain tour, affichée sur le fronton. */
  stake: number;
  /** Tirer. Absent pour un spectateur : le levier devient alors décoratif. */
  onPull?: (() => void) | undefined;
  /** Le levier est-il actionnable ? Faux si la mise dépasse le solde. */
  canPull?: boolean;
  className?: string;
}

export function SlotMachine({
  spinning,
  resting,
  stake,
  onPull,
  canPull = false,
  className,
}: SlotMachineProps) {
  const reduced = useReducedMotion();
  const now = useAnimationClock(spinning !== null && !reduced);

  const affiche = spinning ?? resting;
  const debut = spinning ? new Date(spinning.spunAt).getTime() : 0;

  // Un tirage n'est « révélé » que lorsque son dernier rouleau s'est arrêté :
  // c'est à ce moment, et pas avant, que la ligne peut s'allumer.
  const revele = spinning ? now - debut >= slotsReelStopAt(SLOTS_REELS - 1) : resting !== null;
  const gagnant = revele && (affiche?.kind ?? "none") !== "none";
  const actionnable = Boolean(onPull) && canPull && spinning === null;

  return (
    <div className={cn("relative select-none", className)}>
      {/* Le levier déborde à droite : la caisse lui réserve sa marge. */}
      <div className="flex items-stretch justify-center gap-0">
        <div className="min-w-0 flex-1">
          {/* --- Fronton ------------------------------------------------- */}
          <div
            className={cn(
              "relative rounded-t-2xl border-2 border-b-0 px-4 py-2 text-center transition-colors duration-500",
              gagnant
                ? "border-brass bg-linear-to-b from-brass/30 to-transparent"
                : "border-brass-deep bg-linear-to-b from-brass-deep/25 to-transparent",
            )}
          >
            {/* Trois ampoules de fronton, comme sur les caisses de foire. */}
            <span aria-hidden className="absolute inset-x-4 top-2 flex justify-between">
              {[0, 1, 2].map((lampe) => (
                <span
                  key={lampe}
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-300",
                    gagnant ? "bg-brass-bright" : "bg-brass-deep/70",
                  )}
                  style={gagnant ? { animation: "var(--animate-pulse-soft)", animationDelay: `${lampe * 160}ms` } : undefined}
                />
              ))}
            </span>
            <p className="font-display text-sm font-black tracking-[0.18em] text-brass-bright">
              MAXOU
            </p>
            <p className="tabular text-[0.7rem] text-cream-faint">{formatCoins(stake)} le tour</p>
          </div>

          {/* --- Caisse -------------------------------------------------- */}
          <div
            className={cn(
              "rounded-2xl rounded-t-none border-2 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_18px_40px_-24px_rgb(0_0_0/0.9)] transition-colors duration-500 sm:p-4",
              gagnant ? "border-brass bg-felt-raised" : "border-brass-deep bg-felt",
            )}
          >
            {/* Vitre : le reflet oblique donne le verre sans image ni filtre. */}
            <div className="relative overflow-hidden rounded-xl border border-line bg-felt-deep p-2 sm:p-3">
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-y-8 -left-1/3 w-1/2 -rotate-12 bg-linear-to-r from-transparent via-cream/[0.055] to-transparent"
              />

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {Array.from({ length: SLOTS_REELS }, (_, reel) => {
                  const arret = slotsReelStopAt(reel);
                  const tourne = spinning !== null && !reduced && now - debut < arret;
                  // Sans tirage encore joue, on montre trois symboles
                  // **differents** : trois cerises alignees se liraient comme un
                  // gain que personne n'a obtenu.
                  const symbole = tourne
                    ? symboleDeDefilement(reel, now)
                    : (affiche?.reels[reel] ?? reel + 1);
                  // Seuls les rouleaux du symbole payant sont mis en avant :
                  // sur une paire, le troisième reste en retrait.
                  const paye =
                    revele && affiche?.symbol !== null && affiche?.reels[reel] === affiche?.symbol;

                  return (
                    <div
                      key={reel}
                      className={cn(
                        "relative aspect-square overflow-hidden rounded-lg border transition-colors duration-300",
                        // Le rouleau est un cylindre : plus sombre en haut et
                        // en bas qu'en son milieu.
                        "bg-linear-to-b from-felt-deep via-felt to-felt-deep",
                        paye ? "border-brass" : "border-line",
                      )}
                    >
                      <div
                        className={cn(
                          "grid h-full w-full place-items-center p-2 transition-transform sm:p-3",
                          tourne && "blur-[2px] brightness-90",
                          paye && "scale-105",
                        )}
                      >
                        <SlotSymbolGlyph index={symbole} />
                      </div>

                      {/* Ombres de cylindre, en haut et en bas du rouleau. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 h-1/4 bg-linear-to-b from-felt-deep/90 to-transparent"
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-linear-to-t from-felt-deep/90 to-transparent"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Ligne de gain : elle traverse les trois rouleaux d'un trait. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-x-2 top-1/2 h-px -translate-y-1/2 transition-all duration-300 sm:inset-x-3",
                  gagnant ? "bg-brass opacity-80 shadow-[0_0_8px_var(--color-brass)]" : "bg-cream opacity-[0.07]",
                )}
              />
            </div>

            {/* --- Bac de paiement ------------------------------------- */}
            <div className="mt-3 rounded-lg border border-line bg-felt-deep/70 px-3 py-2">
              <p
                aria-live="polite"
                className={cn(
                  "text-center font-display text-sm font-bold tabular transition-colors",
                  gagnant ? "text-brass-bright" : "text-cream-faint",
                )}
              >
                {gagnant && affiche
                  ? `+ ${formatCoins(affiche.payout)}`
                  : spinning
                    ? "…"
                    : resting
                      ? "Rien cette fois"
                      : "Tire les rouleaux"}
              </p>
            </div>
          </div>
        </div>

        <Levier actionnable={actionnable} tourne={spinning !== null} onPull={onPull} />
      </div>
    </div>
  );
}

/**
 * Le levier.
 *
 * C'est un **vrai bouton** et non un décor : on tire une machine à sous par son
 * levier, pas par un bouton posé à côté. Il porte donc son propre libellé
 * accessible, son état désactivé et une cible large — le manche seul serait
 * impossible à viser au doigt.
 *
 * Le bras est **un seul élément** qui pivote autour de son point de fixation :
 * manche et pommeau sont solidaires, comme sur une vraie machine. Les animer
 * séparément les faisait partir chacun de leur côté.
 *
 * Au repos le bras pointe vers le haut ; tiré, il bascule vers le bas. Il n'est
 * affiché qu'à partir de `sm` : sur un téléphone, sa course déborderait de
 * l'écran, et le bouton du panneau fait déjà le même travail.
 */
function Levier({
  actionnable,
  tourne,
  onPull,
}: {
  actionnable: boolean;
  tourne: boolean;
  onPull?: (() => void) | undefined;
}) {
  const bras = (
    <>
      {/* Platine de fixation, au milieu du flanc de la caisse. */}
      <span
        aria-hidden
        className="absolute bottom-[38%] left-1/2 size-5 -translate-x-1/2 translate-y-1/2 rounded-full border border-brass-deep bg-felt-raised"
      />

      {/* Le bras : pommeau et manche d'un seul tenant, pivot en bas. */}
      <span
        aria-hidden
        className={cn(
          "absolute bottom-[38%] left-1/2 flex origin-bottom -translate-x-1/2 flex-col items-center",
          "transition-transform duration-300 ease-out",
          tourne ? "rotate-[52deg]" : "rotate-0",
          // Le survol amorce le geste, l'appui le termine : le levier répond
          // avant même que le serveur ait répondu.
          actionnable && "group-hover:rotate-[10deg] group-active:rotate-[52deg]",
        )}
      >
        <span
          className={cn(
            "size-6 rounded-full bg-linear-to-br from-[#d8574f] to-[#8f2a20]",
            "ring-2 ring-brass-deep",
            "shadow-[inset_0_2px_3px_rgb(255_255_255/0.4),0_5px_10px_-3px_rgb(0_0_0/0.8)]",
          )}
        />
        <span className="h-12 w-1.5 rounded-b-full bg-linear-to-b from-brass-bright via-brass to-brass-deep" />
      </span>

      {/* Axe, posé par-dessus le bras : c'est lui qui le tient. */}
      <span
        aria-hidden
        className="absolute bottom-[38%] left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-brass-deep ring-1 ring-felt-deep"
      />
    </>
  );

  if (!onPull) {
    // Spectateur : le levier reste, en décor. Il n'a alors rien à annoncer aux
    // technologies d'assistance.
    return (
      <div aria-hidden className="relative hidden w-12 shrink-0 opacity-50 sm:block">
        {bras}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPull}
      disabled={!actionnable}
      aria-label={tourne ? "Les rouleaux tournent" : "Tirer le levier"}
      className={cn(
        "group relative hidden w-12 shrink-0 cursor-pointer rounded-2xl transition-opacity sm:block",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
        !actionnable && "cursor-not-allowed opacity-45",
      )}
    >
      {bras}
    </button>
  );
}

/**
 * Symbole affiché par un rouleau qui tourne encore.
 *
 * Le défilement est **décoratif** : il n'a aucune incidence sur le résultat,
 * déjà décidé. Il dépend du temps et du numéro de rouleau pour que les trois ne
 * changent pas de symbole en même temps, ce qui les ferait paraître liés.
 */
function symboleDeDefilement(reel: number, now: number): number {
  const pas = Math.floor(now / FLICKER_MS) + reel * 2;
  return pas % SLOT_SYMBOLS.length;
}

/**
 * Horloge d'animation.
 *
 * Une boucle `requestAnimationFrame` pendant la rotation, rien du tout ensuite :
 * une machine au repos ne doit pas réveiller le processeur soixante fois par
 * seconde, surtout sur un téléphone.
 */
function useAnimationClock(running: boolean): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      setNow(serverNow());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  return now;
}
