import type { Leaderboard } from "@maxoujeux/shared";
import { Crosshair } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { prefersReducedMotion } from "@/lib/motion";
import { RangLigne } from "./RangLigne";

interface TableauClassementProps {
  board: Leaderboard;
  meId: string;
  /** Message affiché quand personne n'a joué sur la période. */
  vide: string;
}

/**
 * Un classement, et surtout : **le joueur s'y retrouve sans chercher**.
 *
 * Quatre mécanismes, appliqués partout de la même façon :
 *
 * 1. le serveur renvoie toujours le rang réel du demandeur, même au 87e ;
 * 2. sa ligne est reconnaissable au premier coup d'œil, liseré laiton ;
 * 3. hors du haut de tableau, elle est **épinglée sous la liste**, séparée par
 *    des points de suspension qui disent qu'il manque des rangs entre les deux ;
 * 4. lorsqu'elle est dans la liste mais hors écran, un bouton y ramène.
 *
 * Sans cela, un joueur classé 87e sur 143 lirait vingt pseudos qui ne sont pas
 * le sien et conclurait qu'il n'est pas classé.
 */
export function TableauClassement({ board, meId, vide }: TableauClassementProps) {
  const maLigne = useRef<HTMLDivElement>(null);
  const dansLaListe = board.rows.some((row) => row.userId === meId);

  function meRetrouver() {
    maLigne.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  }

  if (board.rows.length === 0 && !board.me) {
    return (
      <EmptyState
        title={vide}
        description="La première manche jouée prend la tête. Il n'y a personne devant."
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="tabular text-xs text-cream-faint">
          {board.total} joueur{board.total > 1 ? "s" : ""} classé
          {board.total > 1 ? "s" : ""}
        </p>
        {dansLaListe && (
          <Button variant="ghost" onClick={meRetrouver} className="text-xs">
            <Crosshair className="size-3.5" aria-hidden />
            Me retrouver
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {board.rows.map((row) => {
          const moi = row.userId === meId;
          return (
            <RangLigne
              key={row.userId}
              ref={moi ? maLigne : undefined}
              row={row}
              metric={board.metric}
              moi={moi}
            />
          );
        })}
      </div>

      {/* Le joueur n'est pas dans le haut de tableau : sa ligne le rejoint quand
          même, précédée d'une coupure qui rend le saut de rangs explicite. */}
      {board.me && !dansLaListe && (
        <div className="sticky bottom-0 -mx-1 mt-1.5 px-1 pb-1 pt-2">
          <p aria-hidden className="mb-1.5 text-center text-lg leading-none text-cream-faint">
            ⋯
          </p>
          <RangLigne
            row={board.me}
            metric={board.metric}
            moi
            className="bg-felt-deep/95 shadow-lg backdrop-blur"
          />
        </div>
      )}

      {/* Classement non vide, mais le joueur n'y figure pas du tout. */}
      {!board.me && (
        <p className="mt-4 text-center text-sm text-cream-dim">
          Tu n'as pas encore joué sur cette période — une manche suffit pour entrer au
          classement.
        </p>
      )}
    </div>
  );
}
