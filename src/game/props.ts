/**
 * Kleine Gegenstände der Angriffe, aus einfachen Körpern zusammengesetzt und je zu einem Netz
 * verschmolzen: Pfeil, Wurfmesser, Wurfaxt, Fangeisen, Wurzelwerk, Steinbrocken und Felszacken.
 * Farben stecken in den Eckpunkten, damit alle mit einem Material und einem Zeichenaufruf auskommen.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Random } from '../core/random';
import { swallowedByFinsternis } from './darkness';

const WOOD = 0xc9b184;
const DARK_WOOD = 0x4a3423;
const STEEL = 0xbcc1c9;
const IRON = 0x4d5057;
const FEATHER = 0xe8e2d2;
const LEATHER = 0x3a2a1c;

/** Färbt ein Teil ein; die Geometrie wird dabei in einzelne Dreiecke aufgelöst, damit alle Teile zusammenpassen. */
function painted(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const part = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = part.getAttribute('position').count;
  const { r, g, b } = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3);
  part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return part;
}

function joined(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Die Teile eines Gegenstands passen nicht zusammen.');
  return merged;
}

/** Dreht eine in der XY-Ebene ausgestanzte Platte so, dass ihre Achsen auf die gewünschten Richtungen fallen. */
function oriented(
  geometry: THREE.BufferGeometry,
  x: readonly [number, number, number],
  y: readonly [number, number, number],
): THREE.BufferGeometry {
  const xAxis = new THREE.Vector3(...x);
  const yAxis = new THREE.Vector3(...y);
  return geometry.applyMatrix4(new THREE.Matrix4().makeBasis(xAxis, yAxis, new THREE.Vector3().crossVectors(xAxis, yAxis)));
}

/** Material für alle Gegenstände: vom Licht der Welt beleuchtet, von der Finsternis verschluckt. */
export function propMaterial(roughness = 0.7, flatShading = false): THREE.MeshStandardMaterial {
  return swallowedByFinsternis(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, flatShading }),
  );
}

/** Pfeil, Spitze nach +Z. Dicker als ein echter, sonst wäre er aus der Spielkamera kaum zu sehen. */
export function arrowGeometry(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.02, 0.02, 0.78, 5).rotateX(Math.PI / 2);
  const head = new THREE.ConeGeometry(0.055, 0.18, 4).rotateX(Math.PI / 2).translate(0, 0, 0.48);
  const parts = [painted(shaft, WOOD), painted(head, STEEL)];
  for (let k = 0; k < 3; k++) {
    const fin = new THREE.BoxGeometry(0.006, 0.085, 0.2).translate(0, 0.055, -0.29).rotateZ((k * Math.PI * 2) / 3);
    parts.push(painted(fin, FEATHER));
  }
  return joined(parts);
}

/** Wurfmesser, Spitze nach +Z, die flache Seite nach oben: So blitzt es beim Überschlagen auf. */
export function knifeGeometry(): THREE.BufferGeometry {
  const outline = new THREE.Shape();
  outline.moveTo(0, -0.028);
  outline.lineTo(0.19, -0.04);
  outline.lineTo(0.3, 0);
  outline.lineTo(0.19, 0.04);
  outline.lineTo(0, 0.028);
  outline.closePath();
  const blade = oriented(new THREE.ExtrudeGeometry(outline, { depth: 0.012, bevelEnabled: false }), [0, 0, 1], [1, 0, 0]);
  const handle = new THREE.CylinderGeometry(0.017, 0.02, 0.13, 6).rotateX(Math.PI / 2).translate(0, 0.006, -0.065);
  const guard = new THREE.BoxGeometry(0.075, 0.016, 0.02).translate(0, 0.006, 0);
  // Der Drehpunkt liegt im Schwerpunkt, nicht am Griffende.
  return joined([painted(blade, STEEL), painted(handle, LEATHER), painted(guard, IRON)]).translate(0, 0, -0.08);
}

/** Wurfaxt: Stiel entlang Z, der Kopf vorn, die Schneide nach unten; so führt sie beim Überschlag. */
export function throwingAxeGeometry(): THREE.BufferGeometry {
  const handle = new THREE.CylinderGeometry(0.016, 0.02, 0.5, 6).rotateX(Math.PI / 2);
  const outline = new THREE.Shape();
  outline.moveTo(-0.035, 0.04);
  outline.lineTo(0.03, 0.035);
  outline.quadraticCurveTo(0.085, 0.045, 0.15, 0.1);
  outline.quadraticCurveTo(0.185, -0.015, 0.14, -0.15);
  outline.quadraticCurveTo(0.085, -0.06, 0.03, -0.04);
  outline.lineTo(-0.035, -0.042);
  outline.closePath();
  const head = oriented(new THREE.ExtrudeGeometry(outline, { depth: 0.02, bevelEnabled: false }), [0, -1, 0], [0, 0, 1])
    .translate(0.01, 0, 0.17);
  return joined([painted(handle, DARK_WOOD), painted(head, STEEL)]).translate(0, 0, -0.1);
}

const TRAP_RADIUS = 0.42;

/** Ein Bügel des Fangeisens: ein halber Ring in der Bodenebene, die Zähne nach oben. */
function trapJaw(): THREE.BufferGeometry[] {
  const arc = new THREE.TorusGeometry(TRAP_RADIUS, 0.026, 5, 14, Math.PI).rotateX(Math.PI / 2).translate(0, 0.03, 0);
  const parts = [painted(arc, IRON)];
  for (let k = 1; k <= 7; k++) {
    const a = (k * Math.PI) / 8;
    const tooth = new THREE.ConeGeometry(0.03, 0.12, 4).translate(Math.cos(a) * TRAP_RADIUS, 0.09, Math.sin(a) * TRAP_RADIUS);
    parts.push(painted(tooth, STEEL));
  }
  return parts;
}

