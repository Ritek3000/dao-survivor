/**
 * Die Evolutionen des Magiers (Rang 6, Vorlage: „Klassen, Fertigkeiten & Evolutionen“, Abschnitt Magier). Wie bei Kämpfer und
 * Wildnisläufer (`evolutions.ts`, `evolutionsLaeufer.ts`) wird der Angriff mit dem passenden Ring beim Schritt auf Rang 5 zu Rang 6;
 * die Zeile dazu steht in `weapons.ts`, ihre Schalter heißen dort wie hier: `sonnenstich`, `sonnenspeer`, `krone`, `beben`, `tiefe`,
 * `orkan` und `kuppel`.
 *
 * - Atem der Verblassenden Sor (Hitze werfen): Der weite Halbkreis ist ein breiterer Kegel des Angriffs selbst; dieser Teil hält nur,
 *   was ein Brennender beim Sterben tut (er entzündet den Staub um sich).
 * - Speer der Verschwundenen Sonne (Sorlanze): Ein Lichtspeer fällt auf die dichteste Gruppe und teilt sich in vier Strahlen.
 * - Krone der Erloschenen Sor (Glut formen): Der Hitzeschaden im Kreis wächst mit der Zeit; wer im Kreis stirbt, löst eine Hitzewelle aus.
 * - Beben der Alten Ordnung (Erdstoß): Drei Ringe rollen hinaus, danach liegt ein Trümmerfeld.
 * - Griff der Alten Tiefe (Wurzelgriff): Eine lange Bahn aus Wurzeln zieht Gegner in die Mitte und hält sie fest.
 * - Orkan der Alten Ordnung (Sturmböe): ein dauerhafter Luftstrom; die Doppelböe zerreibt feindliche Zauber.
 * - Kuppel der Alten Ordnung (Schild): kreisende Runen, die Zauber zerreiben und beim Zerbrechen eine Welle schicken.
 *
 * Wer trifft und wie hart, entscheidet weiter allein `Arsenal.hit` (über `EvolutionHost.strike`), damit Kritische, Zustände, Segen
 * und Gegenstände auch hier gelten. Im Kampf entsteht nichts Neues: Alles liegt in festen Feldern oder in den Bodenfeldern des Unterbaus.
 */
import { audio } from '../audio';
import { CONFIG } from '../config';
import type { BuffSpec } from './buffs';
import type { OwnedWeapon } from './arsenal';
import { Crowd } from './crowd';
import type { Enemy } from './enemies';
import type { EvolutionHost } from './evolutions';
import type { Field, FieldDef } from './fields';
import { BIG_GAME_SCALE } from './progression';
import { applyStatus, type StatusApply } from './status';
import { statusSeconds } from './weapons';

const M = CONFIG.skills.evolution.magier;

/** Wie ein Rückstoß mit Tempo v weit trägt: Er klingt mit exp(−8 t) ab (siehe `Enemies.update`), also v / 8 Meter. */
const PUSH_PER_METER = 8;
/** Zur dichtesten Gruppe zählen die Gegner in diesem Umkreis (Meter). */
const GROUP_RADIUS = 3;
/** Der Speer fällt auf höchstens so viele Orte zugleich; die Ankündigung ist kurz. */
const SPEARS = 2;
/** Höchstens so viele Beben laufen zugleich. */
const QUAKES = 2;
/** So viele Hitzewellen der Krone warten höchstens auf das nächste Bild. */
const WAVE_QUEUE = 8;
/** Der Orkan erneuert seinen Schub in diesem Abstand (Sekunden); der Schub hält etwas länger, damit er nicht flackert. */
const GALE_RENEW = 0.25;
/** Wie oft die Kuppel nach feindlichen Zaubern in ihrer Aura sieht (Sekunden). */
const DOME_LOOK = 0.1;

const GALE: BuffSpec = { id: 'orkan-tempo', stat: 'speed', mode: 'mul', amount: M.galeSpeed, seconds: GALE_RENEW * 2.4 };

