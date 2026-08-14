/**
 * Le catalogue de sons, fabriqués en code.
 *
 * Aucun fichier audio : les bruits de casino sont percussifs ou tonals, jamais
 * orchestraux, et se synthétisent très bien avec quelques oscillateurs et du
 * bruit filtré. Zéro octet à télécharger, zéro licence à surveiller, et un
 * réglage de timbre se fait en changeant un chiffre plutôt qu'en réenregistrant.
 *
 * Chaque son est une fonction qui **pose des nœuds sur la ligne de temps** et
 * s'oublie : les oscillateurs sont programmés puis arrêtés, le ramasse-miettes
 * fait le reste. Rien n'est conservé d'un appel à l'autre.
 */

import { audioEngine, useAudio, type AudioBus } from "./audio";

export const SOUND_NAMES = [
  "roue-cliquet",
  "jeton",
  "carte",
  "gain",
  "gros-gain",
  "perte",
  "tour",
  "notification",
  "succes",
  "bouton",
] as const;

export type SoundName = (typeof SOUND_NAMES)[number];

interface SoundSpec {
  bus: AudioBus;
  /** Pose le son à l'instant `at`. */
  play: (ctx: AudioContext, out: GainNode, at: number) => void;
}

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

/**
 * Une note, avec son enveloppe.
 *
 * L'attaque est très courte et la chute exponentielle : c'est ce qui distingue
 * un carillon d'un bourdonnement. Une enveloppe linéaire sonne synthétique.
 */
