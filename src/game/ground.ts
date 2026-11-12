/**
 * Der Boden: staubige, tote Erde. Farbe und Relief werden beim Start errechnet, nicht geladen.
 *
 * Aus einer Höhenkarte (Wellen, getrocknete Risse, Steinchen, Körnung) entstehen zwei Texturen:
 * die Farbe und die Richtung der Oberfläche. Erst die zweite lässt den flach einfallenden
 * Fackelschein an jeder Kante hängen bleiben. Damit sich die Kachel nicht sichtbar wiederholt,
 * mischt das Material sie fleckenweise mit einer zweiten, gröberen Abtastung, lässt den Boden
 * großflächig heller und dunkler werden und färbt ihn um die Feuerschalen zu Asche.
 */
import * as THREE from 'three';
import type { Random } from '../core/random';
import { extendShader, swallowedByFinsternis } from './darkness';
import type { PropModel } from './models';
import type { Site } from './zones';

/** Kantenlänge der Textur in Bildpunkten und der Kachel in Metern. */
const SIZE = 1024;
const TILE_METERS = 10;
/** Wie stark Höhenunterschiede die Oberfläche neigen. */
const RELIEF = 5;

type Rgb = readonly [number, number, number];
const DARK: Rgb = [98, 86, 72];
const MID: Rgb = [150, 138, 118];
const LIGHT: Rgb = [186, 175, 153];
const STAIN: Rgb = [150, 118, 84];
const CRACK: Rgb = [52, 44, 37];

