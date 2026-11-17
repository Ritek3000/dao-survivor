/**
 * Die Evolutionen des Wildnisläufers (Rang 6, siehe `weapons.ts`, `CONFIG.skills.evolution.laeufer`): Pfeilfächer der Alten Ordnung,
 * Sturm der Aschenfedern, Kiefer der Ödnis, Klingen-Fächer der Ödnis, Atem der Schattenpilze, Vollstrecker der Ödnis und Schlinge der
 * Alten Ordnung. Wie bei den Kämpfer-Evolutionen (`evolutions.ts`) gilt: Wer trifft und wie hart, entscheidet allein `Arsenal.hit`
 * (über `EvolutionHost.strike`), damit Kritische, Zustände, Segen und Gegenstände auch hier greifen. Dieser Teil hält nur, was über
 * mehrere Bilder läuft: Staubwolken, Aschenschauer, geworfene Eisen, Wellen von Messern, Beutel, Nebelwände, das Netz auf dem Boden.
 *
 * Im Kampf entsteht nichts Neues: Alles liegt in kleinen festen Vorräten (Plätze, die frei oder belegt sind), die Gegner werden
 * nur kurz gehalten (höchstens ein Dutzend, und jedes Bild auf ihr Leben geprüft, damit kein wiederverwendeter Gegner mitläuft).
 */
import { audio } from '../audio';
import { CONFIG } from '../config';
import type { OwnedWeapon } from './arsenal';
import type { Enemy } from './enemies';
import { BAG_CAPACITY, JAW_CAPACITY, type BagSite, type JawSite } from './evolutionEffectsLaeufer';
import type { EvolutionHost } from './evolutions';
import type { Source } from './events';
import type { Field, FieldDef } from './fields';
import type { Projectile } from './projectiles';
import { BIG_GAME_SCALE } from './progression';
import { applyStatus, type StatusApply } from './status';
import { hasFlag, type ResolvedRank } from './weapons';

const L = CONFIG.skills.evolution.laeufer;
const LAEUFER = CONFIG.skills.laeufer;
const TAU = Math.PI * 2;
/** Wie hoch das Eisenbündel und der Beutel im Bogen ihres Flugs steigen (Meter). */
const JAW_ARC = 3.4;
const BAG_ARC = 2.6;
/** Die Eisen des Bündels liegen so weit (Radius der Zeichnung) auseinander, bezogen auf den Radius, den `area` ihnen gibt. */
const JAW_DRAW = 0.78;
/** So viele Gegner prüft die Suche nach der dichtesten Gruppe höchstens als Mitte; mehr Gegner zählen als Nachbarn. */
const CROWD_SLOTS = 48;
/** Die Staubwolke einer Evolution ist so breit, wie der Pfeil sie macht, höchstens aber dieser Faktor mal der Mitte. */
const GROUP_RADIUS = 3;
/** So langsam rückt der Schauer der Aschenfedern der Gruppe nach (Meter je Sekunde). */
const ASH_FOLLOW = 1.6;
/** Wie lange die Ketten eines Kiefers brauchen, bis sie Gegner in die Mitte gerissen haben (Sekunden). */
const CHAIN_SECONDS = 0.3;

/** Was die Evolutionen des Läufers vom Arsenal brauchen, über `EvolutionHost` hinaus. */
export interface LaeuferHost extends EvolutionHost {
  /** Fläche des Angriffs in Metern (Radius des Angriffs, Gegenstände und Rang eingerechnet). */
  area(weapon: OwnedWeapon): number;
  /** Wer in einer Wolke der Sporenfalle (Rang 5) stirbt, platzt auf und lässt eine frische kleine Wolke zurück. */
  sporeKill(field: Field, enemy: Enemy): void;
  /** Der Angriff, der ein Feld aufgestellt hat (Urheber ist seine Kennung). */
  weaponBySource(source: Source): OwnedWeapon | undefined;
}

interface Cloud {
  time: number;
  x: number;
  z: number;
  radius: number;
}

interface Storm {
  weapon: OwnedWeapon | null;
  time: number;
  tick: number;
  x: number;
  z: number;
  radius: number;
  fromX: number;
  fromZ: number;
}

type BundleState = 'frei' | 'flug' | 'gespannt' | 'zu';

/** Das Bündel dreier Riesen-Fangeisen: im Flug, gespannt am Boden oder zugeschnappt. */
interface Bundle {
  state: BundleState;
  weapon: OwnedWeapon | null;
  /** Restsekunden des Flugs bzw. des Zerreißens. */
  time: number;
  fromX: number;
  fromZ: number;
  x: number;
  z: number;
  /** Die Drehung der drei Eisen um die Mitte. */
  phase: number;
}

interface Pull {
  enemy: Enemy | null;
  weapon: OwnedWeapon | null;
  time: number;
  targetX: number;
  targetZ: number;
  hold: number;
}

interface Wave {
  weapon: OwnedWeapon | null;
  delay: number;
  angle: number;
  range: number;
}

interface Bag {
  weapon: OwnedWeapon | null;
  time: number;
  fromX: number;
  fromZ: number;
  x: number;
  z: number;
}

/** Eine Nebelwand, die mit dem Wind weiterkriecht: ihr Feld und wohin sie zieht. */
interface Fog {
  field: Field | null;
  def: FieldDef | null;
  dirX: number;
  dirZ: number;
  /** Das Alter des Felds im letzten Bild: Wird es kleiner, hat der Vorrat das Feld für ein anderes ersetzt. */
  seen: number;
}

export class LaeuferEvolutions {
  /** Die Mitte, die `densest` gefunden hat; für den Aufrufer, damit keine Zahlenpaare entstehen. */
  siteX = 0;
  siteZ = 0;

  private dt = 0;
  private clock = 0;

  // Pfeilfächer
  private readonly clouds: Cloud[] = Array.from({ length: L.dustMax }, () => ({ time: 0, x: 0, z: 0, radius: 0 }));
  private steerTarget: Enemy | null = null;
  private steerDistance = 0;
  private steerShot: Projectile<OwnedWeapon> | null = null;
  private steerCloud: Cloud | null = null;

