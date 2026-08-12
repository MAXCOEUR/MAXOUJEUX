import {
  formatCoins,
  getGame,
  isGameCode,
  type CurrentUser,
  type DuelGame,
  type GameCode,
  type GameDefinition,
  type TableSummary,
} from "@maxoujeux/shared";
import { ArrowLeft, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { GameArtefact } from "@/components/GameArtefact";
import { Lien } from "@/components/Lien";
import { NewTableDialog } from "@/components/NewTableDialog";
import { Plaque } from "@/components/Plaque";
import { TableCard } from "@/components/TableCard";
import { cn } from "@/lib/cn";
import { useGame } from "@/lib/game";
import { useBlackjack } from "@/lib/blackjack";
import { useRoulette } from "@/lib/roulette";
import { navigate } from "@/lib/route";
import { request, useRealtime, watchSalon } from "@/lib/socket";
import { useTables } from "@/lib/tables";

/**
 * Salon d'un jeu : la liste de ses tables.
 *
 * Un écran par jeu plutôt qu'une liste unique sur le lobby : le lobby reste la
 * vitrine des cinq jeux, et cette page tiendra encore quand le Motus, le
 * blackjack et le poker viendront s'ajouter avec leurs propres règles de table.
 */
export function SalonPage({ user, game }: { user: CurrentUser; game: GameCode }) {
  const definition = isGameCode(game) ? getGame(game) : undefined;

  // Garde séparé du contenu : le corps du salon a besoin d'un jeu **ouvert**, et
  // le passer en propriété évite d'avoir à le revérifier dans chaque fonction.
  if (!definition || definition.status !== "live") {
    return (
      <EmptyState
        title="Ce jeu n'est pas encore ouvert"
        description="Il arrive dans une prochaine livraison."
        action={
          <Lien to={{ name: "lobby" }}>
            <Button variant="outline">Retour au lobby</Button>
          </Lien>
        }
      />
    );
  }

  return <SalonContent user={user} definition={definition} />;
}

function SalonContent({
  user,
  definition,
}: {
  user: CurrentUser;
  definition: GameDefinition;
}) {
  const game = definition.code;
  const salon = useTables((state) => state.salons[game]);
  const match = useGame((state) => state.match);
  const blackjack = useBlackjack((state) => state.view);
  const roulette = useRoulette((state) => state.view);
  const status = useRealtime((state) => state.status);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinErrors, setJoinErrors] = useState<Record<string, string>>({});

  // Abonnement au salon. Le comptage de références du store rend l'opération
  // sûre en `StrictMode`, où React monte, démonte puis remonte les effets.
  useEffect(() => watchSalon(game), [game]);

  const tables = salon?.tables ?? [];
  const used = salon?.used ?? 0;
  const max = salon?.max ?? definition.maxTables;
  const plein = used >= max;
  // Une partie en cours interdit d'en ouvrir une seconde : le serveur le refuse
  // de toute façon, autant ne pas proposer le geste.
  const busy = (match !== null && match.status !== "finished") || blackjack !== null || roulette !== null;
  const attente = tables.filter((table) => table.status === "waiting");
  const enCours = tables.filter((table) => table.status === "playing");

  async function creerTable(stake: number) {
    setCreating(true);
    setCreateError(undefined);

    // Les tables de casino s'ouvrent sans mise : elle se pose sur le tapis.
    const reply = await request<{ tableId: string }>((socket, ack) =>
      game === "blackjack"
        ? socket.emit("tables:create", { game: "blackjack" }, ack)
        : game === "roulette"
          ? socket.emit("tables:create", { game: "roulette" }, ack)
          : socket.emit("tables:create", { game: game as DuelGame, stake }, ack),
    );

    setCreating(false);
    if (!reply.ok) {
      setCreateError(reply.message);
      return;
    }

    setDialogOpen(false);
    navigate({ name: "table", tableId: reply.data.tableId });
  }

  async function rejoindre(table: TableSummary) {
    setJoiningId(table.id);
    setJoinErrors((previous) => ({ ...previous, [table.id]: "" }));

    const reply = await request<{ tableId: string }>((socket, ack) =>
      socket.emit("tables:join", { tableId: table.id }, ack),
    );

    setJoiningId(null);
    if (!reply.ok) {
      setJoinErrors((previous) => ({ ...previous, [table.id]: reply.message }));
      return;
    }
    navigate({ name: "table", tableId: reply.data.tableId });
  }

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <Lien
        to={{ name: "lobby" }}
        className="inline-flex items-center gap-1.5 text-sm text-cream-dim transition-colors hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Le lobby
      </Lien>

      <section className="panel flex items-center gap-4 p-4 sm:gap-6 sm:p-6">
        <div aria-hidden className="w-14 shrink-0 sm:w-20">
          <GameArtefact code={definition.code} />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-extrabold text-cream sm:text-2xl">
            {definition.name}
          </h1>
          <p className="mt-1 text-sm text-cream-dim">{definition.tagline}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="tabular text-brass">
              {formatCoins(definition.wager.min)} – {formatCoins(definition.wager.max)}
            </span>
            <span className="text-cream-faint">·</span>
            <span className="text-cream-dim">{definition.wager.payout}</span>
            <Plaque tone={plein ? "danger" : "neutre"} className="ml-auto">
              {used} / {max} tables
            </Plaque>
          </div>
        </div>

        {/* Sur grand écran, l'action reste en haut à droite, là où l'œil la
            cherche à côté du titre. Sur téléphone elle passe sous le pouce. */}
        <div className="hidden shrink-0 sm:block">
          <Button onClick={() => setDialogOpen(true)} disabled={plein || busy}>
            <Plus className="size-4" aria-hidden />
            Nouvelle table
          </Button>
        </div>
      </section>

      {plein && (
        <p role="alert" className="text-sm text-danger">
          Les {max} tables de {definition.name} sont prises. Rejoins-en une, ou reviens dans un
          instant.
        </p>
      )}

      <section aria-labelledby="tables-heading">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 id="tables-heading" className="font-display text-lg font-bold text-cream">
            Tables ouvertes
          </h2>
          <span className="tabular text-xs text-cream-faint">{attente.length} en attente</span>
        </div>

        {status !== "connected" && tables.length === 0 ? (
          <p className="text-sm text-cream-faint">Connexion au serveur…</p>
        ) : attente.length === 0 ? (
          <EmptyState
            artefact={definition.code}
            title="Aucune table ouverte"
            description={
              <>
                Sois le premier à en ouvrir une : le prochain joueur qui arrive te rejoindra, et la
                partie démarrera aussitôt.
              </>
            }
            action={
              <Button onClick={() => setDialogOpen(true)} disabled={plein || busy}>
                <Plus className="size-4" aria-hidden />
                Ouvrir une table
              </Button>
            }
            hint={<PresenceHint />}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {attente.map((table, index) => (
              <TableCard
                key={table.id}
                table={table}
                userId={user.id}
                balance={user.balance}
                busy={busy}
                joining={joiningId === table.id}
                error={joinErrors[table.id] || undefined}
                onJoin={rejoindre}
                onReprendre={(t) => navigate({ name: "table", tableId: t.id })}
                delay={index * 60}
              />
            ))}
          </div>
        )}
      </section>

      {enCours.length > 0 && (
        <section aria-labelledby="encours-heading">
          <h2
            id="encours-heading"
            className="mb-3 font-display text-sm font-bold text-cream-dim"
          >
            Parties en cours ({enCours.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {enCours.map((table, index) => (
              <TableCard
                key={table.id}
                table={table}
                userId={user.id}
                balance={user.balance}
                busy={busy}
                joining={false}
                onJoin={rejoindre}
                onReprendre={(t) => navigate({ name: "table", tableId: t.id })}
                delay={index * 60}
              />
            ))}
          </div>
        </section>
      )}

      {/* Barre d'action collée, téléphone uniquement. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 border-t border-line bg-felt-deep/95 px-4 py-3 backdrop-blur sm:hidden",
          "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        )}
      >
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={plein || busy}
          className="w-full text-base"
        >
          <Plus className="size-4" aria-hidden />
          Nouvelle table
        </Button>
      </div>

      <NewTableDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setCreateError(undefined);
        }}
        game={definition}
        balance={user.balance}
        onCreate={creerTable}
        loading={creating}
        error={createError}
      />
    </div>
  );
}

/** « 3 joueurs en ligne » : ce qui distingue « personne ne joue » de « patiente ». */
function PresenceHint() {
  const online = useRealtime((state) => state.presence.online);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Users className="size-3.5" aria-hidden />
      {online <= 1
        ? "Tu es seul en ligne pour l'instant."
        : `${online} joueurs sont en ligne en ce moment.`}
    </span>
  );
}
