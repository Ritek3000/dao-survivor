/**
 * Alle Angriffe als Daten. Einheiten: Meter und Sekunden.
 * Die Zauber des Magiers folgen den Effektfamilien aus den Magie-Vorlagen des Nutzers:
 * nichts schwebt, nichts entsteht aus dem Nichts.
 *
 * Was ein höherer Rang ändert, steht entweder in den Einheitsregeln (jeder Rang +25 % Schaden, Abklingzeit auf 94 %) mit den
 * Feldern `arc`, `count` und `pierce` oder, je Angriff, in einer Tabelle `ranks` (siehe `RankRule`). `resolveRank` macht daraus
 * für jeden Rang eine fertige Zeile, die der Kampf liest.
 */

import type { StatusApply } from './status';

export type WeaponKind =
  /** Kegel in Richtung des nächsten Gegners. */
  | 'arc'
  /** Wirkung rundum um die Spielfigur. */
  | 'nova'
  | 'projectile'
  /** Gerade Linie, die alle Gegner darauf trifft. */
  | 'beam'
  /** Dauerhafter Kreis um die Spielfigur, der in Abständen wirkt. */
  | 'aura'
  /** Verzögerter Einschlag auf einer Fläche. */
  | 'volley'
  | 'trap'
  /** Sofortige Wirkung auf einer Fläche um den nächsten Gegner. */
  | 'root'
  | 'shield';

export type ProjectileShape = 'arrow' | 'knife' | 'axe';

/** Das Bild eines Angriffs; was dazu gezeichnet wird, steht in effects.ts. */
export type WeaponLook =
  // Kegel
  | 'hieb'
  | 'wucht'
  | 'hitze'
  // rundum
  | 'wirbel'
  | 'schrei'
  | 'erdstoss'
  | 'boee';

export interface WeaponDef {
  id: string;
  name: string;
  /** Kurzbeschreibung für die Auswahlkarte. */
  text: string;
  kind: WeaponKind;
  /** Bei 'aura' der Abstand zwischen zwei Wirkungen, bei 'shield' die Ladezeit. */
  cooldown: number;
  damage: number;
  /** Reichweite, in der ein Ziel gesucht wird; bei 'nova' und 'aura' der Radius. */
  range: number;
  /** Wie ein Kegel oder eine Wirkung rundum aussieht; die übrigen Arten haben nur ein Bild. */
  look?: WeaponLook;
  /** Öffnungswinkel eines Kegels in Radiant, abhängig vom Rang. */
  arc?: (rank: number) => number;
  knockback?: number;
  /** Sekunden, die Getroffene festgehalten werden: umgeworfen oder verwurzelt. */
  hold?: number;
  /** Sekunden mit halbem Tempo. */
  slow?: number;
  /** Sekunden, in denen Getroffene mehr Schaden erleiden. */
  weak?: number;
  /** Fläche von 'volley', 'trap' und 'root'. */
  radius?: number;
  /** Verzögerung bis zum Einschlag. */
  delay?: number;
  maxTargets?: number;
  /** Höchstzahl gleichzeitig liegender Fallen. */
  maxActive?: number;
  /** Breite eines Strahls. */
  width?: number;
  speed?: number;
  shape?: ProjectileShape;
  /** Winkel zwischen zwei Geschossen eines Fächers. */
  spread?: number;
  count?: (rank: number) => number;
  /** Wie viele Gegner ein Geschoss zusätzlich durchschlägt. */
  pierce?: (rank: number) => number;
  /**
   * Die Regeln je Rang, wo sie von den Einheitsregeln abweichen; der Eintrag an Stelle 0 ist Rang 1. Siehe `RankRule`.
   * Ohne Tabelle gelten die Einheitsregeln und die Felder `arc`, `count` und `pierce`.
   */
  ranks?: readonly RankRule[];
}

