import {
  AVATAR_SOURCE_ACCEPT,
  DELETE_CONFIRMATION,
  PASSWORD_MIN,
  deleteAccountSchema,
  formatCoins,
  parseAvatarSeed,
  updateEmailSchema,
  updatePasswordSchema,
  updatePseudoSchema,
  type CurrentUser,
} from "@maxoujeux/shared";
import { ArrowLeft, BarChart3, ImageUp, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Lien } from "@/components/Lien";
import { Modal } from "@/components/Modal";
import { ReglagesSon } from "@/components/ReglagesSon";
import { PwaInstallCard } from "@/components/PwaInstall";
import {
  useDeleteAccount,
  useRemoveAvatar,
  useUpdateEmail,
  useUpdatePassword,
  useUpdatePseudo,
  useUploadAvatar,
} from "@/lib/account";
import { AvatarError, reduireAvatar } from "@/lib/avatar";
import { mutationError, toFieldErrors } from "@/lib/form-errors";
import { pushToast } from "@/lib/toast";

/**
 * Espace « Mon compte ».
 *
 * Une carte par réglage, chacune ouvrant son propre dialogue : les cinq
 * opérations n'ont ni la même portée ni les mêmes conséquences, et les empiler
 * dans un seul formulaire ferait passer la fermeture du compte pour un champ
 * comme un autre. Un seul dialogue étant visible à la fois, la règle du bouton
 * laiton unique par écran tient.
 */
export function ComptePage({ user }: { user: CurrentUser }) {
  const [ouvert, setOuvert] = useState<"email" | "pseudo" | "password" | "delete" | null>(null);

  return (
    <div className="space-y-5 pb-8">
      <Lien
        to={{ name: "lobby" }}
        className="-my-2 inline-flex min-h-11 items-center gap-1.5 py-2 text-sm text-cream-dim transition-colors hover:text-cream"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Le lobby
      </Lien>

      <header className="panel flex items-center gap-4 p-5 sm:p-6">
        <Avatar userId={user.id} seed={user.avatarSeed} pseudo={user.pseudo} className="size-16 text-xl" />
        <div className="min-w-0">
          <h1 className="font-display text-xl font-extrabold text-cream sm:text-2xl">
            {user.pseudo}
          </h1>
          <p className="truncate text-sm text-cream-dim">{user.email}</p>
          <p className="tabular mt-1 text-xs text-brass">{formatCoins(user.balance)}</p>
        </div>

        {/* Le profil public est **la même page** que celle des autres joueurs :
            c'est la seule façon de savoir exactement ce qui est montré de soi. */}
        <Lien
          to={{ name: "profil", pseudo: user.pseudo }}
          className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 self-center rounded-xl px-3 py-2 text-sm text-cream-dim transition-colors hover:bg-felt-raised hover:text-cream"
        >
          <BarChart3 className="size-4" aria-hidden />
          <span className="hidden sm:inline">Mes statistiques</span>
        </Lien>
      </header>

      <AvatarCard user={user} />

      <ReglagesSon />

      <PwaInstallCard />

      <Reglage titre="Adresse email" valeur={user.email} onOuvrir={() => setOuvert("email")} />
      <Reglage titre="Pseudo" valeur={user.pseudo} onOuvrir={() => setOuvert("pseudo")} />
      <Reglage
        titre="Mot de passe"
        valeur="Modifié pour la dernière fois lors de l'inscription ou d'un changement"
        action="Changer"
        onOuvrir={() => setOuvert("password")}
      />

      <section className="panel border-danger/30 p-5">
        <h2 className="font-display text-sm font-bold text-danger">Fermer mon compte</h2>
        <p className="mt-1 text-sm text-cream-dim">
          Ton pseudo, ton email et ton avatar sont effacés définitivement.
        </p>
        <Button variant="outline" onClick={() => setOuvert("delete")} className="mt-4 text-danger">
          <Trash2 className="size-4" aria-hidden />
          Fermer mon compte
        </Button>
      </section>

      <EmailDialog open={ouvert === "email"} user={user} onClose={() => setOuvert(null)} />
      <PseudoDialog open={ouvert === "pseudo"} user={user} onClose={() => setOuvert(null)} />
      <PasswordDialog open={ouvert === "password"} onClose={() => setOuvert(null)} />
      <DeleteDialog open={ouvert === "delete"} onClose={() => setOuvert(null)} />
    </div>
  );
}

