import { Volume2, VolumeX } from "lucide-react";
import { AUDIO_BUSES, AUDIO_BUS_HINTS, AUDIO_BUS_LABELS, useAudio, type AudioBus } from "@/lib/audio";
import { noMusicInstalled, syncMusicVolume, useMusic } from "@/lib/musique";
import { playSound, type SoundName } from "@/lib/sounds";
import { cn } from "@/lib/cn";

/** Le son joué en aperçu quand on relâche un curseur. */
const APERCU: Record<AudioBus, SoundName> = {
  effets: "jeton",
  musique: "bouton",
  notifications: "notification",
};

/**
 * Les trois volumes, dans « Mon compte ».
 *
 * Trois curseurs et non un seul interrupteur : garder les bruits de table sans
 * la musique — ou l'inverse — est le réglage que les joueurs cherchent en
 * premier, et un interrupteur unique les oblige à tout couper.
 *
 * Chaque curseur joue son propre son au relâchement. Régler un volume sans
 * l'entendre revient à le régler à l'aveugle.
 */
export function ReglagesSon() {
  const settings = useAudio((state) => state.settings);
  const setVolume = useAudio((state) => state.setVolume);
  const setMuted = useAudio((state) => state.setMuted);
  const ready = useAudio((state) => state.ready);
  // On s'abonne pour re-rendre une fois le manifeste chargé.
  useMusic((state) => state.loaded);

  const musiqueIndisponible = noMusicInstalled();

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-bold text-cream">Son</h2>
          <p className="mt-0.5 text-sm text-cream-dim">
            Trois familles réglables séparément. Les réglages restent sur cet appareil.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMuted(!settings.muted)}
          aria-pressed={settings.muted}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm transition-colors",
            settings.muted
              ? "border-danger/50 bg-danger/10 text-danger"
              : "border-line bg-felt/50 text-cream-dim hover:border-line-strong hover:text-cream",
          )}
        >
          {settings.muted ? (
            <VolumeX className="size-4" aria-hidden />
          ) : (
            <Volume2 className="size-4" aria-hidden />
          )}
          {settings.muted ? "Tout coupé" : "Tout couper"}
        </button>
      </div>

      <div className="mt-5 space-y-4">
        {AUDIO_BUSES.map((bus) => (
          <Curseur
            key={bus}
            bus={bus}
            valeur={settings.volumes[bus]}
            coupe={settings.muted}
            indisponible={bus === "musique" && musiqueIndisponible}
            onChange={(value) => {
              setVolume(bus, value);
              if (bus === "musique") syncMusicVolume();
            }}
            onApercu={() => playSound(APERCU[bus])}
          />
        ))}
      </div>

      {!ready && (
        <p className="mt-4 text-xs text-cream-faint">
          Le son démarre au premier clic dans la page : tous les navigateurs le refusent avant.
        </p>
      )}
    </section>
  );
}

interface CurseurProps {
  bus: AudioBus;
  valeur: number;
  coupe: boolean;
  indisponible: boolean;
  onChange: (value: number) => void;
  onApercu: () => void;
}

function Curseur({ bus, valeur, coupe, indisponible, onChange, onApercu }: CurseurProps) {
  const id = `volume-${bus}`;
  const pourcent = Math.round(valeur * 100);

  return (
    <div className={cn(coupe && "opacity-50")}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-cream">
          {AUDIO_BUS_LABELS[bus]}
        </label>
        <span className="tabular text-xs text-cream-faint">{pourcent} %</span>
      </div>

      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={pourcent}
        disabled={coupe}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        // L'aperçu au relâchement et non à chaque pas : le jouer pendant le
        // glissement produirait une rafale de sons superposés.
        onPointerUp={onApercu}
        onKeyUp={onApercu}
        className="mt-2 h-11 w-full accent-brass"
      />

      <p className="text-xs text-cream-faint">
        {indisponible
          ? "Aucune musique n'est installée sur ce serveur — voir public/sons/musique/README.md."
          : AUDIO_BUS_HINTS[bus]}
      </p>
    </div>
  );
}
