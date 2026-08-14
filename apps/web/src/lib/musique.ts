/**
 * La musique de fond : une **zone par jeu**, plusieurs pistes par zone.
 *
 * Deux contraintes façonnent ce module.
 *
 * 1. **Un navigateur ne sait pas lister un dossier.** Les pistes sont donc
 *    déclarées dans `public/sons/musique/pistes.json`, un fichier que
 *    l'exploitant tient à jour en même temps qu'il dépose ses fichiers. Sonder
 *    des noms numérotés jusqu'au premier 404 aurait évité ce fichier, au prix
 *    d'une volée de requêtes en erreur à chaque chargement.
 * 2. **Rien n'est livré avec le dépôt.** Manifeste absent, zone vide, fichier
 *    introuvable : dans les trois cas le site fonctionne en silence et l'écran
 *    de réglages le dit, au lieu de laisser croire à une panne.
 *
 * Un `HTMLAudioElement` plutôt que Web Audio : le chargement est progressif, et
 * la fin d'une piste se signale par un `ended` propre — ce dont on a besoin pour
 * enchaîner sur la suivante.
 */

import { GAME_CODES, type GameCode } from "@maxoujeux/shared";
import { create } from "zustand";
import { effectiveVolume, useAudio } from "./audio";
import { useRouteStore, type Route } from "./route";

/**
 * Une zone musicale : le lobby, ou l'un des neuf jeux.
 *
 * Un dossier par jeu et non par famille : rien n'oblige à distinguer le Plinko
 * de la machine à sous, mais rien n'empêche non plus de le faire le jour où on
 * en a envie. Une zone sans piste retombe sur celle du lobby.
 */
export const MUSIC_ZONES = ["lobby", ...GAME_CODES] as const;

export type MusicZone = (typeof MUSIC_ZONES)[number];

/** Ce que déclare `pistes.json` : une zone, ses fichiers. */
export type MusicManifest = Partial<Record<MusicZone, string[]>>;

const MANIFEST_URL = "/sons/musique/pistes.json";

/** Durée du fondu enchaîné. Une coupure nette s'entend plus que la musique. */
const FADE_MS = 800;
const FADE_STEP_MS = 40;

function isZone(value: string): value is MusicZone {
  return (MUSIC_ZONES as readonly string[]).includes(value);
}

/**
 * Nettoie le manifeste lu sur le réseau.
 *
 * Fonction pure, donc testable : c'est la seule porte d'entrée d'un fichier que
 * l'exploitant écrit à la main, et une virgule de trop ne doit pas priver tout
 * le site de musique.
 */
export function parseManifest(raw: unknown): MusicManifest {
  if (typeof raw !== "object" || raw === null) return {};

  const manifest: MusicManifest = {};
  for (const [zone, pistes] of Object.entries(raw as Record<string, unknown>)) {
    if (!isZone(zone) || !Array.isArray(pistes)) continue;
    const fichiers = pistes.filter(
      (piste): piste is string => typeof piste === "string" && piste.trim().length > 0,
    );
    if (fichiers.length > 0) manifest[zone] = fichiers;
  }
  return manifest;
}

/**
 * La zone d'une route.
 *
 * Les écrans hors jeu — lobby, classements, succès, profil, mon compte —
 * partagent la même ambiance : ce sont les couloirs du casino, pas ses salles.
 */
export function zoneForRoute(route: Route, game: GameCode | null): MusicZone {
  if (route.name === "salon") return route.game;
  if (route.name === "table") return game ?? "lobby";
  return "lobby";
}

/**
 * Les pistes réellement jouables pour une zone.
 *
 * Une zone sans dossier garni retombe sur le lobby : c'est ce qui permet de
 * démarrer avec deux ou trois morceaux sans devoir en trouver dix.
 */
export function tracksFor(manifest: MusicManifest, zone: MusicZone): string[] {
  const propres = manifest[zone];
  if (propres && propres.length > 0) return propres;
  return manifest.lobby ?? [];
}

