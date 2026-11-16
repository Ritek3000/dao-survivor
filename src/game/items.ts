/**
 * Gegenstände: Ausrüstung, die zwischen den Nächten angelegt wird und die Werte der Figur bestimmt.
 *
 * Neun Plätze (Fackel, Helm, Gürtel, Waffe, Handschuh, Schuh, Ring, Brustrüstung, Amulett), vier Seltenheiten. Ein Gegenstand
 * trägt je nach Seltenheit eine bis drei Eigenschaften; jede würfelt ihren Wert einmal beim Entstehen aus dem Bereich, den
 * `CONFIG.items` für sie und den Platz vorgibt. Danach ändert sich der Gegenstand nicht mehr.
 *
 * Welche Eigenschaft auf welchen Plätzen vorkommen kann, steht hier in den Daten (`PROPERTIES`), die Zahlen in `config.ts`.
 * Die Wirkung läuft über denselben Haken wie früher die Steigerungen: `applyItems` setzt die Eigenschaften auf die Werte,
 * mit denen eine Nacht beginnt (`Progression.reset`). Gegenstände ändern nur Werte, nicht das Aussehen der Figur.
 *
 * Lore: Die Wiki-Vorlagen kennen kein solches System; Namen, Plätze und Eigenschaften sind ein Vorschlag für das Spiel.
 */

import { CONFIG } from '../config';
import type { Random } from '../core/random';
import { CLASSES, type ClassId } from './classes';
import type { Stats } from './progression';

export const ITEM_SLOTS = ['fackel', 'helm', 'guertel', 'waffe', 'handschuh', 'schuh', 'ring', 'brust', 'amulett'] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

export const RARITIES = ['normal', 'selten', 'rar', 'legendaer'] as const;
export type Rarity = (typeof RARITIES)[number];

export type PropertyId = keyof typeof CONFIG.items.properties;

export interface ItemProperty {
  id: PropertyId;
  /** In der Einheit der Anzeige: Prozent, Punkte oder Leben (siehe `CONFIG.items`). */
  value: number;
}

export interface Item {
  /** Fortlaufende Nummer, die der Spielstand vergibt; 0 = noch nicht abgelegt. */
  id: number;
  slot: ItemSlot;
  rarity: Rarity;
  /** Fackel, Waffe und ein legendärer Ring gehören zu einer Klasse und lassen sich nur von ihr anlegen. */
  classId?: ClassId;
  props: ItemProperty[];
}

/**
 * Auf diesen Plätzen kann es Legendäres geben, sonst nirgends: Ein legendärer Ring trägt später die Evolution einer
 * Fertigkeit der Klasse (siehe Entwurf zu Gegenständen, Entscheidung 2). Weitere Plätze brauchten je einen eigenen Effekt.
 */
export const LEGENDARY_SLOTS: readonly ItemSlot[] = ['ring'];

/** Wie viele Eigenschaften ein Gegenstand der Seltenheit trägt. Legendär bringt zu den dreien später eine Evolution. */
export const RARITY_PROPERTIES: Readonly<Record<Rarity, number>> = { normal: 1, selten: 2, rar: 3, legendaer: 3 };

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  normal: 'Normal',
  selten: 'Selten',
  rar: 'Rar',
  legendaer: 'Legendär',
};

const SLOT_LABELS: Readonly<Record<ItemSlot, string>> = {
  fackel: 'Fackel',
  helm: 'Helm',
  guertel: 'Gürtel',
  waffe: 'Waffe',
  handschuh: 'Handschuhe',
  schuh: 'Schuhe',
  ring: 'Ring',
  brust: 'Brustrüstung',
  amulett: 'Amulett',
};

/** Der Magier trägt keine Fackel, sondern ein Kerzenwort, und führt ein Zauberbuch statt einer Waffe aus Stahl. */
const CLASS_SLOT_LABELS: Readonly<Record<ClassId, Partial<Record<ItemSlot, string>>>> = {
  kaempfer: { waffe: 'Axt' },
  wildnislaeufer: { waffe: 'Bogen' },
  magier: { fackel: 'Kerzenwort', waffe: 'Zauberbuch' },
};

interface PropertyDef {
  name: string;
  /** Hängt sich an den Namen des Gegenstands: „Ring der Wucht“. */
  suffix: string;
  unit: '%' | '';
  /** Die Plätze, auf denen die Eigenschaft würfeln kann. */
  slots: readonly ItemSlot[];
  /** Setzt die Summe aller angelegten Werte dieser Eigenschaft (in der Einheit der Anzeige) auf die Werte der Nacht. */
  apply(stats: Stats, total: number): void;
}

