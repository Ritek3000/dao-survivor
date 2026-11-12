import * as THREE from 'three';
import { CONFIG } from '../config';
import type { PropModel } from './models';
import type { Site } from './zones';

interface Gem extends Site {
  value: number;
  /** Geschwindigkeit, mit der der Edelstein zur Figur fliegt; 0 = liegt noch. */
  pull: number;
}

type GemSize = 'small' | 'large';

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

/** Erfahrung, die besiegte Gegner fallen lassen: kleine Edelsteine, von starken Gegnern große. */
export class Pickups {
  readonly group = new THREE.Group();
  private readonly gems: Gem[] = [];
  private meshes: Record<GemSize, THREE.InstancedMesh>;
  private overflow = 0;

  constructor() {
    this.meshes = {
      small: this.createMesh(placeholder(0x9fe3d0)),
      large: this.createMesh(placeholder(0x6fb6ff)),
    };
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
    for (const size of SIZES) this.meshes[size].count = 0;
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