/** Fangeisen, gespannt (`shut` = false) oder zugeschnappt: Dann stehen die Bügel hoch und greifen ineinander. */
export function trapGeometry(shut: boolean): THREE.BufferGeometry {
  const lift = shut ? 1.3 : 0;
  const near = trapJaw().map((part) => part.rotateX(-lift));
  const far = trapJaw().map((part) => part.rotateY(Math.PI).rotateX(lift));
  const plate = new THREE.CylinderGeometry(0.2, 0.22, 0.03, 10).translate(0, 0.015, 0);
  const bar = new THREE.BoxGeometry(TRAP_RADIUS * 2.1, 0.025, 0.07).translate(0, 0.013, 0);
  return joined([...near, ...far, painted(plate, 0x3a3c40), painted(bar, IRON)]);
}

/**
 * Dornige Wurzeln, die aus dem Boden um ein Opfer wachsen und sich nach innen krallen,
 * dazu niedrige Wurzeln, die sich am Boden nach außen ziehen.
 * Bemessen für einen Gegner mit 0,45 m Radius; für größere wird das Ganze skaliert.
 */
export function rootsGeometry(random: Random): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3();
  const vertex = new THREE.Vector3();

  /** Eine Röhre entlang `path`, zur Spitze hin verjüngt, mit Dornen an `thornsAt`. */
  const root = (path: THREE.Vector3[], thickness: number, color: number, thornsAt: number[], thornSize: number): void => {
    const curve = new THREE.CatmullRomCurve3(path);
    const segments = 9;
    const sides = 5;
    const tube = new THREE.TubeGeometry(curve, segments, thickness, sides, false);
    // Zur Spitze hin verjüngen: Jeder Ring rückt an die Mittellinie heran.
    const position = tube.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const t = Math.floor(i / (sides + 1)) / segments;
      curve.getPointAt(t, center);
      vertex.fromBufferAttribute(position, i).sub(center).multiplyScalar(1 - 0.85 * t).add(center);
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    tube.computeVertexNormals();
    parts.push(painted(tube, color));

    for (const t of thornsAt) {
      curve.getPointAt(t, center);
      const outward = new THREE.Vector3(center.x, 0.25 + random() * 0.5, center.z).normalize();
      if (random() < 0.5) outward.set(-outward.z, outward.y, outward.x);
      // Die Dornen sind hell wie abgebrochenes Holz, damit sie sich von der dunklen Rinde abheben.
      const thorn = new THREE.ConeGeometry(0.03 * thornSize, 0.17 * thornSize, 4)
        .translate(0, 0.085 * thornSize, 0)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, outward))
        .translate(center.x, center.y, center.z);
      parts.push(painted(thorn, 0x8f7c52));
    }
  };

  const tendrils = 10;
  for (let k = 0; k < tendrils; k++) {
    const start = (k / tendrils) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const twist = (random() < 0.5 ? -1 : 1) * (0.3 + random() * 0.45);
    const height = (k % 3 === 2 ? 0.45 : 0.85) + random() * 0.55;
    // Vom Boden außen in einem Bogen nach oben und innen, jede mit eigener Windung.
    const path = [0, 0.3, 0.6, 0.85, 1].map((t) => {
      const angle = start + twist * t * 1.9;
      const radius = 0.66 - 0.44 * t * t + 0.05 * Math.sin(t * 9 + k);
      return new THREE.Vector3(Math.cos(angle) * radius, -0.08 + height * Math.sin(t * 1.45), Math.sin(angle) * radius);
    });
    root(path, 0.075 + random() * 0.05, k % 2 === 0 ? 0x4a3822 : 0x58452a, [0.3, 0.5, 0.68, 0.84].filter(() => random() < 0.7), 1);
  }
  // Niedrige Wurzeln, die sich am Boden vom Opfer fortziehen.
  for (let k = 0; k < 5; k++) {
    const angle = (k / 5) * Math.PI * 2 + (random() - 0.5) * 0.8;
    const path = [0, 0.33, 0.66, 1].map((t) => {
      const a = angle + 0.5 * Math.sin(t * 4 + k);
      const radius = 0.35 + 0.85 * t;
      return new THREE.Vector3(Math.cos(a) * radius, -0.06 + (0.12 + 0.12 * random()) * Math.sin(t * Math.PI), Math.sin(a) * radius);
    });
    root(path, 0.045 + random() * 0.025, 0x4a3822, [0.45, 0.75], 0.8);
  }
  return joined(parts);
}

/**
 * Felszacke, die ein Erdstoß aus dem Boden treibt: eine kantige, zur Spitze schmaler werdende Säule
 * von Einheitshöhe und -breite, Fuß leicht unter dem Boden. Jede Instanz wird verdreht und gestreckt,
 * damit der Ring nicht gleichförmig wirkt.
 */
export function shardGeometry(random: Random): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const r = 0.6 + random() * 0.6;
    points.push(new THREE.Vector3(Math.cos(a) * r, -0.15, Math.sin(a) * r));
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + (random() - 0.5) * 1;
    const r = 0.45 + random() * 0.5;
    points.push(new THREE.Vector3(Math.cos(a) * r, 0.3 + random() * 0.3, Math.sin(a) * r));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + (random() - 0.5) * 0.8;
    const r = 0.08 + random() * 0.2;
    points.push(new THREE.Vector3(Math.cos(a) * r, 0.9 + random() * 0.1, Math.sin(a) * r));
  }
  return painted(new ConvexGeometry(points), 0x7d7466);
}

/** Kantiger Brocken, den ein Erdstoß aus dem Boden wirft. */
export function rockGeometry(): THREE.BufferGeometry {
  return painted(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.7, 0.85), 0x9a9488);
}