/** Was die Evolutionen des Magiers vom Arsenal brauchen, über `EvolutionHost` hinaus. */
export interface MagierHost extends EvolutionHost {
  /** Fläche des Angriffs in Metern (Radius des Angriffs, Gegenstände und Rang eingerechnet). */
  area(weapon: OwnedWeapon): number;
  /** Zerreibt feindliche Fernzauber (Schwarzer Sog) im Umkreis `reach` um (x, z); es sagt, wie viele es waren. */
  dissolve(x: number, z: number, reach: number): number;
}

/** Ein Speer, der gleich fällt. */
interface Spear {
  weapon: OwnedWeapon | null;
  delay: number;
  x: number;
  z: number;
  /** Aus welcher Richtung er kommt (Radiant, wie ein Angriff zielt). */
  angle: number;
}

/** Ein Beben: Es hat drei Ringe, jeder merkt sich, wie weit er schon gelaufen ist. */
interface Quake {
  weapon: OwnedWeapon | null;
  x: number;
  z: number;
  radius: number;
  time: number;
  front: number[];
  /** Hat der Ring schon angefangen zu laufen (damit sein Bild einmal entsteht)? */
  started: boolean[];
}

/** Ein Gegner, den der Griff in die Mitte zieht. */
interface Pulled {
  enemy: Enemy | null;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

/** Wo eine Hitzewelle der Krone ausgeht. */
interface Wave {
  x: number;
  z: number;
}

export class MagierEvolutions {
  private clock = 0;
  private dt = 0;
  private readonly crowd: Crowd;

  // Atem der Verblassenden Sor
  private sunWeapon: OwnedWeapon | null = null;
  private sunDef: FieldDef | null = null;
  private sunX = 0;
  private sunZ = 0;
  private sunCrowded = false;

  // Speer der Verschwundenen Sonne
  private readonly spears: Spear[] = Array.from({ length: SPEARS }, () => ({ weapon: null, delay: 0, x: 0, z: 0, angle: 0 }));
  private spearNext = 0;
  private spearStruck = 0;

  // Krone der Erloschenen Sor
  private crownWeapon: OwnedWeapon | null = null;
  private crownRadius = 0;
  private crownSeen = -1;
  private readonly waves: Wave[] = Array.from({ length: WAVE_QUEUE }, () => ({ x: 0, z: 0 }));
  private waveCount = 0;
  private waveFrom: Wave = { x: 0, z: 0 };

  // Beben der Alten Ordnung
  private readonly quakes: Quake[] = Array.from({ length: QUAKES }, () => ({
    weapon: null,
    x: 0,
    z: 0,
    radius: 0,
    time: 0,
    front: M.quakeRings.map(() => -1),
    started: M.quakeRings.map(() => false),
  }));
  private quakeNow: Quake | null = null;
  private quakeRing = 0;
  private quakePrev = 0;
  private quakeReach = 0;
  private readonly debrisDef: FieldDef = {
    id: 'beben-truemmer',
    shape: 'circle',
    duration: M.quakeFieldSeconds,
    every: 0.5,
    instant: true,
    statuses: [
      { kind: 'slow', seconds: 0.8, power: M.quakeSlow },
      { kind: 'weak', seconds: 0.8, power: M.quakeWeak },
    ],
  };

  // Griff der Alten Tiefe
  private readonly pulled: Pulled[] = Array.from({ length: M.gripMax }, () => ({ enemy: null, fromX: 0, fromZ: 0, toX: 0, toZ: 0 }));
  private pulledCount = 0;
  private pullTime = 0;
  private pullTotal = 0;
  private gripWeapon: OwnedWeapon | null = null;
  private gripX = 0;
  private gripZ = 0;
  private gripAngle = 0;
  private gripLength = 0;
  private gripWidth = 0;
  private gripCaught = 0;
  private gripDef: FieldDef | null = null;

  // Orkan der Alten Ordnung
  private galeGap = 0;

  // Kuppel der Alten Ordnung
  private domeWeapon: OwnedWeapon | null = null;
  private domePhase = 0;
  private domeGap = 0;
  private domeCharges = 0;

  constructor(private readonly host: MagierHost) {
    this.crowd = new Crowd(host.enemies);
  }