/**
 * Die 17 Eigenschaften der ersten Fassung: zwölf aus den alten Steigerungen, dazu Krit-Schaden, Schonfrist, Rastheilung,
 * Brenndauer und Zündtempo. Keine Heilung im Kampf, denn im Spiel gilt: Heilung nur im Licht. Jede Eigenschaft hat nur auf
 * zwei bis acht Plätzen Platz, damit sich keine über alle neun stapeln lässt.
 */
const PROPERTIES: Readonly<Record<PropertyId, PropertyDef>> = {
  schaden: {
    name: 'Schaden',
    suffix: 'der Wucht',
    unit: '%',
    slots: ['waffe', 'handschuh', 'ring'],
    apply: (s, v) => void (s.damage += v / 100),
  },
  tempo: {
    name: 'Angriffstempo',
    suffix: 'der Eile',
    unit: '%',
    slots: ['waffe', 'handschuh', 'ring'],
    apply: (s, v) => void (s.cooldown *= 1 - v / 100),
  },
  kritChance: {
    name: 'Krit-Chance',
    suffix: 'der Treffsicherheit',
    unit: '%',
    slots: ['waffe', 'handschuh', 'ring'],
    apply: (s, v) => void (s.critChance += v / 100),
  },
  kritSchaden: {
    name: 'Krit-Schaden',
    suffix: 'der Härte',
    unit: '%',
    slots: ['waffe', 'ring', 'amulett'],
    apply: (s, v) => void (s.critDamage += v / 100),
  },
  reichweite: {
    name: 'Reichweite',
    suffix: 'der Weite',
    unit: '%',
    slots: ['waffe', 'handschuh'],
    apply: (s, v) => void (s.reach += v / 100),
  },
  leben: {
    name: 'Leben',
    suffix: 'der Zähigkeit',
    unit: '',
    slots: ['helm', 'guertel', 'schuh', 'brust', 'amulett'],
    apply: (s, v) => void (s.maxHp += v),
  },
  ruestung: {
    name: 'Rüstung',
    suffix: 'der Panzerung',
    unit: '',
    slots: ['helm', 'guertel', 'schuh', 'brust'],
    apply: (s, v) => void (s.armor += v),
  },
  staub: {
    name: 'Staubfestigkeit',
    suffix: 'gegen den Staub',
    unit: '%',
    slots: ['fackel', 'helm', 'brust', 'amulett'],
    apply: (s, v) => void (s.verstaubung *= 1 - v / 100),
  },
  schonfrist: {
    name: 'Schonfrist',
    suffix: 'der Schonung',
    unit: '%',
    slots: ['helm', 'guertel', 'schuh', 'brust'],
    apply: (s, v) => void (s.grace += v / 100),
  },
  rastheilung: {
    name: 'Rastheilung',
    suffix: 'der Rast',
    unit: '%',
    slots: ['fackel', 'guertel', 'brust', 'amulett'],
    apply: (s, v) => void (s.restHeal += v / 100),
  },
  lauftempo: {
    name: 'Lauftempo',
    suffix: 'des Läufers',
    unit: '%',
    slots: ['guertel', 'schuh', 'amulett'],
    apply: (s, v) => void (s.speed += v / 100),
  },
  sammelradius: {
    name: 'Sammelradius',
    suffix: 'des Sammlers',
    unit: '%',
    slots: ['guertel', 'handschuh', 'schuh', 'ring'],
    apply: (s, v) => void (s.pickup += v / 100),
  },
  erfahrung: {
    name: 'Erfahrung',
    suffix: 'des Lehrlings',
    unit: '%',
    slots: ['helm', 'ring', 'amulett'],
    apply: (s, v) => void (s.xp += v / 100),
  },
  gold: {
    name: 'Goldfund',
    suffix: 'des Händlers',
    unit: '%',
    slots: ['guertel', 'ring', 'amulett'],
    apply: (s, v) => void (s.gold += v / 100),
  },
  licht: {
    name: 'Lichtschein',
    suffix: 'des Scheins',
    unit: '%',
    slots: ['fackel', 'helm', 'amulett'],
    apply: (s, v) => void (s.light += v / 100),
  },
  brenndauer: {
    name: 'Brenndauer',
    suffix: 'der Glut',
    unit: '%',
    slots: ['fackel'],
    apply: (s, v) => void (s.burn += v / 100),
  },
  zuendtempo: {
    name: 'Zündtempo',
    suffix: 'des Funkens',
    unit: '%',
    slots: ['fackel'],
    apply: (s, v) => void (s.ignite += v / 100),
  },
};

const PROPERTY_IDS = Object.keys(PROPERTIES) as PropertyId[];

const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rundet auf das Raster des Werts und putzt die Fließkommareste (0,1 + 0,2 und Ähnliches). */
function snap(value: number, step: number, round: (x: number) => number): number {
  return Number((round(value / step + 1e-9) * step).toFixed(2));
}

