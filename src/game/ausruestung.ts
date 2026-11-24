/**
 * Die Gegenstände jeder Klasse: ein Inventar mit festen Plätzen und die neun angelegten Gegenstände, dazu die Truhe, die allen
 * Klassen gemeinsam gehört (`truhe.ts`), und der Stand des Händlers (`haendler.ts`).
 *
 * Jede Klasse hat ihr eigenes Inventar und ihre eigene Ausrüstung; das Gold gehört allen gemeinsam. Gespeichert wird im
 * Spielstand (`core/savegame.ts`, Feld `items`). Wie bei der Börse liest jede Änderung den gespeicherten Stand neu,
 * damit zwei offene Tabs einander nicht überschreiben.
 *
 * Ein Gegenstand wandert zwischen Inventar, Truhe und Ausrüstung mit `move`: Beide Plätze ändern sich in einem Zug oder keiner,
 * so geht auch bei einem Fehlschlag oder einem Neuladen nichts verloren. Ebenso geschieht jeder Handel (kaufen, verkaufen,
 * zurückkaufen, einen Reiter bezahlen) in einem Zug: Gold, Gegenstand und Angebot ändern sich zusammen oder gar nicht. Darum
 * rechnet der Handel hier mit dem Gold des Spielstands, nicht über `Boerse`, die ihren Stand erst neu lesen muss.
 *
 * Angelegt wird nur zwischen den Nächten: Die Werte einer Nacht stehen beim Start fest (`apply` über `Progression.reset`).
 */

import { CONFIG } from '../config';
import { createRandom } from '../core/random';
import { loadSavegame, writeSavegame, type Savegame, type StoredItems } from '../core/savegame';
import { className, CLASSES, type ClassId } from './classes';
import { emptyStand, parseStand, rerollPrice, rollStock, serializeStand, type HaendlerStand } from './haendler';
import {
  applyItems,
  canEquip,
  ITEM_SLOTS,
  itemValue,
  parseItem,
  propertyTotals,
  sellPrice,
  type Item,
  type ItemSlot,
  type PropertyId,
} from './items';
import type { Stats } from './progression';
import { defaultReiterName, emptyReiter, nextReiterPrice, parseTruhe, serializeTruhe, type TruheReiter } from './truhe';

/** Ein Platz, auf dem ein Gegenstand liegen kann. */
export type Place =
  | { kind: 'inventar'; classId: ClassId; index: number }
  | { kind: 'ausruestung'; classId: ClassId; slot: ItemSlot }
  | { kind: 'truhe'; tab: number; index: number };

export function samePlace(a: Place, b: Place): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'inventar' && b.kind === 'inventar') return a.classId === b.classId && a.index === b.index;
  if (a.kind === 'ausruestung' && b.kind === 'ausruestung') return a.classId === b.classId && a.slot === b.slot;
  if (a.kind === 'truhe' && b.kind === 'truhe') return a.tab === b.tab && a.index === b.index;
  return false;
}

/** Was beim Löschen eines Reiters geschehen ist. */
export type RemoveResult = 'ok' | 'letzter' | 'belegt' | 'voll';

/** Der Ausgang eines Handels: der Preis in Gold und, wo ein Gegenstand neu hingekommen ist, sein Platz; sonst der Grund der Absage. */
export type Deal = { ok: true; price: number; place: Place | null } | { ok: false; reason: string };

/** Ein Ort, dessen Gegenstände man dem Händler auf einmal anbieten kann: das Inventar einer Klasse oder ein Reiter der Truhe. */
export type Scope = { kind: 'inventar'; classId: ClassId } | { kind: 'truhe'; tab: number };

interface ClassItems {
  /** Immer `CONFIG.items.inventorySize` Plätze; leere sind `null`. */
  inventory: (Item | null)[];
  equipment: Partial<Record<ItemSlot, Item>>;
}

function emptyClassItems(): ClassItems {
  return { inventory: Array.from({ length: CONFIG.items.inventorySize }, () => null), equipment: {} };
}

