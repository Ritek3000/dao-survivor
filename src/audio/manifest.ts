/**
 * Die Zuordnungsliste public/audio/audio.json: welches Ereignis mit welcher Datei klingt.
 * Wer einen Klang austauschen will, ändert nur diese Datei oder ersetzt die Audiodatei selbst;
 * am Code ändert sich nichts. Die Felder sind in der README beschrieben (Abschnitt "Ton und Musik").
 *
 * Das Lesen ist nachsichtig: Ein fehlerhafter Eintrag wird gemeldet und übersprungen, der Rest gilt weiter.
 */
import { CONFIG } from '../config';

/** Ein Ereignis, das einmal klingt. */
export interface SoundEntry {
  /** Pfade relativ zu public/audio. Bei mehreren wird bei jedem Abspielen eine zufällig gewählt. */
  files: string[];
  /** Faktor auf die Lautstärke, 1 = unverändert. */
  volume: number;
  /** Zufällige Abweichung der Tonhöhe in Cent (hundertstel Halbtöne), damit Wiederholungen nicht gleich klingen. */
  jitter: number;
  /** Mindestabstand in Sekunden zwischen zwei Wiedergaben; schützt vor Dauerfeuer bei Treffern. */
  gap: number;
  /** Reichweite in Metern für Töne mit Ort. */
  range: number;
  /** 0 = Nebensache (Schritte, Treffer), 3 = muss klingen. Bei Andrang verdrängt Wichtiges Unwichtiges. */
  priority: number;
}

/** Ein Dauerklang, dessen Lautstärke das Spiel führt (Feuer, Wind, Finsternis). */
export interface LoopEntry {
  file: string;
  volume: number;
  range: number;
}

export interface MusicEntry {
  file: string;
  volume: number;
  /** Aus: Das Stück spielt einmal und endet (Stücke zum Ende der Nacht). */
  loop: boolean;
  /** Sekunden, in denen das Stück eingeblendet wird und das vorige ausblendet. */
  fade: number;
}

export interface Manifest {
  sounds: Map<string, SoundEntry>;
  loops: Map<string, LoopEntry>;
  music: Map<string, MusicEntry>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Ein Pfad in audio.json gilt immer relativ zum Audio-Ordner, nie absolut. */
function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/^(\.?\/)+/, '');
  return path === '' ? null : path;
}

function files(entry: Record<string, unknown>): string[] {
  const raw = entry.datei;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(cleanPath).filter((path): path is string => path !== null);
}

function section(root: Record<string, unknown>, name: string): Record<string, unknown> {
  const found = record(root[name]);
  if (!found) console.warn(`Audio: In audio.json fehlt der Abschnitt "${name}".`);
  return found ?? {};
}

/** Prüft den Inhalt von audio.json und macht daraus nachgeschlagene Einträge. */
export function parseManifest(json: unknown): Manifest {
  const root = record(json);
  if (!root) throw new Error('audio.json hat nicht die Form eines Objekts.');
  const manifest: Manifest = { sounds: new Map(), loops: new Map(), music: new Map() };
  const range = CONFIG.audio.range;

  for (const [id, raw] of Object.entries(section(root, 'ereignisse'))) {
    const entry = record(raw);
    const list = entry ? files(entry) : [];
    if (!entry || list.length === 0) {
      console.warn(`Audio: Ereignis "${id}" in audio.json hat keine Datei und wird übersprungen.`);
      continue;
    }
    manifest.sounds.set(id, {
      files: list,
      volume: num(entry.lautstaerke, 1, 0, 4),
      jitter: num(entry.streuung, 0, 0, 1200),
      gap: num(entry.abstand, 0, 0, 30),
      range: num(entry.reichweite, range, 1, 500),
      priority: Math.round(num(entry.prioritaet, 1, 0, 3)),
    });
  }

  for (const [id, raw] of Object.entries(section(root, 'schleifen'))) {
    const entry = record(raw);
    const [file] = entry ? files(entry) : [];
    if (!entry || !file) {
      console.warn(`Audio: Dauerklang "${id}" in audio.json hat keine Datei und wird übersprungen.`);
      continue;
    }
    manifest.loops.set(id, { file, volume: num(entry.lautstaerke, 1, 0, 4), range: num(entry.reichweite, range, 1, 500) });
  }

  for (const [id, raw] of Object.entries(section(root, 'musik'))) {
    const entry = record(raw);
    const [file] = entry ? files(entry) : [];
    if (!entry || !file) {
      console.warn(`Audio: Musikstück "${id}" in audio.json hat keine Datei und wird übersprungen.`);
      continue;
    }
    manifest.music.set(id, {
      file,
      volume: num(entry.lautstaerke, 1, 0, 4),
      loop: entry.schleife !== false,
      fade: num(entry.einblenden, CONFIG.audio.music.fade, 0, 30),
    });
  }
  return manifest;
}

/** Adresse einer Datei im Audio-Ordner; über BASE_URL, damit der Build mit relativen Pfaden läuft. */
export function audioUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${CONFIG.audio.folder}${path.split('/').map(encodeURIComponent).join('/')}`;
}
