/**
 * Das Protokoll der gespielten Nächte: Aus jeder Nacht bleibt ein kleiner Datensatz (`RunRecord`) mit der Klasse, der Nachtart und dem
 * Grad, dem Ausgang, der überlebten Zeit, der erreichten Stufe, den gewählten Stärkungen und Segen und den Rängen der Fertigkeiten. Die Statistik
 * (`auswertung.ts`) rechnet daraus; hier wird nur aufgezeichnet, gelesen und gespeichert.
 *
 * Das Protokoll liegt nicht im Spielstand (`savegame.ts`), sondern in einem eigenen Speicher: Es wächst mit jeder Nacht, würde den
 * Spielstand bei jedem Handel im Lager mitschreiben lassen und soll "Neues Spiel" überleben (es ist die Geschichte des Spielers, nicht
 * sein Fortschritt). Wo es liegt, versteckt `TextStore` (siehe `storage.ts`): im Browser in `localStorage`, in einer Desktop-Hülle
 * später etwa in einer Datei; dafür gibt es `useStatistikStore`. Gespeichert wird als JSON mit Versionsnummer.
 *
 * Dieser Teil kennt keine Klassen, Fertigkeiten oder Stärkungen, nur ihre Kennungen als Text. Was das Spiel nicht (mehr) kennt,
 * bleibt im Protokoll stehen; die Anzeige übergeht es.
 *
 * Wer das Format ändert, hebt `STATISTIK_VERSION` an und hebt ältere Stände in `parseRuns` an.
 */

import { browserTextStore, type TextStore } from './storage';

/** Die Fassung des Formats, die dieser Code schreibt. Fassung 2 kam mit der Nachtart und dem Grad dazu (`night`, `grade`). */
export const STATISTIK_VERSION = 2;

/** Wie eine Nacht endete: Sonnenaufgang erlebt, gefallen (auch verstaubt) oder über das Pausenmenü abgebrochen. */
export type RunOutcome = 'won' | 'fallen' | 'aborted';
export const RUN_OUTCOMES: readonly RunOutcome[] = ['won', 'fallen', 'aborted'];

/** Eine gespielte Nacht. */
export interface RunRecord {
  /** Zufällige Kennung dieser Nacht; spätere Fassungen können damit Doppelte erkennen. */
  id: string;
  /** Wann die Nacht endete, in Millisekunden seit 1970. */
  at: number;
  /**
   * Die Fassung des Spiels (aus package.json), damit sich Läufe nach Änderungen am Gleichgewicht trennen lassen. Im Dev-Modus mit
   * der Endung "-dev"; die Sammelstelle zählt solche Nächte nicht mit.
   */
  version: string;
  classId: string;
  /**
   * Die Nachtart (`NightId` aus `game/nights.ts`, hier nur als Text). Leer, wenn sie unbekannt ist: bei Nächten aus den Fassungen
   * 0.21 bis 0.24, die sie nicht festhielten (siehe `legacyNight`). Die Auswertung zählt solche Nächte nur bei der Klasse und
   * insgesamt, nicht bei einer Nachtart.
   */
  night: string;
  /** Der gewählte Grad der Nacht (0 ist der Grundgrad, siehe `game/grade.ts`); 0 auch dort, wo die Nachtart unbekannt ist. */
  grade: number;
  outcome: RunOutcome;
  /** Überlebte Sekunden, ganz; höchstens `CONFIG.run.nightSeconds`. */
  seconds: number;
  /** Die erreichte Stufe am Ende der Nacht. */
  level: number;
  /** Gewählte Stärkungen: Kennung → wie oft (Rang am Ende). Was nie gewählt wurde, fehlt. */
  upgrades: Record<string, number>;
  /** Die gewährten Segen (Kennungen). */
  segen: string[];
  /** Die Fertigkeiten der Klasse mit ihrem Rang am Ende: Kennung → Rang (6 ist die Evolution). Was nie gewählt wurde, fehlt. */
  skills: Record<string, number>;
}

/** Obergrenze für die gespeicherten Nächte; die ältesten fallen heraus. Bei etwa 350 Byte je Nacht bleibt der Speicher unter einem Megabyte. */
export const MAX_RUNS = 2000;

/** Obergrenzen beim Lesen; schützen vor Unsinn in einer von Hand bearbeiteten Datei, das Spiel selbst kennt weniger. */
const MAX_ID_LENGTH = 64;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_LEVEL = 999;
/** Wie `CONFIG.grade.max` und die Prüfregel für `grade` in `tools/supabase/statistik.sql`. */
const MAX_GRADE = 99;
const MAX_COUNT = 99;
const MAX_ENTRIES = 64;

export type StatistikStore = TextStore;

const KEY = 'dao-survivor.statistik';

let store: StatistikStore = browserTextStore(KEY);

/** Ersetzt den Speicher, etwa durch eine Datei in einer Desktop-Hülle. */
export function useStatistikStore(next: StatistikStore): void {
  store = next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
}

function shortText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