function Reglage({
  titre,
  valeur,
  action = "Modifier",
  onOuvrir,
}: {
  titre: string;
  valeur: string;
  action?: string;
  onOuvrir: () => void;
}) {
  return (
    <section className="panel flex items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <h2 className="font-display text-sm font-bold text-cream">{titre}</h2>
        <p className="mt-0.5 truncate text-sm text-cream-dim">{valeur}</p>
      </div>
      <Button variant="outline" onClick={onOuvrir} className="shrink-0">
        {action}
      </Button>
    </section>
  );
}

/**
 * Envoi de l'avatar.
 *
 * Pas de dialogue ici : le fichier se choisit en un clic et le résultat
 * s'affiche à côté, il n'y a rien à valider entre les deux.
 */
function AvatarCard({ user }: { user: CurrentUser }) {
  const envoyer = useUploadAvatar();
  const retirer = useRemoveAvatar();
  const champ = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const aUneImage = parseAvatarSeed(user.avatarSeed).hasImage;

  async function choisir(fichier: File | undefined) {
    if (!fichier) return;
    setErreur(null);
    try {
      const image = await reduireAvatar(fichier);
      await envoyer.mutateAsync(image);
      pushToast("info", `Avatar mis à jour — ${Math.round(image.size / 1024)} ko`);
    } catch (error) {
      if (error instanceof AvatarError) {
        setErreur(error.message);
      } else {
        // Le refus du serveur voyage dans `fields.avatar` : sans cette lecture,
        // `message` vaut null et l'écran ne dirait rien du tout.
        const { fields, message } = mutationError(error);
        setErreur(fields.avatar ?? message);
      }
    } finally {
      // Sans cette remise à zéro, rechoisir le même fichier n'émettrait rien.
      if (champ.current) champ.current.value = "";
    }
  }

  return (
    <section className="panel p-5">
      <h2 className="font-display text-sm font-bold text-cream">Avatar</h2>
      <p className="mt-0.5 text-sm text-cream-dim">
        Ton image est réduite à 128 × 128 sur ton appareil avant l'envoi, et ne dépasse pas quelques
        kilo-octets.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Avatar userId={user.id} seed={user.avatarSeed} pseudo={user.pseudo} className="size-16 text-xl" />

        <div className="flex flex-wrap gap-2">
          <input
            ref={champ}
            type="file"
            accept={AVATAR_SOURCE_ACCEPT}
            onChange={(event) => void choisir(event.target.files?.[0])}
            className="sr-only"
            id="avatar-fichier"
          />
          <Button
            variant="outline"
            onClick={() => champ.current?.click()}
            loading={envoyer.isPending}
          >
            <ImageUp className="size-4" aria-hidden />
            {aUneImage ? "Changer ma photo" : "Choisir une photo"}
          </Button>

          {aUneImage && (
            <Button variant="ghost" onClick={() => retirer.mutate()} loading={retirer.isPending}>
              Retirer ma photo
            </Button>
          )}
        </div>
      </div>

      {aUneImage && (
        <p className="mt-3 text-xs text-cream-faint">
          Retirer ta photo te rendra un jeton dessiné, d'une nouvelle couleur.
        </p>
      )}
      {erreur && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {erreur}
        </p>
      )}
    </section>
  );
}

/** Coque commune aux dialogues de formulaire, sur le motif de l'administration. */
function FormDialog({
  open,
  onClose,
  title,
  id,
  submit,
  loading,
  onSubmit,
  message,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  id: string;
  submit: string;
  loading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  message: string | null;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button type="submit" form={id} loading={loading} className="w-full">
          {submit}
        </Button>
      }
    >
      <form id={id} onSubmit={onSubmit} noValidate className="space-y-4">
        {children}
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
      </form>
    </Modal>
  );
}

