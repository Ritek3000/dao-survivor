/**
 * Alle Angriffe als Daten. Einheiten: Meter und Sekunden.
 * Die Zauber des Magiers folgen den Effektfamilien aus den Magie-Vorlagen des Nutzers:
 * nichts schwebt, nichts entsteht aus dem Nichts.
 */

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
  | 'boee'
  | 'brand';

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
  /** Sekunden, die Getroffene festgehalten werden: umgeworfen, verwurzelt oder geblendet. */
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
}

export const MAX_RANK = 5;
/** Jeder Rang über dem ersten bringt so viel Schaden dazu. */
export const DAMAGE_PER_RANK = 0.25;
/** Jeder Rang über dem ersten verkürzt die Abklingzeit auf diesen Anteil. */
export const COOLDOWN_PER_RANK = 0.94;
/** Geschwächte Gegner erleiden so viel mehr Schaden. */
export const WEAK_FACTOR = 1.3;

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
    id: 'sorhennas-brand',
    name: 'Sorhennas Brand',
    text: 'Weißer Lichtstoß, blendet alle im Umkreis',
    kind: 'nova',
    look: 'brand',
    cooldown: 9,
    damage: 0,
    range: 7.5,
    hold: 2.2,
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

export function weaponById(id: string): WeaponDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unbekannter Angriff: ${id}`);
  return def;
}