export class Ausruestung {
  /**
   * Der Messlauf spielt Nächte im Zeitraffer und schaltet das Speichern ab,
   * damit seine Ausrüstung den Spielstand im Browser nicht verändert.
   */
  persist = true;
  private save: Savegame = loadSavegame();
  private classes = new Map<ClassId, ClassItems>();
  private tabs: TruheReiter[] = [];
  private nextId = 1;
  private pityCount = 0;
  private shop: HaendlerStand = emptyStand();
  /** Für Werkzeuge und Proben: Mit einer Zahl würfelt der Händler bei jedem Angebot der Reihe nach daraus; sonst nach der Uhr. */
  fixedSeed: number | null = null;

  constructor() {
    this.parse();
  }

  /** Liest den Spielstand neu, etwa nachdem ein Werkzeug die Ausrüstung nur zum Ausprobieren gesetzt hat. */
  reload(): void {
    this.save = loadSavegame();
    this.parse();
  }

  /** Gibt es Gegenstände, die bei einem neuen Spiel verloren gingen (auch in der Truhe)? */
  hasAny(): boolean {
    this.refresh();
    return CLASSES.some((entry) => this.count(entry.id) > 0) || this.chestCount() > 0;
  }

  /** Löscht alle Gegenstände, auch die der Truhe; Gold und Ränge bleiben. Der Messlauf (`persist = false`) schreibt dabei nichts. */
  reset(): void {
    this.refresh();
    this.save.items = { next: 1, classes: {}, pity: 0, chest: { tabs: [] }, shop: serializeStand(emptyStand()) };
    this.parse();
    this.persistNow();
  }

  /** Das Gold in der Geldbörse, so wie der Spielstand es zuletzt hatte (`reload` liest es neu). */
  get gold(): number {
    return this.save.gold;
  }

  inventory(classId: ClassId): readonly (Item | null)[] {
    return this.of(classId).inventory;
  }

  equipped(classId: ClassId, slot: ItemSlot): Item | null {
    return this.of(classId).equipment[slot] ?? null;
  }

  /** Die angelegten Gegenstände, in der Reihenfolge der Plätze. */
  equippedItems(classId: ClassId): Item[] {
    const { equipment } = this.of(classId);
    return ITEM_SLOTS.flatMap((slot) => equipment[slot] ?? []);
  }

  /** Die Evolutionen, die die angelegten Gegenstände einer Klasse freischalten: die Kennungen der Angriffe (siehe `Arsenal.reset`). */
  evolutionsOf(classId: ClassId): Set<string> {
    const unlocked = new Set<string>();
    for (const item of this.equippedItems(classId)) if (item.evolution) unlocked.add(item.evolution);
    return unlocked;
  }

  /** Anzahl der Gegenstände einer Klasse, angelegt und im Inventar. */
  count(classId: ClassId): number {
    const { inventory } = this.of(classId);
    return this.equippedItems(classId).length + inventory.filter((item) => item !== null).length;
  }

  /** Die Reiter der Truhe. Es gibt immer mindestens einen. */
  truhe(): readonly TruheReiter[] {
    return this.tabs;
  }

  /** Anzahl der Gegenstände in der Truhe, über alle Reiter. */
  chestCount(): number {
    return this.tabs.reduce((sum, tab) => sum + tab.slots.filter((item) => item !== null).length, 0);
  }

  /** Der Gegenstand auf einem Platz; `null`, wenn er leer ist oder es den Platz nicht gibt. */
  itemAt(place: Place): Item | null {
    switch (place.kind) {
      case 'inventar':
        return this.of(place.classId).inventory[place.index] ?? null;
      case 'ausruestung':
        return this.of(place.classId).equipment[place.slot] ?? null;
      case 'truhe':
        return this.tabs[place.tab]?.slots[place.index] ?? null;
    }
  }

