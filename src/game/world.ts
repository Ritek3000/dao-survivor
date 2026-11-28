import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG, type SceneryModel } from '../config';
import { createRandom, deriveSeed, type Random } from '../core/random';
import { SpatialGrid } from '../core/spatialGrid';
import { swallowedByFinsternis } from './darkness';
import { createGround, tuftModel, type Ground } from './ground';
import type { PropModel } from './models';
import { buildScenery, type Placement } from './scenery';
import type { Site } from './zones';

/** Kreisförmiges Hindernis auf dem Boden. */
interface Obstacle extends Site {
  radius: number;
}

/** Unter diesen Namen stehen die Grasbüschel bei den Modellen der Kulisse. */
const TUFTS = ['bewuchs-1', 'bewuchs-2', 'bewuchs-3'] as const;
const NIGHT_SKY = new THREE.Color(0x2b3447);
const NIGHT_GROUND = new THREE.Color(0x0b0907);
/** Bei Tag bricht der Staub das Licht zu einem schmutzig gelbgrauen Zwielicht. */
const DAWN_SKY = new THREE.Color(0x8f8566);
const DAWN_GROUND = new THREE.Color(0x3a3428);

/** Unterscheidet den Zufallsstrom der Welt von denen der übrigen Teile eines Laufs (siehe `deriveSeed`). */
const WORLD_SALT = 700;
/** Die kahlen Stämme und die Steinmale sind je ein Instanznetz fester Größe; nur ihre Plätze wechseln mit dem Lauf. */
const BOUNDARY_STONES = 80;

const pose = new THREE.Object3D();

export class World {
  readonly group = new THREE.Group();
  /** Standorte der Feuerschalen; Felsen und Bäume halten Abstand dazu. Jeder Lauf stellt sie neu (`generate`). */
  islandSites: readonly Site[] = [];
  private readonly ground: Ground;
  private readonly deadTrees = createDeadTrees(CONFIG.scenery.bareTrunks);
  private readonly boundaryStones = createBoundaryStones(BOUNDARY_STONES);
  /** Felsen, Totholz und Gras als Netze; erst da, wenn die Modelle geladen sind. */
  private scenery: THREE.Group | null = null;
  /** Die Modelle der Kulisse (samt den Grasbüscheln), sobald `dress` sie bekommen hat; für jede neue Welt gebraucht. */
  private props: ReadonlyMap<string, PropModel> | null = null;
  private readonly ambient = new THREE.HemisphereLight(NIGHT_SKY, NIGHT_GROUND, 0.3);
  private readonly obstacles = new SpatialGrid<Obstacle>(4);
  /** Wo Felsen und Totholz stehen; ihre Netze kommen erst mit den geladenen Modellen dazu. */
  private readonly placements: Placement[] = [];
  private largestObstacle = 0;
  // Zwischenspeicher für resolve(), damit pro Abfrage keine Funktion erzeugt wird.
  private resolveTarget: Site = { x: 0, z: 0 };
  private resolveRadius = 0;

  constructor() {
    // Die Kachel des Bodens braucht ihre Zeit zum Errechnen und entsteht darum nur einmal; was sich je Lauf ändert, steht in `generate`.
    this.ground = createGround(createRandom(CONFIG.world.seed), CONFIG.world.radius + 60, CONFIG.islands.count);
    // Dhârgass ist ein schwarzer Mond: fast kein Umgebungslicht, nur Umrisse.
    this.group.add(this.ambient, this.ground.mesh, this.deadTrees, this.boundaryStones);
    // Bis ein Lauf beginnt (Titelbild), steht die Welt des festen Seeds da.
    this.generate(CONFIG.world.seed);
  }

