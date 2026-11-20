/**
 * Messlauf: Eine einfache Automatik-Figur spielt ganze Nächte im Zeitraffer und schreibt mit,
 * wie es ihr ergeht. Das ersetzt kein Spielgefühl, zeigt aber grobe Schieflagen: Stirbt eine
 * Klasse immer früh? Trägt ein Angriff fast nichts bei? Wächst die Horde schneller als die Figur?
 *
 * Nur für die Entwicklung. In der Browser-Konsole:
 *   __messlauf.start()                               alle Klassen, je drei Nächte
 *   __messlauf.start({ nights: 5, classes: [2] })    nur der Magier, fünf Nächte
 *   __messlauf.start({ ausruestung: 'rar' })         alle neun Plätze jeder Klasse mit rar gewürfelten Gegenständen belegt
 *   __messlauf.start({ evolution: 'axthieb', classes: [0] })   der Kämpfer trägt den legendären Ring der Evolution des Axthiebs und beginnt mit diesem Angriff auf Rang 4
 *   __messlauf.start({ fokus: 'axthieb', classes: [0] })       dasselbe ohne Ring: Der Angriff endet bei Rang 5 (zum Vergleich mit der Evolution)
 *   __messlauf.results                               alle Messwerte
 *   __messlauf.config.enemies.ratePerMinute = 0.3  einen Wert nur für diese Sitzung ändern
 *   __messlauf.weapon('bogenschuss').damage = 20     ebenso einen Angriff
 *
 * Die Figur ist kein guter Spieler. Zehnmal je Sekunde sucht sie unter einigen Richtungen die,
 * in der es am ruhigsten ist, sammelt dabei Edelsteine, sucht bei Not eine Feuerschale und wählt
 * Stärkungen zufällig. Ihre Zahlen taugen zum Vergleichen, nicht als Maßstab.
 */
import { audio } from '../audio';
import { CONFIG } from '../config';
import type { MoveVector } from '../core/input';
import { createRandom, type Random } from '../core/random';
import type { OwnedWeapon } from '../game/arsenal';
import type { CombatListener } from '../game/events';
import { CLASSES, type ClassId } from '../game/classes';
import type { Enemy } from '../game/enemies';
import type { Game } from '../game/game';
import type { Stats } from '../game/progression';
import type { Ausruestung } from '../game/ausruestung';
import type { Boerse } from '../game/boerse';
import { ITEM_SLOTS, rollItem, type Rarity } from '../game/items';
import { weaponById, type WeaponDef } from '../game/weapons';
import type { Zone } from '../game/zones';

/** Die Teile des Spiels, in die der Messlauf hineingreift; im Spiel selbst sind sie nicht öffentlich. */
interface Internals {
  recordStats: boolean;
  nextSeed: number | null;
  phase: string;
  time: number;
  offers: { name: string; note: string }[];
  update(dt: number): void;
  pick(index: number): void;
  openSelect(): void;
  player: {
    position: { x: number; z: number };
    hp: number;
    verstaubung: number;
    lastDamage: string;
    hurt(amount: number, verstaubt?: boolean, announced?: boolean, attacker?: Enemy | null, ranged?: boolean): void;
  };
  enemies: { alive: Enemy[]; kills: number };
  threats: { sogs: { x: number; z: number; radius: number }[] };
  boss: { appeared: boolean; slain: boolean };
  zones: {
    islands: { x: number; z: number; state: 'unlit' | 'burning' | 'spent' }[];
    zoneAt(x: number, z: number): Zone;
    finsternisAt(x: number, z: number): number;
  };
  pickups: { gems: { x: number; z: number; value: number }[] };
  arsenal: {
    owned: OwnedWeapon[];
    hit(enemy: Enemy, weapon: OwnedWeapon, fromX: number, fromZ: number): void;
    rankOf(id: string): number;
    take(def: WeaponDef): void;
  };
  events: { add(listener: CombatListener): void };
  progression: { level: number; stats: Stats; blessed: { name: string }[] };
  boerse: Boerse;
  ausruestung: Ausruestung;
  beute: {
    settle(): { gold: number; items: { item: { rarity: Rarity } }[] };
  };
  input: { getMove(out: MoveVector): MoveVector };
  hud: { hideEnd(): void };
}