function EmailDialog({ open, user, onClose }: { open: boolean; user: CurrentUser; onClose: () => void }) {
  const mutation = useUpdateEmail();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFields({});
    setMessage(null);

    const parsed = updateEmailSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setFields(toFieldErrors(parsed.error));

    try {
      await mutation.mutateAsync(parsed.data);
      pushToast("info", "Adresse email mise à jour");
      onClose();
    } catch (error) {
      const { fields: champs, message: texte } = mutationError(error);
      setFields(champs);
      setMessage(texte);
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Changer mon email"
      id="compte-email"
      submit="Enregistrer"
      loading={mutation.isPending}
      onSubmit={submit}
      message={message}
    >
      <Field
        label="Nouvelle adresse"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={user.email}
        error={fields.email}
      />
    </FormDialog>
  );
}

function PseudoDialog({ open, user, onClose }: { open: boolean; user: CurrentUser; onClose: () => void }) {
  const mutation = useUpdatePseudo();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFields({});
    setMessage(null);

    const parsed = updatePseudoSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setFields(toFieldErrors(parsed.error));

    try {
      await mutation.mutateAsync(parsed.data);
      pushToast("info", "Pseudo mis à jour");
      onClose();
    } catch (error) {
      const { fields: champs, message: texte } = mutationError(error);
      setFields(champs);
      setMessage(texte);
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Changer mon pseudo"
      id="compte-pseudo"
      submit="Enregistrer"
      loading={mutation.isPending}
      onSubmit={submit}
      message={message}
    >
      <Field
        label="Nouveau pseudo"
        name="pseudo"
        defaultValue={user.pseudo}
        hint="C'est le nom que verront les autres joueurs."
        error={fields.pseudo}
      />
    </FormDialog>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mutation = useUpdatePassword();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFields({});
    setMessage(null);

    const parsed = updatePasswordSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setFields(toFieldErrors(parsed.error));

    try {
      await mutation.mutateAsync(parsed.data);
      pushToast("info", "Mot de passe modifié. Tes autres appareils ont été déconnectés.");
      onClose();
    } catch (error) {
      const { fields: champs, message: texte } = mutationError(error);
      setFields(champs);
      setMessage(texte);
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Changer mon mot de passe"
      id="compte-password"
      submit="Enregistrer"
      loading={mutation.isPending}
      onSubmit={submit}
      message={message}
    >
      <Field
        label="Nouveau mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`${PASSWORD_MIN} caractères minimum. Tes autres appareils seront déconnectés.`}
        error={fields.password}
      />
    </FormDialog>
  );
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mutation = useDeleteAccount();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFields({});
    setMessage(null);

    const parsed = deleteAccountSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) return setFields(toFieldErrors(parsed.error));

    try {
      await mutation.mutateAsync(parsed.data);
    } catch (error) {
      const { fields: champs, message: texte } = mutationError(error);
      setFields(champs);
      setMessage(texte);
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Fermer mon compte"
      id="compte-delete"
      submit="Fermer définitivement mon compte"
      loading={mutation.isPending}
      onSubmit={submit}
      message={message}
    >
      {/* Le texte dit la vérité sur ce qui reste : promettre un effacement total
          serait faux, et les soldes des autres joueurs en dépendent. */}
      <p className="text-sm leading-relaxed text-cream-dim">
        Ton pseudo, ton email et ton avatar sont effacés définitivement, et tu ne pourras plus te
        connecter. Tes parties et l'historique de tes MaxouCoin restent, sous un nom anonyme, parce
        que les scores des autres joueurs en dépendent.
      </p>
      <Field
        label={`Recopie « ${DELETE_CONFIRMATION} » pour confirmer`}
        name="confirmation"
        autoComplete="off"
        error={fields.confirmation}
      />
    </FormDialog>
  );
}
