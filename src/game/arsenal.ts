import * as THREE from 'three';
import { audio, type SoundId } from '../audio';
import { CONFIG, type EnemyModel } from '../config';
import type { Random } from '../core/random';
import type { BuffSpec } from './buffs';
import type { ClassDef } from './classes';
import { BANNER_CAPACITY, DECOY_CAPACITY, Effects, type StrikeKind } from './effects';
import type { Enemies, Enemy } from './enemies';
import { sourceOf, type CombatListener, type Source } from './events';
import type { Field, FieldDef, Fields } from './fields';
import type { Pickups } from './pickups';
import type { Player } from './player';
import { Evolutions } from './evolutions';
import { Projectiles, type Projectile, type ProjectileOptions } from './projectiles';
import { BIG_GAME_SCALE, type Progression, type Stats } from './progression';
import { applyStatus, markChance, takenFactor } from './status';
import { EVOLUTION_RANK, hasFlag, MAX_RANK, resolveRank, statusSeconds, weaponById, type ResolvedRank, type WeaponDef } from './weapons';
import type { Site, Zones } from './zones';

/** Was Klasse und Zone gerade am Kampf verändern. */
export interface CombatTraits {
  /** Faktor auf allen ausgeteilten Schaden. */
  dealt: number;
  /** Faktor auf das Tempo, mit dem Abklingzeiten ablaufen. */
  haste: number;
  /** Faktor auf Treffer gegen Gegner, die in der Finsternis stehen. */
  finsternisDamage: number;
}

export interface OwnedWeapon {
  def: WeaponDef;
  rank: number;
  /** Was der Rang festlegt (Schaden, Abklingzeit, Fläche, Zustände ...); wechselt mit dem Rang. */
  rules: ResolvedRank;
  /** Der Urheber seiner Treffer in den Ereignissen (`events.ts`). */
  source: Source;
  cooldown: number;
  /** Die Figur holt für diesen Angriff schon aus. */
  windingUp: boolean;
  /** Sekunden, die der Angriff beim nächsten Auslösen von seiner Abklingzeit abzieht (Wirbelschlag, Wuchthieb); negativ: die er dazurechnet (Mahlstrom). */
  refund: number;
  /** Der nächste Schlag ist sicher kritisch (Wuchthieb, Rang 5). */
  primed: boolean;
  /** Zählt Ereignisse für „jeder dritte Treffer“ (Dornenschild). */
  counter: number;
}

/** Was nach einer Weile noch folgt: der Rückhand-Hieb des Axthiebs, der zweite Wirbel, das Echo des Kriegsschreis. */
interface FollowUp {
  active: boolean;
  weapon: OwnedWeapon;
  delay: number;
  kind: 'rueckhand' | 'wirbel' | 'echo' | 'welle' | 'lanze';
  angle: number;
}

/** Was der Arsenal von der übrigen Spielwelt braucht, um Felder zu setzen, zeitweilige Werte zu geben und Splitter fallen zu lassen. */
export interface ArsenalSupport {
  fields: Fields;
  progression: Progression;
  pickups: Pickups;
}

interface Placed extends Site {
  weapon: OwnedWeapon;
  /** Restzeit bis zum Einschlag; bei Fallen ungenutzt. */
  delay: number;
}

const TRAP_CAPACITY = 12;
const FOLLOW_UPS = 12;
const KAEMPFER = CONFIG.skills.kaempfer;
const LAEUFER = CONFIG.skills.laeufer;
const MAGIER = CONFIG.skills.magier;
const EVOLUTION = CONFIG.skills.evolution;
/** Die zeitweiligen Werte der Kämpfer-Fertigkeiten; `seconds` stellt der Aufrufer vor dem Setzen ein. */
const GUARD: BuffSpec = { id: 'schutz', stat: 'taken', mode: 'mul', amount: 1, seconds: 1 };
const WHIRL_SPEED: BuffSpec = { id: 'wirbelschlag-tempo', stat: 'speed', mode: 'mul', amount: KAEMPFER.whirlSpeed, seconds: KAEMPFER.whirlSpeedSeconds };
const SHOUT_HASTE: BuffSpec = { id: 'kriegsschrei-tempo', stat: 'cooldown', mode: 'mul', amount: KAEMPFER.shoutAdvantageCooldown, seconds: KAEMPFER.shoutAdvantageSeconds };
const SHOUT_CRIT: BuffSpec = { id: 'kriegsschrei-krit', stat: 'critChance', mode: 'add', amount: KAEMPFER.shoutAdvantageCrit, seconds: KAEMPFER.shoutAdvantageSeconds };
/** Der Schleier der Köderpuppe (Rang 4): Fernangriffe richten weniger an, solange die Figur im Schatten der Puppe steht. */
const SHELTER: BuffSpec = { id: 'koederpuppe-schleier', stat: 'rangedTaken', mode: 'mul', amount: LAEUFER.decoyShelter, seconds: 0.8 };
/** Der Urheber der Wolke, die ein Gestorbener hinterlässt (Sporenfalle, Rang 5). */
const REST_ID = 'sporenfalle-rest';
/** Der Schub nach der Sturmböe (Rang 2). */
const BOOST: BuffSpec = { id: 'sturmboee-tempo', stat: 'speed', mode: 'mul', amount: MAGIER.boostSpeed, seconds: MAGIER.boostSeconds };
/** Die Zauber des Magiers: Nur ihre Tode und Treffer zählen für den Schild (Rang 5). */
const SPELLS: ReadonlySet<string> = new Set(['hitze-werfen', 'sorlanze', 'glut-formen', 'erdstoss', 'wurzelgriff', 'sturmboee']);
/** Ein Rückstoß mit Tempo v trägt einen Gegner um v / 8 Meter weit: Er klingt mit exp(−8 t) ab (`Enemies.update`). */
const PUSH_PER_METER = 8;
/** So viele Gegner merkt sich die Sorlanze auf einmal, wenn sie nur die ersten trifft (Rang 1); mehr gelten als unbegrenzt. */
const BEAM_SLOTS = 8;
const LINE_COLOR = 0xffb454;
const ASH_COLOR = 0xff6a24;
/** Die Nahkampfangriffe des Kämpfers: Nur sie erleiden die Mehrung durch den Donner der Alten Ordnung. */
const MELEE: ReadonlySet<string> = new Set(['axthieb', 'wirbelschlag', 'wuchthieb', 'kriegsschrei', 'dornenschild']);
const NO_EVOLUTIONS: ReadonlySet<string> = new Set();
/** Die Glut der Feuerschalen (Kwests Esse) als Urheber ihres Schadens. */
const SEAR_SOURCE = sourceOf('kwests-esse');
const lightAt = new THREE.Vector3();

/** Woran ein Treffer des Angriffs zu erkennen ist. */
function strikeKind(def: WeaponDef): StrikeKind {
  if (def.kind === 'beam') return 'brand';
  if (def.kind === 'aura' || def.look === 'hitze') return 'glut';
  if (def.kind === 'projectile' || def.kind === 'volley' || def.kind === 'trap') return 'stahl';
  return def.look === 'hieb' || def.look === 'wucht' || def.look === 'wirbel' ? 'stahl' : 'staub';
}

/** Der Ton zu jeder Trefferart; fest hinterlegt, weil Treffer das häufigste Ereignis im Kampf sind. */
const HIT_SOUNDS: Record<StrikeKind, SoundId> = {
  stahl: 'treffer.stahl',
  staub: 'treffer.staub',
  brand: 'treffer.brand',
  glut: 'treffer.brand',
};

/** Höhe eines Punktes am Körper des Gegners als Anteil seiner Größe; wer schwebt, steht entsprechend höher. */
function bodyHeight(model: EnemyModel, fraction: number): number {
  return (model.hover?.lift ?? 0) + model.height * fraction;
}

/** Alle Angriffe der Spielfigur: was sie besitzt, wann es auslöst und wen es trifft. */
export class Arsenal {
  readonly group = new THREE.Group();
  readonly owned: OwnedWeapon[] = [];
  private readonly effects = new Effects();
  private readonly projectiles = new Projectiles<OwnedWeapon>();
  private readonly traps: Placed[] = [];
  private readonly pods: Placed[] = [];
  private readonly volleys: Placed[] = [];
  private available: readonly WeaponDef[] = [];
  /** Die Bewegungen der Figur zu den Angriffen ihrer Klasse. */
  private swings: ClassDef['swings'] = {};
  private traits: CombatTraits = { dealt: 1, haste: 1, finsternisDamage: 1 };
  private shieldCharging = 0;
  private readonly followUps: FollowUp[] = [];
  /** Das Dornenschild der Figur, wenn sie eines hat. */
  private thorns: OwnedWeapon | null = null;
  /** Das Fangeisen der Figur, wenn sie eines hat (Rang 5 wartet auf Tote im Eisen). */
  private trapper: OwnedWeapon | null = null;
  /** Faktor auf den Schaden des nächsten Treffers; Aufrufer stellen ihn vor einem Schlag ein und danach zurück auf 1. */
  private factor = 1;
  /** Der nächste Treffer stößt nicht zurück (der Mahlstrom zieht und schleudert selbst). */
  private pushless = false;
  /** Wie viele Gegner der laufende Schlag getroffen hat. */
  private swept = 0;
  private readonly options = new Map<ResolvedRank, ProjectileOptions>();
  private readonly bannerFields = new Map<ResolvedRank, FieldDef>();
  private readonly decoyFields = new Map<ResolvedRank, FieldDef>();
  private readonly sporeFields = new Map<ResolvedRank, FieldDef>();
  private readonly restFields = new Map<ResolvedRank, FieldDef>();
  private readonly bannerSites: Site[] = [];
  private readonly decoySites: Site[] = [];
  /** Die Splitter eines Fangeisens (Rang 5) und Schläge ohne Zustände: Sie wirken nicht in Ketten und bringen nichts an. */
  private splintering = false;
  private plain = false;
  /** Wie viele Ladungen der Schild im letzten Bild hatte: Daran erkennt man, dass er gerade einen Treffer abgefangen hat. */
  private shieldSeen = 0;
  /** Der Wurzelgriff der Figur (Rang 4 und 5 lauern auf Gefesselte) und ihr Schild (Rang 4 und 5 lauern auf den Bruch). */
  private rooter: OwnedWeapon | null = null;
  private shielder: OwnedWeapon | null = null;
  /** Hat der Schild Rang 5? Dann zählt er Tode durch Zauber und Treffer an Großen. */
  private primed = false;
  private primeKills = 0;
  private primeHits = 0;
  /** Läuft die Ladezeit des Schilds, seit er zuletzt abgefangen hat? */
  private shieldStarted = false;
  /** Die Spielzeit des Bilds, für „wie lange steht er im Glutkreis“. */
  private now = 0;
  /** Zustand des Schlags, der gerade läuft: Pulse der Glut, Betäubung der zweiten Erdwelle. */
  private pulsing = false;
  private stun = false;
  private glowX = 0;
  private glowZ = 0;
  private glowRadius = 0;
  /** Die Sorlanze merkt sich, wen sie trifft, damit sie nur die ersten Gegner in der Reihe nimmt. */
  private readonly beamEnemy: (Enemy | null)[] = Array.from({ length: BEAM_SLOTS }, () => null);
  private readonly beamAlong: number[] = Array.from({ length: BEAM_SLOTS }, () => 0);
  /** Die Beschreibungen der Felder des Magiers; sie hängen nicht vom Rang ab, einmal angelegt. */
  private lineDef: FieldDef | null = null;
  private ashDef: FieldDef | null = null;
  private ringDef: FieldDef | null = null;
  private trailDef: FieldDef | null = null;
  /** Die Staubspur der Sturmböe (Rang 5): wie lange sie noch entsteht und wann das nächste Feld fällt. */
  private trailWeapon: OwnedWeapon | null = null;
  private trailTime = 0;
  private trailGap = 0;
  /** Die Evolutionen (Rang 6), die die Ringe dieser Nacht freischalten: die Kennungen der Angriffe. */
  private evolved: ReadonlySet<string> = NO_EVOLUTIONS;
  /** Das Spiel erfährt, wenn ein Angriff sich entwickelt (Meldung auf dem Bildschirm). */
  onEvolve: ((weapon: OwnedWeapon) => void) | null = null;
  private readonly evolutions: Evolutions;
  /** Das Feld des schwebenden Banners (Reliquie der Nimmersatten), wenn eines liegt. */
  private relic: Field | null = null;
  private relicSeen: Field | null = null;