/** Wie eine Klasse sich bewegt. */
interface Style {
  /** Wie sehr sie Gedränge scheut; der Kämpfer muss heran, die anderen halten Abstand. */
  fear: number;
  /** Wie stark sie die Finsternis meidet. */
  shunDark: number;
  /** Wie stark es sie auch ohne Not zu einer Feuerschale zieht. */
  seekLight: number;
}

const STYLES: Record<ClassId, Style> = {
  // Der Kämpfer muss heran und ist im Licht am stärksten.
  kaempfer: { fear: 0.3, shunDark: 3, seekLight: 0.5 },
  wildnislaeufer: { fear: 1, shunDark: 2.5, seekLight: 0 },
  // Der Magier zaubert in der Finsternis schneller und geht deshalb nicht ganz so weit auf Abstand zu ihr.
  magier: { fear: 1, shunDark: 1.2, seekLight: 0 },
};

/** So viele Richtungen wägt die Figur ab, und so weit schaut sie dabei voraus (Meter). */
const DIRECTIONS = 16;
const LOOKAHEAD = [2.5, 6] as const;
/** Sekunden zwischen zwei Entscheidungen: etwa die Reaktionszeit eines Menschen. */
const DECIDE_SECONDS = 0.1;

/** Schrittweite der Rechnung; größer wäre schneller, aber Angriffe und Stöße würden ungenau. */
const STEP_SECONDS = 1 / 30;
/** So viele Millisekunden rechnet der Messlauf am Stück, bevor er dem Browser Luft lässt. */
const SLICE_MS = 14;

export interface MinuteSample {
  minute: number;
  stufe: number;
  erschlagen: number;
  gegner: number;
  leben: number;
}

export interface NightResult {
  klasse: string;
  /** Überlebte Sekunden; eine volle Nacht hat `CONFIG.run.nightSeconds`. */
  ueberlebt: number;
  gewonnen: boolean;
  todesursache: string;
  stufe: number;
  erschlagen: number;
  proMinute: MinuteSample[];
  /** Ausgeteilter Schaden je Angriff. */
  schaden: Record<string, number>;
  /** Schaden je Sekunde, seit der Angriff im Besitz ist: So lassen sich früh und spät gewählte vergleichen. */
  schadenJeSekunde: Record<string, number>;
  /** Rang je Angriff am Ende. */
  raenge: Record<string, number>;
  erlittenerSchaden: number;
  treffer: number;
  hoechsteVerstaubung: number;
  /** Sekunden je Zone. */
  zonen: Record<Zone, number>;
  entzuendeteFeuer: number;
  /** Was aus dem Verschlinger wurde: 'nicht erschienen', 'überlebt' oder 'erschlagen'. */
  boss: string;
  /** Die Segen, die in dieser Nacht gewählt wurden. */
  segen: string[];
  /** Gold, das die Nacht der Geldbörse eingebracht hat (Münzen, Sold und Prämie; ohne den Verkauf überzähliger Gegenstände). */
  gold: number;
  /** Die Gegenstände, die in der Nacht gefallen sind, nach Seltenheit (`CONFIG.loot`). */
  beute: Record<Rarity, number>;
}

