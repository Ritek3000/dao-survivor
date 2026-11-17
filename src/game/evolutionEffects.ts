/**
 * Wie die Evolutionen aussehen (Rang 6, siehe `evolutions.ts`). Sie nutzen dieselben Bausteine wie `effects.ts` (Flächen aus dem
 * Shader, Teilchen) und zwei kleine Gegenstände: die kreisenden Äxte des Sturms der Klingen, die schwebende Reliquie und die Eisenstangen
 * des Bollwerks. `Effects` gibt ihnen seinen Werkzeugkasten (`EffectTools`) und zeichnet nichts selbst dafür.
 *
 * Wie dort gilt: Im Kampf entsteht nichts Neues. Gehaltene Flächen werden nachgeführt und beim Ende ausgeblendet, Teilchen kommen
 * aus dem Vorrat, die Gegenstände sind Instanznetze fester Größe.
 */
import * as THREE from 'three';
import type { Random } from '../core/random';
import type { Particle, Particles } from './particles';
import { bannerGeometry, propMaterial, spikeGeometry, throwingAxeGeometry } from './props';
import type { Strip, Strips } from './strips';

/** Was `Effects` den Evolutionen von seinen Bausteinen reicht. */
export interface EffectTools {
  strips: Strips;
  glow: Particles;
  dust: Particles;
  random: Random;
  /** Ein Teilchen als Vorlage, damit nichts entsteht. */
  particle: Particle;
  after(seconds: number, run: () => void): void;
  groundWave(x: number, z: number, radius: number, color: number, opacity: number): void;
  puff(x: number, z: number, angle: number, speed: number, color: number, alpha?: number): void;
  sparks(x: number, y: number, z: number, count: number, color: number, speed: number): void;
  flash(x: number, y: number, z: number, color: number, intensity: number, distance: number, seconds: number): void;
  /** Pfeile gehen auf einen Kreis nieder (ohne den Ring des Pfeilhagels), von der Seite des Schützen aus gesehen. */
  hailArrows(x: number, z: number, radius: number, delay: number, fromX: number, fromZ: number, arrows: number): void;
}

/** Wo eine kreisende Axt gerade ist und wohin sie zeigt (Radiant, Richtung ihres Flugs). */
export interface OrbitSite {
  x: number;
  z: number;
  angle: number;
}

/** So viele kreisende Äxte und Eisenstangen zeichnet der Kampf höchstens zugleich. */
export const ORBIT_CAPACITY = 6;
export const SPIKE_CAPACITY = 9;

const DUST = 0xa3927a;
const EARTH = 0x8a775c;
const SOR = 0xffe6a8;
const STEEL = 0xffeed2;
const BLOOD = 0xb23a30;
const TAU = Math.PI * 2;

const pose = new THREE.Object3D();
pose.rotation.order = 'YXZ';

export class EvolutionEffects {
  readonly group = new THREE.Group();
  private readonly axeMesh: THREE.InstancedMesh;
  private readonly spikeMesh: THREE.InstancedMesh;
  private readonly relicMesh: THREE.InstancedMesh;
  private relicRing: Strip | null = null;
  private relicGlow: Strip | null = null;
  private vortexRing: Strip | null = null;
  private vortexGust: Strip | null = null;
  private vortexShimmer: Strip | null = null;
  private bulwarkArc: Strip | null = null;
  private bulwarkGlow: Strip | null = null;

