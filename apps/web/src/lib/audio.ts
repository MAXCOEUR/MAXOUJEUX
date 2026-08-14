/**
 * Le moteur sonore, hors de React.
 *
 * Même famille que `socket.ts` et `toast.ts` : les sons se déclenchent depuis
 * des gestionnaires de socket et des minuteries, jamais depuis un rendu. Un
 * `useEffect` sans garde rejouerait le carillon du gain à chaque `setState`.
 *
 * Deux règles gouvernent ce fichier :
 *
 * 1. **Le contexte naît au premier geste du joueur.** Tous les navigateurs
 *    refusent l'audio avant une interaction ; un `AudioContext` créé au
 *    chargement reste `suspended` et se tait sans rien dire. On l'ouvre donc au
 *    premier `pointerdown` ou `keydown`, et l'écouteur se retire aussitôt.
 * 2. **Trois bus de volume, jamais de volume dans un son.** Régler un curseur
 *    change un gain de sortie ; le code d'un son n'a pas à savoir qu'il existe
 *    un réglage.
 */

import { create } from "zustand";

export const AUDIO_BUSES = ["effets", "musique", "notifications"] as const;

export type AudioBus = (typeof AUDIO_BUSES)[number];

export const AUDIO_BUS_LABELS: Record<AudioBus, string> = {
  effets: "Effets de jeu",
  musique: "Musique de fond",
  notifications: "Notifications",
};

export const AUDIO_BUS_HINTS: Record<AudioBus, string> = {
  effets: "Jetons, cartes, roue qui tourne, gains et pertes.",
  musique: "Une ambiance différente au lobby et à chaque table.",
  notifications: "Messages du chat et succès débloqués.",
};

export interface AudioSettings {
  /** Coupure générale. Prime sur les trois volumes. */
  muted: boolean;
  /** Volume par famille, de 0 à 1. */
  volumes: Record<AudioBus, number>;
}

/**
 * Tout est allumé d'entrée, musique comprise.
 *
 * Sans risque de faire sursauter qui que ce soit : le navigateur bloque de toute
 * façon le son jusqu'au premier clic, et personne ne clique par accident.
 */
export const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  volumes: { effets: 0.7, musique: 0.35, notifications: 0.6 },
};

/**
 * Clé versionnée : le jour où la forme des réglages change, l'ancienne valeur
 * est ignorée au lieu d'être lue de travers.
 */
const STORAGE_KEY = "maxoujeux.audio.v1";

// ---------------------------------------------------------------------------
// Persistance
// ---------------------------------------------------------------------------

function clampVolume(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

/**
 * Relit les réglages enregistrés.
 *
 * Exporté pour être testable : c'est la fonction qui doit survivre à une valeur
 * corrompue à la main, à une version antérieure du format, et à un navigateur
 * en navigation privée qui refuse `localStorage`.
 */
export function parseSettings(raw: string | null): AudioSettings {
  if (!raw) return DEFAULT_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  if (typeof parsed !== "object" || parsed === null) return DEFAULT_SETTINGS;
  const source = parsed as { muted?: unknown; volumes?: unknown };
  const volumes = (source.volumes ?? {}) as Record<string, unknown>;

  // Champ par champ : un réglage absent ou aberrant retombe sur sa valeur par
  // défaut sans emporter les deux autres avec lui.
  return {
    muted: source.muted === true,
    volumes: {
      effets: clampVolume(volumes.effets) ?? DEFAULT_SETTINGS.volumes.effets,
      musique: clampVolume(volumes.musique) ?? DEFAULT_SETTINGS.volumes.musique,
      notifications:
        clampVolume(volumes.notifications) ?? DEFAULT_SETTINGS.volumes.notifications,
    },
  };
}

function readSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // `localStorage` lève en navigation privée sur certains navigateurs.
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: AudioSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota plein ou écriture refusée : le réglage vaut pour la session, et
    // c'est mieux que de faire échouer un clic sur un curseur de volume.
  }
}

// ---------------------------------------------------------------------------
// Le graphe audio
// ---------------------------------------------------------------------------