const smoothstep = (from: number, to: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Weiches Rauschen, das sich nach `cells` Zellen nahtlos wiederholt. */
function tilingNoise(random: Random, cells: number): (u: number, v: number) => number {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();
  const at = (x: number, y: number): number => lattice[(y % cells) * cells + (x % cells)] as number;
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(0, 1, x - x0);
    const fy = smoothstep(0, 1, y - y0);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

/**
 * Schollen wie in getrocknetem Schlamm, nahtlos wiederholt: liefert je Punkt den Abstand
 * zur nächsten Kante zwischen zwei Schollen und einen Zufallswert der Scholle selbst.
 */
function tilingPlates(random: Random, cells: number): (u: number, v: number, out: [number, number]) => void {
  const points = new Float32Array(cells * cells * 3);
  for (let i = 0; i < points.length; i++) points[i] = random();
  return (u, v, out) => {
    const x = u * cells;
    const y = v * cells;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    let nearest = Infinity;
    let second = Infinity;
    let plate = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = cellX + dx;
        const cy = cellY + dy;
        const index = ((((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)) * 3;
        const px = cx + (points[index] as number) - x;
        const py = cy + (points[index + 1] as number) - y;
        const distance = Math.hypot(px, py);
        if (distance < nearest) {
          second = nearest;
          nearest = distance;
          plate = points[index + 2] as number;
        } else if (distance < second) {
          second = distance;
        }
      }
    }
    out[0] = second - nearest;
    out[1] = plate;
  };
}

/** Errechnet Farb- und Richtungstextur einer nahtlosen Bodenkachel. */
function paintGround(random: Random): { color: THREE.Texture; normal: THREE.Texture } {
  const height = new Float32Array(SIZE * SIZE);
  const crack = new Float32Array(SIZE * SIZE);
  const stone = new Float32Array(SIZE * SIZE);
  const tone = new Float32Array(SIZE * SIZE);

  const waves = [4, 9, 19, 41].map((cells) => tilingNoise(random, cells));
  const patches = tilingNoise(random, 3);
  const stains = tilingNoise(random, 5);
  const plates = tilingPlates(random, 9);
  const hairlines = tilingPlates(random, 23);
  const cell: [number, number] = [0, 0];

  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const u = i / SIZE;
      const v = j / SIZE;
      const index = j * SIZE + i;
      let base = 0;
      let amplitude = 0.5;
      for (const wave of waves) {
        base += wave(u, v) * amplitude;
        amplitude *= 0.5;
      }
      // Risse gibt es nur fleckenweise: dort, wo einmal Wasser stand.
      const cracked = smoothstep(0.54, 0.7, patches(u, v));
      plates(u, v, cell);
      const wide = (1 - smoothstep(0, 0.04, cell[0])) * cracked;
      const lift = (cell[1] - 0.5) * 0.05 * cracked;
      hairlines(u, v, cell);
      const fine = (1 - smoothstep(0, 0.045, cell[0])) * (0.06 + 0.5 * cracked);
      const depth = Math.max(wide, fine * 0.5);

      crack[index] = depth;
      tone[index] = base;
      height[index] = base * 0.55 + lift - depth * 0.3 + (random() - 0.5) * 0.035;
    }
  }

  // Steinchen: kleine Kuppen, die über die Kachelgrenze hinweg weiterlaufen.
  for (let n = 0; n < 520; n++) {
    const cx = random() * SIZE;
    const cy = random() * SIZE;
    const radius = 1.5 + random() ** 3 * 7;
    const shade = 0.35 + random() * 0.65;
    // Länglich und irgendwie gedreht: Kein Kiesel ist kreisrund.
    const turn = random() * Math.PI;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const squash = 1.2 + random() * 1.1;
    const reach = Math.ceil(radius);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const along = dx * cos + dy * sin;
        const across = (dy * cos - dx * sin) * squash;
        const d2 = (along * along + across * across) / (radius * radius);
        if (d2 >= 1) continue;
        const x = (Math.floor(cx) + dx + SIZE) % SIZE;
        const y = (Math.floor(cy) + dy + SIZE) % SIZE;
        const index = y * SIZE + x;
        const dome = Math.sqrt(1 - d2);
        height[index] = Math.max(height[index] as number, (height[index] as number) * 0.5 + dome * radius * 0.035 + 0.16);
        stone[index] = Math.max(stone[index] as number, shade * Math.min(1, dome * 2.5));
      }
    }
  }

  const colors = new Uint8ClampedArray(SIZE * SIZE * 4);
  const normals = new Uint8Array(SIZE * SIZE * 4);
  const wrap = (n: number): number => (n + SIZE) % SIZE;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const index = j * SIZE + i;
      const at = index * 4;

      const slopeX = ((height[j * SIZE + wrap(i + 1)] as number) - (height[j * SIZE + wrap(i - 1)] as number)) * RELIEF;
      const slopeY = ((height[wrap(j + 1) * SIZE + i] as number) - (height[wrap(j - 1) * SIZE + i] as number)) * RELIEF;
      const length = Math.hypot(slopeX, slopeY, 1);
      normals[at] = (-slopeX / length) * 127.5 + 127.5;
      normals[at + 1] = (-slopeY / length) * 127.5 + 127.5;
      normals[at + 2] = (1 / length) * 127.5 + 127.5;
      normals[at + 3] = 255;

      // Hohe Stellen tragen hellen Staub, Senken sind dunkler; dazu rostige Flecken.
      const t = Math.min(1, Math.max(0, 0.5 + ((tone[index] as number) - 0.47) * 2.6 + (random() - 0.5) * 0.16));
      const stain = smoothstep(0.55, 0.8, stains(i / SIZE, j / SIZE)) * 0.3;
      const pebble = stone[index] as number;
      const gap = Math.min(1, (crack[index] as number) * 0.9);
      for (let k = 0; k < 3; k++) {
        const soil =
          t < 0.5
            ? (DARK[k] as number) + ((MID[k] as number) - (DARK[k] as number)) * t * 2
            : (MID[k] as number) + ((LIGHT[k] as number) - (MID[k] as number)) * (t - 0.5) * 2;
        let value = soil + ((STAIN[k] as number) - soil) * stain;
        value += ((CRACK[k] as number) - value) * gap;
        // Steine sind grau und je für sich etwas heller oder dunkler.
        value += (104 + pebble * 74 - value) * Math.min(1, pebble * 1.6) * 0.85;
        colors[at + k] = value;
      }
      colors[at + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D-Canvas ist nicht verfügbar.');
  context.putImageData(new ImageData(colors, SIZE, SIZE), 0, 0);
  const color = new THREE.CanvasTexture(canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  // Wie die Richtungstextur zeilenweise von oben gelesen, damit beide deckungsgleich liegen.
  color.flipY = false;

  const normal = new THREE.DataTexture(normals, SIZE, SIZE, THREE.RGBAFormat);
  normal.generateMipmaps = true;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.magFilter = THREE.LinearFilter;

  for (const texture of [color, normal]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }
  return { color, normal };
}

/** Die Bodenfläche der ganzen Welt; `islands` sind die Standorte der Feuerschalen. */
export function createGround(random: Random, halfSize: number, islands: readonly Site[]): THREE.Mesh {
  const { color, normal } = paintGround(random);
  const repeat = (halfSize * 2) / TILE_METERS;
  color.repeat.set(repeat, repeat);
  normal.repeat.set(repeat, repeat);

  const material = swallowedByFinsternis(
    new THREE.MeshStandardMaterial({ map: color, normalMap: normal, roughness: 1, metalness: 0 }),
  );
  const sites = islands.map((site) => new THREE.Vector2(site.x, site.z));
  // Die Finsternis hängt schon am selben Haken und bringt die Lage in der Welt und ihr Rauschen mit.
  extendShader(material, `boden-${sites.length}`, (shader) => {
    shader.uniforms.uGroundIslands = { value: sites };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec2 uGroundIslands[${Math.max(1, sites.length)}];`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        // Fleckenweise mischt sich eine zweite, gröbere Abtastung dazu: So fällt die Kachel nicht auf.
        vec2 groundCoarseUv = vMapUv * 0.43 + vec2(0.31, 0.17);
        float groundBlend = 0.5 * smoothstep(0.42, 0.64, finsternisNoise(vFinsternisPosition * 0.06 + 3.7));
        vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map, groundCoarseUv), groundBlend);
        // Großflächig wechselt der Boden zwischen hellem Staub und dunkler Erde.
        sampledDiffuseColor.rgb *= 0.82 + 0.4 * finsternisNoise(vFinsternisPosition * 0.027 + 11.0);
        // Asche und Ruß um die Feuerschalen, mit ausgefranstem Rand.
        float groundAsh = 0.0;
        float groundFray = (finsternisNoise(vFinsternisPosition * 1.7) - 0.5) * 1.3;
        for (int i = 0; i < ${sites.length}; i++) {
          groundAsh = max(groundAsh, 1.0 - smoothstep(0.7, 3.6, distance(vFinsternisPosition, uGroundIslands[i]) + groundFray));
        }
        float groundLuma = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.6, 0.1));
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(groundLuma * 0.2), groundAsh * 0.92);
        diffuseColor *= sampledDiffuseColor;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        vec3 mapN = mix(texture2D(normalMap, vNormalMapUv).xyz, texture2D(normalMap, groundCoarseUv).xyz, groundBlend) * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`,
      );
  });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(halfSize * 2, halfSize * 2), material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

/**
 * Ein dürres Grasbüschel: eine Handvoll Halme, die aus einem Punkt nach außen fallen.
 * Auf Durchmesser 1 gebracht wie die übrige Kulisse.
 */
export function tuftModel(random: Random): PropModel {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const shades = [new THREE.Color(0x4a3e28), new THREE.Color(0x94855a), new THREE.Color(0xc2b383)] as const;
  const blades = 9;
  for (let b = 0; b < blades; b++) {
    const yaw = random() * Math.PI * 2;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const lean = 0.2 + random() * 0.55;
    const tall = 0.45 + random() * 0.55;
    // Breiter als echte Halme: Dünnere wären aus der Spielkamera nur flimmernde Striche.
    const width = 0.055 + random() * 0.04;
    const start = random() * 0.1;
    // Fuß, Mitte und Spitze des Halms; er wird nach oben schmaler.
    const spine: [number, number, number][] = [
      [dx * start, 0, dz * start],
      [dx * (start + lean * 0.35), tall * 0.55, dz * (start + lean * 0.35)],
      [dx * (start + lean), tall, dz * (start + lean)],
    ];
    const corner = (level: 0 | 1, side: number): [number, number, number] => {
      const [x, y, z] = spine[level] as [number, number, number];
      const half = width * (level === 0 ? 1 : 0.6) * side;
      return [x + dz * half, y, z - dx * half];
    };
    const triangles: [[number, number, number], number][][] = [
      [[corner(0, -1), 0], [corner(0, 1), 0], [corner(1, 1), 1]],
      [[corner(0, -1), 0], [corner(1, 1), 1], [corner(1, -1), 1]],
      [[corner(1, -1), 1], [corner(1, 1), 1], [spine[2] as [number, number, number], 2]],
    ];
    // Jedes Dreieck gibt es in beiden Drehrichtungen: Von hinten gesehen würde es sonst
    // seine nach oben gerichtete Normale umkehren und schwarz bleiben.
    for (const triangle of [...triangles, ...triangles.map((t) => [...t].reverse())]) {
      for (const [point, level] of triangle) {
        positions.push(...point);
        // Nach oben gerichtet wie der Boden: So werden Halme von beiden Seiten gleich hell.
        const n = new THREE.Vector3(dx * 0.35, 1, dz * 0.35).normalize();
        normals.push(n.x, n.y, n.z);
        const shade = shades[level] as THREE.Color;
        colors.push(shade.r, shade.g, shade.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  const size = (geometry.boundingBox ?? new THREE.Box3()).getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z) || 1;
  geometry.scale(1 / footprint, 1 / footprint, 1 / footprint);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = swallowedByFinsternis(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  );
  return { geometry, material, height: size.y / footprint, width: 1, receiveShadow: false };
}