  constructor(
    private readonly stats: Stats,
    private readonly random: Random,
    private readonly enemies: Enemies,
    private readonly zones: Zones,
    private readonly player: Player,
    private readonly support: ArsenalSupport,
  ) {
    this.group.add(this.projectiles.group, this.effects.group);
    const idle = weaponById('axthieb');
    for (let i = 0; i < FOLLOW_UPS; i++) {
      this.followUps.push({
        active: false,
        weapon: { def: idle, rank: 1, rules: resolveRank(idle, 1), source: sourceOf(idle.id), cooldown: 0, windingUp: false, refund: 0, primed: false, counter: 0 },
        delay: 0,
        kind: 'rueckhand',
        angle: 0,
      });
    }
    for (let i = 0; i < BANNER_CAPACITY; i++) this.bannerSites.push({ x: 0, z: 0 });
    for (let i = 0; i < DECOY_CAPACITY; i++) this.decoySites.push({ x: 0, z: 0 });
    const arsenal = this;
    this.evolutions = new Evolutions({
      stats,
      enemies,
      player,
      support,
      effects: this.effects,
      projectiles: this.projectiles,
      get traits() {
        return arsenal.traits;
      },
      get now() {
        return arsenal.now;
      },
      strike: (enemy, weapon, fromX, fromZ, factor, push = true) => {
        this.factor = factor;
        this.pushless = !push;
        this.hit(enemy, weapon, fromX, fromZ);
        this.factor = 1;
        this.pushless = false;
      },
      range: (weapon) => weapon.def.range * this.stats.reach * weapon.rules.range,
      projectileOptions: (weapon) => this.projectileOptions(weapon),
      swing: (weapon, angle) => {
        const swing = this.swings[weapon.def.id];
        if (swing) this.player.strike(swing, angle);
      },
    });
  }

  /**
   * Neue Nacht: nur der Startangriff der Klasse. `evolutions` sind die Angriffe, deren Evolution ein angelegter legendärer Ring
   * freischaltet; sie werden Rang 6, sobald sie Rang 5 erreichen (`take`).
   */
  reset(playerClass: ClassDef, evolutions: ReadonlySet<string> = NO_EVOLUTIONS): void {
    this.available = playerClass.weapons.map(weaponById);
    this.evolved = evolutions;
    this.relic = null;
    this.relicSeen = null;
    this.evolutions.reset();
    this.swings = playerClass.swings;
    this.owned.length = 0;
    this.traps.length = 0;
    this.pods.length = 0;
    this.volleys.length = 0;
    for (const followUp of this.followUps) followUp.active = false;
    this.thorns = null;
    this.trapper = null;
    this.splintering = false;
    this.plain = false;
    this.factor = 1;
    this.shieldCharging = 0;
    this.shieldStarted = false;
    this.shieldSeen = 0;
    this.rooter = null;
    this.shielder = null;
    this.primed = false;
    this.primeKills = 0;
    this.primeHits = 0;
    this.pulsing = false;
    this.stun = false;
    this.trailWeapon = null;
    this.trailTime = 0;
    this.player.shieldCharges = 0;
    this.projectiles.reset();
    this.effects.reset();
    const start = this.available[0];
    if (start) this.take(start);
  }

  /** Hält die Teilchen der Effekte unabhängig von Auflösung und Blickwinkel gleich groß. */
  resize(pixelHeight: number, fovDegrees: number): void {
    this.effects.resize(pixelHeight, fovDegrees);
  }

  /** Angriffe der Klasse, die neu gewählt oder weiter verbessert werden können. */
  open(): { def: WeaponDef; rank: number }[] {
    return this.available
      .map((def) => ({ def, rank: this.find(def)?.rank ?? 0 }))
      .filter((entry) => entry.rank < MAX_RANK);
  }

  /** Schaltet Evolutionen frei, als trüge die Figur den Ring dazu (Werkzeuge; `reset` setzt sie aus den angelegten Ringen). */
  unlockEvolutions(ids: ReadonlySet<string>): void {
    this.evolved = ids;
  }

  /** Der Rang des Angriffs mit dieser Kennung in dieser Nacht; 0, wenn die Figur ihn noch nicht hat. */
  rankOf(id: string): number {
    return this.owned.find((weapon) => weapon.def.id === id)?.rank ?? 0;
  }

  /** Hat der Angriff eine Evolution, die ein angelegter Ring freischaltet? */
  unlocks(def: WeaponDef): boolean {
    return def.evolution !== undefined && this.evolved.has(def.id);
  }

  take(def: WeaponDef): void {
    const weapon = this.find(def);
    if (weapon) {
      weapon.rank++;
      // Rang 5 mit dem passenden Ring entwickelt sich sofort zum Rang 6.
      const evolves = weapon.rank === MAX_RANK && this.unlocks(def);
      if (evolves) weapon.rank = EVOLUTION_RANK;
      weapon.rules = resolveRank(def, weapon.rank);
      if (evolves) this.evolve(weapon);
    } else {
      const owned: OwnedWeapon = {
        def,
        rank: 1,
        rules: resolveRank(def, 1),
        source: sourceOf(def.id),
        cooldown: 0,
        windingUp: false,
        refund: 0,
        primed: false,
        counter: 0,
      };
      this.owned.push(owned);
      if (def.kind === 'thorns') this.thorns = owned;
      if (def.kind === 'trap') this.trapper = owned;
      if (def.id === 'wurzelgriff') this.rooter = owned;
      if (def.kind === 'shield') this.shielder = owned;
    }
    this.primed = this.shielder !== null && hasFlag(this.shielder.rules, 'staub');
  }

  update(dt: number, time: number, traits: CombatTraits): void {
    this.traits = traits;
    this.now = time;
    const origin = this.player.position;
    let aura: OwnedWeapon | null = null;

    for (const weapon of this.owned) {
      if (weapon.def.kind === 'shield') {
        this.updateShield(dt, weapon);
        continue;
      }
      // Das Dornenschild wirkt nur, wenn ein Gegner die Figur trifft (`hurt`); sein Bollwerk (Rang 6) steht dauernd vor der Figur.
      if (weapon.def.kind === 'thorns') {
        if (weapon.rank === EVOLUTION_RANK) this.evolutions.keepBulwark(weapon, dt);
        continue;
      }
      // Die Reliquie der Nimmersatten ist ein Banner ohne Abklingzeit: Es schwebt immer über der Figur.
      if (weapon.rank === EVOLUTION_RANK && hasFlag(weapon.rules, 'reliquie')) {
        this.keepRelic(weapon, origin);
        continue;
      }
      if (weapon.def.kind === 'aura') aura = weapon;
      weapon.cooldown -= dt * traits.haste;
      if (weapon.cooldown > 0) {
        this.announce(weapon, origin);
        // Spalter von Ghen: Beim Ausholen zieht der Staub nahe Gegner zum Einschlagpunkt.
        if (weapon.windingUp && weapon.rank === EVOLUTION_RANK && hasFlag(weapon.rules, 'spalter')) this.windup(weapon, origin, dt);
        continue;
      }
      if (this.fire(weapon, origin)) {
        weapon.cooldown = weapon.def.cooldown * this.stats.cooldown * weapon.rules.cooldown;
        weapon.windingUp = false;
        if (weapon.refund !== 0) {
          weapon.cooldown = Math.max(0, weapon.cooldown - weapon.refund);
          weapon.refund = 0;
        }
      }
    }

    this.evolutions.update(dt);
    this.updateFollowUps(dt);
    this.updateVolleys(dt);
    this.updateTraps();
    this.updatePods();
    this.updateTrail(dt);
    this.projectiles.update(dt, this.enemies, this.onProjectileHit, origin, this.trail);
    this.showFields();
    this.effects.embers(aura !== null, origin.x, origin.z, aura ? this.auraRadius(aura) : 0, time, dt);
    // Wer den Schild getroffen hat, ist meist der nächste Gegner; von dort aus zerfällt die Kuppel oder stieben die Splitter.
    const charges = this.player.shieldCharges;
    const absorbed = charges < this.shieldSeen;
    const attacker = absorbed ? this.enemies.nearest(origin.x, origin.z, 4) : null;
    const from = attacker ? Math.atan2(attacker.x - origin.x, attacker.z - origin.z) : undefined;
    this.effects.shield(charges > 0, origin.x, origin.z, from);
    if (absorbed && charges > 0) this.effects.shieldHit(origin.x, origin.z, from ?? 0);
    this.shieldSeen = charges;
    this.effects.showTraps(this.traps, this.trapper !== null && hasFlag(this.trapper.rules, 'splitter'));
    this.effects.showPods(this.pods);
    this.effects.lightSource(this.player.lightSource(lightAt), lightAt, dt);
    this.effects.update(dt, this.player.light, this.player.lightColor);
  }