/**
 * Was ein Rang eines Angriffs festlegt. Ein Feld, das der Rang nennt, gilt von diesem Rang an auch für die folgenden, bis ein späterer
 * Rang es neu setzt (Rang 3 mit `count: 4` heißt: auf Rang 3, 4 und 5 sind es vier). Ein Feld, das nie genannt wird, folgt den
 * Einheitsregeln und den Feldern des Angriffs. So schreibt eine Tabelle nur auf, was von der Regel abweicht.
 */
export interface RankRule {
  /** Faktor auf den Schaden des Angriffs. */
  damage?: number;
  /** Faktor auf die Abklingzeit; kleiner ist schneller. */
  cooldown?: number;
  /** Faktor auf die Reichweite, in der ein Ziel gesucht wird. */
  range?: number;
  /** Faktor auf die Fläche (`radius`; bei 'aura' die Reichweite selbst). */
  radius?: number;
  /** Öffnungswinkel eines Kegels in Radiant. */
  arc?: number;
  /** Zahl der Geschosse eines Fächers. */
  count?: number;
  /** Wie viele Gegner ein Geschoss zusätzlich durchschlägt. */
  pierce?: number;
  /** Faktor auf den Rückstoß. */
  knockback?: number;
  /** Die Zustände, die ein Treffer anbringt; die Liste ersetzt die des vorigen Rangs ganz (leer: keine). */
  statuses?: readonly StatusApply[];
  /** Schalter für Besonderheiten dieses Rangs, die der Angriff mit `hasFlag` liest (etwa ein zweiter Hieb); ersetzt die des vorigen Rangs ganz. */
  flags?: readonly string[];
}

/** Ein Rang eines Angriffs, fertig aufgelöst: das, was der Kampf liest. */
export interface ResolvedRank {
  rank: number;
  /** Faktor auf den Schaden des Angriffs. */
  damage: number;
  /** Faktor auf die Abklingzeit. */
  cooldown: number;
  range: number;
  radius: number;
  arc: number;
  count: number;
  pierce: number;
  knockback: number;
  statuses: readonly StatusApply[];
  flags: readonly string[];
}

export const MAX_RANK = 5;
/** Jeder Rang über dem ersten bringt so viel Schaden dazu. */
export const DAMAGE_PER_RANK = 0.25;
/** Jeder Rang über dem ersten verkürzt die Abklingzeit auf diesen Anteil. */
export const COOLDOWN_PER_RANK = 0.94;
/** Bei Dauerkreisen wächst der Radius mit jedem Rang um so viel des Grundwerts. */
export const AURA_RADIUS_PER_RANK = 0.1;

