import * as THREE from 'three';
import { CONFIG } from '../config';
import type { PropModel } from './models';
import type { Site } from './zones';

interface Gem extends Site {
  value: number;
  /** Geschwindigkeit, mit der der Edelstein zur Figur fliegt; 0 = liegt noch. */
  pull: number;
}

/** Ein Lebenssplitter: liegt da, bis die Figur ihn aufnimmt, und heilt sie dann. */
interface Splinter extends Site {
  heal: number;
  pull: number;
}

type GemSize = 'small' | 'large';

/** So viele Lebenssplitter liegen höchstens zugleich da; ein weiterer ersetzt den ältesten. */
const SPLINTER_CAPACITY = 8;

const COLLECT_DISTANCE = 0.6;
const SIZES: readonly GemSize[] = ['small', 'large'];
const pose = new THREE.Object3D();

/** Platzhalter, bis das Modell geladen ist oder falls seine Datei fehlt: ein Splitter von einem Meter Höhe. */
function placeholder(color: number): PropModel {
  return {
    geometry: new THREE.OctahedronGeometry(0.5).translate(0, 0.5, 0),
    // Unbeleuchtet, damit die Edelsteine auch im Dunkeln und in der Finsternis zu sehen sind.
    material: new THREE.MeshBasicMaterial({ color }),
    height: 1,
    width: 1,
  };
}

/** Erfahrung, die besiegte Gegner fallen lassen: kleine Edelsteine, von starken Gegnern große; dazu die Lebenssplitter des Banners. */
export class Pickups {
  readonly group = new THREE.Group();
  private readonly gems: Gem[] = [];
  private meshes: Record<GemSize, THREE.InstancedMesh>;
  private overflow = 0;
  private readonly splinters: Splinter[] = [];
  private readonly splinterMesh: THREE.InstancedMesh;
  /** Was die Lebenssplitter seit dem letzten `takeHealing` an Leben gebracht haben. */
  private healed = 0;

