/**
 * Die Truhe: ein Lager für alle Klassen, in Reitern zu je `CONFIG.items.truhe.tabSize` Plätzen.
 *
 * Dieser Teil kennt nur die Form der Reiter, ihre Namen und Preise und wie sie gelesen und geschrieben werden. Gespeichert und
 * bedient wird die Truhe von `Ausruestung`, denn ein Gegenstand wandert zwischen Inventar, Truhe und Ausrüstung in einem Zug;
 * das Menü dazu ist `lager.ts`.
 */

import { CONFIG } from '../config';
import type { StoredChest } from '../core/savegame';
import { parseItem, type Item } from './items';

export interface TruheReiter {
  name: string;
  /** Stelle in `CONFIG.items.truhe.colors`. */
  color: number;
  /** Immer `CONFIG.items.truhe.tabSize` Plätze; leere sind `null`. */
  slots: (Item | null)[];
}

export function emptyReiter(name: string, color: number): TruheReiter {
  const { tabSize, colors } = CONFIG.items.truhe;
  return { name, color: ((color % colors.length) + colors.length) % colors.length, slots: Array.from({ length: tabSize }, () => null) };
}

export function defaultReiterName(number: number): string {
  return `Reiter ${number}`;
}

/** Macht aus einer Eingabe einen brauchbaren Namen: Leerraum zusammengezogen, Steuerzeichen weg, auf die Länge gekürzt. */
export function cleanReiterName(text: string): string {
  const plain = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(plain).slice(0, CONFIG.items.truhe.nameLength).join('').trim();
}

/**
 * Was der nächste Reiter kostet, wenn es schon `count` gibt; `null`, wenn es keinen weiteren geben darf. Die ersten
 * `freeTabs` sind gratis, danach wächst der Preis um `tabPrice` je Reiter.
 */
export function nextReiterPrice(count: number): number | null {
  const { maxTabs, freeTabs, tabPrice } = CONFIG.items.truhe;
  if (count >= maxTabs) return null;
  return count < freeTabs ? 0 : tabPrice * (count - freeTabs + 1);
}

/**
 * Liest die gespeicherten Reiter. Jeder Gegenstand wird einzeln geprüft (`parseItem`); `onItem` meldet die gültigen, damit der
 * Aufrufer die nächste Nummer nachziehen kann. Ohne Reiter, etwa in einem alten Spielstand, beginnt die Truhe mit einem leeren.
 */
export function parseTruhe(stored: StoredChest, onItem: (item: Item) => void): TruheReiter[] {
  const { maxTabs, tabSize } = CONFIG.items.truhe;
  const tabs: TruheReiter[] = [];
  for (const raw of stored.tabs.slice(0, maxTabs)) {
    const tab = emptyReiter(cleanReiterName(raw.name) || defaultReiterName(tabs.length + 1), raw.color);
    for (let index = 0; index < tabSize; index++) {
      const item = parseItem(raw.slots[index]);
      if (!item) continue;
      tab.slots[index] = item;
      onItem(item);
    }
    tabs.push(tab);
  }
  if (tabs.length === 0) tabs.push(emptyReiter(defaultReiterName(1), 0));
  return tabs;
}

export function serializeTruhe(tabs: readonly TruheReiter[]): StoredChest {
  return { tabs: tabs.map((tab) => ({ name: tab.name, color: tab.color, slots: [...tab.slots] })) };
}
