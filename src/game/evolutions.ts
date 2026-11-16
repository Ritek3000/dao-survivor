/**
 * Die Evolutionen (Rang 6): Hat ein Angriff Rang 5 und schaltet ein angelegter legendärer Ring seine Evolution frei (`Arsenal.take`),
 * wird er zu Rang 6. Der Rang bringt keine neue Fertigkeit, sondern eine Wirkung obendrauf oder an Stelle der alten; die Zeile dazu
 * steht in `weapons.ts`, ihre Schalter heißen dort wie hier (`sichel`, `reliquie`, `sturm`, `mahlstrom`, `spalter`, `donner`, `bollwerk`).
 *
 * Dieser Teil hält, was dazu über mehrere Bilder läuft (kreisende Äxte, Mahlstrom, die Aura des Bollwerks) und rechnet die Wirkungen,
 * die sich nicht aus den Bausteinen des Arsenals ergeben. Er kennt vom Arsenal nur `EvolutionHost`: Wer trifft und wie hart, entscheidet
 * weiter allein `Arsenal.hit`, damit Kritische, Zustände, Segen und Gegenstände auch für die Evolutionen gelten.
 */
import { audio } from '../audio';
import { CONFIG } from '../config';
import type { OrbitSite } from './evolutionEffects';
import type { BuffSpec } from './buffs';
import type { CombatTraits, OwnedWeapon, ArsenalSupport } from './arsenal';
import type { Effects } from './effects';
import type { Enemies, Enemy } from './enemies';
import type { Field } from './fields';
import type { Player } from './player';
import type { Projectiles, ProjectileOptions } from './projectiles';
import { BIG_GAME_SCALE, type Stats } from './progression';
import { applyStatus } from './status';

const K = CONFIG.skills.evolution.kaempfer;

/** Wie ein Rückstoß mit Tempo v weit trägt: Er klingt mit exp(−8 t) ab (siehe `Enemies.update`), also v / 8 Meter. */
const PUSH_PER_METER = 8;

/** Die zeitweiligen Werte der Reliquie; `seconds` ist etwas länger als ein Takt, damit sie nicht flackern. */
const RELIC_HASTE: BuffSpec = { id: 'reliquie-tempo', stat: 'cooldown', mode: 'mul', amount: K.relicHaste, seconds: K.relicSeconds, maxStacks: K.relicStacks };
const RELIC_SPEED: BuffSpec = { id: 'reliquie-lauf', stat: 'speed', mode: 'mul', amount: K.relicSpeed, seconds: K.relicSeconds, maxStacks: K.relicStacks };
/** Im Mahlstrom nimmt die Figur weniger Schaden (wie im Wirbel des Wirbelschlags, Rang 5). */
const VORTEX_GUARD: BuffSpec = { id: 'mahlstrom-schutz', stat: 'taken', mode: 'mul', amount: CONFIG.skills.kaempfer.whirlGuard, seconds: 0.4 };

/** Was die Evolutionen vom Arsenal brauchen; es gibt es als Objekt an `Evolutions`, damit diese Datei dessen Innereien nicht kennt. */
export interface EvolutionHost {
  readonly stats: Stats;
  readonly enemies: Enemies;
  readonly player: Player;
  readonly support: ArsenalSupport;
  readonly effects: Effects;
  readonly projectiles: Projectiles<OwnedWeapon>;
  readonly traits: CombatTraits;
  /** Die Spielzeit des Bilds. */
  readonly now: number;
  /** Ein Treffer des Angriffs mit dem Faktor `factor` auf den Schaden (Rückstoß weg von (fromX, fromZ), mit `push` false ohne). */
  strike(enemy: Enemy, weapon: OwnedWeapon, fromX: number, fromZ: number, factor: number, push?: boolean): void;
  /** Reichweite des Angriffs in Metern (Reichweite des Angriffs, Gegenstände und Rang eingerechnet). */
  range(weapon: OwnedWeapon): number;
  /** Die Vorlage für die Geschosse des Angriffs (Wurfaxt). */
  projectileOptions(weapon: OwnedWeapon): ProjectileOptions | undefined;
  /** Die Figur macht die Bewegung des Angriffs noch einmal vor (Mahlstrom). */
  swing(weapon: OwnedWeapon, angle: number): void;
}

/** Eine der sechs Äxte des Sturms: ihre Stellung auf dem Kreis und ihr Platz in der Zeichnung. */
interface Axe extends OrbitSite {
  phase: number;
}