  /** Neue Nacht: Was lief, ist vorbei, ohne dass sein Ende wirkt. */
  reset(): void {
    this.sunWeapon = null;
    for (const spear of this.spears) spear.weapon = null;
    this.crownWeapon = null;
    this.crownSeen = -1;
    this.waveCount = 0;
    for (const quake of this.quakes) quake.weapon = null;
    this.pulledCount = 0;
    this.gripWeapon = null;
    this.galeGap = 0;
    this.domeWeapon = null;
    this.domeCharges = 0;
  }

  update(dt: number): void {
    this.dt = dt;
    this.clock += dt;
    this.updateSpears(dt);
    this.updateWaves();
    this.updateQuakes(dt);
    this.updatePull(dt);
  }

  // ---------------------------------------------------------- Atem der Verblassenden Sor

  /** Der Hitzesturm bricht los: Der Kegel selbst schlägt der Angriff; hier kommen Bild und Klang dazu. */
  sunBreath(weapon: OwnedWeapon, x: number, z: number, angle: number, range: number, width: number): void {
    this.sunWeapon = weapon;
    this.host.effects.magier.sunBreath(x, z, angle, range, width);
    audio.play('evolution.sonnenstich', x, z);
  }

  private readonly nearSun = (field: Field): void => {
    if (field.def === this.sunDef && Math.hypot(field.x - this.sunX, field.z - this.sunZ) < M.sunRadius * 0.6) this.sunCrowded = true;
  };

  /** Ein Gegner ist gestorben: War er vom Hitzesturm entzündet, brennt der Staub um ihn weiter. */
  sunKill(enemy: Enemy): void {
    const weapon = this.sunWeapon;
    if (!weapon || enemy.status.burn.time <= 0 || enemy.status.burn.source !== weapon.source) return;
    const fields = this.host.support.fields;
    // Der Vorrat an Feldern ist begrenzt; Banner und Köderpuppe sollen nicht von Glut verdrängt werden.
    if (fields.count >= M.sunLimit) return;
    this.sunDef ??= {
      id: 'sonnenstich-glut',
      shape: 'circle',
      duration: M.sunSeconds,
      every: 0.5,
      instant: true,
      damage: weapon.def.damage * M.sunDamage,
      statuses: [{ kind: 'burn', seconds: M.sunBurnSeconds, power: M.sunBurnPower }],
    };
    this.sunX = enemy.x;
    this.sunZ = enemy.z;
    this.sunCrowded = false;
    fields.eachActive(this.nearSun);
    if (this.sunCrowded) return;
    const radius = M.sunRadius * this.host.stats.reach;
    const { rules } = weapon;
    fields.spawn(this.sunDef, enemy.x, enemy.z, { radius, scale: rules.damage * this.host.stats.damage * this.host.traits.dealt, source: weapon.source });
    this.host.effects.magier.sunIgnite(enemy.x, enemy.z, radius, M.sunSeconds);
  }

  // ------------------------------------------------------ Speer der Verschwundenen Sonne

  /** Der Speer wird gerufen: Er fällt auf die dichteste Gruppe in Reichweite, sonst auf das Ziel. */
  spear(weapon: OwnedWeapon, x: number, z: number, target: Enemy, range: number): void {
    const reach = Math.min(range, M.spearReach * this.host.stats.reach);
    const found = this.crowd.find(x, z, reach, GROUP_RADIUS);
    const toX = found ? this.crowd.siteX : target.x;
    const toZ = found ? this.crowd.siteZ : target.z;
    const spear = this.spears[this.spearNext];
    this.spearNext = (this.spearNext + 1) % SPEARS;
    if (!spear) return;
    spear.weapon = weapon;
    spear.delay = M.spearDelay;
    spear.x = toX;
    spear.z = toZ;
    spear.angle = Math.atan2(toX - x, toZ - z);
    const radius = M.spearRadius * this.host.stats.reach;
    this.host.effects.magier.spearMark(toX, toZ, radius, M.spearDelay);
  }