  /** Kwests Esse: Die Glut einer Feuerschale versengt jeden Gegner in ihrem Lichtkreis. */
  sear(x: number, z: number, radius: number, amount: number): void {
    this.enemies.queryRadius(x, z, radius, (enemy) => {
      if (enemy.hp <= 0 || Math.hypot(enemy.x - x, enemy.z - z) > radius + enemy.type.radius) return;
      this.enemies.damage(enemy, amount, 0, 0, SEAR_SOURCE);
      this.effects.strike(enemy.x, bodyHeight(enemy.type.model, 0.5), enemy.z, 'brand');
    });
  }

  /** Lässt laufende Effekte ausklingen und die Lichtquelle weiterbrennen, wenn die Nacht vorbei ist. */
  animate(dt: number): void {
    this.effects.lightSource(this.player.lightSource(lightAt), lightAt, dt);
    this.effects.update(dt, this.player.light, this.player.lightColor);
  }

  private find(def: WeaponDef): OwnedWeapon | undefined {
    return this.owned.find((weapon) => weapon.def === def);
  }

  /**
   * Kurz bevor ein Angriff bereit ist, holt die Figur dafür aus,
   * damit der Treffer mit dem Schlag zusammenfällt und nicht vor ihm kommt.
   */
  private announce(weapon: OwnedWeapon, origin: Site): void {
    const swing = this.swings[weapon.def.id];
    if (!swing || weapon.windingUp) return;
    const seconds = weapon.cooldown / this.traits.haste;
    const lead = swing.lead * weapon.rules.lead;
    if (seconds > lead) return;
    const target = this.enemies.nearest(origin.x, origin.z, weapon.def.range * this.stats.reach * weapon.rules.range);
    if (!target) return;
    weapon.windingUp = true;
    if (weapon.rank === EVOLUTION_RANK && hasFlag(weapon.rules, 'spalter')) {
      this.evolutions.windupStart(origin.x, origin.z, Math.atan2(target.x - origin.x, target.z - origin.z), lead);
    }
    // Wuchthieb und Wirbelschlag schützen die Figur beim Ausholen; der Wirbel noch durch das Ausschwingen.
    if (weapon.rules.flags.length > 0 && hasFlag(weapon.rules, 'schutz')) {
      this.guard(weapon.def.kind === 'nova' ? KAEMPFER.whirlGuard : KAEMPFER.windupGuard, lead + (weapon.def.kind === 'nova' ? swing.recover : 0.1));
    }
    this.player.windUp(swing, Math.atan2(target.x - origin.x, target.z - origin.z), seconds);
  }

  /** Löst einen Angriff aus; gibt false zurück, wenn kein Ziel in Reichweite ist. */
  private fire(weapon: OwnedWeapon, origin: Site): boolean {
    const { def, rules } = weapon;
    const range = def.range * this.stats.reach * rules.range;

    if (def.kind === 'trap' || def.kind === 'pod') {
      this.lay(weapon, origin);
      audio.play(`angriff.${def.id}`, origin.x, origin.z);
      return true;
    }
    if (def.kind === 'aura') {
      this.glow(weapon, origin, this.auraRadius(weapon));
      audio.play(`angriff.${def.id}`, origin.x, origin.z);
      return true;
    }

    if (def.kind === 'field') return def.id === 'koederpuppe' ? this.plantDecoy(weapon, origin) : this.plantBanner(weapon, origin);

    const target = this.enemies.nearest(origin.x, origin.z, range);
    if (!target) return false;
    const angle = Math.atan2(target.x - origin.x, target.z - origin.z);
    const swing = this.swings[def.id];
    if (swing) this.player.strike(swing, angle);
    audio.play(`angriff.${def.id}`, origin.x, origin.z);

    switch (def.kind) {
      case 'arc':
        this.strikeArc(weapon, origin, angle, range, 1, true);
        break;
      case 'nova':
        // Mahlstrom aus Staub und Eisen: Statt der zwei Wirbel dreht sich die Figur mehrere Sekunden.
        if (rules.flags.length > 0 && hasFlag(rules, 'mahlstrom')) this.evolutions.vortex(weapon, origin.x, origin.z, angle);
        else this.strikeNova(weapon, origin, angle, range * rules.radius, 1, true);
        break;
      case 'projectile': {
        // Sturm der Klingen: Statt eines Wurfs kreisen sechs Äxte um die Figur und fliegen dann auf die stärksten Ziele.
        if (rules.flags.length > 0 && hasFlag(rules, 'sturm')) {
          this.evolutions.storm(weapon, origin.x, origin.z);
          break;
        }
        const count = rules.count;
        const options = this.projectileOptions(weapon);
        for (let i = 0; i < count; i++) {
          this.projectiles.spawn(
            origin.x,
            origin.z,
            angle + (i - (count - 1) / 2) * (def.spread ?? 0) * rules.spread,
            (def.speed ?? 15) * rules.speed,
            range,
            rules.pierce,
            def.shape ?? 'arrow',
            weapon,
            options,
          );
        }
        break;
      }
      case 'beam': {
        // Rang 5: zwei Lanzen kurz nacheinander, die erste ein wenig links, die zweite rechts der Mitte.
        const twice = rules.flags.length > 0 && hasFlag(rules, 'doppel');
        this.shoot(weapon, origin.x, origin.z, angle, range, twice ? -MAGIER.lanceOffset / 2 : 0);
        if (twice) this.later(weapon, MAGIER.lanceAgain, 'lanze', angle);
        break;
      }
      case 'volley': {
        const delay = def.delay ?? 0.5;
        this.volleys.push({ x: target.x, z: target.z, weapon, delay });
        // Ein Kreis kündigt den Einschlag an, dann kommen die Pfeile herab.
        this.effects.hailMark(target.x, target.z, this.area(weapon), delay, origin.x, origin.z, rules.count > 1 ? Math.round(rules.count * 1.4) + 2 : undefined);
        break;
      }
      case 'root':
        if (def.look === 'netz') this.net(weapon, target);
        else this.burst(weapon, target.x, target.z, this.area(weapon), def.maxTargets, this.entangle);
        break;
    }
    return true;
  }

  /**
   * Ein Hieb im Kegel. `factor` ist der Anteil am Schaden (der Rückhand-Hieb schlägt schwächer zu); `first` ist wahr beim
   * eigentlichen Hieb, der die Folgen des Rangs anstößt (Rückhand, sicherer Kritischer, Kette).
   */
  private strikeArc(weapon: OwnedWeapon, origin: Site, angle: number, range: number, factor: number, first: boolean): void {
    const { def, rules } = weapon;
    const width = rules.arc;
    const primed = weapon.primed;
    this.swept = 0;
    this.factor = factor;
    this.sweep(weapon, origin, angle, range, width);
    this.factor = 1;
    if (def.look === 'hitze') this.effects.heat(origin.x, origin.z, angle, range, width);
    else if (def.look === 'boee') this.effects.gustLane(origin.x, origin.z, angle, range, width);
    else this.effects.slash(origin.x, origin.z, angle, range, width, def.look === 'wucht');
    if (rules.flags.length === 0 && rules.statuses.length === 0) return;
    // Der Staub des Wuchthiebs ab Rang 3: Er blendet und betäubt, und man sieht ihn.
    if (first && statusSeconds(rules, 'blind') > 0) this.effects.cloud(origin.x + Math.sin(angle) * range * 0.7, origin.z + Math.cos(angle) * range * 0.7, range * 0.7);
    if (!first) return;
    if (primed) weapon.primed = false;
    if (hasFlag(rules, 'kette') && this.swept >= KAEMPFER.chainHits) {
      weapon.primed = true;
      weapon.refund = def.cooldown * this.stats.cooldown * rules.cooldown * KAEMPFER.chainRefund;
    }
    if (hasFlag(rules, 'rueckhand')) this.later(weapon, KAEMPFER.backhandDelay, 'rueckhand', angle);
    // Sturmböe: Schub nach jeder Böe, ab Rang 5 mit Staubspur; Hitze werfen, Rang 5: die Aschelinie am Ende des Kegels.
    if (hasFlag(rules, 'schub')) {
      this.support.progression.addBuff(BOOST);
      if (hasFlag(rules, 'spur')) {
        this.trailWeapon = weapon;
        this.trailTime = MAGIER.boostSeconds;
        this.trailGap = 0;
      }
    }
    if (hasFlag(rules, 'asche')) this.ashLine(weapon, origin, angle, range, width);
    // Evolutionen (Rang 6): Henkersbeil und Spalter von Ghen.
    if (hasFlag(rules, 'sichel')) this.evolutions.sickle(weapon, origin.x, origin.z, angle);
    if (hasFlag(rules, 'spalter')) this.evolutions.cleave(weapon, origin.x, origin.z, angle);
  }

  /** Eine Wirkung rundum (Wirbelschlag, Kriegsschrei, Erdstoß, Sturmböe) mit dem Radius `radius`. */
  private strikeNova(weapon: OwnedWeapon, origin: Site, angle: number, radius: number, factor: number, first: boolean): void {
    const { def, rules } = weapon;
    if (rules.flags.length > 0 && hasFlag(rules, 'donner')) {
      // Donner der Alten Ordnung: Der Schrei fährt als Kegel in Blickrichtung hinaus.
      this.factor = factor;
      this.sweep(weapon, origin, angle, radius, EVOLUTION.kaempfer.thunderArc);
      this.factor = 1;
      this.effects.evolution.thunder(origin.x, origin.z, angle, radius, EVOLUTION.kaempfer.thunderArc);
      if (first) audio.play('evolution.donner', origin.x, origin.z);
    } else if (rules.flags.length === 0) {
      this.burst(weapon, origin.x, origin.z, radius);
    } else {
      // Umzingelt (Wirbelschlag, Rang 5): Ab so vielen Gegnern im Kreis schlägt der Wirbel doppelt zu.
      const surrounded = hasFlag(rules, 'umzingelt') && this.countAround(origin.x, origin.z, radius) >= KAEMPFER.surround;
      this.factor = surrounded ? factor * KAEMPFER.surroundFactor : factor;
      this.burst(weapon, origin.x, origin.z, radius, Infinity, hasFlag(rules, 'abkuehlung') ? this.refund : undefined);
      this.factor = 1;
    }
    if (def.look === 'wirbel') this.effects.whirl(origin.x, origin.z, angle, radius);
    else if (def.look === 'schrei' && !hasFlag(rules, 'donner')) this.effects.shout(origin.x, origin.z, radius);
    else if (def.look === 'erdstoss') this.effects.quake(origin.x, origin.z, radius);
    if (!first || rules.flags.length === 0) return;
    if (hasFlag(rules, 'doppelt')) {
      this.later(weapon, KAEMPFER.whirlAgain, 'wirbel', angle);
      this.support.progression.addBuff(WHIRL_SPEED);
    }
    if (hasFlag(rules, 'vorteil')) {
      this.support.progression.addBuff(SHOUT_HASTE);
      this.support.progression.addBuff(SHOUT_CRIT);
    }
    if (hasFlag(rules, 'echo')) this.later(weapon, KAEMPFER.echoDelay, 'echo', angle);
    // Erdstoß: eine engere zweite Welle (Rang 4) und der Ring aus Erde am Rand (Rang 5).
    if (hasFlag(rules, 'welle')) this.later(weapon, MAGIER.waveDelay, 'welle', angle);
    if (hasFlag(rules, 'ring')) this.earthRing(weapon, origin, radius);
  }