export class Evolutions {
  // Sichel und Spalt: eine Linie, die gerade trifft.
  private lineWeapon: OwnedWeapon | null = null;
  private lineX = 0;
  private lineZ = 0;
  private lineAngle = 0;
  private lineLength = 0;
  private lineWidth = 0;
  private lineFactor = 1;
  private lineMode: 'sichel' | 'spalt' = 'sichel';

  // Sturm der Klingen
  private stormWeapon: OwnedWeapon | null = null;
  private stormTime = 0;
  private stormTick = 0;
  private stormSpin = 0;
  private stormCount = 0;
  private readonly axes: Axe[] = Array.from({ length: 6 }, () => ({ x: 0, z: 0, angle: 0, phase: 0 }));
  private readonly picks: (Enemy | null)[] = [null, null, null, null, null, null];
  private readonly pickHp: number[] = [0, 0, 0, 0, 0, 0];
  private pickCount = 0;
  private pickX = 0;
  private pickZ = 0;
  private pickRange = 0;

  // Mahlstrom
  private vortexWeapon: OwnedWeapon | null = null;
  private vortexTime = 0;
  private vortexTick = 0;
  private vortexSwing = 0;
  private vortexRadius = 0;
  private vortexPhase = 0;
  private vortexMode: 'zug' | 'schlag' | 'stoss' = 'zug';
  private vortexDt = 0;

  // Spalter: Wohin der Staub beim Ausholen zieht.
  private pullX = 0;
  private pullZ = 0;
  private pullStep = 0;

  // Reliquie
  private relicSeen = 0;
  private relicMotes = 0;

  // Bollwerk
  private bulwarkWeapon: OwnedWeapon | null = null;
  private bulwarkIn = 0;
  private bulwarkShown = false;
  private bulwarkX = 0;
  private bulwarkZ = 0;
  private bulwarkAngle = 0;

  /** Die Zeit, die die Zeichnung der Evolutionen für ihre Bewegungen braucht. */
  private clock = 0;

  constructor(private readonly host: EvolutionHost) {}

  /** Neue Nacht: Was lief, ist vorbei, ohne dass sein Ende wirkt. */
  reset(): void {
    this.stormWeapon = null;
    this.stormTime = 0;
    this.vortexWeapon = null;
    this.vortexTime = 0;
    this.bulwarkWeapon = null;
    this.bulwarkShown = false;
    this.relicSeen = 0;
    this.lineWeapon = null;
  }

  // ------------------------------------------------------------ Henkersbeil

  /** Axthieb: Jeder vierte Hieb entlädt eine schwere Staub-Sichel, die durch die ganze Horde schneidet und Geschwächte hinrichtet. */
  sickle(weapon: OwnedWeapon, x: number, z: number, angle: number): void {
    if (++weapon.counter % K.sickleEvery !== 0) return;
    const { host } = this;
    const length = K.sickleLength * host.stats.reach;
    this.line(weapon, x, z, angle, length, K.sickleWidth, K.sickleDamage, 'sichel');
    host.effects.evolution.sickle(x, z, angle, length, K.sickleWidth);
    audio.play('evolution.sichel', x, z);
  }

  /** Geschwächt ist, wer im Nachteil ist oder schwach (Axthieb, Rang 5; Kriegsschrei, Rang 4). */
  private weakened(enemy: Enemy): boolean {
    return enemy.status.weak.time > 0 || enemy.status.feeble.time > 0;
  }

  // ------------------------------------------------------------------ Spalter

  /** Wuchthieb: Der Niederschlag spaltet den Boden in einer langen Linie, zerquetscht alles darin und betäubt die Kleinen. */
  cleave(weapon: OwnedWeapon, x: number, z: number, angle: number): void {
    const length = K.cleaveLength * this.host.stats.reach;
    this.line(weapon, x, z, angle, length, K.cleaveWidth, K.cleaveDamage, 'spalt');
    this.host.effects.evolution.cleave(x, z, angle, length, K.cleaveWidth);
    audio.play('evolution.spalter', x, z);
  }

  /** Der Mittelpunkt, zu dem der Staub beim Ausholen zieht: ein Stück vor der Figur, in Richtung des Ziels. */
  windupStart(x: number, z: number, angle: number, seconds: number): void {
    this.host.effects.evolution.cleaveMark(x + Math.sin(angle) * K.cleaveImpact, z + Math.cos(angle) * K.cleaveImpact, K.cleaveReach, seconds);
  }

