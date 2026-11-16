/**
 * Werkzeug für die Browser-Konsole (nur im Entwicklungsmodus): Gegenstände und Beute zum Ausprobieren. Gehört nicht ins fertige
 * Spiel und wird deshalb nur dort nachgeladen (siehe `main.ts`).
 *
 *   __items.fuellen()                        Inventar aller Klassen mit gewürfelten Gegenständen füllen (Seltenheit gemischt)
 *   __items.fuellen(2, 'rar')                nur das Inventar des Magiers (0 Kämpfer, 1 Wildnisläufer, 2 Magier), alle 'rar'
 *   __items.geben(0, 'ring', 'legendaer')    einen Gegenstand auf den ersten freien Platz im Inventar der Klasse legen
 *   __items.leeren()                         alle Gegenstände aller Klassen und die Truhe löschen
 *   __items.truhe(30, 'rar')                 30 Gegenstände (hier alle 'rar', ohne Angabe gemischt) in die Truhe legen, Reiter für Reiter
 *
 * Beute (nur während einer Nacht):
 *   __items.fallen('rar')                    lässt neben der Figur einen Gegenstand der Seltenheit fallen (Platz gewürfelt)
 *   __items.kiste()                          stellt die Kiste des Verschlingers neben die Figur (zählt den Pech-Schutz weiter)
 *   __items.verteilung('stark', 100000)      würfelt die Seltenheit n-mal für eine Quelle ('schwach', 'stark', 'kiste') und zählt
 *   __items.kisten(100000)                   spielt n Kisten durch (ohne den Spielstand zu berühren): im Schnitt Kisten bis zu einem Legendären
 *   __items.beutel()                         was in dieser Nacht schon im Beutel liegt
 *
 * `fuellen`, `geben`, `leeren`, `kiste` und der Abschluss einer Nacht schreiben in den Spielstand, genau wie echte Funde.
 */

import { CONFIG } from '../config';
import { createRandom } from '../core/random';
import type { Ausruestung } from '../game/ausruestung';
import { rollChestRarities, rollRarity, type Beute, type LootSource } from '../game/beute';
import { CLASSES } from '../game/classes';
import type { Chest } from '../game/drops';
import type { Game } from '../game/game';
import { isPossible, ITEM_SLOTS, rollItem, type Item, type ItemSlot, type Rarity } from '../game/items';

interface Internals {
  ausruestung: Ausruestung;
  beute: Beute;
  chest: Chest;
  phase: string;
  player: { position: { x: number; z: number } };
  playerClass: { id: Parameters<typeof rollItem>[3] };
  dropLoot(item: Item, x: number, z: number): void;
  openSelect(): void;
}

const RARITY_LIST: readonly Rarity[] = ['normal', 'selten', 'rar', 'legendaer'];

function requireNight(internals: Internals): void {
  if (internals.phase !== 'playing') throw new Error('Das geht nur mitten in einer Nacht.');
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
    /** Legt `count` gewürfelte Gegenstände auf die ersten freien Plätze der Truhe (für alle Klassen, Waffen und Fackeln der ersten). */
    truhe(count = 25, rarity?: Rarity): number {
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const slot = ITEM_SLOTS[i % ITEM_SLOTS.length] as ItemSlot;
        const chosen = rarity ?? (MIXED[Math.floor(random() * MIXED.length)] as Rarity);
        const fitting = isPossible(slot, chosen) ? chosen : 'rar';
        const owner = CLASSES[i % CLASSES.length];
        if (!owner || !internals.ausruestung.addToChest(rollItem(random, slot, fitting, owner.id))) break;
        placed++;
      }
      return placed;
    },
    leeren(): void {
      internals.ausruestung.reset();
    },
    /** Lässt neben der Figur einen Gegenstand fallen; er fliegt nach einem Augenblick zu ihr, wie bei einem echten Fund. */
    fallen(rarity: Rarity = 'normal', slot?: ItemSlot): Item {
      requireNight(internals);
      const chosen = rarity === 'legendaer' ? 'ring' : (slot ?? (ITEM_SLOTS[Math.floor(random() * ITEM_SLOTS.length)] as ItemSlot));
      const item = rollItem(random, chosen, rarity, internals.playerClass.id);
      const { x, z } = internals.player.position;
      internals.dropLoot(item, x + 3, z - 1);
      return item;
    },
    /** Stellt die Kiste des Verschlingers hin, mit gewürfeltem Inhalt und weitergezähltem Pech-Schutz. */
    kiste(): Item[] {
      requireNight(internals);
      const items = internals.beute.rollChest();
      const { x, z } = internals.player.position;
      internals.chest.open(x, z - 4, items);
      return items;
    },
    /** Würfelt die Seltenheit `count`-mal für eine Quelle und zählt sie, in Prozent. */
    verteilung(source: LootSource, count = 100000): Record<Rarity, number> {
      const counts: Record<Rarity, number> = { normal: 0, selten: 0, rar: 0, legendaer: 0 };
      for (let i = 0; i < count; i++) counts[rollRarity(random, source)]++;
      for (const rarity of RARITY_LIST) counts[rarity] = Math.round((counts[rarity] / count) * 10000) / 100;
      return counts;
    },
    /** Spielt `count` Kisten durch (ohne den Spielstand zu berühren) und sagt, wie viele Kisten je Kiste mit Legendärem nötig waren. */
    kisten(count = 100000): { kistenBisLegendaer: number; laengsteFlaute: number; legendaereJeKiste: number } {
      let pity = 0;
      let legendaries = 0;
      let withLegendary = 0;
      let longest = 0;
      let streak = 0;
      for (let i = 0; i < count; i++) {
        const result = rollChestRarities(random, pity);
        pity = result.pity;
        streak++;
        const found = result.rarities.filter((rarity) => rarity === 'legendaer').length;
        if (found > 0) {
          legendaries += found;
          withLegendary++;
          longest = Math.max(longest, streak);
          streak = 0;
        }
      }
      return {
        kistenBisLegendaer: Math.round((count / Math.max(1, withLegendary)) * 100) / 100,
        laengsteFlaute: longest,
        legendaereJeKiste: Math.round((legendaries / count) * 1000) / 1000,
      };
    },
    beutel(): Item[] {
      return [...internals.beute.bag];
    },
  };
  (window as unknown as { __items: typeof api }).__items = api;
}
