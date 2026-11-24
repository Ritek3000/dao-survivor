/**
 * Die Auswertung des Protokolls (`statistik.ts`): zählt die Nächte zusammen, insgesamt, je Klasse, je Nachtart, je Nachtart und Grad sowie
 * je Klasse in jeder dieser Gruppen, und hält fest, wer welche Nachtart im höchsten Grad zuerst geschafft hat. Das sind nur Zähler; Anteile und Namen kommen erst in der Anzeige (`ui/statistikView.ts`). Dieser Teil kennt keine Klassen,
 * Nachtarten und Fertigkeiten, sondern nur Kennungen.
 *
 * Die Zähler sind so gewählt, dass man sie addieren kann (zwei Auswertungen ergeben zusammen die Auswertung der beiden Protokolle).
 * Eine Sammelstelle für alle Spieler kann darum Zähler liefern, ohne jede einzelne Nacht herzugeben.
 */

import type { RunRecord } from './statistik';

/** Die Zähler für eine Gruppe von Nächten: eine Klasse, eine Nachtart, eine Nachtart in einem Grad, eine Klasse darin oder alle zusammen. */
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

/** Der höchste Grad, in dem eine Nachtart geschafft wurde (die Sonne ging auf), und wer ihn zuerst geschafft hat. */
export interface GradeRecord {
  grade: number;
  /** Die Klasse, die diesen Grad der Nachtart als erste geschafft hat. */
  classId: string;
  /** Wann das war, in Millisekunden seit 1970. */
  at: number;
}

export interface Auswertung {
  /** Alle Nächte, gleich welcher Klasse. */
  total: Tally;
  /** Je Klasse (Kennung); Klassen ohne Nacht fehlen. */
  byClass: Record<string, Tally>;
  /**
   * Je Nachtart (Kennung); Nachtarten ohne Nacht fehlen. Nächte, deren Nachtart unbekannt ist (siehe `RunRecord.night`), zählen
   * hier nicht; die Summe der Nächte kann also unter `total.nights` liegen.
   */
  byNight: Record<string, Tally>;
  /** Je Nachtart und Grad: Nachtart (Kennung) → Grad → Zähler; was nie gespielt wurde, fehlt. Zählt dieselben Nächte wie `byNight`. */
  byNightGrade: Record<string, Record<number, Tally>>;
  /** Je Klasse und Nachtart: Klasse → Nachtart → Zähler. Zählt, wie `byNight`, nur Nächte mit bekannter Nachtart. */
  byClassNight: Record<string, Record<string, Tally>>;
  /** Je Klasse, Nachtart und Grad: Klasse → Nachtart → Grad → Zähler. */
  byClassNightGrade: Record<string, Record<string, Record<number, Tally>>>;
  /** Je Nachtart der höchste geschaffte Grad (nur Siege zählen) mit der Klasse, die ihn zuerst geschafft hat; nie geschaffte Nachtarten fehlen. */
  highestGrade: Record<string, GradeRecord>;
}

export function emptyTally(): Tally {
  return { nights: 0, wins: 0, falls: 0, aborts: 0, seconds: 0, levels: {}, upgrades: {}, segen: {}, skills: {} };
}

export function emptyAuswertung(): Auswertung {
  return { total: emptyTally(), byClass: {}, byNight: {}, byNightGrade: {}, byClassNight: {}, byClassNightGrade: {}, highestGrade: {} };
}

