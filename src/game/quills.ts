/**
 * Die Stacheln des Stachelträgers: ein fester Vorrat in einem Instanznetz, im Kampf entsteht nichts Neues.
 *
 * Zwei Arten fliegen:
 *   Wurf     gerade auf die Stelle zu, an der die Spielfigur beim Loslassen stand; wer sich seitlich bewegt, weicht aus.
 *            Trifft er sie unterwegs, verletzt er sie; sonst steckt er, wo er den Boden erreicht, noch kurz in der Erde.
 *   Salve    im hohen Bogen auf einen Punkt der angekündigten Fläche (`Threats.marker`). Schlägt er ein, trifft er alles im Umkreis
 *            `impactRadius`; wen er trifft, den setzt er fest (`Player.root`). Auch diese stecken danach noch kurz im Boden.
 * Die Zahlen stehen in `CONFIG.stachelboss`.
 */
import * as THREE from 'three';
import { audio } from '../audio';
import { CONFIG } from '../config';
import { swallowedByFinsternis } from './darkness';
import type { Enemy } from './enemies';
import type { Player } from './player';
import type { Threats } from './threats';

const SPEC = CONFIG.stachelboss;
/** So viele Stacheln gibt es höchstens zugleich (fliegend und im Boden); bei Überlauf fällt ein neuer aus. */
const CAPACITY = 80;
/** Länge des gezeichneten Stachels in Metern (der Stachel ist als Kegel gebaut, Spitze nach +Z). */
const LENGTH = 1.3;
/** Fallbeschleunigung der Salve in m/s²; größer = höherer, steilerer Bogen bei gleicher Flugzeit. */
const GRAVITY = 24;
/** Ein geworfener Stachel zielt auf diese Höhe über dem Boden (Brust der Spielfigur). */
const AIM_HEIGHT = 1.0;
/** Ab dieser Höhe über dem Boden gilt ein fliegender Stachel als gelandet. */
const GROUND = 0.05;
/** Im Boden sinkt der Stachel in den letzten Sekunden ein Stück, bevor er verschwindet. */
const SINK_SECONDS = 0.5;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

type Kind = 'wurf' | 'salve';

interface Quill {
  active: boolean;
  kind: Kind;
  /** Fliegt er noch? Sonst steckt er im Boden. */
  flying: boolean;
  /** Sekunden bis zum Start (die Salve fliegt gestaffelt ab); davor ist der Stachel unsichtbar. */
  delay: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Geflogene Meter in der Waagerechten (nur beim Wurf, für die Reichweite). */
  flown: number;
  /** Restsekunden im Boden. */
  stuckLeft: number;
  owner: Enemy | null;
  /** Die angekündigte Fläche, zu der ein Stachel der Salve gehört. */
  zone: SalveZone | null;
}

/** Eine angekündigte Fläche der Salve, solange noch Stacheln dafür fliegen (der Messlauf weicht ihr aus). */
export interface SalveZone {
  x: number;
  z: number;
  radius: number;
  /** Stacheln dieser Salve, die noch nicht eingeschlagen sind. */
  pending: number;
}

export class Quills {
  readonly group = new THREE.Group();
  /** Laufende Flächen der Salve. */
  readonly zones: SalveZone[] = [];
  /** Wie oft die Figur seit dem Start dieser Nacht festgesetzt wurde; der Messlauf liest es. */
  roots = 0;
  private readonly pool: Quill[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly pose = new THREE.Object3D();
  private readonly direction = new THREE.Vector3();
  /** Wie viele Instanzen im letzten Bild gezeichnet wurden; reicht für das Aufräumen, wenn nichts mehr fliegt. */
  private drawn = 0;

  constructor() {
    const geometry = new THREE.ConeGeometry(0.055, LENGTH, 6, 1);
    // Mitte in den Ursprung, Spitze nach +Z.
    geometry.rotateX(Math.PI / 2);
    // Bleich wie Horn mit dunklem Fuß: Der Stachel ist im Dunkeln zu sehen und doch kein Licht.
    const material = swallowedByFinsternis(
      new THREE.MeshStandardMaterial({ color: 0xb8a98c, roughness: 0.6, emissive: 0x3a3022, emissiveIntensity: 0.7 }),
      true,
    );
    this.mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    this.mesh.count = 0;
    // Die Instanzen bewegen sich, die einmal berechnete Hüllkugel wäre falsch.
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({ active: false, kind: 'wurf', flying: false, delay: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, flown: 0, stuckLeft: 0, owner: null, zone: null });
    }
  }

  reset(): void {
    for (const quill of this.pool) {
      quill.active = false;
      quill.owner = null;
      quill.zone = null;
    }
    this.zones.length = 0;
    this.roots = 0;
    this.mesh.count = 0;
    this.drawn = 0;
  }

  /** Ein Stachel zum Halten in der Hand; er teilt Form und Material mit den fliegenden. */
  createHeld(): THREE.Mesh {
    const held = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
    // Er hängt an einem Knochen: Die Hüllkugel aus der Ruhelage stimmt in Bewegung nicht.
    held.frustumCulled = false;
    held.castShadow = false;
    return held;
  }

  /** Wie viele Stacheln fliegen oder stecken gerade. */
  get live(): number {
    let n = 0;
    for (const quill of this.pool) if (quill.active) n++;
    return n;
  }