  /**
   * Baut die Welt eines Laufs aus dessen Seed: Feuerschalen, Felsen, Totholz, kahle Stämme, Gras und Steinmale stehen bei jedem Seed
   * anders, bei demselben Seed immer gleich (der Strom hängt nur vom Seed ab, nicht davon, was vorher war). Zahl, Größen und Abstände
   * kommen aus `CONFIG`; nur die Orte wechseln, so dass sich das Gleichgewicht nicht verschiebt. Danach muss `Zones.arrange` die
   * Feuerschalen an `islandSites` stellen.
   */
  generate(seed: number): void {
    const random = createRandom(deriveSeed(seed, WORLD_SALT));
    this.obstacles.clear();
    this.largestObstacle = 0;
    this.placements.length = 0;

    this.islandSites = createIslandSites(random);
    for (const site of this.islandSites) this.addObstacle(site.x, site.z, 0.5);
    this.ground.arrange(this.islandSites, random);

    const { rocks, rockModels, rockBlocksFrom, wood, woodModels, tufts } = CONFIG.scenery;
    this.scatter(random, rocks, rockModels, rockBlocksFrom);
    this.scatter(random, wood, woodModels, 0);
    this.scatterTufts(random, tufts);
    this.placeDeadTrees(random);
    this.placeBoundaryStones(random);
    this.rebuildScenery();
  }

  /** Setzt die geladenen Modelle an ihre Standorte. Einmal aufzurufen, sobald sie da sind; jede neue Welt (`generate`) nimmt sie wieder. */
  dress(props: ReadonlyMap<string, PropModel>): void {
    // Die Grasbüschel sind keine Dateien; sie entstehen hier und reihen sich bei den Modellen ein.
    const all = new Map(props);
    const random = createRandom(CONFIG.world.seed + 7);
    for (const name of TUFTS) all.set(name, tuftModel(random));
    this.props = all;
    this.rebuildScenery();
  }

  /** Schiebt einen Kreis aus allen Hindernissen heraus und hält ihn innerhalb der Steinmale. */
  resolve(position: Site, radius: number): void {
    this.resolveTarget = position;
    this.resolveRadius = radius;
    this.obstacles.query(position.x, position.z, radius + this.largestObstacle, this.pushOut);

    const limit = CONFIG.world.radius - radius;
    const fromCenter = Math.hypot(position.x, position.z);
    if (fromCenter > limit) {
      const scale = limit / fromCenter;
      position.x *= scale;
      position.z *= scale;
    }
  }

  /** 0 = tiefe Nacht, 1 = Sonnenaufgang. */
  setDawn(amount: number): void {
    this.ambient.color.lerpColors(NIGHT_SKY, DAWN_SKY, amount);
    this.ambient.groundColor.lerpColors(NIGHT_GROUND, DAWN_GROUND, amount);
    this.ambient.intensity = 0.3 + amount * 2.2;
  }

