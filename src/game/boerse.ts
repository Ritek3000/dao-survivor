/**
 * Die Geldbörse: das Gold, das allen Klassen gemeinsam gehört. Es kommt aus den Nächten (Münzen, Sold, Prämie, verkaufte Gegenstände)
 * und geht beim Händler wieder aus (`Ausruestung`, die Handel und Gold in einem Zug ändert).
 *
 * Bis Fassung 5 des Spielstands gab es dazu die Steigerungen, dauerhafte Ränge, die man mit Gold kaufte. Gegenstände ersetzen sie;
 * wer noch Ränge hatte, bekommt das Gold dafür zurück (`von5auf6` in `core/savegame.ts`) und liest einmal eine Erklärung (`refund`).
 *
 * Lore: In der Spielwelt steigern Spielende ihre Werte mit Punkten (Steigerungskosten, `spielregeln:erschaffung_entwicklung`),
 * und Kämpfer stecken ihr Erspartes in ihre Ausrüstung. Hier ist es Gold, damit man es in der Nacht einsammeln kann.
 */

import { emptySavegame, loadSavegame, writeSavegame, type Savegame } from '../core/savegame';

/** Das Gold in der Geldbörse. Liest und schreibt den Spielstand (`core/savegame.ts`). */
export class Boerse {
  /**
   * Der Messlauf spielt Nächte im Zeitraffer und schaltet das Speichern ab,
   * damit seine Probenächte den Spielstand im Browser nicht verändern.
   */
  persist = true;
  private save: Savegame = loadSavegame();

  get gold(): number {
    return this.save.gold;
  }

  /** Das Gold, das die Umstellung auf Gegenstände für entfallene Ränge erstattet hat und das das Spiel noch nicht erklärt hat; sonst 0. */
  get refund(): number {
    return this.save.refund;
  }

  /** Liest den Spielstand neu, etwa nachdem ein Werkzeug oder der Händler das Gold geändert hat. */
  reload(): void {
    this.save = loadSavegame();
  }

  /** Gibt es Gold in der Börse, das bei einem neuen Spiel verloren ginge? */
  hasGold(): boolean {
    this.refresh();
    return this.save.gold > 0;
  }

  /** Setzt den Fortschritt zurück: leere Börse und keine Gegenstände. Der Messlauf (`persist = false`) schreibt dabei nichts. */
  reset(): void {
    this.save = emptySavegame();
    this.persistNow();
  }

  /** Schreibt der Geldbörse Gold gut, etwa den Ertrag einer Nacht. */
  credit(gold: number): void {
    if (!(gold > 0)) return;
    this.refresh();
    this.save.gold += Math.floor(gold);
    this.persistNow();
  }

  /** Der Spieler hat die Erklärung zur Erstattung gelesen; sie erscheint nicht noch einmal. */
  acknowledgeRefund(): void {
    if (this.save.refund === 0) return;
    this.refresh();
    this.save.refund = 0;
    this.persistNow();
  }

  /**
   * Liest vor jeder Änderung den gespeicherten Stand neu. Ist das Spiel in zwei Tabs offen, überschreibt der eine
   * sonst mit seinem alten Wissen, was der andere inzwischen verdient oder ausgegeben hat.
   */
  private refresh(): void {
    if (this.persist) this.reload();
  }

  private persistNow(): void {
    if (this.persist) writeSavegame(this.save);
  }
}