const DEFS: readonly WeaponDef[] = [
  // Kämpfer
  {
    id: 'axthieb',
    name: 'Axthieb',
    text: 'Weiter Hieb im Bogen auf den nächsten Gegner',
    kind: 'arc',
    look: 'hieb',
    cooldown: 0.85,
    damage: 12,
    range: 2.9,
    arc: () => 2.5,
    knockback: 6,
  },
  {
    id: 'wirbelschlag',
    name: 'Wirbelschlag',
    text: 'Sprung mit Drehung, trifft alle Gegner rundum',
    kind: 'nova',
    look: 'wirbel',
    cooldown: 3.2,
    damage: 14,
    range: 3.2,
    knockback: 4,
  },
  {
    // Der Kämpfer trägt keinen Schild; an die Stelle des Schildstoßes tritt der aufgeladene Hieb.
    id: 'wuchthieb',
    name: 'Wuchthieb',
    text: 'Weit ausgeholter Hieb, schleudert Gegner vor dir zurück',
    kind: 'arc',
    look: 'wucht',
    cooldown: 3,
    damage: 18,
    range: 3.1,
    arc: () => 2.2,
    knockback: 16,
    hold: 0.5,
  },
  {
    id: 'kriegsschrei',
    name: 'Kriegsschrei',
    text: 'Umstehende werden langsam und erleiden mehr Schaden',
    kind: 'nova',
    look: 'schrei',
    cooldown: 7,
    damage: 0,
    range: 6,
    slow: 4,
    weak: 4,
  },
  {
    id: 'wurfaxt',
    name: 'Wurfaxt',
    text: 'Fliegt durch alle Gegner auf ihrem Weg',
    kind: 'projectile',
    cooldown: 2.8,
    damage: 14,
    range: 11,
    speed: 11,
    shape: 'axe',
    pierce: () => 99,
    knockback: 3,
  },

  // Wildnisläufer
  {
    id: 'bogenschuss',
    name: 'Bogenschuss',
    text: 'Pfeil auf den nächsten Gegner, durchschlägt einen weiteren, auf höheren Rängen mehr',
    kind: 'projectile',
    cooldown: 0.65,
    damage: 16,
    range: 14,
    speed: 26,
    shape: 'arrow',
    pierce: (rank) => (rank >= 5 ? 3 : rank >= 3 ? 2 : 1),
    knockback: 2,
  },
  {
    id: 'pfeilhagel',
    name: 'Pfeilhagel',
    text: 'Pfeile regnen auf eine Gruppe von Gegnern',
    kind: 'volley',
    cooldown: 4.5,
    damage: 16,
    range: 13,
    radius: 3,
    delay: 0.6,
  },
  {
    id: 'fangeisen',
    name: 'Fangeisen',
    text: 'Legt Fallen aus, die Gegner verletzen und festhalten',
    kind: 'trap',
    cooldown: 3.5,
    damage: 30,
    range: 0,
    radius: 1.1,
    hold: 2.5,
    maxActive: 6,
  },
  {
    id: 'wurfmesser',
    name: 'Wurfmesser-Fächer',
    text: 'Fächer aus Messern auf nahe Gegner, mehr Messer auf höheren Rängen',
    kind: 'projectile',
    cooldown: 1.6,
    damage: 9,
    range: 9,
    speed: 20,
    shape: 'knife',
    spread: 0.22,
    count: (rank) => (rank >= 5 ? 7 : rank >= 3 ? 5 : 3),
    pierce: () => 1,
  },

  // Magier
  {
    id: 'hitze-werfen',
    name: 'Hitze werfen',
    text: 'Unsichtbarer Hitzestoß in einer Linie, ab Rang 4 ein Kegel',
    kind: 'arc',
    look: 'hitze',
    cooldown: 0.95,
    damage: 15,
    range: 9,
    arc: (rank) => (rank >= 4 ? 0.9 : 0.3),
  },
  {
    id: 'sorlanze',
    name: 'Sorlanze',
    text: 'Lichtstrahl, der alle Gegner in einer Linie trifft',
    kind: 'beam',
    cooldown: 2.4,
    damage: 22,
    range: 15,
    width: 0.4,
  },
  {
    // Trifft alle Gegner im ganzen Kreis, nicht nur am Rand: Rang 1 bringt 5 Schaden alle 0,5 s, also 10 je Sekunde.
    id: 'glut-formen',
    name: 'Glut formen',
    text: 'Brennender Kreis um dich: Wer darin steht, erleidet jede Sekunde Schaden',
    kind: 'aura',
    cooldown: 0.5,
    damage: 5,
    range: 3.2,
  },
  {
    id: 'erdstoss',
    name: 'Erdstoß',
    text: 'Stoß im Umkreis, wirft Gegner um',
    kind: 'nova',
    look: 'erdstoss',
    cooldown: 5,
    damage: 18,
    range: 4.5,
    hold: 1.2,
  },
  {
    id: 'wurzelgriff',
    name: 'Wurzelgriff',
    text: 'Dornige Wurzeln halten bis zu fünf Gegner fest',
    kind: 'root',
    cooldown: 4.5,
    damage: 4,
    range: 10,
    radius: 2.5,
    hold: 3,
    maxTargets: 5,
  },
  {
    id: 'sturmboee',
    name: 'Sturmböe',
    text: 'Stößt alle Gegner im Umkreis fort',
    kind: 'nova',
    look: 'boee',
    cooldown: 6,
    damage: 3,
    range: 7,
    knockback: 18,
  },
  {
    id: 'schild',
    name: 'Schild',
    text: 'Fängt einen Treffer vollständig ab und lädt dann neu',
    kind: 'shield',
    cooldown: 12,
    damage: 0,
    range: 1.1,
  },
];