/** Die Kennung der gewöhnlichen Nacht (`USUAL_NIGHT` in `game/nights.ts`); der Kern kennt sonst keine Nachtarten. */
const USUAL_NIGHT_ID = 'gewoehnlich';

/** Seit dieser Fassung (Haupt- und Nebenzahl) gibt es Nachtarten; Fassung 0.21.0 brachte Rotnacht, Blaunacht und Regenlicht. */
const NIGHTS_SINCE: readonly [number, number] = [0, 21];

/**
 * Die Nachtart einer Nacht, die sie nicht festhielt (Protokoll der Fassung 1): Vor den Nachtarten war jede Nacht eine gewöhnliche im
 * Grad 0, das sagt die Fassung des Spiels. Aus den Fassungen danach ist die Nachtart nicht mehr zu erraten; sie bleibt leer.
 */
function legacyNight(version: string): string {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  if (!match) return '';
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [sinceMajor, sinceMinor] = NIGHTS_SINCE;
  return major < sinceMajor || (major === sinceMajor && minor < sinceMinor) ? USUAL_NIGHT_ID : '';
}

/** Kennung → Zahl (mindestens 1); Einträge ohne gültige Kennung oder mit 0 fallen weg. */
function parseCounts(raw: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!isRecord(raw)) return counts;
  for (const [id, value] of Object.entries(raw).slice(0, MAX_ENTRIES)) {
    const count = wholeNumber(value, MAX_COUNT);
    if (count > 0 && id.length > 0 && id.length <= MAX_ID_LENGTH) counts[id] = count;
  }
  return counts;
}

function parseRun(raw: unknown): RunRecord | null {
  if (!isRecord(raw)) return null;
  const id = shortText(raw.id);
  const classId = shortText(raw.classId);
  const outcome = RUN_OUTCOMES.find((candidate) => candidate === raw.outcome);
  if (!id || !classId || !outcome) return null;
  const version = typeof raw.version === 'string' ? raw.version.slice(0, 20) : '';
  // Fassung 1 des Protokolls kennt die Nachtart nicht (siehe `legacyNight`); ohne Nachtart gibt es auch keinen Grad.
  const night = shortText(raw.night) ?? legacyNight(version);
  return {
    id,
    at: wholeNumber(raw.at, Number.MAX_SAFE_INTEGER),
    version,
    classId,
    night,
    grade: night ? wholeNumber(raw.grade, MAX_GRADE) : 0,
    outcome,
    seconds: wholeNumber(raw.seconds, MAX_SECONDS),
    level: Math.max(1, wholeNumber(raw.level, MAX_LEVEL)),
    upgrades: parseCounts(raw.upgrades),
    segen: Array.isArray(raw.segen)
      ? raw.segen.flatMap((entry) => shortText(entry) ?? []).slice(0, MAX_ENTRIES)
      : [],
    skills: parseCounts(raw.skills),
  };
}

/** Macht aus gespeichertem Text die Liste der Nächte; unbrauchbare Einträge fallen weg, ein unlesbarer Text ergibt eine leere Liste. */
export function parseRuns(text: string | null): RunRecord[] {
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Beschädigter Text: Das Protokoll beginnt leer. Überschrieben wird erst, wenn die nächste Nacht endet.
    return [];
  }
  // Fassung 1 ist die erste, Fassung 2 fügt Nachtart und Grad hinzu. Fehlen sie, hebt `parseRun` den Eintrag an; das Format der Liste
  // selbst blieb gleich, darum genügt es, die Einträge einzeln zu lesen.
  if (!isRecord(parsed) || !Array.isArray(parsed.runs)) return [];
  const runs: RunRecord[] = [];
  for (const raw of parsed.runs.slice(-MAX_RUNS)) {
    const run = parseRun(raw);
    if (run) runs.push(run);
  }
  return runs;
}

/** Alle gespeicherten Nächte, die älteste zuerst. */
export function loadRuns(): RunRecord[] {
  return parseRuns(store.read());
}

/** Hängt eine Nacht an das Protokoll an; jenseits von `MAX_RUNS` fallen die ältesten heraus. */
export function recordRun(run: RunRecord): void {
  const runs = loadRuns();
  runs.push(run);
  store.write(JSON.stringify({ version: STATISTIK_VERSION, runs: runs.slice(-MAX_RUNS) }));
}

let fallbackCounter = 0;

/**
 * Eine neue zufällige Kennung (UUID, Fassung 4). Sie kommt vom Zufallsgenerator des Browsers, nicht aus `random.ts`: Die Kennung
 * gehört nicht zur Welt, und gleiche Kennungen aus gleichem Samen wären gerade falsch. Ohne `crypto` (eingebettete Hüllen) bleibt
 * eine aus Uhrzeit und Zähler; sie muss nur innerhalb dieses Protokolls eindeutig sein.
 */
export function newRunId(): string {
  try {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    // Fassung 4 und Variante 1 der UUID.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    fallbackCounter++;
    return `lokal-${Date.now().toString(36)}-${fallbackCounter}`;
  }
}