  private updateSpears(dt: number): void {
    for (const spear of this.spears) {
      const weapon = spear.weapon;
      if (!weapon) continue;
      spear.delay -= dt;
      if (spear.delay > 0) continue;
      spear.weapon = null;
      this.impact(weapon, spear);
    }
  }

  private spearWeapon: OwnedWeapon | null = null;
  private spearX = 0;
  private spearZ = 0;
  private spearFactor = 1;
  private spearAlong = 0;
  private spearLength = 0;
  private spearHalf = 0;
  private spearSin = 0;
  private spearCos = 0;

  private readonly impactEach = (enemy: Enemy): void => {
    const weapon = this.spearWeapon;
    if (!weapon || enemy.hp <= 0) return;
    if (Math.hypot(enemy.x - this.spearX, enemy.z - this.spearZ) > this.spearAlong + enemy.type.radius) return;
    this.spearStruck++;
    this.host.strike(enemy, weapon, this.spearX, this.spearZ, this.spearFactor);
  };

  private readonly rayEach = (enemy: Enemy): void => {
    const weapon = this.spearWeapon;
    if (!weapon || enemy.hp <= 0) return;
    const dx = enemy.x - this.spearX;
    const dz = enemy.z - this.spearZ;
    const along = dx * this.spearSin + dz * this.spearCos;
    // Was im Einschlag selbst steht, hat der Speer schon getroffen.
    if (along < this.spearAlong || along > this.spearLength + enemy.type.radius) return;
    const across = Math.abs(dx * this.spearCos - dz * this.spearSin);
    if (across > this.spearHalf + enemy.type.radius) return;
    this.host.strike(enemy, weapon, this.spearX, this.spearZ, this.spearFactor);
  };

  /** Der Speer schlägt ein, und vier Strahlen fegen sternförmig über den Boden. */
  private impact(weapon: OwnedWeapon, spear: Spear): void {
    const reach = this.host.stats.reach;
    const radius = M.spearRadius * reach;
    this.spearWeapon = weapon;
    this.spearX = spear.x;
    this.spearZ = spear.z;
    this.spearAlong = radius;
    this.spearFactor = M.spearDamage;
    this.spearStruck = 0;
    this.host.enemies.queryRadius(spear.x, spear.z, radius + 1, this.impactEach);
    this.host.effects.magier.spearImpact(spear.x, spear.z, radius, spear.angle);
    audio.play('evolution.speer', spear.x, spear.z);

    // Die Strahlen stehen im Kreuz, um eine Achtel Drehung gegen die Richtung des Speers versetzt: Keiner zeigt auf die Figur zurück.
    const length = M.spearRayLength * reach;
    const width = M.spearRayWidth * reach;
    this.spearAlong = radius * 0.9;
    this.spearLength = length;
    this.spearHalf = width / 2;
    this.spearFactor = M.spearRayDamage;
    for (let ray = 0; ray < 4; ray++) {
      const angle = spear.angle + Math.PI / 4 + (ray * Math.PI) / 2;
      this.spearSin = Math.sin(angle);
      this.spearCos = Math.cos(angle);
      this.host.enemies.queryRadius(spear.x + this.spearSin * length * 0.5, spear.z + this.spearCos * length * 0.5, length * 0.5 + width, this.rayEach);
      this.host.effects.magier.spearRay(spear.x, spear.z, angle, length, width);
    }
    this.spearWeapon = null;
  }

  // ------------------------------------------------------ Krone der Erloschenen Sor

  /** Ein Schlag der Krone hat einen Gegner im Kreis getroffen: Je länger er darin steht, desto härter brennt es. */
  crownHit(enemy: Enemy, weapon: OwnedWeapon, x: number, z: number, radius: number): void {
    this.crownWeapon = weapon;
    this.crownRadius = radius;
    this.crownSeen = this.clock;
    const ramp = Math.min(enemy.scorch, M.crownRampMax) * M.crownRamp;
    if (ramp > 0.01) this.host.strike(enemy, weapon, x, z, ramp, false);
  }