  // Sturm der Aschenfedern
  private readonly storms: Storm[] = Array.from({ length: 2 }, () => ({ weapon: null, time: 0, tick: 0, x: 0, z: 0, radius: 0, fromX: 0, fromZ: 0 }));
  private stormNow: Storm | null = null;
  private sumX = 0;
  private sumZ = 0;
  private sumN = 0;
  private readonly ashDef: FieldDef = {
    id: 'aschesturm',
    shape: 'circle',
    duration: L.ashFieldSeconds,
    every: 0.5,
    instant: true,
    statuses: [{ kind: 'slow', seconds: 0.8, power: L.ashFieldSlow }],
  };

  // Kiefer der Ödnis
  private readonly bundles: Bundle[] = Array.from({ length: L.jawsMax }, () => ({ state: 'frei' as BundleState, weapon: null, time: 0, fromX: 0, fromZ: 0, x: 0, z: 0, phase: 0 }));
  private readonly pulls: Pull[] = Array.from({ length: L.jawsMax * L.jawsChain }, () => ({ enemy: null, weapon: null, time: 0, targetX: 0, targetZ: 0, hold: 0 }));
  private readonly openJaws: JawSite[] = Array.from({ length: JAW_CAPACITY }, () => ({ x: 0, z: 0, lift: 0, angle: 0 }));
  private readonly shutJaws: JawSite[] = Array.from({ length: JAW_CAPACITY }, () => ({ x: 0, z: 0, lift: 0, angle: 0 }));
  private openCount = 0;
  private shutCount = 0;
  private jawScale = 1;
  private readonly tearDef: FieldDef = {
    id: 'kiefer',
    shape: 'circle',
    duration: L.jawsHold,
    every: L.jawsTearEvery,
    damage: 1,
    statuses: [{ kind: 'hold', seconds: L.jawsTearEvery * 1.4 }],
    onTick: (field) => this.host.effects.laeufer.tear(field.x, field.z, field.radius),
  };
  private snapBundle: Bundle | null = null;
  private snapReach = 0;
  private pullCount = 0;
  private readonly pullBest: (Enemy | null)[] = Array.from({ length: L.jawsChain }, () => null);
  private readonly pullDistance: number[] = Array.from({ length: L.jawsChain }, () => 0);

  // Klingen-Fächer
  private readonly waves: Wave[] = Array.from({ length: 2 }, () => ({ weapon: null, delay: 0, angle: 0, range: 0 }));

  // Atem der Schattenpilze
  private readonly bags: Bag[] = Array.from({ length: BAG_CAPACITY }, () => ({ weapon: null, time: 0, fromX: 0, fromZ: 0, x: 0, z: 0 }));
  private readonly bagSites: BagSite[] = Array.from({ length: BAG_CAPACITY }, () => ({ x: 0, z: 0, lift: 0, angle: 0 }));
  private readonly fogs: Fog[] = Array.from({ length: L.fogMax }, () => ({ field: null, def: null, dirX: 0, dirZ: 1, seen: 0 }));
  private readonly fogDefs = new Map<ResolvedRank, FieldDef>();

  // Vollstrecker der Ödnis
  private phantomWeapon: OwnedWeapon | null = null;
  private feared: Field | null = null;

  // Schlinge der Alten Ordnung
  private dragWeapon: OwnedWeapon | null = null;
  private dragFrom = 0;
  private dragX = 0;
  private dragZ = 0;
  private dragAngle = 0;
  private dragFront = 0;
  private readonly dragCaught: (Enemy | null)[] = Array.from({ length: L.dragMax }, () => null);
  private readonly dragSide: number[] = Array.from({ length: L.dragMax }, () => 0);
  private dragCount = 0;
  private dragSeen = 0;
  private readonly crushDef: FieldDef = {
    id: 'schlinge',
    shape: 'circle',
    duration: L.dragHold,
    every: L.dragCrushEvery,
    instant: true,
    damage: 1,
    pull: 2.5,
    statuses: [
      { kind: 'hold', seconds: L.dragCrushEvery * 1.4 },
      { kind: 'silence', seconds: L.dragCrushEvery * 1.4 },
    ],
    onTick: (field) => this.host.effects.laeufer.crush(field.x, field.z, field.radius),
  };

  // Die Gruppe, in deren Mitte etwas geworfen wird.
  private readonly crowd: (Enemy | null)[] = Array.from({ length: CROWD_SLOTS }, () => null);
  private crowdCount = 0;
  private crowdX = 0;
  private crowdZ = 0;
  private crowdRange = 0;
  private crowdAround = 0;
  private crowdNear = 0;
  private crowdSumX = 0;
  private crowdSumZ = 0;

  constructor(private readonly host: LaeuferHost) {}

  /** Neue Nacht: Was lief, ist vorbei, ohne dass sein Ende wirkt. */
  reset(): void {
    for (const cloud of this.clouds) cloud.time = 0;
    for (const storm of this.storms) {
      storm.weapon = null;
      storm.time = 0;
    }
    for (const bundle of this.bundles) {
      bundle.state = 'frei';
      bundle.weapon = null;
    }
    for (const pull of this.pulls) {
      pull.enemy = null;
      pull.weapon = null;
    }
    for (const wave of this.waves) wave.weapon = null;
    for (const bag of this.bags) bag.weapon = null;
    for (const fog of this.fogs) {
      fog.field = null;
      fog.def = null;
    }
    this.phantomWeapon = null;
    this.dragWeapon = null;
    this.dragCount = 0;
    this.openCount = this.shutCount = 0;
    this.sumN = 0;
  }

  // ------------------------------------------------------------- Gruppe suchen

