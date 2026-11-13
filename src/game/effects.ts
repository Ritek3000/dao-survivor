/**
 * Wie die Angriffe aussehen. Hier steht je Angriff, aus welchen Bausteinen sein Bild besteht:
 * Flächen aus dem Shader (strips.ts), Teilchen (particles.ts), kleine Gegenstände (props.ts)
 * und zwei Lichter, die für Augenblicke aufleuchten.
 *
 * Die Zauber folgen den Vorlagen und ihren Grundsätzen: Nichts entsteht aus dem Nichts. Steine kommen aus dem Boden,
 * Wurzeln wachsen aus ihm, Feuer braucht etwas, das brennt, und was leuchtet, ist angestrahlter Staub.
 * Die Vorlagen sind dabei ein Maß für die Stimmung, nicht für die Sichtbarkeit: Hitze und Schild sind dort
 * unsichtbar, im Spiel muss man sie sehen, sonst weiß niemand, was ihn trifft oder schützt. Sie zeigen sich
 * deshalb als flimmernde Luft mit glühenden Körnern bzw. als dünnes Wabenglas (`dome.ts`).
 */
import * as THREE from 'three';
import { createRandom } from '../core/random';
import { ShieldDome } from './dome';
import { Particles, type Particle } from './particles';
import { arrowGeometry, propMaterial, rockGeometry, rootsGeometry, shardGeometry, trapGeometry } from './props';
import { Strips, type Strip } from './strips';
import type { Site } from './zones';

/**
 * Woran ein Treffer zu erkennen ist: Stahl schlägt Funken, die Sorlanze brennt,
 * Hitze und Glut versengen (Funken und aufsteigender Rauch), alles andere wirbelt Staub auf.
 */
export type StrikeKind = 'stahl' | 'brand' | 'glut' | 'staub';

const STEEL = 0xffeed2;
const DUST = 0xa3927a;
const EARTH = 0x8a775c;
const SOR = 0xffe6a8;
const EMBER = 0xff7a2a;
const SHIELD = 0xbfd4ff;

/** Wie viele Körner die Hitze zum Glühen bringt. */
const HEAT_GRAINS = 70;
/** Wie viele Felszacken gleichzeitig stehen können, und wie viele ein Erdstoß treibt. */
const SHARDS = 64;
const QUAKE_SHARDS = 34;
const HAIL_ARROWS = 14;
/** Sekunden, die ein Pfeil des Hagels sichtbar herabfliegt, und sein Tempo dabei. */
const HAIL_FLIGHT = 0.3;
const HAIL_SPEED = 34;
/** Abstand von der Mitte des Pfeils bis zu seiner Spitze, in der Größe, in der er gezeigt wird. */
const HAIL_ARROW_HALF = 0.66;
const STUCK_SECONDS = 1.4;
const GRAVITY = 14;

interface HailArrow extends Site {
  /** Flugrichtung, schräg nach unten. */
  dx: number;
  dy: number;
  dz: number;
  /** Sekunden bis zum Einschlag; danach negativ, solange der Pfeil im Boden steckt. */
  lands: number;
}

interface Rock {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  spin: number;
  /** Sekunden seit der Landung; negativ, solange der Brocken fliegt. */
  rest: number;
}

/** Eine Felszacke, die ein Erdstoß aus dem Boden treibt. */
interface Shard extends Site {
  yaw: number;
  /** Neigung nach außen in Radiant. */
  lean: number;
  spin: number;
  width: number;
  height: number;
  /** Helligkeit des Steins, 1 = Grundfarbe. */
  tint: number;
  age: number;
  life: number;
}

interface Roots extends Site {
  scale: number;
  yaw: number;
  age: number;
  life: number;
}

interface Snapped extends Site {
  age: number;
}

interface Later {
  seconds: number;
  run: () => void;
}

const pose = new THREE.Object3D();
const WHITE = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const yawTurn = new THREE.Quaternion();
const leanTurn = new THREE.Quaternion();
const selfTurn = new THREE.Quaternion();
const stoneTint = new THREE.Color();
const FORWARD = new THREE.Vector3(0, 0, 1);
const heading = new THREE.Vector3();
const TAU = Math.PI * 2;

/** Alle sichtbaren Wirkungen der Angriffe. */
export class Effects {
  readonly group = new THREE.Group();
  private readonly random = createRandom(4711);
  private readonly strips = new Strips();
  private readonly glow = new Particles(1600, 'glow');
  private readonly dust = new Particles(900, 'dust');
  /** Leuchtet für Augenblicke auf: Sorlanze, Sorhennas Brand. */
  private readonly flashLight = new THREE.PointLight(0xffffff, 0, 10, 1.4);
  private flashPeak = 0;
  private flashAge = 0;
  private flashLife = 1;
  /** Der Schein der geformten Glut. */
  private readonly emberLight = new THREE.PointLight(EMBER, 0, 8, 1.4);

  private readonly hailMesh: THREE.InstancedMesh;
  private readonly hail: HailArrow[] = [];
  private readonly rockMesh: THREE.InstancedMesh;
  private readonly rocks: Rock[] = [];
  private readonly shardMesh: THREE.InstancedMesh;
  private readonly shards: Shard[] = [];
  private readonly rootMesh: THREE.InstancedMesh;
  private readonly roots: Roots[] = [];
  private readonly openTraps: THREE.InstancedMesh;
  private readonly shutTraps: THREE.InstancedMesh;
  private readonly snapped: Snapped[] = [];
  private readonly later: Later[] = [];
  private readonly lightTint = new THREE.Color();

  private fireRing: Strip | null = null;
  private fireCoals: Strip | null = null;
  private fireGlow: Strip | null = null;
  private fireBed: Strip | null = null;
  /** Klingt nach jedem Schadensstoß der Glut von 1 auf 0 ab: Dann flammt das ganze Feld auf. */
  private fireSurge = 0;
  private readonly dome = new ShieldDome(SHIELD);
  private shieldRing: Strip | null = null;
  private shieldGlow: Strip | null = null;

