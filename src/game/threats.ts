/**
 * Was die Geschöpfe der Finsternis gegen die Spielfigur wirken, und wie es sich ankündigt.
 *
 * Der Schwarze Sog folgt der Vorlage (Domäne Finsternis): Der Staub nimmt die Wärme einer Stelle.
 * Sein Schaden verstaubt, und in der großen Form erlischt jede Flamme in der Fläche.
 * Alles kündigt sich am Boden an, damit man ausweichen kann; selbst leuchten darf dabei nur
 * der kalte Rand, denn die Finsternis gibt kein Licht.
 */
import * as THREE from 'three';
import { audio } from '../audio';
import type { Enemy } from './enemies';
import { Particles, type Particle } from './particles';
import type { Player } from './player';
import { Strips, type Strip } from './strips';
import type { Site, Zones } from './zones';

/** Die Farbe, in der Finsternis sich verrät: kaltes, fahles Blau. */
const COLD = 0x6f8cff;
const DARK_DUST = 0x3a3d4c;
const WHITE = new THREE.Color(1, 1, 1);
const TAU = Math.PI * 2;

/** Ein Schwarzer Sog, der sich ankündigt und dann wirkt. */
export interface Sog extends Site {
  radius: number;
  /** Sekunden bis zur Wirkung. */
  delay: number;
  damage: number;
  /** Löscht brennende Feuerschalen in der Fläche. */
  quench: boolean;
  /** Stirbt der Wirkende vorher, verfällt der Zauber. */
  owner: Enemy | null;
  field: Strip;
  rim: Strip;
}