/** Fackel, Waffe und Legendäres (ein Ring mit der Evolution einer Fertigkeit) gehören zu einer Klasse. */
export function isClassBound(slot: ItemSlot, rarity: Rarity): boolean {
  return slot === 'fackel' || slot === 'waffe' || rarity === 'legendaer';
}

/** Gibt es die Seltenheit auf dem Platz? Legendäres nur auf `LEGENDARY_SLOTS`. */
export function isPossible(slot: ItemSlot, rarity: Rarity): boolean {
  return rarity !== 'legendaer' || LEGENDARY_SLOTS.includes(slot);
}

/** Darf `classId` den Gegenstand anlegen? Der Platz ist dabei nicht gemeint, nur die Bindung an eine Klasse. */
export function canEquip(item: Item, classId: ClassId): boolean {
  return item.classId === undefined || item.classId === classId;
}

/** Name des Platzes; bei Fackel und Waffe nach Klasse (Kerzenwort, Axt, Bogen, Zauberbuch). */
export function slotLabel(slot: ItemSlot, classId?: ClassId): string {
  return (classId ? CLASS_SLOT_LABELS[classId][slot] : undefined) ?? SLOT_LABELS[slot];
}

export function propertyName(id: PropertyId): string {
  return PROPERTIES[id].name;
}

/** Kleinster und größter Wurf einer Eigenschaft auf einem Platz; der Kernplatz hebt beide an. */
export function propertyRange(id: PropertyId, slot: ItemSlot): { min: number; max: number } {
  const config = CONFIG.items.properties[id];
  const factor = (config.core as Partial<Record<ItemSlot, number>>)[slot] ?? 1;
  return { min: snap(config.min * factor, config.step, Math.floor), max: snap(config.max * factor, config.step, Math.floor) };
}

/** Wo der Wurf im Bereich liegt: 0 ist der schwächste, 1 der stärkste. */
export function propertyQuality(slot: ItemSlot, property: ItemProperty): number {
  const { min, max } = propertyRange(property.id, slot);
  if (max <= min) return 1;
  return Math.min(1, Math.max(0, (property.value - min) / (max - min)));
}

