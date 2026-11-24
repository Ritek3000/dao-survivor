/**
 * Die Nachtarten: Vor der Nacht wählt man, wie sie sein soll. Jede hat eine Regel, ein Risiko und einen Lohn; schwerere Nächte
 * zahlen besser. So wird aus dem Risiko eine Entscheidung und kein Pech.
 *
 * Namen und Anlässe stammen aus dem Wiki (Kalender: Rotnacht und Blaunacht; Wetter: Regenlicht). **Die Wirkungen sind Vorschläge,
 * die Zahlen Startwerte** für den Messlauf (`__messlauf.start({ nacht: 'rotnacht' })`). Abweichung von der Lore: Dort bestimmt der
 * Kalender, wann Rotnacht und Blaunacht sind; im Spiel wählt die Spielerin oder der Spieler die Nacht, damit die Schwierigkeit
 * eine Entscheidung ist. Text und Faktoren eines Eintrags ändert man zusammen.
 *
 * Wie eine Nachtart wirkt, steht in `NightRules`: Die Gegner (`Enemies.reset`), die Schwaden (`Zones.reset`) und die Werte der Figur
 * (`Progression.reset`) lesen es beim Start der Nacht. Nichts davon ändert `CONFIG`.
 *
 * Auf jede Nachtart kann ein Grad kommen (`rulesAt`, die Grade selbst verwaltet `grade.ts`): Er macht die Gegner stärker und ändert sonst nichts.
 */

import { CONFIG } from '../config';
import type { Stats } from './progression';

export type NightId = 'gewoehnlich' | 'rotnacht' | 'blaunacht' | 'regenlicht';

/** Die Werte der Figur, die eine Nachtart mit einem Faktor verändern darf. */
export type NightStat = 'cooldown' | 'restHeal' | 'verstaubung' | 'xp' | 'gold' | 'taken';

/** Was eine Nachtart verändert; fehlt eine Angabe, gilt der gewohnte Wert. Faktoren beginnen bei 1. */
export interface NightRules {
  /** Faktor auf das Tempo der Gegner. */
  enemySpeed?: number;
  /** Faktor auf das Leben der Gegner (nicht der Bosse; deren Leben ändert nur `bossHp`). */
  enemyHp?: number;
  /** Faktor auf das Leben der Bosse, des Verschlingers und des Stachelträgers. Die Nachtarten rühren es nicht an; der Grad (`rulesAt`) schon. */
  bossHp?: number;
  /** Faktor auf die Zahl der Gegner, die je Sekunde entstehen. */
  spawnRate?: number;
  /** Gegnerarten (`EnemyType.id`), die schon nach so vielen Sekunden erscheinen statt erst zu ihrer gewohnten Zeit. */
  appearFrom?: Readonly<Record<string, number>>;
  /** So viele Schwaden der Finsternis ziehen umher statt `CONFIG.finsternis.clouds`. */
  clouds?: number;
  /** Faktoren auf die Werte der Figur, aufmultipliziert auf Klasse, Gegenstände und Stärkungen. */
  stats?: Readonly<Partial<Record<NightStat, number>>>;
}

export interface NightDef {
  id: NightId;
  name: string;
  /** Regel und Risiko in zwei Sätzen, für die Auswahlkarte. */
  text: string;
  /** Der Anlass in der Welt, kleingedruckt unter dem Text. */
  note: string;
  /** Der Lohn, gold gesetzt. */
  reward: string;
  rules: NightRules;
}

/** Die Nachtarten in der Reihenfolge der Auswahl; die erste ist die gewöhnliche Nacht und die vorgewählte. */
export const NIGHTS: readonly NightDef[] = [
  {
    id: 'gewoehnlich',
    name: 'Gewöhnliche Nacht',
    text: 'Die Nacht, wie sie ist: Finsternis, Horde und Feuerschalen ohne Besonderheit.',
    note: 'Kein Zuschlag, kein Abschlag',
    reward: 'Lohn: wie gewohnt',
    rules: {},
  },
  {
    id: 'rotnacht',
    name: 'Rotnacht',
    text: 'Die Gegner laufen 20 % schneller, und du schlägst 10 % schneller zu. Die Rast im Licht heilt nur halb so viel.',
    note: 'Dundar steht voll am Himmel: Unter rotem Mond ist keiner, wer er ist.',
    reward: 'Lohn: Gold × 1,3',
    rules: { enemySpeed: 1.2, stats: { cooldown: 1 / 1.1, restHeal: 0.5, gold: 1.3 } },
  },
  {
    id: 'blaunacht',
    name: 'Blaunacht',
    text: 'Weniger Gegner, aber zähere: 20 % seltener, mit 50 % mehr Leben. Die Dhargass-Priester kommen schon nach zwei Minuten.',
    note: 'Branjur steht voll am Himmel, und die Nacht ist still.',
    reward: 'Lohn: Erfahrung × 1,3',
    rules: { spawnRate: 0.8, enemyHp: 1.5, appearFrom: { priester: 120 }, stats: { xp: 1.3 } },
  },
  {
    id: 'regenlicht',
    name: 'Regenlicht',
    text: 'Der Staub ist ausgewaschen: Die Verstaubung wächst nur halb so schnell, und nur vier Schwaden ziehen umher. Die Gegner halten 20 % mehr aus.',
    note: 'Nach kräftigem Regen ist der Himmel heller.',
    reward: 'Lohn: Gold × 0,9',
    rules: { enemyHp: 1.2, clouds: 4, stats: { verstaubung: 0.5, gold: 0.9 } },
  },
];

/** Die gewöhnliche Nacht. */
export const USUAL_NIGHT: NightDef = NIGHTS[0] as NightDef;

export function nightById(id: string): NightDef | undefined {
  return NIGHTS.find((night) => night.id === id);
}

/**
 * Die Regeln einer Nacht im gewählten Grad (siehe `grade.ts`): die der Nachtart, dazu der Zuschlag des Grads auf das Leben der Gegner
 * und der Bosse und auf den Schaden, den die Figur erleidet (`taken`). Die Zuschläge sind additiv je Grad
 * (`CONFIG.grade`) und werden mit den Faktoren der Nachtart malgenommen. Grad 0 ergibt die Regeln der Nachtart unverändert.
 */
export function rulesAt(night: NightDef, grade: number): NightRules {
  if (grade <= 0) return night.rules;
  const { enemyHp, enemyDamage } = CONFIG.grade;
  const hp = 1 + grade * enemyHp;
  const damage = 1 + grade * enemyDamage;
  const { rules } = night;
  return {
    ...rules,
    enemyHp: (rules.enemyHp ?? 1) * hp,
    bossHp: (rules.bossHp ?? 1) * hp,
    stats: { ...rules.stats, taken: (rules.stats?.taken ?? 1) * damage },
  };
}

/** Legt die Faktoren der Nachtart auf die Werte der Figur. */
export function applyNightStats(rules: NightRules, stats: Stats): void {
  for (const [stat, factor] of Object.entries(rules.stats ?? {}) as [NightStat, number][]) stats[stat] *= factor;
}