const BY_ID = new Map(DEFS.map((def) => [def.id, def]));
const NO_FLAGS: readonly string[] = [];

/** Die Zustände, die `hold`, `slow` und `weak` eines Angriffs ohne Tabelle anbringen. */
function legacyStatuses(def: WeaponDef): readonly StatusApply[] {
  const list: StatusApply[] = [];
  if (def.hold) list.push({ kind: 'hold', seconds: def.hold });
  if (def.slow) list.push({ kind: 'slow', seconds: def.slow });
  if (def.weak) list.push({ kind: 'weak', seconds: def.weak });
  return list;
}

/** Ein Rang nach den Einheitsregeln und den Feldern des Angriffs, ohne Tabelle. */
function ruleRank(def: WeaponDef, rank: number): ResolvedRank {
  return {
    rank,
    damage: 1 + DAMAGE_PER_RANK * (rank - 1),
    cooldown: COOLDOWN_PER_RANK ** (rank - 1),
    range: 1,
    radius: def.kind === 'aura' ? 1 + AURA_RADIUS_PER_RANK * (rank - 1) : 1,
    arc: def.arc?.(rank) ?? Math.PI,
    count: def.count?.(rank) ?? 1,
    pierce: def.pierce?.(rank) ?? 0,
    knockback: 1,
    statuses: legacyStatuses(def),
    flags: NO_FLAGS,
  };
}

/** Alle Ränge eines Angriffs, von 1 bis `MAX_RANK`. */
function resolveAll(def: WeaponDef): readonly ResolvedRank[] {
  const table = def.ranks ?? [];
  const named: RankRule = {};
  const all: ResolvedRank[] = [];
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    // Was ein Rang nennt, merkt sich `named` für die folgenden.
    Object.assign(named, table[rank - 1]);
    const resolved = ruleRank(def, rank);
    all.push({
      rank,
      damage: named.damage ?? resolved.damage,
      cooldown: named.cooldown ?? resolved.cooldown,
      range: named.range ?? resolved.range,
      radius: named.radius ?? resolved.radius,
      arc: named.arc ?? resolved.arc,
      count: named.count ?? resolved.count,
      pierce: named.pierce ?? resolved.pierce,
      knockback: named.knockback ?? resolved.knockback,
      statuses: named.statuses ?? resolved.statuses,
      flags: named.flags ?? resolved.flags,
    });
  }
  return all;
}

const RANKS = new Map(DEFS.map((def) => [def.id, resolveAll(def)]));

/** Die fertige Zeile eines Rangs (1 bis `MAX_RANK`) eines Angriffs; sie liegt vorberechnet da, im Kampf entsteht nichts. */
export function resolveRank(def: WeaponDef, rank: number): ResolvedRank {
  const all = RANKS.get(def.id) ?? resolveAll(def);
  const row = all[Math.min(Math.max(rank, 1), MAX_RANK) - 1];
  if (!row) throw new Error(`Kein Rang ${rank} für ${def.id}`);
  return row;
}

/** Hat der Rang diesen Schalter gesetzt? */
export function hasFlag(rules: ResolvedRank, flag: string): boolean {
  return rules.flags.includes(flag);
}

/** Die Sekunden, die ein Rang einen Zustand anbringt; 0, wenn er ihn nicht anbringt. */
export function statusSeconds(rules: ResolvedRank, kind: StatusApply['kind']): number {
  for (const entry of rules.statuses) if (entry.kind === kind) return entry.seconds;
  return 0;
}

export function weaponById(id: string): WeaponDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unbekannter Angriff: ${id}`);
  return def;
}