  /** Ein Gegner ist gestorben; stand er im Kreis der Krone, zerfällt er zu Glut und löst im nächsten Bild eine Hitzewelle aus. */
  crownKill(enemy: Enemy): void {
    const weapon = this.crownWeapon;
    // Die Krone ist nur da, solange ihr Kreis schlägt (`crownHit` meldet sich alle halbe Sekunde).
    if (!weapon || this.clock - this.crownSeen > 1 || this.waveCount >= WAVE_QUEUE) return;
    const origin = this.host.player.position;
    if (Math.hypot(enemy.x - origin.x, enemy.z - origin.z) > this.crownRadius + enemy.type.radius) return;
    const wave = this.waves[this.waveCount++];
    if (!wave) return;
    wave.x = enemy.x;
    wave.z = enemy.z;
  }

  private readonly waveEach = (enemy: Enemy): void => {
    const weapon = this.crownWeapon;
    if (!weapon || enemy.hp <= 0) return;
    if (Math.hypot(enemy.x - this.waveFrom.x, enemy.z - this.waveFrom.z) > M.crownWave + enemy.type.radius) return;
    this.host.strike(enemy, weapon, this.waveFrom.x, this.waveFrom.z, M.crownWaveDamage, false);
    applyStatus(enemy.status, 'burn', M.crownBurnSeconds, M.crownBurnPower, weapon.source);
  };

  /** Die Wellen der Krone, die im letzten Bild entstanden sind (höchstens `crownWaveMax` je Bild, der Rest wartet). */
  private updateWaves(): void {
    const weapon = this.crownWeapon;
    if (!weapon || this.waveCount === 0) {
      this.waveCount = 0;
      return;
    }
    const take = Math.min(this.waveCount, M.crownWaveMax);
    const effects = this.host.effects.magier;
    for (let i = 0; i < take; i++) {
      const wave = this.waves[i];
      if (!wave) continue;
      this.waveFrom = wave;
      this.host.enemies.queryRadius(wave.x, wave.z, M.crownWave + 1, this.waveEach);
      effects.crownWave(wave.x, wave.z, M.crownWave);
    }
    if (take > 0) audio.play('evolution.krone', this.waves[0]?.x ?? 0, this.waves[0]?.z ?? 0);
    // Was nicht drankam, wartet: nach vorn schieben.
    const rest = this.waveCount - take;
    for (let i = 0; i < rest; i++) {
      const from = this.waves[take + i];
      const to = this.waves[i];
      if (from && to) {
        to.x = from.x;
        to.z = from.z;
      }
    }
    this.waveCount = rest;
  }

  /** Das weißglühende Aschefeld der Krone: Jedes Bild aufzurufen; ohne Krone (`weapon` null) erlischt es. */
  crownVisual(weapon: OwnedWeapon | null, x: number, z: number, radius: number): void {
    this.host.effects.magier.crown(weapon !== null, x, z, radius, this.clock, this.dt);
  }

  // ---------------------------------------------------------- Beben der Alten Ordnung

  /** Das Beben beginnt: Drei Ringe rollen hinaus, einer nach dem anderen. */
  quake(weapon: OwnedWeapon, x: number, z: number, radius: number): void {
    let slot = this.quakes.find((quake) => !quake.weapon);
    // Läuft schon alles, ersetzt das neue Beben das älteste.
    slot ??= this.quakes.reduce((oldest, quake) => (quake.time > oldest.time ? quake : oldest));
    slot.weapon = weapon;
    slot.x = x;
    slot.z = z;
    slot.radius = radius;
    slot.time = 0;
    // Die Front steht vor dem Start bei −1: Auch wer mit seiner Kante über der Mitte liegt (Kante < 0), wird noch überlaufen.
    slot.front.fill(-1);
    slot.started.fill(false);
    audio.play('evolution.beben', x, z);
  }

