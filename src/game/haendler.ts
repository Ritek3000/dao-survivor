/**
 * Der Händler: sein Angebot, die Rückkaufliste und der Preis fürs Erneuern des Angebots.
 *
 * Dieser Teil kennt nur die Form und die Zahlen: wie ein Angebot gewürfelt wird, was Erneuern kostet und wie das Ganze gelesen und
 * geschrieben wird. Gekauft, verkauft und gespeichert wird in `Ausruestung` (der Handel ändert Gold, Gegenstände und Angebot in einem
 * Zug); das Menü dazu ist `lager.ts`. Alle Zahlen stehen in `CONFIG.items.shop` und `CONFIG.items.price`.
 *
 * Preise: Der Händler verkauft zum vollen Wert eines Gegenstands (`itemValue`) und kauft für ein Viertel davon (`sellPrice`). Das
 * Verhältnis 4 zu 1 verhindert eine Schleife aus Kaufen und Verkaufen.
 */

import { CONFIG } from '../config';
import type { StoredShop } from '../core/savegame';
import type { Random } from '../core/random';
import { CLASSES } from './classes';
import { ITEM_SLOTS, parseItem, rollItem, type Item, type ItemSlot, type Rarity } from './items';

export interface HaendlerStand {
  /**
   * Ist das Angebot gewürfelt? Nach jeder gespielten Nacht wird es `false`; gewürfelt wird erst, wenn man den Händler wieder
   * ansieht. So bleibt ein leer gekauftes Angebot leer, bis die nächste Nacht gespielt ist (oder man es erneuert).
   */
  stocked: boolean;
  /** Das Angebot; gekaufte Plätze sind `null`. */
  stock: (Item | null)[];
  /** Die zuletzt verkauften Gegenstände, der jüngste vorn. */
  buyback: Item[];
  /** Wie oft das Angebot in dieser Nacht schon erneuert wurde. */
  rerolls: number;
}

export function emptyStand(): HaendlerStand {
  return { stocked: false, stock: [], buyback: [], rerolls: 0 };
}

/** Was das Erneuern des Angebots kostet, wenn es schon `count`-mal erneuert wurde: 0, 25, 50, 100, 200, … Gold. */
export function rerollPrice(count: number): number {
  if (count <= 0) return 0;
  // Die Hochzahl ist begrenzt, damit der Preis in jedem Fall eine gewöhnliche Zahl bleibt.
  return CONFIG.items.shop.rerollPrice * 2 ** Math.min(count - 1, 30);
}

/** Verlangt das Spiel beim Kaufen und Verkaufen eine Rückfrage? Ab Rar, denn dort geht es um viel Gold. */
export function needsConfirm(item: Item): boolean {
  return item.rarity === 'rar' || item.rarity === 'legendaer';
}

/**
 * Würfelt ein neues Angebot: meist Normal, einige Selten, höchstens ein Rarer und mit kleiner Chance je Platz ein legendärer Ring.
 * Der Platz ist gleich verteilt; Waffe, Fackel und der legendäre Ring gehören zu einer zufälligen Klasse. Die Nummern vergibt der
 * Aufrufer (`Ausruestung`), damit ein Gegenstand im Angebot schon eine feste Kennung hat.
 */
export function rollStock(random: Random): Item[] {
  const { size, chances } = CONFIG.items.shop;
  const items: Item[] = [];
  let rare = 0;
  for (let i = 0; i < size; i++) {
    const roll = random();
    let rarity: Rarity = 'normal';
    if (roll < chances.legendaer) rarity = 'legendaer';
    else if (roll < chances.legendaer + chances.rar && rare === 0) {
      rarity = 'rar';
      rare++;
    } else if (random() < chances.selten) rarity = 'selten';
    const slot: ItemSlot = rarity === 'legendaer' ? 'ring' : (ITEM_SLOTS[Math.floor(random() * ITEM_SLOTS.length)] ?? 'ring');
    const owner = CLASSES[Math.floor(random() * CLASSES.length)];
    items.push(rollItem(random, slot, rarity, owner?.id));
  }
  return items;
}

/**
 * Liest den Stand des Händlers aus dem Spielstand; jeder Gegenstand wird einzeln geprüft (`parseItem`), `onItem` meldet die gültigen.
 * Ein Angebot, das nicht (mehr) gewürfelt ist, bleibt leer: Es wird beim nächsten Ansehen neu gewürfelt.
 */
export function parseStand(stored: StoredShop, onItem: (item: Item) => void): HaendlerStand {
  const { size, buybackSize } = CONFIG.items.shop;
  const stand = emptyStand();
  stand.stocked = stored.stocked;
  stand.rerolls = stored.rerolls;
  for (let index = 0; index < size; index++) {
    const item = stored.stocked ? parseItem(stored.stock[index]) : null;
    stand.stock.push(item);
    if (item) onItem(item);
  }
  for (const raw of stored.buyback.slice(0, buybackSize)) {
    const item = parseItem(raw);
    if (!item) continue;
    stand.buyback.push(item);
    onItem(item);
  }
  return stand;
}

export function serializeStand(stand: HaendlerStand): StoredShop {
  return { stocked: stand.stocked, stock: [...stand.stock], buyback: [...stand.buyback], rerolls: stand.rerolls };
}
