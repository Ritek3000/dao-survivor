/**
 * Zustände der Gegner: festgehalten, verlangsamt, im Nachteil, blutend, brennend, markiert, in Furcht, geblendet, geschwächt und ohne
 * Zauber. Fertigkeiten bringen sie an (`applyStatus`), die Horde liest sie in `enemies.ts` und die Treffer in `arsenal.ts`.
 *
 * Jeder Gegner trägt einen festen Satz von Feldern, einen je Zustand: Restsekunden, Stärke und Urheber. Es entsteht nie etwas Neues,
 * wenn ein Zustand dazukommt oder abläuft; die Gegner liegen ohnehin in Pools.
 *
 * Was die Stärke (`power`) bedeutet, hängt vom Zustand ab:
 * - `hold`: ohne Stärke; wer festgehalten wird, rührt sich nicht (umgeworfen oder verwurzelt).
 * - `slow`: der Anteil des Tempos, der wegfällt (0,5 = halbes Tempo).
 * - `weak` (Nachteil): Faktor auf den Schaden, den der Gegner erleidet (1,3 = ein Drittel mehr).
 * - `bleed`, `burn`: Schaden je Sekunde, solange der Zustand dauert.
 * - `mark` (Vorteil für die Figur): Kritchance, die gegen Markierte dazukommt (1 = jeder Treffer kritisch).
 * - `fear`: ohne Stärke; wer sich fürchtet, läuft von der Figur weg und greift nicht an.
 * - `blind`: der Anteil des Schadens, den Geblendete nicht anrichten (0,5 = die Hälfte).
 * - `feeble`: der Anteil von Schaden und Angriffstempo, der wegfällt.
 * - `silence`: ohne Stärke; wer sonst zaubert (der Priester), wirkt keinen Zauber. In der Lore „Fernkämpfer stören“.
 */

import { CONFIG } from '../config';
import type { Source } from './events';

export type StatusKind = 'hold' | 'slow' | 'weak' | 'bleed' | 'burn' | 'mark' | 'fear' | 'blind' | 'feeble' | 'silence';

export const STATUS_KINDS: readonly StatusKind[] = ['hold', 'slow', 'weak', 'bleed', 'burn', 'mark', 'fear', 'blind', 'feeble', 'silence'];

/** Die Zustände, die in jedem Bild Schaden machen. */
export const DOT_KINDS: readonly StatusKind[] = ['bleed', 'burn'];

/** Ein Zustand eines Gegners. `time` ist 0, solange er nicht betroffen ist. */
export interface StatusSlot {
  /** Restsekunden. */
  time: number;
  power: number;
  /** Wer ihn angebracht hat; null, wenn niemand Bestimmtes. */
  source: Source | null;
}

/** Alle Zustände eines Gegners. `live` zählt die, die gerade wirken; ist es 0, braucht der Gegner keine Pflege. */
export interface StatusSet extends Record<StatusKind, StatusSlot> {
  live: number;
}

/** Ein Zustand, den ein Treffer, ein Angriff oder ein Bodenfeld anbringt. Ohne `power` gilt die Stärke aus `CONFIG.skills.status`. */
export interface StatusApply {
  kind: StatusKind;
  seconds: number;
  power?: number;
}

const DEFAULTS = CONFIG.skills.status;

/** Die Stärke, die ein Zustand ohne eigene Angabe hat. */
export const DEFAULT_POWER: Readonly<Record<StatusKind, number>> = {
  hold: 1,
  slow: DEFAULTS.slowPower,
  weak: DEFAULTS.weakFactor,
  bleed: DEFAULTS.dotPower,
  burn: DEFAULTS.dotPower,
  mark: DEFAULTS.markPower,
  fear: 1,
  blind: DEFAULTS.blindPower,
  feeble: DEFAULTS.feeblePower,
  silence: 1,
};

/** Bei diesen Zuständen ist die Stärke ein Anteil und liegt zwischen 0 und 1. */
const SHARE: Readonly<Record<StatusKind, boolean>> = {
  hold: false,
  slow: true,
  weak: false,
  bleed: false,
  burn: false,
  mark: true,
  fear: false,
  blind: true,
  feeble: true,
  silence: false,
};

function slot(): StatusSlot {
  return { time: 0, power: 0, source: null };
}

export function createStatusSet(): StatusSet {
  return {
    hold: slot(),
    slow: slot(),
    weak: slot(),
    bleed: slot(),
    burn: slot(),
    mark: slot(),
    fear: slot(),
    blind: slot(),
    feeble: slot(),
    silence: slot(),
    live: 0,
  };
}

