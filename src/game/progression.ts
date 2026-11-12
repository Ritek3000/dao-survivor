import { CONFIG } from '../config';
import type { ClassDef } from './classes';

/** Alles, was Verbesserungen verändern können. Faktoren beginnen bei 1. */
export interface Stats {
  damage: number;
  /** Faktor auf Abklingzeiten; kleiner ist schneller. */
  cooldown: number;
  critChance: number;
  /** Fester Abzug von jedem Treffer. */
  armor: number;
  /** Faktor auf den Zuwachs der Verstaubung. */
  verstaubung: number;
  maxHp: number;
  speed: number;
  reach: number;
  pickup: number;
  // Ab hier: was nur die Segen der Höheren Mächte verändern.
  /** Verstaubung, die sich je Sekunde auch fern jeder Feuerschale löst (nicht in der Finsternis). */
  dustClear: number;
  /** Faktor auf die Reichweite des eigenen Lichtscheins. */
  light: number;
  /** Faktor auf Treffer gegen Gegner, die im eigenen Lichtschein stehen. */
  litDamage: number;
  /** Faktor auf die Brenndauer der Feuerschalen. */
  burn: number;
  /** Faktor auf das Tempo, mit dem sich eine Feuerschale entzündet. */
  ignite: number;
  /** Schaden je Sekunde, den brennende Feuerschalen Gegnern in ihrem Lichtkreis zufügen. */
  scorch: number;
  /** Faktor auf die Schonfrist nach einem Treffer. */
  grace: number;
  /** Faktor auf Treffer gegen große Gegner. */
  bigGame: number;
  /** Faktor auf eingesammelte Erfahrung. */
  xp: number;
  /** Faktor auf Treffer gegen Gegner, die festgehalten sind. */
  heldDamage: number;
}

/** Ein Segen einer Höheren Macht: stärker als eine Stärkung, je Nacht nur einmal zu haben. */
export interface Segen {
  id: string;
  name: string;
  /** Die Macht, die ihn gewährt, und die Domäne, aus der er stammt. */
  macht: string;
  text: string;
  apply(stats: Stats): void;
}

/** Ab dieser Größe (`scale` der Gegnerart) zählt ein Gegner für Gôths Jagd als groß. */
export const BIG_GAME_SCALE = 1.5;
/** Auf jeder so vielten Stufe antwortet eine Höhere Macht mit der Wahl eines Segens. */
export const SEGEN_EVERY_LEVELS = 5;

/**
 * Die Segen. Mächte und Domänen stammen aus der Vorlage (Zuordnung zu Höheren Mächten);
 * was der einzelne Segen im Spiel bewirkt, ist ein Vorschlag.
 */
export const SEGEN: readonly Segen[] = [
  {
    id: 'sors-laeuterung',
    name: 'Sors Läuterung',
    macht: 'Sor · Reinigung',
    text: 'Verstaubung löst sich auch fern der Feuerschalen, solange du nicht in der Finsternis stehst',
    apply: (s) => void (s.dustClear += 1.5),
  },
  {
    id: 'sors-schein',
    name: 'Sors Schein',
    macht: 'Sor · Licht',
    text: 'Dein Lichtschein reicht 30 % weiter, und Gegner darin erleiden 15 % mehr Schaden',
    apply: (s) => {
      s.light *= 1.3;
      s.litDamage *= 1.15;
    },
  },
  {
    id: 'kwests-glut',
    name: 'Kwests Glut',
    macht: 'Kwest · Feuer',
    text: 'Feuerschalen brennen 60 % länger und entzünden sich doppelt so schnell',
    apply: (s) => {
      s.burn *= 1.6;
      s.ignite *= 2;
    },
  },
  {
    id: 'kwests-esse',
    name: 'Kwests Esse',
    macht: 'Kwest · Handwerk',
    text: 'Brennende Feuerschalen versengen alle Gegner in ihrem Lichtkreis',
    apply: (s) => void (s.scorch += 12),
  },
  {
    id: 'ippaias-schutz',
    name: 'Ippaias Schutz',
    macht: 'Ippaia · Schutz',
    text: 'Nach einem Treffer bist du doppelt so lange vor der Horde geschützt',
    apply: (s) => void (s.grace *= 2),
  },
  {
    id: 'ippaias-geleit',
    name: 'Ippaias Geleit',
    macht: 'Ippaia · Reise',
    text: '+12 % Lauftempo, und Edelsteine fliegen dir aus doppelter Entfernung zu',
    apply: (s) => {
      s.speed += 0.12;
      s.pickup *= 2;
    },
  },
  {
    id: 'goths-jagd',
    name: 'Gôths Jagd',
    macht: 'Gôth · Krieg',
    text: 'Große Gegner erleiden 35 % mehr Schaden',
    apply: (s) => void (s.bigGame *= 1.35),
  },
  {
    id: 'goths-beute',
    name: 'Gôths Beute',
    macht: 'Gôth · Leben',
    text: 'Edelsteine bringen 25 % mehr Erfahrung',
    apply: (s) => void (s.xp *= 1.25),
  },
  {
    id: 'goths-boden',
    name: 'Gôths Boden',
    macht: 'Gôth · Erde',
    text: 'Festgehaltene Gegner erleiden 30 % mehr Schaden',
    apply: (s) => void (s.heldDamage *= 1.3),
  },
];