/** Chemin d'un fichier de piste. */
export function trackUrl(zone: MusicZone, fichier: string): string {
  return `/sons/musique/${zone}/${encodeURIComponent(fichier)}`;
}

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

interface MusicState {
  manifest: MusicManifest;
  /** Le manifeste a-t-il été cherché ? Évite de le redemander à chaque écran. */
  loaded: boolean;
  zone: MusicZone | null;
  /** Fichier en cours, pour l'afficher si on veut un jour le montrer. */
  piste: string | null;
}

export const useMusic = create<MusicState>(() => ({
  manifest: {},
  loaded: false,
  zone: null,
  piste: null,
}));

/** Aucune piste déclarée nulle part : l'écran de réglages le mentionne. */
export function noMusicInstalled(): boolean {
  const { manifest, loaded } = useMusic.getState();
  return loaded && Object.keys(manifest).length === 0;
}

let manifestPromise: Promise<void> | null = null;

/** Charge le manifeste une seule fois, quoi qu'il arrive ensuite. */
function loadManifest(): Promise<void> {
  if (manifestPromise) return manifestPromise;

  manifestPromise = fetch(MANIFEST_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((raw) => {
      useMusic.setState({ manifest: parseManifest(raw), loaded: true });
    })
    .catch(() => {
      // Fichier absent ou illisible : pas de musique, et on n'y revient pas.
      useMusic.setState({ manifest: {}, loaded: true });
    });

  return manifestPromise;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

let current: HTMLAudioElement | null = null;
let currentZone: MusicZone | null = null;
/** File mélangée de la zone : on l'épuise avant de la rebattre. */
let file: string[] = [];
let fadeTimer: ReturnType<typeof setInterval> | null = null;

function stopFade(): void {
  if (fadeTimer !== null) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

/**
 * Fait glisser le volume d'un élément, puis exécute la suite.
 *
 * Par paliers de 40 ms : sous le seuil où l'oreille perçoit des marches, et bien
 * au-dessus de ce qui coûterait quoi que ce soit au processeur.
 */
function fade(element: HTMLAudioElement, to: number, done?: () => void): void {
  stopFade();
  const from = element.volume;
  const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
  let step = 0;

  fadeTimer = setInterval(() => {
    step += 1;
    const ratio = Math.min(1, step / steps);
    element.volume = Math.min(1, Math.max(0, from + (to - from) * ratio));
    if (ratio >= 1) {
      stopFade();
      done?.();
    }
  }, FADE_STEP_MS);
}

/**
 * Mélange une liste. Fisher-Yates, sans surprise.
 *
 * Exporté pour que la file d'attente reste testable : c'est elle qui garantit
 * qu'on entend toutes les pistes d'une zone avant d'en réentendre une.
 */
export function melanger<T>(items: readonly T[]): T[] {
  const copie = [...items];
  for (let index = copie.length - 1; index > 0; index -= 1) {
    const tirage = Math.floor(Math.random() * (index + 1));
    [copie[index], copie[tirage]] = [copie[tirage]!, copie[index]!];
  }
  return copie;
}

function arreterCourante(fondu: boolean): void {
  const sortante = current;
  current = null;
  if (!sortante) return;

  if (!fondu) {
    sortante.pause();
    sortante.src = "";
    return;
  }
  fade(sortante, 0, () => {
    sortante.pause();
    sortante.src = "";
  });
}

/** Lance la piste suivante de la file de la zone en cours. */
function jouerSuivante(fondu: boolean): void {
  const zone = currentZone;
  if (zone === null) return;

  const pistes = tracksFor(useMusic.getState().manifest, zone);
  if (pistes.length === 0) {
    useMusic.setState({ piste: null });
    return;
  }

  // File épuisée : on rebat les cartes. Sur une zone à une seule piste, cela
  // revient à la rejouer — ce qui est exactement le comportement attendu.
  if (file.length === 0) file = melanger(pistes);
  const fichier = file.shift();
  if (!fichier) return;

  const sortante = current;
  const entrante = new Audio(trackUrl(zone, fichier));
  entrante.volume = 0;
  entrante.preload = "auto";

  entrante.addEventListener(
    "error",
    () => {
      // Fichier déclaré mais absent : on passe au suivant plutôt que de laisser
      // la zone muette à cause d'une faute de frappe dans le manifeste.
      if (current !== entrante) return;
      current = null;
      jouerSuivante(false);
    },
    { once: true },
  );

  // Pas de `loop` : c'est l'enchaînement qui fait tourner la zone, et c'est ce
  // qui permet d'y mettre plusieurs morceaux.
  entrante.addEventListener("ended", () => {
    if (current !== entrante) return;
    current = null;
    jouerSuivante(false);
  });

  current = entrante;
  useMusic.setState({ piste: fichier });

  void entrante
    .play()
    .then(() => fade(entrante, effectiveVolume("musique")))
    .catch(() => {
      // Refus d'autoplay : la zone repartira au prochain geste du joueur.
      if (current === entrante) current = null;
    });

  if (sortante && fondu) {
    fade(sortante, 0, () => {
      sortante.pause();
      sortante.src = "";
    });
  } else if (sortante) {
    sortante.pause();
    sortante.src = "";
  }
}

/** Bascule sur une zone. Sans effet si elle est déjà en cours. */
export function playZone(zone: MusicZone): void {
  useMusic.setState({ zone });

  if (!useAudio.getState().ready) return;

  void loadManifest().then(() => {
    // La zone a pu changer pendant le chargement du manifeste.
    if (useMusic.getState().zone !== zone) return;
    if (currentZone === zone && current) {
      if (!fadeTimer) current.volume = effectiveVolume("musique");
      return;
    }

    currentZone = zone;
    file = [];
    jouerSuivante(true);
  });
}

/** Réaligne le volume de la piste en cours sur les réglages. */
export function syncMusicVolume(): void {
  if (!current || fadeTimer) return;
  const volume = effectiveVolume("musique");
  current.volume = volume;
  // Coupure générale ou volume à zéro : on met en pause plutôt que de laisser
  // tourner un flux muet, qui consommerait pour rien sur un téléphone.
  if (volume === 0) current.pause();
  else if (current.paused) void current.play().catch(() => undefined);
}

/** Passe à la piste suivante de la zone. Utile depuis les réglages. */
export function nextTrack(): void {
  if (currentZone === null) return;
  jouerSuivante(true);
}

/** Arrête tout. */
export function stopMusic(): void {
  stopFade();
  arreterCourante(false);
  currentZone = null;
  file = [];
  useMusic.setState({ zone: null, piste: null });
}

/**
 * Branche la musique sur la navigation et sur les réglages.
 *
 * Enregistré **une seule fois**, hors de React : la musique doit survivre à un
 * changement d'écran, et un `useEffect` la couperait à chaque démontage.
 */
export function bindMusic(gameOf: () => GameCode | null): () => void {
  const suivre = () => playZone(zoneForRoute(useRouteStore.getState().route, gameOf()));

  const desabonnerRoute = useRouteStore.subscribe(suivre);
  const desabonnerAudio = useAudio.subscribe((state, previous) => {
    // Le premier geste du joueur débloque la lecture : c'est là que la musique
    // démarre réellement, jamais au chargement de la page.
    if (state.ready && !previous.ready) suivre();
    else syncMusicVolume();
  });

  suivre();

  return () => {
    desabonnerRoute();
    desabonnerAudio();
    stopMusic();
  };
}

/** Remise à zéro. Réservé aux tests. */
export function resetMusicForTests(): void {
  stopFade();
  current = null;
  currentZone = null;
  file = [];
  manifestPromise = null;
  useMusic.setState({ manifest: {}, loaded: false, zone: null, piste: null });
}