  /**
   * Warum ein Gegenstand nicht von `from` nach `to` wandern kann; `null`, wenn es geht. Nur die Ausrüstung stellt Bedingungen:
   * Der Gegenstand muss auf den Platz passen und zur Klasse gehören, und tauscht er mit einem anderen, muss auch dieser zurück
   * auf den Platz passen, den der erste verlässt.
   */
  refusal(from: Place, to: Place): string | null {
    const item = this.itemAt(from);
    if (!item) return 'Dort liegt nichts.';
    const reason = this.refusalFor(item, to);
    if (reason) return reason;
    const other = this.itemAt(to);
    if (other && this.refusalFor(other, from)) return 'Der andere Gegenstand passt nicht auf den freiwerdenden Platz.';
    return null;
  }

  /** Verschiebt den Gegenstand von `from` nach `to`; liegt dort schon einer, tauschen beide. Gibt false zurück, wenn es nicht geht. */
  move(from: Place, to: Place): boolean {
    this.refresh();
    if (samePlace(from, to) || this.refusal(from, to)) return false;
    const item = this.itemAt(from);
    const other = this.itemAt(to);
    if (!item) return false;
    this.put(to, item);
    this.put(from, other);
    this.persistNow();
    return true;
  }

  /** Der erste freie Platz im Inventar der Klasse. */
  freeInventory(classId: ClassId): Place | null {
    const index = this.of(classId).inventory.indexOf(null);
    return index < 0 ? null : { kind: 'inventar', classId, index };
  }

  /** Der erste freie Platz der Truhe; `first` ist der Reiter, in dem zuerst gesucht wird, danach der Reihe nach. */
  freeChest(first = 0): Place | null {
    const order = [first, ...this.tabs.keys()].filter((tab, position, all) => this.tabs[tab] && all.indexOf(tab) === position);
    for (const tab of order) {
      const index = this.tabs[tab]?.slots.indexOf(null) ?? -1;
      if (index >= 0) return { kind: 'truhe', tab, index };
    }
    return null;
  }

  /** Legt einen Gegenstand auf den ersten freien Platz der Truhe. Gibt false zurück, wenn alle Reiter voll sind. */
  addToChest(item: Item): boolean {
    this.refresh();
    const place = this.freeChest();
    if (!place) return false;
    this.put(place, { ...item, id: item.id > 0 ? item.id : this.nextId++ });
    this.persistNow();
    return true;
  }

  /** Was der nächste Reiter kostet (Gold); `null`, wenn es keinen weiteren geben darf. */
  nextTabPrice(): number | null {
    return nextReiterPrice(this.tabs.length);
  }

  /** Bezahlt und legt einen neuen, leeren Reiter an. Gibt seine Stelle zurück; reicht das Gold nicht oder gibt es die Höchstzahl, die Absage. */
  buyTab(): { ok: true; price: number; index: number } | { ok: false; reason: string } {
    this.refresh();
    const price = nextReiterPrice(this.tabs.length);
    if (price === null) return { ok: false, reason: `Mehr als ${CONFIG.items.truhe.maxTabs} Reiter gibt es nicht.` };
    if (price > this.save.gold) return { ok: false, reason: `Ein neuer Reiter kostet ${price} Gold.` };
    this.save.gold -= price;
    const { colors } = CONFIG.items.truhe;
    // Die Farbe läuft der Reihe nach durch, damit neue Reiter sich unterscheiden.
    this.tabs.push(emptyReiter(this.freeTabName(), this.tabs.length % colors.length));
    this.persistNow();
    return { ok: true, price, index: this.tabs.length - 1 };
  }

  renameTab(index: number, name: string): boolean {
    this.refresh();
    const tab = this.tabs[index];
    if (!tab || name === '') return false;
    tab.name = name;
    this.persistNow();
    return true;
  }

  colorTab(index: number, color: number): boolean {
    this.refresh();
    const tab = this.tabs[index];
    if (!tab) return false;
    tab.color = ((color % CONFIG.items.truhe.colors.length) + CONFIG.items.truhe.colors.length) % CONFIG.items.truhe.colors.length;
    this.persistNow();
    return true;
  }

