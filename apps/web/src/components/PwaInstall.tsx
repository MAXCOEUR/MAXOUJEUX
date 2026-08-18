import { Download, RefreshCw, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePwa } from "@/lib/pwa";
import { installCardState, shouldShowInstallBanner } from "@/lib/pwa-install";
import { Button } from "./Button";
import { Modal } from "./Modal";

const DISMISSED_KEY = "maxoujeux:pwa-banner-dismissed";

export function IosInstallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Installer MaxouJeux">
      <div className="space-y-4 text-sm leading-relaxed text-cream-dim">
        <p>Safari installe l’application depuis son menu de partage :</p>
        <ol className="space-y-3">
          <li className="flex gap-3">
            <Share className="mt-0.5 size-5 shrink-0 text-brass" aria-hidden />
            <span>Appuie sur <strong className="text-cream">Partager</strong>.</span>
          </li>
          <li className="pl-8">Choisis <strong className="text-cream">Sur l’écran d’accueil</strong>, puis confirme.</li>
        </ol>
      </div>
    </Modal>
  );
}

export function PwaNotices() {
  const pwa = usePwa();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (pwa.installed) setIosOpen(false);
  }, [pwa.installed]);

  const showInstall = shouldShowInstallBanner(pwa, dismissed);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (pwa.iosInstructions) return setIosOpen(true);
    await pwa.install();
  }

  return (
    <>
      {showInstall && (
        <aside className="border-b border-brass/25 bg-brass/10 px-4 py-3" aria-label="Installer l’application">
          <div className="mx-auto flex max-w-6xl items-center gap-3 sm:px-2">
            <Download className="hidden size-5 shrink-0 text-brass sm:block" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-cream-dim">
              <strong className="text-cream">MaxouJeux sur ton appareil</strong>
              <span className="hidden sm:inline"> — ouvre le jeu comme une application.</span>
            </p>
            <Button type="button" onClick={() => void install()} className="shrink-0">Installer</Button>
            <button type="button" onClick={dismiss} aria-label="Masquer la proposition d’installation" className="rounded-lg p-2 text-cream-faint transition-colors hover:bg-felt-raised hover:text-cream">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </aside>
      )}

      {pwa.needRefresh && (
        <aside className="border-b border-line bg-felt-raised px-4 py-3" aria-label="Mise à jour disponible">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 sm:px-2">
            <RefreshCw className="size-5 shrink-0 text-brass" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-cream-dim">
              <strong className="text-cream">Mise à jour disponible.</strong> Termine ta partie avant de l’appliquer.
            </p>
            <Button type="button" variant="outline" onClick={() => void pwa.update()}>Mettre à jour</Button>
          </div>
        </aside>
      )}

      <IosInstallModal open={iosOpen} onClose={() => setIosOpen(false)} />
    </>
  );
}

export function PwaInstallCard() {
  const pwa = usePwa();
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    if (pwa.installed) setIosOpen(false);
  }, [pwa.installed]);

  const cardState = installCardState(pwa);
  if (cardState === "hidden") return null;

  async function install() {
    if (pwa.iosInstructions) return setIosOpen(true);
    await pwa.install();
  }

  return (
    <>
      <section className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-cream">Application MaxouJeux</h2>
          <p className="mt-1 text-sm text-cream-dim">Ajoute MaxouJeux à ton écran d’accueil pour l’ouvrir sans passer par un onglet.</p>
          <p className="mt-2 text-xs text-cream-faint">L’empreinte du navigateur aide la modération, mais reste contournable et peut produire des faux positifs.</p>
        </div>
        <Button type="button" onClick={() => void install()} disabled={cardState === "waiting"} className="shrink-0">
          <Download className="size-4" aria-hidden />
          {cardState === "ready" ? "Installer MaxouJeux" : "Installation bientôt disponible"}
        </Button>
      </section>
      <IosInstallModal open={iosOpen} onClose={() => setIosOpen(false)} />
    </>
  );
}
