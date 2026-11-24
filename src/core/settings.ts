/**
 * Einstellungen des Spielers, die den Neustart überdauern sollen: die Tonregler, die Stelle der Lebensgruppe, das Aussehen der
 * Klassen (Mann oder Frau) und ob die Statistik anonym an die Sammelstelle gehen darf.
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

/**
 * Das Aussehen einer Klasse: `'m'` der Mann, `'w'` die Frau. Es ändert Figur, Namen und Texte, nie Werte, Gegenstände oder
 * Statistik; die Klasse bleibt dieselbe. Die Wahl ist eine Einstellung und kein Fortschritt, darum liegt sie hier und nicht im Spielstand.
 */
export const LOOKS = ['m', 'w'] as const;
export type Look = (typeof LOOKS)[number];

export interface UiSettings {
  /** Wo die Lebensgruppe auf dem Bildschirm steht. */
  vitalsPosition: VitalsPosition;
  /** Das gewählte Aussehen je Klasse (nach `ClassId`); eine Klasse ohne Eintrag zeigt den Mann. */
  looks: Record<string, Look>;
}

export interface DataSettings {
  /**
   * Meldet das Spiel jede Nacht anonym an die Sammelstelle der Statistik (`core/sammelstelle.ts`)? Standardmäßig ja, ohne Rückfrage;
   * wer nicht will, schaltet es in den Optionen ab. Ein früher gespeichertes `null` (noch nicht entschieden, so fragte Fassung 0.17.0)
   * zählt wie nicht gespeichert, also ja; ein gespeichertes `false` bleibt.
   */
  share: boolean;
  /**
   * Hat der Spieler den Hinweis zur anonymen Statistik schon gesehen? Das Spiel blendet ihn einmal beim Start ein (`Game.showDataNotice`),
   * auch bei Spielern, die in Fassung 0.17.0 noch gefragt wurden und deren Einstellungen diesen Merker nicht kennen.
   */
  noticeSeen: boolean;
}

export interface Settings {
  sound: SoundSettings;
  ui: UiSettings;
  data: DataSettings;
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

function isLook(value: unknown): value is Look {
  return LOOKS.some((look) => look === value);
}

/** Übernimmt nur Einträge mit bekanntem Aussehen. Klassen, die das Spiel nicht (mehr) kennt, bleiben stehen und schaden nicht. */
function readLooks(value: unknown): Record<string, Look> {
  const looks: Record<string, Look> = {};
  if (isRecord(value)) for (const [id, look] of Object.entries(value)) if (isLook(look)) looks[id] = look;
  return looks;
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
  // Ältere Stände kennen `ui` und `data` noch nicht; dann gilt der Standardwert.
  const sound = isRecord(stored.sound) ? stored.sound : {};
  const ui = isRecord(stored.ui) ? stored.ui : {};
  const data = isRecord(stored.data) ? stored.data : {};
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
      // Ältere Stände kennen das Aussehen noch nicht; dann zeigt jede Klasse den Mann.
      looks: ui.looks === undefined ? { ...defaults.ui.looks } : readLooks(ui.looks),
    },
    data: {
      share: typeof data.share === 'boolean' ? data.share : defaults.data.share,
      noticeSeen: typeof data.noticeSeen === 'boolean' ? data.noticeSeen : defaults.data.noticeSeen,
    },
  };
}

export function saveSettings(settings: Settings): void {
  store.write(JSON.stringify(settings));
}