interface Engine {
  ctx: AudioContext;
  buses: Record<AudioBus, GainNode>;
}

let engine: Engine | null = null;

/** Gain effectif d'un bus, coupure générale comprise. */
function gainOf(settings: AudioSettings, bus: AudioBus): number {
  return settings.muted ? 0 : settings.volumes[bus];
}

function applySettings(settings: AudioSettings): void {
  if (!engine) return;
  for (const bus of AUDIO_BUSES) {
    // Rampe courte plutôt qu'affectation sèche : un gain qui saute produit un
    // claquement audible, y compris à la coupure.
    const node = engine.buses[bus].gain;
    node.cancelScheduledValues(engine.ctx.currentTime);
    node.setTargetAtTime(gainOf(settings, bus), engine.ctx.currentTime, 0.02);
  }
}

/**
 * Ouvre le contexte audio. Idempotent.
 *
 * Appelé au premier geste du joueur, et non au chargement du module : un
 * contexte ouvert trop tôt naît `suspended` et ne rejoue rien.
 */
function openEngine(): Engine | null {
  if (engine) return engine;
  if (typeof window === "undefined") return null;

  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;

  let ctx: AudioContext;
  try {
    ctx = new Constructor();
  } catch {
    return null;
  }

  const buses = Object.fromEntries(
    AUDIO_BUSES.map((bus) => {
      const node = ctx.createGain();
      node.gain.value = 0;
      node.connect(ctx.destination);
      return [bus, node];
    }),
  ) as Record<AudioBus, GainNode>;

  engine = { ctx, buses };
  applySettings(useAudio.getState().settings);
  return engine;
}

/** Le contexte, ou `null` tant que le joueur n'a rien touché. */
export function audioEngine(): Engine | null {
  return engine;
}

// ---------------------------------------------------------------------------
// Déverrouillage
// ---------------------------------------------------------------------------

let unlocked = false;

/**
 * Réveille l'audio au premier geste.
 *
 * `resume()` est indispensable en plus de la création : un contexte peut être
 * suspendu par le navigateur après un changement d'onglet, et il faut alors le
 * relancer sans recréer tout le graphe.
 */
function unlock(): void {
  const current = openEngine();
  if (!current) return;
  if (current.ctx.state === "suspended") void current.ctx.resume();
  if (unlocked) return;

  unlocked = true;
  useAudio.setState({ ready: true });
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
  // Les écouteurs de déverrouillage partent, mais la reprise après mise en
  // veille reste utile : `visibilitychange` s'en charge plus bas.
  document.addEventListener("visibilitychange", resumeIfVisible);
}

function resumeIfVisible(): void {
  if (document.visibilityState !== "visible") return;
  if (engine?.ctx.state === "suspended") void engine.ctx.resume();
}

/**
 * Enregistré au chargement du module, une seule fois — c'est un abonnement au
 * navigateur, pas au cycle de vie d'un composant.
 */
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AudioState {
  settings: AudioSettings;
  /** Le joueur a-t-il fait le geste qui autorise le son ? */
  ready: boolean;
  setVolume: (bus: AudioBus, value: number) => void;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
}

export const useAudio = create<AudioState>((set, get) => ({
  settings: readSettings(),
  ready: false,

  setVolume: (bus, value) => {
    const settings = {
      ...get().settings,
      volumes: { ...get().settings.volumes, [bus]: Math.min(1, Math.max(0, value)) },
    };
    set({ settings });
    applySettings(settings);
    writeSettings(settings);
  },

  toggleMute: () => get().setMuted(!get().settings.muted),

  setMuted: (muted) => {
    const settings = { ...get().settings, muted };
    set({ settings });
    applySettings(settings);
    writeSettings(settings);
  },
}));

/** Volume effectif d'un bus, pour la musique qui ne passe pas par Web Audio. */
export function effectiveVolume(bus: AudioBus): number {
  return gainOf(useAudio.getState().settings, bus);
}

/** Remise à l'état initial. Réservé aux tests. */
export function resetAudioForTests(): void {
  engine = null;
  unlocked = false;
  useAudio.setState({ settings: DEFAULT_SETTINGS, ready: false });
}