  /** Jeder Getroffene des Wirbelschlags verkürzt die nächste Abklingzeit, insgesamt höchstens um einen Anteil. */
  private readonly refund = (_enemy: Enemy, weapon: OwnedWeapon): void => {
    const cap = weapon.def.cooldown * this.stats.cooldown * weapon.rules.cooldown * KAEMPFER.whirlRefundMax;
    weapon.refund = Math.min(weapon.refund + KAEMPFER.whirlRefund, cap);
  };

  private countAround(x: number, z: number, radius: number): number {
    let count = 0;
    this.enemies.queryRadius(x, z, radius, (enemy) => {
      if (enemy.hp > 0 && Math.hypot(enemy.x - x, enemy.z - z) <= radius + enemy.type.radius) count++;
    });
    return count;
  }

  /** Ein zeitweiliger Schutz: Die Figur erleidet für `seconds` nur `factor` des Schadens. */
  private guard(factor: number, seconds: number): void {
    GUARD.amount = factor;
    GUARD.seconds = seconds;
    this.support.progression.addBuff(GUARD);
  }

  // ---------------------------------------------------------------- Evolutionen

  /** Ein Angriff hat sich entwickelt: Licht steigt vom Boden auf, das Spiel meldet es. */
  private evolve(weapon: OwnedWeapon): void {
    const origin = this.player.position;
    this.effects.evolution.awaken(origin.x, origin.z);
    audio.play('evolution', origin.x, origin.z);
    this.onEvolve?.(weapon);
  }

  /** Spalter von Ghen, Ausholen: Der Staub zieht Gegner zum Einschlagpunkt vor der Figur. */
  private windup(weapon: OwnedWeapon, origin: Site, dt: number): void {
    const target = this.enemies.nearest(origin.x, origin.z, weapon.def.range * this.stats.reach * weapon.rules.range);
    if (!target) return;
    this.evolutions.windup(origin.x, origin.z, Math.atan2(target.x - origin.x, target.z - origin.z), dt);
  }

  // ------------------------------------------------------------ Folgen nach Verzögerung

  private later(weapon: OwnedWeapon, delay: number, kind: FollowUp['kind'], angle: number): void {
    for (const followUp of this.followUps) {
      if (followUp.active) continue;
      followUp.active = true;
      followUp.weapon = weapon;
      followUp.delay = delay;
      followUp.kind = kind;
      followUp.angle = angle;
      return;
    }
  }

  private updateFollowUps(dt: number): void {
    for (const followUp of this.followUps) {
      if (!followUp.active) continue;
      followUp.delay -= dt;
      if (followUp.delay > 0) continue;
      followUp.active = false;
      const { weapon } = followUp;
      // Wer in der Zwischenzeit ausgeschieden ist (neue Nacht), schlägt nicht mehr zu.
      if (!this.owned.includes(weapon)) continue;
      const origin = this.player.position;
      const { def, rules } = weapon;
      if (followUp.kind === 'rueckhand') {
        const range = def.range * this.stats.reach * rules.range;
        // Der Rückhand-Hieb richtet sich nach dem Gegner, der jetzt am nächsten steht.
        const target = this.enemies.nearest(origin.x, origin.z, range);
        const angle = target ? Math.atan2(target.x - origin.x, target.z - origin.z) : followUp.angle;
        const swing = this.swings[def.id];
        if (swing) this.player.strike(swing, angle);
        audio.play(`angriff.${def.id}`, origin.x, origin.z);
        this.strikeArc(weapon, origin, angle, range, KAEMPFER.backhandDamage, false);
      } else if (followUp.kind === 'lanze') {
        // Die zweite Lanze richtet sich nach dem Gegner, der jetzt am nächsten steht.
        const range = def.range * this.stats.reach * rules.range;
        const target = this.enemies.nearest(origin.x, origin.z, range);
        const angle = target ? Math.atan2(target.x - origin.x, target.z - origin.z) : followUp.angle;
        audio.play(`angriff.${def.id}`, origin.x, origin.z);
        this.shoot(weapon, origin.x, origin.z, angle, range, MAGIER.lanceOffset / 2);
      } else {
        const radius = def.range * this.stats.reach * rules.range * rules.radius;
        audio.play(`angriff.${def.id}`, origin.x, origin.z);
        if (followUp.kind === 'welle') this.wave(weapon, origin, radius * MAGIER.waveRadius);
        else this.strikeNova(weapon, origin, followUp.angle, radius, followUp.kind === 'echo' ? KAEMPFER.echoFactor : 1, false);
      }
    }
  }

  // --------------------------------------------------------------------- Banner

  /** Setzt ein Banner an die Stelle der Figur, wenn ein Gegner nah genug ist. */
  private plantBanner(weapon: OwnedWeapon, origin: Site): boolean {
    const { def, rules } = weapon;
    if (!this.enemies.nearest(origin.x, origin.z, def.range * this.stats.reach * rules.range)) return false;
    const radius = this.area(weapon);
    const field = this.bannerField(weapon);
    this.support.fields.spawn(field, origin.x, origin.z, {
      radius,
      // Schaden wie bei jedem Angriff: Rang, Stärkungen und Gegenstände zählen.
      scale: rules.damage * this.stats.damage * this.traits.dealt,
      source: weapon.source,
    });
    this.effects.banner(origin.x, origin.z, radius, field.duration);
    audio.play(`angriff.${def.id}`, origin.x, origin.z);
    return true;
  }

  /** Die Beschreibung des Banners für einen Rang; sie wird einmal angelegt und dann wiederverwendet. */
  private bannerField(weapon: OwnedWeapon): FieldDef {
    const { rules } = weapon;
    let field = this.bannerFields.get(rules);
    if (!field) {
      // Die Reliquie der Nimmersatten (Rang 6) schwebt dauerhaft über der Figur; sie zählt zusätzlich die Gegner im Umkreis.
      const relic = hasFlag(rules, 'reliquie');
      field = {
        id: relic ? 'reliquie' : weapon.def.id,
        shape: 'circle',
        duration: relic ? Infinity : hasFlag(rules, 'lang') ? 8 : 6,
        every: 0.5,
        instant: true,
        damage: weapon.def.damage,
        statuses: rules.statuses.length > 0 ? rules.statuses : undefined,
        onKill: hasFlag(rules, 'splitter') ? this.bannerKill : undefined,
        onTick: relic ? this.relicTick : hasFlag(rules, 'magnet') ? this.bannerPulse : undefined,
      };
      this.bannerFields.set(rules, field);
    }
    return field;
  }

  /** Jeder zehnte Gegner, der im Banner stirbt, lässt einen Lebenssplitter fallen. */
  private readonly bannerKill = (field: Field, enemy: Enemy): void => {
    if (field.kills % KAEMPFER.splinterEvery === 0) this.support.pickups.dropSplinter(enemy.x, enemy.z, KAEMPFER.splinterHeal);
  };

  /** Alle zwei Sekunden zieht das Banner Edelsteine in der Nähe zur Figur. */
  private readonly bannerPulse = (field: Field): void => {
    if (Math.round(field.age / field.def.every) % Math.round(KAEMPFER.bannerPulse / field.def.every) !== 0) return;
    this.support.pickups.attract(field.x, field.z, field.radius * KAEMPFER.bannerMagnet);
  };

  /** Reliquie der Nimmersatten: Das Banner zieht (wie jedes mit Rang 5) Edelsteine heran und gibt der Figur Tempo für jeden Gegner im Umkreis. */
  private readonly relicTick = (field: Field): void => {
    this.bannerPulse(field);
    this.evolutions.relicTick(field);
  };

  /** Hält die Reliquie am Leben: Sie liegt als Feld an der Figur und wird neu gesetzt, wenn der Vorrat der Felder sie verdrängt hat. */
  private keepRelic(weapon: OwnedWeapon, origin: Site): void {
    const { rules } = weapon;
    const def = this.bannerField(weapon);
    let field = this.relic;
    if (!field || !field.active || field.def !== def) {
      field = this.support.fields.spawn(def, origin.x, origin.z, { radius: this.area(weapon), follow: true, source: weapon.source });
      this.relic = field;
    }
    // Schaden, Größe und Stärkungen ändern sich im Lauf der Nacht; das Feld folgt ihnen.
    field.radius = this.area(weapon);
    field.scale = rules.damage * this.stats.damage * this.traits.dealt;
  }

  private bannerCount = 0;
  private decoyCount = 0;

  private readonly showField = (field: Field): void => {
    if (field.def.id === 'banner') {
      if (this.bannerCount >= BANNER_CAPACITY) return;
      const site = this.bannerSites[this.bannerCount++];
      if (site) {
        site.x = field.x;
        site.z = field.z;
      }
    } else if (field.def.id === 'reliquie') {
      this.relicSeen = field;
    } else if (field.def.id === 'koederpuppe') {
      if (this.decoyCount >= DECOY_CAPACITY) return;
      const site = this.decoySites[this.decoyCount++];
      if (site) {
        site.x = field.x;
        site.z = field.z;
      }
    }
  };