  private readonly ringEach = (enemy: Enemy): void => {
    const quake = this.quakeNow;
    if (!quake || !quake.weapon || enemy.hp <= 0) return;
    const dx = enemy.x - quake.x;
    const dz = enemy.z - quake.z;
    const distance = Math.hypot(dx, dz);
    // Ein Ring trifft, was seine Front in diesem Bild überläuft. Gemessen wird bis zur Kante des Gegners, die der Front zugewandt ist:
    // Mit der Mitte als Maß träfe der Ring einen dicken Gegner in zwei Bildern nacheinander.
    const edge = distance - enemy.type.radius;
    if (edge > this.quakeReach || edge <= this.quakePrev) return;
    const factor = M.quakeDamage[this.quakeRing] ?? 1;
    this.host.strike(enemy, quake.weapon, quake.x, quake.z, factor);
    // Auch Große fliegen weit; nur wen der Verschlinger führt, lassen wir stehen.
    if (enemy.driven) return;
    const meters = enemy.type.scale >= BIG_GAME_SCALE ? M.quakeBigPush : M.quakePush;
    const along = distance > 1e-3 ? 1 / distance : 0;
    enemy.pushX += (distance > 1e-3 ? dx * along : 1) * meters * PUSH_PER_METER;
    enemy.pushZ += (distance > 1e-3 ? dz * along : 0) * meters * PUSH_PER_METER;
  };

  private updateQuakes(dt: number): void {
    const effects = this.host.effects.magier;
    for (const quake of this.quakes) {
      const weapon = quake.weapon;
      if (!weapon) continue;
      quake.time += dt;
      this.quakeNow = quake;
      let finished = true;
      for (let ring = 0; ring < M.quakeRings.length; ring++) {
        const start = ring * M.quakeGap;
        const max = quake.radius * (M.quakeRings[ring] ?? 1);
        if (quake.time < start) {
          finished = false;
          continue;
        }
        if (!quake.started[ring]) {
          quake.started[ring] = true;
          effects.quakeRing(quake.x, quake.z, max, ring, max / M.quakeSpeed);
          // Der innere Ring bricht den Fels in Zacken auf (das Bild des Erdstoßes); der äußere lässt eine Palisade aus Erde stehen.
          if (ring === 0) this.host.effects.quake(quake.x, quake.z, max);
          else if (ring === M.quakeRings.length - 1) this.host.effects.earthRing(quake.x, quake.z, max * 0.92, 1.4, M.quakeFieldSeconds);
        }
        const previous = quake.front[ring] ?? -1;
        const front = Math.min(max, (quake.time - start) * M.quakeSpeed);
        if (front < max) finished = false;
        if (front <= previous) continue;
        this.quakeRing = ring;
        this.quakePrev = previous;
        this.quakeReach = front;
        this.host.enemies.queryRadius(quake.x, quake.z, front + 2, this.ringEach);
        quake.front[ring] = front;
      }
      if (!finished) continue;
      // Am Ende bleibt ein zerrissenes Trümmerfeld, in dem Feinde taumeln und verwundbar sind.
      const radius = quake.radius * 0.95;
      const { rules } = weapon;
      this.host.support.fields.spawn(this.debrisDef, quake.x, quake.z, {
        radius,
        scale: rules.damage * this.host.stats.damage * this.host.traits.dealt,
        source: weapon.source,
      });
      effects.debris(quake.x, quake.z, radius, M.quakeFieldSeconds);
      quake.weapon = null;
    }
    this.quakeNow = null;
  }

  // ---------------------------------------------------------- Griff der Alten Tiefe

  private readonly gatherEach = (enemy: Enemy): void => {
    if (!this.gripWeapon || this.gripCaught >= M.gripMax || enemy.hp <= 0 || enemy.driven || enemy.type.scale >= BIG_GAME_SCALE) return;
    const dx = enemy.x - this.gripX;
    const dz = enemy.z - this.gripZ;
    const along = dx * Math.sin(this.gripAngle) + dz * Math.cos(this.gripAngle);
    if (along < 0 || along > this.gripLength) return;
    const across = Math.abs(dx * Math.cos(this.gripAngle) - dz * Math.sin(this.gripAngle));
    if (across > this.gripWidth / 2 + enemy.type.radius) return;
    const slot = this.pulled[this.gripCaught++];
    if (!slot) return;
    slot.enemy = enemy;
    slot.fromX = enemy.x;
    slot.fromZ = enemy.z;
  };

