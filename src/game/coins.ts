import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { Site } from './zones';

const COLLECT_DISTANCE = 0.6;
const COIN = CONFIG.gold.coin;
const COPPER = new THREE.Color(COIN.colors.copper);
const SILVER = new THREE.Color(COIN.colors.silver);
const GOLD = new THREE.Color(COIN.colors.gold);
const pose = new THREE.Object3D();
/** Die Münze lehnt sich um so viele Radiant zur Kamera (die steht auf der +Z-Seite) und wiegt sich um `SWAY`. */
const LEAN = -0.5;
const SWAY = 0.95;

/** Färbt alle Ecken gleich ein; die Farbe der Münze selbst kommt je Instanz dazu. */
function shaded(geometry: THREE.BufferGeometry, brightness: number): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(brightness), 3));
  return geometry;
}

/** Eine stehende Münze mit erhabenem Rand und dunklerer Prägung in der Mitte; Durchmesser 1, unten bei y = 0. */
function coinGeometry(): THREE.BufferGeometry {
  const parts = [
    shaded(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 18), 1),
    shaded(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 18), 0.66),
  ];
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('Die Teile der Münze passen nicht zusammen.');
  merged.rotateX(Math.PI / 2);
  merged.translate(0, 0.5, 0);
  return merged;
}

/** Kupferpfennig, Silbermark oder Goldkrone, je nach Wert. */
function tint(value: number): THREE.Color {
  if (value >= COIN.goldFrom) return GOLD;
  if (value >= COIN.silverFrom) return SILVER;
  return COPPER;
}

/**
 * Gold, das erschlagene Gegner fallen lassen: stehende Münzen, die sich drehen und der Figur zufliegen,
 * sobald sie nah genug ist. Wie die Edelsteine mit der Erfahrung liegen sie in einem festen Vorrat (keine neuen Objekte im Kampf).
 */
export class Coins {
  readonly group = new THREE.Group();
  private readonly x = new Float32Array(CONFIG.gold.maxCoins);
  private readonly z = new Float32Array(CONFIG.gold.maxCoins);
  private readonly value = new Float32Array(CONFIG.gold.maxCoins);
  /** Geschwindigkeit, mit der die Münze zur Figur fliegt; 0 = liegt noch. */
  private readonly pull = new Float32Array(CONFIG.gold.maxCoins);
  private count = 0;
  private overflow = 0;
  private readonly mesh: THREE.InstancedMesh;

  constructor() {
    // Unbeleuchtet, damit die Münzen auch im Dunkeln und in der Finsternis zu sehen sind (wie die Edelsteine).
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(coinGeometry(), material, CONFIG.gold.maxCoins);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Die Farbe je Münze liegt von Anfang an an, damit der Shader nicht mitten im Kampf neu übersetzt wird.
    for (let i = 0; i < CONFIG.gold.maxCoins; i++) this.mesh.setColorAt(i, COPPER);
    this.group.add(this.mesh);
  }

  reset(): void {
    this.count = 0;
    this.overflow = 0;
    this.mesh.count = 0;
  }

  drop(x: number, z: number, value: number): void {
    if (this.count >= CONFIG.gold.maxCoins) {
      // Kein Platz mehr: der Wert wandert in eine vorhandene Münze, nichts geht verloren.
      const index = this.overflow++ % this.count;
      this.value[index] = (this.value[index] ?? 0) + value;
      return;
    }
    const index = this.count++;
    this.x[index] = x;
    this.z[index] = z;
    this.value[index] = value;
    this.pull[index] = 0;
  }

  /** Bewegt und zeichnet die Münzen; gibt das in diesem Frame eingesammelte Gold zurück (ohne Faktoren). */
  update(dt: number, time: number, player: Site, pickupRadius: number): number {
    let collected = 0;
    for (let i = this.count - 1; i >= 0; i--) {
      const dx = player.x - (this.x[i] ?? 0);
      const dz = player.z - (this.z[i] ?? 0);
      const distance = Math.hypot(dx, dz);
      let pull = this.pull[i] ?? 0;
      if (pull <= 0 && distance >= pickupRadius) continue;
      // Einmal angezogen, holt die Münze die Figur immer ein.
      pull = Math.max(pull, 6) + 30 * dt;
      this.pull[i] = pull;
      const step = Math.min(distance, pull * dt);
      if (distance > 1e-4) {
        this.x[i] = (this.x[i] ?? 0) + (dx / distance) * step;
        this.z[i] = (this.z[i] ?? 0) + (dz / distance) * step;
      }
      if (distance - step < COLLECT_DISTANCE) {
        collected += this.value[i] ?? 0;
        // Die letzte Münze rückt an die freie Stelle.
        const last = --this.count;
        if (last !== i) {
          this.x[i] = this.x[last] ?? 0;
          this.z[i] = this.z[last] ?? 0;
          this.value[i] = this.value[last] ?? 0;
          this.pull[i] = this.pull[last] ?? 0;
        }
      }
    }

    for (let i = 0; i < this.count; i++) {
      const x = this.x[i] ?? 0;
      const z = this.z[i] ?? 0;
      pose.position.set(x, 0.12 + 0.06 * Math.sin(time * 3 + x), z);
      // Von oben gesehen wäre eine kreisende Münze meist ein dünner Strich. Darum wiegt sie sich nur hin und her und
      // lehnt sich der Kamera zu: Ihre Fläche bleibt zu sehen und blitzt dabei auf.
      pose.rotation.set(LEAN, Math.sin(time * 2.2 + x * 1.3 + z) * SWAY, 0);
      pose.scale.setScalar(COIN.size);
      pose.updateMatrix();
      this.mesh.setMatrixAt(i, pose.matrix);
      this.mesh.setColorAt(i, tint(this.value[i] ?? 0));
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return collected;
  }
}