/** Der Eintrag zu `key`; er wird angelegt, wenn er fehlt. */
function slot<T>(map: Record<string | number, T>, key: string | number, make: () => T): T {
  return map[key] ?? (map[key] = make());
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

/**
 * Rechnet die Nächte eines Protokolls aus: insgesamt, je Klasse, je Nachtart, je Nachtart und Grad, und die Klasse noch einmal in
 * Nachtart und Nachtart und Grad. Dazu kommt der höchste geschaffte Grad je Nachtart.
 */
export function evaluate(runs: readonly RunRecord[]): Auswertung {
  const result = emptyAuswertung();
  for (const run of runs) {
    tallyRun(result.total, run);
    tallyRun(slot(result.byClass, run.classId, emptyTally), run);
    // Eine Nacht ohne bekannte Nachtart zählt nur insgesamt und bei ihrer Klasse.
    if (!run.night) continue;
    tallyRun(slot(result.byNight, run.night, emptyTally), run);
    tallyRun(slot(slot(result.byNightGrade, run.night, () => ({})), run.grade, emptyTally), run);
    const ofClass = slot(result.byClassNight, run.classId, () => ({}));
    tallyRun(slot(ofClass, run.night, emptyTally), run);
    const gradesOfClass = slot(slot(result.byClassNightGrade, run.classId, () => ({})), run.night, () => ({}));
    tallyRun(slot(gradesOfClass, run.grade, emptyTally), run);
    if (run.outcome === 'won') noteWin(result.highestGrade, run);
  }
  return result;
}

/** Merkt einen Sieg vor, wenn er den höchsten Grad der Nachtart erhöht oder ihn früher als der bisherige Eintrag erreicht. */
function noteWin(highest: Record<string, GradeRecord>, run: RunRecord): void {
  const known = highest[run.night];
  if (!known || run.grade > known.grade || (run.grade === known.grade && run.at < known.at)) {
    highest[run.night] = { grade: run.grade, classId: run.classId, at: run.at };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Kennung (oder Zahl als Text) → Zahl; Einträge ohne Zahl fallen weg. */
function parseCounts<K extends string | number>(raw: unknown): Record<K, number> {
  const counts: Record<string, number> = {};
  if (!isRecord(raw)) return counts as Record<K, number>;
  for (const [key, value] of Object.entries(raw)) {
    const n = count(value);
    if (n > 0) counts[key] = n;
  }
  return counts as Record<K, number>;
}

function parseTally(raw: unknown): Tally {
  const tally = emptyTally();
  if (!isRecord(raw)) return tally;
  tally.nights = count(raw.nights);
  tally.wins = count(raw.wins);
  tally.falls = count(raw.falls);
  tally.aborts = count(raw.aborts);
  tally.seconds = count(raw.seconds);
  tally.levels = parseCounts<number>(raw.levels);
  tally.upgrades = parseCounts<string>(raw.upgrades);
  tally.segen = parseCounts<string>(raw.segen);
  if (isRecord(raw.skills)) {
    for (const [id, ranks] of Object.entries(raw.skills)) tally.skills[id] = parseCounts<number>(ranks);
  }
  return tally;
}

/** Kennung → Zähler; was kein Zähler ist, fällt weg. */
function parseTallies(raw: unknown): Record<string, Tally> {
  const tallies: Record<string, Tally> = {};
  if (!isRecord(raw)) return tallies;
  for (const [id, tally] of Object.entries(raw)) tallies[id] = parseTally(tally);
  return tallies;
}

/** Der Grad kommt als Text (JSON-Schlüssel); was keine ganze Zahl ist, fällt weg. */
function parseGrades(raw: unknown): Record<number, Tally> {
  return Object.fromEntries(Object.entries(parseTallies(raw)).filter(([grade]) => /^\d{1,2}$/.test(grade)));
}

/** Kennung → (Kennung → Zähler), zwei Ebenen. */
function parseNested<T>(raw: unknown, parseInner: (inner: unknown) => T): Record<string, T> {
  const result: Record<string, T> = {};
  if (!isRecord(raw)) return result;
  for (const [id, inner] of Object.entries(raw)) result[id] = parseInner(inner);
  return result;
}

function parseHighest(raw: unknown): Record<string, GradeRecord> {
  const result: Record<string, GradeRecord> = {};
  if (!isRecord(raw)) return result;
  for (const [night, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || typeof entry.classId !== 'string' || entry.classId.length === 0) continue;
    result[night] = { grade: count(entry.grade), classId: entry.classId, at: count(entry.at) };
  }
  return result;
}

/**
 * Liest eine Auswertung, die von außen kommt (die Sammelstelle liefert sie als JSON, siehe `sammelstelle.ts`). Was fehlt oder keine
 * Zahl ist, zählt als 0; ein Text, der keine Auswertung ist, ergibt eine leere. Eine Sammelstelle, die noch nach einem
 * älteren Stand antwortet (ohne `byNight` und die folgenden Teile), ergibt eine Auswertung ohne diese Teile.
 */
export function parseAuswertung(raw: unknown): Auswertung {
  const result = emptyAuswertung();
  if (!isRecord(raw)) return result;
  result.total = parseTally(raw.total);
  result.byClass = parseTallies(raw.byClass);
  result.byNight = parseTallies(raw.byNight);
  result.byNightGrade = parseNested(raw.byNightGrade, parseGrades);
  result.byClassNight = parseNested(raw.byClassNight, parseTallies);
  result.byClassNightGrade = parseNested(raw.byClassNightGrade, (nights) => parseNested(nights, parseGrades));
  result.highestGrade = parseHighest(raw.highestGrade);
  return result;
}