  /**
   * Löscht einen Reiter. Ein voller Reiter geht nur mit `moveItems`: Seine Gegenstände ziehen dann auf freie Plätze der anderen
   * Reiter um. Es geht nie etwas verloren: Reicht der Platz nicht (`voll`) oder ist es der letzte Reiter (`letzter`), bleibt alles.
   */
  removeTab(index: number, moveItems: boolean): RemoveResult {
    this.refresh();
    const tab = this.tabs[index];
    if (!tab) return 'letzter';
    if (this.tabs.length <= 1) return 'letzter';
    const items = tab.slots.filter((item): item is Item => item !== null);
    if (items.length > 0 && !moveItems) return 'belegt';
    const free = this.tabs.reduce((sum, other) => (other === tab ? sum : sum + other.slots.filter((slot) => slot === null).length), 0);
    if (items.length > free) return 'voll';
    this.tabs.splice(index, 1);
    for (const item of items) {
      const place = this.freeChest();
      if (place) this.put(place, item);
    }
    this.persistNow();
    return 'ok';
  }

  /** Der Stand des Händlers: das Angebot (gekaufte Plätze als `null`), der Rückkauf und wie oft er erneuert wurde. Nur zum Lesen. */
  haendler(): Readonly<HaendlerStand> {
    return this.shop;
  }

  /** Was das nächste Erneuern des Angebots kostet (Gold); das erste Mal in einer Nacht nichts. */
  nextRerollPrice(): number {
    return rerollPrice(this.shop.rerolls);
  }

  /** Würfelt das Angebot, wenn es seit der letzten gespielten Nacht noch nicht gewürfelt ist; sonst bleibt es, wie es ist. */
  stockUp(): void {
    this.refresh();
    if (this.shop.stocked) return;
    this.rollShopStock();
    this.persistNow();
  }

  /** Erneuert das Angebot (das ganze, auch was schon gekauft ist); der Rückkauf bleibt. Kostet Gold, siehe `nextRerollPrice`. */
  reroll(): Deal {
    this.refresh();
    const price = rerollPrice(this.shop.rerolls);
    if (price > this.save.gold) return { ok: false, reason: `Das Erneuern kostet ${price} Gold.` };
    this.save.gold -= price;
    this.shop.rerolls++;
    this.rollShopStock();
    this.persistNow();
    return { ok: true, price, place: null };
  }

  /**
   * Eine Nacht ist gespielt: Das Angebot wird neu gewürfelt, sobald man den Händler wieder ansieht, und das Erneuern ist wieder
   * einmal gratis. Der Rückkauf bleibt.
   */
  nightPlayed(): void {
    this.refresh();
    this.shop.stocked = false;
    this.shop.stock = Array.from({ length: CONFIG.items.shop.size }, () => null);
    this.shop.rerolls = 0;
    this.persistNow();
  }

  /**
   * Kauft den Gegenstand auf Platz `index` des Angebots zum vollen Preis. Er kommt auf `into`, sonst ins Inventar der Klasse,
   * sonst in die Truhe. Mit `id` gilt der Kauf nur, wenn dort noch derselbe Gegenstand liegt (ein anderes Fenster kann das Angebot
   * inzwischen erneuert haben).
   */
  buy(index: number, classId: ClassId, { into, id }: { into?: Place; id?: number } = {}): Deal {
    this.refresh();
    const item = this.shop.stocked ? this.shop.stock[index] : null;
    if (!item || (id !== undefined && item.id !== id)) return { ok: false, reason: 'Der Gegenstand ist nicht mehr im Angebot.' };
    const price = itemValue(item);
    const target = this.dealTarget(price, classId, into);
    if (typeof target === 'string') return { ok: false, reason: target };
    this.save.gold -= price;
    this.put(target, item);
    this.shop.stock[index] = null;
    this.persistNow();
    return { ok: true, price, place: target };
  }

