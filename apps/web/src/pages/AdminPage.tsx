import {
  createPlayerSchema,
  formatCoins,
  resetPlayerPasswordSchema,
  setPlayerBalanceSchema,
  type AdminAccount,
} from "@maxoujeux/shared";
import { Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ZodError } from "zod";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { ApiClientError } from "@/lib/api";
import {
  adminActionAllowed,
  useAdminAccounts,
  useCreatePlayer,
  useDeletePlayer,
  useResetPlayerPassword,
  useSetPlayerBalance,
} from "@/lib/admin";

function toFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[issue.path.join(".")] ??= issue.message;
  return errors;
}

function mutationError(error: unknown): { fields: Record<string, string>; message: string | null } {
  if (error instanceof ApiClientError) {
    return {
      fields: error.fields,
      message: Object.keys(error.fields).length === 0 ? error.message : null,
    };
  }
  return { fields: {}, message: "Une erreur inattendue est survenue." };
}

interface AccountTableProps {
  accounts: AdminAccount[];
  onResetPassword: (account: AdminAccount) => void;
  onSetBalance: (account: AdminAccount) => void;
  onDelete: (account: AdminAccount) => void;
}

export function AccountTable({ accounts, onResetPassword, onSetBalance, onDelete }: AccountTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-felt-raised/60 text-xs uppercase tracking-[0.08em] text-cream-faint">
            <tr>
              <th className="px-4 py-3 font-semibold">Pseudo</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Solde</th>
              <th className="px-4 py-3 font-semibold">Rôle</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                onResetPassword={onResetPassword}
                onSetBalance={onSetBalance}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {accounts.map((account) => (
          <article key={account.id} className="rounded-2xl border border-line bg-felt-raised/35 p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-cream-faint">Pseudo</dt><dd className="font-medium text-cream">{account.pseudo}</dd>
              <dt className="text-cream-faint">Email</dt><dd className="break-all text-cream-dim">{account.email}</dd>
              <dt className="text-cream-faint">Solde</dt><dd className="font-medium text-brass-bright">{formatCoins(account.balance)}</dd>
              <dt className="text-cream-faint">Rôle</dt><dd className="text-cream">{account.isAdmin ? "Administrateur" : "Joueur"}</dd>
            </dl>
            {adminActionAllowed(account) && (
              <AccountActions account={account} onResetPassword={onResetPassword} onSetBalance={onSetBalance} onDelete={onDelete} />
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function AccountRow({ account, onResetPassword, onSetBalance, onDelete }: Pick<AccountTableProps, "onResetPassword" | "onSetBalance" | "onDelete"> & { account: AdminAccount }) {
  return (
    <tr className="bg-felt/25 text-cream-dim">
      <td className="px-4 py-3 font-medium text-cream">{account.pseudo}</td>
      <td className="px-4 py-3">{account.email}</td>
      <td className="px-4 py-3 font-medium text-brass-bright">{formatCoins(account.balance)}</td>
      <td className="px-4 py-3">{account.isAdmin ? "Administrateur" : "Joueur"}</td>
      <td className="px-4 py-3">
        {adminActionAllowed(account) && (
          <AccountActions account={account} onResetPassword={onResetPassword} onSetBalance={onSetBalance} onDelete={onDelete} />
        )}
      </td>
    </tr>
  );
}

function AccountActions({ account, onResetPassword, onSetBalance, onDelete }: Pick<AccountTableProps, "onResetPassword" | "onSetBalance" | "onDelete"> & { account: AdminAccount }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => onResetPassword(account)} className="px-2.5 py-2" aria-label={`Réinitialiser le mot de passe de ${account.pseudo}`}>
        <RotateCcw className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="outline" onClick={() => onSetBalance(account)} className="px-2.5 py-2" aria-label={`Ajuster le solde de ${account.pseudo}`}>
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Button type="button" variant="ghost" onClick={() => onDelete(account)} className="px-2.5 py-2 text-danger hover:text-danger" aria-label={`Supprimer ${account.pseudo}`}>
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

export function CreatePlayerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createPlayer = useCreatePlayer();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setGlobalError(null);
    const parsed = createPlayerSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) return setFieldErrors(toFieldErrors(parsed.error));
    try {
      await createPlayer.mutateAsync(parsed.data);
      event.currentTarget.reset();
      onClose();
    } catch (error) {
      const outcome = mutationError(error);
      setFieldErrors(outcome.fields);
      setGlobalError(outcome.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Créer un joueur" footer={<Button type="submit" form="create-player" loading={createPlayer.isPending} className="w-full">Créer le joueur</Button>}>
      <form id="create-player" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required error={fieldErrors.email} />
        <Field label="Pseudo" name="pseudo" autoComplete="nickname" required error={fieldErrors.pseudo} />
        <Field label="Mot de passe" name="password" type="password" autoComplete="new-password" required error={fieldErrors.password} />
        {globalError && <p role="alert" className="text-sm text-danger">{globalError}</p>}
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({ account, onClose }: { account: AdminAccount | null; onClose: () => void }) {
  const resetPassword = useResetPlayerPassword();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setFieldErrors({}); setGlobalError(null);
    const parsed = resetPlayerPasswordSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) return setFieldErrors(toFieldErrors(parsed.error));
    try { await resetPassword.mutateAsync({ accountId: account.id, input: parsed.data }); onClose(); }
    catch (error) { const outcome = mutationError(error); setFieldErrors(outcome.fields); setGlobalError(outcome.message); }
  }
  return <Modal open={account !== null} onClose={onClose} title={`Mot de passe de ${account?.pseudo ?? ""}`} footer={<Button type="submit" form="reset-password" loading={resetPassword.isPending} className="w-full">Réinitialiser</Button>}>
    <form id="reset-password" onSubmit={submit} noValidate className="space-y-4">
      <Field label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required error={fieldErrors.password} />
      {globalError && <p role="alert" className="text-sm text-danger">{globalError}</p>}
    </form>
  </Modal>;
}

function SetBalanceDialog({ account, onClose }: { account: AdminAccount | null; onClose: () => void }) {
  const setBalance = useSetPlayerBalance();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setFieldErrors({}); setGlobalError(null);
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = setPlayerBalanceSchema.safeParse({ balance: Number(raw.balance) });
    if (!parsed.success) return setFieldErrors(toFieldErrors(parsed.error));
    try { await setBalance.mutateAsync({ accountId: account.id, input: parsed.data }); onClose(); }
    catch (error) { const outcome = mutationError(error); setFieldErrors(outcome.fields); setGlobalError(outcome.message); }
  }
  return <Modal open={account !== null} onClose={onClose} title={`Solde de ${account?.pseudo ?? ""}`} footer={<Button type="submit" form="set-balance" loading={setBalance.isPending} className="w-full">Enregistrer le solde</Button>}>
    <form id="set-balance" onSubmit={submit} noValidate className="space-y-4">
      <Field label="Solde en MaxouCoin" name="balance" type="number" min="0" step="1" defaultValue={account?.balance} required error={fieldErrors.balance} />
      {globalError && <p role="alert" className="text-sm text-danger">{globalError}</p>}
    </form>
  </Modal>;
}

function DeleteAccountDialog({ account, onClose }: { account: AdminAccount | null; onClose: () => void }) {
  const deletePlayer = useDeletePlayer();
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!account) return;
    setError(null);
    try { await deletePlayer.mutateAsync(account.id); onClose(); }
    catch (cause) { setError(mutationError(cause).message ?? "Impossible de supprimer ce compte."); }
  }
  return <Modal open={account !== null} onClose={onClose} title="Supprimer le joueur" footer={<Button type="button" onClick={remove} loading={deletePlayer.isPending} className="w-full">Supprimer définitivement</Button>}>
    <p className="text-sm leading-relaxed text-cream-dim">Supprimer <span className="font-semibold text-cream">{account?.pseudo}</span> et ses données associées ? Cette action est irréversible.</p>
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
  </Modal>;
}

export function AdminPage() {
  const accounts = useAdminAccounts();
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordAccount, setPasswordAccount] = useState<AdminAccount | null>(null);
  const [balanceAccount, setBalanceAccount] = useState<AdminAccount | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<AdminAccount | null>(null);

  return (
    <section className="animate-rise">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="font-display text-3xl font-bold text-cream">Administration</h1><p className="mt-1 text-sm text-cream-dim">Gérer les comptes joueurs de la maison.</p></div>
        <Button type="button" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden />Créer un joueur</Button>
      </div>

      {accounts.isPending && <div className="grid min-h-48 place-items-center"><Loader2 className="size-6 animate-spin text-cream-faint" aria-label="Chargement des comptes" /></div>}
      {accounts.isError && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">Impossible de charger les comptes.</p>}
      {accounts.data && <AccountTable accounts={accounts.data} onResetPassword={setPasswordAccount} onSetBalance={setBalanceAccount} onDelete={setDeleteAccount} />}

      <CreatePlayerDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ResetPasswordDialog account={passwordAccount} onClose={() => setPasswordAccount(null)} />
      <SetBalanceDialog account={balanceAccount} onClose={() => setBalanceAccount(null)} />
      <DeleteAccountDialog account={deleteAccount} onClose={() => setDeleteAccount(null)} />
    </section>
  );
}
