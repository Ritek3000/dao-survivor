/**
 * Werkzeug für die Browser-Konsole (nur im Entwicklungsmodus): Gegenstände zum Ausprobieren erzeugen, solange es noch
 * keine Beute gibt. Gehört nicht ins fertige Spiel und wird deshalb nur dort nachgeladen (siehe `main.ts`).
 *
 *   __items.fuellen()                        Inventar aller Klassen mit gewürfelten Gegenständen füllen (Seltenheit gemischt)
 *   __items.fuellen(2, 'rar')                nur das Inventar des Magiers (0 Kämpfer, 1 Wildnisläufer, 2 Magier), alle 'rar'
 *   __items.geben(0, 'ring', 'legendaer')    einen Gegenstand auf den ersten freien Platz im Inventar der Klasse legen
 *   __items.leeren()                         alle Gegenstände aller Klassen löschen
 *
 * Alles wird in den Spielstand geschrieben, genau wie echte Funde; `leeren` räumt wieder auf.
 */

import { CONFIG } from '../config';
import { createRandom } from '../core/random';
import type { Ausruestung } from '../game/ausruestung';
import { CLASSES } from '../game/classes';
import type { Game } from '../game/game';
import { isPossible, ITEM_SLOTS, rollItem, type ItemSlot, type Rarity } from '../game/items';

interface Internals {
  ausruestung: Ausruestung;
  openSelect(): void;
}

const MIXED: readonly Rarity[] = ['normal', 'normal', 'selten', 'selten', 'rar', 'legendaer'];

export function installItemTools(game: Game): void {
  const internals = game as unknown as Internals;
  const random = createRandom(Date.now());

  const api = {
    /** Legt einen gewürfelten Gegenstand ins Inventar der Klasse (Stelle in der Liste der Klassen). */
    geben(classIndex: number, slot: ItemSlot, rarity: Rarity = 'normal'): boolean {
      const playerClass = CLASSES[classIndex];
      if (!playerClass) throw new Error(`Unbekannte Klasse: ${classIndex}`);
      // Legendäres gibt es nur auf wenigen Plätzen; beim Füllen mit gemischter Seltenheit rückt es auf Rar.
      if (!isPossible(slot, rarity)) rarity = 'rar';
      return internals.ausruestung.add(playerClass.id, rollItem(random, slot, rarity, playerClass.id));
    },
    /** Füllt das Inventar einer Klasse oder aller Klassen bis zum letzten freien Platz. */
    fuellen(classIndex?: number, rarity?: Rarity): void {
      const targets = classIndex === undefined ? CLASSES.map((_, index) => index) : [classIndex];
      for (const index of targets) {
        for (let i = 0; i < CONFIG.items.inventorySize; i++) {
          const slot = ITEM_SLOTS[i % ITEM_SLOTS.length] as ItemSlot;
          const chosen = rarity ?? (MIXED[Math.floor(random() * MIXED.length)] as Rarity);
          if (!api.geben(index, slot, chosen)) break;
        }
      }
    },
    leeren(): void {
      internals.ausruestung.reset();
    },
  };
  (window as unknown as { __items: typeof api }).__items = api;
}