  /** Ein Stachel verlässt die Hand bei (x, y, z) und fliegt auf die Stelle (tx, tz) zu. */
  throwAt(owner: Enemy | null, x: number, y: number, z: number, tx: number, tz: number): void {
    const quill = this.take('wurf');
    if (!quill) return;
    const dx = tx - x;
    const dz = tz - z;
    const distance = Math.max(0.5, Math.hypot(dx, dz));
    const seconds = distance / SPEC.wurf.speed;
    quill.owner = owner;
    quill.x = x;
    quill.y = y;
    quill.z = z;
    quill.vx = dx / seconds;
    quill.vz = dz / seconds;
    quill.vy = (AIM_HEIGHT - y) / seconds;
  }

  /**
   * Ein Stachel fliegt nach `delay` Sekunden vom Rücken bei (x, y, z) in hohem Bogen zum Punkt (tx, tz) und braucht dafür `flight` Sekunden.
   * `zone` ist die angekündigte Fläche, zu der er gehört.
   */
  arcTo(owner: Enemy | null, x: number, y: number, z: number, tx: number, tz: number, flight: number, delay: number, zone: SalveZone): void {
    const quill = this.take('salve');
    if (!quill) {
      // Fällt ein Stachel aus, darf die Fläche nicht auf ihn warten.
      zone.pending--;
      return;
    }
    quill.owner = owner;
    quill.delay = delay;
    quill.x = x;
    quill.y = y;
    quill.z = z;
    quill.vx = (tx - x) / flight;
    quill.vz = (tz - z) / flight;
    // Aus y(t) = y + vy t - g t² / 2 = 0 bei t = flight.
    quill.vy = (0.5 * GRAVITY * flight * flight - y) / flight;
    quill.zone = zone;
  }

  /** Eine neue Fläche der Salve anmelden; sie bleibt in `zones`, bis alle ihre Stacheln eingeschlagen sind. */
  openZone(x: number, z: number, radius: number, pending: number): SalveZone {
    const zone: SalveZone = { x, z, radius, pending };
    this.zones.push(zone);
    return zone;
  }

  update(dt: number, player: Player, threats: Threats): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zone = this.zones[i];
      if (zone && zone.pending <= 0) this.zones.splice(i, 1);
    }
    let any = false;
    for (const quill of this.pool) {
      if (!quill.active) continue;
      any = true;
      if (quill.delay > 0) {
        quill.delay -= dt;
        continue;
      }
      if (quill.flying) this.fly(quill, dt, player, threats);
      else {
        quill.stuckLeft -= dt;
        if (quill.stuckLeft <= 0) quill.active = false;
      }
    }
    if (any || this.drawn > 0) this.write();
  }

  private take(kind: Kind): Quill | null {
    for (const quill of this.pool) {
      if (quill.active) continue;
      quill.active = true;
      quill.kind = kind;
      quill.flying = true;
      quill.delay = 0;
      quill.flown = 0;
      quill.stuckLeft = 0;
      quill.zone = null;
      return quill;
    }
    return null;
  }

  private fly(quill: Quill, dt: number, player: Player, threats: Threats): void {
    const { wurf, salve } = SPEC;
    if (quill.kind === 'salve') quill.vy -= GRAVITY * dt;
    quill.x += quill.vx * dt;
    quill.y += quill.vy * dt;
    quill.z += quill.vz * dt;
    if (quill.kind === 'wurf') {
      quill.flown += Math.hypot(quill.vx, quill.vz) * dt;
      const p = player.position;
      // Ein Wurf trifft, wenn er die Figur in Körperhöhe streift; `wurf.radius` gilt von der Mitte der Figur aus (ihr Kollisionskreis ist weiter).
      if (quill.y > GROUND && quill.y < 2.2 && Math.hypot(p.x - quill.x, p.z - quill.z) <= wurf.radius) {
        player.hurt(wurf.damage, false, false, quill.owner, true);
        quill.active = false;
        return;
      }
      if (quill.flown > wurf.maxRange) {
        quill.active = false;
        return;
      }
    }
    if (quill.y > GROUND) return;
    // Er hat den Boden erreicht und steckt jetzt darin.
    quill.y = 0;
    quill.flying = false;
    quill.stuckLeft = salve.stuck;
    if (quill.kind === 'wurf') return;
    if (quill.zone) quill.zone.pending--;
    threats.thud(quill.x, quill.z, 0.9);
    audio.play('stachelboss.einschlag', quill.x, quill.z);
    const p = player.position;
    if (Math.hypot(p.x - quill.x, p.z - quill.z) > salve.impactRadius) return;
    player.hurt(salve.damage, false, false, quill.owner, true);
    if (player.root(salve.root, salve.immunity)) {
      this.roots++;
      threats.pin(p.x, p.z, salve.root);
      audio.play('stachelboss.festgesetzt', p.x, p.z);
    }
  }

  /** Schreibt die Lage aller sichtbaren Stacheln ins Instanznetz. */
  private write(): void {
    const pose = this.pose;
    const dir = this.direction;
    let count = 0;
    for (const quill of this.pool) {
      if (!quill.active || quill.delay > 0) continue;
      // Er zeigt in seine Flugrichtung; im Boden behält er sie, steil nach unten, und sinkt zum Ende ein.
      dir.set(quill.vx, quill.vy, quill.vz);
      if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0);
      dir.normalize();
      pose.quaternion.setFromUnitVectors(Z_AXIS, dir);
      let y = quill.y;
      if (!quill.flying) {
        // Die Spitze steckt in der Erde: Die Mitte liegt eine halbe Länge über ihr, entlang der Richtung.
        y = Math.max(0, -dir.y) * LENGTH * 0.4;
        y -= (1 - Math.min(1, quill.stuckLeft / SINK_SECONDS)) * LENGTH * 0.6;
      }
      pose.position.set(quill.x, y, quill.z);
      pose.scale.setScalar(1);
      pose.updateMatrix();
      this.mesh.setMatrixAt(count++, pose.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.drawn = count;
  }
}