  /** Kauft einen verkauften Gegenstand zurück (Platz `index` im Rückkauf) für das, was der Verkauf eingebracht hat. */
  buyBack(index: number, classId: ClassId, { into, id }: { into?: Place; id?: number } = {}): Deal {
    this.refresh();
    const item = this.shop.buyback[index];
    if (!item || (id !== undefined && item.id !== id)) return { ok: false, reason: 'Der Gegenstand ist nicht mehr im Rückkauf.' };
    const price = sellPrice(item);
    const target = this.dealTarget(price, classId, into);
    if (typeof target === 'string') return { ok: false, reason: target };
    this.save.gold -= price;
    this.put(target, item);
    this.shop.buyback.splice(index, 1);
    this.persistNow();
    return { ok: true, price, place: target };
  }

  /** Verkauft den Gegenstand auf `from` (Inventar oder Truhe) für ein Viertel seines Werts; der Händler merkt ihn sich im Rückkauf. */
  sell(from: Place, id?: number): Deal {
    this.refresh();
    if (from.kind === 'ausruestung') return { ok: false, reason: 'Was angelegt ist, wird erst abgelegt.' };
    const item = this.itemAt(from);
    if (!item || (id !== undefined && item.id !== id)) return { ok: false, reason: 'Der Gegenstand liegt nicht mehr dort.' };
    const price = sellPrice(item);
    this.sellItem(from, item, price);
    this.persistNow();
    return { ok: true, price, place: null };
  }

  /** Die Plätze eines Orts, auf denen ein Gegenstand der Seltenheit `rarity` liegt. */
  placesIn(scope: Scope, rarity: Item['rarity']): Place[] {
    const places: Place[] = [];
    if (scope.kind === 'inventar') {
      this.of(scope.classId).inventory.forEach((item, index) => {
        if (item?.rarity === rarity) places.push({ kind: 'inventar', classId: scope.classId, index });
      });
    } else {
      this.tabs[scope.tab]?.slots.forEach((item, index) => {
        if (item?.rarity === rarity) places.push({ kind: 'truhe', tab: scope.tab, index });
      });
    }
    return places;
  }

  /** Was es einbrächte, alle Gegenstände der Seltenheit `rarity` an einem Ort zu verkaufen: ihre Zahl und das Gold. */
  worth(scope: Scope, rarity: Item['rarity']): { count: number; gold: number } {
    const places = this.placesIn(scope, rarity);
    return { count: places.length, gold: places.reduce((sum, place) => sum + sellPrice(this.itemAt(place) as Item), 0) };
  }

  /** Verkauft alle Gegenstände der Seltenheit `rarity` an einem Ort in einem Zug. Gibt Zahl und Erlös zurück. */
  sellAll(scope: Scope, rarity: Item['rarity']): { count: number; gold: number } {
    this.refresh();
    let gold = 0;
    const places = this.placesIn(scope, rarity);
    for (const place of places) {
      const item = this.itemAt(place);
      if (!item) continue;
      const price = sellPrice(item);
      this.sellItem(place, item, price);
      gold += price;
    }
    if (places.length > 0) this.persistNow();
    return { count: places.length, gold };
  }

  /** Wie viele Boss-Kisten in Folge ohne Legendäres blieben; je eine hebt die Chance der nächsten (`game/beute.ts`). */
  get pity(): number {
    return this.pityCount;
  }

  /** Merkt sich den Pech-Schutz im Spielstand, damit ein Neuladen ihn nicht zurücksetzt. */
  setPity(count: number): void {
    this.refresh();
    this.pityCount = Math.max(0, Math.floor(count));
    this.persistNow();
  }

  /** Legt einen Gegenstand auf den ersten freien Platz im Inventar. Gibt false zurück, wenn es voll ist. */
  add(classId: ClassId, item: Item): boolean {
    this.refresh();
    const { inventory } = this.of(classId);
    const free = inventory.indexOf(null);
    if (free < 0) return false;
    inventory[free] = { ...item, id: item.id > 0 ? item.id : this.nextId++ };
    this.persistNow();
    return true;
  }