export function formatValue(id: PropertyId, value: number, signed = true): string {
  const sign = signed && value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${NUMBER.format(Math.abs(value))}${PROPERTIES[id].unit === '%' ? ' %' : ''}`;
}

/** Der Bereich, aus dem ein Wurf auf dem Platz kommt, für die Karte: „6–14 %“. */
export function formatRange(id: PropertyId, slot: ItemSlot): string {
  const { min, max } = propertyRange(id, slot);
  return `${NUMBER.format(min)}–${NUMBER.format(max)}${PROPERTIES[id].unit === '%' ? ' %' : ''}`;
}

/** Eine Zeile für die Karte: „Schaden +9 %“. */
export function describeProperty(property: ItemProperty): string {
  return `${PROPERTIES[property.id].name} ${formatValue(property.id, property.value)}`;
}

/** „Ring der Wucht“: der Platz und das Anhängsel der Eigenschaft, die am besten gewürfelt hat. */
export function itemName(item: Item): string {
  const label = slotLabel(item.slot, item.classId);
  let best: ItemProperty | undefined;
  let bestQuality = -1;
  for (const property of item.props) {
    const quality = propertyQuality(item.slot, property);
    if (quality > bestQuality) {
      best = property;
      bestQuality = quality;
    }
  }
  return best ? `${label} ${PROPERTIES[best.id].suffix}` : label;
}

/** Wie gut der Wurf insgesamt ist: der Durchschnitt der Güte seiner Eigenschaften, von 0 bis 1. */
export function itemQuality(item: Item): number {
  if (item.props.length === 0) return 0;
  return item.props.reduce((sum, property) => sum + propertyQuality(item.slot, property), 0) / item.props.length;
}

/** Was der Gegenstand wert ist: die Basis seiner Seltenheit mal (0,75 + 0,5 × Güte), also 75 bis 125 % davon. */
export function itemValue(item: Item): number {
  return Math.round(CONFIG.items.price[item.rarity] * (0.75 + 0.5 * itemQuality(item)));
}

/** Was ein Verkauf einbringt: ein Viertel des Werts (`CONFIG.items.price.sellShare`), mindestens 1 Gold. */
export function sellPrice(item: Item): number {
  return Math.max(1, Math.round(itemValue(item) * CONFIG.items.price.sellShare));
}

function rollValue(random: Random, id: PropertyId, slot: ItemSlot): number {
  const { min, max } = propertyRange(id, slot);
  const step = CONFIG.items.properties[id].step;
  return Math.min(max, Math.max(min, snap(min + random() * (max - min), step, Math.round)));
}

/**
 * Würfelt einen neuen Gegenstand: Die Eigenschaften werden aus denen des Platzes gezogen (keine doppelt),
 * ihre Werte gleichverteilt aus dem Bereich. Fackel, Waffe und legendärer Ring brauchen eine Klasse.
 * Die Nummer vergibt erst der Spielstand (`Ausruestung.add`).
 */
export function rollItem(random: Random, slot: ItemSlot, rarity: Rarity, classId?: ClassId): Item {
  if (!isPossible(slot, rarity)) throw new Error(`Auf dem Platz „${slotLabel(slot)}“ gibt es nichts ${RARITY_LABELS[rarity]}.`);
  const bound = isClassBound(slot, rarity);
  if (bound && !classId) throw new Error(`Der Gegenstand „${slotLabel(slot)}“ (${rarity}) braucht eine Klasse.`);
  const pool = PROPERTY_IDS.filter((id) => PROPERTIES[id].slots.includes(slot));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a === undefined || b === undefined) continue;
    pool[i] = b;
    pool[j] = a;
  }
  const props = pool.slice(0, RARITY_PROPERTIES[rarity]).map((id) => ({ id, value: rollValue(random, id, slot) }));
  const item: Item = { id: 0, slot, rarity, props };
  if (bound && classId) item.classId = classId;
  return item;
}

/**
 * Liest einen Gegenstand aus dem Spielstand. Was nicht passt (unbekannter Platz oder Name, doppelte oder auf dem Platz
 * unmögliche Eigenschaft, fehlende Klasse), wird verworfen; Werte außerhalb des heutigen Bereichs rücken an dessen Rand,
 * damit eine von Hand bearbeitete Datei oder ein später verengter Bereich nichts über die Grenzen hinaushebt.
 */
export function parseItem(raw: unknown): Item | null {
  if (!isRecord(raw)) return null;
  const { slot, rarity } = raw;
  if (!ITEM_SLOTS.includes(slot as ItemSlot) || !RARITIES.includes(rarity as Rarity)) return null;
  const typedSlot = slot as ItemSlot;
  const typedRarity = rarity as Rarity;
  if (!isPossible(typedSlot, typedRarity)) return null;
  const bound = isClassBound(typedSlot, typedRarity);
  const classId = CLASSES.find((entry) => entry.id === raw.classId)?.id;
  if (bound && !classId) return null;
  if (!Array.isArray(raw.props)) return null;

  const props: ItemProperty[] = [];
  for (const entry of raw.props) {
    if (!isRecord(entry)) continue;
    const id = entry.id as PropertyId;
    const def = PROPERTIES[id] as PropertyDef | undefined;
    if (!def || !def.slots.includes(typedSlot) || props.some((property) => property.id === id)) continue;
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) continue;
    const { min, max } = propertyRange(id, typedSlot);
    props.push({ id, value: Math.min(max, Math.max(min, entry.value)) });
  }
  if (props.length === 0) return null;
  const id = typeof raw.id === 'number' && Number.isFinite(raw.id) ? Math.max(0, Math.floor(raw.id)) : 0;
  const item: Item = { id, slot: typedSlot, rarity: typedRarity, props: props.slice(0, RARITY_PROPERTIES[typedRarity]) };
  if (bound && classId) item.classId = classId;
  return item;
}

/** Die Summe jeder Eigenschaft über alle Gegenstände, nach oben auf `CONFIG.items` (`cap`) begrenzt. */
export function propertyTotals(items: Iterable<Item>): Map<PropertyId, number> {
  const totals = new Map<PropertyId, number>();
  for (const item of items) {
    for (const property of item.props) totals.set(property.id, (totals.get(property.id) ?? 0) + property.value);
  }
  for (const [id, total] of totals) {
    totals.set(id, Number(Math.min(total, CONFIG.items.properties[id].cap).toFixed(2)));
  }
  return totals;
}

/** Überträgt die angelegten Gegenstände auf die Werte, mit denen die Nacht beginnt. */
export function applyItems(stats: Stats, items: Iterable<Item>): void {
  for (const [id, total] of propertyTotals(items)) PROPERTIES[id].apply(stats, total);
}

/** Was sich ändert, wenn `next` an die Stelle von `current` tritt: je Eigenschaft der Unterschied der Werte. */
export function compareItems(next: Item, current: Item | null): { id: PropertyId; delta: number }[] {
  const ids = new Set<PropertyId>([...next.props.map((p) => p.id), ...(current?.props.map((p) => p.id) ?? [])]);
  const value = (item: Item | null, id: PropertyId): number => item?.props.find((p) => p.id === id)?.value ?? 0;
  const result: { id: PropertyId; delta: number }[] = [];
  for (const id of ids) {
    const delta = Number((value(next, id) - value(current, id)).toFixed(2));
    if (delta !== 0) result.push({ id, delta });
  }
  return result;
}
