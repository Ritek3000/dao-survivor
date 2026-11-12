/**
 * Einstellungen des Spielers, die den Neustart überdauern sollen (bisher die Tonregler).
 *
 * Wo sie liegen, versteckt `SettingsStore`: im Browser in `localStorage`, und wo der fehlt oder gesperrt ist
 * (private Fenster, eingebettete Hüllen), nur im Speicher der laufenden Sitzung. Eine Desktop-Fassung kann
 * mit `useSettingsStore` eine Datei an die Stelle setzen, ohne dass sich am Spiel etwas ändert.
 */

export interface SoundSettings {
  /** Reglerstellungen von 0 bis 1. */
  master: number;
  effects: number;
  music: number;
  muted: boolean;
}

export interface Settings {
  sound: SoundSettings;
}

export interface SettingsStore {
  read(): string | null;
  write(text: string): void;
}

const KEY = 'dao-survivor.einstellungen';

function browserStore(): SettingsStore {
  const memory: { text: string | null } = { text: null };
  return {
    read() {
      try {
        return window.localStorage.getItem(KEY) ?? memory.text;
      } catch {
        return memory.text;
      }
    },
    write(text) {
      memory.text = text;
      try {
        window.localStorage.setItem(KEY, text);
      } catch {
        // Gesperrt oder voll: Die Einstellung gilt dann nur bis zum Schließen der Seite.
      }
    },
  };
}

let store: SettingsStore = browserStore();

/** Ersetzt den Speicher, etwa durch eine Datei in einer Desktop-Hülle. */
export function useSettingsStore(next: SettingsStore): void {
  store = next;
}

function fraction(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/** Liest die gespeicherten Einstellungen; was fehlt oder unbrauchbar ist, bleibt beim Standardwert. */
export function loadSettings(defaults: Settings): Settings {
  let stored: Partial<Record<keyof SoundSettings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(store.read() ?? '{}');
    const sound = typeof parsed === 'object' && parsed !== null ? (parsed as { sound?: unknown }).sound : null;
    if (typeof sound === 'object' && sound !== null) stored = sound;
  } catch {
    // Beschädigter Text: Es gelten die Standardwerte.
  }
  const base = defaults.sound;
  return {
    sound: {
      master: fraction(stored.master, base.master),
      effects: fraction(stored.effects, base.effects),
      music: fraction(stored.music, base.music),
      muted: typeof stored.muted === 'boolean' ? stored.muted : base.muted,
    },
  };
}

export function saveSettings(settings: Settings): void {
  store.write(JSON.stringify(settings));
}
