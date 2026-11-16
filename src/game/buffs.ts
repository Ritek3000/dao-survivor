/**
 * Zeitweilige Werte der Figur: Tempo-Schübe, Vorteil im Nahkampf, weniger Schaden beim Ausholen. `Progression.base` hält, was
 * dauerhaft gilt (Klasse, Gegenstände, Stärkungen, Segen); die zeitweiligen Werte liegen als auslaufende Schicht darüber, und
 * `Progression.stats` ist das Ergebnis, das alle anderen Teile des Spiels lesen.
 *
 * Jeder Wert hat eine Kennung. Wer ihn noch einmal setzt, erneuert die Dauer und, bei Stapeln, die Zahl der Stapel bis zum Höchstwert
 * (das Banner des Kämpfers: bis zu 10 Stapel auf das Tempo). Es gibt höchstens `CONFIG.skills.maxBuffs` zugleich, in festen Plätzen.
 *
 * Gerechnet wird erst addiert, dann multipliziert, beides je Stapel: `add` zählt `amount × Stapel`, `mul` den Faktor
 * `1 + (amount − 1) × Stapel` (bei 1,1 und 3 Stapeln also 1,3, nicht 1,331).
 */

import { CONFIG } from '../config';
import type { Stats } from './progression';

/** Was sich zeitweilig ändern lässt: alle Werte außer dem Höchstleben, dessen Stand am aktuellen Leben hängt. */
export type BuffStat = Exclude<keyof Stats, 'maxHp'>;

export interface BuffSpec {
  /** Wer ihn setzt; dieselbe Kennung zum selben Wert erneuert den Platz, statt einen zweiten zu belegen. */
  id: string;
  stat: BuffStat;
  /** 'add': `amount` je Stapel dazu; 'mul': Faktor je Stapel (1,2 = ein Fünftel mehr). */
  mode: 'add' | 'mul';
  amount: number;
  /** Dauer ab dem letzten Setzen, in Sekunden. */
  seconds: number;
  /** Höchstzahl der Stapel; ohne Angabe 1. */
  maxStacks?: number;
}

interface BuffSlot {
  id: string;
  stat: BuffStat;
  mode: 'add' | 'mul';
  amount: number;
  time: number;
  stacks: number;
}

export class Buffs {
  /**
   * Wahr, seit sich etwas geändert hat (gesetzt, abgelaufen, entfernt). `Progression.update` rechnet dann `stats` neu und
   * setzt es zurück.
   */
  changed = false;
  private readonly slots: BuffSlot[] = [];

  constructor() {
    for (let i = 0; i < CONFIG.skills.maxBuffs; i++) {
      this.slots.push({ id: '', stat: 'damage', mode: 'add', amount: 0, time: 0, stacks: 0 });
    }
  }

  /** Wie viele Werte gerade wirken. */
  get active(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.time > 0) count++;
    return count;
  }

  /**
   * Setzt einen Wert oder erneuert ihn und legt `stacks` Stapel dazu (bis `maxStacks`). Gibt false zurück, wenn alle Plätze belegt sind.
   */
  add(spec: BuffSpec, stacks = 1): boolean {
    let free: BuffSlot | null = null;
    for (const slot of this.slots) {
      if (slot.time <= 0) {
        free ??= slot;
        continue;
      }
      if (slot.id !== spec.id || slot.stat !== spec.stat) continue;
      slot.mode = spec.mode;
      slot.amount = spec.amount;
      slot.time = spec.seconds;
      slot.stacks = Math.min(spec.maxStacks ?? 1, slot.stacks + stacks);
      this.changed = true;
      return true;
    }
    if (!free || !(spec.seconds > 0)) return false;
    free.id = spec.id;
    free.stat = spec.stat;
    free.mode = spec.mode;
    free.amount = spec.amount;
    free.time = spec.seconds;
    free.stacks = Math.min(spec.maxStacks ?? 1, Math.max(1, stacks));
    this.changed = true;
    return true;
  }

  /**
   * Wie `add`, legt aber die Zahl der Stapel fest, statt sie zu erhöhen: Wer mit jedem Gegner im Umkreis einen Stapel bekommt und
   * einen verliert, wenn er geht (Reliquie der Nimmersatten), setzt den Wert in jedem Takt neu.
   */
  set(spec: BuffSpec, stacks: number): boolean {
    for (const slot of this.slots) {
      if (slot.time <= 0 || slot.id !== spec.id || slot.stat !== spec.stat) continue;
      slot.mode = spec.mode;
      slot.amount = spec.amount;
      slot.time = spec.seconds;
      slot.stacks = Math.min(spec.maxStacks ?? 1, Math.max(1, stacks));
      this.changed = true;
      return true;
    }
    return this.add(spec, stacks);
  }

  /** Wie viele Stapel der Wert gerade hat; 0, wenn er nicht wirkt. */
  stacks(id: string, stat: BuffStat): number {
    for (const slot of this.slots) if (slot.time > 0 && slot.id === id && slot.stat === stat) return slot.stacks;
    return 0;
  }

  /** Nimmt alle Werte einer Kennung weg. */
  remove(id: string): void {
    for (const slot of this.slots) {
      if (slot.time <= 0 || slot.id !== id) continue;
      slot.time = 0;
      slot.stacks = 0;
      this.changed = true;
    }
  }

  /** Neue Nacht: nichts wirkt mehr. */
  clear(): void {
    for (const slot of this.slots) {
      if (slot.time <= 0) continue;
      slot.time = 0;
      slot.stacks = 0;
      this.changed = true;
    }
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (slot.time <= 0) continue;
      slot.time -= dt;
      if (slot.time > 0) continue;
      slot.time = 0;
      slot.stacks = 0;
      this.changed = true;
    }
  }

  /** Legt die wirkenden Werte auf `stats`, das schon den Stand der dauerhaften Werte trägt. */
  apply(stats: Stats): void {
    for (const slot of this.slots) {
      if (slot.time > 0 && slot.mode === 'add') stats[slot.stat] += slot.amount * slot.stacks;
    }
    for (const slot of this.slots) {
      if (slot.time > 0 && slot.mode === 'mul') stats[slot.stat] *= 1 + (slot.amount - 1) * slot.stacks;
    }
  }
}
