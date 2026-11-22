/**
 * Die Grade der Nächte: Wer eine Nachtart geschafft hat, darf sie beim nächsten Mal einen Grad höher wählen. Man beginnt jede Nachtart
 * bei Grad 0; schafft man sie (die Sonne geht auf), steht Grad 1 zur Wahl, schafft man den, Grad 2 und so fort. Gewählt werden darf
 * höchstens der geschaffte Grad plus 1, niedrigere Grade bleiben jederzeit offen. Jede Nachtart zählt für sich, und der Stand gilt für alle
 * Klassen gemeinsam. Was ein Grad an der Nacht ändert, steht in `nights.ts` (`rulesAt`) und in `CONFIG.grade`.
 *
 * Gespeichert wird im Spielstand (`core/savegame.ts`, Feld `grades`); darum nehmen Sicherungsdatei, Laden und "Neues Spiel" die Grade mit.
 * Die Klasse folgt dem Muster der Geldbörse (`boerse.ts`): Sie liest vor jeder Änderung den gespeicherten Stand neu, damit zwei offene
 * Tabs einander nichts überschreiben, und schreibt nichts, solange `persist` aus ist (der Messlauf).
 */

import { CONFIG } from '../config';
import { loadSavegame, writeSavegame, type Savegame } from '../core/savegame';

/** Was ein Grad an den Gegnern ändert, für die Karte: „Gegner: Leben +20 %, Schaden +20 %“; Grad 0 ändert nichts. */
export function describeGrade(grade: number): string {
  if (grade <= 0) return 'Grundgrad: ohne Zuschlag';
  const percent = (perGrade: number): number => Math.round(grade * perGrade * 100);
  // Geschützte Leerzeichen: Auf der schmalen Karte soll die Zeile nur hinter dem Komma brechen.
  return `Gegner: Leben\u00a0+${percent(CONFIG.grade.enemyHp)}\u00a0%, Schaden\u00a0+${percent(CONFIG.grade.enemyDamage)}\u00a0%`;
}

export class Grade {
  /** Der Messlauf spielt Nächte im Zeitraffer und schaltet das Speichern ab, damit seine Proben die echten Grade nicht verändern. */
  persist = true;
  private save: Savegame = loadSavegame();

  /** Liest den Spielstand neu, etwa nachdem eine Datei ihn ersetzt hat. */
  reload(): void {
    this.save = loadSavegame();
  }

  /** Der höchste Grad, den man in dieser Nachtart geschafft hat; -1, wenn noch keiner. */
  cleared(night: string): number {
    return this.save.grades[night] ?? -1;
  }

  /** Der höchste Grad, den man wählen darf: der geschaffte plus 1, höchstens `CONFIG.grade.max`. */
  highest(night: string): number {
    return Math.min(CONFIG.grade.max, this.cleared(night) + 1);
  }

  /** Gibt es irgendeine Nachtart mit einem geschafften Grad? */
  hasAny(): boolean {
    this.refresh();
    return Object.keys(this.save.grades).length > 0;
  }

  /**
   * Hält fest, dass man die Nachtart in diesem Grad geschafft hat. Ein Grad, der nicht über dem bisher geschafften liegt, ändert nichts.
   * Gibt `true` zurück, wenn dadurch ein höherer Grad zur Wahl steht.
   */
  record(night: string, grade: number): boolean {
    this.refresh();
    const reached = Math.min(CONFIG.grade.max, Math.max(0, Math.floor(grade)));
    if (reached <= this.cleared(night)) return false;
    const before = this.highest(night);
    this.save.grades[night] = reached;
    this.persistNow();
    return this.highest(night) > before;
  }

  /**
   * Liest den gespeicherten Stand neu, außer der Messlauf spielt (`persist` aus). Das Spiel ruft es auf, bevor es die Grade anzeigt,
   * und `record` tut es vor jeder Änderung (siehe `Boerse.refresh`).
   */
  refresh(): void {
    if (this.persist) this.reload();
  }

  private persistNow(): void {
    if (this.persist) writeSavegame(this.save);
  }
}
