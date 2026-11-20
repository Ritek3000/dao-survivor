/**
 * Der Spielstand, der den Neustart überdauern soll: das Gold, die Gegenstände jeder Klasse, die Truhe und der Stand des Händlers.
 *
 * Wo er liegt, versteckt `TextStore` (siehe `storage.ts`): im Browser in `localStorage`, in einer Desktop-Hülle
 * später etwa in einer Datei; dafür gibt es `useSavegameStore`. Gespeichert wird als JSON mit Versionsnummer.
 *
 * Neue Fassungen des Formats heben ältere Stände in `parseSavegame` an, Schritt für Schritt von der alten zur nächsten
 * Nummer; so geht beim Umbau nichts verloren (die entfallenen Ränge der Steigerungen kommen als Gold zurück, siehe `von5auf6`).
 * Dieser Teil kennt keine Klassen und behält darum auch Einträge, die das Spiel gerade nicht kennt (etwa nach einem Rückschritt
 * auf eine ältere Fassung): Sie werden nicht angezeigt, aber auch nicht gelöscht.
 *
 * Bevor ein älterer Stand gehoben wird, legt `loadSavegame` seinen Text unverändert in einer Sicherung ab; so lässt sich nach
 * einem Umbau, der Daten verwirft, der alte Stand zurückholen.
 *
 * Zum Wegsichern gibt es die Sicherungsdatei: `writeSavegameFile` macht aus dem Stand den Text einer Datei, `readSavegameFile`
 * liest ihn wieder ein (auch von einer älteren Fassung, dann wird er gehoben). Die Datei zu speichern und zu wählen ist Sache von
 * `dateien.ts`; dieser Teil kennt nur den Text.
 */

import { browserTextStore, type TextStore } from './storage';

/** Die Fassung des Formats, die dieser Code schreibt. */
export const SAVEGAME_VERSION = 7;
/**
 * Stände von einer älteren Fassung als dieser werden vor dem Heben gesichert. Das Heben von Fassung 6 auf 7 verwirft nichts; die
 * Sicherung aus der Umstellung auf Fassung 6 (die Ränge der Steigerungen) soll darum nicht davon überschrieben werden.
 */
const BACKUP_BELOW = 6;

/** Obergrenze für einen Rang der entfallenen Steigerungen beim Lesen; schützt vor Unsinn in einer von Hand bearbeiteten Datei. */
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
  /** Seit Fassung 2: die Gegenstände. */
  items: StoredItems;
  /**
   * Seit Fassung 6: Das Gold, das die Umstellung für die entfallenen Steigerungen erstattet hat (schon im `gold` enthalten).
   * Das Spiel zeigt es einmal an und setzt es dann auf 0.
   */
  refund: number;
}

export type SavegameStore = TextStore;

const KEY = 'dao-survivor.spielstand';
/** Unter diesem Schlüssel liegt die Sicherung des Stands von vor der letzten Hebung (siehe `loadSavegame`). */
export const BACKUP_KEY = `${KEY}.sicherung`;

let store: SavegameStore = browserTextStore(KEY);
let backup: SavegameStore | null = browserTextStore(BACKUP_KEY);

/** Ersetzt den Speicher, etwa durch eine Datei in einer Desktop-Hülle; ohne `next`-Sicherung gibt es keine. */
export function useSavegameStore(next: SavegameStore, nextBackup: SavegameStore | null = null): void {
  store = next;
  backup = nextBackup;
}

export function emptySavegame(): Savegame {
  return { version: SAVEGAME_VERSION, gold: 0, items: emptyItems(), refund: 0 };
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
  return isRecord(parsed) ? savegameFromRecord(parsed) : save;
}

