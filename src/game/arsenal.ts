import * as THREE from 'three';
import { audio, type SoundId } from '../audio';
import { CONFIG, type EnemyModel } from '../config';
import type { Random } from '../core/random';
import type { BuffSpec } from './buffs';
import type { ClassDef } from './classes';
import { BANNER_CAPACITY, Effects, type StrikeKind } from './effects';
import type { Enemies, Enemy } from './enemies';
import { sourceOf, type CombatListener, type Source } from './events';
import type { Field, FieldDef, Fields } from './fields';
import type { Pickups } from './pickups';
import type { Player } from './player';
import { Projectiles, type Projectile, type ProjectileOptions } from './projectiles';
import { BIG_GAME_SCALE, type Progression, type Stats } from './progression';
import { applyStatus, markChance, takenFactor } from './status';
import { hasFlag, MAX_RANK, resolveRank, statusSeconds, weaponById, type ResolvedRank, type WeaponDef } from './weapons';
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
  /** Sekunden, die der Angriff beim nächsten Auslösen von seiner Abklingzeit abzieht (Wirbelschlag, Wuchthieb). */
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
  kind: 'rueckhand' | 'wirbel' | 'echo';
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
/** Die zeitweiligen Werte der Kämpfer-Fertigkeiten; `seconds` stellt der Aufrufer vor dem Setzen ein. */
const GUARD: BuffSpec = { id: 'schutz', stat: 'taken', mode: 'mul', amount: 1, seconds: 1 };
const WHIRL_SPEED: BuffSpec = { id: 'wirbelschlag-tempo', stat: 'speed', mode: 'mul', amount: KAEMPFER.whirlSpeed, seconds: KAEMPFER.whirlSpeedSeconds };
const SHOUT_HASTE: BuffSpec = { id: 'kriegsschrei-tempo', stat: 'cooldown', mode: 'mul', amount: KAEMPFER.shoutAdvantageCooldown, seconds: KAEMPFER.shoutAdvantageSeconds };
const SHOUT_CRIT: BuffSpec = { id: 'kriegsschrei-krit', stat: 'critChance', mode: 'add', amount: KAEMPFER.shoutAdvantageCrit, seconds: KAEMPFER.shoutAdvantageSeconds };
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
  private readonly volleys: Placed[] = [];
  private available: readonly WeaponDef[] = [];
  /** Die Bewegungen der Figur zu den Angriffen ihrer Klasse. */
  private swings: ClassDef['swings'] = {};
  private traits: CombatTraits = { dealt: 1, haste: 1, finsternisDamage: 1 };
  private shieldCharging = 0;
  private readonly followUps: FollowUp[] = [];
  /** Das Dornenschild der Figur, wenn sie eines hat. */
  private thorns: OwnedWeapon | null = null;
  /** Faktor auf den Schaden des nächsten Treffers; Aufrufer stellen ihn vor einem Schlag ein und danach zurück auf 1. */
  private factor = 1;
  /** Wie viele Gegner der laufende Schlag getroffen hat. */
  private swept = 0;
  private readonly options = new Map<ResolvedRank, ProjectileOptions>();
  private readonly bannerFields = new Map<ResolvedRank, FieldDef>();
  private readonly bannerSites: Site[] = [];
  /** Stand der Kuppel im letzten Bild: Daran erkennt man, dass sie gerade einen Treffer abgefangen hat. */
  private shieldWasUp = false;

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
  }

  /** Neue Nacht: nur der Startangriff der Klasse. */
  reset(playerClass: ClassDef): void {
    this.available = playerClass.weapons.map(weaponById);
    this.swings = playerClass.swings;
    this.owned.length = 0;
    this.traps.length = 0;
    this.volleys.length = 0;
    for (const followUp of this.followUps) followUp.active = false;
    this.thorns = null;
    this.factor = 1;
    this.shieldCharging = 0;
    this.shieldWasUp = false;
    this.player.shield = false;
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

  take(def: WeaponDef): void {
    const weapon = this.find(def);
    if (weapon) {
      weapon.rank++;
      weapon.rules = resolveRank(def, weapon.rank);
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
    }
  }

  update(dt: number, time: number, traits: CombatTraits): void {
    this.traits = traits;
    const origin = this.player.position;
    let aura: OwnedWeapon | null = null;

    for (const weapon of this.owned) {
      if (weapon.def.kind === 'shield') {
        this.updateShield(dt, weapon);
        continue;
      }
      // Das Dornenschild wirkt nur, wenn ein Gegner die Figur trifft (`hurt`).
      if (weapon.def.kind === 'thorns') continue;
      if (weapon.def.kind === 'aura') aura = weapon;
      weapon.cooldown -= dt * traits.haste;
      if (weapon.cooldown > 0) {
        this.announce(weapon, origin);
        continue;
      }
      if (this.fire(weapon, origin)) {
        weapon.cooldown = weapon.def.cooldown * this.stats.cooldown * weapon.rules.cooldown;
        weapon.windingUp = false;
        if (weapon.refund > 0) {
          weapon.cooldown = Math.max(0, weapon.cooldown - weapon.refund);
          weapon.refund = 0;
        }
      }
    }

    this.updateFollowUps(dt);
    this.updateVolleys(dt);
    this.updateTraps();
    this.projectiles.update(dt, this.enemies, this.onProjectileHit, origin, this.trail);
    this.showBanners();
    this.effects.embers(aura !== null, origin.x, origin.z, aura ? this.auraRadius(aura) : 0, time, dt);
    // Wer den Schild gebrochen hat, ist meist der nächste Gegner; von dort aus zerfällt die Kuppel.
    const broken = this.shieldWasUp && !this.player.shield;
    const attacker = broken ? this.enemies.nearest(origin.x, origin.z, 4) : null;
    this.effects.shield(this.player.shield, origin.x, origin.z, attacker ? Math.atan2(attacker.x - origin.x, attacker.z - origin.z) : undefined);
    this.shieldWasUp = this.player.shield;
    this.effects.showTraps(this.traps);
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

    if (def.kind === 'trap') {
      this.traps.push({ x: origin.x, z: origin.z, weapon, delay: 0 });
      if (this.traps.length > Math.min(def.maxActive ?? TRAP_CAPACITY, TRAP_CAPACITY)) this.traps.shift();
      audio.play(`angriff.${def.id}`, origin.x, origin.z);
      return true;
    }
    if (def.kind === 'aura') {
      const radius = this.auraRadius(weapon);
      this.burst(weapon, origin.x, origin.z, radius);
      this.effects.emberPulse(origin.x, origin.z, radius);
      audio.play(`angriff.${def.id}`, origin.x, origin.z);
      return true;
    }

    if (def.kind === 'field') return this.plantBanner(weapon, origin);

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
        this.strikeNova(weapon, origin, angle, range * rules.radius, 1, true);
        break;
      case 'projectile': {
        const count = rules.count;
        const options = this.projectileOptions(weapon);
        for (let i = 0; i < count; i++) {
          this.projectiles.spawn(
            origin.x,
            origin.z,
            angle + (i - (count - 1) / 2) * (def.spread ?? 0),
            def.speed ?? 15,
            range,
            rules.pierce,
            def.shape ?? 'arrow',
            weapon,
            options,
          );
        }
        break;
      }
      case 'beam':
        this.lance(weapon, origin, angle, range, def.width ?? 0.4);
        this.effects.lance(origin.x, origin.z, angle, range);
        break;
      case 'volley': {
        const delay = def.delay ?? 0.5;
        this.volleys.push({ x: target.x, z: target.z, weapon, delay });
        // Ein Kreis kündigt den Einschlag an, dann kommen die Pfeile herab.
        this.effects.hailMark(target.x, target.z, this.area(weapon), delay, origin.x, origin.z);
        break;
      }
      case 'root':
        this.burst(weapon, target.x, target.z, this.area(weapon), def.maxTargets, this.entangle);
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
  }

  /** Eine Wirkung rundum (Wirbelschlag, Kriegsschrei, Erdstoß, Sturmböe) mit dem Radius `radius`. */
  private strikeNova(weapon: OwnedWeapon, origin: Site, angle: number, radius: number, factor: number, first: boolean): void {
    const { def, rules } = weapon;
    if (rules.flags.length === 0) {
      this.burst(weapon, origin.x, origin.z, radius);
    } else {
      // Umzingelt (Wirbelschlag, Rang 5): Ab so vielen Gegnern im Kreis schlägt der Wirbel doppelt zu.
      const surrounded = hasFlag(rules, 'umzingelt') && this.countAround(origin.x, origin.z, radius) >= KAEMPFER.surround;
      this.factor = surrounded ? factor * KAEMPFER.surroundFactor : factor;
      this.burst(weapon, origin.x, origin.z, radius, Infinity, hasFlag(rules, 'abkuehlung') ? this.refund : undefined);
      this.factor = 1;
    }
    if (def.look === 'wirbel') this.effects.whirl(origin.x, origin.z, angle, radius);
    else if (def.look === 'schrei') this.effects.shout(origin.x, origin.z, radius);
    else if (def.look === 'erdstoss') this.effects.quake(origin.x, origin.z, radius);
    else if (def.look === 'boee') this.effects.gust(origin.x, origin.z, radius);
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
      } else {
        const radius = def.range * this.stats.reach * rules.range * rules.radius;
        audio.play(`angriff.${def.id}`, origin.x, origin.z);
        this.strikeNova(weapon, origin, followUp.angle, radius, followUp.kind === 'echo' ? KAEMPFER.echoFactor : 1, false);
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
      field = {
        id: weapon.def.id,
        shape: 'circle',
        duration: hasFlag(rules, 'lang') ? 8 : 6,
        every: 0.5,
        instant: true,
        damage: weapon.def.damage,
        statuses: rules.statuses.length > 0 ? rules.statuses : undefined,
        onKill: hasFlag(rules, 'splitter') ? this.bannerKill : undefined,
        onTick: hasFlag(rules, 'magnet') ? this.bannerPulse : undefined,
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

  private bannerCount = 0;

  private readonly showBanner = (field: Field): void => {
    if (field.def.id !== 'banner' || this.bannerCount >= BANNER_CAPACITY) return;
    const site = this.bannerSites[this.bannerCount++];
    if (!site) return;
    site.x = field.x;
    site.z = field.z;
  };

  /** Die Banner, die gerade stehen, für die Zeichnung. */
  private showBanners(): void {
    this.bannerCount = 0;
    this.support.fields.eachActive(this.showBanner);
    this.effects.showBanners(this.bannerSites, this.bannerCount);
  }

  // ---------------------------------------------------------------- Dornenschild

  /** Für `CombatEvents`: Wird die Figur getroffen, sticht das Dornenschild zurück. Das Spiel meldet ihn zu Beginn jeder Nacht an. */
  readonly listener: CombatListener = {
    hurt: (attacker) => this.sting(attacker),
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

  /** Trifft alle Gegner auf einer geraden Linie. */
  private lance(weapon: OwnedWeapon, origin: Site, angle: number, length: number, width: number): void {
    const directionX = Math.sin(angle);
    const directionZ = Math.cos(angle);
    for (const enemy of this.enemies.alive) {
      if (enemy.hp <= 0) continue;
      const dx = enemy.x - origin.x;
      const dz = enemy.z - origin.z;
      const along = dx * directionX + dz * directionZ;
      if (along < 0 || along > length + enemy.type.radius) continue;
      const across = Math.abs(dx * directionZ - dz * directionX);
      if (across <= width / 2 + enemy.type.radius) this.hit(enemy, weapon, origin.x, origin.z);
    }
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
      if (weapon.primed || roll < this.stats.critChance + markChance(enemy.status)) amount *= this.stats.critDamage;
      amount *= takenFactor(enemy.status);
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
      this.effects.strike(enemy.x, bodyHeight(enemy.type.model, 0.6), enemy.z, kind);
      audio.play(HIT_SOUNDS[kind], enemy.x, enemy.z);
    }

    let pushX = 0;
    let pushZ = 0;
    if (def.knockback) {
      const dx = enemy.x - fromX;
      const dz = enemy.z - fromZ;
      // Große Gegner lassen sich schwerer zurückstoßen.
      const push = (def.knockback * rules.knockback) / enemy.type.scale / Math.max(Math.hypot(dx, dz), 0.1);
      pushX = dx * push;
      pushZ = dz * push;
    }
    this.enemies.damage(enemy, amount, pushX, pushZ, weapon.source);
    for (const apply of rules.statuses) applyStatus(enemy.status, apply.kind, apply.seconds, apply.power, weapon.source);
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
    // Eisensplitter des Dornenschilds treffen schwächer als der Stich selbst.
    this.factor = projectile.payload.def.kind === 'thorns' ? KAEMPFER.splitterDamage : 1;
    // Der Rückstoß wirkt in Flugrichtung.
    this.hit(enemy, projectile.payload, enemy.x - projectile.directionX, enemy.z - projectile.directionZ);
    this.factor = 1;
  };

  private updateShield(dt: number, weapon: OwnedWeapon): void {
    if (this.player.shield) return;
    // Erst nach einem abgefangenen Treffer beginnt das Laden von vorn.
    if (this.shieldCharging <= 0) {
      this.shieldCharging = weapon.def.cooldown * this.stats.cooldown * weapon.rules.cooldown;
    }
    this.shieldCharging -= dt * this.traits.haste;
    if (this.shieldCharging <= 0) {
      this.player.shield = true;
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
      this.burst(volley.weapon, volley.x, volley.z, radius);
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