  /** Ein Teilchen als Vorlage, damit im Kampf keine neuen Objekte entstehen. */
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
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadow: boolean) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      mesh.count = 0;
      return mesh;
    };
    const iron = propMaterial(0.5);
    this.hailMesh = instanced(arrowGeometry(), propMaterial(0.6), 96, false);
    this.rockMesh = instanced(rockGeometry(), propMaterial(0.95, true), 140, true);
    this.shardMesh = instanced(shardGeometry(this.random), propMaterial(0.95, true), SHARDS, true);
    // Das Farbattribut muss vor dem ersten Zeichnen da sein, sonst baut das Material seinen Shader ohne.
    for (let i = 0; i < SHARDS; i++) this.shardMesh.setColorAt(i, WHITE);
    this.rootMesh = instanced(rootsGeometry(this.random), propMaterial(0.9), 40, true);
    this.openTraps = instanced(trapGeometry(false), iron, 12, false);
    this.shutTraps = instanced(trapGeometry(true), iron, 16, true);

    this.group.add(
      this.strips.group,
      this.dome.mesh,
      this.dust.points,
      this.glow.points,
      this.flashLight,
      this.emberLight,
      this.hailMesh,
      this.rockMesh,
      this.shardMesh,
      this.rootMesh,
      this.openTraps,
      this.shutTraps,
    );
  }

  reset(): void {
    this.strips.reset();
    this.glow.reset();
    this.dust.reset();
    this.flashLight.intensity = 0;
    this.emberLight.intensity = 0;
    this.flashPeak = 0;
    this.hail.length = 0;
    this.rocks.length = 0;
    this.shards.length = 0;
    this.roots.length = 0;
    this.snapped.length = 0;
    this.later.length = 0;
    this.fireRing = this.fireCoals = this.fireGlow = this.fireBed = this.shieldRing = this.shieldGlow = null;
    this.fireSurge = 0;
    this.dome.reset();
    for (const mesh of [this.hailMesh, this.rockMesh, this.shardMesh, this.rootMesh, this.openTraps, this.shutTraps]) mesh.count = 0;
  }

  /** Hält die Teilchen unabhängig von Auflösung und Blickwinkel gleich groß. */
  resize(pixelHeight: number, fovDegrees: number): void {
    this.glow.resize(pixelHeight, fovDegrees);
    this.dust.resize(pixelHeight, fovDegrees);
  }

  /** `lightRadius` und `lightColor` beschreiben die Lichtquelle der Spielfigur: Staub ist nur in ihrem Schein zu sehen. */
  update(dt: number, lightRadius: number, lightColor: THREE.Color): void {
    // Etwas zum Weiß hin: Staub im Fackelschein ist warm, aber nicht orange.
    const tint = this.lightTint.copy(lightColor).lerp(WHITE, 0.45);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const entry = this.later[i];
      if (!entry) continue;
      entry.seconds -= dt;
      if (entry.seconds > 0) continue;
      this.later.splice(i, 1);
      entry.run();
    }
    this.strips.update(dt, lightRadius, tint);
    this.glow.update(dt, lightRadius, tint);
    this.dust.update(dt, lightRadius, tint);

    if (this.flashPeak > 0) {
      this.flashAge += dt;
      const left = Math.max(0, 1 - this.flashAge / this.flashLife);
      this.flashLight.intensity = this.flashPeak * left * left;
      if (left === 0) this.flashPeak = 0;
    }
    this.updateHail(dt);
    this.updateRocks(dt);
    this.updateShards(dt);
    this.updateRoots(dt);
    this.updateSnapped(dt);
    this.dome.update(dt);
    this.shieldMotes(dt);
  }

  // ---------------------------------------------------------------- Kämpfer

  /** Hieb mit der Axt: eine helle Spur, die den Bogen von links nach rechts durchläuft. */
  slash(x: number, z: number, angle: number, range: number, width: number, heavy: boolean): void {
    this.strips.spawn({
      look: 'slash',
      x,
      z,
      angle,
      width,
      inner: range * (heavy ? 0.3 : 0.5),
      outer: range * 1.02,
      y: 1.15,
      color: heavy ? 0xffd9a0 : STEEL,
      opacity: heavy ? 1.25 : 0.85,
      life: heavy ? 0.36 : 0.24,
    });
    if (!heavy) return;
    // Der Wuchthieb reißt Staub vom Boden und drückt die Luft vor sich her.
    this.strips.spawn({
      look: 'dustring',
      x,
      z,
      angle,
      width,
      inner: range * 0.45,
      outer: range * 0.8,
      innerTo: range * 0.9,
      outerTo: range * 1.35,
      color: DUST,
      opacity: 0.8,
      life: 0.55,
    });
    this.strips.spawn({
      look: 'shock',
      x,
      z,
      angle,
      width,
      inner: range * 0.5,
      outer: range * 0.85,
      innerTo: range,
      outerTo: range * 1.4,
      y: 1,
      life: 0.3,
    });
    for (let i = 0; i < 7; i++) {
      const a = angle + (this.random() - 0.5) * width;
      this.puff(x + Math.sin(a) * range * 0.8, z + Math.cos(a) * range * 0.8, a, 2.5, DUST);
    }
  }

  /** Wirbelschlag: Die Axt zieht einen vollen Kreis und fährt dann in den Boden. */
  whirl(x: number, z: number, angle: number, range: number): void {
    this.strips.spawn({
      look: 'slash',
      x,
      z,
      angle: angle + Math.PI,
      inner: range * 0.45,
      outer: range,
      y: 1.1,
      color: STEEL,
      opacity: 1,
      life: 0.3,
    });
    this.groundWave(x, z, range, DUST, 0.75);
    for (let i = 0; i < 12; i++) {
      const a = this.random() * TAU;
      this.puff(x + Math.sin(a) * range * 0.6, z + Math.cos(a) * range * 0.6, a, 3, DUST);
    }
  }

  /** Kriegsschrei: Der Schall läuft in Ringen über den Boden und drückt sichtbar die Luft. */
  shout(x: number, z: number, range: number): void {
    this.strips.spawn({ look: 'pulse', x, z, inner: 0.5, outer: range, y: 0.1, color: 0xe08a3c, opacity: 0.32, life: 0.7 });
    const wave = (): void => {
      this.strips.spawn({
        look: 'shock',
        x,
        z,
        inner: 0.3,
        outer: 1.1,
        innerTo: range * 0.85,
        outerTo: range * 1.15,
        y: 1,
        life: 0.45,
      });
    };
    wave();
    this.after(0.16, wave);
  }

  // ---------------------------------------------------------- Wildnisläufer

  /** Pfeilhagel: Ein fahler Kreis kündigt ihn an, dann schlagen die Pfeile nacheinander ein. */
  hailMark(x: number, z: number, radius: number, delay: number, fromX: number, fromZ: number): void {
    this.strips.spawn({
      look: 'ring',
      x,
      z,
      inner: radius * 0.93,
      outer: radius * 1.02,
      color: 0xe0cfa2,
      opacity: 0.4,
      life: delay + 0.15,
    });
    // Die Pfeile kommen aus der Richtung des Schützen, steil von oben.
    const away = Math.atan2(x - fromX, z - fromZ);
    for (let i = 0; i < HAIL_ARROWS; i++) {
      const a = this.random() * TAU;
      const r = Math.sqrt(this.random()) * radius * 0.92;
      const yaw = away + (this.random() - 0.5) * 0.25;
      const steep = 1.05 + this.random() * 0.2;
      this.hail.push({
        x: x + Math.sin(a) * r,
        z: z + Math.cos(a) * r,
        dx: Math.sin(yaw) * Math.cos(steep),
        dy: -Math.sin(steep),
        dz: Math.cos(yaw) * Math.cos(steep),
        lands: delay * (0.72 + 0.28 * (i / (HAIL_ARROWS - 1))),
      });
    }
  }

  hailImpact(x: number, z: number, radius: number): void {
    this.strips.spawn({
      look: 'dustring',
      x,
      z,
      inner: radius * 0.5,
      outer: radius * 0.8,
      innerTo: radius * 0.95,
      outerTo: radius * 1.25,
      color: DUST,
      opacity: 0.6,
      life: 0.5,
    });
  }

  /** Die gespannten Fangeisen, wie sie gerade liegen. */
  showTraps(traps: readonly Site[]): void {
    const count = Math.min(traps.length, this.openTraps.instanceMatrix.count);
    for (let i = 0; i < count; i++) {
      const trap = traps[i];
      if (!trap) continue;
      pose.position.set(trap.x, 0, trap.z);
      // Jede Falle liegt etwas anders, aber von Bild zu Bild gleich.
      pose.rotation.set(0, trap.x * 12.9898 + trap.z * 78.233, 0);
      pose.scale.setScalar(1.15);
      pose.updateMatrix();
      this.openTraps.setMatrixAt(i, pose.matrix);
    }
    this.openTraps.count = count;
    this.openTraps.instanceMatrix.needsUpdate = true;
  }

  /** Ein Fangeisen schnappt zu: Die Bügel stehen hoch, Stahl schlägt auf Stahl. */
  trapSnap(x: number, z: number, radius: number): void {
    if (this.snapped.length >= this.shutTraps.instanceMatrix.count) this.snapped.shift();
    this.snapped.push({ x, z, age: 0 });
    this.strips.spawn({
      look: 'ring',
      x,
      z,
      inner: 0.2,
      outer: 0.5,
      innerTo: radius * 0.8,
      outerTo: radius,
      y: 0.1,
      color: 0xcfd6e0,
      opacity: 0.5,
      life: 0.25,
    });
    this.sparks(x, 0.35, z, 12, 0xfff0c8, 5);
    for (let i = 0; i < 4; i++) this.puff(x, z, this.random() * TAU, 1.5, DUST);
  }

  // ----------------------------------------------------------------- Magier

  /**
   * Hitze werfen: kein Licht, kein Knall. Die Luft flimmert in Wellen, die von der Hand ausgehen,
   * und der Staub in ihr wird für einen Atemzug glühend heiß.
   */
  heat(x: number, z: number, angle: number, range: number, width: number): void {
    this.strips.spawn({ look: 'heat', x, z, angle, width: width + 0.22, inner: 0.5, outer: range, y: 1.05, life: 0.55 });
    for (let i = 0; i < 5; i++) {
      const a = angle + (this.random() - 0.5) * width;
      const r = 1 + this.random() * (range - 1.5);
      this.puff(x + Math.sin(a) * r, z + Math.cos(a) * r, a, 3.5, DUST, 0.22);
    }
    // Glühende Körner im ganzen Kegel: je weiter hinaus, desto breiter streut er.
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const p = this.particle;
    for (let i = 0; i < HEAT_GRAINS; i++) {
      const along = 1.2 + (range - 1.4) * Math.pow(this.random(), 0.85);
      const spread = 0.3 + along * Math.tan(Math.min(width, 2.2) / 2);
      const side = (this.random() + this.random() - 1) * spread;
      const drift = 0.6 + this.random();
      const heat = this.random();
      // Über 1: Das Zentrum des Korns sättigt, der Rand bleibt orange.
      const glow = 1.6 + 3.5 * Math.pow(this.random(), 3);
      p.x = x + sin * along + cos * side;
      p.y = 0.1 + Math.pow(this.random(), 1.4) * 1.9;
      p.z = z + cos * along - sin * side;
      p.vx = sin * drift;
      p.vy = 0.35;
      p.vz = cos * drift;
      p.life = 0.45 + this.random() * 0.6;
      p.size = 0.06 + this.random() * 0.07;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 1.2;
      p.color.setRGB(glow, glow * (0.22 + 0.5 * heat), glow * 0.04 * (0.5 + heat));
      p.alpha = 1;
      this.glow.spawn(p);
    }
  }

  /** Sorlanze: ein fingerdicker Strahl. Was man sieht, ist vor allem sein Schein im Staub der Luft. */
  lance(x: number, z: number, angle: number, length: number): void {
    this.strips.spawn({ look: 'lance', x, z, angle, width: 0.9, inner: 0.7, outer: length, y: 1.2, color: SOR, life: 0.34 });
    // Der Boden unter dem Strahl leuchtet mit.
    this.strips.spawn({
      look: 'lancelight',
      x,
      z,
      angle,
      width: 4.5,
      inner: 0.2,
      outer: length + 1,
      y: 0.07,
      color: SOR,
      opacity: 0.26,
      life: 0.3,
    });
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    for (let i = 0; i < 44; i++) {
      const along = 0.8 + this.random() * (length - 1);
      const p = this.particle;
      p.x = x + sin * along + (this.random() - 0.5) * 0.25;
      p.y = 1.2 + (this.random() - 0.5) * 0.3;
      p.z = z + cos * along + (this.random() - 0.5) * 0.25;
      // Der Staub im Strahl wird heiß und stiebt zur Seite und nach oben davon.
      const side = (this.random() - 0.5) * 1.4;
      p.vx = cos * side + (this.random() - 0.5) * 0.3;
      p.vy = 0.15 + this.random() * 0.5;
      p.vz = -sin * side + (this.random() - 0.5) * 0.3;
      p.life = 0.45 + this.random() * 0.6;
      p.size = 0.05 + this.random() * 0.09;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 1;
      // Weißgold, nur manche Körner glühen orange nach.
      p.color.set(this.random() < 0.25 ? 0xffb050 : SOR).multiplyScalar(1.3);
      p.alpha = 0.95;
      this.glow.spawn(p);
    }
    // Am Ursprung ist der Strahl am heißesten.
    const q = this.particle;
    q.x = x + sin * 0.9;
    q.y = 1.2;
    q.z = z + cos * 0.9;
    q.vx = q.vy = q.vz = 0;
    q.life = 0.3;
    q.size = 0.9;
    q.grow = -1.5;
    q.gravity = 0;
    q.drag = 0;
    q.color.set(0xfff0c8);
    q.alpha = 0.9;
    this.glow.spawn(q);
    this.flash(x + sin * length * 0.35, 1.7, z + cos * length * 0.35, 0xfff0c8, 70, length * 0.9, 0.3);
  }

  /**
   * Glut formen: ein brennender Kreis, der dem Magier folgt. Der Boden darin steht in Flammen, am Rand
   * lodert eine Wand aus Zungen über einem Ring aus Glutbrocken. Wer im Kreis steht, brennt; die Schadensstöße
   * zeigt `emberPulse`. Jedes Bild aufzurufen; mit `active` = false erlischt das Feuer.
   *
   * Lore (Abweichung): In der Vorlage ist der Feuerkreis eine Wand, die nur verletzt, wer hindurchgeht. Im Spiel
   * brennt die ganze Fläche, denn nur dann sieht man, dass Gegner im Inneren Schaden nehmen.
   */
  embers(active: boolean, x: number, z: number, radius: number, time: number, dt: number): void {
    if (!active) {
      for (const strip of [this.fireRing, this.fireCoals, this.fireGlow, this.fireBed]) if (strip) this.strips.release(strip, 0.4);
      this.fireRing = this.fireCoals = this.fireGlow = this.fireBed = null;
      this.emberLight.intensity = 0;
      this.fireSurge = 0;
      return;
    }
    this.fireBed ??= this.strips.spawn({ look: 'brandbett', x, z, inner: 0, outer: radius, y: 0.025, life: Infinity });
    this.fireRing ??= this.strips.spawn({ look: 'fire', x, z, inner: 0, outer: radius, y: 0.02, span: 1.9, life: Infinity });
    this.fireCoals ??= this.strips.spawn({ look: 'glut', x, z, inner: radius - 0.5, outer: radius + 0.5, y: 0.03, life: Infinity });
    // Ein warmer Hof färbt den Boden im Ring.
    this.fireGlow ??= this.strips.spawn({
      look: 'glow',
      x,
      z,
      inner: 0,
      outer: radius * 1.35,
      y: 0.05,
      color: 0xff6a18,
      opacity: 0.05,
      life: Infinity,
    });
    this.fireSurge = Math.max(0, this.fireSurge - dt * 4);
    const surge = this.fireSurge;
    // Unregelmäßig und schnell: Das Feuer lodert, es pulsiert nicht gleichmäßig.
    const flicker =
      1 + 0.12 * Math.sin(time * 13) + 0.08 * Math.sin(time * 29.3 + 1.1) + 0.14 * Math.sin(time * 2.3) * Math.sin(time * 5.1 + 0.6);
    for (const strip of [this.fireRing, this.fireCoals, this.fireGlow, this.fireBed]) {
      strip.x = x;
      strip.z = z;
    }
    this.fireBed.spec.outer = radius;
    this.fireBed.opacity = (0.85 + 0.9 * surge) * flicker;
    this.fireRing.spec.outer = radius;
    this.fireRing.spec.span = 1.9 + 0.9 * surge;
    this.fireRing.opacity = Math.min(1.25, (0.95 + 0.3 * surge) * flicker);
    this.fireCoals.spec.inner = radius - 0.5;
    this.fireCoals.spec.outer = radius + 0.5;
    this.fireCoals.opacity = 0.9 * flicker;
    this.fireGlow.spec.outer = radius * 1.35;
    // Das Licht sitzt über dem Magier: So fällt der Schein flach auf den Boden um ihn, ohne ihn auszubrennen.
    this.emberLight.position.set(x, 2.2, z);
    this.emberLight.distance = radius * 3;
    this.emberLight.intensity = 6 * flicker * (1 + 0.5 * surge);

    // Funken steigen aus den Flammen auf, die meisten vom Rand, einige vom brennenden Boden.
    const sparks = this.perFrame(110 * dt);
    for (let i = 0; i < sparks; i++) this.ember(x, z, radius, 1, i % 3 === 0);
    // Zungen und Rauch: Die Flammen im Kreis schlagen auf, über dem Feuer steigt dunkler Rauch.
    const tongues = this.perFrame((26 + 40 * surge) * dt);
    for (let i = 0; i < tongues; i++) this.tongue(x, z, radius);
    const smoke = this.perFrame(5 * dt);
    for (let i = 0; i < smoke; i++) this.fireSmoke(x, z, radius);
  }

  /**
   * Die Glut greift an: Alle im Kreis erleiden Schaden, und das ganze Feuer flammt auf. Dafür gibt es keine
   * eigene Fläche: Sie bliebe stehen, wo sie entstand, und der Magier ließe beim Laufen Ringe hinter sich zurück.
   * Stattdessen schlagen die Flammen des mitlaufenden Feuers höher (`fireSurge` in `embers`).
   */
  emberPulse(x: number, z: number, radius: number): void {
    this.fireSurge = 1;
    for (let i = 0; i < 22; i++) this.ember(x, z, radius, 2, i % 2 === 0);
  }

  /**
   * Erdstoß: Spalten laufen vom Magier nach außen, im Ring bricht der Fels in Zacken aus dem Boden,
   * Staub rollt hinaus, Brocken und Splitter fliegen.
   */
  quake(x: number, z: number, radius: number): void {
    this.strips.spawn({ look: 'crack', x, z, inner: 0, outer: radius * 1.15, y: 0.04, life: 2.8, opacity: 0.95 });
    this.groundWave(x, z, radius, EARTH, 0.95);
    for (let i = 0; i < QUAKE_SHARDS && this.shards.length < SHARDS; i++) {
      const a = (i / QUAKE_SHARDS) * TAU + (this.random() - 0.5) * 0.18;
      // Ein gebrochener Ring um vier Fünftel des Radius, dazwischen wenige Zacken weiter innen.
      const r = radius * (i % 5 === 4 ? 0.35 + 0.35 * this.random() : 0.8) + (this.random() - 0.5) * 0.8;
      const big = this.random() < 0.3;
      this.shards.push({
        x: x + Math.sin(a) * r,
        z: z + Math.cos(a) * r,
        yaw: a,
        lean: 0.2 + this.random() * 0.25,
        spin: this.random() * TAU,
        width: big ? 0.3 + this.random() * 0.15 : 0.14 + this.random() * 0.13,
        height: big ? 0.9 + this.random() * 0.5 : 0.3 + this.random() * 0.5,
        tint: 0.75 + this.random() * 0.6,
        // Der Fels bricht nicht überall im selben Augenblick auf.
        age: -this.random() * 0.08,
        life: 1.3 + this.random() * 0.4,
      });
    }
    for (let i = 0; i < 22 && this.rocks.length < this.rockMesh.instanceMatrix.count; i++) {
      const a = this.random() * TAU;
      const r = radius * (0.25 + 0.75 * this.random());
      const out = 0.5 + this.random() * 2;
      this.rocks.push({
        x: x + Math.sin(a) * r,
        y: 0,
        z: z + Math.cos(a) * r,
        vx: Math.sin(a) * out,
        vy: 3 + this.random() * 3.5,
        vz: Math.cos(a) * out,
        size: 0.07 + this.random() * 0.13,
        spin: (this.random() - 0.5) * 16,
        rest: -1,
      });
    }
    for (let i = 0; i < 44; i++) {
      const a = this.random() * TAU;
      const r = radius * (0.8 + (this.random() - 0.4) * 0.35);
      this.puff(x + Math.sin(a) * r, z + Math.cos(a) * r, a, 2, EARTH);
    }
    // Splitter, die das Licht erfasst: Sie springen aus den Rissen und fallen zurück.
    const p = this.particle;
    for (let i = 0; i < 60; i++) {
      const a = this.random() * TAU;
      const r = radius * (0.2 + 0.7 * this.random());
      const out = 1.5 + this.random() * 3;
      p.x = x + Math.sin(a) * r;
      p.y = 0.1 + this.random() * 0.4;
      p.z = z + Math.cos(a) * r;
      p.vx = Math.sin(a) * out;
      p.vy = 2 + this.random() * 4;
      p.vz = Math.cos(a) * out;
      p.life = 0.5 + this.random() * 0.6;
      p.size = 0.05 + this.random() * 0.05;
      p.grow = 0;
      p.gravity = 9;
      p.drag = 0.6;
      p.color.setRGB(0.95, 0.78, 0.55).multiplyScalar(0.9 + this.random() * 1.2);
      p.alpha = 0.9;
      this.glow.spawn(p);
    }
  }

  /**
   * Wurzelgriff: Um jedes Opfer wachsen dornige Wurzeln aus dem Boden und halten es `seconds` lang.
   * Der Boden reißt um den Fuß auf, Erde stäubt.
   */
  entangle(x: number, z: number, radius: number, seconds: number): void {
    if (this.roots.length >= this.rootMesh.instanceMatrix.count) return;
    this.roots.push({ x, z, scale: radius / 0.45, yaw: this.random() * TAU, age: 0, life: seconds });
    this.strips.spawn({ look: 'footcrack', x, z, inner: 0, outer: radius * 4, y: 0.04, life: Math.max(0.6, seconds), opacity: 0.95 });
    for (let i = 0; i < 9; i++) {
      const a = this.random() * TAU;
      this.puff(x + Math.sin(a) * radius * 1.3, z + Math.cos(a) * radius * 1.3, a, 1.2, EARTH);
    }
  }

  /**
   * Sturmböe: Der Wind zeigt sich nur im Staub. Eine Staubfront läuft nach außen, weiche Fahnen krümmen sich
   * hinterher, Körner und Kiesel werden nach außen getrieben.
   */
  gust(x: number, z: number, radius: number): void {
    for (const [y, opacity] of [
      [0.45, 0.22],
      [1.3, 0.1],
    ] as const) {
      this.strips.spawn({ look: 'gust', x, z, inner: 0.6, outer: radius * 1.15, y, color: 0xd8d2c4, opacity, life: 0.6 });
    }
    this.strips.spawn({
      look: 'dustring',
      x,
      z,
      inner: radius * 0.25,
      outer: radius * 0.5,
      innerTo: radius * 0.85,
      outerTo: radius * 1.2,
      color: DUST,
      opacity: 0.75,
      life: 0.6,
    });
    this.strips.spawn({
      look: 'shock',
      x,
      z,
      inner: 0.3,
      outer: 1.2,
      innerTo: radius * 0.85,
      outerTo: radius * 1.2,
      y: 0.9,
      life: 0.45,
    });
    const p = this.particle;
    for (let i = 0; i < 64; i++) {
      const a = this.random() * TAU;
      const speed = 8 + this.random() * 7;
      p.x = x + Math.sin(a) * 0.8;
      p.y = 0.15 + this.random() * 0.9;
      p.z = z + Math.cos(a) * 0.8;
      p.vx = Math.sin(a) * speed;
      p.vy = this.random() * 0.8;
      p.vz = Math.cos(a) * speed;
      p.life = 0.5 + this.random() * 0.4;
      p.size = 0.25 + this.random() * 0.3;
      p.grow = 0.8;
      p.gravity = 0;
      p.drag = 2.2;
      p.color.set(DUST);
      p.alpha = 0.4;
      this.dust.spawn(p);
    }
    // Körner, die der Wind vor sich hertreibt.
    for (let i = 0; i < 120; i++) {
      const a = this.random() * TAU;
      const speed = 9 + this.random() * 9;
      p.x = x + Math.sin(a) * (0.6 + this.random() * 2);
      p.y = 0.1 + this.random() * 1.4;
      p.z = z + Math.cos(a) * (0.6 + this.random() * 2);
      p.vx = Math.sin(a + 0.25) * speed;
      p.vy = this.random() * 0.5;
      p.vz = Math.cos(a + 0.25) * speed;
      p.life = 0.35 + this.random() * 0.45;
      p.size = 0.04 + this.random() * 0.05;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 1.1;
      p.color.setRGB(0.95, 0.93, 0.86).multiplyScalar(0.7 + this.random() * 1.6);
      p.alpha = 0.9;
      this.glow.spawn(p);
    }
    // Kiesel, die weit hinausfliegen.
    for (let i = 0; i < 18 && this.rocks.length < this.rockMesh.instanceMatrix.count; i++) {
      const a = this.random() * TAU;
      const speed = 7 + this.random() * 7;
      this.rocks.push({
        x: x + Math.sin(a) * 0.9,
        y: 0.1 + this.random() * 0.4,
        z: z + Math.cos(a) * 0.9,
        vx: Math.sin(a) * speed,
        vy: 0.8 + this.random() * 1.6,
        vz: Math.cos(a) * speed,
        size: 0.03 + this.random() * 0.04,
        spin: (this.random() - 0.5) * 24,
        rest: -1,
      });
    }
  }

  /**
   * Sorhennas Brand: ein lautloser weißer Lichtstoß, der für einen Augenblick alles ausleuchtet.
   * Strahlen schießen in der Luft nach allen Seiten, eine Lichtwelle läuft über den Boden.
   */
  flare(x: number, z: number, radius: number): void {
    this.strips.spawn({ look: 'flare', x, z, inner: 0, outer: radius, y: 1.5, color: 0xfff6e4, opacity: 1.2, life: 0.5 });
    this.strips.spawn({
      look: 'lichtwelle',
      x,
      z,
      inner: radius * 0.1,
      outer: radius * 0.22,
      innerTo: radius * 0.8,
      outerTo: radius * 0.98,
      y: 0.06,
      color: 0xffeccc,
      opacity: 0.9,
      life: 0.55,
    });
    this.strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.3, y: 0.06, color: 0xfff6e0, opacity: 0.3, life: 0.3 });
    this.flash(x, 2.4, z, 0xffffff, 110, radius * 2.4, 0.24);
    // Der Staub in der Luft hängt noch einen Atemzug lang hell.
    for (let i = 0; i < 90; i++) {
      const a = this.random() * TAU;
      const r = Math.sqrt(this.random()) * radius;
      const p = this.particle;
      p.x = x + Math.sin(a) * r;
      p.y = 0.3 + this.random() * 1.8;
      p.z = z + Math.cos(a) * r;
      p.vx = Math.sin(a) * 0.9;
      p.vy = 0.1 + this.random() * 0.3;
      p.vz = Math.cos(a) * 0.9;
      p.life = 0.6 + this.random() * 0.9;
      p.size = 0.05 + this.random() * 0.08;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 1.5;
      p.color.set(0xfff4dc).multiplyScalar(1 + 2.5 * Math.pow(this.random(), 3));
      p.alpha = 0.9;
      this.glow.spawn(p);
    }
  }

  /**
   * Schild: eine Kuppel aus kaltem Wabenglas, am Boden durch einen hellen Ring verankert (`dome.ts`).
   * Jedes Bild aufzurufen. `hitFrom` ist die Richtung des Angreifers (0 zeigt nach +Z), wenn der Schild
   * gerade einen Treffer abgefangen hat (ohne Angabe wird eine Richtung gewürfelt); die Kuppel zerfällt von dort aus.
   */
  shield(active: boolean, x: number, z: number, hitFrom?: number): void {
    this.dome.place(x, z);
    if (active) {
      if (!this.dome.standing) this.raiseShield(x, z);
      for (const strip of [this.shieldRing, this.shieldGlow]) {
        if (!strip) continue;
        strip.x = x;
        strip.z = z;
      }
      return;
    }
    if (!this.dome.standing) return;
    for (const strip of [this.shieldRing, this.shieldGlow]) if (strip) this.strips.release(strip, 0.2);
    this.shieldRing = this.shieldGlow = null;
    const from = hitFrom ?? this.random() * TAU;
    this.dome.shatter(from);
    this.shieldBurst(x, z, from);
  }

  /** Die Kuppel wächst empor: Ein Ring läuft über den Boden nach außen und bleibt als Fuß der Kuppel stehen. */
  private raiseShield(x: number, z: number): void {
    this.dome.raise();
    this.strips.spawn({ look: 'ring', x, z, inner: 0.1, outer: 0.5, innerTo: 1.0, outerTo: 1.45, y: 0.04, color: SHIELD, opacity: 0.8, life: 0.4 });
    this.shieldRing = this.strips.spawn({ look: 'ring', x, z, inner: 0.96, outer: 1.24, y: 0.04, color: SHIELD, opacity: 0.1, life: Infinity });
    this.shieldGlow = this.strips.spawn({ look: 'glow', x, z, inner: 0, outer: 1.5, y: 0.03, color: SHIELD, opacity: 0.015, life: Infinity });
    this.sparks(x, 0.15, z, 10, SHIELD, 2);
  }

  /** Der Schild hat einen Treffer abgefangen: Die Druckwelle weicht aus, Splitter fliegen von der Einschlagstelle fort. */
  private shieldBurst(x: number, z: number, from: number): void {
    this.strips.spawn({ look: 'shock', x, z, inner: 0.6, outer: 1.2, innerTo: 2, outerTo: 2.8, y: 1, life: 0.35 });
    this.strips.spawn({ look: 'ring', x, z, inner: 1.15, outer: 1.4, innerTo: 2.1, outerTo: 2.6, y: 0.06, color: SHIELD, opacity: 0.35, life: 0.35 });
    const p = this.particle;
    // Splitter: Die meisten stieben von der Einschlagstelle fort, die übrigen fallen von der ganzen Kuppel ab.
    for (let i = 0; i < 36; i++) {
      const aimed = i < 24;
      const a = aimed ? from + (this.random() - 0.5) * 1.8 : this.random() * TAU;
      const speed = aimed ? 2.5 + this.random() * 4 : 0.8 + this.random() * 1.6;
      p.x = x + Math.sin(a) * 1.0;
      p.y = 0.3 + this.random() * 1.2;
      p.z = z + Math.cos(a) * 1.0;
      p.vx = Math.sin(a) * speed;
      p.vy = this.random() * 2.5;
      p.vz = Math.cos(a) * speed;
      p.life = 0.35 + this.random() * 0.45;
      p.size = 0.06 + this.random() * 0.08;
      p.grow = -0.08;
      p.gravity = GRAVITY * 0.6;
      p.drag = 1.1;
      p.color.set(SHIELD).multiplyScalar(1.4 + 1.8 * this.random());
      p.alpha = 1;
      this.glow.spawn(p);
    }
  }

  /** Feine Körner, die in der stehenden Kuppel langsam aufsteigen: angestrahlter Staub, nichts schwebt ohne Grund. */
  private shieldMotes(dt: number): void {
    if (!this.dome.standing) return;
    const wanted = 7 * dt;
    const count = Math.floor(wanted) + (this.random() < wanted % 1 ? 1 : 0);
    const p = this.particle;
    for (let i = 0; i < count; i++) {
      const a = this.random() * TAU;
      const r = 0.25 + this.random() * 0.75;
      p.x = this.dome.mesh.position.x + Math.sin(a) * r;
      p.y = 0.05;
      p.z = this.dome.mesh.position.z + Math.cos(a) * r;
      p.vx = 0;
      p.vy = 0.35 + this.random() * 0.4;
      p.vz = 0;
      p.life = 1.2 + this.random() * 0.8;
      p.size = 0.04 + this.random() * 0.03;
      p.grow = -0.015;
      p.gravity = 0;
      p.drag = 0.4;
      p.color.set(SHIELD).multiplyScalar(1.6);
      p.alpha = 0.75;
      this.glow.spawn(p);
    }
  }

  // -------------------------------------------------------------- Allgemein

  /**
   * Die Lichtquelle der Spielfigur, jedes Bild aufzurufen: eine Fackelflamme oder das Kerzenwort,
   * eine faustgroße, kalt leuchtende Staubwolke.
   */
  lightSource(kind: 'fackel' | 'kerzenwort', at: THREE.Vector3, dt: number): void {
    const p = this.particle;
    const wanted = (kind === 'fackel' ? 70 : 55) * dt;
    const count = Math.floor(wanted) + (this.random() < wanted % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      p.gravity = 0;
      p.alpha = 1;
      if (kind === 'fackel') {
        p.x = at.x + (this.random() - 0.5) * 0.07;
        p.y = at.y + this.random() * 0.05;
        p.z = at.z + (this.random() - 0.5) * 0.07;
        p.vx = (this.random() - 0.5) * 0.25;
        p.vy = 0.9 + this.random() * 0.9;
        p.vz = (this.random() - 0.5) * 0.25;
        p.life = 0.22 + this.random() * 0.25;
        p.size = 0.2 + this.random() * 0.1;
        p.grow = -0.45;
        p.drag = 0.6;
        // Unten hell, an den Spitzen rot.
        p.color.set(this.random() < 0.45 ? 0xffd27a : 0xff7a22);
      } else {
        const a = this.random() * TAU;
        const r = this.random() * 0.13;
        p.x = at.x + Math.sin(a) * r;
        p.y = at.y + (this.random() - 0.5) * 0.16;
        p.z = at.z + Math.cos(a) * r;
        // Die Wolke kreist langsam in sich; schweben kann kein Staub, also bleibt sie am Boden.
        p.vx = Math.cos(a) * 0.35;
        p.vy = (this.random() - 0.5) * 0.15;
        p.vz = -Math.sin(a) * 0.35;
        p.life = 0.4 + this.random() * 0.5;
        p.size = 0.09 + this.random() * 0.09;
        p.grow = -0.05;
        p.drag = 1.5;
        p.color.set(0xdfe9ff);
        p.alpha = 0.85;
      }
      this.glow.spawn(p);
    }
    // Ab und zu löst sich ein Funke von der Fackel.
    if (kind === 'fackel' && this.random() < 4 * dt) {
      p.x = at.x;
      p.y = at.y + 0.1;
      p.z = at.z;
      p.vx = (this.random() - 0.5) * 0.8;
      p.vy = 1.2 + this.random();
      p.vz = (this.random() - 0.5) * 0.8;
      p.life = 0.6 + this.random() * 0.5;
      p.size = 0.05;
      p.grow = -0.03;
      p.gravity = 1.2;
      p.drag = 0.5;
      p.color.set(0xffb060);
      this.glow.spawn(p);
    }
  }

  /** Ein Treffer an einem Gegner, auf Höhe `y`. */
  strike(x: number, y: number, z: number, kind: StrikeKind): void {
    if (kind === 'stahl') {
      this.sparks(x, y, z, 4, 0xffe2b0, 3.5);
    } else if (kind === 'brand') {
      this.sparks(x, y, z, 7, 0xffb060, 2.5);
    } else if (kind === 'glut') {
      this.sparks(x, y, z, 6, 0xff8a30, 2.5);
      this.smoke(x, y, z);
    }
    // Die Geschöpfe der Nacht sind halb Staub: Jeder Treffer schlägt etwas davon heraus.
    const p = this.particle;
    for (let i = 0; i < 2; i++) {
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = (this.random() - 0.5) * 2.5;
      p.vy = 0.5 + this.random() * 1.5;
      p.vz = (this.random() - 0.5) * 2.5;
      p.life = 0.4 + this.random() * 0.3;
      p.size = 0.25;
      p.grow = 1.2;
      p.gravity = 1.5;
      p.drag = 2;
      p.color.set(0x6b6258);
      p.alpha = 0.5;
      this.dust.spawn(p);
    }
  }

  // ---------------------------------------------------------------- Bausteine

  private after(seconds: number, run: () => void): void {
    this.later.push({ seconds, run });
  }

  private flash(x: number, y: number, z: number, color: number, intensity: number, distance: number, seconds: number): void {
    // Ein schwächerer Blitz verdrängt keinen stärkeren, der noch leuchtet.
    if (this.flashLight.intensity > intensity) return;
    this.flashLight.position.set(x, y, z);
    this.flashLight.color.set(color);
    this.flashLight.distance = distance;
    this.flashLight.intensity = intensity;
    this.flashPeak = intensity;
    this.flashAge = 0;
    this.flashLife = seconds;
  }

  /** Staub rollt als Ring über den Boden, die Luft darüber wird sichtbar verdrängt. */
  private groundWave(x: number, z: number, radius: number, color: number, opacity: number): void {
    this.strips.spawn({
      look: 'dustring',
      x,
      z,
      inner: radius * 0.2,
      outer: radius * 0.5,
      innerTo: radius * 0.9,
      outerTo: radius * 1.3,
      color,
      opacity,
      life: 0.65,
    });
    this.strips.spawn({
      look: 'shock',
      x,
      z,
      inner: radius * 0.15,
      outer: radius * 0.45,
      innerTo: radius * 0.9,
      outerTo: radius * 1.25,
      y: 0.6,
      life: 0.38,
    });
  }

  /** Rauch, der von einem Versengten aufsteigt: dunkel, langsam, fast ohne Eigenlicht. */
  private smoke(x: number, y: number, z: number): void {
    const p = this.particle;
    for (let i = 0; i < 2; i++) {
      p.x = x + (this.random() - 0.5) * 0.3;
      p.y = y + this.random() * 0.3;
      p.z = z + (this.random() - 0.5) * 0.3;
      p.vx = (this.random() - 0.5) * 0.5;
      p.vy = 0.9 + this.random() * 0.8;
      p.vz = (this.random() - 0.5) * 0.5;
      p.life = 0.8 + this.random() * 0.6;
      p.size = 0.28 + this.random() * 0.2;
      p.grow = 0.7;
      p.gravity = -0.4;
      p.drag = 1.5;
      p.color.set(0x3a3430);
      p.alpha = 0.6;
      this.dust.spawn(p);
    }
  }

  /** Funken: springen auseinander, fallen und verglühen. */
  private sparks(x: number, y: number, z: number, count: number, color: number, speed: number): void {
    const p = this.particle;
    for (let i = 0; i < count; i++) {
      const a = this.random() * TAU;
      const v = speed * (0.4 + this.random() * 0.8);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.sin(a) * v;
      p.vy = 1 + this.random() * speed * 0.7;
      p.vz = Math.cos(a) * v;
      p.life = 0.25 + this.random() * 0.3;
      p.size = 0.07 + this.random() * 0.06;
      p.grow = -0.1;
      p.gravity = GRAVITY;
      p.drag = 1.2;
      p.color.set(color);
      p.alpha = 1;
      this.glow.spawn(p);
    }
  }

  /** Eine Staubflocke, die in Richtung `angle` davonzieht und sich dabei auflöst. */
  private puff(x: number, z: number, angle: number, speed: number, color: number, alpha = 0.55): void {
    const p = this.particle;
    const v = speed * (0.4 + this.random() * 0.8);
    p.x = x;
    p.y = 0.15 + this.random() * 0.25;
    p.z = z;
    p.vx = Math.sin(angle) * v;
    p.vy = 0.4 + this.random() * 0.9;
    p.vz = Math.cos(angle) * v;
    p.life = 0.6 + this.random() * 0.6;
    p.size = 0.45 + this.random() * 0.4;
    p.grow = 1.4;
    p.gravity = -0.3;
    p.drag = 2.4;
    p.color.set(color);
    p.alpha = alpha;
    this.dust.spawn(p);
  }

  /** Wie oft in diesem Bild etwas entsteht, wenn im Mittel `wanted` Stück gebraucht werden. */
  private perFrame(wanted: number): number {
    return Math.floor(wanted) + (this.random() < wanted % 1 ? 1 : 0);
  }

  /** Ein Funke, der aus dem Feuer aufsteigt: vom Flammenring oder, mit `inside`, vom brennenden Boden darin. */
  private ember(x: number, z: number, radius: number, vigor: number, inside = false): void {
    const a = this.random() * TAU;
    const p = this.particle;
    const r = inside ? Math.sqrt(this.random()) * radius : radius + (this.random() - 0.5) * 0.9;
    p.x = x + Math.sin(a) * r;
    p.y = 0.1 + this.random() * 0.4;
    p.z = z + Math.cos(a) * r;
    p.vx = (this.random() - 0.5) * 0.8;
    p.vy = (0.7 + this.random() * 1.4) * vigor;
    p.vz = (this.random() - 0.5) * 0.8;
    p.life = 0.5 + this.random() * 0.9;
    p.size = 0.05 + this.random() * 0.07;
    p.grow = -0.03;
    p.gravity = -0.6;
    p.drag = 0.8;
    // Von rotorange bis gelb; die wenigen hellen Funken glühen über 1 und sättigen.
    const heat = this.random();
    const glow = 1 + 2.2 * Math.pow(this.random(), 3);
    p.color.setRGB(glow, glow * (0.25 + 0.5 * heat), glow * 0.05 * heat);
    p.alpha = 1;
    this.glow.spawn(p);
  }

  /** Eine kurze Flammenzunge aus dem brennenden Boden: weich, orange, steigt schnell und zieht sich zusammen. */
  private tongue(x: number, z: number, radius: number): void {
    const a = this.random() * TAU;
    const r = Math.sqrt(this.random()) * radius;
    const p = this.particle;
    p.x = x + Math.sin(a) * r;
    p.y = 0.05;
    p.z = z + Math.cos(a) * r;
    p.vx = (this.random() - 0.5) * 0.5;
    p.vy = 1.1 + this.random() * 1.2;
    p.vz = (this.random() - 0.5) * 0.5;
    p.life = 0.35 + this.random() * 0.35;
    p.size = 0.22 + this.random() * 0.2;
    p.grow = -0.35;
    p.gravity = -0.6;
    p.drag = 1.2;
    p.color.setRGB(1.5, 0.42 + 0.3 * this.random(), 0.05);
    p.alpha = 0.4;
    this.glow.spawn(p);
  }

  /** Ein Rauchfaden, der über dem Feuer aufsteigt: dunkel, langsam, fast ohne Eigenlicht. */
  private fireSmoke(x: number, z: number, radius: number): void {
    const a = this.random() * TAU;
    const r = radius * (0.5 + 0.5 * Math.sqrt(this.random()));
    const p = this.particle;
    p.x = x + Math.sin(a) * r;
    p.y = 0.8 + this.random() * 0.6;
    p.z = z + Math.cos(a) * r;
    p.vx = (this.random() - 0.5) * 0.4;
    p.vy = 0.8 + this.random() * 0.6;
    p.vz = (this.random() - 0.5) * 0.4;
    p.life = 1 + this.random() * 0.8;
    p.size = 0.35 + this.random() * 0.25;
    p.grow = 0.5;
    p.gravity = -0.3;
    p.drag = 1.2;
    p.color.set(0x2c2824);
    p.alpha = 0.3;
    this.dust.spawn(p);
  }

  private updateHail(dt: number): void {
    let shown = 0;
    for (let i = this.hail.length - 1; i >= 0; i--) {
      const arrow = this.hail[i];
      if (!arrow) continue;
      const before = arrow.lands;
      arrow.lands -= dt;
      if (arrow.lands < -STUCK_SECONDS) {
        const last = this.hail.pop();
        if (last && last !== arrow) this.hail[i] = last;
        continue;
      }
      if (before > 0 && arrow.lands <= 0) this.puff(arrow.x, arrow.z, this.random() * TAU, 1, DUST, 0.4);
    }
    for (const arrow of this.hail) {
      // Erst kurz vor dem Einschlag kommt der Pfeil ins Bild.
      if (arrow.lands > HAIL_FLIGHT || shown >= this.hailMesh.instanceMatrix.count) continue;
      // Lage der Pfeilmitte auf der Flugbahn, gemessen vom Einschlagpunkt: Im Boden steckt die
      // Spitze eine Handbreit tief, davor liegt der Pfeil noch entsprechend weit zurück.
      const along = 0.1 - HAIL_ARROW_HALF - Math.max(0, arrow.lands) * HAIL_SPEED;
      // Am Ende versinkt er.
      const sunk = Math.max(0, -arrow.lands - (STUCK_SECONDS - 0.3)) * 3;
      pose.position.set(arrow.x + arrow.dx * along, arrow.dy * along - sunk, arrow.z + arrow.dz * along);
      pose.quaternion.setFromUnitVectors(FORWARD, heading.set(arrow.dx, arrow.dy, arrow.dz));
      pose.scale.setScalar(1.15);
      pose.updateMatrix();
      this.hailMesh.setMatrixAt(shown++, pose.matrix);
    }
    this.hailMesh.count = shown;
    this.hailMesh.instanceMatrix.needsUpdate = true;
  }

  private updateRocks(dt: number): void {
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const rock = this.rocks[i];
      if (!rock) continue;
      if (rock.rest < 0) {
        rock.vy -= GRAVITY * dt;
        rock.x += rock.vx * dt;
        rock.y += rock.vy * dt;
        rock.z += rock.vz * dt;
        if (rock.y <= 0 && rock.vy < 0) {
          rock.y = 0;
          rock.rest = 0;
        }
      } else {
        rock.rest += dt;
        // Liegen gebliebene Brocken sinken zurück in den Boden.
        if (rock.rest > 0.9) {
          const last = this.rocks.pop();
          if (last && last !== rock) this.rocks[i] = last;
        }
      }
    }
    for (const [index, rock] of this.rocks.entries()) {
      const flying = rock.rest < 0;
      const shrink = flying ? 1 : Math.max(0, 1 - Math.max(0, rock.rest - 0.5) / 0.4);
      pose.position.set(rock.x, rock.y + rock.size * 0.5 * shrink, rock.z);
      pose.rotation.set(flying ? rock.spin * rock.y : rock.spin, rock.spin, 0);
      pose.scale.setScalar(rock.size * shrink);
      pose.updateMatrix();
      this.rockMesh.setMatrixAt(index, pose.matrix);
    }
    this.rockMesh.count = this.rocks.length;
    this.rockMesh.instanceMatrix.needsUpdate = true;
  }

  private updateShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const shard = this.shards[i];
      if (!shard) continue;
      shard.age += dt;
      if (shard.age < shard.life) continue;
      const last = this.shards.pop();
      if (last && last !== shard) this.shards[i] = last;
    }
    let shown = 0;
    for (const shard of this.shards) {
      // Wer noch verzögert ist, steht noch nicht da.
      if (shard.age < 0) continue;
      // Sie schießen hoch, schwingen etwas über und sinken am Ende zurück.
      const t = Math.min(1, shard.age / 0.14);
      const grown = 1 + 0.12 * Math.sin(t * Math.PI) - (1 - t) * (1 - t);
      const sink = Math.min(1, (shard.life - shard.age) / 0.5);
      const height = Math.max(0.001, grown * sink) * shard.height;
      pose.position.set(shard.x, 0, shard.z);
      pose.quaternion
        .copy(yawTurn.setFromAxisAngle(UP, shard.yaw))
        .multiply(leanTurn.setFromAxisAngle(RIGHT, shard.lean))
        .multiply(selfTurn.setFromAxisAngle(UP, shard.spin));
      pose.scale.set(shard.width, height, shard.width);
      pose.updateMatrix();
      this.shardMesh.setMatrixAt(shown, pose.matrix);
      this.shardMesh.setColorAt(shown, stoneTint.setScalar(shard.tint));
      shown++;
    }
    this.shardMesh.count = shown;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    if (this.shardMesh.instanceColor) this.shardMesh.instanceColor.needsUpdate = true;
  }

  private updateRoots(dt: number): void {
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const roots = this.roots[i];
      if (!roots) continue;
      roots.age += dt;
      if (roots.age >= roots.life) {
        const last = this.roots.pop();
        if (last && last !== roots) this.roots[i] = last;
      }
    }
    for (const [index, roots] of this.roots.entries()) {
      // Sie schießen hoch, schwingen etwas über und welken am Ende zurück in den Boden.
      const t = Math.min(1, roots.age / 0.28);
      const grown = 1 + 0.18 * Math.sin(t * Math.PI) - (1 - t) * (1 - t);
      const wilt = Math.min(1, (roots.life - roots.age) / 0.45);
      const height = Math.max(0.001, grown * wilt);
      pose.position.set(roots.x, 0, roots.z);
      pose.rotation.set(0, roots.yaw + (1 - t) * 1.2, 0);
      pose.scale.set(roots.scale * (0.75 + 0.25 * t), roots.scale * height, roots.scale * (0.75 + 0.25 * t));
      pose.updateMatrix();
      this.rootMesh.setMatrixAt(index, pose.matrix);
    }
    this.rootMesh.count = this.roots.length;
    this.rootMesh.instanceMatrix.needsUpdate = true;
  }

  private updateSnapped(dt: number): void {
    for (let i = this.snapped.length - 1; i >= 0; i--) {
      const trap = this.snapped[i];
      if (!trap) continue;
      trap.age += dt;
      if (trap.age > 2.4) this.snapped.splice(i, 1);
    }
    for (const [index, trap] of this.snapped.entries()) {
      // Der Schlag lässt das Eisen kurz springen; am Ende versinkt es.
      const hop = Math.max(0, 0.12 - trap.age) * 1.5;
      const sink = Math.max(0, trap.age - 2) / 0.4;
      pose.position.set(trap.x, hop - sink * 0.6, trap.z);
      pose.rotation.set(0, trap.x * 12.9898 + trap.z * 78.233, 0);
      pose.scale.setScalar(1.15);
      pose.updateMatrix();
      this.shutTraps.setMatrixAt(index, pose.matrix);
    }
    this.shutTraps.count = this.snapped.length;
    this.shutTraps.instanceMatrix.needsUpdate = true;
  }
}