interface Options {
  /** Nächte je Klasse. */
  nights?: number;
  /** Klassen als Stelle in der Liste: 0 Kämpfer, 1 Wildnisläufer, 2 Magier. */
  classes?: number[];
  /** Bricht jede Nacht nach so vielen Sekunden ab; zum schnellen Probieren. */
  maxSeconds?: number;
  /**
   * Alle neun Plätze jeder Klasse mit gewürfelten Gegenständen dieser Seltenheit belegen (Würfel aus `seed`, bei allen
   * Klassen gleich gezogen). Ohne Angabe ist nichts angelegt, damit die Werte unabhängig vom Spielstand vergleichbar bleiben.
   * Der echte Spielstand wird weder gelesen noch verändert.
   */
  ausruestung?: Exclude<Rarity, 'legendaer'>;
  /**
   * Die Kennung eines Angriffs mit Evolution (etwa `'axthieb'`): Die Klasse, zu der er gehört, trägt den legendären Ring, der sie freischaltet
   * (er ersetzt den Ring der Ausrüstung); die Nacht beginnt mit diesem Angriff auf Rang 4, und die Figur wählt ihn bei jeder Stärkung, die ihn anbietet.
   * So erreicht er in jeder Nacht früh Rang 6, und man sieht, was die Evolution leistet.
   */
  evolution?: string;
  /** Wie `evolution`, nur ohne den Ring: Der Angriff beginnt auf Rang 4 und endet bei Rang 5. Der Vergleichswert zur Evolution. */
  fokus?: string;
  seed?: number;
}

/**
 * Wählt die Richtung, in der es am ruhigsten ist. Anders als bloßes Wegstoßen von Gegnern
 * findet das auch die Lücke im Ring, statt eingekesselt stehen zu bleiben.
 */