function note(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  options: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    /** Glissando : fréquence d'arrivée, si elle diffère du départ. */
    to?: number;
  },
): void {
  const { freq, duration, type = "sine", gain = 0.3, to } = options;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** Bruit blanc court : la matière première des clics, jetons et cartes. */
function noise(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  options: {
    duration: number;
    gain?: number;
    /** Passe-bande : centre du filtre. */
    freq?: number;
    q?: number;
    type?: BiquadFilterType;
  },
): void {
  const { duration, gain = 0.2, freq = 2_000, q = 1, type = "bandpass" } = options;

  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  source.connect(filter).connect(env).connect(out);
  source.start(at);
  source.stop(at + duration + 0.02);
}

/** Un arpège : la suite de notes qui dit « tu as gagné ». */
function arpeggio(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  freqs: number[],
  options: { step?: number; duration?: number; type?: OscillatorType; gain?: number } = {},
): void {
  const { step = 0.075, duration = 0.5, type = "triangle", gain = 0.24 } = options;
  freqs.forEach((freq, index) => {
    note(ctx, out, at + index * step, { freq, duration, type, gain });
  });
}

// Gamme de référence : do majeur, en hertz. Nommer les notes évite de recopier
// des fréquences sans savoir ce qu'elles valent les unes par rapport aux autres.
const DO = 523.25;
const MI = 659.25;
const SOL = 783.99;
const DO_AIGU = 1_046.5;
const MI_AIGU = 1_318.5;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const SOUNDS: Record<SoundName, SoundSpec> = {
  /** Le cliquet de la roue : une impulsion sèche, rejouée en décélérant. */
  "roue-cliquet": {
    bus: "effets",
    play: (ctx, out, at) => noise(ctx, out, at, { duration: 0.03, freq: 2_600, q: 6, gain: 0.16 }),
  },

  /** Un jeton posé sur le tapis : l'impact, puis la résonance du disque. */
  jeton: {
    bus: "effets",
    play: (ctx, out, at) => {
      noise(ctx, out, at, { duration: 0.04, freq: 3_200, q: 2, gain: 0.14 });
      note(ctx, out, at, { freq: 1_100, to: 780, duration: 0.09, type: "triangle", gain: 0.1 });
    },
  },

  /** Une carte qui glisse : du souffle, rien de tonal. */
  carte: {
    bus: "effets",
    play: (ctx, out, at) =>
      noise(ctx, out, at, { duration: 0.11, freq: 4_200, q: 0.7, type: "highpass", gain: 0.09 }),
  },

  /** Gain ordinaire : trois notes qui montent, franches et courtes. */
  gain: {
    bus: "effets",
    play: (ctx, out, at) => arpeggio(ctx, out, at, [DO, MI, SOL]),
  },

  /**
   * Gros gain : le même mouvement, prolongé et doublé à l'octave.
   *
   * Distinct du gain ordinaire à l'oreille sans être un son étranger : c'est le
   * même motif, en plus haut et en plus long.
   */
  "gros-gain": {
    bus: "effets",
    play: (ctx, out, at) => {
      arpeggio(ctx, out, at, [DO, MI, SOL, DO_AIGU, MI_AIGU], { step: 0.08, duration: 0.75 });
      arpeggio(ctx, out, at + 0.02, [DO / 2, MI / 2, SOL / 2, DO, MI], {
        step: 0.08,
        duration: 0.85,
        type: "sine",
        gain: 0.13,
      });
    },
  },

  /** Perte : deux notes qui descendent, sourdes, sans agressivité. */
  perte: {
    bus: "effets",
    play: (ctx, out, at) => {
      note(ctx, out, at, { freq: 320, to: 240, duration: 0.22, type: "sine", gain: 0.2 });
      note(ctx, out, at + 0.13, { freq: 240, to: 160, duration: 0.34, type: "sine", gain: 0.17 });
    },
  },

  /** C'est à toi de parler : bref, clair, non anxiogène. */
  tour: {
    bus: "notifications",
    play: (ctx, out, at) => {
      note(ctx, out, at, { freq: SOL, duration: 0.12, type: "triangle", gain: 0.2 });
      note(ctx, out, at + 0.1, { freq: DO_AIGU, duration: 0.16, type: "triangle", gain: 0.16 });
    },
  },

  /** Un message arrive : deux notes douces, plus basses que le tour de parole. */
  notification: {
    bus: "notifications",
    play: (ctx, out, at) => {
      note(ctx, out, at, { freq: MI, duration: 0.14, type: "sine", gain: 0.18 });
      note(ctx, out, at + 0.11, { freq: SOL, duration: 0.2, type: "sine", gain: 0.15 });
    },
  },

  /** Succès débloqué : un arpège plus large, qui ne se confond pas avec un gain. */
  succes: {
    bus: "notifications",
    play: (ctx, out, at) => {
      arpeggio(ctx, out, at, [DO, SOL, DO_AIGU, MI_AIGU], { step: 0.09, duration: 0.9, gain: 0.2 });
      note(ctx, out, at + 0.36, { freq: SOL * 2, duration: 1.1, type: "sine", gain: 0.09 });
    },
  },

  /** Retour d'action : très court, presque subliminal. */
  bouton: {
    bus: "effets",
    play: (ctx, out, at) => noise(ctx, out, at, { duration: 0.02, freq: 1_800, q: 3, gain: 0.08 }),
  },
};

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/**
 * Joue un son. Sans effet tant que le joueur n'a pas fait son premier geste.
 *
 * Ne lève jamais : un son est un ornement, il ne doit casser aucun geste de jeu.
 */
export function playSound(name: SoundName, delayMs = 0): void {
  const engine = audioEngine();
  if (!engine) return;
  if (useAudio.getState().settings.muted) return;

  const spec = SOUNDS[name];
  if (!spec) return;

  try {
    spec.play(engine.ctx, engine.buses[spec.bus], engine.ctx.currentTime + delayMs / 1000);
  } catch {
    // Contexte fermé entre-temps, quota de nœuds atteint : on se tait.
  }
}

/**
 * Le crépitement de la roue : des cliquets de plus en plus espacés.
 *
 * Programmés d'un coup sur la ligne de temps du contexte audio plutôt qu'avec
 * des `setTimeout` : l'horloge audio ne dérive pas, celle des minuteries
 * navigateur si — et un cliquet en retard s'entend immédiatement.
 *
 * @returns le nombre de cliquets posés
 */
export function playWheelTicks(durationMs: number): number {
  const engine = audioEngine();
  if (!engine) return 0;
  if (useAudio.getState().settings.muted) return 0;

  const spec = SOUNDS["roue-cliquet"];
  const out = engine.buses[spec.bus];
  const start = engine.ctx.currentTime;
  const duration = durationMs / 1000;

  let posed = 0;
  let at = 0;
  // L'écart entre deux cliquets croît d'un facteur constant : la roue paraît
  // ralentir, ce qu'elle fait effectivement à l'écran.
  let gap = 0.055;
  while (at < duration && posed < 120) {
    try {
      spec.play(engine.ctx, out, start + at);
    } catch {
      break;
    }
    posed += 1;
    at += gap;
    gap *= 1.075;
  }

  return posed;
}
