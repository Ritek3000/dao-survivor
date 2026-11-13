/**
 * Steigerungen: dauerhafte Verbesserungen, die man zwischen den Nächten mit Gold bezahlt.
 *
 * Anders als die Stärkungen einer Nacht (`progression.ts`) bleiben sie bestehen, und jede Klasse wird einzeln gesteigert:
 * Das Gold gehört allen gemeinsam, die Ränge zählen je Klasse. Wie Stärkungen und Segen sind sie Daten; eine neue
 * Steigerung ist ein weiterer Eintrag in `STEIGERUNGEN`. Wirkung, Höchstrang und Preis des ersten Rangs stehen dort,
 * die Preiskurve und was das Gold einbringt in `CONFIG.gold`.
 *
 * Lore: In der Spielwelt steigern Spielende ihre Werte mit Punkten (Steigerungskosten, `spielregeln:erschaffung_entwicklung`),
 * und Kämpfer stecken ihr Erspartes in ihre Ausrüstung. Hier ist es Gold statt Punkten, damit man es in der Nacht
 * einsammeln kann; der Name „Steigerung“ und die steigenden Preise je Rang stammen aus der Lore.
 */

import { CONFIG } from '../config';
import { emptySavegame, loadSavegame, writeSavegame, type Savegame } from '../core/savegame';
import type { ClassId } from './classes';
import type { Stats } from './progression';

export interface Steigerung {
  id: string;
  name: string;
  /** Was ein einzelner Rang bewirkt. */
  text: string;
  /** Wie viele Ränge es gibt. */
  max: number;
  /** Preis des ersten Rangs in Gold; jeder weitere kostet `CONFIG.gold.upgradeGrowth`-mal so viel. */
  cost: number;
  /** Wirkt einmal je Rang auf die Werte der Nacht. */
  apply(stats: Stats): void;
}

/** Reihenfolge wie im Menü: erst, was die Ausbeute mehrt, dann Kampf und Überleben. */
export const STEIGERUNGEN: readonly Steigerung[] = [
  {
    id: 'offene-hand',
    name: 'Offene Hand',
    text: '+10 % Sammelradius je Rang',
    max: 6,
    cost: 35,
    apply: (s) => void (s.pickup += 0.1),
  },
  {
    id: 'lehrjahre',
    name: 'Lehrjahre',
    text: '+4 % Erfahrung je Rang',
    max: 10,
    cost: 40,
    apply: (s) => void (s.xp += 0.04),
  },
  {
    id: 'kaufmannsblick',
    name: 'Kaufmannsblick',
    text: '+5 % Gold je Rang',
    max: 10,
    cost: 60,
    apply: (s) => void (s.gold += 0.05),
  },
  {
    id: 'waffenuebung',
    name: 'Waffenübung',
    text: '+5 % Schaden je Rang',
    max: 10,
    cost: 40,
    apply: (s) => void (s.damage += 0.05),
  },
  {
    id: 'flinke-hand',
    name: 'Flinke Hand',
    text: 'Angriffe folgen 4 % schneller aufeinander, je Rang',
    max: 8,
    cost: 45,
    apply: (s) => void (s.cooldown *= 0.96),
  },
  {
    id: 'ausdauer',
    name: 'Ausdauer',
    text: '+3 % Lauftempo je Rang',
    max: 6,
    cost: 45,
    apply: (s) => void (s.speed += 0.03),
  },
  {
    id: 'sicherer-griff',
    name: 'Sicherer Griff',
    text: '+2 % Chance auf doppelten Schaden je Rang',
    max: 8,
    cost: 50,
    apply: (s) => void (s.critChance += 0.02),
  },
  {
    id: 'weitblick',
    name: 'Weitblick',
    text: '+4 % Reichweite aller Angriffe je Rang',
    max: 6,
    cost: 40,
    apply: (s) => void (s.reach += 0.04),
  },
  {
    id: 'abhaertung',
    name: 'Abhärtung',
    text: '+6 Leben je Rang',
    max: 10,
    cost: 35,
    apply: (s) => void (s.maxHp += 6),
  },
  {
    id: 'ruestungspflege',
    name: 'Rüstungspflege',
    text: 'Jeder Treffer verursacht 1 Schaden weniger, je Rang',
    max: 3,
    cost: 90,
    apply: (s) => void (s.armor += 1),
  },
  {
    id: 'staubfestigkeit',
    name: 'Staubfestigkeit',
    text: 'Die Finsternis verstaubt dich 5 % langsamer je Rang',
    max: 6,
    cost: 50,
    apply: (s) => void (s.verstaubung *= 0.95),
  },
  {
    id: 'heller-schein',
    name: 'Heller Schein',
    text: '+4 % Reichweite des eigenen Lichtscheins je Rang',
    max: 5,
    cost: 60,
    apply: (s) => void (s.light *= 1.04),
  },
];

