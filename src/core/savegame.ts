/**
 * Der Spielstand, der den Neustart überdauern soll: das Gold und die Ränge der Steigerungen jeder Klasse.
 *
 * Wo er liegt, versteckt `TextStore` (siehe `storage.ts`): im Browser in `localStorage`, in einer Desktop-Hülle
 * später etwa in einer Datei; dafür gibt es `useSavegameStore`. Gespeichert wird als JSON mit Versionsnummer.
 *
 * Neue Fassungen des Formats heben ältere Stände in `parseSavegame` an, Schritt für Schritt von der alten zur nächsten
 * Nummer; so geht beim Umbau von Steigerungen kein Gold verloren. Dieser Teil kennt keine Klassen und Steigerungen
 * und behält darum auch Einträge, die das Spiel gerade nicht kennt (etwa nach einem Rückschritt auf eine ältere Fassung):
 * Sie werden nicht angezeigt, aber auch nicht gelöscht.
 */

import { browserTextStore, type TextStore } from './storage';

/** Die Fassung des Formats, die dieser Code schreibt. */
export const SAVEGAME_VERSION = 1;

/** Obergrenze für einen Rang beim Lesen; schützt vor Unsinn in einer von Hand bearbeiteten Datei. */
const MAX_STORED_RANK = 99;

export interface Savegame {
  version: number;
  /** Gold in der Geldbörse; sie gehört allen Klassen gemeinsam. */
  gold: number;
  /** Rang jeder Steigerung je Klasse: `ranks[klasse][steigerung]`. */
  ranks: Record<string, Record<string, number>>;
}

export type SavegameStore = TextStore;

const KEY = 'dao-survivor.spielstand';

let store: SavegameStore = browserTextStore(KEY);

/** Ersetzt den Speicher, etwa durch eine Datei in einer Desktop-Hülle. */
export function useSavegameStore(next: SavegameStore): void {
  store = next;
}

export function emptySavegame(): Savegame {
  return { version: SAVEGAME_VERSION, gold: 0, ranks: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
}

/** Macht aus gespeichertem Text einen Spielstand; was fehlt oder unbrauchbar ist, fängt bei null an. */
export function parseSavegame(text: string | null): Savegame {
  const save = emptySavegame();
  if (text === null) return save;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Beschädigter Text: Es beginnt ein leerer Stand. Überschrieben wird erst beim nächsten Speichern.
    return save;
  }
  if (!isRecord(raw)) return save;

  // Hier kämen die Schritte älterer Fassungen hin (`if (version < 2) raw = von1auf2(raw)` …). Es gibt noch keine.
  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) {
    // Ein Stand aus einer neueren Fassung wird so gut gelesen wie möglich, seine Nummer aber nicht zurückgesetzt.
    save.version = Math.max(SAVEGAME_VERSION, Math.floor(raw.version));
  }
  save.gold = wholeNumber(raw.gold, Number.MAX_SAFE_INTEGER);
  if (isRecord(raw.ranks)) {
    for (const [classId, perClass] of Object.entries(raw.ranks)) {
      if (!isRecord(perClass)) continue;
      const ranks: Record<string, number> = {};
      for (const [id, rank] of Object.entries(perClass)) {
        const whole = wholeNumber(rank, MAX_STORED_RANK);
        if (whole > 0) ranks[id] = whole;
      }
      save.ranks[classId] = ranks;
    }
  }
  return save;
}

/** Liest den gespeicherten Stand; ohne oder mit unbrauchbarem Stand ein leerer. */
export function loadSavegame(): Savegame {
  return parseSavegame(store.read());
}

export function writeSavegame(save: Savegame): void {
  store.write(JSON.stringify(save));
}