  /** Merkt sich Gegner in Reichweite als mögliche Mitte einer Gruppe. */
  private readonly collectEach = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || enemy.driven || this.crowdCount >= CROWD_SLOTS) return;
    if (Math.hypot(enemy.x - this.crowdX, enemy.z - this.crowdZ) > this.crowdRange + enemy.type.radius) return;
    this.crowd[this.crowdCount++] = enemy;
  };

  private readonly neighbourEach = (enemy: Enemy): void => {
    if (enemy.hp <= 0 || enemy.driven) return;
    if (Math.hypot(enemy.x - this.siteX, enemy.z - this.siteZ) > this.crowdAround) return;
    this.crowdNear++;
    this.crowdSumX += enemy.x;
    this.crowdSumZ += enemy.z;
  };

  /**
   * Die Mitte der dichtesten Gruppe (die meisten Gegner im Umkreis `around`) in `range` Metern um (x, z); das Ergebnis liegt in
   * `siteX` und `siteZ`. Ohne Gegner in Reichweite ist es false.
   */
  densest(x: number, z: number, range: number, around: number): boolean {
    this.crowdCount = 0;
    this.crowdX = x;
    this.crowdZ = z;
    this.crowdRange = range;
    this.crowdAround = around;
    this.host.enemies.queryRadius(x, z, range, this.collectEach);
    let best = 0;
    let bestX = 0;
    let bestZ = 0;
    for (let i = 0; i < this.crowdCount; i++) {
      const candidate = this.crowd[i];
      if (!candidate) continue;
      this.siteX = candidate.x;
      this.siteZ = candidate.z;
      this.crowdNear = 0;
      this.crowdSumX = 0;
      this.crowdSumZ = 0;
      this.host.enemies.queryRadius(candidate.x, candidate.z, around, this.neighbourEach);
      if (this.crowdNear > best) {
        best = this.crowdNear;
        // Die Mitte der Gruppe, nicht der eine Gegner, von dem aus gezählt wurde.
        bestX = this.crowdSumX / this.crowdNear;
        bestZ = this.crowdSumZ / this.crowdNear;
      }
    }
    this.siteX = bestX;
    this.siteZ = bestZ;
    return best > 0;
  }

  // ------------------------------------------------------------------ Pfeilfächer

  /** Jeder `dustEvery`-te Schuss trägt einen Staub-Pfeil. */
  dustShot(weapon: OwnedWeapon): boolean {
    return ++weapon.counter % L.dustEvery === 0;
  }

  /** Der Staub-Pfeil schlägt ein: Eine Wolke bleibt liegen und lenkt nachfolgende Pfeile auf Ziele in ihr. */
  dustBurst(x: number, z: number): void {
    let slot: Cloud | null = null;
    for (const cloud of this.clouds) {
      if (!slot || cloud.time < slot.time) slot = cloud;
    }
    if (!slot) return;
    slot.time = L.dustSeconds;
    slot.x = x;
    slot.z = z;
    slot.radius = L.dustRadius * this.host.stats.reach;
    this.host.effects.laeufer.dustCloud(x, z, slot.radius, L.dustSeconds);
    audio.play('evolution.faecher', x, z);
  }

  /** Ein Geschoss in der Luft: Pfeile in einer Staubwolke werden auf Ziele darin gelenkt; der Staub-Pfeil und die äußeren Messer stäuben. */
  fly(projectile: Projectile<OwnedWeapon>): void {
    const effects = this.host.effects.laeufer;
    if (projectile.shape === 'arrow') {
      if (projectile.tag === 1 && this.every(projectile, 0.045)) effects.dustArrow(projectile.x, projectile.z, projectile.angle);
      this.steer(projectile);
      return;
    }
    if (projectile.shape !== 'knife' || projectile.tag < 2) return;
    if (this.every(projectile, L.knivesDustEvery)) effects.knifeDust(projectile.x, projectile.z, projectile.angle);
    // Die äußeren Messer knicken nach einem Augenblick nach innen ab (Tag 2: linke Seite, Tag 3: rechte).
    if (projectile.age < L.knivesBendAfter) return;
    const turn = L.knivesBend * this.dt * (projectile.tag === 2 ? 1 : -1);
    projectile.angle += turn;
    projectile.directionX = Math.sin(projectile.angle);
    projectile.directionZ = Math.cos(projectile.angle);
  }

  /** Wird in diesem Bild ein Vielfaches von `period` Sekunden im Alter des Geschosses überschritten? */
  private every(projectile: Projectile<OwnedWeapon>, period: number): boolean {
    return Math.floor(projectile.age / period) !== Math.floor((projectile.age - this.dt) / period);
  }

  private readonly steerEach = (enemy: Enemy): void => {
    const cloud = this.steerCloud;
    const shot = this.steerShot;
    if (!cloud || !shot || enemy.hp <= 0 || shot.struck.includes(enemy)) return;
    if (Math.hypot(enemy.x - cloud.x, enemy.z - cloud.z) > cloud.radius + enemy.type.radius) return;
    const distance = Math.hypot(enemy.x - shot.x, enemy.z - shot.z);
    if (distance < this.steerDistance) {
      this.steerDistance = distance;
      this.steerTarget = enemy;
    }
  };

  private steer(projectile: Projectile<OwnedWeapon>): void {
    for (const cloud of this.clouds) {
      if (cloud.time <= 0 || Math.hypot(projectile.x - cloud.x, projectile.z - cloud.z) > cloud.radius) continue;
      this.steerCloud = cloud;
      this.steerShot = projectile;
      this.steerTarget = null;
      this.steerDistance = Infinity;
      this.host.enemies.queryRadius(cloud.x, cloud.z, cloud.radius, this.steerEach);
      const target = this.steerTarget as Enemy | null;
      if (!target) return;
      const want = Math.atan2(target.x - projectile.x, target.z - projectile.z);
      const offset = Math.atan2(Math.sin(want - projectile.angle), Math.cos(want - projectile.angle));
      // Wer hinter dem Pfeil steht, bleibt unbehelligt: Der Staub lenkt, er wendet nicht um.
      if (Math.abs(offset) > 2) return;
      const limit = L.dustTurn * this.dt;
      projectile.angle += Math.max(-limit, Math.min(limit, offset));
      projectile.directionX = Math.sin(projectile.angle);
      projectile.directionZ = Math.cos(projectile.angle);
      return;
    }
  }

  private updateClouds(dt: number): void {
    for (const cloud of this.clouds) {
      if (cloud.time <= 0) continue;
      cloud.time -= dt;
      this.host.effects.laeufer.dustDrift(cloud.x, cloud.z, cloud.radius, dt);
    }
  }

  // ------------------------------------------------------- Sturm der Aschenfedern

  /** Pfeilhagel: Statt eines Einschlags geht ein Schauer nieder, der `ashSeconds` anhält und der Gruppe langsam folgt. */
  ashStorm(weapon: OwnedWeapon, x: number, z: number, fromX: number, fromZ: number): void {
    let slot: Storm | null = null;
    for (const storm of this.storms) {
      if (!slot || storm.time < slot.time) slot = storm;
    }
    if (!slot) return;
    // Wie beim Pfeilhagel kündigt der Kreis den Schauer kurz an (`delay` des Angriffs), dann beginnt er.
    const delay = weapon.def.delay ?? 0.5;
    slot.weapon = weapon;
    slot.time = delay + L.ashSeconds;
    slot.tick = delay;
    slot.x = x;
    slot.z = z;
    slot.fromX = fromX;
    slot.fromZ = fromZ;
    slot.radius = this.host.area(weapon);
    this.host.effects.laeufer.ashStart(x, z, slot.radius, delay + L.ashSeconds);
    audio.play('evolution.aschesturm', x, z);
  }

  private readonly ashEach = (enemy: Enemy): void => {
    const storm = this.stormNow;
    const weapon = storm?.weapon;
    if (!storm || !weapon || enemy.hp <= 0) return;
    const distance = Math.hypot(enemy.x - storm.x, enemy.z - storm.z);
    if (distance > storm.radius + enemy.type.radius) return;
    // Im Zentrum trifft der Schauer härter (Rang 5).
    const centre = hasFlag(weapon.rules, 'mitte') && distance <= storm.radius * LAEUFER.hailCenter;
    this.host.strike(enemy, weapon, storm.x, storm.z, L.ashTick * (centre ? LAEUFER.hailCenterFactor : 1), false);
    if (enemy.hp <= 0) return;
    // Die Asche nimmt die Sicht: Blinde treffen schlecht, und wer zaubert, verstummt.
    applyStatus(enemy.status, 'blind', L.ashBlind, undefined, weapon.source);
    applyStatus(enemy.status, 'silence', L.ashBlind, undefined, weapon.source);
  };

  private readonly gatherEach = (enemy: Enemy): void => {
    const storm = this.stormNow;
    if (!storm || enemy.hp <= 0 || Math.hypot(enemy.x - storm.x, enemy.z - storm.z) > storm.radius * 1.3 + enemy.type.radius) return;
    this.sumX += enemy.x;
    this.sumZ += enemy.z;
    this.sumN++;
  };

  private updateStorms(dt: number): void {
    const effects = this.host.effects.laeufer;
    for (const storm of this.storms) {
      const weapon = storm.weapon;
      if (!weapon || storm.time <= 0) continue;
      this.stormNow = storm;
      storm.time -= dt;
      // Rang 5 (`folgen`): Der Schauer rückt langsam zur Mitte der Gruppe vor.
      if (hasFlag(weapon.rules, 'folgen')) {
        this.sumX = this.sumZ = this.sumN = 0;
        this.host.enemies.queryRadius(storm.x, storm.z, storm.radius * 1.3, this.gatherEach);
        if (this.sumN > 0) {
          const dx = this.sumX / this.sumN - storm.x;
          const dz = this.sumZ / this.sumN - storm.z;
          const distance = Math.hypot(dx, dz);
          if (distance > 1e-3) {
            const step = Math.min(distance, ASH_FOLLOW * dt) / distance;
            storm.x += dx * step;
            storm.z += dz * step;
          }
        }
      }
      storm.tick -= dt;
      if (storm.tick <= 0 && storm.time > 0) {
        storm.tick = L.ashEvery;
        this.host.enemies.queryRadius(storm.x, storm.z, storm.radius, this.ashEach);
        effects.ashTick(storm.x, storm.z, storm.radius, storm.fromX, storm.fromZ);
      }
      if (storm.time <= L.ashSeconds) effects.ashRain(storm.x, storm.z, storm.radius, dt);
      if (storm.time <= 0) {
        // Am Ende bleibt ein dichtes Staubfeld liegen, das Nachrückende verlangsamt.
        const radius = storm.radius * L.ashFieldRadius;
        this.host.support.fields.spawn(this.ashDef, storm.x, storm.z, { radius, source: weapon.source });
        effects.ashEnd(storm.x, storm.z, radius, L.ashFieldSeconds);
        storm.weapon = null;
      }
    }
    this.stormNow = null;
  }

  // ----------------------------------------------------------------- Kiefer der Ödnis

  /** Fangeisen: Ein Bündel aus drei Riesen-Eisen fliegt auf die dichteste Gruppe in Reichweite. Ohne Gegner dort bleibt es in der Hand. */
  jaws(weapon: OwnedWeapon, x: number, z: number): boolean {
    if (!this.densest(x, z, L.jawsRange * this.host.stats.reach, GROUP_RADIUS)) return false;
    let slot: Bundle | null = null;
    for (const bundle of this.bundles) {
      if (bundle.state === 'frei') {
        slot = bundle;
        break;
      }
      // Ist der Vorrat voll, geht das Eisen, das am längsten liegt (die Zeit der gespannten zählt nicht, also das erste zugeschnappte, sonst das erste).
      if (!slot || (bundle.state === 'zu' && slot.state !== 'zu')) slot = bundle;
    }
    if (!slot) return false;
    slot.state = 'flug';
    slot.weapon = weapon;
    slot.time = L.jawsFlight;
    slot.fromX = x;
    slot.fromZ = z;
    slot.x = this.siteX;
    slot.z = this.siteZ;
    slot.phase = Math.atan2(this.siteX - x, this.siteZ - z);
    return true;
  }

  private jawAt(bundle: Bundle, index: number, spread: number, lift: number, list: JawSite[], at: number): void {
    const site = list[at];
    if (!site) return;
    const angle = bundle.phase + (index / 3) * TAU;
    site.x = bundle.x + Math.sin(angle) * spread;
    site.z = bundle.z + Math.cos(angle) * spread;
    site.lift = lift;
    site.angle = angle;
  }

  private readonly snapEach = (enemy: Enemy): void => {
    const bundle = this.snapBundle;
    const weapon = bundle?.weapon;
    if (!bundle || !weapon || enemy.hp <= 0) return;
    // Wen eines der drei Eisen erreicht, wird getroffen (nur einmal, auch wo sich zwei überlappen).
    for (let i = 0; i < 3; i++) {
      const angle = bundle.phase + (i / 3) * TAU;
      const jawX = bundle.x + Math.sin(angle) * L.jawsSpread;
      const jawZ = bundle.z + Math.cos(angle) * L.jawsSpread;
      if (Math.hypot(enemy.x - jawX, enemy.z - jawZ) > this.snapReach + enemy.type.radius) continue;
      this.host.strike(enemy, weapon, bundle.x, bundle.z, L.jawsDamage, false);
      return;
    }
  };

  /** Wer außerhalb der Eisen, aber im Umkreis der Ketten steht, kommt als Nächster in Frage; die nächsten `jawsChain` werden gezogen. */
  private readonly chainEach = (enemy: Enemy): void => {
    const bundle = this.snapBundle;
    if (!bundle || enemy.hp <= 0 || enemy.driven || enemy.type.scale >= BIG_GAME_SCALE) return;
    const distance = Math.hypot(enemy.x - bundle.x, enemy.z - bundle.z);
    if (distance > L.jawsChainRadius || distance < L.jawsSpread + this.snapReach * 0.5) return;
    let slot = this.pullCount < L.jawsChain ? this.pullCount : L.jawsChain - 1;
    if (this.pullCount >= L.jawsChain && distance >= (this.pullDistance[slot] ?? Infinity)) return;
    if (this.pullCount < L.jawsChain) this.pullCount++;
    while (slot > 0 && (this.pullDistance[slot - 1] ?? 0) > distance) {
      this.pullDistance[slot] = this.pullDistance[slot - 1] ?? 0;
      this.pullBest[slot] = this.pullBest[slot - 1] ?? null;
      slot--;
    }
    this.pullDistance[slot] = distance;
    this.pullBest[slot] = enemy;
  };

  /** Das erste Eisen schnappt zu: Alle drei greifen, die Ketten reißen weitere Gegner in die Mitte, dort werden sie zerrissen. */
  private snap(bundle: Bundle): void {
    const weapon = bundle.weapon;
    if (!weapon) return;
    const { host } = this;
    const effects = host.effects.laeufer;
    this.snapBundle = bundle;
    this.snapReach = host.area(weapon);
    host.enemies.queryRadius(bundle.x, bundle.z, L.jawsSpread + this.snapReach, this.snapEach);
    // Die Ketten.
    this.pullCount = 0;
    this.pullBest.fill(null);
    host.enemies.queryRadius(bundle.x, bundle.z, L.jawsChainRadius, this.chainEach);
    for (let i = 0; i < this.pullCount; i++) {
      const enemy = this.pullBest[i];
      const pull = this.freePull();
      if (!enemy || !pull) continue;
      const angle = bundle.phase + (i / L.jawsChain) * TAU + 0.5;
      pull.enemy = enemy;
      pull.weapon = weapon;
      pull.time = CHAIN_SECONDS;
      pull.targetX = bundle.x + Math.sin(angle) * 0.8;
      pull.targetZ = bundle.z + Math.cos(angle) * 0.8;
      pull.hold = L.jawsHold;
      effects.chainLine(bundle.x, bundle.z, enemy.x, enemy.z);
    }
    this.snapBundle = null;
    bundle.state = 'zu';
    bundle.time = L.jawsHold;
    // Das Zerreißen: ein Feld in der Mitte, das alle darin hält und jeden Takt schlägt.
    const reach = L.jawsSpread + this.snapReach * 0.6;
    const { def, rules } = weapon;
    host.support.fields.spawn(this.tearDef, bundle.x, bundle.z, {
      radius: reach,
      scale: def.damage * rules.damage * host.stats.damage * host.traits.dealt * L.jawsTear,
      source: weapon.source,
    });
    effects.snap(bundle.x, bundle.z, L.jawsSpread, this.snapReach);
    audio.play('evolution.kiefer', bundle.x, bundle.z);
  }

  private freePull(): Pull | null {
    for (const pull of this.pulls) if (!pull.enemy) return pull;
    return null;
  }

  private updateJaws(dt: number): void {
    const effects = this.host.effects.laeufer;
    this.openCount = this.shutCount = 0;
    for (let slot = 0; slot < this.bundles.length; slot++) {
      const bundle = this.bundles[slot];
      if (!bundle) continue;
      const weapon = bundle.weapon;
      if (bundle.state === 'frei' || !weapon) {
        effects.chains(slot, false, 0, 0, 0, 0);
        continue;
      }
      const reach = this.host.area(weapon);
      this.jawScale = (reach / 0.42) * JAW_DRAW;
      if (bundle.state === 'flug') {
        bundle.time -= dt;
        const t = Math.min(1, Math.max(0, 1 - bundle.time / L.jawsFlight));
        const x = bundle.fromX + (bundle.x - bundle.fromX) * t;
        const z = bundle.fromZ + (bundle.z - bundle.fromZ) * t;
        const lift = 4 * JAW_ARC * t * (1 - t);
        for (let i = 0; i < 3; i++) {
          const site = this.openJaws[this.openCount++];
          if (!site) continue;
          const angle = bundle.phase + (i / 3) * TAU + t * 5;
          site.x = x + Math.sin(angle) * L.jawsSpread * t;
          site.z = z + Math.cos(angle) * L.jawsSpread * t;
          site.lift = lift + 0.3;
          site.angle = angle;
        }
        if (bundle.time <= 0) {
          bundle.state = 'gespannt';
          effects.land(bundle.x, bundle.z, L.jawsSpread);
          effects.chains(slot, true, bundle.x, bundle.z, L.jawsSpread, bundle.phase);
          audio.play('evolution.kiefer-wurf', bundle.x, bundle.z);
        }
        continue;
      }
      if (bundle.state === 'gespannt') {
        for (let i = 0; i < 3; i++) this.jawAt(bundle, i, L.jawsSpread, 0, this.openJaws, this.openCount++);
        // Das erste Eisen, auf das ein Gegner tritt, löst das ganze Bündel aus.
        for (let i = 0; i < 3; i++) {
          const angle = bundle.phase + (i / 3) * TAU;
          if (!this.host.enemies.nearest(bundle.x + Math.sin(angle) * L.jawsSpread, bundle.z + Math.cos(angle) * L.jawsSpread, reach)) continue;
          this.snap(bundle);
          break;
        }
        continue;
      }
      // Zugeschnappt: Die Eisen stehen, bis das Zerreißen vorbei ist.
      for (let i = 0; i < 3; i++) this.jawAt(bundle, i, L.jawsSpread, 0, this.shutJaws, this.shutCount++);
      bundle.time -= dt;
      if (bundle.time <= 0) {
        bundle.state = 'frei';
        bundle.weapon = null;
        effects.chains(slot, false, 0, 0, 0, 0);
      }
    }
    effects.showJaws(this.openJaws, this.openCount, this.shutJaws, this.shutCount, this.jawScale);
    // Die Ketten reißen Gegner in die Mitte.
    for (const pull of this.pulls) {
      const enemy = pull.enemy;
      const weapon = pull.weapon;
      if (!enemy || !weapon) continue;
      if (enemy.hp <= 0) {
        pull.enemy = null;
        continue;
      }
      pull.time -= dt;
      const share = pull.time > 0 ? Math.min(1, dt / (pull.time + dt)) : 1;
      enemy.x += (pull.targetX - enemy.x) * share;
      enemy.z += (pull.targetZ - enemy.z) * share;
      // Der Gegner steht still, solange ihn die Kette zieht.
      applyStatus(enemy.status, 'hold', 0.35, undefined, weapon.source);
      if (pull.time > 0) continue;
      // In der Mitte angekommen: der Schlag der Eisen und danach gefangen, bis das Zerreißen vorbei ist.
      this.host.strike(enemy, weapon, pull.targetX, pull.targetZ, L.jawsDamage, false);
      if (enemy.hp > 0) applyStatus(enemy.status, 'hold', pull.hold, undefined, weapon.source);
      pull.enemy = null;
      pull.weapon = null;
    }
  }

  // ------------------------------------------------------------------ Klingen-Fächer

  /** Wurfmesser: Die erste Welle fliegt sofort, die zweite nach einem Augenblick, um eine halbe Lücke versetzt. */
  knives(weapon: OwnedWeapon, x: number, z: number, angle: number, range: number): void {
    this.knifeWave(weapon, x, z, angle, range);
    const gap = (weapon.def.spread ?? 0) * weapon.rules.spread;
    for (const wave of this.waves) {
      if (wave.weapon) continue;
      wave.weapon = weapon;
      wave.delay = L.knivesDelay;
      wave.angle = angle + gap / 2;
      wave.range = range;
      return;
    }
  }

  private knifeWave(weapon: OwnedWeapon, x: number, z: number, angle: number, range: number): void {
    const { def, rules } = weapon;
    const count = rules.count;
    const gap = (def.spread ?? 0) * rules.spread;
    const options = this.host.projectileOptions(weapon);
    for (let i = 0; i < count; i++) {
      const k = i - (count - 1) / 2;
      // Die beiden äußersten Messer jeder Seite stäuben und knicken ab.
      const tag = Math.abs(k) >= (count - 1) / 2 - 1 && count >= 5 ? (k < 0 ? 2 : 3) : 0;
      this.host.projectiles.spawn(x, z, angle + k * gap, (def.speed ?? 20) * rules.speed, range, rules.pierce, def.shape ?? 'knife', weapon, options, tag);
    }
    this.host.effects.laeufer.fan(x, z, angle, gap * (count - 1), range);
  }

  private updateWaves(dt: number): void {
    for (const wave of this.waves) {
      const weapon = wave.weapon;
      if (!weapon) continue;
      wave.delay -= dt;
      if (wave.delay > 0) continue;
      wave.weapon = null;
      const origin = this.host.player.position;
      audio.play('angriff.wurfmesser', origin.x, origin.z);
      this.knifeWave(weapon, origin.x, origin.z, wave.angle, wave.range);
    }
  }

  // ------------------------------------------------------------- Atem der Schattenpilze

  /** Sporenfalle: Ein dicker Beutel fliegt auf die dichteste Gruppe in Reichweite. Ohne Gegner dort bleibt er in der Hand. */
  bag(weapon: OwnedWeapon, x: number, z: number): boolean {
    if (!this.densest(x, z, L.bagRange * this.host.stats.reach, GROUP_RADIUS)) return false;
    let slot: Bag | null = null;
    for (const bag of this.bags) {
      if (!bag.weapon) {
        slot = bag;
        break;
      }
      if (!slot || bag.time < slot.time) slot = bag;
    }
    if (!slot) return false;
    slot.weapon = weapon;
    slot.time = L.bagFlight;
    slot.fromX = x;
    slot.fromZ = z;
    slot.x = this.siteX;
    slot.z = this.siteZ;
    return true;
  }

  /** Die Beschreibung der Nebelwand für einen Rang: Zustände der Wolke und, was der Rang dazu bringt, die blinde Wand. */
  private fogDef(weapon: OwnedWeapon): FieldDef {
    const { def, rules } = weapon;
    let fog = this.fogDefs.get(rules);
    if (!fog) {
      const statuses: StatusApply[] = [...rules.statuses, { kind: 'blind', seconds: L.fogBlind }, { kind: 'weak', seconds: 1, power: 1.2 }];
      fog = {
        id: 'schattenpilz',
        shape: 'line',
        duration: rules.duration,
        every: 0.5,
        instant: true,
        damage: def.damage,
        statuses,
        // Rang 5 bleibt: Wer in der Wand stirbt, platzt auf.
        onKill: hasFlag(rules, 'platzen') ? this.host.sporeKill : undefined,
      };
      this.fogDefs.set(rules, fog);
    }
    return fog;
  }

  private landBag(bag: Bag, weapon: OwnedWeapon): void {
    const { host } = this;
    const dx = bag.x - bag.fromX;
    const dz = bag.z - bag.fromZ;
    const distance = Math.hypot(dx, dz);
    const dirX = distance > 1e-3 ? dx / distance : 0;
    const dirZ = distance > 1e-3 ? dz / distance : 1;
    const radius = host.area(weapon);
    const length = radius * 2.2;
    const width = radius * 0.9;
    // Die Wand steht quer zur Wurfrichtung und kriecht mit dem Wind weiter.
    const angle = Math.atan2(dirX, dirZ) + Math.PI / 2;
    const def = this.fogDef(weapon);
    const field = host.support.fields.spawn(def, bag.x - Math.sin(angle) * (length / 2), bag.z - Math.cos(angle) * (length / 2), {
      angle,
      length,
      width,
      scale: weapon.rules.damage * host.stats.damage * host.traits.dealt * L.fogDamage,
      source: weapon.source,
    });
    let slot: Fog | null = null;
    for (const fog of this.fogs) {
      if (!fog.field || !fog.field.active) {
        slot = fog;
        break;
      }
      if (!slot || fog.seen > slot.seen) slot = fog;
    }
    if (slot) {
      // Das älteste Feld, wenn der Vorrat voll ist, verweht.
      if (slot.field && slot.field.active && slot.field.def === slot.def) host.support.fields.remove(slot.field);
      slot.field = field;
      slot.def = def;
      slot.dirX = dirX;
      slot.dirZ = dirZ;
      slot.seen = 0;
    }
    host.effects.laeufer.fogLand(field.x, field.z, angle, length, width);
    audio.play('evolution.nebel', bag.x, bag.z);
  }

  private updateBags(dt: number): void {
    const effects = this.host.effects.laeufer;
    let shown = 0;
    for (const bag of this.bags) {
      const weapon = bag.weapon;
      if (!weapon) continue;
      bag.time -= dt;
      const t = Math.min(1, Math.max(0, 1 - bag.time / L.bagFlight));
      const site = this.bagSites[shown++];
      if (site) {
        site.x = bag.fromX + (bag.x - bag.fromX) * t;
        site.z = bag.fromZ + (bag.z - bag.fromZ) * t;
        site.lift = 4 * BAG_ARC * t * (1 - t) + 0.3;
        site.angle = this.clock * 7;
      }
      if (bag.time <= 0) {
        bag.weapon = null;
        this.landBag(bag, weapon);
        shown--;
      }
    }
    effects.showBags(this.bagSites, shown);
    // Die Nebelwände wandern mit dem Wind.
    for (let slot = 0; slot < this.fogs.length; slot++) {
      const fog = this.fogs[slot];
      if (!fog) continue;
      const field = fog.field;
      // Ein Feld, dessen Platz der Vorrat für ein anderes vergeben hat (Alter kleiner als zuvor), gehört nicht mehr dazu.
      const alive = field !== null && field.active && field.def === fog.def && field.age >= fog.seen;
      if (!alive || !field) {
        effects.fog(slot, false, 0, 0, 0, 0, 0, this.clock, dt);
        fog.field = null;
        continue;
      }
      fog.seen = field.age;
      field.x += fog.dirX * L.fogDrift * dt;
      field.z += fog.dirZ * L.fogDrift * dt;
      effects.fog(slot, true, field.x, field.z, field.angle, field.length, field.width, this.clock, dt);
    }
  }

  // ------------------------------------------------------------ Vollstrecker der Ödnis

  /** Die Furcht, die das Phantom jeden Takt verbreitet (kleine Gegner), und seine Sogwirkung für die Zeichnung. */
  private readonly fearEach = (enemy: Enemy): void => {
    const field = this.feared;
    if (!field || enemy.hp <= 0 || enemy.type.scale >= BIG_GAME_SCALE) return;
    if (Math.hypot(enemy.x - field.x, enemy.z - field.z) > field.radius + enemy.type.radius) return;
    applyStatus(enemy.status, 'fear', L.phantomFear, undefined, field.source);
  };

  /** Jeder Takt des Phantoms: Wer in seinem Umkreis steht, fürchtet sich; der Sog selbst ist `pull` am Feld. */
  readonly phantomTick = (field: Field): void => {
    this.feared = field;
    this.host.enemies.queryRadius(field.x, field.z, field.radius, this.fearEach);
    this.feared = null;
    this.host.effects.laeufer.phantomPulse(field.x, field.z, field.radius);
  };

  private blastField: Field | null = null;
  private blastRadius = 0;

  private readonly blastEach = (enemy: Enemy): void => {
    const field = this.blastField;
    const weapon = this.phantomWeapon;
    if (!field || !weapon || enemy.hp <= 0) return;
    if (Math.hypot(enemy.x - field.x, enemy.z - field.z) > this.blastRadius + enemy.type.radius) return;
    // Wer verlangsamt oder gefesselt ist, erleidet mehr Schaden.
    const bound = enemy.status.slow.time > 0 || enemy.status.hold.time > 0;
    this.host.strike(enemy, weapon, field.x, field.z, L.phantomDamage * (bound ? 1 + L.phantomBonus : 1));
  };

  /** Das Phantom zerspringt: eine gewaltige Schockwelle aus Knochen und Staub. */
  readonly phantomEnd = (field: Field): void => {
    const weapon = this.host.weaponBySource(field.source);
    if (!weapon) return;
    this.phantomWeapon = weapon;
    this.blastField = field;
    this.blastRadius = field.radius * L.phantomBlast;
    this.host.enemies.queryRadius(field.x, field.z, this.blastRadius, this.blastEach);
    this.host.effects.laeufer.phantomBlast(field.x, field.z, this.blastRadius);
    audio.play('evolution.phantom', field.x, field.z);
    this.phantomWeapon = null;
    this.blastField = null;
  };

  // ------------------------------------------------------ Schlinge der Alten Ordnung

  /** Netz: Ein Schleppnetz fegt vom Läufer weg auf die dichteste Gruppe zu (sonst auf den nächsten Gegner) und nimmt kleine und mittlere mit. */
  drag(weapon: OwnedWeapon, x: number, z: number, target: Enemy): void {
    if (this.dragWeapon) return;
    this.dragWeapon = weapon;
    this.dragX = x;
    this.dragZ = z;
    const aimed = this.densest(x, z, weapon.def.range * this.host.stats.reach, GROUP_RADIUS);
    this.dragAngle = aimed ? Math.atan2(this.siteX - x, this.siteZ - z) : Math.atan2(target.x - x, target.z - z);
    this.dragFrom = 1;
    this.dragFront = this.dragFrom;
    this.dragCount = 0;
    this.dragCaught.fill(null);
    this.host.effects.laeufer.dragStart(x, z, this.dragAngle, L.dragWidth);
    audio.play('evolution.schlinge', x, z);
  }

  private readonly dragEach = (enemy: Enemy): void => {
    const weapon = this.dragWeapon;
    if (!weapon || enemy.hp <= 0 || enemy.driven || enemy.type.scale >= BIG_GAME_SCALE || this.dragCount >= L.dragMax) return;
    const directionX = Math.sin(this.dragAngle);
    const directionZ = Math.cos(this.dragAngle);
    const dx = enemy.x - this.dragX;
    const dz = enemy.z - this.dragZ;
    const along = dx * directionX + dz * directionZ;
    const across = dx * directionZ - dz * directionX;
    if (along < this.dragFront - 1.4 || along > this.dragFront + 0.9 || Math.abs(across) > L.dragWidth / 2 + enemy.type.radius) return;
    for (let i = 0; i < this.dragCount; i++) if (this.dragCaught[i] === enemy) return;
    this.dragCaught[this.dragCount] = enemy;
    this.dragSide[this.dragCount] = Math.max(-L.dragWidth / 2, Math.min(L.dragWidth / 2, across));
    this.dragCount++;
    // Der Schlag des Netzes beim Einfangen; das Netz trägt die Gefangenen, es stößt sie nicht fort.
    this.host.strike(enemy, weapon, this.dragX, this.dragZ, 1, false);
  };

  private updateDrag(dt: number): void {
    const weapon = this.dragWeapon;
    const effects = this.host.effects.laeufer;
    if (!weapon) {
      effects.dragFront(false, 0, 0, 0, 0, dt);
      return;
    }
    this.dragFront = Math.min(L.dragLength, this.dragFront + L.dragSpeed * dt);
    const directionX = Math.sin(this.dragAngle);
    const directionZ = Math.cos(this.dragAngle);
    const frontX = this.dragX + directionX * this.dragFront;
    const frontZ = this.dragZ + directionZ * this.dragFront;
    this.host.enemies.queryRadius(frontX, frontZ, L.dragWidth / 2 + 1.6, this.dragEach);
    // Die Gefangenen laufen im Netz mit; wer stirbt, fällt heraus.
    let kept = 0;
    for (let i = 0; i < this.dragCount; i++) {
      const enemy = this.dragCaught[i];
      if (!enemy || enemy.hp <= 0) continue;
      const along = this.dragFront - 0.5 - (i % 3) * 0.35;
      const side = this.dragSide[i] ?? 0;
      enemy.x = this.dragX + directionX * along + directionZ * side;
      enemy.z = this.dragZ + directionZ * along - directionX * side;
      applyStatus(enemy.status, 'hold', 0.3, undefined, weapon.source);
      this.dragCaught[kept] = enemy;
      this.dragSide[kept] = side;
      kept++;
    }
    for (let i = kept; i < this.dragCount; i++) this.dragCaught[i] = null;
    this.dragCount = kept;
    effects.dragFront(true, frontX, frontZ, this.dragAngle, L.dragWidth, dt);
    if (this.dragFront < L.dragLength) return;
    this.cinch(weapon, frontX, frontZ);
  }

  /** Das Netz ist am Ende der Strecke: Es schnürt die Gefangenen zu einem Bündel und hält sie, während die Gewichte zuschlagen. */
  private cinch(weapon: OwnedWeapon, x: number, z: number): void {
    const { host } = this;
    for (let i = 0; i < this.dragCount; i++) {
      const enemy = this.dragCaught[i];
      if (!enemy || enemy.hp <= 0) continue;
      // Auf einer Spirale um die Mitte, damit sie nicht in einem Punkt liegen.
      const a = i * 2.4;
      const r = L.dragBundle * Math.sqrt((i + 0.5) / Math.max(1, this.dragCount));
      enemy.x = x + Math.sin(a) * r;
      enemy.z = z + Math.cos(a) * r;
      applyStatus(enemy.status, 'hold', L.dragHold, undefined, weapon.source);
      applyStatus(enemy.status, 'silence', L.dragHold, undefined, weapon.source);
    }
    const reach = L.dragBundle + 0.8;
    host.support.fields.spawn(this.crushDef, x, z, {
      radius: reach,
      scale: weapon.def.damage * weapon.rules.damage * host.stats.damage * host.traits.dealt * L.dragCrush,
      source: weapon.source,
    });
    host.effects.laeufer.dragBundle(x, z, reach, L.dragHold);
    this.dragSeen = this.dragCount;
    this.dragCaught.fill(null);
    this.dragCount = 0;
    this.dragWeapon = null;
  }

  /** Wie viele Gegner das letzte Netz gefangen hat (für Prüfungen). */
  get lastCatch(): number {
    return this.dragSeen;
  }

  // -------------------------------------------------------------------- Jedes Bild

  /** Läuft in jedem Bild nach den Angriffen und vor den Geschossen. */
  update(dt: number): void {
    this.dt = dt;
    this.clock += dt;
    this.updateClouds(dt);
    this.updateStorms(dt);
    this.updateJaws(dt);
    this.updateWaves(dt);
    this.updateBags(dt);
    this.updateDrag(dt);
  }
}
