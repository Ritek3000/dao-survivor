/**
 * Der Spielstand, der den Neustart überdauern soll: das Gold, die Ränge der Steigerungen, die Gegenstände jeder Klasse, die Truhe
 * und der Stand des Händlers.
 *
 * Wo er liegt, versteckt `TextStore` (siehe `storage.ts`): im Browser in `localStorage`, in einer Desktop-Hülle
 * später etwa in einer Datei; dafür gibt es `useSavegameStore`. Gespeichert wird als JSON mit Versionsnummer.
 *
 * Neue Fassungen des Formats heben ältere Stände in `parseSavegame` an, Schritt für Schritt von der alten zur nächsten
 * Nummer; so geht beim Umbau von Steigerungen kein Gold verloren. Dieser Teil kennt keine Klassen und Steigerungen
 * und behält darum auch Einträge, die das Spiel gerade nicht kennt (etwa nach einem Rückschritt auf eine ältere Fassung):
 * Sie werden nicht angezeigt, aber auch nicht gelöscht.
 */

import { browserTextStore, type TextStore } from './storage';

/** Die Fassung des Formats, die dieser Code schreibt. */
export const SAVEGAME_VERSION = 5;

/** Obergrenze für einen Rang beim Lesen; schützt vor Unsinn in einer von Hand bearbeiteten Datei. */
const MAX_STORED_RANK = 99;
/** Obergrenze für die Plätze, die je Klasse gelesen werden; das Spiel selbst kennt weniger (`CONFIG.items.inventorySize`). */
const MAX_STORED_SLOTS = 200;
/** Obergrenze für die Zahl der Boss-Kisten ohne Legendäres, die der Pech-Schutz zählt. */
const MAX_STORED_PITY = 99;
/** Obergrenzen für die Reiter der Truhe beim Lesen; das Spiel selbst kennt weniger (`CONFIG.items.truhe`). */
const MAX_STORED_TABS = 64;
const MAX_STORED_NAME = 40;
const MAX_STORED_COLOR = 99;
/** Obergrenze für die Plätze des Angebots und des Rückkaufs beim Lesen; das Spiel selbst kennt weniger (`CONFIG.items.shop`). */
const MAX_STORED_SHOP = 40;
/** Obergrenze für die Zahl der Erneuerungen des Angebots; der Preis wächst ohnehin ins Unbezahlbare. */
const MAX_STORED_REROLLS = 99;

/**
 * Die Gegenstände der Klassen, so wie sie im Spielstand liegen. Was ein Gegenstand ist, kennt `game/items.ts`; dieser Teil
 * reicht die Einträge unverändert weiter und prüft sie nicht, damit auch Gegenstände einer anderen Fassung erhalten bleiben.
 */
export interface StoredChest {
  /** Die Reiter in ihrer Reihenfolge; jeder hat einen Namen, eine Farbe (Nummer) und seine Plätze (leere als `null`). */
  tabs: { name: string; color: number; slots: unknown[] }[];
}

/** Der Stand des Händlers: sein Angebot (gekaufte Plätze als `null`), die verkauften Gegenstände und wie oft er erneuert wurde. */
export interface StoredShop {
  /** Ist das Angebot gewürfelt? Nach jeder gespielten Nacht nicht mehr; dann wird neu gewürfelt, wenn man den Händler ansieht. */
  stocked: boolean;
  stock: unknown[];
  /** Die zuletzt verkauften Gegenstände, der jüngste vorn. */
  buyback: unknown[];
  /** Wie oft das Angebot in dieser Nacht schon erneuert wurde. */
  rerolls: number;
}

export interface StoredItems {
  /** Die nächste Nummer, die ein neuer Gegenstand bekommt. */
  next: number;
  /** Je Klasse das Inventar (Plätze in Reihenfolge, leere als `null`) und die angelegten Gegenstände nach Platz. */
  classes: Record<string, { inventory: unknown[]; equipment: Record<string, unknown> }>;
  /** Seit Fassung 3: Wie viele Boss-Kisten in Folge ohne Legendäres blieben (Pech-Schutz, siehe `game/beute.ts`). */
  pity: number;
  /** Seit Fassung 4: die Truhe für alle Klassen. Ohne Reiter beginnt das Spiel mit einem leeren. */
  chest: StoredChest;
  /** Seit Fassung 5: der Händler. */
  shop: StoredShop;
}

export interface Savegame {
  version: number;
  /** Gold in der Geldbörse; sie gehört allen Klassen gemeinsam. */
  gold: number;
  /** Rang jeder Steigerung je Klasse: `ranks[klasse][steigerung]`. */
  ranks: Record<string, Record<string, number>>;
  /** Seit Fassung 2: die Gegenstände. */
  items: StoredItems;
}

export type SavegameStore = TextStore;

const KEY = 'dao-survivor.spielstand';

let store: SavegameStore = browserTextStore(KEY);

/** Ersetzt den Speicher, etwa durch eine Datei in einer Desktop-Hülle. */
export function useSavegameStore(next: SavegameStore): void {
  store = next;
}

export function emptySavegame(): Savegame {
  return { version: SAVEGAME_VERSION, gold: 0, ranks: {}, items: emptyItems() };
}

function emptyItems(): StoredItems {
  return { next: 1, classes: {}, pity: 0, chest: { tabs: [] }, shop: emptyShop() };
}

