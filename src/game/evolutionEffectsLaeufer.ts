/**
 * Wie die Evolutionen des Wildnisläufers aussehen (siehe `evolutionsLaeufer.ts`): Staubwolken und Staub-Pfeile, der Schauer der
 * Aschenfedern, die Riesen-Fangeisen mit ihren Ketten, der Fächer aus Messern, Beutel und Nebelwände, das Staub-Phantom und das
 * Schleppnetz. Dieselben Bausteine wie `evolutionEffects.ts` (Flächen aus dem Shader, Teilchen) und drei kleine Gegenstände aus festen
 * Instanznetzen: die Eisen, die Beutel und das Phantom.
 *
 * Im Kampf entsteht nichts Neues: Gehaltene Flächen werden nachgeführt und beim Ende ausgeblendet, Teilchen kommen aus dem Vorrat.
 */
import * as THREE from 'three';
import { CONFIG } from '../config';
import { swallowedByFinsternis } from './darkness';
import type { EffectTools } from './evolutionEffects';
import { decoyGeometry, podGeometry, propMaterial, trapGeometry } from './props';
import type { Strip, StripSpec } from './strips';

/** Wo eines der drei Riesen-Eisen eines Bündels liegt oder fliegt: Ort, Höhe über dem Boden und Drehung. */
export interface JawSite {
  x: number;
  z: number;
  lift: number;
  angle: number;
}

export type BagSite = JawSite;

/** So viele Eisen, Beutel und Phantome zeichnet der Kampf höchstens zugleich. */
export const JAW_CAPACITY = CONFIG.skills.evolution.laeufer.jawsMax * 3;
export const BAG_CAPACITY = 2;
export const PHANTOM_CAPACITY = 4;

const DUST = 0xa3927a;
const ASH = 0x77716a;
const IRON = 0xaab3be;
const BLOOD = 0xb23a30;
const FOG = 0x8f9f78;
const FOG_DARK = 0x6a7c58;
const BONE = 0xe6dcc0;
const NET = 0xd9cfb0;
const TAU = Math.PI * 2;

const pose = new THREE.Object3D();

export class LaeuferEffects {
  readonly group = new THREE.Group();
  private readonly openMesh: THREE.InstancedMesh;
  private readonly shutMesh: THREE.InstancedMesh;
  private readonly bagMesh: THREE.InstancedMesh;
  private readonly phantomMesh: THREE.InstancedMesh;
  /** Die Ketten eines Bündels (drei Linien je Platz) und die Nebelwände (zwei Flächen je Platz) und die Front des Netzes. */
  private readonly chainStrips: (Strip | null)[][] = [];
  private readonly fogStrips: (Strip | null)[][] = [];
  private dragStrips: (Strip | null)[] = [null, null];