  /** Legt den Gegenstand auf dem Platz `index` im Inventar an; was dort angelegt war, kommt an seine Stelle zurück. */
  equip(classId: ClassId, index: number): boolean {
    this.refresh();
    const items = this.of(classId);
    const item = items.inventory[index];
    if (!item || !canEquip(item, classId)) return false;
    items.inventory[index] = items.equipment[item.slot] ?? null;
    items.equipment[item.slot] = item;
    this.persistNow();
    return true;
  }

  /** Nimmt den Gegenstand ab und legt ihn auf den ersten freien Platz im Inventar. Gibt false zurück, wenn es voll ist. */
  unequip(classId: ClassId, slot: ItemSlot): boolean {
    this.refresh();
    const items = this.of(classId);
    const item = items.equipment[slot];
    if (!item) return false;
    const free = items.inventory.indexOf(null);
    if (free < 0) return false;
    items.inventory[free] = item;
    delete items.equipment[slot];
    this.persistNow();
    return true;
  }

  /** Überträgt die angelegten Gegenstände einer Klasse auf die Werte, mit denen die Nacht beginnt. */
  apply(classId: ClassId, stats: Stats): void {
    applyItems(stats, this.equippedItems(classId));
  }

  /** Die Summe jeder Eigenschaft über alle angelegten Gegenstände (mit Obergrenze), für die Übersicht. */
  totals(classId: ClassId): Map<PropertyId, number> {
    return propertyTotals(this.equippedItems(classId));
  }

  /** Setzt die angelegten Gegenstände einer Klasse, ohne zu speichern. Nur für Werkzeuge; ersetzt, was dort angelegt war. */
  setLoadout(classId: ClassId, items: readonly Item[]): void {
    const classItems = this.of(classId);
    classItems.equipment = {};
    for (const item of items) classItems.equipment[item.slot] = { ...item, id: item.id > 0 ? item.id : this.nextId++ };
  }

  /** Der Name für einen neuen Reiter: „Reiter n“ mit der kleinsten Nummer, die noch nicht vergeben ist. */
  private freeTabName(): string {
    let number = this.tabs.length + 1;
    while (this.tabs.some((tab) => tab.name === defaultReiterName(number))) number++;
    return defaultReiterName(number);
  }

  /** Würfelt das Angebot neu und gibt jedem Gegenstand seine Nummer. */
  private rollShopStock(): void {
    const seed = this.fixedSeed !== null ? this.fixedSeed++ : Date.now();
    this.shop.stock = rollStock(createRandom(seed)).map((item) => ({ ...item, id: this.nextId++ }));
    this.shop.stocked = true;
  }

  /** Legt den Gegenstand eines Verkaufs aus der Hand des Spielers in den Rückkauf und schreibt das Gold gut; speichert nicht. */
  private sellItem(from: Place, item: Item, price: number): void {
    this.put(from, null);
    this.save.gold += price;
    this.shop.buyback.unshift(item);
    this.shop.buyback.length = Math.min(this.shop.buyback.length, CONFIG.items.shop.buybackSize);
  }

  /** Wohin ein gekaufter Gegenstand kommt, oder warum der Kauf nicht geht. */
  private dealTarget(price: number, classId: ClassId, into?: Place): Place | string {
    if (price > this.save.gold) return `Dafür fehlen ${price - this.save.gold} Gold.`;
    if (into) {
      if (into.kind === 'ausruestung') return 'Gekauftes kommt erst ins Inventar oder in die Truhe.';
      if (!this.exists(into)) return 'Diesen Platz gibt es nicht.';
      if (this.itemAt(into)) return 'Dieser Platz ist belegt.';
      return into;
    }
    return this.freeInventory(classId) ?? this.freeChest() ?? 'Inventar und Truhe sind voll.';
  }