  /** Während des Ausholens zieht der Staub nahe Gegner leicht zum Einschlagpunkt. */
  windup(x: number, z: number, angle: number, dt: number): void {
    const { host } = this;
    this.pullX = x + Math.sin(angle) * K.cleaveImpact;
    this.pullZ = z + Math.cos(angle) * K.cleaveImpact;
    this.pullStep = K.cleavePull * dt;
    host.enemies.queryRadius(this.pullX, this.pullZ, K.cleaveReach, this.pullEach);
    host.effects.evolution.suck(this.pullX, this.pullZ, K.cleaveReach, dt);
  }

  private readonly pullEach = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || enemy.driven) return;
    const dx = this.pullX - enemy.x;
    const dz = this.pullZ - enemy.z;
    const distance = Math.hypot(dx, dz);
    if (distance > K.cleaveReach + enemy.type.radius || distance < 0.4) return;
    // Große lassen sich schwerer ziehen.
    const step = Math.min(distance, this.pullStep / enemy.type.scale) / distance;
    enemy.x += dx * step;
    enemy.z += dz * step;
  };

  // ------------------------------------------------------- Linie (Sichel, Spalt)

  private line(weapon: OwnedWeapon, x: number, z: number, angle: number, length: number, width: number, factor: number, mode: 'sichel' | 'spalt'): void {
    this.lineWeapon = weapon;
    this.lineX = x;
    this.lineZ = z;
    this.lineAngle = angle;
    this.lineLength = length;
    this.lineWidth = width;
    this.lineFactor = factor;
    this.lineMode = mode;
    const half = length / 2;
    this.host.enemies.queryRadius(x + Math.sin(angle) * half, z + Math.cos(angle) * half, Math.hypot(half, width / 2), this.lineEach);
  }

  private readonly lineEach = (enemy: Enemy): void => {
    const weapon = this.lineWeapon;
    if (!weapon || enemy.hp <= 0) return;
    const dx = enemy.x - this.lineX;
    const dz = enemy.z - this.lineZ;
    const directionX = Math.sin(this.lineAngle);
    const directionZ = Math.cos(this.lineAngle);
    const along = dx * directionX + dz * directionZ;
    const across = Math.abs(dx * directionZ - dz * directionX);
    const margin = enemy.type.radius;
    if (along < -margin || along > this.lineLength + margin || across > this.lineWidth / 2 + margin) return;
    const { host } = this;
    host.strike(enemy, weapon, this.lineX, this.lineZ, this.lineFactor);
    if (enemy.hp <= 0) return;
    if (this.lineMode === 'sichel') {
      // Hinrichtung: Wer geschwächt ist und fast nichts mehr hat, fällt sofort. Der Hieb der Sichel schwächt selbst (Rang 5 setzt
      // Nachteil), geprüft wird nach dem Treffer: In der Linie fällt also jeder unter 25 %. Der Verschlinger wird geführt und nicht hingerichtet.
      if (!enemy.driven && this.weakened(enemy) && enemy.hp <= enemy.maxHp * K.sickleExecute) {
        host.enemies.damage(enemy, enemy.hp, 0, 0, weapon.source);
        host.effects.strike(enemy.x, 0.9, enemy.z, 'stahl');
      }
    } else if (enemy.type.scale < BIG_GAME_SCALE && !enemy.driven) {
      applyStatus(enemy.status, 'hold', K.cleaveStun, undefined, weapon.source);
    }
  };

  // ------------------------------------------------------------------ Reliquie

  /**
   * Jeder Takt des schwebenden Banners: Wer im Umkreis steht, gibt der Figur einen Stapel Tempo (bis zum Höchstwert), und ein paar
   * Funken Lebenskraft fliegen zum Banner.
   */
  relicTick(field: Field): void {
    const { host } = this;
    this.relicSeen = 0;
    this.relicMotes = 0;
    this.pullX = field.x;
    this.pullZ = field.z;
    this.vortexRadius = field.radius;
    host.enemies.queryRadius(field.x, field.z, field.radius, this.relicEach);
    if (this.relicSeen === 0) return;
    host.support.progression.setBuff(RELIC_HASTE, this.relicSeen);
    host.support.progression.setBuff(RELIC_SPEED, this.relicSeen);
  }

  private readonly relicEach = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || this.relicSeen >= K.relicStacks) return;
    if (Math.hypot(enemy.x - this.pullX, enemy.z - this.pullZ) > this.vortexRadius + enemy.type.radius) return;
    this.relicSeen++;
    if (this.relicMotes++ < 5) this.host.effects.evolution.drain(enemy.x, enemy.z, this.pullX, this.pullZ, K.relicLift);
  };

  // ------------------------------------------------------------ Sturm der Klingen

  /** Wurfaxt: Sechs Äxte steigen aus dem Staub und kreisen kurz um die Figur, ehe sie fliegen. */
  storm(weapon: OwnedWeapon, x: number, z: number): void {
    if (this.stormTime > 0) return;
    this.stormWeapon = weapon;
    this.stormTime = K.stormSeconds;
    this.stormTick = 0;
    this.stormSpin = 0;
    this.stormCount = Math.min(weapon.rules.count, this.axes.length);
    for (let i = 0; i < this.stormCount; i++) {
      const axe = this.axes[i];
      if (axe) axe.phase = (i / this.stormCount) * Math.PI * 2;
    }
    this.host.effects.evolution.stormRing(x, z, K.stormRadius, K.stormSeconds);
    audio.play('evolution.sturm', x, z);
  }

  private updateStorm(dt: number): void {
    const weapon = this.stormWeapon;
    if (!weapon || this.stormTime <= 0) return;
    const { host } = this;
    const origin = host.player.position;
    this.stormTime -= dt;
    this.stormSpin += K.stormSpin * dt;
    // Die Äxte wachsen aus dem Boden auf ihre Bahn und ziehen ihre Kreise enger, kurz bevor sie fliegen.
    const grown = Math.min(1, (K.stormSeconds - this.stormTime) / 0.25);
    const radius = K.stormRadius * (0.3 + 0.7 * grown);
    for (let i = 0; i < this.stormCount; i++) {
      const axe = this.axes[i];
      if (!axe) continue;
      const a = axe.phase + this.stormSpin;
      axe.x = origin.x + Math.sin(a) * radius;
      axe.z = origin.z + Math.cos(a) * radius;
      axe.angle = a + Math.PI / 2;
    }
    this.stormTick -= dt;
    if (this.stormTick <= 0) {
      this.stormTick = K.stormEvery;
      this.pullX = origin.x;
      this.pullZ = origin.z;
      for (let i = 0; i < this.stormCount; i++) {
        this.touching = this.axes[i] ?? null;
        if (this.touching) host.enemies.queryRadius(this.touching.x, this.touching.z, 0.9, this.touchEach);
      }
    }
    host.effects.evolution.showOrbit(this.axes, this.stormCount, this.clock);
    if (this.stormTime <= 0) this.launch(weapon, origin.x, origin.z);
  }

  /** Die Axt, deren Berührung gerade die Gegner in ihrer Nähe prüft. */
  private touching: Axe | null = null;

  private readonly touchEach = (enemy: Enemy): void => {
    const axe = this.touching;
    const weapon = this.stormWeapon;
    if (!axe || !weapon || enemy.hp <= 0 || Math.hypot(enemy.x - axe.x, enemy.z - axe.z) > 0.55 + enemy.type.radius) return;
    this.host.strike(enemy, weapon, this.pullX, this.pullZ, K.stormTouch);
  };

  /** Die Äxte fliegen auf die stärksten Ziele in Sichtweite, übrige in die Richtung, in der sie gerade kreisen. */
  private launch(weapon: OwnedWeapon, x: number, z: number): void {
    const { host } = this;
    const { def, rules } = weapon;
    this.pickCount = 0;
    this.pickX = x;
    this.pickZ = z;
    this.pickRange = host.range(weapon) * K.stormSight;
    this.picks.fill(null);
    host.enemies.queryRadius(x, z, this.pickRange, this.pickEach);
    const options = host.projectileOptions(weapon);
    const reach = host.range(weapon);
    for (let i = 0; i < this.stormCount; i++) {
      const axe = this.axes[i];
      if (!axe) continue;
      const target = this.picks[i % Math.max(1, this.pickCount)];
      const outward = Math.atan2(axe.x - x, axe.z - z);
      const angle = target && this.pickCount > 0 ? Math.atan2(target.x - axe.x, target.z - axe.z) : outward;
      host.projectiles.spawn(axe.x, axe.z, angle, (def.speed ?? 15) * rules.speed, reach, rules.pierce, def.shape ?? 'axe', weapon, options);
    }
    host.effects.evolution.showOrbit(this.axes, 0, this.clock);
    host.effects.evolution.stormLaunch(x, z, K.stormRadius);
    audio.play('angriff.wurfaxt', x, z);
  }

  /** Merkt sich die stärksten (die mit dem meisten Leben) Gegner in Sichtweite, geordnet. */
  private readonly pickEach = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || Math.hypot(enemy.x - this.pickX, enemy.z - this.pickZ) > this.pickRange + enemy.type.radius) return;
    const slots = this.stormCount;
    let slot = this.pickCount < slots ? this.pickCount : slots - 1;
    if (this.pickCount >= slots && enemy.hp <= (this.pickHp[slot] ?? 0)) return;
    if (this.pickCount < slots) this.pickCount++;
    while (slot > 0 && (this.pickHp[slot - 1] ?? 0) < enemy.hp) {
      this.pickHp[slot] = this.pickHp[slot - 1] ?? 0;
      this.picks[slot] = this.picks[slot - 1] ?? null;
      slot--;
    }
    this.pickHp[slot] = enemy.hp;
    this.picks[slot] = enemy;
  };

  // ---------------------------------------------------------------- Mahlstrom

  /** Wirbelschlag: Die Figur dreht sich mehrere Sekunden und läuft dabei frei; ein Tornado zieht, zerschneidet und schleudert am Ende. */
  vortex(weapon: OwnedWeapon, x: number, z: number, angle: number): void {
    if (this.vortexTime > 0) return;
    this.vortexWeapon = weapon;
    this.vortexTime = K.vortexSeconds;
    this.vortexTick = 0;
    this.vortexSwing = 0;
    this.vortexPhase = angle;
    // Die Abklingzeit beginnt erst, wenn der Wirbel endet: Der Mahlstrom ist kein Dauerzustand.
    weapon.refund -= K.vortexSeconds;
    audio.play('evolution.mahlstrom', x, z);
  }

  private updateVortex(dt: number): void {
    const weapon = this.vortexWeapon;
    const { host } = this;
    if (!weapon || this.vortexTime <= 0) {
      host.effects.evolution.vortex(false, 0, 0, 0, this.clock, dt);
      return;
    }
    const origin = host.player.position;
    this.vortexRadius = host.range(weapon) * weapon.rules.radius * K.vortexRadius;
    this.vortexTime -= dt;
    // Schutz wie im Wirbel; er wird in jedem Bild erneuert und endet kurz nach dem Mahlstrom.
    host.support.progression.addBuff(VORTEX_GUARD);
    // Der Zug: in jedem Bild ein Stück zur Figur.
    this.vortexMode = 'zug';
    this.vortexDt = dt;
    host.enemies.queryRadius(origin.x, origin.z, this.vortexRadius, this.vortexEach);
    // Der Schnitt: in jedem Takt ein Treffer an allen im Tornado.
    this.vortexTick -= dt;
    if (this.vortexTick <= 0) {
      this.vortexTick = K.vortexEvery;
      this.vortexMode = 'schlag';
      host.enemies.queryRadius(origin.x, origin.z, this.vortexRadius, this.vortexEach);
    }
    // Die Figur dreht sich weiter: alle gut halbe Sekunden holt sie noch einmal aus.
    this.vortexSwing -= dt;
    if (this.vortexSwing <= 0) {
      this.vortexSwing = 0.55;
      this.vortexPhase += 2.4;
      host.swing(weapon, this.vortexPhase);
    }
    host.effects.evolution.vortex(true, origin.x, origin.z, this.vortexRadius, this.clock, dt);
    if (this.vortexTime <= 0) this.blast(weapon, origin.x, origin.z);
  }

  private readonly vortexEach = (enemy: Enemy): void => {
    const weapon = this.vortexWeapon;
    if (!weapon || enemy.hp <= 0) return;
    const origin = this.host.player.position;
    const dx = origin.x - enemy.x;
    const dz = origin.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const radius = this.vortexMode === 'stoss' ? this.vortexRadius * K.vortexBlastRadius : this.vortexRadius;
    if (distance > radius + enemy.type.radius) return;
    if (this.vortexMode === 'zug') {
      if (enemy.driven || distance < 0.8) return;
      const step = Math.min(distance - 0.8, (K.vortexPull * this.vortexDt) / enemy.type.scale) / distance;
      enemy.x += dx * step;
      enemy.z += dz * step;
      return;
    }
    if (this.vortexMode === 'schlag') {
      this.host.strike(enemy, weapon, origin.x, origin.z, K.vortexDamage, false);
      return;
    }
    this.host.strike(enemy, weapon, origin.x, origin.z, K.vortexBlastDamage, false);
    // Die Druckwelle schleudert nach außen; Große und der Verschlinger bleiben stehen.
    if (enemy.driven || enemy.type.scale >= BIG_GAME_SCALE) return;
    const out = distance > 1e-3 ? -1 / distance : 0;
    enemy.pushX += (distance > 1e-3 ? dx * out : 1) * K.vortexBlastPush * PUSH_PER_METER;
    enemy.pushZ += (distance > 1e-3 ? dz * out : 0) * K.vortexBlastPush * PUSH_PER_METER;
  };

  /** Das Ende: die Druckwelle. */
  private blast(weapon: OwnedWeapon, x: number, z: number): void {
    const { host } = this;
    const radius = this.vortexRadius * K.vortexBlastRadius;
    this.vortexMode = 'stoss';
    host.enemies.queryRadius(x, z, radius, this.vortexEach);
    host.effects.evolution.vortexBlast(x, z, radius);
    audio.play('evolution.mahlstrom-ende', x, z);
    this.vortexWeapon = null;
    void weapon;
  }

  // ---------------------------------------------------------------- Bollwerk

  /** Dornenschild: Eine enge Aura vor der Figur sticht jeden, der sie berührt, und drängt ihn leicht zurück. */
  keepBulwark(weapon: OwnedWeapon, dt: number): void {
    const { host } = this;
    const origin = host.player.position;
    this.bulwarkWeapon = weapon;
    this.bulwarkShown = true;
    this.bulwarkX = origin.x;
    this.bulwarkZ = origin.z;
    this.bulwarkAngle = host.player.facing;
    this.bulwarkIn -= dt;
    if (this.bulwarkIn > 0) return;
    this.bulwarkIn = K.bulwarkEvery;
    const reach = (K.bulwarkStart + K.bulwarkLength) * host.stats.reach;
    host.enemies.queryRadius(origin.x + Math.sin(this.bulwarkAngle) * reach * 0.5, origin.z + Math.cos(this.bulwarkAngle) * reach * 0.5, reach, this.bulwarkEach);
  }

  private readonly bulwarkEach = (enemy: Enemy): void => {
    const weapon = this.bulwarkWeapon;
    if (!weapon || enemy.hp <= 0 || enemy.driven) return;
    const dx = enemy.x - this.bulwarkX;
    const dz = enemy.z - this.bulwarkZ;
    const directionX = Math.sin(this.bulwarkAngle);
    const directionZ = Math.cos(this.bulwarkAngle);
    const along = dx * directionX + dz * directionZ;
    const across = Math.abs(dx * directionZ - dz * directionX);
    const reach = this.host.stats.reach;
    const margin = enemy.type.radius;
    if (along < K.bulwarkStart * reach - margin || along > (K.bulwarkStart + K.bulwarkLength) * reach + margin || across > (K.bulwarkWidth * reach) / 2 + margin) return;
    this.host.strike(enemy, weapon, this.bulwarkX, this.bulwarkZ, K.bulwarkDamage);
    if (enemy.type.scale >= BIG_GAME_SCALE) return;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-3) return;
    enemy.pushX += (dx / distance) * K.bulwarkPush * PUSH_PER_METER;
    enemy.pushZ += (dz / distance) * K.bulwarkPush * PUSH_PER_METER;
  };

  // ------------------------------------------------------------- Jedes Bild

  /** Läuft in jedem Bild nach den Angriffen. */
  update(dt: number): void {
    this.clock += dt;
    this.updateStorm(dt);
    this.updateVortex(dt);
    const { effects, stats } = this.host;
    if (this.bulwarkShown && this.bulwarkWeapon) {
      effects.evolution.bulwark(true, this.bulwarkX, this.bulwarkZ, this.bulwarkAngle, K.bulwarkStart * stats.reach, K.bulwarkLength * stats.reach, K.bulwarkWidth * stats.reach, this.clock);
      // Gilt nur für dieses Bild: Hat das Arsenal es nicht erneuert, ist das Bollwerk weg.
      this.bulwarkShown = false;
    } else if (this.bulwarkWeapon) {
      effects.evolution.bulwark(false, 0, 0, 0, 0, 0, 0, this.clock);
      this.bulwarkWeapon = null;
    }
  }
}