  /** Die Banner und Köderpuppen, die gerade stehen, für die Zeichnung. */
  private showFields(): void {
    this.bannerCount = 0;
    this.decoyCount = 0;
    this.relicSeen = null;
    this.support.fields.eachActive(this.showField);
    const relic = this.relicSeen as Field | null;
    this.effects.evolution.relic(relic !== null, relic?.x ?? 0, relic?.z ?? 0, relic?.radius ?? 0, EVOLUTION.kaempfer.relicLift, this.now);
    this.effects.showBanners(this.bannerSites, this.bannerCount);
    this.effects.showDecoys(this.decoySites, this.decoyCount);
  }

  // ---------------------------------------------------------------- Dornenschild

  /** Für `CombatEvents`: Wird die Figur getroffen, sticht das Dornenschild zurück. Das Spiel meldet ihn zu Beginn jeder Nacht an. */
  readonly listener: CombatListener = {
    hurt: (attacker, _taken, absorbed) => {
      this.sting(attacker);
      if (absorbed) this.shieldBroke();
    },
    kill: (enemy, source) => {
      this.trapKill(enemy);
      this.rootKill(enemy);
      if (this.primed) this.shieldKill(source);
    },
    hit: (enemy, _amount, source, dot) => {
      if (this.primed) this.shieldHit(enemy, source, dot);
    },
  };

  /** Ein Gegner trifft die Figur: Das Dornenschild sticht zurück. */
  private sting(attacker: Enemy | null): void {
    const weapon = this.thorns;
    if (!weapon || !attacker || attacker.hp <= 0) return;
    const { rules } = weapon;
    const origin = this.player.position;
    this.factor = hasFlag(rules, 'ramm') && this.facing(attacker) ? KAEMPFER.rammFactor : 1;
    this.hit(attacker, weapon, origin.x, origin.z);
    this.factor = 1;
    audio.play('angriff.dornenschild', attacker.x, attacker.z);
    weapon.counter++;
    if (hasFlag(rules, 'splitter') && weapon.counter % KAEMPFER.splitterEvery === 0) this.splinters(weapon, attacker);
  }

