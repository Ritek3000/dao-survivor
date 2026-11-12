import * as THREE from 'three';
import { audio, type SoundId } from '../audio';
import type { EnemyModel } from '../config';
import type { Random } from '../core/random';
import type { ClassDef } from './classes';
import { Effects, type StrikeKind } from './effects';
import type { Enemies, Enemy } from './enemies';
import type { Player } from './player';
import { Projectiles, type Projectile } from './projectiles';
import { BIG_GAME_SCALE, type Stats } from './progression';
import { COOLDOWN_PER_RANK, DAMAGE_PER_RANK, MAX_RANK, WEAK_FACTOR, weaponById, type WeaponDef } from './weapons';
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
  cooldown: number;
  /** Die Figur holt für diesen Angriff schon aus. */
  windingUp: boolean;
}

interface Placed extends Site {
  weapon: OwnedWeapon;
  /** Restzeit bis zum Einschlag; bei Fallen ungenutzt. */
  delay: number;
}

const TRAP_CAPACITY = 12;
const lightAt = new THREE.Vector3();

/** Woran ein Treffer des Angriffs zu erkennen ist. */
function strikeKind(def: WeaponDef): StrikeKind {
  if (def.kind === 'beam') return 'brand';
  if (def.kind === 'projectile' || def.kind === 'volley' || def.kind === 'trap') return 'stahl';
  return def.look === 'hieb' || def.look === 'wucht' || def.look === 'wirbel' ? 'stahl' : 'staub';
}