  /** Das Geflecht bricht aus dem Staub: Die Bahn zielt auf die dichteste Gruppe, sonst auf das Ziel. */
  grip(weapon: OwnedWeapon, x: number, z: number, target: Enemy, range: number): void {
    const reach = this.host.stats.reach;
    const aimed = this.crowd.find(x, z, range, GROUP_RADIUS);
    const angle = aimed ? Math.atan2(this.crowd.siteX - x, this.crowd.siteZ - z) : Math.atan2(target.x - x, target.z - z);
    const length = M.gripLength * reach;
    const width = M.gripWidth * reach;
    // Die Bahn beginnt einen Schritt vor der Figur; ihre Mitte liegt etwas hinter der Hälfte.
    const startX = x + Math.sin(angle) * 1;
    const startZ = z + Math.cos(angle) * 1;
    const centerX = startX + Math.sin(angle) * length * 0.55;
    const centerZ = startZ + Math.cos(angle) * length * 0.55;
    this.gripWeapon = weapon;
    this.gripX = startX;
    this.gripZ = startZ;
    this.gripAngle = angle;
    this.gripLength = length;
    this.gripWidth = width;
    this.gripCaught = 0;
    this.host.enemies.queryRadius(centerX, centerZ, length * 0.5 + width, this.gatherEach);
    const caught = this.gripCaught;
    const bundle = M.gripBundle * reach;
    for (let i = 0; i < caught; i++) {
      const slot = this.pulled[i];
      const enemy = slot?.enemy;
      if (!slot || !enemy) continue;
      // Der Griff trifft jeden einmal; die Zustände des Rangs (festhalten, ausbluten, Nachteil, Blendung) kommen mit dem Treffer.
      this.host.strike(enemy, weapon, startX, startZ, 1, false);
      // Das Bündel liegt auf einer Spirale um die Mitte, damit keiner im anderen steckt.
      const around = i * 2.4;
      const spiral = bundle * Math.sqrt((i + 0.5) / Math.max(caught, 1));
      slot.toX = centerX + Math.sin(around) * spiral;
      slot.toZ = centerZ + Math.cos(around) * spiral;
    }
    this.pulledCount = caught;
    this.pullTime = M.gripPull;
    this.pullTotal = M.gripPull;
    this.gripWeapon = weapon;
    // Das Geflecht zehrt aus, solange es hält.
    const hold = Math.max(statusSeconds(weapon.rules, 'hold'), M.gripPull);
    this.gripDef = {
      id: 'griff-tiefe',
      shape: 'circle',
      duration: hold,
      every: M.gripDrainEvery,
      damage: weapon.def.damage * M.gripDrain,
      onTick: (field) => this.host.effects.magier.gripDrain(field.x, field.z, field.radius),
    };
    const { rules } = weapon;
    this.host.support.fields.spawn(this.gripDef, centerX, centerZ, {
      radius: bundle + 0.4,
      scale: rules.damage * this.host.stats.damage * this.host.traits.dealt,
      source: weapon.source,
    });
    this.host.effects.magier.gripCast(startX, startZ, angle, length, width, centerX, centerZ, bundle, hold);
    audio.play('evolution.griff', centerX, centerZ);
  }

  private updatePull(dt: number): void {
    if (this.pulledCount === 0) return;
    this.pullTime -= dt;
    // Erst schnell, dann langsamer, und am Ende liegen alle genau im Bündel.
    const progress = this.pullTotal > 0 ? Math.min(1, Math.max(0, 1 - this.pullTime / this.pullTotal)) : 1;
    const eased = 1 - (1 - progress) * (1 - progress);
    for (let i = 0; i < this.pulledCount; i++) {
      const slot = this.pulled[i];
      const enemy = slot?.enemy;
      if (!slot || !enemy || enemy.hp <= 0) continue;
      enemy.x = slot.fromX + (slot.toX - slot.fromX) * eased;
      enemy.z = slot.fromZ + (slot.toZ - slot.fromZ) * eased;
    }
    if (this.pullTime > 0) return;
    for (let i = 0; i < this.pulledCount; i++) {
      const slot = this.pulled[i];
      const enemy = slot?.enemy;
      if (!slot || !enemy) continue;
      slot.enemy = null;
      if (enemy.hp > 0) this.host.effects.entangle(enemy.x, enemy.z, enemy.type.radius, M.gripPull + 2.1);
    }
    this.pulledCount = 0;
  }