function steer(g: Internals, style: Style, previous: number, out: MoveVector): number {
  const { x, z } = g.player.position;
  const maxHp = g.progression.stats.maxHp;
  const inNeed = g.player.hp < maxHp * 0.55 || g.player.verstaubung > maxHp * 0.12;
  const lightPull = (inNeed ? 2.2 : 0) + style.seekLight;

  // Nächste Feuerschale, die brennt oder sich entzünden lässt.
  let island: { x: number; z: number } | null = null;
  let islandDistance = Infinity;
  if (lightPull > 0) {
    for (const candidate of g.zones.islands) {
      if (candidate.state === 'spent') continue;
      const distance = Math.hypot(candidate.x - x, candidate.z - z);
      if (distance < islandDistance) {
        island = candidate;
        islandDistance = distance;
      }
    }
  }

  // Nur was nah ist, zählt; das spart bei voller Horde die meiste Rechnung.
  const near: Enemy[] = [];
  for (const enemy of g.enemies.alive) {
    if (Math.abs(enemy.x - x) < 14 && Math.abs(enemy.z - z) < 14) near.push(enemy);
  }
  const gems = g.pickups.gems.filter((gem) => Math.abs(gem.x - x) < 14 && Math.abs(gem.z - z) < 14);

  /** Wie gut es an einem Punkt wäre: wenig Gegner, Edelsteine in Reichweite, Licht bei Not, keine Finsternis. */
  const worth = (px: number, pz: number): number => {
    let danger = 0;
    for (const enemy of near) {
      const dx = px - enemy.x;
      const dz = pz - enemy.z;
      danger += enemy.type.damage / 8 / (dx * dx + dz * dz + 0.6);
    }
    let loot = 0;
    for (const gem of gems) loot = Math.max(loot, gem.value ** 0.5 / (Math.hypot(px - gem.x, pz - gem.z) + 1.5));
    let value = -danger * style.fear * 6 + loot * 2.2 - g.zones.finsternisAt(px, pz) * style.shunDark * 3;
    // Aus der angekündigten Fläche eines Schwarzen Sogs geht jeder hinaus, der sie sieht.
    for (const sog of g.threats.sogs) {
      if (Math.hypot(px - sog.x, pz - sog.z) < sog.radius + 0.6) value -= 5;
    }
    if (island) value -= (Math.hypot(island.x - px, island.z - pz) / 10) * lightPull;
    const fromCenter = Math.hypot(px, pz);
    if (fromCenter > CONFIG.world.radius - 10) value -= (fromCenter - (CONFIG.world.radius - 10)) * 0.8;
    return value;
  };

  // Stehen bleiben ist auch eine Wahl: Der Kämpfer steht oft richtig, wo er ist.
  let best = -1;
  let bestValue = worth(x, z) + 0.05;
  for (let i = 0; i < DIRECTIONS; i++) {
    const angle = (i / DIRECTIONS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let value = 0;
    for (const reach of LOOKAHEAD) value += worth(x + dx * reach, z + dz * reach);
    value /= LOOKAHEAD.length;
    // Wer einmal läuft, bleibt eher bei seiner Richtung, statt zu zappeln.
    if (i === previous) value += 0.12;
    if (value > bestValue) {
      best = i;
      bestValue = value;
    }
  }
  if (best < 0) {
    out.x = 0;
    out.y = 0;
    return best;
  }
  const angle = (best / DIRECTIONS) * Math.PI * 2;
  // Bildschirm-oben ist -Z in der Welt.
  out.x = Math.cos(angle);
  out.y = -Math.sin(angle);
  return best;
}

/** Der Rang, mit dem ein Angriff im Blick (`evolution`, `fokus`) in die Nacht geht. */
const FOCUS_RANK = 4;

async function playNight(game: Game, classIndex: number, random: Random, maxSeconds: number, focus?: string): Promise<NightResult> {
  const g = game as unknown as Internals;
  const playerClass = CLASSES[classIndex];
  if (!playerClass) throw new Error(`Keine Klasse an Stelle ${classIndex}.`);
  const style = STYLES[playerClass.id];
  const result: NightResult = {
    klasse: playerClass.name,
    ueberlebt: 0,
    gewonnen: false,
    todesursache: '',
    stufe: 1,
    erschlagen: 0,
    proMinute: [],
    schaden: {},
    schadenJeSekunde: {},
    raenge: {},
    erlittenerSchaden: 0,
    treffer: 0,
    hoechsteVerstaubung: 0,
    zonen: { licht: 0, nacht: 0, finsternis: 0 },
    entzuendeteFeuer: 0,
    boss: 'nicht erschienen',
    segen: [],
    gold: 0,
    beute: { normal: 0, selten: 0, rar: 0, legendaer: 0 },
  };
  const goldBefore = g.boerse.gold;
  // Mithören: Was fiel, und was brachte der Verkauf überzähliger Gegenstände ein (das gehört nicht zum Ertrag der Nacht)?
  const beute = g.beute;
  const settleLoot = beute.settle;
  let soldGold = 0;
  beute.settle = function () {
    const loot = settleLoot.call(this);
    soldGold = loot.gold;
    for (const entry of loot.items) result.beute[entry.item.rarity]++;
    return loot;
  };

  g.hud.hideEnd();
  g.openSelect();
  g.pick(classIndex);
  // Nach der Klasse folgt die Wahl des Startangriffs; die Messung nimmt den üblichen, den ersten der Klasse.
  if (g.phase === 'start') g.pick(0);
  // Mit einem Angriff im Blick beginnt die Nacht mit ihm auf Rang 4: Sonst käme er in einer Nacht selten bis Rang 5, und es ließe sich nichts messen.
  // Der nächste Rang ist dann die Evolution (mit dem Ring) oder Rang 5 (ohne).
  if (focus) {
    const def = weaponById(focus);
    while (g.arsenal.rankOf(focus) < FOCUS_RANK) g.arsenal.take(def);
  }

  // Mithören: Wer teilt wie viel aus, und was steckt die Figur ein?
  const arsenal = g.arsenal;
  const hit = arsenal.hit;
  arsenal.hit = function (enemy, weapon, fromX, fromZ) {
    const before = enemy.hp;
    hit.call(this, enemy, weapon, fromX, fromZ);
    const dealt = Math.min(before, before - enemy.hp);
    if (dealt > 0) result.schaden[weapon.def.name] = (result.schaden[weapon.def.name] ?? 0) + dealt;
  };
  // Schaden über Zeit (Banner, Blutung, Brennen) läuft nicht über `Arsenal.hit`, sondern kommt als Ereignis mit Urheber.
  g.events.add({
    hit(_enemy, amount, source, dot) {
      if (!dot || !source) return;
      const owner = arsenal.owned.find((weapon) => weapon.def.id === source.id);
      if (owner) result.schaden[owner.def.name] = (result.schaden[owner.def.name] ?? 0) + amount;
    },
  });
  const player = g.player;
  const hurt = player.hurt;
  player.hurt = function (amount, verstaubt, announced, attacker, ranged) {
    const before = this.hp;
    hurt.call(this, amount, verstaubt, announced, attacker, ranged);
    if (this.hp < before) {
      result.erlittenerSchaden += before - this.hp;
      result.treffer++;
    }
  };
  const move: MoveVector = { x: 0, y: 0 };
  const getMove = g.input.getMove;
  g.input.getMove = (out) => {
    out.x = move.x;
    out.y = move.y;
    return out;
  };

  const burning = new Set<object>();
  /** Seit wann die Figur jeden Angriff besitzt. */
  const ownedSince = new Map<string, number>();
  let direction = -1;
  let decideIn = 0;
  let nextMinute = 60;
  try {
    while (g.phase !== 'ended' && g.time < maxSeconds) {
      const sliceStart = performance.now();
      while (performance.now() - sliceStart < SLICE_MS && g.phase !== 'ended' && g.time < maxSeconds) {
        if (g.phase === 'levelup') {
          // Mit einer Evolution im Blick nimmt die Figur den Angriff, sobald er angeboten wird; sonst entscheidet der Zufall.
          const wanted = focus ? g.offers.findIndex((offer) => offer.name === weaponById(focus).name) : -1;
          const index = wanted >= 0 ? wanted : Math.floor(random() * g.offers.length);
          g.pick(index);
          continue;
        }
        if (g.phase !== 'playing') break;
        decideIn -= STEP_SECONDS;
        if (decideIn <= 0) {
          direction = steer(g, style, direction, move);
          decideIn = DECIDE_SECONDS;
        }
        g.update(STEP_SECONDS);
        for (const weapon of g.arsenal.owned) {
          if (!ownedSince.has(weapon.def.name)) ownedSince.set(weapon.def.name, g.time);
        }

        const { x, z } = g.player.position;
        result.zonen[g.zones.zoneAt(x, z)] += STEP_SECONDS;
        result.hoechsteVerstaubung = Math.max(result.hoechsteVerstaubung, g.player.verstaubung);
        for (const island of g.zones.islands) {
          if (island.state === 'burning' && !burning.has(island)) {
            burning.add(island);
            result.entzuendeteFeuer++;
          } else if (island.state !== 'burning') {
            burning.delete(island);
          }
        }
        if (g.time >= nextMinute) {
          result.proMinute.push({
            minute: nextMinute / 60,
            stufe: g.progression.level,
            erschlagen: g.enemies.kills,
            gegner: g.enemies.alive.length,
            leben: Math.round(g.player.hp),
          });
          nextMinute += 60;
        }
      }
      // Dem Browser Luft lassen, sonst friert die Seite für die Dauer der Nacht ein.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    beute.settle = settleLoot;
    arsenal.hit = hit;
    player.hurt = hurt;
    g.input.getMove = getMove;
  }

  result.ueberlebt = Math.round(Math.min(g.time, CONFIG.run.nightSeconds));
  result.gewonnen = g.phase === 'ended' && g.player.hp > 0;
  result.todesursache = g.player.hp > 0 ? '' : g.player.lastDamage;
  result.stufe = g.progression.level;
  result.erschlagen = g.enemies.kills;
  result.boss = g.boss.slain ? 'erschlagen' : g.boss.appeared ? 'überlebt' : 'nicht erschienen';
  result.segen = g.progression.blessed.map((segen) => segen.name);
  result.gold = g.boerse.gold - goldBefore - soldGold;
  for (const weapon of g.arsenal.owned) {
    const name = weapon.def.name;
    result.raenge[name] = weapon.rank;
    const seconds = Math.max(1, g.time - (ownedSince.get(name) ?? 0));
    result.schadenJeSekunde[name] = Math.round(((result.schaden[name] ?? 0) / seconds) * 10) / 10;
  }
  for (const name of Object.keys(result.schaden)) result.schaden[name] = Math.round(result.schaden[name] ?? 0);
  result.erlittenerSchaden = Math.round(result.erlittenerSchaden);
  result.hoechsteVerstaubung = Math.round(result.hoechsteVerstaubung);
  for (const zone of Object.keys(result.zonen) as Zone[]) result.zonen[zone] = Math.round(result.zonen[zone]);
  return result;
}

/** Hängt den Messlauf als `__messlauf` ans Fenster. */
export function installMesslauf(game: Game): void {
  const api = {
    running: false,
    // Zum Ausprobieren von Werten, ohne Dateien zu ändern: Diese Objekte sind die des laufenden Spiels.
    config: CONFIG,
    classes: CLASSES,
    weapon: weaponById,
    /** Fortschritt als Text, etwa "Magier, Nacht 2 von 3". */
    status: 'bereit',
    results: [] as NightResult[],
    async start(options: Options = {}): Promise<NightResult[]> {
      if (api.running) return api.results;
      api.running = true;
      api.results = [];
      // Im Zeitraffer wäre jeder Ton ein Rauschen und die Wiedergabe eine Last.
      audio.silenced = true;
      const random = createRandom(options.seed ?? 12345);
      const nights = options.nights ?? 3;
      const classes = options.classes ?? CLASSES.map((_, index) => index);
      // Das Gold der Messung wird nicht gespeichert; am Ende gilt wieder der echte Spielstand.
      const boerse = (game as unknown as Internals).boerse;
      boerse.persist = false;
      // Auch die Statistik soll die Probenächte nicht zählen.
      (game as unknown as Internals).recordStats = false;
      // Dasselbe für die Gegenstände: Die Ausrüstung der Messung ersetzt die echte, bis der Spielstand neu gelesen wird.
      const ausruestung = (game as unknown as Internals).ausruestung;
      ausruestung.persist = false;
      const itemRandom = createRandom((options.seed ?? 12345) + 777);
      // Jeder Lauf würfelt sonst mit der Uhrzeit; für die Messung bekommt jede Nacht einen festen, weitergezählten Seed.
      let runSeed = (options.seed ?? 12345) + 4242;
      const focus = options.evolution ?? options.fokus;
      const owner = focus ? CLASSES.find((candidate) => candidate.weapons.includes(focus)) : undefined;
      if (options.evolution && !weaponById(options.evolution).evolution) throw new Error(`${options.evolution} hat keine Evolution.`);
      for (const playerClass of CLASSES) {
        const items = options.ausruestung
          ? ITEM_SLOTS.map((slot) => rollItem(itemRandom, slot, options.ausruestung as Rarity, playerClass.id))
          : [];
        // Der legendäre Ring ersetzt den Ring der Ausrüstung.
        if (options.evolution && owner === playerClass) {
          items.splice(0, items.length, ...items.filter((item) => item.slot !== 'ring'), rollItem(itemRandom, 'ring', 'legendaer', playerClass.id, options.evolution));
        }
        ausruestung.setLoadout(playerClass.id, items);
      }
      try {
        for (const classIndex of classes) {
          for (let night = 1; night <= nights; night++) {
            api.status = `${CLASSES[classIndex]?.name ?? '?'}, Nacht ${night} von ${nights}`;
            (game as unknown as Internals).nextSeed = runSeed++;
            api.results.push(await playNight(game, classIndex, random, options.maxSeconds ?? Infinity, owner === CLASSES[classIndex] ? focus : undefined));
          }
        }
        api.status = 'fertig';
      } catch (error) {
        api.status = `abgebrochen: ${String(error)}`;
        throw error;
      } finally {
        api.running = false;
        audio.silenced = false;
        boerse.persist = true;
        (game as unknown as Internals).recordStats = true;
        boerse.reload();
        ausruestung.persist = true;
        ausruestung.reload();
        (game as unknown as Internals).nextSeed = null;
        (game as unknown as Internals).hud.hideEnd();
        (game as unknown as Internals).openSelect();
      }
      return api.results;
    },
  };
  (window as unknown as { __messlauf: typeof api }).__messlauf = api;
}