/** Der Ton zu jeder Trefferart; fest hinterlegt, weil Treffer das häufigste Ereignis im Kampf sind. */
const HIT_SOUNDS: Record<StrikeKind, SoundId> = { stahl: 'treffer.stahl', staub: 'treffer.staub', brand: 'treffer.brand' };

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

  constructor(
    private readonly stats: Stats,
    private readonly random: Random,
    private readonly enemies: Enemies,
    private readonly zones: Zones,
    private readonly player: Player,
  ) {
    this.group.add(this.projectiles.group, this.effects.group);
  }

  /** Neue Nacht: nur der Startangriff der Klasse. */
  reset(playerClass: ClassDef): void {
    this.available = playerClass.weapons.map(weaponById);
    this.swings = playerClass.swings;
    this.owned.length = 0;
    this.traps.length = 0;
    this.volleys.length = 0;
    this.shieldCharging = 0;
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
    if (weapon) weapon.rank++;
    else this.owned.push({ def, rank: 1, cooldown: 0, windingUp: false });
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
      if (weapon.def.kind === 'aura') aura = weapon;
      weapon.cooldown -= dt * traits.haste;
      if (weapon.cooldown > 0) {
        this.announce(weapon, origin);
        continue;
      }
      if (this.fire(weapon, origin)) {
        weapon.cooldown = weapon.def.cooldown * this.stats.cooldown * COOLDOWN_PER_RANK ** (weapon.rank - 1);
        weapon.windingUp = false;
      }
    }

    this.updateVolleys(dt);
    this.updateTraps();
    this.projectiles.update(dt, this.enemies, this.onProjectileHit);
    this.effects.embers(aura !== null, origin.x, origin.z, aura ? this.auraRadius(aura) : 0, time, dt);
    this.effects.shield(this.player.shield, origin.x, origin.z);
    this.effects.showTraps(this.traps);
    this.effects.lightSource(this.player.lightSource(lightAt), lightAt, dt);
    this.effects.update(dt, this.player.light, this.player.lightColor);
  }

  /** Kwests Esse: Die Glut einer Feuerschale versengt jeden Gegner in ihrem Lichtkreis. */
  sear(x: number, z: number, radius: number, amount: number): void {
    this.enemies.queryRadius(x, z, radius, (enemy) => {
      if (enemy.hp <= 0 || Math.hypot(enemy.x - x, enemy.z - z) > radius + enemy.type.radius) return;
      this.enemies.damage(enemy, amount, 0, 0);
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
    if (seconds > swing.lead) return;
    const target = this.enemies.nearest(origin.x, origin.z, weapon.def.range * this.stats.reach);
    if (!target) return;
    weapon.windingUp = true;
    this.player.windUp(swing, Math.atan2(target.x - origin.x, target.z - origin.z), seconds);
  }

  /** Löst einen Angriff aus; gibt false zurück, wenn kein Ziel in Reichweite ist. */
  private fire(weapon: OwnedWeapon, origin: Site): boolean {
    const { def, rank } = weapon;
    const range = def.range * this.stats.reach;

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

    const target = this.enemies.nearest(origin.x, origin.z, range);
    if (!target) return false;
    const angle = Math.atan2(target.x - origin.x, target.z - origin.z);
    const swing = this.swings[def.id];
    if (swing) this.player.strike(swing, angle);
    audio.play(`angriff.${def.id}`, origin.x, origin.z);

    switch (def.kind) {
      case 'arc': {
        const width = def.arc?.(rank) ?? Math.PI;
        this.sweep(weapon, origin, angle, range, width);
        if (def.look === 'hitze') this.effects.heat(origin.x, origin.z, angle, range, width);
        else this.effects.slash(origin.x, origin.z, angle, range, width, def.look === 'wucht');
        break;
      }
      case 'nova':
        this.burst(weapon, origin.x, origin.z, range);
        if (def.look === 'wirbel') this.effects.whirl(origin.x, origin.z, angle, range);
        else if (def.look === 'schrei') this.effects.shout(origin.x, origin.z, range);
        else if (def.look === 'erdstoss') this.effects.quake(origin.x, origin.z, range);
        else if (def.look === 'boee') this.effects.gust(origin.x, origin.z, range);
        else this.effects.flare(origin.x, origin.z, range);
        break;
      case 'projectile': {
        const count = def.count?.(rank) ?? 1;
        for (let i = 0; i < count; i++) {
          this.projectiles.spawn(
            origin.x,
            origin.z,
            angle + (i - (count - 1) / 2) * (def.spread ?? 0),
            def.speed ?? 15,
            range,
            def.pierce?.(rank) ?? 0,
            def.shape ?? 'arrow',
            weapon,
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
        this.effects.hailMark(target.x, target.z, this.area(def), delay, origin.x, origin.z);
        break;
      }
      case 'root':
        this.burst(weapon, target.x, target.z, this.area(def), def.maxTargets, this.entangle);
        break;
    }
    return true;
  }

  private area(def: WeaponDef): number {
    return (def.radius ?? 2) * this.stats.reach;
  }

  private auraRadius(weapon: OwnedWeapon): number {
    return weapon.def.range * this.stats.reach * (1 + 0.1 * (weapon.rank - 1));
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
    this.effects.entangle(enemy.x, enemy.z, enemy.type.radius, weapon.def.hold ?? 2);
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
    const { def } = weapon;
    let amount = def.damage * (1 + DAMAGE_PER_RANK * (weapon.rank - 1)) * this.stats.damage * this.traits.dealt;
    if (amount > 0) {
      if (this.random() < this.stats.critChance) amount *= 2;
      if (enemy.weak > 0) amount *= WEAK_FACTOR;
      if (this.traits.finsternisDamage !== 1 && this.zones.finsternisAt(enemy.x, enemy.z) > 0.5) {
        amount *= this.traits.finsternisDamage;
      }
      // Die Segen der Höheren Mächte.
      const { litDamage, bigGame, heldDamage } = this.stats;
      if (bigGame !== 1 && enemy.type.scale >= BIG_GAME_SCALE) amount *= bigGame;
      if (heldDamage !== 1 && enemy.hold > 0) amount *= heldDamage;
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
      const push = def.knockback / enemy.type.scale / Math.max(Math.hypot(dx, dz), 0.1);
      pushX = dx * push;
      pushZ = dz * push;
    }
    this.enemies.damage(enemy, amount, pushX, pushZ);
    if (def.hold) enemy.hold = Math.max(enemy.hold, def.hold);
    if (def.slow) enemy.slow = Math.max(enemy.slow, def.slow);
    if (def.weak) enemy.weak = Math.max(enemy.weak, def.weak);
  }

  private readonly onProjectileHit = (enemy: Enemy, projectile: Projectile<OwnedWeapon>): void => {
    // Der Rückstoß wirkt in Flugrichtung.
    this.hit(enemy, projectile.payload, enemy.x - projectile.directionX, enemy.z - projectile.directionZ);
  };

  private updateShield(dt: number, weapon: OwnedWeapon): void {
    if (this.player.shield) return;
    // Erst nach einem abgefangenen Treffer beginnt das Laden von vorn.
    if (this.shieldCharging <= 0) {
      this.shieldCharging = weapon.def.cooldown * this.stats.cooldown * COOLDOWN_PER_RANK ** (weapon.rank - 1);
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
      const radius = this.area(volley.weapon.def);
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
      const radius = this.area(trap.weapon.def);
      if (!this.enemies.nearest(trap.x, trap.z, radius)) continue;
      this.burst(trap.weapon, trap.x, trap.z, radius);
      this.effects.trapSnap(trap.x, trap.z, radius);
      audio.play(`einschlag.${trap.weapon.def.id}`, trap.x, trap.z);
      this.traps.splice(i, 1);
    }
  }
}