  constructor(private readonly tools: EffectTools) {
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadow: boolean) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      mesh.count = 0;
      return mesh;
    };
    const iron = propMaterial(0.5);
    this.openMesh = instanced(trapGeometry(false), iron, JAW_CAPACITY, false);
    this.shutMesh = instanced(trapGeometry(true), iron, JAW_CAPACITY, true);
    this.bagMesh = instanced(podGeometry(), propMaterial(0.8), BAG_CAPACITY, false);
    // Das Phantom ist durchscheinender Staub: ein halbdurchsichtiges, leicht glimmendes Gestell.
    const ghost = swallowedByFinsternis(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        emissive: new THREE.Color(0x77705e),
        emissiveIntensity: 0.55,
      }),
    );
    this.phantomMesh = instanced(decoyGeometry(), ghost, PHANTOM_CAPACITY, false);
    this.phantomMesh.renderOrder = 4;
    this.group.add(this.openMesh, this.shutMesh, this.bagMesh, this.phantomMesh);
    for (let i = 0; i < CONFIG.skills.evolution.laeufer.jawsMax; i++) this.chainStrips.push([null, null, null]);
    for (let i = 0; i < CONFIG.skills.evolution.laeufer.fogMax; i++) this.fogStrips.push([null, null]);
  }

  /**
   * Eine festgehaltene Glutlinie. Ihr Verlauf liegt in der Zeit (erst glimmt sie auf, dann fällt sie in Asche zurück); ohne
   * Zeit stünde sie bei null und bliebe unsichtbar, also hält sie in der Mitte des Verlaufs.
   */
  private hold(spec: StripSpec): Strip {
    const strip = this.tools.strips.spawn(spec);
    strip.held = 0.5;
    return strip;
  }

  reset(): void {
    for (const list of [...this.chainStrips, ...this.fogStrips]) list.fill(null);
    this.dragStrips = [null, null];
    for (const mesh of [this.openMesh, this.shutMesh, this.bagMesh, this.phantomMesh]) mesh.count = 0;
  }

  // ---------------------------------------------------------------- Pfeilfächer

  /** Der Staub-Pfeil schlägt ein: Eine Wolke steigt auf und bleibt liegen. */
  dustCloud(x: number, z: number, radius: number, seconds: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'dustring', x, z, inner: radius * 0.15, outer: radius, color: DUST, opacity: 0.9, life: seconds });
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.96, outer: radius * 1.03, y: 0.05, color: 0xd8c9a6, opacity: 0.35, life: seconds });
    this.tools.groundWave(x, z, radius * 1.1, DUST, 0.8);
    for (let i = 0; i < 14; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius * 0.8;
      this.tools.puff(x + Math.sin(a) * r, z + Math.cos(a) * r, a, 2.2, DUST, 0.65);
    }
  }

  /** Die Wolke wallt: Jedes Bild steigen ein paar Körner auf. */
  dustDrift(x: number, z: number, radius: number, dt: number): void {
    const { random, particle: p } = this.tools;
    const wanted = 16 * dt;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius;
      p.x = x + Math.sin(a) * r;
      p.y = 0.1 + random() * 0.5;
      p.z = z + Math.cos(a) * r;
      p.vx = (random() - 0.5) * 0.6;
      p.vy = 0.5 + random() * 0.6;
      p.vz = (random() - 0.5) * 0.6;
      p.life = 0.8 + random() * 0.6;
      p.size = 0.35 + random() * 0.3;
      p.grow = 0.5;
      p.gravity = 0;
      p.drag = 0.5;
      p.color.set(DUST);
      p.alpha = 0.4;
      this.tools.dust.spawn(p);
    }
  }

  /** Der Staub-Pfeil zieht eine Fahne aus Staub hinter sich her. */
  dustArrow(x: number, z: number, angle: number): void {
    this.tools.puff(x, z, angle + Math.PI, 0.8, DUST, 0.55);
  }

  // ----------------------------------------------------------- Sturm der Aschenfedern

  /** Der Schauer beginnt: Ein dunkler Ring aus Asche am Boden zeigt, wie weit er niedergeht. */
  ashStart(x: number, z: number, radius: number, seconds: number): void {
    const { strips } = this.tools;
    strips.spawn({ look: 'dustring', x, z, inner: radius * 0.1, outer: radius, color: ASH, opacity: 0.85, life: seconds });
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.95, outer: radius * 1.03, y: 0.05, color: 0xb7aea0, opacity: 0.4, life: seconds });
    this.tools.groundWave(x, z, radius, ASH, 0.6);
  }

  /** Eine Handvoll Pfeile geht nieder, jeder Takt des Schauers. */
  ashTick(x: number, z: number, radius: number, fromX: number, fromZ: number): void {
    this.tools.hailArrows(x, z, radius, 0.26, fromX, fromZ, 10);
    this.tools.groundWave(x, z, radius * 0.55, ASH, 0.22);
  }

  /** Aschefedern rieseln dunkel und schräg herab; jedes Bild einige. */
  ashRain(x: number, z: number, radius: number, dt: number): void {
    const { random, particle: p } = this.tools;
    const wanted = 80 * dt;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius;
      p.x = x + Math.sin(a) * r;
      p.y = 4.2 + random() * 1.5;
      p.z = z + Math.cos(a) * r;
      p.vx = (random() - 0.4) * 1.4;
      p.vy = -(11 + random() * 4);
      p.vz = (random() - 0.5) * 0.8;
      p.life = 0.38 + random() * 0.1;
      p.size = 0.16 + random() * 0.12;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 0;
      p.color.set(random() < 0.5 ? 0x3c3834 : 0x8a847a);
      p.alpha = 0.85;
      this.tools.dust.spawn(p);
    }
  }

  /** Der Schauer endet: Ein dichtes Staubfeld bleibt liegen. */
  ashEnd(x: number, z: number, radius: number, seconds: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'dustring', x, z, inner: 0, outer: radius, color: ASH, opacity: 0.7, life: seconds });
    strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.1, y: 0.05, color: 0x4d4944, opacity: 0.14, life: seconds });
    for (let i = 0; i < 10; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius * 0.9;
      this.tools.puff(x + Math.sin(a) * r, z + Math.cos(a) * r, a, 1.4, ASH, 0.6);
    }
  }

  // ------------------------------------------------------------- Kiefer der Ödnis

  /** Die Riesen-Eisen, gespannt (offen) und zugeschnappt, jedes mit Ort, Höhe und Drehung; `scale` bemisst sie an der Reichweite der Eisen. */
  showJaws(open: readonly JawSite[], openCount: number, shut: readonly JawSite[], shutCount: number, scale: number): void {
    const place = (mesh: THREE.InstancedMesh, sites: readonly JawSite[], count: number) => {
      const shown = Math.min(count, JAW_CAPACITY);
      for (let i = 0; i < shown; i++) {
        const site = sites[i];
        if (!site) continue;
        pose.position.set(site.x, site.lift, site.z);
        pose.rotation.set(0, site.angle, 0);
        pose.scale.setScalar(scale);
        pose.updateMatrix();
        mesh.setMatrixAt(i, pose.matrix);
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.openMesh, open, openCount);
    place(this.shutMesh, shut, shutCount);
  }

  /** Die Ketten eines Bündels: drei Linien von der Mitte zu den Eisen; ohne `active` sind sie weg. */
  chains(slot: number, active: boolean, x: number, z: number, spread: number, phase: number): void {
    const list = this.chainStrips[slot];
    if (!list) return;
    const { strips } = this.tools;
    for (let i = 0; i < list.length; i++) {
      const strip = list[i];
      if (!active) {
        if (strip) strips.release(strip, 0.3);
        list[i] = null;
        continue;
      }
      if (strip) continue;
      list[i] = this.hold({ look: 'glutlinie', x, z, angle: phase + (i / 3) * TAU, width: 0.12, inner: 0.2, outer: spread, y: 0.05, color: IRON, opacity: 0.8, life: Infinity });
    }
  }

  /** Das Bündel schlägt auf: Staub fliegt, der Boden bebt. */
  land(x: number, z: number, spread: number): void {
    this.tools.groundWave(x, z, spread * 1.7, DUST, 0.8);
    this.tools.sparks(x, 0.3, z, 14, IRON, 4);
    for (let i = 0; i < 12; i++) this.tools.puff(x, z, (i / 12) * TAU, 2.6, DUST, 0.6);
  }

  /** Eine Kette fährt von der Mitte zu einem Gegner und reißt ihn heran. */
  chainLine(x0: number, z0: number, x1: number, z1: number): void {
    const distance = Math.hypot(x1 - x0, z1 - z0);
    if (distance < 0.1) return;
    this.tools.strips.spawn({ look: 'glutlinie', x: x0, z: z0, angle: Math.atan2(x1 - x0, z1 - z0), width: 0.2, inner: 0, outer: distance, y: 0.6, color: 0xdfe5ec, opacity: 1.1, life: 0.4 });
  }

  /** Die Eisen schnappen zu: Ein Stoß geht über den Boden, Funken stieben. */
  snap(x: number, z: number, spread: number, reach: number): void {
    const { strips } = this.tools;
    const radius = spread + reach;
    strips.spawn({ look: 'ring', x, z, inner: 0.4, outer: 0.9, innerTo: radius * 0.9, outerTo: radius, y: 0.1, color: 0xdfe5ec, opacity: 0.8, life: 0.35 });
    strips.spawn({ look: 'shock', x, z, inner: 0.5, outer: 1.2, innerTo: radius * 0.85, outerTo: radius * 1.1, y: 0.8, life: 0.4 });
    this.tools.groundWave(x, z, radius, DUST, 0.8);
    this.tools.sparks(x, 0.5, z, 28, 0xfff0c8, 7);
    this.tools.flash(x, 1.2, z, 0xdfe5ec, 5, 10, 0.3);
    for (let i = 0; i < 10; i++) this.tools.puff(x, z, (i / 10) * TAU, 3, DUST, 0.6);
  }

  /** Das Zerreißen: Bei jedem Takt spritzt es rot in der Mitte der Eisen. */
  tear(x: number, z: number, radius: number): void {
    const { random, particle: p } = this.tools;
    for (let i = 0; i < 7; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius * 0.8;
      p.x = x + Math.sin(a) * r;
      p.y = 0.2 + random() * 0.7;
      p.z = z + Math.cos(a) * r;
      p.vx = Math.sin(a) * 1.5;
      p.vy = 1 + random() * 2;
      p.vz = Math.cos(a) * 1.5;
      p.life = 0.4 + random() * 0.3;
      p.size = 0.08 + random() * 0.06;
      p.grow = -0.05;
      p.gravity = 5;
      p.drag = 0.3;
      p.color.setRGB(1.5, 0.3, 0.25);
      p.alpha = 1;
      this.tools.glow.spawn(p);
    }
    this.tools.groundWave(x, z, radius * 0.7, BLOOD, 0.25);
  }

  // ------------------------------------------------------------------ Klingen-Fächer

  /** Der Fächer aus Messern: ein heller Bogen am Boden, so weit der Fächer aufgeht. */
  fan(x: number, z: number, angle: number, spread: number, range: number): void {
    // Nur die Kante des Bogens leuchtet; ein ganzer Fächer aus Licht wäre bei einem Halbkreis ein weißer Fleck.
    this.tools.strips.spawn({ look: 'slash', x, z, angle, width: spread + 0.3, inner: range * 0.9, outer: range * 1.0, y: 0.95, color: 0xdfe3ea, opacity: 0.3, life: 0.2 });
    this.tools.strips.spawn({ look: 'dustring', x, z, angle, width: spread, inner: range * 0.1, outer: range * 0.6, color: DUST, opacity: 0.5, life: 0.4 });
  }

  /** Die äußeren Messer wirbeln Staub auf. */
  knifeDust(x: number, z: number, angle: number): void {
    this.tools.puff(x, z, angle + Math.PI, 1.1, DUST, 0.5);
  }

  // ---------------------------------------------------------- Atem der Schattenpilze

  /** Die Beutel im Flug: Jeder steigt im Bogen und dreht sich. */
  showBags(sites: readonly BagSite[], count: number): void {
    const shown = Math.min(count, BAG_CAPACITY);
    for (let i = 0; i < shown; i++) {
      const site = sites[i];
      if (!site) continue;
      pose.position.set(site.x, site.lift, site.z);
      pose.rotation.set(site.angle * 0.7, site.angle, 0);
      pose.scale.setScalar(3.2);
      pose.updateMatrix();
      this.bagMesh.setMatrixAt(i, pose.matrix);
    }
    this.bagMesh.count = shown;
    this.bagMesh.instanceMatrix.needsUpdate = true;
  }

  /** Der Beutel platzt: Die Wand steigt auf und breitet sich aus. */
  fogLand(x: number, z: number, angle: number, length: number, width: number): void {
    const { random } = this.tools;
    const radius = Math.max(length, width) / 2;
    this.tools.groundWave(x + Math.sin(angle) * length * 0.5, z + Math.cos(angle) * length * 0.5, radius, FOG, 0.7);
    for (let i = 0; i < 20; i++) {
      const along = random() * length;
      const side = (random() - 0.5) * width;
      this.tools.puff(x + Math.sin(angle) * along + Math.cos(angle) * side, z + Math.cos(angle) * along - Math.sin(angle) * side, angle, 1.6, FOG, 0.65);
    }
  }

  /**
   * Eine Nebelwand: zwei Bänder am Boden (breit und fahl, schmal und heller) und aufsteigende Schwaden; sie wandert, also führt
   * jedes Bild sie nach. Ohne `active` klingt sie aus.
   */
  fog(slot: number, active: boolean, x: number, z: number, angle: number, length: number, width: number, time: number, dt: number): void {
    const list = this.fogStrips[slot];
    if (!list) return;
    const { strips, random } = this.tools;
    if (!active) {
      for (let i = 0; i < list.length; i++) {
        const strip = list[i];
        if (strip) strips.release(strip, 0.6);
        list[i] = null;
      }
      return;
    }
    list[0] ??= this.hold({ look: 'glutlinie', x, z, angle, width, inner: 0, outer: length, y: 0.05, color: FOG_DARK, opacity: 0.38, life: Infinity });
    list[1] ??= this.hold({ look: 'glutlinie', x, z, angle, width: width * 0.5, inner: 0, outer: length, y: 0.07, color: FOG, opacity: 0.24, life: Infinity });
    for (const strip of list) {
      if (!strip) continue;
      strip.x = x;
      strip.z = z;
      strip.angle = angle;
    }
    const broad = list[0];
    if (broad) broad.opacity = 0.36 + 0.08 * Math.sin(time * 2.3);
    const wanted = 26 * dt;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const along = random() * length;
      const side = (random() - 0.5) * width;
      this.tools.puff(x + Math.sin(angle) * along + Math.cos(angle) * side, z + Math.cos(angle) * along - Math.sin(angle) * side, random() * TAU, 0.5, FOG, 0.5);
    }
  }

  // ------------------------------------------------------------ Vollstrecker der Ödnis

  /** Das Phantom steigt auf: Staub sammelt sich zum Gestell, ein heller Ring zeichnet seinen Umkreis. */
  phantomRise(x: number, z: number, radius: number, seconds: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.97, outer: radius * 1.03, y: 0.06, color: 0xdcd2b4, opacity: 0.45, life: seconds });
    strips.spawn({ look: 'sogfeld', x, z, inner: 0, outer: radius, y: 0.03, color: 0x77705e, opacity: 0.45, life: seconds });
    this.tools.groundWave(x, z, radius, DUST, 0.7);
    for (let i = 0; i < 20; i++) {
      const a = random() * TAU;
      this.tools.puff(x + Math.sin(a) * radius * 0.4, z + Math.cos(a) * radius * 0.4, a, 2.4, DUST, 0.6);
    }
  }

  /** Das Phantom schwebt: Gestell mit wehenden Tüchern, im Bogen auf und ab. */
  showPhantoms(sites: readonly { x: number; z: number }[], count: number, time: number): void {
    const shown = Math.min(count, PHANTOM_CAPACITY);
    for (let i = 0; i < shown; i++) {
      const site = sites[i];
      if (!site) continue;
      pose.position.set(site.x, 1.1 + 0.18 * Math.sin(time * 1.6 + i), site.z);
      pose.rotation.set(0.05 * Math.sin(time * 1.1), time * 0.35 + i, 0.06 * Math.sin(time * 1.3));
      pose.scale.setScalar(2.3);
      pose.updateMatrix();
      this.phantomMesh.setMatrixAt(i, pose.matrix);
    }
    this.phantomMesh.count = shown;
    this.phantomMesh.instanceMatrix.needsUpdate = true;
  }

  /** Jeder Takt: Staub strömt von den Rändern zum Phantom und wird eingesogen. */
  phantomPulse(x: number, z: number, radius: number): void {
    const { random, particle: p } = this.tools;
    for (let i = 0; i < 16; i++) {
      const a = random() * TAU;
      const r = radius * (0.6 + 0.4 * random());
      const seconds = 0.45 + random() * 0.2;
      p.x = x + Math.sin(a) * r;
      p.y = 0.2 + random() * 0.9;
      p.z = z + Math.cos(a) * r;
      p.vx = (-Math.sin(a) * r) / seconds;
      p.vy = 0.5;
      p.vz = (-Math.cos(a) * r) / seconds;
      p.life = seconds;
      p.size = 0.3 + random() * 0.25;
      p.grow = -0.3;
      p.gravity = 0;
      p.drag = 0;
      p.color.set(0xd8cfb4);
      p.alpha = 0.45;
      this.tools.dust.spawn(p);
    }
  }

  /** Das Phantom zerspringt: Eine Welle aus Knochensplittern und Staub geht nach außen. */
  phantomBlast(x: number, z: number, radius: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.15, outer: radius * 0.3, innerTo: radius * 0.9, outerTo: radius, y: 0.1, color: 0xefe6cc, opacity: 0.9, life: 0.5 });
    strips.spawn({ look: 'shock', x, z, inner: 0.5, outer: 1.5, innerTo: radius * 0.9, outerTo: radius * 1.15, y: 1, life: 0.55 });
    this.tools.groundWave(x, z, radius, DUST, 0.9);
    this.tools.after(0.1, () => this.tools.groundWave(x, z, radius * 0.75, BONE, 0.5));
    this.tools.sparks(x, 1.2, z, 34, BONE, 9);
    this.tools.flash(x, 1.6, z, 0xf0e8d0, 6, 14, 0.45);
    for (let i = 0; i < 28; i++) this.tools.puff(x, z, (i / 28) * TAU + random() * 0.2, 6.5, DUST, 0.7);
  }

  // ---------------------------------------------------- Schlinge der Alten Ordnung

  /** Das Schleppnetz wird geworfen: Eine Bahn zeichnet sich kurz auf den Boden. */
  dragStart(x: number, z: number, angle: number, width: number): void {
    this.tools.strips.spawn({ look: 'bahn', x, z, angle, width, inner: 1, outer: CONFIG.skills.evolution.laeufer.dragLength + 1, y: 0.04, color: NET, opacity: 0.35, life: 0.8 });
    this.tools.groundWave(x, z, 2.2, DUST, 0.5);
  }

  /** Die Front des Netzes: ein helles Band quer zur Bahn und eine Staubwand davor. Ohne `active` klingt es aus. */
  dragFront(active: boolean, x: number, z: number, angle: number, width: number, dt: number): void {
    const { strips, random } = this.tools;
    if (!active) {
      for (let i = 0; i < this.dragStrips.length; i++) {
        const strip = this.dragStrips[i];
        if (strip) strips.release(strip, 0.3);
        this.dragStrips[i] = null;
      }
      return;
    }
    const across = angle + Math.PI / 2;
    const startX = x - Math.sin(across) * (width / 2);
    const startZ = z - Math.cos(across) * (width / 2);
    this.dragStrips[0] ??= this.hold({ look: 'glutlinie', x: startX, z: startZ, angle: across, width: 0.9, inner: 0, outer: width, y: 0.08, color: NET, opacity: 1, life: Infinity });
    this.dragStrips[1] ??= this.hold({ look: 'glutlinie', x: startX, z: startZ, angle: across, width: 2.4, inner: 0, outer: width, y: 0.05, color: DUST, opacity: 0.5, life: Infinity });
    for (const strip of this.dragStrips) {
      if (!strip) continue;
      strip.x = startX;
      strip.z = startZ;
      strip.angle = across;
    }
    const wanted = 90 * dt;
    const count = Math.floor(wanted) + (random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const side = (random() - 0.5) * width;
      this.tools.puff(x + Math.sin(across) * side, z + Math.cos(across) * side, angle, 2.2, DUST, 0.6);
    }
  }

  /** Das Netz zieht sich zu: Ringe aus Maschen schnüren sich auf den Bündel zusammen, Eisengewichte schlagen auf. */
  dragBundle(x: number, z: number, radius: number, seconds: number): void {
    const { strips } = this.tools;
    for (const share of [1, 0.65, 0.35]) {
      strips.spawn({ look: 'ring', x, z, inner: radius * share * 0.96, outer: radius * share * 1.03, y: 0.07, color: NET, opacity: 0.6, life: seconds });
    }
    strips.spawn({ look: 'crack', x, z, inner: 0, outer: radius, y: 0.07, color: NET, opacity: 0.6, life: seconds });
    strips.spawn({ look: 'ring', x, z, inner: radius * 2.2, outer: radius * 2.4, innerTo: radius * 0.6, outerTo: radius * 0.8, y: 0.1, color: 0xf0e6c8, opacity: 0.8, life: 0.35 });
    this.tools.groundWave(x, z, radius * 2, DUST, 0.7);
    this.tools.sparks(x, 0.6, z, 20, IRON, 6);
  }

  /** Die Gewichte schlagen zu (jeder Takt). */
  crush(x: number, z: number, radius: number): void {
    this.tools.sparks(x, 0.4, z, 8, 0xfff0c8, 4);
    this.tools.groundWave(x, z, radius * 0.9, DUST, 0.35);
    for (let i = 0; i < 4; i++) this.tools.puff(x, z, this.tools.random() * TAU, 1.6, DUST, 0.5);
  }
}
