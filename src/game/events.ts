/**
 * Ereignisse des Kampfes mit Urheber. Fertigkeiten, die auf etwas reagieren (jeder zehnte Tod im Feld des Banners, Splitter nach
 * drei Treffern am Dornenschild), brauchen zu jedem Treffer und Tod zu wissen, wer wen getroffen oder erschlagen hat. Dieser Teil
 * meldet das; er hört nichts selbst und bewirkt nichts.
 *
 * Der Urheber (`Source`) ist ein kleines, dauerhaftes Objekt je Angriff, Bodenfeld oder Zustand. Es wird einmal angelegt und danach
 * nur weitergereicht, damit im Kampf nichts Neues entsteht. Wer nichts zuhört, kostet nichts: Ohne Zuhörer sind die Aufrufe leer.
 */

import type { Enemy } from './enemies';

/** Wer etwas bewirkt hat: ein Angriff (seine Nummer in `weapons.ts`), ein Bodenfeld, ein Zustand oder die Umgebung. */
export interface Source {
  readonly id: string;
}

const SOURCES = new Map<string, Source>();

/** Der Urheber zu einem Namen; derselbe Name gibt immer dasselbe Objekt zurück, sodass man Urheber mit `===` vergleichen kann. */
export function sourceOf(id: string): Source {
  let source = SOURCES.get(id);
  if (!source) {
    source = { id };
    SOURCES.set(id, source);
  }
  return source;
}

/** Wer Ereignisse hören will; jede Methode ist freiwillig. */
export interface CombatListener {
  /**
   * Ein Gegner hat Schaden genommen (immer über 0). `dot`: Der Schaden stammt aus Blutung oder Brennen und fällt in jedem Bild
   * ein wenig an. `source` ist null, wenn niemand Bestimmtes ihn zugefügt hat.
   */
  hit?(enemy: Enemy, amount: number, source: Source | null, dot: boolean): void;
  /** Ein Gegner ist gestorben. `source` ist, wer ihm zuletzt Schaden zugefügt hat; sein Leben war da schon unter 0. */
  kill?(enemy: Enemy, source: Source | null): void;
  /**
   * Die Figur wurde von einem Gegner getroffen: `attacker` ist er (null bei Dingen ohne Gegner), `taken` das Leben, das sie verlor.
   * `absorbed`: Der Schild hat den Treffer abgefangen; dann ist `taken` 0.
   */
  hurt?(attacker: Enemy | null, taken: number, absorbed: boolean): void;
}

/**
 * Die Zuhörer und die Meldungen an sie. Ein Zuhörer darf sich nicht in einem Ereignis selbst an- oder abmelden;
 * Anmelden und Abmelden geschieht zwischen den Nächten (`Game.startRun`).
 */
export class CombatEvents {
  private readonly listeners: CombatListener[] = [];

  add(listener: CombatListener): void {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }

  remove(listener: CombatListener): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }

  /** Meldet alle ab; neue Nacht. */
  clear(): void {
    this.listeners.length = 0;
  }

  get count(): number {
    return this.listeners.length;
  }

  hit(enemy: Enemy, amount: number, source: Source | null, dot: boolean): void {
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]?.hit?.(enemy, amount, source, dot);
  }

  kill(enemy: Enemy, source: Source | null): void {
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]?.kill?.(enemy, source);
  }

  hurt(attacker: Enemy | null, taken: number, absorbed: boolean): void {
    for (let i = 0; i < this.listeners.length; i++) this.listeners[i]?.hurt?.(attacker, taken, absorbed);
  }
}
