/**
 * Die Gegenstände jeder Klasse: ein Inventar mit festen Plätzen und die neun angelegten Gegenstände.
 *
 * Jede Klasse hat ihr eigenes Inventar und ihre eigene Ausrüstung; das Gold gehört weiterhin allen gemeinsam
 * (`steigerung.ts`). Gespeichert wird im Spielstand (`core/savegame.ts`, Feld `items`). Wie bei den Steigerungen liest jede
 * Änderung den gespeicherten Stand neu, damit zwei offene Tabs einander nicht überschreiben.
 *
 * Angelegt wird nur zwischen den Nächten: Die Werte einer Nacht stehen beim Start fest (`apply` über `Progression.reset`).
 */

import { CONFIG } from '../config';
import { loadSavegame, writeSavegame, type Savegame, type StoredItems } from '../core/savegame';
import { CLASSES, type ClassId } from './classes';
import { applyItems, canEquip, ITEM_SLOTS, parseItem, propertyTotals, type Item, type ItemSlot, type PropertyId } from './items';
import type { Stats } from './progression';

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
  private nextId = 1;

  constructor() {
    this.parse();
  }

  /** Liest den Spielstand neu, etwa nachdem ein Werkzeug die Ausrüstung nur zum Ausprobieren gesetzt hat. */
  reload(): void {
    this.save = loadSavegame();
    this.parse();
  }

  /** Gibt es Gegenstände, die bei einem neuen Spiel verloren gingen? */
  hasAny(): boolean {
    this.refresh();
    return CLASSES.some((entry) => this.count(entry.id) > 0);
  }

  /** Löscht alle Gegenstände; Gold und Ränge bleiben. Der Messlauf (`persist = false`) schreibt dabei nichts. */
  reset(): void {
    this.refresh();
    this.save.items = { next: 1, classes: {} };
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
    return { next: this.nextId, classes };
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
