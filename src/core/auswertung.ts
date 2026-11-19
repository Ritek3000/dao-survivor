/**
 * Die Auswertung des Protokolls (`statistik.ts`): zählt die Nächte einer Klasse zusammen. Das sind nur Zähler; Anteile und Namen
 * kommen erst in der Anzeige (`ui/statistikView.ts`). Dieser Teil kennt keine Klassen und Fertigkeiten, sondern nur Kennungen.
 *
 * Die Zähler sind so gewählt, dass man sie addieren kann (zwei Auswertungen ergeben zusammen die Auswertung der beiden Protokolle).
 * Eine Sammelstelle für alle Spieler kann darum Zähler liefern, ohne jede einzelne Nacht herzugeben.
 */

import type { RunRecord } from './statistik';

/** Die Zähler für eine Gruppe von Nächten: eine Klasse oder alle zusammen. */
export interface Tally {
  /** Wie viele Nächte es waren. */
  nights: number;
  wins: number;
  /** Gefallen oder verstaubt. */
  falls: number;
  aborts: number;
  /** Die Summe der überlebten Sekunden; geteilt durch `nights` ergibt sie den Durchschnitt. */
  seconds: number;
  /** Stufe → in wie vielen Nächten die Figur am Ende auf ihr stand. */
  levels: Record<number, number>;
  /** Stärkung → wie oft sie gewählt wurde (alle Ränge zusammen). */
  upgrades: Record<string, number>;
  /** Segen → wie oft er gewährt wurde. */
  segen: Record<string, number>;
  /** Fertigkeit → Rang → in wie vielen Nächten sie am Ende auf diesem Rang stand (nicht gewählte fehlen). */
  skills: Record<string, Record<number, number>>;
}

export interface Auswertung {
  /** Alle Nächte, gleich welcher Klasse. */
  total: Tally;
  /** Je Klasse (Kennung); Klassen ohne Nacht fehlen. */
  byClass: Record<string, Tally>;
}

export function emptyTally(): Tally {
  return { nights: 0, wins: 0, falls: 0, aborts: 0, seconds: 0, levels: {}, upgrades: {}, segen: {}, skills: {} };
}

function bump(counts: Record<string | number, number>, key: string | number, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

/** Zählt eine Nacht in die Zähler ein. */
export function tallyRun(tally: Tally, run: RunRecord): void {
  tally.nights++;
  if (run.outcome === 'won') tally.wins++;
  else if (run.outcome === 'fallen') tally.falls++;
  else tally.aborts++;
  tally.seconds += run.seconds;
  bump(tally.levels, run.level);
  for (const [id, count] of Object.entries(run.upgrades)) bump(tally.upgrades, id, count);
  for (const id of run.segen) bump(tally.segen, id);
  for (const [id, rank] of Object.entries(run.skills)) {
    const ranks = tally.skills[id] ?? (tally.skills[id] = {});
    bump(ranks, rank);
  }
}

/** Rechnet die Nächte eines Protokolls aus, insgesamt und je Klasse. */
export function evaluate(runs: readonly RunRecord[]): Auswertung {
  const result: Auswertung = { total: emptyTally(), byClass: {} };
  for (const run of runs) {
    tallyRun(result.total, run);
    tallyRun(result.byClass[run.classId] ?? (result.byClass[run.classId] = emptyTally()), run);
  }
  return result;
}
