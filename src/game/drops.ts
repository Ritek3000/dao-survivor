import * as THREE from 'three';
import { CONFIG } from '../config';
import { RARITIES, type Item } from './items';
import type { Site } from './zones';

const DROP = CONFIG.loot.drop;
const COLLECT_DISTANCE = 0.7;
const COLORS = RARITIES.map((rarity) => new THREE.Color(CONFIG.loot.colors[rarity]));
/** Wie lange ein Gegenstand je Seltenheit liegt: Ein Legendäres darf man ruhig länger bestaunen. */
const WAIT_FACTOR = [0.8, 1, 1.3, 1.9];
/** Wie breit der Strahl je Seltenheit ist. */
const BEAM_WIDTH = [1, 1.1, 1.35, 1.8];
/** So lange (Sekunden) wächst der Strahl beim Fallen, und so lange springt ein Gegenstand aus der Kiste an seinen Platz. */
const GROW_SECONDS = 0.25;
const SPILL_SECONDS = 0.5;
/** Wie schnell (Radiant je Sekunde) sich der Stein dreht. */
const SPIN = 2.4;
const pose = new THREE.Object3D();

/** Färbt alle Ecken mit dem Helligkeitsverlauf von unten (1) nach oben (0); mit Additiv-Mischung wird der Strahl dort durchsichtig. */
function fading(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const top = DROP.beamHeight;
  for (let i = 0; i < position.count; i++) {
    const brightness = Math.max(0, 1 - position.getY(i) / top);
    colors.fill(brightness * brightness, i * 3, i * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Gegenstände, die erschlagene Gegner und die Kiste fallen lassen: ein Stein in der Farbe der Seltenheit unter einem Lichtstrahl.
 * Sie liegen einen Augenblick da und fliegen dann der Figur zu, wo sie auch steht; so geht nichts verloren, auch wenn der
 * Verschlinger kurz vor Sonnenaufgang fällt. Wie Münzen und Edelsteine liegen sie in einem festen Vorrat (keine neuen Objekte im Kampf).
 */
export class Drops {
  readonly group = new THREE.Group();
  private readonly x = new Float32Array(DROP.max);
  private readonly z = new Float32Array(DROP.max);
  /** Wo der Gegenstand aufschlägt, wenn er aus der Kiste springt; sonst gleich `x`/`z`. */
  private readonly landX = new Float32Array(DROP.max);
  private readonly landZ = new Float32Array(DROP.max);
  private readonly fromX = new Float32Array(DROP.max);
  private readonly fromZ = new Float32Array(DROP.max);
  private readonly age = new Float32Array(DROP.max);
  private readonly wait = new Float32Array(DROP.max);
  /** Tempo im Flug; 0 = liegt noch. */
  private readonly pull = new Float32Array(DROP.max);
  /** Sekunden im Flug, für den Strahl, der dabei erlischt. */
  private readonly flight = new Float32Array(DROP.max);
  private readonly rarity = new Uint8Array(DROP.max);
  private readonly items: (Item | null)[] = Array.from({ length: DROP.max }, () => null);
  private count = 0;
  private readonly gems: THREE.InstancedMesh;
  private readonly beams: THREE.InstancedMesh;

  constructor() {
    // Unbeleuchtet, damit Stein und Strahl auch im Dunkeln und in der Finsternis zu sehen sind (wie Münzen und Edelsteine).
    this.gems = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial(), DROP.max);
    const beam = new THREE.CylinderGeometry(DROP.beamRadius, DROP.beamRadius * 1.7, DROP.beamHeight, 10, 1, true);
    beam.translate(0, DROP.beamHeight / 2, 0);
    this.beams = new THREE.InstancedMesh(
      fading(beam),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      DROP.max,
    );
    for (const mesh of [this.gems, this.beams]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      // Die Farbe je Gegenstand liegt von Anfang an an, damit der Shader nicht mitten im Kampf neu übersetzt wird.
      for (let i = 0; i < DROP.max; i++) mesh.setColorAt(i, COLORS[0] as THREE.Color);
    }
    this.group.add(this.beams, this.gems);
  }

  /** Liegt gerade etwas da oder ist etwas unterwegs? */
  get busy(): boolean {
    return this.count > 0;
  }

  reset(): void {
    this.count = 0;
    this.gems.count = 0;
    this.beams.count = 0;
    this.items.fill(null);
  }

  /**
   * Legt einen Gegenstand hin. Mit `angle` und `distance` springt er von (x, z) an einen Platz daneben (aus der Kiste).
   * Gibt false zurück, wenn der Vorrat voll ist; der Aufrufer legt ihn dann gleich in den Beutel.
   */
  spawn(item: Item, x: number, z: number, angle = 0, distance = 0): boolean {
    if (this.count >= DROP.max) return false;
    const index = this.count++;
    const rarity = Math.max(0, RARITIES.indexOf(item.rarity));
    this.fromX[index] = x;
    this.fromZ[index] = z;
    this.landX[index] = x + Math.cos(angle) * distance;
    this.landZ[index] = z + Math.sin(angle) * distance;
    this.x[index] = x;
    this.z[index] = z;
    this.age[index] = 0;
    this.wait[index] = DROP.wait * (WAIT_FACTOR[rarity] ?? 1) + (distance > 0 ? SPILL_SECONDS * 0.5 : 0);
    this.pull[index] = 0;
    this.flight[index] = 0;
    this.rarity[index] = rarity;
    this.items[index] = item;
    return true;
  }

  /** Bewegt und zeichnet die Gegenstände. Was die Figur erreicht, geht an `collect` (Gegenstand und Ort). */
  update(dt: number, time: number, player: Site, collect: (item: Item, x: number, z: number) => void): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] = (this.age[i] ?? 0) + dt;
      const age = this.age[i] ?? 0;
      let pull = this.pull[i] ?? 0;
      if (pull <= 0) {
        // Noch am Boden: aus der Kiste springen oder einfach liegen.
        const t = Math.min(1, age / SPILL_SECONDS);
        const eased = 1 - (1 - t) * (1 - t);
        this.x[i] = (this.fromX[i] ?? 0) + ((this.landX[i] ?? 0) - (this.fromX[i] ?? 0)) * eased;
        this.z[i] = (this.fromZ[i] ?? 0) + ((this.landZ[i] ?? 0) - (this.fromZ[i] ?? 0)) * eased;
        if (age < (this.wait[i] ?? 0)) continue;
      }
      // Einmal losgeflogen, holt der Gegenstand die Figur immer ein.
      pull = Math.max(pull, DROP.speed) + DROP.accel * dt;
      this.pull[i] = pull;
      this.flight[i] = (this.flight[i] ?? 0) + dt;
      const dx = player.x - (this.x[i] ?? 0);
      const dz = player.z - (this.z[i] ?? 0);
      const distance = Math.hypot(dx, dz);
      const step = Math.min(distance, pull * dt);
      if (distance > 1e-4) {
        this.x[i] = (this.x[i] ?? 0) + (dx / distance) * step;
        this.z[i] = (this.z[i] ?? 0) + (dz / distance) * step;
      }
      if (distance - step < COLLECT_DISTANCE) {
        const item = this.items[i];
        const x = this.x[i] ?? 0;
        const z = this.z[i] ?? 0;
        // Der letzte Gegenstand rückt an die freie Stelle.
        const last = --this.count;
        if (last !== i) this.move(last, i);
        this.items[last] = null;
        if (item) collect(item, x, z);
      }
    }
    this.draw(time);
  }

  /** Gibt jeden Gegenstand, der noch liegt oder fliegt, sofort an `collect`: für das Ende der Nacht. */
  flush(collect: (item: Item) => void): void {
    for (let i = 0; i < this.count; i++) {
      const item = this.items[i];
      if (item) collect(item);
      this.items[i] = null;
    }
    this.reset();
  }

  private move(from: number, to: number): void {
    for (const array of [this.x, this.z, this.landX, this.landZ, this.fromX, this.fromZ, this.age, this.wait, this.pull, this.flight, this.rarity]) {
      array[to] = array[from] ?? 0;
    }
    this.items[to] = this.items[from] ?? null;
  }

  private draw(time: number): void {
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i] ?? 0;
      const z = this.z[i] ?? 0;
      const age = this.age[i] ?? 0;
      const rarity = this.rarity[i] ?? 0;
      const color = COLORS[rarity] as THREE.Color;
      const flying = (this.pull[i] ?? 0) > 0;
      // Beim Springen aus der Kiste ein Bogen, danach ein sanftes Schweben.
      const arc = age < SPILL_SECONDS && (this.landX[i] !== this.fromX[i] || this.landZ[i] !== this.fromZ[i]) ? Math.sin((age / SPILL_SECONDS) * Math.PI) * 1.4 : 0;
      const hover = flying ? 0.6 : 0.55 + 0.1 * Math.sin(time * 3 + x);

      pose.position.set(x, hover + arc, z);
      pose.rotation.set(0.35, time * SPIN + x, 0);
      pose.scale.setScalar(DROP.size * (rarity >= 2 ? 1.25 : 1));
      pose.updateMatrix();
      this.gems.setMatrixAt(i, pose.matrix);
      this.gems.setColorAt(i, color);

      // Der Strahl wächst beim Fallen und erlischt, sobald der Stein losfliegt.
      const grow = Math.min(1, age / GROW_SECONDS);
      const fade = flying ? Math.max(0, 1 - (this.flight[i] ?? 0) * 3.5) : 1;
      const width = BEAM_WIDTH[rarity] ?? 1;
      pose.position.set(x, 0, z);
      pose.rotation.set(0, 0, 0);
      pose.scale.set(width * fade, Math.max(0.001, grow * fade), width * fade);
      pose.updateMatrix();
      this.beams.setMatrixAt(i, pose.matrix);
      this.beams.setColorAt(i, color);
    }
    this.gems.count = this.count;
    this.beams.count = this.count;
    this.gems.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.gems.instanceColor) this.gems.instanceColor.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }
}