  private readonly pushOut = (obstacle: Obstacle): void => {
    const position = this.resolveTarget;
    const dx = position.x - obstacle.x;
    const dz = position.z - obstacle.z;
    const minDistance = this.resolveRadius + obstacle.radius;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= minDistance * minDistance) return;
    const distance = Math.sqrt(distanceSq);
    if (distance < 1e-5) {
      position.x += minDistance;
      return;
    }
    const push = (minDistance - distance) / distance;
    position.x += dx * push;
    position.z += dz * push;
  };

  private addObstacle(x: number, z: number, radius: number): void {
    this.obstacles.insert(x, z, { x, z, radius });
    this.largestObstacle = Math.max(this.largestObstacle, radius);
  }

  /**
   * Verteilt `count` Kopien der Modelle über die Welt, nach ihrer Häufigkeit gewichtet.
   * Runde Stücke unter `blocksFrom` Metern Durchmesser stehen nicht im Weg.
   */
  private scatter(random: Random, count: number, models: readonly SceneryModel[], blocksFrom: number): void {
    const totalWeight = models.reduce((sum, model) => sum + model.weight, 0);
    for (let i = 0; i < count; i++) {
      let pick = random() * totalWeight;
      const model = models.find((candidate) => (pick -= candidate.weight) < 0) ?? models[0];
      if (!model) return;
      const { x, z } = this.scatterClear(random);
      const [smallest, largest] = model.size;
      // Die meisten Stücke sind klein, wenige groß.
      const size = smallest + random() ** 2 * (largest - smallest);
      const yaw = random() * Math.PI * 2;
      this.placements.push({ file: model.file, x, z, yaw, size });

      if (model.shape === 'rund' && size >= blocksFrom) {
        this.addObstacle(x, z, size * 0.38);
      } else if (model.shape === 'lang') {
        // Ein liegender Stamm: drei Kreise entlang seiner Länge.
        for (const along of [-0.34, 0, 0.34]) {
          this.addObstacle(x + Math.cos(yaw) * along * size, z - Math.sin(yaw) * along * size, size * 0.13);
        }
      }
    }
  }

  /** Dürres Gras wächst in Flecken: Wo eines steht, stehen meist mehrere. */
  private scatterTufts(random: Random, count: number): void {
    // Das Muster ist an feste Orte gebunden; die Verschiebung (Wellenlängen 20 bis 60 m) legt die Flecken in jedem Lauf woandershin.
    const shiftX = random() * 60;
    const shiftZ = random() * 60;
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 6; attempt++) {
      const { x, z } = this.scatterClear(random);
      // Zwei überlagerte Wellen ergeben ein ruhiges Fleckenmuster ohne eigene Rauschfunktion.
      const u = x + shiftX;
      const v = z + shiftZ;
      const patch = Math.sin(u * 0.11 + 1.3) * Math.cos(v * 0.13 - 0.7) + 0.6 * Math.sin((u + v) * 0.31);
      if (patch < 0.15 + random() * 0.5) continue;
      const name = TUFTS[Math.floor(random() * TUFTS.length)] ?? TUFTS[0];
      this.placements.push({ file: name, x, z, yaw: random() * Math.PI * 2, size: 0.4 + random() * 0.55 });
      placed++;
    }
  }

  /** Stellt die kahlen Stämme neu; das Netz bleibt, nur seine Plätze und Maße wechseln. */
  private placeDeadTrees(random: Random): void {
    const mesh = this.deadTrees;
    for (let i = 0; i < mesh.count; i++) {
      const { x, z } = this.scatterClear(random);
      const width = 0.8 + random() * 0.8;
      pose.position.set(x, 0, z);
      pose.rotation.set((random() - 0.5) * 0.25, random() * Math.PI * 2, (random() - 0.5) * 0.25);
      pose.scale.set(width, 2.4 + random() * 3.2, width);
      pose.updateMatrix();
      mesh.setMatrixAt(i, pose.matrix);
      this.addObstacle(x, z, 0.26 * width + 0.05);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // Die Hüllkugel gilt für die alten Plätze; ohne neue würde das Netz am falschen Rand aussortiert.
    mesh.computeBoundingSphere();
  }

  /** Steinmale markieren den letzten sicheren Punkt und damit den Rand der Karte; jedes steht je Lauf etwas anders schief. */
  private placeBoundaryStones(random: Random): void {
    const mesh = this.boundaryStones;
    const ringRadius = CONFIG.world.radius + 1.2;
    for (let i = 0; i < mesh.count; i++) {
      const angle = (i / mesh.count) * Math.PI * 2;
      pose.position.set(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
      pose.rotation.set((random() - 0.5) * 0.12, Math.PI / 2 - angle, (random() - 0.5) * 0.12);
      pose.scale.set(0.8 + random() * 0.4, 0.75 + random() * 0.5, 1);
      pose.updateMatrix();
      mesh.setMatrixAt(i, pose.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  /** Ersetzt die Netze der Kulisse durch welche für die jetzigen Standorte; ohne geladene Modelle gibt es noch keine. */
  private rebuildScenery(): void {
    if (this.scenery) {
      this.group.remove(this.scenery);
      // Die Geometrie und das Material gehören den Modellen und bleiben; frei wird nur, was die Netze selbst belegen (die Matrizen).
      for (const mesh of this.scenery.children) if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
    this.scenery = this.props ? buildScenery(this.placements, this.props) : null;
    if (this.scenery) this.group.add(this.scenery);
  }

  /** Zufälliger Punkt, der den Start und die Lichtkreise der Feuerschalen frei lässt. */
  private scatterClear(random: Random): Site {
    const clearance = CONFIG.islands.radius * 0.6;
    let point = scatterPoint(random, CONFIG.world.spawnClearing, CONFIG.world.radius + 30);
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = point;
      if (this.islandSites.every((site) => Math.hypot(site.x - candidate.x, site.z - candidate.z) > clearance)) break;
      point = scatterPoint(random, CONFIG.world.spawnClearing, CONFIG.world.radius + 30);
    }
    return point;
  }
}

/** So oft wird ein Standort gewürfelt, bevor der Mindestabstand enger gefasst wird. */
const SITE_ATTEMPTS = 3000;

/**
 * Verteilt die Feuerschalen mit Mindestabstand; eine steht nah am Start. Es werden immer genau `CONFIG.islands.count`:
 * Findet der Zufall eines Seeds nach `SITE_ATTEMPTS` Würfen keinen Platz mehr, rückt der Mindestabstand um ein Zehntel zusammen.
 */
function createIslandSites(random: Random): Site[] {
  const { count, spacing, firstDistance } = CONFIG.islands;
  const firstAngle = random() * Math.PI * 2;
  const sites: Site[] = [{ x: Math.cos(firstAngle) * firstDistance, z: Math.sin(firstAngle) * firstDistance }];
  for (let gap = spacing; sites.length < count; gap *= 0.9) {
    for (let attempt = 0; attempt < SITE_ATTEMPTS && sites.length < count; attempt++) {
      const candidate = scatterPoint(random, firstDistance, CONFIG.world.radius - 8);
      if (sites.every((site) => Math.hypot(site.x - candidate.x, site.z - candidate.z) >= gap)) {
        sites.push(candidate);
      }
    }
  }
  return sites;
}

/** Netz der kahlen Stämme; seine Plätze setzt `placeDeadTrees`. */
function createDeadTrees(count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    createDeadTreeGeometry(),
    swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 })),
    count,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Netz der Steinmale am Rand; seine Plätze setzt `placeBoundaryStones`. */
function createBoundaryStones(count: number): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(0.8, 2.6, 0.5);
  geometry.translate(0, 1.3, 0);
  const mesh = new THREE.InstancedMesh(
    geometry,
    swallowedByFinsternis(new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.9, flatShading: true })),
    count,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Kahler Stamm mit drei Aststümpfen, ein Meter hoch; die Instanz streckt ihn auf Baumhöhe. */
function createDeadTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.1, 0.26, 1, 6);
  trunk.translate(0, 0.5, 0);
  const branch = (height: number, yaw: number, length: number): THREE.BufferGeometry => {
    const geometry = new THREE.CylinderGeometry(0.02, 0.06, length, 5);
    geometry.translate(0, length / 2, 0);
    geometry.rotateZ(1.3);
    geometry.rotateY(yaw);
    geometry.translate(0, height, 0);
    return geometry;
  };
  return mergeGeometries([trunk, branch(0.5, 0.4, 1.2), branch(0.66, 2.6, 0.9), branch(0.8, 4.4, 0.7)]);
}

/** Gleichmäßig über die Fläche eines Kreisrings verteilt. */
function scatterPoint(random: Random, minRadius: number, maxRadius: number): Site {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(minRadius ** 2 + random() * (maxRadius ** 2 - minRadius ** 2));
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
