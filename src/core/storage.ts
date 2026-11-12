/**
 * Ablage für einen kurzen Text unter einem festen Schlüssel. Einstellungen und Spielstand liegen je in einer eigenen.
 *
 * Im Browser ist es `localStorage`; wo der fehlt oder gesperrt ist (private Fenster, eingebettete Hüllen),
 * gilt der Text nur im Speicher der laufenden Sitzung. Eine Desktop-Fassung setzt eine Datei an die Stelle,
 * ohne dass sich am Spiel etwas ändert (siehe `useSettingsStore` und `useSavegameStore`).
 */
export interface TextStore {
  read(): string | null;
  write(text: string): void;
}

export function browserTextStore(key: string): TextStore {
  const memory: { text: string | null } = { text: null };
  return {
    read() {
      try {
        return window.localStorage.getItem(key) ?? memory.text;
      } catch {
        return memory.text;
      }
    },
    write(text) {
      memory.text = text;
      try {
        window.localStorage.setItem(key, text);
      } catch {
        // Gesperrt oder voll: Der Text gilt dann nur bis zum Schließen der Seite.
      }
    },
  };
}
