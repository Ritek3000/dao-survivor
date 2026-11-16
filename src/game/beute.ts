/**
 * Die Beute: welche Gegenstände aus Gegnern und aus der Kiste des Verschlingers fallen.
 *
 * Gewürfelt wird mit einem eigenen Zufallsstrom, nicht mit dem der Welt: Der feste Seed der Welt würde nach jedem Neustart
 * dieselben Gegenstände würfeln. Der Strom beginnt mit der Uhrzeit des Nachtbeginns; der Messlauf legt dagegen einen festen
 * Anfang fest (`fixedSeed`), damit seine Nächte vergleichbar bleiben.
 *
 * Während der Nacht sammelt die Figur die Gegenstände nur im Beutel (`bag`). Erst am Ende der Nacht wandern sie ins Inventar
 * der gespielten Klasse (`settle`); was nicht mehr hineinpasst, wird zum Verkaufspreis verkauft. Die Truhe (später) kommt
 * zwischen Inventar und Verkauf.
 */

import { CONFIG } from '../config';
import { createRandom, type Random } from '../core/random';
import type { Ausruestung } from './ausruestung';
import type { ClassId } from './classes';
import { itemValue, ITEM_SLOTS, LEGENDARY_SLOTS, rollItem, sellPrice, type Item, type Rarity, RARITIES } from './items';

/** Woher ein Gegenstand kommt: `schwach` und `stark` sind Gegner (siehe `EnemyLoot`), `kiste` die des Verschlingers. */
export type LootSource = keyof typeof CONFIG.loot.rarity;

/** Ein Gegenstand der Nacht und was am Ende mit ihm geschah. */
export interface SettledItem {
  item: Item;
  /** Im Inventar der Klasse gelandet? Sonst verkauft. */
  stored: boolean;
  /** Was der Verkauf einbrachte; 0, wenn der Gegenstand im Inventar liegt. */
  gold: number;
}

export interface LootSettlement {
  /** Die Gegenstände, die wertvollsten zuerst: Sie bekommen die freien Plätze, der Rest wird verkauft. */
  items: SettledItem[];
  /** Gold aus den Verkäufen. */
  gold: number;
}

/**
 * Würfelt die Seltenheit nach den Gewichten einer Quelle. `legendaryBonus` (Prozentpunkte) wandert von Selten auf Legendär,
 * soweit Selten reicht: so wirkt der Pech-Schutz der Kiste.
 */
export function rollRarity(random: Random, source: LootSource, legendaryBonus = 0): Rarity {
  const weights: Record<Rarity, number> = { ...CONFIG.loot.rarity[source] };
  if (legendaryBonus > 0) {
    const shift = Math.min(legendaryBonus, weights.selten);
    weights.selten -= shift;
    weights.legendaer += shift;
  }
  let total = 0;
  for (const rarity of RARITIES) total += weights[rarity];
  let roll = random() * total;
  for (const rarity of RARITIES) {
    roll -= weights[rarity];
    if (roll < 0 && weights[rarity] > 0) return rarity;
  }
  // Nur durch Rundung erreichbar: die höchste Seltenheit mit Gewicht.
  return [...RARITIES].reverse().find((rarity) => weights[rarity] > 0) ?? 'normal';
}

/**
 * Die Seltenheiten der Gegenstände einer Kiste und der Zähler des Pech-Schutzes danach: Blieb die Kiste ohne Legendäres, hebt jede
 * solche Kiste die Chance der nächsten um `pityStep` Prozentpunkte je Gegenstand; ein Legendäres setzt den Zähler zurück.
 */
export function rollChestRarities(random: Random, pity: number): { rarities: Rarity[]; pity: number } {
  const { items, pityStep } = CONFIG.loot.chest;
  const rarities: Rarity[] = [];
  for (let i = 0; i < items; i++) rarities.push(rollRarity(random, 'kiste', pity * pityStep));
  return { rarities, pity: rarities.includes('legendaer') ? 0 : pity + 1 };
}

export class Beute {
  /** Die Gegenstände dieser Nacht, die die Figur schon aufgesammelt hat. */
  readonly bag: Item[] = [];
  /** Nur für den Messlauf: fester Anfang des Zufallsstroms; jede Nacht zählt ihn um eins weiter. */
  fixedSeed: number | null = null;
  private random: Random = createRandom(1);
  private classId: ClassId = 'kaempfer';

  constructor(private readonly ausruestung: Ausruestung) {}

  /** Beginnt eine Nacht der Klasse: leerer Beutel, neuer Zufallsstrom. */
  start(classId: ClassId): void {
    this.classId = classId;
    this.bag.length = 0;
    this.random = createRandom(this.fixedSeed !== null ? this.fixedSeed++ : Date.now());
  }

  /** Fällt aus einem Gegner mit dieser Chance (0 bis 1) etwas? Jede Frage zieht eine Zahl aus dem Strom. */
  drops(chance: number): boolean {
    return this.random() < chance;
  }

  /** Würfelt einen Gegenstand der Quelle für die gespielte Klasse. */
  roll(source: LootSource, legendaryBonus = 0): Item {
    return this.make(rollRarity(this.random, source, legendaryBonus));
  }

  /**
   * Würfelt den Inhalt der Kiste des Verschlingers und führt den Pech-Schutz weiter (`rollChestRarities`). Der Zähler wird
   * sofort gespeichert, damit ein Neuladen der Seite die Kiste nicht noch einmal würfelt.
   */
  rollChest(): Item[] {
    const { rarities, pity } = rollChestRarities(this.random, this.ausruestung.pity);
    this.ausruestung.setPity(pity);
    return rarities.map((rarity) => this.make(rarity));
  }

  /** Die Figur hat einen Gegenstand aufgesammelt. */
  collect(item: Item): void {
    this.bag.push(item);
  }

  /**
   * Räumt den Beutel am Ende der Nacht aus: Die wertvollsten Gegenstände kommen zuerst ins Inventar der Klasse, was keinen
   * Platz mehr findet, wird verkauft. Der Verkaufserlös gehört der Börse; ihn schreibt der Aufrufer gut.
   */
  settle(): LootSettlement {
    const items = [...this.bag].sort((a, b) => itemValue(b) - itemValue(a));
    this.bag.length = 0;
    const settled: SettledItem[] = [];
    let gold = 0;
    for (const item of items) {
      if (this.ausruestung.add(this.classId, item)) {
        settled.push({ item, stored: true, gold: 0 });
      } else {
        const price = sellPrice(item);
        gold += price;
        settled.push({ item, stored: false, gold: price });
      }
    }
    return { items: settled, gold };
  }

  /** Der Platz ist gleich verteilt; Waffe und Fackel gehören zur gespielten Klasse, Legendäres ist ein Ring dieser Klasse. */
  private make(rarity: Rarity): Item {
    const slots = rarity === 'legendaer' ? LEGENDARY_SLOTS : ITEM_SLOTS;
    const slot = slots[Math.floor(this.random() * slots.length)] ?? 'ring';
    return rollItem(this.random, slot, rarity, this.classId);
  }
}