function emptyShop(): StoredShop {
  return { stocked: false, stock: [], buyback: [], rerolls: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
}

/** Macht aus gespeichertem Text einen Spielstand; was fehlt oder unbrauchbar ist, fängt bei null an. */
export function parseSavegame(text: string | null): Savegame {
  const save = emptySavegame();
  if (text === null) return save;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Beschädigter Text: Es beginnt ein leerer Stand. Überschrieben wird erst beim nächsten Speichern.
    return save;
  }
  if (!isRecord(parsed)) return save;
  // Ältere Fassungen werden Schritt für Schritt auf die nächste gehoben.
  const version = typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 1;
  let raw = parsed;
  if (version < 2) raw = von1auf2(raw);
  if (version < 3) raw = von2auf3(raw);
  if (version < 4) raw = von3auf4(raw);
  if (version < 5) raw = von4auf5(raw);

  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) {
    // Ein Stand aus einer neueren Fassung wird so gut gelesen wie möglich, seine Nummer aber nicht zurückgesetzt.
    save.version = Math.max(SAVEGAME_VERSION, Math.floor(raw.version));
  }
  save.gold = wholeNumber(raw.gold, Number.MAX_SAFE_INTEGER);
  if (isRecord(raw.ranks)) {
    for (const [classId, perClass] of Object.entries(raw.ranks)) {
      if (!isRecord(perClass)) continue;
      const ranks: Record<string, number> = {};
      for (const [id, rank] of Object.entries(perClass)) {
        const whole = wholeNumber(rank, MAX_STORED_RANK);
        if (whole > 0) ranks[id] = whole;
      }
      save.ranks[classId] = ranks;
    }
  }
  save.items = parseItems(raw.items);
  return save;
}

/** Fassung 1 kannte keine Gegenstände; Gold und Ränge bleiben, wie sie sind. */
function von1auf2(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: 2, items: emptyItems() };
}

/** Fassung 2 kannte den Pech-Schutz der Boss-Kisten nicht; er beginnt bei null. */
function von2auf3(raw: Record<string, unknown>): Record<string, unknown> {
  const items = isRecord(raw.items) ? raw.items : emptyItems();
  return { ...raw, version: 3, items: { ...items, pity: 0 } };
}

/** Fassung 3 kannte keine Truhe; sie beginnt mit einem leeren Reiter (den legt das Spiel an). */
function von3auf4(raw: Record<string, unknown>): Record<string, unknown> {
  const items = isRecord(raw.items) ? raw.items : emptyItems();
  return { ...raw, version: 4, items: { ...items, chest: { tabs: [] } } };
}

/** Fassung 4 kannte keinen Händler; sein Angebot wird gewürfelt, wenn man ihn zum ersten Mal ansieht. */
function von4auf5(raw: Record<string, unknown>): Record<string, unknown> {
  const items = isRecord(raw.items) ? raw.items : emptyItems();
  return { ...raw, version: 5, items: { ...items, shop: emptyShop() } };
}

function parseShop(raw: unknown): StoredShop {
  const shop = emptyShop();
  if (!isRecord(raw)) return shop;
  shop.stocked = raw.stocked === true;
  shop.stock = Array.isArray(raw.stock) ? raw.stock.slice(0, MAX_STORED_SHOP) : [];
  shop.buyback = Array.isArray(raw.buyback) ? raw.buyback.slice(0, MAX_STORED_SHOP) : [];
  shop.rerolls = wholeNumber(raw.rerolls, MAX_STORED_REROLLS);
  return shop;
}

function parseChest(raw: unknown): StoredChest {
  const chest: StoredChest = { tabs: [] };
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return chest;
  for (const tab of raw.tabs.slice(0, MAX_STORED_TABS)) {
    if (!isRecord(tab)) continue;
    chest.tabs.push({
      name: typeof tab.name === 'string' ? tab.name.slice(0, MAX_STORED_NAME) : '',
      color: wholeNumber(tab.color, MAX_STORED_COLOR),
      slots: Array.isArray(tab.slots) ? tab.slots.slice(0, MAX_STORED_SLOTS) : [],
    });
  }
  return chest;
}

function parseItems(raw: unknown): StoredItems {
  const items = emptyItems();
  if (!isRecord(raw)) return items;
  items.next = Math.max(1, wholeNumber(raw.next, Number.MAX_SAFE_INTEGER));
  items.pity = wholeNumber(raw.pity, MAX_STORED_PITY);
  items.chest = parseChest(raw.chest);
  items.shop = parseShop(raw.shop);
  if (!isRecord(raw.classes)) return items;
  for (const [classId, perClass] of Object.entries(raw.classes)) {
    if (!isRecord(perClass)) continue;
    items.classes[classId] = {
      inventory: Array.isArray(perClass.inventory) ? perClass.inventory.slice(0, MAX_STORED_SLOTS) : [],
      equipment: isRecord(perClass.equipment) ? { ...perClass.equipment } : {},
    };
  }
  return items;
}

/** Liest den gespeicherten Stand; ohne oder mit unbrauchbarem Stand ein leerer. */
export function loadSavegame(): Savegame {
  return parseSavegame(store.read());
}

export function writeSavegame(save: Savegame): void {
  store.write(JSON.stringify(save));
}