  // ---------------------------------------------------------- Orkan der Alten Ordnung

  /** Der dauerhafte Luftstrom: Jedes Bild aufzurufen; `weapon` ist die Sturmböe, wenn sie der Orkan ist, sonst null. */
  keepGale(weapon: OwnedWeapon | null, x: number, z: number, dt: number): void {
    this.host.effects.magier.gale(weapon !== null, x, z, dt);
    if (!weapon) return;
    this.galeGap -= dt;
    if (this.galeGap > 0) return;
    this.galeGap = GALE_RENEW;
    this.host.support.progression.addBuff(GALE);
  }

  /** Eine Böe des Orkans zerreibt die feindlichen Zauber in der Nähe der Figur. */
  galeGust(x: number, z: number, angle: number, range: number, width: number, second: boolean): void {
    this.host.dissolve(x, z, M.galeCancel);
    this.host.effects.magier.galeGust(x, z, angle, range, width, second);
    if (!second) audio.play('evolution.orkan', x, z);
  }

  // ---------------------------------------------------------- Kuppel der Alten Ordnung

  /**
   * Die Runen der Kuppel: Jedes Bild aufzurufen. `weapon` ist der Schild, wenn er die Kuppel ist; sonst null. `charges` ist die Zahl der
   * Runen, die noch stehen.
   */
  runes(weapon: OwnedWeapon | null, charges: number, x: number, z: number, dt: number): void {
    this.domeWeapon = weapon;
    this.domeCharges = weapon ? charges : 0;
    this.domePhase += dt * M.domeSpin;
    this.host.effects.magier.runes(this.domeCharges, x, z, this.domePhase, this.clock, dt);
    if (this.domeCharges <= 0) return;
    this.domeGap -= dt;
    if (this.domeGap > 0) return;
    this.domeGap = DOME_LOOK;
    this.host.dissolve(x, z, M.domeCancel);
  }

  private readonly shockEach = (enemy: Enemy): void => {
    const weapon = this.domeWeapon;
    if (!weapon || enemy.hp <= 0) return;
    const origin = this.host.player.position;
    const dx = enemy.x - origin.x;
    const dz = enemy.z - origin.z;
    const distance = Math.hypot(dx, dz);
    if (distance > M.domeRange + enemy.type.radius) return;
    // Die Welle fährt in Blickrichtung: Wer seitlich oder dahinter steht, bleibt unberührt.
    const offset = Math.atan2(dx, dz) - this.host.player.facing;
    if (Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset))) > M.domeArc / 2 && distance > enemy.type.radius + 0.6) return;
    const along = distance > 1e-3 ? 1 / distance : 0;
    const push = enemy.driven ? 0 : (M.domePush / Math.max(enemy.type.scale, 1)) * PUSH_PER_METER;
    const amount = M.domeDamage * this.host.stats.damage * this.host.traits.dealt;
    this.host.enemies.damage(enemy, amount, dx * along * push, dz * along * push, weapon.source);
    const status: StatusApply = { kind: 'blind', seconds: M.domeBlind, power: 0.5 };
    applyStatus(enemy.status, status.kind, status.seconds, status.power, weapon.source);
  };

  /** Eine Rune ist zerbrochen: Eine scharfe Staub-Druckwelle fährt in Blickrichtung aus. */
  runeBroke(): void {
    if (!this.domeWeapon) return;
    const origin = this.host.player.position;
    this.host.enemies.queryRadius(origin.x, origin.z, M.domeRange + 1, this.shockEach);
    this.host.effects.magier.runeBreak(origin.x, origin.z, this.host.player.facing, M.domeRange, M.domeArc);
    audio.play('evolution.kuppel', origin.x, origin.z);
  }
}