export interface Upgrade {
  id: string;
  name: string;
  text: string;
  /** Wie oft sie gewählt werden kann. */
  max: number;
  apply(stats: Stats): void;
}

// Die Stärkungen tragen die Namen der Effektfamilien aus den Magie-Vorlagen des Nutzers.
export const UPGRADES: readonly Upgrade[] = [
  { id: 'harte-hand', name: 'Die harte Hand', text: '+20 % Schaden', max: 5, apply: (s) => void (s.damage += 0.2) },
  {
    id: 'schneller-schritt',
    name: 'Der schnelle Schritt',
    text: 'Angriffe folgen 12 % schneller aufeinander',
    max: 5,
    apply: (s) => void (s.cooldown *= 0.88),
  },
  {
    id: 'gefuehrter-arm',
    name: 'Der geführte Arm',
    text: '+10 % Chance auf doppelten Schaden',
    max: 5,
    apply: (s) => void (s.critChance += 0.1),
  },
  {
    id: 'steinhaut',
    name: 'Steinhaut',
    text: 'Jeder Treffer verursacht 2 Schaden weniger',
    max: 4,
    apply: (s) => void (s.armor += 2),
  },
  {
    id: 'milder-mantel',
    name: 'Der milde Mantel',
    text: 'Die Finsternis verstaubt dich 20 % langsamer',
    max: 3,
    apply: (s) => void (s.verstaubung *= 0.8),
  },
  { id: 'zaehigkeit', name: 'Zähigkeit', text: '+20 Leben', max: 5, apply: (s) => void (s.maxHp += 20) },
  { id: 'leichtfuss', name: 'Leichtfuß', text: '+8 % Lauftempo', max: 3, apply: (s) => void (s.speed += 0.08) },
  {
    id: 'langer-arm',
    name: 'Langer Arm',
    text: '+15 % Reichweite aller Angriffe',
    max: 3,
    apply: (s) => void (s.reach += 0.15),
  },
  { id: 'lange-finger', name: 'Lange Finger', text: '+30 % Sammelradius', max: 3, apply: (s) => void (s.pickup += 0.3) },
];

function baseStats(): Stats {
  return {
    damage: 1,
    cooldown: 1,
    critChance: 0,
    armor: 0,
    verstaubung: 1,
    maxHp: CONFIG.player.maxHp,
    speed: 1,
    reach: 1,
    pickup: 1,
    dustClear: 0,
    light: 1,
    litDamage: 1,
    burn: 1,
    ignite: 1,
    scorch: 0,
    grace: 1,
    bigGame: 1,
    xp: 1,
    heldDamage: 1,
  };
}

function xpNeeded(level: number): number {
  const { base, linear, quadratic } = CONFIG.xp;
  return Math.round(base + linear * level + quadratic * level * level);
}

/** Erfahrung, Stufen und die gewählten Verbesserungen eines Runs. */
export class Progression {
  level = 1;
  xp = 0;
  needed = xpNeeded(1);
  /** Bleibt dasselbe Objekt, damit andere Systeme es festhalten können. */
  readonly stats: Stats = baseStats();
  private readonly ranks = new Map<string, number>();
  /** Die Segen, die in dieser Nacht schon gewährt wurden. */
  readonly blessed: Segen[] = [];

  /** Neue Nacht mit den Grundwerten der gewählten Klasse. */
  reset(playerClass: ClassDef): void {
    this.level = 1;
    this.xp = 0;
    this.needed = xpNeeded(1);
    Object.assign(this.stats, baseStats());
    this.stats.maxHp = Math.round(CONFIG.player.maxHp * playerClass.hpFactor);
    this.stats.speed = playerClass.speedFactor;
    this.stats.verstaubung = playerClass.verstaubungFactor;
    this.ranks.clear();
    this.blessed.length = 0;
  }

  /** Gibt zurück, wie viele Stufen dazugekommen sind. */
  addXp(amount: number): number {
    let gained = 0;
    this.xp += amount;
    while (this.xp >= this.needed) {
      this.xp -= this.needed;
      this.level++;
      this.needed = xpNeeded(this.level);
      gained++;
    }
    return gained;
  }

  rank(upgrade: Upgrade): number {
    return this.ranks.get(upgrade.id) ?? 0;
  }

  /** Verbesserungen, die noch nicht ausgereizt sind. */
  open(): Upgrade[] {
    return UPGRADES.filter((upgrade) => this.rank(upgrade) < upgrade.max);
  }

  take(upgrade: Upgrade): void {
    upgrade.apply(this.stats);
    this.ranks.set(upgrade.id, this.rank(upgrade) + 1);
  }

  /** Segen, die in dieser Nacht noch nicht gewährt wurden. */
  openSegen(): Segen[] {
    return SEGEN.filter((segen) => !this.blessed.includes(segen));
  }

  bless(segen: Segen): void {
    segen.apply(this.stats);
    this.blessed.push(segen);
  }
}
