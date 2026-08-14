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

/**
 * Ce dont un fondu a besoin.
 *
 * Structurel plutôt que `HTMLAudioElement` : c'est ce qui rend le mécanisme
 * testable sans navigateur, et il n'utilise effectivement rien d'autre.
 */
export interface Fadable {
  volume: number;
}

/** Les fondus en cours, un par élément. Voir `fade`. */
const fades = new Map<Fadable, ReturnType<typeof setInterval>>();

/** Interrompt le fondu d'un élément, sans toucher à ceux des autres. */
export function stopFade(element: Fadable): void {
  const timer = fades.get(element);
  if (timer === undefined) return;
  clearInterval(timer);
  fades.delete(element);
}

/** Un fondu court-il sur cet élément ? */
export function isFading(element: Fadable): boolean {
  return fades.has(element);
}

function stopAllFades(): void {
  for (const timer of fades.values()) clearInterval(timer);
  fades.clear();
}

/**
 * Fait glisser le volume d'un élément, puis exécute la suite.
 *
 * Par paliers de 40 ms : sous le seuil où l'oreille perçoit des marches, et bien
 * au-dessus de ce qui coûterait quoi que ce soit au processeur.
 *
 * **Un fondu par élément, et non un fondu à la fois.** Un fondu enchaîné en fait
 * courir deux de front : celui qui monte et celui qui descend. Avec une seule
 * minuterie partagée, le second annulait le premier, dont la suite — mettre la
 * piste sortante en pause — n'était jamais exécutée. La piste restait audible
 * pour toujours, hors d'atteinte du volume et de la coupure, et chaque
 * changement d'écran en ajoutait une.
 */
export function fade(element: Fadable, to: number, done?: () => void): void {
  stopFade(element);
  const from = element.volume;
  const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
  let step = 0;

  const timer = setInterval(() => {
    step += 1;
    const ratio = Math.min(1, step / steps);
    element.volume = Math.min(1, Math.max(0, from + (to - from) * ratio));
    if (ratio >= 1) {
      stopFade(element);
      done?.();
    }
  }, FADE_STEP_MS);

  fades.set(element, timer);
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

/**
 * Éteint une piste : fondu jusqu'au silence, puis arrêt franc.
 *
 * L'arrêt est **dans la suite du fondu**, jamais à côté : c'est ce qui garantit
 * qu'aucun élément ne reste en lecture derrière le dos du reste du module.
 */
function eteindre(element: HTMLAudioElement, fondu: boolean): void {
  const couper = () => {
    element.pause();
    // `removeAttribute` puis `load` et non `src = ""` : une source vide se
    // résout en l'adresse de la page courante, que le navigateur tenterait alors
    // de décoder comme un fichier audio. C'est la façon prévue de relâcher le
    // flux et la mémoire qu'il occupe.
    element.removeAttribute("src");
    element.load();
    stopFade(element);
  };

  if (!fondu) {
    couper();
    return;
  }
  fade(element, 0, couper);
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
    .then(() => {
      // Le joueur a pu changer d'écran, ou couper le son, pendant que le
      // navigateur ouvrait le fichier.
      if (current !== entrante) return;
      const volume = effectiveVolume("musique");
      if (volume === 0) entrante.pause();
      else fade(entrante, volume);
    })
    .catch(() => {
      // Refus d'autoplay : la zone repartira au prochain geste du joueur.
      if (current === entrante) current = null;
    });

  // La piste sortante s'éteint pour son propre compte : son fondu a désormais sa
  // minuterie, celui de l'entrante ne peut plus l'interrompre.
  if (sortante) eteindre(sortante, fondu);
}

/** Bascule sur une zone. Sans effet si elle est déjà en cours. */
export function playZone(zone: MusicZone): void {
  useMusic.setState({ zone });

  if (!useAudio.getState().ready) return;

  void loadManifest().then(() => {
    // La zone a pu changer pendant le chargement du manifeste.
    if (useMusic.getState().zone !== zone) return;
    if (currentZone === zone && current) {
      if (!isFading(current)) current.volume = effectiveVolume("musique");
      return;
    }

    currentZone = zone;
    file = [];
    jouerSuivante(true);
  });
}

/**
 * Réaligne le volume de la piste en cours sur les réglages.
 *
 * **Le fondu en cours est interrompu**, et non attendu : un geste explicite du
 * joueur prime sur une transition automatique. Attendre la fin du fondu — ce que
 * faisait la première version — rendait le curseur et la coupure sans effet
 * pendant les huit dixièmes de seconde qui suivent un changement d'écran, et le
 * fondu ramenait ensuite le volume qu'on venait de quitter.
 */
export function syncMusicVolume(): void {
  if (!current) return;
  stopFade(current);

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

/** Arrête tout, sans fondu et sans laisser de minuterie derrière. */
export function stopMusic(): void {
  stopAllFades();
  if (current) eteindre(current, false);
  current = null;
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
  stopAllFades();
  current = null;
  currentZone = null;
  file = [];
  manifestPromise = null;
  useMusic.setState({ manifest: {}, loaded: false, zone: null, piste: null });
}