/** Nimmt dem Gegner alle Zustände, etwa wenn ein Gegner aus dem Pool neu auftritt. */
export function clearStatuses(set: StatusSet): void {
  if (set.live === 0) return;
  for (const kind of STATUS_KINDS) {
    const entry = set[kind];
    entry.time = 0;
    entry.power = 0;
    entry.source = null;
  }
  set.live = 0;
}

/** Nimmt dem Gegner einen Zustand (der Verschlinger lässt sich nicht festhalten). */
export function clearStatus(set: StatusSet, kind: StatusKind): void {
  const entry = set[kind];
  if (entry.time <= 0) return;
  entry.time = 0;
  entry.power = 0;
  entry.source = null;
  set.live--;
}

export function isActive(set: StatusSet, kind: StatusKind): boolean {
  return set[kind].time > 0;
}

/**
 * Bringt einen Zustand an. Wirkt er schon, gilt die längere Dauer und die stärkere Stärke; ein schwächerer Wert verlängert einen
 * stärkeren nicht. Bei gleicher Stärke zählt der jüngste Urheber.
 */
export function applyStatus(set: StatusSet, kind: StatusKind, seconds: number, power?: number, source: Source | null = null): void {
  if (!(seconds > 0)) return;
  let strength = power ?? DEFAULT_POWER[kind];
  if (strength < 0) strength = 0;
  if (SHARE[kind] && strength > 1) strength = 1;
  const entry = set[kind];
  if (entry.time <= 0) {
    entry.time = seconds;
    entry.power = strength;
    entry.source = source;
    set.live++;
  } else if (strength > entry.power) {
    entry.time = Math.max(entry.time, seconds);
    entry.power = strength;
    entry.source = source;
  } else if (strength === entry.power) {
    entry.time = Math.max(entry.time, seconds);
    entry.source = source;
  }
}

/** Zieht die Zeit ab; abgelaufene Zustände fallen weg. Schaden über Zeit rechnet der Aufrufer vorher (`dotAmount`). */
export function tickStatuses(set: StatusSet, dt: number): void {
  if (set.live === 0) return;
  for (const kind of STATUS_KINDS) {
    const entry = set[kind];
    if (entry.time <= 0) continue;
    entry.time -= dt;
    if (entry.time > 0) continue;
    entry.time = 0;
    entry.power = 0;
    entry.source = null;
    set.live--;
  }
}

/** Der Schaden, den Blutung oder Brennen in diesem Bild anrichten; nie mehr, als in der Restzeit noch anfällt. */
export function dotAmount(set: StatusSet, kind: StatusKind, dt: number): number {
  const entry = set[kind];
  return entry.time > 0 ? entry.power * Math.min(dt, entry.time) : 0;
}

/**
 * Faktor auf das Tempo: 1, solange nichts bremst. `floor` ist die Untergrenze; der Verschlinger lässt sich nicht unter
 * `CONFIG.boss.slowFloor` bremsen. Festhalten bremst nicht, es hält an (der Aufrufer prüft `hold`).
 */
export function slowFactor(set: StatusSet, floor = 0): number {
  const entry = set.slow;
  return entry.time > 0 ? Math.max(1 - entry.power, floor) : 1;
}

/** Faktor auf den Schaden, den der Gegner erleidet (Nachteil). */
export function takenFactor(set: StatusSet): number {
  const entry = set.weak;
  return entry.time > 0 ? entry.power : 1;
}

/** Faktor auf den Schaden, den der Gegner anrichtet: Geblendete und Geschwächte schlagen schwächer zu. */
export function dealtFactor(set: StatusSet): number {
  if (set.live === 0) return 1;
  let factor = 1;
  if (set.blind.time > 0) factor *= 1 - set.blind.power;
  if (set.feeble.time > 0) factor *= 1 - set.feeble.power;
  return factor;
}

/** Faktor auf das Tempo, mit dem Hiebe und Zauber des Gegners nachladen: 1, solange er nicht geschwächt ist. */
export function attackRate(set: StatusSet): number {
  return set.feeble.time > 0 ? 1 - set.feeble.power : 1;
}

/** Die Kritchance, die gegen diesen Gegner dazukommt (Vorteil gegen Markierte); 0, wenn er nicht markiert ist. */
export function markChance(set: StatusSet): number {
  return set.mark.time > 0 ? set.mark.power : 0;
}
