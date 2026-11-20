/**
 * Dateien auf dem Gerät des Spielers: einen Text als Datei ablegen (`save`) und eine Datei zum Einlesen wählen lassen (`pick`).
 * Der Spielstand nutzt es, um sich wegsichern und wieder einlesen zu lassen (siehe `savegame.ts`, `writeSavegameFile` und `readSavegameFile`).
 *
 * Im Browser sind das ein Download-Link und ein Dateiwähler; beides geht ohne besondere Rechte und ohne Server, auch unter
 * dem Unterpfad von GitHub Pages. Eine Desktop-Hülle setzt mit `useFileAccess` eigene Fassungen ein (etwa den Speichern-Dialog des
 * Betriebssystems), ohne dass sich am Spiel etwas ändert.
 */

/** Das Ergebnis des Dateiwählers: der Text der Datei, ein Fehler zum Anzeigen oder `null`, wenn der Spieler nichts gewählt hat. */
export type PickedFile = { text: string } | { error: string } | null;

export interface FileAccess {
  /** Legt `text` unter dem Vorschlag `name` ab; im Browser landet die Datei im Download-Ordner (oder der Browser fragt, wohin). */
  save(name: string, text: string): void;
  /** Lässt den Spieler eine Datei wählen. Dateien über `maxBytes` werden nicht gelesen. */
  pick(maxBytes: number): Promise<PickedFile>;
}

/**
 * Der Dateiwähler muss bis zur Antwort am Leben bleiben: Ein Eingabefeld, das nur eine Variable hält, kann in manchen Browsern
 * weggeräumt werden, bevor `change` kommt.
 */
let activePicker: HTMLInputElement | null = null;

function browserFileAccess(): FileAccess {
  return {
    save(name, text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      // Der Browser hat die Adresse nach dem Klick übernommen; freigeben darf man sie erst etwas später.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    pick(maxBytes) {
      return new Promise<PickedFile>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        const finish = (result: PickedFile): void => {
          if (activePicker === input) activePicker = null;
          resolve(result);
        };
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) finish(null);
          else if (file.size > maxBytes) finish({ error: 'Die Datei ist zu groß für einen Spielstand.' });
          else file.text().then((text) => finish({ text }), () => finish({ error: 'Die Datei ließ sich nicht lesen.' }));
        });
        // Wer den Dialog schließt, ohne zu wählen, löst `cancel` aus. Ältere Browser kennen es nicht; dort bleibt das Versprechen
        // offen, was nichts kostet: Das Spiel wartet nicht darauf.
        input.addEventListener('cancel', () => finish(null));
        activePicker = input;
        input.click();
      });
    },
  };
}

let access: FileAccess = browserFileAccess();

/** Ersetzt den Zugriff auf Dateien, etwa durch die Dialoge einer Desktop-Hülle. */
export function useFileAccess(next: FileAccess): void {
  access = next;
}

export function saveTextFile(name: string, text: string): void {
  access.save(name, text);
}

export function pickTextFile(maxBytes: number): Promise<PickedFile> {
  return access.pick(maxBytes);
}