  /** Gibt es den Platz überhaupt (ein Reiter, der gelöscht wurde, ein Platz hinter dem Ende)? */
  private exists(place: Place): boolean {
    switch (place.kind) {
      case 'inventar':
        return place.index >= 0 && place.index < this.of(place.classId).inventory.length;
      case 'ausruestung':
        return true;
      case 'truhe':
        return place.index >= 0 && place.index < (this.tabs[place.tab]?.slots.length ?? 0);
    }
  }

  private refusalFor(item: Item, to: Place): string | null {
    if (to.kind !== 'ausruestung') return null;
    if (item.slot !== to.slot) return 'Das gehört auf einen anderen Platz.';
    if (!canEquip(item, to.classId)) {
      const owner = CLASSES.find((entry) => entry.id === item.classId);
      return owner ? `Nur die Klasse ${className(owner)} kann das tragen.` : 'Das kann diese Klasse nicht tragen.';
    }
    return null;
  }

  /** Legt einen Gegenstand (oder nichts) auf einen Platz, ohne zu prüfen und ohne zu speichern. */
  private put(place: Place, item: Item | null): void {
    switch (place.kind) {
      case 'inventar':
        this.of(place.classId).inventory[place.index] = item;
        break;
      case 'ausruestung':
        if (item) this.of(place.classId).equipment[place.slot] = item;
        else delete this.of(place.classId).equipment[place.slot];
        break;
      case 'truhe': {
        const tab = this.tabs[place.tab];
        if (tab) tab.slots[place.index] = item;
        break;
      }
    }
  }

  private of(classId: ClassId): ClassItems {
    let items = this.classes.get(classId);
    if (!items) {
      items = emptyClassItems();
      this.classes.set(classId, items);
    }
    return items;
  }

  private parse(): void {
    this.classes.clear();
    const stored = this.save.items;
    this.nextId = stored.next;
    this.pityCount = stored.pity;
    this.tabs = parseTruhe(stored.chest, (item) => {
      this.nextId = Math.max(this.nextId, item.id + 1);
    });
    this.shop = parseStand(stored.shop, (item) => {
      this.nextId = Math.max(this.nextId, item.id + 1);
    });
    for (const entry of CLASSES) {
      const raw = stored.classes[entry.id];
      const items = emptyClassItems();
      if (raw) {
        for (let index = 0; index < items.inventory.length; index++) {
          const item = parseItem(raw.inventory[index]);
          if (!item) continue;
          items.inventory[index] = item;
          // Nummern, die der Spielstand schon vergeben hat, werden nicht noch einmal ausgegeben.
          this.nextId = Math.max(this.nextId, item.id + 1);
        }
        for (const slot of ITEM_SLOTS) {
          const item = parseItem(raw.equipment[slot]);
          // Ein Gegenstand gehört auf seinen Platz und darf nur von seiner Klasse getragen werden.
          if (!item || item.slot !== slot || !canEquip(item, entry.id)) continue;
          items.equipment[slot] = item;
          this.nextId = Math.max(this.nextId, item.id + 1);
        }
      }
      this.classes.set(entry.id, items);
    }
  }

  /** Schreibt die Gegenstände zurück in den Spielstand; Einträge für Klassen, die das Spiel nicht kennt, bleiben erhalten. */
  private serialize(): StoredItems {
    const classes: StoredItems['classes'] = { ...this.save.items.classes };
    for (const entry of CLASSES) {
      const items = this.of(entry.id);
      classes[entry.id] = { inventory: [...items.inventory], equipment: { ...items.equipment } };
    }
    return { next: this.nextId, classes, pity: this.pityCount, chest: serializeTruhe(this.tabs), shop: serializeStand(this.shop) };
  }

  /**
   * Liest vor jeder Änderung den gespeicherten Stand neu. Ist das Spiel in zwei Tabs offen, überschreibt der eine
   * sonst mit seinem alten Wissen, was der andere inzwischen gesammelt oder abgegeben hat.
   */
  private refresh(): void {
    if (this.persist) this.reload();
  }

  private persistNow(): void {
    this.save.items = this.serialize();
    if (this.persist) writeSavegame(this.save);
  }
}