  constructor(private readonly tools: EffectTools) {
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadow: boolean) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      mesh.count = 0;
      return mesh;
    };
    this.axeMesh = instanced(throwingAxeGeometry(), propMaterial(0.5), ORBIT_CAPACITY, false);
    this.spikeMesh = instanced(spikeGeometry(), propMaterial(0.55), SPIKE_CAPACITY, true);
    this.relicMesh = instanced(bannerGeometry(), propMaterial(0.85), 1, true);
    this.group.add(this.axeMesh, this.spikeMesh, this.relicMesh);
  }

  reset(): void {
    this.relicRing = this.relicGlow = this.vortexRing = this.vortexGust = this.vortexShimmer = this.bulwarkArc = this.bulwarkGlow = null;
    for (const mesh of [this.axeMesh, this.spikeMesh, this.relicMesh]) mesh.count = 0;
  }

  // ------------------------------------------------------------------ Allgemein

  /** Der Angriff entwickelt sich: Ringe aus Licht steigen vom Boden, goldene Körner fliegen auf. */
  awaken(x: number, z: number): void {
    const { strips, random, particle: p } = this.tools;
    strips.spawn({ look: 'ring', x, z, inner: 0.3, outer: 0.8, innerTo: 3.2, outerTo: 3.7, y: 0.06, color: SOR, opacity: 1.1, life: 0.9 });
    strips.spawn({ look: 'pulse', x, z, inner: 0.4, outer: 4.5, y: 0.08, color: SOR, opacity: 0.5, life: 1.2 });
    this.tools.groundWave(x, z, 4, SOR, 0.8);
    this.tools.flash(x, 1.6, z, SOR, 7, 12, 0.7);
    for (let i = 0; i < 46; i++) {
      const a = random() * TAU;
      const r = 0.6 + random() * 1.6;
      p.x = x + Math.sin(a) * r;
      p.y = 0.1 + random() * 0.3;
      p.z = z + Math.cos(a) * r;
      p.vx = Math.sin(a) * 0.3;
      p.vy = 1.6 + random() * 2.6;
      p.vz = Math.cos(a) * 0.3;
      p.life = 0.9 + random() * 0.8;
      p.size = 0.07 + random() * 0.08;
      p.grow = -0.03;
      p.gravity = -0.4;
      p.drag = 0.7;
      p.color.setRGB(1.8, 1.4 + random() * 0.4, 0.6);
      p.alpha = 1;
      this.tools.glow.spawn(p);
    }
  }

  // ------------------------------------------------------------ Henkersbeil

  /** Die Sichel: Mondsicheln aus Staub und Stahl jagen nacheinander die Strecke entlang, hinter ihnen bleibt aufgewirbelter Staub. */
  sickle(x: number, z: number, angle: number, length: number, width: number): void {
    const { strips, random } = this.tools;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const reach = (length * (i + 1)) / steps;
      this.tools.after(i * 0.04, () => {
        strips.spawn({ look: 'slash', x, z, angle, width: 1.7, inner: reach - 1.1, outer: reach + 0.5, y: 1.1, color: 0xffe2b0, opacity: 1.25, life: 0.3 });
        strips.spawn({ look: 'dustring', x, z, angle, width: 1.7, inner: reach - 1.4, outer: reach - 0.2, color: DUST, opacity: 0.7, life: 0.5 });
      });
    }
    strips.spawn({ look: 'glutlinie', x, z, angle, width: width * 0.7, inner: 0.5, outer: length, y: 0.05, color: 0xffd9a0, opacity: 0.8, life: 0.7 });
    strips.spawn({ look: 'shock', x, z, angle, width: 1.6, inner: 0.5, outer: 1.6, innerTo: length * 0.9, outerTo: length * 1.05, y: 1, life: 0.4 });
    for (let i = 0; i < 18; i++) {
      const along = 1 + random() * (length - 1);
      const side = (random() - 0.5) * width;
      this.tools.puff(x + Math.sin(angle) * along + Math.cos(angle) * side, z + Math.cos(angle) * along - Math.sin(angle) * side, angle, 2.5, DUST);
    }
    this.tools.sparks(x + Math.sin(angle) * length, 1, z + Math.cos(angle) * length, 10, 0xffe2b0, 4);
  }

  // ---------------------------------------------------------------- Reliquie

  /**
   * Die Reliquie der Nimmersatten: Das Banner schwebt über der Figur und dreht sich langsam; am Boden liegt der Kreis, in dem sie
   * saugt. Ohne `active` klingt alles aus.
   */
  relic(active: boolean, x: number, z: number, radius: number, lift: number, time: number): void {
    const { strips } = this.tools;
    if (!active) {
      for (const strip of [this.relicRing, this.relicGlow]) if (strip) strips.release(strip, 0.4);
      this.relicRing = this.relicGlow = null;
      this.relicMesh.count = 0;
      return;
    }
    this.relicRing ??= strips.spawn({ look: 'ring', x, z, inner: radius * 0.95, outer: radius * 1.02, y: 0.05, color: BLOOD, opacity: 0.5, life: Infinity });
    this.relicGlow ??= strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.15, y: 0.04, color: 0x8f1d18, opacity: 0.1, life: Infinity });
    for (const strip of [this.relicRing, this.relicGlow]) {
      strip.x = x;
      strip.z = z;
    }
    this.relicRing.spec.inner = radius * 0.95;
    this.relicRing.spec.outer = radius * 1.02;
    this.relicGlow.spec.outer = radius * 1.15;
    this.relicRing.opacity = 0.45 + 0.12 * Math.sin(time * 3.1);
    pose.position.set(x, lift + 0.08 * Math.sin(time * 1.7), z);
    pose.rotation.set(0.04 * Math.sin(time * 1.9), time * 0.8, 0.07 * Math.sin(time * 1.3));
    pose.scale.setScalar(0.62);
    pose.updateMatrix();
    this.relicMesh.setMatrixAt(0, pose.matrix);
    this.relicMesh.count = 1;
    this.relicMesh.instanceMatrix.needsUpdate = true;
  }

  /** Ein Funke Lebenskraft fliegt von einem Ausgesaugten zum Banner. */
  drain(fromX: number, fromZ: number, toX: number, toZ: number, lift: number): void {
    const { random, particle: p } = this.tools;
    const seconds = 0.5 + random() * 0.2;
    p.x = fromX;
    p.y = 0.7 + random() * 0.5;
    p.z = fromZ;
    p.vx = (toX - fromX) / seconds;
    p.vy = (lift - p.y) / seconds;
    p.vz = (toZ - fromZ) / seconds;
    p.life = seconds;
    p.size = 0.1 + random() * 0.06;
    p.grow = -0.08;
    p.gravity = 0;
    p.drag = 0;
    p.color.setRGB(1.7, 0.25, 0.2);
    p.alpha = 1;
    this.tools.glow.spawn(p);
  }

  // ------------------------------------------------------------ Sturm der Klingen

  /** Die kreisenden Äxte: `count` Plätze aus `sites`, jede flach in ihrer Flugrichtung und sich überschlagend. */
  showOrbit(sites: readonly OrbitSite[], count: number, time: number): void {
    const shown = Math.min(count, ORBIT_CAPACITY);
    for (let i = 0; i < shown; i++) {
      const site = sites[i];
      if (!site) continue;
      // Flach und um die Hochachse kreiselnd: Von der Kamera aus zeigt die Klinge so immer ihre Fläche.
      pose.position.set(site.x, 1.1, site.z);
      pose.rotation.set(1.15, site.angle + time * 14 + i, 0, 'YXZ');
      pose.scale.setScalar(2.3);
      pose.updateMatrix();
      this.axeMesh.setMatrixAt(i, pose.matrix);
    }
    pose.rotation.order = 'XYZ';
    this.axeMesh.count = shown;
    this.axeMesh.instanceMatrix.needsUpdate = true;
  }

  /** Der Ring aus gebundenem Staub, in dem die Äxte kreisen. */
  stormRing(x: number, z: number, radius: number, seconds: number): void {
    const { strips } = this.tools;
    strips.spawn({ look: 'dustring', x, z, inner: radius - 0.7, outer: radius + 0.7, color: DUST, opacity: 0.75, life: seconds });
    strips.spawn({ look: 'ring', x, z, inner: radius - 0.1, outer: radius + 0.1, y: 0.9, color: STEEL, opacity: 0.35, life: seconds });
    this.tools.groundWave(x, z, radius * 1.2, DUST, 0.5);
  }

  /** Die Äxte fliegen: ein Stoß geht von der Figur aus. */
  stormLaunch(x: number, z: number, radius: number): void {
    this.tools.groundWave(x, z, radius * 1.6, DUST, 0.7);
    this.tools.sparks(x, 1.1, z, 18, STEEL, 5);
    for (let i = 0; i < 8; i++) this.tools.puff(x, z, (i / 8) * TAU, 3, DUST);
  }

  // --------------------------------------------------------------- Mahlstrom

  /** Der Tornado um die Figur: ein Ring aus Staub, Windfahnen und flimmernde Luft, dazu kreisende Körner. Ohne `active` klingt er aus. */
  vortex(active: boolean, x: number, z: number, radius: number, time: number, dt: number): void {
    const { strips, random, particle: p } = this.tools;
    if (!active) {
      for (const strip of [this.vortexRing, this.vortexGust, this.vortexShimmer]) if (strip) strips.release(strip, 0.5);
      this.vortexRing = this.vortexGust = this.vortexShimmer = null;
      return;
    }
    this.vortexRing ??= strips.spawn({ look: 'dustring', x, z, inner: radius * 0.35, outer: radius, color: DUST, opacity: 0.8, life: Infinity });
    this.vortexGust ??= strips.spawn({ look: 'gust', x, z, inner: 0.5, outer: radius, y: 0.5, color: 0xd8d2c4, opacity: 0.3, life: Infinity });
    this.vortexShimmer ??= strips.spawn({ look: 'shimmer', x, z, inner: radius * 0.8, outer: radius * 0.9, y: 0, span: 3.2, opacity: 1, life: Infinity });
    for (const strip of [this.vortexRing, this.vortexGust, this.vortexShimmer]) {
      strip.x = x;
      strip.z = z;
    }
    this.vortexRing.spec.inner = radius * 0.35;
    this.vortexRing.spec.outer = radius;
    this.vortexGust.spec.outer = radius;
    this.vortexShimmer.spec.inner = radius * 0.8;
    this.vortexShimmer.spec.outer = radius * 0.9;
    // Körner und Eisensplitter kreisen im Tornado und steigen dabei auf.
    const wanted = 90 * dt;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = random() * TAU;
      const r = radius * (0.25 + 0.75 * random());
      const speed = 6 + random() * 4;
      p.x = x + Math.sin(a) * r;
      p.y = 0.1 + random() * 0.6;
      p.z = z + Math.cos(a) * r;
      // Tangential, nach links herum, mit leichtem Zug nach innen.
      p.vx = Math.cos(a) * speed - Math.sin(a) * 1.2;
      p.vz = -Math.sin(a) * speed - Math.cos(a) * 1.2;
      p.vy = 1.6 + random() * 2.2;
      p.life = 0.5 + random() * 0.5;
      const spark = random() < 0.25;
      p.size = spark ? 0.06 : 0.35 + random() * 0.3;
      p.grow = spark ? 0 : 1.1;
      p.gravity = -0.2;
      p.drag = 0.6;
      if (spark) p.color.setRGB(1.6, 1.5, 1.3);
      else p.color.set(DUST);
      p.alpha = spark ? 1 : 0.45;
      (spark ? this.tools.glow : this.tools.dust).spawn(p);
    }
    this.vortexGust.opacity = 0.28 + 0.06 * Math.sin(time * 9);
  }

  /** Am Ende des Mahlstroms: Die Druckwelle fährt nach außen, Staub und Eisen fliegen. */
  vortexBlast(x: number, z: number, radius: number): void {
    const { strips } = this.tools;
    this.tools.groundWave(x, z, radius, DUST, 0.95);
    this.tools.after(0.12, () => this.tools.groundWave(x, z, radius * 0.8, DUST, 0.6));
    strips.spawn({ look: 'shock', x, z, inner: 0.5, outer: 1.5, innerTo: radius * 0.9, outerTo: radius * 1.2, y: 1, life: 0.5 });
    strips.spawn({ look: 'ring', x, z, inner: 0.4, outer: 0.8, innerTo: radius * 0.85, outerTo: radius * 0.95, y: 0.9, color: STEEL, opacity: 0.6, life: 0.4 });
    for (let i = 0; i < 28; i++) this.tools.puff(x, z, (i / 28) * TAU + this.tools.random() * 0.2, 6, DUST, 0.7);
    this.tools.sparks(x, 1, z, 26, STEEL, 7);
    this.tools.flash(x, 1.4, z, 0xffe2b0, 5, 11, 0.4);
  }

  // ------------------------------------------------------------------ Spalter

  /** Das Ausholen des Spalters: Ein Ring aus Staub zieht sich auf den Einschlagpunkt zusammen. */
  cleaveMark(x: number, z: number, radius: number, seconds: number): void {
    const { strips } = this.tools;
    strips.spawn({ look: 'dustring', x, z, inner: radius * 0.8, outer: radius, innerTo: 0.1, outerTo: radius * 0.3, color: DUST, opacity: 0.85, life: seconds });
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.95, outer: radius, innerTo: 0.1, outerTo: 0.4, y: 0.06, color: 0xe0a060, opacity: 0.45, life: seconds });
  }

  /** Staub strömt zum Einschlagpunkt (jedes Bild einige Körner, solange die Axt ausholt). */
  suck(x: number, z: number, radius: number, dt: number): void {
    const { random, particle: p } = this.tools;
    const wanted = 70 * dt;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = random() * TAU;
      const r = radius * (0.5 + 0.5 * random());
      const seconds = 0.35 + random() * 0.2;
      p.x = x + Math.sin(a) * r;
      p.y = 0.1 + random() * 0.5;
      p.z = z + Math.cos(a) * r;
      p.vx = (-Math.sin(a) * r) / seconds;
      p.vy = 0.6;
      p.vz = (-Math.cos(a) * r) / seconds;
      p.life = seconds;
      p.size = 0.3 + random() * 0.3;
      p.grow = -0.3;
      p.gravity = 0;
      p.drag = 0;
      p.color.set(DUST);
      p.alpha = 0.5;
      this.tools.dust.spawn(p);
    }
  }

  /** Der Niederschlag: Der Boden bricht in einer langen Linie auf, Funken und Staub steigen aus dem Spalt. */
  cleave(x: number, z: number, angle: number, length: number, width: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'glutlinie', x, z, angle, width: width * 0.9, inner: 0.8, outer: length, y: 0.05, color: 0xff8a30, opacity: 1.1, life: 2.4 });
    strips.spawn({ look: 'glutlinie', x, z, angle, width: width * 0.35, inner: 0.8, outer: length, y: 0.06, color: 0xffd9a0, opacity: 0.9, life: 1.6 });
    for (let i = 0; i < 6; i++) {
      const reach = (length * (i + 1)) / 6;
      this.tools.after(i * 0.03, () => {
        strips.spawn({ look: 'shock', x, z, angle, width: 0.5, inner: reach - 1.2, outer: reach, innerTo: reach, outerTo: reach + 1.6, y: 0.6, life: 0.3 });
      });
    }
    for (let i = 0; i < 26; i++) {
      const along = 0.8 + random() * (length - 0.8);
      const side = (random() - 0.5) * width * 0.6;
      this.tools.puff(x + Math.sin(angle) * along + Math.cos(angle) * side, z + Math.cos(angle) * along - Math.sin(angle) * side, angle + (random() - 0.5) * 3, 3, EARTH, 0.7);
    }
    for (let i = 0; i < 6; i++) {
      const along = 1 + random() * (length - 1);
      this.tools.sparks(x + Math.sin(angle) * along, 0.3, z + Math.cos(angle) * along, 6, 0xffa050, 5);
    }
    this.tools.flash(x + Math.sin(angle) * length * 0.4, 1, z + Math.cos(angle) * length * 0.4, 0xffa050, 6, 12, 0.45);
  }

  // ------------------------------------------------------------------- Donner

  /** Der Donner: eine Wand aus Schall und Staub fährt als Kegel hinaus. */
  thunder(x: number, z: number, angle: number, range: number, arc: number): void {
    const { strips, random } = this.tools;
    for (const [y, opacity] of [
      [0.45, 0.3],
      [1.4, 0.14],
    ] as const) {
      strips.spawn({ look: 'gust', x, z, angle, width: arc * 1.1, inner: 0.6, outer: range * 1.05, y, color: 0xe8e0d0, opacity, life: 0.7 });
    }
    strips.spawn({ look: 'dustring', x, z, angle, width: arc, inner: range * 0.2, outer: range * 0.45, innerTo: range * 0.85, outerTo: range * 1.15, color: DUST, opacity: 0.85, life: 0.7 });
    for (let i = 0; i < 3; i++) {
      this.tools.after(i * 0.1, () => {
        strips.spawn({ look: 'shock', x, z, angle, width: arc, inner: 0.4, outer: 1.5, innerTo: range * 0.8, outerTo: range * 1.15, y: 1, life: 0.5 });
      });
    }
    strips.spawn({ look: 'slash', x, z, angle, width: arc, inner: range * 0.55, outer: range * 1.02, y: 1.3, color: 0xffd9a0, opacity: 0.8, life: 0.35 });
    const p = this.tools.particle;
    for (let i = 0; i < 60; i++) {
      const a = angle + (random() - 0.5) * arc;
      const speed = 12 + random() * 12;
      p.x = x + Math.sin(a) * 0.8;
      p.y = 0.15 + random() * 1.1;
      p.z = z + Math.cos(a) * 0.8;
      p.vx = Math.sin(a) * speed;
      p.vy = random() * 0.8;
      p.vz = Math.cos(a) * speed;
      p.life = 0.5 + random() * 0.5;
      p.size = 0.3 + random() * 0.35;
      p.grow = 0.9;
      p.gravity = 0;
      p.drag = 2;
      p.color.set(DUST);
      p.alpha = 0.45;
      this.tools.dust.spawn(p);
    }
    this.tools.flash(x + Math.sin(angle) * 2, 1.4, z + Math.cos(angle) * 2, 0xffe2b0, 6, 12, 0.35);
  }

  // ----------------------------------------------------------------- Bollwerk

  /**
   * Das Bollwerk: Eisenstangen fächern sich vor der Figur, ein schwacher Bogen am Boden zeigt, wie weit die Aura reicht. Ohne `active`
   * verschwindet alles.
   */
  bulwark(active: boolean, x: number, z: number, angle: number, start: number, length: number, width: number, time: number): void {
    const { strips } = this.tools;
    if (!active) {
      for (const strip of [this.bulwarkArc, this.bulwarkGlow]) if (strip) strips.release(strip, 0.3);
      this.bulwarkArc = this.bulwarkGlow = null;
      this.spikeMesh.count = 0;
      return;
    }
    const reach = start + length;
    const opening = 2 * Math.atan(width / 2 / Math.max(reach * 0.7, 0.5));
    this.bulwarkArc ??= strips.spawn({ look: 'ring', x, z, angle, width: opening, inner: start, outer: reach, y: 0.05, color: 0xd88a4a, opacity: 0.22, life: Infinity });
    this.bulwarkGlow ??= strips.spawn({ look: 'glow', x, z, inner: 0, outer: reach * 0.9, y: 0.04, color: 0xd88a4a, opacity: 0.05, life: Infinity });
    this.bulwarkArc.x = this.bulwarkGlow.x = x;
    this.bulwarkArc.z = this.bulwarkGlow.z = z;
    this.bulwarkArc.angle = angle;
    this.bulwarkArc.spec.width = opening;
    this.bulwarkArc.spec.inner = start;
    this.bulwarkArc.spec.outer = reach;
    this.bulwarkArc.opacity = 0.2 + 0.05 * Math.sin(time * 4);
    // Ein Fächer aus Stangen, die schräg nach vorn und etwas nach oben zeigen.
    for (let i = 0; i < SPIKE_CAPACITY; i++) {
      const spread = (i / (SPIKE_CAPACITY - 1) - 0.5) * opening * 0.95;
      const a = angle + spread;
      const base = 0.45 + 0.1 * Math.cos(i * 2.3);
      pose.position.set(x + Math.sin(a) * base, 0.5 + 0.28 * Math.cos(spread * 2.2) + 0.05 * Math.sin(time * 2 + i), z + Math.cos(a) * base);
      pose.rotation.set(-0.28 - 0.06 * Math.sin(i * 1.7), a, 0);
      pose.scale.setScalar(0.85 + 0.1 * Math.cos(i * 1.3));
      pose.updateMatrix();
      this.spikeMesh.setMatrixAt(i, pose.matrix);
    }
    this.spikeMesh.count = SPIKE_CAPACITY;
    this.spikeMesh.instanceMatrix.needsUpdate = true;
  }
}