export class Threats {
  readonly group = new THREE.Group();
  /** Laufende Flächen; der Messlauf weicht ihnen aus. */
  readonly sogs: Sog[] = [];
  /** Feuerschalen, die ein Sog gelöscht hat, seit jemand zuletzt nachgesehen hat; für die Anzeige. */
  quenched = 0;
  private readonly strips = new Strips();
  private readonly motes = new Particles(500, 'glow');
  private readonly dust = new Particles(500, 'dust');
  private readonly lightTint = new THREE.Color();
  private readonly particle: Particle = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size: 0.1,
    grow: 0,
    gravity: 0,
    drag: 0,
    color: new THREE.Color(),
    alpha: 1,
  };

  constructor() {
    this.group.add(this.strips.group, this.dust.points, this.motes.points);
  }

  reset(): void {
    this.sogs.length = 0;
    this.quenched = 0;
    this.strips.reset();
    this.motes.reset();
    this.dust.reset();
  }

  resize(pixelHeight: number, fovDegrees: number): void {
    this.motes.resize(pixelHeight, fovDegrees);
    this.dust.resize(pixelHeight, fovDegrees);
  }

  /** Kündigt einen Schwarzen Sog an; nach `delay` Sekunden trifft er, wer dann noch in der Fläche steht. */
  sog(x: number, z: number, radius: number, delay: number, damage: number, owner: Enemy | null, quench = false): void {
    const field = this.strips.spawn({ look: 'sogfeld', x, z, inner: 0, outer: radius, y: 0.05, opacity: 0.85, life: delay + 0.05 });
    const rim = this.strips.spawn({
      look: 'sogrand',
      x,
      z,
      inner: 0,
      outer: radius,
      y: 0.07,
      color: COLD,
      opacity: quench ? 0.5 : 0.4,
      life: delay + 0.05,
    });
    this.sogs.push({ x, z, radius, delay, damage, quench, owner, field, rim });
    audio.play('sog.ankuendigung', x, z);
  }

  /** Kündigt den Hieb des Verschlingers an: die Fläche vor ihm, die seine Faust gleich trifft. */
  arc(x: number, z: number, angle: number, width: number, reach: number, seconds: number): void {
    const shape = { x, z, angle, width, inner: reach * 0.25, outer: reach, life: seconds + 0.08 };
    this.strips.spawn({ ...shape, look: 'sogfeld', y: 0.05, opacity: 0.7 });
    this.strips.spawn({ ...shape, look: 'sogrand', y: 0.07, color: COLD, opacity: 0.45 });
  }

  /** Kündigt die Bahn eines Ansturms an. */
  lane(x: number, z: number, angle: number, length: number, width: number, seconds: number): void {
    this.strips.spawn({ look: 'bahn', x, z, angle, width, inner: 0.5, outer: length, y: 0.07, color: COLD, opacity: 0.4, life: seconds });
  }

  /** Staub, der aufgewirbelt wird, wo etwas Schweres aufschlägt. */
  thud(x: number, z: number, radius: number): void {
    this.strips.spawn({
      look: 'dustring',
      x,
      z,
      inner: radius * 0.3,
      outer: radius * 0.6,
      innerTo: radius,
      outerTo: radius * 1.4,
      color: 0xa3927a,
      opacity: 0.8,
      life: 0.6,
    });
  }

  update(dt: number, player: Player, zones: Zones): void {
    for (let i = this.sogs.length - 1; i >= 0; i--) {
      const sog = this.sogs[i];
      if (!sog) continue;
      if (sog.owner && sog.owner.hp <= 0) {
        // Der Wirkende ist gefallen: Der Auftrag an den Staub verfällt.
        this.strips.cancel(sog.field, 0.25);
        this.strips.cancel(sog.rim, 0.25);
        this.sogs.splice(i, 1);
        continue;
      }
      sog.delay -= dt;
      this.draw(sog, dt);
      if (sog.delay > 0) continue;
      this.sogs.splice(i, 1);
      this.strike(sog, player, zones);
    }

    const tint = this.lightTint.copy(player.lightColor).lerp(WHITE, 0.45);
    this.strips.update(dt, player.light, tint);
    this.motes.update(dt, player.light, tint);
    this.dust.update(dt, player.light, tint);
  }

  /** Solange der Sog sich aufbaut, zieht er Staub vom Rand zur Mitte. */
  private draw(sog: Sog, dt: number): void {
    const wanted = sog.radius * 9 * dt;
    const p = this.particle;
    for (let n = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0); n > 0; n--) {
      const angle = Math.random() * TAU;
      const from = sog.radius * (0.55 + 0.45 * Math.random());
      const speed = from / 0.55;
      const cold = Math.random() < 0.35;
      p.x = sog.x + Math.sin(angle) * from;
      p.y = 0.1 + Math.random() * 0.5;
      p.z = sog.z + Math.cos(angle) * from;
      p.vx = -Math.sin(angle) * speed;
      p.vy = 0.2 + Math.random() * 0.5;
      p.vz = -Math.cos(angle) * speed;
      p.life = 0.5;
      p.gravity = 0;
      p.drag = 0.6;
      if (cold) {
        p.size = 0.05 + Math.random() * 0.04;
        p.grow = -0.04;
        p.color.set(COLD);
        p.alpha = 0.55;
        this.motes.spawn(p);
      } else {
        p.size = 0.3 + Math.random() * 0.25;
        p.grow = -0.3;
        p.color.set(DARK_DUST);
        p.alpha = 0.5;
        this.dust.spawn(p);
      }
    }
  }

  private strike(sog: Sog, player: Player, zones: Zones): void {
    const { x, z, radius } = sog;
    audio.play('sog.wirkung', x, z);
    // Der Ring schnürt sich zu: Was er einschließt, verliert seine Wärme.
    this.strips.spawn({
      look: 'ring',
      x,
      z,
      inner: radius * 0.85,
      outer: radius,
      innerTo: 0.05,
      outerTo: radius * 0.22,
      y: 0.12,
      color: COLD,
      opacity: 0.7,
      life: 0.35,
    });
    this.strips.spawn({
      look: 'dustring',
      x,
      z,
      inner: radius * 0.6,
      outer: radius,
      innerTo: 0.1,
      outerTo: radius * 0.4,
      color: DARK_DUST,
      opacity: 0.9,
      life: 0.5,
    });
    const p = this.particle;
    for (let n = Math.round(10 + radius * 4); n > 0; n--) {
      const angle = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * radius * 0.5;
      p.x = x + Math.sin(angle) * r;
      p.y = 0.2 + Math.random() * 0.6;
      p.z = z + Math.cos(angle) * r;
      p.vx = Math.sin(angle) * 0.5;
      p.vy = 1 + Math.random() * 2.2;
      p.vz = Math.cos(angle) * 0.5;
      p.life = 0.5 + Math.random() * 0.6;
      p.size = 0.06 + Math.random() * 0.05;
      p.grow = -0.05;
      p.gravity = 0;
      p.drag = 1.4;
      p.color.set(COLD);
      p.alpha = 0.8;
      this.motes.spawn(p);
    }

    const position = player.position;
    if (Math.hypot(position.x - x, position.z - z) <= radius) player.hurt(sog.damage, true, true);
    if (sog.quench) this.quenched += zones.quench(x, z, radius);
  }
}