/**
 * Die Kiste, die der Verschlinger hinterlässt: Es gibt noch kein Modell, darum steht ein Platzhalter aus Quadern da. Sie wächst
 * aus dem Boden, der Deckel springt auf, und die Gegenstände springen einer nach dem anderen heraus (`Drops`).
 */
export class Chest {
  readonly group = new THREE.Group();
  private readonly lid = new THREE.Group();
  private readonly glow: THREE.Mesh;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private pending: Item[] = [];
  /** Sekunden seit dem Öffnen; negativ, wenn keine Kiste da ist. */
  private age = -1;
  private spilled = 0;

  constructor() {
    const { size } = CONFIG.loot.chest;
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2b, emissive: 0x2e1d0e });
    const metal = new THREE.MeshLambertMaterial({ color: 0xc9a45a, emissive: 0x4a3a1a });
    const inner = new THREE.MeshBasicMaterial({ color: 0x1a1008 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 0.55, 0.65), wood);
    body.position.y = 0.275;
    const hollow = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.53), inner);
    hollow.rotation.x = -Math.PI / 2;
    hollow.position.y = 0.552;
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.2, 0.69), wood);
    lidBox.position.set(0, 0.1, 0.325);
    this.lid.position.set(0, 0.55, -0.325);
    this.lid.add(lidBox);
    for (const side of [-0.3, 0.3]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.58, 0.68), metal);
      band.position.set(side, 0.29, 0);
      const lidBand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.72), metal);
      lidBand.position.set(side, 0.1, 0.325);
      this.lid.add(lidBand);
      this.group.add(band);
    }
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.05), metal);
    clasp.position.set(0, 0.45, 0.34);

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc060,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), this.glowMaterial);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.04;

    this.group.add(body, hollow, this.lid, clasp, this.glow);
    this.group.scale.setScalar(size);
    this.group.visible = false;
  }

  /** Die Kiste steht da und hat noch Gegenstände in sich? */
  get waiting(): boolean {
    return this.age >= 0 && this.spilled < this.pending.length;
  }

  reset(): void {
    this.age = -1;
    this.pending = [];
    this.spilled = 0;
    this.group.visible = false;
  }

  /** Stellt die Kiste hin; ihre Gegenstände springen heraus, sobald der Deckel offen ist. */
  open(x: number, z: number, items: Item[]): void {
    this.group.position.set(x, 0, z);
    this.group.scale.setScalar(0.01);
    this.group.visible = true;
    this.lid.rotation.x = 0;
    this.pending = items;
    this.spilled = 0;
    this.age = 0;
  }

  /** Nimmt die Gegenstände, die noch nicht herausgesprungen sind (etwa weil die Nacht endet), und leert die Kiste. */
  take(): Item[] {
    const rest = this.pending.slice(this.spilled);
    this.spilled = this.pending.length;
    return rest;
  }

  /** `fallback` bekommt, was `drops` nicht mehr aufnehmen kann. */
  update(dt: number, drops: Drops, fallback: (item: Item) => void): void {
    if (this.age < 0) return;
    this.age += dt;
    const { size, openSeconds, spillSeconds } = CONFIG.loot.chest;
    const grown = Math.min(1, this.age / 0.35);
    // Wächst mit einem kleinen Überschwingen aus dem Boden.
    this.group.scale.setScalar(size * Math.max(0.01, 1 + 2.2 * Math.pow(grown - 1, 3) + 1.2 * Math.pow(grown - 1, 2)));
    const opening = Math.min(1, Math.max(0, (this.age - 0.35) / Math.max(0.1, openSeconds - 0.35)));
    this.lid.rotation.x = -(1 - Math.pow(1 - opening, 3)) * 1.9;
    this.glowMaterial.opacity = opening * (0.55 + 0.15 * Math.sin(this.age * 6));
    this.glow.scale.setScalar(0.8 + opening * 0.6);

    while (this.spilled < this.pending.length && this.age >= openSeconds + this.spilled * spillSeconds) {
      const item = this.pending[this.spilled];
      this.spilled++;
      if (!item) continue;
      // Gleichmäßig auf einem Kranz um die Kiste, dem Betrachter zugewandt beginnend.
      const angle = Math.PI / 2 + (this.spilled - (this.pending.length + 1) / 2) * 1.5;
      if (!drops.spawn(item, this.group.position.x, this.group.position.z + 0.2, angle, 2.2)) fallback(item);
    }
  }
}
