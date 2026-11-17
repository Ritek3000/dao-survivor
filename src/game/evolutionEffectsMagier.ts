/**
 * Wie die Evolutionen des Magiers aussehen (siehe `evolutionsMagier.ts`): der weiße Hitzesturm und die Glut, die ein Verbrannter
 * hinterlässt, der Lichtspeer mit seinen vier Strahlen, die weißglühende Krone, die drei Ringe des Bebens und sein Trümmerfeld, das
 * Geflecht des Griffs, der dauernde Wind des Orkans und die kreisenden Runen der Kuppel. Dieselben Bausteine wie bei den anderen
 * Evolutionen (Flächen aus dem Shader, Teilchen aus dem Vorrat); neu ist nur ein kleines Instanznetz für die Runen.
 *
 * Im Kampf entsteht nichts Neues: Gehaltene Flächen werden nachgeführt und beim Ende ausgeblendet, Teilchen kommen aus dem Vorrat.
 */
import * as THREE from 'three';
import { swallowedByFinsternis } from './darkness';
import type { EffectTools } from './evolutionEffects';
import type { Strip } from './strips';

/** So viele Runen zeichnet der Kampf höchstens zugleich. */
export const RUNE_CAPACITY = 6;
/** Wie weit die Runen um die Figur kreisen (Meter) und in welcher Höhe. */
const RUNE_ORBIT = 1.5;
const RUNE_LIFT = 1.15;

const SUN = 0xffe6a8;
const SUN_WHITE = 0xfff3d4;
const EMBER = 0xff7a2a;
const DUST = 0xa3927a;
const EARTH = 0x8a775c;
const ROOT = 0x6f5d3f;
const WIND = 0xd8d2c4;
const RUNE = 0x9bbcff;
const TAU = Math.PI * 2;

const pose = new THREE.Object3D();

export class MagierEffects {
  readonly group = new THREE.Group();
  private readonly runeMesh: THREE.InstancedMesh;
  private crownGlow: Strip | null = null;
  private crownRing: Strip | null = null;
  private galeRing: Strip | null = null;
  private runeRing: Strip | null = null;
  /** Wie viele Körner die Rand-Funken der Krone und die Schweife der Runen noch schuldig sind (Bruchteile eines Korns je Bild). */
  private crownDebt = 0;
  private galeDebt = 0;
  private runeDebt = 0;

  constructor(private readonly tools: EffectTools) {
    // Eine Raute, schmal und flach: ein Stein mit eingeritzter Rune, der von innen leuchtet.
    const geometry = new THREE.OctahedronGeometry(0.5, 0).scale(0.5, 1.15, 0.22);
    const material = swallowedByFinsternis(
      new THREE.MeshStandardMaterial({ color: 0x6f8fd8, roughness: 0.35, emissive: new THREE.Color(RUNE), emissiveIntensity: 1.6, flatShading: true }),
    );
    this.runeMesh = new THREE.InstancedMesh(geometry, material, RUNE_CAPACITY);
    this.runeMesh.frustumCulled = false;
    this.runeMesh.count = 0;
    this.group.add(this.runeMesh);
  }

  reset(): void {
    this.crownGlow = this.crownRing = this.galeRing = this.runeRing = null;
    this.crownDebt = this.galeDebt = this.runeDebt = 0;
    this.runeMesh.count = 0;
  }

  /** Lässt eine gehaltene Fläche ausklingen und vergisst sie. */
  private letGo(strip: Strip | null): null {
    if (strip) this.tools.strips.release(strip, 0.4);
    return null;
  }

  // ------------------------------------------------------------ Atem der Verblassenden Sor

