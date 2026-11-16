/**
 * Die Gegenstände jeder Klasse: ein Inventar mit festen Plätzen und die neun angelegten Gegenstände, dazu die Truhe, die allen
 * Klassen gemeinsam gehört (`truhe.ts`).
 *
 * Jede Klasse hat ihr eigenes Inventar und ihre eigene Ausrüstung; das Gold gehört weiterhin allen gemeinsam
 * (`steigerung.ts`). Gespeichert wird im Spielstand (`core/savegame.ts`, Feld `items`). Wie bei den Steigerungen liest jede
 * Änderung den gespeicherten Stand neu, damit zwei offene Tabs einander nicht überschreiben.
 *
 * Ein Gegenstand wandert zwischen Inventar, Truhe und Ausrüstung mit `move`: Beide Plätze ändern sich in einem Zug oder keiner,
 * so geht auch bei einem Fehlschlag oder einem Neuladen nichts verloren.
 *
 * Angelegt wird nur zwischen den Nächten: Die Werte einer Nacht stehen beim Start fest (`apply` über `Progression.reset`).
 */

import { CONFIG } from '../config';
import { loadSavegame, writeSavegame, type Savegame, type StoredItems } from '../core/savegame';
import { CLASSES, type ClassId } from './classes';
import { applyItems, canEquip, ITEM_SLOTS, parseItem, propertyTotals, type Item, type ItemSlot, type PropertyId } from './items';
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
    this.save.items = { next: 1, classes: {}, pity: 0, chest: { tabs: [] } };
    this.parse();
    this.persistNow();
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

  /** Was der nächste Reiter kostet (Gold); `null`, wenn es keinen weiteren geben darf. Bezahlen muss der Aufrufer. */
  nextTabPrice(): number | null {
    return nextReiterPrice(this.tabs.length);
  }

  /** Legt einen neuen, leeren Reiter an und gibt seine Stelle zurück; -1, wenn es schon die Höchstzahl gibt. */
  addTab(): number {
    this.refresh();
    if (nextReiterPrice(this.tabs.length) === null) return -1;
    const { colors } = CONFIG.items.truhe;
    // Die Farbe läuft der Reihe nach durch, damit neue Reiter sich unterscheiden.
    this.tabs.push(emptyReiter(this.freeTabName(), this.tabs.length % colors.length));
    this.persistNow();
    return this.tabs.length - 1;
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

  private refusalFor(item: Item, to: Place): string | null {
    if (to.kind !== 'ausruestung') return null;
    if (item.slot !== to.slot) return 'Das gehört auf einen anderen Platz.';
    if (!canEquip(item, to.classId)) {
      const owner = CLASSES.find((entry) => entry.id === item.classId);
      return owner ? `Nur der ${owner.name} kann das tragen.` : 'Das kann diese Klasse nicht tragen.';
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
    return { next: this.nextId, classes, pity: this.pityCount, chest: serializeTruhe(this.tabs) };
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