  /** Steht der Angreifer vor der Figur, und läuft sie auf ihn zu oder steht sie still? (Rammbock) */
  private facing(attacker: Enemy): boolean {
    const origin = this.player.position;
    const dx = attacker.x - origin.x;
    const dz = attacker.z - origin.z;
    const offset = Math.atan2(dx, dz) - this.player.facing;
    if (Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset))) > KAEMPFER.rammAngle) return false;
    const motion = this.player.motion;
    const speed = Math.hypot(motion.x, motion.z);
    if (speed < 0.5) return true;
    return motion.x * dx + motion.z * dz > 0;
  }

  /** Drei Eisensplitter fliegen in einem engen Kegel auf den Angreifer zu. */
  private splinters(weapon: OwnedWeapon, attacker: Enemy): void {
    const origin = this.player.position;
    const angle = Math.atan2(attacker.x - origin.x, attacker.z - origin.z);
    const count = KAEMPFER.splitterCount;
    for (let i = 0; i < count; i++) {
      this.projectiles.spawn(
        origin.x,
        origin.z,
        angle + (i - (count - 1) / 2) * KAEMPFER.splitterSpread,
        KAEMPFER.splitterSpeed,
        KAEMPFER.splitterReach,
        0,
        'knife',
        weapon,
      );
    }
  }

  // ------------------------------------------------------------------ Wildnisläufer

  /** Legt Fangeisen oder Pilzkapseln an die Stelle der Figur; mehrere liegen quer zur Blickrichtung nebeneinander. */
  private lay(weapon: OwnedWeapon, origin: Site): void {
    const { def, rules } = weapon;
    const pod = def.kind === 'pod';
    const list = pod ? this.pods : this.traps;
    const spacing = pod ? LAEUFER.sporeSpacing : LAEUFER.trapSpacing;
    const limit = pod ? LAEUFER.sporeMax : Math.min(def.maxActive ?? TRAP_CAPACITY, TRAP_CAPACITY);
    const facing = this.player.facing;
    for (let i = 0; i < rules.count; i++) {
      const side = (i - (rules.count - 1) / 2) * spacing;
      list.push({ x: origin.x + Math.cos(facing) * side, z: origin.z - Math.sin(facing) * side, weapon, delay: 0 });
      if (list.length > limit) list.shift();
    }
  }

  /** Fangeisen, Rang 5: Stirbt ein Gefangener im Eisen, schleudert die Falle Splitter auf die Gegner ringsum. */
  private trapKill(enemy: Enemy): void {
    const weapon = this.trapper;
    if (!weapon || this.splintering || weapon.rules.flags.length === 0 || !hasFlag(weapon.rules, 'splitter')) return;
    const held = enemy.status.hold;
    if (held.time <= 0 || held.source !== weapon.source) return;
    this.splintering = true;
    this.plain = true;
    this.factor = LAEUFER.trapSplinterDamage;
    this.burst(weapon, enemy.x, enemy.z, LAEUFER.trapSplinterRadius);
    this.factor = 1;
    this.plain = false;
    this.splintering = false;
    this.effects.trapSnap(enemy.x, enemy.z, LAEUFER.trapSplinterRadius);
    audio.play(`einschlag.${weapon.def.id}`, enemy.x, enemy.z);
  }

  // Der Schwerpunkt der Gruppe, der eine Salve folgt (Pfeilhagel, Rang 5).
  private sumX = 0;
  private sumZ = 0;
  private sumN = 0;
  private sumRadius = 0;
  private sumFromX = 0;
  private sumFromZ = 0;

  private readonly gather = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || Math.hypot(enemy.x - this.sumFromX, enemy.z - this.sumFromZ) > this.sumRadius + enemy.type.radius) return;
    this.sumX += enemy.x;
    this.sumZ += enemy.z;
    this.sumN++;
  };

  /** Pfeilhagel, Rang 5: Bis zum Einschlag ist die Gruppe weitergezogen; die Salve rückt ein Stück zu ihrer Mitte vor. */
  private follow(volley: Placed, radius: number): void {
    this.sumX = this.sumZ = this.sumN = 0;
    this.sumRadius = radius * 1.3;
    this.sumFromX = volley.x;
    this.sumFromZ = volley.z;
    this.enemies.queryRadius(volley.x, volley.z, this.sumRadius, this.gather);
    if (this.sumN === 0) return;
    const dx = this.sumX / this.sumN - volley.x;
    const dz = this.sumZ / this.sumN - volley.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return;
    const step = Math.min(distance, LAEUFER.hailFollow) / distance;
    volley.x += dx * step;
    volley.z += dz * step;
  }

  private impactWeapon: OwnedWeapon | null = null;
  private impactX = 0;
  private impactZ = 0;
  private impactRadius = 0;
  /** Bis zu diesem Abstand von der Mitte erleidet ein Gegner mehr Schaden; kleiner als 0: für niemanden. */
  private impactCenter = -1;

  private readonly impactEach = (enemy: Enemy): void => {
    const weapon = this.impactWeapon;
    if (!weapon || enemy.hp <= 0) return;
    const distance = Math.hypot(enemy.x - this.impactX, enemy.z - this.impactZ);
    if (distance > this.impactRadius + enemy.type.radius) return;
    this.factor = distance <= this.impactCenter ? LAEUFER.hailCenterFactor : 1;
    this.hit(enemy, weapon, this.impactX, this.impactZ);
    this.factor = 1;
  };

  /** Eine Salve schlägt ein: alle Gegner im Kreis; im Zentrum trifft sie härter (Rang 5). */
  private impact(weapon: OwnedWeapon, x: number, z: number, radius: number): void {
    this.impactWeapon = weapon;
    this.impactX = x;
    this.impactZ = z;
    this.impactRadius = radius;
    this.impactCenter = weapon.rules.flags.length > 0 && hasFlag(weapon.rules, 'mitte') ? radius * LAEUFER.hailCenter : -1;
    this.enemies.queryRadius(x, z, radius, this.impactEach);
  }

  // Das Netz: wohin es fällt und wie weit es reicht, für `netCatch`.
  private netX = 0;
  private netZ = 0;

  /** Das Netz fällt auf die nächste Gruppe. */
  private net(weapon: OwnedWeapon, target: Enemy): void {
    const radius = this.area(weapon);
    this.netX = target.x;
    this.netZ = target.z;
    this.burst(weapon, target.x, target.z, radius, Infinity, this.netCatch);
    this.effects.net(target.x, target.z, radius, 2.5);
  }

  /** Was das Netz mit jedem Gefangenen tut: zusammenziehen (Rang 3), Staub (Rang 5). */
  private readonly netCatch = (enemy: Enemy, weapon: OwnedWeapon): void => {
    const { rules } = weapon;
    if (rules.flags.length === 0) return;
    if (hasFlag(rules, 'zug') && !enemy.driven) {
      const dx = this.netX - enemy.x;
      const dz = this.netZ - enemy.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1e-3) {
        const step = Math.min(LAEUFER.netPull, distance * LAEUFER.netPullShare) / distance;
        enemy.x += dx * step;
        enemy.z += dz * step;
      }
    }
    if (hasFlag(rules, 'staub')) {
      applyStatus(enemy.status, 'silence', LAEUFER.netSilence, undefined, weapon.source);
      if (enemy.type.scale < BIG_GAME_SCALE) applyStatus(enemy.status, 'hold', LAEUFER.netHold, undefined, weapon.source);
    }
  };

  // ----------------------------------------------------------------- Sporenfalle

  private updatePods(): void {
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const pod = this.pods[i];
      if (!pod || !this.enemies.nearest(pod.x, pod.z, LAEUFER.sporeTrigger)) continue;
      this.pods.splice(i, 1);
      this.openPod(pod);
    }
  }

  /** Eine Kapsel platzt: Eine Wolke bleibt liegen. */
  private openPod(pod: Placed): void {
    const { weapon } = pod;
    const radius = this.area(weapon);
    const field = this.sporeField(weapon, false);
    this.support.fields.spawn(field, pod.x, pod.z, {
      radius,
      scale: weapon.rules.damage * this.stats.damage * this.traits.dealt,
      source: weapon.source,
    });
    this.effects.sporeCloud(pod.x, pod.z, radius, field.duration);
    audio.play(`einschlag.${weapon.def.id}`, pod.x, pod.z);
  }

  /** Die Beschreibung der Wolke (oder der kleinen Wolke eines Gestorbenen) für einen Rang; einmal angelegt und wiederverwendet. */
  private sporeField(weapon: OwnedWeapon, rest: boolean): FieldDef {
    const { def, rules } = weapon;
    const cache = rest ? this.restFields : this.sporeFields;
    let field = cache.get(rules);
    if (!field) {
      field = {
        id: rest ? REST_ID : def.id,
        shape: 'circle',
        duration: rest ? LAEUFER.sporeAgainSeconds : rules.duration,
        every: 0.5,
        instant: true,
        damage: def.damage,
        statuses: rules.statuses.length > 0 ? rules.statuses : undefined,
        onTick: this.sporeDrift,
        onKill: !rest && hasFlag(rules, 'platzen') ? this.sporeKill : undefined,
      };
      cache.set(rules, field);
    }
    return field;
  }

  private readonly sporeDrift = (field: Field): void => {
    this.effects.sporeDrift(field.x, field.z, field.radius);
  };

  private crowdX = 0;
  private crowdZ = 0;
  private crowded = false;

  private readonly nearRest = (field: Field): void => {
    if (field.def.id === REST_ID && Math.hypot(field.x - this.crowdX, field.z - this.crowdZ) < 1) this.crowded = true;
  };

  /** Sporenfalle, Rang 5: Wer in der Wolke stirbt, platzt auf und lässt eine kleine frische Wolke zurück. */
  private readonly sporeKill = (field: Field, enemy: Enemy): void => {
    const fields = this.support.fields;
    // Der Vorrat an Feldern ist begrenzt; Banner und Köderpuppe sollen nicht von Wolken verdrängt werden.
    if (fields.count >= LAEUFER.sporeAgainLimit) return;
    this.crowdX = enemy.x;
    this.crowdZ = enemy.z;
    this.crowded = false;
    fields.eachActive(this.nearRest);
    if (this.crowded) return;
    const weapon = this.owned.find((candidate) => candidate.source === field.source);
    if (!weapon) return;
    const radius = LAEUFER.sporeAgainRadius * this.stats.reach;
    const rest = this.sporeField(weapon, true);
    fields.spawn(rest, enemy.x, enemy.z, { radius, scale: field.scale, source: field.source });
    this.effects.sporeCloud(enemy.x, enemy.z, radius, rest.duration);
  };

  // ---------------------------------------------------------------- Köderpuppe

  /** Rammt die Köderpuppe an die Stelle der Figur, wenn ein Gegner nah genug ist. */
  private plantDecoy(weapon: OwnedWeapon, origin: Site): boolean {
    const { def, rules } = weapon;
    if (!this.enemies.nearest(origin.x, origin.z, def.range * this.stats.reach * rules.range)) return false;
    const radius = this.area(weapon);
    this.support.fields.spawn(this.decoyField(weapon), origin.x, origin.z, { radius, duration: rules.duration, source: weapon.source });
    this.effects.decoy(origin.x, origin.z, radius, rules.duration);
    audio.play(`angriff.${def.id}`, origin.x, origin.z);
    return true;
  }

  private decoyField(weapon: OwnedWeapon): FieldDef {
    const { def, rules } = weapon;
    let field = this.decoyFields.get(rules);
    if (!field) {
      field = {
        id: def.id,
        shape: 'circle',
        duration: rules.duration,
        every: 0.5,
        instant: true,
        statuses: rules.statuses.length > 0 ? rules.statuses : undefined,
        buffs: hasFlag(rules, 'schleier') ? [SHELTER] : undefined,
        onTick: hasFlag(rules, 'furcht') ? this.decoyTick : undefined,
        onEnd: hasFlag(rules, 'knall') ? this.decoyEnd : undefined,
      };
      this.decoyFields.set(rules, field);
    }
    return field;
  }

  private scared: Field | null = null;

  private readonly scare = (enemy: Enemy): void => {
    const field = this.scared;
    if (!field || enemy.hp <= 0 || enemy.type.scale >= BIG_GAME_SCALE) return;
    if (Math.hypot(enemy.x - field.x, enemy.z - field.z) > field.radius + enemy.type.radius) return;
    applyStatus(enemy.status, 'fear', LAEUFER.decoyFearSeconds, undefined, field.source);
  };

  /** Rang 3: Wer zu lange im Schatten der Puppe steht, fürchtet sich (Große nicht). */
  private readonly decoyTick = (field: Field): void => {
    if (field.age < LAEUFER.decoyFearAfter) return;
    this.scared = field;
    this.enemies.queryRadius(field.x, field.z, field.radius, this.scare);
  };

  /** Rang 5: Die Puppe löst sich auf, der gebundene Staub schleudert Gegner zurück. */
  private readonly decoyEnd = (field: Field): void => {
    const weapon = this.owned.find((candidate) => candidate.source === field.source);
    if (!weapon) return;
    const radius = field.radius * LAEUFER.decoyBlast;
    this.burst(weapon, field.x, field.z, radius);
    this.effects.blast(field.x, field.z, radius);
    audio.play(`einschlag.${weapon.def.id}`, field.x, field.z);
  };

  // ----------------------------------------------------------------------- Magier

  /**
   * Glut formen: Ein Schlag der Glut auf alle im Kreis. Rang 4 zählt, wie lange einer ohne Unterbrechung darin steht (und lässt ihn dann
   * brennen); Rang 5 macht jeden achten Schlag zum Puls: doppelter Schaden, kleine Nahkämpfer werden zum Rand gestoßen.
   */
  private glow(weapon: OwnedWeapon, origin: Site, radius: number): void {
    const { rules } = weapon;
    const pulse = rules.flags.length > 0 && hasFlag(rules, 'puls') && ++weapon.counter % MAGIER.pulseEvery === 0;
    this.glowX = origin.x;
    this.glowZ = origin.z;
    this.glowRadius = radius;
    this.pulsing = pulse;
    this.factor = pulse ? MAGIER.pulseFactor : 1;
    this.burst(weapon, origin.x, origin.z, radius, Infinity, rules.flags.length > 0 ? this.scorch : undefined);
    this.factor = 1;
    this.pulsing = false;
    this.effects.emberPulse(origin.x, origin.z, radius);
    if (pulse) this.effects.emberBurst(origin.x, origin.z, radius);
  }

  private readonly scorch = (enemy: Enemy, weapon: OwnedWeapon): void => {
    if (hasFlag(weapon.rules, 'entzuenden')) {
      // Wer zwischen zwei Schlägen nicht im Kreis war, beginnt von vorn.
      const gap = this.now - enemy.scorchAt;
      enemy.scorch = gap > MAGIER.scorchGap ? 0 : enemy.scorch + gap;
      enemy.scorchAt = this.now;
      if (enemy.scorch >= MAGIER.scorchAfter) applyStatus(enemy.status, 'burn', MAGIER.scorchSeconds, MAGIER.scorchPower, weapon.source);
    }
    if (!this.pulsing || enemy.driven || enemy.type.cast || enemy.type.scale >= BIG_GAME_SCALE) return;
    const dx = enemy.x - this.glowX;
    const dz = enemy.z - this.glowZ;
    const distance = Math.hypot(dx, dz);
    // Bis an den Rand, höchstens ein Stück weit; wer in der Mitte steht, wird in eine beliebige Richtung gestoßen.
    const meters = Math.min(Math.max(this.glowRadius - distance, 0), MAGIER.pulsePush);
    const along = distance > 1e-3 ? 1 / distance : 0;
    enemy.pushX += (distance > 1e-3 ? dx * along : 1) * meters * PUSH_PER_METER;
    enemy.pushZ += (distance > 1e-3 ? dz * along : 0) * meters * PUSH_PER_METER;
  };

  /** Eine Lanze der Sorlanze von (x, z), `side` Meter seitlich versetzt, mit ihrer Glutspur (Rang 4). */
  private shoot(weapon: OwnedWeapon, x: number, z: number, angle: number, range: number, side: number): void {
    const ox = x + Math.cos(angle) * side;
    const oz = z - Math.sin(angle) * side;
    this.lance(weapon, ox, oz, angle, range, weapon.def.width ?? 0.4);
    this.effects.lance(ox, oz, angle, range);
    if (weapon.rules.flags.length > 0 && hasFlag(weapon.rules, 'glutspur')) {
      this.lineDef ??= {
        id: 'sorlanze-spur',
        shape: 'line',
        duration: MAGIER.lineSeconds,
        every: 0.4,
        damage: weapon.def.damage * MAGIER.lineDamage,
        statuses: [{ kind: 'slow', seconds: MAGIER.lineSlowSeconds, power: MAGIER.lineSlow }],
      };
      this.support.fields.spawn(this.lineDef, ox, oz, {
        angle,
        length: range,
        width: MAGIER.lineWidth,
        scale: weapon.rules.damage * this.stats.damage * this.traits.dealt,
        source: weapon.source,
      });
      this.effects.glowLine(ox, oz, angle, range, MAGIER.lineWidth, MAGIER.lineSeconds, LINE_COLOR);
    }
  }

  /** Hitze werfen, Rang 5: Am Ende des Kegels bleibt eine Linie aus glühender Asche quer zur Richtung liegen. */
  private ashLine(weapon: OwnedWeapon, origin: Site, angle: number, range: number, width: number): void {
    const reach = range * 0.92;
    const half = Math.min(MAGIER.ashLength, 2 * reach * Math.tan(Math.min(width, 2.2) / 2)) / 2;
    const across = angle + Math.PI / 2;
    const x = origin.x + Math.sin(angle) * reach - Math.sin(across) * half;
    const z = origin.z + Math.cos(angle) * reach - Math.cos(across) * half;
    this.ashDef ??= {
      id: 'hitze-asche',
      shape: 'line',
      duration: MAGIER.ashSeconds,
      every: 0.5,
      damage: weapon.def.damage * MAGIER.ashDamage,
      statuses: [{ kind: 'burn', seconds: MAGIER.ashBurnSeconds, power: MAGIER.ashBurnPower }],
    };
    this.support.fields.spawn(this.ashDef, x, z, {
      angle: across,
      length: half * 2,
      width: MAGIER.ashWidth,
      scale: weapon.rules.damage * this.stats.damage * this.traits.dealt,
      source: weapon.source,
    });
    this.effects.glowLine(x, z, across, half * 2, MAGIER.ashWidth, MAGIER.ashSeconds, ASH_COLOR);
  }

  /** Erdstoß, Rang 4: Die engere zweite Welle trifft, wer dem ersten Stoß standgehalten hat, und betäubt ihn kurz. */
  private wave(weapon: OwnedWeapon, origin: Site, radius: number): void {
    this.factor = MAGIER.waveDamage;
    this.stun = true;
    this.burst(weapon, origin.x, origin.z, radius);
    this.factor = 1;
    this.stun = false;
    this.effects.quake(origin.x, origin.z, radius);
  }

  /** Erdstoß, Rang 5: Am Rand der Welle steht für kurze Zeit ein Ring aus Erde, der nachrückende Gegner bremst. */
  private earthRing(weapon: OwnedWeapon, origin: Site, radius: number): void {
    this.ringDef ??= {
      id: 'erdstoss-ring',
      shape: 'ring',
      duration: MAGIER.ringSeconds,
      every: 0.25,
      instant: true,
      statuses: [{ kind: 'slow', seconds: MAGIER.ringSlowSeconds, power: MAGIER.ringSlow }],
    };
    this.support.fields.spawn(this.ringDef, origin.x, origin.z, { radius, width: MAGIER.ringWidth, source: weapon.source });
    this.effects.earthRing(origin.x, origin.z, radius, MAGIER.ringWidth, MAGIER.ringSeconds);
  }

  /** Sturmböe, Rang 5: Solange der Schub währt, fällt hinter der Figur alle paar Atemzüge ein Feld Staub, das Verfolger bremst und schwächt. */
  private updateTrail(dt: number): void {
    const weapon = this.trailWeapon;
    if (!weapon || this.trailTime <= 0) return;
    this.trailTime -= dt;
    this.trailGap -= dt;
    if (this.trailGap > 0) return;
    this.trailGap = MAGIER.trailEvery;
    this.trailDef ??= {
      id: 'sturmboee-spur',
      shape: 'circle',
      duration: MAGIER.trailSeconds,
      every: 0.3,
      instant: true,
      statuses: [
        { kind: 'slow', seconds: MAGIER.trailEffectSeconds, power: MAGIER.trailSlow },
        { kind: 'feeble', seconds: MAGIER.trailEffectSeconds, power: MAGIER.trailFeeble },
      ],
    };
    const origin = this.player.position;
    const radius = MAGIER.trailRadius * this.stats.reach;
    this.support.fields.spawn(this.trailDef, origin.x, origin.z, { radius, source: weapon.source });
    this.effects.dustTrail(origin.x, origin.z, radius);
  }

  /** Wurzelgriff, Rang 5: Stirbt ein Gefesselter, schießt eine neue Wurzel zum nächsten freien Gegner in der Nähe. */
  private rootKill(enemy: Enemy): void {
    const weapon = this.rooter;
    if (!weapon || weapon.rules.flags.length === 0 || !hasFlag(weapon.rules, 'nachwuchs')) return;
    const held = enemy.status.hold;
    if (held.time <= 0 || held.source !== weapon.source) return;
    this.regrowX = enemy.x;
    this.regrowZ = enemy.z;
    this.regrowBest = null;
    this.regrowDistance = MAGIER.regrowRange;
    this.enemies.queryRadius(enemy.x, enemy.z, MAGIER.regrowRange, this.regrowPick);
    const target = this.regrowBest as Enemy | null;
    if (!target) return;
    applyStatus(target.status, 'hold', MAGIER.regrowSeconds, undefined, weapon.source);
    this.effects.entangle(target.x, target.z, target.type.radius, MAGIER.regrowSeconds);
  }

  private regrowX = 0;
  private regrowZ = 0;
  private regrowDistance = 0;
  private regrowBest: Enemy | null = null;

  private readonly regrowPick = (candidate: Enemy): void => {
    // Wer schon festsitzt oder vom Verschlinger geführt wird, kommt nicht in Frage.
    if (candidate.hp <= 0 || candidate.driven || candidate.status.hold.time > 0) return;
    const distance = Math.hypot(candidate.x - this.regrowX, candidate.z - this.regrowZ) - candidate.type.radius;
    if (distance >= this.regrowDistance) return;
    this.regrowDistance = distance;
    this.regrowBest = candidate;
  };

  /** Die Ladezeit des Schilds in Sekunden. */
  private shieldTime(weapon: OwnedWeapon): number {
    return weapon.def.cooldown * this.stats.cooldown * weapon.rules.cooldown;
  }

  /** Schild, Rang 4: Der letzte Schutz bricht unter einem Treffer, und der Impuls aus gebundenem Staub blendet und bremst Angreifer in der Nähe. */
  private shieldBroke(): void {
    const weapon = this.shielder;
    if (!weapon || this.player.shield || weapon.rules.flags.length === 0 || !hasFlag(weapon.rules, 'impuls')) return;
    const origin = this.player.position;
    this.enemies.queryRadius(origin.x, origin.z, MAGIER.pulseRadius, this.pulseEach);
    this.effects.dustPulse(origin.x, origin.z, MAGIER.pulseRadius);
  }

  private readonly pulseEach = (enemy: Enemy): void => {
    const weapon = this.shielder;
    if (!weapon || enemy.hp <= 0) return;
    const origin = this.player.position;
    if (Math.hypot(enemy.x - origin.x, enemy.z - origin.z) > MAGIER.pulseRadius + enemy.type.radius) return;
    applyStatus(enemy.status, 'blind', MAGIER.pulseBlindSeconds, MAGIER.pulseBlind, weapon.source);
    applyStatus(enemy.status, 'slow', MAGIER.pulseSlowSeconds, MAGIER.pulseSlow, weapon.source);
  };

  /** Schild, Rang 5: Jeder fünfte Tod durch einen Zauber verkürzt die Ladezeit. */
  private shieldKill(source: Source | null): void {
    if (!source || !SPELLS.has(source.id)) return;
    if (++this.primeKills < MAGIER.primeKills) return;
    this.primeKills = 0;
    this.primeShield();
  }

  /** Schild, Rang 5: Jeder zehnte Treffer eines Zaubers an einem Großen (Troll, Verschlinger) verkürzt die Ladezeit. */
  private shieldHit(enemy: Enemy, source: Source | null, dot: boolean): void {
    if (dot || !source || enemy.type.scale < BIG_GAME_SCALE || !SPELLS.has(source.id)) return;
    if (++this.primeHits < MAGIER.primeHits) return;
    this.primeHits = 0;
    this.primeShield();
  }

  /** Zieht einen Anteil von der Ladezeit ab, solange der Schild lädt. */
  private primeShield(): void {
    const weapon = this.shielder;
    if (!weapon || !this.shieldStarted || this.player.shield) return;
    this.shieldCharging -= this.shieldTime(weapon) * MAGIER.primeShare;
    const origin = this.player.position;
    this.effects.dustPulse(origin.x, origin.z, 1.2);
  }

  // ---------------------------------------------------------------------- Wurfaxt

  /** Was die Äxte können: stecken bleiben, eine Staubspur ziehen, zurückkehren. Je Rang einmal angelegt. */
  private projectileOptions(weapon: OwnedWeapon): ProjectileOptions | undefined {
    const { def, rules } = weapon;
    if (def.shape !== 'axe') return undefined;
    let options = this.options.get(rules);
    if (!options) {
      const returning = hasFlag(rules, 'kehrtwende');
      options = { stick: returning ? 0 : KAEMPFER.axeStick, boomerang: returning, fly: hasFlag(rules, 'staubspur'), returnSpeed: KAEMPFER.returnSpeed };
      this.options.set(rules, options);
    }
    return options;
  }

  /** Die Axt, deren Spur gerade Gegner besucht. */
  private trailOf: Projectile<OwnedWeapon> | null = null;

  /** Die Staubspur: Wer in der Nähe der Axt ist, wird für einen Augenblick langsamer. */
  private readonly trail = (projectile: Projectile<OwnedWeapon>): void => {
    this.trailOf = projectile;
    this.enemies.queryRadius(projectile.x, projectile.z, KAEMPFER.trailRadius, this.slowOnTrail);
  };

  private readonly slowOnTrail = (enemy: Enemy): void => {
    const axe = this.trailOf;
    if (!axe || enemy.hp <= 0 || Math.hypot(enemy.x - axe.x, enemy.z - axe.z) > KAEMPFER.trailRadius + enemy.type.radius) return;
    applyStatus(enemy.status, 'slow', KAEMPFER.trailSeconds, KAEMPFER.trailSlow, axe.payload.source);
  };

  private area(weapon: OwnedWeapon): number {
    return (weapon.def.radius ?? 2) * this.stats.reach * weapon.rules.radius;
  }

  private auraRadius(weapon: OwnedWeapon): number {
    return weapon.def.range * this.stats.reach * weapon.rules.radius;
  }

  /** Trifft alle Gegner in einem Kegel. */
  private sweep(weapon: OwnedWeapon, origin: Site, angle: number, range: number, width: number): void {
    this.enemies.queryRadius(origin.x, origin.z, range, (enemy) => {
      if (enemy.hp <= 0) return;
      const dx = enemy.x - origin.x;
      const dz = enemy.z - origin.z;
      const distance = Math.hypot(dx, dz);
      if (distance > range + enemy.type.radius) return;
      // Wer direkt an der Figur steht, wird immer getroffen; sonst zählt der Winkel.
      if (distance > 0.9) {
        const offset = Math.atan2(dx, dz) - angle;
        const wrapped = Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset)));
        // Der Körper des Gegners verbreitert den Winkel, unter dem er noch getroffen wird.
        if (wrapped > width / 2 + Math.asin(Math.min(1, enemy.type.radius / distance))) return;
      }
      this.hit(enemy, weapon, origin.x, origin.z);
    });
  }

  /** Trifft alle Gegner in einem Kreis, höchstens `maxTargets`; `each` erfährt von jedem Getroffenen. */
  private burst(
    weapon: OwnedWeapon,
    x: number,
    z: number,
    radius: number,
    maxTargets = Infinity,
    each?: (enemy: Enemy, weapon: OwnedWeapon) => void,
  ): void {
    let hits = 0;
    this.enemies.queryRadius(x, z, radius, (enemy) => {
      if (enemy.hp <= 0 || hits >= maxTargets) return;
      if (Math.hypot(enemy.x - x, enemy.z - z) > radius + enemy.type.radius) return;
      hits++;
      this.hit(enemy, weapon, x, z);
      each?.(enemy, weapon);
    });
  }

  /** Um jeden Festgehaltenen wachsen Wurzeln, so lange wie er festsitzt. */
  private readonly entangle = (enemy: Enemy, weapon: OwnedWeapon): void => {
    this.effects.entangle(enemy.x, enemy.z, enemy.type.radius, statusSeconds(weapon.rules, 'hold') || 2);
  };

  /**
   * Trifft Gegner auf einer geraden Linie von (x, z): alle, oder (Sorlanze, Rang 1) nur die ersten `pierce + 1`; dann erleidet jeder
   * weitere einen Teil weniger (`abfall`).
   */
  private lance(weapon: OwnedWeapon, x: number, z: number, angle: number, length: number, width: number): void {
    const directionX = Math.sin(angle);
    const directionZ = Math.cos(angle);
    const limit = weapon.rules.pierce + 1;
    const limited = limit <= BEAM_SLOTS;
    let count = 0;
    for (const enemy of this.enemies.alive) {
      if (enemy.hp <= 0) continue;
      const dx = enemy.x - x;
      const dz = enemy.z - z;
      const along = dx * directionX + dz * directionZ;
      if (along < 0 || along > length + enemy.type.radius) continue;
      const across = Math.abs(dx * directionZ - dz * directionX);
      if (across > width / 2 + enemy.type.radius) continue;
      if (!limited) {
        this.hit(enemy, weapon, x, z);
        continue;
      }
      // Die ersten `limit` Gegner entlang der Linie, nach Abstand geordnet.
      if (count < limit) count++;
      else if (along >= (this.beamAlong[limit - 1] ?? Infinity)) continue;
      let slot = count - 1;
      while (slot > 0 && (this.beamAlong[slot - 1] ?? 0) > along) {
        this.beamAlong[slot] = this.beamAlong[slot - 1] ?? 0;
        this.beamEnemy[slot] = this.beamEnemy[slot - 1] ?? null;
        slot--;
      }
      this.beamAlong[slot] = along;
      this.beamEnemy[slot] = enemy;
    }
    if (!limited) return;
    const falloff = weapon.rules.flags.length > 0 && hasFlag(weapon.rules, 'abfall');
    for (let i = 0; i < count; i++) {
      const enemy = this.beamEnemy[i];
      if (!enemy) continue;
      this.factor = falloff ? MAGIER.lanceFalloff ** i : 1;
      this.hit(enemy, weapon, x, z);
    }
    this.factor = 1;
  }

  /** Einziger Weg, auf dem ein Angriff Schaden und Wirkungen anbringt. */
  private hit(enemy: Enemy, weapon: OwnedWeapon, fromX: number, fromZ: number): void {
    const { def, rules } = weapon;
    this.swept++;
    let amount = def.damage * rules.damage * this.stats.damage * this.traits.dealt * this.factor;
    if (rules.flags.length > 0) {
      // Der Schrei verletzt nur schwache Gegner; wer auf einen Gegner zuläuft, trifft ihn härter (Axthieb).
      if (hasFlag(rules, 'schwache') && enemy.type.scale >= BIG_GAME_SCALE) amount = 0;
      else if (hasFlag(rules, 'zulaufen') && this.charging(enemy)) amount *= KAEMPFER.chargeBonus;
    }
    if (amount > 0) {
      // Gegen Markierte kommt Kritchance dazu (Vorteil); der Zufall wird in jedem Fall einmal gezogen.
      // Ein vorbereiteter Schlag (Wuchthieb, Rang 5) ist sicher kritisch.
      const roll = this.random();
      let chance = this.stats.critChance + markChance(enemy.status);
      if (rules.flags.length > 0) {
        if (hasFlag(rules, 'vorteil') && this.disadvantaged(enemy)) chance += LAEUFER.advantageCrit;
        // Sorlanze, Rang 5: Gegen Gegner im Nachteil oder in Flammen trifft sie sicher kritisch.
        else if (hasFlag(rules, 'treffsicher') && (enemy.status.weak.time > 0 || enemy.status.burn.time > 0)) chance = 1;
      }
      if (weapon.primed || roll < chance) amount *= this.stats.critDamage;
      amount *= takenFactor(enemy.status);
      // Donner der Alten Ordnung: Wen der Schrei getroffen hat, erleidet von den Nahkampfangriffen des Kämpfers mehr.
      if (enemy.thunderUntil > this.now && MELEE.has(def.id)) amount *= EVOLUTION.kaempfer.thunderFactor;
      if (this.traits.finsternisDamage !== 1 && this.zones.finsternisAt(enemy.x, enemy.z) > 0.5) {
        amount *= this.traits.finsternisDamage;
      }
      // Die Segen der Höheren Mächte.
      const { litDamage, bigGame, heldDamage } = this.stats;
      if (bigGame !== 1 && enemy.type.scale >= BIG_GAME_SCALE) amount *= bigGame;
      if (heldDamage !== 1 && enemy.status.hold.time > 0) amount *= heldDamage;
      if (litDamage !== 1) {
        const origin = this.player.position;
        if (Math.hypot(enemy.x - origin.x, enemy.z - origin.z) <= this.player.light) amount *= litDamage;
      }
      const kind = strikeKind(def);
      // Wurzelgriff, Rang 4: Im Griff der Wurzeln brennt das trockene Holz mit; Feuer und Licht schaden dort mehr.
      const rooter = this.rooter;
      if (rooter && (kind === 'brand' || kind === 'glut') && enemy.status.hold.time > 0 && enemy.status.hold.source === rooter.source && hasFlag(rooter.rules, 'trocken')) {
        amount *= MAGIER.dryFactor;
      }
      this.effects.strike(enemy.x, bodyHeight(enemy.type.model, 0.6), enemy.z, kind);
      audio.play(HIT_SOUNDS[kind], enemy.x, enemy.z);
    }

    let pushX = 0;
    let pushZ = 0;
    if (def.knockback && !this.pushless) {
      const dx = enemy.x - fromX;
      const dz = enemy.z - fromZ;
      // Große Gegner lassen sich schwerer zurückstoßen.
      const push = (def.knockback * rules.knockback) / enemy.type.scale / Math.max(Math.hypot(dx, dz), 0.1);
      pushX = dx * push;
      pushZ = dz * push;
    }
    this.enemies.damage(enemy, amount, pushX, pushZ, weapon.source);
    if (this.plain) return;
    for (const apply of rules.statuses) applyStatus(enemy.status, apply.kind, apply.seconds, apply.power, weapon.source);
    if (rules.flags.length > 0 && hasFlag(rules, 'donner')) enemy.thunderUntil = this.now + EVOLUTION.kaempfer.thunderSeconds;
    if (this.stun) applyStatus(enemy.status, 'hold', MAGIER.waveStun, undefined, weapon.source);
    // Sturmböe, Rang 3: Wen die Böe trifft und zaubert (der Priester), dessen Zauber zerstreut sie.
    if (enemy.type.cast && rules.flags.length > 0 && hasFlag(rules, 'zerstreuen')) applyStatus(enemy.status, 'silence', MAGIER.scatterSeconds, undefined, weapon.source);
  }

  /** Steht der Gegner im Nachteil, ist er verlangsamt oder blutet er? Dann treffen Pfeile und Messer mit Vorteil. */
  private disadvantaged(enemy: Enemy): boolean {
    const { status } = enemy;
    return status.weak.time > 0 || status.slow.time > 0 || status.bleed.time > 0;
  }

  /** Läuft die Figur auf den Gegner zu? Dann trifft der Axthieb ab Rang 2 härter. */
  private charging(enemy: Enemy): boolean {
    const motion = this.player.motion;
    const speed = Math.hypot(motion.x, motion.z);
    if (speed < KAEMPFER.chargeSpeed) return false;
    const origin = this.player.position;
    const dx = enemy.x - origin.x;
    const dz = enemy.z - origin.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return true;
    return (motion.x * dx + motion.z * dz) / (speed * distance) >= Math.cos(KAEMPFER.chargeAngle);
  }

  private readonly onProjectileHit = (enemy: Enemy, projectile: Projectile<OwnedWeapon>): void => {
    const weapon = projectile.payload;
    const { rules } = weapon;
    // Eisensplitter des Dornenschilds treffen schwächer als der Stich selbst.
    this.factor = weapon.def.kind === 'thorns' ? KAEMPFER.splitterDamage : 1;
    // Wer als Zweiter getroffen wird, erleidet weniger (Bogenschuss ab Rang 2, Wurfmesser auf Rang 5).
    const first = projectile.struck.length <= 1;
    if (!first && rules.flags.length > 0 && hasFlag(rules, 'abfall')) this.factor *= LAEUFER.pierceFalloff;
    // Der Rückstoß wirkt in Flugrichtung.
    this.hit(enemy, weapon, enemy.x - projectile.directionX, enemy.z - projectile.directionZ);
    this.factor = 1;
    if (first && rules.flags.length > 0 && hasFlag(rules, 'ruestung')) {
      applyStatus(enemy.status, 'weak', LAEUFER.armorSeconds, LAEUFER.armorFactor, weapon.source);
    }
  };

  private updateShield(dt: number, weapon: OwnedWeapon): void {
    if (this.player.shield) {
      this.shieldStarted = false;
      return;
    }
    // Erst nach dem letzten abgefangenen Treffer beginnt das Laden von vorn; dann ist der Schild wieder ganz da (ab Rang 3 zwei Ladungen).
    if (!this.shieldStarted) {
      this.shieldStarted = true;
      this.shieldCharging = this.shieldTime(weapon);
    }
    this.shieldCharging -= dt * this.traits.haste;
    if (this.shieldCharging <= 0) {
      this.shieldStarted = false;
      this.player.shieldCharges = weapon.rules.count;
      audio.play('schild.bereit', this.player.position.x, this.player.position.z);
    }
  }

  private updateVolleys(dt: number): void {
    for (let i = this.volleys.length - 1; i >= 0; i--) {
      const volley = this.volleys[i];
      if (!volley) continue;
      volley.delay -= dt;
      if (volley.delay > 0) continue;
      const radius = this.area(volley.weapon);
      if (volley.weapon.rules.flags.length > 0 && hasFlag(volley.weapon.rules, 'folgen')) this.follow(volley, radius);
      this.impact(volley.weapon, volley.x, volley.z, radius);
      this.effects.hailImpact(volley.x, volley.z, radius);
      audio.play(`einschlag.${volley.weapon.def.id}`, volley.x, volley.z);
      this.volleys.splice(i, 1);
    }
  }

  private updateTraps(): void {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      if (!trap) continue;
      const radius = this.area(trap.weapon);
      if (!this.enemies.nearest(trap.x, trap.z, radius)) continue;
      this.burst(trap.weapon, trap.x, trap.z, radius);
      this.effects.trapSnap(trap.x, trap.z, radius);
      audio.play(`einschlag.${trap.weapon.def.id}`, trap.x, trap.z);
      this.traps.splice(i, 1);
    }
  }
}