  /**
   * Der Hitzesturm bricht los. Der Kegel flimmert schon wie bei jeder Hitze (`Effects.heat`); hier kommt der weiße Kern dazu:
   * ein Hof aus gleißendem Staub über den ganzen Kegel, eine helle Kante an seinem Rand und weißgoldene Körner, die hinausfliegen.
   */
  sunBreath(x: number, z: number, angle: number, range: number, width: number): void {
    const { strips, random, particle: p } = this.tools;
    strips.spawn({ look: 'glow', x, z, angle, width, inner: 0.4, outer: range * 1.05, y: 0.06, color: 0xffb060, opacity: 0.28, life: 0.55 });
    strips.spawn({ look: 'slash', x, z, angle, width: width + 0.2, inner: range * 0.88, outer: range, y: 0.9, color: SUN_WHITE, opacity: 0.4, life: 0.35 });
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    for (let i = 0; i < 44; i++) {
      const along = 1 + (range - 1.2) * Math.pow(random(), 0.8);
      const spread = 0.3 + along * Math.tan(Math.min(width, 2.4) / 2);
      const side = (random() + random() - 1) * spread;
      const drift = 1.2 + random() * 1.5;
      p.x = x + sin * along + cos * side;
      p.y = 0.15 + random() * 1.6;
      p.z = z + cos * along - sin * side;
      p.vx = sin * drift;
      p.vy = 0.5 + random() * 0.4;
      p.vz = cos * drift;
      p.life = 0.5 + random() * 0.6;
      p.size = 0.07 + random() * 0.07;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 1.1;
      // Über 1: Der Kern des Korns sättigt weiß, nur sein Rand bleibt golden.
      const glow = 2 + 3 * Math.pow(random(), 3);
      p.color.setRGB(glow, glow * 0.9, glow * 0.62);
      p.alpha = 1;
      this.tools.glow.spawn(p);
    }
    this.tools.flash(x + sin * range * 0.4, 1.5, z + cos * range * 0.4, 0xffd9a0, 40, range, 0.22);
  }