/** Das Gold in der Geldbörse und die Ränge jeder Klasse. Liest und schreibt den Spielstand (`core/savegame.ts`). */
export class Steigerungen {
  /**
   * Der Messlauf spielt Nächte im Zeitraffer und schaltet das Speichern ab,
   * damit seine Probenächte den Spielstand im Browser nicht verändern.
   */
  persist = true;
  private save: Savegame = loadSavegame();

  get gold(): number {
    return this.save.gold;
  }

  /** Liest den Spielstand neu, etwa nachdem ein Werkzeug Ränge nur zum Ausprobieren gesetzt hat. */
  reload(): void {
    this.save = loadSavegame();
  }

  /** Gibt es einen Fortschritt, der bei einem neuen Spiel verloren ginge: Gold in der Börse oder gekaufte Ränge? */
  hasProgress(): boolean {
    this.refresh();
    return this.save.gold > 0 || Object.values(this.save.ranks).some((ranks) => Object.values(ranks).some((rank) => rank > 0));
  }

  /** Setzt den Fortschritt zurück: leere Börse, keine Ränge. Der Messlauf (`persist = false`) schreibt dabei nichts. */
  reset(): void {
    this.save = emptySavegame();
    this.persistNow();
  }

  rank(classId: ClassId, steigerung: Steigerung): number {
    return Math.min(steigerung.max, this.save.ranks[classId]?.[steigerung.id] ?? 0);
  }

  /** Summe der Ränge, die eine Klasse schon hat. */
  totalRanks(classId: ClassId): number {
    return STEIGERUNGEN.reduce((sum, steigerung) => sum + this.rank(classId, steigerung), 0);
  }

  /** Preis des nächsten Rangs in Gold; `null`, wenn der höchste Rang erreicht ist. */
  cost(classId: ClassId, steigerung: Steigerung): number | null {
    const rank = this.rank(classId, steigerung);
    if (rank >= steigerung.max) return null;
    // Auf Fünfer gerundet, damit die Preise rund bleiben.
    return Math.max(5, Math.round((steigerung.cost * CONFIG.gold.upgradeGrowth ** rank) / 5) * 5);
  }

  /** Kauft den nächsten Rang. Gibt false zurück, wenn das Gold nicht reicht oder der höchste Rang erreicht ist. */
  buy(classId: ClassId, steigerung: Steigerung): boolean {
    this.refresh();
    const cost = this.cost(classId, steigerung);
    if (cost === null || cost > this.save.gold) return false;
    this.save.gold -= cost;
    this.setRank(classId, steigerung, this.rank(classId, steigerung) + 1);
    this.persistNow();
    return true;
  }

  /** Schreibt der Geldbörse Gold gut, etwa den Ertrag einer Nacht. */
  credit(gold: number): void {
    if (!(gold > 0)) return;
    this.refresh();
    this.save.gold += Math.floor(gold);
    this.persistNow();
  }

  /** Setzt einen Rang, ohne zu bezahlen und ohne zu speichern. Nur für Werkzeuge; das Spiel selbst kauft mit `buy`. */
  setRank(classId: ClassId, steigerung: Steigerung, rank: number): void {
    const ranks = (this.save.ranks[classId] ??= {});
    ranks[steigerung.id] = Math.min(steigerung.max, Math.max(0, Math.floor(rank)));
  }

  /** Überträgt die Ränge einer Klasse auf die Werte, mit denen die Nacht beginnt. */
  apply(classId: ClassId, stats: Stats): void {
    for (const steigerung of STEIGERUNGEN) {
      for (let i = this.rank(classId, steigerung); i > 0; i--) steigerung.apply(stats);
    }
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