  constructor() {
    this.meshes = {
      small: this.createMesh(placeholder(0x9fe3d0)),
      large: this.createMesh(placeholder(0x6fb6ff)),
    };
    // Blutrot und unbeleuchtet, damit der Splitter im Dunkeln leuchtet wie die Edelsteine.
    this.splinterMesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.22).scale(0.8, 1.5, 0.8).translate(0, 0.3, 0),
      new THREE.MeshBasicMaterial({ color: 0xd8413a }),
      SPLINTER_CAPACITY,
    );
    this.splinterMesh.frustumCulled = false;
    this.splinterMesh.count = 0;
    this.group.add(this.splinterMesh);
  }

  /** Ersetzt die Platzhalter durch die Modelle; fehlt eines, bleibt sein Platzhalter. */
  setModels(small: PropModel | null, large: PropModel | null): void {
    for (const [size, model] of [
      ['small', small],
      ['large', large],
    ] as const) {
      if (!model) continue;
      this.group.remove(this.meshes[size]);
      this.meshes[size].dispose();
      this.meshes[size] = this.createMesh(model);
    }
  }

  reset(): void {
    this.gems.length = 0;
    this.splinters.length = 0;
    this.healed = 0;
    this.splinterMesh.count = 0;
    for (const size of SIZES) this.meshes[size].count = 0;
  }

  /** Lässt einen Lebenssplitter fallen (Banner, Rang 3); er heilt `heal` Leben, wenn die Figur ihn aufnimmt. */
  dropSplinter(x: number, z: number, heal: number): void {
    if (this.splinters.length >= SPLINTER_CAPACITY) this.splinters.shift();
    this.splinters.push({ x, z, heal, pull: 0 });
  }

  /** Zieht alle Edelsteine und Lebenssplitter im Umkreis zur Figur (Banner, Rang 5); sie fliegen von allein, bis sie sie erreichen. */
  attract(x: number, z: number, radius: number): void {
    for (const gem of this.gems) if (Math.hypot(gem.x - x, gem.z - z) <= radius) gem.pull = Math.max(gem.pull, 6);
    for (const splinter of this.splinters) if (Math.hypot(splinter.x - x, splinter.z - z) <= radius) splinter.pull = Math.max(splinter.pull, 6);
  }

  /** Das Leben, das Lebenssplitter seit dem letzten Aufruf gebracht haben; danach 0. */
  takeHealing(): number {
    const healed = this.healed;
    this.healed = 0;
    return healed;
  }

  drop(x: number, z: number, value: number): void {
    if (this.gems.length >= CONFIG.xp.maxGems) {
      // Kein Platz mehr: der Wert wandert in einen vorhandenen Edelstein, nichts geht verloren.
      const gem = this.gems[this.overflow++ % this.gems.length];
      if (gem) gem.value += value;
      return;
    }
    this.gems.push({ x, z, value, pull: 0 });
  }

  /** Bewegt und zeichnet die Edelsteine; gibt die in diesem Frame eingesammelte Erfahrung zurück. */
  update(dt: number, time: number, player: Site, pickupRadius: number): number {
    let collected = 0;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const gem = this.gems[i];
      if (!gem) continue;
      const dx = player.x - gem.x;
      const dz = player.z - gem.z;
      const distance = Math.hypot(dx, dz);
      if (gem.pull > 0 || distance < pickupRadius) {
        // Einmal angezogen, holt der Edelstein die Figur immer ein.
        gem.pull = Math.max(gem.pull, 6) + 30 * dt;
        const step = Math.min(distance, gem.pull * dt);
        if (distance > 1e-4) {
          gem.x += (dx / distance) * step;
          gem.z += (dz / distance) * step;
        }
        if (distance - step < COLLECT_DISTANCE) {
          collected += gem.value;
          const last = this.gems.pop();
          if (last && last !== gem) this.gems[i] = last;
        }
      }
    }

    for (let i = this.splinters.length - 1; i >= 0; i--) {
      const splinter = this.splinters[i];
      if (!splinter) continue;
      const dx = player.x - splinter.x;
      const dz = player.z - splinter.z;
      const distance = Math.hypot(dx, dz);
      if (splinter.pull <= 0 && distance >= pickupRadius) continue;
      splinter.pull = Math.max(splinter.pull, 6) + 30 * dt;
      const step = Math.min(distance, splinter.pull * dt);
      if (distance > 1e-4) {
        splinter.x += (dx / distance) * step;
        splinter.z += (dz / distance) * step;
      }
      if (distance - step < COLLECT_DISTANCE) {
        this.healed += splinter.heal;
        this.splinters.splice(i, 1);
      }
    }
    for (let i = 0; i < this.splinters.length; i++) {
      const splinter = this.splinters[i];
      if (!splinter) continue;
      pose.position.set(splinter.x, 0.1 + 0.07 * Math.sin(time * 3 + splinter.x), splinter.z);
      pose.rotation.y = time * 2.4 + splinter.z;
      pose.scale.setScalar(1);
      pose.updateMatrix();
      this.splinterMesh.setMatrixAt(i, pose.matrix);
    }
    this.splinterMesh.count = this.splinters.length;
    this.splinterMesh.instanceMatrix.needsUpdate = true;

    const { small, large, largeFrom } = CONFIG.xp.gems;
    const counts: Record<GemSize, number> = { small: 0, large: 0 };
    for (const gem of this.gems) {
      const size: GemSize = gem.value >= largeFrom ? 'large' : 'small';
      const height = size === 'large' ? large.height : small.height;
      // Mehr Erfahrung in einem Stein macht ihn etwas größer.
      const base = size === 'large' ? largeFrom : 1;
      const grown = Math.min(1.6, 1 + 0.08 * (gem.value - base));
      pose.position.set(gem.x, 0.18 + 0.07 * Math.sin(time * 3 + gem.x), gem.z);
      pose.rotation.y = time * 2 + gem.z;
      pose.scale.setScalar(height * grown);
      pose.updateMatrix();
      this.meshes[size].setMatrixAt(counts[size]++, pose.matrix);
    }
    for (const size of SIZES) {
      this.meshes[size].count = counts[size];
      this.meshes[size].instanceMatrix.needsUpdate = true;
    }
    return collected;
  }

  private createMesh(model: PropModel): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(model.geometry, model.material, CONFIG.xp.maxGems);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }
}
