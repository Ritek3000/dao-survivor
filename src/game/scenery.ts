/**
 * Unbewegte Kulisse aus Modellen: Felsen, Totholz, Gestrüpp.
 *
 * Die Welt ist in Kacheln geteilt, und jede Kachel hält je Modell ein eigenes Bündel Kopien.
 * So zeichnet die Grafikkarte nur, was im Bild oder im Schein der Fackel liegt; ein einziges
 * Bündel für die ganze Welt würde in jedem der sieben Durchgänge eines Bildes vollständig gezeichnet.
 */
import * as THREE from 'three';
import { swallowedByFinsternis } from './darkness';
import type { PropModel } from './models';

/** Wo eine Kopie eines Modells steht. */
export interface Placement {
  /** Datei des Modells im Ordner public/models. */
  file: string;
  x: number;
  z: number;
  yaw: number;
  /** Größter Durchmesser am Boden in Metern. */
  size: number;
}

/** Kantenlänge einer Kachel in Metern: etwas mehr als die Reichweite des Fackelscheins. */
const TILE_METERS = 24;
/** So viel seiner Höhe steckt ein Stück im Boden, damit keine Kante in der Luft hängt. */
const SUNK = 0.06;

const pose = new THREE.Object3D();

/** Ersatz, wenn die Datei eines Modells fehlt: ein kantiger grauer Brocken. */
function placeholder(): PropModel {
  const geometry = new THREE.DodecahedronGeometry(0.5, 0).scale(1, 0.6, 1).translate(0, 0.3, 0);
  const material = swallowedByFinsternis(
    new THREE.MeshStandardMaterial({ color: 0x7c776d, roughness: 0.95, flatShading: true }),
  );
  return { geometry, material, height: 0.6, width: 1 };
}

/** Baut aus den Standorten die Netze; fehlende Modelle erscheinen als graue Brocken. */
export function buildScenery(placements: readonly Placement[], props: ReadonlyMap<string, PropModel>): THREE.Group {
  const group = new THREE.Group();
  const fallback = placeholder();

  // Nach Modell und Kachel bündeln.
  const bundles = new Map<string, Placement[]>();
  for (const placement of placements) {
    const key = `${placement.file}|${Math.floor(placement.x / TILE_METERS)}|${Math.floor(placement.z / TILE_METERS)}`;
    const bundle = bundles.get(key);
    if (bundle) bundle.push(placement);
    else bundles.set(key, [placement]);
  }

  for (const bundle of bundles.values()) {
    const first = bundle[0];
    if (!first) continue;
    const prop = props.get(first.file) ?? fallback;
    const mesh = new THREE.InstancedMesh(prop.geometry, prop.material, bundle.length);
    bundle.forEach((placement, index) => {
      pose.position.set(placement.x, -SUNK * prop.height * placement.size, placement.z);
      pose.rotation.set(0, placement.yaw, 0);
      pose.scale.setScalar(placement.size);
      pose.updateMatrix();
      mesh.setMatrixAt(index, pose.matrix);
    });
    // Erst mit der Hüllkugel über alle Kopien kann die Kachel als Ganzes aussortiert werden.
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.castShadow = true;
    mesh.receiveShadow = prop.receiveShadow ?? true;
    group.add(mesh);
  }
  return group;
}