/** Macht aus einem gelesenen JSON-Objekt einen Spielstand und hebt ihn dabei auf die Fassung dieses Codes. */
function savegameFromRecord(parsed: Record<string, unknown>): Savegame {
  const save = emptySavegame();
  // Ältere Fassungen werden Schritt für Schritt auf die nächste gehoben.
  const version = typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 1;
  let raw = parsed;
  if (version < 2) raw = von1auf2(raw);
  if (version < 3) raw = von2auf3(raw);
  if (version < 4) raw = von3auf4(raw);
  if (version < 5) raw = von4auf5(raw);
  if (version < 6) raw = von5auf6(raw);
  if (version < 7) raw = von6auf7(raw);

  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) {
    // Ein Stand aus einer neueren Fassung wird so gut gelesen wie möglich, seine Nummer aber nicht zurückgesetzt.
    save.version = Math.max(SAVEGAME_VERSION, Math.floor(raw.version));
  }
  save.gold = wholeNumber(raw.gold, Number.MAX_SAFE_INTEGER);
  save.refund = wholeNumber(raw.refund, Number.MAX_SAFE_INTEGER);
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

/**
 * So viel kostete der erste Rang jeder Steigerung, die es bis Fassung 5 gab, und so viele Ränge hatte sie. Die Steigerungen sind
 * entfallen (Gegenstände ersetzen sie); die Zahlen bleiben hier, damit `von5auf6` das ausgegebene Gold erstatten kann. Es sind
 * eingefrorene Werte der alten Fassung, keine Stellschrauben.
 */
const RETIRED_UPGRADES: Readonly<Record<string, { cost: number; max: number }>> = {
  'offene-hand': { cost: 35, max: 6 },
  lehrjahre: { cost: 40, max: 10 },
  kaufmannsblick: { cost: 60, max: 10 },
  waffenuebung: { cost: 40, max: 10 },
  'flinke-hand': { cost: 45, max: 8 },
  ausdauer: { cost: 45, max: 6 },
  'sicherer-griff': { cost: 50, max: 8 },
  weitblick: { cost: 40, max: 6 },
  abhaertung: { cost: 35, max: 10 },
  ruestungspflege: { cost: 90, max: 3 },
  staubfestigkeit: { cost: 50, max: 6 },
  'heller-schein': { cost: 60, max: 5 },
};
/** Jeder weitere Rang einer Steigerung kostete so viel mal mehr als der vorige (bis Fassung 5). */
const RETIRED_GROWTH = 1.2;

/** Was die Ränge einer Klasse gekostet haben: jeder Rang auf Fünfer gerundet, wie es das Menü der Steigerungen verlangte. */
function spentOnRanks(ranks: unknown): number {
  if (!isRecord(ranks)) return 0;
  let spent = 0;
  for (const [id, value] of Object.entries(ranks)) {
    const upgrade = RETIRED_UPGRADES[id];
    if (!upgrade) continue;
    const rank = Math.min(upgrade.max, wholeNumber(value, MAX_STORED_RANK));
    for (let step = 0; step < rank; step++) spent += Math.max(5, Math.round((upgrade.cost * RETIRED_GROWTH ** step) / 5) * 5);
  }
  return spent;
}

/**
 * Fassung 5 kannte die Steigerungen, Fassung 6 nicht mehr: Alles Gold, das in Ränge geflossen ist, kommt zurück in die Börse
 * (und wird als `refund` gemerkt, damit das Spiel es einmal erklärt). Ränge, die diese Fassung nicht kennt, bleiben ohne Erstattung.
 */
function von5auf6(raw: Record<string, unknown>): Record<string, unknown> {
  let refund = 0;
  if (isRecord(raw.ranks)) {
    for (const perClass of Object.values(raw.ranks)) refund += spentOnRanks(perClass);
  }
  const { ranks: _ranks, ...rest } = raw;
  return { ...rest, version: 6, gold: wholeNumber(raw.gold, Number.MAX_SAFE_INTEGER) + refund, refund };
}

/**
 * Fassung 7: Ein legendärer Ring trägt die Evolution einer Fertigkeit (Feld `evolution` am Gegenstand). Ringe aus Fassung 6 haben
 * keine; `parseItem` gibt jedem eine aus seiner Nummer, sobald er gelesen wird. Sonst ändert sich nichts am Format.
 */
function von6auf7(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: 7 };
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

/** Die Fassung eines gespeicherten Textes; `null`, wenn er sich nicht lesen lässt. */
function storedVersion(text: string): number | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    return typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 1;
  } catch {
    return null;
  }
}