  /** Ein Brennender ist gestorben: Der Staub um ihn fängt Feuer und brennt `seconds` lang weiter. */
  sunIgnite(x: number, z: number, radius: number, seconds: number): void {
    const { strips, random } = this.tools;
    // Das Brandbett hat keinen Verlauf; es läuft, bis man es loslässt.
    const bed = strips.spawn({ look: 'brandbett', x, z, inner: 0, outer: radius, y: 0.03, life: Infinity });
    this.tools.after(Math.max(0.1, seconds - 0.45), () => strips.release(bed, 0.4));
    strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.5, y: 0.05, color: EMBER, opacity: 0.2, life: seconds });
    this.tools.groundWave(x, z, radius * 1.3, EMBER, 0.55);
    this.tools.sparks(x, 0.3, z, 8, SUN, 3.5);
    for (let i = 0; i < 4; i++) this.tools.puff(x, z, random() * TAU, 1.4, DUST, 0.45);
  }

  // ------------------------------------------------------ Speer der Verschwundenen Sonne

  /** Der Speer wird gerufen: Ein Ring zieht sich auf die Stelle zusammen, an der er einschlägt; ein Hof Licht wächst darunter. */
  spearMark(x: number, z: number, radius: number, delay: number): void {
    const { strips } = this.tools;
    strips.spawn({ look: 'sogrand', x, z, inner: 0, outer: radius * 1.35, y: 0.08, color: SUN, opacity: 0.8, life: delay });
    strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.5, y: 0.05, color: SUN, opacity: 0.2, life: delay + 0.3 });
    // Ein dünner Schein fällt schon vor dem Einschlag von oben.
    const p = this.tools.particle;
    for (let i = 0; i < 6; i++) {
      const a = this.tools.random() * TAU;
      const r = Math.sqrt(this.tools.random()) * radius;
      p.x = x + Math.sin(a) * r;
      p.y = 0.2;
      p.z = z + Math.cos(a) * r;
      p.vx = 0;
      p.vy = 0.8 + this.tools.random();
      p.vz = 0;
      p.life = delay;
      p.size = 0.08;
      p.grow = 0;
      p.gravity = 0;
      p.drag = 0;
      p.color.set(SUN).multiplyScalar(1.6);
      p.alpha = 0.8;
      this.tools.glow.spawn(p);
    }
  }

  /** Der Speer schlägt ein: Eine Säule aus Licht fährt vom Himmel, der Boden reißt auf, ein Ring aus Druck läuft hinaus. */
  spearImpact(x: number, z: number, radius: number, angle: number): void {
    const { strips, random, particle: p } = this.tools;
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.2, outer: radius * 0.4, innerTo: radius * 1.1, outerTo: radius * 1.25, y: 0.1, color: SUN_WHITE, opacity: 1, life: 0.45 });
    strips.spawn({ look: 'shock', x, z, inner: 0.5, outer: 1.4, innerTo: radius * 1.6, outerTo: radius * 1.9, y: 0.9, life: 0.5 });
    strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 2.2, y: 0.07, color: SUN, opacity: 0.55, life: 0.6 });
    strips.spawn({ look: 'crack', x, z, inner: 0, outer: radius * 1.4, y: 0.05, opacity: 0.9, life: 1.6 });
    this.tools.groundWave(x, z, radius * 1.6, DUST, 0.8);
    // Die Säule: Funken, die in einer Schicht von hoch oben herabschießen.
    for (let i = 0; i < 40; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius * 0.35;
      p.x = x + Math.sin(a) * r;
      p.y = 1 + random() * 8;
      p.z = z + Math.cos(a) * r;
      p.vx = 0;
      p.vy = -(26 + random() * 14);
      p.vz = 0;
      p.life = 0.22 + random() * 0.1;
      p.size = 0.18 + random() * 0.12;
      p.grow = -0.3;
      p.gravity = 0;
      p.drag = 0;
      p.color.set(SUN_WHITE).multiplyScalar(2);
      p.alpha = 1;
      this.tools.glow.spawn(p);
    }
    this.tools.sparks(x, 0.4, z, 36, SUN_WHITE, 9);
    this.tools.flash(x, 2.2, z, 0xfff0c8, 110, 16, 0.35);
    for (let i = 0; i < 14; i++) this.tools.puff(x, z, angle + (i / 14) * TAU, 4, DUST, 0.6);
  }

  /** Ein Strahl des Speers fegt flach über den Boden. */
  spearRay(x: number, z: number, angle: number, length: number, width: number): void {
    const { strips } = this.tools;
    strips.spawn({ look: 'lance', x, z, angle, width: width * 1.4, inner: 0.4, outer: length, y: 0.45, color: SUN, life: 0.36 });
    strips.spawn({ look: 'lancelight', x, z, angle, width: width * 3.4, inner: 0.2, outer: length + 0.5, y: 0.07, color: SUN, opacity: 0.3, life: 0.4 });
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    for (let i = 0; i < 5; i++) {
      const along = this.tools.random() * length;
      this.tools.sparks(x + sin * along, 0.2, z + cos * along, 2, SUN_WHITE, 2.2);
    }
  }

  // ------------------------------------------------------ Krone der Erloschenen Sor

  /**
   * Die Krone: Über dem Glutkreis der Figur liegt weißes Licht, am Rand steht ein heller Ring, und Funken steigen auf wie Zacken einer Krone.
   * Jedes Bild aufzurufen; mit `active` = false erlischt sie.
   */
  crown(active: boolean, x: number, z: number, radius: number, time: number, dt: number): void {
    if (!active) {
      this.crownGlow = this.letGo(this.crownGlow);
      this.crownRing = this.letGo(this.crownRing);
      this.crownDebt = 0;
      return;
    }
    const { strips, random, particle: p } = this.tools;
    this.crownGlow ??= strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.2, y: 0.06, color: SUN_WHITE, opacity: 0.2, life: Infinity });
    this.crownRing ??= strips.spawn({ look: 'ring', x, z, inner: radius * 0.97, outer: radius * 1.05, y: 0.08, color: 0xffe9b8, opacity: 0.5, life: Infinity });
    const flicker = 1 + 0.12 * Math.sin(time * 9) + 0.08 * Math.sin(time * 23.1 + 0.7);
    for (const strip of [this.crownGlow, this.crownRing]) {
      strip.x = x;
      strip.z = z;
    }
    this.crownGlow.spec.outer = radius * 1.2;
    this.crownGlow.opacity = 0.2 * flicker;
    this.crownRing.spec.inner = radius * 0.97;
    this.crownRing.spec.outer = radius * 1.05;
    this.crownRing.opacity = 0.5 * flicker;
    this.crownDebt += 34 * dt;
    const count = Math.floor(this.crownDebt);
    this.crownDebt -= count;
    for (let i = 0; i < count; i++) {
      const a = random() * TAU;
      p.x = x + Math.sin(a) * radius * (0.96 + random() * 0.08);
      p.y = 0.1;
      p.z = z + Math.cos(a) * radius * (0.96 + random() * 0.08);
      p.vx = (random() - 0.5) * 0.4;
      p.vy = 1.4 + random() * 1.6;
      p.vz = (random() - 0.5) * 0.4;
      p.life = 0.45 + random() * 0.5;
      p.size = 0.07 + random() * 0.06;
      p.grow = -0.04;
      p.gravity = 0;
      p.drag = 0.5;
      p.color.setRGB(2.2, 1.8, 1.1);
      p.alpha = 0.95;
      this.tools.glow.spawn(p);
    }
  }

  /** Eine Hitzewelle der Krone: Ein weißer Ring jagt aus der Mitte des Gestorbenen hinaus. */
  crownWave(x: number, z: number, radius: number): void {
    const { strips } = this.tools;
    strips.spawn({ look: 'ring', x, z, inner: radius * 0.1, outer: radius * 0.25, innerTo: radius * 0.85, outerTo: radius, y: 0.1, color: SUN_WHITE, opacity: 0.85, life: 0.4 });
    strips.spawn({ look: 'glow', x, z, inner: 0, outer: radius * 1.2, y: 0.06, color: 0xff9a40, opacity: 0.3, life: 0.4 });
    this.tools.sparks(x, 0.4, z, 9, SUN, 4);
    this.tools.groundWave(x, z, radius, EMBER, 0.45);
  }

  // ---------------------------------------------------------- Beben der Alten Ordnung

  /** Ein Ring des Bebens beginnt zu laufen: Staub und Splitter rollen hinaus, der Boden bricht hinter ihm auf. */
  quakeRing(x: number, z: number, max: number, ring: number, seconds: number): void {
    const { strips, random, particle: p } = this.tools;
    strips.spawn({ look: 'dustring', x, z, inner: max * 0.15, outer: max * 0.3, innerTo: max * 0.85, outerTo: max * 1.05, y: 0.06, color: EARTH, opacity: 0.9, life: seconds + 0.25 });
    strips.spawn({ look: 'shock', x, z, inner: 0.4, outer: 1.2, innerTo: max * 0.9, outerTo: max * 1.1, y: 0.7, life: seconds + 0.2 });
    if (ring === 0) strips.spawn({ look: 'crack', x, z, inner: 0, outer: max * 2.1, y: 0.04, opacity: 0.95, life: 3.2 });
    this.tools.groundWave(x, z, max, EARTH, 0.8);
    const count = Math.min(40, Math.round(max * 6));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + random() * 0.2;
      const r = max * (0.1 + 0.8 * random());
      const out = 3 + random() * 4;
      p.x = x + Math.sin(a) * r;
      p.y = 0.1 + random() * 0.3;
      p.z = z + Math.cos(a) * r;
      p.vx = Math.sin(a) * out;
      p.vy = 2 + random() * 3.5;
      p.vz = Math.cos(a) * out;
      p.life = 0.45 + random() * 0.5;
      p.size = 0.05 + random() * 0.05;
      p.grow = 0;
      p.gravity = 9;
      p.drag = 0.6;
      p.color.setRGB(0.95, 0.78, 0.55).multiplyScalar(0.9 + random() * 1.1);
      p.alpha = 0.9;
      this.tools.glow.spawn(p);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      this.tools.puff(x + Math.sin(a) * max * 0.7, z + Math.cos(a) * max * 0.7, a, 2.4, EARTH, 0.6);
    }
  }

  /** Das Trümmerfeld: Der zerrissene Boden bleibt `seconds` lang liegen, Staub steigt aus den Spalten. */
  debris(x: number, z: number, radius: number, seconds: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'crack', x, z, inner: 0, outer: radius * 1.1, y: 0.045, opacity: 0.95, life: seconds });
    strips.spawn({ look: 'dustring', x, z, inner: 0, outer: radius, y: 0.05, color: EARTH, opacity: 0.55, life: seconds });
    for (let i = 0; i < 12; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius * 0.9;
      this.tools.puff(x + Math.sin(a) * r, z + Math.cos(a) * r, a, 1.2, EARTH, 0.5);
    }
  }

  // ---------------------------------------------------------- Griff der Alten Tiefe

  /**
   * Das Geflecht bricht aus dem Boden: Die Bahn reißt auf, Erde stäubt am ganzen Weg, um die Mitte schließen sich die Spalten
   * und ein Ring aus Staub zeigt, wie lange der Griff hält.
   */
  gripCast(startX: number, startZ: number, angle: number, length: number, width: number, centerX: number, centerZ: number, bundle: number, hold: number): void {
    const { strips, random } = this.tools;
    strips.spawn({ look: 'bahn', x: startX, z: startZ, angle, width, inner: 0.2, outer: length, y: 0.05, color: 0xb59a68, opacity: 0.6, life: 0.7 });
    strips.spawn({ look: 'crack', x: centerX, z: centerZ, inner: 0, outer: Math.max(bundle * 2.4, length * 0.3), y: 0.04, opacity: 0.95, life: hold + 0.6 });
    strips.spawn({ look: 'footcrack', x: centerX, z: centerZ, inner: 0, outer: bundle + 0.9, y: 0.045, opacity: 0.95, life: hold });
    strips.spawn({ look: 'dustring', x: centerX, z: centerZ, inner: 0, outer: bundle + 0.5, y: 0.05, color: ROOT, opacity: 0.7, life: hold });
    this.tools.groundWave(centerX, centerZ, bundle * 2.2, EARTH, 0.85);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    for (let i = 0; i < 22; i++) {
      const along = random() * length;
      const side = (random() - 0.5) * width;
      this.tools.puff(startX + sin * along + cos * side, startZ + cos * along - sin * side, angle, 1.8, EARTH, 0.6);
    }
    this.tools.sparks(centerX, 0.3, centerZ, 14, 0xd8b878, 4);
  }

  /** Das Geflecht zehrt (jeder Takt): ein paar dunkelrote Tropfen und Staub in der Mitte. */
  gripDrain(x: number, z: number, radius: number): void {
    const { random, particle: p } = this.tools;
    for (let i = 0; i < 6; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * radius;
      p.x = x + Math.sin(a) * r;
      p.y = 0.2 + random() * 0.6;
      p.z = z + Math.cos(a) * r;
      p.vx = Math.sin(a) * 0.6;
      p.vy = 0.8 + random() * 1.4;
      p.vz = Math.cos(a) * 0.6;
      p.life = 0.4 + random() * 0.3;
      p.size = 0.08 + random() * 0.05;
      p.grow = -0.05;
      p.gravity = 4;
      p.drag = 0.3;
      p.color.setRGB(1.3, 0.35, 0.25);
      p.alpha = 0.9;
      this.tools.glow.spawn(p);
    }
    this.tools.groundWave(x, z, radius, ROOT, 0.35);
  }

  // ---------------------------------------------------------- Orkan der Alten Ordnung

  /** Der dauernde Luftstrom: Windfahnen laufen unablässig um die Figur, Staub wirbelt auf. Jedes Bild; mit `active` = false legt er sich. */
  gale(active: boolean, x: number, z: number, dt: number): void {
    if (!active) {
      this.galeRing = this.letGo(this.galeRing);
      this.galeDebt = 0;
      return;
    }
    const { strips, random } = this.tools;
    if (!this.galeRing) {
      this.galeRing = strips.spawn({ look: 'gust', x, z, inner: 0.9, outer: 3.4, y: 0.35, color: WIND, opacity: 0.26, life: Infinity });
      // Der Verlauf der Fahnen liegt in der Zeit; ohne sie stünde der Wind bei null und bliebe unsichtbar.
      this.galeRing.held = 0.7;
    }
    this.galeRing.x = x;
    this.galeRing.z = z;
    // Die Fahnen stehen im Raum still; die Drehung der Fläche lässt sie um die Figur kreisen.
    this.galeRing.angle += dt * 2.2;
    this.galeDebt += 14 * dt;
    const count = Math.floor(this.galeDebt);
    this.galeDebt -= count;
    for (let i = 0; i < count; i++) {
      const a = random() * TAU;
      this.tools.puff(x + Math.sin(a) * 1.2, z + Math.cos(a) * 1.2, a + Math.PI / 2, 2.4, DUST, 0.3);
    }
  }

  /** Eine Böe des Orkans: weitere Fahnen und eine Welle aus Druck; die zweite Böe ist heller, sie holt auf. */
  galeGust(x: number, z: number, angle: number, range: number, width: number, second: boolean): void {
    const { strips, random, particle: p } = this.tools;
    strips.spawn({ look: 'gust', x, z, angle, width: width * 1.15, inner: 0.5, outer: range * 1.15, y: second ? 1 : 0.7, color: WIND, opacity: second ? 0.2 : 0.16, life: 0.6 });
    strips.spawn({ look: 'shock', x, z, angle, width, inner: 0.4, outer: 1.4, innerTo: range * 0.9, outerTo: range * 1.25, y: 0.9, life: 0.5 });
    for (let i = 0; i < 30; i++) {
      const a = angle + (random() - 0.5) * width;
      const speed = 11 + random() * 8;
      p.x = x + Math.sin(a) * 0.7;
      p.y = 0.2 + random() * 1.1;
      p.z = z + Math.cos(a) * 0.7;
      p.vx = Math.sin(a + 0.18) * speed;
      p.vy = random() * 0.6;
      p.vz = Math.cos(a + 0.18) * speed;
      p.life = 0.4 + random() * 0.35;
      p.size = 0.3 + random() * 0.3;
      p.grow = 0.9;
      p.gravity = 0;
      p.drag = 2.4;
      p.color.set(DUST);
      p.alpha = 0.4;
      this.tools.dust.spawn(p);
    }
  }

  // ---------------------------------------------------------- Kuppel der Alten Ordnung

  /**
   * Die Runen: je eine für jede Ladung, auf einem Kreis um die Figur, der sich dreht. Die Runen stehen fest an ihren Plätzen
   * (Platz 0 bis 2): Bricht eine, verschwindet die letzte, und die anderen bleiben, wo sie sind. Jedes Bild aufzurufen.
   */
  runes(charges: number, x: number, z: number, phase: number, time: number, dt: number): void {
    const shown = Math.min(charges, RUNE_CAPACITY);
    for (let i = 0; i < shown; i++) {
      const a = phase + (i / Math.max(3, shown)) * TAU;
      pose.position.set(x + Math.sin(a) * RUNE_ORBIT, RUNE_LIFT + 0.1 * Math.sin(time * 2.1 + i * 2), z + Math.cos(a) * RUNE_ORBIT);
      // Die breite Seite zeigt nach außen, die Rune wiegt sich leicht.
      pose.rotation.set(0.12 * Math.sin(time * 1.7 + i), a, 0);
      // Sie sind größer als ein Stein im Staub: Neben dem hellen Schildglühen der Figur müssen sie sich abheben.
      pose.scale.setScalar(1.5);
      pose.updateMatrix();
      this.runeMesh.setMatrixAt(i, pose.matrix);
    }
    this.runeMesh.count = shown;
    this.runeMesh.instanceMatrix.needsUpdate = true;
    if (shown === 0) {
      this.runeRing = this.letGo(this.runeRing);
      this.runeDebt = 0;
      return;
    }
    const { strips, random, particle: p } = this.tools;
    this.runeRing ??= strips.spawn({ look: 'ring', x, z, inner: RUNE_ORBIT - 0.05, outer: RUNE_ORBIT + 0.05, y: 0.07, color: RUNE, opacity: 0.4, life: Infinity });
    this.runeRing.x = x;
    this.runeRing.z = z;
    this.runeRing.opacity = 0.34 + 0.08 * Math.sin(time * 3.1);
    // Jede Rune lässt Funken hinter sich.
    this.runeDebt += shown * 5 * dt;
    const count = Math.floor(this.runeDebt);
    this.runeDebt -= count;
    for (let i = 0; i < count; i++) {
      const slot = Math.floor(random() * shown);
      const a = phase + (slot / Math.max(3, shown)) * TAU - 0.12;
      p.x = x + Math.sin(a) * RUNE_ORBIT;
      p.y = RUNE_LIFT + (random() - 0.5) * 0.5;
      p.z = z + Math.cos(a) * RUNE_ORBIT;
      p.vx = 0;
      p.vy = 0.2 + random() * 0.3;
      p.vz = 0;
      p.life = 0.35 + random() * 0.3;
      p.size = 0.06 + random() * 0.04;
      p.grow = -0.08;
      p.gravity = 0;
      p.drag = 0.4;
      p.color.set(RUNE).multiplyScalar(1.8);
      p.alpha = 0.9;
      this.tools.glow.spawn(p);
    }
  }

  /** Eine Rune zerbricht: Splitter aus kaltem Licht, und eine scharfe Welle fährt in Blickrichtung hinaus. */
  runeBreak(x: number, z: number, facing: number, range: number, arc: number): void {
    const { strips, random, particle: p } = this.tools;
    strips.spawn({ look: 'ring', x, z, angle: facing, width: arc, inner: 0.8, outer: 1.5, innerTo: range * 0.8, outerTo: range, y: 0.1, color: 0xd5e4ff, opacity: 0.95, life: 0.42 });
    strips.spawn({ look: 'shock', x, z, angle: facing, width: arc, inner: 0.6, outer: 1.5, innerTo: range * 0.85, outerTo: range * 1.15, y: 0.9, life: 0.5 });
    strips.spawn({ look: 'slash', x, z, angle: facing, width: arc, inner: range * 0.75, outer: range, y: 0.9, color: 0xe6efff, opacity: 0.45, life: 0.3 });
    this.tools.groundWave(x + Math.sin(facing) * range * 0.4, z + Math.cos(facing) * range * 0.4, range * 0.7, RUNE, 0.6);
    for (let i = 0; i < 26; i++) {
      const a = facing + (random() - 0.5) * arc;
      const speed = 5 + random() * 7;
      p.x = x + Math.sin(a) * RUNE_ORBIT;
      p.y = RUNE_LIFT + (random() - 0.5) * 0.6;
      p.z = z + Math.cos(a) * RUNE_ORBIT;
      p.vx = Math.sin(a) * speed;
      p.vy = 0.5 + random() * 2;
      p.vz = Math.cos(a) * speed;
      p.life = 0.35 + random() * 0.35;
      p.size = 0.07 + random() * 0.06;
      p.grow = -0.1;
      p.gravity = 4;
      p.drag = 0.7;
      p.color.set(RUNE).multiplyScalar(2);
      p.alpha = 1;
      this.tools.glow.spawn(p);
    }
    this.tools.flash(x + Math.sin(facing) * 1.5, 1.4, z + Math.cos(facing) * 1.5, 0xcfe0ff, 40, 8, 0.2);
    for (let i = 0; i < 8; i++) this.tools.puff(x, z, facing + (random() - 0.5) * arc, 3.2, DUST, 0.4);
  }
}
