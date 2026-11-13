/**
 * Einstellungen des Spielers, die den Neustart überdauern sollen: die Tonregler und die Stelle der Lebensgruppe.
 *
 * Wo sie liegen, versteckt `SettingsStore`: im Browser in `localStorage`, und wo der fehlt oder gesperrt ist
 * (private Fenster, eingebettete Hüllen), nur im Speicher der laufenden Sitzung. Eine Desktop-Fassung kann
 * mit `useSettingsStore` eine Datei an die Stelle setzen, ohne dass sich am Spiel etwas ändert.
 */

import { browserTextStore, type TextStore } from './storage';

export interface SoundSettings {
  /** Reglerstellungen von 0 bis 1. */
  master: number;
  effects: number;
  music: number;
  muted: boolean;
}

/** Die Stellen, an denen die Lebensgruppe (Stufe, Lebensbalken, Gold) stehen kann, in der Reihenfolge der Auswahl. */
export const VITALS_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const;
export type VitalsPosition = (typeof VITALS_POSITIONS)[number];

export interface UiSettings {
  /** Wo die Lebensgruppe auf dem Bildschirm steht. */
  vitalsPosition: VitalsPosition;
}

export interface Settings {
  sound: SoundSettings;
  ui: UiSettings;
}

export type SettingsStore = TextStore;

const KEY = 'dao-survivor.einstellungen';

let store: SettingsStore = browserTextStore(KEY);

/** Ersetzt den Speicher, etwa durch eine Datei in einer Desktop-Hülle. */
export function useSettingsStore(next: SettingsStore): void {
  store = next;
}

function fraction(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVitalsPosition(value: unknown): value is VitalsPosition {
  return VITALS_POSITIONS.some((position) => position === value);
}

/** Liest die gespeicherten Einstellungen; was fehlt oder unbrauchbar ist, bleibt beim Standardwert. */
export function loadSettings(defaults: Settings): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(store.read() ?? '{}');
    if (isRecord(parsed)) stored = parsed;
  } catch {
    // Beschädigter Text: Es gelten die Standardwerte.
  }
  // Ältere Stände kennen `ui` noch nicht; dann gilt der Standardwert.
  const sound = isRecord(stored.sound) ? stored.sound : {};
  const ui = isRecord(stored.ui) ? stored.ui : {};
  const base = defaults.sound;
  return {
    sound: {
      master: fraction(sound.master, base.master),
      effects: fraction(sound.effects, base.effects),
      music: fraction(sound.music, base.music),
      muted: typeof sound.muted === 'boolean' ? sound.muted : base.muted,
    },
    ui: {
      vitalsPosition: isVitalsPosition(ui.vitalsPosition) ? ui.vitalsPosition : defaults.ui.vitalsPosition,
    },
  };
}

export function saveSettings(settings: Settings): void {
  store.write(JSON.stringify(settings));
}