/**
 * Liest den gespeicherten Stand; ohne oder mit unbrauchbarem Stand ein leerer. Ist der Stand von einer Fassung vor `BACKUP_BELOW`, wird sein
 * Text vorher unverändert gesichert (`BACKUP_KEY`), denn das Heben verwirft Daten, die es nicht mehr gibt.
 */
export function loadSavegame(): Savegame {
  const text = store.read();
  if (text !== null && backup) {
    const version = storedVersion(text);
    if (version !== null && version < BACKUP_BELOW && backup.read() !== text) backup.write(text);
  }
  return parseSavegame(text);
}

export function writeSavegame(save: Savegame): void {
  store.write(JSON.stringify(save));
}

/** Was ein Stand dem Spieler wert ist, in zwei Zahlen: das Gold und die Gegenstände (angelegt, im Inventar und in der Truhe). */
export interface SavegameSummary {
  gold: number;
  items: number;
}

export function summarizeSavegame(save: Savegame): SavegameSummary {
  let items = 0;
  for (const perClass of Object.values(save.items.classes)) {
    items += perClass.inventory.filter(isRecord).length + Object.values(perClass.equipment).filter(isRecord).length;
  }
  for (const tab of save.items.chest.tabs) items += tab.slots.filter(isRecord).length;
  return { gold: save.gold, items };
}

/** So große Dateien liest das Spiel höchstens als Spielstand ein; ein echter ist weit kleiner (auch eingerückt nur einige Hundert KB). */
export const MAX_SAVEGAME_FILE_BYTES = 8 * 1024 * 1024;

/** Die Kennung im Feld `datei` der Sicherungsdatei; eine fremde JSON-Datei soll sich nicht als Spielstand einlesen lassen. */
const FILE_KIND = 'dao-survivor-spielstand';

/**
 * Der Text der Sicherungsdatei: der Spielstand, wie er im Speicher liegt, in einem Umschlag mit Kennung, Fassung des Spiels und
 * Zeitpunkt. Der Umschlag hat keine eigene Versionsnummer; die Fassung des Formats steht im Spielstand selbst (`version`).
 * Eingerückt, damit man in die Datei sehen kann.
 */
export function writeSavegameFile(save: Savegame, gameVersion: string, now: Date = new Date()): string {
  return JSON.stringify(
    { datei: FILE_KIND, spiel: 'DAO-Survivor', spielversion: gameVersion, gesichert: now.toISOString(), spielstand: save },
    null,
    2,
  );
}

/** Was `readSavegameFile` aus einer Datei liest. */
export interface SavegameFile {
  /** Der Stand, schon auf die Fassung dieses Codes gehoben. */
  save: Savegame;
  /** Wann die Datei gesichert wurde (Millisekunden seit 1970); `null`, wenn sie es nicht sagt. */
  savedAt: number | null;
  /** Stammt der Stand aus einer neueren Fassung des Spiels? Was dieser Code nicht kennt, bleibt dann stehen, wird aber nicht angezeigt. */
  newer: boolean;
}

/** Sieht ein Objekt wie ein Spielstand aus? `parseSavegame` nimmt zur Not auch Unsinn, eine gewählte Datei soll aber nie still einen leeren Stand ergeben. */
function looksLikeSavegame(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const { version, gold, items } = value;
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 && (typeof gold === 'number' || isRecord(items));
}

/**
 * Liest den Text einer Sicherungsdatei. Auch ein nackter Spielstand ohne Umschlag (etwa aus `localStorage` kopiert) wird genommen.
 * Gibt `null` zurück, wenn der Text kein Spielstand ist; ein beschädigter Stand soll nie einen vorhandenen ersetzen.
 */
export function readSavegameFile(text: string): SavegameFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const wrapped = parsed.datei === FILE_KIND;
  const inner = wrapped ? parsed.spielstand : parsed;
  if (!looksLikeSavegame(inner)) return null;
  const save = savegameFromRecord(inner);
  const stamp = wrapped && typeof parsed.gesichert === 'string' ? Date.parse(parsed.gesichert) : Number.NaN;
  return { save, savedAt: Number.isFinite(stamp) ? stamp : null, newer: save.version > SAVEGAME_VERSION };
}
